// Chapter 02, ported from pmndrs/examples `building-live-envmaps`: a Porsche
// 911 lit by an environment that is rendered live from lightformer geometry.
// The demo's R3F + drei + lamina wrapper is replaced with an imperative
// SectionWorld. drei's `Environment` is a CubeCamera parked in a virtual
// scene of white lightformer meshes; its cube texture is the car's
// scene.environment. A planar render target projects a mirror image onto the
// reflective floor. The demo's backdrop and shadow plane are omitted.
import * as THREE from "three/webgpu";
import type { PerspectiveCamera, WebGPURenderer } from "three/webgpu";
import { pass } from "three/tsl";
import {
  abs,
  color,
  float,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  positionWorld,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec4,
} from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import type { SectionWorld } from "../types";
import { liveEnvMeta } from "./meta";

const CAR_URL = "/building-live-envmaps/car.glb";
/** The lightformer rail slides 10 units/s in the demo. */
const LIGHTFORMER_SPEED = 10;
const ENV_CUBE_SIZE = 32;
/** Planar-reflector plane and reflection texture resolution scale. */
const FLOOR_Y = -1.2;
const REFLECTION_SCALE = 1.0;
/** Clip space (-1..1) to texture space (0..1) bias, as in three's Reflector. */
const REFLECTION_BIAS = new THREE.Matrix4().set(
  0.5,
  0,
  0,
  0.5,
  0,
  0.5,
  0,
  0.5,
  0,
  0,
  0.5,
  0.5,
  0,
  0,
  0,
  1,
);

type LightformerForm = "plane" | "circle" | "ring";

export function createLiveEnvWorld(
  camera: PerspectiveCamera,
  renderer: WebGPURenderer,
): SectionWorld {
  const scene = new THREE.Scene();
  let disposed = false;

  //* Lights =======================================================
  renderer.shadowMap.enabled = true;
  const spot = new THREE.SpotLight("#ffffff", 2 * Math.PI, 0, 0.3, 1, 0);
  spot.position.set(0, 15, 0);
  spot.castShadow = true;
  spot.shadow.mapSize.set(2048, 2048);
  spot.shadow.bias = -0.0001;
  spot.shadow.radius = 4;
  const ambient = new THREE.AmbientLight("#ffffff", 0.5 * Math.PI);
  scene.add(spot, ambient);

  //* Virtual environment scene ====================================
  // Only this scene is rendered by the CubeCamera. Its white meshes are the
  // demo's Lightformers.
  const envScene = new THREE.Scene();
  const envResources: Array<{
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
  }> = [];

  const lightformer = (
    form: LightformerForm,
    intensity: number,
    tint = "#ffffff",
  ) => {
    const geometry =
      form === "circle"
        ? new THREE.CircleGeometry(1, 64)
        : form === "ring"
          ? new THREE.RingGeometry(0.6, 1, 64)
          : new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    material.color.set(tint).multiplyScalar(intensity);
    envResources.push({ geometry, material });
    return new THREE.Mesh(geometry, material);
  };

  const ceiling = lightformer("plane", 0.75);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, 5, -9);
  ceiling.scale.set(10, 10, 1);
  envScene.add(ceiling);

  // The row of circular softboxes that scrolls past the car.
  const rail = new THREE.Group();
  const moving = new THREE.Group();
  for (const [i, x] of [2, 0, 2, 0, 2, 0, 2, 0].entries()) {
    const softbox = lightformer("circle", 2);
    softbox.rotation.x = Math.PI / 2;
    softbox.position.set(x, 4, i * 4);
    softbox.scale.set(3, 1, 1);
    moving.add(softbox);
  }
  rail.rotation.y = 0.5;
  rail.add(moving);
  envScene.add(rail);

  const sideLeft = lightformer("plane", 4);
  sideLeft.rotation.y = Math.PI / 2;
  sideLeft.position.set(-5, 1, -1);
  sideLeft.scale.set(20, 0.1, 1);
  envScene.add(sideLeft);

  const sideLeftLower = lightformer("plane", 1);
  sideLeftLower.rotation.y = Math.PI / 2;
  sideLeftLower.position.set(-5, -1, -1);
  sideLeftLower.scale.set(20, 0.5, 1);
  envScene.add(sideLeftLower);

  const sideRight = lightformer("plane", 1);
  sideRight.rotation.y = -Math.PI / 2;
  sideRight.position.set(10, 1, 0);
  sideRight.scale.set(20, 1, 1);
  envScene.add(sideRight);

  // Floating red accent ring, mirrored in the car's paint.
  const redRing = lightformer("ring", 1, "#ff0000");
  redRing.position.set(-15, 4, -18);
  redRing.scale.setScalar(10);
  redRing.lookAt(0, 0, 0);
  envScene.add(redRing);

  // Live environment: a CubeCamera in the virtual scene feeds the car.
  const cubeTarget = new THREE.CubeRenderTarget(ENV_CUBE_SIZE, {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
  });
  const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeTarget);
  cubeCamera.position.set(0, 2, 0);
  scene.environment = cubeTarget.texture;
  scene.environmentIntensity = 1;

  //* Reflective floor =============================================
  const reflectionTarget = new THREE.RenderTarget(1024, 1024, {
    type: THREE.HalfFloatType,
  });
  const reflectionCamera = new THREE.PerspectiveCamera();
  const reflectionDirection = new THREE.Vector3();
  const reflectionTargetPoint = new THREE.Vector3();
  const reflectionUp = new THREE.Vector3();

  const reflectionMatrix = uniform(new THREE.Matrix4());
  const floorGeometry = new THREE.PlaneGeometry(200, 200);
  const floorMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: true,
  });
  const floorWorld = positionWorld.xz;
  const floorCell = floorWorld.div(6);
  const floorDistanceToLine = abs(fract(floorCell.sub(0.5)).sub(0.5)).div(
    max(fwidth(floorCell), vec2(0.0001)),
  );
  const floorLine = float(1).sub(
    min(floorDistanceToLine.x, floorDistanceToLine.y).div(1.5).clamp(0, 1),
  );
  const floorFade = float(1).sub(smoothstep(25, 55, length(floorWorld)));
  // Project the floor's world position into the reflection camera, like
  // three's Reflector, so the mirrored image lands on the right texels.
  const reflectionClip = reflectionMatrix.mul(vec4(positionWorld, 1));
  const reflectionUv = reflectionClip.xy.div(reflectionClip.w);
  // The WebGPU render target is stored top-down; flip V to match the
  // bottom-left texture convention.
  const reflectionColor = texture(reflectionTarget.texture).sample(
    vec2(reflectionUv.x, float(1).sub(reflectionUv.y)),
  ).rgb;
  floorMaterial.colorNode = vec4(
    mix(color("#0b0d14"), reflectionColor, 0.82).add(
      color("#39466b").mul(floorLine).mul(0.22),
    ),
    1,
  );
  floorMaterial.opacityNode = floorFade;
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  scene.add(floor);

  //* Car ==========================================================
  let car: THREE.Object3D | null = null;
  const draco = new DRACOLoader();
  draco.setDecoderPath("/draco/");
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(draco);

  void gltfLoader
    .loadAsync(CAR_URL)
    .then((gltf) => {
      if (disposed) {
        disposeObject(gltf.scene);
        return;
      }
      const model = gltf.scene;
      model.scale.setScalar(1.6);
      model.position.set(-0.5, -0.18, 0);
      model.rotation.y = Math.PI / 5;

      const seen = new Set<THREE.Material>();
      model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const material of materials) {
          if (!material || seen.has(material)) continue;
          seen.add(material);
          applyCarMaterial(material);
        }
      });

      car = model;
      scene.add(model);
      draco.dispose();
    })
    .catch((error) => {
      console.warn("Live Env: car failed to load.", error);
      draco.dispose();
    });

  //* Camera rig ===================================================
  camera.near = 0.1;
  camera.far = 500;
  camera.updateProjectionMatrix();

  const cameraGoal = new THREE.Vector3();
  let time = 0;

  const updateReflection = () => {
    reflectionCamera.fov = camera.fov;
    reflectionCamera.aspect = camera.aspect;
    reflectionCamera.near = camera.near;
    reflectionCamera.far = camera.far;
    reflectionCamera.updateProjectionMatrix();

    reflectionCamera.position.set(
      camera.position.x,
      2 * FLOOR_Y - camera.position.y,
      camera.position.z,
    );

    camera.getWorldDirection(reflectionDirection);
    reflectionTargetPoint.copy(camera.position).add(reflectionDirection);
    reflectionTargetPoint.y = 2 * FLOOR_Y - reflectionTargetPoint.y;

    reflectionUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    reflectionCamera.up.set(reflectionUp.x, -reflectionUp.y, reflectionUp.z);
    reflectionCamera.lookAt(reflectionTargetPoint);
    reflectionCamera.updateMatrixWorld();

    reflectionMatrix.value
      .copy(REFLECTION_BIAS)
      .multiply(reflectionCamera.projectionMatrix)
      .multiply(reflectionCamera.matrixWorldInverse);

    // Do not sample the floor while it is being rendered.
    floor.visible = false;
    const previousTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(reflectionTarget);
    renderer.render(scene, reflectionCamera);
    renderer.setRenderTarget(previousTarget);
    floor.visible = true;
  };

  return {
    id: liveEnvMeta.id,
    index: liveEnvMeta.index,
    scene,
    camera,
    pass: pass(scene, camera),
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      const size = renderer.getSize(new THREE.Vector2());
      reflectionTarget.setSize(
        Math.max(256, Math.round(size.x * REFLECTION_SCALE)),
        Math.max(256, Math.round(size.y * REFLECTION_SCALE)),
      );
    },
    animate({ delta }) {
      const dt = Math.min(delta, 0.05);
      time += dt;

      // The lightformer rail drifts; the red ring floats on its own clock.
      moving.position.z += dt * LIGHTFORMER_SPEED;
      if (moving.position.z > 20) moving.position.z = -60;
      redRing.position.y = 4 + Math.sin(time * 5) * 0.4;
      redRing.rotation.z = Math.sin(time * 3.5) * 0.25;

      // Refresh the live environment (cube camera -> PMREM for the car).
      cubeCamera.update(renderer, envScene);

      // The demo's trucking shot: lerp toward a slowly circling eye.
      cameraGoal.set(Math.sin(time / 5), 0, 12 + Math.cos(time / 5) / 2);
      const blend = 1 - Math.exp(-3 * dt);
      camera.position.lerp(cameraGoal, blend);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      updateReflection();
    },
    dispose() {
      disposed = true;
      draco.dispose();
      if (car) {
        scene.remove(car);
        disposeObject(car);
      }
      scene.remove(spot, ambient, floor);
      floorGeometry.dispose();
      floorMaterial.dispose();
      for (const { geometry, material } of envResources) {
        geometry.dispose();
        material.dispose();
      }
      cubeTarget.dispose();
      reflectionTarget.dispose();
      spot.dispose();
    },
  };
}

/** A flat lavender stage if the scene fails to build. */
export function createLiveEnvFallbackWorld(
  camera: PerspectiveCamera,
): SectionWorld {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#9b8db4");
  return {
    id: liveEnvMeta.id,
    index: liveEnvMeta.index,
    scene,
    camera,
    pass: pass(scene, camera),
    resize() {},
    animate() {},
    dispose() {},
  };
}

/** The demo's material tweaks for the Porsche. */
function applyCarMaterial(material: THREE.Material) {
  const standard = material as THREE.MeshStandardMaterial;
  switch (material.name) {
    case "rubber":
      standard.color.set("#222222");
      standard.roughness = 0.6;
      standard.roughnessMap = null;
      standard.normalScale?.set(4, 4);
      standard.needsUpdate = true;
      break;
    case "window":
      standard.color.set("#000000");
      standard.roughness = 0;
      break;
    case "coat":
      standard.envMapIntensity = 4;
      standard.roughness = 0.5;
      standard.metalness = 1;
      standard.needsUpdate = true;
      break;
    case "paint":
      standard.envMapIntensity = 2;
      standard.roughness = 0.45;
      standard.metalness = 0.8;
      standard.color.set("#555555");
      standard.needsUpdate = true;
      break;
    default:
      break;
  }
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = mesh.material
      ? Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]
      : [];
    for (const entry of materials) {
      for (const value of Object.values(entry)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      entry.dispose();
    }
  });
}

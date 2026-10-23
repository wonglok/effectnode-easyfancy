// Chapter 06: a dark room full of old computers, ported from pmndrs/examples
// `monitors`. The reference's R3F/drei/postprocessing stack becomes an
// imperative WebGPU world: the same computers GLB, live render targets on the
// monitor panels, blinking power LEDs, a blurred planar reflection and a
// pointer-following camera. Bloom/DOF/AO are omitted; the screens stay
// tone-mapping-free so they still read as light sources.
import * as THREE from "three/webgpu";
import type { Node, PerspectiveCamera, WebGPURenderer } from "three/webgpu";
import { pass } from "three/tsl";
import {
  color,
  length,
  mix,
  oneMinus,
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
import { samplePointer } from "../shared/section-activity";
import { monitorsMeta } from "./meta";
import {
  createHeartFeed,
  type HeartPlacement,
  type ScreenFeed,
} from "./screens";

const COMPUTERS_URL = "/monitors/computers.glb";
const FLOOR_Y = -1;
const REFLECTION_SCALE = 0.5;
const CAMERA_DISTANCE = 5.5;
const CAMERA_DRIFT = 1.7;
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

export async function createMonitorsWorld(
  camera: PerspectiveCamera,
  renderer: WebGPURenderer,
): Promise<SectionWorld> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(monitorsMeta.surface);

  //* Lights =======================================================
  renderer.shadowMap.enabled = true;
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x000000, 0.15);
  const spot = new THREE.SpotLight(0xffffff, Math.PI, 0, 0.12, 1, 0);
  spot.position.set(10, 20, 10);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0002;
  spot.shadow.radius = 3;
  scene.add(hemisphere, spot);

  //* Models =======================================================
  const draco = new DRACOLoader();
  draco.setDecoderPath("/draco/");
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  const computers = await loader.loadAsync(COMPUTERS_URL);
  draco.dispose();

  // The model already carries the reference's authored placements. The stage
  // group mirrors the demo's `group position={[0, -1, 0]}`.
  const stage = new THREE.Group();
  stage.position.set(0, -1, 0);
  scene.add(stage);

  const wall = computers.scene;
  stage.add(wall);

  const screens: THREE.Mesh[] = [];
  const leds: THREE.Mesh[] = [];
  wall.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      if (material.name === "Screen") screens.push(mesh);
      else if (material.name === "led") leds.push(mesh);
    }
  });

  // Each panel samples a small sub-rect of its feed texture, so the hearts sit
  // on the centres of the four distinct rects (u 0.16/0.49, v 0.58/0.875); the
  // orange screen keeps the single rect the reference framed.
  const textHearts: HeartPlacement[] = [
    { x: -4.72, y: 5.24 },
    { x: -0.11, y: 5.24 },
    { x: -4.72, y: 1.1 },
    { x: -0.09, y: 1.06 },
  ];
  const feeds: ScreenFeed[] = [
    createHeartFeed({
      background: "#35c19f",
      color: "#0b0b0b",
      cameraZ: 15,
      placements: textHearts,
      size: 1.9,
      phase: 0,
    }),
    createHeartFeed({
      background: "#0b0b0b",
      color: "#35c19f",
      cameraZ: 15,
      placements: textHearts,
      size: 1.9,
      phase: 1.7,
    }),
    createHeartFeed({
      background: "#ff7a1a",
      color: "#8d2f2f",
      cameraZ: 10,
      placements: [{ x: -3.15, y: 0.75 }],
      size: 1.35,
      phase: 3.1,
    }),
  ];
  const orangeScreenName = "Object_207";
  let textFeed = 0;
  screens
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((mesh) => {
      if (mesh.name === orangeScreenName) {
        mesh.material = feeds[2].material;
      } else {
        mesh.material = feeds[textFeed % 2].material;
        textFeed += 1;
      }
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });

  // Power LEDs: one unlit material per lamp, pulsed on its own clock.
  const ledEntries = leds.map((mesh) => {
    const material = new THREE.MeshBasicNodeMaterial({ toneMapped: false });
    mesh.material = material;
    return {
      material,
      phase: Math.abs(2 + mesh.position.x),
    };
  });

  const warm = new THREE.PointLight("orange", 1, 1.5, 0);
  warm.position.set(-0.15, 0.7, 0);
  stage.add(warm);

  //* Reflective floor =============================================
  const initialSize = renderer.getSize(new THREE.Vector2());
  const reflectionTarget = new THREE.RenderTarget(
    Math.max(256, Math.round(initialSize.x * REFLECTION_SCALE)),
    Math.max(256, Math.round(initialSize.y * REFLECTION_SCALE)),
    { type: THREE.HalfFloatType },
  );
  const reflectionTexel = uniform(
    new THREE.Vector2(1 / reflectionTarget.width, 1 / reflectionTarget.height),
  );
  const reflectionMatrix = uniform(new THREE.Matrix4());
  const reflectionCamera = new THREE.PerspectiveCamera();
  const reflectionDirection = new THREE.Vector3();
  const reflectionTargetPoint = new THREE.Vector3();
  const reflectionUp = new THREE.Vector3();

  const floorGeometry = new THREE.PlaneGeometry(60, 60);
  const floorMaterial = new THREE.MeshBasicNodeMaterial({ toneMapped: true });
  const reflectionClip = reflectionMatrix.mul(vec4(positionWorld, 1));
  const reflectionUv = reflectionClip.xy.div(reflectionClip.w);
  const baseUv = vec2(reflectionUv.x, oneMinus(reflectionUv.y));
  const sampleReflection = (offset: Node<"vec2">) =>
    texture(reflectionTarget.texture).sample(baseUv.add(offset)).rgb;
  const blurred = sampleReflection(vec2(0, 0))
    .mul(0.4)
    .add(sampleReflection(reflectionTexel.mul(vec2(1.5, 0))).mul(0.15))
    .add(sampleReflection(reflectionTexel.mul(vec2(-1.5, 0))).mul(0.15))
    .add(sampleReflection(reflectionTexel.mul(vec2(0, 1.5))).mul(0.15))
    .add(sampleReflection(reflectionTexel.mul(vec2(0, -1.5))).mul(0.15));
  const floorFade = oneMinus(smoothstep(25, 40, length(positionWorld.xz)));
  floorMaterial.colorNode = vec4(
    mix(color("#07080b"), blurred, 0.85).mul(floorFade),
    1,
  );
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  scene.add(floor);

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
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(reflectionTarget);
    renderer.render(scene, reflectionCamera);
    renderer.setRenderTarget(previous);
    floor.visible = true;
  };

  //* Camera rig ===================================================
  camera.near = 0.1;
  camera.far = 40;
  camera.fov = 45;
  camera.position.set(-1.5, 1, CAMERA_DISTANCE);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  const cameraGoal = new THREE.Vector3();

  return {
    id: monitorsMeta.id,
    index: monitorsMeta.index,
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
      reflectionTexel.value.set(
        1 / reflectionTarget.width,
        1 / reflectionTarget.height,
      );
    },
    animate({ elapsed, delta, phase }) {
      // Refresh the monitor feeds, then the LEDs.
      for (const feed of feeds) {
        feed.update(elapsed, delta);
        feed.render(renderer);
      }
      for (const led of ledEntries) {
        const pulse = Math.round(
          (1 + Math.sin(led.phase * 10000 + elapsed * led.phase)) / 2,
        );
        led.material.color.setRGB(0, pulse * 1.1, pulse);
      }

      // The demo's camera rig: pointer x/y across the viewport, with a small
      // idle drift and a scroll-linked push-in.
      const pointer = samplePointer(elapsed, delta);
      cameraGoal.set(
        -1 + pointer.x * CAMERA_DRIFT + Math.sin(elapsed * 0.17) * 0.06,
        (1 + pointer.y) / 2 + Math.cos(elapsed * 0.13) * 0.03,
        CAMERA_DISTANCE - phase.sceneProgress * 0.9,
      );
      camera.position.lerp(cameraGoal, 1 - Math.exp(-2.6 * delta));
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      updateReflection();
    },
    dispose() {
      scene.remove(stage, floor);
      scene.remove(spot, hemisphere);
      spot.dispose();
      hemisphere.dispose();
      for (const feed of feeds) feed.dispose();
      for (const led of ledEntries) led.material.dispose();
      disposeObject(wall);
      floorGeometry.dispose();
      floorMaterial.dispose();
      reflectionTarget.dispose();
      scene.clear();
    },
  };
}

/** A dim stage of glowing panels if the computer wall fails to load. */
export function createMonitorsFallbackWorld(
  camera: PerspectiveCamera,
): SectionWorld {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(monitorsMeta.surface);

  const group = new THREE.Group();
  const boxGeometry = new THREE.BoxGeometry(1, 1, 0.3);
  const bodyMaterial = new THREE.MeshStandardNodeMaterial({
    color: "#20242a",
    roughness: 0.6,
  });
  const glowMaterial = new THREE.MeshBasicNodeMaterial({
    color: monitorsMeta.accent,
    toneMapped: false,
  });
  const glowGeometry = new THREE.PlaneGeometry(0.7, 0.5);
  for (let i = 0; i < 9; i += 1) {
    const body = new THREE.Mesh(boxGeometry, bodyMaterial);
    body.position.set(((i % 3) - 1) * 1.6, Math.floor(i / 3) * 1.2 - 0.4, 0);
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.z = 0.16;
    body.add(glow);
    group.add(body);
  }
  scene.add(group);

  camera.position.set(0, 0.6, 6);
  camera.lookAt(0, 0.4, 0);

  return {
    id: monitorsMeta.id,
    index: monitorsMeta.index,
    scene,
    camera,
    pass: pass(scene, camera),
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    animate({ elapsed }) {
      group.rotation.y = Math.sin(elapsed * 0.15) * 0.18;
    },
    dispose() {
      boxGeometry.dispose();
      bodyMaterial.dispose();
      glowGeometry.dispose();
      glowMaterial.dispose();
      scene.clear();
    },
  };
}

function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (!mesh.material) return;
    const entries = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const entry of entries) materials.add(entry);
  });
  for (const entry of geometries) entry.dispose();
  for (const entry of materials) {
    for (const value of Object.values(entry)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    entry.dispose();
  }
}

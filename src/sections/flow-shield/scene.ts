// Chapter 01, ported from pmndrs/examples `flow-shield`. A force-field sphere
// with hex cells, flowing noise, fresnel rim and click-triggered hit rings,
// floating over a reflective grid floor. The demo's R3F + drei + leva wrapper
// is replaced with an imperative SectionWorld; the GLSL ShaderMaterial is
// translated to TSL so it renders through this site's WebGPURenderer.
import * as THREE from "three/webgpu";
import type { PerspectiveCamera, WebGPURenderer } from "three/webgpu";
import { pass } from "three/tsl";
import {
  cameraPosition,
  dot,
  normalWorld,
  oneMinus,
  positionWorld,
  pow,
  vec4,
} from "three/tsl";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import type { SectionWorld } from "../types";
import { samplePointer } from "../shared/section-activity";
import { flowShieldMeta } from "./meta";
import { createShieldMaterial } from "./shield-material";
import { createGridFloor } from "./grid-floor";

const SHIELD_RADIUS = 1.8;
// Lowered from the demo's y=2 so the lamb on the floor sits inside the field.
const SHIELD_CENTER = new THREE.Vector3(0, 1.55, 0.2);
/** How close the scroll-linked dolly takes the camera (fraction of the base). */
const ZOOM_END = 0.55;
/** The lamb stands on the grid, inside the force field. */
const LAMB_URL = "/flow-shield/lamb.glb";
const LAMB_IDLE_URL = "/flow-shield/idle.fbx";
const LAMB_HEIGHT = 2.15;
const OCEAN_HDR_URL = "/hdr/ocean.hdr";
/** How far the head may turn from its rest pose toward the cursor. */
const HEAD_MAX_TURN = 0.55;
/** Touch devices: the head traces a slow circle, looking around naturally. */
const HEAD_ORBIT_SPEED = 0.5;
const HEAD_ORBIT_YAW = 0.42;
const HEAD_ORBIT_PITCH = 0.16;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export function createFlowShieldWorld(
  camera: PerspectiveCamera,
  renderer: WebGPURenderer,
): SectionWorld {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0e0d0c");

  //* Environment ==================================================
  // A procedural room lights the shield until the ocean HDR arrives, then the
  // ocean becomes the environment (reflections + image-based lighting).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  let environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.45;
  let disposed = false;

  void new HDRLoader()
    .loadAsync(OCEAN_HDR_URL)
    .then((hdr) => {
      const next = pmrem.fromEquirectangular(hdr);
      hdr.dispose();
      if (disposed) {
        next.dispose();
        return;
      }
      const previous = environment;
      environment = next;
      scene.environment = next.texture;
      scene.environmentIntensity = 0.5;
      previous.dispose();
    })
    .catch((error) => {
      console.warn("Flow Shield: ocean environment failed to load.", error);
    });

  //* Lighting =====================================================
  // Ambient 0.4 + warm key at (5, 8, 3), with shadows for the lamb.
  renderer.shadowMap.enabled = true;
  const ambient = new THREE.AmbientLight("#ffffff", 0.4);
  const key = new THREE.DirectionalLight("#ffeedd", 1.5);
  key.position.set(5, 8, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.normalBias = 0.04;
  const shadowCamera = key.shadow.camera;
  shadowCamera.left = -8;
  shadowCamera.right = 8;
  shadowCamera.top = 10;
  shadowCamera.bottom = -4;
  shadowCamera.near = 0.5;
  shadowCamera.far = 40;
  shadowCamera.updateProjectionMatrix();
  scene.add(ambient, key);

  const floor = createGridFloor();
  scene.add(floor.group);

  //* Shield =======================================================
  const shield = createShieldMaterial();
  const sphereGeometry = new THREE.SphereGeometry(SHIELD_RADIUS, 64, 64);
  const shieldMesh = new THREE.Mesh(sphereGeometry, shield.material);
  const shieldGroup = new THREE.Group();
  shieldGroup.position.copy(SHIELD_CENTER);
  shieldGroup.add(shieldMesh);
  scene.add(shieldGroup);

  // The demo leans on Bloom; this pipeline has no post-processing pass, so a
  // slightly larger additive fresnel shell fakes the outer glow.
  const haloGeometry = new THREE.SphereGeometry(SHIELD_RADIUS * 1.05, 48, 48);
  const haloMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
  });
  const haloView = cameraPosition.sub(positionWorld).normalize();
  const haloFresnel = pow(
    oneMinus(dot(normalWorld.normalize(), haloView)),
    2.4,
  );
  haloMaterial.colorNode = vec4(new THREE.Color("#26aeff"), 1);
  haloMaterial.opacityNode = haloFresnel.mul(0.5);
  const halo = new THREE.Mesh(haloGeometry, haloMaterial);
  halo.raycast = () => {};
  shieldGroup.add(halo);

  //* Lamb: model + idle animation =================================
  const lambRoot = new THREE.Group();
  lambRoot.position.set(0, 0, SHIELD_CENTER.z);
  // The model looks along its local +Z, so yaw it to the camera's azimuth.
  lambRoot.rotation.y = Math.atan2(
    camera.position.x - lambRoot.position.x,
    camera.position.z - lambRoot.position.z,
  );
  scene.add(lambRoot);
  let lamb: THREE.Object3D | null = null;
  let mixer: THREE.AnimationMixer | null = null;

  // Mouse-driven head look-at on desktop; touch devices get a slow circle.
  // The head/neck tracks are gone, so the head rests in its bind pose and this
  // offset is the only rotation.
  const supportsPointer =
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: fine)").matches;
  const supportsTouch =
    typeof window !== "undefined" &&
    (window.matchMedia("(pointer: coarse)").matches ||
      (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0));
  // On desktop the head circles until the visitor first moves the mouse over
  // the page, then it follows the cursor.
  let pointerEngaged = false;
  const engagePointer = () => {
    pointerEngaged = true;
  };
  if (typeof window !== "undefined") {
    window.addEventListener("pointermove", engagePointer, { passive: true });
  }
  let headBone: THREE.Bone | null = null;
  const headRestQuat = new THREE.Quaternion();
  const headForwardAxis = new THREE.Vector3(0, 0, 1);
  const headAxisCandidates = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
  ];
  const headRaycaster = new THREE.Raycaster();
  const headPointerNdc = new THREE.Vector2();
  const headWorldPos = new THREE.Vector3();
  const headParentWorld = new THREE.Quaternion();
  const headBaseWorld = new THREE.Quaternion();
  const headForwardWorld = new THREE.Vector3();
  const headDesiredDir = new THREE.Vector3();
  const headTargetPoint = new THREE.Vector3();
  const headDeltaQuat = new THREE.Quaternion();
  const headPartialQuat = new THREE.Quaternion();
  const headDesiredWorld = new THREE.Quaternion();
  const headIdentityQuat = new THREE.Quaternion();
  const headRightWorld = new THREE.Vector3();

  // The lamb GLB is Draco-compressed; the decoder ships in public/draco.
  const draco = new DRACOLoader();
  draco.setDecoderPath("/draco/");
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(draco);

  void Promise.all([
    gltfLoader.loadAsync(LAMB_URL),
    new FBXLoader().loadAsync(LAMB_IDLE_URL),
  ])
    .then(([gltf, motion]) => {
      if (disposed) return;

      const model = gltf.scene;
      // The asset is authored Z-up, as in the happy-lamb AR project.
      model.rotation.x = -Math.PI / 2;

      model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
      });

      // The FBX carries root-motion on the hips; pin it so the lamb idles in
      // place like the AR project does. Head/neck tracks are dropped so the
      // lamb keeps looking toward the camera instead of turning away.
      const clip = motion.animations[0];
      if (clip) {
        clip.tracks = clip.tracks.filter((track) => {
          const name = track.name.toLowerCase();
          return !name.includes("head") && !name.includes("neck");
        });
        for (const track of clip.tracks) {
          if (track.name.toLowerCase().includes("hips.position")) {
            track.values.fill(0);
          }
        }
        mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(clip).play();
        // Pose at the first frame before measuring: the skinned mesh's bind
        // pose is much smaller than the animated pose.
        mixer.update(0);
      }

      // Fit the posed lamb inside the shield and stand it on the floor.
      // Precise bounds run the vertices through the skeleton.
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model, true);
      const height = Math.max(0.001, bounds.max.y - bounds.min.y);
      model.scale.setScalar(LAMB_HEIGHT / height);
      model.updateMatrixWorld(true);

      const fitted = new THREE.Box3().setFromObject(model, true);
      model.position.set(
        -(fitted.min.x + fitted.max.x) / 2,
        -fitted.min.y,
        -(fitted.min.z + fitted.max.z) / 2,
      );

      lamb = model;
      lambRoot.add(model);
      model.updateMatrixWorld(true);

      // Find the head and work out which local axis points out of the face.
      model.traverse((child) => {
        if (
          !headBone &&
          (child as THREE.Bone).isBone &&
          child.name.toLowerCase().endsWith("head")
        ) {
          headBone = child as THREE.Bone;
        }
      });
      if (headBone) {
        const head = headBone as THREE.Bone;
        headRestQuat.copy(head.quaternion);
        head.updateWorldMatrix(true, false);
        head.getWorldQuaternion(headBaseWorld);
        const facing = new THREE.Vector3(
          camera.position.x - lambRoot.position.x,
          0,
          camera.position.z - lambRoot.position.z,
        ).normalize();
        let best = -Infinity;
        for (const axis of headAxisCandidates) {
          const direction = axis.clone().applyQuaternion(headBaseWorld).setY(0);
          if (direction.lengthSq() < 1e-6) continue;
          const alignment = direction.normalize().dot(facing);
          if (alignment > best) {
            best = alignment;
            headForwardAxis.copy(axis);
          }
        }
      }

      draco.dispose();
    })
    .catch((error) => {
      console.warn("Flow Shield: lamb failed to load.", error);
      draco.dispose();
    });

  //* Camera: fixed demo angle, dollying in with the section scroll ======
  const baseRadius = Math.hypot(
    camera.position.x - SHIELD_CENTER.x,
    camera.position.z - SHIELD_CENTER.z,
  );
  const startAngle = Math.atan2(
    camera.position.x - SHIELD_CENTER.x,
    camera.position.z - SHIELD_CENTER.z,
  );
  const eyeHeight = camera.position.y;

  camera.near = 0.1;
  camera.far = 200;

  const updateCamera = (radius: number) => {
    camera.position.set(
      SHIELD_CENTER.x + Math.sin(startAngle) * radius,
      eyeHeight,
      SHIELD_CENTER.z + Math.cos(startAngle) * radius,
    );
    camera.lookAt(SHIELD_CENTER);
    camera.updateMatrixWorld();
  };

  /**
   * Turns the head from its rest pose toward a world-space direction. The
   * spine still idles below it, so the rest pose is rebuilt each frame from
   * the parent's current world rotation.
   */
  const aimHead = (desiredDir: THREE.Vector3) => {
    if (!headBone || !headBone.parent) return;

    headBone.updateWorldMatrix(true, false);
    headBone.parent.getWorldQuaternion(headParentWorld);
    headBaseWorld.copy(headParentWorld).multiply(headRestQuat);
    headForwardWorld.copy(headForwardAxis).applyQuaternion(headBaseWorld);

    const angle = headForwardWorld.angleTo(desiredDir);
    if (angle < 1e-4) {
      headBone.quaternion.copy(headRestQuat);
      return;
    }

    // Clamp the turn so the neck never breaks, then convert the world-space
    // correction back into the head bone's local rotation.
    headDeltaQuat.setFromUnitVectors(headForwardWorld, desiredDir);
    headPartialQuat
      .copy(headIdentityQuat)
      .slerp(headDeltaQuat, Math.min(1, HEAD_MAX_TURN / angle));
    headDesiredWorld.copy(headPartialQuat).multiply(headBaseWorld);
    headBone.quaternion
      .copy(headParentWorld.invert())
      .multiply(headDesiredWorld);
  };

  /**
   * Idle / touch path: the head traces a slow circle around its rest forward
   * direction, like a standing character looking around the room.
   */
  const updateHeadOrbit = (elapsed: number) => {
    if (!headBone || !headBone.parent) return;

    headBone.updateWorldMatrix(true, false);
    headBone.parent.getWorldQuaternion(headParentWorld);
    headBaseWorld.copy(headParentWorld).multiply(headRestQuat);
    headForwardWorld.copy(headForwardAxis).applyQuaternion(headBaseWorld);

    const phase = elapsed * HEAD_ORBIT_SPEED;
    headDesiredDir
      .copy(headForwardWorld)
      .applyAxisAngle(WORLD_UP, Math.cos(phase) * HEAD_ORBIT_YAW);
    // Pitch around the horizontal axis perpendicular to the yawed forward.
    headRightWorld.crossVectors(headDesiredDir, WORLD_UP).normalize();
    headDesiredDir.applyAxisAngle(
      headRightWorld,
      Math.sin(phase) * HEAD_ORBIT_PITCH,
    );
    aimHead(headDesiredDir);
  };

  const updateHeadLook = (elapsed: number, delta: number) => {
    if (!headBone || !headBone.parent) return;

    // Touch devices always look around; desktop does so until the first
    // pointer movement engages cursor tracking.
    if (supportsTouch || !pointerEngaged) {
      updateHeadOrbit(elapsed);
      return;
    }
    if (!supportsPointer) return;

    // The shared pointer signal is the site's smoothed (drift) cursor.
    const pointer = samplePointer(elapsed, delta);
    headPointerNdc.set(pointer.x, pointer.y);
    headRaycaster.setFromCamera(headPointerNdc, camera);

    headBone.updateWorldMatrix(true, false);
    headBone.getWorldPosition(headWorldPos);

    // Point on the cursor ray at the head's depth: the look target.
    headDesiredDir.copy(headWorldPos).sub(headRaycaster.ray.origin);
    const along = Math.max(
      0,
      headDesiredDir.dot(headRaycaster.ray.direction),
    );
    headTargetPoint
      .copy(headRaycaster.ray.origin)
      .addScaledVector(headRaycaster.ray.direction, along);
    headDesiredDir.copy(headTargetPoint).sub(headWorldPos);
    if (headDesiredDir.lengthSq() < 1e-6) return;
    headDesiredDir.normalize();

    aimHead(headDesiredDir);
  };

  //* Runtime ======================================================
  let time = 0;

  updateCamera(baseRadius);

  return {
    id: flowShieldMeta.id,
    index: flowShieldMeta.index,
    scene,
    camera,
    pass: pass(scene, camera),
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    animate({ elapsed, delta, phase }) {
      const dt = Math.min(delta, 0.05);
      time += dt;
      shield.uniforms.uTime.value = time;
      mixer?.update(dt);

      // Scroll-linked dolly: the camera pushes in across the whole section
      // (the demo's auto-rotation is switched off).
      const zoom = phase.sceneProgress;
      const eased = zoom * zoom * (3 - 2 * zoom);
      updateCamera(
        THREE.MathUtils.lerp(baseRadius, baseRadius * ZOOM_END, eased),
      );
      updateHeadLook(elapsed, dt);
    },
    dispose() {
      disposed = true;
      if (typeof window !== "undefined") {
        window.removeEventListener("pointermove", engagePointer);
      }
      draco.dispose();
      scene.remove(shieldGroup, lambRoot, floor.group, ambient, key);
      sphereGeometry.dispose();
      haloGeometry.dispose();
      haloMaterial.dispose();
      shield.dispose();
      floor.dispose();
      if (lamb) disposeObject(lamb);
      environment.dispose();
      room.dispose();
      pmrem.dispose();
    },
  };
}

/** A dark stage so the chapter never goes black if the scene fails to build. */
export function createFlowShieldFallbackWorld(
  camera: PerspectiveCamera,
): SectionWorld {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0e0d0c");
  return {
    id: flowShieldMeta.id,
    index: flowShieldMeta.index,
    scene,
    camera,
    pass: pass(scene, camera),
    resize() {},
    animate() {},
    dispose() {},
  };
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

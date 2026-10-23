// Chapter 02: a mirror sphere lit entirely by the live rainbow environment.
// The procedural env map is rebuilt from TSL every frame, so the reflections
// drift across the metal as the visitor scrolls through.
import * as THREE from "three/webgpu";
import type { PerspectiveCamera, WebGPURenderer } from "three/webgpu";
import { pass, texture, uv } from "three/tsl";
import type { SectionWorld } from "../types";
import { createLiveRainbowEnvMap } from "../shared/live-rainbow-env-map";
import { rainbowSphereMeta } from "./meta";
import { textureCubeUV } from "three/src/nodes/pmrem/PMREMUtils.js";

const SPHERE_RADIUS = 1.1;
const CAMERA_HEIGHT = 0.3;
const CAMERA_DISTANCE = 4.6;
/** How close the scroll-linked push-in takes the camera. */
const ZOOM_END = 0.8;
/** The mirror arrives crisp and scatters into satin across the animate phase. */
const ROUGHNESS_START = 0;
const ROUGHNESS_END = 0.4;

export function createRainbowSphereWorld(
  camera: PerspectiveCamera,
  renderer: WebGPURenderer,
): SectionWorld {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(rainbowSphereMeta.surface);

  // The only light source: a metallic mirror has nothing to reflect without it.
  const environment = createLiveRainbowEnvMap(renderer, { resolution: 32 });
  scene.environment = environment.envMap;
  scene.environmentIntensity = 1;

  const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, 160, 96);
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 0.15,
    iridescence: 1,
  });
  const sphere = new THREE.Mesh(geometry, material);
  scene.add(sphere);

  camera.near = 0.1;
  camera.far = 100;
  camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);
  camera.lookAt(0, 0, 0);

  return {
    id: rainbowSphereMeta.id,
    index: rainbowSphereMeta.index,
    scene,
    camera,
    pass: pass(scene, camera),
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    animate({ elapsed, phase }) {
      // Spin the mirror so a new part of the env map catches the light.
      sphere.rotation.y = elapsed * 0.18;
      sphere.rotation.x = Math.sin(elapsed * 0.15) * 0.12;

      // Scatter the reflection as the animate phase scrolls: a crisp mirror on
      // arrival, a soft satin sphere once the chapter is ready to hand off.
      // Enter stays crisp and exit holds the final value, so neither boundary
      // pops when the visitor scrolls back through it.
      const scatter =
        phase.phase === "animate"
          ? phase.progress
          : phase.phase === "exit"
            ? 1
            : 0;
      material.roughness = THREE.MathUtils.lerp(
        ROUGHNESS_START,
        ROUGHNESS_END,
        scatter,
      );

      // A slow push-in across the chapter.
      const zoom = THREE.MathUtils.lerp(1, ZOOM_END, phase.sceneProgress);
      camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE * zoom);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      environment.compute(elapsed);
    },
    dispose() {
      environment.dispose();
      geometry.dispose();
      material.dispose();
      scene.clear();
    },
  };
}

/** A dark stage so the chapter never goes black if WebGPU is unavailable. */
export function createRainbowSphereFallbackWorld(
  camera: PerspectiveCamera,
): SectionWorld {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(rainbowSphereMeta.surface);

  const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, 64, 48);
  const material = new THREE.MeshStandardNodeMaterial({
    color: "#6d5470",
    metalness: 1,
    roughness: 0.2,
  });
  scene.add(new THREE.Mesh(geometry, material));

  return {
    id: rainbowSphereMeta.id,
    index: rainbowSphereMeta.index,
    scene,
    camera,
    pass: pass(scene, camera),
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    animate() {},
    dispose() {
      geometry.dispose();
      material.dispose();
      scene.clear();
    },
  };
}

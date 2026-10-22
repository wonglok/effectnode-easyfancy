"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import type { PerspectiveCamera } from "three/webgpu";
import { pass } from "three/tsl";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { reportAssetProgress } from "@/store/useScrollerStore";
import type { SectionPhaseState } from "@/lib/scroll-phases";
import type {
  CameraConfig,
  Section3DProps,
  SectionMeta,
  SectionWorld,
} from "../types";
import {
  getSceneTime,
  getSectionActivity,
  getSectionPhase,
} from "../shared/section-activity";
import {
  addLights,
  disposeScene,
  makeCamera,
  makeParticles,
  makeSky,
} from "../shared/scene-utils";
import { createStarSky } from "../shared/star-sky";
import { createScrollCue } from "../shared/scroll-cue";
import { createAetherMoon } from "./moon";
import { createWaterMesh, WaterMesh3D } from "./WaterMesh3D";

// ---------------------------------------------------------------------------
// Chapter config
// ---------------------------------------------------------------------------

export const aetherMeta: SectionMeta = {
  id: "aether",
  index: 0,
  chapter: "01",
  name: "Aether",
  title: "Scroll into\nreal time.",
  accent: "#7ea113",
  surface: "#07100a",
};

export const aetherCamera: CameraConfig = {
  base: [0, 1.6, 5.6],
  fov: 60,
  drift: 0.15,
  orbit: 0.1,
  lookAt: [0, 1.15, 0],
  // Fly in from 15 to the origin, then continue through to -15 on the way out,
  // always aimed at the z = 0 plane.
  travelZ: { from: 8, to: -8 },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The 3D component for chapter 01. It owns this section's Three.js scene,
 * render pass target and animation loop.
 */
export function Aether3D({ onReady, onDispose }: Section3DProps) {
  const camera = useAetherCamera();
  const worldRef = useAetherWorld(camera, onReady, onDispose);

  useFrame((state, delta) => {
    const world = worldRef.current;
    if (!world) return;

    const influence = getSectionActivity(world.index);
    if (influence <= 0) return;

    world.animate({
      elapsed: getSceneTime(state.clock.elapsedTime),
      delta,
      phase: getSectionPhase(world.index),
    });
  });

  return (
    <>
      <WaterMesh3D></WaterMesh3D>
    </>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** One camera for the lifetime of the scene, framed on the chapter's lookAt. */
function useAetherCamera() {
  return useMemo(() => {
    const camera = makeCamera(aetherCamera.base, aetherCamera.fov);
    camera.lookAt(...(aetherCamera.lookAt ?? [0, 0, 0]));
    return camera;
  }, []);
}

/**
 * Builds the world once the component mounts, keeps it sized to the canvas and
 * disposes it on unmount. The ref is shared with the frame loop.
 */
function useAetherWorld(
  camera: PerspectiveCamera,
  onReady: Section3DProps["onReady"],
  onDispose: Section3DProps["onDispose"],
) {
  const size = useThree((state) => state.size);
  const worldRef = useRef<SectionWorld | null>(null);
  // The async world may finish loading after the size effect has run, so keep
  // the latest canvas size in a ref and apply it when the world mounts.
  const sizeRef = useRef(size);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  useEffect(() => {
    let cancelled = false;
    let world: SectionWorld | null = null;

    const mount = (next: SectionWorld) => {
      if (cancelled) {
        next.dispose();
        return;
      }
      const { width, height } = sizeRef.current;
      if (height > 0) next.resize(width / height);
      world = next;
      worldRef.current = next;
      onReady(next);
    };

    const load = async () => {
      try {
        mount(await createAetherWorld(camera, reportAssetProgress));
      } catch (error) {
        console.warn(
          "Aether environment failed to load; using the fallback scene.",
          error,
        );
        // The fallback has no network assets, so the preload is complete.
        reportAssetProgress(1);
        if (!cancelled) mount(createAetherFallbackWorld(camera));
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (!world) return;
      if (worldRef.current === world) worldRef.current = null;
      onDispose(world);
      world.dispose();
    };
  }, [camera, onReady, onDispose]);

  useEffect(() => {
    if (size.height === 0) return;
    worldRef.current?.resize(size.width / size.height);
  }, [size.width, size.height]);

  return worldRef;
}

// ---------------------------------------------------------------------------
// Camera rig
// ---------------------------------------------------------------------------

const lookAtValue = new THREE.Vector3(0, 0, 0);
const lookAtGoal = new THREE.Vector3(0, 0, 0);
const moveGoal = new THREE.Vector3(0, 0, 0);
const moveValue = new THREE.Vector3(0, 0, 0);

const moveCurve = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(
      aetherCamera.base[0] * 7,
      aetherCamera.base[1] + 0,
      aetherCamera.base[2] * 7,
    ),
    new THREE.Vector3(
      aetherCamera.base[0] * 7,
      aetherCamera.base[1] + 0,
      aetherCamera.base[2] * 7,
    ),
    new THREE.Vector3(
      aetherCamera.base[0],
      aetherCamera.base[1],
      aetherCamera.base[2],
    ),
    new THREE.Vector3(
      aetherCamera.base[0],
      aetherCamera.base[1] - 3,
      aetherCamera.base[2],
    ),
  ],
  false,
  "catmullrom",
  0.0,
);

const lookCurve = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(
      //
      0.0,
      aetherCamera.base[1],
      0.0,
    ),
    new THREE.Vector3(
      //
      0.0,
      aetherCamera.base[1],
      0.0,
    ),
    new THREE.Vector3(
      //
      0.0,
      aetherCamera.base[1],
      0.0,
    ),
    new THREE.Vector3(
      //
      aetherCamera.base[0],
      aetherCamera.base[1] - 3,
      aetherCamera.base[2] - 3,
    ),
  ],
  false,
  "catmullrom",
  0.0,
);

/**
 * Chapter 01 camera: a single spline through the scene's whole life.
 * - enter   starts far out at the opening framing
 * - animate settles on the look target
 * - exit    drops straight down from the target
 * The move and look targets are eased toward their curve points so the hand-
 * offs between phases stay smooth.
 */
function updateCamera(camera: PerspectiveCamera, phase: SectionPhaseState) {
  moveCurve.getPoint(phase.sceneProgress, moveGoal);
  lookCurve.getPoint(phase.sceneProgress, lookAtGoal);

  moveValue.lerp(moveGoal, 0.25);
  camera.position.lerp(moveValue, 0.25);

  lookAtValue.lerp(lookAtGoal, 0.25);
  camera.lookAt(lookAtValue.x, lookAtValue.y, lookAtValue.z);
}

/**
 * The scroll cue is full strength on arrival and fades out across the first
 * fraction of the chapter's hold, once the visitor has taken the hint.
 */
function scrollCueAmount(phase: SectionPhaseState) {
  if (phase.phase !== "animate") return 0;
  return 1 - THREE.MathUtils.smoothstep(phase.progress, 0, 0.16);
}

// ---------------------------------------------------------------------------
// Scene building
// ---------------------------------------------------------------------------

const meta = aetherMeta;

const ISLAND_URL = "/env/ocean-island.glb";
const LIGHTING_URL = "/hdr/ocean.hdr";
/** Local copy of three's Draco decoder, served from public/draco. */
const DRACO_DECODER_PATH = "/draco/";

type ProgressLoader<T> = {
  load: (
    url: string,
    onLoad: (result: T) => void,
    onProgress: (event: ProgressEvent) => void,
    onError: (error: unknown) => void,
  ) => void;
};

/** Promise wrapper around a loader that reports byte progress. */
function loadWithProgress<T>(
  loader: ProgressLoader<T>,
  url: string,
  onProgress: (fraction: number) => void,
) {
  return new Promise<T>((resolve, reject) => {
    loader.load(
      url,
      resolve,
      (event) => {
        if (!event.lengthComputable || event.total === 0) return;
        onProgress(event.loaded / event.total);
      },
      reject,
    );
  });
}

/**
 * The island GLB uses Draco compression, so the loader needs a decoder. The
 * decoded tree and the ocean HDR resolve together, and the decoder is disposed
 * once the asset is parsed.
 */
async function loadIslandAssets(onProgress?: (fraction: number) => void) {
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_DECODER_PATH);

  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  let glbFraction = 0;
  let hdrFraction = 0;
  // The GLB carries most of the payload; the HDR only shares the tail.
  const report = () => onProgress?.(glbFraction * 0.9 + hdrFraction * 0.1);

  try {
    const assets = await Promise.all([
      loadWithProgress(loader, ISLAND_URL, (fraction) => {
        glbFraction = fraction;
        report();
      }),
      loadWithProgress(new HDRLoader(), LIGHTING_URL, (fraction) => {
        hdrFraction = fraction;
        report();
      }),
    ]);
    // Some responses omit Content-Length, so mark the download complete here.
    onProgress?.(1);
    return assets;
  } finally {
    draco.dispose();
  }
}

type IslandMaterial = THREE.Material & {
  envMapIntensity?: number;
  emissiveIntensity?: number;
};

/**
 * Keeps the island's baked material look but lets the ocean HDR drive the PBR
 * response, the same treatment chapter 03 gives the same asset.
 */
function prepareIsland(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    for (const material of materials as IslandMaterial[]) {
      if (!material) continue;
      if (typeof material.emissiveIntensity === "number") {
        material.emissiveIntensity = 0.4;
      }
      if (typeof material.envMapIntensity === "number") {
        material.envMapIntensity = 1.1;
      }
      material.needsUpdate = true;
    }
  });
}

/** Frees a loaded model, textures included. */
function disposeObjectTree(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];

    for (const material of materials) {
      if (!material) continue;

      for (const value of Object.values(material as unknown as object)) {
        if (
          value &&
          typeof value === "object" &&
          (value as { isTexture?: boolean }).isTexture
        ) {
          textures.add(value as THREE.Texture);
        }
      }
      material.dispose();
    }
  });

  textures.forEach((texture) => texture.dispose());
}

/**
 * Builds the chapter's scene: the ocean island sits at its native scale while
 * the water plane at y = -9.5 cuts across its base. The ocean HDR lights and
 * reflects the scene.
 */
async function createAetherWorld(
  camera: PerspectiveCamera,
  onAssetProgress?: (fraction: number) => void,
): Promise<SectionWorld> {
  const [gltf, environment] = await loadIslandAssets(onAssetProgress);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(meta.surface, 0.014);

  environment.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = environment;
  scene.environmentIntensity = 0.9;
  // The backdrop is a drifting star dome. Additive and fog-free, so the black
  // part of the dome leaves the scene alone and the stars read against the
  // renderer's clear colour.
  const starSky = createStarSky({ radius: 200, speed: 0.8 });
  scene.add(starSky.object);

  const moon = createAetherMoon();
  scene.add(moon.object);

  // The island ships at its own world scale, the same asset chapter 03 uses.
  const island = gltf.scene;
  prepareIsland(island);
  // Keep the exported orientation: chapter 01 never turns this GLB.
  island.rotation.set(0, 0, 0);
  scene.add(island);

  // The HDR supplies the image-based lighting; these give the stone, glass and
  // trees a readable direction plus the chapter accent.
  const hemisphere = new THREE.HemisphereLight(0xdce8ff, 0x1a120b, 0.35);
  const key = new THREE.DirectionalLight(0xeaf4ff, 1.2);
  key.position.set(40, 60, 30);
  const accent = new THREE.PointLight(meta.accent, 160, 140, 2);
  accent.position.set(-24, 18, 18);
  scene.add(hemisphere, key, accent);

  // Sunk to y = -9.5 so the ocean cuts across the island's base while the
  // plaza stays dry; it reflects the island and refracts the star dome.
  const water = createWaterMesh({
    width: 160,
    depth: 160,
    position: [0, -9.5, 0],
    color: "#ffffff",
    scale: 24,
    reflectivity: 0.16,
  });
  scene.add(water);

  const scrollCue = createScrollCue(meta.accent);
  scene.add(scrollCue.object);

  return {
    id: meta.id,
    index: meta.index,
    scene,
    camera,
    pass: pass(scene, camera),
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    animate({ elapsed, phase }) {
      updateCamera(camera, phase);

      // The dome reads only directions, so keeping it centred on the camera is
      // enough to make it a sky — and it never has to clear the far plane.
      starSky.object.position.copy(camera.position);
      moon.update(camera, camera.aspect);
      scrollCue.update(camera, elapsed, scrollCueAmount(phase));
    },
    dispose() {
      disposeObjectTree(island);
      starSky.dispose();
      moon.dispose();
      scrollCue.dispose();
      water.geometry.dispose();
      water.material.dispose();
      scene.environment = null;
      scene.background = null;
      environment.dispose();
      scene.clear();
    },
  };
}

/**
 * Last-resort scene used only if the environment assets fail to load, so the
 * chapter stays renderable.
 */
function createAetherFallbackWorld(camera: PerspectiveCamera): SectionWorld {
  const scene = new THREE.Scene();

  makeSky(scene, "#102117", "#020504", meta.accent, 0.08);
  addLights(scene, meta.accent, 24, 14);

  const moon = createAetherMoon();
  scene.add(moon.object);

  const particles = makeParticles(
    meta.accent,
    "#f4ffd7",
    180,
    2.2,
    7.6,
    0.02,
    811,
  );
  scene.add(particles);

  const scrollCue = createScrollCue(meta.accent);
  scene.add(scrollCue.object);

  return {
    id: meta.id,
    index: meta.index,
    scene,
    camera,
    pass: pass(scene, camera),
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    animate({ elapsed, phase }) {
      updateCamera(camera, phase);

      moon.update(camera, camera.aspect);
      particles.rotation.y = elapsed * 0.03;
      particles.rotation.x = Math.sin(elapsed * 0.1) * 0.08;
      scrollCue.update(camera, elapsed, scrollCueAmount(phase));
    },
    dispose() {
      moon.dispose();
      scrollCue.dispose();
      disposeScene(scene);
    },
  };
}

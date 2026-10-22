import * as THREE from "three/webgpu";
import type { PerspectiveCamera } from "three/webgpu";
import { pass } from "three/tsl";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import type { CameraConfig, SectionMeta, SectionWorld } from "../types";
import {
  addLights,
  disposeScene,
  easeInOut,
  makeSky,
  pointerDrift,
  setCameraPose,
} from "../shared/scene-utils";
import { samplePointer } from "../shared/section-activity";
import { createWaterMesh } from "../01-aether/WaterMesh3D";
import type { SectionPhaseState } from "@/lib/scroll-phases";

export const matterMeta: SectionMeta = {
  id: "matter",
  index: 2,
  chapter: "03",
  name: "Matter",
  title: "Worlds,\nnot pages.",
  accent: "#ff8a5b",
  surface: "#120906",
};

export const matterCamera: CameraConfig = {
  base: [0, 26, 26],
  fov: 44,
  drift: 0.22,
  orbit: 0.12,
  lookAt: [0, 8, -16],
};

const meta = matterMeta;

const LOOK_AT = matterCamera.lookAt ?? [0, 0, 0];
/** Where the enter blend starts: far enough out to read the whole island. */
const ENTER_FROM: [number, number, number] = [0, 150, 380];
/** The still-far pose enter settles on; the animate fly-in starts here. */
const FAR: [number, number, number] = [0, 95, 260];
/** Above the island's centre, the end of the animate fly-in. */
const CENTER: [number, number, number] = [0, 26, 26];
/** Bird's-eye finish, straight above the island. */
const TOP: [number, number, number] = [0, 26, 26];

/**
 * Chapter 03 camera: hold far out while the chapter enters, fly in to the
 * island's centre through the animate phase, then climb to a top-down finish.
 */
function updateCamera(
  camera: PerspectiveCamera,
  phase: SectionPhaseState,
  elapsed: number,
  delta: number,
) {
  const pointer = samplePointer(elapsed, Math.min(delta, 0.05));
  const drift = pointerDrift(
    pointer,
    elapsed,
    matterCamera.drift,
    matterCamera.orbit,
  );

  const t = easeInOut(phase.progress);
  let x: number;
  let y: number;
  let z: number;

  if (phase.phase === "enter") {
    x = ENTER_FROM[0] + (FAR[0] - ENTER_FROM[0]) * t;
    y = ENTER_FROM[1] + (FAR[1] - ENTER_FROM[1]) * t;
    z = ENTER_FROM[2] + (FAR[2] - ENTER_FROM[2]) * t;
  } else if (phase.phase === "animate") {
    x = FAR[0] + (CENTER[0] - FAR[0]) * t;
    y = FAR[1] + (CENTER[1] - FAR[1]) * t;
    z = FAR[2] + (CENTER[2] - FAR[2]) * t;
  } else {
    x = CENTER[0] + (TOP[0] - CENTER[0]) * t;
    y = CENTER[1] + (TOP[1] - CENTER[1]) * t;
    z = CENTER[2] + (TOP[2] - CENTER[2]) * t;
  }

  setCameraPose(camera, [x + drift.x, y + drift.y, z], LOOK_AT);
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

const ISLAND_URL = "/env/ocean-island.glb";
const LIGHTING_URL = "/hdr/sky-col.hdr";
/** Local copy of three's Draco decoder, served from public/draco. */
const DRACO_DECODER_PATH = "/draco/";

/** The GLB is Draco-compressed, so the loader needs the decoder. */
async function loadIslandAssets() {
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_DECODER_PATH);

  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  try {
    return await Promise.all([
      loader.loadAsync(ISLAND_URL),
      new HDRLoader().loadAsync(LIGHTING_URL),
    ]);
  } finally {
    draco.dispose();
  }
}

type IslandMaterial = THREE.Material & {
  envMapIntensity?: number;
  emissiveIntensity?: number;
};

/**
 * Keeps the baked look of the exported materials but lets the ocean HDR drive
 * their PBR response, the same treatment chapter 01 gives its environment.
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

/** Frees a loaded model, textures included — `disposeScene` skips textures. */
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

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export async function createMatterWorld(
  camera: PerspectiveCamera,
): Promise<SectionWorld> {
  const [gltf, environment] = await loadIslandAssets();

  const scene = new THREE.Scene();
  // No fog: it turned the ocean's far edge into a pale band that did not match
  // the sky. The plane is large enough that its edge reads as the horizon.

  environment.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = environment;
  scene.environmentIntensity = 0.95;
  // The ocean sky doubles as the backdrop behind the island.
  scene.background = environment;
  scene.backgroundIntensity = 0.85;

  const island = gltf.scene;
  prepareIsland(island);
  scene.add(island);

  // The HDR supplies the image-based lighting; these only give the stone and
  // glass a readable direction and a warm accent on the sunset side.
  const hemisphere = new THREE.HemisphereLight(0xffe6cf, 0x1a120b, 0.4);
  const key = new THREE.DirectionalLight(0xfff0d8, 1.4);
  key.position.set(40, 60, 30);
  const accent = new THREE.PointLight(meta.accent, 260, 160, 2);
  accent.position.set(-24, 18, 18);
  scene.add(hemisphere, key, accent);

  // The same water surface chapter 01 uses, sunk to y = -9.5 so it cuts across
  // the island's base while the plaza stays dry. It is wide enough that its far
  // edge reads as the horizon line rather than a visible plane boundary.
  const water = createWaterMesh({
    width: 3000,
    depth: 3000,
    position: [0, -9.5, 0],
    color: "#8fbbe0",
    // The normal map tiles only 35 times across the 4000-unit disc (~114 m per
    // tile), giving long swells instead of dense chop.
    scale: 35,
    reflectivity: 0.06,
  });
  scene.add(water);

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
    animate({ elapsed, delta, phase }) {
      updateCamera(camera, phase, elapsed, delta);
    },
    dispose() {
      scene.environment = null;
      scene.background = null;
      environment.dispose();
      disposeObjectTree(island);
      water.geometry.dispose();
      water.material.dispose();
      scene.clear();
    },
  };
}

/**
 * Registered if the GLB or HDR fails, so the render pipeline still has a
 * world for every chapter and the scene stays scrollable instead of going black.
 */
function createMatterFallbackWorld(camera: PerspectiveCamera): SectionWorld {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(meta.surface, 0.014);

  const sky = makeSky(scene, "#102117", "#020504", meta.accent, 0.08);
  addLights(scene, meta.accent, 24, 14);

  const water = createWaterMesh({
    width: 260,
    depth: 260,
    position: [0, 0, -16],
    color: "#8fe0d8",
  });
  scene.add(water);

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
    animate({ elapsed, delta, phase }) {
      updateCamera(camera, phase, elapsed, delta);
    },
    dispose() {
      sky.geometry.dispose();
      (sky.material as THREE.Material).dispose();
      disposeScene(scene);
    },
  };
}

/** The loader in `Matter3D` awaits the real world and falls back on failure. */
export { createMatterFallbackWorld };

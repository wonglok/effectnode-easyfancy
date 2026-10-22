import * as THREE from "three/webgpu";
import type { PerspectiveCamera } from "three/webgpu";
import { pass } from "three/tsl";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { Font, type FontData } from "three/addons/loaders/FontLoader.js";
import type { CameraConfig, SectionMeta, SectionWorld } from "../types";
import {
  TAU,
  disposeScene,
  easeInOut,
  makeParticles,
  mulberry32,
  setCameraPose,
} from "../shared/scene-utils";
import { samplePointer } from "../shared/section-activity";
import { Helvetica } from "../shared/helvetica";
import type { SectionPhaseState } from "@/lib/scroll-phases";

export const vrGalleryMeta: SectionMeta = {
  id: "vr-gallery",
  index: 3,
  chapter: "04",
  name: "VR Gallery",
  title: "Step\ninside.",
  accent: "#ffb46b",
  surface: "#151009",
};

/** The camera starts where the gallery world aims it after framing the model. */
export const vrGalleryCamera: CameraConfig = {
  base: [0, 2.1, 18],
  fov: 50,
  drift: 0.15,
  orbit: 0.04,
  lookAt: [0, 2, 0],
};

const meta = vrGalleryMeta;
const LIGHTING_URL = "/hdr/office.hdr";

// ---------------------------------------------------------------------------
// Room dimensions
// ---------------------------------------------------------------------------

const ROOM_WIDTH = 20;
const ROOM_DEPTH = 36;
const ROOM_HEIGHT = 7.4;
/** The camera path reads its entrance/hold distances from this footprint. */
const ROOM_SIZE = new THREE.Vector3(ROOM_WIDTH, ROOM_HEIGHT, ROOM_DEPTH);

const font = new Font(Helvetica as unknown as FontData);

/** Tilt of the sculpture's two orbit rings, shared with the animation. */
const RING_TILTS = [1.15, -0.95];

/** Warm/cool print palettes; each canvas is generated, never loaded. */
const ART_PALETTES: Array<[string, string, string]> = [
  ["#ffb46b", "#8a4a2a", "#241209"],
  ["#f6dfc0", "#b07a4c", "#2a1509"],
  ["#7ad7ff", "#1d5f7a", "#06131a"],
  ["#ff9e6b", "#5a2b48", "#160a12"],
  ["#d8e8ff", "#6d7f9a", "#101722"],
  ["#ffd27a", "#7a5a1e", "#1a1206"],
];

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

/**
 * Interior walkthrough. The chapter opens at the entrance looking down the
 * hall, then dollies toward the sculpture as the reader scrolls. The lateral
 * drift steps around the plinth on the centre line.
 */
function updateGalleryCamera(
  camera: PerspectiveCamera,
  size: THREE.Vector3,
  phase: SectionPhaseState,
  elapsed: number,
  delta: number,
) {
  const pointer = samplePointer(elapsed, Math.min(delta, 0.05));
  const t = easeInOut(phase.progress);

  const entranceZ = size.z * 0.48;
  const holdZ = 14;
  // Portrait screens have a narrow horizontal field, so stop short of the
  // sculpture; landscape can push right up to it.
  const portrait = camera.aspect < 1;
  const heroZ = portrait ? 9 : 7.5;
  const heroX = portrait ? 2.8 : 3.2;

  let z: number;
  let x: number;

  if (phase.phase === "enter") {
    // Just inside the doors, easing off the threshold.
    z = entranceZ + (holdZ - entranceZ) * t;
    x = heroX * 0.3 * t;
  } else if (phase.phase === "animate") {
    // The fly-in: close the distance to the sculpture.
    z = holdZ + (heroZ - holdZ) * t;
    x = heroX * 0.3 + (heroX - heroX * 0.3) * t;
  } else {
    // Hold the close-up while the next chapter blends in over it.
    z = heroZ;
    x = heroX;
  }

  const eyeY = 2.05 + pointer.y * 0.25 + Math.sin(elapsed * 0.5) * 0.02;
  const sway = Math.sin(elapsed * 0.22) * 0.12;

  setCameraPose(
    camera,
    [x + pointer.x * 0.35 + sway, eyeY, z],
    [0, 3, 0],
  );
}

// ---------------------------------------------------------------------------
// Procedural gallery
// ---------------------------------------------------------------------------

/**
 * Paints one abstract print on a 2D canvas. Every frame in the gallery is
 * generated this way, so the chapter ships no image files.
 */
function createArtTexture(index: number): THREE.CanvasTexture {
  const palette = ART_PALETTES[index % ART_PALETTES.length];
  const canvas = document.createElement("canvas");
  canvas.width = 360;
  canvas.height = 270;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  const random = mulberry32(9001 + index * 101);

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, palette[0]);
  gradient.addColorStop(0.55, palette[1]);
  gradient.addColorStop(1, palette[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 11; i += 1) {
    ctx.globalAlpha = 0.08 + random() * 0.28;
    ctx.fillStyle = i % 3 === 0 ? "#fff4e2" : palette[0];
    ctx.beginPath();
    ctx.arc(
      random() * canvas.width,
      random() * canvas.height,
      18 + random() * 104,
      0,
      TAU,
    );
    ctx.fill();
  }

  ctx.globalAlpha = 0.32;
  ctx.strokeStyle = "#0c0806";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 6; i += 1) {
    const y = random() * canvas.height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y + (random() - 0.5) * 64);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

type Gallery = {
  root: THREE.Group;
  textures: THREE.Texture[];
  sculpture: THREE.Group;
  orb: THREE.Mesh;
  rings: THREE.Mesh[];
  dust: THREE.InstancedMesh;
};

/** One framed print: a bronze slab with the canvas floated just in front. */
function createArtwork(
  texture: THREE.Texture,
  width: number,
  height: number,
  frameMaterial: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.28, height + 0.28, 0.1),
    frameMaterial,
  );
  const print = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicNodeMaterial({ map: texture }),
  );
  print.position.z = 0.056;
  group.add(backing, print);
  return group;
}

/** Builds the room, the hung prints, the centre sculpture and the motes. */
function buildGalleryRoom(): Gallery {
  const root = new THREE.Group();
  const textures: THREE.Texture[] = [];

  // ---------------------------------------------------------------- shell

  const floorMaterial = new THREE.MeshStandardNodeMaterial({
    color: "#1c1510",
    roughness: 0.3,
    metalness: 0.32,
  });
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH),
    floorMaterial,
  );
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);

  const ceilingMaterial = new THREE.MeshStandardNodeMaterial({
    color: "#0b0806",
    roughness: 0.92,
    metalness: 0.04,
  });
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH),
    ceilingMaterial,
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM_HEIGHT;
  root.add(ceiling);

  const wallMaterial = new THREE.MeshStandardNodeMaterial({
    color: "#cbbca6",
    roughness: 0.86,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  const addWall = (
    width: number,
    height: number,
    position: [number, number, number],
    rotationY: number,
  ) => {
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      wallMaterial,
    );
    wall.position.set(...position);
    wall.rotation.y = rotationY;
    root.add(wall);
    return wall;
  };

  addWall(ROOM_DEPTH, ROOM_HEIGHT, [-ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0], Math.PI / 2);
  addWall(ROOM_DEPTH, ROOM_HEIGHT, [ROOM_WIDTH / 2, ROOM_HEIGHT / 2, 0], -Math.PI / 2);
  addWall(ROOM_WIDTH, ROOM_HEIGHT, [0, ROOM_HEIGHT / 2, -ROOM_DEPTH / 2], 0);

  // Front wall with a doorway, so the entrance reads as a threshold.
  const doorway = 4.4;
  const doorwayHeight = 4.4;
  const frontZ = ROOM_DEPTH / 2;
  addWall(
    (ROOM_WIDTH - doorway) / 2,
    ROOM_HEIGHT,
    [-(doorway + (ROOM_WIDTH - doorway) / 2) / 2, ROOM_HEIGHT / 2, frontZ],
    Math.PI,
  );
  addWall(
    (ROOM_WIDTH - doorway) / 2,
    ROOM_HEIGHT,
    [(doorway + (ROOM_WIDTH - doorway) / 2) / 2, ROOM_HEIGHT / 2, frontZ],
    Math.PI,
  );
  addWall(
    doorway,
    ROOM_HEIGHT - doorwayHeight,
    [0, doorwayHeight + (ROOM_HEIGHT - doorwayHeight) / 2, frontZ],
    Math.PI,
  );

  const trimMaterial = new THREE.MeshStandardNodeMaterial({
    color: "#2c2118",
    roughness: 0.42,
    metalness: 0.32,
  });
  const baseTrim = new THREE.Mesh(
    new THREE.BoxGeometry(ROOM_WIDTH, 0.16, 0.06),
    trimMaterial,
  );
  baseTrim.position.set(0, 0.08, -ROOM_DEPTH / 2 + 0.035);
  root.add(baseTrim);
  for (const side of [-1, 1]) {
    const sideTrim = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.16, ROOM_DEPTH),
      trimMaterial,
    );
    sideTrim.position.set(side * (ROOM_WIDTH / 2 - 0.035), 0.08, 0);
    root.add(sideTrim);
  }

  // ---------------------------------------------------------------- lights

  const lampMaterial = new THREE.MeshBasicNodeMaterial({ color: "#ffe4c2" });
  for (const x of [-4.6, 4.6]) {
    for (const z of [-9, 0, 9]) {
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(4.4, 0.06, 0.2),
        lampMaterial,
      );
      lamp.position.set(x, ROOM_HEIGHT - 0.09, z);
      root.add(lamp);
    }
  }

  // ------------------------------------------------------------- the prints

  const frameMaterial = new THREE.MeshStandardNodeMaterial({
    color: "#372618",
    roughness: 0.34,
    metalness: 0.62,
  });

  const spots = [-13.2, -7.4, -1.6, 4.2, 10];
  spots.forEach((z, index) => {
    for (const side of [-1, 1]) {
      const width = index % 2 === 0 ? 3.2 : 2.5;
      const height = width * 0.72;
      const texture = createArtTexture(index * 2 + (side > 0 ? 1 : 0));
      textures.push(texture);
      const art = createArtwork(texture, width, height, frameMaterial);
      art.position.set(
        side * (ROOM_WIDTH / 2 - 0.1),
        3.2,
        z + (side > 0 ? 1.1 : 0),
      );
      art.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      root.add(art);

      // Picture light: a thin emissive bar above the frame.
      const pictureLight = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.05, width + 0.3),
        lampMaterial,
      );
      pictureLight.position.set(
        side * (ROOM_WIDTH / 2 - 0.2),
        3.2 + height / 2 + 0.34,
        z + (side > 0 ? 1.1 : 0),
      );
      root.add(pictureLight);
    }
  });

  // Feature print on the back wall, with the gallery's name above it.
  const featureTexture = createArtTexture(ART_PALETTES.length - 1);
  textures.push(featureTexture);
  const feature = createArtwork(featureTexture, 8.4, 4.2, frameMaterial);
  feature.position.set(0, 3.05, -ROOM_DEPTH / 2 + 0.08);
  root.add(feature);

  const signGeometry = new TextGeometry("VR GALLERY", {
    font,
    size: 0.72,
    depth: 0.06,
    curveSegments: 6,
    bevelEnabled: true,
    bevelThickness: 0.014,
    bevelSize: 0.008,
    bevelSegments: 2,
  });
  signGeometry.computeBoundingBox();
  const signBox = signGeometry.boundingBox!;
  signGeometry.translate(
    -(signBox.min.x + signBox.max.x) / 2,
    -(signBox.min.y + signBox.max.y) / 2,
    0,
  );
  const sign = new THREE.Mesh(
    signGeometry,
    new THREE.MeshStandardNodeMaterial({
      color: "#ffd9ae",
      emissive: "#ff9c4a",
      emissiveIntensity: 0.8,
      metalness: 0.4,
      roughness: 0.42,
    }),
  );
  sign.position.set(0, 6.15, -ROOM_DEPTH / 2 + 0.12);
  root.add(sign);

  // -------------------------------------------------------------- sculpture

  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.88, 1.15, 72),
    new THREE.MeshStandardNodeMaterial({
      color: "#2c2219",
      roughness: 0.3,
      metalness: 0.34,
    }),
  );
  plinth.position.set(0, 0.575, 0);
  root.add(plinth);

  const sculpture = new THREE.Group();
  sculpture.position.set(0, 2.55, 0);
  root.add(sculpture);

  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 64, 48),
    new THREE.MeshStandardNodeMaterial({
      color: "#f5e7d6",
      metalness: 1,
      roughness: 0.04,
    }),
  );
  sculpture.add(orb);

  const ringMaterial = new THREE.MeshBasicNodeMaterial({
    color: meta.accent,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const rings = [
    { radius: 1.5, tube: 0.018 },
    { radius: 1.72, tube: 0.014 },
  ].map((spec, index) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(spec.radius, spec.tube, 12, 128),
      ringMaterial,
    );
    ring.rotation.x = RING_TILTS[index];
    sculpture.add(ring);
    return ring;
  });

  // A soft halo behind the orb, so the plinth stays the brightest object.
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.35, 32, 24),
    new THREE.MeshBasicNodeMaterial({
      color: "#ffcf9c",
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  sculpture.add(halo);

  // ------------------------------------------------------------ atmosphere

  const dust = makeParticles(
    meta.accent,
    "#fff1dc",
    140,
    1.5,
    10,
    0.018,
    707,
  );
  dust.position.y = 3.6;
  dust.scale.set(0.85, 0.32, 1.5);
  root.add(dust);

  return { root, textures, sculpture, orb, rings, dust };
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

function buildGalleryWorld(
  camera: PerspectiveCamera,
  environment: THREE.Texture | null,
): SectionWorld {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(meta.surface);

  if (environment) {
    environment.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = environment;
    scene.environmentIntensity = 0.9;
  }

  const gallery = buildGalleryRoom();
  scene.add(gallery.root);

  // The room is lit by the strip lamps and two warm pools; the HDR, when it
  // loads, fills the chrome orb and the polished floor.
  const hemisphere = new THREE.HemisphereLight(0xfff1de, 0x16100a, 0.55);
  const key = new THREE.PointLight(0xffd9b4, 240, 46, 1.8);
  key.position.set(0, 6.5, 4);
  const warm = new THREE.PointLight(meta.accent, 140, 26, 1.8);
  warm.position.set(0, 3.2, -9);
  const cool = new THREE.PointLight(0x9fd4ff, 60, 24, 2);
  cool.position.set(-6, 4, 6);
  scene.add(hemisphere, key, warm, cool);

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
      updateGalleryCamera(camera, ROOM_SIZE, phase, elapsed, delta);

      gallery.sculpture.rotation.y = elapsed * 0.12;
      gallery.orb.position.y = Math.sin(elapsed * 0.7) * 0.07;

      gallery.rings.forEach((ring, index) => {
        ring.rotation.x =
          RING_TILTS[index % RING_TILTS.length] +
          Math.sin(elapsed * 0.22 + index) * 0.18;
        ring.rotation.y = elapsed * (index % 2 === 0 ? 0.32 : -0.25);
      });

      gallery.dust.rotation.y = elapsed * 0.01;
    },
    dispose() {
      gallery.textures.forEach((texture) => texture.dispose());
      scene.environment = null;
      scene.background = null;
      environment?.dispose();
      disposeScene(scene);
      scene.clear();
    },
  };
}

export async function createVrGalleryWorld(
  camera: PerspectiveCamera,
): Promise<SectionWorld> {
  let environment: THREE.Texture | null = null;
  try {
    environment = await new HDRLoader().loadAsync(LIGHTING_URL);
  } catch (error) {
    console.warn("VR gallery HDR failed to load; using lights only.", error);
  }
  return buildGalleryWorld(camera, environment);
}

/** The same room, lit without the HDR, if the environment cannot load. */
export function createVrGalleryFallbackWorld(
  camera: PerspectiveCamera,
): SectionWorld {
  return buildGalleryWorld(camera, null);
}

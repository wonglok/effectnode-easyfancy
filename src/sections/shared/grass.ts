// ---------------------------------------------------------------------------
// Instanced grass field
// ---------------------------------------------------------------------------
// Adapted from the B3 template's `GrassComponent.tsx` (see `grass-material.ts`
// for the shader half). One blade is a 1 × `joints` PlaneGeometry, drawn
// `instances` times as an InstancedBufferGeometry. All per-blade variation —
// position, root heading, lean, height — is baked into instanced attributes by
// `buildGrassAttributes`; the wind is a noise field sampled in the shader.
//
// Blades are scattered over a flat rectangle and clumped by a world-space
// Perlin density field, so the field reads as patches with thin ground between
// them rather than an even lawn. The count is fixed and the noise only decides
// how tightly they bunch.
//
// Unlike the template this has no collider sampler and no culling: scene 4's
// ground is an instanced forest of bars, so the field is flat, and the mesh is
// drawn every frame regardless of the frustum.
// ---------------------------------------------------------------------------

import * as THREE from "three/webgpu";
import { createGrassMaterial } from "./grass-material";
import type { GrassMaterial } from "./grass-material";
import { mulberry32 } from "./scene-utils";

// ---------------------------------------------------------------------------
// Blade textures
// ---------------------------------------------------------------------------
// Loaded lazily, not at module scope: the scene modules are imported during
// SSR, where `TextureLoader` has no `document`. Shared across grass fields and
// deliberately never disposed, so remounting a scene does not take the blades
// with it.

type BladeTextures = { diffuse: THREE.Texture; alpha: THREE.Texture };

let bladeTextures: BladeTextures | null = null;

function getBladeTextures(): BladeTextures {
  if (bladeTextures) return bladeTextures;

  const loader = new THREE.TextureLoader();
  const diffuse = loader.load(
    "/texture/grass/blade_diffuse.jpg",
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
    },
  );
  // The silhouette is coverage data, not colour: sRGB decoding would shift
  // every edge in the `alphaTest` cutout.
  const alpha = loader.load("/texture/grass/blade_alpha.jpg", (texture) => {
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
  });

  bladeTextures = { diffuse, alpha };
  return bladeTextures;
}

// ---------------------------------------------------------------------------
// Clumping field
// ---------------------------------------------------------------------------

/**
 * 32-bit lattice hash, unsigned — the shared core of the Perlin field below.
 */
function hashBits(ix: number, iy: number, seed: number): number {
  let h =
    Math.imul(ix, 374761393) +
    Math.imul(iy, 668265263) +
    Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * The eight unit gradient directions, tabulated so `perlin2D` stays
 * allocation-free. Diagonals are normalised to 1/√2 so every direction
 * contributes equally — the raw (±1, ±1) corners would bias diagonal features.
 */
const SQRT1_2 = Math.SQRT1_2;
const PERLIN_GRADIENTS = new Float32Array([
  1, 0, -1, 0, 0, 1, 0, -1,
  SQRT1_2, SQRT1_2, -SQRT1_2, SQRT1_2,
  SQRT1_2, -SQRT1_2, -SQRT1_2, -SQRT1_2,
]);

/** Perlin's fade `6t⁵ - 15t⁴ + 10t³`: zero first *and* second derivative at 0/1. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** GLSL's three-argument `smoothstep`, clamped outside the edges. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The lattice gradient at (ix, iy), dotted with the offset from it. */
function gradientDot(
  ix: number,
  iy: number,
  dx: number,
  dy: number,
  seed: number,
): number {
  const g = (hashBits(ix, iy, seed) & 7) * 2;
  return PERLIN_GRADIENTS[g] * dx + PERLIN_GRADIENTS[g + 1] * dy;
}

/** 2D Perlin noise, roughly [-0.707, 0.707]. */
function perlin2D(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const dx = x - ix;
  const dy = y - iy;

  const ux = fade(dx);
  const uy = fade(dy);

  const n00 = gradientDot(ix, iy, dx, dy, seed);
  const n10 = gradientDot(ix + 1, iy, dx - 1, dy, seed);
  const n01 = gradientDot(ix, iy + 1, dx, dy - 1, seed);
  const n11 = gradientDot(ix + 1, iy + 1, dx - 1, dy - 1, seed);

  const top = n00 + (n10 - n00) * ux;
  const bottom = n01 + (n11 - n01) * ux;

  return top + (bottom - top) * uy;
}

/** Octaves in the clump fBm: three reads as ground, a fourth adds sub-metre detail. */
const CLUMP_OCTAVES = 3;
/** Deliberately unrelated to any placement seed. */
const CLUMP_SEED = 101;
/**
 * The field is thinned to this, never emptied: placement rejects candidates
 * until one passes, so a genuine zero would spin until the attempt budget ran
 * out.
 */
const MIN_BLADE_DENSITY = 0.05;
/** Candidates a blade may burn before the last one is taken regardless. */
const MAX_SAMPLE_ATTEMPTS = 64;
/** Half-width of the ramp that turns the fBm into a density. */
const CLUMP_CONTRAST = 0.15;

/**
 * Blade density at a world XZ position in `0..1`. `clumpStrength: 0` is a
 * density of exactly 1, so the neutral setting rejects nothing.
 */
function grassDensity(
  x: number,
  z: number,
  clumpScale: number,
  clumpStrength: number,
): number {
  let sum = 0;
  let total = 0;
  let frequency = 1 / clumpScale;
  let amplitude = 1;

  for (let octave = 0; octave < CLUMP_OCTAVES; octave += 1) {
    sum += amplitude * perlin2D(x * frequency, z * frequency, CLUMP_SEED + octave);
    total += amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }

  // The weighted mean is bounded by 1/√2, so `SQRT1_2` maps it onto [-1, 1]
  // exactly; the ramp lives inside that range rather than at its edges.
  const normalized = (sum / total) * SQRT1_2 + 0.5;
  const contrast = smoothstep(
    0.5 - CLUMP_CONTRAST,
    0.5 + CLUMP_CONTRAST,
    normalized,
  );

  return 1 - clumpStrength * (1 - MIN_BLADE_DENSITY) * (1 - contrast);
}

// ---------------------------------------------------------------------------
// Placement and attributes
// ---------------------------------------------------------------------------

type BladePlacement = {
  /** World-space blade roots, xyz per instance. Becomes the `offset` attribute. */
  positions: Float32Array;
  /** World-space unit surface normals, xyz per instance. */
  ups: Float32Array;
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
/** Growth-direction tilt range, in radians. */
const TILT_RANGE = 0.25;

/**
 * Scatters blades over a flat `width` × `depth` rectangle, with rejection
 * sampling against `grassDensity`. The count stays fixed; the noise only
 * decides where the blades land.
 */
function sampleFlatPlacement(
  instances: number,
  width: number,
  depth: number,
  center: readonly [number, number, number],
  clumpScale: number,
  clumpStrength: number,
  random: () => number,
): BladePlacement {
  const positions = new Float32Array(instances * 3);
  const ups = new Float32Array(instances * 3);

  for (let i = 0; i < instances; i += 1) {
    let x = 0;
    let z = 0;
    let attempts = 0;

    // The draw comes first so an exhausted budget still leaves a position to
    // keep rather than looping forever.
    for (;;) {
      x = random() * width - width / 2;
      z = random() * depth - depth / 2;

      attempts += 1;
      if (attempts >= MAX_SAMPLE_ATTEMPTS) break;
      if (random() < grassDensity(x, z, clumpScale, clumpStrength)) break;
    }

    positions[i * 3] = center[0] + x;
    positions[i * 3 + 1] = center[1];
    positions[i * 3 + 2] = center[2] + z;

    // Flat ground: every blade grows plumb.
    ups[i * 3] = 0;
    ups[i * 3 + 1] = 1;
    ups[i * 3 + 2] = 0;
  }

  return { positions, ups };
}

type GrassAttributes = {
  offsets: Float32Array;
  rootDirection: Float32Array;
  orientations: Float32Array;
  stretches: Float32Array;
};

/**
 * Turns a placement into the per-blade attributes the vertex shader consumes.
 *
 * The quaternion composition is the reference's — root heading, then a tilt
 * about X, then one about Z — with the blade frame first rotated so its local
 * +Y points along the surface normal, so blades grow out of a slope instead of
 * through it.
 */
function buildGrassAttributes(
  placement: BladePlacement,
  random: () => number,
): GrassAttributes {
  const offsets = placement.positions;
  const instances = offsets.length / 3;

  const rootDirection = new Float32Array(instances * 4);
  const orientations = new Float32Array(instances * 4);
  const stretches = new Float32Array(instances);

  // Scratch, reused across every blade.
  const align = new THREE.Quaternion();
  const heading = new THREE.Quaternion();
  const unbent = new THREE.Quaternion();
  const tilt = new THREE.Quaternion();
  const up = new THREE.Vector3();

  for (let i = 0; i < instances; i += 1) {
    up.set(
      placement.ups[i * 3],
      placement.ups[i * 3 + 1],
      placement.ups[i * 3 + 2],
    );

    // Identity on flat ground; the slope case is kept so a future collider
    // placement gets it for free.
    align.setFromUnitVectors(WORLD_UP, up);

    // A yaw about the blade's own axis (the surface normal once aligned).
    const rootAngle = Math.PI - random() * Math.PI * 2;

    // Heading only — the endpoint `slerp` starts from.
    unbent.setFromAxisAngle(WORLD_UP, rootAngle).premultiply(align);
    rootDirection[i * 4] = unbent.x;
    rootDirection[i * 4 + 1] = unbent.y;
    rootDirection[i * 4 + 2] = unbent.z;
    rootDirection[i * 4 + 3] = unbent.w;

    // The same frame with the growth tilts on top — where the tip ends up.
    heading.setFromAxisAngle(WORLD_UP, rootAngle).premultiply(align);
    heading.multiply(
      tilt.setFromAxisAngle(
        AXIS_X,
        (random() * 2 - 1) * TILT_RANGE,
      ),
    );
    heading.multiply(
      tilt.setFromAxisAngle(
        AXIS_Z,
        (random() * 2 - 1) * TILT_RANGE,
      ),
    );

    orientations[i * 4] = heading.x;
    orientations[i * 4 + 1] = heading.y;
    orientations[i * 4 + 2] = heading.z;
    orientations[i * 4 + 3] = heading.w;

    // A third of the blades are extra tall — the tall minority breaks up the
    // canopy.
    stretches[i] =
      i < instances / 3 ? random() * 1.8 : random();
  }

  return { offsets, rootDirection, orientations, stretches };
}

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

export type GrassFieldOptions = {
  /** Number of blades. */
  instances?: number;
  /** Edge lengths of the flat rectangle the field fills, in world units. */
  width?: number;
  depth?: number;
  /** World-space centre of that rectangle, at blade-root height. */
  center?: [number, number, number];
  bladeWidth?: number;
  bladeHeight?: number;
  /** Vertical segments per blade — how smoothly it can bend. */
  joints?: number;
  /** sRGB hex applied at the blade tip. */
  tipColor?: string;
  /** sRGB hex applied at the blade root. */
  bottomColor?: string;
  /** Self-lit lift so blades stay readable in a dark scene. */
  emissiveStrength?: number;
  /** Gust travel speed. */
  windSpeed?: number;
  /** Peak gust bend, in radians. */
  windStrength?: number;
  /** Wavelength of the clumping field, in world units. */
  clumpScale?: number;
  /** `0` uniform scatter, `1` patches separated by near-bare ground. */
  clumpStrength?: number;
  seed?: number;
};

export type GrassField = {
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshStandardNodeMaterial>;
  uniforms: GrassMaterial["uniforms"];
  dispose(): void;
};

/**
 * Builds the whole field as one instanced draw. The geometry's own bounds cover
 * a single blade at the origin, so the mesh opts out of frustum culling rather
 * than pretending its bounds are the field — see the note in `createGrassField`.
 */
export function createGrassField(options: GrassFieldOptions = {}): GrassField {
  const {
    instances = 45000,
    width = 32,
    depth = 20,
    center = [0, 0, 0],
    bladeWidth = 0.045,
    bladeHeight = 0.9,
    joints = 4,
    tipColor = "#a8f06a",
    bottomColor = "#0d240f",
    emissiveStrength = 0.3,
    windSpeed = 0.5,
    windStrength = 0.1,
    clumpScale = 7,
    clumpStrength = 0.85,
    seed = 404,
  } = options;

  const random = mulberry32(seed);

  // --- Blade template: one column of `joints` quads, root at the origin so the
  // shader's per-vertex rotation pivots about the base.
  const bladeTemplate = new THREE.PlaneGeometry(
    bladeWidth,
    bladeHeight,
    1,
    joints,
  );
  bladeTemplate.translate(0, bladeHeight / 2, 0);

  const placement = sampleFlatPlacement(
    instances,
    width,
    depth,
    center,
    clumpScale,
    clumpStrength,
    random,
  );
  const attributes = buildGrassAttributes(placement, random);

  // --- Instanced geometry. The template's index/position/uv buffers are
  // shared with this geometry, so the template is intentionally not disposed.
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = bladeTemplate.index;
  geometry.setAttribute("position", bladeTemplate.attributes.position);
  geometry.setAttribute("uv", bladeTemplate.attributes.uv);
  geometry.setAttribute(
    "offset",
    new THREE.InstancedBufferAttribute(attributes.offsets, 3),
  );
  geometry.setAttribute(
    "rootDirection",
    new THREE.InstancedBufferAttribute(attributes.rootDirection, 4),
  );
  geometry.setAttribute(
    "orientation",
    new THREE.InstancedBufferAttribute(attributes.orientations, 4),
  );
  geometry.setAttribute(
    "stretch",
    new THREE.InstancedBufferAttribute(attributes.stretches, 1),
  );

  // Required: InstancedBufferGeometry defaults this to Infinity, which the
  // WebGPU path reads directly as the draw's instance count.
  geometry.instanceCount = instances;

  const textures = getBladeTextures();
  const { material, uniforms } = createGrassMaterial({
    map: textures.diffuse,
    alphaMap: textures.alpha,
    bladeHeight,
    tipColor,
    bottomColor,
    windSpeed,
    windStrength,
    emissiveStrength,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "grass";
  // Culling is skipped on purpose: all instances are drawn every frame, so the
  // field cannot pop out at the frustum edge. Casting or receiving shadows is
  // also off — hundreds of thousands of vertices for a 1-unit blade is not
  // worth the second pass.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  return {
    mesh,
    uniforms,
    dispose() {
      geometry.dispose();
      material.dispose();
      // The blade textures are shared module-level assets and stay loaded.
    },
  };
}

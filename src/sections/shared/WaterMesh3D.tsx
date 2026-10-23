"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three/webgpu";
import { WaterMesh } from "three/addons/objects/Water2Mesh.js";
import { mulberry32 } from "./scene-utils";

export type WaterMesh3DOptions = {
  /**
   * Bounds of the circular surface in world units. The disc's diameter is the
   * smaller of the two, so a square request is exactly that wide.
   */
  width?: number;
  depth?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** Tint multiplied over the reflected/refracted water. */
  color?: string;
  /** Normal-map tiling across the disc. */
  scale?: number;
  flowDirection?: [number, number];
  flowSpeed?: number;
  reflectivity?: number;
};

const DEFAULT_POSITION: [number, number, number] = [0, 0, 0];
const DEFAULT_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0];
const DEFAULT_FLOW: [number, number] = [1, 1];
/** Segments around the disc's rim; the surface is flat, so this is only an edge. */
const WATER_SEGMENTS = 128;

const NORMAL_MAP_SIZE = 256;
/** Slope amplification baked into the normal maps. */
const NORMAL_MAP_STRENGTH = 0.02;
const WAVE_COUNT = 7;
const MAX_WAVE_NUMBER = 3;

/**
 * Bakes a seamless water normal map from a sum of waves with integer wave
 * numbers in x and y. Integer kx/ky make every term repeat over the unit
 * texture domain, so the map tiles without a visible seam: the value and its
 * derivatives at u=1/v=1 match u=0/v=0 exactly.
 *
 * Water2Mesh decodes red/green as the x/z slopes and reads blue directly as
 * the up axis, so the channels are packed to match that convention.
 */
function createNormalMap(seed: number) {
  const random = mulberry32(seed);
  const tau = Math.PI * 2;

  // One representative per lattice direction: a wave and its negation differ
  // only by a phase shift, so both would double up the same ridge pattern.
  const candidates: Array<{ kx: number; ky: number }> = [];
  for (let ky = 0; ky <= MAX_WAVE_NUMBER; ky += 1) {
    const minKx = ky === 0 ? 1 : -MAX_WAVE_NUMBER;
    for (let kx = minKx; kx <= MAX_WAVE_NUMBER; kx += 1) {
      candidates.push({ kx, ky });
    }
  }
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const waves = candidates.slice(0, WAVE_COUNT).map(({ kx, ky }) => {
    // Normalise by the wave number so high-frequency terms do not dominate the
    // slope; they contribute detail rather than amplitude.
    const waveNumber = Math.hypot(kx, ky);
    return {
      kx: kx * tau,
      ky: ky * tau,
      phase: random() * tau,
      amplitude: (0.5 + random() * 0.5) / waveNumber,
    };
  });

  const data = new Uint8Array(NORMAL_MAP_SIZE * NORMAL_MAP_SIZE * 4);

  for (let y = 0; y < NORMAL_MAP_SIZE; y += 1) {
    for (let x = 0; x < NORMAL_MAP_SIZE; x += 1) {
      const u = x / NORMAL_MAP_SIZE;
      const v = y / NORMAL_MAP_SIZE;

      let dx = 0;
      let dy = 0;
      for (const wave of waves) {
        const cos = Math.cos(wave.kx * u + wave.ky * v + wave.phase);
        const slope = cos * wave.amplitude;
        dx += slope * wave.kx;
        dy += slope * wave.ky;
      }

      let nx = -dx * NORMAL_MAP_STRENGTH;
      let ny = 1;
      let nz = -dy * NORMAL_MAP_STRENGTH;
      const length = Math.hypot(nx, ny, nz);
      nx /= length;
      ny /= length;
      nz /= length;

      const offset = (y * NORMAL_MAP_SIZE + x) * 4;
      data[offset] = Math.round((nx * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((nz * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round(ny * 255);
      data[offset + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(
    data,
    NORMAL_MAP_SIZE,
    NORMAL_MAP_SIZE,
    THREE.RGBAFormat,
  );
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

let cachedNormalMaps: [THREE.DataTexture, THREE.DataTexture] | null = null;

/** The two scrolling layers Water2Mesh blends; built once and shared. */
function getWaterNormalMaps(): [THREE.DataTexture, THREE.DataTexture] {
  cachedNormalMaps ??= [createNormalMap(17), createNormalMap(91)];
  return cachedNormalMaps;
}

/**
 * Builds a WebGPU water surface (reflections, refraction and two scrolling
 * normal layers). The mesh is returned for imperative section worlds, where
 * adding to a `<Canvas>` is not enough.
 */
export function createWaterMesh(options: WaterMesh3DOptions = {}): WaterMesh {
  const {
    width = 160,
    depth = 160,
    position = DEFAULT_POSITION,
    rotation = DEFAULT_ROTATION,
    color = "#ddfaf7",
    scale = 48,
    flowDirection = DEFAULT_FLOW,
    flowSpeed = 0.045,
    reflectivity = 0.06,
  } = options;

  // A disc rather than a quad: the surface has no corners to draw attention to
  // at the horizon, and it inherits CircleGeometry's planar 0..1 UVs, which the
  // tiling normal maps need.
  const radius = Math.min(width, depth) / 2;
  const geometry = new THREE.CircleGeometry(radius, WATER_SEGMENTS);

  const [normalMap0, normalMap1] = getWaterNormalMaps();
  const water = new WaterMesh(geometry, {
    normalMap0,
    normalMap1,
    color,
    scale,
    flowDirection: new THREE.Vector2(...flowDirection),
    flowSpeed,
    reflectivity,
  });

  water.position.set(...position);
  water.rotation.set(...rotation);
  // The reflector renders the scene from a mirrored camera; the surface is
  // large enough that culling it by its origin would pop it out of view.
  water.frustumCulled = false;

  return water;
}

/** Declarative wrapper for use inside a React Three Fiber canvas. */
export function WaterMesh3D({
  width = 160,
  depth = 160,
  position = DEFAULT_POSITION,
  rotation = DEFAULT_ROTATION,
  color = "#ddfaf7",
  scale = 48,
  flowDirection = DEFAULT_FLOW,
  flowSpeed = 0.045,
  reflectivity = 0.06,
}: WaterMesh3DOptions) {
  const water = useMemo(
    () =>
      createWaterMesh({
        width,
        depth,
        position,
        rotation,
        color,
        scale,
        flowDirection,
        flowSpeed,
        reflectivity,
      }),
    [
      width,
      depth,
      position,
      rotation,
      color,
      scale,
      flowDirection,
      flowSpeed,
      reflectivity,
    ],
  );

  useEffect(
    () => () => {
      water.geometry.dispose();
      water.material.dispose();
    },
    [water],
  );

  return <primitive object={water} />;
}

// A live procedural rainbow environment map, ported from the WebGL
// ShaderCubeChrome example to WebGPURenderer + TSL.
//
// The reference generated a screen-space pattern into an equirect texture and
// then resampled it into a cube. Here the noise is evaluated in 3D from each
// fragment's view direction, so the CubeCamera can bake it straight into the
// cube texture: no equirect intermediate, and no pole pinch or face seams.
//
// The module exposes the cube environment map and a basic material already
// wired to it.
import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import { abs, cos, float, positionWorld, sin, uniform, vec3 } from "three/tsl";

type Vec3Node = Node<"vec3">;
type FloatNode = Node<"float">;

export type LiveRainbowEnvMapOptions = {
  /** Cube map resolution in pixels. */
  resolution?: number;
  /** Tint multiplied over the rainbow pattern. */
  color?: THREE.ColorRepresentation;
};

export type LiveRainbowEnvMap = {
  /** The cube texture baked from the 3D pattern, ready for scene.environment. */
  envMap: THREE.CubeTexture;
  /** A basic material already using `envMap`, as in the original example. */
  material: THREE.MeshBasicNodeMaterial;
  /** Rebuilds the cube map for the given time. Pass the scene clock. */
  compute(time?: number): void;
  dispose(): void;
};

/**
 * The pattern's 2D rotation matrix, lifted to vec3: the x/y axes rotate and
 * z passes through so the pattern stays continuous in every direction.
 */
function rotate(p: Vec3Node): Vec3Node {
  return vec3(
    p.x.mul(0.8).sub(p.y.mul(0.6)),
    p.x.mul(0.6).add(p.y.mul(0.8)),
    p.z,
  );
}

/** Cheap separable "noise", extended to the third axis. */
function noise(p: Vec3Node): FloatNode {
  return sin(p.x).mul(sin(p.y)).mul(sin(p.z));
}

function fbm4(p: Vec3Node): FloatNode {
  let f: FloatNode = float(0);
  let q: Vec3Node = p;
  f = f.add(noise(q).mul(0.5));
  q = rotate(q).mul(2.02);
  f = f.add(noise(q).mul(0.25));
  q = rotate(q).mul(2.03);
  f = f.add(noise(q).mul(0.125));
  q = rotate(q).mul(2.01);
  f = f.add(noise(q).mul(0.0625));
  return f.div(0.9375);
}

function fbm6(p: Vec3Node): FloatNode {
  let f: FloatNode = float(0);
  let q: Vec3Node = p;
  const add = (weight: number) => {
    f = f.add(float(0.5).add(noise(q).mul(0.5)).mul(weight));
  };
  add(0.5);
  q = rotate(q).mul(2.02);
  add(0.25);
  q = rotate(q).mul(2.03);
  add(0.125);
  q = rotate(q).mul(2.01);
  add(0.0625);
  q = rotate(q).mul(2.04);
  add(0.03125);
  q = rotate(q).mul(2.01);
  add(0.015625);
  return f.div(0.96875);
}

/** The reference shader's folded turbulence, evaluated along a direction. */
function pattern(p: Vec3Node, time: FloatNode): FloatNode {
  const drifted = p.add(time);
  return abs(fbm4(drifted.add(fbm6(p.add(fbm4(drifted))))));
}

export function createLiveRainbowEnvMap(
  renderer: THREE.WebGPURenderer,
  options: LiveRainbowEnvMapOptions = {},
): LiveRainbowEnvMap {
  const resolution = options.resolution ?? 128;
  const time = uniform(0);
  const diffuse = uniform(new THREE.Color(options.color ?? "#ffffff"));

  // The pattern is evaluated along the fragment's view direction, so the box
  // around the cube camera can bake it straight into the cube faces.
  const direction = positionWorld.normalize().mul(0.55);
  const wobble = cos(time.mul(0.15));
  const rainbowDiff = 0.15;
  const rainbow = vec3(
    float(0.1).add(pattern(direction.add(wobble.mul(-1 * rainbowDiff)), time)),
    float(0.1).add(pattern(direction, time)),
    float(0.1).add(pattern(direction.add(wobble.mul(rainbowDiff)), time)),
  ).mul(diffuse);

  const cubeTarget = new THREE.CubeRenderTarget(resolution, {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
  });
  cubeTarget.texture.mapping = THREE.CubeReflectionMapping;

  const envScene = new THREE.Scene();
  const envMaterial = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
  envMaterial.colorNode = rainbow;
  const envGeometry = new THREE.BoxGeometry(5, 5, 5);
  envScene.add(new THREE.Mesh(envGeometry, envMaterial));

  const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeTarget);

  const material = new THREE.MeshBasicNodeMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    envMap: cubeTarget.texture,
  });

  return {
    envMap: cubeTarget.texture,
    material,
    compute(now) {
      time.value =
        now ??
        (typeof performance !== "undefined" ? performance.now() * 0.0001 : 0);

      cubeCamera.update(renderer, envScene);
    },
    dispose() {
      envScene.clear();
      envGeometry.dispose();
      envMaterial.dispose();
      material.dispose();
      cubeTarget.dispose();
    },
  };
}

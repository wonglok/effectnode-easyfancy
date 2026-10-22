// ---------------------------------------------------------------------------
// Star sky dome
// ---------------------------------------------------------------------------
// Ported from Gordon's `src/Content/StarSky.tsx` (itself a GLSL-to-TSL port of
// a simplex-noise star shader). Three `cnoise` samples build a drifting haze and
// two layers of twinkling points; a power of ~15 on the noise is what turns the
// smooth field into individual stars.
//
// The reference sphere is a 1 m ball and the shader only reads the *direction*
// to each vertex, so the object is scaled up here and moved with the camera:
// the sky is always centred on the viewer, and its size never has to clear the
// scene's far plane.
//
// Additive blending: a star sky is light, so the black dome adds nothing and
// the scene shows through. It also leaves the shader's dark teal haze intact,
// which normal alpha blending would squash.
// ---------------------------------------------------------------------------

import * as THREE from "three/webgpu";
import * as TSL from "three/tsl";

// The TSL typings key each function by its argument types, and a widened
// argument resolves to the float overload — which then rejects the `.x/.y/.z`
// swizzles this noise is built from. The runtime nodes are identical.
/* eslint-disable @typescript-eslint/no-explicit-any */
const {
  Fn,
  abs,
  clamp,
  dot,
  float,
  floor,
  fract,
  mix,
  min,
  mod,
  modelWorldMatrix,
  normalize,
  positionGeometry,
  pow,
  sin,
  step,
  time,
  uniform,
  varying,
  vec3,
  vec4,
} = TSL as any;

/** Any node produced by the widened namespace above. */
type TslNode = any;

/** Resolution the noise was tuned against in the original shader. */
const DEFAULT_RES = 768;

// ---- simplex noise ---------------------------------------------------------
// Ashima/Gustavson 3D simplex noise. `.toVar()` pins each stage to a shader
// variable where it is written; without it the expression graph would read the
// mutated value later in the flow.

const permute = Fn(([x]: [TslNode]) => mod(x.mul(34).add(1).mul(x), 289));

const taylorInvSqrt = Fn(([r]: [TslNode]) =>
  float(1.79284291400159).sub(r.mul(0.85373472095314)),
);

const fade = Fn(([t]: [TslNode]) =>
  t
    .mul(t)
    .mul(t)
    .mul(t.mul(t.mul(6).sub(15)).add(10)),
);

const cnoise = Fn(([P]: [TslNode]) => {
  const Pi0 = floor(P).toVar();
  const Pi1 = Pi0.add(vec3(1)).toVar();

  Pi0.assign(mod(Pi0, 289));
  Pi1.assign(mod(Pi1, 289));

  const Pf0 = fract(P).toVar();
  const Pf1 = Pf0.sub(vec3(1)).toVar();

  // Spelled out because `vec4(vec2, vec2)` argument splicing is the one
  // construction here not worth betting on.
  const ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  const iy = vec4(Pi0.y, Pi0.y, Pi1.y, Pi1.y);
  const iz0 = vec4(Pi0.z, Pi0.z, Pi0.z, Pi0.z);
  const iz1 = vec4(Pi1.z, Pi1.z, Pi1.z, Pi1.z);

  const ixy = permute(permute(ix).add(iy));
  const ixy0 = permute(ixy.add(iz0));
  const ixy1 = permute(ixy.add(iz1));

  const gx0 = ixy0.div(7).toVar();
  const gy0 = fract(floor(gx0).div(7)).sub(0.5).toVar();

  gx0.assign(fract(gx0));

  const gz0 = vec4(0.5).sub(abs(gx0)).sub(abs(gy0)).toVar();
  const sz0 = step(gz0, vec4(0)).toVar();

  gx0.assign(gx0.sub(sz0.mul(step(0, gx0).sub(0.5))));
  gy0.assign(gy0.sub(sz0.mul(step(0, gy0).sub(0.5))));

  const gx1 = ixy1.div(7).toVar();
  const gy1 = fract(floor(gx1).div(7)).sub(0.5).toVar();

  gx1.assign(fract(gx1));

  const gz1 = vec4(0.5).sub(abs(gx1)).sub(abs(gy1)).toVar();
  const sz1 = step(gz1, vec4(0)).toVar();

  gx1.assign(gx1.sub(sz1.mul(step(0, gx1).sub(0.5))));
  gy1.assign(gy1.sub(sz1.mul(step(0, gy1).sub(0.5))));

  const g000 = vec3(gx0.x, gy0.x, gz0.x);
  const g100 = vec3(gx0.y, gy0.y, gz0.y);
  const g010 = vec3(gx0.z, gy0.z, gz0.z);
  const g110 = vec3(gx0.w, gy0.w, gz0.w);
  const g001 = vec3(gx1.x, gy1.x, gz1.x);
  const g101 = vec3(gx1.y, gy1.y, gz1.y);
  const g011 = vec3(gx1.z, gy1.z, gz1.z);
  const g111 = vec3(gx1.w, gy1.w, gz1.w);

  const norm0 = taylorInvSqrt(
    vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)),
  );
  const norm1 = taylorInvSqrt(
    vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)),
  );

  const G000 = g000.mul(norm0.x);
  const G010 = g010.mul(norm0.y);
  const G100 = g100.mul(norm0.z);
  const G110 = g110.mul(norm0.w);
  const G001 = g001.mul(norm1.x);
  const G011 = g011.mul(norm1.y);
  const G101 = g101.mul(norm1.z);
  const G111 = g111.mul(norm1.w);

  const n000 = dot(G000, Pf0);
  const n100 = dot(G100, vec3(Pf1.x, Pf0.y, Pf0.z));
  const n010 = dot(G010, vec3(Pf0.x, Pf1.y, Pf0.z));
  const n110 = dot(G110, vec3(Pf1.x, Pf1.y, Pf0.z));
  const n001 = dot(G001, vec3(Pf0.x, Pf0.y, Pf1.z));
  const n101 = dot(G101, vec3(Pf1.x, Pf0.y, Pf1.z));
  const n011 = dot(G011, vec3(Pf0.x, Pf1.y, Pf1.z));
  const n111 = dot(G111, Pf1);

  const fadeXYZ = fade(Pf0);

  const nZ = mix(
    vec4(n000, n100, n010, n110),
    vec4(n001, n101, n011, n111),
    fadeXYZ.z,
  );
  const nYZ = mix(nZ.xy, nZ.zw, fadeXYZ.y);

  return float(2.2).mul(mix(nYZ.x, nYZ.y, fadeXYZ.x));
});

export type StarSkyOptions = {
  /** Background haze, sRGB hex. The reference's dark end. */
  colorA?: string;
  /** Haze tint toward the horizon/peaks, sRGB hex. */
  colorB?: string;
  /** Star colour, sRGB hex. */
  colorC?: string;
  /** Radius of the dome. Keep it well inside the camera's far plane. */
  radius?: number;
  /** Drift/twinkle speed multiplier. */
  speed?: number;
  res?: number;
};

export type StarSky = {
  /** Add this to the scene and keep it at the camera's position. */
  object: THREE.Group;
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicNodeMaterial>;
  uniforms: {
    speed: { value: number };
    colorA: { value: THREE.Color };
    colorB: { value: THREE.Color };
    colorC: { value: THREE.Color };
    res: { value: number };
  };
  dispose(): void;
};

export function createStarSky(options: StarSkyOptions = {}): StarSky {
  const {
    colorA: hexA = "#0d438f",
    colorB: hexB = "#1f2e7a",
    colorC: hexC = "#5262ef",
    radius = 200,
    speed = 1,
    res = DEFAULT_RES,
  } = options;

  const uniforms = {
    res: uniform(res, "float"),
    speed: uniform(speed, "float"),
    colorA: uniform(new THREE.Color(hexA)),
    colorB: uniform(new THREE.Color(hexB)),
    colorC: uniform(new THREE.Color(hexC)),
  };

  // Direction to the vertex in world space (w = 0, so the dome's translation
  // never enters the shader). Interpolated rather than recomputed per pixel.
  const worldDirection = varying(
    normalize(modelWorldMatrix.mul(vec4(positionGeometry, 0)).xyz),
  );

  const clock = time.div(3.5).mul(uniforms.speed);
  const pp = worldDirection.mul(350).add(clock.mul(2).mul(uniforms.speed));

  const noise = clamp(
    cnoise(clock.add(pp.div(250).mul(768).div(uniforms.res))),
    0,
    1,
  );

  // colorA is multiplied down hard and then squared, which keeps the sky dark
  // while colorB still glows near the horizon.
  const colorA = uniforms.colorA.mul(0.35);
  const colorB = uniforms.colorB.mul(0.5);
  const colorC = mix(colorA, colorB, noise);
  const background = colorC.mul(colorC);

  // A period-15.5 + sin(time) exponent: the twinkle drifts, and the high power
  // leaves only the noise peaks, which is what turns a field into stars.
  const starPow = float(15.5).add(sin(time));
  const starNoise1 = noise
    .mul(
      pow(
        cnoise(clock.add(pp.mul(2)))
          .mul(0.5)
          .add(0.5),
        starPow,
      ),
    )
    .mul(15);
  const starNoise2 = noise
    .mul(
      pow(
        cnoise(clock.add(pp.mul(1.3)))
          .mul(0.5)
          .add(0.5),
        starPow,
      ),
    )
    .mul(15);

  const rgb = background
    .add(pow(starNoise1, 1.3).mul(colorA))
    .add(pow(starNoise2, 1.3).mul(uniforms.colorC));

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = vec4(min(rgb, 0.99), 1);
  material.transparent = true;
  material.blending = THREE.AdditiveBlending;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  // The dome sits far beyond any scene fog; letting FogExp2 reach it would wash
  // the stars out to the fog colour.
  material.fog = false;

  const geometry = new THREE.SphereGeometry(1, 64, 64);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.setScalar(radius);
  mesh.frustumCulled = false;

  const object = new THREE.Group();
  object.add(mesh);

  return {
    object,
    mesh,
    uniforms: {
      speed: uniforms.speed as unknown as { value: number },
      colorA: uniforms.colorA as unknown as { value: THREE.Color },
      colorB: uniforms.colorB as unknown as { value: THREE.Color },
      colorC: uniforms.colorC as unknown as { value: THREE.Color },
      res: uniforms.res as unknown as { value: number },
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

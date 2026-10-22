// ---------------------------------------------------------------------------
// TSL grass-blade material
// ---------------------------------------------------------------------------
// Ported from the B3 template's `grassTSLMaterial.ts`, itself a TSL rewrite of
// three's `grass-shader` example (MIT, Poimandres):
// https://github.com/pmndrs/examples/tree/main/examples/grass-shader
//
// One blade is a PlaneGeometry stretched along +Y. Every blade-specific value —
// where it stands, which way it leans, how tall it is — arrives as an instanced
// attribute. The shader slerps the blade from its root heading toward its
// authored orientation as it climbs, then rocks the whole thing with a noise
// gust field. Nothing is animated on the CPU.
// ---------------------------------------------------------------------------

import {
  Color,
  DoubleSide,
  MeshStandardNodeMaterial,
  SRGBColorSpace,
} from "three/webgpu";
import type { Node, Texture } from "three/webgpu";
import {
  Fn,
  abs,
  acos,
  attribute,
  cos,
  cross,
  dot,
  float,
  max,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  saturate,
  select,
  sin,
  texture,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

/**
 * `attribute(name, nodeType)` is typed as `Node<string>` by @types/three, which
 * cannot be joined into a `vec3`/`vec4`. The runtime node is exactly what the
 * node type says, so these casts only restore the type the declaration drops.
 */
const vec3Attribute = (name: string) =>
  attribute(name, "vec3") as unknown as Node<"vec3">;
const vec4Attribute = (name: string) =>
  attribute(name, "vec4") as unknown as Node<"vec4">;
const floatAttribute = (name: string) =>
  attribute(name, "float") as unknown as Node<"float">;

/**
 * Rotate `v` by unit quaternion `q`:
 * `v + 2·(q.xyz × (q.xyz × v + q.w·v))`. Cheaper than building a matrix once
 * per vertex.
 */
const rotateByQuaternion = Fn(([v, q]: [Node<"vec3">, Node<"vec4">]) => {
  return cross(q.xyz, cross(q.xyz, v).add(q.w.mul(v)))
    .mul(2)
    .add(v);
});

/**
 * Shortest-path spherical interpolation between two unit quaternions.
 *
 * - `q` and `-q` are the same rotation, so a negative dot is flipped first;
 *   otherwise half the field bends the long way round and visibly spins.
 * - Near-parallel inputs degenerate the `sin θ₀` denominator, so it is floored
 *   and those cases fall back to a lerp.
 *
 * Both `select` branches are evaluated (it compiles to a ternary), hence the
 * floor on the divisor rather than a branch.
 */
const slerp = Fn(([v0, v1, t]: [Node<"vec4">, Node<"vec4">, Node<"float">]) => {
  const DOT_THRESHOLD = 0.9995;

  const rawDot = dot(v0, v1);
  const target = select(rawDot.lessThan(0), v1.negate(), v1);
  const d = abs(rawDot);

  // `d` is already in [0, 1]; `saturate` absorbs float error past 1, where
  // `acos` returns NaN and takes the whole blade with it.
  const theta0 = acos(saturate(d));
  const theta = theta0.mul(t);
  const s1 = sin(theta).div(max(sin(theta0), 1e-5));
  const s0 = cos(theta).sub(d.mul(s1));
  const spherical = v0.mul(s0).add(target.mul(s1));

  const linear = v0.add(target.sub(v0).mul(t));

  return normalize(select(d.greaterThan(DOT_THRESHOLD), linear, spherical));
});

export type GrassMaterialOptions = {
  /** Blade albedo, decoded from sRGB. */
  map: Texture;
  /** Blade silhouette, read on `.r` as the cutout. Data, not colour. */
  alphaMap: Texture;
  /** Blade length in world units. */
  bladeHeight: number;
  /** Colour at the blade tip, as an sRGB hex string. */
  tipColor: string;
  /** Colour at the blade root, as an sRGB hex string. */
  bottomColor: string;
  /** How far the gust field advances per second. */
  windSpeed: number;
  /** Peak bend, in radians, of the per-blade gust. */
  windStrength: number;
  /** Strength of the self-lit lift that keeps blades readable in a dark scene. */
  emissiveStrength: number;
};

export type GrassMaterial = {
  material: MeshStandardNodeMaterial;
  /** Live-tweakable values — mutate `.value` without rebuilding the material. */
  uniforms: {
    bladeHeight: { value: number };
    windSpeed: { value: number };
    windStrength: { value: number };
  };
};

/**
 * Builds the blade material. Deliberately `MeshStandardNodeMaterial` with a
 * lit-less look: the colour comes from the albedo plus the tip/root ramp, so
 * scene lighting only warms it rather than defining it.
 */
export function createGrassMaterial(
  options: GrassMaterialOptions,
): GrassMaterial {
  const {
    map,
    alphaMap,
    tipColor,
    bottomColor,
    bladeHeight: bladeHeightValue,
    windSpeed: windSpeedValue,
    windStrength: windStrengthValue,
    emissiveStrength,
  } = options;

  // Per-instance attributes built by `createGrassField`.
  const offset = vec3Attribute("offset");
  const orientation = vec4Attribute("orientation");
  const stretch = floatAttribute("stretch");
  const rootDirection = vec4Attribute("rootDirection");

  const bladeHeight = uniform(bladeHeightValue);
  const windSpeed = uniform(windSpeedValue);
  const windStrength = uniform(windStrengthValue);

  // Hex strings are sRGB; `setStyle` decodes them once into the working
  // (linear) space.
  const tipRgb = new Color().setStyle(tipColor, SRGBColorSpace);
  const bottomRgb = new Color().setStyle(bottomColor, SRGBColorSpace);

  const material = new MeshStandardNodeMaterial();

  // ---- Vertex -------------------------------------------------------------

  // 0 at the root → 1 at the tip. The blade's UVs span exactly the same range,
  // so the fragment side can derive it from `uv().y` without a varying.
  const rootToTip = positionLocal.y.div(bladeHeight);

  // A blade starts pointing straight out of the ground and slerps toward its
  // authored (tilted) orientation as it climbs — an arc, not a hinge.
  const direction = slerp(rootDirection, orientation, rootToTip);

  // Only Y is stretched, as in the reference: taller blades end up slightly
  // thinner in silhouette.
  const stretched = vec3(
    positionLocal.x,
    positionLocal.y.add(positionLocal.y.mul(stretch)),
    positionLocal.z,
  );

  const bent = rotateByQuaternion(stretched, direction);

  // Gusts travel across the field because the noise is sampled at
  // (time, world XZ) rather than per blade. The /50 sets the gust wavelength at
  // roughly 50 world units.
  const clock = time.mul(windSpeed);
  const gust = float(1).sub(
    mx_noise_float(vec2(clock.sub(offset.x.div(50)), clock.sub(offset.z.div(50)))),
  );
  const halfAngle = gust.mul(windStrength);

  // Rotating about YZ leans the blade along one axis, so the field sways
  // instead of spinning.
  const windQuaternion = normalize(
    vec4(sin(halfAngle), float(0), sin(halfAngle).negate(), cos(halfAngle)),
  );

  material.positionNode = Fn(() => {
    return offset.add(rotateByQuaternion(bent, windQuaternion));
  })();

  // ---- Fragment -----------------------------------------------------------

  const albedo = texture(map, uv());
  const tipRamp = mix(
    vec3(tipRgb.r, tipRgb.g, tipRgb.b),
    albedo.rgb,
    uv().y,
  );
  const bladeColor = mix(
    vec3(bottomRgb.r, bottomRgb.g, bottomRgb.b),
    tipRamp,
    uv().y,
  );

  material.colorNode = bladeColor;

  // Keep the cutout as `alphaTest` so three's own handling applies —
  // `alphaToCoverage` gives the edges a fwidth-based softness.
  material.opacityNode = texture(alphaMap, uv()).r;
  material.alphaTest = 0.15;
  material.side = DoubleSide;
  material.emissiveNode = bladeColor.mul(emissiveStrength);

  return {
    material,
    uniforms: {
      bladeHeight: bladeHeight as unknown as { value: number },
      windSpeed: windSpeed as unknown as { value: number },
      windStrength: windStrength as unknown as { value: number },
    },
  };
}

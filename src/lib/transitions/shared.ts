import type { Node } from "three/webgpu";
import {
  dot,
  fract,
  interleavedGradientNoise,
  length,
  oneMinus,
  screenCoordinate,
  screenUV,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

/**
 * Shared finishing pass for every composite: a soft vignette plus animated
 * grain. Both the plain frame and every transition output run through it, so
 * the site keeps one consistent finish.
 */
export function finishNode(input: Node<"vec4">, time: Node<"float">) {
  const uv = screenUV;
  const vignette = oneMinus(smoothstep(0.32, 0.86, length(uv.sub(0.5))))
    .mul(0.18)
    .add(0.82);

  const grain = interleavedGradientNoise(
    screenCoordinate.add(vec2(time.mul(47), time.mul(91))),
  )
    .sub(0.5)
    .mul(0.018);

  const rgb = input.rgb.mul(vignette).add(grain);
  return vec4(rgb, 1);
}

/** A cheap hash, shared by the ascii and light-rays shaders. */
export function hash12(v: Node<"vec2">) {
  const v3 = fract(vec3(v.x, v.y, v.x).mul(0.1031));
  const mixed = v3.add(dot(v3, vec3(v3.y, v3.z, v3.x).add(33.33)));
  return fract(mixed.x.add(mixed.y).mul(mixed.z));
}

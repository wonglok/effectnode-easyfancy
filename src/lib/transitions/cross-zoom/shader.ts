import type { Node } from "three/webgpu";
import {
  cos,
  dot,
  float,
  fract,
  mix,
  oneMinus,
  pow,
  screenUV,
  select,
  sin,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { TransitionContext } from "../types";

/**
 * Cross zoom, ported to TSL from rectalogic's gl-transition (MIT; after
 * Evan Wallace's glfx zoom blur). Both frames are dissolved through a strong
 * zoom blur whose centre drifts across the screen while its strength rises
 * and falls, so the handoff punches in and settles.
 */
export function buildCrossZoom({
  from,
  to,
  progress,
  finish,
}: TransitionContext) {
  const STRENGTH = 0.4;
  const SAMPLES = 40;

  // The reference works in bottom-left UV space, like the ports.
  const uv = vec2(screenUV.x, oneMinus(screenUV.y));
  const sampleFrom = (q: Node<"vec2">) => from.sample(vec2(q.x, oneMinus(q.y))).rgb;
  const sampleTo = (q: Node<"vec2">) => to.sample(vec2(q.x, oneMinus(q.y))).rgb;

  // The blur centre slides linearly from 0.25 to 0.75 across the handoff.
  const center = vec2(progress.mul(0.5).add(0.25), 0.5);

  // Exponential ease-in-out dissolve, with the reference's exact endpoint
  // values. time = progress / (duration / 2) = progress * 2.
  const time = progress.mul(2);
  const easeIn = pow(float(2), time.sub(1).mul(10)).mul(0.5);
  const easeOut = pow(float(2), time.sub(1).mul(-10)).mul(-0.5).add(1);
  const eased = select(time.lessThan(1), easeIn, easeOut);
  const dissolve = select(
    progress.lessThanEqual(0),
    float(0),
    select(progress.greaterThanEqual(1), float(1), eased),
  );

  // Mirrored sinusoid: 0 -> strength -> 0 over the blend.
  const blurStrength = oneMinus(cos(progress.mul(2 * Math.PI))).mul(
    STRENGTH * 0.5,
  );

  // A randomized sample offset hides the fixed step count.
  const offset = fract(
    sin(dot(uv, vec2(12.9898, 78.233))).mul(43758.5453),
  );
  const toCenter = center.sub(uv);

  // The reference's fixed 41-tap loop, unrolled at graph-build time.
  let sum: Node<"vec3"> = vec3(0);
  let total: Node<"float"> = float(0);
  for (let tap = 0; tap <= SAMPLES; tap += 1) {
    const percent = offset.add(tap).div(SAMPLES);
    const weight = percent.sub(percent.mul(percent)).mul(4);
    const sampleUv = uv.add(toCenter.mul(percent).mul(blurStrength));
    const faded = mix(sampleFrom(sampleUv), sampleTo(sampleUv), dissolve);
    sum = sum.add(faded.mul(weight));
    total = total.add(weight);
  }

  return finish(vec4(sum.div(total), 1));
}

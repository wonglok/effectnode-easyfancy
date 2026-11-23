import type { Node } from "three/webgpu";
import {
  cos,
  floor,
  fract,
  mix,
  mod,
  oneMinus,
  screenUV,
  select,
  sin,
  vec2,
  vec4,
} from "three/tsl";
import type { TransitionContext } from "../types";

/**
 * Doom-style melt, ported to TSL from Zeh Fernando's gl-transition. The
 * outgoing frame slides downward in vertical columns, each with its own
 * speed, wave and drip shape, while the incoming scene is revealed from the
 * top of the screen.
 */
export function buildMelt({
  from,
  to,
  progress,
  finish,
}: TransitionContext) {
  const BARS = 30;
  const AMPLITUDE: number = 2;
  const NOISE: number = 0.1;
  const FREQUENCY: number = 0.5;
  const DRIP_SCALE: number = 0.5;

  // The reference shader works in bottom-left UV space.
  const uv = vec2(screenUV.x, oneMinus(screenUV.y));
  const sampleFrom = (q: Node<"vec2">) => from.sample(vec2(q.x, oneMinus(q.y)));
  const sampleTo = (q: Node<"vec2">) => to.sample(vec2(q.x, oneMinus(q.y)));

  // One bar per column, indexing all per-column shapes below.
  const num = floor(uv.x.mul(BARS));

  // A hashed per-column value, mixed into the wave to break up its rhythm.
  const rand = fract(
    mod(num.mul(67123.313), 12)
      .mul(sin(num.mul(10.3)))
      .mul(cos(num)),
  );

  // A low-frequency wave gives neighbouring columns similar speeds.
  const fn = num.mul(FREQUENCY * 0.1 * BARS);
  const wave = cos(fn.mul(0.5))
    .mul(cos(fn.mul(0.13)))
    .mul(sin(fn.add(10).mul(0.3)))
    .div(2)
    .add(0.5);

  // Columns near the middle of the screen start later than the edges.
  const drip = sin(num.div(BARS - 1).mul(Math.PI)).mul(DRIP_SCALE);

  const waved = NOISE === 0 ? wave : mix(wave, rand, NOISE);
  const shape = DRIP_SCALE === 0 ? waved : waved.add(drip);
  const phase = progress.mul(shape.mul(AMPLITUDE).add(1));

  // The outgoing frame is sampled lower than it is drawn, so its content
  // runs down the screen as the phase grows.
  const fromColor = sampleFrom(vec2(uv.x, uv.y.add(phase))).rgb;
  const toColor = sampleTo(uv).rgb;

  return finish(
    vec4(select(phase.add(uv.y).lessThan(1), fromColor, toColor), 1),
  );
}

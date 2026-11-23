import type { Node } from "three/webgpu";
import {
  float,
  fract,
  mix,
  oneMinus,
  pow,
  screenUV,
  sign,
  sin,
  step,
  vec2,
  vec4,
} from "three/tsl";
import type { TransitionContext } from "../types";

/**
 * Directional scale, ported to TSL from Thibaut Foussard's gl-transition
 * (after Gaëtan Renaudeau's Directional). The outgoing frame slides in
 * `direction` while the incoming frame is revealed from the opposite edge.
 * Both frames shrink around the midpoint (the `parabola` term peaks at
 * progress 0.5), leaving the black gutter that separates the two slides.
 */
export function buildDirectionalScale({
  from,
  to,
  progress,
  finish,
}: TransitionContext) {
  const PI = Math.PI;
  const SCALE = 0.7;
  // @param direction of the movement, in the reference's bottom-left UV
  // space. (0, 1) pushes the outgoing frame upward.
  const direction = vec2(0, 1);

  // The reference shader works in bottom-left UV space, like the melt and
  // page-curl ports.
  const uv = vec2(screenUV.x, oneMinus(screenUV.y));
  const sampleFrom = (q: Node<"vec2">) => from.sample(vec2(q.x, oneMinus(q.y)));
  const sampleTo = (q: Node<"vec2">) => to.sample(vec2(q.x, oneMinus(q.y)));

  // Snappy ease-out, cubed exactly as in the reference.
  const easedProgress = pow(sin(progress.mul(PI / 2)), 3);

  // Shift the frame, then wrap so both slides tile infinitely.
  const p = uv.add(sign(direction).mul(easedProgress));
  const wrapped = fract(p);

  // parabola(progress) = sin(progress * PI), zero at both ends and one in
  // the middle, so the shrink is strongest mid-handoff.
  const parabola = sin(progress.mul(PI));
  const s = float(1).sub(
    oneMinus(float(1).div(SCALE)).mul(parabola),
  );

  // Shrink the wrapped frame about its centre.
  const f = wrapped.sub(0.5).mul(s).add(0.5);

  // Which slide owns this pixel: the wrapped p inside [0, 1] shows the
  // outgoing frame, everything else shows the incoming one.
  const mixer = step(0, p.x)
    .mul(step(p.x, 1))
    .mul(step(0, p.y))
    .mul(step(p.y, 1));

  const fromColor = sampleFrom(f).rgb;
  const toColor = sampleTo(f).rgb;
  const rgb = mix(toColor, fromColor, mixer);

  // The scaled frame leaves the space beyond [0, 1] black.
  const border = step(0, f.x)
    .mul(step(0, oneMinus(f.x)))
    .mul(step(0, f.y))
    .mul(step(0, oneMinus(f.y)));

  return finish(vec4(rgb.mul(border), 1));
}

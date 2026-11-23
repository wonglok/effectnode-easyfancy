import type { Node } from "three/webgpu";
import {
  abs,
  atan,
  clamp,
  cos,
  dot,
  float,
  length,
  log,
  max,
  min,
  mix,
  normalize,
  oneMinus,
  pow,
  reflect,
  screenSize,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { TransitionContext } from "../types";

/**
 * Ball roll, ported to TSL from gre's gl-transition (MIT). The outgoing
 * frame wraps itself onto a shaded sphere that shrinks and rolls away,
 * revealing the incoming frame under a soft shadow. Used for the first
 * handoff (Kinetic -> Flow Shield, "transition 1").
 */
export function buildBallRoll({
  from,
  to,
  progress,
  finish,
}: TransitionContext) {
  const PI = Math.PI;
  // Half width of the antialiased ball edge, in frame heights.
  const AA = 0.0015;
  // Radius of the wrapped ball relative to the shorter frame side.
  const SIZE = 0.3;
  // Strength of the shading and of the shadow on the incoming frame.
  const SHADING = 0.6;
  const SHADOW = 0.5;
  // Toward the light, from the top left (pre-normalised by 1.2689).
  const LIGHT = vec3(-0.5, 0.6, 1.0).div(1.2689);
  // The ball rolls away toward +x in reference (bottom-left) UV space.
  const DIRECTION = vec2(1, 0);

  const ratio = screenSize.x.div(screenSize.y);
  // Work in bottom-left reference space, flip back when sampling.
  const uv = vec2(screenUV.x, oneMinus(screenUV.y));
  const sampleFrom = (q: Node<"vec2">) => from.sample(vec2(q.x, oneMinus(q.y)));
  const sampleTo = (q: Node<"vec2">) => to.sample(vec2(q.x, oneMinus(q.y)));

  const dir = normalize(DIRECTION);
  const side = vec2(dir.y.negate(), dir.x);

  // Square-pixel space, so the ball is round on any aspect ratio.
  const p = uv.sub(0.5).mul(vec2(ratio, 1));
  const shorter = min(ratio, 1.0);
  const r0 = float(SIZE).clamp(0.1, 0.5).mul(shorter);

  // The frame curves into a ball (flat at first), then the ball shrinks
  // while rolling away until it and its shadow have left the frame.
  const wRaw = clamp(progress.div(0.45), 0, 1);
  const w = float(1).sub(oneMinus(wRaw).mul(oneMinus(wRaw)));
  const awayRaw = smoothstep(0.3, 1.0, progress);
  const away = awayRaw.mul(awayRaw);
  const wrapped = r0.div(max(w, 1e-4));
  const radius = wrapped.mul(mix(float(1), float(0.5), away));
  // Pull the image tighter as it wraps, so it ends up covering the ball.
  const tight = mix(
    float(1),
    min(float(1), shorter.mul(0.48).div(float(PI).mul(r0))),
    w.mul(w),
  );
  const paper = radius.mul(tight);
  // Half extent of the frame along the roll direction.
  const e = float(0.5).mul(abs(dir.x).mul(ratio).add(abs(dir.y)));
  // Far enough that the ball (0.5 * r0 by then) and its shadow have left.
  const full = e.add(r0.mul(1.1)).add(AA * 2);
  const travel = away.mul(full);
  const center = dir.mul(travel);
  // Rolling without slipping: the integral of dtravel / radius.
  const angle = full
    .mul(-2)
    .mul(log(float(1).sub(away.mul(0.5))))
    .div(wrapped);

  const d = p.sub(center);
  const r = length(d);

  // Soft shadow on the incoming frame, below and right of the ball.
  const sd = d.sub(vec2(0.25, -0.3).mul(radius).mul(w));
  const shadowAmount = float(SHADOW)
    .mul(w)
    .mul(
      oneMinus(
        smoothstep(radius.mul(0.6), radius.mul(1.4), length(sd)),
      ),
    );

  const toSample = sampleTo(uv);
  // Premultiplied background, so transparent frames do not bleed colour.
  const bgRgb = toSample.rgb.mul(toSample.a).mul(oneMinus(shadowAmount));

  // The visible cap of the ball.
  const cover = oneMinus(
    smoothstep(radius.sub(AA), radius.add(AA), r),
  );
  const nd = d.div(radius);
  // Normal of the visible point (no squared radius, which overflows when
  // the ball is huge).
  const n = vec3(nd.x, nd.y, sqrt(max(float(1).sub(dot(nd, nd)), 0)));
  // Undo the roll: rotate around the axis across the direction.
  const u = dot(n.xy, dir);
  const s = dot(n.xy, side);
  const cu = cos(angle);
  const su = sin(angle);
  const q = vec3(
    u.mul(cu).sub(n.z.mul(su)),
    s,
    u.mul(su).add(n.z.mul(cu)),
  );
  // The image is wrapped around the ball from its front point, distances
  // kept along the surface.
  const lq = length(q.xy);
  const arc = atan(lq, q.z).mul(paper);
  const img = select(
    lq.greaterThan(0),
    q
      .x
      .mul(dir)
      .add(q.y.mul(side))
      .div(lq)
      .mul(arc),
    vec2(0),
  );
  const iuv = img.div(vec2(ratio, 1)).add(0.5);
  // Distance to the image edge, antialiased like the ball outline.
  const edge = min(iuv, oneMinus(iuv)).mul(vec2(ratio, 1));
  const inside = cover.mul(
    smoothstep(float(-AA), AA, min(edge.x, edge.y)),
  );

  const fromSample = sampleFrom(clamp(iuv, 0, 1));
  const diff = max(dot(n, LIGHT), 0);
  const spec = pow(max(reflect(LIGHT.negate(), n).z, 0), 24);
  const k = float(SHADING).mul(w);
  const lit = clamp(
    fromSample.rgb
      .mul(mix(float(1), float(0.25).add(diff.mul(0.85)), k))
      .add(float(0.35).mul(k).mul(spec)),
    0,
    1,
  );
  const ballRgb = lit.mul(fromSample.a).mul(inside);
  const ballA = fromSample.a.mul(inside);

  // Premultiplied composite: ball over the shadowed incoming frame.
  const compositeRgb = ballRgb.add(bgRgb.mul(oneMinus(ballA)));
  const compositeA = ballA.add(toSample.a.mul(oneMinus(ballA)));
  const rolledRgb = select(
    compositeA.greaterThan(0),
    compositeRgb.div(compositeA),
    vec3(0),
  );

  // Exact endpoints match the neighbouring chapters' plain frames.
  const rgb = select(
    progress.lessThanEqual(0),
    sampleFrom(uv).rgb,
    select(progress.greaterThanEqual(1), toSample.rgb, rolledRgb),
  );

  return finish(vec4(rgb, 1));
}

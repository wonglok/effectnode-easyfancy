import type { Node } from "three/webgpu";
import {
  abs,
  atan,
  dot,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  mod,
  oneMinus,
  screenSize,
  screenUV,
  select,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { hash12 } from "../shared";
import type { TransitionContext } from "../types";

/**
 * Shafts of light, ported to TSL from gre's gl-transition (MIT). Light
 * bursts from the highlights of the outgoing frame and streams outward from
 * a slowly drifting centre as radial shafts; at their peak the incoming
 * frame takes over and its own rays shrink back into its highlights. Kept as
 * an available shader for future pairs; the third handoff now uses the
 * text-mode dissolve instead.
 */
export function buildLightRays({
  from,
  to,
  progress,
  finish,
}: TransitionContext) {
  const TAPS = 20;
  // Number of shafts around the centre.
  const SHAFTS = 23;
  const PI = Math.PI;
  // The rays stream away from this point at the middle of the transition.
  const CENTER = vec2(0.5, 0.6);
  // How far the centre drifts left to right during the handoff, and the
  // length of the rays at their peak as a fraction of their distance to it.
  const DRIFT = 0.15;
  const REACH = 0.6;
  // Brightness above which the image casts rays, and the ray brightness.
  const THRESHOLD = 0.65;
  const INTENSITY = 1.5;
  // Warm white near the sources, tinted toward the ends of the rays.
  const TINT = vec3(1.0, 0.82, 0.55);

  const ratio = screenSize.x.div(screenSize.y);
  // The reference works in bottom-left UV space, like the ports above.
  const uv = vec2(screenUV.x, oneMinus(screenUV.y));
  const sampleFrom = (q: Node<"vec2">) => from.sample(vec2(q.x, oneMinus(q.y)));
  const sampleTo = (q: Node<"vec2">) => to.sample(vec2(q.x, oneMinus(q.y)));

  // Smooth noise around the centre, wrapping over a full turn (t in 0..1).
  const shaftNoise = (t: Node<"float">, n: number, seed: number) => {
    const x = t.mul(n);
    const i = floor(x);
    const f = x.sub(i);
    const a = hash12(vec2(mod(i, n), seed));
    const b = hash12(vec2(mod(i.add(1), n), seed));
    return mix(a, b, f.mul(f).mul(float(3).sub(f.mul(2))));
  };

  // Mirror coordinates back into the frame, so the rays can reach past it.
  const mirror = (v: Node<"vec2">) =>
    vec2(1).sub(abs(vec2(1).sub(mod(v, 2))));

  // The light of a pixel (premultiplied): its colour above the threshold.
  const glow = (c: Node<"vec4">, knee: Node<"float">) => {
    const lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    return c.rgb.mul(c.a).mul(smoothstep(knee, knee.add(0.2), lum));
  };

  // The rays grow on the outgoing image, then shrink into the incoming one.
  const amount = select(
    progress.lessThan(0.5),
    smoothstep(0, 0.5, progress),
    oneMinus(smoothstep(0.5, 1, progress)),
  );
  const peak = amount.mul(amount).mul(amount);
  // The frame switches under the cover of the peak.
  const m = smoothstep(0.46, 0.54, progress);
  // The light at a ray tap: one image, or both during the short switch.
  const light = (st: Node<"vec2">, knee: Node<"float">) =>
    mix(glow(sampleFrom(st), knee), glow(sampleTo(st), knee), m);

  // The rays stream away from a centre drifting slowly across the frame.
  const origin = CENTER.add(vec2(progress.sub(0.5).mul(DRIFT), 0));
  const rayLength = amount.mul(REACH);
  // More and more of the image catches the light as the rays grow.
  const knee = mix(THRESHOLD, THRESHOLD * 0.75, peak);
  // A small shift of the taps, under their spacing, blends them into smooth
  // shafts; hashed by integer cell so every GPU computes the same shift.
  const jitter = hash12(floor(uv.mul(vec2(ratio, 1)).mul(997)));

  // The light gathered on the way to the centre, fading with the distance
  // it travels.
  let rays: Node<"vec3"> = vec3(0);
  let total: Node<"float"> = float(0);
  for (let i = 0; i < TAPS; i += 1) {
    const s = float(i).add(jitter).div(TAPS);
    const w = exp(s.mul(-2));
    // Warm white near the sources, tinted further along the rays.
    const hue = mix(vec3(1), TINT, smoothstep(0, 0.6, s));
    const tap = mirror(mix(uv, origin, s.mul(rayLength)));
    rays = rays.add(hue.mul(w).mul(light(tap, knee)));
    total = total.add(w);
  }

  // The light breaks into shafts of different strengths, slowly turning.
  const d = uv.sub(origin).mul(vec2(ratio, 1));
  // atan is undefined at the centre itself.
  const turn = select(
    length(d).greaterThan(1e-6),
    atan(d.y, d.x).div(2 * PI).add(0.5),
    float(0),
  );
  const shafts = shaftNoise(fract(turn.add(progress.mul(0.03))), SHAFTS, 1)
    .mul(0.6)
    .add(
      shaftNoise(
        fract(turn.sub(progress.mul(0.05))),
        SHAFTS * 2 + 1,
        7,
      ).mul(0.4),
    );
  // Merged back into a soft glow close to the centre, where the shafts
  // would meet in a point.
  rays = rays.mul(
    mix(
      float(1),
      mix(0.2, 1.6, smoothstep(0.15, 0.85, shafts)),
      smoothstep(0, 0.3, length(d)),
    ),
  );
  rays = rays
    .mul(amount.mul(INTENSITY).mul(peak.mul(3).add(1)))
    .div(total);
  // Compressed, so bright areas never flatten into white.
  rays = vec3(1)
    .sub(exp(rays.negate()))
    .mul(0.9);

  // The image stays sharp, with a slight lift of the exposure at the peak;
  // the rays are screened on top and add nothing to its alpha.
  const fromSample = sampleFrom(uv);
  const toSample = sampleTo(uv);
  const mixed = mix(
    vec4(fromSample.rgb.mul(fromSample.a), fromSample.a),
    vec4(toSample.rgb.mul(toSample.a), toSample.a),
    m,
  );
  const base = min(
    mixed.rgb
      .div(max(mixed.a, 1e-4))
      .mul(peak.mul(0.2).add(1)),
    1,
  );
  const rgb = select(
    mixed.a.lessThanEqual(0),
    vec3(0),
    base.add(rays).sub(base.mul(rays)),
  );

  return finish(vec4(rgb, 1));
}

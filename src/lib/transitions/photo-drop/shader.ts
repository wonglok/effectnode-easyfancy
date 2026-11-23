import type { Node } from "three/webgpu";
import {
  abs,
  clamp,
  cos,
  float,
  length,
  max,
  min,
  mix,
  oneMinus,
  screenSize,
  screenUV,
  select,
  sin,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { TransitionContext } from "../types";

/**
 * Flash photo drop, ported to TSL from gre's gl-transition (MIT). A camera
 * flash freezes the outgoing frame into a printed photo with a white border;
 * the card shrinks, tilts and falls out of the frame under gravity, casting a
 * soft shadow on the incoming frame behind it. Used for the second handoff
 * (Flow Shield -> Live Env, "transition 2").
 */
export function buildPhotoDrop({
  from,
  to,
  progress,
  finish,
}: TransitionContext) {
  // How much the photo turns as it drops, border width, flash and shadow.
  const TILT = 0.35;
  const BORDER = 0.04;
  const FLASH = 0.85;
  const SHADOW = 0.45;
  const BORDER_COLOR = vec4(0.96, 0.94, 0.89, 1.0);
  // How much smaller the photo gets before it drops, its corner radius and
  // the width of the antialiased edges (frame heights).
  const SHRINK = 0.24;
  const RADIUS = 0.008;
  const AA = 0.0015;
  // Baked |sin| / |cos| of the final tilt, for the fall bound.
  const TILT_SIN = Math.abs(Math.sin(TILT));
  const TILT_COS = Math.abs(Math.cos(TILT));

  const ratio = screenSize.x.div(screenSize.y);
  const asp = vec2(ratio, 1);
  // Work in bottom-left reference space, flip back when sampling.
  const uv = vec2(screenUV.x, oneMinus(screenUV.y));
  const sampleFrom = (q: Node<"vec2">) => from.sample(vec2(q.x, oneMinus(q.y)));
  const sampleTo = (q: Node<"vec2">) => to.sample(vec2(q.x, oneMinus(q.y)));

  /** Signed distance to a rounded box of half size b, corner radius r. */
  const roundedBox = (
    point: Node<"vec2">,
    halfSize: Node<"vec2">,
    corner: Node<"float">,
  ) => {
    const d = abs(point).sub(halfSize).add(corner);
    return length(max(d, vec2(0)))
      .add(min(max(d.x, d.y), 0))
      .sub(corner);
  };
  const premultiply = (c: Node<"vec4">) => vec4(c.rgb.mul(c.a), c.a);

  const q = uv.sub(0.5).mul(asp);
  const halfImage = asp.mul(0.5);
  const halfCard = halfImage.add(vec2(BORDER, BORDER));

  // The photo shrinks right after the flash, then falls with gravity,
  // turning as it goes.
  const k = smoothstep(0.05, 0.4, progress);
  const t = clamp(progress.sub(0.3).div(0.7), 0, 1);
  const fall = t.mul(t);
  const s = float(1).sub(k.mul(SHRINK));
  const angle = float(-TILT).mul(k.mul(0.12).add(fall.mul(0.88)));
  // Fall far enough for the turned photo and its shadow to leave the frame.
  const bound = halfCard
    .x
    .mul(TILT_SIN)
    .add(halfCard.y.mul(TILT_COS))
    .mul(1 - SHRINK);
  // It lifts a little toward the viewer before the drop.
  const lift = k.mul(oneMinus(fall)).mul(0.035);
  const center = vec2(
    fall.mul(0.08),
    lift.sub(fall.mul(bound.add(0.6))),
  );

  const rad = k.mul(RADIUS);
  const ca = cos(angle);
  const sa = sin(angle);
  // GLSL mat2(ca, -sa, sa, ca) is column-major, i.e. rotation by -angle.
  const unrotate = (point: Node<"vec2">) =>
    vec2(
      ca.mul(point.x).add(sa.mul(point.y)),
      ca.mul(point.y).sub(sa.mul(point.x)),
    );

  // The incoming image, already behind the photo, in its soft shadow.
  const toSample = sampleTo(uv);
  const sh = float(SHADOW).mul(k);
  const rs = unrotate(
    q.sub(center).sub(vec2(0.012, -0.022).mul(k)),
  ).div(s);
  const ds = roundedBox(rs, halfCard, rad).mul(s);
  const blur = float(0.035).mul(s);
  const dim = oneMinus(
    sh.mul(oneMinus(smoothstep(blur.negate(), blur, ds))),
  );
  let col: Node<"vec4"> = premultiply(
    vec4(toSample.rgb.mul(dim), toSample.a),
  );

  // The photo: the outgoing image, framed by its paper border.
  const r = unrotate(q.sub(center)).div(s);
  const dCard = roundedBox(r, halfCard, rad).mul(s);
  const dImage = roundedBox(r, halfImage, float(0)).mul(s);
  // Edges are pushed out one AA width, so the photo fills the frame at p=0.
  const cardCover = clamp(float(1.5).sub(dCard.div(AA)), 0, 1);
  const imageCover = clamp(float(1.5).sub(dImage.div(AA)), 0, 1);
  const fromSample = sampleFrom(clamp(r.div(asp).add(0.5), 0, 1));
  const photo = premultiply(fromSample);
  const paper = premultiply(BORDER_COLOR);
  const card = mix(
    paper.add(col.mul(oneMinus(paper.a))),
    photo,
    imageCover,
  );
  col = mix(col, card, cardCover);

  const rgbBase = select(
    col.a.greaterThan(0),
    col.rgb.div(col.a),
    vec3(0),
  );

  // The flash only adds light: a quick bloom to white that fades out.
  const f = float(FLASH)
    .mul(smoothstep(0, 0.05, progress))
    .mul(oneMinus(smoothstep(0.05, 0.3, progress)));
  const rgb = float(1).sub(oneMinus(rgbBase).mul(oneMinus(f)));

  return finish(vec4(rgb, 1));
}

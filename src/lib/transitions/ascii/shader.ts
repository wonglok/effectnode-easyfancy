import type { Node } from "three/webgpu";
import {
  abs,
  clamp,
  dot,
  float,
  floor,
  length,
  max,
  min,
  mix,
  oneMinus,
  pow,
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
 * Text-mode dissolve, ported to TSL from gre's gl-transition (MIT). The
 * outgoing frame turns into characters whose density follows the cell
 * brightness; as the handoff advances, each cell scrambles through random
 * characters, switches to the incoming frame at its own time, then resolves
 * back into that frame. Used for the third handoff (Live Env -> Alpha 6,
 * "transition 3").
 */
export function buildAscii({
  from,
  to,
  progress,
  finish,
}: TransitionContext) {
  // Height of a character (frame heights), its width (in cell heights) and
  // the half width of its strokes. 0.012 is 0.3x the reference's 0.04, so
  // the text grid is almost three times denser.
  const CELL_SIZE = 0.012;
  const ASPECT = 0.6;
  const STROKE = 0.05;
  // Colored characters take the image's own tint; otherwise they use ink.
  const COLORED = true;
  const INK = vec3(0.3, 1.0, 0.45);
  const BACKGROUND = vec3(0, 0, 0);

  const ratio = screenSize.x.div(screenSize.y);
  // The reference works in bottom-left UV space, like the ports above.
  const uv = vec2(screenUV.x, oneMinus(screenUV.y));
  const sampleFrom = (q: Node<"vec2">) => from.sample(vec2(q.x, oneMinus(q.y)));
  const sampleTo = (q: Node<"vec2">) => to.sample(vec2(q.x, oneMinus(q.y)));

  // Distance to the segment from a to b.
  const segment = (
    q: Node<"vec2">,
    a: Node<"vec2">,
    b: Node<"vec2">,
  ) => {
    const pa = q.sub(a);
    const ba = b.sub(a);
    return length(
      pa.sub(ba.mul(clamp(dot(pa, ba).div(dot(ba, ba)), 0, 1))),
    );
  };

  // Distance to the strokes of the character for this density, from 0 (" ")
  // to 9 ("@"), at q, in cell heights from the cell's centre.
  const glyph = (density: Node<"float">, q: Node<"vec2">) => {
    // Every character is built, then the density picks one branchlessly.
    const space = float(1);
    const period = length(q.sub(vec2(0, -0.27))).sub(0.035);
    const colon = min(
      length(q.sub(vec2(0, -0.25))),
      length(q.sub(vec2(0, 0.1))),
    ).sub(0.035);
    const dash = segment(q, vec2(-0.17, 0), vec2(0.17, 0)).sub(STROKE);
    const equals = min(
      segment(q, vec2(-0.18, 0.1), vec2(0.18, 0.1)),
      segment(q, vec2(-0.18, -0.1), vec2(0.18, -0.1)),
    ).sub(STROKE);
    const plus = min(
      segment(q, vec2(-0.19, 0), vec2(0.19, 0)),
      segment(q, vec2(0, -0.19), vec2(0, 0.19)),
    ).sub(STROKE);
    let star = segment(q, vec2(0, -0.2), vec2(0, 0.2));
    star = min(star, segment(q, vec2(-0.18, -0.11), vec2(0.18, 0.11)));
    star = min(star, segment(q, vec2(-0.18, 0.11), vec2(0.18, -0.11)));
    star = star.sub(STROKE);
    let hashMark = min(
      segment(q, vec2(-0.06, -0.3), vec2(-0.1, 0.3)),
      segment(q, vec2(0.12, -0.3), vec2(0.08, 0.3)),
    );
    hashMark = min(
      hashMark,
      min(
        segment(q, vec2(-0.24, 0.11), vec2(0.24, 0.11)),
        segment(q, vec2(-0.24, -0.11), vec2(0.24, -0.11)),
      ),
    ).sub(STROKE);
    let percent = segment(q, vec2(-0.2, -0.3), vec2(0.2, 0.3));
    percent = min(
      percent,
      abs(length(q.sub(vec2(-0.13, 0.19))).sub(0.08)),
    );
    percent = min(
      percent,
      abs(length(q.sub(vec2(0.13, -0.19))).sub(0.08)),
    );
    percent = percent.sub(STROKE);
    // "@": a ring around a small "a".
    let at = abs(length(q).sub(0.25));
    at = min(at, abs(length(q.sub(vec2(-0.02, 0))).sub(0.1)));
    at = min(at, segment(q, vec2(0.08, 0.1), vec2(0.08, -0.12)));
    at = at.sub(0.8 * STROKE);

    let d: Node<"float"> = at;
    d = select(density.lessThan(8.5), percent, d);
    d = select(density.lessThan(7.5), hashMark, d);
    d = select(density.lessThan(6.5), star, d);
    d = select(density.lessThan(5.5), plus, d);
    d = select(density.lessThan(4.5), equals, d);
    d = select(density.lessThan(3.5), dash, d);
    d = select(density.lessThan(2.5), colon, d);
    d = select(density.lessThan(1.5), period, d);
    return select(density.lessThan(0.5), space, d);
  };

  // The cell brightness, from 0 to 1, as a character density.
  const density = (c: Node<"vec4">) =>
    floor(
      pow(
        clamp(
          dot(c.rgb, vec3(0.299, 0.587, 0.114)).mul(c.a),
          0,
          1,
        ),
        0.75,
      ).mul(9.99),
    );

  // The average colour of a cell, from four samples.
  const cellColor = (
    center: Node<"vec2">,
    dims: Node<"vec2">,
    incoming: Node<"bool">,
  ) => {
    let sum: Node<"vec4"> = vec4(0);
    for (let i = 0; i < 4; i += 1) {
      const offset = vec2(
        (i % 2) - 0.5,
        Math.floor(i / 2) - 0.5,
      )
        .mul(0.5)
        .mul(dims);
      const st = clamp(
        center.add(offset).div(vec2(ratio, 1)).add(0.5),
        0,
        1,
      );
      sum = sum.add(select(incoming, sampleTo(st), sampleFrom(st)));
    }
    return sum.mul(0.25);
  };

  // Square-pixel space, divided into character cells.
  const fp = uv.sub(0.5).mul(vec2(ratio, 1));
  const dims = vec2(ASPECT * CELL_SIZE, CELL_SIZE);
  const cell = floor(fp.div(dims));
  const center = cell.add(0.5).mul(dims);
  const q = fp.sub(center).div(CELL_SIZE);
  // One pixel in cell units. With the finer grid the characters are only a
  // few pixels tall, so the reference's fixed 0.02 cell-width edge would be
  // sub-pixel and shimmer; widen it to about three quarters of a pixel.
  const edge = max(
    float(0.02),
    float(0.75).div(screenSize.y).div(CELL_SIZE),
  );

  // Each cell switches to the incoming image at its own time, scrambling
  // through random characters around it.
  const switchAt = hash12(cell.add(100)).mul(0.2).add(0.4);
  const incoming = progress.greaterThan(switchAt);
  const c = cellColor(center, dims, incoming);
  const cellDensity = density(c);
  const scramble = oneMinus(
    smoothstep(0.02, 0.045, abs(progress.sub(switchAt))),
  );
  const frame = floor(progress.mul(40));
  const scrambleHash = hash12(cell.add(frame.mul(vec2(17, 31))));
  const scrambledDensity = float(1).add(
    floor(
      hash12(cell.mul(1.7).add(frame.mul(vec2(5, 11)))).mul(9),
    ),
  );
  const g = select(
    scrambleHash.lessThan(scramble),
    scrambledDensity,
    cellDensity,
  );

  const cover = oneMinus(
    smoothstep(edge.mul(-1), edge, glyph(g, q)),
  );
  const tint = COLORED
    ? mix(
        c.rgb,
        c.rgb.div(max(max(max(c.r, c.g), c.b), 0.05)),
        0.7,
      )
    : INK;
  // Colored characters glow faintly over their cell, so the picture stays
  // readable; the background shows through where a cell is empty.
  const behind = COLORED ? mix(BACKGROUND, c.rgb, 0.3) : BACKGROUND;
  const textRgb = mix(behind, clamp(tint, 0, 1), cover);

  // Each cell dissolves into its character at its own time, from 0.05 to
  // 0.35, and back into the incoming image from 0.65 to 0.95.
  const into = hash12(cell.add(200)).mul(0.22).add(0.05);
  const outof = hash12(cell.add(300)).mul(-0.22).add(0.95);
  const show = smoothstep(into, into.add(0.08), progress).mul(
    oneMinus(smoothstep(outof.sub(0.08), outof, progress)),
  );
  const image = select(
    progress.lessThan(0.5),
    sampleFrom(uv),
    sampleTo(uv),
  );

  return finish(vec4(mix(image.rgb, textRgb, show), 1));
}

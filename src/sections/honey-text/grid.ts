import {
  abs,
  dot,
  float,
  fract,
  fwidth,
  max,
  mod,
  select,
  sin,
  smoothstep,
  time,
  vec2,
} from "three/tsl";
import type { Node } from "three/webgpu";

/**
 * An animated honeycomb grid. Each hex carries a thin border and a faint fill,
 * and its brightness pulses on its own phase, so the floor shimmers cell by
 * cell instead of moving as one sheet. The edge uses the derivative of the hex
 * distance for anti-aliasing in perspective.
 */
export function hexGrid(
  position: Node<"vec2">,
  cellSize: Node<"float">,
  opacity: Node<"float">,
) {
  // Classic hexagonal tiling: pick whichever of the two interleaved lattices
  // the fragment is nearest to.
  const q = position.div(cellSize);
  const lattice = vec2(1, 1.7320508);
  const half = lattice.mul(0.5);
  const a = mod(q, lattice).sub(half);
  const b = mod(q.sub(half), lattice).sub(half);
  const gv = select(dot(a, a).lessThan(dot(b, b)), a, b);

  // Distance to the hex border: 0 at the center, 0.5 on the edge.
  const across = abs(gv);
  const distance = max(
    across.x,
    across.x.mul(0.5).add(across.y.mul(0.8660254)),
  );
  const aa = fwidth(distance).mul(1.5);
  const width = float(0.055);
  const inner = float(0.5).sub(width);

  const border = smoothstep(inner.sub(aa), inner.add(aa), distance);
  const fill = float(1)
    .sub(smoothstep(inner, float(0.5), distance))
    .mul(0.06);

  // Each cell has its own pulse phase, so the shimmer crawls across the floor.
  const cellId = q.sub(gv);
  const phase = fract(sin(dot(cellId, vec2(127.1, 311.7))).mul(43758.5453));
  const pulse = float(0.55).add(
    sin(time.mul(1.2).add(phase.mul(6.2831853))).mul(0.45),
  );

  return border.add(fill).mul(pulse).mul(opacity);
}

import type { Node } from "three/webgpu";
import {
  abs,
  dot,
  fract,
  max,
  mix,
  mod,
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
 * Honeycomb reveal: the screen is split into hexagonal cells, each flipping
 * to the incoming frame on its own staggered slice of the progress. The
 * honeycomb borders glint while their cell changes over, so the handoff
 * reads as a grid of hexagons rather than a plain dissolve.
 */
export function buildHexGrid({
  from,
  to,
  progress,
  finish,
}: TransitionContext) {
  const CELLS = 24;
  const lattice = vec2(1, 1.7320508);
  const half = lattice.mul(0.5);

  const uv = vec2(screenUV.x, oneMinus(screenUV.y));
  const sampleFrom = (q: Node<"vec2">) => from.sample(vec2(q.x, oneMinus(q.y))).rgb;
  const sampleTo = (q: Node<"vec2">) => to.sample(vec2(q.x, oneMinus(q.y))).rgb;

  // Square screen units: x is scaled by the viewport aspect, so one unit is
  // the same number of pixels in both directions.
  const aspect = screenSize.x.div(screenSize.y);
  const p = vec2(uv.x.mul(aspect), uv.y).mul(CELLS);

  // Two interleaved lattices; each pixel belongs to the nearest hexagon.
  // The lattice units are not square, so the offsets are compared in the
  // (already aspect-corrected) p space: this is what keeps the cells regular
  // hexagons instead of stretching them vertically by sqrt(3).
  const q = p.div(lattice);
  const a = mod(q, lattice).sub(half);
  const b = mod(q.sub(half), lattice).sub(half);
  const aP = vec2(a.x, a.y.mul(lattice.y));
  const bP = vec2(b.x, b.y.mul(lattice.y));
  const useA = dot(aP, aP).lessThan(dot(bP, bP));
  const gv = select(useA, aP, bP);
  const id = p.sub(gv);

  // Per-cell random start, so the reveal ripples across the honeycomb.
  const rand = fract(sin(dot(id, vec2(127.1, 311.7))).mul(43758.5453));
  const start = rand.mul(0.4);
  const local = smoothstep(start, start.add(0.6), progress);

  const rgb = mix(sampleFrom(uv), sampleTo(uv), local);

  // Distance to the hex border in p space (0 at the centre, 0.5 on the edge).
  const across = abs(gv);
  const edgeDistance = max(
    across.x,
    across.x.mul(0.5).add(across.y.mul(0.8660254)),
  );
  const edge = smoothstep(0.465, 0.5, edgeDistance);
  const glint = sin(local.mul(Math.PI)).mul(edge).mul(0.4);

  return finish(vec4(rgb.add(vec3(glint)), 1));
}

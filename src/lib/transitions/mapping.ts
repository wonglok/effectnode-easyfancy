/**
 * Which transition shader owns which adjacent chapter pair. This module is the
 * single source of truth for the mapping and deliberately imports no Three.js:
 * easy-fancy's scene scanner imports it directly (by file path) to label the
 * timeline with the same names the site uses.
 *
 * Order is selection priority. An empty `pairs` means the shader is available
 * but not selected by index; the default is chosen by `DEFAULT_TRANSITION_ID`.
 */

export type TransitionPair = readonly [number, number];

export type TransitionMapping = {
  id: string;
  label: string;
  /** Index pairs (both directions) this shader owns. */
  pairs: readonly TransitionPair[];
};

/** The handoff used for any pair not claimed below. */
export const DEFAULT_TRANSITION_ID = "liquid";

export const TRANSITION_MAPPING: readonly TransitionMapping[] = [
  {
    id: "ball-roll",
    label: "ball roll",
    pairs: [
      [0, 1],
      [1, 0],
    ],
  },
  {
    id: "photo-drop",
    label: "photo drop",
    pairs: [
      [1, 2],
      [2, 1],
    ],
  },
  {
    id: "ascii",
    label: "ascii",
    pairs: [
      [2, 3],
      [3, 2],
    ],
  },
  {
    id: "page-curl",
    label: "page curl",
    pairs: [
      [6, 7],
      [7, 6],
    ],
  },
  {
    id: "cross-zoom",
    label: "cross zoom",
    pairs: [
      [3, 4],
      [4, 3],
    ],
  },
  {
    id: "directional-scale",
    label: "directional scale",
    pairs: [
      [4, 5],
      [5, 4],
    ],
  },
  // Available shaders with no pair of their own.
  { id: "melt", label: "melt", pairs: [] },
  { id: "hex-grid", label: "hex grid", pairs: [] },
  { id: "light-rays", label: "light rays", pairs: [] },
  { id: "liquid", label: "liquid", pairs: [] },
];

import { buildAscii } from "./ascii";
import { buildBallRoll } from "./ball-roll";
import { buildCrossZoom } from "./cross-zoom";
import { buildDirectionalScale } from "./directional-scale";
import { buildHexGrid } from "./hex-grid";
import { buildLightRays } from "./light-rays";
import { buildLiquid } from "./liquid";
import {
  DEFAULT_TRANSITION_ID,
  TRANSITION_MAPPING,
  type TransitionMapping,
} from "./mapping";
import { buildMelt } from "./melt";
import { buildPageCurl } from "./page-curl";
import { buildPhotoDrop } from "./photo-drop";
import type { TransitionBuilder } from "./types";

export type TransitionDefinition = TransitionMapping & {
  build: TransitionBuilder;
};

/** One builder per folder; the metadata lives in `mapping.ts`. */
const BUILDERS: Record<string, TransitionBuilder> = {
  "ball-roll": buildBallRoll,
  "photo-drop": buildPhotoDrop,
  ascii: buildAscii,
  "page-curl": buildPageCurl,
  "cross-zoom": buildCrossZoom,
  "directional-scale": buildDirectionalScale,
  melt: buildMelt,
  "hex-grid": buildHexGrid,
  "light-rays": buildLightRays,
  liquid: buildLiquid,
};

/** Every transition, in selection order. */
export const TRANSITIONS: readonly TransitionDefinition[] =
  TRANSITION_MAPPING.map((mapping) => {
    const build = BUILDERS[mapping.id];
    if (!build) {
      throw new Error(`No transition builder registered for "${mapping.id}"`);
    }
    return { ...mapping, build };
  });

/** Picks the shader for a handoff, falling back to the liquid wipe. */
export function selectTransition(
  fromIndex: number,
  toIndex: number,
): TransitionDefinition {
  const match = TRANSITIONS.find(({ pairs }) =>
    pairs.some(
      ([from, to]) =>
        (from === fromIndex && to === toIndex) ||
        (from === toIndex && to === fromIndex),
    ),
  );
  if (match) return match;

  const fallback = TRANSITIONS.find(({ id }) => id === DEFAULT_TRANSITION_ID);
  if (!fallback) {
    throw new Error(`No default transition "${DEFAULT_TRANSITION_ID}"`);
  }
  return fallback;
}

export type { TransitionContext, TransitionBuilder } from "./types";

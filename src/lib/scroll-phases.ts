/**
 * Every scene runs through three phases as the page scrolls:
 *
 *   enter    the previous chapter's exit blend brings the scene in
 *   animate  the scene is held fully visible (camera holds its hero pose)
 *   exit     the blend hands the viewport to the next scene
 *
 * Chapters are anchored at the start of their animate phase. Chapter i sits at
 * `i * CHAPTER_SPAN`, the hold lasts PHASE_HOLD, then the crossfade to the next
 * chapter lasts PHASE_BLEND (this scene's exit and the next scene's enter).
 * On the last chapter the exit blend is never reached.
 */
export const PHASE_HOLD = 0.5;
/**
 * The crossfade spans twice the scroll distance of a hold, so every handoff
 * gets a longer, more readable transition without shortening the hero hold.
 */
export const PHASE_BLEND = 1;
/** Distance between chapter anchors: hold + the crossfade that follows it. */
export const CHAPTER_SPAN = PHASE_HOLD + PHASE_BLEND;
/** Scroll distance from the first pixel of enter to the last pixel of exit. */
export const SCENE_SPAN = PHASE_BLEND * 2 + PHASE_HOLD;

/** Scroll position where a chapter's animate phase starts. */
export function getChapterAnchor(index: number) {
  return index * CHAPTER_SPAN;
}

export type SectionPhaseName = "enter" | "animate" | "exit";

export type SectionPhaseState = {
  phase: SectionPhaseName;
  /** Progress through the current phase, 0..1. */
  progress: number;
  /**
   * Progress through the scene's whole visible lifecycle, 0..1: 0 at the start
   * of enter, 1/3 when the animate hold begins, 2/3 when the exit begins and
   * 1 at the end of the exit blend.
   */
  sceneProgress: number;
  /** How much of this scene the composite should show, 0..1. */
  activity: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Phase of a scene at a continuous scroll position (0..(n-1)*CHAPTER_SPAN). */
export function getSectionPhaseAt(
  index: number,
  scrollProgress: number,
): SectionPhaseState {
  const relative = scrollProgress - getChapterAnchor(index);
  // Where the scene is in its full enter → animate → exit life.
  const sceneProgress = clamp01((relative + PHASE_BLEND) / SCENE_SPAN);

  // The previous chapter's exit blend is this scene's enter phase.
  if (relative < 0) {
    const progress = clamp01((relative + PHASE_BLEND) / PHASE_BLEND);
    return { phase: "enter", progress, sceneProgress, activity: progress };
  }

  // Held fully visible after arriving.
  if (relative <= PHASE_HOLD) {
    return {
      phase: "animate",
      progress: clamp01(relative / PHASE_HOLD),
      sceneProgress,
      activity: 1,
    };
  }

  // Blending out to the next chapter.
  const progress = clamp01((relative - PHASE_HOLD) / PHASE_BLEND);
  return { phase: "exit", progress, sceneProgress, activity: 1 - progress };
}

/**
 * Crossfade amount for the chapter interval that contains scrollProgress:
 * 0 while the scene holds, then 0..1 across the exit blend.
 */
export function getChapterBlend(scrollProgress: number) {
  const anchor = Math.floor(scrollProgress / CHAPTER_SPAN) * CHAPTER_SPAN;
  return clamp01((scrollProgress - anchor - PHASE_HOLD) / PHASE_BLEND);
}

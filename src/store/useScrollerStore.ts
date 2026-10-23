"use client";

import { create } from "zustand";
import { SECTION_COUNT, SECTIONS } from "@/sections/registry";
import { audioEngine } from "@/lib/audio-engine";
import {
  CHAPTER_SPAN,
  PHASE_HOLD,
  getChapterAnchor,
  getChapterBlend,
} from "@/lib/scroll-phases";

export type GpuStatus = "checking" | "ready" | "unsupported" | "error";

/** Splash screen timeline: preload scenes/audio, precompile shaders, ready. */
export type BootPhase = "loading" | "compiling" | "ready";

/** The full-screen element that owns scrolling instead of <html>. */
export const SCROLL_ROOT_ID = "scroll-root";

function resolveScrollRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(SCROLL_ROOT_ID);
}

type ScrollerState = {
  /**
   * Continuous scroll position in phase units. Chapter 1 starts at 0 and
   * chapters sit CHAPTER_SPAN apart.
   */
  scrollProgress: number;
  /** The section that owns the viewport. */
  activeIndex: number;
  /** The outgoing section while a scroll transition is in flight. */
  fromIndex: number;
  /** The incoming section while a scroll transition is in flight. */
  toIndex: number;
  /** 0..1 blend between fromIndex and toIndex. */
  transitionProgress: number;
  isTransitioning: boolean;
  gpuStatus: GpuStatus;
  bootPhase: BootPhase;
  /** 0..1 over asset downloads and scene registration. */
  preloadProgress: number;
  /** 0..1 over the shader compilation of every scene. */
  precompileProgress: number;
  soundFx: boolean;
  music: boolean;
  setScroll: (progress: number) => void;
  setGpuStatus: (status: GpuStatus) => void;
  setBootPhase: (phase: BootPhase) => void;
  setPreloadProgress: (progress: number) => void;
  setPrecompileProgress: (progress: number) => void;
  goTo: (index: number) => void;
  /** Play the handoff between chapter `index` and `index + 1` in full. */
  previewTransition: (index: number) => void;
  setSoundFx: (enabled: boolean) => void;
  setMusic: (enabled: boolean) => void;
};

/**
 * Scroll bound is derived lazily: SECTION_COUNT comes from the section
 * registry, which imports scene modules that import this store. The last
 * chapter has no exit blend, but its animate hold is still scrubbable.
 */
const maxScrollProgress = () =>
  getChapterAnchor(SECTION_COUNT - 1) + PHASE_HOLD;

const clampProgress = (value: number) =>
  Math.min(maxScrollProgress(), Math.max(0, value));

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Section hashes are the chapter numbers, e.g. `#scene-01`. */
const hashForIndex = (index: number) => {
  const section = SECTIONS[index];
  return section ? `#scene-${section.chapter}` : "";
};

/** Resolves a `#scene-NN` hash to a section index, or -1. */
function indexForHash(hash: string) {
  const match = /^#scene-(\d+)$/.exec(hash);
  if (!match) return -1;
  return SECTIONS.findIndex((section) => section.chapter === match[1]);
}

/**
 * Hash syncing waits for the boot restore. Otherwise the first scroll publish
 * would write `#scene-01` before the hash the visitor arrived with is read.
 */
let hashSyncEnabled = false;

/** Mirrors the active chapter into the URL without adding history entries. */
function syncHash(index: number) {
  if (!hashSyncEnabled || typeof window === "undefined") return;
  const next = hashForIndex(index);
  if (!next || window.location.hash === next) return;
  window.history.replaceState(window.history.state, "", next);
}

/**
 * Called once the splash has finished loading every scene: restores the
 * chapter named by the URL hash, then keeps the hash in step from then on.
 */
export function restoreScrollFromHash() {
  if (typeof window === "undefined" || hashSyncEnabled) return;
  hashSyncEnabled = true;

  const index = indexForHash(window.location.hash);
  if (index < 0) {
    syncHash(useScrollerStore.getState().activeIndex);
    return;
  }

  if (engine.pixelsPerSection <= 1) {
    engine.pixelsPerSection = measureSectionPixels();
  }
  const progress = getChapterAnchor(index);
  engine.scrollPixel = clampScrollPixel(progress * engine.pixelsPerSection);
  engine.scrollTargetPixel = engine.scrollPixel;
  engine.scrollVelocity = 0;
  engine.scrollMotion = "idle";
  publishScroll();
}

/**
 * Preload splits between network assets (the scene GLB/HDR files) and
 * registering the scenes. Kept outside the store so the reporters can be called
 * from loaders without re-rendering anything.
 */
const ASSET_WEIGHT = 0.55;
let assetProgress = 0;
let worldProgress = 0;

function publishPreload() {
  useScrollerStore
    .getState()
    .setPreloadProgress(
      assetProgress * ASSET_WEIGHT + worldProgress * (1 - ASSET_WEIGHT),
    );
}

/** Reports byte progress of the chapter assets. */
export function reportAssetProgress(progress: number) {
  assetProgress = clamp01(progress);
  publishPreload();
}

/** Reports how many of the scene worlds are mounted. */
export function reportWorldProgress(progress: number) {
  worldProgress = clamp01(progress);
  publishPreload();
}

/**
 * Virtual scroll position in pixels: SECTION_SCROLL_HEIGHTS viewport heights
 * equal one phase unit, so a chapter's hold and its longer crossfade each get
 * their own span of wheel travel. Wheel and touch input feed the scroll
 * velocity; a rAF loop integrates it with the frame delta and adds it to the
 * scroll pixel. A finger or wheel flick leaves momentum behind, which friction
 * decays to a stop.
 */
type ScrollMotion = "idle" | "spring" | "coast" | "preview";

type ScrollEngine = {
  scrollPixel: number;
  scrollTargetPixel: number;
  scrollVelocity: number;
  pixelsPerSection: number;
  scrollFrame: number;
  scrollFrameTime: number;
  scrollMotion: ScrollMotion;
  scrollRoot: HTMLElement | null;
  previewStartPixel: number;
  previewEndPixel: number;
  previewStartTime: number;
  /** Spring tuning, mirrored onto the singleton so Fast Refresh applies it. */
  scrollStiffness: number;
  scrollDamping: number;
};

const createScrollEngine = (): ScrollEngine => ({
  scrollPixel: 0,
  scrollTargetPixel: 0,
  scrollVelocity: 0,
  pixelsPerSection: 1,
  scrollFrame: 0,
  scrollFrameTime: 0,
  scrollMotion: "idle",
  scrollRoot: null,
  previewStartPixel: 0,
  previewEndPixel: 0,
  previewStartTime: 0,
  scrollStiffness: 30,
  scrollDamping: 11,
});

/**
 * The engine state is a browser-global singleton. Without it, editing any file
 * makes Fast Refresh re-evaluate this module while the old scroll listeners are
 * still attached, leaving two copies of the position (and a second store):
 * the page then scrolls the stale copy and only a reload recovers.
 */
const engine: ScrollEngine =
  typeof window === "undefined"
    ? createScrollEngine()
    : ((
        window as unknown as { __scrollerEngine?: ScrollEngine }
      ).__scrollerEngine ??= createScrollEngine());

/**
 * Critically damped spring used when a chapter is targeted. Halving the
 * natural frequency (sqrt(stiffness)) doubles the settle time, so navigation
 * glides at half the original speed: ~0.8s settle.
 */
const SCROLL_STIFFNESS = 30;
const SCROLL_DAMPING = 11;

// Mirror the tuning onto the browser-global engine on every module evaluation,
// so Fast Refresh applies new spring values without needing a full reload.
engine.scrollStiffness = SCROLL_STIFFNESS;
engine.scrollDamping = SCROLL_DAMPING;
/** Exponential friction (1/s) that bleeds off flick momentum. */
const SCROLL_FRICTION = 4;
/** Wheel pixels → impulse in px/s; one tick glides about as far as before. */
const WHEEL_INERTIA = 4;
/** Speed cap so a violent flick cannot skip past several chapters. */
const MAX_SCROLL_VELOCITY = 3200;
/** Below this speed the coast is considered finished. */
const COAST_REST_SPEED = 8;
/** A pause longer than this during a drag drops the release momentum. */
const TOUCH_IDLE_MS = 120;
/** Viewport heights of virtual scroll per phase unit. */
const SECTION_SCROLL_HEIGHTS = 2;
/** A transition preview rests on its first frame, then sweeps the blend. */
const PREVIEW_LEAD_MS = 240;
const PREVIEW_DURATION_MS = 2200;

function measureSectionPixels() {
  const height =
    engine.scrollRoot?.clientHeight ||
    (typeof window !== "undefined" ? window.innerHeight : 0);
  return Math.max(height, 1) * SECTION_SCROLL_HEIGHTS;
}

const clampScrollPixel = (value: number) =>
  Math.min(maxScrollProgress() * engine.pixelsPerSection, Math.max(0, value));

/** Keeps flick momentum inside the speed cap. */
const clampVelocity = (value: number) =>
  Math.min(MAX_SCROLL_VELOCITY, Math.max(-MAX_SCROLL_VELOCITY, value));

function publishScroll() {
  useScrollerStore
    .getState()
    .setScroll(engine.scrollPixel / engine.pixelsPerSection);
}

/** Adds velocity * delta to the scroll pixel, stopping at the chapter bounds. */
function integrateVelocity(dt: number) {
  const next = clampScrollPixel(
    engine.scrollPixel + engine.scrollVelocity * dt,
  );
  // Hitting a bound kills the momentum instead of grinding against it.
  if (next === engine.scrollPixel) engine.scrollVelocity = 0;
  engine.scrollPixel = next;
}

/**
 * The scroll loop runs for the lifetime of the page. In "coast" it decays the
 * flick velocity with friction; in "spring" it eases toward a chapter target.
 */
function scrollLoop(now: number) {
  engine.scrollFrame = window.requestAnimationFrame(scrollLoop);
  // Clamp dt so a long frame (tab switch, GC pause) cannot launch the spring.
  const dt = Math.min(
    Math.max((now - engine.scrollFrameTime) / 1000, 0.001),
    0.05,
  );
  engine.scrollFrameTime = now;

  if (engine.scrollMotion === "preview") {
    // Hold on the begin frame for a beat, then ease across the whole blend.
    const progress = Math.min(
      1,
      Math.max(
        0,
        (now - engine.previewStartTime - PREVIEW_LEAD_MS) / PREVIEW_DURATION_MS,
      ),
    );
    const eased =
      progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

    engine.scrollPixel =
      engine.previewStartPixel +
      (engine.previewEndPixel - engine.previewStartPixel) * eased;
    engine.scrollTargetPixel = engine.scrollPixel;
    engine.scrollVelocity = 0;
    if (progress >= 1) engine.scrollMotion = "idle";
    publishScroll();
    return;
  }

  if (engine.scrollMotion === "coast") {
    engine.scrollVelocity *= Math.exp(-SCROLL_FRICTION * dt);
    integrateVelocity(dt);
    engine.scrollTargetPixel = engine.scrollPixel;

    if (Math.abs(engine.scrollVelocity) < COAST_REST_SPEED) {
      // Publish the resting position once, then let the loop idle.
      engine.scrollVelocity = 0;
      engine.scrollMotion = "idle";
      publishScroll();
      return;
    }

    publishScroll();
    return;
  }

  if (engine.scrollMotion !== "spring") return;

  const displacement = engine.scrollTargetPixel - engine.scrollPixel;
  engine.scrollVelocity +=
    (displacement * engine.scrollStiffness -
      engine.scrollVelocity * engine.scrollDamping) *
    dt;
  integrateVelocity(dt);

  const restDistance = 0.0004 * engine.pixelsPerSection;
  const restSpeed = 0.002 * engine.pixelsPerSection;
  if (
    Math.abs(engine.scrollTargetPixel - engine.scrollPixel) < restDistance &&
    Math.abs(engine.scrollVelocity) < restSpeed
  ) {
    engine.scrollPixel = engine.scrollTargetPixel;
    engine.scrollVelocity = 0;
    engine.scrollMotion = "idle";
    publishScroll();
    return;
  }

  publishScroll();
}

function startScrollLoop() {
  if (engine.scrollFrame || typeof window === "undefined") return;
  engine.scrollFrameTime = window.performance.now();
  engine.scrollFrame = window.requestAnimationFrame(scrollLoop);
}

/** Eases the virtual position to a chapter; used by the navigation. */
export function scrollVirtualTo(progress: number) {
  if (typeof window === "undefined") return;
  if (engine.pixelsPerSection <= 1) {
    engine.pixelsPerSection = measureSectionPixels();
  }

  engine.scrollTargetPixel = clampProgress(progress) * engine.pixelsPerSection;
  // A navigation intent replaces any momentum in flight.
  engine.scrollVelocity = 0;
  engine.scrollMotion = "spring";
  startScrollLoop();
}

/**
 * Plays a whole chapter handoff: snap to the first frame, hold briefly, then
 * carry the scroll position from the start of the blend to the next chapter.
 * Wheel or touch input cancels it by switching the motion mode.
 */
function playTransitionPreview(fromIndex: number) {
  if (typeof window === "undefined") return;
  if (
    !Number.isInteger(fromIndex) ||
    fromIndex < 0 ||
    fromIndex >= SECTION_COUNT - 1
  ) {
    return;
  }
  if (engine.pixelsPerSection <= 1) {
    engine.pixelsPerSection = measureSectionPixels();
  }

  const start = getChapterAnchor(fromIndex) + PHASE_HOLD;
  const end = getChapterAnchor(fromIndex + 1);

  engine.scrollPixel = clampScrollPixel(start * engine.pixelsPerSection);
  engine.scrollTargetPixel = engine.scrollPixel;
  engine.scrollVelocity = 0;
  engine.previewStartPixel = engine.scrollPixel;
  engine.previewEndPixel = clampScrollPixel(end * engine.pixelsPerSection);
  engine.previewStartTime = window.performance.now();
  engine.scrollMotion = "preview";
  publishScroll();
  startScrollLoop();
}

/**
 * The store is also a browser-global singleton so Fast Refresh reuses the same
 * instance instead of handing already-mounted consumers a new, empty one.
 */
function createScrollerStore() {
  return create<ScrollerState>((set) => ({
    scrollProgress: 0,
    activeIndex: 0,
    fromIndex: 0,
    toIndex: 0,
    transitionProgress: 0,
    isTransitioning: false,
    gpuStatus: "checking",
    bootPhase: "loading",
    preloadProgress: 0,
    precompileProgress: 0,
    soundFx: true,
    music: false,

    setScroll: (rawProgress) => {
      const scrollProgress = clampProgress(rawProgress);
      // Which chapter anchor the scroll position belongs to.
      const lower = Math.min(
        Math.floor(scrollProgress / CHAPTER_SPAN),
        SECTION_COUNT - 1,
      );
      const toIndex = Math.min(lower + 1, SECTION_COUNT - 1);
      // Each chapter holds its scene for a while, then crossfades to the next.
      const blend = getChapterBlend(scrollProgress);
      const isTransitioning = blend > 0.002 && blend < 0.998;
      const activeIndex = blend < 0.5 ? lower : toIndex;

      if (!isTransitioning) {
        set({
          scrollProgress,
          activeIndex,
          fromIndex: activeIndex,
          toIndex: activeIndex,
          transitionProgress: 0,
          isTransitioning: false,
        });
        syncHash(activeIndex);
        return;
      }

      set({
        scrollProgress,
        activeIndex,
        fromIndex: lower,
        toIndex,
        transitionProgress: blend,
        isTransitioning: true,
      });
      syncHash(activeIndex);
    },

    setGpuStatus: (gpuStatus) => set({ gpuStatus }),

    setBootPhase: (bootPhase) => set({ bootPhase }),

    setPreloadProgress: (preloadProgress) =>
      set({ preloadProgress: clamp01(preloadProgress) }),

    setPrecompileProgress: (precompileProgress) =>
      set({ precompileProgress: clamp01(precompileProgress) }),

    goTo: (index) => {
      audioEngine.playUiClick();
      scrollVirtualTo(getChapterAnchor(index));
    },

    previewTransition: (index) => {
      audioEngine.playUiClick();
      playTransitionPreview(index);
    },

    setSoundFx: (soundFx) => {
      set({ soundFx });
      void audioEngine.setSoundFx(soundFx);
    },

    setMusic: (music) => {
      set({ music });
      audioEngine.setMusic(music);
    },
  }));
}

type ScrollerStore = ReturnType<typeof createScrollerStore>;

export const useScrollerStore: ScrollerStore =
  typeof window === "undefined"
    ? createScrollerStore()
    : ((
        window as unknown as { __scrollerStore?: ScrollerStore }
      ).__scrollerStore ??= createScrollerStore());

/** Wheel pixels per viewport height; smaller means faster chapter travel. */
const WHEEL_GAIN = 0.35;
const WHEEL_LINE_HEIGHT = 16;

/**
 * Virtual scrolling. Wheel deltas and touch drags advance a target position in
 * scroll pixels (SECTION_SCROLL_HEIGHTS viewport heights per phase unit); the
 * rAF loop eases the current pixel toward it. Native scrolling stays disabled
 * so the gesture drives the scenes directly.
 */
export function trackPageScroll() {
  const root = resolveScrollRoot();
  if (!root) return () => {};

  engine.scrollRoot = root;
  engine.pixelsPerSection = measureSectionPixels();

  // Resume from whatever chapter the store already shows (StrictMode remounts
  // and fast refresh re-run this effect). The engine singleton means the live
  // position survives a module swap.
  const progress = clampProgress(useScrollerStore.getState().scrollProgress);
  engine.scrollPixel = progress * engine.pixelsPerSection;
  engine.scrollTargetPixel = engine.scrollPixel;
  engine.scrollVelocity = 0;
  engine.scrollMotion = "idle";

  /** Keeps a chapter a viewport tall when the stage is resized. */
  const onResize = () => {
    const next = measureSectionPixels();
    if (next === engine.pixelsPerSection) return;

    // Keep the current chapter and any in-flight target across the resize by
    // re-expressing them in the new pixels-per-section scale.
    const currentProgress = engine.scrollPixel / engine.pixelsPerSection;
    const targetProgress = engine.scrollTargetPixel / engine.pixelsPerSection;
    const previewStartProgress =
      engine.previewStartPixel / engine.pixelsPerSection;
    const previewEndProgress = engine.previewEndPixel / engine.pixelsPerSection;
    engine.pixelsPerSection = next;
    engine.scrollPixel = clampScrollPixel(currentProgress * next);
    engine.scrollTargetPixel = clampScrollPixel(targetProgress * next);
    engine.previewStartPixel = clampScrollPixel(previewStartProgress * next);
    engine.previewEndPixel = clampScrollPixel(previewEndProgress * next);
  };

  const onWheel = (event: WheelEvent) => {
    // Let pinch-zoom through untouched.
    if (event.ctrlKey) return;
    event.preventDefault();

    const pixels =
      event.deltaY *
      (event.deltaMode === 1
        ? WHEEL_LINE_HEIGHT
        : event.deltaMode === 2
          ? root.clientHeight
          : 1);

    // Each wheel tick is an impulse, so the page keeps gliding after the
    // wheel stops and friction brings it to rest.
    engine.scrollVelocity = clampVelocity(
      engine.scrollVelocity + (pixels / WHEEL_GAIN) * WHEEL_INERTIA,
    );
    engine.scrollMotion = "coast";
  };

  let touchY: number | null = null;
  let touchTime = 0;
  /** Smoothed finger speed in px/s, used as the release momentum. */
  let touchVelocity = 0;

  const onTouchStart = (event: TouchEvent) => {
    touchY = event.touches.length === 1 ? event.touches[0].clientY : null;
    touchTime = performance.now();
    touchVelocity = 0;
    // A new touch grabs the scroll immediately, cancelling any glide.
    engine.scrollVelocity = 0;
    engine.scrollMotion = "idle";
  };

  const onTouchMove = (event: TouchEvent) => {
    if (touchY === null || event.touches.length !== 1) return;
    event.preventDefault();

    const now = performance.now();
    const y = event.touches[0].clientY;
    const delta = touchY - y;
    const dt = Math.max(now - touchTime, 1) / 1000;

    const previous = engine.scrollPixel;
    const next = clampScrollPixel(previous + delta);
    // Track the finger 1:1 instead of lagging behind a spring.
    engine.scrollPixel = next;
    engine.scrollTargetPixel = next;
    touchY = y;

    if (next === previous && delta !== 0) {
      // At a chapter bound there is nothing to carry into the release.
      touchVelocity = 0;
    } else {
      // Blend the latest sample so one jittery event cannot define the flick.
      touchVelocity = touchVelocity * 0.5 + (delta / dt) * 0.3;
    }
    touchTime = now;
    engine.scrollVelocity = 0;
    engine.scrollMotion = "idle";
    publishScroll();
  };

  const onTouchEnd = () => {
    if (touchY === null) return;
    const paused = performance.now() - touchTime > TOUCH_IDLE_MS;
    touchY = null;

    if (!paused && Math.abs(touchVelocity) > COAST_REST_SPEED) {
      engine.scrollVelocity = clampVelocity(touchVelocity);
      engine.scrollMotion = "coast";
    }
    touchVelocity = 0;
  };

  const onTouchCancel = () => {
    touchY = null;
    touchVelocity = 0;
    engine.scrollVelocity = 0;
    engine.scrollMotion = "idle";
  };

  // Manual hash edits and anchor links navigate to the matching chapter.
  // Our own hash sync uses replaceState, which does not fire this event.
  const onHashChange = () => {
    const index = indexForHash(window.location.hash);
    if (index < 0) return;
    if (index === useScrollerStore.getState().activeIndex) return;
    scrollVirtualTo(getChapterAnchor(index));
  };

  startScrollLoop();

  root.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("hashchange", onHashChange);
  root.addEventListener("touchstart", onTouchStart, { passive: true });
  root.addEventListener("touchmove", onTouchMove, { passive: false });
  root.addEventListener("touchend", onTouchEnd, { passive: true });
  root.addEventListener("touchcancel", onTouchCancel, { passive: true });

  return () => {
    if (engine.scrollFrame) window.cancelAnimationFrame(engine.scrollFrame);
    engine.scrollFrame = 0;
    if (engine.scrollRoot === root) engine.scrollRoot = null;
    root.removeEventListener("wheel", onWheel);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("hashchange", onHashChange);
    root.removeEventListener("touchstart", onTouchStart);
    root.removeEventListener("touchmove", onTouchMove);
    root.removeEventListener("touchend", onTouchEnd);
    root.removeEventListener("touchcancel", onTouchCancel);
  };
}

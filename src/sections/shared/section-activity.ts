"use client";

import { useScrollerStore } from "@/store/useScrollerStore";
import {
  getSectionPhaseAt,
  type SectionPhaseState,
} from "@/lib/scroll-phases";

export type {
  SectionPhaseName,
  SectionPhaseState,
} from "@/lib/scroll-phases";

export type PointerState = { x: number; y: number };

const pointerTarget: PointerState = { x: 0, y: 0 };
const pointerCurrent: PointerState = { x: 0, y: 0 };
let lastSampleTime = -1;
let attached = false;
let reducedMotion = false;
let mediaQuery: MediaQueryList | null = null;

/** Degrees of tilt that sweep the whole ±1 range of the parallax signal. */
const TILT_RANGE = 22;
/** Tilt ignored around the calibrated pose, so holding the phone still is calm. */
const TILT_DEADZONE = 1.5;

let orientationActive = false;
let orientationListening = false;
let orientationRequested = false;
let orientationBaseline: PointerState | null = null;
let orientationScreen: ScreenOrientation | null = null;

function onPointerMove(event: PointerEvent) {
  // On touch devices the pointer is the scroll gesture; let the tilt drive
  // the camera instead so a swipe does not fight the orientation signal.
  if (orientationActive) return;
  pointerTarget.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointerTarget.y = -((event.clientY / window.innerHeight) * 2 - 1);
}

function normalizeTilt(degrees: number) {
  const magnitude = Math.abs(degrees);
  if (magnitude <= TILT_DEADZONE) return 0;
  return (
    Math.sign(degrees) *
    Math.min(1, (magnitude - TILT_DEADZONE) / (TILT_RANGE - TILT_DEADZONE))
  );
}

function onDeviceOrientation(event: DeviceOrientationEvent) {
  if (event.beta === null || event.gamma === null) return;

  // Rotate the device tilt into screen space so landscape holds respond on
  // the same axes as portrait ones.
  const angle = ((screen.orientation?.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const tilt = {
    x: event.gamma * cos + event.beta * sin,
    y: -event.gamma * sin + event.beta * cos,
  };

  // The first reading becomes neutral: however the phone is held when the
  // page opens, that pose looks straight ahead.
  if (!orientationBaseline) {
    orientationBaseline = tilt;
    orientationActive = true;
    return;
  }

  let deltaX = tilt.x - orientationBaseline.x;
  let deltaY = tilt.y - orientationBaseline.y;
  if (deltaX > 180) deltaX -= 360;
  else if (deltaX < -180) deltaX += 360;
  if (deltaY > 180) deltaY -= 360;
  else if (deltaY < -180) deltaY += 360;

  pointerTarget.x = normalizeTilt(deltaX);
  // Tilting the top of the phone away reads as looking up, matching where
  // the pointer would go on desktop.
  pointerTarget.y = normalizeTilt(-deltaY);
  orientationActive = true;
}

function resetOrientationBaseline() {
  // Recalibrate after the screen rotates or the tab comes back, so the pose
  // the user picks up becomes the new neutral.
  orientationBaseline = null;
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") resetOrientationBaseline();
}

type DeviceOrientationWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
};

function startOrientation() {
  if (orientationListening) return;

  const orientationEvent = window.DeviceOrientationEvent as
    | DeviceOrientationWithPermission
    | undefined;
  if (!orientationEvent) return;

  const begin = () => {
    orientationListening = true;
    orientationBaseline = null;
    window.addEventListener("deviceorientation", onDeviceOrientation, {
      passive: true,
    });
    window.addEventListener("visibilitychange", onVisibilityChange);
    orientationScreen = window.screen.orientation ?? null;
    orientationScreen?.addEventListener("change", resetOrientationBaseline);
  };

  // iOS exposes the sensor only after an explicit user gesture.
  if (typeof orientationEvent.requestPermission === "function") {
    orientationEvent
      .requestPermission()
      .then((state) => {
        if (state === "granted") begin();
      })
      .catch(() => {
        // Denied or unavailable: the pointer signal stays as the fallback.
      });
    return;
  }

  begin();
}

function onFirstGesture() {
  if (orientationRequested) return;
  orientationRequested = true;
  startOrientation();
}

function onMotionPreferenceChange(event: MediaQueryListEvent) {
  reducedMotion = event.matches;
}

/**
 * Single global pointer signal. Every camera samples the same smoothed value,
 * so sections do not install one pointer listener each.
 *
 * On touch-first devices there is no hover, so device orientation feeds the
 * same signal instead: tilting the phone moves the cameras the way a mouse
 * would. iOS requires the sensor request to happen inside a user gesture, so
 * the listener starts on the first tap and falls back to touch input if the
 * permission is denied.
 */
export function attachPointerSignal() {
  if (attached || typeof window === "undefined") return () => {};

  attached = true;
  mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  reducedMotion = mediaQuery.matches;
  pointerTarget.x = 0;
  pointerTarget.y = 0;
  pointerCurrent.x = 0;
  pointerCurrent.y = 0;
  lastSampleTime = -1;

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  mediaQuery.addEventListener("change", onMotionPreferenceChange);

  if (window.matchMedia("(pointer: coarse)").matches) {
    window.addEventListener("pointerdown", onFirstGesture, { passive: true });
  }

  return () => {
    attached = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerdown", onFirstGesture);
    window.removeEventListener("deviceorientation", onDeviceOrientation);
    window.removeEventListener("visibilitychange", onVisibilityChange);
    orientationScreen?.removeEventListener("change", resetOrientationBaseline);
    orientationScreen = null;
    orientationListening = false;
    orientationRequested = false;
    orientationActive = false;
    orientationBaseline = null;
    mediaQuery?.removeEventListener("change", onMotionPreferenceChange);
    mediaQuery = null;
  };
}

export function samplePointer(elapsed: number, delta: number): PointerState {
  if (elapsed !== lastSampleTime) {
    lastSampleTime = elapsed;
    const easing = 1 - Math.exp(-delta * 5.5);
    pointerCurrent.x += (pointerTarget.x - pointerCurrent.x) * easing;
    pointerCurrent.y += (pointerTarget.y - pointerCurrent.y) * easing;
  }
  return pointerCurrent;
}

export function getSceneTime(elapsed: number) {
  return reducedMotion ? elapsed * 0.18 : elapsed;
}

/**
 * The current enter / animate / exit phase of a scene, with the progress
 * inside that phase. Use it to choreograph a scene: "enter" runs while the
 * previous chapter blends it in, "animate" while it holds the viewport, and
 * "exit" while it hands over to the next chapter.
 */
export function getSectionPhase(index: number): SectionPhaseState {
  return getSectionPhaseAt(index, useScrollerStore.getState().scrollProgress);
}

/**
 * 1 = fully present, 0 = not rendered. During a scroll blend both neighbours
 * receive a value between 0 and 1, letting each scene and camera perform its
 * own entrance/exit motion before the TSL composite blends the render targets.
 */
export function getSectionActivity(index: number) {
  return getSectionPhase(index).activity;
}

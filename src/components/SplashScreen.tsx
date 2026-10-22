"use client";

import { useEffect, useRef, useState } from "react";
import { useScrollerStore } from "@/store/useScrollerStore";
import styles from "./SplashScreen.module.css";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Preload carries the first 60% of the bar, precompile the rest. */
const PRELOAD_WEIGHT = 0.6;
/** Keep the splash up at least this long so a fast boot does not flash. */
const MIN_VISIBLE_MS = 700;
/** Fade-out length; the component unmounts once it finishes. */
const FADE_MS = 900;

/**
 * Boot splash. It stays up while the scenes download and their shaders
 * precompile, showing both progresses, then fades away.
 */
export function SplashScreen() {
  const bootPhase = useScrollerStore((state) => state.bootPhase);
  const preloadProgress = useScrollerStore((state) => state.preloadProgress);
  const precompileProgress = useScrollerStore(
    (state) => state.precompileProgress,
  );
  const gpuStatus = useScrollerStore((state) => state.gpuStatus);

  const gpuUnavailable = gpuStatus === "unsupported" || gpuStatus === "error";
  const booted = bootPhase === "ready" || gpuUnavailable;

  const mountedAt = useRef(0);
  const [canDismiss, setCanDismiss] = useState(false);
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    mountedAt.current = window.performance.now();
  }, []);

  useEffect(() => {
    if (!booted) return;
    const remaining = Math.max(
      0,
      MIN_VISIBLE_MS - (window.performance.now() - mountedAt.current),
    );
    const timer = window.setTimeout(() => setCanDismiss(true), remaining);
    return () => window.clearTimeout(timer);
  }, [booted]);

  useEffect(() => {
    if (!canDismiss) return;
    const timer = window.setTimeout(() => setMounted(false), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [canDismiss]);

  if (!mounted) return null;

  const progress = clamp01(
    preloadProgress * PRELOAD_WEIGHT +
      precompileProgress * (1 - PRELOAD_WEIGHT),
  );
  const percent = Math.round(progress * 100);
  const status = gpuUnavailable
    ? "Starting fallback"
    : bootPhase === "compiling"
      ? "Compiling shaders"
      : bootPhase === "ready"
        ? "Ready to scroll"
        : "Loading scenes";

  return (
    <div className={styles.splash} data-done={canDismiss} role="status">
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span className={styles.mark} />
          <span>
            EFFECT<span className={styles.thin}>NODE</span>
          </span>
        </div>

        <div className={styles.status}>
          <span>{status}</span>
          <span className={styles.percent}>{percent}%</span>
        </div>

        <div
          className={styles.bar}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>

        <div className={styles.readouts}>
          <span>
            Assets <b>{Math.round(preloadProgress * 100)}%</b>
          </span>
          <span>
            Shaders <b>{Math.round(precompileProgress * 100)}%</b>
          </span>
        </div>
      </div>
    </div>
  );
}

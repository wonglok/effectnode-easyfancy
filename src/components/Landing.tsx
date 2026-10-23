"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { SECTION_COUNT, SECTIONS } from "@/sections/registry";
import {
  SCROLL_ROOT_ID,
  restoreScrollFromHash,
  trackPageScroll,
  useScrollerStore,
} from "@/store/useScrollerStore";
import { audioEngine } from "@/lib/audio-engine";
import { PHASE_HOLD, getChapterAnchor } from "@/lib/scroll-phases";
import { SceneStage } from "./SceneStage";
import { SplashScreen } from "./SplashScreen";
import styles from "./Landing.module.css";

// Progress line under the header; reads the store directly to avoid re-renders.
function ScrollLine() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // Matches the store's scroll bound, including the last chapter's hold.
    const maxProgress = getChapterAnchor(SECTION_COUNT - 1) + PHASE_HOLD;
    const apply = (progress: number) => {
      if (!ref.current) return;
      ref.current.style.transform = `scaleX(${Math.min(1, Math.max(0, progress / maxProgress))})`;
    };

    apply(useScrollerStore.getState().scrollProgress);
    return useScrollerStore.subscribe((state) => apply(state.scrollProgress));
  }, []);

  return (
    <div className={styles.scrollLine} aria-hidden="true">
      <span ref={ref} />
    </div>
  );
}

function Header() {
  const activeIndex = useScrollerStore((state) => state.activeIndex);
  const gpuStatus = useScrollerStore((state) => state.gpuStatus);
  const music = useScrollerStore((state) => state.music);
  const setMusic = useScrollerStore((state) => state.setMusic);
  const goTo = useScrollerStore((state) => state.goTo);
  const section = SECTIONS[activeIndex] ?? SECTIONS[0];

  return (
    <header className={styles.header}>
      <button
        className={styles.brand}
        onClick={() => goTo(0)}
        aria-label="EffectNode — back to the beginning"
      >
        <span className={styles.brandMark} />
        <span>
          EFFECT<span className={styles.brandThin}>NODE</span>
        </span>
      </button>

      <div className={styles.headerRight}>
        <button
          type="button"
          className={styles.soundToggle}
          data-on={music}
          onClick={() => setMusic(!music)}
          aria-label={
            music ? "Mute background music" : "Unmute background music"
          }
          aria-pressed={music}
          title={music ? "Mute music" : "Unmute music"}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              className={styles.speakerBody}
              d="M4 9.1h3.6L12.5 5v14l-4.9-4.1H4V9.1Z"
            />
            {music ? (
              <g className={styles.soundWaves}>
                <path d="M16.1 8.6a4.9 4.9 0 0 1 0 6.8" />
                <path d="M18.8 5.9a8.8 8.8 0 0 1 0 12.2" />
              </g>
            ) : (
              <g className={styles.soundMuted}>
                <path d="m16.2 9.2 5.1 5.6" />
                <path d="m21.3 9.2-5.1 5.6" />
              </g>
            )}
          </svg>
        </button>

        <span className={styles.gpuPill} data-live={gpuStatus === "ready"}>
          <i />
          {gpuStatus === "ready"
            ? "WEBGPU LIVE"
            : gpuStatus === "checking"
              ? "LINKING GPU"
              : "FALLBACK MODE"}
        </span>
        {/*  */}
        <a
          className={styles.talk}
          href="https://www.linkedin.com/in/wonglok831/"
          target="_blank"
          rel="noreferrer"
        >
          Connect with me
          <span aria-hidden="true">↗</span>
        </a>
      </div>

      <div
        className={styles.headerAccent}
        style={{ background: section.accent }}
        aria-hidden="true"
      />
    </header>
  );
}

// Scene switcher pinned to the middle right: one numbered circle per chapter.
function SceneHud() {
  const activeIndex = useScrollerStore((state) => state.activeIndex);
  const goTo = useScrollerStore((state) => state.goTo);

  return (
    <nav className={styles.hud} aria-label="Scene switcher">
      {SECTIONS.map((section) => {
        const active = activeIndex === section.index;
        return (
          <button
            key={section.id}
            type="button"
            className={styles.hudButton}
            data-active={active}
            style={{ "--accent": section.accent } as CSSProperties}
            onClick={() => goTo(section.index)}
            aria-label={`Go to scene ${section.index + 1}, ${section.name}`}
            aria-current={active ? "true" : undefined}
          >
            {`${(section.index + 1 + "").padStart(2, "0")}`}
          </button>
        );
      })}
    </nav>
  );
}

export function Landing() {
  useEffect(() => trackPageScroll(), []);

  // Once every scene is loaded, restore the chapter named by the URL hash
  // (e.g. `/#scene-03`) and keep the hash in step with the active chapter.
  useEffect(() => {
    const restore = () => {
      if (useScrollerStore.getState().bootPhase !== "ready") return;
      restoreScrollFromHash();
    };
    restore();
    return useScrollerStore.subscribe(restore);
  }, []);

  // easy-fancy embeds this page and posts a message when one of its timeline
  // clips is clicked. Scenes scrub through goTo; transitions play the whole
  // handoff so the shader's begin and end are both visible.
  useEffect(() => {
    const navigate = (event: MessageEvent) => {
      const data = event.data as {
        source?: unknown;
        type?: unknown;
        index?: unknown;
        from?: unknown;
      } | null;
      if (!data || data.source !== "easy-fancy") return;

      if (data.type === "scroll-to-scene") {
        const index = Number(data.index);
        if (!Number.isInteger(index) || index < 0 || index >= SECTION_COUNT) {
          return;
        }
        useScrollerStore.getState().goTo(index);
        return;
      }

      if (data.type === "play-transition") {
        const from = Number(data.from);
        if (!Number.isInteger(from) || from < 0 || from >= SECTION_COUNT - 1) {
          return;
        }
        useScrollerStore.getState().previewTransition(from);
      }
    };

    window.addEventListener("message", navigate);
    return () => window.removeEventListener("message", navigate);
  }, []);

  // Browsers only allow audio after a gesture; start it on the first input
  // instead of gating the whole experience behind a splash screen.
  useEffect(() => {
    const startAudio = () => {
      const { soundFx, music } = useScrollerStore.getState();
      void audioEngine
        .start({ soundFx, music })
        .catch((error) => console.warn("Audio unavailable:", error));
    };
    window.addEventListener("pointerdown", startAudio, { once: true });
    return () => window.removeEventListener("pointerdown", startAudio);
  }, []);

  return (
    <main className={styles.page} id="top">
      <div className={styles.scroller} id={SCROLL_ROOT_ID}>
        <div className={styles.underlay}>
          <SceneStage />
          <div className={styles.grain} aria-hidden="true" />
          <ScrollLine />
          <Header />
          <SceneHud />
        </div>
      </div>
      <SplashScreen />
    </main>
  );
}

import { Fragment, useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { useChat } from "../store/chat";
import { playTransitionInPreview, scrollPreviewToScene } from "../lib/preview";
import type {
  AssistantMessage,
  ChatMessage,
  SceneInfo,
  TransitionInfo,
} from "../types";

type Turn = {
  key: string;
  userId: string;
  prompt: string;
  assistant?: AssistantMessage;
};

/** One clip per user turn; the assistant reply rides along in the same clip. */
function buildTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      turns.push({
        key: message.id,
        userId: message.id,
        prompt: message.text,
      });
      continue;
    }

    const last = turns[turns.length - 1];
    if (last) {
      last.assistant = message;
    } else {
      turns.push({
        key: message.id,
        userId: message.id,
        prompt: "Session started",
        assistant: message,
      });
    }
  }

  return turns;
}

function turnWidth(turn: Turn): number {
  const duration = turn.assistant?.durationMs ?? 0;
  // Longer turns get longer clips, like trimming in a video editor.
  return Math.round(104 + Math.min(140, duration / 45));
}

function turnMeta(turn: Turn): string {
  const parts: string[] = [];
  const duration = turn.assistant?.durationMs;
  if (duration != null) parts.push(`${(duration / 1000).toFixed(1)}s`);
  const tools = turn.assistant?.tools.length ?? 0;
  if (tools > 0) parts.push(`${tools} tool${tools === 1 ? "" : "s"}`);
  return parts.join(" · ") || "queued";
}

function sceneWidth(scene: SceneInfo): number {
  return Math.min(210, Math.max(138, 120 + scene.name.length * 8));
}

const plainTitle = (title: string): string => title.replace(/\n/g, " ");

/** A recognisable mark per render-pipeline transition. */
const TRANSITION_GLYPH: Record<string, string> = {
  liquid: "≈",
  melt: "≋",
  "page-curl": "◜",
};

function transitionGlyph(kind?: string): string {
  return (kind && TRANSITION_GLYPH[kind]) || "⋈";
}

/**
 * Bottom strip for the chat panel. When the working directory exposes a
 * section registry, it shows that registry's scene list; otherwise it falls
 * back to one clip per conversation turn.
 */
export default function Timeline() {
  const messages = useChat((state) => state.messages);
  const running = useChat((state) => state.running);
  const scenes = useChat((state) => state.scenes);
  const scenesSource = useChat((state) => state.scenesSource);
  const pipelineTransitions = useChat((state) => state.transitions);
  const transitionsSource = useChat((state) => state.transitionsSource);
  const selectedScene = useChat((state) => state.selectedScene);
  const setSelectedScene = useChat((state) => state.setSelectedScene);
  const setDraft = useChat((state) => state.setDraft);
  const turns = buildTurns(messages);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const hasScenes = scenes.length > 0;
  const transitionCount = Math.max(
    0,
    (hasScenes ? scenes.length : turns.length) - 1,
  );

  /** The pipeline entry for the boundary in front of `index` (0-based). */
  const transitionBetween = (index: number): TransitionInfo | undefined => {
    const from = scenes[index - 1]?.index;
    const to = scenes[index]?.index;
    return pipelineTransitions.find(
      (entry) => entry.from === from && entry.to === to,
    );
  };

  /** Prefill the composer and put the caret at the end, ready to type. */
  const prefill = (text: string): void => {
    setDraft(text);
    requestAnimationFrame(() => {
      const input = document.getElementById(
        "composer-input",
      ) as HTMLTextAreaElement | null;
      if (!input) return;
      input.focus();
      input.setSelectionRange(text.length, text.length);
    });
  };

  const selectScene = (index: number): void => {
    setSelectedScene(index);
    // The preview is cross-origin; it listens for this and scrubs its own
    // virtual scroller to the chapter.
    scrollPreviewToScene(scenes[index]?.index ?? index);
    prefill(`for the scene ${index + 1}, please: `);
  };

  const selectTransition = (index: number): void => {
    // Boundary `index` sits between scenes `index` and `index + 1` (1-based),
    // so the shader handoff starts from the zero-based chapter `index - 1`.
    prefill(`for the transition ${index}, please: ...`);
    playTransitionInPreview(index - 1);
  };

  useEffect(() => {
    const track = trackRef.current;
    if (!track || hasScenes) return;
    track.scrollTo({ left: track.scrollWidth, behavior: "smooth" });
  }, [turns.length, hasScenes]);

  // Keep the active scene visible when the reel is wider than the panel.
  useEffect(() => {
    const track = trackRef.current;
    const clip = track?.querySelector<HTMLElement>(
      '[data-scene="true"][data-active="true"]',
    );
    if (!track || !clip) return;

    const left = clip.offsetLeft;
    const right = left + clip.offsetWidth;
    const padding = 10;
    if (left < track.scrollLeft + padding) {
      track.scrollTo({ left: Math.max(0, left - padding), behavior: "smooth" });
    } else if (right > track.scrollLeft + track.clientWidth - padding) {
      track.scrollTo({
        left: right - track.clientWidth + padding,
        behavior: "smooth",
      });
    }
  }, [selectedScene, scenes.length]);

  const jump = (userId: string): void => {
    document
      .getElementById(`msg-${userId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <section
      className={`timeline${hasScenes ? " isSceneList" : ""}`}
      aria-label={hasScenes ? "Scene list" : "Conversation timeline"}
    >
      <div className="timelineHead">
        <span className="timelineTitle">
          {hasScenes ? "Scene list" : "Timeline"}
        </span>
        <span className="timelineCount">
          {hasScenes
            ? `${scenes.length} scene${scenes.length === 1 ? "" : "s"} · ${transitionCount} transition${transitionCount === 1 ? "" : "s"}`
            : turns.length === 0
              ? "empty reel"
              : `${turns.length} scene${turns.length === 1 ? "" : "s"} · ${transitionCount} transition${transitionCount === 1 ? "" : "s"}`}
        </span>
        {hasScenes && scenesSource && (
          <span className="timelineSource" title={scenesSource}>
            registry
          </span>
        )}
        {hasScenes && transitionsSource && (
          <span className="timelineSource" title={transitionsSource}>
            pipeline
          </span>
        )}
        {!hasScenes && running && <span className="timelineLive">live</span>}
      </div>

      <div className="timelineTrack" ref={trackRef}>
        {hasScenes ? (
          scenes.map((scene, index) => {
            const transition = index > 0 ? transitionBetween(index) : undefined;
            return (
              <Fragment key={scene.id}>
                {index > 0 && (
                  <button
                    type="button"
                    className="transition"
                    data-kind={transition?.kind ?? "unknown"}
                    style={
                      {
                        "--scene-accent": scenes[index - 1]?.accent,
                      } as CSSProperties
                    }
                    onClick={() => selectTransition(index)}
                    title={
                      transition
                        ? `${transition.label}: ${scenes[index - 1]?.name} → ${scene.name}`
                        : undefined
                    }
                    aria-label={
                      transition
                        ? `Transition ${index}, ${transition.label}: ${scenes[index - 1]?.name} to ${scene.name}`
                        : `Transition ${index}`
                    }
                  >
                    <span className="transitionGlyph">
                      {transitionGlyph(transition?.kind)}
                    </span>
                    <span className="transitionLabel">
                      {transition?.label ?? "transition"}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  className="sceneClip"
                  data-scene="true"
                  data-active={index === selectedScene}
                  style={
                    {
                      width: `${sceneWidth(scene)}px`,
                      "--scene-accent": scene.accent,
                    } as CSSProperties
                  }
                  onClick={() => selectScene(index)}
                  title={`${scene.chapter} ${scene.name} — ${plainTitle(scene.title)}`}
                >
                  <span className="sceneClipTop">
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <span>scene</span>
                    <i className="sceneDot" aria-hidden="true" />
                  </span>
                  <span className="sceneName">{scene.name}</span>
                  <span className="sceneClipMeta sceneSub">
                    {plainTitle(scene.title)}
                  </span>
                </button>
              </Fragment>
            );
          })
        ) : turns.length === 0 ? (
          <>
            <div className="sceneClip" data-active="true">
              <span className="sceneClipTop">
                <b>01</b>
                <span>scene</span>
              </span>
              <span className="sceneClipTitle">
                Your first prompt starts the timeline.
              </span>
            </div>
            <div className="transition" aria-hidden="true">
              <span className="transitionGlyph">⋈</span>
              <span className="transitionLabel">transition</span>
            </div>
            <div className="sceneClip" data-ghost="true">
              <span className="sceneClipTop">
                <b>02</b>
                <span>scene</span>
              </span>
              <span className="sceneClipTitle">Waiting for the next take.</span>
            </div>
          </>
        ) : (
          turns.map((turn, index) => {
            const active = index === turns.length - 1;
            return (
              <Fragment key={turn.key}>
                {index > 0 && (
                  <div className="transition" aria-hidden="true">
                    <span className="transitionGlyph">⋈</span>
                    <span className="transitionLabel">transition</span>
                  </div>
                )}
                <button
                  type="button"
                  className="sceneClip"
                  data-active={active}
                  data-live={active && running}
                  style={{ width: `${turnWidth(turn)}px` }}
                  onClick={() => jump(turn.userId)}
                  title={turn.prompt}
                >
                  <span className="sceneClipTop">
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <span>scene</span>
                  </span>
                  <span className="sceneClipTitle">{turn.prompt}</span>
                  <span className="sceneClipMeta">
                    <span>{turnMeta(turn)}</span>
                    {active && running && <span className="recDot" />}
                  </span>
                </button>
              </Fragment>
            );
          })
        )}
      </div>
    </section>
  );
}

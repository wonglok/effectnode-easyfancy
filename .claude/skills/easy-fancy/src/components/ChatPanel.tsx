import { useEffect } from "react";
import { Link } from "react-router-dom";
import { AGENT_LABELS, AGENT_OPTIONS } from "../lib/agents";
import { MODE_META, useChat } from "../store/chat";
import type { AgentKind, PermissionMode } from "../types";
import Composer from "./Composer";
import MessageList from "./MessageList";
import Timeline from "./Timeline";

type Props = { fullscreen?: boolean };

export default function ChatPanel({ fullscreen = false }: Props) {
  const running = useChat((state) => state.running);
  const agent = useChat((state) => state.agent);
  const mode = useChat((state) => state.mode);
  const model = useChat((state) => state.model);
  const setAgent = useChat((state) => state.setAgent);
  const setMode = useChat((state) => state.setMode);
  const setModel = useChat((state) => state.setModel);
  const sessionShort = useChat((state) => state.sessionShort);
  const cwd = useChat((state) => state.cwd);
  const cost = useChat((state) => state.cost);
  const lastDuration = useChat((state) => state.lastDuration);
  const error = useChat((state) => state.error);
  const version = useChat((state) => state.version);
  const newChat = useChat((state) => state.newChat);
  const stop = useChat((state) => state.stop);
  const hydrate = useChat((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && useChat.getState().running) {
        useChat.getState().stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const meta = MODE_META[mode] || MODE_META.acceptEdits;
  const status = running ? "Working" : error ? "Error" : "Ready";

  const handleMode = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const next = event.target.value as PermissionMode;
    if (
      next === "bypassPermissions" &&
      !window.confirm(
        "Full access runs every tool without asking, including shell commands. Only use it in a project you trust. Continue?",
      )
    ) {
      event.target.value = mode;
      return;
    }
    setMode(next);
  };

  return (
    <aside className={`chatPanel${fullscreen ? " isFull" : ""}`}>
      <header className="chatTop">
        <Link className="brand" to="/" aria-label="easy-fancy home">
          <em>easy</em>
          <span className="slash">/</span>
          <strong>fancy</strong>
        </Link>

        <div className="topRight">
          <span
            className={`status${running ? " working" : ""}${error ? " error" : ""}`}
          >
            <i aria-hidden="true" />
            {status}
          </span>
          <Link className="mobilePreview" to="/preview">
            Preview
          </Link>
          <button className="iconBtn" type="button" onClick={newChat}>
            New
          </button>
          <button
            className="stopBtn"
            type="button"
            onClick={stop}
            disabled={!running}
          >
            Stop <kbd>esc</kbd>
          </button>
        </div>
      </header>

      <div className="controls">
        <label className="miniField">
          <span>Agent</span>
          <select
            value={agent}
            onChange={(event) => setAgent(event.target.value as AgentKind)}
          >
            {AGENT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.id}
              </option>
            ))}
          </select>
        </label>
        <label className="miniField">
          <span>Model</span>
          <input
            className="modelInput"
            list="model-options"
            value={model}
            placeholder="default"
            spellCheck={false}
            aria-label="Model"
            onChange={(event) => setModel(event.target.value)}
          />
          <datalist id="model-options">
            <option value="opus" />
            <option value="sonnet" />
            <option value="haiku" />
          </datalist>
        </label>
        <label className="miniField">
          <span>Mode</span>
          <select value={mode} onChange={handleMode}>
            <option value="acceptEdits">edit files</option>
            <option value="plan">plan only</option>
            <option value="bypassPermissions">full access</option>
          </select>
        </label>
        <span className="modeBadge" data-danger={meta.danger}>
          {meta.label}
        </span>
      </div>

      <div className="metaLine" title={cwd}>
        <span className="cwd">{cwd || "…"}</span>
        <span>session {sessionShort || "new"}</span>
        <span>${cost.toFixed(4)}</span>
        {lastDuration != null && (
          <span>{(lastDuration / 1000).toFixed(1)}s</span>
        )}
      </div>

      {mode !== "acceptEdits" && (
        <p className="modeHint" data-danger={meta.danger}>
          {meta.hint}
        </p>
      )}

      <MessageList />
      <Composer />
      <Timeline />
      <p className="chatFoot">
        Runs locally ·{" "}
        {version ? `${AGENT_LABELS[agent]} ${version}` : AGENT_LABELS[agent]}
      </p>
    </aside>
  );
}

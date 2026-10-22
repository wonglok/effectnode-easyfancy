import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useChat } from "../store/chat";
import { scrollPreviewToScene } from "../lib/preview";

const DEVICES = [
  { id: "desktop", label: "Desktop" },
  { id: "tablet", label: "Tablet" },
  { id: "mobile", label: "Mobile" },
] as const;

type Device = (typeof DEVICES)[number]["id"];

type Props = { fullscreen?: boolean };

export default function PreviewPanel({ fullscreen = false }: Props) {
  const previewUrl = useChat((state) => state.previewUrl);
  const setPreviewUrl = useChat((state) => state.setPreviewUrl);
  const autoReload = useChat((state) => state.autoReload);
  const setAutoReload = useChat((state) => state.setAutoReload);
  const nonce = useChat((state) => state.previewNonce);

  const [draft, setDraft] = useState(previewUrl);
  const [manualReload, setManualReload] = useState(0);
  const [reloadSpin, setReloadSpin] = useState(0);
  const [device, setDevice] = useState<Device>("desktop");

  useEffect(() => {
    setDraft(previewUrl);
  }, [previewUrl]);

  const src = normaliseUrl(previewUrl);
  const frameKey = `${src}:${manualReload}:${nonce}`;

  return (
    <section className={`previewPanel${fullscreen ? " isFull" : ""}`}>
      <header className="previewTop">
        <div className="previewTitle">
          <span className="liveDot" aria-hidden="true" />
          <span>Live preview</span>
          {fullscreen ? (
            <Link className="iconBtn backBtn" to="/">
              ← Chat
            </Link>
          ) : (
            <Link
              className="iconBtn expandBtn"
              to="/preview"
              title="Expand the preview"
              aria-label="Expand the preview"
            >
              ⤢
            </Link>
          )}
        </div>

        <form
          className="urlForm"
          onSubmit={(event) => {
            event.preventDefault();
            setPreviewUrl(draft);
          }}
        >
          <span className="urlScheme" aria-hidden="true">
            ↗
          </span>
          <input
            className="urlInput"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            aria-label="Preview URL"
          />
          <button className="iconBtn" type="submit" title="Load this URL">
            Go
          </button>
        </form>

        <div className="previewActions">
          <button
            className="iconBtn reloadBtn"
            type="button"
            onClick={() => {
              setManualReload((value) => value + 1);
              setReloadSpin((value) => value + 1);
            }}
            title="Reload the preview"
            aria-label="Reload the preview"
          >
            <svg
              key={reloadSpin}
              className={`reloadIcon${reloadSpin ? " isSpinning" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20.5 12a8.5 8.5 0 1 1-2.49-6.01" />
              <path d="M20.5 4.5V11h-6.5" />
            </svg>
            <span className="reloadLabel">Reload</span>
          </button>
          <label className="toggle" title="Reload after each turn">
            <input
              type="checkbox"
              checked={autoReload}
              onChange={(event) => setAutoReload(event.target.checked)}
            />
            <span>Auto</span>
          </label>
          <a
            className="iconBtn"
            href={src}
            target="_blank"
            rel="noreferrer"
            title="Open in a new tab"
            aria-label="Open in a new tab"
          >
            ↗
          </a>
        </div>
      </header>

      <div className="previewBar">
        <div className="devices" role="group" aria-label="Preview width">
          {DEVICES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="deviceBtn"
              data-active={device === entry.id}
              onClick={() => setDevice(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <span className="previewHint">
          {autoReload ? "reloads after each turn" : "manual reload"}
        </span>
      </div>

      <div className="canvas">
        <div className="deviceFrame" data-device={device}>
          <iframe
            key={frameKey}
            data-preview-frame="true"
            src={src}
            title="Website preview"
            onLoad={() => {
              // A reload (manual, auto, or the first load) resets the site to
              // its first chapter, so re-apply the clip the user is parked on.
              const { selectedScene, scenes } = useChat.getState();
              scrollPreviewToScene(
                scenes[selectedScene]?.index ?? selectedScene,
              );
            }}
          />
        </div>
      </div>

      <footer className="previewFoot">
        <span className="previewUrlLabel" title={src}>
          {src}
        </span>
        <span>If the site refuses to embed, open it in a new tab</span>
      </footer>
    </section>
  );
}

function normaliseUrl(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "http://localhost:3000";
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw) ? raw : `http://${raw}`;
}

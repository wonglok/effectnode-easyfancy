import { useEffect, useMemo, useRef, useState } from "react";
import { AGENT_LABELS } from "../lib/agents";
import { useChat } from "../store/chat";
import type { Attachment } from "../types";

const MAX_FILES = 6;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_MENTIONS = 6;
const ACCEPTED = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

function readImage(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.onload = () => {
      resolve({
        id:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `img-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name || "pasted-image.png",
        mime: file.type,
        size: file.size,
        dataUrl: String(reader.result || ""),
      });
    };
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Composer() {
  const draft = useChat((state) => state.draft);
  const agent = useChat((state) => state.agent);
  const attachments = useChat((state) => state.attachments);
  const queue = useChat((state) => state.queue);
  const uploads = useChat((state) => state.uploads);
  const uploading = useChat((state) => state.uploading);
  const uploadError = useChat((state) => state.uploadError);
  const setDraft = useChat((state) => state.setDraft);
  const addAttachment = useChat((state) => state.addAttachment);
  const removeAttachment = useChat((state) => state.removeAttachment);
  const enqueue = useChat((state) => state.enqueue);
  const removeQueued = useChat((state) => state.removeQueued);
  const clearQueue = useChat((state) => state.clearQueue);
  const moveQueued = useChat((state) => state.moveQueued);
  const uploadFiles = useChat((state) => state.uploadFiles);
  const clearUploadError = useChat((state) => state.clearUploadError);
  const running = useChat((state) => state.running);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const [caret, setCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionHidden, setMentionHidden] = useState(false);
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [draft]);

  const mention = useMemo(() => {
    if (mentionHidden) return null;
    const before = draft.slice(0, caret);
    const match = /(^|\s)@([A-Za-z0-9._-]*)$/.exec(before);
    if (!match) return null;
    const query = match[2].toLowerCase();
    const matches = uploads
      .filter((file) => file.name.toLowerCase().includes(query))
      .slice(0, MAX_MENTIONS);
    return { start: caret - query.length - 1, query, matches };
  }, [draft, caret, uploads, mentionHidden]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mention?.query]);

  const insertText = (snippet: string): void => {
    const element = textareaRef.current;
    const value = useChat.getState().draft;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const pad = before && !/\s$/.test(before) ? " " : "";
    const next = `${before}${pad}${snippet} ${value.slice(end)}`;
    const position = before.length + pad.length + snippet.length + 1;
    setDraft(next);
    setCaret(position);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(position, position);
    });
  };

  const applyMention = (name: string): void => {
    if (!mention) return;
    const after = draft.slice(caret);
    const next = `${draft.slice(0, mention.start)}@${name} ${after.replace(/^\s+/, "")}`;
    const position = mention.start + name.length + 2;
    setDraft(next);
    setCaret(position);
    setMentionHidden(true);
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(position, position);
    });
  };

  const uploadFileList = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    const saved = await uploadFiles(files);
    if (saved.length === 0) return;
    insertText(saved.map((file) => `@${file.name}`).join(" "));
  };

  const addFiles = async (files: File[]): Promise<void> => {
    const images = files.filter((file) => ACCEPTED.has(file.type));
    for (const file of images) {
      if (file.size > MAX_BYTES) continue;
      if (useChat.getState().attachments.length >= MAX_FILES) break;
      try {
        addAttachment(await readImage(file));
      } catch {
        /* an unreadable image is simply skipped */
      }
    }
  };

  const submit = (): void => {
    if (!draft.trim() && attachments.length === 0) return;
    enqueue();
  };

  const canSubmit = Boolean(draft.trim()) || attachments.length > 0;

  return (
    <form
      className={`composerWrap${dropping ? " isDropping" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        setDropping(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropping(false);
        const files = Array.from(event.dataTransfer.files || []);
        void uploadFileList(files);
      }}
    >
      {dropping && (
        <div className="dropOverlay" aria-hidden="true">
          Drop files to upload to <code>public/easy-fancy-uploads</code>
        </div>
      )}

      {queue.length > 0 && (
        <section className="queuePanel" aria-label="Queued prompts">
          <header className="queueHead">
            <span>
              <strong>{queue.length}</strong> queued
              {running ? " · next starts when this run ends" : ""}
            </span>
            <button
              type="button"
              className="queueClear"
              onClick={clearQueue}
              title="Remove every queued prompt"
            >
              Clear
            </button>
          </header>
          <ol className="queueList">
            {queue.map((item, index) => (
              <li className="queueItem" key={item.id}>
                <span className="queueIndex">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="queueText" title={item.text}>
                  {item.text || "(attachments only)"}
                </span>
                {item.attachments.length > 0 && (
                  <span className="queueBadge">
                    {item.attachments.length} img
                  </span>
                )}
                <span className="queueActions">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => moveQueued(item.id, -1)}
                    aria-label="Move prompt up"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === queue.length - 1}
                    onClick={() => moveQueued(item.id, 1)}
                    aria-label="Move prompt down"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeQueued(item.id)}
                    aria-label="Remove queued prompt"
                    title="Remove"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="composer">
        {attachments.length > 0 && (
          <div className="attachmentRow" aria-label="Attached images">
            {attachments.map((attachment) => (
              <figure className="attachmentChip" key={attachment.id}>
                <img
                  src={attachment.dataUrl}
                  alt={attachment.name}
                  title={attachment.name}
                />
                <figcaption>{attachment.name}</figcaption>
                <button
                  type="button"
                  className="attachmentRemove"
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={`Remove ${attachment.name}`}
                  title="Remove image"
                >
                  ×
                </button>
              </figure>
            ))}
          </div>
        )}

        {mention && (
          <ul className="mentionMenu" role="listbox" aria-label="Uploaded files">
            {mention.matches.length > 0 ? (
              mention.matches.map((file, index) => (
                <li key={file.name}>
                  <button
                    type="button"
                    className={index === mentionIndex ? "active" : ""}
                    role="option"
                    aria-selected={index === mentionIndex}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applyMention(file.name);
                    }}
                  >
                    <span className="mentionAt">@</span>
                    <span className="mentionName">{file.name}</span>
                    <span className="mentionMeta">
                      {formatSize(file.size)}
                    </span>
                  </button>
                </li>
              ))
            ) : (
              <li className="mentionEmpty">
                No uploaded file matches “{mention.query}”. Drop a file to upload.
              </li>
            )}
          </ul>
        )}

        <textarea
          id="composer-input"
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setCaret(event.target.selectionStart ?? 0);
            setMentionHidden(false);
          }}
          onSelect={(event) =>
            setCaret(event.currentTarget.selectionStart ?? 0)
          }
          onClick={(event) =>
            setCaret(event.currentTarget.selectionStart ?? 0)
          }
          onBlur={() => setMentionHidden(true)}
          onPaste={(event) => {
            const items = event.clipboardData?.items;
            if (!items) return;
            const images: File[] = [];
            const others: File[] = [];
            for (const item of items) {
              if (item.kind !== "file") continue;
              const file = item.getAsFile();
              if (!file) continue;
              (ACCEPTED.has(item.type) ? images : others).push(file);
            }
            if (images.length > 0 || others.length > 0) {
              event.preventDefault();
              void addFiles(images);
              void uploadFileList(others);
            }
          }}
          onKeyDown={(event) => {
            if (mention && mention.matches.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setMentionIndex(
                  (index) => (index + 1) % mention.matches.length,
                );
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setMentionIndex(
                  (index) =>
                    (index - 1 + mention.matches.length) %
                    mention.matches.length,
                );
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                applyMention(mention.matches[mentionIndex].name);
                return;
              }
            }
            if (event.key === "Escape" && mention) {
              event.preventDefault();
              setMentionHidden(true);
              return;
            }
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={`Ask ${AGENT_LABELS[agent]} to build, explain, explore…`}
          autoComplete="off"
          spellCheck
        />

        <div className="composerFoot">
          <div className="composerTools">
            <button
              type="button"
              className="attachBtn"
              onClick={() => fileRef.current?.click()}
              title="Attach images for the model to see"
              aria-label="Attach images"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              <span>
                Image
                {attachments.length > 0
                  ? ` ${attachments.length}/${MAX_FILES}`
                  : ""}
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = "";
                void addFiles(files);
              }}
            />
            <button
              type="button"
              className="attachBtn attachFile"
              onClick={() => uploadRef.current?.click()}
              title="Upload a file and reference it with @name"
              aria-label="Upload a file"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>{uploading > 0 ? `Uploading ${uploading}…` : "File"}</span>
            </button>
            <input
              ref={uploadRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = "";
                void uploadFileList(files);
              }}
            />
            <span className="composerHint">
              <kbd>↵</kbd> {running ? "queue" : "run"}{" "}
              <span className="dot">·</span>
              <kbd>⇧↵</kbd> new line <span className="dot">·</span>
              <kbd>@</kbd> file
            </span>
          </div>
          <button className="sendBtn" type="submit" disabled={!canSubmit}>
            <span>{running ? "Queue" : "Run"}</span>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 12.5v-9M3.8 7.3 8 3l4.2 4.3" />
            </svg>
          </button>
        </div>
      </div>

      {uploadError && (
        <p className="uploadStatus isError" role="alert">
          {uploadError}
          <button type="button" onClick={clearUploadError} title="Dismiss">
            ×
          </button>
        </p>
      )}
    </form>
  );
}

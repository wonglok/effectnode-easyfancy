import { create } from "zustand";
import { socket } from "../lib/socket";
import type {
  AgentKind,
  AssistantMessage,
  Attachment,
  ChatMessage,
  HarnessEvent,
  PermissionMode,
  QueueItem,
  SceneInfo,
  TransitionInfo,
  UploadFile,
} from "../types";

const read = (key: string, fallback: string): string => {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
};

const readOptional = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
};

const uid = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const isMode = (value: string | null): value is PermissionMode =>
  value === "acceptEdits" ||
  value === "plan" ||
  value === "bypassPermissions";

const isAgent = (value: string | null | undefined): value is AgentKind =>
  value === "claude" ||
  value === "codex" ||
  value === "opencode" ||
  value === "pi" ||
  value === "hermes" ||
  value === "openclaw";

export const MODE_META: Record<
  PermissionMode,
  { label: string; hint: string; danger: boolean }
> = {
  acceptEdits: {
    label: "EDITS",
    hint: "File edits apply automatically. Commands that need approval are denied.",
    danger: false,
  },
  plan: {
    label: "PLAN",
    hint: "Read-only: Claude explores and plans, but makes no changes.",
    danger: false,
  },
  bypassPermissions: {
    label: "FULL ACCESS",
    hint: "Runs every tool without asking. Only for trusted projects.",
    danger: true,
  },
};

type ChatState = {
  messages: ChatMessage[];
  running: boolean;
  sessionId: string | null;
  sessionShort: string;
  cwd: string;
  version: string;
  cost: number;
  lastDuration: number | null;
  error: string | null;
  agent: AgentKind;
  model: string;
  mode: PermissionMode;
  previewUrl: string;
  autoReload: boolean;
  previewNonce: number;
  draft: string;
  attachments: Attachment[];
  /** Prompts waiting for the active run to finish, oldest first. */
  queue: QueueItem[];
  /** Files in `public/easy-fancy-uploads`, newest first. */
  uploads: UploadFile[];
  uploading: number;
  uploadError: string | null;
  hydrated: boolean;
  scenes: SceneInfo[];
  scenesSource: string | null;
  scenesError: string | null;
  transitions: TransitionInfo[];
  transitionsSource: string | null;
  selectedScene: number;

  hydrate: () => Promise<void>;
  setSelectedScene: (index: number) => void;
  setDraft: (draft: string) => void;
  addAttachment: (attachment: Attachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setAgent: (agent: AgentKind) => void;
  setModel: (model: string) => void;
  setMode: (mode: PermissionMode) => void;
  setPreviewUrl: (url: string) => void;
  setAutoReload: (autoReload: boolean) => void;
  newChat: () => void;
  stop: () => void;
  send: (prompt: string, files?: Attachment[]) => void;
  enqueue: (text?: string) => void;
  removeQueued: (id: string) => void;
  clearQueue: () => void;
  moveQueued: (id: string, direction: -1 | 1) => void;
  uploadFiles: (files: File[]) => Promise<UploadFile[]>;
  refreshUploads: () => Promise<void>;
  clearUploadError: () => void;
};

type ActiveRun = {
  handle: (event: HarnessEvent) => void;
  fail: (message: string) => void;
};

const storedPreview = readOptional("easyfancy.preview");
const storedModel = readOptional("easyfancy.model");
const storedMode = readOptional("easyfancy.mode");
const storedAgent = readOptional("easyfancy.agent");
const initialMode: PermissionMode = isMode(storedMode)
  ? storedMode
  : "acceptEdits";
const initialAgent: AgentKind = isAgent(storedAgent) ? storedAgent : "claude";

let activeRun: ActiveRun | null = null;
let lastAssistantId: string | null = null;
let socketWired = false;
let queueTimer: ReturnType<typeof setTimeout> | null = null;

export const useChat = create<ChatState>((set, get) => {
  if (!socketWired) {
    socketWired = true;
    socket.on("harness", (event) => {
      activeRun?.handle(event);
    });
    socket.on("disconnect", () => {
      activeRun?.fail("Connection to the server was lost.");
    });
    // A run that failed while offline leaves its queue untouched; resume it.
    socket.on("connect", () => drainQueue(250));
  }

  return {
    messages: [],
    running: false,
    sessionId: null,
    sessionShort: "",
    cwd: "",
    version: "",
    cost: 0,
    lastDuration: null,
    error: null,
    agent: initialAgent,
    model: storedModel ?? "",
    mode: initialMode,
    previewUrl: storedPreview || "http://localhost:3000",
    autoReload: read("easyfancy.autoReload", "1") === "1",
    previewNonce: 0,
    draft: "",
    attachments: [],
    queue: [],
    uploads: [],
    uploading: 0,
    uploadError: null,
    hydrated: false,
    scenes: [],
    scenesSource: null,
    scenesError: null,
    transitions: [],
    transitionsSource: null,
    selectedScene: 0,

    setSelectedScene: (index) => set({ selectedScene: Math.max(0, index) }),

    hydrate: async () => {
      if (get().hydrated) return;
      set({ hydrated: true });
      try {
        const response = await fetch("/api/health");
        if (!response.ok) return;
        const data = (await response.json()) as {
          cwd?: string;
          agent?: string;
          model?: string;
          mode?: string;
          previewUrl?: string;
        };
        set({
          cwd: data.cwd || "",
          agent: isAgent(storedAgent)
            ? storedAgent
            : isAgent(data.agent)
              ? data.agent
              : "claude",
          model: storedModel ?? data.model ?? "",
          mode:
            storedMode && isMode(storedMode)
              ? storedMode
              : isMode(data.mode ?? null)
                ? (data.mode as PermissionMode)
                : "acceptEdits",
          previewUrl: storedPreview || data.previewUrl || get().previewUrl,
        });
      } catch {
        /* the chat still works if health is briefly unavailable */
      }

      try {
        const response = await fetch("/api/scenes");
        if (!response.ok) return;
        const data = (await response.json()) as {
          scenes?: SceneInfo[];
          source?: string | null;
          transitions?: TransitionInfo[];
          transitionSource?: string | null;
          error?: string;
        };
        const scenes = Array.isArray(data.scenes) ? data.scenes : [];
        set({
          scenes,
          scenesSource: data.source ?? null,
          scenesError: data.error ?? null,
          transitions: Array.isArray(data.transitions) ? data.transitions : [],
          transitionsSource: data.transitionSource ?? null,
          selectedScene: Math.min(
            get().selectedScene,
            Math.max(0, scenes.length - 1),
          ),
        });
      } catch {
        /* the timeline falls back to conversation turns */
      }

      void get().refreshUploads();
    },

    setDraft: (draft) => set({ draft }),

    addAttachment: (attachment) =>
      set((state) =>
        state.attachments.length >= 6
          ? state
          : { attachments: [...state.attachments, attachment] },
      ),

    removeAttachment: (id) =>
      set((state) => ({
        attachments: state.attachments.filter((entry) => entry.id !== id),
      })),

    clearAttachments: () => set({ attachments: [] }),

    setAgent: (agent) => {
      if (!isAgent(agent)) return;
      write("easyfancy.agent", agent);
      // A session id belongs to the backend that created it, so switching
      // agents starts a fresh thread instead of resuming the wrong one.
      set((state) =>
        state.agent === agent
          ? { agent }
          : { agent, sessionId: null, sessionShort: "", version: "" },
      );
    },

    setModel: (model) => {
      write("easyfancy.model", model);
      set({ model });
    },

    setMode: (mode) => {
      if (!isMode(mode)) return;
      write("easyfancy.mode", mode);
      set({ mode });
    },

    setPreviewUrl: (previewUrl) => {
      const next = String(previewUrl).trim() || "http://localhost:3000";
      write("easyfancy.preview", next);
      set({ previewUrl: next });
    },

    setAutoReload: (autoReload) => {
      write("easyfancy.autoReload", autoReload ? "1" : "0");
      set({ autoReload });
    },

    newChat: () => {
      if (get().running) get().stop();
      lastAssistantId = null;
      // Queued prompts were written for the old thread, so they go with it.
      set({
        messages: [],
        queue: [],
        sessionId: null,
        sessionShort: "",
        cost: 0,
        lastDuration: null,
        error: null,
      });
    },

    stop: () => {
      const id = lastAssistantId;
      if (id) {
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === id && message.role === "assistant"
              ? { ...message, stopped: true }
              : message,
          ),
        }));
      }
      socket.emit("stop");
    },

    send: (rawPrompt, filesOverride) => {
      const prompt = String(rawPrompt || "").trim();
      const files = filesOverride ?? get().attachments;
      if ((!prompt && files.length === 0) || get().running) return;

      const user: ChatMessage = {
        id: uid(),
        role: "user",
        text: prompt,
        attachments: files,
      };
      const assistant: AssistantMessage = {
        id: uid(),
        role: "assistant",
        agent: get().agent,
        text: "",
        thinking: "",
        tools: [],
        costUsd: null,
        durationMs: null,
        failed: false,
        stopped: false,
        error: "",
      };
      lastAssistantId = assistant.id;

      set((state) => ({
        messages: [...state.messages, user, assistant],
        running: true,
        error: null,
        attachments: [],
      }));

      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const commit = (): void => {
        const snapshot: AssistantMessage = {
          ...assistant,
          tools: assistant.tools.map((tool) => ({ ...tool })),
        };
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === assistant.id ? snapshot : message,
          ),
        }));
      };

      const schedule = (): void => {
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
          flushTimer = null;
          commit();
        }, 45);
      };

      const flush = (): void => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        commit();
      };

      const finish = (): void => {
        flush();
        activeRun = null;
        set({ running: false });

        if (get().autoReload && !assistant.failed) {
          // Give the dev server a beat to pick up edits before refreshing.
          setTimeout(() => {
            set((state) => ({ previewNonce: state.previewNonce + 1 }));
          }, 700);
        }

        // The next queued prompt starts once this run has fully settled.
        drainQueue(450);
      };

      const fail = (message: string): void => {
        assistant.failed = true;
        assistant.error = assistant.error
          ? `${assistant.error}\n${message}`
          : message;
        set({ error: assistant.error });
        finish();
      };

      const handle = (event: HarnessEvent): void => {
        switch (event.type) {
          case "run": {
            set({
              sessionId: event.sessionId,
              sessionShort: event.sessionId.slice(0, 8),
              cwd: event.cwd || get().cwd,
            });
            break;
          }
          case "init": {
            set((state) => ({
              version: event.version || state.version,
              sessionId: event.sessionId || state.sessionId,
              sessionShort: event.sessionId
                ? event.sessionId.slice(0, 8)
                : state.sessionShort,
            }));
            break;
          }
          case "text": {
            assistant.text += event.text;
            schedule();
            break;
          }
          case "thinking": {
            assistant.thinking += event.text;
            schedule();
            break;
          }
          case "tool": {
            const existing = assistant.tools.find(
              (tool) => tool.id === event.id,
            );
            if (existing) {
              existing.name = event.name || existing.name;
              existing.input = event.input || existing.input;
            } else {
              assistant.tools.push({
                id: event.id,
                name: event.name || "Tool",
                input: event.input || {},
                result: "",
                isError: false,
                pending: true,
              });
            }
            commit();
            break;
          }
          case "tool_result": {
            const tool = assistant.tools.find(
              (entry) => entry.id === event.id,
            );
            if (tool) {
              tool.result = event.text || "";
              tool.isError = Boolean(event.isError);
              tool.pending = false;
              commit();
            }
            break;
          }
          case "result": {
            assistant.costUsd =
              typeof event.costUsd === "number"
                ? event.costUsd
                : assistant.costUsd;
            assistant.durationMs =
              typeof event.durationMs === "number"
                ? event.durationMs
                : assistant.durationMs;
            if (event.isError) assistant.failed = true;
            set((state) => ({
              cost:
                typeof event.costUsd === "number" ? event.costUsd : state.cost,
              lastDuration:
                typeof event.durationMs === "number"
                  ? event.durationMs
                  : state.lastDuration,
            }));
            commit();
            break;
          }
          case "error": {
            assistant.failed = true;
            assistant.error = assistant.error
              ? `${assistant.error}\n${event.message}`
              : event.message || "The agent reported an error.";
            set({ error: assistant.error });
            commit();
            break;
          }
          case "done": {
            if (event.stopped) assistant.stopped = true;
            finish();
            break;
          }
          default:
            break;
        }
      };

      if (!socket.connected) {
        fail("Not connected to the easy-fancy server.");
        return;
      }

      activeRun = { handle, fail };
      socket.emit(
        "run",
        {
          prompt,
          agent: get().agent,
          sessionId: get().sessionId,
          model: get().model,
          permissionMode: get().mode,
          attachments: files.map((entry) => ({
            name: entry.name,
            mime: entry.mime,
            data: entry.dataUrl.slice(entry.dataUrl.indexOf(",") + 1),
          })),
        },
        (ack) => {
          if (ack?.error) fail(ack.error);
        },
      );
    },

    enqueue: (rawText) => {
      const text = String(rawText ?? get().draft).trim();
      const files = get().attachments;
      if (!text && files.length === 0) return;

      const item: QueueItem = {
        id: uid(),
        text,
        attachments: files,
        createdAt: Date.now(),
      };
      set({ draft: "", attachments: [] });

      // Idle and online: run right away instead of pretending to queue.
      if (!get().running && get().queue.length === 0 && socket.connected) {
        get().send(text, files);
        return;
      }

      set((state) => ({ queue: [...state.queue, item] }));
      drainQueue(0);
    },

    removeQueued: (id) =>
      set((state) => ({
        queue: state.queue.filter((item) => item.id !== id),
      })),

    clearQueue: () => set({ queue: [] }),

    moveQueued: (id, direction) =>
      set((state) => {
        const index = state.queue.findIndex((item) => item.id === id);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= state.queue.length) {
          return state;
        }
        const queue = [...state.queue];
        [queue[index], queue[target]] = [queue[target], queue[index]];
        return { queue };
      }),

    refreshUploads: async () => {
      try {
        const response = await fetch("/api/uploads");
        if (!response.ok) return;
        const data = (await response.json()) as { files?: UploadFile[] };
        set({ uploads: Array.isArray(data.files) ? data.files : [] });
      } catch {
        /* uploads still work when the listing is briefly unavailable */
      }
    },

    uploadFiles: async (files) => {
      const saved: UploadFile[] = [];
      if (files.length === 0) return saved;

      set((state) => ({
        uploading: state.uploading + files.length,
        uploadError: null,
      }));

      for (const file of files) {
        try {
          const name = file.name || `upload-${Date.now()}`;
          const response = await fetch(
            `/api/upload?name=${encodeURIComponent(name)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/octet-stream" },
              body: file,
            },
          );
          const data = (await response.json()) as {
            file?: UploadFile;
            error?: string;
          };
          if (!response.ok || !data.file) {
            throw new Error(data.error || "Upload failed.");
          }
          saved.push(data.file);
        } catch (error: unknown) {
          set({
            uploadError:
              error instanceof Error ? error.message : "Upload failed.",
          });
        } finally {
          set((state) => ({ uploading: Math.max(0, state.uploading - 1) }));
        }
      }

      if (saved.length > 0) {
        set((state) => ({
          uploads: [...saved, ...state.uploads].filter(
            (entry, index, all) =>
              all.findIndex((other) => other.name === entry.name) === index,
          ),
        }));
        void get().refreshUploads();
      }
      return saved;
    },

    clearUploadError: () => set({ uploadError: null }),
  };
});

/**
 * Starts the oldest queued prompt once nothing is running. The server rejects
 * overlapping runs, so the delay also lets the previous child finish exiting.
 */
function drainQueue(delay = 450): void {
  if (queueTimer) return;
  queueTimer = setTimeout(() => {
    queueTimer = null;
    const state = useChat.getState();
    if (state.running || state.queue.length === 0 || !socket.connected) return;
    const [next] = state.queue;
    useChat.setState({ queue: state.queue.slice(1) });
    state.send(next.text, next.attachments);
  }, delay);
}

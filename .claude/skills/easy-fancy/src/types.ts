export type PermissionMode =
  | "acceptEdits"
  | "plan"
  | "bypassPermissions";

export type AgentKind =
  | "claude"
  | "codex"
  | "opencode"
  | "pi"
  | "hermes"
  | "openclaw";

/** One entry from the website's `src/sections/registry.ts` (SectionMeta). */
export type SceneInfo = {
  id: string;
  index: number;
  chapter: string;
  name: string;
  title: string;
  accent: string;
  surface: string;
};

/**
 * The shader the site uses between two adjacent chapters, read from
 * `src/lib/render-pipeline.ts` (e.g. liquid, melt, page-curl).
 */
export type TransitionInfo = {
  from: number;
  to: number;
  kind: string;
  label: string;
};

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
  pending: boolean;
};

export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** `data:image/png;base64,…` — used for the thumbnail and the wire payload. */
  dataUrl: string;
};

/** A prompt waiting for the current run to finish. */
export type QueueItem = {
  id: string;
  text: string;
  attachments: Attachment[];
  createdAt: number;
};

/** A file on disk under `public/easy-fancy-uploads`, addressable as `@name`. */
export type UploadFile = {
  name: string;
  /** cwd-relative path, e.g. `public/easy-fancy-uploads/hero.png`. */
  path: string;
  /** URL under the preview site, e.g. `/easy-fancy-uploads/hero.png`. */
  url: string;
  size: number;
  mtime: number;
};

export type UserMessage = {
  id: string;
  role: "user";
  text: string;
  attachments?: Attachment[];
};

export type AssistantMessage = {
  id: string;
  role: "assistant";
  agent: AgentKind;
  text: string;
  thinking: string;
  tools: ToolCall[];
  costUsd: number | null;
  durationMs: number | null;
  failed: boolean;
  stopped: boolean;
  error: string;
};

export type ChatMessage = UserMessage | AssistantMessage;

export type HarnessEvent =
  | {
      type: "run";
      agent: AgentKind;
      sessionId: string;
      cwd: string;
      model: string;
      mode: PermissionMode;
    }
  | {
      type: "init";
      sessionId?: string;
      model?: string;
      cwd?: string;
      version?: string;
      permissionMode?: string;
    }
  | { type: "status"; status: string }
  | { type: "block"; kind: string; index: number }
  | { type: "text"; text: string; final?: boolean }
  | { type: "thinking"; text: string; final?: boolean }
  | { type: "tool"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; isError: boolean; text: string }
  | { type: "usage"; usage?: unknown; stopReason?: string }
  | {
      type: "result";
      subtype?: string;
      isError?: boolean;
      sessionId?: string;
      costUsd?: number;
      durationMs?: number;
      durationApiMs?: number;
      usage?: unknown;
      result?: string;
    }
  | { type: "error"; message: string }
  | { type: "done"; code?: number | null; signal?: string; stopped?: boolean };

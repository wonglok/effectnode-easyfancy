/**
 * Harness adapters.
 *
 * Each adapter spawns one non-interactive run of an agent CLI and normalizes
 * that CLI's native event stream into the small NDJSON vocabulary the React
 * client understands:
 *
 *   init · block · text · thinking · tool · tool_result · usage · result ·
 *   error · status · done
 *
 * Claude Code speaks stream-json directly. Codex and OpenCode each expose a
 * JSON line mode whose shapes are translated below.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PermissionMode = "acceptEdits" | "plan" | "bypassPermissions";

export const MODES: ReadonlySet<PermissionMode> = new Set([
  "acceptEdits",
  "plan",
  "bypassPermissions",
]);

export type AgentKind =
  | "claude"
  | "codex"
  | "opencode"
  | "pi"
  | "hermes"
  | "openclaw";

export const AGENTS: ReadonlySet<AgentKind> = new Set([
  "claude",
  "codex",
  "opencode",
  "pi",
  "hermes",
  "openclaw",
]);

export const AGENT_META: Record<
  AgentKind,
  { label: string; binary: string; install: string }
> = {
  claude: {
    label: "Claude Code",
    binary: "claude",
    install:
      "Install Claude Code, or start easy-fancy from a shell where `claude` works.",
  },
  codex: {
    label: "Codex",
    binary: "codex",
    install:
      "Install Codex (`npm i -g @openai/codex`), or start easy-fancy from a shell where `codex` works.",
  },
  opencode: {
    label: "OpenCode",
    binary: "opencode",
    install:
      "Install OpenCode (https://opencode.ai), or start easy-fancy from a shell where `opencode` works.",
  },
  pi: {
    label: "Pi",
    binary: "pi",
    install:
      "Install the Pi coding agent (`npm i -g @mariozechner/pi-coding-agent`), or start easy-fancy from a shell where `pi` works.",
  },
  hermes: {
    label: "Hermes",
    binary: "hermes",
    install:
      "Install Hermes Agent, or start easy-fancy from a shell where `hermes` works.",
  },
  openclaw: {
    label: "OpenClaw",
    binary: "openclaw",
    install:
      "Install OpenClaw (`npm i -g openclaw`), or start easy-fancy from a shell where `openclaw` works.",
  },
};

export type HarnessEvent = { type: string } & Record<string, unknown>;

/** An image the server has already decoded to a temp file. */
export type HarnessAttachment = {
  path: string;
  mime: string;
  name: string;
  data: string;
};

export type StartOptions = {
  agent: AgentKind;
  prompt: string;
  attachments?: HarnessAttachment[];
  cwd: string;
  sessionId: string;
  resume: boolean;
  model: string;
  mode: PermissionMode;
  send: (event: HarnessEvent) => void;
  onClose?: () => void;
};

export function startHarnessRun(options: StartOptions): {
  cancel: () => void;
} {
  switch (options.agent) {
    case "codex":
      return startCodex(options);
    case "opencode":
      return startOpencode(options);
    case "pi":
      return startPi(options);
    case "hermes":
      return startHermes(options);
    case "openclaw":
      return startOpenclaw(options);
    case "claude":
    default:
      return startClaude(options);
  }
}

/* --------------------------------------------------------------- plumbing */

type ProcessOptions = {
  agent: AgentKind;
  args: string[];
  cwd: string;
  input: string;
  send: (event: HarnessEvent) => void;
  onLine: (line: string) => void;
  onExit: (exit: {
    code: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
    stopped: boolean;
    spawnFailed: boolean;
  }) => void;
  onClose?: () => void;
};

/**
 * Runs one CLI, splits stdout into lines, keeps the last 8 kB of stderr and
 * owns the process-group cancellation logic shared by every adapter.
 */
function runProcess(options: ProcessOptions): { cancel: () => void } {
  const { agent, args, cwd, input, send, onLine, onExit, onClose } = options;
  const meta = AGENT_META[agent];

  let child;
  try {
    child = spawn(meta.binary, args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
  } catch (error: unknown) {
    send({
      type: "error",
      message: `Could not start ${meta.binary}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    send({ type: "done", code: 1 });
    onClose?.();
    return { cancel: () => {} };
  }

  const run = { stopped: false };
  let buffer = "";
  let stderr = "";
  let spawnFailed = false;

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onLine(line);
      newline = buffer.indexOf("\n");
    }
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
    if (stderr.length > 8000) stderr = stderr.slice(-8000);
  });

  child.on("error", (error: NodeJS.ErrnoException) => {
    spawnFailed = true;
    send({
      type: "error",
      message:
        error.code === "ENOENT"
          ? `The \`${meta.binary}\` CLI was not found on PATH. ${meta.install}`
          : error.message,
    });
  });

  child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
    if (buffer.trim()) onLine(buffer.trim());
    onExit({ code, signal, stderr, stopped: run.stopped, spawnFailed });
    onClose?.();
  });

  // Prompts travel through stdin so long text never hits argv limits.
  child.stdin?.end(input);

  return {
    cancel() {
      if (run.stopped) return;
      run.stopped = true;
      try {
        // The child is its own process group; stop everything it spawned.
        process.kill(-child.pid!, "SIGTERM");
      } catch {
        try {
          child.kill("SIGTERM");
        } catch {
          /* already gone */
        }
      }
      setTimeout(() => {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          /* already gone */
        }
      }, 3000).unref();
    },
  };
}

function reportExit(
  agent: AgentKind,
  exit: {
    code: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
    stopped: boolean;
    spawnFailed: boolean;
  },
  send: (event: HarnessEvent) => void,
): void {
  if (exit.spawnFailed || exit.stopped || exit.code === 0) return;
  const meta = AGENT_META[agent];
  const detail = exit.stderr.trim().split("\n").slice(-6).join("\n");
  send({
    type: "error",
    message: exit.signal
      ? `${meta.label} exited on ${exit.signal}.`
      : `${meta.label} exited with code ${exit.code}.${detail ? `\n${detail}` : ""}`,
  });
}

function emitDone(
  send: (event: HarnessEvent) => void,
  exit: {
    code: number | null;
    signal: NodeJS.Signals | null;
    stopped: boolean;
  },
): void {
  send({
    type: "done",
    code: exit.code,
    signal: exit.signal || undefined,
    stopped: exit.stopped,
  });
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Array<{ text?: unknown }>)
    .map((block) => (typeof block?.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { output?: unknown }).output === "string"
  ) {
    return (value as { output: string }).output;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/* ----------------------------------------------------------------- claude */

type RawClaudeEvent = {
  type?: string;
  subtype?: string;
  status?: string;
  session_id?: string;
  cwd?: string;
  model?: string;
  permissionMode?: string;
  claude_code_version?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  usage?: unknown;
  result?: string;
  event?: {
    type?: string;
    index?: number;
    content_block?: {
      type?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    };
    delta?: {
      type?: string;
      text?: string;
      thinking?: string;
      stop_reason?: string;
    };
    usage?: unknown;
  };
  message?: {
    content?: Array<{
      type?: string;
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      is_error?: boolean;
      content?: unknown;
    }>;
  };
};

function startClaude(options: StartOptions): { cancel: () => void } {
  const {
    prompt,
    attachments = [],
    cwd,
    sessionId,
    resume,
    model,
    mode,
    send,
    onClose,
  } = options;

  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    mode,
  ];
  if (attachments.length > 0) args.push("--input-format", "stream-json");
  if (model) args.push("--model", model);
  args.push(resume ? "--resume" : "--session-id", sessionId);
  if (mode === "bypassPermissions") args.push("--dangerously-skip-permissions");

  const flags = { sawText: false, sawThinking: false };

  return runProcess({
    agent: "claude",
    args,
    cwd,
    input:
      attachments.length > 0 ? claudeStreamInput(prompt, attachments) : prompt,
    send,
    onClose,
    onLine: (line) => handleClaudeLine(line, send, flags),
    onExit: (exit) => {
      reportExit("claude", exit, send);
      emitDone(send, exit);
    },
  });
}

/** Claude's stream-json input message, with images as base64 blocks. */
function claudeStreamInput(
  prompt: string,
  attachments: HarnessAttachment[],
): string {
  const content: unknown[] = [];
  if (prompt) content.push({ type: "text", text: prompt });
  for (const attachment of attachments) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mime,
        data: attachment.data,
      },
    });
  }
  if (!prompt) {
    content.unshift({
      type: "text",
      text: "Please look at the attached image(s).",
    });
  }
  return `${JSON.stringify({
    type: "user",
    message: { role: "user", content },
  })}\n`;
}

function handleClaudeLine(
  line: string,
  send: (event: HarnessEvent) => void,
  flags: { sawText: boolean; sawThinking: boolean },
): void {
  let event: RawClaudeEvent;
  try {
    event = JSON.parse(line) as RawClaudeEvent;
  } catch {
    return;
  }

  switch (event.type) {
    case "system": {
      if (event.subtype === "init") {
        send({
          type: "init",
          agent: "claude",
          sessionId: event.session_id,
          model: event.model,
          cwd: event.cwd,
          permissionMode: event.permissionMode,
          version: event.claude_code_version,
        });
      } else if (event.subtype === "status" && event.status === "requesting") {
        send({ type: "status", status: "requesting" });
      }
      return;
    }

    case "stream_event": {
      const inner = event.event;
      if (!inner) return;

      if (inner.type === "content_block_start") {
        const kind = inner.content_block?.type;
        if (kind === "tool_use") {
          send({
            type: "tool",
            id: inner.content_block?.id,
            name: inner.content_block?.name,
            input: inner.content_block?.input || {},
          });
        } else if (kind === "text" || kind === "thinking") {
          send({ type: "block", kind, index: inner.index });
        }
        return;
      }

      if (inner.type === "content_block_delta") {
        const delta = inner.delta || {};
        if (delta.type === "text_delta" && delta.text) {
          flags.sawText = true;
          send({ type: "text", text: delta.text });
        } else if (delta.type === "thinking_delta" && delta.thinking) {
          flags.sawThinking = true;
          send({ type: "thinking", text: delta.thinking });
        }
        return;
      }

      if (inner.type === "message_delta") {
        send({
          type: "usage",
          usage: inner.usage,
          stopReason: inner.delta?.stop_reason,
        });
      }
      return;
    }

    case "assistant": {
      const content = event.message?.content || [];
      for (const block of content) {
        if (block.type === "text" && !flags.sawText) {
          send({ type: "text", text: block.text, final: true });
        } else if (block.type === "thinking" && !flags.sawThinking) {
          send({ type: "thinking", text: block.thinking, final: true });
        } else if (block.type === "tool_use") {
          send({
            type: "tool",
            id: block.id,
            name: block.name,
            input: block.input,
          });
        }
      }
      return;
    }

    case "user": {
      const content = event.message?.content || [];
      if (!Array.isArray(content)) return;
      for (const block of content) {
        if (block.type !== "tool_result") continue;
        send({
          type: "tool_result",
          id: block.tool_use_id,
          isError: Boolean(block.is_error),
          text: toolResultText(block.content),
        });
      }
      return;
    }

    case "result": {
      send({
        type: "result",
        subtype: event.subtype,
        isError: Boolean(event.is_error),
        sessionId: event.session_id,
        costUsd: event.total_cost_usd,
        durationMs: event.duration_ms,
        durationApiMs: event.duration_api_ms,
        usage: event.usage,
        result:
          typeof event.result === "string"
            ? event.result.slice(0, 4000)
            : undefined,
      });
      return;
    }

    default:
      return;
  }
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Array<{ type?: string; text?: string }>)
    .map((block) => {
      if (block?.type === "text") return block.text || "";
      if (block?.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------------------------------------------ codex */

type CodexItem = {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
  changes?: unknown;
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  query?: string;
  message?: string;
  error?: { message?: string } | string;
};

type CodexEvent = {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: unknown;
  message?: string;
  error?: { message?: string } | string;
};

type CodexState = {
  sessionId: string;
  text: Map<string, string>;
  thinking: Map<string, string>;
  tools: Set<string>;
  counter: number;
};

function startCodex(options: StartOptions): { cancel: () => void } {
  const {
    prompt,
    attachments = [],
    cwd,
    sessionId,
    resume,
    model,
    mode,
    send,
    onClose,
  } = options;

  const args = ["exec"];
  if (resume) args.push("resume");
  args.push("--json", "--skip-git-repo-check");
  if (model) args.push("--model", model);
  for (const attachment of attachments) {
    args.push("--image", attachment.path);
  }
  if (mode === "bypassPermissions") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (!resume) {
    // A resumed thread keeps the sandbox settings it was created with.
    args.push("--sandbox", mode === "plan" ? "read-only" : "workspace-write");
  }
  if (resume) args.push(sessionId);
  args.push("-");

  const state: CodexState = {
    sessionId,
    text: new Map(),
    thinking: new Map(),
    tools: new Set(),
    counter: 0,
  };
  const startedAt = Date.now();

  return runProcess({
    agent: "codex",
    args,
    cwd,
    input: prompt,
    send,
    onClose,
    onLine: (line) => handleCodexLine(line, send, state),
    onExit: (exit) => {
      reportExit("codex", exit, send);
      send({
        type: "result",
        sessionId: state.sessionId,
        durationMs: Date.now() - startedAt,
      });
      emitDone(send, exit);
    },
  });
}

function errorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

function handleCodexLine(
  line: string,
  send: (event: HarnessEvent) => void,
  state: CodexState,
): void {
  let event: CodexEvent;
  try {
    event = JSON.parse(line) as CodexEvent;
  } catch {
    return;
  }

  switch (event.type) {
    case "thread.started": {
      if (event.thread_id) state.sessionId = event.thread_id;
      send({
        type: "init",
        agent: "codex",
        sessionId: state.sessionId,
      });
      return;
    }

    case "turn.completed": {
      send({
        type: "result",
        sessionId: state.sessionId,
        usage: event.usage,
      });
      return;
    }

    case "turn.failed": {
      send({
        type: "error",
        message: errorMessage(event.error) || "Codex reported a failed turn.",
      });
      return;
    }

    case "error": {
      send({
        type: "error",
        message: event.message || errorMessage(event.error) || "Codex error.",
      });
      return;
    }

    case "item.started":
    case "item.updated":
    case "item.completed": {
      handleCodexItem(event, send, state);
      return;
    }

    default:
      return;
  }
}

function handleCodexItem(
  event: CodexEvent,
  send: (event: HarnessEvent) => void,
  state: CodexState,
): void {
  const item = event.item;
  if (!item) return;
  state.counter += 1;
  const id = item.id || `codex-item-${state.counter}`;
  const done = event.type === "item.completed";

  switch (item.type) {
    case "agent_message": {
      emitText(state.text, id, item.text || "", (text) =>
        send({ type: "text", text }),
      );
      return;
    }

    case "reasoning": {
      emitText(state.thinking, id, item.text || "", (text) =>
        send({ type: "thinking", text }),
      );
      return;
    }

    case "command_execution": {
      if (!state.tools.has(id)) {
        state.tools.add(id);
        send({
          type: "tool",
          id,
          name: "shell",
          input: { command: item.command || "" },
        });
      }
      if (!done) return;
      const failed = typeof item.exit_code === "number" && item.exit_code !== 0;
      send({
        type: "tool_result",
        id,
        isError: failed,
        text:
          item.aggregated_output ||
          (typeof item.exit_code === "number"
            ? `exit ${item.exit_code}`
            : "completed"),
      });
      return;
    }

    case "file_change": {
      if (!state.tools.has(id)) {
        state.tools.add(id);
        send({
          type: "tool",
          id,
          name: "apply_patch",
          input: { changes: item.changes ?? [] },
        });
      }
      if (!done) return;
      send({
        type: "tool_result",
        id,
        isError: item.status === "failed",
        text: item.status === "failed" ? "Patch failed." : "Patch applied.",
      });
      return;
    }

    case "mcp_tool_call": {
      if (!state.tools.has(id)) {
        state.tools.add(id);
        send({
          type: "tool",
          id,
          name: `${item.server || "mcp"}.${item.tool || "call"}`,
          input: item.arguments ?? {},
        });
      }
      if (!done) return;
      send({
        type: "tool_result",
        id,
        isError: Boolean(item.error),
        text: errorMessage(item.error) || textOf(item.result) || "completed",
      });
      return;
    }

    case "web_search": {
      if (!state.tools.has(id)) {
        state.tools.add(id);
        send({
          type: "tool",
          id,
          name: "web_search",
          input: { query: item.query || "" },
        });
      }
      if (!done) return;
      send({
        type: "tool_result",
        id,
        isError: false,
        text: "Search complete.",
      });
      return;
    }

    case "error": {
      send({
        type: "error",
        message: errorMessage(item.error) || item.message || "Codex error.",
      });
      return;
    }

    default:
      return;
  }
}

/* --------------------------------------------------------------- opencode */

type OpencodePart = {
  id?: string;
  type?: string;
  text?: string;
  tool?: string;
  callID?: string;
  reason?: string;
  tokens?: unknown;
  cost?: number;
  state?: {
    status?: string;
    input?: unknown;
    output?: unknown;
    error?: string;
    title?: string;
    metadata?: { output?: string; exit?: number };
  };
};

type OpencodeEvent = {
  type?: string;
  sessionID?: string;
  part?: OpencodePart;
  error?: { message?: string; data?: { message?: string } } | string;
  message?: string;
};

type OpencodeState = {
  sessionId: string;
  initialized: boolean;
  text: Map<string, string>;
  thinking: Map<string, string>;
  tools: Set<string>;
  counter: number;
  costUsd: number;
};

function startOpencode(options: StartOptions): { cancel: () => void } {
  const {
    prompt,
    attachments = [],
    cwd,
    sessionId,
    resume,
    model,
    mode,
    send,
    onClose,
  } = options;

  const args = ["run", "--format", "json", "--dir", cwd];
  if (resume) args.push("--session", sessionId);
  if (model) args.push("--model", model);
  for (const attachment of attachments) {
    args.push("--file", attachment.path);
  }
  if (mode === "plan") args.push("--agent", "plan");
  if (mode === "bypassPermissions") args.push("--auto");
  // `--` keeps a prompt that starts with a dash from parsing as a flag.
  args.push("--", prompt);

  const state: OpencodeState = {
    sessionId,
    initialized: false,
    text: new Map(),
    thinking: new Map(),
    tools: new Set(),
    counter: 0,
    costUsd: 0,
  };
  const startedAt = Date.now();

  return runProcess({
    agent: "opencode",
    args,
    cwd,
    input: "",
    send,
    onClose,
    onLine: (line) => handleOpencodeLine(line, send, state),
    onExit: (exit) => {
      reportExit("opencode", exit, send);
      send({
        type: "result",
        sessionId: state.sessionId,
        costUsd: state.costUsd || undefined,
        durationMs: Date.now() - startedAt,
      });
      emitDone(send, exit);
    },
  });
}

function handleOpencodeLine(
  line: string,
  send: (event: HarnessEvent) => void,
  state: OpencodeState,
): void {
  let event: OpencodeEvent;
  try {
    event = JSON.parse(line) as OpencodeEvent;
  } catch {
    return;
  }

  if (event.sessionID) state.sessionId = event.sessionID;
  if (event.sessionID && !state.initialized) {
    state.initialized = true;
    send({
      type: "init",
      agent: "opencode",
      sessionId: event.sessionID,
    });
  }

  const part = event.part;
  switch (event.type) {
    case "text": {
      if (!part) return;
      const id = part.id || `opencode-text-${state.counter++}`;
      emitText(state.text, id, part.text || "", (text) =>
        send({ type: "text", text }),
      );
      return;
    }

    case "reasoning": {
      if (!part) return;
      const id = part.id || `opencode-thinking-${state.counter++}`;
      emitText(state.thinking, id, part.text || "", (text) =>
        send({ type: "thinking", text }),
      );
      return;
    }

    case "tool_use": {
      if (!part) return;
      state.counter += 1;
      const id = part.callID || part.id || `opencode-tool-${state.counter}`;
      const status = part.state?.status;
      if (!state.tools.has(id)) {
        state.tools.add(id);
        send({
          type: "tool",
          id,
          name: part.tool || "tool",
          input: part.state?.input ?? {},
        });
      }
      if (status === "running" || status === "pending") return;
      const output =
        textOf(part.state?.output) ||
        part.state?.metadata?.output ||
        part.state?.title ||
        (status === "error" ? "Tool failed." : "completed");
      send({
        type: "tool_result",
        id,
        isError: status === "error",
        text: part.state?.error || output,
      });
      return;
    }

    case "step_finish": {
      if (!part) return;
      if (typeof part.cost === "number") state.costUsd += part.cost;
      send({
        type: "result",
        sessionId: state.sessionId,
        costUsd: state.costUsd || undefined,
        usage: part.tokens,
      });
      return;
    }

    case "error": {
      send({
        type: "error",
        message:
          errorMessage(event.error) ||
          event.message ||
          (typeof event.error === "object" && event.error
            ? errorMessage(event.error.data)
            : "") ||
          "OpenCode reported an error.",
      });
      return;
    }

    default:
      return;
  }
}

/* --------------------------------------------------------------------- pi */

type PiBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
};

type PiMessage = {
  role?: string;
  content?: PiBlock[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  usage?: { cost?: { total?: number } } & Record<string, unknown>;
  stopReason?: string;
  errorMessage?: string;
};

type PiEvent = {
  type?: string;
  message?: PiMessage;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
    toolCall?: {
      id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
    };
  };
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: { content?: PiBlock[] };
  isError?: boolean;
  finalError?: string;
};

type PiState = {
  tools: Set<string>;
  costUsd: number;
};

function startPi(options: StartOptions): { cancel: () => void } {
  const {
    prompt,
    attachments = [],
    cwd,
    sessionId,
    model,
    mode,
    send,
    onClose,
  } = options;

  // Pi resumes by reading a session file, so the file name is derived from
  // the id the client already holds. That keeps resume stable across turns.
  const dir = path.join(os.tmpdir(), "easy-fancy-pi");
  fs.mkdirSync(dir, { recursive: true });
  const sessionPath = path.join(dir, `${sessionId}.json`);

  const args = ["-p", "--mode", "json", "--session", sessionPath];
  if (model) args.push("--model", model);
  if (mode === "plan") args.push("--tools", "read,grep,find,ls");
  // Pi expands @path images only from argv messages, not from stdin.
  if (attachments.length > 0) {
    args.push(...attachments.map((item) => `@${item.path}`));
    args.push(prompt || "Please look at the attached image(s).");
  }

  const state: PiState = { tools: new Set(), costUsd: 0 };
  const startedAt = Date.now();
  send({ type: "init", agent: "pi", sessionId });

  return runProcess({
    agent: "pi",
    args,
    cwd,
    input: attachments.length > 0 ? "" : prompt,
    send,
    onClose,
    onLine: (line) => handlePiLine(line, send, state),
    onExit: (exit) => {
      reportExit("pi", exit, send);
      send({
        type: "result",
        sessionId,
        costUsd: state.costUsd || undefined,
        durationMs: Date.now() - startedAt,
      });
      emitDone(send, exit);
    },
  });
}

function handlePiLine(
  line: string,
  send: (event: HarnessEvent) => void,
  state: PiState,
): void {
  let event: PiEvent;
  try {
    event = JSON.parse(line) as PiEvent;
  } catch {
    return;
  }

  switch (event.type) {
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (!update) return;
      if (update.type === "text_delta" && update.delta) {
        send({ type: "text", text: update.delta });
      } else if (update.type === "thinking_delta" && update.delta) {
        send({ type: "thinking", text: update.delta });
      } else if (update.type === "toolcall_end" && update.toolCall?.id) {
        if (!state.tools.has(update.toolCall.id)) {
          state.tools.add(update.toolCall.id);
          send({
            type: "tool",
            id: update.toolCall.id,
            name: update.toolCall.name,
            input: update.toolCall.arguments || {},
          });
        }
      }
      return;
    }

    case "tool_execution_end": {
      const id = event.toolCallId;
      if (!id) return;
      if (!state.tools.has(id)) {
        state.tools.add(id);
        send({
          type: "tool",
          id,
          name: event.toolName,
          input: event.args || {},
        });
      }
      send({
        type: "tool_result",
        id,
        isError: Boolean(event.isError),
        text:
          contentText(event.result?.content) ||
          (event.isError ? "Tool failed." : "completed"),
      });
      return;
    }

    case "message_end": {
      const message = event.message;
      if (!message || message.role !== "assistant") return;
      const cost = message.usage?.cost?.total;
      if (typeof cost === "number") state.costUsd += cost;
      send({
        type: "result",
        usage: message.usage,
        costUsd: state.costUsd || undefined,
      });
      if (message.stopReason === "error") {
        send({
          type: "error",
          message: message.errorMessage || "Pi reported an error.",
        });
      }
      return;
    }

    case "auto_retry_end": {
      if (event.finalError) {
        send({ type: "error", message: event.finalError });
      }
      return;
    }

    case "error": {
      send({
        type: "error",
        message:
          event.finalError ||
          event.message?.errorMessage ||
          "Pi reported an error.",
      });
      return;
    }

    default:
      return;
  }
}

/* ----------------------------------------------------------------- hermes */

type HermesEvent = {
  type?: string;
  subtype?: string;
  model?: string;
  session_id?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  output?: string;
  is_error?: boolean;
  exit_code?: number;
  tokens?: unknown;
  duration_ms?: number;
  message?: string;
};

type HermesTool = { id: string; name: string };

function startHermes(options: StartOptions): { cancel: () => void } {
  const {
    prompt,
    attachments = [],
    cwd,
    sessionId,
    resume,
    model,
    mode,
    send,
    onClose,
  } = options;

  const args = [
    "chat",
    "-q",
    prompt || "Please look at the attached image(s).",
    "--format",
    "stream-json",
    "--in",
    cwd,
  ];
  for (const attachment of attachments) {
    args.push("--image", attachment.path);
  }
  if (resume) args.push("--resume", sessionId);
  if (model) args.push("-m", model);
  // "web" is read-only: it keeps plan mode from touching files or a shell.
  if (mode === "plan") args.push("-t", "web");
  if (mode === "bypassPermissions") args.push("--yolo");

  const state = {
    pending: [] as HermesTool[],
    counter: 0,
    sawText: false,
  };
  const startedAt = Date.now();

  return runProcess({
    agent: "hermes",
    args,
    cwd,
    input: "",
    send,
    onClose,
    onLine: (line) => handleHermesLine(line, send, state),
    onExit: (exit) => {
      reportExit("hermes", exit, send);
      send({
        type: "result",
        sessionId,
        durationMs: Date.now() - startedAt,
      });
      emitDone(send, exit);
    },
  });
}

function handleHermesLine(
  line: string,
  send: (event: HarnessEvent) => void,
  state: {
    pending: HermesTool[];
    counter: number;
    sawText: boolean;
  },
): void {
  let event: HermesEvent;
  try {
    event = JSON.parse(line) as HermesEvent;
  } catch {
    return;
  }

  switch (event.type) {
    case "system": {
      if (event.subtype === "init") {
        send({
          type: "init",
          agent: "hermes",
          sessionId: event.session_id,
          model: event.model,
        });
      }
      return;
    }

    case "text": {
      if (!event.text) return;
      state.sawText = true;
      send({ type: "text", text: event.text });
      return;
    }

    case "tool_use": {
      state.counter += 1;
      const id = `hermes-tool-${state.counter}`;
      state.pending.push({ id, name: event.name || "tool" });
      send({
        type: "tool",
        id,
        name: event.name || "tool",
        input: event.input || {},
      });
      return;
    }

    case "tool_result": {
      // Hermes does not send call ids, so match the oldest pending call
      // with the same tool name (or the oldest call when names differ).
      const named = state.pending.findIndex(
        (entry) => entry.name === event.name,
      );
      const index = named === -1 ? 0 : named;
      const match = state.pending[index];
      if (match) state.pending.splice(index, 1);
      send({
        type: "tool_result",
        id: match?.id,
        isError: Boolean(event.is_error),
        text: event.output || "",
      });
      return;
    }

    case "result": {
      if (!state.sawText && event.text) {
        send({ type: "text", text: event.text });
      }
      send({
        type: "result",
        sessionId: event.session_id,
        durationMs: event.duration_ms,
        usage: event.tokens,
      });
      if (typeof event.exit_code === "number" && event.exit_code !== 0) {
        send({
          type: "error",
          message: event.text || `Hermes exited with code ${event.exit_code}.`,
        });
      }
      return;
    }

    case "error": {
      send({
        type: "error",
        message: event.message || "Hermes reported an error.",
      });
      return;
    }

    default:
      return;
  }
}

/* --------------------------------------------------------------- openclaw */

type OpenclawResult = {
  payloads?: Array<{ text?: string | null }>;
  meta?: {
    durationMs?: number;
    aborted?: boolean;
    agentMeta?: { usage?: unknown; model?: string };
  };
};

function startOpenclaw(options: StartOptions): { cancel: () => void } {
  const {
    prompt,
    attachments = [],
    cwd,
    sessionId,
    model,
    send,
    onClose,
  } = options;

  // OpenClaw's agent turn has no image flag, so point it at the files.
  const message = attachments.length
    ? `${prompt}\n\nAttached image files:\n${attachments
        .map((item) => `- ${item.path}`)
        .join("\n")}`.trim()
    : prompt;

  const args = [
    "agent",
    "--session-id",
    sessionId,
    "--message",
    message,
    "--json",
  ];
  if (model) args.push("--model", model);
  // OpenClaw enforces its own exec approvals; there is no per-run mode flag.
  // Its embedded agent uses the workspace configured for the OpenClaw agent.

  const startedAt = Date.now();
  let raw = "";
  send({ type: "init", agent: "openclaw", sessionId });

  return runProcess({
    agent: "openclaw",
    args,
    cwd,
    input: "",
    send,
    onClose,
    // --json prints one pretty-printed object at the end, so collect stdout
    // and parse it once the process closes.
    onLine: (line) => {
      raw += `${line}\n`;
    },
    onExit: (exit) => {
      reportExit("openclaw", exit, send);
      if (!exit.spawnFailed && exit.code === 0) {
        handleOpenclawResult(raw, send, startedAt);
      }
      emitDone(send, exit);
    },
  });
}

function handleOpenclawResult(
  raw: string,
  send: (event: HarnessEvent) => void,
  startedAt: number,
): void {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    send({
      type: "error",
      message: "OpenClaw returned no JSON result.",
    });
    return;
  }
  let parsed: OpenclawResult;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as OpenclawResult;
  } catch {
    send({
      type: "error",
      message: "Could not parse OpenClaw's JSON result.",
    });
    return;
  }
  const text = (parsed.payloads || [])
    .map((payload) => payload.text || "")
    .filter(Boolean)
    .join("\n\n");
  if (text) send({ type: "text", text });
  send({
    type: "result",
    durationMs: parsed.meta?.durationMs ?? Date.now() - startedAt,
    usage: parsed.meta?.agentMeta?.usage,
  });
  if (parsed.meta?.aborted) {
    send({ type: "error", message: "OpenClaw aborted the turn." });
  }
}

/* ----------------------------------------------------------------- shared */

/**
 * Emits only the newly appended slice of an item whose text may arrive in
 * several updates (Codex) or repeat a cumulative string (OpenCode).
 */
function emitText(
  seen: Map<string, string>,
  id: string,
  full: string,
  push: (delta: string) => void,
): void {
  if (!full) return;
  const previous = seen.get(id) || "";
  if (full === previous) return;
  if (full.startsWith(previous)) {
    push(full.slice(previous.length));
  } else {
    push(full);
  }
  seen.set(id, full);
}

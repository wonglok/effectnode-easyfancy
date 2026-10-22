#!/usr/bin/env node
/**
 * easy-fancy — Express API + Vite/React UI.
 *
 * The left side of the page is a chat with the host Claude Code harness; the
 * right side embeds the site you are working on. In dev mode Vite runs in
 * Express middleware mode, so one process serves both the SPA and the API.
 */
import express from "express";
import type { NextFunction, Request, Response } from "express";
import fs from "node:fs";
import os from "node:os";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Server as SocketServer } from "socket.io";
import type { Socket } from "socket.io";
import { AGENTS, AGENT_META, MODES, startHarnessRun } from "./harness";
import type {
  AgentKind,
  HarnessAttachment,
  HarnessEvent,
  PermissionMode,
} from "./harness";

const SKILL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Options = Record<string, string | boolean>;

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const text = (key: string, fallback = ""): string =>
  typeof options[key] === "string" ? (options[key] as string) : fallback;

const cwd = path.resolve(text("cwd", process.cwd()));
const host = text("host", "127.0.0.1");
const port = Number(text("port", "7777"));
const defaultModel = text("model");
const requestedMode = text("mode", "acceptEdits");
const defaultMode: PermissionMode = MODES.has(requestedMode as PermissionMode)
  ? (requestedMode as PermissionMode)
  : "acceptEdits";
const requestedAgent = text("agent", "");
const hostAgent = detectHostAgent();
const resolvedAgent = requestedAgent || hostAgent || "claude";
const defaultAgent: AgentKind = AGENTS.has(resolvedAgent as AgentKind)
  ? (resolvedAgent as AgentKind)
  : "claude";
const agentSource = requestedAgent ? "flag" : hostAgent ? "host" : "default";
const previewUrl = text("preview", "http://localhost:3000");
const production = Boolean(options.prod);

if (!fs.existsSync(cwd)) {
  fail(`Working directory does not exist: ${cwd}`);
}

type ConnectionInfo = {
  cwd: string;
  previewUrl: string;
  agent: AgentKind;
  agents: AgentKind[];
  model: string;
  mode: PermissionMode;
  production: boolean;
  running: boolean;
};

type RunPayload = {
  prompt?: unknown;
  permissionMode?: unknown;
  model?: unknown;
  sessionId?: unknown;
  agent?: unknown;
  attachments?: unknown;
};

const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL = 20 * 1024 * 1024;

type PreparedAttachments = {
  attachments: HarnessAttachment[];
  cleanup: () => void;
  error?: string;
};

/**
 * Validates pasted/uploaded images and writes them to a private temp folder.
 * Each adapter then receives both the base64 payload (Claude) and a file path
 * (Codex, OpenCode, Pi, Hermes, OpenClaw).
 */
function prepareAttachments(value: unknown): PreparedAttachments {
  if (!Array.isArray(value) || value.length === 0) {
    return { attachments: [], cleanup: () => {} };
  }
  if (value.length > MAX_ATTACHMENTS) {
    return {
      attachments: [],
      cleanup: () => {},
      error: `Attach at most ${MAX_ATTACHMENTS} images per prompt.`,
    };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "easy-fancy-img-"));
  const cleanup = (): void => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  };
  const fail = (error: string): PreparedAttachments => {
    cleanup();
    return { attachments: [], cleanup: () => {}, error };
  };

  const attachments: HarnessAttachment[] = [];
  let total = 0;

  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index] as {
      name?: unknown;
      mime?: unknown;
      data?: unknown;
    } | null;
    if (!raw || typeof raw !== "object") {
      return fail("Invalid attachment.");
    }
    const name = typeof raw.name === "string" ? raw.name : `image-${index + 1}`;
    const mime =
      typeof raw.mime === "string" ? raw.mime.toLowerCase() : "image/png";
    const data = typeof raw.data === "string" ? raw.data : "";
    if (!IMAGE_MIMES.has(mime)) {
      return fail("Only PNG, JPEG, WebP and GIF images are supported.");
    }
    if (!data) return fail("Attachment data is empty.");
    const buffer = Buffer.from(data, "base64");
    if (buffer.length === 0) return fail("Attachment data is not valid base64.");
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      return fail("Each image must be 8 MB or smaller.");
    }
    total += buffer.length;
    if (total > MAX_ATTACHMENT_TOTAL) {
      return fail("Images must total 20 MB or less.");
    }

    const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
    const stem =
      name
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(-48) || `image-${index + 1}`;
    const filename = `${String(index + 1).padStart(2, "0")}-${stem}.${ext}`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, buffer);
    attachments.push({ path: filePath, mime, name, data });
  }

  return { attachments, cleanup };
}

type RunAck = (result: { ok?: boolean; error?: string; sessionId?: string }) => void;

/** One conversation at a time; the UI is a single shared chat. */
let active: { socket: Socket; cancel: () => void } | null = null;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "512kb" }));

const httpServer = createHttpServer(app);
const io = new SocketServer(httpServer, {
  serveClient: false,
  // Room for base64 images on a prompt (server limit: 20 MB of image data).
  maxHttpBufferSize: 30e6,
});

// --------------------------------------------------------------------- API

app.get("/api/health", (_req: Request, res: Response) => {
  const info: ConnectionInfo = {
    cwd,
    previewUrl,
    agent: defaultAgent,
    agents: [...AGENTS],
    model: defaultModel,
    mode: defaultMode,
    production,
    running: Boolean(active),
  };
  res.json({ ok: true, ...info });
});

// ------------------------------------------------------------------ uploads

/**
 * Dropped files land inside the previewed project, so the agent can open them
 * with a normal `@` reference and the preview can serve them as static files.
 */
const UPLOAD_DIR = path.join(cwd, "public", "easy-fancy-uploads");
const UPLOAD_URL_PREFIX = "/easy-fancy-uploads";
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

type UploadedFile = {
  name: string;
  path: string;
  url: string;
  size: number;
  mtime: number;
};

const toPosix = (value: string): string => value.split(path.sep).join("/");

/** Keeps the file inside the upload dir and makes the name @-referenceable. */
function safeUploadName(raw: unknown): string {
  const base = path.basename(String(raw ?? "").replace(/\\/g, "/")).trim();
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(-120);
  return cleaned || `upload-${Date.now()}`;
}

/** Writes with O_EXCL so an existing file or symlink is never overwritten. */
function writeUpload(name: string, body: Buffer): string {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length) || "file";
  for (let counter = 0; counter < 1000; counter += 1) {
    const candidate = counter === 0 ? name : `${stem}-${counter}${ext}`;
    try {
      fs.writeFileSync(path.join(UPLOAD_DIR, candidate), body, { flag: "wx" });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not find a free name for the upload.");
}

function listUploads(): UploadedFile[] {
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    return fs
      .readdirSync(UPLOAD_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
      .map((entry) => {
        const file = path.join(UPLOAD_DIR, entry.name);
        const stat = fs.statSync(file);
        return {
          name: entry.name,
          path: toPosix(path.relative(cwd, file)),
          url: `${UPLOAD_URL_PREFIX}/${encodeURIComponent(entry.name)}`,
          size: stat.size,
          mtime: stat.mtimeMs,
        };
      })
      .sort((left, right) => right.mtime - left.mtime);
  } catch {
    return [];
  }
}

/**
 * Rewrites `@photo.png` into `@public/easy-fancy-uploads/photo.png` when the
 * name matches an uploaded file. Anything else is left exactly as typed.
 */
function expandUploadRefs(prompt: string): string {
  if (!prompt.includes("@")) return prompt;
  const byName = new Map(listUploads().map((file) => [file.name, file]));
  if (byName.size === 0) return prompt;
  return prompt.replace(/@([A-Za-z0-9][^\s@]*)/g, (match, token: string) => {
    const trimmed = token.replace(/[.,;:!?]+$/, "");
    const file = byName.get(trimmed);
    if (!file) return match;
    return `@${file.path}${token.slice(trimmed.length)}`;
  });
}

app.get("/api/uploads", (_req: Request, res: Response) => {
  res.json({
    dir: toPosix(path.relative(cwd, UPLOAD_DIR)) || UPLOAD_DIR,
    files: listUploads(),
  });
});

app.post(
  "/api/upload",
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  (req: Request, res: Response) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (body.length === 0) {
      res.status(400).json({ error: "The uploaded file is empty." });
      return;
    }
    if (body.length > MAX_UPLOAD_BYTES) {
      res.status(413).json({ error: "Files must be 64 MB or smaller." });
      return;
    }

    try {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      const name = writeUpload(safeUploadName(req.query.name), body);
      const file = path.join(UPLOAD_DIR, name);
      const stat = fs.statSync(file);
      res.json({
        ok: true,
        file: {
          name,
          path: toPosix(path.relative(cwd, file)),
          url: `${UPLOAD_URL_PREFIX}/${encodeURIComponent(name)}`,
          size: stat.size,
          mtime: stat.mtimeMs,
        } satisfies UploadedFile,
      });
    } catch (error: unknown) {
      res.status(500).json({
        error:
          error instanceof Error ? error.message : "Could not save the file.",
      });
    }
  },
);

// ------------------------------------------------------------------- scenes

type SceneInfo = {
  id: string;
  index: number;
  chapter: string;
  name: string;
  title: string;
  accent: string;
  surface: string;
};

type TransitionInfo = {
  from: number;
  to: number;
  kind: string;
  label: string;
};

type ScenePayload = {
  scenes: SceneInfo[];
  source: string | null;
  transitions: TransitionInfo[];
  transitionSource: string | null;
  error?: string;
};

let sceneCache: { stamp: number; payload: ScenePayload } | null = null;
let scenePending: Promise<ScenePayload> | null = null;

const SCENE_SCAN = path.join(SKILL_DIR, "server", "scan-scenes.ts");
const TSX_CLI = path.join(SKILL_DIR, "node_modules", "tsx", "dist", "cli.mjs");

/**
 * The registry's scene modules import the site's own aliases (`@/...`), so the
 * import runs in a child tsx process whose cwd is the project. That lets tsx
 * pick up the project's tsconfig instead of this skill's.
 */
function scanScenes(): Promise<ScenePayload> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [TSX_CLI, SCENE_SCAN],
      { cwd, timeout: 30_000, maxBuffer: 2_000_000, env: process.env },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            scenes: [],
            source: null,
            transitions: [],
            transitionSource: null,
            error: stderr.trim() || error.message,
          });
          return;
        }
        const lastLine =
          stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .pop() ?? "";
        try {
          const payload = JSON.parse(lastLine) as ScenePayload;
          if (!Array.isArray(payload.scenes)) {
            throw new Error("Invalid scene payload");
          }
          resolve(payload);
        } catch {
          resolve({
            scenes: [],
            source: null,
            transitions: [],
            transitionSource: null,
            error: "Could not parse the scene scan output.",
          });
        }
      },
    );
  });
}

/**
 * Reads the section registry the site itself renders from, caching the result
 * until one of the scene files changes.
 */
async function loadScenes(): Promise<ScenePayload> {
  const sectionDir = path.join(cwd, "src", "sections");
  const registry = ["registry.ts", "registry.tsx", "registry.js"]
    .map((name) => path.join(sectionDir, name))
    .find((file) => fs.existsSync(file));

  if (!registry) {
    return {
      scenes: [],
      source: null,
      transitions: [],
      transitionSource: null,
      error: "No src/sections/registry.ts found in the working directory.",
    };
  }

  const source = path.relative(cwd, registry);
  const files = [registry];

  // The transition names come from render-pipeline.ts, so edits there should
  // invalidate the cache too.
  for (const name of ["render-pipeline.ts", "render-pipeline.tsx"]) {
    const pipeline = path.join(cwd, "src", "lib", name);
    if (fs.existsSync(pipeline)) files.push(pipeline);
  }

  try {
    for (const entry of fs.readdirSync(sectionDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const name of ["scene.ts", "scene.tsx"]) {
        const candidate = path.join(sectionDir, entry.name, name);
        if (fs.existsSync(candidate)) files.push(candidate);
      }
    }
  } catch {
    /* registry alone is enough */
  }

  let stamp: number;
  try {
    stamp = Math.max(...files.map((file) => fs.statSync(file).mtimeMs));
  } catch (error: unknown) {
    return {
      scenes: [],
      source,
      transitions: [],
      transitionSource: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (sceneCache && sceneCache.stamp === stamp) return sceneCache.payload;

  if (!scenePending) {
    scenePending = scanScenes()
      .then((payload) => {
        sceneCache = { stamp, payload };
        return payload;
      })
      .finally(() => {
        scenePending = null;
      });
  }
  return scenePending;
}

app.get("/api/scenes", async (_req: Request, res: Response) => {
  try {
    res.json(await loadScenes());
  } catch (error: unknown) {
    res.status(500).json({
      scenes: [],
      source: null,
      transitions: [],
      transitionSource: null,
      error: error instanceof Error ? error.message : "Could not read scenes.",
    });
  }
});

// ------------------------------------------------------------------ socket

io.on("connection", (socket) => {
  const info: ConnectionInfo = {
    cwd,
    previewUrl,
    agent: defaultAgent,
    agents: [...AGENTS],
    model: defaultModel,
    mode: defaultMode,
    production,
    running: Boolean(active),
  };
  socket.emit("connection", info);

  socket.on("run", (payload: RunPayload, ack?: RunAck) => {
    if (active) {
      ack?.({ error: "A run is already in progress. Stop it first." });
      return;
    }

    const prompt = String(payload?.prompt ?? "").trim();
    if (prompt.length > 200_000) {
      ack?.({ error: "Prompt is too long." });
      return;
    }
    const prepared = prepareAttachments(payload?.attachments);
    if (prepared.error) {
      ack?.({ error: prepared.error });
      return;
    }
    if (!prompt && prepared.attachments.length === 0) {
      prepared.cleanup();
      ack?.({ error: "Prompt is empty." });
      return;
    }
    // `@photo.png` becomes the cwd-relative path of the uploaded file.
    const expandedPrompt = expandUploadRefs(prompt);

    const requestedPermission =
      typeof payload.permissionMode === "string"
        ? payload.permissionMode
        : defaultMode;
    const mode: PermissionMode = MODES.has(
      requestedPermission as PermissionMode,
    )
      ? (requestedPermission as PermissionMode)
      : defaultMode;
    const requestedAgent =
      typeof payload.agent === "string" ? payload.agent : defaultAgent;
    const agent: AgentKind = AGENTS.has(requestedAgent as AgentKind)
      ? (requestedAgent as AgentKind)
      : defaultAgent;
    const model = sanitizeModel(payload.model ?? defaultModel);
    const requestedSession =
      typeof payload.sessionId === "string" ? payload.sessionId : "";
    // Claude requires a UUID; Codex and OpenCode use their own session ids.
    const resume =
      isSessionId(requestedSession) &&
      (agent !== "claude" || UUID_RE.test(requestedSession));
    const sessionId = resume ? requestedSession : randomUUID();

    ack?.({ ok: true, sessionId });
    socket.emit("harness", {
      type: "run",
      agent,
      sessionId,
      cwd,
      model,
      mode,
    } satisfies HarnessEvent);

    const run = startHarnessRun({
      agent,
      prompt: expandedPrompt,
      attachments: prepared.attachments,
      cwd,
      sessionId,
      resume,
      model,
      mode,
      send: (event) => socket.emit("harness", event),
      onClose: () => {
        prepared.cleanup();
        if (active?.socket === socket) active = null;
      },
    });
    active = { socket, cancel: run.cancel };
  });

  socket.on("stop", () => {
    if (active?.socket === socket) active.cancel();
  });

  // A closed tab should stop the work, not leave it running unseen.
  socket.on("disconnect", () => {
    if (active?.socket === socket) active.cancel();
  });
});

// ------------------------------------------------------------------ assets

if (production) {
  const dist = path.join(SKILL_DIR, "dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    fail("dist/ is missing. Run `npm run build` before `npm start -- --prod`.");
  }
  // The skill lives under a dot directory (.claude), and send/sendFile treats
  // dot segments as hidden files. Read the shell once and serve it directly.
  const indexHtml = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  app.use(express.static(dist, { dotfiles: "allow" }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.type("html").send(indexHtml);
  });
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: SKILL_DIR,
    appType: "spa",
    server: {
      middlewareMode: true,
      // The skill UI is not edited while in use; skipping HMR keeps Express
      // as the only process owning the socket.
      hmr: false,
    },
  });
  app.use(vite.middlewares);
}

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(error as Error);
  const type =
    typeof error === "object" && error !== null
      ? (error as { type?: string }).type
      : undefined;
  if (type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON body." });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "Internal server error." });
});

// ------------------------------------------------------------------- boot

const server = httpServer.listen(port, host, () => {
  const address = `http://${host}:${port}`;
  console.log("");
  console.log("  easy-fancy");
  console.log(`  ${address}`);
  console.log(`  cwd      ${cwd}`);
  console.log(`  preview  ${previewUrl}`);
  console.log(
    `  agent    ${defaultAgent}${
      agentSource === "host" ? " (host harness)" : ""
    }  ·  mode ${defaultMode}${defaultModel ? `  ·  model ${defaultModel}` : ""}`,
  );
  console.log(
    `  stack    express + vite + react${production ? " (production)" : " (dev)"}`,
  );
  console.log("");

  getHarnessVersion(defaultAgent).then((version) => {
    if (version) {
      console.log(`  harness  ${AGENT_META[defaultAgent].label} ${version}\n`);
    }
  });

  if (!options["no-open"]) openBrowser(address);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    fail(`Port ${port} is already in use. Try --port 7788.`);
  }
  fail(error.message);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    active?.cancel();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}

// ----------------------------------------------------------------- helpers

function parseArgs(argv: string[]): Options {
  const parsed: Options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [key, inline] = arg.slice(2).split("=");
    if (key === "no-open" || key === "help" || key === "prod") {
      parsed[key] = true;
      continue;
    }
    const value = inline !== undefined ? inline : argv[index + 1];
    if (inline === undefined) index += 1;
    parsed[key] = value;
  }
  return parsed;
}

function printHelp(): void {
  console.log(`easy-fancy — chat + live preview for the host Claude Code harness

Usage:
  npm start [-- options]
  node --import tsx server/index.ts [options]

Options:
  --cwd <dir>        Directory prompts run in (default: $PWD)
  --preview <url>    Site shown in the preview pane (default: http://localhost:3000)
  --port <n>         Port to listen on (default: 7777)
  --host <addr>      Interface to bind (default: 127.0.0.1)
  --agent <name>     claude | codex | opencode | pi | hermes | openclaw
                     (default: same as the host harness, else claude)
  --model <alias>    Default model (Claude aliases, or provider/model for other agents)
  --mode <mode>      acceptEdits | plan | bypassPermissions
  --prod             Serve the built UI from dist/ instead of Vite dev
  --no-open          Do not open a browser
  --help             Show this message
`);
}

/**
 * Markers each agent CLI exports into the shell it runs. When easy-fancy is
 * started from one of these CLIs, default to that same agent so the chat
 * mirrors the host harness; an explicit --agent always wins. The list lives
 * inside the function because it runs at module top level, before later
 * module-level consts are initialized.
 */
function detectHostAgent(): AgentKind | null {
  const markers: Array<[AgentKind, string[]]> = [
    ["claude", ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"]],
    [
      "codex",
      ["CODEX_SANDBOX", "CODEX_SANDBOX_NETWORK_DISABLED", "CODEX_THREAD_ID"],
    ],
    ["opencode", ["OPENCODE", "OPENCODE_SESSION_ID"]],
    ["hermes", ["HERMES_AGENT", "HERMES_SESSION_ID"]],
    ["pi", ["PI_CODING_AGENT", "PI_SESSION_ID", "PI_CODING_AGENT_DIR"]],
    [
      "openclaw",
      ["OPENCLAW_AGENT_ID", "OPENCLAW_SESSION_ID", "OPENCLAW_RUN_ID"],
    ],
  ];
  for (const [agent, keys] of markers) {
    if (keys.some((key) => Boolean(process.env[key]))) return agent;
  }
  return null;
}

function sanitizeModel(value: unknown): string {
  const model = String(value ?? "").trim();
  // OpenCode models are addressed as provider/model; keep the slash but never
  // allow a leading dash or whitespace to smuggle in another CLI flag.
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,119}$/.test(model) ? model : "";
}

/** Accepts Claude UUIDs, Codex thread ids, OpenCode `ses_…` and Hermes ids. */
function isSessionId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:\-]{0,127}$/.test(value);
}

function getHarnessVersion(agent: AgentKind): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      AGENT_META[agent].binary,
      ["--version"],
      { timeout: 5000 },
      (error, stdout) => {
        resolve(error ? "" : stdout.trim().split("\n")[0]);
      },
    );
  });
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(command, args, () => {
    /* best effort */
  });
}

function fail(message: string): never {
  console.error(`easy-fancy: ${message}`);
  process.exit(1);
}

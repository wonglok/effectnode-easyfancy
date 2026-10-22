---
name: easy-fancy
description: >-
  Spin up easy-fancy, a local chat + live-preview web UI for local coding
  agents (Claude Code, Codex, OpenCode, Pi, Hermes or OpenClaw). The left pane
  streams the agent's
  answer, thinking, tool calls
  and cost through Socket.IO; the right pane embeds the site you are building
  and reloads it after each turn. Use this whenever the user wants a local
  chat or web interface for Claude, asks to "spin up the fancy UI", names
  easy-fancy, wants to run prompts from a browser or second screen next to
  their website, demo Claude Code to someone, or would rather type into a
  polished page than a terminal — even if they never say "skill" or "web UI".
---

# easy-fancy

A local workspace for the coding agents already installed on this machine —
Claude Code, Codex or OpenCode. One process serves a chat on the left and a
live preview of the project on the right. Every message becomes a real
headless run of the **selected agent** in the project directory, so tools,
skills, `CLAUDE.md`, MCP servers and auth behave exactly as they do in the
terminal.

Built with TypeScript throughout:

```
easy-fancy/
├── SKILL.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── server/
│   ├── index.ts        Express + Socket.IO + Vite middleware
│   └── harness.ts      adapters for claude/codex/opencode, one event vocabulary
└── src/
    ├── main.tsx        React 19 + BrowserRouter
    ├── App.tsx         routes: / (split), /chat, /preview
    ├── components/     ChatPanel, MessageList, Message, ToolCard,
    │                   Thinking, Composer, PreviewPanel
    ├── store/chat.ts   zustand store + stream reducer
    ├── lib/            socket.io client, markdown, tool formatting
    ├── types.ts
    └── styles.css
```

## Start it

Install once, then run it from the project the prompts should operate in.
`<skill>` is this skill's folder.

```bash
cd <skill> && npm install
npm start -- --cwd "$PWD" --preview http://localhost:3000 --agent claude --mode acceptEdits
```

`--agent claude` and `--mode acceptEdits` are the defaults: prompts run through
Claude Code and may edit files in the project without asking, while shell
commands that need approval are denied. Either can be changed in the UI while
the server runs.

It prints a banner, opens the browser on macOS, and serves
<http://127.0.0.1:7777>. In Claude Code, start it in the background so the
session stays usable, then give the user the URL. Use `--no-open` on headless
machines or when a browser should not pop up.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--cwd <dir>` | `$PWD` | Directory every prompt runs in |
| `--preview <url>` | `http://localhost:3000` | Site embedded in the right pane |
| `--port <n>` | `7777` | Listen port |
| `--host <addr>` | `127.0.0.1` | Bind address; keep it loopback |
| `--agent <name>` | host harness | `claude`, `codex`, `opencode`, `pi`, `hermes`, `openclaw` |
| `--model <alias>` | agent default | `opus`/`sonnet`/`haiku`, a Codex model, or `provider/model` |
| `--mode <mode>` | `acceptEdits` | `acceptEdits`, `plan`, `bypassPermissions` |
| `--prod` | off | Serve `dist/` instead of Vite dev |
| `--no-open` | off | Do not open a browser |

`npm run build` produces `dist/` for `npm start -- --prod`.

## Agents

| Agent | CLI | Non-interactive mode | Sessions |
| --- | --- | --- | --- |
| Claude Code | `claude` | `stream-json` | `--session-id` / `--resume <uuid>` |
| Codex | `codex` | `exec --json` | thread id, `codex exec resume <id>` |
| OpenCode | `opencode` | `run --format json` | `ses_…`, `--session <id>` |
| Pi | `pi` | `-p --mode json` | session file under `$TMPDIR/easy-fancy-pi` |
| Hermes | `hermes` | `chat --format stream-json` | session id, `--resume <id>` |
| OpenClaw | `openclaw` | `agent --json` | `--session-id <id>` |

The default agent follows the **host harness**: easy-fancy reads the CLI
markers in its environment (`CLAUDECODE`, `CODEX_*`, `OPENCODE*`, `PI_*`,
`HERMES_*`, `OPENCLAW_*`) and selects the same agent, falling back to Claude
Code. `--agent` overrides it.

The adapter translates each CLI's native events into one vocabulary, so
thinking, tool cards, results, usage and costs look the same in the chat no
matter which agent ran. Switching the agent in the UI starts a new thread
because session ids are agent-specific. Models are free text: `opus` for
Claude, a Codex model name, `provider/model` for OpenCode or Pi, and whatever
the CLI accepts for Hermes/OpenClaw.

OpenClaw runs agent turns through its gateway, with an embedded fallback when
the gateway is down. It uses the workspace configured for the selected
OpenClaw agent (default `~/.openclaw/workspace`) rather than the preview's
project directory.

## The page

- **Left: chat.** Streaming assistant text, collapsible thinking, expandable
  tool cards with input and result, per-turn cost and duration, agent, model
  and permission selectors, new chat, stop.
- **Prompt queue.** The composer is also a queue: pressing <kbd>↵</kbd> while a
  run is in flight stores the prompt (and any attached images) instead of
  rejecting it. The strip above the composer lists queued prompts with
  reorder, remove and clear controls; the oldest one starts automatically
  ~450 ms after the active run ends. `New` clears the queue, and a queue that
  was waiting while the socket was down resumes on reconnect.
- **File uploads.** The **File** button, drag-and-drop onto the composer, or a
  pasted non-image uploads the file byte-for-byte to
  `<cwd>/public/easy-fancy-uploads/` (64 MB max, names sanitized, collisions
  get `-1`, `-2`). The `@name` reference is inserted into the draft; typing `@`
  opens a filterable list of uploads, and <kbd>↵</kbd>/<kbd>Tab</kbd> picks
  one. The server rewrites `@photo.png` to `@public/easy-fancy-uploads/photo.png`
  before the agent sees the prompt, so the same token works for any agent.
- **Images.** Paste an image into the composer (⌘V / Ctrl+V) or use the
  **Image** button to pick files. Up to 6 PNG/JPEG/WebP/GIF images, 8 MB each
  and 20 MB total, are shown as thumbnails and sent with the prompt. The
  adapter hands them to the CLI natively: Claude (stream-json image blocks),
  Codex (`--image`), OpenCode (`--file`), Pi (`@path` argv references) and
  Hermes (`--image`). OpenClaw's agent turn has no image flag, so the file
  paths are listed in its message instead.
- **Bottom of the chat: an iMovie-style timeline.** When the working directory
  has `src/sections/registry.ts`, the strip lists the site's real chapters
  (`scene 01`, transition, `scene 02`, …) using their names, titles and accent
  colors. The transition tiles are named from `src/lib/render-pipeline.ts` —
  `liquid`, `melt` or `page curl` — so the strip mirrors what the shader
  actually does. Clicking a scene scrubs the embedded site to that chapter;
  the site listens for the `easy-fancy` / `scroll-to-scene` message and calls
  its own `goTo(index)`, keeping the virtual scroller in sync. Clicking a scene
  also prefills the composer with `for the scene N, please: `. Clicking a
  transition tile prefills `for the transition N, please: ` and plays that
  handoff in the preview from its first frame to its last (`previewTransition`
  eases the virtual scroll across the blend), with the caret left at the end.
  Without a registry the strip falls back to one clip per conversation turn,
  sized by duration, and clicks scroll the transcript. The strip follows the
  newest clip as the conversation grows; an empty conversation shows a ghost
  reel.
- **Right: live preview.** An iframe of `--preview`, with a URL field,
  reload, "Auto" (reload after each turn, on by default), Desktop/Tablet/Mobile
  widths, and open-in-new-tab. The preview refreshes ~0.7 s after a turn ends
  so the user sees edits land.
- **Routes (React Router).** `/` is the split workspace, `/preview` is a
  focused preview (the chat header shows a Preview button on narrow screens),
  `/chat` is the chat alone. Unknown paths redirect to `/`.
- **State (zustand).** One store owns messages, session, streaming, model,
  mode, preview URL, auto-reload and the preview refresh counter. Tool events
  and text deltas are batched (~45 ms) before committing so long answers do not
  re-render per token.
- **Session continuity.** The first turn creates a Claude session; later turns
  send `sessionId` and the server resumes it with `--resume`. **New** starts a
  fresh session.
- **Stop** (`Esc`) cancels the whole child process group, not just the socket.

## How it works

```
Browser ──socket.io──▶ Express + Socket.IO ──spawn──▶ claude -p
   ▲                         │                       (stream-json)
   └──────"harness" events───┘◀──────────────────────────┘
```

- `server/index.ts` builds an Express app, wraps it in `node:http`, attaches
  Socket.IO, and in dev mounts Vite in middleware mode (HMR off, because the
  skill UI is not being edited while in use). In `--prod` it serves `dist/`.
- On `run`, the server validates the prompt/mode/session, emits a `run` event,
  and spawns `claude -p --output-format stream-json --verbose
  --include-partial-messages --permission-mode <mode>` with the prompt on stdin.
- `server/harness.ts` parses stream-json lines and emits normalized events:
  `run`, `init`, `status`, `block`, `text`, `thinking`, `tool`,
  `tool_result`, `usage`, `result`, `error`, `done`.
- One run at a time. A second `run` is rejected with an ack error; a
  disconnect, a closed tab, or `stop` kills the process group.
- `GET /api/health` (Express) supplies `cwd`, the default preview URL, model
  and mode on load.
- `GET /api/uploads` lists `public/easy-fancy-uploads`; `POST /api/upload?name=…`
  takes the raw file body (`application/octet-stream`) and returns the stored
  name, cwd-relative path and preview URL.
- `GET /api/scenes` runs `server/scan-scenes.ts` in a child `tsx` process with
  the project as `cwd` (so the site's `@/...` aliases resolve), imports
  `SECTIONS` from the section registry, and parses the page-curl/melt index
  pairs out of `src/lib/render-pipeline.ts`. It returns the scenes plus one
  transition per adjacent pair and caches the result until a registry, scene
  or pipeline file changes.

## Permission modes

| UI label | Flag | Behavior |
| --- | --- | --- |
| Edit files | `acceptEdits` | File edits apply without prompting. Other tools that would prompt are denied. |
| Plan only | `plan` | Read-only: explores and plans, makes no changes. |
| Full access | `bypassPermissions` + `--dangerously-skip-permissions` | Every tool runs without asking, including shell commands. |

Mapped onto each CLI:

| Agent | `acceptEdits` | `plan` | `bypassPermissions` |
| --- | --- | --- | --- |
| Claude Code | `--permission-mode acceptEdits` | `--permission-mode plan` | `--dangerously-skip-permissions` |
| Codex | `--sandbox workspace-write` | `--sandbox read-only` | `--dangerously-bypass-approvals-and-sandbox` |
| OpenCode | `build` agent | `--agent plan` | `--auto` |
| Pi | default tools | `--tools read,grep,find,ls` | default tools |
| Hermes | configured toolsets | `-t web` | `--yolo` |
| OpenClaw | agent exec policy | agent exec policy | agent exec policy |

Pi and OpenClaw have no separate full-access flag, so their `acceptEdits` and
`bypassPermissions` invocations are the same; OpenClaw's approvals live in its
own exec policy.

Default to **Edit files**. Never change that default; the UI asks for
confirmation before enabling full access. Prompts run with the selected
agent's own login and filesystem access, so treat the URL as sensitive: bind
to `127.0.0.1`, do not tunnel or expose it on a network interface, and stop
the server when finished.

## Operating notes

- Verify the selected agent's CLI is on `PATH` (`claude --version`,
  `codex --version`, `opencode --version`, `pi --version`, `hermes --version`,
  `openclaw --version`) before launching. The server inherits the current
  environment, which is what makes each agent's auth work.
- Pi uses its configured default model when the Model field is empty; if that
  points at a local server (e.g. LM Studio) which is not running, set a model
  in the UI. OpenClaw likewise uses the model configured for its agent.
- The preview site must be running before it can be shown. If the user's dev
  server is on another port, pass `--preview` or edit the URL in the preview
  toolbar (persisted in `localStorage`).
- If port 7777 is taken, pass `--port 7788` and use the printed URL.
- Leave the server running while the user works. Stop it with the background
  task controls or `Ctrl‑C`; it stops any active run on `SIGINT`/`SIGTERM`.
- `node_modules/` and `dist/` are gitignored inside the skill.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Every run errors with "`claude` / `codex` / `opencode` was not found" | Start the server from a shell where that CLI's `--version` works, or fix `PATH`. |
| Status shows "Not connected to the easy-fancy server" | Socket.IO did not connect; check the server log and that the port is reachable. |
| `EADDRINUSE` | Use `--port 7788`. |
| Preview shows the wrong site or refuses to embed | Set `--preview` / the toolbar URL. Some sites send `X-Frame-Options`; use the open-in-tab button. |
| Clicking a scene does not move the preview | The embedded site must handle the `easy-fancy` / `scroll-to-scene` message (this project does in `src/components/Landing.tsx`). For another site, add the listener there or use its URL hash instead. |
| Turn ends with denied tool messages | The permission mode blocks it; switch deliberately to Edit files or Full access. |
| Vite dev UI looks stale | It has no HMR by design; reload the page. |
| Production page 500s | Run `npm run build` before `npm start -- --prod`. |

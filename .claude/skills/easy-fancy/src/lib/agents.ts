import type { AgentKind } from "../types";

export const AGENT_OPTIONS: Array<{ id: AgentKind; label: string }> = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "OpenCode" },
  { id: "pi", label: "Pi" },
  { id: "hermes", label: "Hermes" },
  { id: "openclaw", label: "OpenClaw" },
];

export const AGENT_LABELS: Record<AgentKind, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
  hermes: "Hermes",
  openclaw: "OpenClaw",
};

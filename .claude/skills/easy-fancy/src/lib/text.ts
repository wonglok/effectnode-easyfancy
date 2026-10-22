/** Small helpers for presenting tool calls. */

export function summariseTool(input: Record<string, unknown>): string {
  if (!input || typeof input !== "object") return "";
  const order = [
    "file_path",
    "notebook_path",
    "path",
    "command",
    "pattern",
    "query",
    "url",
    "skill",
    "description",
    "prompt",
  ];
  for (const key of order) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      const prefix = key === "command" ? "$ " : "";
      return truncate(prefix + value.replace(/\s+/g, " "), 110);
    }
  }
  return "";
}

export function prettyTool(input: Record<string, unknown>): string {
  if (!input || (typeof input === "object" && !Object.keys(input).length)) {
    return "(no input)";
  }
  try {
    return truncate(JSON.stringify(input, null, 2), 6000);
  } catch {
    return String(input);
  }
}

export function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

export function truncate(value: string, limit: number): string {
  const text = String(value);
  return text.length > limit
    ? `${text.slice(0, limit)}\n… ${text.length - limit} more characters`
    : text;
}

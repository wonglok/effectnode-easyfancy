import { prettyTool, stripAnsi, summariseTool, truncate } from "../lib/text";
import type { ToolCall } from "../types";

type Props = { tool: ToolCall };

export default function ToolCard({ tool }: Props) {
  return (
    <details className="tool" data-error={tool.isError ? "true" : "false"}>
      <summary className="toolHead">
        <span className="toolName">{tool.name}</span>
        <span className="toolArg">{summariseTool(tool.input)}</span>
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </summary>
      <div className="toolBody">
        <div className="toolSection">
          <span className="toolLabel">Input</span>
          <pre>{prettyTool(tool.input)}</pre>
        </div>
        <div className="toolSection">
          <span className="toolLabel">
            {tool.pending ? "Running" : "Result"}
          </span>
          <pre>
            {tool.pending
              ? "Waiting for the tool…"
              : truncate(stripAnsi(tool.result || "(empty)"), 12000)}
          </pre>
        </div>
      </div>
    </details>
  );
}

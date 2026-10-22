import { AGENT_LABELS } from "../lib/agents";
import { renderMarkdown } from "../lib/markdown";
import type { ChatMessage } from "../types";
import Thinking from "./Thinking";
import ToolCard from "./ToolCard";

type Props = {
  message: ChatMessage;
  streaming: boolean;
};

export default function Message({ message, streaming }: Props) {
  if (message.role === "user") {
    return (
      <div className="msg user" id={`msg-${message.id}`}>
        <div className="userBubble">
          {message.attachments && message.attachments.length > 0 && (
            <div className="userAttachmentGrid">
              {message.attachments.map((attachment) => (
                <img
                  key={attachment.id}
                  src={attachment.dataUrl}
                  alt={attachment.name}
                  title={attachment.name}
                />
              ))}
            </div>
          )}
          {message.text}
        </div>
      </div>
    );
  }

  const hasAnswer = Boolean(message.text) || message.tools.length > 0;

  return (
    <div className="msg assistant" id={`msg-${message.id}`}>
      <div className="assistantHead">
        <span className="pip" aria-hidden="true" />
        <span>{AGENT_LABELS[message.agent]}</span>
      </div>

      {message.thinking && (
        <Thinking text={message.thinking} collapsed={hasAnswer} />
      )}

      {message.tools.length > 0 && (
        <div className="toolStack">
          {message.tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}

      {message.text && (
        <div
          className="md"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }}
        />
      )}

      {streaming && <span className="streamCursor" aria-hidden="true" />}

      {message.stopped && <div className="note">Stopped.</div>}
      {message.error && <div className="errorNote">{message.error}</div>}

      {(message.costUsd != null || message.durationMs != null) && (
        <div className="turnFoot">
          {message.costUsd != null && (
            <span>${message.costUsd.toFixed(4)}</span>
          )}
          <span className="rule" />
          {message.durationMs != null && (
            <span>{(message.durationMs / 1000).toFixed(1)}s</span>
          )}
        </div>
      )}
    </div>
  );
}

import { useLayoutEffect, useRef } from "react";
import { useChat } from "../store/chat";
import Message from "./Message";

const SUGGESTIONS = [
  "Explain this project and how the main pieces fit together.",
];

export default function MessageList() {
  const messages = useChat((state) => state.messages);
  const running = useChat((state) => state.running);
  const setDraft = useChat((state) => state.setDraft);
  const listRef = useRef<HTMLElement | null>(null);
  const stickToBottom = useRef(true);

  useLayoutEffect(() => {
    const element = listRef.current;
    if (element && stickToBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages]);

  const handleScroll = (): void => {
    const element = listRef.current;
    if (!element) return;
    stickToBottom.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 150;
  };

  const pick = (text: string): void => {
    setDraft(text);
    document.getElementById("composer-input")?.focus();
  };

  return (
    <section
      className="thread"
      ref={listRef}
      onScroll={handleScroll}
      aria-live="polite"
    >
      {messages.length === 0 ? (
        <div className="empty">
          <p className="eyebrow">The harness, on a page</p>
          <h1>
            Update <em>anything.</em>
          </h1>
          <p className="emptySub">
            Your prompt runs in this project with the same agent session, tools
            and auth as your terminal — streamed here, with the site rebuilding
            on the right.
          </p>
          <div className="chips">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="chip"
                onClick={() => pick(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : (
        messages.map((message, index) => (
          <Message
            key={message.id}
            message={message}
            streaming={
              running &&
              index === messages.length - 1 &&
              message.role === "assistant"
            }
          />
        ))
      )}
    </section>
  );
}

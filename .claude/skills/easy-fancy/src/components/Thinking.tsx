import { useEffect, useRef } from "react";

type Props = { text: string; collapsed: boolean };

/** A collapsible reasoning block that folds away once the answer starts. */
export default function Thinking({ text, collapsed }: Props) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    if (detailsRef.current) detailsRef.current.open = !collapsed;
  }, [collapsed]);

  return (
    <details className="thinking" ref={detailsRef}>
      <summary>Thinking</summary>
      <div className="thinkingText">{text}</div>
    </details>
  );
}

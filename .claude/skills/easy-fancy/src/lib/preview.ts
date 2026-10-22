/**
 * Navigation for the embedded site.
 *
 * The preview runs on another origin, so the chat cannot touch its DOM. The
 * site's Landing component listens for these messages and drives its own
 * virtual scroller, which keeps the chapter offsets and shader transitions in
 * sync instead of jumping the browser scroll position.
 */
export type SceneScrollMessage = {
  source: "easy-fancy";
  type: "scroll-to-scene";
  index: number;
};

export type TransitionPreviewMessage = {
  source: "easy-fancy";
  type: "play-transition";
  /** Zero-based index of the chapter the transition starts from. */
  from: number;
};

type PreviewMessage = SceneScrollMessage | TransitionPreviewMessage;

function postToPreview(message: PreviewMessage): void {
  const frame = document.querySelector<HTMLIFrameElement>(
    "iframe[data-preview-frame]",
  );
  frame?.contentWindow?.postMessage(message, "*");
}

export function scrollPreviewToScene(index: number): void {
  if (!Number.isInteger(index)) return;
  postToPreview({ source: "easy-fancy", type: "scroll-to-scene", index });
}

/** Play the handoff between chapter `from` and `from + 1` from start to end. */
export function playTransitionInPreview(from: number): void {
  if (!Number.isInteger(from)) return;
  postToPreview({ source: "easy-fancy", type: "play-transition", from });
}

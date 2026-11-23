import type { Node, TextureNode } from "three/webgpu";

/**
 * Everything a transition shader needs from the render pipeline. The textures
 * are full-resolution render targets of the outgoing and incoming chapters.
 */
export type TransitionContext = {
  /** Outgoing chapter's beauty/pass texture (top-left origin). */
  from: TextureNode;
  /** Incoming chapter's beauty/pass texture (top-left origin). */
  to: TextureNode;
  /** Eased blend, 0..1. Already smoothstepped by the pipeline. */
  progress: Node<"float">;
  /** Section accent lerped between the two chapters. */
  accent: Node<"color">;
  /** Seconds since start, used by the shared grain. */
  time: Node<"float">;
  /** Shared vignette + grain, applied to every output. */
  finish: (input: Node<"vec4">) => Node<"vec4">;
};

export type TransitionBuilder = (context: TransitionContext) => Node<"vec4">;

import type {
  PerspectiveCamera,
  PassNode,
  Scene,
  TextureNode,
} from "three/webgpu";
import type { SectionPhaseState } from "@/lib/scroll-phases";

export type SectionMeta = {
  id: string;
  index: number;
  chapter: string;
  name: string;
  title: string;
  accent: string;
  surface: string;
};

export type CameraConfig = {
  base: [number, number, number];
  fov: number;
  drift: number;
  orbit: number;
  lookAt?: [number, number, number];
  /**
   * Optional z journey across the section's scroll span: the first chapter at
   * progress 0, the next chapter at progress 1. x/y still follow the base and
   * the pointer, and lookAt stays where the scene wants it.
   */
  travelZ?: { from: number; to: number };
};

export type SceneAnimateArgs = {
  elapsed: number;
  /** Frame delta in seconds, for input smoothing in the camera rig. */
  delta: number;
  /** Enter / animate / exit phase of this section, with its own progress. */
  phase: SectionPhaseState;
};

export type SectionWorld = {
  id: string;
  index: number;
  scene: Scene;
  camera: PerspectiveCamera;
  pass: PassNode;
  /**
   * Optional post-processed beauty texture (e.g. godrays baked through an RTT
   * node). When present the render pipeline composites this instead of the
   * pass' raw output, for both the plain frame and shader transitions.
   */
  beautyNode?: TextureNode;
  animate: (args: SceneAnimateArgs) => void;
  resize: (aspect: number) => void;
  dispose: () => void;
};

export type Section3DProps = {
  onReady: (world: SectionWorld) => void;
  onDispose: (world: SectionWorld) => void;
};

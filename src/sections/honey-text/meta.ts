// Chapter config for the ported r3f-alpha-6 scene. Kept free of browser-only
// imports so the section registry can load it during a server render.
import type { CameraConfig, SectionMeta } from "../types";

export const alpha6Meta: SectionMeta = {
  id: "alpha6",
  index: 5,
  chapter: "06",
  name: "Alpha 6",
  title: "Glass,\nnot pixels.",
  accent: "#4aa8ff",
  surface: "#04101f",
};

/**
 * The ported scene owns its camera pose (one world unit per screen pixel at the
 * target), so this only supplies the lens and a starting position.
 */
export const alpha6Camera: CameraConfig = {
  base: [0, 900, 1500],
  fov: 30,
  drift: 0,
  orbit: 0,
};

// Chapter config for the ported pmndrs `flow-shield` demo. Free of
// browser-only imports so the registry can load it during a server render.
import type { CameraConfig, SectionMeta } from "../types";

export const flowShieldMeta: SectionMeta = {
  id: "flow-shield",
  index: 2,
  chapter: "03",
  name: "Flow Shield",
  title: "Force,\nnot field.",
  accent: "#26aeff",
  surface: "#0e0d0c",
};

export const flowShieldCamera: CameraConfig = {
  base: [8, 5, 8],
  fov: 26,
  drift: 0,
  orbit: 0,
};

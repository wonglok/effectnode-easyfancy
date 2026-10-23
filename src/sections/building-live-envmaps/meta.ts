// Chapter config for the ported pmndrs `building-live-envmaps` demo. Free of
// browser-only imports so the registry can load it during a server render.
import type { CameraConfig, SectionMeta } from "../types";

export const liveEnvMeta: SectionMeta = {
  id: "building-live-envmaps",
  index: 2,
  chapter: "03",
  name: "Live Env",
  title: "Built\nin light.",
  accent: "#c7a6ff",
  surface: "#9b8db4",
};

export const liveEnvCamera: CameraConfig = {
  base: [5, 0, 15],
  fov: 30,
  drift: 0,
  orbit: 0,
};

import type { CameraConfig, SectionMeta } from "../types";

export const monitorsMeta: SectionMeta = {
  id: "monitors",
  index: 5,
  chapter: "06",
  name: "Monitors",
  title: "Old light,\nstill on.",
  accent: "#35c19f",
  surface: "#050607",
};

export const monitorsCamera: CameraConfig = {
  base: [-1.5, 1, 5.5],
  fov: 45,
  drift: 0,
  orbit: 0,
  lookAt: [0, 0, 0],
};

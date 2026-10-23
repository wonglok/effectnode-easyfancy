import type { CameraConfig, SectionMeta } from "../types";

export const rainbowSphereMeta: SectionMeta = {
  id: "rainbow-sphere",
  index: 1,
  chapter: "02",
  name: "Rainbow",
  title: "Light,\nin colour.",
  accent: "#ff8ad1",
  surface: "#05060a",
};

export const rainbowSphereCamera: CameraConfig = {
  base: [0, 0.3, 4.6],
  fov: 40,
  drift: 0,
  orbit: 0,
  lookAt: [0, 0, 0],
};

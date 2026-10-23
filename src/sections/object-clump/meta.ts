import type { CameraConfig, SectionMeta } from "../types";

export const objectClumpMeta: SectionMeta = {
  id: "object-clump",
  index: 1,
  chapter: "02",
  name: "Clump",
  title: "Light,\nin colour.",
  accent: "#ff8ad1",
  surface: "#dfdfdf",
};

export const objectClumpCamera: CameraConfig = {
  base: [0, 0, 20],
  fov: 35,
  drift: 0,
  orbit: 0,
  lookAt: [0, 0, 0],
};

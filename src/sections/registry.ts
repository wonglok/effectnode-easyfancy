import { flowShieldMeta } from "./flow-shield";
import { liveEnvMeta } from "./building-live-envmaps";
import { alpha6Meta } from "./honey-text";
import { kineticMeta } from "./kinetic";
import { rainbowSphereMeta } from "./rainbow-sphere";

export const SECTIONS = [
  kineticMeta,
  rainbowSphereMeta,
  flowShieldMeta,
  liveEnvMeta,
  alpha6Meta,
];
export const SECTION_COUNT = SECTIONS.length;

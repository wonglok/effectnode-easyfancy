import { flowShieldMeta } from "./flow-shield";
import { liveEnvMeta } from "./building-live-envmaps";
import { alpha6Meta } from "./honey-text";
import { kineticMeta } from "./kinetic";
import { objectClumpMeta } from "./object-clump";

export const SECTIONS = [
  kineticMeta,
  objectClumpMeta,
  flowShieldMeta,
  liveEnvMeta,
  alpha6Meta,
];
export const SECTION_COUNT = SECTIONS.length;

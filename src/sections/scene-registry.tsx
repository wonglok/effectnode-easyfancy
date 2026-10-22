"use client";

import { Aether3D } from "./01-aether";
import { Kinetic3D } from "./02-kinetic";
import { Matter3D } from "./03-matter";
import { VrGallery3D } from "./04-vr-gallery";
import { Signal3D } from "./05-signal";

/** 3D components, each owning one scene, camera rig and render target. */
export const SCENE_COMPONENTS = [
  Aether3D,
  Kinetic3D,
  Matter3D,
  VrGallery3D,
  Signal3D,
];

"use client";

import { FlowShield } from "./flow-shield";
import { LiveEnv } from "./building-live-envmaps";
import { Alpha6 } from "./honey-text";
import { Kinetic3D } from "./kinetic";
import { RainbowSphere } from "./rainbow-sphere";

/** 3D components, each owning one scene, camera rig and render target. */
export const SCENE_COMPONENTS = [
  Kinetic3D,
  RainbowSphere,
  FlowShield,
  LiveEnv,
  Alpha6,
];

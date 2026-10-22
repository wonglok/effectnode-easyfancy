"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Section3DProps, SectionWorld } from "../types";
import {
  getSceneTime,
  getSectionActivity,
  getSectionPhase,
} from "../shared/section-activity";
import { makeCamera } from "../shared/scene-utils";
import { createSignalWorld, signalCamera } from "./scene";

/** 3D scene component for chapter 05. */
export function Signal3D({ onReady, onDispose }: Section3DProps) {
  const size = useThree((state) => state.size);
  const camera = useMemo(
    () => makeCamera(signalCamera.base, signalCamera.fov),
    [],
  );
  const worldRef = useRef<SectionWorld | null>(null);

  useEffect(() => {
    const world = createSignalWorld(camera);
    worldRef.current = world;
    onReady(world);

    return () => {
      if (worldRef.current === world) worldRef.current = null;
      onDispose(world);
      world.dispose();
    };
  }, [camera, onReady, onDispose]);

  useEffect(() => {
    if (size.height === 0) return;
    worldRef.current?.resize(size.width / size.height);
  }, [size.width, size.height]);

  useFrame((state, delta) => {
    const world = worldRef.current;
    if (!world) return;
    const influence = getSectionActivity(world.index);
    if (influence <= 0) return;

    world.animate({
      elapsed: getSceneTime(state.clock.elapsedTime),
      delta,
      phase: getSectionPhase(world.index),
    });
  });

  return null;
}

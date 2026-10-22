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
import {
  createMatterFallbackWorld,
  createMatterWorld,
  matterCamera,
} from "./scene";

/** 3D scene component for chapter 03. */
export function Matter3D({ onReady, onDispose }: Section3DProps) {
  const size = useThree((state) => state.size);
  const camera = useMemo(
    () => makeCamera(matterCamera.base, matterCamera.fov),
    [],
  );
  const worldRef = useRef<SectionWorld | null>(null);
  // The async world may finish loading after the size effect has run, so keep
  // the latest canvas size in a ref and apply it when the world mounts.
  const sizeRef = useRef(size);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  useEffect(() => {
    let cancelled = false;
    let world: SectionWorld | null = null;

    const mount = (next: SectionWorld) => {
      if (cancelled) {
        next.dispose();
        return;
      }
      const { width, height } = sizeRef.current;
      if (height > 0) next.resize(width / height);
      world = next;
      worldRef.current = next;
      onReady(next);
    };

    const load = async () => {
      try {
        mount(await createMatterWorld(camera));
      } catch (error) {
        console.warn(
          "Matter island failed to load; using the fallback scene.",
          error,
        );
        if (!cancelled) mount(createMatterFallbackWorld(camera));
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (!world) return;
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

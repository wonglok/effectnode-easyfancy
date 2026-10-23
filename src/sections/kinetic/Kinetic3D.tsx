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
  createKineticFallbackWorld,
  createKineticWorld,
  kineticCamera,
} from "./scene";

/** 3D scene component for chapter 02. */
export function Kinetic3D({ onReady, onDispose }: Section3DProps) {
  const size = useThree((state) => state.size);
  const camera = useMemo(
    () => makeCamera(kineticCamera.base, kineticCamera.fov),
    [],
  );
  const worldRef = useRef<SectionWorld | null>(null);
  // The world loads its flow map asynchronously, so keep the latest canvas
  // size in a ref and apply it when the world mounts.
  const sizeRef = useRef(size);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  useEffect(() => {
    let cancelled = false;

    const mount = (next: SectionWorld) => {
      if (cancelled) {
        next.dispose();
        return;
      }
      const { width, height } = sizeRef.current;
      if (height > 0) next.resize(width / height);
      worldRef.current = next;
      onReady(next);
    };

    const load = async () => {
      try {
        mount(await createKineticWorld(camera));
      } catch (error) {
        console.warn(
          "Jellyfish failed to load; using the fallback scene.",
          error,
        );
        mount(createKineticFallbackWorld(camera));
      }
    };

    void load();

    return () => {
      cancelled = true;
      const world = worldRef.current;
      if (!world) return;
      worldRef.current = null;
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

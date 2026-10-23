"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { WebGPURenderer } from "three/webgpu";
import type { Section3DProps, SectionWorld } from "../types";
import {
  getSceneTime,
  getSectionActivity,
  getSectionPhase,
} from "../shared/section-activity";
import { makeCamera } from "../shared/scene-utils";
import { alpha6Camera } from "./meta";

/** 3D component for chapter 01, the ported r3f-alpha-6 glass scene. */
export function Alpha6({ onReady, onDispose }: Section3DProps) {
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);
  const renderer = gl as unknown as WebGPURenderer;
  const camera = useMemo(
    () => makeCamera(alpha6Camera.base, alpha6Camera.fov),
    [],
  );
  const worldRef = useRef<SectionWorld | null>(null);
  // The scene loads fonts and the studio HDR before mounting, so keep the
  // latest canvas size in a ref and apply it when the world arrives.
  const sizeRef = useRef(size);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  //

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
        // Dynamic so glyph and the scene's browser-only modules never run
        // during a server render.
        const { createAlpha6World } = await import("./scene");
        mount(await createAlpha6World(camera, renderer));
      } catch (error) {
        console.warn(
          "Alpha 6 scene failed to load; using the fallback scene.",
          error,
        );
        const { createAlpha6FallbackWorld } = await import("./scene");
        mount(createAlpha6FallbackWorld(camera));
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
  }, [camera, renderer, onReady, onDispose]);

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

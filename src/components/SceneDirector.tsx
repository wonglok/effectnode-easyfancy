"use client";

import { useCallback, useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { WebGPURenderer } from "three/webgpu";
import {
  SectionRenderPipeline,
  type PipelineState,
} from "@/lib/render-pipeline";
import { SCENE_COMPONENTS } from "@/sections/scene-registry";
import { attachPointerSignal } from "@/sections/shared/section-activity";
import type { SectionWorld } from "@/sections/types";
import {
  reportWorldProgress,
  useScrollerStore,
} from "@/store/useScrollerStore";

/**
 * Thin orchestrator: the 3D components register their scenes here, and
 * this component owns the one WebGPU render pipeline used to composite them.
 * Once every world is present it precompiles all of their shaders, reporting
 * progress for the splash screen.
 */
export function SceneDirector() {
  const gl = useThree((state) => state.gl) as unknown as WebGPURenderer;
  const worldsRef = useRef<Array<SectionWorld | undefined>>([]);
  const pipelineRef = useRef<SectionRenderPipeline | null>(null);
  const bootRef = useRef({ started: false, cancelled: false });
  const bootTimerRef = useRef<number | null>(null);
  const stateRef = useRef<PipelineState>({
    fromIndex: 0,
    toIndex: 0,
    isTransitioning: false,
    progress: 0,
  });

  const rebuildPipeline = useCallback(() => {
    const worlds = worldsRef.current;
    // The array is sparse while async scenes load, and Array.prototype.some()
    // skips holes — check every expected slot explicitly instead.
    const missingWorld = SCENE_COMPONENTS.some(
      (_component, index) => !worlds[index],
    );
    if (worlds.length < SCENE_COMPONENTS.length || missingWorld) {
      return;
    }

    pipelineRef.current?.dispose();
    const pipeline = new SectionRenderPipeline(gl, worlds as SectionWorld[]);
    pipelineRef.current = pipeline;
  }, [gl]);

  const precompile = useCallback(
    async (worlds: SectionWorld[], pipeline: SectionRenderPipeline) => {
      useScrollerStore.getState().setBootPhase("compiling");

      for (let index = 0; index < worlds.length; index += 1) {
        if (bootRef.current.cancelled) return;
        const world = worlds[index];

        if (!gl.initialized) {
          await gl.init();
        }

        await gl.compileAsync(world.scene, world.camera, null, (event) => {
          const fraction = event.total > 0 ? event.loaded / event.total : 0;
          useScrollerStore
            .getState()
            .setPrecompileProgress((index + fraction) / worlds.length);
        });

        useScrollerStore
          .getState()
          .setPrecompileProgress((index + 1) / worlds.length);
      }

      if (bootRef.current.cancelled) return;

      // Compile the composite and transition passes while the splash still
      // covers the canvas.
      pipeline.prewarm();
      useScrollerStore.getState().setBootPhase("ready");
    },
    [gl],
  );

  const schedulePrecompile = useCallback(() => {
    if (bootRef.current.started || bootTimerRef.current !== null) return;
    if (!pipelineRef.current) return;

    const worlds = worldsRef.current;
    const missingWorld = SCENE_COMPONENTS.some(
      (_component, index) => !worlds[index],
    );
    if (worlds.length < SCENE_COMPONENTS.length || missingWorld) return;

    // Give the current mount a beat to settle (StrictMode remounts in dev),
    // then re-check before compiling.
    bootTimerRef.current = window.setTimeout(() => {
      bootTimerRef.current = null;

      const currentWorlds = worldsRef.current;
      const pipeline = pipelineRef.current;
      if (!pipeline) return;
      if (
        currentWorlds.length < SCENE_COMPONENTS.length ||
        SCENE_COMPONENTS.some((_component, index) => !currentWorlds[index])
      ) {
        return;
      }

      bootRef.current.started = true;
      bootRef.current.cancelled = false;
      void precompile(currentWorlds as SectionWorld[], pipeline);
    }, 60);
  }, [precompile]);

  const registerWorld = useCallback(
    (world: SectionWorld) => {
      worldsRef.current[world.index] = world;
      rebuildPipeline();
      const worlds = worldsRef.current;
      const registered = worlds.filter(Boolean).length;
      reportWorldProgress(registered / SCENE_COMPONENTS.length);

      // Each scene hardcodes its `index`; if a section is removed without
      // renumbering the rest, the array gets a hole and the pipeline never
      // builds — the splash would sit at 27% forever. Say so loudly instead.
      if (
        registered === SCENE_COMPONENTS.length &&
        SCENE_COMPONENTS.some((_component, index) => !worlds[index])
      ) {
        console.warn(
          "[SceneDirector] Scene indices are not contiguous 0..N-1:",
          worlds.map((entry, index) => (entry ? index : null)),
          "— renumber the section metas (index + chapter).",
        );
      }

      schedulePrecompile();
    },
    [rebuildPipeline, schedulePrecompile],
  );

  const unregisterWorld = useCallback((world: SectionWorld) => {
    if (worldsRef.current[world.index] !== world) return;
    worldsRef.current[world.index] = undefined;
    pipelineRef.current?.dispose();
    pipelineRef.current = null;

    // A compile in flight is no longer valid; a fresh registration restarts it.
    bootRef.current.cancelled = true;
    bootRef.current.started = false;
    if (bootTimerRef.current !== null) {
      window.clearTimeout(bootTimerRef.current);
      bootTimerRef.current = null;
    }

    reportWorldProgress(
      worldsRef.current.filter(Boolean).length / SCENE_COMPONENTS.length,
    );
    const state = useScrollerStore.getState();
    state.setBootPhase("loading");
    state.setPrecompileProgress(0);
  }, []);

  useEffect(() => attachPointerSignal(), []);

  useEffect(
    () => () => {
      bootRef.current.cancelled = true;
      if (bootTimerRef.current !== null) {
        window.clearTimeout(bootTimerRef.current);
        bootTimerRef.current = null;
      }
      pipelineRef.current?.dispose();
      pipelineRef.current = null;
    },
    [],
  );

  useFrame((r3fState) => {
    const pipeline = pipelineRef.current;
    if (!pipeline) return;

    const scroll = useScrollerStore.getState();
    const state = stateRef.current;
    state.fromIndex = scroll.fromIndex;
    state.toIndex = scroll.toIndex;
    state.isTransitioning = scroll.isTransitioning;
    state.progress = scroll.transitionProgress;

    pipeline.update(state, r3fState.clock.elapsedTime);
    pipeline.render();
  }, 1);

  return (
    <>
      {SCENE_COMPONENTS.map((SceneComponent, index) => (
        <SceneComponent
          key={index}
          onReady={registerWorld}
          onDispose={unregisterWorld}
        />
      ))}
    </>
  );
}

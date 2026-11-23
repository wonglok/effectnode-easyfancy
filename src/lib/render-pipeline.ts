import * as THREE from "three/webgpu";
import { RenderPipeline, type WebGPURenderer } from "three/webgpu";
import { color, screenUV, uniform } from "three/tsl";
import { SECTIONS } from "@/sections/registry";
import type { SectionWorld } from "@/sections/types";
import { selectTransition } from "./transitions";
import { finishNode } from "./transitions/shared";

/**
 * Smoothstep easing applied to every handoff, so both ends of a transition
 * start and finish gently regardless of which shader runs.
 */
function easeInOut(value: number) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

export type PipelineState = {
  fromIndex: number;
  toIndex: number;
  isTransitioning: boolean;
  progress: number;
};

/**
 * Owns the single WebGPU render pipeline.
 *
 * Each pass has its own full-resolution render target. The output graph only
 * references the active pass — or the two passes taking part in a transition —
 * so unused sections are never drawn. Transition shaders live in
 * `./transitions/<id>/`; this class only selects one and feeds it uniforms.
 */
export class SectionRenderPipeline {
  private readonly pipeline: RenderPipeline;
  private readonly worlds: SectionWorld[];
  private readonly uniforms = {
    progress: uniform(0),
    accent: uniform(new THREE.Color(SECTIONS[0].accent)),
    time: uniform(0),
  };
  private activeKey = "";

  constructor(renderer: WebGPURenderer, worlds: SectionWorld[]) {
    this.worlds = worlds;
    this.pipeline = new RenderPipeline(renderer);
    this.pipeline.outputColorTransform = true;
    this.buildOutput(0, 0, false);
  }

  update(state: PipelineState, elapsed: number) {
    const progress = easeInOut(state.progress);
    this.uniforms.progress.value = progress;
    this.uniforms.time.value = elapsed;

    const fromMeta = SECTIONS[state.fromIndex] ?? SECTIONS[0];
    const toMeta = SECTIONS[state.toIndex] ?? fromMeta;
    const p = state.isTransitioning ? progress : 1;
    this.uniforms.accent.value
      .set(fromMeta.accent)
      .lerp(new THREE.Color(toMeta.accent), p);

    const key = `${state.fromIndex}:${state.toIndex}:${state.isTransitioning}`;
    if (key !== this.activeKey) {
      this.buildOutput(state.fromIndex, state.toIndex, state.isTransitioning);
      this.activeKey = key;
    }
  }

  render() {
    this.pipeline.render();
  }

  /**
   * Compiles the plain composite and every consecutive handoff shader while
   * the splash still covers the canvas, so the first scroll blend does not
   * stutter.
   */
  prewarm() {
    const first = this.worlds[0];
    if (!first) return;

    for (let index = 0; index < this.worlds.length - 1; index += 1) {
      const from = this.worlds[index] ?? first;
      const to = this.worlds[index + 1] ?? from;
      this.pipeline.outputNode = this.transitionNode(
        from.beautyNode ?? from.pass.getTextureNode(),
        to.beautyNode ?? to.pass.getTextureNode(),
        index,
        index + 1,
      );
      this.pipeline.needsUpdate = true;
      this.pipeline.render();
    }

    this.buildOutput(0, 0, false);
    this.pipeline.render();
    this.activeKey = "";
  }

  dispose() {
    this.pipeline.dispose();
  }

  private buildOutput(
    fromIndex: number,
    toIndex: number,
    isTransitioning: boolean,
  ) {
    const fromWorld =
      this.worlds[fromIndex] ?? this.worlds.find((world) => world);
    if (!fromWorld) return;
    const toWorld = this.worlds[toIndex] ?? fromWorld;
    const fromTexture = fromWorld.beautyNode ?? fromWorld.pass.getTextureNode();
    const toTexture = toWorld.beautyNode ?? toWorld.pass.getTextureNode();

    const base = isTransitioning
      ? this.transitionNode(fromTexture, toTexture, fromIndex, toIndex)
      : finishNode(fromTexture.sample(screenUV), this.uniforms.time);

    this.pipeline.outputNode = base;
    this.pipeline.needsUpdate = true;
  }

  /** Builds the shader selected by `src/lib/transitions/mapping.ts`. */
  private transitionNode(
    fromTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
    toTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
    fromIndex: number,
    toIndex: number,
  ) {
    const transition = selectTransition(fromIndex, toIndex);
    return transition.build({
      from: fromTexture,
      to: toTexture,
      progress: this.uniforms.progress,
      accent: color(this.uniforms.accent),
      time: this.uniforms.time,
      finish: (input) => finishNode(input, this.uniforms.time),
    });
  }
}

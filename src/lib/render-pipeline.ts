import * as THREE from "three/webgpu";
import { RenderPipeline, type Node, type WebGPURenderer } from "three/webgpu";
import {
  abs,
  acos,
  and,
  atan,
  clamp,
  color,
  cos,
  dot,
  float,
  floor,
  fract,
  interleavedGradientNoise,
  length,
  log,
  max,
  min,
  mix,
  mod,
  mx_fractal_noise_float_2d,
  normalize,
  oneMinus,
  or,
  pow,
  reflect,
  screenCoordinate,
  screenSize,
  screenUV,
  select,
  sign,
  sin,
  smoothstep,
  sqrt,
  step,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { SECTIONS } from "@/sections/registry";
import type { SectionWorld } from "@/sections/types";

const TRANSITION_WIDTH = 0.24;

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
 * so unused sections are never drawn.
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
   * Compiles both output variants while the splash still covers the canvas:
   * the plain composite and the transition shader, so the first scroll blend
   * does not stutter.
   */
  prewarm() {
    const first = this.worlds[0];
    if (!first) return;

    // Compile every consecutive handoff (liquid, directional scale, column
    // melt, page curl) so the first scroll through each pair never hitches.
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
      : this.finishNode(fromTexture.sample(screenUV));

    this.pipeline.outputNode = base;
    this.pipeline.needsUpdate = true;
  }

  /**
   * Picks the handoff shader for a pair of chapters: the ball roll for the
   * first pair (0 ↔ 1), the flash photo drop for the second pair (1 ↔ 2), the
   * cross zoom for the current last pair (3 ↔ 4), plus the page curl, honeycomb
   * grid, column melt and directional scale shaders kept for later chapters if
   * they return, and the liquid-glass wipe elsewhere.
   */
  private transitionNode(
    fromTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
    toTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
    fromIndex: number,
    toIndex: number,
  ) {
    const isBallRollPair =
      (fromIndex === 0 && toIndex === 1) || (fromIndex === 1 && toIndex === 0);
    const isPhotoDropPair =
      (fromIndex === 1 && toIndex === 2) || (fromIndex === 2 && toIndex === 1);
    const isPageCurlPair =
      (fromIndex === 6 && toIndex === 7) ||
      (fromIndex === 7 && toIndex === 6);
    const isCrossZoomPair =
      (fromIndex === 3 && toIndex === 4) || (fromIndex === 4 && toIndex === 3);
    const isDirectionalScalePair =
      (fromIndex === 4 && toIndex === 5) || (fromIndex === 5 && toIndex === 4);

    if (isBallRollPair) {
      return this.ballRollTransitionNode(fromTexture, toTexture);
    }
    if (isPhotoDropPair) {
      return this.photoDropTransitionNode(fromTexture, toTexture);
    }
    if (isPageCurlPair) {
      return this.pageCurlTransitionNode(fromTexture, toTexture);
    }
    if (isCrossZoomPair) {
      return this.crossZoomTransitionNode(fromTexture, toTexture);
    }
    if (isDirectionalScalePair) {
      return this.directionalScaleTransitionNode(fromTexture, toTexture);
    }
    return this.liquidTransitionNode(fromTexture, toTexture);
  }

  /**
   * Honeycomb reveal: the screen is split into hexagonal cells, each flipping
   * to the incoming frame on its own staggered slice of the progress. The
   * honeycomb borders glint while their cell changes over, so the handoff
   * reads as a grid of hexagons rather than a plain dissolve.
   */
  private hexGridTransitionNode(
    fromTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
    toTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
  ) {
    const CELLS = 24;
    const lattice = vec2(1, 1.7320508);
    const half = lattice.mul(0.5);

    const progress = this.uniforms.progress;
    const uv = vec2(screenUV.x, oneMinus(screenUV.y));
    const sampleFrom = (q: Node<"vec2">) =>
      fromTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;
    const sampleTo = (q: Node<"vec2">) =>
      toTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;

    // Square screen units: x is scaled by the viewport aspect, so one unit is
    // the same number of pixels in both directions.
    const aspect = screenSize.x.div(screenSize.y);
    const p = vec2(uv.x.mul(aspect), uv.y).mul(CELLS);

    // Two interleaved lattices; each pixel belongs to the nearest hexagon.
    // The lattice units are not square, so the offsets are compared in the
    // (already aspect-corrected) p space: this is what keeps the cells regular
    // hexagons instead of stretching them vertically by sqrt(3).
    const q = p.div(lattice);
    const a = mod(q, lattice).sub(half);
    const b = mod(q.sub(half), lattice).sub(half);
    const aP = vec2(a.x, a.y.mul(lattice.y));
    const bP = vec2(b.x, b.y.mul(lattice.y));
    const useA = dot(aP, aP).lessThan(dot(bP, bP));
    const gv = select(useA, aP, bP);
    const id = p.sub(gv);

    // Per-cell random start, so the reveal ripples across the honeycomb.
    const rand = fract(sin(dot(id, vec2(127.1, 311.7))).mul(43758.5453));
    const start = rand.mul(0.4);
    const local = smoothstep(start, start.add(0.6), progress);

    const rgb = mix(sampleFrom(uv), sampleTo(uv), local);

    // Distance to the hex border in p space (0 at the centre, 0.5 on the edge).
    const across = abs(gv);
    const edgeDistance = max(
      across.x,
      across.x.mul(0.5).add(across.y.mul(0.8660254)),
    );
    const edge = smoothstep(0.465, 0.5, edgeDistance);
    const glint = sin(local.mul(Math.PI)).mul(edge).mul(0.4);

    return this.finishNode(vec4(rgb.add(vec3(glint)), 1));
  }

  /**
   * Directional scale, ported to TSL from Thibaut Foussard's gl-transition
   * (after Gaëtan Renaudeau's Directional). The outgoing frame slides in
   * `direction` while the incoming frame is revealed from the opposite edge.
   * Both frames shrink around the midpoint (the `parabola` term peaks at
   * progress 0.5), leaving the black gutter that separates the two slides.
   */
  private directionalScaleTransitionNode(
    fromTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
    toTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
  ) {
    const PI = Math.PI;
    const SCALE = 0.7;
    // @param direction of the movement, in the reference's bottom-left UV
    // space. (0, 1) pushes the outgoing frame upward.
    const direction = vec2(0, 1);

    const progress = this.uniforms.progress;
    // The reference shader works in bottom-left UV space, like the melt and
    // page-curl ports above.
    const uv = vec2(screenUV.x, oneMinus(screenUV.y));
    const sampleFrom = (q: Node<"vec2">) =>
      fromTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;
    const sampleTo = (q: Node<"vec2">) =>
      toTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;

    // Snappy ease-out, cubed exactly as in the reference.
    const easedProgress = pow(sin(progress.mul(PI / 2)), 3);

    // Shift the frame, then wrap so both slides tile infinitely.
    const p = uv.add(sign(direction).mul(easedProgress));
    const wrapped = fract(p);

    // parabola(progress) = sin(progress * PI), zero at both ends and one in
    // the middle, so the shrink is strongest mid-handoff.
    const parabola = sin(progress.mul(PI));
    const s = float(1).sub(
      oneMinus(float(1).div(SCALE)).mul(parabola),
    );

    // Shrink the wrapped frame about its centre.
    const f = wrapped.sub(0.5).mul(s).add(0.5);

    // Which slide owns this pixel: the wrapped p inside [0, 1] shows the
    // outgoing frame, everything else shows the incoming one.
    const mixer = step(0, p.x)
      .mul(step(p.x, 1))
      .mul(step(0, p.y))
      .mul(step(p.y, 1));

    const fromColor = sampleFrom(f);
    const toColor = sampleTo(f);
    const rgb = mix(toColor, fromColor, mixer);

    // The scaled frame leaves the space beyond [0, 1] black.
    const border = step(0, f.x)
      .mul(step(0, oneMinus(f.x)))
      .mul(step(0, f.y))
      .mul(step(0, oneMinus(f.y)));

    return this.finishNode(vec4(rgb.mul(border), 1));
  }

  /**
   * Doom-style melt, ported to TSL from Zeh Fernando's gl-transition. The
   * outgoing frame slides downward in vertical columns, each with its own
   * speed, wave and drip shape, while the incoming scene is revealed from the
   * top of the screen.
   */
  private meltTransitionNode(
    fromTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
    toTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
  ) {
    const BARS = 30;
    const AMPLITUDE: number = 2;
    const NOISE: number = 0.1;
    const FREQUENCY: number = 0.5;
    const DRIP_SCALE: number = 0.5;

    const progress = this.uniforms.progress;
    // The reference shader works in bottom-left UV space.
    const uv = vec2(screenUV.x, oneMinus(screenUV.y));
    const sampleFrom = (q: Node<"vec2">) =>
      fromTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;
    const sampleTo = (q: Node<"vec2">) =>
      toTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;

    // One bar per column, indexing all per-column shapes below.
    const num = floor(uv.x.mul(BARS));

    // A hashed per-column value, mixed into the wave to break up its rhythm.
    const rand = fract(
      mod(num.mul(67123.313), 12)
        .mul(sin(num.mul(10.3)))
        .mul(cos(num)),
    );

    // A low-frequency wave gives neighbouring columns similar speeds.
    const fn = num.mul(FREQUENCY * 0.1 * BARS);
    const wave = cos(fn.mul(0.5))
      .mul(cos(fn.mul(0.13)))
      .mul(sin(fn.add(10).mul(0.3)))
      .div(2)
      .add(0.5);

    // Columns near the middle of the screen start later than the edges.
    const drip = sin(num.div(BARS - 1).mul(Math.PI)).mul(DRIP_SCALE);

    const waved = NOISE === 0 ? wave : mix(wave, rand, NOISE);
    const shape = DRIP_SCALE === 0 ? waved : waved.add(drip);
    const phase = progress.mul(shape.mul(AMPLITUDE).add(1));

    // The outgoing frame is sampled lower than it is drawn, so its content
    // runs down the screen as the phase grows.
    const fromColor = sampleFrom(vec2(uv.x, uv.y.add(phase)));
    const toColor = sampleTo(uv);

    return this.finishNode(
      vec4(select(phase.add(uv.y).lessThan(1), fromColor, toColor), 1),
    );
  }

  /**
   * Cross zoom, ported to TSL from rectalogic's gl-transition (MIT; after
   * Evan Wallace's glfx zoom blur). Both frames are dissolved through a strong
   * zoom blur whose centre drifts across the screen while its strength rises
   * and falls, so the handoff punches in and settles.
   */
  private crossZoomTransitionNode(
    fromTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
    toTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
  ) {
    const STRENGTH = 0.4;
    const SAMPLES = 40;

    const progress = this.uniforms.progress;
    // The reference works in bottom-left UV space, like the ports below.
    const uv = vec2(screenUV.x, oneMinus(screenUV.y));
    const sampleFrom = (q: Node<"vec2">) =>
      fromTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;
    const sampleTo = (q: Node<"vec2">) =>
      toTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;

    // The blur centre slides linearly from 0.25 to 0.75 across the handoff.
    const center = vec2(progress.mul(0.5).add(0.25), 0.5);

    // Exponential ease-in-out dissolve, with the reference's exact endpoint
    // values. time = progress / (duration / 2) = progress * 2.
    const time = progress.mul(2);
    const easeIn = pow(float(2), time.sub(1).mul(10)).mul(0.5);
    const easeOut = pow(float(2), time.sub(1).mul(-10)).mul(-0.5).add(1);
    const eased = select(time.lessThan(1), easeIn, easeOut);
    const dissolve = select(
      progress.lessThanEqual(0),
      float(0),
      select(progress.greaterThanEqual(1), float(1), eased),
    );

    // Mirrored sinusoid: 0 -> strength -> 0 over the blend.
    const blurStrength = oneMinus(cos(progress.mul(2 * Math.PI))).mul(
      STRENGTH * 0.5,
    );

    // A randomized sample offset hides the fixed step count.
    const offset = fract(
      sin(dot(uv, vec2(12.9898, 78.233))).mul(43758.5453),
    );
    const toCenter = center.sub(uv);

    // The reference's fixed 41-tap loop, unrolled at graph-build time.
    let sum: Node<"vec3"> = vec3(0);
    let total: Node<"float"> = float(0);
    for (let tap = 0; tap <= SAMPLES; tap += 1) {
      const percent = offset.add(tap).div(SAMPLES);
      const weight = percent.sub(percent.mul(percent)).mul(4);
      const sampleUv = uv.add(toCenter.mul(percent).mul(blurStrength));
      const faded = mix(sampleFrom(sampleUv), sampleTo(sampleUv), dissolve);
      sum = sum.add(faded.mul(weight));
      total = total.add(weight);
    }

    return this.finishNode(vec4(sum.div(total), 1));
  }

  /**
   * Page curl, ported to TSL from Hewlett-Packard's WebVFX reference (adapted
   * by Sergey Kosarevsky), BSD 3-Clause, copyright (c) 2010 Hewlett-Packard
   * Development Company, L.P. The outgoing frame is a paper sheet wrapped
   * around a cylinder; the sheet rolls off with the scroll, casting a shadow
   * on the incoming scene as it goes.
   */
  private pageCurlTransitionNode(
    fromTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
    toTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
  ) {
    const PI = Math.PI;
    const MIN_AMOUNT = -0.16;
    const MAX_AMOUNT = 1.5;
    const CYLINDER_RADIUS = 1 / PI / 2;
    const SCALE = 512;
    const SHARPNESS = 3;
    const ANGLE = (100 * PI) / 180;

    // The reference bakes a 100° page edge into two fixed matrices. GLSL
    // mat3s are column-major, so each product expands to these two rows.
    const ROT_C = Math.cos(-ANGLE);
    const ROT_S = Math.sin(-ANGLE);
    const BACK_C = Math.cos(ANGLE);
    const BACK_S = Math.sin(ANGLE);

    const progress = this.uniforms.progress;
    const amount = progress.mul(MAX_AMOUNT - MIN_AMOUNT).add(MIN_AMOUNT);
    const cylinderAngle = amount.mul(2 * PI);

    // Work in the reference's bottom-left UV space, then flip back to the
    // render-target's top-left origin when sampling.
    const uv = vec2(screenUV.x, oneMinus(screenUV.y));
    const sampleFrom = (q: Node<"vec2">) =>
      fromTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;
    const sampleTo = (q: Node<"vec2">) =>
      toTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;

    const rotate = (v: Node<"vec3">) =>
      vec3(
        v.x.mul(ROT_C).sub(v.y.mul(ROT_S)).sub(0.801),
        v.x.mul(ROT_S).add(v.y.mul(ROT_C)).add(0.89),
        v.z,
      );
    const rotateBack = (v: Node<"vec3">) =>
      vec3(
        v.x.mul(BACK_C).sub(v.y.mul(BACK_S)).add(0.985),
        v.x.mul(BACK_S).add(v.y.mul(BACK_C)).add(0.985),
        v.z,
      );

    /** Maps a point on the cylinder back onto the page. */
    const hitPoint = (hitAngle: Node<"float">, point: Node<"vec3">) =>
      rotateBack(vec3(point.x, hitAngle.div(2 * PI), point.z));

    const isOutside = (point: Node<"vec3">) =>
      or(
        or(point.x.lessThan(0), point.y.lessThan(0)),
        or(point.x.greaterThan(1), point.y.greaterThan(1)),
      );

    const antiAlias = (
      color1: Node<"vec3">,
      color2: Node<"vec3">,
      distance: Node<"float">,
    ) => {
      const d = distance.mul(SCALE);
      // Clamping the base keeps pow() out of NaN territory for the branches
      // the reference discards; at d > 2 the blend already returns color1.
      const dd = pow(max(oneMinus(d.div(2)), 0), SHARPNESS);
      const blended = color2.sub(color1).mul(dd).add(color1);
      return select(
        d.lessThan(0),
        color2,
        select(d.greaterThan(2), color1, blended),
      );
    };

    const distanceToEdge = (point: Node<"vec3">) => {
      const baseDx = abs(
        select(point.x.greaterThan(0.5), oneMinus(point.x), point.x),
      );
      const baseDy = abs(
        select(point.y.greaterThan(0.5), oneMinus(point.y), point.y),
      );
      let dx = select(point.x.lessThan(0), point.x.negate(), baseDx);
      dx = select(point.x.greaterThan(1), point.x.sub(1), dx);
      let dy = select(point.y.lessThan(0), point.y.negate(), baseDy);
      dy = select(point.y.greaterThan(1), point.y.sub(1), dy);

      const bothOut = and(
        or(point.x.lessThan(0), point.x.greaterThan(1)),
        or(point.y.lessThan(0), point.y.greaterThan(1)),
      );
      return select(bothOut, sqrt(dx.mul(dx).add(dy.mul(dy))), min(dx, dy));
    };

    /** What shows through the gap where the curled sheet has lifted. */
    const seeThrough = (yc: Node<"float">) => {
      const hitAngle = float(PI).sub(
        acos(clamp(yc.div(CYLINDER_RADIUS), -1, 1)).sub(cylinderAngle),
      );
      const point = hitPoint(hitAngle, rotate(vec3(uv.x, uv.y, 1)));
      const edge = antiAlias(
        sampleFrom(point.xy),
        vec3(0),
        distanceToEdge(point),
      );
      return select(
        and(yc.lessThanEqual(0), isOutside(point)),
        sampleTo(uv),
        select(yc.greaterThan(0), sampleFrom(uv), edge),
      );
    };

    /**
     * Composites a plain black shadow over the scene: alpha 1 is fully black
     * at the fold and alpha 0 leaves the incoming frame untouched. Keeping the
     * shadow as an opacity ramp avoids per-channel subtraction, which can
     * brighten or shift colours into an inverted-looking rim.
     */
    const applyShadow = (color: Node<"vec3">, alpha: Node<"float">) =>
      color.mul(oneMinus(clamp(alpha, 0, 1)));

    const seeThroughWithShadow = (yc: Node<"float">, point: Node<"vec3">) => {
      const base = oneMinus(distanceToEdge(point).mul(30)).div(3);
      return applyShadow(seeThrough(yc), base.mul(amount));
    };

    /** The paper's reverse side: a desaturated back-lit grey. */
    const backside = (yc: Node<"float">, point: Node<"vec3">) => {
      const paper = sampleFrom(point.xy);
      const gray = paper.r.add(paper.b).add(paper.g).div(15);
      const lift = pow(
        max(float(0), oneMinus(abs(yc.div(CYLINDER_RADIUS)))),
        0.2,
      )
        .div(2)
        .add(0.5)
        .mul(0.8);
      return vec3(gray.add(lift));
    };

    /** Everything past the curl, seen from behind the sheet. */
    const behindSurface = (ycIn: Node<"float">, pointIn: Node<"vec3">) => {
      // The reference computes an initial shadow here, then overwrites it in
      // both branches below, so only the flipped half is ever shaded.

      // Flip to the other half of the cylinder.
      const yc = float(-2 * CYLINDER_RADIUS).sub(ycIn);
      const hitAngle = acos(clamp(yc.div(CYLINDER_RADIUS), -1, 1))
        .add(cylinderAngle)
        .sub(PI);
      const point = hitPoint(hitAngle, pointIn);

      const dx = point.x.sub(0.5);
      const dy = point.y.sub(0.5);
      const nyc = yc.negate().div(CYLINDER_RADIUS);
      const innerShadow = oneMinus(sqrt(dx.mul(dx).add(dy.mul(dy))).div(0.71))
        .mul(nyc.mul(nyc).mul(nyc))
        .mul(0.5);
      const inside = and(
        and(point.x.greaterThanEqual(0), point.y.greaterThanEqual(0)),
        and(point.x.lessThanEqual(1), point.y.lessThanEqual(1)),
      );
      const useInner = and(
        and(yc.lessThan(0), inside),
        or(hitAngle.lessThan(PI), amount.greaterThan(0.5)),
      );
      const shado = select(useInner, innerShadow, float(0));

      // A black-to-transparent radial shadow under the curled sheet.
      return applyShadow(sampleTo(uv), shado);
    };

    const rotated = rotate(vec3(uv.x, uv.y, 1));
    const yc = rotated.y.sub(amount);
    const hitAngle = acos(clamp(yc.div(CYLINDER_RADIUS), -1, 1))
      .add(cylinderAngle)
      .sub(PI);
    const hitAngleMod = mod(hitAngle, 2 * PI);
    const seeThroughEarly = or(
      and(hitAngleMod.greaterThan(PI), amount.lessThan(0.5)),
      and(hitAngleMod.greaterThan(PI / 2), amount.lessThan(0)),
    );

    const hit = hitPoint(hitAngle, rotated);
    const otherColor = select(yc.lessThan(0), vec3(0), sampleFrom(uv));
    const curled = antiAlias(
      backside(yc, hit),
      otherColor,
      float(CYLINDER_RADIUS).sub(abs(yc)),
    );
    const edge = antiAlias(
      curled,
      seeThroughWithShadow(yc, hit),
      distanceToEdge(hit),
    );
    const middle = select(
      seeThroughEarly,
      seeThrough(yc),
      select(isOutside(hit), seeThroughWithShadow(yc, hit), edge),
    );

    const rgb = select(
      yc.lessThan(-CYLINDER_RADIUS),
      behindSurface(yc, rotated),
      select(yc.greaterThan(CYLINDER_RADIUS), sampleFrom(uv), middle),
    );

    return this.finishNode(vec4(rgb, 1));
  }

  /**
   * Ball roll, ported to TSL from gre's gl-transition (MIT). The outgoing
   * frame wraps itself onto a shaded sphere that shrinks and rolls away,
   * revealing the incoming frame under a soft shadow. Used for the first
   * handoff (Kinetic -> Flow Shield, "transition 1").
   */
  private ballRollTransitionNode(
    fromTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
    toTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
  ) {
    const PI = Math.PI;
    // Half width of the antialiased ball edge, in frame heights.
    const AA = 0.0015;
    // Radius of the wrapped ball relative to the shorter frame side.
    const SIZE = 0.3;
    // Strength of the shading and of the shadow on the incoming frame.
    const SHADING = 0.6;
    const SHADOW = 0.5;
    // Toward the light, from the top left (pre-normalised by 1.2689).
    const LIGHT = vec3(-0.5, 0.6, 1.0).div(1.2689);
    // The ball rolls away toward +x in reference (bottom-left) UV space.
    const DIRECTION = vec2(1, 0);

    const progress = this.uniforms.progress;
    const ratio = screenSize.x.div(screenSize.y);
    // Work in bottom-left reference space, flip back when sampling.
    const uv = vec2(screenUV.x, oneMinus(screenUV.y));
    const sampleFrom = (q: Node<"vec2">) =>
      fromTexture.sample(vec2(q.x, oneMinus(q.y)));
    const sampleTo = (q: Node<"vec2">) =>
      toTexture.sample(vec2(q.x, oneMinus(q.y)));

    const dir = normalize(DIRECTION);
    const side = vec2(dir.y.negate(), dir.x);

    // Square-pixel space, so the ball is round on any aspect ratio.
    const p = uv.sub(0.5).mul(vec2(ratio, 1));
    const shorter = min(ratio, 1.0);
    const r0 = float(SIZE).clamp(0.1, 0.5).mul(shorter);

    // The frame curves into a ball (flat at first), then the ball shrinks
    // while rolling away until it and its shadow have left the frame.
    const wRaw = clamp(progress.div(0.45), 0, 1);
    const w = float(1).sub(oneMinus(wRaw).mul(oneMinus(wRaw)));
    const awayRaw = smoothstep(0.3, 1.0, progress);
    const away = awayRaw.mul(awayRaw);
    const wrapped = r0.div(max(w, 1e-4));
    const radius = wrapped.mul(mix(float(1), float(0.5), away));
    // Pull the image tighter as it wraps, so it ends up covering the ball.
    const tight = mix(
      float(1),
      min(float(1), shorter.mul(0.48).div(float(PI).mul(r0))),
      w.mul(w),
    );
    const paper = radius.mul(tight);
    // Half extent of the frame along the roll direction.
    const e = float(0.5).mul(abs(dir.x).mul(ratio).add(abs(dir.y)));
    // Far enough that the ball (0.5 * r0 by then) and its shadow have left.
    const full = e.add(r0.mul(1.1)).add(AA * 2);
    const travel = away.mul(full);
    const center = dir.mul(travel);
    // Rolling without slipping: the integral of dtravel / radius.
    const angle = full
      .mul(-2)
      .mul(log(float(1).sub(away.mul(0.5))))
      .div(wrapped);

    const d = p.sub(center);
    const r = length(d);

    // Soft shadow on the incoming frame, below and right of the ball.
    const sd = d.sub(vec2(0.25, -0.3).mul(radius).mul(w));
    const shadowAmount = float(SHADOW)
      .mul(w)
      .mul(
        oneMinus(
          smoothstep(radius.mul(0.6), radius.mul(1.4), length(sd)),
        ),
      );

    const toSample = sampleTo(uv);
    // Premultiplied background, so transparent frames do not bleed colour.
    const bgRgb = toSample.rgb.mul(toSample.a).mul(oneMinus(shadowAmount));

    // The visible cap of the ball.
    const cover = oneMinus(
      smoothstep(radius.sub(AA), radius.add(AA), r),
    );
    const nd = d.div(radius);
    // Normal of the visible point (no squared radius, which overflows when
    // the ball is huge).
    const n = vec3(nd.x, nd.y, sqrt(max(float(1).sub(dot(nd, nd)), 0)));
    // Undo the roll: rotate around the axis across the direction.
    const u = dot(n.xy, dir);
    const s = dot(n.xy, side);
    const cu = cos(angle);
    const su = sin(angle);
    const q = vec3(
      u.mul(cu).sub(n.z.mul(su)),
      s,
      u.mul(su).add(n.z.mul(cu)),
    );
    // The image is wrapped around the ball from its front point, distances
    // kept along the surface.
    const lq = length(q.xy);
    const arc = atan(lq, q.z).mul(paper);
    const img = select(
      lq.greaterThan(0),
      q
        .x
        .mul(dir)
        .add(q.y.mul(side))
        .div(lq)
        .mul(arc),
      vec2(0),
    );
    const iuv = img.div(vec2(ratio, 1)).add(0.5);
    // Distance to the image edge, antialiased like the ball outline.
    const edge = min(iuv, oneMinus(iuv)).mul(vec2(ratio, 1));
    const inside = cover.mul(
      smoothstep(float(-AA), AA, min(edge.x, edge.y)),
    );

    const fromSample = sampleFrom(clamp(iuv, 0, 1));
    const diff = max(dot(n, LIGHT), 0);
    const spec = pow(max(reflect(LIGHT.negate(), n).z, 0), 24);
    const k = float(SHADING).mul(w);
    const lit = clamp(
      fromSample.rgb
        .mul(mix(float(1), float(0.25).add(diff.mul(0.85)), k))
        .add(float(0.35).mul(k).mul(spec)),
      0,
      1,
    );
    const ballRgb = lit.mul(fromSample.a).mul(inside);
    const ballA = fromSample.a.mul(inside);

    // Premultiplied composite: ball over the shadowed incoming frame.
    const compositeRgb = ballRgb.add(bgRgb.mul(oneMinus(ballA)));
    const compositeA = ballA.add(toSample.a.mul(oneMinus(ballA)));
    const rolledRgb = select(
      compositeA.greaterThan(0),
      compositeRgb.div(compositeA),
      vec3(0),
    );

    // Exact endpoints match the neighbouring chapters' plain frames.
    const rgb = select(
      progress.lessThanEqual(0),
      sampleFrom(uv).rgb,
      select(progress.greaterThanEqual(1), toSample.rgb, rolledRgb),
    );

    return this.finishNode(vec4(rgb, 1));
  }

  /**
   * Flash photo drop, ported to TSL from gre's gl-transition (MIT). A camera
   * flash freezes the outgoing frame into a printed photo with a white border;
   * the card shrinks, tilts and falls out of the frame under gravity, casting a
   * soft shadow on the incoming frame behind it. Used for the second handoff
   * (Flow Shield -> Live Env, "transition 2").
   */
  private photoDropTransitionNode(
    fromTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
    toTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
  ) {
    // How much the photo turns as it drops, border width, flash and shadow.
    const TILT = 0.35;
    const BORDER = 0.04;
    const FLASH = 0.85;
    const SHADOW = 0.45;
    const BORDER_COLOR = vec4(0.96, 0.94, 0.89, 1.0);
    // How much smaller the photo gets before it drops, its corner radius and
    // the width of the antialiased edges (frame heights).
    const SHRINK = 0.24;
    const RADIUS = 0.008;
    const AA = 0.0015;
    // Baked |sin| / |cos| of the final tilt, for the fall bound.
    const TILT_SIN = Math.abs(Math.sin(TILT));
    const TILT_COS = Math.abs(Math.cos(TILT));

    const progress = this.uniforms.progress;
    const ratio = screenSize.x.div(screenSize.y);
    const asp = vec2(ratio, 1);
    // Work in bottom-left reference space, flip back when sampling.
    const uv = vec2(screenUV.x, oneMinus(screenUV.y));
    const sampleFrom = (q: Node<"vec2">) =>
      fromTexture.sample(vec2(q.x, oneMinus(q.y)));
    const sampleTo = (q: Node<"vec2">) =>
      toTexture.sample(vec2(q.x, oneMinus(q.y)));

    /** Signed distance to a rounded box of half size b, corner radius r. */
    const roundedBox = (
      point: Node<"vec2">,
      halfSize: Node<"vec2">,
      corner: Node<"float">,
    ) => {
      const d = abs(point).sub(halfSize).add(corner);
      return length(max(d, vec2(0)))
        .add(min(max(d.x, d.y), 0))
        .sub(corner);
    };
    const premultiply = (c: Node<"vec4">) => vec4(c.rgb.mul(c.a), c.a);

    const q = uv.sub(0.5).mul(asp);
    const halfImage = asp.mul(0.5);
    const halfCard = halfImage.add(vec2(BORDER, BORDER));

    // The photo shrinks right after the flash, then falls with gravity,
    // turning as it goes.
    const k = smoothstep(0.05, 0.4, progress);
    const t = clamp(progress.sub(0.3).div(0.7), 0, 1);
    const fall = t.mul(t);
    const s = float(1).sub(k.mul(SHRINK));
    const angle = float(-TILT).mul(k.mul(0.12).add(fall.mul(0.88)));
    // Fall far enough for the turned photo and its shadow to leave the frame.
    const bound = halfCard
      .x
      .mul(TILT_SIN)
      .add(halfCard.y.mul(TILT_COS))
      .mul(1 - SHRINK);
    // It lifts a little toward the viewer before the drop.
    const lift = k.mul(oneMinus(fall)).mul(0.035);
    const center = vec2(
      fall.mul(0.08),
      lift.sub(fall.mul(bound.add(0.6))),
    );

    const rad = k.mul(RADIUS);
    const ca = cos(angle);
    const sa = sin(angle);
    // GLSL mat2(ca, -sa, sa, ca) is column-major, i.e. rotation by -angle.
    const unrotate = (point: Node<"vec2">) =>
      vec2(
        ca.mul(point.x).add(sa.mul(point.y)),
        ca.mul(point.y).sub(sa.mul(point.x)),
      );

    // The incoming image, already behind the photo, in its soft shadow.
    const toSample = sampleTo(uv);
    const sh = float(SHADOW).mul(k);
    const rs = unrotate(
      q.sub(center).sub(vec2(0.012, -0.022).mul(k)),
    ).div(s);
    const ds = roundedBox(rs, halfCard, rad).mul(s);
    const blur = float(0.035).mul(s);
    const dim = oneMinus(
      sh.mul(oneMinus(smoothstep(blur.negate(), blur, ds))),
    );
    let col: Node<"vec4"> = premultiply(
      vec4(toSample.rgb.mul(dim), toSample.a),
    );

    // The photo: the outgoing image, framed by its paper border.
    const r = unrotate(q.sub(center)).div(s);
    const dCard = roundedBox(r, halfCard, rad).mul(s);
    const dImage = roundedBox(r, halfImage, float(0)).mul(s);
    // Edges are pushed out one AA width, so the photo fills the frame at p=0.
    const cardCover = clamp(float(1.5).sub(dCard.div(AA)), 0, 1);
    const imageCover = clamp(float(1.5).sub(dImage.div(AA)), 0, 1);
    const fromSample = sampleFrom(clamp(r.div(asp).add(0.5), 0, 1));
    const photo = premultiply(fromSample);
    const paper = premultiply(BORDER_COLOR);
    const card = mix(
      paper.add(col.mul(oneMinus(paper.a))),
      photo,
      imageCover,
    );
    col = mix(col, card, cardCover);

    const rgbBase = select(
      col.a.greaterThan(0),
      col.rgb.div(col.a),
      vec3(0),
    );

    // The flash only adds light: a quick bloom to white that fades out.
    const f = float(FLASH)
      .mul(smoothstep(0, 0.05, progress))
      .mul(oneMinus(smoothstep(0.05, 0.3, progress)));
    const rgb = float(1).sub(oneMinus(rgbBase).mul(oneMinus(f)));

    return this.finishNode(vec4(rgb, 1));
  }

  /**
   * A liquid-glass wipe: noisy edge, refraction at the seam, chromatic split
   * and a thin light leak tinted with the participating section accents.
   */
  private liquidTransitionNode(
    fromTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
    toTexture: ReturnType<SectionWorld["pass"]["getTextureNode"]>,
  ) {
    const uv = screenUV;
    const aspect = screenSize.x.div(screenSize.y);
    const noise = mx_fractal_noise_float_2d(
      uv.mul(vec2(aspect, 1)).mul(3.1),
      3,
      2.0,
      0.5,
      1.0,
    )
      .mul(0.5)
      .add(0.5);

    // The wipe always travels upward, independent of scroll direction.
    const vertical = oneMinus(uv.y);

    const front = this.uniforms.progress.mul(2.1).sub(0.55);
    const warped = vertical.add(noise.sub(0.5).mul(0.46));
    const wipe = oneMinus(smoothstep(0, TRANSITION_WIDTH, warped.sub(front)));

    const seam = smoothstep(0, 0.12, wipe).mul(
      smoothstep(0, 0.12, oneMinus(wipe)),
    );
    const ripple = smoothstep(0, 0.9, seam);
    const wobble = mix(float(-1), float(1), noise).mul(ripple);

    const distortion = vec2(
      wobble.mul(0.026),
      seam.mul(noise.sub(0.5)).mul(0.052),
    );
    const sampleUv = uv.add(distortion);
    const chroma = vec2(seam.mul(0.008).add(0.0007), 0);

    const fromRed = fromTexture.sample(sampleUv.add(chroma)).r;
    const fromGreen = fromTexture.sample(sampleUv).g;
    const fromBlue = fromTexture.sample(sampleUv.sub(chroma)).b;
    const toRed = toTexture.sample(sampleUv.add(chroma)).r;
    const toGreen = toTexture.sample(sampleUv).g;
    const toBlue = toTexture.sample(sampleUv.sub(chroma)).b;

    const fromColor = vec3(fromRed, fromGreen, fromBlue);
    const toColor = vec3(toRed, toGreen, toBlue);
    const blended = mix(fromColor, toColor, wipe);

    // Follow the flipped wipe so the leak stays at the leading edge.
    const lightLeak = max(float(0), oneMinus(vertical.mul(1.2).add(0.1)))
      .mul(seam)
      .mul(0.16);
    const tinted = blended.add(color(this.uniforms.accent).mul(lightLeak));

    return this.finishNode(vec4(tinted, 1));
  }

  private finishNode(input: Node<"vec4">) {
    const uv = screenUV;
    const vignette = oneMinus(smoothstep(0.32, 0.86, length(uv.sub(0.5))))
      .mul(0.18)
      .add(0.82);

    const grain = interleavedGradientNoise(
      screenCoordinate.add(
        vec2(this.uniforms.time.mul(47), this.uniforms.time.mul(91)),
      ),
    )
      .sub(0.5)
      .mul(0.018);

    const rgb = input.rgb.mul(vignette).add(grain);
    return vec4(rgb, 1);
  }
}

# Scene & Transition Structure

This document describes how a **chapter (scene)** and a **chapter handoff (transition)** are built in this project.

The site is a single full-screen WebGPU canvas. There is exactly **one renderer** and **one render pipeline**; each chapter contributes a self-contained `SectionWorld` (its own `Scene`, `Camera` and full-resolution render target), and the pipeline composites the active world — or the two worlds taking part in a handoff — into the canvas.

```
                      ┌──────────────────────────────────────────────┐
  wheel / touch       │  useScrollerStore (zustand)                  │
  ───────────────▶    │  virtual scroll → scrollProgress             │
                      │  → activeIndex / fromIndex / toIndex /       │
                      │    transitionProgress / isTransitioning      │
                      └───────────────┬──────────────────────────────┘
                                      │ read every frame
                                      ▼
  <Canvas> ── SceneStage ── SceneDirector ── SectionRenderPipeline
                               │  registers worlds        │ owns one WebGPU RenderPipeline
                               │  precompiles shaders     │ output graph references
                               ▼                          ▼ only the active pass(es)
                     SCENE_COMPONENTS[]                composite → canvas
                     (one React adapter per chapter)
                               │
                               ▼
                     createXxxWorld() → SectionWorld
                     { scene, camera, pass, animate, resize, dispose }
```

Key idea: **scenes never draw themselves to the screen and never own a renderer.** They render into their own `pass` render target; the pipeline decides which one(s) the screen shows and with what shader.

---

## 1. Directory map

```
src/
├── app/page.tsx                    → <Landing />
├── components/
│   ├── Landing.tsx                 → page chrome, scroll tracking, easy-fancy messaging
│   ├── SceneStage.tsx              → one <Canvas>, WebGPU bootstrap, GPU fallback
│   ├── SceneDirector.tsx           → orchestration: register worlds, precompile, per-frame render
│   └── SplashScreen.tsx            → boot progress (preload + precompile)
├── store/useScrollerStore.ts       → zustand store + virtual scroll engine
├── lib/
│   ├── scroll-phases.ts            → enter / animate / exit math
│   └── render-pipeline.ts          → SectionRenderPipeline + every transition shader
└── sections/
    ├── types.ts                    → SectionMeta, CameraConfig, SectionWorld, Section3DProps
    ├── registry.ts                 → SECTIONS (ordered, SSR-safe metas)
    ├── scene-registry.tsx          → SCENE_COMPONENTS (ordered client components)
    ├── shared/                     → camera rig, pointer signal, reusable scene pieces
    ├── kinetic/                    → index 0 · chapter 01 · "Motion, not video."
    ├── flow-shield/                → index 1 · chapter 02 · "Force, not field."
    ├── building-live-envmaps/      → index 2 · chapter 03 · "Built in light."
    ├── honey-text/                 → index 3 · chapter 04 · "Glass, not pixels."
    ├── vr-gallery/                 → index 6 · chapter 07 · dormant (not registered)
    └── signal/                     → index 7 · chapter 08 · dormant (not registered)
```

Only `SECTIONS` / `SCENE_COMPONENTS` order matters. `vr-gallery` and `signal` are complete chapters kept in the tree but **not** registered; the transition selector still anticipates their indices.

> `SECTIONS` (metas) and `SCENE_COMPONENTS` (React components) are two parallel arrays. They must stay the same length and the same order, and each meta's `index` must equal its array position.

---

## 2. Scene code structure

### 2.1 Contracts — `src/sections/types.ts`

```ts
SectionMeta   // data only, safe to import during SSR
  id        stable slug, e.g. "flow-shield"
  index     0..N-1; MUST equal the array slot (see §3.6)
  chapter   zero-padded number used in the URL hash and labels ("02")
  name      short label for the HUD / easy-fancy timeline
  title     headline ("Force,\nnot field."); newline = two lines
  accent    hex tint for HUD, HUD dot, transition light leak
  surface   page-surface color consumed by easy-fancy's scene scan

CameraConfig
  base      [x, y, z] starting camera position
  fov       vertical field of view
  drift     pointer parallax amplitude
  orbit     idle orbit amplitude
  lookAt?   look target (defaults to origin in most scenes)
  travelZ?  optional z journey from progress 0 → 1 (declared, currently unused)

SectionWorld
  id, index
  scene     THREE.Scene
  camera    THREE.PerspectiveCamera
  pass      PassNode = pass(scene, camera)  ← full-resolution render target
  beautyNode?  optional TextureNode that replaces pass output (e.g. an RTT
               with post effects); the pipeline composites this instead
  animate({ elapsed, delta, phase })   per-frame scene/camera work
  resize(aspect)                        canvas aspect changed
  dispose()                             release geometries, materials, textures

Section3DProps
  onReady(world)     register with SceneDirector
  onDispose(world)   unregister
```

`phase: SectionPhaseState` is `{ phase: "enter" | "animate" | "exit", progress, sceneProgress, activity }` (see §2.8).

### 2.2 Anatomy of a chapter folder

```
src/sections/<chapter>/
├── index.ts          barrel: exports the component, camera config and meta
├── meta.ts           SectionMeta + CameraConfig (no browser-only imports)
├── <Name>3D.tsx      React adapter: async-loads the world, drives animate(), handles resize/dispose
├── scene.ts          createXxxWorld(camera, renderer): SectionWorld
│                     createXxxFallbackWorld(camera): SectionWorld   ← degraded but valid
└── …                 materials, geometry, ground, glass, particles, etc.
```

Variations:

- `kinetic` declares `kineticMeta` / `kineticCamera` directly in `scene.ts` and re-exports them from `index.ts`. `flow-shield`, `live-env` and `alpha6` keep a separate `meta.ts`.
- `honey-text` is the largest: `scene.ts` composes `environment.ts`, `glass/`, `ground/`, `fracture.ts`, `timeline.ts`, etc. The sub-files are plain Three.js factories; only `scene.ts` knows about `SectionWorld`.
- A chapter may ship a `settings.ts`, `theme.ts`, `controls.ts` — private config. Nothing outside the folder imports them.

### 2.3 The meta (must stay SSR-safe)

`registry.ts` is imported by the server render (through `Landing` → `SECTIONS`). Keep the meta module free of `window`, `document`, canvas and DOM-only dependencies. A separate `meta.ts` makes that obvious; `kinetic` gets away with exporting its meta from `scene.ts` because the module only touches browser APIs inside functions, never at top level.

```ts
export const flowShieldMeta: SectionMeta = {
  id: "flow-shield",
  index: 1,
  chapter: "02",
  name: "Flow Shield",
  title: "Force,\nnot field.",
  accent: "#26aeff",
  surface: "#0e0d0c",
};

export const flowShieldCamera: CameraConfig = {
  base: [8, 5, 8],
  fov: 26,
  drift: 0,
  orbit: 0,
};
```

### 2.4 The 3D component adapter (`<Name>3D.tsx`)

Every chapter has the same adapter shape. It is the only React code in a scene:

```tsx
export function FlowShield({ onReady, onDispose }: Section3DProps) {
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer;
  const renderer = gl;
  const camera = useMemo(
    () => makeCamera(flowShieldCamera.base, flowShieldCamera.fov),
    [],
  );
  const worldRef = useRef<SectionWorld | null>(null);

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
        const { createFlowShieldWorld } = await import("./scene"); // client-only + heavy
        mount(createFlowShieldWorld(camera, renderer));
      } catch (error) {
        const { createFlowShieldFallbackWorld } = await import("./scene");
        mount(createFlowShieldFallbackWorld(camera));
      }
    };
    void load();
    return () => {
      /* onDispose(world); world.dispose(); */
    };
  }, [camera, renderer, onReady, onDispose]);

  useEffect(() => {
    /* forward canvas aspect to world.resize */
  }, [size.width, size.height]);

  useFrame((state, delta) => {
    const world = worldRef.current;
    if (!world) return;
    if (getSectionActivity(world.index) <= 0) return; // off-screen: skip CPU work
    world.animate({
      elapsed: getSceneTime(state.clock.elapsedTime), // slowed under reduced motion
      delta,
      phase: getSectionPhase(world.index),
    });
  });

  return null; // renders nothing to the DOM
}
```

Why the dynamic `import("./scene")`:

1. The scene module imports `three/webgpu`, fonts, loaders and other browser-only code; the component itself must survive a server render.
2. If scene construction (asset loads, shader compilation) throws, the catch path mounts a **fallback world** so the chapter is still a valid render target and the composite never breaks.

Consequences of `return null`: a chapter has no DOM. All visuals come from the pipeline; all UI (header, HUD, scroll cue) is DOM chrome in `Landing.tsx` or 3D objects inside the scene.

### 2.5 The scene factory → `SectionWorld`

`scene.ts` builds plain Three.js objects and returns the contract. The `pass` is what makes it compositable:

```ts
return {
  id: flowShieldMeta.id,
  index: flowShieldMeta.index,
  scene,
  camera,
  pass: pass(scene, camera), // from three/tsl; full-res render target
  resize(aspect) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  },
  animate({ elapsed, delta, phase }) {
    const dt = Math.min(delta, 0.05); // clamp long frames
    // uniforms, mixer.update(dt), camera choreography from `phase`
  },
  dispose() {
    // remove + dispose every geometry/material/texture the factory created
  },
};
```

Two consistent conventions:

- `delta` is clamped (`Math.min(delta, 0.05)`) before feeding time-based motion, so a tab switch or GC pause cannot jump the scene.
- `animate` reads `phase` to choreograph the camera and entrance/exit motion; it does **not** fade anything for the transition — the pipeline's shader owns the blend.

`createXxxFallbackWorld(camera)` returns the same contract with a minimal scene (flat color / empty stage), no-op `animate`/`resize`/`dispose`. It exists purely so a failed scene still renders something.

Optional `beautyNode`: if a scene wants its own RTT (reflections, godrays, a custom composite), it can expose the resulting `TextureNode`; `SectionRenderPipeline` prefers it over `pass.getTextureNode()` for both the plain frame and every transition. No chapter uses this today, but the pipeline honors it everywhere.

### 2.6 Registration and boot — `scene-registry.tsx` + `SceneDirector`

```tsx
// scene-registry.tsx — order MUST match registry.ts
export const SCENE_COMPONENTS = [Kinetic3D, FlowShield, LiveEnv, Alpha6];
```

`SceneDirector` renders every component at once and collects their worlds:

1. `registerWorld(world)` → `worldsRef.current[world.index] = world`; reports `registered / N` for the splash preload bar.
2. When **all** slots `0..N-1` are filled, `rebuildPipeline()` creates the single `SectionRenderPipeline(gl, worlds)`.
3. `schedulePrecompile()` waits one beat (StrictMode remount safety), then `precompile()`:
   - `gl.compileAsync(world.scene, world.camera, …)` for each world, updating `precompileProgress`;
   - `pipeline.prewarm()` compiles the composite and every consecutive handoff shader;
   - `setBootPhase("ready")` → the splash fades.
4. `unregisterWorld(world)` clears the slot, disposes the pipeline, cancels an in-flight compile, and resets boot state so a remount can redo it.

**Index invariant:** each scene hardcodes `index: meta.index` and the director stores it by that index. If a chapter is removed without renumbering the rest, the array gets a hole, the pipeline never builds and the splash stalls forever. The director logs a loud warning in that case — renumber the metas (`index` and `chapter`) and both registries.

### 2.7 Per-frame lifecycle

```
R3F frame:
  priority 0  → every <Name>3D useFrame: if activity > 0 → world.animate(...)
  priority 1  → SceneDirector useFrame:
                  read store → PipelineState
                  pipeline.update(state, clock.elapsedTime)
                  pipeline.render()
```

- All scenes may run `animate` in the same frame; only the active one(s) are actually drawn.
- `getSectionActivity(index)` is 0 outside the scene's enter→exit window, so off-screen scenes skip work entirely.
- `SceneDirector` owns the only `pipeline.render()` call.

### 2.8 Scroll phases and activity — `src/lib/scroll-phases.ts`

Scroll is measured in **phase units**, not pixels:

| Constant       | Value                                | Meaning                                            |
| -------------- | ------------------------------------ | -------------------------------------------------- |
| `PHASE_HOLD`   | `0.5`                                | fully visible hold                                 |
| `PHASE_BLEND`  | `1.0`                                | crossfade (this scene's exit + next scene's enter) |
| `CHAPTER_SPAN` | `PHASE_HOLD + PHASE_BLEND = 1.5`     | distance between chapter anchors                   |
| `SCENE_SPAN`   | `2 × PHASE_BLEND + PHASE_HOLD = 2.5` | full lifecycle of one scene                        |

Chapter `i` is anchored at `getChapterAnchor(i) = i * 1.5`. For scroll position `p`:

```ts
relative = p - i * CHAPTER_SPAN
sceneProgress = clamp01((relative + PHASE_BLEND) / SCENE_SPAN)

relative < 0        → phase "enter",   progress = relative + 1,            activity = progress
0 ≤ relative ≤ 0.5  → phase "animate", progress = relative / 0.5,          activity = 1
relative > 0.5      → phase "exit",    progress = (relative - 0.5) / 1,    activity = 1 - progress
```

With the current constants, `sceneProgress` is `0` at the start of enter, `0.4` when the hold begins, `0.6` when exit begins and `1` at the end of the blend. (The `types.ts` comment's "1/3, 2/3" is the older symmetrical-third wording.)

Helpers used by scenes:

- `getSectionPhase(index)` → `SectionPhaseState` for the current store position.
- `getSectionActivity(index)` → `0..1`; both neighbours are non-zero during a blend.
- `getSceneTime(elapsed)` → freezes/slows to `elapsed * 0.18` under `prefers-reduced-motion`.
- `samplePointer(elapsed, delta)` → one globally smoothed pointer/tilt signal (mouse on desktop, device orientation on touch; iOS permission requested on first tap). Do not add per-scene pointer listeners.
- `attachPointerSignal()` is called once by `SceneDirector`.

The maximum scroll position is `getChapterAnchor(N - 1) + PHASE_HOLD` — the last chapter has no exit blend, but its hold is still scrubbable.

### 2.9 Shared scene helpers — `src/sections/shared/`

| File                                                                                                    | Purpose                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scene-utils.ts`                                                                                        | `makeCamera`, `setCameraPose`, `easeInOut`, `pointerDrift`, `mulberry32`, `fresnelAmount`, `makeSky`, `makeParticles`, `makeRibbonMaterial`, `addLights`, `disposeScene` |
| `section-activity.ts`                                                                                   | global pointer/tilt signal, phase/activity accessors, `getSceneTime`                                                                                                     |
| `section-title.ts`                                                                                      | 3D chapter titles                                                                                                                                                        |
| `scroll-cue.ts`                                                                                         | the "scroll" hint object                                                                                                                                                 |
| `helvetica.ts`                                                                                          | font data (bundled)                                                                                                                                                      |
| `star-sky.ts`, `moon.ts`, `grass.ts`, `grass-material.ts`, `WaterMesh3D.tsx`, `live-rainbow-env-map.ts` | reusable environment pieces                                                                                                                                              |

Prefer these over re-implementing; they are already TSL-native and sized/behaved for the shared camera rig.

### 2.10 Rules for scene code

- **WebGPU + TSL only.** Use `WebGPURenderer` and `three/tsl` nodes (`MeshStandardNodeMaterial`, `material.colorNode`, …). Do not introduce `WebGLRenderer`, GLSL `ShaderMaterial`, or WebGL-only addons; translate any provided GLSL to TSL.
- **No own renderer, no own post-processing.** There is one renderer and one output graph. Need an RTT? Build it inside the scene and expose it as `beautyNode`; otherwise just return `pass(scene, camera)`.
- **Never draw to the canvas directly.** `pass` is the scene's output.
- **Always provide a fallback world.** The adapter catches construction errors and mounts it.
- **Dispose everything you create.** Repeated chapter visits rely on `dispose()`.
- **Keep meta SSR-safe and `index`/`chapter` unique, contiguous and ordered.**
- **Register in both arrays.** `registry.ts` and `scene-registry.tsx` must agree.
- **Clamp `delta`** before time integration.
- **Gate per-frame work on `getSectionActivity(index) > 0`.**

---

## 3. Transition code structure

### 3.1 What a "transition" is here

A transition is **not** DOM, CSS or a separate scene. It is a shader in the single render pipeline that takes two render targets — `from` (outgoing chapter) and `to` (incoming chapter) — and outputs one blended frame. Both chapters keep animating during the handoff; the shader only decides per pixel which frame shows and how.

There are two levels:

1. **Scroll math** decides _how much_ blend (0..1), in `scroll-phases.ts` + the store.
2. **Shader selection** decides _what the blend looks like_, in `render-pipeline.ts`.

### 3.2 Scroll math → `PipelineState`

The virtual scroll engine (in `useScrollerStore.ts`) accumulates wheel/touch input into `engine.scrollPixel` and publishes phase-unit progress. `setScroll` derives:

```ts
scrollProgress = clamp(rawProgress, 0, getChapterAnchor(N-1) + PHASE_HOLD)

lower = min(floor(scrollProgress / CHAPTER_SPAN), N - 1)
toIndex = min(lower + 1, N - 1)

blend = getChapterBlend(scrollProgress)
      = clamp01((scrollProgress - anchor - PHASE_HOLD) / PHASE_BLEND)

isTransitioning = blend > 0.002 && blend < 0.998
activeIndex     = blend < 0.5 ? lower : toIndex   // HUD, hash, music

if (!isTransitioning) → fromIndex = toIndex = activeIndex, transitionProgress = 0
else                  → fromIndex = lower, toIndex = toIndex, transitionProgress = blend
```

So each chapter spends `PHASE_HOLD` units fully visible, then `PHASE_BLEND` units hand-holding to the next. `getChapterBlend` returns 0 during holds.

Motion modes in the same engine:

- `coast` — flick momentum with exponential friction (`SCROLL_FRICTION`), capped by `MAX_SCROLL_VELOCITY`.
- `spring` — critically damped ease toward a chapter (`goTo`, hash navigation).
- `preview` — easy-fancy transition playback: snap to the blend's first frame, hold `PREVIEW_LEAD_MS` (240 ms), then ease across the whole blend over `PREVIEW_DURATION_MS` (2200 ms).

`SECTION_SCROLL_HEIGHTS = 2` viewport heights per phase unit, so a hold is one screen of wheel travel and a blend is two.

### 3.3 Store → pipeline, every frame

`SceneDirector`'s `useFrame(..., 1)` copies the store fields into a reused `PipelineState`:

```ts
type PipelineState = {
  fromIndex: number;
  toIndex: number;
  isTransitioning: boolean;
  progress: number; // blend 0..1
};
```

Then `pipeline.update(state, elapsed)` and `pipeline.render()`.

### 3.4 `SectionRenderPipeline` — `src/lib/render-pipeline.ts`

```ts
class SectionRenderPipeline {
  private pipeline: RenderPipeline; // three/webgpu
  private worlds: SectionWorld[];
  private uniforms = {
    progress: uniform(0), // eased blend 0..1
    accent: uniform(Color), // lerp(from.accent, to.accent)
    time: uniform(0), // seconds, for grain
  };
  private activeKey = ""; // "+from:to:transitioning" cache
}
```

- **One output node at a time.** `buildOutput(from, to, isTransitioning)` rebuilds `pipeline.outputNode` only when the key changes, so the graph references just the active `pass` (plain frame) or two passes (transition). Unused chapters are never drawn.
- `update()` eases the raw progress with `easeInOut` (smoothstep), writes it to `uniforms.progress`, advances `uniforms.time`, and lerps `uniforms.accent` between the two chapters' accents (using `progress`, or `1` when settled).
- `pipeline.outputColorTransform = true` applies the renderer's tone mapping / sRGB output to the composite.
- `render()` calls `pipeline.render()`.
- `prewarm()` compiles, while the splash still covers the canvas:
  - every **consecutive** pair in `worlds`, through `transitionNode(index, index + 1)`;
  - then the plain composite `buildOutput(0, 0, false)`.
    This removes first-scroll hitches for the pairs that exist today.

### 3.5 Choosing a shader — `transitionNode()`

```ts
const isPageCurlPair        = (from === 6 && to === 7) || (from === 7 && to === 6);
const isCrossZoomPair       = (from === 3 && to === 4) || (from === 4 && to === 3);
const isDirectionalScalePair= (from === 4 && to === 5) || (from === 5 && to === 4);

if (isPageCurlPair)         return pageCurlTransitionNode(...);
if (isCrossZoomPair)        return crossZoomTransitionNode(...);
if (isDirectionalScalePair) return directionalScaleTransitionNode(...);
return liquidTransitionNode(...);   // default
```

Current registry is indices **0..3**, so every live handoff is:

| Handoff | Chapters               | Shader |
| ------- | ---------------------- | ------ |
| 0 → 1   | Kinetic → Flow Shield  | liquid |
| 1 → 2   | Flow Shield → Live Env | liquid |
| 2 → 3   | Live Env → Alpha 6     | liquid |

Reserved mappings:

| Pair  | Shader            | Status                                                         |
| ----- | ----------------- | -------------------------------------------------------------- |
| 3 ↔ 4 | cross zoom        | no index 4 registered                                          |
| 4 ↔ 5 | directional scale | no indices 4/5 registered                                      |
| 6 ↔ 7 | page curl         | `vr-gallery` (6) and `signal` (7) exist but are not registered |

Two more shaders are implemented but **not selected by `transitionNode`**:

- `meltTransitionNode` (column melt)
- `hexGridTransitionNode` (honeycomb reveal)

They are available for future pairs; add a predicate to use them (and see §3.10 for the easy-fancy scanner's naming contract).

### 3.6 The transition shaders

All shaders are built in TSL, return `finishNode(vec4(rgb, 1))`, and read three uniforms: `progress` (already eased), `accent`, `time`.

| Method                               | Look                                                                                                                                   | Key constants / mechanics                                                                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `liquidTransitionNode` **(default)** | noisy upward glass wipe: refraction wobble, chromatic split, thin accent light leak at the seam                                        | `TRANSITION_WIDTH = 0.24`; `mx_fractal_noise_float_2d` (3 octaves); wipe front = `progress * 2.1 - 0.55`; samples R/G/B with ±chroma offsets                                                              |
| `directionalScaleTransitionNode`     | outgoing frame slides in `direction` while the incoming frame enters from the opposite edge; both shrink about mid-blend, black gutter | `SCALE = 0.7`, `direction = (0, 1)`, ease `sin(p·π/2)^3`, `fract` wrap, `parabola = sin(p·π)` shrink, `border` mask                                                                                       |
| `meltTransitionNode`                 | Doom-style melt: outgoing frame runs downward in independently-shaped columns, incoming revealed from the top                          | `BARS = 30`, `AMPLITUDE = 2`, `NOISE = 0.1`, `FREQUENCY = 0.5`, `DRIP_SCALE = 0.5`; per-column hash + low-frequency wave + edge-drip                                                                      |
| `crossZoomTransitionNode`            | both frames dissolved through a strong zoom blur whose centre drifts and strength rises then falls                                     | `STRENGTH = 0.4`, `SAMPLES = 40` → 41 taps **unrolled at graph-build time**; centre `0.25 → 0.75`; exponential ease-in-out; mirrored-sinusoid blur                                                        |
| `pageCurlTransitionNode`             | outgoing frame is a paper sheet on a cylinder, rolling off and casting a shadow on the incoming scene                                  | `MIN_AMOUNT = -0.16`, `MAX_AMOUNT = 1.5`, `CYLINDER_RADIUS = 1/(2π)`, `SCALE = 512`, `SHARPNESS = 3`, `ANGLE = 100°`; rotate/rotateBack matrices; backside, see-through, inner shadow, anti-aliased edges |
| `hexGridTransitionNode`              | screen split into hexagons, each flipping on its own staggered slice, borders glinting                                                 | `CELLS = 24`, lattice `(1, √3)`, per-cell hash start, glint `sin(local·π)·edge·0.4`                                                                                                                       |

Opt-in parameters are module-local `const`s inside each method — retune by editing the constant, not by passing options.

### 3.7 Shared finishing pass — `finishNode()`

Every output path (plain frame and every transition) goes through:

```ts
vignette = 1 - smoothstep(0.32, 0.86, length(uv - 0.5)) * 0.18 + 0.82;
grain =
  (interleavedGradientNoise(screenCoordinate + time * (47, 91)) - 0.5) * 0.018;
out.rgb = input.rgb * vignette + grain;
```

That is why the composite looks consistent across shaders. Do not add a second vignette/grain inside a new transition.

### 3.8 Coordinate conventions (important when porting a shader)

- **Plain composite and liquid/hex shaders** sample with `screenUV` directly (render-target origin is top-left).
- **Ported reference shaders** (directional scale, melt, cross zoom, page curl) were written in **bottom-left UV** space. They define:
  ```ts
  const uv = vec2(screenUV.x, oneMinus(screenUV.y));
  const sampleFrom = (q) => fromTexture.sample(vec2(q.x, oneMinus(q.y))).rgb;
  ```
  i.e. flip into reference space for the math, flip back when sampling. Keep this pattern or the handoff renders upside down.
- Sampling a transition texture returns `.rgb`; alpha is discarded and the result is forced to `vec4(rgb, 1)`.
- The eased `progress` is already smoothstep-applied by `pipeline.update()`; reference ports that need a different curve (e.g. `sin^3`, exponential) apply their own on top.

### 3.9 Adding or retuning a transition

1. Add a `private xxxTransitionNode(from, to)` method returning `this.finishNode(vec4(rgb, 1))`.
2. Add a pair predicate and branch in `transitionNode()`.
3. Keep the numeric pair literals in the exact form `fromIndex === A && toIndex === B` inside a named `isXxxPair` variable — easy-fancy's scanner parses that regex to label the timeline.
4. `prewarm()` needs no change for **consecutive** pairs: it walks `transitionNode(index, index + 1)` for every registered world.
5. If the pair is non-consecutive or the mapping is special, the first play compiles on demand; consider extending `prewarm()` too.

### 3.10 easy-fancy integration

`Landing.tsx` listens for `window.message` events from the embedded easy-fancy UI:

- `{ source: "easy-fancy", type: "scroll-to-scene", index }` → `goTo(index)` (chapter anchor).
- `{ source: "easy-fancy", type: "play-transition", from }` → `previewTransition(from)`, which scrubs `from`'s hold edge to the next anchor over 2.2 s.

The skill's server (`server/scan-scenes.ts`) imports `SECTIONS` to list chapters and **reads `render-pipeline.ts` as text** to name transitions:

```ts
const pageCurlPairs = extractPairs(source, "isPageCurlPair");
const meltPairs = extractPairs(source, "isMeltPair");
// pair regex: /fromIndex\s*===\s*(\d+)\s*&&\s*toIndex\s*===\s*(\d+)/g
// label: page curl > melt > liquid
```

So:

- The file must keep variables literally named `isPageCurlPair` / `isMeltPair` for those labels to appear.
- Every other pair is labelled **liquid** in the timeline, even if its shader is cross zoom / directional scale / hex grid.
- Renaming or restructuring the predicates silently downgrades the timeline labels, not the site.

---

## 4. Adding a new chapter — checklist

Critical path (do in order):

1. **Create `src/sections/<chapter>/meta.ts`** with a unique `id`, the next `index`, the next zero-padded `chapter`, `name`, `title`, `accent`, `surface`, plus `CameraConfig`. Keep it SSR-safe.
2. **Create `scene.ts`** with `createXxxWorld(camera, renderer): SectionWorld` and `createXxxFallbackWorld(camera)`. Build TSL/WebGPU-only content; return `pass(scene, camera)`; implement `animate`, `resize`, `dispose`.
3. **Create `<Name>3D.tsx`** following the adapter pattern (async import, mount → `onReady`, activity-gated `useFrame`, resize effect, dispose on unmount).
4. **Create `index.ts`** exporting the component, camera and meta.
5. **Register in `registry.ts`** — append the meta so `SECTIONS` stays index-ordered.
6. **Register in `scene-registry.tsx`** — append the component in the same position.
7. **Verify index contiguity** (`0..N-1`, `meta.index === array slot`), or the pipeline never builds and the splash stalls. Watch the console for `[SceneDirector] Scene indices are not contiguous`.
8. **Decide the handoffs.** Every new pair defaults to liquid. Add a predicate in `transitionNode()` if it needs a specific shader; `prewarm()` then compiles it during boot.
9. **Update scroll bounds implicitly** — they derive from `SECTION_COUNT` and `getChapterAnchor`, so no manual constant changes are needed.

Non-critical (can run in parallel afterward):

- Add a `settings.ts` / theme module if the scene needs tunable constants.
- Add chapter-specific assets under `public/<chapter>/`.
- Add a 3D title using `shared/section-title.ts` or a scroll cue using `shared/scroll-cue.ts`.
- Update copy in the header/HUD (they read the registry automatically).

---

## 5. Gotchas

- **Index holes freeze boot.** `worldsRef` is sparse; a missing `index` means the pipeline is never created and the splash never finishes.
- **Two registries, one order.** `registry.ts` and `scene-registry.tsx` are not type-linked; keep them in lockstep.
- **Scene components render `null`.** Any chapter UI must be DOM in `Landing`/`SplashScreen` or 3D objects in the scene.
- **Do not add pointer listeners per scene.** Use `samplePointer` / `attachPointerSignal`.
- **Do not add a vignette or grain in a scene or transition.** `finishNode` already applies both.
- **Transition progress arrives pre-eased.** Applying `easeInOut` again makes handoffs feel sluggish.
- **Flip UVs for ported shaders.** See §3.8.
- **`transitionNode` indices are literal.** If chapters are reordered, the predicates pick the wrong shader (or silently fall back to liquid).
- **`prewarm` only walks consecutive pairs.** Special non-adjacent mappings compile on first use.
- **Dispose the world.** A scene that leaks its render targets will slow every subsequent chapter.
- **Only `WebGPURenderer`.** If a browser lacks WebGPU, `SceneStage` shows the CSS fallback instead of the canvas; the experience is intentionally degraded, not emulated with WebGL.
- **Reduced motion** slows scene time (`getSceneTime`) but does not disable transitions — the blend still advances with scroll.

---

## 6. Quick reference

| Concern                                         | File                                      |
| ----------------------------------------------- | ----------------------------------------- |
| One canvas + WebGPU bootstrap                   | `src/components/SceneStage.tsx`           |
| Register worlds / precompile / render loop      | `src/components/SceneDirector.tsx`        |
| Single render pipeline + all transition shaders | `src/lib/render-pipeline.ts`              |
| enter / animate / exit math                     | `src/lib/scroll-phases.ts`                |
| zustand store + virtual scroll engine           | `src/store/useScrollerStore.ts`           |
| Contracts                                       | `src/sections/types.ts`                   |
| Chapter order (metas)                           | `src/sections/registry.ts`                |
| Chapter order (components)                      | `src/sections/scene-registry.tsx`         |
| Camera / scene helpers                          | `src/sections/shared/scene-utils.ts`      |
| Pointer + phase accessors                       | `src/sections/shared/section-activity.ts` |
| Boot splash / progress                          | `src/components/SplashScreen.tsx`         |
| easy-fancy messaging + hash routing             | `src/components/Landing.tsx`              |

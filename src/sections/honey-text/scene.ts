// Chapter 01, ported from pmndrs/examples `r3f-alpha-6`: glass type standing on
// a golden-sunset floor with polka dots, refraction, caustics and room
// reflections. The original was an R3F page with a playback clock and a leva
// panel; this port keeps the scene modules and replaces the wrapper with a
// SectionWorld so it composes in this site's single WebGPU render pipeline.
import * as THREE from "three/webgpu";
import type { PerspectiveCamera, WebGPURenderer } from "three/webgpu";
import { pass } from "three/tsl";
import type { SectionWorld } from "../types";
import { samplePointer } from "../shared/section-activity";
import { useScrollerStore } from "@/store/useScrollerStore";
import { groundSettings, type GroundSettings } from "./settings";
import { createEnvironmentMap, loadStudio } from "./environment";
import { createGlass } from "./glass/create-glass";
import { updateGlass } from "./glass/update-glass";
import { captureTransmissionBackdrop } from "./glass/transmissionBackdrop";
import { createGround } from "./ground/ground";
import { createShadowLight } from "./ground/shadow-light";
import { createGlassTitle } from "./ground/glass-title";
import { createReflections } from "./ground/reflections";
import { groundLayout } from "./ground/layout";
import { alpha6Meta } from "./meta";

const ORIGIN = new THREE.Vector3();

type Stage = {
  size: THREE.Vector2;
  distance: number;
  titleAt: THREE.Vector3;
  titlePixel: number;
  ground: ReturnType<typeof createGround>;
  light: THREE.DirectionalLight;
  lightHome: THREE.Vector3;
  title: ReturnType<typeof createGlassTitle>;
};

export async function createAlpha6World(
  camera: PerspectiveCamera,
  renderer: WebGPURenderer,
): Promise<SectionWorld> {
  const settings: GroundSettings = groundSettings;
  const studio = await loadStudio();

  const scene = new THREE.Scene();
  const size = canvasSize(renderer);
  camera.aspect = size.x / size.y;
  camera.near = 1;
  camera.far = 100000;
  camera.updateProjectionMatrix();

  //* Environment + glass ==========================================
  const map = createEnvironmentMap(renderer, studio, settings.environment);
  scene.environment = map.texture;
  const distance = distanceFor(camera, size);
  const reflections = createReflections(
    renderer,
    scene,
    map.texture,
    distance * 20,
  );

  const glass = createGlass(renderer, scene, camera);
  glass.config.background = "#0a0b0f";

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.transmitted = true;

  //* Stage (everything that depends on the canvas size) ===========
  let stage: Stage | null = null;

  const disposeStage = (current: Stage) => {
    scene.remove(current.ground.root, current.light, current.title.root);
    current.light.dispose();
    current.ground.dispose();
    current.title.dispose();
  };

  const buildStage = (): Stage => {
    if (stage) disposeStage(stage);
    const nextSize = canvasSize(renderer);
    const nextDistance = distanceFor(camera, nextSize);
    camera.aspect = nextSize.x / nextSize.y;
    camera.near = nextDistance * 0.02;
    camera.far = nextDistance * 40;
    camera.updateProjectionMatrix();

    const layout = groundLayout(
      nextSize.x,
      nextSize.y,
      camera.fov,
      nextDistance,
    );
    // The title is anchored below center so it can extend away from the
    // camera without running under the site's header.
    const titleAt = layout.at(0, -nextSize.y * 0.16);
    const titlePixel = layout.scale(titleAt);

    const ground = createGround(nextSize.x, nextSize.y, nextDistance * 16);
    const light = createShadowLight(Math.max(nextSize.x, nextSize.y) * 1.2);
    scene.add(ground.root, light);
    scene.background = ground.horizon;
    glass.config.background = ground.horizon;

    const title = createGlassTitle(
      glass.material,
      settings,
      (width, depth) =>
        Math.min(
          (nextSize.x * 0.82 * titlePixel) / width,
          // Ground depth is foreshortened by about sin(pitch) on screen.
          (nextSize.y * 0.55 * titlePixel) / (depth * 0.9),
        ),
    );

    title.root.position.copy(titleAt);
    title.root.position.z = 10;
    scene.add(title.root);

    stage = {
      size: nextSize,
      distance: nextDistance,
      titleAt,
      titlePixel,
      ground,
      light,
      lightHome: light.position.clone(),
      title,
    };
    return stage;
  };

  //* Camera =======================================================
  const aim = new THREE.Vector2();
  let cameraDistance = distance;

  const updateCamera = (delta: number, pointer: { x: number; y: number }) => {
    const strength = settings.cameraMode === "Pointer" ? settings.parallax : 0;
    const blend =
      1 - Math.exp(-settings.cameraSmoothing * Math.min(delta, 0.05));
    aim.x = THREE.MathUtils.lerp(aim.x, pointer.x, blend);
    aim.y = THREE.MathUtils.lerp(aim.y, pointer.y, blend);

    const pitch = THREE.MathUtils.clamp(
      settings.cameraPitch + aim.y * settings.pointerY * strength,
      10,
      80,
    );
    const yaw = THREE.MathUtils.clamp(
      settings.cameraYaw + aim.x * settings.pointerX * strength,
      -80,
      80,
    );

    camera.position
      .setFromSphericalCoords(
        cameraDistance,
        THREE.MathUtils.degToRad(90 - pitch),
        THREE.MathUtils.degToRad(yaw),
      )
      .add(ORIGIN);
    camera.lookAt(ORIGIN);
    const zoom = settings.cameraZoom;
    if (camera.zoom !== zoom) {
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  };

  //* Runtime state ================================================
  const clock = { atmosphere: 0 };
  let frame = 0;
  let captureTick = 0;

  const initialStage = buildStage();
  cameraDistance = initialStage.distance;
  updateCamera(1, { x: 0, y: 0 });

  return {
    id: alpha6Meta.id,
    index: alpha6Meta.index,
    scene,
    camera,
    pass: pass(scene, camera),
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      const next = canvasSize(renderer);
      if (
        !stage ||
        Math.abs(next.x - stage.size.x) > 1 ||
        Math.abs(next.y - stage.size.y) > 1
      ) {
        const rebuilt = buildStage();
        cameraDistance = rebuilt.distance;
      }
    },
    animate({ elapsed, delta, phase }) {
      const dt = Math.min(delta, 0.05);
      const pointer = samplePointer(elapsed, dt);

      // Hold the shot until the splash has lifted.
      if (useScrollerStore.getState().bootPhase !== "ready") {
        updateCamera(dt, pointer);
        return;
      }

      clock.atmosphere += dt;

      const current = stage!;
      // Fixed camera pose: no fly-in, and the pointer no longer nudges it.
      updateCamera(dt, pointer);

      // The palette warms from sky blue to golden orange across the animate
      // phase; the exit holds the golden end.
      const warmth =
        phase.phase === "animate"
          ? phase.progress
          : phase.phase === "exit"
            ? 1
            : 0;

      // The floor is lit from the first frame: no scroll-linked reveal.
      current.ground.update(settings, 1, warmth);

      // The reflection dome applies the environment rotation and intensity.
      scene.environmentRotation.set(0, 0, 0);
      scene.environmentIntensity = 1;
      const key = current.light;
      key.intensity = settings.lightIntensity;
      const swing = aim.x * settings.lightFollow;
      const span = current.lightHome.y;
      key.position.set(
        current.lightHome.x + swing * span * 0.6,
        current.lightHome.y,
        current.lightHome.z - aim.y * settings.lightFollow * span * 0.5,
      );

      updateGlass(glass, settings, clock.atmosphere, warmth);

      current.title.update(settings);

      // Every other frame is plenty for reflections.
      if ((frame = (frame + 1) % 2) === 0) {
        scene.environment = reflections.update(
          current.title.root.position.clone().setY(current.titlePixel * 30),
          [current.title.root],
          [key],
          settings.environmentRotation + aim.x * settings.hdrFollow * 70,
          settings.environmentIntensity,
        );
      }

      captureTransmissionBackdrop(renderer, scene, camera, captureTick++);
    },
    dispose() {
      if (stage) disposeStage(stage);
      glass.dispose();
      reflections.dispose();
      map.dispose();
    },
  };
}

/** A dark stage so the chapter never goes black if the assets fail. */
export function createAlpha6FallbackWorld(
  camera: PerspectiveCamera,
): SectionWorld {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0a0b0f");
  return {
    id: alpha6Meta.id,
    index: alpha6Meta.index,
    scene,
    camera,
    pass: pass(scene, camera),
    resize() {},
    animate() {},
    dispose() {},
  };
}

function canvasSize(renderer: WebGPURenderer) {
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x < 2 || size.y < 2) {
    size.set(
      typeof window === "undefined" ? 1280 : window.innerWidth,
      typeof window === "undefined" ? 720 : window.innerHeight,
    );
  }
  return size;
}

/** At this distance one world unit at the target is one screen pixel. */
function distanceFor(camera: PerspectiveCamera, size: THREE.Vector2) {
  return size.y / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
}

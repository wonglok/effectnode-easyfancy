import * as THREE from "three/webgpu";
import type { PerspectiveCamera } from "three/webgpu";
import { pass } from "three/tsl";
import type { CameraConfig, SectionMeta, SectionWorld } from "../types";
import {
  addLights,
  disposeScene,
  easeInOut,
  makeSky,
  pointerDrift,
  setCameraPose,
} from "../shared/scene-utils";
import { samplePointer } from "../shared/section-activity";
import { createGrassField } from "../shared/grass";
import {
  attachSectionTitle,
  resizeSectionTitle,
} from "../shared/section-title";
import type { SectionPhaseState } from "@/lib/scroll-phases";

export const signalMeta: SectionMeta = {
  id: "signal",
  index: 7,
  chapter: "08",
  name: "Signal",
  title: "One scroll,\nfive worlds.",
  // A meadow at night rather than the chapter's old violet signal field.
  accent: "#a8f06a",
  surface: "#040905",
};

export const signalCamera: CameraConfig = {
  base: [0, 3.1, 9.2],
  fov: 44,
  drift: 0.3,
  orbit: 0.16,
  lookAt: [0, 0.45, -3.2],
};

const meta = signalMeta;

const HOME = signalCamera.base;
const LOOK_AT = signalCamera.lookAt ?? [0, 0.45, -3.2];
/** Rise from the ground far back in the field. */
const ENTER_FROM: [number, number, number] = [0, 0.7, 14.6];
/** Climb and drift back out over the terrain. */
const EXIT_TO: [number, number, number] = [0.6, 6.6, 14.2];

/**
 * Chapter 05 camera: enter rising out of the terrain, hold the beacon framing
 * static through the animate phase, then lift away over the field. Returns the
 * pointer drift so the closing title can cancel it.
 */
function updateCamera(
  camera: PerspectiveCamera,
  phase: SectionPhaseState,
  elapsed: number,
  delta: number,
) {
  const pointer = samplePointer(elapsed, Math.min(delta, 0.05));
  const drift = pointerDrift(
    pointer,
    elapsed,
    signalCamera.drift,
    signalCamera.orbit,
  );

  const t = easeInOut(phase.progress);
  let x: number;
  let y: number;
  let z: number;

  if (phase.phase === "enter") {
    x = ENTER_FROM[0] + (HOME[0] - ENTER_FROM[0]) * t;
    y = ENTER_FROM[1] + (HOME[1] - ENTER_FROM[1]) * t;
    z = ENTER_FROM[2] + (HOME[2] - ENTER_FROM[2]) * t;
  } else if (phase.phase === "animate") {
    x = HOME[0];
    y = HOME[1];
    z = HOME[2];
  } else {
    x = HOME[0] + (EXIT_TO[0] - HOME[0]) * t;
    y = HOME[1] + (EXIT_TO[1] - HOME[1]) * t;
    z = HOME[2] + (EXIT_TO[2] - HOME[2]) * t;
  }

  setCameraPose(camera, [x + drift.x, y + drift.y, z], LOOK_AT);
  return drift;
}

const lookTarget = new THREE.Vector3(LOOK_AT[0], LOOK_AT[1], LOOK_AT[2]);
/** Drift-free camera pose, used to isolate the drift transform each frame. */
const baseCamera = new THREE.PerspectiveCamera();
const driftRotation = new THREE.Quaternion();

export function createSignalWorld(camera: PerspectiveCamera): SectionWorld {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(meta.surface, 0.035);

  const sky = makeSky(scene, "#0d1a10", "#020503", meta.accent, 0.05);
  addLights(scene, meta.accent, 34, 18);

  // The chapter is the meadow. The field is the template's clumped, wind-blown
  // TSL grass, tinted to this chapter's violet and built as one instanced draw
  // with culling off, so it never pops at the frustum edge.
  const grass = createGrassField({
    instances: 38000,
    width: 30,
    depth: 17.4,
    center: [0, -1.75, -3.4],
    bladeWidth: 0.035,
    bladeHeight: 0.7,
    tipColor: meta.accent,
    bottomColor: "#0d240f",
    emissiveStrength: 0.26,
    clumpScale: 6,
    clumpStrength: 0.85,
    seed: 404,
  });
  scene.add(grass.mesh);

  // Closing title, built the same way as chapter 01's: extruded metal type
  // floating in front of the camera's opening pose, first line paper white and
  // the second in the chapter accent. It is world geometry, so it takes part in
  // the meadow's lighting and depth.
  const title = attachSectionTitle(
    scene,
    camera,
    "One scroll,\nmany worlds.",
    meta.accent,
  );

  title.position.y = 2.5;
  // The title is world geometry, but the meadow's pointer drift should not
  // drag it around the frame. Keep its authored pose and cancel exactly the
  // camera's drift transform in animate, leaving the scroll parallax intact.
  const titleBasePosition = title.position.clone();
  const titleBaseQuaternion = title.quaternion.clone();

  return {
    id: meta.id,
    index: meta.index,
    scene,
    camera,
    pass: pass(scene, camera),
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      resizeSectionTitle(title, camera);
    },
    animate({ elapsed, delta, phase }) {
      const drift = updateCamera(camera, phase, elapsed, delta);

      // Cancel the drift's translation and rotation on the title only. The
      // base pose is the camera with the drift subtracted, so the title keeps
      // its parallax as the phase moves but holds still when the pointer does.
      baseCamera.position.set(
        camera.position.x - drift.x,
        camera.position.y - drift.y,
        camera.position.z,
      );
      baseCamera.lookAt(lookTarget);
      driftRotation
        .copy(baseCamera.quaternion)
        .invert()
        .premultiply(camera.quaternion);

      title.position
        .copy(titleBasePosition)
        .sub(baseCamera.position)
        .applyQuaternion(driftRotation)
        .add(camera.position);
      title.quaternion.copy(driftRotation).multiply(titleBaseQuaternion);
    },
    dispose() {
      sky.geometry.dispose();
      (sky.material as THREE.Material).dispose();
      disposeScene(scene);
    },
  };
}

import * as THREE from "three/webgpu";
import type { PerspectiveCamera } from "three/webgpu";
import {
  cameraPosition,
  clamp,
  cubeTexture,
  dot,
  float,
  mix,
  normalWorld,
  pass,
  positionWorld,
  pow,
  reflect,
  reflectVector,
  refract,
  texture,
  uv,
  vec3,
} from "three/tsl";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { Font, type FontData } from "three/addons/loaders/FontLoader.js";
import type { CameraConfig, SectionMeta, SectionWorld } from "../types";
import {
  disposeScene,
  easeInOut,
  pointerDrift,
  setCameraPose,
} from "../shared/scene-utils";
import { samplePointer } from "../shared/section-activity";
import type { SectionPhaseState } from "@/lib/scroll-phases";
// import Lovelo from "./lovelo";
import { createTouchSky } from "./touch-sky";
import { Helvetica } from "../shared/helvetica";

export const kineticMeta: SectionMeta = {
  id: "kinetic",
  index: 1,
  chapter: "02",
  name: "Kinetic",
  title: "Motion,\nnot video.",
  accent: "#c5e6ff",
  surface: "#021019",
};

export const kineticCamera: CameraConfig = {
  base: [0, 0, 20],
  fov: 75,
  drift: 0.18,
  orbit: 0,
};

const meta = kineticMeta;

/** Old scene framing: camera starts at 20 and scrolls in to 10. */
const HOME_Z = 20;
const ENTER_Z = 30;
const EXIT_Z = 16;
const LOOK_AT: [number, number, number] = [0, 0, 0];
/** Slow dolly-in distance across the animate phase, as in the reference. */
const DOLLY = 10;

/**
 * Chapter 02 camera: approach from far back, dolly toward the creatures as the
 * chapter holds, then retreat again for the hand-off.
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
    kineticCamera.drift,
    kineticCamera.orbit,
  );

  const t = easeInOut(phase.progress);
  let z: number;

  if (phase.phase === "enter") {
    z = ENTER_Z + (HOME_Z - ENTER_Z) * t;
  } else if (phase.phase === "animate") {
    z = HOME_Z - DOLLY * phase.progress;
  } else {
    z = HOME_Z - DOLLY + (EXIT_Z - (HOME_Z - DOLLY)) * t;
  }

  setCameraPose(camera, [drift.x, drift.y, z], LOOK_AT);
}

/** Flow map the original scene used to ripple the water refraction. */
const DUDV_URL = "/texture/dudv.jpg";
/** Centre text, as in the original scene. */
const CENTER_TEXT = "Welcome";
const font = new Font(Helvetica as unknown as FontData);

/** Visible world height at the camera's home depth. */
function viewHeightAtHome() {
  return 2 * Math.tan(THREE.MathUtils.degToRad(kineticCamera.fov / 2)) * HOME_Z;
}

/** Text target width: a wide banner that never overflows a portrait screen. */
function textWidthFor(aspect: number) {
  const height = viewHeightAtHome();
  return Math.min(height * aspect, height) * 0.55;
}

/** Loads the dudv map used by the water refraction shader. */
function loadDudv(): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      DUDV_URL,
      (loaded) => {
        loaded.wrapS = THREE.RepeatWrapping;
        loaded.wrapT = THREE.RepeatWrapping;
        resolve(loaded);
      },
      undefined,
      () => reject(new Error(`Failed to load ${DUDV_URL}`)),
    );
  });
}

/**
 * Full-screen water backdrop ported from the original shader to TSL: the cube
 * environment is refracted through three slightly different ratios, each
 * channel taking its own direction, and the dudv flow map pushes those
 * directions around so the surface shimmers. Reflection is mixed in by the
 * same fresnel term the reference material used.
 */
function createWoozyPlane(sky: THREE.CubeTexture, dudv: THREE.Texture | null) {
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: true,
  });

  const incident = positionWorld.sub(cameraPosition).normalize();
  const normal = normalWorld.normalize();
  const reflectDir = reflect(incident, normal);

  let distortion = null;
  if (dudv) {
    const surfaceUv = uv();
    const flow = texture(dudv, surfaceUv).rg;
    const advected = surfaceUv.add(flow.mul(0.12));
    distortion = texture(dudv, advected.mul(0.25)).rg.mul(2).sub(1).mul(0.12);
  }

  const refractDir = (ratio: number) => {
    const direction = refract(incident, normal, ratio);
    return distortion
      ? direction.add(vec3(distortion.x, distortion.y, 0))
      : direction;
  };

  const reflected = cubeTexture(sky, reflectDir).rgb;
  // Chromatic refraction: red, green and blue each see a slightly different
  // index, exactly like the reference material.
  const refracted = vec3(
    cubeTexture(sky, refractDir(1.02)).r,
    cubeTexture(sky, refractDir(1.0098)).g,
    cubeTexture(sky, refractDir(1.0)).b,
  );

  const fresnel = clamp(
    float(0.1 * 20).add(
      float(1.2 * 20).mul(
        pow(float(1).add(dot(incident, normal)), float(2.2 * 20)),
      ),
    ),
    0,
    1,
  );
  material.colorNode = mix(reflected, refracted, fresnel);

  const plane = new THREE.Mesh(new THREE.SphereGeometry(120, 32, 32), material);
  plane.position.set(0, 0, 0);
  plane.frustumCulled = false;
  return plane;
}

/**
 * Builds the extruded "Kinetic" sign from the Helvetica typeface and
 * gives it the original reflective cube-map finish.
 */
function createCenterText(camera: PerspectiveCamera, sky: THREE.CubeTexture) {
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  material.colorNode = cubeTexture(sky, reflectVector).rgb.mul(1.25).add(0.12);

  const mount = new THREE.Group();
  const fit = new THREE.Group();
  mount.add(fit);

  const geometry = new TextGeometry(CENTER_TEXT, {
    font,
    size: 1,
    depth: 0.12,
    curveSegments: 14,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.0245,
    bevelSegments: 5,
  });
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(
    -(box.min.x + box.max.x) / 2,
    -(box.min.y + box.max.y) / 2,
    0,
  );
  geometry.computeBoundingBox();
  const naturalWidth =
    geometry.boundingBox!.max.x - geometry.boundingBox!.min.x;

  geometry.center();

  const mesh = new THREE.Mesh(geometry, material);
  fit.add(mesh);

  const fitToView = (aspect: number) => {
    fit.scale.setScalar(textWidthFor(aspect) / naturalWidth);
  };
  fitToView(camera.aspect > 0 ? camera.aspect : 1.6);

  return { mount, fitToView };
}

type Bubble = {
  mount: THREE.Group;
  spinner: THREE.Group;
  shell: THREE.Mesh;
  radius: number;
  baseY: number;
  phase: number;
};

/**
 * Four iridescent soap bubbles in the reference scene's diagonal composition.
 * They share one sphere geometry and one thin-film physical material; only the
 * mount, radius and breathing phase differ per instance.
 */
function createBubbles(material: THREE.Material, height: number): Bubble[] {
  const layout = [
    { x: 0, y: -0.4, z: 0, roll: 0 },
    { x: 0.3, y: -0.1, z: -0.4, roll: -0.03 },
    { x: -0.4, y: -0.15, z: -0.55, roll: 0.03 },
    { x: 0, y: 0.15, z: -0.55, roll: 0.03 },
  ];
  const geometry = new THREE.SphereGeometry(1, 64, 48);

  return layout.map((entry, index) => {
    const mount = new THREE.Group();
    mount.position.set(entry.x * height, entry.y * height, entry.z * height);
    mount.rotation.z = entry.roll * Math.PI;

    const spinner = new THREE.Group();
    mount.add(spinner);

    const radius = height * (0.145 + (index % 2) * 0.016);
    const shell = new THREE.Mesh(geometry, material);
    shell.scale.setScalar(radius);
    // The breathing scale and the shell's translucency ignore static bounds.
    shell.frustumCulled = false;
    spinner.add(shell);

    return {
      mount,
      spinner,
      shell,
      radius,
      baseY: mount.position.y,
      phase: index * 1.7,
    };
  });
}

/**
 * Rebuilds chapter 02 from the original Jelly Fish Studio scene, ported to the
 * WebGPU/TSL renderer: the touch-trail cube map feeds a refracted water plate,
 * four iridescent bubbles and the extruded Lovelo sign.
 */
function buildKineticWorld(
  camera: PerspectiveCamera,
  dudv: THREE.Texture | null,
): SectionWorld {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#020a12");

  const sky = createTouchSky();
  const height = viewHeightAtHome();

  const water = createWoozyPlane(sky.texture, dudv);
  scene.add(water);

  const text = createCenterText(camera, sky.texture);
  scene.add(text.mount);

  const bubbleRotation = new THREE.Group();
  bubbleRotation.rotation.z = Math.PI * 0.15;
  scene.add(bubbleRotation);

  // Soap-bubble film: a physical node material with thin-film iridescence,
  // lit by the live touch-sky cube map so the rainbow shifts as the view moves.
  const bubbleMaterial = new THREE.MeshPhysicalNodeMaterial({
    color: "#ffffff",
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    metalness: 0,
    roughness: 0.02,
    ior: 1.33,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    iridescence: 1,
    iridescenceIOR: 1.45,
    iridescenceThicknessRange: [100, 1400],
    depthWrite: false,
  });
  bubbleMaterial.envNode = cubeTexture(
    sky.texture,
    reflectVector,
  ).rgb.mul(1.9);

  // Fresnel edge: the film is invisible face-on, so the silhouette carries a
  // hue sweep. The physical thin-film layer produces the same rainbow from the
  // reflected sky; this adds it to the emissive term so it reads on a dark set.
  const viewDirection = cameraPosition.sub(positionWorld).normalize();
  const facing = clamp(dot(normalWorld.normalize(), viewDirection), 0, 1);
  const rim = pow(float(1).sub(facing), 2.2);
  const hue = rim.mul(7.0);
  const rainbow = vec3(
    hue.cos().mul(0.5).add(0.5),
    hue.add(2.094).cos().mul(0.5).add(0.5),
    hue.add(4.188).cos().mul(0.5).add(0.5),
  );
  bubbleMaterial.emissiveNode = rainbow.mul(rim.mul(0.3));

  const bubbles = createBubbles(bubbleMaterial, height);
  for (const bubble of bubbles) bubbleRotation.add(bubble.mount);

  return {
    id: meta.id,
    index: meta.index,
    scene,
    camera,
    pass: pass(scene, camera),
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      text.fitToView(aspect);
    },
    animate({ elapsed, delta, phase }) {
      updateCamera(camera, phase, elapsed, delta);

      // The reference scene's scroll ramp: 0 on entry, 1 after the hold.
      const smooth =
        phase.phase === "animate"
          ? phase.progress
          : phase.phase === "exit"
            ? 1
            : 0;
      // The animate phase carries the bubbles half a rotation up the chapter;
      // enter holds 0° and exit keeps the half turn.
      const turn =
        phase.phase === "animate"
          ? phase.progress * Math.PI
          : phase.phase === "exit"
            ? Math.PI
            : 0;

      for (const bubble of bubbles) {
        // Breathe: a slow inhale swells the film and lifts the bubble.
        const breathe = Math.sin(elapsed * 0.85 + bubble.phase);
        const swell = 1 + breathe * 0.035;
        bubble.shell.scale.set(
          bubble.radius * swell,
          bubble.radius * (1 - breathe * 0.022),
          bubble.radius * swell,
        );
        bubble.mount.position.y =
          bubble.baseY +
          smooth * height * 0.5 * 2 +
          Math.sin(elapsed * 0.4 + bubble.phase) * 0.45;
        bubble.spinner.position.x =
          Math.sin(elapsed * 0.28 + bubble.phase) * 0.4;
        bubble.spinner.rotation.y =
          turn * 0.15 + Math.sin(elapsed * 0.2 + bubble.phase) * 0.2;
        bubble.spinner.rotation.z =
          Math.sin(elapsed * 0.33 + bubble.phase) * 0.05;
      }

      // The sign sinks below the frame and tilts flat as the chapter scrolls.
      text.mount.position.y = smooth * height * -0.3;
      text.mount.rotation.x = smooth * Math.PI * -0.5;
      text.mount.scale.setScalar(1 + smooth * 0.5);

      sky.update();
    },
    dispose() {
      sky.dispose();
      dudv?.dispose();
      disposeScene(scene);
    },
  };
}

export async function createKineticWorld(
  camera: PerspectiveCamera,
): Promise<SectionWorld> {
  const dudv = await loadDudv().catch((error) => {
    console.warn("Kinetic dudv map failed to load.", error);
    return null;
  });
  return buildKineticWorld(camera, dudv);
}

/** Renders the same bubbles without the flow map if it fails. */
export function createKineticFallbackWorld(
  camera: PerspectiveCamera,
): SectionWorld {
  return buildKineticWorld(camera, null);
}

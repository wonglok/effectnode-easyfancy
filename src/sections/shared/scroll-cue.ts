// ---------------------------------------------------------------------------
// Scroll cue
// ---------------------------------------------------------------------------
// A small "SCROLL DOWN" sign that floats in front of the camera on the opening
// chapter. It is built from real extruded type and a looping stack of chevrons,
// then anchored to the camera each frame so it reads as an overlay while still
// being 3D geometry.
//
// Both parts are animated in TSL: an iridescent gradient sweeps through the
// metal type, a fresnel rim keeps its bevels lit, and the chevrons carry a
// flowing highlight.
//
// The cue fades away as soon as the visitor starts scrolling, so it guides
// without staying in the way of the scene.
// ---------------------------------------------------------------------------

import * as THREE from "three/webgpu";
import type { PerspectiveCamera } from "three/webgpu";
import {
  abs,
  clamp,
  color,
  dot,
  mix,
  normalView,
  oneMinus,
  positionLocal,
  positionViewDirection,
  pow,
  sin,
  smoothstep,
  time,
  vec3,
} from "three/tsl";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { Font, type FontData } from "three/addons/loaders/FontLoader.js";
import { Helvetica } from "./helvetica";

const font = new Font(Helvetica as unknown as FontData);

/** Distance in front of the camera the cue floats at. */
const CUE_DISTANCE = 2.6;
/** Text spans this share of the visible width, capped so it stays delicate. */
const CUE_WIDTH_RATIO = 0.288;
const CUE_MAX_WIDTH = 0.96;
/** Bottom offset from the view centre, as a share of the visible height. */
const CUE_BOTTOM_OFFSET = 0.34;
/** One downward pass of a chevron, in seconds. */
const CHEVRON_CYCLE = 1.7;
/** How far a chevron travels before it restarts. */
const CHEVRON_TRAVEL = 0.1;
const CHEVRON_BASE_Y = [-0.12, -0.192, -0.264];
const PAPER = "#f3f0e7";

export type ScrollCue = {
  /** Add this to the scene; `update` keeps it anchored to the camera. */
  object: THREE.Group;
  /** `amount` is the fade (0..1), driven by the chapter's scroll progress. */
  update(camera: PerspectiveCamera, elapsed: number, amount: number): void;
  dispose(): void;
};

/** A flat V-shaped band, used three times for the descending motion. */
function makeChevronGeometry() {
  const width = 0.136;
  const drop = 0.06;
  const thickness = 0.0192;

  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(0, -drop);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, -thickness);
  shape.lineTo(0, -drop - thickness);
  shape.lineTo(-width / 2, -thickness);
  shape.closePath();

  return new THREE.ShapeGeometry(shape);
}

export function createScrollCue(accent: string): ScrollCue {
  const object = new THREE.Group();
  object.renderOrder = 20;

  const textGeometry = new TextGeometry("Scroll down", {
    font,
    size: 1,
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.004,
    bevelSegments: 2,
    curveSegments: 8,
  });
  textGeometry.computeBoundingBox();
  const textBox = textGeometry.boundingBox!;
  const naturalWidth = textBox.max.x - textBox.min.x;
  textGeometry.translate(
    -(textBox.min.x + textBox.max.x) / 2,
    -(textBox.min.y + textBox.max.y) / 2,
    0,
  );

  // Fully TSL-shaded type: a fake key/fill pair lights the extruded bevels
  // instead of the scene environment, so the iridescence stays readable over
  // the bright villa reflection. Lime and ice trade places across the letters,
  // a fresnel rim lifts the edges, and a narrow band sweeps past.
  const textMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });

  const surfaceNormal = normalView.normalize();
  const keyLight = clamp(
    dot(surfaceNormal, vec3(-0.35, 0.85, 0.5).normalize()),
    0,
    1,
  );
  const fillLight = clamp(
    dot(surfaceNormal, vec3(0.45, -0.1, 0.9).normalize()),
    0,
    1,
  );
  const lit = keyLight.mul(0.55).add(fillLight.mul(0.25)).add(0.4);

  const sweep = sin(positionLocal.x.mul(0.85).sub(time.mul(1.6)))
    .mul(0.5)
    .add(0.5);
  const iridescent = mix(vec3(0.4, 1.0, 0.52), vec3(0.45, 0.82, 1.0), sweep);
  const facing = abs(dot(surfaceNormal, positionViewDirection));
  const rim = pow(oneMinus(facing), 2.2);
  const band = smoothstep(
    0.72,
    1.0,
    sin(positionLocal.x.mul(0.8).sub(time.mul(2.2)))
      .mul(0.5)
      .add(0.5),
  );
  // Fine horizontal shimmer travelling across the letters.
  const shimmer = sin(positionLocal.y.mul(40).sub(time.mul(3.0)))
    .mul(0.5)
    .add(0.5);

  textMaterial.colorNode = mix(color(PAPER), iridescent, 0.8)
    .mul(lit.mul(shimmer.mul(0.25).add(0.85)))
    .add(vec3(1).mul(pow(keyLight, 5).mul(0.5)))
    .add(iridescent.mul(rim.mul(1.5)))
    .add(vec3(1).mul(band.mul(0.8)));
  textMaterial.fog = false;

  const textMesh = new THREE.Mesh(textGeometry, textMaterial);
  textMesh.renderOrder = 21;
  object.add(textMesh);

  const chevronGeometry = makeChevronGeometry();
  const chevrons = CHEVRON_BASE_Y.map((baseY) => {
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    // A highlight runs down each band, so the stack reads as motion even
    // between its downward steps.
    const flow = sin(positionLocal.y.mul(55).sub(time.mul(4.2)))
      .mul(0.5)
      .add(0.5);
    material.colorNode = mix(color(accent), vec3(0.78, 1.0, 0.82), flow).mul(
      1.35,
    );
    material.fog = false;

    const mesh = new THREE.Mesh(chevronGeometry, material);
    mesh.position.y = baseY;
    mesh.renderOrder = 22;
    object.add(mesh);
    return mesh;
  });

  const forward = new THREE.Vector3();
  const up = new THREE.Vector3();

  return {
    object,
    update(camera, elapsed, amount) {
      const visible =
        2 * CUE_DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const aspect = camera.aspect > 0 ? camera.aspect : 1.6;
      const visibleWidth = visible * aspect;

      // Fit the type to the viewport every frame so a resize never crops it.
      const width = Math.min(visibleWidth * CUE_WIDTH_RATIO, CUE_MAX_WIDTH);
      const breathe = 1 + Math.sin(elapsed * 2) * 0.01;
      textMesh.scale.setScalar((width / naturalWidth) * breathe);

      // Follow the camera's current pose, with a slow float on top.
      forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
      up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      const bob = Math.sin(elapsed * 1.5) * visible * 0.008;
      object.position
        .copy(camera.position)
        .addScaledVector(forward, CUE_DISTANCE)
        .addScaledVector(up, -visible * CUE_BOTTOM_OFFSET + bob);
      object.quaternion.copy(camera.quaternion);
      object.visible = amount > 0.001;

      textMaterial.opacity = (0.74 + Math.sin(elapsed * 2) * 0.12) * amount;

      // The chevrons leave the type in a staggered stream and fade out at the
      // bottom of their travel, pointing the eye down the page.
      chevrons.forEach((mesh, index) => {
        const progress =
          (((elapsed / CHEVRON_CYCLE + index / chevrons.length) % 1) + 1) % 1;
        mesh.position.y = CHEVRON_BASE_Y[index] - progress * CHEVRON_TRAVEL;
        (mesh.material as THREE.MeshBasicNodeMaterial).opacity =
          Math.sin(progress * Math.PI) * 0.9 * amount;
      });
    },
    dispose() {
      textGeometry.dispose();
      textMaterial.dispose();
      chevronGeometry.dispose();
      chevrons.forEach((mesh) => {
        (mesh.material as THREE.Material).dispose();
      });
    },
  };
}

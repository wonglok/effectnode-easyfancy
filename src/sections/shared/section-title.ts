import * as THREE from "three/webgpu";
import { color } from "three/tsl";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { Font, type FontData } from "three/addons/loaders/FontLoader.js";
import { Helvetica } from "./helvetica";

const font = new Font(Helvetica as unknown as FontData);

/** Distance in front of the camera where the title floats. */
const TITLE_DISTANCE = 3.2;
/** Fraction of the viewport width the title spans on wide screens. */
const TITLE_WIDTH_RATIO = 0.6;
/** Bolder ratio on portrait screens, where the title is the main focal point. */
const NARROW_TITLE_WIDTH_RATIO = 0.82;
/** Aspect below which the narrow ratio applies (phones in portrait). */
const NARROW_ASPECT = 0.8;
/** Aspect the title is designed around; wider viewports do not widen it. */
const TITLE_ASPECT = 1.4;
/** Gap between title lines, relative to the text unit size. */
const LINE_GAP = 0.22;
const PAPER = "#f3f0e7";

/**
 * Small equirectangular sky/ground gradient used only by the title material,
 * so the metal has something to reflect in scenes without an HDR.
 */
let titleEnvironment: THREE.CanvasTexture | null = null;

function getTitleEnvironment() {
  if (titleEnvironment || typeof document === "undefined") {
    return titleEnvironment;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.42, "#aebdcc");
  gradient.addColorStop(0.55, "#39424b");
  gradient.addColorStop(1, "#05070a");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  titleEnvironment = new THREE.CanvasTexture(canvas);
  titleEnvironment.mapping = THREE.EquirectangularReflectionMapping;
  return titleEnvironment;
}

/**
 * Width the title should occupy at the given viewport aspect: it fills more of
 * a portrait screen, and stops growing once the viewport is wide enough.
 */
function visibleHeightFor(camera: THREE.PerspectiveCamera) {
  return (
    2 * TITLE_DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  );
}

function titleWidthFor(camera: THREE.PerspectiveCamera, aspect: number) {
  const visibleHeight = visibleHeightFor(camera);
  const framedAspect = Math.min(Math.max(aspect, 0.2), TITLE_ASPECT);
  const ratio =
    aspect < NARROW_ASPECT ? NARROW_TITLE_WIDTH_RATIO : TITLE_WIDTH_RATIO;
  return visibleHeight * framedAspect * ratio;
}

/**
 * Builds the chapter title (from the section config) as extruded 3D text and
 * places it in world space just in front of the camera's opening pose, so it
 * takes part in the scene's lighting, depth and parallax. The first line is
 * paper white, the following lines use the accent.
 */
export function attachSectionTitle(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  title: string,
  accent: string,
  /** How far in front of the camera's opening pose the text floats. */
  distance = TITLE_DISTANCE,
): THREE.Group {
  const group = new THREE.Group();

  const viewportAspect = camera.aspect > 0 ? camera.aspect : TITLE_ASPECT;
  // Size the text for the current viewport; as world geometry it keeps its
  // physical size and gains parallax as the camera moves.
  const targetWidth = titleWidthFor(camera, viewportAspect);

  const lines = title
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const geometries = lines.map((line) => {
    const geometry = new TextGeometry(line, {
      font,
      size: 1,
      depth: 0.08,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.005,
      bevelSegments: 2,
      curveSegments: 10,
    });
    geometry.computeBoundingBox();
    return geometry;
  });

  const widest = Math.max(
    ...geometries.map(
      (geometry) => geometry.boundingBox!.max.x - geometry.boundingBox!.min.x,
    ),
  );
  const scale = targetWidth / widest;
  // Remember the width the geometry was built at so resize can re-fit it by
  // scaling the whole group instead of rebuilding the text.
  group.userData.titleWidth = targetWidth;

  geometries.forEach((geometry) => {
    geometry.scale(scale, scale, scale);
    geometry.computeBoundingBox();
  });

  const heights = geometries.map(
    (geometry) => geometry.boundingBox!.max.y - geometry.boundingBox!.min.y,
  );
  const gap = LINE_GAP * scale;
  const totalHeight =
    heights.reduce((sum, height) => sum + height, 0) +
    gap * Math.max(0, lines.length - 1);

  let cursor = totalHeight / 2;

  geometries.forEach((geometry, index) => {
    const box = geometry.boundingBox!;
    geometry.translate(
      -(box.min.x + box.max.x) / 2,
      -(box.min.y + box.max.y) / 2,
      0,
    );

    const tint = index === 0 ? PAPER : accent;
    const material = new THREE.MeshPhysicalNodeMaterial({
      metalness: 1.05,
      roughness: 0.15,
      // clearcoat: 1,
      // clearcoatRoughness: 0.08,
      envMapIntensity: 1.0,
      // transmission: 1,
      // thickness: 3,
      // iridescence: 1,
    });

    material.colorNode = color(tint);
    // A little self-light keeps the metal readable in scenes without an
    // environment map; the specular highlights come from the scene lights.
    material.emissiveNode = color(tint).mul(0.12);
    material.envMap = getTitleEnvironment();
    material.envMapIntensity = 1.35;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = cursor - heights[index] / 2;
    group.add(mesh);

    cursor -= heights[index] + gap;
  });

  // Place the title in world space, a little in front of the camera's initial
  // pose and facing it, so it participates in lighting and depth.
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
    camera.quaternion,
  );
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

  group.position
    .copy(camera.position)
    .addScaledVector(forward, distance)
    .addScaledVector(up, visibleHeightFor(camera) * 0.05);
  group.quaternion.copy(camera.quaternion);

  // A scene-local key light gives the metal specular highlights in scenes
  // that do not provide an environment map.
  const titleKey = new THREE.PointLight(0xffffff, 16, 8, 2);
  titleKey.position
    .copy(group.position)
    .addScaledVector(right, -1.2)
    .addScaledVector(up, 1.3)
    .addScaledVector(forward, 0.6);

  scene.add(group, titleKey);

  group.position.y = 1.55;

  return group;
}

/**
 * Re-fits the title to the current camera aspect. The text is world geometry,
 * so portrait screens scale it down to fit the narrow width and wide screens
 * keep it at its designed size instead of stretching it.
 */
export function resizeSectionTitle(
  group: THREE.Group,
  camera: THREE.PerspectiveCamera,
) {
  const baseWidth = group.userData.titleWidth as number | undefined;
  if (!baseWidth) return;

  const aspect =
    camera.aspect > 0 && Number.isFinite(camera.aspect)
      ? camera.aspect
      : TITLE_ASPECT;
  group.scale.setScalar(titleWidthFor(camera, aspect) / baseWidth);
}

const titleNormal = new THREE.Vector3();
const titleOffset = new THREE.Vector3();

/**
 * Hides the title once a moving camera crosses its plane. From behind, the
 * extruded letters would read mirrored, so the group is simply not drawn.
 */
export function updateSectionTitleVisibility(
  group: THREE.Group,
  camera: THREE.PerspectiveCamera,
) {
  group.getWorldDirection(titleNormal);
  titleOffset.copy(camera.position).sub(group.position);
  group.visible = titleNormal.dot(titleOffset) > 0;
}

/** Frees the title meshes when a scene does not use disposeScene(). */
export function disposeSectionTitle(group: THREE.Group) {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
}

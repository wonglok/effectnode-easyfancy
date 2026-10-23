// Live monitor content for the monitors chapter: small scenes rendered into
// render targets and mapped onto the panel meshes of the computer wall, the
// imperative equivalent of drei's <RenderTexture> in the reference demo.
// Every screen shows a heart, since each panel samples only a sub-rect of the
// feed, the hearts are placed on the rect centres the panels actually show.
import * as THREE from "three/webgpu";
import type { WebGPURenderer } from "three/webgpu";
import { oneMinus, texture, uv, vec2 } from "three/tsl";

const FEED_SIZE = 256;
const FEED_FOV = 50;

export type ScreenFeed = {
  material: THREE.MeshBasicNodeMaterial;
  update: (elapsed: number, delta: number) => void;
  render: (renderer: WebGPURenderer) => void;
  dispose: () => void;
};

export type HeartPlacement = { x: number; y: number };

export type HeartFeedOptions = {
  background: string;
  color: string;
  /** Camera distance. Panel rects are framed for 15 (texts) or 10 (orange). */
  cameraZ: number;
  /** Heart centres in the feed camera's world plane. */
  placements: HeartPlacement[];
  /** Heart width in world units. */
  size: number;
  /** Offsets the heartbeat phases between screens. */
  phase?: number;
};

function createFeed(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  updateScene?: (elapsed: number, delta: number) => void,
): ScreenFeed {
  const target = new THREE.RenderTarget(FEED_SIZE, FEED_SIZE, {
    type: THREE.HalfFloatType,
  });
  target.texture.anisotropy = 4;

  // WebGPU render targets store their rows top-down while the panels' UVs
  // expect the usual bottom-up v, so flip v when sampling the feed.
  const material = new THREE.MeshBasicNodeMaterial({ toneMapped: false });
  const panelUv = uv();
  material.colorNode = texture(
    target.texture,
    vec2(panelUv.x, oneMinus(panelUv.y)),
  );

  return {
    material,
    update(elapsed, delta) {
      updateScene?.(elapsed, delta);
    },
    render(renderer) {
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
    },
    dispose() {
      const disposables = new Set<THREE.Material>();
      const geometries = new Set<THREE.BufferGeometry>();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (!mesh.material) return;
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const entry of materials) disposables.add(entry);
      });
      for (const entry of geometries) entry.dispose();
      for (const entry of disposables) entry.dispose();
      material.dispose();
      target.dispose();
      scene.clear();
    },
  };
}

/** A classic two-lobe heart, `width` units across. */
function makeHeartGeometry(width: number) {
  const shape = new THREE.Shape();
  shape.moveTo(0, -1);
  shape.bezierCurveTo(0, -0.55, -1, 0.1, -1, 0.62);
  shape.bezierCurveTo(-1, 1.25, -0.4, 1.45, 0, 0.92);
  shape.bezierCurveTo(0.4, 1.45, 1, 1.25, 1, 0.62);
  shape.bezierCurveTo(1, 0.1, 0, -0.55, 0, -1);

  const geometry = new THREE.ShapeGeometry(shape, 24);
  geometry.center();
  geometry.scale(width * 0.5, width * 0.5, 1);
  return geometry;
}

/** A feed of softly beating hearts on a flat colour. */
export function createHeartFeed(options: HeartFeedOptions): ScreenFeed {
  const { background, color, cameraZ, placements, size, phase = 0 } = options;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);

  const camera = new THREE.PerspectiveCamera(FEED_FOV, 1, 0.1, 100);
  camera.position.set(0, 0, cameraZ);

  const geometry = makeHeartGeometry(size);
  const material = new THREE.MeshBasicNodeMaterial({
    color,
    toneMapped: false,
  });

  const hearts = placements.map((placement, index) => {
    const heart = new THREE.Mesh(geometry, material);
    heart.position.set(placement.x, placement.y, 0);
    heart.userData.baseY = placement.y;
    heart.userData.phase = phase + index * 0.6;
    scene.add(heart);
    return heart;
  });

  return createFeed(scene, camera, (elapsed) => {
    for (const heart of hearts) {
      const heartPhase = heart.userData.phase as number;
      const beat = Math.sin(elapsed * 2.2 + heartPhase);
      heart.scale.setScalar(1 + beat * 0.07);
      heart.position.y =
        (heart.userData.baseY as number) +
        Math.sin(elapsed * 0.9 + heartPhase) * 0.05;
      heart.rotation.z = Math.sin(elapsed * 0.6 + heartPhase) * 0.04;
    }
  });
}

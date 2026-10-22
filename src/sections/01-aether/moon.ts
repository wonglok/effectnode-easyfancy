// ---------------------------------------------------------------------------
// Chapter 01 moon
// ---------------------------------------------------------------------------
// A self-lit moon disc pinned to the upper-right of the camera's view. It is
// drawn as a sprite rather than a sphere because the moon is effectively at
// infinity: a billboard keeps it circular from every camera angle, while its
// position is recomputed each frame from the camera's quaternion so scroll and
// hand-held drift never move it out of frame.
//
// Both the surface and the halo are generated on a canvas, so the scene gains
// no network assets and the moon stays crisp at any canvas resolution.
// ---------------------------------------------------------------------------

import * as THREE from "three/webgpu";
import { mulberry32 } from "../shared/scene-utils";

/** Far enough out that villa/water geometry cannot occlude it. */
const MOON_DISTANCE = 160;
/** Upper-right composition in NDC: +1 is the right/top edge. */
const MOON_NDC_X = 0.6;
const MOON_NDC_Y = 0.52;
/** Disc diameter as a fraction of the viewport height. */
const MOON_VIEW_SIZE = 0.095;
const HALO_SCALE = 2.9;
const TEXTURE_SIZE = 512;
const HALO_TEXTURE_SIZE = 256;

export type AetherMoon = {
  object: THREE.Group;
  update(camera: THREE.PerspectiveCamera, aspect: number): void;
  dispose(): void;
};

/** A soft, warm disc of craters with a subtle limb shadow. */
function createMoonTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create the moon texture.");

  const center = TEXTURE_SIZE / 2;
  const radius = center - 2;
  const random = mulberry32(0x0a37e2);

  const insideDisc = () => {
    // Polar placement keeps the craters evenly spread instead of clustering
    // in the middle, where a uniform square sample would put most of them.
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radius * 0.93;
    return {
      x: center + Math.cos(angle) * distance,
      y: center + Math.sin(angle) * distance,
    };
  };

  context.save();
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.clip();

  // Base moon: a warm, uneven ivory rather than a flat white circle.
  const surface = context.createRadialGradient(
    center - radius * 0.24,
    center - radius * 0.3,
    radius * 0.08,
    center,
    center,
    radius,
  );
  surface.addColorStop(0, "#fffdf4");
  surface.addColorStop(0.52, "#ece6d6");
  surface.addColorStop(0.84, "#cfc8b8");
  surface.addColorStop(1, "#b3ac9d");
  context.fillStyle = surface;
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  // Broad maria. Overlapping transparent gradients read as soft basalt seas
  // instead of hard painted blobs.
  for (let index = 0; index < 9; index += 1) {
    const x = center + (random() - 0.5) * radius * 1.45;
    const y = center + (random() - 0.5) * radius * 1.45;
    const blobRadius = radius * (0.18 + random() * 0.27);
    const maria = context.createRadialGradient(x, y, 0, x, y, blobRadius);
    maria.addColorStop(0, "rgba(102, 104, 101, 0.2)");
    maria.addColorStop(0.58, "rgba(115, 116, 110, 0.11)");
    maria.addColorStop(1, "rgba(130, 130, 122, 0)");
    context.fillStyle = maria;
    context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  }

  // Fine grain, so the disc does not look like flat vector art up close.
  for (let index = 0; index < 5200; index += 1) {
    const point = insideDisc();
    const light = random() > 0.5;
    context.fillStyle = light
      ? `rgba(255, 252, 240, ${0.02 + random() * 0.035})`
      : `rgba(69, 68, 62, ${0.015 + random() * 0.03})`;
    context.fillRect(point.x, point.y, 1 + random(), 1 + random());
  }

  // Craters: a dark bowl, a bright rim on the lit side and a soft shadow on
  // the far side. Small craters outnumber large ones.
  for (let index = 0; index < 110; index += 1) {
    const point = insideDisc();
    const craterRadius = 1.5 + Math.pow(random(), 2.4) * 15;
    const bowl = context.createRadialGradient(
      point.x - craterRadius * 0.12,
      point.y - craterRadius * 0.12,
      craterRadius * 0.08,
      point.x,
      point.y,
      craterRadius,
    );
    bowl.addColorStop(0, "rgba(86, 84, 78, 0.2)");
    bowl.addColorStop(0.7, "rgba(94, 92, 85, 0.1)");
    bowl.addColorStop(1, "rgba(94, 92, 85, 0)");
    context.fillStyle = bowl;
    context.beginPath();
    context.arc(point.x, point.y, craterRadius, 0, Math.PI * 2);
    context.fill();

    context.lineWidth = Math.max(0.7, craterRadius * 0.14);
    context.strokeStyle = "rgba(255, 252, 242, 0.18)";
    context.beginPath();
    context.arc(
      point.x,
      point.y,
      craterRadius * 0.82,
      Math.PI * 1.05,
      Math.PI * 1.9,
    );
    context.stroke();

    context.strokeStyle = "rgba(67, 64, 58, 0.16)";
    context.beginPath();
    context.arc(
      point.x,
      point.y,
      craterRadius * 0.78,
      Math.PI * 0.1,
      Math.PI * 0.9,
    );
    context.stroke();
  }

  // Gentle top-left illumination and a darker lower-right edge give the disc
  // some volume without pretending the moon has a terminator.
  const lighting = context.createLinearGradient(
    center - radius,
    center - radius,
    center + radius,
    center + radius,
  );
  lighting.addColorStop(0, "rgba(255, 255, 255, 0.17)");
  lighting.addColorStop(0.48, "rgba(255, 255, 255, 0)");
  lighting.addColorStop(1, "rgba(44, 44, 38, 0.22)");
  context.fillStyle = lighting;
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  // Limb darkening; a slightly brighter rim keeps the silhouette clean.
  const limb = context.createRadialGradient(
    center,
    center,
    radius * 0.66,
    center,
    center,
    radius,
  );
  limb.addColorStop(0, "rgba(28, 27, 24, 0)");
  limb.addColorStop(0.82, "rgba(28, 27, 24, 0.18)");
  limb.addColorStop(1, "rgba(28, 27, 24, 0.42)");
  context.fillStyle = limb;
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  context.restore();

  context.lineWidth = 1.5;
  context.strokeStyle = "rgba(255, 250, 232, 0.4)";
  context.beginPath();
  context.arc(center, center, radius - 0.75, 0, Math.PI * 2);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** A soft warm halo, drawn separately so it can be additive. */
function createHaloTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = HALO_TEXTURE_SIZE;
  canvas.height = HALO_TEXTURE_SIZE;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create the moon halo texture.");

  const center = HALO_TEXTURE_SIZE / 2;
  const glow = context.createRadialGradient(
    center,
    center,
    0,
    center,
    center,
    center,
  );
  glow.addColorStop(0, "rgba(255, 247, 218, 0.58)");
  glow.addColorStop(0.2, "rgba(255, 244, 206, 0.26)");
  glow.addColorStop(0.46, "rgba(222, 228, 224, 0.08)");
  glow.addColorStop(1, "rgba(150, 180, 190, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, HALO_TEXTURE_SIZE, HALO_TEXTURE_SIZE);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Builds the moon group and returns an updater that keeps it at the same
 * screen-space position and size for any camera aspect ratio.
 */
export function createAetherMoon(): AetherMoon {
  const object = new THREE.Group();

  const haloTexture = createHaloTexture();
  const haloMaterial = new THREE.SpriteMaterial({
    map: haloTexture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const halo = new THREE.Sprite(haloMaterial);
  halo.renderOrder = 1;
  halo.frustumCulled = false;

  const moonTexture = createMoonTexture();
  const moonMaterial = new THREE.SpriteMaterial({
    map: moonTexture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const disc = new THREE.Sprite(moonMaterial);
  disc.renderOrder = 2;
  disc.frustumCulled = false;

  object.add(halo, disc);

  const localOffset = new THREE.Vector3();

  return {
    object,
    update(camera, aspect) {
      const halfHeight =
        Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * MOON_DISTANCE;
      const halfWidth = halfHeight * Math.max(aspect, 0.001);

      // Camera-local coordinates put the moon at a fixed point in the frame,
      // independent of where the scroll spline is pointing the camera.
      localOffset.set(
        MOON_NDC_X * halfWidth,
        MOON_NDC_Y * halfHeight,
        -MOON_DISTANCE,
      );
      localOffset.applyQuaternion(camera.quaternion);
      object.position.copy(camera.position).add(localOffset);

      const diameter = MOON_VIEW_SIZE * halfHeight * 2;
      disc.scale.setScalar(diameter);
      halo.scale.setScalar(diameter * HALO_SCALE);
    },
    dispose() {
      moonTexture.dispose();
      haloTexture.dispose();
      moonMaterial.dispose();
      haloMaterial.dispose();
      object.clear();
    },
  };
}

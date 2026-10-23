import {
  Color,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
} from "three/webgpu";
import {
  color,
  mix,
  positionWorld,
  smoothstep,
  uniform,
} from "three/tsl";
import { hexGrid } from "../grid";
import { alpha6WarmTheme, blendThemeColor } from "../theme";
import { CausticReceiverMaterial } from "./caustics";
import type { GroundSettings } from "../settings";

/**
 * The floor the glass lies on: a static golden-sunset gradient with polka dots,
 * fading into a flat horizon, and catching shadows from the letters.
 */
export function createGround(width: number, height: number, extent: number) {
  const root = new Group();
  const reveal = uniform(0),
    gridAlpha = uniform(0.2),
    cellSize = uniform(48),
    gridColor = uniform(new Color());
  const dotOpacity = uniform(1),
    horizon = uniform(new Color()),
    base = new Color(),
    // Sky ramp: deeper blue toward the camera, sky blue into the distance.
    // Uniforms, so the palette can turn with the chapter's scroll.
    skyNear = uniform(new Color("#bfe8ff")),
    skyFar = uniform(new Color("#2f74d8"));
  const world = positionWorld.xz;
  const sky = mix(
    skyNear,
    skyFar,
    smoothstep(height * -0.9, height * 0.35, world.y),
  );
  const surface = mix(color("#080a0e"), sky, reveal);
  const reach = Math.max(width, height);
  // Animated honeycomb grid, faded out with distance.
  const pattern = hexGrid(world, cellSize, dotOpacity)
    .mul(smoothstep(reach, reach * 0.4, world.length()))
    .mul(gridAlpha);
  const material = new MeshBasicNodeMaterial({ toneMapped: false });
  material.colorNode = mix(
    mix(surface, gridColor, pattern),
    horizon,
    smoothstep(extent * 0.12, extent * 0.5, world.length()),
  );
  const geometry = new PlaneGeometry(extent * 2, extent * 2);
  const floor = new Mesh(geometry, material);
  floor.rotation.x = -Math.PI / 2;
  const shadowStrength = uniform(0.7);
  const shadowMaterial = new CausticReceiverMaterial(shadowStrength);
  const shadows = new Mesh(geometry, shadowMaterial);
  shadows.rotation.x = -Math.PI / 2;
  shadows.position.y = 1;
  shadows.receiveShadow = true;
  shadows.renderOrder = 1;
  root.add(floor, shadows);
  return {
    root,
    /** The flat color the ground fades into, also used for the sky. */
    horizon: horizon.value,
    update(settings: GroundSettings, light: number, warmth = 0) {
      reveal.value = light;
      // The floor ramp, the sky it fades into and the grid all share the
      // theme, so they warm together as the phase advances.
      blendThemeColor(base, settings.baseColor, alpha6WarmTheme.base, warmth);
      horizon.value.set("#0a0b0f").lerp(base, light);
      blendThemeColor(
        skyNear.value,
        settings.color1,
        alpha6WarmTheme.skyNear,
        warmth,
      );
      blendThemeColor(
        skyFar.value,
        settings.color2,
        alpha6WarmTheme.skyFar,
        warmth,
      );
      gridAlpha.value = settings.grid
        ? settings.gridOpacity * (0.45 + 0.55 * light)
        : 0;
      cellSize.value = settings.gridSize;
      blendThemeColor(
        gridColor.value,
        settings.gridColor,
        alpha6WarmTheme.grid,
        warmth,
      );
      shadowStrength.value = Math.min(
        1,
        settings.shadowOpacity * (0.35 + 0.65 * light) * 4,
      );
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      shadowMaterial.dispose();
    },
  };
}

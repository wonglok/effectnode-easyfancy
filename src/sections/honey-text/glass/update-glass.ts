import type { createGlass } from "./create-glass";
import { alpha6WarmTheme, blendThemeColor } from "../theme";
import type { GlassSettings } from "../controls";

/** Pushes the live panel values into the shared glass material. */
export function updateGlass(
  glass: ReturnType<typeof createGlass>,
  settings: GlassSettings,
  time: number,
  warmth = 0,
) {
  glass.params.ior.value = settings.ior;
  glass.params.thickness.value = settings.thickness;
  glass.material.envMapIntensity = settings.reflections;
  blendThemeColor(
    glass.material.color,
    settings.glassTint,
    alpha6WarmTheme.glass,
    warmth,
  );
  glass.material.roughness = settings.roughness;
  glass.material.dispersion = settings.dispersion;
  glass.params.distortion.value = settings.distortion;
  glass.params.time.value = time;
  glass.config.backside = settings.backside;
  glass.config.backsideThickness = settings.thickness;
  glass.params.backsideThickness.value = settings.thickness;
}

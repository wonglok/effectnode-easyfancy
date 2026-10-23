import { Color, SRGBColorSpace } from "three/webgpu";

/**
 * The warm end of the floor theme. The cool end is the chapter's authored
 * settings (sky blue), so the scene can slide from one palette to the other
 * as its animate phase scrolls.
 */
export const alpha6WarmTheme = {
  base: "#f5a543",
  skyNear: "#ffe0a3",
  skyFar: "#c9701e",
  grid: "#9a5313",
  glass: "#ffd9a0",
} as const;

const cool = new Color();
const warm = new Color();
const coolRgb = { r: 0, g: 0, b: 0 };
const warmRgb = { r: 0, g: 0, b: 0 };

/**
 * Writes the blend of `cool` and `warm` into `target`. The mix happens in
 * sRGB so the complementary ends settle through a warm neutral rather than a
 * muddy dark grey.
 */
export function blendThemeColor(
  target: Color,
  coolHex: string,
  warmHex: string,
  t: number,
) {
  cool.set(coolHex).getRGB(coolRgb, SRGBColorSpace);
  warm.set(warmHex).getRGB(warmRgb, SRGBColorSpace);
  target.setRGB(
    coolRgb.r + (warmRgb.r - coolRgb.r) * t,
    coolRgb.g + (warmRgb.g - coolRgb.g) * t,
    coolRgb.b + (warmRgb.b - coolRgb.b) * t,
    SRGBColorSpace,
  );
  return target;
}

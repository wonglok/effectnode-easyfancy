// Glyph typography for the r3f-alpha-6 scene. The original imported the font
// GLBs through Vite's `?url`; here they are served from /public/alpha6 so both
// Next's server render and the browser can resolve them.
import { glyph, slug } from "@pmndrs/glyph";
import { ThreeConfig } from "@pmndrs/glyph/three";
import { traceStartup } from "./startup";

export type DisplayFont = "Manrope" | "Space Grotesk";
export type DetailFont = "IBM Plex Mono";

const display: Record<DisplayFont, string> = {
  Manrope: "/alpha6/Manrope-SemiBold.font.glb",
  "Space Grotesk": "/alpha6/SpaceGrotesk-SemiBold.font.glb",
};

// Initialised lazily so importing this module never touches browser-only
// glyph state during a server render.
const startEngine = () =>
  glyph.init().then(() => {
    traceStartup("Typography engine ready");
    return glyph.handle("alpha-six", ThreeConfig);
  });
let enginePromise: ReturnType<typeof startEngine> | null = null;
function engine() {
  enginePromise ??= startEngine();
  return enginePromise;
}

const loads = new Map<string, Promise<unknown>>();
/** Starts a load once per key. Later calls share it. */
const once = <T,>(key: string, load: () => Promise<T>) => {
  if (!loads.has(key)) loads.set(key, load());
  return loads.get(key) as Promise<T>;
};
const face = (url: string) =>
  once(url, () =>
    engine().then(() => glyph.fontFace(url, { format: slug }).load()),
  );

/**
 * The text handle with the chosen display font. Loaded once and shared.
 */
export function loadTypography(displayFont: DisplayFont) {
  return once(displayFont, async () => {
    const [handle, displayFace] = await Promise.all([
      engine(),
      face(display[displayFont]),
    ]);
    traceStartup("Fonts ready", 0.22);
    return { handle, display: displayFace };
  });
}

export type Typography = Awaited<ReturnType<typeof loadTypography>>;

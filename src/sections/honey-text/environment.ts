// Prefiltered reflections for the glass, from the chapter's black-and-white sky
// HDR or a procedural room.
import {
  PMREMGenerator,
  type DataTexture,
  type WebGPURenderer,
} from "three/webgpu";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { traceStartup } from "./startup";
import type { GlassSettings } from "./controls";

const STUDIO_URL = "/hdr/sky-bw.hdr";

let studioPromise: Promise<DataTexture> | null = null;

/** The chapter's sky HDR, loaded once on first use. */
export function loadStudio() {
  studioPromise ??= new HDRLoader().loadAsync(STUDIO_URL).then((texture) => {
    traceStartup("Environment ready");
    return texture;
  });
  return studioPromise;
}

export function createEnvironmentMap(
  renderer: WebGPURenderer,
  studio: DataTexture,
  choice: GlassSettings["environment"],
) {
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const target =
    choice === "Studio HDR"
      ? pmrem.fromEquirectangular(studio)
      : pmrem.fromScene(room, 0.04);
  return {
    texture: target.texture,
    dispose() {
      target.dispose();
      room.dispose();
      pmrem.dispose();
    },
  };
}

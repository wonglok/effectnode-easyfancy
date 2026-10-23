// The title in glass, standing on the floor. The original built
// `<Canvas renderer />`, fractured it around the strike and settled its shards;
// this chapter shows settled lines of type only, so no fracture, shards or
// explosion are created.
import {
  Box3,
  BufferGeometry,
  Color,
  Group,
  MeshBasicNodeMaterial,
  Mesh,
  type Material,
} from "three/webgpu";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { Font, type FontData } from "three/addons/loaders/FontLoader.js";
import { Helvetica } from "../../shared/helvetica";
import { withShadow } from "./shadow-light";
import { causticCast } from "./caustics";
import type { GroundSettings } from "../settings";

export const TITLE_TEXT = "Thank you for\nvisiting us.";

const font = new Font(Helvetica as unknown as FontData);
/** Baseline distance between lines, in font-size units. */
const LINE_STEP = 1.34;

/**
 * Lays the settled word flat on the ground at y = 0 in em units, scales it to
 * `fit(width, depth)` and gives it a shadow-only twin for the caustic floor.
 * Each line is its own TextGeometry, centered on the block's axis.
 */
export function createGlassTitle(
  material: Material,
  settings: GroundSettings,
  fit: (width: number, depth: number) => number,
) {
  const root = new Group();
  const geometries: BufferGeometry[] = [];
  const bounds = new Box3();

  TITLE_TEXT.split("\n").forEach((line, index) => {
    const geometry = new TextGeometry(line, {
      font,
      size: 1,
      depth: settings.depth,
      curveSegments: 24,
      bevelEnabled: settings.bevel > 0,
      bevelThickness: settings.bevel,
      bevelSize: settings.bevel,
      bevelSegments: 5,
    });
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    // Center the line on the block's axis; TextGeometry already puts the
    // baseline at y = 0, so stacking by index keeps even line spacing.
    geometry.translate(
      -(box.min.x + box.max.x) / 2,
      -index * LINE_STEP,
      0,
    );
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox!);
    geometries.push(geometry);
  });

  // After rotateX(-90°) the extrusion thickness becomes y, and text height
  // becomes -z. Translate the shared frame so the block is centered in xz and
  // its underside rests on y = 0.
  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const centerZ = (bounds.min.y + bounds.max.y) / 2;
  const bottom = bounds.min.z;
  for (const geometry of geometries) {
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(-centerX, -bottom, centerZ);
  }

  const width = bounds.max.x - bounds.min.x;
  const depth = bounds.max.y - bounds.min.y;
  root.scale.setScalar(fit(width, depth));

  const shadowMaterial = new MeshBasicNodeMaterial();
  shadowMaterial.castShadowNode = causticCast(
    (material as unknown as { color: Color }).color,
  );
  for (const geometry of geometries) {
    root.add(withShadow(new Mesh(geometry, material), shadowMaterial));
  }

  let baseY: number | undefined;
  return {
    root,
    /** Floats the word a little above the floor so its shadow and refraction read. */
    update(settings: GroundSettings) {
      baseY ??= root.position.y;
      root.position.y = baseY + settings.lift * root.scale.x;
    },
    dispose() {
      geometries.forEach((geometry) => geometry.dispose());
      shadowMaterial.dispose();
    },
  };
}

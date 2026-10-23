// TSL replacement for the demo's drei `MeshReflectorMaterial` floor and
// `Grid`. The demo overlays two infinite grids — fine 1-unit section lines in
// warm grey under brighter 3-unit cell lines — and fades them by distance
// from the camera's projection on the floor, so the far grid dissolves.
import * as THREE from "three/webgpu";
import {
  abs,
  cameraPosition,
  clamp,
  color,
  float,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  positionWorld,
  pow,
  smoothstep,
  vec2,
  vec4,
} from "three/tsl";

const GRID_SIZE = 300;
const FLOOR_SIZE = 200;
const FADE_DISTANCE = 67;
const FADE_STRENGTH = 3.2;

export function createGridFloor() {
  // Reflective floor: env-map reflections at low intensity, like the demo's
  // metalness 0.5 / roughness 0.5 dark plane. Its radial alpha map is
  // approximated by the grid's own fade.
  const floorGeometry = new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE);
  const floorMaterial = new THREE.MeshStandardNodeMaterial({
    color: "#161412",
    roughness: 0.5,
    metalness: 0.5,
  });
  floorMaterial.envMapIntensity = 0.3;
  // The demo's reflective floor carries a radial alpha map (full to 0.16 of
  // the plane, gone by 0.66), so the corners dissolve into the dark stage
  // instead of turning into a bright env-lit sheet.
  floorMaterial.transparent = true;
  floorMaterial.opacityNode = float(1).sub(
    smoothstep(16, 66, length(positionWorld.xz)),
  );
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.1;
  floor.receiveShadow = true;

  // Grid: derive line width in screen space with fwidth, exactly like drei.
  const world = positionWorld.xz;
  const cameraFlat = cameraPosition.xz;
  const distanceToCamera = length(world.sub(cameraFlat));
  const fade = pow(
    clamp(float(1).sub(distanceToCamera.div(FADE_DISTANCE)), 0, 1),
    FADE_STRENGTH,
  );

  const getGrid = (size: number, thickness: number) => {
    const r = world.div(size);
    const grid = abs(fract(r.sub(0.5)).sub(0.5)).div(
      max(fwidth(r), vec2(0.0001)),
    );
    const line = min(grid.x, grid.y).add(1).sub(thickness);
    return float(1).sub(min(line, 1));
  };

  const cellLines = getGrid(3, 1.4);
  const sectionLines = getGrid(1, 0.5);
  const lines = cellLines.add(sectionLines).mul(fade);
  // Section lines pick up the darker warm grey; cells stay light grey.
  const lineColor = mix(
    color("#9a9a9a"),
    color("#514f4b"),
    min(float(1), float(0.5).mul(sectionLines)),
  );
  const alpha = mix(lines.mul(0.65), lines.mul(0.85), sectionLines);

  const gridGeometry = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE);
  const gridMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  gridMaterial.colorNode = vec4(lineColor, 1);
  gridMaterial.opacityNode = alpha;

  const grid = new THREE.Mesh(gridGeometry, gridMaterial);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = 0.001;

  const group = new THREE.Group();
  group.add(floor, grid);

  return {
    group,
    dispose() {
      group.remove(floor, grid);
      floorGeometry.dispose();
      floorMaterial.dispose();
      gridGeometry.dispose();
      gridMaterial.dispose();
    },
  };
}

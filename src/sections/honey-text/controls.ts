// Shared setting types from the r3f-alpha-6 scene. The original drove these
// with leva; this port ships one authored configuration (see settings.ts).
import type { DisplayFont, DetailFont } from "./typography";

export type CameraSettings = {
  cameraMode: "Pointer" | "Orbit" | "Fixed";
  cameraYaw: number;
  cameraPitch: number;
  cameraZoom: number;
  parallax: number;
  pointerX: number;
  pointerY: number;
  cameraSmoothing: number;
  orbitSpeed: number;
};

export type TypographySettings = {
  displayFont: DisplayFont;
  detailFont: DetailFont;
};

export type BackgroundSettings = {
  animate: boolean;
  speed: number;
  shape: number;
  scale: number;
  baseColor: string;
  color1: string;
  color2: string;
  color3: string;
  softness: number;
  intensity: number;
  grain: number;
};

export type GridSettings = {
  grid: boolean;
  gridColor: string;
  gridOpacity: number;
  gridSize: number;
  crosshairs: boolean;
  crosshairSpacing: number;
};

export type GlassSettings = {
  environment: "Studio HDR" | "Soft room";
  environmentRotation: number;
  ior: number;
  thickness: number;
  reflections: number;
  roughness: number;
  dispersion: number;
  glassTint: string;
  distortion: number;
  backside: boolean;
  depth: number;
  bevel: number;
};

export type FractureSettings = {
  breakDelay: number;
  fragmentCount: number;
  fractureSeed: number;
  explosion: number;
};

// The authored configuration for the r3f-alpha-6 scene: the original leva
// panel's defaults, frozen so the section plays the same shot every visit.
import type {
  BackgroundSettings,
  CameraSettings,
  FractureSettings,
  GlassSettings,
  GridSettings,
  TypographySettings,
} from "./controls";

export type GroundSettings = CameraSettings &
  TypographySettings &
  BackgroundSettings &
  GridSettings &
  GlassSettings &
  FractureSettings & {
    shadowOpacity: number;
    shaderGround: boolean;
    lightFollow: number;
    hdrFollow: number;
    lightIntensity: number;
    environmentIntensity: number;
    lift: number;
    copyStretch: number;
    footerOnGround: boolean;
    windup: number;
    gravity: number;
    bounce: number;
    friction: number;
    shardCollisions: boolean;
    cursorCollider: boolean;
    cursorSize: number;
    flyIn: boolean;
    flyDuration: number;
    flySettleDuration: number;
    flyOvershoot: number;
    flyImpact: number;
    flyYaw: number;
    flyStartPitch: number;
    flyPitch: number;
    flyRoll: number;
    flyDistance: number;
    flyPassDistance: number;
    flyRush: number;
    flyWiden: number;
    flyShake: number;
  };

export const groundSettings: GroundSettings = {
  // Camera: fixed pose, with no pointer/drag influence
  cameraMode: "Fixed",
  cameraYaw: 0.1,
  cameraPitch: 65.2,
  cameraZoom: 0.91,
  parallax: 0,
  pointerX: 0,
  pointerY: 0,
  cameraSmoothing: 2,
  orbitSpeed: 0.5,

  // Typography
  displayFont: "Manrope",
  detailFont: "IBM Plex Mono",

  // Floor palette — blue and sky blue (the shader uses its own static blue ramp)
  animate: true,
  speed: 0.55,
  shape: 1,
  scale: 1.8,
  // The Ground folder's background color wins over the grain default.
  baseColor: "#9fd6ff",
  color1: "#bfe8ff",
  color2: "#2f74d8",
  color3: "#eaf7ff",
  softness: 0.65,
  intensity: 0.22,
  grain: 0.13,

  // Animated hexagon grid
  grid: true,
  gridColor: "#1d4f9e",
  gridOpacity: 0.4,
  gridSize: 48,
  crosshairs: true,
  crosshairSpacing: 4,

  // Glass
  environment: "Studio HDR",
  environmentRotation: 360,
  reflections: 3.65,
  ior: 1.25,
  thickness: 0.2,
  roughness: 0,
  dispersion: 16,
  glassTint: "#cbd2de",
  distortion: 0.29,
  backside: true,
  depth: 0.19,
  bevel: 0.02,

  // Fracture
  // windupAt(0.75) with the demo's fly-in: the strike lands as the rush brakes.
  breakDelay: 0.08,
  fragmentCount: 48,
  fractureSeed: 177,
  explosion: 1,

  // Ground dressing
  shadowOpacity: 0.1,
  shaderGround: true,
  // No cursor-driven light or environment drift.
  lightFollow: 0,
  hdrFollow: 0,
  lightIntensity: 6,
  environmentIntensity: 1.75,
  lift: 0.09,
  copyStretch: 0.36,
  footerOnGround: false,

  // Strike and shards
  windup: 1.1,
  gravity: 9,
  bounce: 0.25,
  friction: 0.6,
  shardCollisions: true,
  cursorCollider: true,
  cursorSize: 0.3,

  // Fly-in
  flyIn: true,
  flyDuration: 2.05,
  flySettleDuration: 3.5,
  flyOvershoot: 1,
  flyImpact: 1,
  flyYaw: -30,
  flyStartPitch: 72,
  flyPitch: 15,
  flyRoll: -4,
  flyDistance: 4.5,
  flyPassDistance: 0.9,
  flyRush: 0.75,
  flyWiden: 0.25,
  flyShake: 0.2,
};

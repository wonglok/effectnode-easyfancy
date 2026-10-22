import * as THREE from "three/webgpu";
import {
  abs,
  cameraPosition,
  color,
  dot,
  mix,
  normalWorld,
  oneMinus,
  positionLocal,
  positionWorld,
  pow,
  smoothstep,
} from "three/tsl";
import type { PointerState } from "./section-activity";

export const TAU = Math.PI * 2;
const lookTarget = new THREE.Vector3();
const tempColor = new THREE.Color();
const tempMatrix = new THREE.Object3D();

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export { tempColor, tempMatrix };

export function fresnelAmount(power = 2.2) {
  const viewDirection = cameraPosition.sub(positionWorld).normalize();
  return pow(oneMinus(abs(dot(normalWorld, viewDirection))), power);
}

export function makeSky(
  scene: THREE.Scene,
  top: string,
  bottom: string,
  accent: string,
  glowY = 0.08,
): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(42, 32, 18);
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  const vertical = smoothstep(-0.7, 0.8, positionLocal.y.div(42));
  const horizon = pow(oneMinus(abs(positionLocal.y.div(42).sub(glowY))), 8);
  const halo = smoothstep(0.2, -0.25, positionLocal.y.div(42));

  material.colorNode = mix(color(bottom), color(top), vertical).add(
    color(accent).mul(horizon.mul(halo).mul(0.22)),
  );

  const sky = new THREE.Mesh(geometry, material);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  return sky;
}

export function makeParticles(
  accentA: string,
  accentB: string,
  count: number,
  innerRadius: number,
  outerRadius: number,
  size: number,
  seed: number,
) {
  const random = mulberry32(seed);
  const geometry = new THREE.OctahedronGeometry(size, 0);
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  const colorA = new THREE.Color(accentA);
  const colorB = new THREE.Color(accentB);

  for (let i = 0; i < count; i += 1) {
    const radius = innerRadius + random() * (outerRadius - innerRadius);
    const theta = random() * TAU;
    const phi = Math.acos(2 * random() - 1);
    dummy.position.set(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi) * 0.72,
      radius * Math.sin(phi) * Math.sin(theta),
    );
    dummy.scale.setScalar(0.4 + random() * 1.8);
    dummy.rotation.set(random() * TAU, random() * TAU, random() * TAU);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    tempColor
      .copy(colorA)
      .lerp(colorB, random())
      .multiplyScalar(0.5 + random() * 0.8);
    mesh.setColorAt(i, tempColor);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

export function makeRibbonMaterial(
  deep: string,
  accent: string,
  emissive = 1.1,
) {
  const material = new THREE.MeshStandardNodeMaterial({
    metalness: 0.88,
    roughness: 0.16,
    emissiveIntensity: 1,
  });
  const fresnel = fresnelAmount(2.4);
  material.colorNode = mix(
    color(deep),
    color(accent),
    fresnel.mul(0.9).add(0.04),
  );
  material.emissiveNode = color(accent).mul(fresnel.mul(emissive));
  return material;
}

export function addLights(
  scene: THREE.Scene,
  accent: string,
  keyIntensity = 28,
  rimIntensity = 16,
) {
  const ambient = new THREE.AmbientLight(0xffffff, 0.38);
  const key = new THREE.PointLight(accent, keyIntensity, 30, 1.5);
  key.position.set(4.5, 4.2, 5);
  const rim = new THREE.PointLight(0x9ec4ff, rimIntensity, 26, 1.5);
  rim.position.set(-5, -1.4, 3.5);
  const top = new THREE.DirectionalLight(0xffffff, 1.1);
  top.position.set(0, 8, 2);
  scene.add(ambient, key, rim, top);
}

/** Smooth 0..1 easing shared by the camera phase paths. */
export function easeInOut(value: number) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/** Small pointer/tilt drift layered on top of every camera phase. */
export function pointerDrift(
  pointer: PointerState,
  elapsed: number,
  drift: number,
  orbit: number,
) {
  return {
    x: pointer.x * drift + Math.sin(elapsed * 0.16) * orbit * 0.35,
    y: pointer.y * drift * 0.6 + Math.cos(elapsed * 0.14) * orbit * 0.18,
  };
}

/**
 * Places the camera for one phase of its choreography. Each camera supplies
 * its own poses; this only eases between them.
 */
export function setCameraPose(
  camera: THREE.PerspectiveCamera,
  position: [number, number, number],
  lookAt: [number, number, number],
) {
  camera.position.set(position[0], position[1], position[2]);
  lookTarget.set(lookAt[0], lookAt[1], lookAt[2]);
  camera.lookAt(lookTarget);
}

export function makeCamera(
  base: [number, number, number],
  fov = 42,
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(fov, 1, 1, 1000);
  camera.position.set(...base);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  return camera;
}

export function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else if (material) {
      material.dispose();
    }
  });
}

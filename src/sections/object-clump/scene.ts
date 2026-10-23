// Chapter 02: a clump of mirror baubles, ported from pmndrs/examples
// `object-clump`. The reference drove 40 cannon rigid bodies and rendered
// them with drei's Environment; here a small sphere solver reproduces the
// same pull-toward-centre, upward-gravity clump, and the live rainbow cube
// map lights the balls instead of an HDR.
import * as THREE from "three/webgpu";
import type { PerspectiveCamera, WebGPURenderer } from "three/webgpu";
import { pass } from "three/tsl";
import type { SectionWorld } from "../types";
import { createLiveRainbowEnvMap } from "../shared/live-rainbow-env-map";
import { samplePointer } from "../shared/section-activity";
import { objectClumpMeta } from "./meta";

const COUNT = 40;
/** Baubles come in a spread of sizes instead of one repeated radius. */
const MIN_RADIUS = 0.55;
const MAX_RADIUS = 1.5;
/** Acceleration toward the origin, as the reference's constant -40 force. */
const ATTRACTION = 40;
/** The reference's gravity points up, easing the clump off-centre. */
const GRAVITY_Y = 2;
/** Fraction of velocity kept per second while the clump settles. */
const LINEAR_DAMPING = 0.65;
const RESTITUTION = 0.2;
/** The pointer is a kinematic sphere, radius 3 in the reference. */
const POINTER_RADIUS = 3;
const POINTER_FOLLOW = 8;
const FIXED_STEP = 1 / 120;
const MAX_STEPS = 4;
const CAMERA_Z = 20;
/** The camera eases in to this distance across the chapter. */
const ZOOM_END = 16;
const FOV = 35;

type Body = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  radius: number;
  /** Uniform density, so the bigger baubles carry more inertia. */
  mass: number;
};

const delta = new THREE.Vector3();
const normal = new THREE.Vector3();
const pull = new THREE.Vector3();
const pointerWorld = new THREE.Vector3();
const pointerTarget = new THREE.Vector3();
const dummy = new THREE.Object3D();
const randomSpread = (size: number) => (Math.random() - 0.5) * size;

export function createObjectClumpWorld(
  camera: PerspectiveCamera,
  renderer: WebGPURenderer,
): SectionWorld {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#dfdfdf");

  // The only light source for the mirror material: the live rainbow env.
  const environment = createLiveRainbowEnvMap(renderer, { resolution: 32 });
  scene.environment = environment.envMap;
  scene.environmentIntensity = 1;

  const ambient = new THREE.AmbientLight(0xffffff, 0.5 * Math.PI);
  const spot = new THREE.SpotLight(0xffffff, Math.PI, 0, 0.2, 1, 0);
  spot.position.set(30, 30, 30);
  spot.castShadow = true;
  spot.shadow.mapSize.set(512, 512);
  spot.shadow.bias = -0.0002;
  scene.add(ambient, spot);
  renderer.shadowMap.enabled = true;

  // One unit sphere; each instance scales it to its own radius.
  const geometry = new THREE.SphereGeometry(1, 32, 32);
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: 0xffffff,
    metalness: 1.0,
    roughness: 0.3,
    transparent: true,
    iridescence: 1,
    opacity: 0.8,
    clearcoat: 1,
  });
  const clump = new THREE.InstancedMesh(geometry, material, COUNT);
  clump.castShadow = true;
  clump.receiveShadow = true;
  clump.frustumCulled = false;
  scene.add(clump);

  // Scatter the balls like the reference's `randFloatSpread(20)` and give each
  // one its own radius, so the clump reads as mixed-size baubles.
  const bodies: Body[] = Array.from({ length: COUNT }, () => {
    const radius = THREE.MathUtils.lerp(MIN_RADIUS, MAX_RADIUS, Math.random());
    return {
      position: new THREE.Vector3(
        randomSpread(20),
        randomSpread(20),
        randomSpread(20),
      ),
      velocity: new THREE.Vector3(),
      radius,
      mass: radius * radius * radius,
    };
  });

  const writeInstances = () => {
    bodies.forEach((body, index) => {
      dummy.position.copy(body.position);
      dummy.scale.setScalar(body.radius);
      dummy.updateMatrix();
      clump.setMatrixAt(index, dummy.matrix);
    });
    clump.instanceMatrix.needsUpdate = true;
  };
  writeInstances();

  camera.near = 1;
  camera.far = 40;
  camera.fov = FOV;
  camera.position.set(0, 0, CAMERA_Z);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  /**
   * One fixed solver step: centre pull + upward gravity, damping, then a few
   * overlap resolutions against the other balls and the pointer sphere.
   */
  const step = (dt: number) => {
    const damping = Math.pow(1 - LINEAR_DAMPING, dt);

    for (const body of bodies) {
      const distance = body.position.length();
      if (distance > 1e-4) {
        pull.copy(body.position).multiplyScalar(-ATTRACTION / distance);
        body.velocity.addScaledVector(pull, dt);
      }
      body.velocity.y += GRAVITY_Y * dt;
      body.velocity.multiplyScalar(damping);
      body.position.addScaledVector(body.velocity, dt);
    }

    for (let iteration = 0; iteration < 2; iteration += 1) {
      for (let i = 0; i < COUNT; i += 1) {
        const a = bodies[i];
        for (let j = i + 1; j < COUNT; j += 1) {
          const b = bodies[j];
          delta.copy(b.position).sub(a.position);
          const distance = delta.length();
          const minDistance = a.radius + b.radius;
          if (distance >= minDistance || distance < 1e-5) continue;

          normal.copy(delta).divideScalar(distance);

          // Separate them in proportion to mass, so the heavier bauble barely
          // moves and the lighter one yields.
          const totalMass = a.mass + b.mass;
          const overlap = minDistance - distance;
          a.position.addScaledVector(normal, -(overlap * b.mass) / totalMass);
          b.position.addScaledVector(normal, (overlap * a.mass) / totalMass);

          const relative = delta.copy(b.velocity).sub(a.velocity).dot(normal);
          if (relative < 0) {
            const inverseA = 1 / a.mass;
            const inverseB = 1 / b.mass;
            const impulse =
              (-(1 + RESTITUTION) * relative) / (inverseA + inverseB);
            a.velocity.addScaledVector(normal, -impulse * inverseA);
            b.velocity.addScaledVector(normal, impulse * inverseB);
          }
        }
      }

      // The pointer is a kinematic, immovable sphere.
      for (const body of bodies) {
        delta.copy(body.position).sub(pointerWorld);
        const distance = delta.length();
        const minDistance = POINTER_RADIUS + body.radius;
        if (distance >= minDistance || distance < 1e-5) continue;
        normal.copy(delta).divideScalar(distance);
        body.position.copy(pointerWorld).addScaledVector(normal, minDistance);
        const along = body.velocity.dot(normal);
        if (along < 0) body.velocity.addScaledVector(normal, -along * 1.4);
      }
    }
  };

  let accumulator = 0;

  return {
    id: objectClumpMeta.id,
    index: objectClumpMeta.index,
    scene,
    camera,
    pass: pass(scene, camera),
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    animate({ elapsed, delta: frameDelta, phase }) {
      // A slow scroll-linked push-in, then map the shared pointer signal into
      // the world plane the reference used for its kinematic sphere.
      camera.position.set(
        0,
        0,
        THREE.MathUtils.lerp(CAMERA_Z, ZOOM_END, phase.sceneProgress),
      );
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      const pointer = samplePointer(elapsed, frameDelta);
      const halfHeight =
        Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * camera.position.z;
      pointerTarget.set(
        pointer.x * halfHeight * camera.aspect,
        pointer.y * halfHeight,
        0,
      );
      pointerWorld.lerp(
        pointerTarget,
        1 - Math.exp(-POINTER_FOLLOW * frameDelta),
      );

      accumulator = Math.min(accumulator + frameDelta, FIXED_STEP * MAX_STEPS);
      while (accumulator >= FIXED_STEP) {
        step(FIXED_STEP);
        accumulator -= FIXED_STEP;
      }

      writeInstances();
      environment.compute(elapsed);
    },
    dispose() {
      scene.remove(clump);
      scene.remove(spot, ambient);
      spot.dispose();
      geometry.dispose();
      material.dispose();
      environment.dispose();
      scene.clear();
    },
  };
}

/** A calm stand-in so the chapter never goes black if WebGPU is unavailable. */
export function createObjectClumpFallbackWorld(
  camera: PerspectiveCamera,
): SectionWorld {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#dfdfdf");

  const geometry = new THREE.SphereGeometry(0.55, 20, 14);
  const material = new THREE.MeshStandardNodeMaterial({
    color: "#8a6b93",
    roughness: 0.35,
  });
  const group = new THREE.Group();
  for (let i = 0; i < 14; i += 1) {
    const sphere = new THREE.Mesh(geometry, material);
    const angle = (i / 14) * Math.PI * 2;
    const radius = 1.4 + (i % 3) * 0.4;
    sphere.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle * 1.7) * 0.9,
      Math.sin(angle) * radius,
    );
    group.add(sphere);
  }
  scene.add(group);

  return {
    id: objectClumpMeta.id,
    index: objectClumpMeta.index,
    scene,
    camera,
    pass: pass(scene, camera),
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    animate({ elapsed }) {
      group.rotation.y = elapsed * 0.2;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      scene.clear();
    },
  };
}

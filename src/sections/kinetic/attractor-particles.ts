// GPU attractor particle field for chapter 02, ported from the R3F example
// `tsl-compute-attractors-particles` (three.js
// webgpu_tsl_compute_attractors_particles). The CPU never touches a particle:
// positions and velocities live in `instancedArray` storage buffers, and two
// compute kernels do all the work. The init kernel runs once on creation; the
// physics kernel runs every frame from the world's `animate` via
// `renderer.compute()`. The sprite draws the storage buffer straight through
// `SpriteNodeMaterial`.
import * as THREE from "three/webgpu";
import type { WebGPURenderer } from "three/webgpu";
import {
  color,
  cos,
  float,
  Fn,
  hash,
  If,
  instancedArray,
  instanceIndex,
  Loop,
  mix,
  mod,
  PI,
  sin,
  uint,
  uniform,
  uniformArray,
  vec3,
  vec4,
} from "three/tsl";

/** Same particle budget as the original demonstration. */
export const PARTICLE_COUNT = 2 ** 18; // 262,144

const GRAVITY_CONSTANT = 6.67e-11;

/** Attractor positions from the original example. */
const ATTRACTOR_POSITIONS = [
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(1, 0, -0.5),
  new THREE.Vector3(0, 0.5, 1),
];

/** Fixed spin axes from the original example. */
const ATTRACTOR_ROTATION_AXES = [
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(1, 0, -0.5).normalize(),
];

const ATTRACTOR_COUNT = ATTRACTOR_POSITIONS.length;

/**
 * The original frames the field from ~10 units back at a 25° lens; chapter 02
 * sits at z = 20…10 with a 75° lens, so the field (and its sprite points) is
 * scaled up to keep the same apparent size.
 */
const GROUP_SCALE = 3;

/** Build-time random seed for the hash-based per-particle randoms. */
const seed = () => uint(Math.floor(Math.random() * 0xffffff));

export type AttractorParticles = {
  /** Add to the chapter's scene. */
  object: THREE.Group;
  /** Dispatch the physics step; call once per frame before rendering. */
  update: () => void;
  dispose: () => void;
};

export function createAttractorParticles(
  renderer: WebGPURenderer,
): AttractorParticles {
  //* Uniforms =====================================================
  const uAttractorMass = uniform(10 ** 7);
  const uParticleGlobalMass = uniform(10 ** 4);
  const uTimeScale = uniform(1);
  const uSpinningStrength = uniform(2.75);
  const uMaxSpeed = uniform(8);
  const uVelocityDamping = uniform(0.1);
  // Sprite size in world units at the field's unscaled size.
  const uScale = uniform(0.03);
  const uBoundHalfExtent = uniform(8);
  const colorA = color("#5900ff");
  const colorB = color("#ffa575");

  //* GPU state ====================================================
  const positions = instancedArray(PARTICLE_COUNT, "vec3");
  const velocities = instancedArray(PARTICLE_COUNT, "vec3");

  // Attractor state as uniformArrays, indexable from the GPU loop. The
  // Vector3s are live: mutating them moves the attractors with no rebuild.
  const uAttractorPositions = uniformArray<"vec3">(
    ATTRACTOR_POSITIONS.map((v) => v.clone()),
    "vec3",
  );
  const uAttractorRotationAxes = uniformArray<"vec3">(
    ATTRACTOR_ROTATION_AXES.map((v) => v.clone()),
    "vec3",
  );

  //* Init kernel ==================================================
  // A flat disc of particles (wide in x/z, thin in y), each with a small
  // random spherical velocity. Dispatched once on creation.
  const computeInit = Fn(() => {
    const position = positions.element(instanceIndex);
    const velocity = velocities.element(instanceIndex);

    const basePosition = vec3(
      hash(instanceIndex.add(seed())),
      hash(instanceIndex.add(seed())),
      hash(instanceIndex.add(seed())),
    )
      .sub(0.5)
      .mul(vec3(5, 0.2, 5));
    position.assign(basePosition);

    const phi = hash(instanceIndex.add(seed())).mul(PI).mul(2);
    const theta = hash(instanceIndex.add(seed())).mul(PI);
    const sinPhiRadius = sin(phi);
    const baseVelocity = vec3(
      sinPhiRadius.mul(sin(theta)),
      cos(phi),
      sinPhiRadius.mul(cos(theta)),
    ).mul(0.05);
    velocity.assign(baseVelocity);
  })().compute(PARTICLE_COUNT);

  // Per-particle mass multiplier, shared by the physics kernel and the sprite
  // scale node (a heavier particle draws a bigger sprite).
  const particleMassMultiplier = hash(instanceIndex.add(seed()))
    .remap(0.25, 1)
    .toVar();
  const particleMass = particleMassMultiplier.mul(uParticleGlobalMass).toVar();

  //* Physics kernel ===============================================
  // Newtonian gravity toward each attractor plus a rotational force around its
  // axis, a speed clamp (GPU `If()`, not a JS branch), damping, integration,
  // and a wrap-around bounding box.
  const computeUpdate = Fn(() => {
    // Fixed timestep, like the original, for a consistent simulation.
    const delta = float(1 / 60)
      .mul(uTimeScale)
      .toVar();
    const position = positions.element(instanceIndex);
    const velocity = velocities.element(instanceIndex);

    const force = vec3(0).toVar();

    Loop(ATTRACTOR_COUNT, ({ i }) => {
      const attractorPosition = uAttractorPositions.element(i);
      const attractorRotationAxis = uAttractorRotationAxes.element(i);
      const toAttractor = attractorPosition.sub(position);
      const distance = toAttractor.length();
      const direction = toAttractor.normalize();

      // gravity
      const gravityStrength = particleMass
        .mul(uAttractorMass)
        .mul(GRAVITY_CONSTANT)
        .div(distance.pow(2))
        .toVar();
      force.addAssign(direction.mul(gravityStrength));

      // spinning
      const spinningForce = attractorRotationAxis
        .mul(gravityStrength)
        .mul(uSpinningStrength);
      force.addAssign(spinningForce.cross(toAttractor));
    });

    // velocity
    velocity.addAssign(force.mul(delta));
    const speed = velocity.length();
    If(speed.greaterThan(uMaxSpeed), () => {
      velocity.assign(velocity.normalize().mul(uMaxSpeed));
    });
    velocity.mulAssign(float(uVelocityDamping).oneMinus());

    // position
    position.addAssign(velocity.mul(delta));

    // box loop: wrap positions into the [-half, +half] cube
    const halfExtent = float(uBoundHalfExtent).div(2).toVar();
    position.assign(
      mod(position.add(halfExtent), uBoundHalfExtent).sub(halfExtent),
    );
  })().compute(PARTICLE_COUNT);

  //* Sprite =======================================================
  // Position straight from the storage buffer; color ramps from colorA to
  // colorB with speed; scale follows the particle's mass.
  const speed = velocities.toAttribute().length();
  const colorMix = speed.div(uMaxSpeed).smoothstep(0, 0.5);

  const material = new THREE.SpriteNodeMaterial({
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  material.positionNode = positions.toAttribute();
  material.colorNode = vec4(mix(colorA, colorB, colorMix), 1);
  material.scaleNode = particleMassMultiplier.mul(uScale);

  const sprite = new THREE.Sprite(material);
  // WebGPU draws `count` instances of the one sprite; positions live only on
  // the GPU, so three's culling sphere knows nothing — disable culling.
  sprite.count = PARTICLE_COUNT;
  sprite.frustumCulled = false;

  const object = new THREE.Group();
  object.scale.setScalar(GROUP_SCALE);
  object.add(sprite);

  // Seed the buffers, then warm the physics pipeline once so the first visible
  // frame does not hitch on shader compilation.
  renderer.compute(computeInit);
  renderer.compute(computeUpdate);

  return {
    object,
    update: () => renderer.compute(computeUpdate),
    dispose() {
      computeInit.dispose();
      computeUpdate.dispose();
      material.dispose();
      positions.dispose();
      velocities.dispose();
    },
  };
}

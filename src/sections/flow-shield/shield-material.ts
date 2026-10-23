// TSL port of the pmndrs flow-shield `shaderMaterial.ts` GLSL. The original
// ran on WebGLRenderer as a ShaderMaterial; this version builds the same
// graph (hex pattern, flow noise, fresnel, cell flashes) as TSL nodes so it
// runs on the site's WebGPURenderer. The demo's click-triggered hit rings are
// left out on request.
import * as THREE from "three/webgpu";
import {
  abs,
  and,
  cameraPosition,
  clamp,
  dot,
  float,
  fract,
  max,
  mix,
  mod,
  mx_noise_float,
  normalWorld,
  oneMinus,
  positionLocal,
  positionWorld,
  pow,
  select,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

const HEX_LATTICE = 1.7320508;

export type ShieldMaterial = ReturnType<typeof createShieldMaterial>;

export function createShieldMaterial() {
  //* Uniforms (default preset from consts/index.ts) ==============
  const uniforms = {
    uTime: uniform(0),
    uColor: uniform(new THREE.Color("#26aeff")),
    uLife: uniform(1),
    uHexScale: uniform(3),
    uEdgeWidth: uniform(0.06),
    uFresnelPower: uniform(1.8),
    uFresnelStrength: uniform(1.75),
    uOpacity: uniform(0.76),
    uFlashSpeed: uniform(0.6),
    uFlashIntensity: uniform(0.11),
    uHexOpacity: uniform(0.13),
    uShowHex: uniform(1),
    uFlowScale: uniform(2.4),
    uFlowSpeed: uniform(1.13),
    uFlowIntensity: uniform(4),
  };

  //* Vertex varyings =============================================
  const normPos = positionLocal.normalize();
  const worldNormal = normalWorld.normalize();
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const fresnel = pow(
    oneMinus(dot(worldNormal, viewDir)),
    uniforms.uFresnelPower,
  ).mul(uniforms.uFresnelStrength);

  //* Flow noise ==================================================
  const flowT = uniforms.uTime.mul(uniforms.uFlowSpeed);
  const flowA = mx_noise_float(
    positionLocal
      .mul(uniforms.uFlowScale)
      .add(vec3(flowT, flowT.mul(0.6), flowT.mul(0.4))),
  );
  const flowB = mx_noise_float(
    positionLocal
      .mul(uniforms.uFlowScale)
      .mul(2.1)
      .add(vec3(flowT.mul(-0.5), flowT.mul(0.9), flowT.mul(0.3))),
  );
  const flowNoise = flowA.mul(0.6).add(flowB.mul(0.4)).mul(0.5).add(0.5);

  //* Hex pattern on cube-projected coordinates ===================
  // The original picks the dominant cube face per fragment and fades near
  // the seams. `select` keeps the same branchless behaviour in TSL.
  const absN = abs(normPos);
  const dominance = max(absN.x, max(absN.y, absN.z));
  const faceFade = smoothstep(0.65, 0.85, dominance);
  const faceUV = select(
    and(absN.x.greaterThanEqual(absN.y), absN.x.greaterThanEqual(absN.z)),
    positionLocal.yz,
    select(
      absN.y.greaterThanEqual(absN.z),
      positionLocal.xz,
      positionLocal.xy,
    ),
  );

  const hp = faceUV.mul(uniforms.uHexScale);
  const half = vec2(1, HEX_LATTICE).mul(0.5);
  const lattice = vec2(1, HEX_LATTICE);
  const cellA = mod(hp, lattice).sub(half);
  const cellB = mod(hp.sub(half), lattice).sub(half);
  const nearest = select(
    dot(cellA, cellA).lessThan(dot(cellB, cellB)),
    cellA,
    cellB,
  );
  const across = abs(nearest);
  const hexDistance = max(
    across.x,
    across.x.mul(0.5).add(across.y.mul(0.8660254)),
  );
  const hex = smoothstep(
    float(0.5).sub(uniforms.uEdgeWidth),
    float(0.5),
    hexDistance,
  ).mul(faceFade);

  // Per-cell random phase so the flashes drift independently.
  const cellId = hp.sub(nearest);
  const cellRandom = fract(
    sin(dot(cellId, vec2(127.1, 311.7))).mul(43758.5453),
  );
  const cellPhase = cellRandom.mul(6.2831853);
  const cellSpeed = float(0.5).add(cellRandom.mul(1.5));
  const cellFlash = smoothstep(
    0.6,
    1.0,
    sin(uniforms.uTime.mul(uniforms.uFlashSpeed).mul(cellSpeed).add(cellPhase)),
  )
    .mul(uniforms.uFlashIntensity)
    .mul(faceFade);

  //* Composite ===================================================
  const lifeColor = mix(vec3(1, 0.08, 0.04), uniforms.uColor, uniforms.uLife);
  const effectiveHexOpacity = uniforms.uHexOpacity.mul(uniforms.uShowHex);
  const intensity = hex
    .mul(effectiveHexOpacity)
    .mul(fresnel.mul(0.7).add(0.3))
    .add(fresnel.mul(0.4))
    .add(cellFlash.mul(uniforms.uShowHex));

  const shieldColor = lifeColor
    .mul(intensity)
    .mul(2)
    .add(lifeColor.mul(flowNoise.mul(fresnel).mul(uniforms.uFlowIntensity)));

  const alpha = clamp(intensity.mul(uniforms.uOpacity), 0, 1);

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
  });
  material.colorNode = vec4(shieldColor, 1);
  material.opacityNode = alpha;

  return {
    material,
    uniforms,
    dispose() {
      material.dispose();
    },
  };
}

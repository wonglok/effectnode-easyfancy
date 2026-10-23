import * as THREE from "three/webgpu";

/**
 * Animated cube map inherited from the original Kinetic scene: pointer and
 * ambient touches paint fading trails onto a small canvas, and that canvas is
 * used for all six cube faces. The result is a soft nebula that the water,
 * jellyfish and title reflect.
 */

const SIZE = 64;
const MAX_AGE = 350;
const RADIUS = 0.1 * SIZE;
const SPEED = 1.33 / MAX_AGE;
/** Base color of the cube (the original brand primary). */
const BACKGROUND = "#020735";
/** Trail tint: the primary hue brightened until it glows. */
const TRAIL_HUE = 202;
/** Ambient touches added on top of the pointer trail, as in the original. */
const SEED_COUNT = 25;
const SEED_CHANCE = 0.8;

type TouchPoint = {
  x: number;
  y: number;
  age: number;
  force: number;
  vx: number;
  vy: number;
};

const easeOutSine = (t: number) => Math.sin(t * (Math.PI / 2));
const easeOutQuad = (t: number) => -t * (t - 2);

class TouchTexture {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly trail: TouchPoint[] = [];
  private last: { x: number; y: number } | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;

    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    this.ctx = context;

    this.ctx.fillStyle = BACKGROUND;
    this.ctx.fillRect(0, 0, SIZE, SIZE);
  }

  addTouch(point: { x: number; y: number }) {
    let force = 0;
    let vx = 0;
    let vy = 0;

    const last = this.last;
    if (last) {
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      if (dx === 0 && dy === 0) return;
      const distanceSq = dx * dx + dy * dy;
      const distance = Math.sqrt(distanceSq);
      vx = dx / distance;
      vy = dy / distance;
      force = Math.min(distanceSq * 10000, 1);
    }

    this.last = { x: point.x, y: point.y };
    this.trail.push({ x: point.x, y: point.y, age: 0, force, vx, vy });
  }

  update() {
    this.clear();

    this.trail.forEach((point, index) => {
      const force = point.force * SPEED * (1 - point.age / MAX_AGE);
      point.x += point.vx * force;
      point.y += point.vy * force;
      point.age += 1;
      if (point.age > MAX_AGE) this.trail.splice(index, 1);
    });

    this.trail.forEach((point) => this.drawPoint(point));
  }

  private clear() {
    this.ctx.fillStyle = BACKGROUND;
    this.ctx.fillRect(0, 0, SIZE, SIZE);
  }

  private drawPoint(point: TouchPoint) {
    const ctx = this.ctx;
    const pos = {
      x: point.x * SIZE,
      y: (1 - point.y) * SIZE,
    };

    const intensity =
      point.age < MAX_AGE * 0.3
        ? easeOutSine(point.age / (MAX_AGE * 0.3))
        : easeOutQuad(1 - (point.age - MAX_AGE * 0.3) / (MAX_AGE * 0.7));

    // Draw off-canvas with a large shadow offset so only the blurred glow
    // lands inside the texture.
    const offset = SIZE * 5;
    ctx.shadowOffsetX = offset;
    ctx.shadowOffsetY = offset;
    ctx.shadowBlur = RADIUS;
    ctx.shadowColor = `hsla(${TRAIL_HUE}, 100%, 87%, ${(
      0.35 * intensity
    ).toFixed(3)})`;

    ctx.beginPath();
    ctx.fillStyle = "rgba(255,0,0,1)";
    ctx.arc(pos.x - offset, pos.y - offset, RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

export type TouchSky = {
  texture: THREE.CubeTexture;
  /** Paints a new trail frame and refreshes the GPU copy. */
  update: () => void;
  dispose: () => void;
};

export function createTouchSky(): TouchSky {
  const touch = new TouchTexture();

  const texture = new THREE.CubeTexture([
    touch.canvas,
    touch.canvas,
    touch.canvas,
    touch.canvas,
    touch.canvas,
    touch.canvas,
  ]);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  for (let i = 0; i < SEED_COUNT; i += 1) {
    touch.addTouch({ x: Math.random(), y: Math.random() });
  }

  const onPointerMove = (event: PointerEvent) => {
    touch.addTouch({
      x: event.clientX / window.innerWidth,
      y: 1 - event.clientY / window.innerHeight,
    });
  };
  window.addEventListener("pointermove", onPointerMove, { passive: true });

  const update = () => {
    if (Math.random() < SEED_CHANCE) {
      touch.addTouch({ x: Math.random(), y: Math.random() });
    }
    touch.update();
    texture.needsUpdate = true;
  };

  const dispose = () => {
    window.removeEventListener("pointermove", onPointerMove);
    texture.dispose();
  };

  return { texture, update, dispose };
}

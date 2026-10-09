// Background: charcoal base, a faint grid that fades in, a soft focal glow that follows the active
// scene, and a vignette. The grid and vignette are pre-rendered once per render scale.
import { W, H, C, RENDER } from '../theme';
import { EASE } from '../engine/ease';
import { lerp, prog } from '../engine/anim';

let built = 0;
let grid: HTMLCanvasElement;
let vignette: HTMLCanvasElement;

function layer() {
  const c = document.createElement('canvas');
  c.width = W * RENDER.scale;
  c.height = H * RENDER.scale;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.scale(RENDER.scale, RENDER.scale);
  return [c, g] as const;
}

function build() {
  // grid: 48 px cells, a stronger line every 4 cells, fading out toward the edges
  const [gc, g] = layer();
  const cell = 48;
  const ox = (W / 2) % (cell * 4);
  const oy = (H / 2) % (cell * 4);
  for (let x = ox % cell; x <= W; x += cell) {
    const major = Math.abs((x - ox) % (cell * 4)) < 0.5;
    g.fillStyle = major ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 255, 255, 0.035)';
    g.fillRect(Math.round(x), 0, 1, H);
  }
  for (let y = oy % cell; y <= H; y += cell) {
    const major = Math.abs((y - oy) % (cell * 4)) < 0.5;
    g.fillStyle = major ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 255, 255, 0.035)';
    g.fillRect(0, Math.round(y), W, 1);
  }
  g.globalCompositeOperation = 'destination-in';
  const mask = g.createRadialGradient(W / 2, H * 0.52, 60, W / 2, H * 0.52, W * 0.64);
  mask.addColorStop(0, 'rgba(0, 0, 0, 1)');
  mask.addColorStop(0.55, 'rgba(0, 0, 0, 0.7)');
  mask.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = mask;
  g.fillRect(0, 0, W, H);
  grid = gc;

  const [vc, v] = layer();
  const vg = v.createRadialGradient(W / 2, H / 2, H * 0.36, W / 2, H / 2, W * 0.72);
  vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vg.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  v.fillStyle = vg;
  v.fillRect(0, 0, W, H);
  vignette = vc;
  built = RENDER.scale;
}

export function backdrop(ctx: CanvasRenderingContext2D, t: number) {
  if (built !== RENDER.scale) build();
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // focal glow drifts with the story: data card → "after" column → centre stage
  const k1 = prog(t, 4.7, 5.8, EASE.inOut);
  const k2 = prog(t, 12.8, 13.8, EASE.inOut);
  const fx = lerp(lerp(960, 1420, k1), 960, k2);
  const fy = lerp(lerp(540, 420, k1), 560, k2);
  const level = prog(t, 0.4, 2.2, EASE.inOut);
  if (level > 0) {
    const r = lerp(820, 700, k1);
    const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
    glow.addColorStop(0, `rgba(79, 251, 223, ${0.075 * level})`);
    glow.addColorStop(0.45, `rgba(79, 251, 223, ${0.03 * level})`);
    glow.addColorStop(1, 'rgba(79, 251, 223, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  // the grid fades in behind the opening text, then steps back for the scene 3 numbers
  const g = prog(t, 0, 1.4, EASE.inOut) * (1 - 0.45 * prog(t, 13, 13.6, EASE.inOut));
  if (g > 0) {
    ctx.save();
    ctx.globalAlpha = g;
    ctx.drawImage(grid, 0, 0, W, H);
    ctx.restore();
  }
}

export function drawVignette(ctx: CanvasRenderingContext2D) {
  ctx.drawImage(vignette, 0, 0, W, H);
}

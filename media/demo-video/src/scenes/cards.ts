// Title card, outro lockup, backdrop and vignette.
import { C, W, H, RENDER } from '../theme';
import { EASE } from '../engine/ease';
import { lerp, prog } from '../engine/anim';
import { measure, nullLayer, textLayer, type TextStyle } from '../engine/layers';
import { OUTRO, TITLE } from '../timeline';

let logo: HTMLImageElement | null = null;
export async function loadLogo() {
  const img = new Image();
  img.src = '/logo-512.png';
  await img.decode();
  logo = img;
}

// ------------------------------------------------------------------------------------------ backdrop

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
  const [gc, g] = layer();
  const cell = 48;
  for (let x = 0; x <= W; x += cell) {
    g.fillStyle = (x / cell) % 4 === 0 ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)';
    g.fillRect(x, 0, 1, H);
  }
  for (let y = 12; y <= H; y += cell) {
    g.fillStyle = ((y - 12) / cell) % 4 === 0 ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)';
    g.fillRect(0, y, W, 1);
  }
  g.globalCompositeOperation = 'destination-in';
  const mask = g.createRadialGradient(W / 2, H * 0.5, 80, W / 2, H * 0.5, W * 0.62);
  mask.addColorStop(0, 'rgba(0, 0, 0, 1)');
  mask.addColorStop(0.6, 'rgba(0, 0, 0, 0.6)');
  mask.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = mask;
  g.fillRect(0, 0, W, H);
  grid = gc;

  const [vc, v] = layer();
  const vg = v.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, W * 0.75);
  vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vg.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
  v.fillStyle = vg;
  v.fillRect(0, 0, W, H);
  vignette = vc;
  built = RENDER.scale;
}

export function backdrop(ctx: CanvasRenderingContext2D, t: number) {
  if (built !== RENDER.scale) build();
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const level = prog(t, 0, 1.0, EASE.inOut);
  const glow = ctx.createRadialGradient(W / 2, H * 0.56, 0, W / 2, H * 0.56, 900);
  glow.addColorStop(0, `rgba(79, 251, 223, ${0.07 * level})`);
  glow.addColorStop(0.5, `rgba(79, 251, 223, ${0.025 * level})`);
  glow.addColorStop(1, 'rgba(79, 251, 223, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = level * 0.9;
  ctx.drawImage(grid, 0, 0, W, H);
  ctx.restore();
}

export const drawVignette = (ctx: CanvasRenderingContext2D) => ctx.drawImage(vignette, 0, 0, W, H);

// ------------------------------------------------------------------------------------------ title

const WORD: TextStyle = { family: 'sans', size: 92, weight: 700, color: C.white, tracking: 0.34 };
const TAG: TextStyle = { family: 'sans', size: 27, weight: 500, color: C.text2, align: 'center' };
const NOTE: TextStyle = { family: 'mono', size: 14, weight: 500, color: C.text3, align: 'center', tracking: 0.2 };

/** Letters that rise in one after another, centred on cx. */
function wordmark(ctx: CanvasRenderingContext2D, s: string, cx: number, y: number, st: TextStyle, t: number, t0: number, step: number) {
  const total = measure(ctx, s, st);
  let x = cx - total / 2;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const k = prog(t, t0 + i * step, t0 + i * step + 0.6, EASE.out);
    if (k > 0) textLayer(ctx, ch, x, y + (1 - k) * 22, st, k);
    x += measure(ctx, ch, st) + (st.tracking ?? 0) * st.size;
  }
}

export function titleCard(ctx: CanvasRenderingContext2D, t: number) {
  if (t > TITLE + 0.6) return;
  const exit = prog(t, TITLE - 0.75, TITLE - 0.05, EASE.in);
  nullLayer(ctx, { y: -46 * exit, opacity: 1 - exit }, () => {
    const lp = prog(t, 0.15, 1.0, EASE.out);
    if (logo && lp > 0) {
      const s = 148 * lerp(0.84, 1, lp);
      ctx.save();
      ctx.globalAlpha *= lp;
      const g = ctx.createRadialGradient(960, 392, 0, 960, 392, 260);
      g.addColorStop(0, 'rgba(79, 251, 223, 0.16)');
      g.addColorStop(1, 'rgba(79, 251, 223, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(700, 130, 520, 520);
      ctx.drawImage(logo, 960 - s / 2, 392 - s / 2, s, s);
      ctx.restore();
    }
    wordmark(ctx, 'ENCIRRA', 960, 592, WORD, t, 0.42, 0.06);
    const tp = prog(t, 0.95, 1.55, EASE.out);
    textLayer(ctx, 'CBRN situational awareness · 3D digital twin', 960, 652 + (1 - tp) * 14, TAG, tp);
    const np = prog(t, 1.25, 1.85, EASE.out);
    textLayer(ctx, 'CONCEPTUAL ENVIRONMENT · SYNTHETIC DATA', 960, 712 + (1 - np) * 10, NOTE, np);
  });
}

// ------------------------------------------------------------------------------------------ outro

/** Window transform for the opening rise and the outro pull-back (pivot = window centre). */
export function windowMotion(t: number) {
  const rise = prog(t, TITLE - 0.7, TITLE + 0.35, EASE.out);
  const pull = prog(t, OUTRO, OUTRO + 1.0, EASE.inOut);
  return {
    opacity: rise,
    scale: lerp(0.93, 1, rise) * lerp(1, 0.5, pull),
    dx: lerp(0, -395, pull),
    dy: lerp(70, 0, rise) + lerp(0, 0, pull),
  };
}

const O_WORD: TextStyle = { family: 'sans', size: 64, weight: 700, color: C.white, tracking: 0.3 };
const O_TAG: TextStyle = { family: 'sans', size: 24, weight: 500, color: C.text2 };
const O_URL: TextStyle = { family: 'mono', size: 21, weight: 500, color: C.cyan, tracking: 0.04 };
const O_BY: TextStyle = { family: 'sans', size: 21, weight: 500, color: C.white };
const O_NOTE: TextStyle = { family: 'mono', size: 12.5, weight: 500, color: C.text3, tracking: 0.16 };

export function outroCard(ctx: CanvasRenderingContext2D, t: number) {
  if (t < OUTRO + 0.3) return;
  const x = 1050;
  const step = (i: number) => prog(t, OUTRO + 0.55 + i * 0.12, OUTRO + 1.15 + i * 0.12, EASE.out);
  const lp = step(0);
  if (logo && lp > 0) {
    ctx.save();
    ctx.globalAlpha *= lp;
    ctx.drawImage(logo, x, 330 + (1 - lp) * 16, 84, 84);
    ctx.restore();
  }
  const rows: [string, number, TextStyle][] = [
    ['ENCIRRA', 512, O_WORD],
    ['CBRN situational awareness · 3D digital twin', 560, O_TAG],
    ['encirra.bridgeae.com', 632, O_URL],
    ['Encirra for Barakah · Developed by Awaiz Ahmed', 680, O_BY],
    ['CONCEPTUAL ENVIRONMENT · SYNTHETIC DATA · NO LINK TO OPERATIONAL SYSTEMS', 742, O_NOTE],
  ];
  rows.forEach(([s, y, st], i) => {
    const p = step(i + 1);
    textLayer(ctx, s, x, y + (1 - p) * 16, st, p);
  });
}

// Caption band above the window: kicker + title per segment (each line slides up as it changes), the
// chapter counter, a six-step progress rail, and a time-lapse badge while the footage runs fast.
import { C, WINDOW } from '../theme';
import { EASE } from '../engine/ease';
import { alpha, lerp, prog } from '../engine/anim';
import { fillRoundRect, strokeRoundRect } from '../engine/draw';
import { measure, textLayer, type TextStyle } from '../engine/layers';
import { frameData } from '../footage';
import { SEGMENTS, XF, type Segment } from '../timeline';

const KICKER: TextStyle = { family: 'mono', size: 15, weight: 500, color: C.cyan, tracking: 0.18 };
const TITLE: TextStyle = { family: 'sans', size: 40, weight: 600, color: C.white, tracking: -0.012 };
const INDEX: TextStyle = { family: 'mono', size: 15, weight: 500, color: C.text3, align: 'right', tracking: 0.08 };

function line(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, st: TextStyle, t: number, t0: number, t1: number, delay: number) {
  const inn = prog(t, t0 + delay, t0 + delay + 0.55, EASE.out);
  const out = prog(t, t1 - 0.3 + delay * 0.5, t1 + delay * 0.5, EASE.in);
  const a = inn * (1 - out);
  if (a <= 0.001) return;
  textLayer(ctx, s, x, y + (1 - inn) * 18 - out * 14, st, a);
}

export function captions(ctx: CanvasRenderingContext2D, t: number, level: number) {
  if (level <= 0.001) return;
  ctx.save();
  ctx.globalAlpha *= level;
  SEGMENTS.forEach((s, i) => {
    const t0 = i === 0 ? s.start - 0.25 : s.start - XF / 2;
    const t1 = i === SEGMENTS.length - 1 ? s.end + 10 : s.end - XF / 2;
    line(ctx, s.kicker.toUpperCase(), WINDOW.x, 80, KICKER, t, t0, t1, 0);
    line(ctx, s.title, WINDOW.x, 126, TITLE, t, t0, t1, 0.07);
    line(ctx, s.index, WINDOW.x + WINDOW.w, 80, INDEX, t, t0, t1, 0.03);
  });
  rail(ctx, t);
  ctx.restore();
}

/** Six thin segments under the chapter counter, filling as the film plays. */
function rail(ctx: CanvasRenderingContext2D, t: number) {
  const n = SEGMENTS.length;
  const w = 26;
  const gap = 6;
  const x0 = WINDOW.x + WINDOW.w - (n * w + (n - 1) * gap);
  const y = 112;
  SEGMENTS.forEach((s, i) => {
    const x = x0 + i * (w + gap);
    fillRoundRect(ctx, x, y, w, 3, 1.5, 'rgba(255, 255, 255, 0.14)');
    const k = prog(t, s.start, s.end, (v) => v);
    if (k > 0) fillRoundRect(ctx, x, y, w * k, 3, 1.5, alpha(C.cyan, 0.9));
  });
}

/** "▸▸ 2.5×" while the recording itself ran faster than real time. */
export function speedBadge(ctx: CanvasRenderingContext2D, seg: Segment, t: number, opacity: number) {
  const lt = t - seg.start;
  // look a little ahead and behind so the badge eases in and out instead of popping
  const fast = (dt: number) => (frameData(seg.id, seg.clipIn + lt + dt).s ?? 1) > 1.01;
  const a = Math.max(...[-0.2, -0.1, 0, 0.1, 0.2].map((dt) => (fast(dt) ? 1 - Math.abs(dt) * 2.5 : 0)));
  if (a <= 0.001) return;
  const speed = frameData(seg.id, seg.clipIn + lt).s > 1.01 ? frameData(seg.id, seg.clipIn + lt).s : 2.5;
  const label = `▸▸  ${speed.toFixed(1)}×  TIME-LAPSE`;
  const st: TextStyle = { family: 'mono', size: 14, weight: 500, tracking: 0.1 };
  const w = measure(ctx, label, st) + 30;
  const x = WINDOW.x + WINDOW.w - w - 20;
  const y = WINDOW.y + 20;
  ctx.save();
  ctx.globalAlpha *= a * opacity;
  fillRoundRect(ctx, x, y, w, 34, 17, 'rgba(11, 13, 18, 0.88)');
  strokeRoundRect(ctx, x + 0.5, y + 0.5, w - 1, 33, 17, 1, alpha(C.cyan, 0.5), 1);
  textLayer(ctx, label, x + 15, y + 22, { ...st, color: C.cyan });
  ctx.restore();
}

export const captionLift = (t: number, outro: number) => lerp(1, 0, prog(t, outro - 0.1, outro + 0.6, EASE.in));

// Shape primitives: outlines that draw themselves on, pills, rings, glows.
import { RENDER } from '../theme';
import { clamp, lerp } from './anim';
import { measure, nullLayer, pivot, textLayer, type TextStyle } from './layers';

export function glow(ctx: CanvasRenderingContext2D, color: string, blur: number) {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * RENDER.scale;
}

export function fillRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string | CanvasGradient) {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  ctx.fill();
}

/** Rounded-rect outline drawn on clockwise from the top-left as `p` goes 0 → 1. */
export function strokeRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, p: number, color: string, width = 1.25, dash?: number[]) {
  if (p <= 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  const rr = Math.min(r, w / 2, h / 2);
  if (dash) ctx.setLineDash(dash);
  else if (p < 1) {
    const L = 2 * (w + h) - (8 - 2 * Math.PI) * rr;
    ctx.setLineDash([L * p, L]);
  }
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rr);
  ctx.stroke();
  ctx.restore();
}

/** Straight line drawn on from its start point as `p` goes 0 → 1. */
export function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, p: number, color: string, width = 1) {
  if (p <= 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(lerp(x1, x2, p), lerp(y1, y2, p));
  ctx.stroke();
  ctx.restore();
}

export function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, width: number) {
  if (r <= 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

export function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Check mark that draws on as `p` goes 0 → 1 (s = size in px). */
export function check(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, p: number, width = 2.4) {
  if (p <= 0) return;
  const pts: [number, number][] = [
    [x, y + s * 0.52],
    [x + s * 0.36, y + s * 0.86],
    [x + s, y + s * 0.12],
  ];
  const l1 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
  const l2 = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);
  const d = clamp(p) * (l1 + l2);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (d <= l1) ctx.lineTo(lerp(pts[0][0], pts[1][0], d / l1), lerp(pts[0][1], pts[1][1], d / l1));
  else {
    ctx.lineTo(pts[1][0], pts[1][1]);
    const k = (d - l1) / l2;
    ctx.lineTo(lerp(pts[1][0], pts[2][0], k), lerp(pts[1][1], pts[2][1], k));
  }
  ctx.stroke();
  ctx.restore();
}

export type PillKind = 'outline' | 'cyan' | 'mint';

/** Label pill centred on (cx, cy); `p` pops it in (scale + opacity, overshoot-friendly). */
export function pill(ctx: CanvasRenderingContext2D, cx: number, cy: number, label: string, kind: PillKind, p: number, opacity = 1, size = 15) {
  if (p <= 0.001 || opacity <= 0.001) return;
  const st: TextStyle = { family: 'mono', size, weight: 500, align: 'center' };
  const w = measure(ctx, label, st) + size * 1.9;
  const h = size * 2;
  nullLayer(ctx, pivot(cx, cy, { scale: lerp(0.86, 1, p), opacity: clamp(p) * opacity }), () => {
    if (kind === 'cyan') {
      ctx.save();
      glow(ctx, 'rgba(79, 251, 223, 0.55)', 16);
      fillRoundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2, '#4FFBDF');
      ctx.restore();
    } else {
      fillRoundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2, kind === 'mint' ? 'rgba(0, 230, 118, 0.08)' : 'rgba(14, 16, 22, 0.94)');
      ctx.save();
      if (kind === 'mint') glow(ctx, 'rgba(0, 230, 118, 0.5)', 12);
      strokeRoundRect(ctx, cx - w / 2 + 0.5, cy - h / 2 + 0.5, w - 1, h - 1, h / 2, 1, kind === 'mint' ? '#00E676' : 'rgba(255, 255, 255, 0.5)', 1.25);
      ctx.restore();
    }
    textLayer(ctx, label, cx, cy + size * 0.34, { ...st, color: kind === 'cyan' ? '#0B0C10' : kind === 'mint' ? '#00E676' : 'rgba(255, 255, 255, 0.9)' });
  });
}

/** Width of a pill for a label (for layout next to other elements). */
export const pillWidth = (ctx: CanvasRenderingContext2D, label: string, size = 15) => measure(ctx, label, { family: 'mono', size, weight: 500 }) + size * 1.9;

/** Viewfinder corner brackets around a rectangle. */
export function brackets(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, arm: number, color: string, width = 2) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ]) {
    ctx.moveTo(cx + dx * arm, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * arm);
  }
  ctx.stroke();
  ctx.restore();
}

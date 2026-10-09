// The app window: recorded footage inside a rounded frame, a virtual camera that pushes in on details,
// the operator's cursor with click ripples, and keycaps for keyboard shortcuts.
import { C, W, H, WINDOW } from '../theme';
import { EASE } from '../engine/ease';
import { alpha, clamp, lerp, prog } from '../engine/anim';
import { fillRoundRect, glow, strokeRoundRect } from '../engine/draw';
import { measure, nullLayer, textLayer } from '../engine/layers';
import { bitmap, clip, frameData, frameIndex, probe, type ClipName, type Rect } from '../footage';
import type { Segment } from '../timeline';

const CSS_W = 1920;
const CSS_H = 1080;

/** CSS px → screen px mapping for the current camera. */
export interface View {
  x0: number;
  y0: number;
  s: number;
}

export function viewFor(z: number, cx: number, cy: number): View {
  const vw = CSS_W / z;
  const vh = CSS_H / z;
  const x0 = clamp(cx - vw / 2, 0, CSS_W - vw);
  const y0 = clamp(cy - vh / 2, 0, CSS_H - vh);
  return { x0, y0, s: WINDOW.w / vw };
}

export const toScreen = (v: View, x: number, y: number): [number, number] => [WINDOW.x + (x - v.x0) * v.s, WINDOW.y + (y - v.y0) * v.s];

export function rectToScreen(v: View, r: Rect, pad = 0): Rect {
  const [x, y] = toScreen(v, r[0], r[1]);
  return [x - pad, y - pad, r[2] * v.s + pad * 2, r[3] * v.s + pad * 2];
}

const center = (r: Rect): [number, number] => [r[0] + r[2] / 2, r[1] + r[3] / 2];

/** Camera at segment-local time `lt`: each key glides from the previous framing to its own. */
export function cameraAt(seg: Segment, lt: number): View {
  let z = 1;
  let cx = CSS_W / 2;
  let cy = CSS_H / 2;
  for (const k of seg.camera) {
    if (lt < k.at) break;
    let tx = k.x ?? cx;
    let ty = k.y ?? cy;
    if (k.probe) {
      const r = probe(seg.id, seg.clipIn + k.at, k.probe);
      if (r) [tx, ty] = center(r);
      tx += k.dx ?? 0;
      ty += k.dy ?? 0;
    }
    const p = prog(lt, k.at, k.at + (k.dur ?? 1.2), EASE.inOut);
    // zoom in log space so pushes feel even
    z = Math.exp(lerp(Math.log(z), Math.log(k.z), p));
    cx = lerp(cx, tx, p);
    cy = lerp(cy, ty, p);
  }
  return viewFor(z, cx, cy);
}

/** Draws the footage frame for clip time `ct` into the window with the camera `v`. */
export function drawFootage(ctx: CanvasRenderingContext2D, name: ClipName, ct: number, v: View, opacity = 1) {
  const c = clip(name);
  const img = bitmap(name, frameIndex(name, ct));
  if (!img || opacity <= 0.001) return;
  const k = c.dsf;
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, v.x0 * k, v.y0 * k, (WINDOW.w / v.s) * k, (WINDOW.h / v.s) * k, WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h);
  ctx.restore();
}

/** Clip to the rounded window, run `body`, then draw the frame's edge. */
export function windowFrame(ctx: CanvasRenderingContext2D, body: () => void) {
  const { x, y, w, h, r } = WINDOW;
  ctx.save();
  glow(ctx, 'rgba(0, 0, 0, 0.65)', 48);
  fillRoundRect(ctx, x, y, w, h, r, '#07080B');
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();
  body();
  ctx.restore();
  strokeRoundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r, 1, 'rgba(255, 255, 255, 0.13)', 1);
}

// ------------------------------------------------------------------------------------------ cursor

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, press: number) {
  const k = (size / 20) * (1 - 0.12 * press);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 17.5);
  ctx.lineTo(4.3, 13.5);
  ctx.lineTo(7.2, 20);
  ctx.lineTo(10, 18.8);
  ctx.lineTo(7.2, 12.5);
  ctx.lineTo(12.8, 12.5);
  ctx.closePath();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0B0C10';
  ctx.stroke();
  ctx.restore();
}

/** Cursor, click ripples and shortcut keycaps for a segment at clip time `ct`. */
export function drawOperator(ctx: CanvasRenderingContext2D, seg: Segment, ct: number, v: View, opacity: number) {
  const c = clip(seg.id);
  const d = frameData(seg.id, ct);
  // click ripples (behind the arrow)
  for (const f of c.clicks) {
    const tc = f / c.fps;
    const p = (ct - tc) / 0.5;
    if (p < 0 || p > 1) continue;
    const at = c.data[f]?.c ?? d.c;
    if (!at) continue;
    const [x, y] = toScreen(v, at[0], at[1]);
    const e = EASE.out(p);
    ctx.save();
    ctx.globalAlpha *= opacity * (1 - p);
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(x, y, lerp(5, 30, e) * v.s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = alpha(C.cyan, 0.22 * (1 - p));
    ctx.beginPath();
    ctx.arc(x, y, lerp(4, 16, e) * v.s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (d.c && opacity > 0.001) {
    const [x, y] = toScreen(v, d.c[0], d.c[1]);
    const press = Math.max(0, ...c.clicks.map((f) => 1 - Math.abs(ct - f / c.fps) / 0.12).filter((q) => q > 0), 0);
    ctx.save();
    ctx.globalAlpha *= opacity;
    arrow(ctx, x, y, 21 * v.s, press);
    ctx.restore();
  }
  // keycaps for shortcuts, under the window's lower edge area
  for (const kk of c.keys) {
    const tk = kk.frame / c.fps;
    const a = prog(ct, tk - 0.12, tk + 0.12, EASE.out) * (1 - prog(ct, tk + 0.95, tk + 1.25, EASE.in));
    if (a <= 0.001) continue;
    const caps = kk.label === '↵' ? ['Enter ↵'] : kk.label.split(' ');
    keycaps(ctx, caps, WINDOW.x + WINDOW.w / 2, WINDOW.y + WINDOW.h - 66, a * opacity);
  }
}

function keycaps(ctx: CanvasRenderingContext2D, caps: string[], cx: number, cy: number, a: number) {
  const st = { family: 'mono' as const, size: 20, weight: 500, align: 'center' as CanvasTextAlign };
  const ws = caps.map((s) => Math.max(46, measure(ctx, s, st) + 30));
  const gap = 12;
  const total = ws.reduce((m, w) => m + w, 0) + gap * (caps.length - 1);
  nullLayer(ctx, { x: cx, y: cy, anchorX: cx, anchorY: cy, scale: lerp(0.9, 1, a), opacity: a }, () => {
    let x = cx - total / 2;
    caps.forEach((s, i) => {
      const w = ws[i];
      ctx.save();
      glow(ctx, 'rgba(0, 0, 0, 0.6)', 18);
      fillRoundRect(ctx, x, cy - 25, w, 50, 9, 'rgba(14, 17, 23, 0.95)');
      ctx.restore();
      fillRoundRect(ctx, x, cy + 21, w, 4, 2, 'rgba(79, 251, 223, 0.55)');
      strokeRoundRect(ctx, x + 0.5, cy - 24.5, w - 1, 49, 9, 1, 'rgba(255, 255, 255, 0.22)', 1);
      textLayer(ctx, s, x + w / 2, cy + 7, { ...st, color: C.white });
      x += w + gap;
    });
  });
}

/** Full-frame darkening used behind title and outro cards. */
export function scrim(ctx: CanvasRenderingContext2D, a: number) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

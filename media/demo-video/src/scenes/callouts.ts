// Callouts: an outline that draws itself around a live UI element (tracked from the recording), corner
// brackets, an optional spotlight that dims the rest of the window, and a label chip on a short leader.
import { C, WINDOW } from '../theme';
import { EASE } from '../engine/ease';
import { alpha, clamp, lerp, prog } from '../engine/anim';
import { brackets, fillRoundRect, glow, line, strokeRoundRect } from '../engine/draw';
import { measure, nullLayer, textLayer, type TextStyle } from '../engine/layers';
import { probe } from '../footage';
import { rectToScreen, type View } from './screen';
import type { Callout, Segment } from '../timeline';

const TONE = { cyan: C.cyan, mint: C.mint, amber: C.amber } as const;
const LABEL: TextStyle = { family: 'sans', size: 19, weight: 600 };
const SUB: TextStyle = { family: 'mono', size: 13, weight: 500, tracking: 0.08 };

function spotlight(ctx: CanvasRenderingContext2D, r: [number, number, number, number], a: number) {
  if (a <= 0.001) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h);
  ctx.roundRect(r[0], r[1], r[2], r[3], 10);
  ctx.fillStyle = `rgba(5, 6, 9, ${0.5 * a})`;
  ctx.fill('evenodd');
  ctx.restore();
}

/** Window-space spotlights for the segment (drawn before outlines so they sit under them). */
export function drawSpotlights(ctx: CanvasRenderingContext2D, seg: Segment, lt: number, v: View) {
  for (const c of seg.callouts) {
    if (!c.spot) continue;
    const a = appear(c, lt);
    if (a <= 0.001) continue;
    const r = probe(seg.id, seg.clipIn + lt, c.probe);
    if (!r) continue;
    spotlight(ctx, rectToScreen(v, r, c.pad ?? 6), a);
  }
}

function appear(c: Callout, lt: number) {
  return prog(lt, c.at, c.at + 0.45, EASE.out) * (1 - prog(lt, c.at + c.dur - 0.3, c.at + c.dur, EASE.in));
}

export function drawCallouts(ctx: CanvasRenderingContext2D, seg: Segment, lt: number, v: View, opacity: number) {
  for (const c of seg.callouts) {
    const a = appear(c, lt) * opacity;
    if (a <= 0.001) continue;
    const r = probe(seg.id, seg.clipIn + lt, c.probe);
    if (!r) continue;
    const [x, y, w, h] = rectToScreen(v, r, c.pad ?? 6);
    const col = TONE[c.tone ?? 'cyan'];
    const draw = prog(lt, c.at + 0.05, c.at + 0.75, EASE.inOut);
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.save();
    glow(ctx, alpha(col, 0.55), 14);
    strokeRoundRect(ctx, x, y, w, h, 10, draw, col, 2);
    ctx.restore();
    brackets(ctx, x - 5, y - 5, w + 10, h + 10, Math.min(18, w / 4, h / 4), alpha(col, 0.9 * draw), 2.5);
    ctx.restore();
    chip(ctx, c, [x, y, w, h], col, lt, opacity);
  }
}

function chip(ctx: CanvasRenderingContext2D, c: Callout, r: [number, number, number, number], col: string, lt: number, opacity: number) {
  const p = prog(lt, c.at + 0.2, c.at + 0.7, EASE.out) * (1 - prog(lt, c.at + c.dur - 0.3, c.at + c.dur, EASE.in));
  if (p <= 0.001) return;
  const [x, y, w, h] = r;
  const lw = measure(ctx, c.label, LABEL);
  const sw = c.sub ? measure(ctx, c.sub, SUB) : 0;
  const cw = Math.max(lw, sw) + 46;
  const ch = c.sub ? 62 : 42;
  const lead = 30;
  let cx: number;
  let cy: number;
  let lx1: number;
  let ly1: number;
  let lx2: number;
  let ly2: number;
  switch (c.side) {
    case 'top':
      cx = x + w / 2 - cw / 2 + (c.nudge ?? 0);
      cy = y - lead - ch;
      [lx1, ly1, lx2, ly2] = [x + w / 2, y, x + w / 2, y - lead];
      break;
    case 'bottom':
      cx = x + w / 2 - cw / 2 + (c.nudge ?? 0);
      cy = y + h + lead;
      [lx1, ly1, lx2, ly2] = [x + w / 2, y + h, x + w / 2, y + h + lead];
      break;
    case 'left':
      cx = x - lead - cw;
      cy = y + h / 2 - ch / 2 + (c.nudge ?? 0);
      [lx1, ly1, lx2, ly2] = [x, y + h / 2, x - lead, y + h / 2];
      break;
    default:
      cx = x + w + lead;
      cy = y + h / 2 - ch / 2 + (c.nudge ?? 0);
      [lx1, ly1, lx2, ly2] = [x + w, y + h / 2, x + w + lead, y + h / 2];
  }
  // keep the chip inside the window
  cx = clamp(cx, WINDOW.x + 14, WINDOW.x + WINDOW.w - cw - 14);
  cy = clamp(cy, WINDOW.y + 14, WINDOW.y + WINDOW.h - ch - 14);
  ctx.save();
  ctx.globalAlpha *= opacity;
  line(ctx, lx1, ly1, lx2, ly2, p, alpha(col, 0.9), 2);
  nullLayer(ctx, { x: cx + cw / 2, y: cy + ch / 2, anchorX: cx + cw / 2, anchorY: cy + ch / 2, scale: lerp(0.92, 1, p), opacity: clamp(p * 1.4) }, () => {
    ctx.save();
    glow(ctx, 'rgba(0, 0, 0, 0.7)', 22);
    fillRoundRect(ctx, cx, cy, cw, ch, 10, C.chip);
    ctx.restore();
    strokeRoundRect(ctx, cx + 0.5, cy + 0.5, cw - 1, ch - 1, 10, 1, alpha(col, 0.55), 1.2);
    ctx.save();
    glow(ctx, alpha(col, 0.8), 10);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx + 20, cy + (c.sub ? 23 : ch / 2), 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    textLayer(ctx, c.label, cx + 34, cy + (c.sub ? 30 : 28), { ...LABEL, color: C.white });
    if (c.sub) textLayer(ctx, c.sub, cx + 34, cy + 50, { ...SUB, color: alpha(col, 0.95) });
  });
  ctx.restore();
}

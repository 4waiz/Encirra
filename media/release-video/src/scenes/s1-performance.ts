// Scene 1 (0:00–0:05): platform header and the "Performance Optimization" data card.
// Both readouts count up with time expressions; all readout text is parented to the master null.
import { C } from '../theme';
import { COPY } from '../copy';
import { masterNull } from '../controller';
import { EASE } from '../engine/ease';
import { lerp, prog } from '../engine/anim';
import { hash } from '../engine/random';
import { measure, nullLayer, pivot, textLayer, type TextStyle } from '../engine/layers';
import { fillRoundRect, glow, line, strokeRoundRect, disc } from '../engine/draw';

const END = 5.1;
const CARD = { x: 96, y: 330, w: 1728, h: 420 };
const CY = CARD.y;
const COL_A = 144;
const COL_B = 1008;

const LABEL: TextStyle = { family: 'sans', size: 22, weight: 500, color: C.text2 };
const VALUE: TextStyle = { family: 'mono', size: 96, weight: 500, color: C.white, tracking: -0.02 };
const SMALL: TextStyle = { family: 'mono', size: 13, weight: 400, color: C.text3, tracking: 0.04 };

/** JS heap (MB) through the perf probe's three screen cycles (measured 30.3 → 29.8 → 34.0 → 28.6). */
const HEAP = [30.3, 30.6, 29.8, 31.1, 32.4, 34.0, 32.2, 30.4, 28.6, 29.3, 28.9, 28.6];

export function sceneOne(ctx: CanvasRenderingContext2D, t: number) {
  if (t >= END) return;
  const enter = prog(t, 0.9, 1.75, EASE.out);
  const exit = prog(t, 4.55, 5.05, EASE.in);
  if (enter <= 0) return;

  nullLayer(ctx, pivot(960, 540, { y: 540 + (1 - enter) * 28 - exit * 26, scale: lerp(0.985, 1, enter), opacity: enter * (1 - exit) }), () => {
    card(ctx, t);
    // every readout below is a child of the master null controller
    nullLayer(ctx, masterNull(t), () => {
      frameRate(ctx, t);
      memory(ctx, t);
    });
  });
}

function card(ctx: CanvasRenderingContext2D, t: number) {
  const { x, y, w, h } = CARD;
  fillRoundRect(ctx, x, y, w, h, 18, C.card);
  strokeRoundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 18, 1, 'rgba(255, 255, 255, 0.11)');
  // a soft highlight along the top edge
  const hl = ctx.createLinearGradient(x, 0, x + w, 0);
  hl.addColorStop(0, 'rgba(255, 255, 255, 0)');
  hl.addColorStop(0.5, 'rgba(255, 255, 255, 0.16)');
  hl.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = hl;
  ctx.fillRect(x + 24, y, w - 48, 1);

  const head = prog(t, 1.25, 1.85, EASE.out);
  ctx.save();
  ctx.globalAlpha *= head;
  glow(ctx, 'rgba(79, 251, 223, 0.8)', 12);
  ctx.fillStyle = C.cyan;
  ctx.fillRect(x, CY + 40, 3, 32);
  ctx.restore();
  textLayer(ctx, COPY.performance.card, COL_A + (1 - head) * 14, CY + 66, { family: 'sans', size: 30, weight: 600, color: C.white, tracking: -0.01 }, head);
  textLayer(ctx, COPY.performance.meta, 1776, CY + 64, { ...SMALL, align: 'right', tracking: 0.14 }, head);

  line(ctx, COL_A, CY + 100.5, 1776, CY + 100.5, prog(t, 1.3, 2.0, EASE.inOut), 'rgba(255, 255, 255, 0.10)');
  line(ctx, 960.5, CY + 136, 960.5, CY + 384, prog(t, 1.45, 2.1, EASE.inOut), 'rgba(255, 255, 255, 0.10)');
}

/** Readout A: frame cost. The value is an expression of time, and the budget meter is linked to it. */
function frameRate(ctx: CanvasRenderingContext2D, t: number) {
  const lab = prog(t, 1.45, 1.95, EASE.out);
  textLayer(ctx, COPY.performance.frameLabel, COL_A, CY + 168 + (1 - lab) * 10, LABEL, lab);

  const v = prog(t, 1.6, 3.3, EASE.out); // value(t) = 1.0 ms × easeOut(progress)
  const settle = prog(t, 3.35, 3.8, EASE.inOut); // the trailing ".0" folds away into "~1"
  const vis = prog(t, 1.55, 1.95, EASE.out);
  const whole = Math.min(1, Math.floor(v + 1e-6));
  const tenth = whole >= 1 ? 0 : Math.floor(v * 10 + 1e-6) % 10;
  const head = `~${whole}`;
  const tail = `.${tenth}`;
  const y = CY + 268;
  const wHead = measure(ctx, head, VALUE);
  const wTail = measure(ctx, tail, VALUE);
  textLayer(ctx, head, COL_A, y, VALUE, vis);
  const kern = VALUE.size * (VALUE.tracking ?? 0); // letter spacing between the two runs
  textLayer(ctx, tail, COL_A + wHead + kern, y, VALUE, vis * (1 - settle));
  textLayer(ctx, COPY.performance.frameUnit, COL_A + wHead + (wTail + kern) * (1 - settle) + 12, y, { family: 'mono', size: 32, weight: 400, color: C.text2 }, vis);

  // meter: 1 ms against the 16.7 ms frame budget
  const mx = COL_A;
  const my = CY + 312;
  const mw = 720;
  const meter = prog(t, 1.6, 2.15, EASE.out);
  ctx.save();
  ctx.globalAlpha *= meter;
  fillRoundRect(ctx, mx, my, mw, 6, 3, 'rgba(255, 255, 255, 0.07)');
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  for (let ms = 1; ms <= 16; ms++) ctx.fillRect(Math.round(mx + (ms / 16.7) * mw), my + 12, 1, ms % 5 === 0 ? 7 : 4);
  ctx.restore();
  const fill = (v / 16.7) * mw;
  if (fill > 0.5) {
    ctx.save();
    glow(ctx, 'rgba(79, 251, 223, 0.9)', 14);
    fillRoundRect(ctx, mx, my, Math.max(6, fill), 6, 3, C.cyan);
    ctx.restore();
  }
  const pct = Math.round((v / 16.7) * 100);
  textLayer(ctx, `${pct}% of the frame budget`, mx, CY + 364, { ...SMALL, color: C.text2 }, meter);
  textLayer(ctx, COPY.performance.frameBudget, mx + mw, CY + 364, { ...SMALL, align: 'right' }, meter);
}

/** Readout B: memory. Counters tick up while the heap trace draws, then the state decodes to "Stable". */
function memory(ctx: CanvasRenderingContext2D, t: number) {
  const lab = prog(t, 1.55, 2.05, EASE.out);
  textLayer(ctx, COPY.performance.memoryLabel, COL_B, CY + 168 + (1 - lab) * 10, LABEL, lab);

  // decode: each glyph flickers (seeded per output frame, so motion-blur sub-samples agree) then locks
  const word = COPY.performance.memoryValue;
  const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&';
  const frame = Math.floor(t * 24 + 1e-6);
  const cw = measure(ctx, 'M', VALUE) + VALUE.size * (VALUE.tracking ?? 0);
  const y = CY + 268;
  for (let i = 0; i < word.length; i++) {
    const t0 = 2.95 + i * 0.05;
    const appear = prog(t, t0, t0 + 0.2, EASE.out);
    if (appear <= 0) continue;
    const locked = t >= 3.2 + i * 0.08;
    const ch = locked ? word[i] : GLYPHS[Math.floor(hash(i + 1, frame) * GLYPHS.length)];
    textLayer(ctx, ch, COL_B + i * cw, y, { ...VALUE, color: locked ? C.white : C.cyan }, appear * (locked ? 1 : 0.75));
  }
  const note = prog(t, 3.55, 4.05, EASE.out);
  textLayer(ctx, COPY.performance.memoryNote, COL_B + cw * word.length + 22 + (1 - note) * 16, y, { family: 'mono', size: 30, weight: 500, color: C.cyan, glow: 12, glowColor: 'rgba(79, 251, 223, 0.6)' }, note);

  // heap trace across the three screen cycles
  const sx = COL_B;
  const sy = CY + 290;
  const sw = 520;
  const sh = 40;
  const draw = prog(t, 1.7, 3.2, EASE.inOut);
  const lo = 26;
  const hi = 36;
  const pts = HEAP.map((v, i) => [sx + (i / (HEAP.length - 1)) * sw, sy + sh - ((v - lo) / (hi - lo)) * sh] as const);
  if (draw > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx - 6, sy - 12, sw * draw + 6, sh + 24);
    ctx.clip();
    const area = ctx.createLinearGradient(0, sy, 0, sy + sh);
    area.addColorStop(0, 'rgba(79, 251, 223, 0.16)');
    area.addColorStop(1, 'rgba(79, 251, 223, 0)');
    ctx.beginPath();
    ctx.moveTo(pts[0][0], sy + sh);
    for (const [px, py] of pts) ctx.lineTo(px, py);
    ctx.lineTo(pts[pts.length - 1][0], sy + sh);
    ctx.closePath();
    ctx.fillStyle = area;
    ctx.fill();
    glow(ctx, 'rgba(79, 251, 223, 0.7)', 8);
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.stroke();
    ctx.restore();
    // pen head
    const f = draw * (pts.length - 1);
    const i0 = Math.min(pts.length - 2, Math.floor(f));
    const k = f - i0;
    ctx.save();
    glow(ctx, 'rgba(79, 251, 223, 0.9)', 10);
    disc(ctx, lerp(pts[i0][0], pts[i0 + 1][0], k), lerp(pts[i0][1], pts[i0 + 1][1], k), 3.5, C.cyan);
    ctx.restore();
  }
  const end = prog(t, 3.0, 3.5, EASE.out);
  textLayer(ctx, COPY.performance.heap, sx + sw + 24, sy + 18, { family: 'mono', size: 17, weight: 500, color: C.white }, end);
  textLayer(ctx, COPY.performance.heapNote, sx + sw + 24, sy + 38, SMALL, end);

  // counters: render targets, textures and geometries count up to the measured steady state
  const k = prog(t, 1.8, 3.2, EASE.out);
  const n = (target: number) => String(Math.round(target * k)).padStart(String(target).length, ' ');
  textLayer(ctx, `render targets ${n(4)}  ·  textures ${n(15)}  ·  geometries ${n(113)}`, COL_B, CY + 364, { ...SMALL, color: C.text2 }, lab);
}

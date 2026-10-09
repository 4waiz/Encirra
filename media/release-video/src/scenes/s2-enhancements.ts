// Scene 2 (0:05–0:13): "Before → After" UI enhancements.
// Left: the old overlapping layout, fading back to 30 %. Right: the cyan sensor ring, labels sliding
// apart and auto-framing. Bottom: the correlation graph scaling along X to fill its panel.
import { C } from '../theme';
import { COPY } from '../copy';
import { masterNull } from '../controller';
import { EASE } from '../engine/ease';
import { alpha, clamp, lerp, prog } from '../engine/anim';
import { measure, nullLayer, pivot, textLayer, type TextStyle } from '../engine/layers';
import { brackets, check, disc, fillRoundRect, glow, line, pill, ring, strokeRoundRect } from '../engine/draw';

const START = 5;
const BEFORE = { x: 96, y: 226, w: 816, h: 372 };
const AFTER = { x: 1008, y: 226, w: 816, h: 372 };
const PANEL = { x: 96, y: 690, w: 1728, h: 330 };
const CAPTION: TextStyle = { family: 'sans', size: 24, weight: 500, color: C.white, tracking: -0.005 };
const COLUMN: TextStyle = { family: 'mono', size: 14, weight: 500, tracking: 0.22 };
const INK = 'rgba(255, 255, 255, 0.42)';

export function sceneTwo(ctx: CanvasRenderingContext2D, t: number) {
  if (t < 4.85 || t >= 13.1) return;
  const lt = t - START;
  const enter = prog(t, 4.85, 5.45, EASE.out);
  const exit = prog(t, 12.55, 13.05, EASE.in);
  nullLayer(ctx, { y: (1 - enter) * 22 - exit * 26, opacity: enter * (1 - exit) }, () => {
    before(ctx, t, lt);
    arrow(ctx, lt);
    after(ctx, t, lt);
    graphPanel(ctx, t, lt);
  });
}

// ------------------------------------------------------------------------------------------ before

function before(ctx: CanvasRenderingContext2D, t: number, lt: number) {
  const dimmed = 1 - 0.7 * prog(lt, 2.4, 3.2, EASE.inOut); // fades the whole column down to 30 %
  nullLayer(ctx, { opacity: dimmed }, () => {
    textLayer(ctx, COPY.enhancements.before, BEFORE.x, 206, { ...COLUMN, color: C.text2 }, prog(lt, 0, 0.5, EASE.out));
    const { x, y, w, h } = BEFORE;
    fillRoundRect(ctx, x, y, w, h, 16, 'rgba(255, 255, 255, 0.02)');
    strokeRoundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 16, prog(lt, 0.15, 0.8, EASE.inOut), 'rgba(255, 255, 255, 0.16)');

    // header strip with nav stubs
    line(ctx, x + 24, y + 46.5, x + w - 24, y + 46.5, prog(lt, 0.3, 0.85, EASE.inOut), 'rgba(255, 255, 255, 0.14)');
    for (let i = 0; i < 4; i++) {
      const p = prog(lt, 0.4 + i * 0.06, 0.75 + i * 0.06, EASE.out);
      fillRoundRect(ctx, x + 24 + i * 74, y + 19, 54 * p, 9, 4.5, 'rgba(255, 255, 255, 0.14)');
    }
    const side = { x: x + 24, y: y + 66, w: 150, h: 282 };
    const view = { x: x + 190, y: y + 66, w: 392, h: 282 };
    const feeds = [
      { x: x + 598, y: y + 66, w: 194, h: 133 },
      { x: x + 598, y: y + 215, w: 194, h: 133 },
    ];
    strokeRoundRect(ctx, side.x, side.y, side.w, side.h, 10, prog(lt, 0.45, 1.0, EASE.inOut), INK);
    for (let i = 0; i < 6; i++) {
      const p = prog(lt, 0.8 + i * 0.04, 1.1 + i * 0.04, EASE.out);
      fillRoundRect(ctx, side.x + 16, side.y + 22 + i * 40, (i % 2 ? 84 : 112) * p, 8, 4, 'rgba(255, 255, 255, 0.12)');
    }
    strokeRoundRect(ctx, view.x, view.y, view.w, view.h, 10, prog(lt, 0.55, 1.1, EASE.inOut), INK);
    // stylised map: roads and two domes
    const map = prog(lt, 0.85, 1.35, EASE.inOut);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(view.x, view.y, view.w, view.h, 10);
    ctx.clip();
    ctx.globalAlpha *= map;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(view.x - 10, view.y + 210);
    ctx.lineTo(view.x + view.w + 10, view.y + 120);
    ctx.moveTo(view.x + 120, view.y - 10);
    ctx.lineTo(view.x + 200, view.y + view.h + 10);
    ctx.stroke();
    ring(ctx, view.x + 84, view.y + 84, 30, 'rgba(255, 255, 255, 0.22)', 1.25);
    ring(ctx, view.x + 318, view.y + 206, 24, 'rgba(255, 255, 255, 0.22)', 1.25);
    ctx.restore();

    feeds.forEach((f, i) => {
      strokeRoundRect(ctx, f.x, f.y, f.w, f.h, 10, prog(lt, 0.65 + i * 0.1, 1.15 + i * 0.1, EASE.inOut), INK);
      // the feed title runs past the tile and is cut off
      const tp = prog(lt, 1.05 + i * 0.08, 1.4 + i * 0.08, EASE.out);
      line(ctx, f.x + 1, f.y + 30.5, f.x + f.w - 1, f.y + 30.5, tp, 'rgba(255, 255, 255, 0.14)');
      ctx.save();
      ctx.beginPath();
      ctx.rect(f.x + 10, f.y + 4, f.w - 40, 24);
      ctx.clip();
      textLayer(ctx, COPY.enhancements.labels.feed.replace('01', `0${i + 1}`), f.x + 12, f.y + 21, { family: 'mono', size: 11.5, color: 'rgba(255, 255, 255, 0.78)' }, tp);
      ctx.restore();
      textLayer(ctx, '…', f.x + f.w - 26, f.y + 21, { family: 'mono', size: 12, color: 'rgba(255, 255, 255, 0.78)' }, tp);
      strokeRoundRect(ctx, f.x + f.w - 34, f.y + 6, 26, 20, 4, prog(lt, 1.35 + i * 0.08, 1.6 + i * 0.08, EASE.out), 'rgba(255, 255, 255, 0.55)', 1, [3, 3]);
    });

    // overlapping labels piled on one spot
    const cx = view.x + 196;
    const cy = view.y + 150;
    disc(ctx, cx + 8, cy + 34, 5, `rgba(255, 255, 255, ${0.6 * map})`);
    pill(ctx, cx - 16, cy - 14, COPY.enhancements.labels.asset, 'outline', prog(lt, 0.95, 1.35, EASE.snap));
    pill(ctx, cx + 6, cy, COPY.enhancements.labels.incident, 'outline', prog(lt, 1.05, 1.45, EASE.snap));
    pill(ctx, cx + 28, cy + 11, COPY.enhancements.labels.sensor, 'outline', prog(lt, 1.15, 1.55, EASE.snap));
    const conflict = prog(lt, 1.35, 1.7, EASE.out);
    strokeRoundRect(ctx, cx - 128, cy - 40, 268, 76, 8, conflict, 'rgba(255, 255, 255, 0.5)', 1, [4, 4]);
    if (conflict > 0) {
      disc(ctx, cx + 140, cy - 40, 9 * conflict, 'rgba(255, 255, 255, 0.85)');
      textLayer(ctx, '!', cx + 140, cy - 35.5, { family: 'sans', size: 13, weight: 700, color: C.bg, align: 'center' }, conflict);
    }

    // caption (bullet) — parented to the master null
    nullLayer(ctx, masterNull(t), () => {
      const cap = prog(lt, 1.5, 2.1, EASE.out);
      textLayer(ctx, COPY.enhancements.beforeCaption, BEFORE.x, 650 + (1 - cap) * 12, CAPTION, cap);
    });
  });
}

function arrow(ctx: CanvasRenderingContext2D, lt: number) {
  const p = prog(lt, 2.3, 2.95, EASE.inOut);
  if (p <= 0) return;
  const y = BEFORE.y + BEFORE.h / 2;
  const x1 = 932;
  const x2 = 988;
  ctx.save();
  glow(ctx, 'rgba(79, 251, 223, 0.6)', 10);
  line(ctx, x1, y, x2, y, p, C.cyan, 2);
  const head = prog(lt, 2.75, 3.05, EASE.out);
  if (head > 0) {
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha *= head;
    ctx.beginPath();
    ctx.moveTo(x2 - 9, y - 8);
    ctx.lineTo(x2 + 1, y);
    ctx.lineTo(x2 - 9, y + 8);
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------------------------------------ after

function after(ctx: CanvasRenderingContext2D, t: number, lt: number) {
  const { x, y, w, h } = AFTER;
  textLayer(ctx, COPY.enhancements.after, x, 206, { ...COLUMN, color: C.cyan }, prog(lt, 2.5, 3.0, EASE.out));
  const frame = prog(lt, 2.45, 3.1, EASE.inOut);
  fillRoundRect(ctx, x, y, w, h, 16, alpha(C.cyan, 0.03 * frame));
  strokeRoundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 16, frame, 'rgba(79, 251, 223, 0.3)');

  const cx = x + 424;
  const cy = y + 214;

  // faint map under the marker
  const map = prog(lt, 2.6, 3.3, EASE.inOut);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 16);
  ctx.clip();
  ctx.globalAlpha *= map;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(x - 10, cy + 96);
  ctx.lineTo(x + w + 10, cy - 64);
  ctx.moveTo(cx - 170, y - 10);
  ctx.lineTo(cx - 60, y + h + 10);
  ctx.stroke();
  ring(ctx, cx - 250, cy - 104, 34, 'rgba(255, 255, 255, 0.12)', 1.25);
  ring(ctx, cx + 212, cy + 96, 28, 'rgba(255, 255, 255, 0.12)', 1.25);
  ctx.restore();

  // auto-framing: viewfinder brackets glide from the full view to the incident cluster
  const fr = prog(lt, 3.6, 4.9, EASE.inOut);
  const from = { x: x + 22, y: y + 22, w: w - 44, h: h - 44 };
  const to = { x: cx - 330, y: cy - 152, w: 560, h: 236 };
  ctx.save();
  ctx.globalAlpha *= prog(lt, 3.45, 3.85, EASE.out);
  glow(ctx, 'rgba(79, 251, 223, 0.55)', 10);
  brackets(ctx, lerp(from.x, to.x, fr), lerp(from.y, to.y, fr), lerp(from.w, to.w, fr), lerp(from.h, to.h, fr), 26, C.cyan, 2);
  ctx.restore();

  // the cyan ring: two pulses expand outward, then the selection ring settles
  ctx.save();
  glow(ctx, 'rgba(79, 251, 223, 0.7)', 12);
  for (const [t0, t1] of [
    [3.0, 4.25],
    [3.3, 4.55],
  ]) {
    const p = prog(lt, t0, t1, EASE.out);
    if (p > 0 && p < 1) ring(ctx, cx, cy, 22 + 170 * p, alpha(C.cyan, 0.9 * Math.pow(1 - p, 1.3)), 2.4 - 1.4 * p);
  }
  ctx.restore();

  const marker = prog(lt, 2.9, 3.35, EASE.snap);
  if (marker > 0) {
    nullLayer(ctx, pivot(cx, cy, { scale: marker, opacity: clamp(marker * 1.6) }), () => {
      disc(ctx, cx, cy, 15, '#12151C');
      ring(ctx, cx, cy, 15, 'rgba(255, 255, 255, 0.75)', 1.5);
      ctx.save();
      glow(ctx, 'rgba(79, 251, 223, 0.9)', 10);
      disc(ctx, cx, cy, 4.5, C.cyan);
      ctx.restore();
    });
  }
  const sel = prog(lt, 3.15, 3.55, EASE.snap);
  if (sel > 0) {
    nullLayer(ctx, pivot(cx, cy, { scale: lerp(1.6, 1, clamp(sel)), opacity: clamp(sel) }), () => {
      ctx.save();
      glow(ctx, 'rgba(79, 251, 223, 0.9)', 12);
      ring(ctx, cx, cy, 22, C.cyan, 2.4);
      ctx.restore();
    });
  }

  // labels arrive piled up (as before), then slide apart with leader lines
  const labelsIn = prog(lt, 3.4, 3.7, EASE.out);
  const L = COPY.enhancements.labels;
  const PILLS = [
    { label: L.incident, kind: 'outline' as const, from: [cx + 6, cy - 44], to: [cx + 4, cy - 116], delay: 0 },
    { label: L.asset, kind: 'outline' as const, from: [cx - 14, cy - 58], to: [cx - 220, cy - 60], delay: 0.08 },
    { label: L.sensor, kind: 'cyan' as const, from: [cx + 28, cy - 30], to: [cx + 120, cy + 2], delay: 0.16 },
  ];
  for (const p of PILLS) {
    const k = prog(lt, 3.75 + p.delay, 4.9 + p.delay, EASE.inOut);
    const px = lerp(p.from[0], p.to[0], k);
    const py = lerp(p.from[1], p.to[1], k);
    const d = Math.hypot(px - cx, py - cy);
    if (k > 0 && d > 30) {
      const ux = (px - cx) / d;
      const uy = (py - cy) / d;
      line(ctx, cx + ux * 26, cy + uy * 26, px, py, 1, alpha(p.kind === 'cyan' ? C.cyan : C.white, 0.5 * k * labelsIn), 1.25);
    }
    pill(ctx, px, py, p.label, p.kind, labelsIn);
  }

  // bullets — parented to the master null
  nullLayer(ctx, masterNull(t), () => {
    const rl = prog(lt, 3.25, 3.75, EASE.out);
    textLayer(ctx, COPY.enhancements.ringLabel, cx, cy + 66 + (1 - rl) * 8, { family: 'mono', size: 14, weight: 500, color: C.cyan, align: 'center', tracking: 0.04, glow: 10, glowColor: 'rgba(79, 251, 223, 0.5)' }, rl);
    const cap = prog(lt, 4.6, 5.2, EASE.out);
    check(ctx, x + 2, 632 + (1 - cap) * 12, 20, C.cyan, prog(lt, 4.75, 5.15, EASE.inOut));
    textLayer(ctx, COPY.enhancements.afterCaption, x + 36, 650 + (1 - cap) * 12, CAPTION, cap);
  });
}

// ------------------------------------------------------------------------------------------ graph

const SOURCES: [string, number][] = [
  ['RAD-S17', 0.62],
  ['RAD-S18', 0.32],
  ['Wind model', 0.4],
  ['UGV-01 thermal', 0.55],
  ['UGV-01 dosimeter', 0.42],
];

function graphPanel(ctx: CanvasRenderingContext2D, t: number, lt: number) {
  // the panel is on screen from the start in its old state (letterboxed, scrolling, dimmed) and
  // comes forward when its fix plays
  const pin = prog(lt, 0.5, 1.15, EASE.out);
  if (pin <= 0) return;
  const focus = lerp(0.42, 1, prog(lt, 5.3, 5.9, EASE.inOut));
  const { x, y, w, h } = PANEL;
  nullLayer(ctx, { y: (1 - pin) * 18, opacity: pin }, () => {
    fillRoundRect(ctx, x, y, w, h, 16, C.card);
    strokeRoundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 16, 1, 'rgba(255, 255, 255, 0.11)');
    textLayer(ctx, COPY.enhancements.graphLabel, x + 32, y + 38, { family: 'mono', size: 13, weight: 500, color: C.text3, tracking: 0.18 });

    // the graph, laid out as a function of fill f (0 = letterboxed and scrolling, 1 = full width)
    const f = prog(lt, 5.8, 7.3, EASE.inOut);
    ctx.save();
    ctx.globalAlpha *= focus;
    const ax = x + 32;
    const ay = y + 96;
    const aw = w - 64;
    const ah = 214;
    const gw = lerp(0.4, 1, f) * aw;
    const x0 = ax + (aw - gw) / 2;
    const step = lerp(58, 41, f);
    const top = ay + 10;
    const nodeW = 216;
    const nodeH = 30;
    const fx = x0 + gw * 0.6;
    const fy = top + 2 * step + nodeH / 2;
    const obsW = 184;
    const obsH = 54;
    const ox = x0 + gw - obsW;

    ctx.save();
    ctx.beginPath();
    ctx.rect(ax - 4, ay, aw + 8, ah);
    ctx.clip();
    SOURCES.forEach(([, weight], i) => {
      const sy = top + i * step + nodeH / 2;
      const sx = x0 + nodeW;
      const mx = (sx + fx - 30) / 2;
      ctx.strokeStyle = alpha(C.cyan, 0.2 + weight * 0.55);
      ctx.lineWidth = 1 + weight * 4.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(mx, sy, mx, fy, fx - 30, fy);
      ctx.stroke();
    });
    // fusion → observation
    ctx.save();
    glow(ctx, 'rgba(79, 251, 223, 0.5)', 8);
    line(ctx, fx + 30, fy, ox - 8, fy, 1, C.cyan, 3.4);
    ctx.fillStyle = C.cyan;
    ctx.beginPath();
    ctx.moveTo(ox - 2, fy);
    ctx.lineTo(ox - 14, fy - 7);
    ctx.lineTo(ox - 14, fy + 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    SOURCES.forEach(([name, weight], i) => {
      const ny = top + i * step;
      fillRoundRect(ctx, x0, ny, nodeW, nodeH, 6, '#141821');
      strokeRoundRect(ctx, x0 + 0.5, ny + 0.5, nodeW - 1, nodeH - 1, 6, 1, 'rgba(255, 255, 255, 0.16)');
      textLayer(ctx, name, x0 + 12, ny + 20, { family: 'mono', size: 13.5, weight: 500, color: C.white });
      textLayer(ctx, `${Math.round(weight * 100)}%`, x0 + nodeW - 12, ny + 20, { family: 'mono', size: 13, color: C.text3, align: 'right' });
    });
    disc(ctx, fx, fy, 30, '#112022');
    ctx.save();
    glow(ctx, 'rgba(79, 251, 223, 0.6)', 12);
    ring(ctx, fx, fy, 30, C.cyan, 1.6);
    ctx.restore();
    textLayer(ctx, 'FUSION', fx, fy - 2, { family: 'sans', size: 11, weight: 700, color: C.white, align: 'center', tracking: 0.08 });
    textLayer(ctx, '90%', fx, fy + 13, { family: 'mono', size: 12, color: C.text2, align: 'center' });
    fillRoundRect(ctx, ox, fy - obsH / 2, obsW, obsH, 8, '#161A23');
    strokeRoundRect(ctx, ox + 0.5, fy - obsH / 2 + 0.5, obsW - 1, obsH - 1, 8, 1, 'rgba(255, 255, 255, 0.4)');
    textLayer(ctx, 'OBSERVATION', ox + obsW / 2, fy - 3, { family: 'sans', size: 11, weight: 700, color: C.white, align: 'center', tracking: 0.08 });
    textLayer(ctx, 'OBS-028', ox + obsW / 2, fy + 14, { family: 'mono', size: 12, color: C.text2, align: 'center' });
    ctx.restore();

    // scrollbar: needed while the graph is letterboxed, gone once it fits
    const sb = 1 - prog(lt, 5.8, 6.6, EASE.inOut);
    if (sb > 0) {
      const content = 10 + 4 * step + nodeH + 12;
      const thumb = Math.min(1, ah / content) * (ah - 8);
      fillRoundRect(ctx, x + w - 18, ay + 4, 4, ah - 8, 2, `rgba(255, 255, 255, ${0.06 * sb})`);
      fillRoundRect(ctx, x + w - 18, ay + 4, 4, thumb, 2, `rgba(255, 255, 255, ${0.4 * sb})`);
    }

    ctx.restore();

    // 100 % width dimension line
    const dim = prog(lt, 6.95, 7.5, EASE.inOut);
    if (dim > 0) {
      const dy = y + h - 12;
      const mid = ax + aw / 2;
      const label = COPY.enhancements.fullWidth;
      const LS: TextStyle = { family: 'mono', size: 12, weight: 500, color: C.cyan, align: 'center', tracking: 0.06 };
      const gap = measure(ctx, label, LS) / 2 + 12;
      ctx.save();
      ctx.globalAlpha *= dim;
      line(ctx, mid - gap, dy, ax, dy, dim, alpha(C.cyan, 0.7), 1.25);
      line(ctx, mid + gap, dy, ax + aw, dy, dim, alpha(C.cyan, 0.7), 1.25);
      line(ctx, ax, dy - 5, ax, dy + 5, dim, alpha(C.cyan, 0.7), 1.25);
      line(ctx, ax + aw, dy - 5, ax + aw, dy + 5, dim, alpha(C.cyan, 0.7), 1.25);
      ctx.restore();
      textLayer(ctx, label, mid, dy + 4, LS, dim);
    }

    // caption (bullet) — parented to the master null
    nullLayer(ctx, masterNull(t), () => {
      const cap = prog(lt, 5.6, 6.2, EASE.out);
      check(ctx, x + 32, y + 56, 20, C.cyan, prog(lt, 7.15, 7.55, EASE.inOut));
      const cx = x + 32 + 34 * prog(lt, 7.0, 7.45, EASE.inOut);
      textLayer(ctx, COPY.enhancements.graphCaption, cx, y + 74, CAPTION, cap);
    });
  });
}

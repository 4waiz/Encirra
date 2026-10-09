// Scene 3 (0:13–0:20): WebGL & optimization metrics.
// A giant comparison snaps in, a cyan wipe transforms it into the optimized figure (turning mint),
// then a status badge types out the WebGL result. Badge and footnote are parented to the master null.
import { C } from '../theme';
import { COPY } from '../copy';
import { masterNull } from '../controller';
import { EASE } from '../engine/ease';
import { alpha, clamp, lerp, mix, prog } from '../engine/anim';
import { measure, nullLayer, pivot, textLayer, type TextStyle } from '../engine/layers';
import { disc, fillRoundRect, glow, pill, pillWidth, strokeRoundRect } from '../engine/draw';

const START = 13;
const BASELINE = 512;
const MAX_WIDTH = 1420;
/** width of the cross-dissolve band trailing the wipe bar, and the strips it is drawn in */
const FEATHER = 150;
const STRIPS = 10;

export function sceneThree(ctx: CanvasRenderingContext2D, t: number) {
  if (t < 12.95) return;
  const lt = t - START;
  const enter = prog(t, 12.95, 13.3, EASE.out);
  nullLayer(ctx, { opacity: enter }, () => {
    comparison(ctx, lt);
    nullLayer(ctx, masterNull(t), () => {
      badge(ctx, lt);
      footnote(ctx, lt);
    });
  });
}

function bigStyle(ctx: CanvasRenderingContext2D): TextStyle {
  // giant type, sized so the longer of the two lines fits the frame comfortably
  const base: TextStyle = { family: 'sans', size: 112, weight: 700, tracking: -0.028, color: C.white, align: 'center' };
  const widest = Math.max(measure(ctx, COPY.webgl.before, base), measure(ctx, COPY.webgl.after, base));
  return widest > MAX_WIDTH ? { ...base, size: Math.floor((base.size * MAX_WIDTH) / widest) } : base;
}

function comparison(ctx: CanvasRenderingContext2D, lt: number) {
  const BIG = bigStyle(ctx);
  const wOld = measure(ctx, COPY.webgl.before, BIG);
  const wNew = measure(ctx, COPY.webgl.after, BIG);
  const half = Math.max(wOld, wNew) / 2 + 44;
  const capTop = BASELINE - BIG.size * 0.78;

  // quick snap ease-out: scales up from 78 % with a hair of overshoot
  const snap = prog(lt, 0.08, 0.6, EASE.snap);
  const appear = prog(lt, 0.08, 0.3, EASE.out);
  // the wipe sweeps left → right; left of the bar is the optimized line
  const wipe = prog(lt, 1.5, 2.35, EASE.inOut);
  const barX = 960 - half + 2 * half * wipe;
  const green = prog(lt, 2.2, 3.2, EASE.inOut);

  nullLayer(ctx, pivot(960, BASELINE - BIG.size * 0.35, { scale: lerp(0.78, 1, snap), opacity: appear }), () => {
    // feathered wipe: right of the bar is the old line, left of the band the new one, and across the
    // band trailing the bar the two cross-dissolve in narrow strips
    const after: TextStyle = { ...BIG, color: mix(C.white, C.mint, green), glow: 28 * green, glowColor: 'rgba(0, 230, 118, 0.42)' };
    const band = wipe > 0 && wipe < 1 ? FEATHER : 0;
    const strip = (x0: number, x1: number, draw: () => void) => {
      if (x1 <= x0) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, capTop - 60, x1 - x0, BIG.size + 120);
      ctx.clip();
      draw();
      ctx.restore();
    };
    if (wipe < 1) strip(barX, 2400, () => textLayer(ctx, COPY.webgl.before, 960, BASELINE, BIG));
    if (wipe > 0) strip(-400, barX - band, () => textLayer(ctx, COPY.webgl.after, 960, BASELINE, after));
    for (let i = 0; i < STRIPS && band > 0; i++) {
      const x0 = barX - band + (i * band) / STRIPS;
      const k = (i + 0.5) / STRIPS; // 0 at the trailing edge → 1 at the bar
      strip(x0, x0 + band / STRIPS + 0.5, () => {
        textLayer(ctx, COPY.webgl.before, 960, BASELINE, BIG, k * k);
        textLayer(ctx, COPY.webgl.after, 960, BASELINE, after, 1 - k);
      });
    }
    if (wipe > 0 && wipe < 1) {
      // the wipe bar with a fading cyan trail
      const top = capTop - 26;
      const height = BIG.size * 1.08 + 52;
      const trail = ctx.createLinearGradient(barX - 200, 0, barX, 0);
      trail.addColorStop(0, alpha(C.cyan, 0));
      trail.addColorStop(1, alpha(C.cyan, 0.16));
      ctx.fillStyle = trail;
      ctx.fillRect(barX - 200, top, 200, height);
      ctx.save();
      glow(ctx, 'rgba(79, 251, 223, 0.95)', 22);
      ctx.fillStyle = C.cyan;
      ctx.fillRect(barX - 2, top, 4, height);
      ctx.restore();
    }
  });

  // delta chip, top-right of the optimized figure
  const chip = prog(lt, 3.05, 3.5, EASE.snap);
  if (chip > 0) {
    const cw = pillWidth(ctx, COPY.webgl.delta, 22);
    pill(ctx, 960 + wNew / 2 + 20 + cw / 2, capTop - 4, COPY.webgl.delta, 'mint', chip, 1, 22);
  }
}

/** Status badge: the pill grows to the right as the line types out; the "0" turns mint once typed. */
function badge(ctx: CanvasRenderingContext2D, lt: number) {
  const show = prog(lt, 3.35, 3.75, EASE.out);
  if (show <= 0) return;
  const s = COPY.webgl.badge;
  const n = s.length;
  const st: TextStyle = { family: 'mono', size: 28, weight: 500, color: C.white };
  const typed = prog(lt, 3.75, 5.3, EASE.soft) * n;
  const k = Math.min(n, Math.floor(typed + 1e-6));
  const frac = k >= n ? 0 : typed - k;
  const w0 = measure(ctx, s.slice(0, k), st);
  const w1 = measure(ctx, s.slice(0, Math.min(n, k + 1)), st);
  const tw = lerp(w0, w1, frac);
  const full = measure(ctx, s, st);
  const padL = 66;
  const padR = 40;
  const h = 70;
  const cy = 668;
  const total = padL + full + 22 + padR;
  const left = 960 - total / 2;
  const width = padL + tw + 22 + padR;

  nullLayer(ctx, pivot(left, cy, { scaleY: lerp(0.6, 1, show), opacity: show }), () => {
    fillRoundRect(ctx, left, cy - h / 2, width, h, h / 2, 'rgba(79, 251, 223, 0.055)');
    ctx.save();
    glow(ctx, 'rgba(79, 251, 223, 0.35)', 14);
    strokeRoundRect(ctx, left + 0.75, cy - h / 2 + 0.75, width - 1.5, h - 1.5, h / 2, 1, 'rgba(79, 251, 223, 0.6)', 1.5);
    ctx.restore();

    // status dot with a slow breathing glow
    const breathe = 0.5 - 0.5 * Math.cos(lt * Math.PI * 1.6);
    ctx.save();
    glow(ctx, 'rgba(0, 230, 118, 0.9)', 8 + 10 * breathe);
    disc(ctx, left + 34, cy, 7.5, C.mint);
    ctx.restore();

    // typed text: settled characters, the next one fading in, the "0" shifting to mint
    const tx = left + padL;
    const by = cy + 10;
    const zero = s.indexOf('0');
    const z = prog(lt, 5.3, 5.8, EASE.inOut);
    if (zero >= 0 && k > zero) {
      textLayer(ctx, s.slice(0, zero), tx, by, st);
      const zx = tx + measure(ctx, s.slice(0, zero + 1), st) - measure(ctx, '0', st);
      textLayer(ctx, '0', zx, by, { ...st, color: mix(C.white, C.mint, z), glow: 14 * z, glowColor: 'rgba(0, 230, 118, 0.6)' });
      textLayer(ctx, s.slice(zero + 1, k), tx + measure(ctx, s.slice(0, zero + 1), st) + st.size * (st.tracking ?? 0), by, st);
    } else textLayer(ctx, s.slice(0, k), tx, by, st);
    if (k < n) textLayer(ctx, s[k], tx + w0, by, st, frac);

    // block cursor: solid while typing, then blinks softly and fades out
    const done = prog(lt, 5.3, 5.35, EASE.out);
    const blink = done > 0 ? 0.5 + 0.5 * Math.cos((lt - 5.3) * Math.PI * 3) : 1;
    const fade = 1 - prog(lt, 6.1, 6.5, EASE.inOut);
    const ca = clamp(blink * fade);
    if (ca > 0.01) {
      ctx.save();
      ctx.globalAlpha *= ca;
      glow(ctx, 'rgba(79, 251, 223, 0.8)', 8);
      ctx.fillStyle = C.cyan;
      ctx.fillRect(tx + tw + 6, cy - 16, 14, 32);
      ctx.restore();
    }
  });
}

function footnote(ctx: CanvasRenderingContext2D, lt: number) {
  const k = prog(lt, 5.45, 6.0, EASE.out);
  textLayer(ctx, COPY.webgl.footnote, 960, 756 + (1 - k) * 10, { family: 'mono', size: 15, color: C.text3, align: 'center', tracking: 0.04 }, k);
}

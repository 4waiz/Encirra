// The comp, back to front: backdrop, title card, the app window (footage, spotlights, callouts, cursor),
// captions, outro lockup, vignette, closing fade. Every layer is a pure function of time.
import { C, W, H, WINDOW } from '../theme';
import { EASE } from '../engine/ease';
import { prog } from '../engine/anim';
import { nullLayer } from '../engine/layers';
import { DURATION, OUTRO, SEGMENTS, TITLE, XF, type Segment } from '../timeline';
import { backdrop, drawVignette, outroCard, titleCard, windowMotion } from './cards';
import { cameraAt, drawFootage, drawOperator, windowFrame } from './screen';
import { drawCallouts, drawSpotlights } from './callouts';
import { captionLift, captions, speedBadge } from './captions';

/** Segments on screen at `t`, each with its dissolve opacity (outgoing first). */
export function activeSegments(t: number): [Segment, number][] {
  const out: [Segment, number][] = [];
  SEGMENTS.forEach((s, i) => {
    const first = i === 0;
    const last = i === SEGMENTS.length - 1;
    const from = first ? -Infinity : s.start - XF / 2;
    const to = last ? Infinity : s.end + XF / 2;
    if (t < from || t >= to) return;
    const a = first ? 1 : prog(t, s.start - XF / 2, s.start + XF / 2, EASE.inOut);
    out.push([s, a]);
  });
  return out;
}

/** Clip time for a segment at film time t (held on the first/last frame outside the segment). */
export const clipTime = (s: Segment, t: number) => s.clipIn + Math.max(0, t - s.start);

export function renderAll(ctx: CanvasRenderingContext2D, t: number) {
  backdrop(ctx, t);
  titleCard(ctx, t);

  const m = windowMotion(t);
  if (m.opacity > 0.001) {
    const cx = WINDOW.x + WINDOW.w / 2;
    const cy = WINDOW.y + WINDOW.h / 2;
    nullLayer(ctx, { x: cx + m.dx, y: cy + m.dy, anchorX: cx, anchorY: cy, scale: m.scale, opacity: m.opacity }, () => {
      const segs = activeSegments(t);
      windowFrame(ctx, () => {
        for (const [s, a] of segs) {
          const lt = Math.max(0, t - s.start);
          const v = cameraAt(s, lt);
          drawFootage(ctx, s.id, clipTime(s, t), v, a);
          ctx.save();
          ctx.globalAlpha *= a;
          drawSpotlights(ctx, s, lt, v);
          ctx.restore();
        }
        // overlays (cursor, callouts, badges) belong to one shot at a time: the outgoing shot's fade out
        // as the incoming shot dissolves in
        const top = segs.length ? segs[segs.length - 1][1] : 1;
        segs.forEach(([s, a], i) => {
          const lt = Math.max(0, t - s.start);
          const v = cameraAt(s, lt);
          const own = i === segs.length - 1 ? a : 1 - top;
          const live = own * (1 - prog(t, OUTRO, OUTRO + 0.5, EASE.in));
          drawCallouts(ctx, s, lt, v, live);
          drawOperator(ctx, s, clipTime(s, t), v, live * prog(t, s.start - 0.1, s.start + 0.35, EASE.out));
          speedBadge(ctx, s, t, live);
        });
      });
    });
  }

  captions(ctx, t, prog(t, TITLE - 0.35, TITLE + 0.35, EASE.out) * captionLift(t, OUTRO));
  outroCard(ctx, t);
  drawVignette(ctx);

  const close = prog(t, DURATION - 0.7, DURATION - 0.05, EASE.inOut);
  if (close > 0) {
    ctx.save();
    ctx.globalAlpha = close;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

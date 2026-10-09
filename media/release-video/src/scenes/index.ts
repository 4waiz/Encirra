// The comp: layer order, back to front. Every layer is a pure function of time.
import { W, H, C } from '../theme';
import { DURATION } from '../timeline';
import { EASE } from '../engine/ease';
import { prog } from '../engine/anim';
import { backdrop, drawVignette } from './backdrop';
import { chrome } from './chrome';
import { sceneOne } from './s1-performance';
import { sceneTwo } from './s2-enhancements';
import { sceneThree } from './s3-webgl';

export function renderAll(ctx: CanvasRenderingContext2D, t: number) {
  backdrop(ctx, t);
  sceneOne(ctx, t);
  sceneTwo(ctx, t);
  sceneThree(ctx, t);
  chrome(ctx, t);
  drawVignette(ctx);
  // close: everything eases down to the background over the last half second
  const close = prog(t, DURATION - 0.55, DURATION - 0.05, EASE.inOut);
  if (close > 0) {
    ctx.save();
    ctx.globalAlpha = close;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

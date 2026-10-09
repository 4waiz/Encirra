// Frame renderer. Preview draws one sample per frame; the offline render averages several sub-frames
// across the shutter (motion blur) and dithers before quantising, so dark gradients don't band.
import { W, H, RENDER } from '../theme';
import { DURATION } from '../timeline';
import { renderAll } from '../scenes';
import { mulberry32 } from './random';

const DITHER_SIZE = 256;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly scale: number;
  private ctx: CanvasRenderingContext2D;
  private sub: CanvasRenderingContext2D | null = null;
  private acc: Uint16Array | null = null;
  private dither: Float32Array | null = null;

  constructor(canvas: HTMLCanvasElement, scale = 1) {
    this.scale = scale;
    RENDER.scale = scale;
    canvas.width = W * scale;
    canvas.height = H * scale;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
  }

  private draw(ctx: CanvasRenderingContext2D, t: number) {
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    renderAll(ctx, t);
  }

  /** Sub-frame times for a frame at `t` (centred on t, spread across `shutter` of a frame). */
  static sampleTimes(t: number, samples: number, shutter: number, fps: number) {
    const n = Math.max(1, Math.min(32, Math.round(samples)));
    if (n === 1) return [t];
    return Array.from({ length: n }, (_, i) => Math.min(DURATION - 1e-4, Math.max(0, t + (shutter / fps) * ((i + 0.5) / n - 0.5))));
  }

  /**
   * Draws the frame at time `t`. With `samples` > 1, sub-frames spread across `shutter` (fraction of a
   * frame, 0.5 = 180°) are averaged for natural motion blur, then dithered back to 8 bits.
   */
  frame(t: number, samples = 1, shutter = 0.5, fps = 60) {
    const times = Renderer.sampleTimes(t, samples, shutter, fps);
    if (times.length === 1) {
      this.draw(this.ctx, t);
      return;
    }
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!this.sub) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      this.sub = c.getContext('2d', { alpha: false, willReadFrequently: true }) as CanvasRenderingContext2D;
    }
    const acc = this.acc ?? (this.acc = new Uint16Array(w * h * 4));
    acc.fill(0);
    for (const ts of times) {
      this.draw(this.sub, ts);
      const d = this.sub.getImageData(0, 0, w, h).data;
      for (let k = 0; k < d.length; k++) acc[k] += d[k];
    }
    const n = times.length;
    const dither = this.ditherTile();
    const rnd = mulberry32(Math.round(t * fps) * 7919 + 17);
    const ox = Math.floor(rnd() * DITHER_SIZE);
    const oy = Math.floor(rnd() * DITHER_SIZE);
    const img = this.ctx.createImageData(w, h);
    const o = img.data;
    const inv = 1 / n;
    for (let y = 0; y < h; y++) {
      const row = ((y + oy) & (DITHER_SIZE - 1)) * DITHER_SIZE;
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4;
        const dz = dither[row + ((x + ox) & (DITHER_SIZE - 1))];
        o[k] = acc[k] * inv + dz;
        o[k + 1] = acc[k + 1] * inv + dz;
        o[k + 2] = acc[k + 2] * inv + dz;
        o[k + 3] = 255;
      }
    }
    this.ctx.putImageData(img, 0, 0);
  }

  /** Triangular-PDF dither in [-1, 1) levels (zero mean), seeded. */
  private ditherTile() {
    if (this.dither) return this.dither;
    const r = mulberry32(90210);
    const d = new Float32Array(DITHER_SIZE * DITHER_SIZE);
    for (let i = 0; i < d.length; i++) d[i] = r() - r();
    this.dither = d;
    return d;
  }
}

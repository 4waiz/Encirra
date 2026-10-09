// Layers, the code way: a null layer is an invisible transform its children inherit, and a text layer
// sets a live string in vector type at draw time.
import { FONT, RENDER } from '../theme';

/** After Effects-style transform: the anchor point (layer space) lands on the position. */
export interface Transform {
  x?: number;
  y?: number;
  anchorX?: number;
  anchorY?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  opacity?: number;
}

/** Draws `children` parented to a null: they inherit its position, anchor, scale, rotation and opacity. */
export function nullLayer(ctx: CanvasRenderingContext2D, tf: Transform, children: () => void) {
  const opacity = tf.opacity ?? 1;
  if (opacity <= 0.001) return;
  ctx.save();
  ctx.translate(tf.x ?? 0, tf.y ?? 0);
  if (tf.rotation) ctx.rotate(tf.rotation);
  const s = tf.scale ?? 1;
  const sx = (tf.scaleX ?? 1) * s;
  const sy = (tf.scaleY ?? 1) * s;
  if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
  ctx.translate(-(tf.anchorX ?? 0), -(tf.anchorY ?? 0));
  ctx.globalAlpha *= opacity;
  children();
  ctx.restore();
}

/** Scales a null about a pivot without moving it (position = anchor = pivot). */
export const pivot = (x: number, y: number, extra: Transform = {}): Transform => ({ x, y, anchorX: x, anchorY: y, ...extra });

export interface TextStyle {
  family?: 'sans' | 'mono';
  size: number;
  weight?: number;
  color?: string;
  /** letter spacing in em */
  tracking?: number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  /** glow radius in px (drawn as a soft shadow in the text colour unless glowColor is set) */
  glow?: number;
  glowColor?: string;
}

function applyText(ctx: CanvasRenderingContext2D, st: TextStyle) {
  ctx.font = `${st.weight ?? 400} ${st.size}px ${st.family === 'mono' ? FONT.mono : FONT.sans}`;
  ctx.letterSpacing = `${(st.tracking ?? 0) * st.size}px`;
  ctx.textAlign = st.align ?? 'left';
  ctx.textBaseline = st.baseline ?? 'alphabetic';
}

/** Advance width of a string in a style (trailing letter spacing excluded). */
export function measure(ctx: CanvasRenderingContext2D, s: string, st: TextStyle) {
  if (!s) return 0;
  ctx.save();
  applyText(ctx, st);
  const w = ctx.measureText(s).width - (st.tracking ?? 0) * st.size;
  ctx.restore();
  return w;
}

/** A live text layer. */
export function textLayer(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, st: TextStyle, opacity = 1) {
  if (opacity <= 0.001 || !s) return;
  ctx.save();
  applyText(ctx, st);
  ctx.globalAlpha *= Math.min(1, opacity);
  ctx.fillStyle = st.color ?? '#FFFFFF';
  if (st.glow) {
    ctx.shadowColor = st.glowColor ?? st.color ?? '#FFFFFF';
    ctx.shadowBlur = st.glow * RENDER.scale;
  }
  ctx.fillText(s, x, y);
  ctx.restore();
}

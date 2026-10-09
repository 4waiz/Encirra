// Keyframe helpers. A scene asks "how far through this span are we at time t?" and gets an eased
// answer, so every property is a pure function of time (scrubbing and rendering always agree).
import { EASE, type Ease } from './ease';

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Eased progress of `t` through the keyframe span [t0, t1]: 0 before it, 1 after it. */
export function prog(t: number, t0: number, t1: number, ease: Ease = EASE.inOut) {
  return ease(clamp((t - t0) / (t1 - t0)));
}

/** Value between two keyframes. */
export function tween(t: number, t0: number, t1: number, from: number, to: number, ease: Ease = EASE.inOut) {
  return lerp(from, to, prog(t, t0, t1, ease));
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Blend two #rrggbb colours. */
export function mix(a: string, b: string, k: number) {
  const A = rgb(a);
  const B = rgb(b);
  const c = A.map((v, i) => Math.round(lerp(v, B[i], clamp(k))));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** #rrggbb with an alpha, for strokes and glows. */
export function alpha(hex: string, a: number) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(a)})`;
}

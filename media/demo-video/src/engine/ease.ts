// Cubic Bézier easing: the same model as CSS cubic-bezier(). Every animated property in the video
// goes through one of these curves; nothing moves on a linear ramp.

export type Ease = (x: number) => number;

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solveT = (x: number) => {
    // Newton–Raphson first, bisection as the fallback (same strategy as browser engines)
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-7) return t;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-7) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 48; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : sampleY(solveT(x)));
}

export const EASE = {
  /** standard move: slow in, slow out */
  inOut: cubicBezier(0.65, 0, 0.35, 1),
  /** long, gentle travel (layout reflows, wipes) */
  soft: cubicBezier(0.45, 0, 0.25, 1),
  /** entrances: quick start, long settle */
  out: cubicBezier(0.16, 1, 0.3, 1),
  /** exits: gentle acceleration away */
  in: cubicBezier(0.55, 0, 0.75, 0.2),
  /** quick snap with a hair of overshoot */
  snap: cubicBezier(0.18, 1.3, 0.32, 1),
};

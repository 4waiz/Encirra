// Master null controller. Every bullet / readout text item in all three scenes is parented to this
// null, so one edit here moves or rescales all of them together. Scale pivots on the frame centre.
import { EASE } from './engine/ease';
import { lerp, prog } from './engine/anim';
import { pivot, type Transform } from './engine/layers';
import { W, H } from './theme';

export interface NullKey {
  /** seconds */
  t: number;
  /** offset from the authored layout, px */
  x: number;
  y: number;
  scale?: number;
  opacity?: number;
}

/** Resting offset of the master null. */
export const MASTER_NULL = { x: 0, y: 0, scale: 1, opacity: 1 };

/**
 * Optional keyframes for adjusting all bullet text later on the timeline. Values hold before the
 * first key and after the last; between keys they ease in and out. Example:
 *   [{ t: 13.0, x: 0, y: 0 }, { t: 13.6, x: 0, y: -24 }]   nudges every bullet up by 24 px from 13.6 s
 */
export const MASTER_KEYS: NullKey[] = [];

export function masterNull(t: number): Transform {
  let { x, y, scale, opacity } = MASTER_NULL;
  if (MASTER_KEYS.length) {
    const keys = [...MASTER_KEYS].sort((a, b) => a.t - b.t);
    let a = keys[0];
    let b = keys[0];
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].t <= t) a = keys[i];
      if (keys[i].t >= t) {
        b = keys[i];
        break;
      }
      b = keys[i];
    }
    const k = a === b ? 1 : prog(t, a.t, b.t, EASE.inOut);
    x += lerp(a.x, b.x, k);
    y += lerp(a.y, b.y, k);
    scale *= lerp(a.scale ?? 1, b.scale ?? 1, k);
    opacity *= lerp(a.opacity ?? 1, b.opacity ?? 1, k);
  }
  return pivot(W / 2, H / 2, { x: W / 2 + x, y: H / 2 + y, scale, opacity });
}

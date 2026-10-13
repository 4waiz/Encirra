/**
 * Per-building presentation state shared by the procedural and kit building layers:
 * one float texel per layout building — R power, G restore tint, B highlight, A emergency.
 * Updated once per frame from `live` (bus states / facility states) and the store selection.
 */
import { useTwin } from '@/state/store';
import { BUILDINGS, N_BLD } from '../data/twin';
import { CODE, isPowered, live } from '../data/live';
import { createStateTexture } from './facadeMaterial';
import { selectionToBuildingIndex } from '../interaction/selection';

export const bldStateTex = createStateTexture(N_BLD);

const anim = {
  power: new Float32Array(N_BLD).fill(1),
  restoreAt: new Float64Array(N_BLD).fill(-1e9),
  wasPowered: new Uint8Array(N_BLD).fill(1),
  highlight: new Float32Array(N_BLD),
};

export function updateBuildingState(t: number, dt: number) {
  const data = bldStateTex.image.data as Float32Array;
  const s = useTwin.getState();
  const hov = selectionToBuildingIndex(s.hovered);
  const sel = selectionToBuildingIndex(s.selected);
  let dirty = false;
  for (let i = 0; i < N_BLD; i++) {
    const b = BUILDINGS[i];
    let target = 1;
    let emergency = 0;
    let powered = true;
    const fac = b.facilityId ? live.facilities.get(b.facilityId) : undefined;
    if (fac && (fac.power === 'backup' || fac.power === 'offline')) {
      powered = false;
      target = fac.power === 'backup' ? 0.42 : 0;
      emergency = 1;
    } else if (b.busIndex >= 0) {
      const code = live.busCode[b.busIndex];
      powered = isPowered(code);
      target = powered ? 1 : 0;
      emergency = powered ? 0 : 1;
      if (code === CODE.restored && !anim.wasPowered[i]) anim.restoreAt[i] = t;
    }
    if (fac && fac.power === 'restored' && !anim.wasPowered[i]) anim.restoreAt[i] = t;
    anim.wasPowered[i] = powered ? 1 : 0;
    const cur = anim.power[i];
    const rate = target > cur ? 0.9 : 3.5; // slow fade-in, fast blackout
    const next = cur + Math.sign(target - cur) * Math.min(Math.abs(target - cur), rate * dt);
    anim.power[i] = next;
    const tint = Math.max(0, 1 - (t - anim.restoreAt[i]) / 3.2);
    const hTarget = i === sel ? 1 : i === hov ? 0.65 : 0;
    anim.highlight[i] += (hTarget - anim.highlight[i]) * Math.min(1, dt * 10);
    const o = i * 4;
    const vals = [next, tint, anim.highlight[i], emergency];
    for (let k = 0; k < 4; k++) {
      if (Math.abs(data[o + k] - vals[k]) > 1e-4) {
        data[o + k] = vals[k];
        dirty = true;
      }
    }
  }
  if (dirty) bldStateTex.needsUpdate = true;
}

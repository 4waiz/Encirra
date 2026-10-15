/**
 * Shared GPU state textures, refreshed once per frame from `live` (see LiveSampler).
 * Every network material samples these instead of holding per-object uniforms, so a single
 * small upload drives buses, cables, ground tint and pipes.
 *
 *  busTex   (N_BUS × 1)   R = dark (lost supply), G = restored flash, B = powered, A = fault pulse
 *  lineTex  (N_LINE × 3)  row0 rgb colour (linear HDR), a intensity
 *                         row1 r phase (m), g flow visibility, b dashed, a fault pulse
 *                         row2 r width scale, g restoring blink
 *  pipeTex  (N_PIPE × 2)  row0 rgb colour, a intensity
 *                         row1 r phase (m), g flow visibility, b closed valve, a speed factor
 */
import { Color, DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import { LINES, N_BUS, N_LINE, N_PIPE, PIPES } from './twin';
import { CODE, live } from './live';
import { LIN } from '../config';

function tex(w: number, h: number) {
  const t = new DataTexture(new Float32Array(w * h * 4), w, h, RGBAFormat, FloatType);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

export const busTex = tex(N_BUS, 1);
export const lineTex = tex(N_LINE, 4);
export const pipeTex = tex(N_PIPE, 2);

const busAnim = {
  dark: new Float32Array(N_BUS),
  powered: new Float32Array(N_BUS).fill(1),
  restoreAt: new Float64Array(N_BUS).fill(-1e9),
  prev: new Uint8Array(N_BUS),
};
const lineAnim = {
  col: Array.from({ length: N_LINE }, (_, i) => (LINES[i].normallyOpen ? LIN.open.clone().multiplyScalar(0.3) : LIN.energized.clone().multiplyScalar(2.2))),
  phase: new Float32Array(N_LINE),
  flow: Float32Array.from(LINES.map((l) => (l.normallyOpen ? 0 : 1))),
  dash: Float32Array.from(LINES.map((l) => (l.normallyOpen ? 1 : 0))),
  width: Float32Array.from(LINES.map((l) => (l.normallyOpen ? 0.45 : 1))),
};
const pipeAnim = {
  col: Array.from({ length: N_PIPE }, () => LIN.water.clone().multiplyScalar(1.6)),
  phase: new Float32Array(N_PIPE),
  flow: Float32Array.from(PIPES.map((p) => (p.initialStatus === 'closed' ? 0 : 1))),
};

const tmp = new Color();
const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * Math.min(1, rate * dt);

export function lineTargetColor(code: number, out: Color): { intensity: number; flow: number; dash: number; width: number; pulse: number } {
  switch (code) {
    case CODE.energized:
      out.copy(LIN.energized);
      return { intensity: 2.7, flow: 1, dash: 0, width: 1, pulse: 0 };
    case CODE.restored:
      out.copy(LIN.restored);
      return { intensity: 3.0, flow: 1, dash: 0, width: 1.05, pulse: 0 };
    case CODE.faulted:
      out.copy(LIN.faulted);
      return { intensity: 3.6, flow: 0, dash: 0, width: 1.3, pulse: 1 };
    case CODE.restoring:
      out.copy(LIN.energized);
      return { intensity: 1.6, flow: 0, dash: 1, width: 0.9, pulse: 0.6 };
    case CODE.isolated:
      out.copy(LIN.isolated);
      return { intensity: 0.32, flow: 0, dash: 0, width: 0.75, pulse: 0 };
    case CODE.deenergized:
      out.copy(LIN.isolated).lerp(LIN.faulted, 0.55);
      return { intensity: 0.55, flow: 0, dash: 0, width: 0.8, pulse: 0 };
    case CODE.open:
    default:
      out.copy(LIN.open);
      return { intensity: 0.38, flow: 0, dash: 1, width: 0.45, pulse: 0 };
  }
}

/** Pressure → colour on distribution mains (cyan healthy → amber low → red critical). */
function pipeTargetColor(i: number, out: Color): number {
  const p = live.pipePressure[i];
  const thr = live.serviceThresholdM || 20;
  if (!live.pipeOpen[i]) {
    out.copy(LIN.faulted);
    return 0.0;
  }
  if (Number.isNaN(p) || PIPES[i].kind !== 'distribution') {
    out.copy(LIN.water);
    return 1;
  }
  if (p >= thr) out.copy(LIN.water);
  else if (p >= thr * 0.5) out.copy(LIN.waterLow).lerp(LIN.water, (p - thr * 0.5) / (thr * 0.5));
  else out.copy(LIN.waterCritical).lerp(LIN.waterLow, Math.max(0, p) / (thr * 0.5));
  return 1;
}

export function updateStateTextures(t: number, dt: number) {
  // ── buses
  const bd = busTex.image.data as Float32Array;
  for (let i = 0; i < N_BUS; i++) {
    const code = live.busCode[i];
    const powered = code === CODE.energized || code === CODE.restored;
    if (code === CODE.restored && busAnim.prev[i] !== CODE.restored) busAnim.restoreAt[i] = t;
    busAnim.prev[i] = code;
    busAnim.dark[i] = approach(busAnim.dark[i], powered ? 0 : 1, powered ? 1.2 : 3, dt);
    busAnim.powered[i] = approach(busAnim.powered[i], powered ? 1 : 0, powered ? 1.2 : 4, dt);
    const o = i * 4;
    bd[o] = busAnim.dark[i];
    bd[o + 1] = Math.max(0, 1 - (t - busAnim.restoreAt[i]) / 4);
    bd[o + 2] = busAnim.powered[i];
    bd[o + 3] = code === CODE.faulted ? 1 : 0;
  }
  busTex.needsUpdate = true;

  // ── lines
  const ld = lineTex.image.data as Float32Array;
  const W = N_LINE * 4;
  for (let i = 0; i < N_LINE; i++) {
    const code = live.lineCode[i];
    const tg = lineTargetColor(code, tmp);
    tmp.multiplyScalar(tg.intensity);
    const c = lineAnim.col[i];
    const k = Math.min(1, dt * 4);
    c.r += (tmp.r - c.r) * k;
    c.g += (tmp.g - c.g) * k;
    c.b += (tmp.b - c.b) * k;
    const flowVisible = tg.flow * (live.lineDir[i] !== 0 ? 1 : 0);
    lineAnim.flow[i] = approach(lineAnim.flow[i], flowVisible, 3, dt);
    lineAnim.dash[i] = approach(lineAnim.dash[i], tg.dash, 4, dt);
    lineAnim.width[i] = approach(lineAnim.width[i], tg.width, 4, dt);
    // animated energy pulses: direction from the sign of the flow, speed ∝ |flow|
    const speed = 14 + 46 * live.lineSpeed[i];
    if (flowVisible > 0) lineAnim.phase[i] = (lineAnim.phase[i] + live.lineDir[i] * speed * dt) % 100000;
    const o = i * 4;
    ld[o] = c.r;
    ld[o + 1] = c.g;
    ld[o + 2] = c.b;
    ld[o + 3] = 1;
    ld[W + o] = lineAnim.phase[i];
    ld[W + o + 1] = lineAnim.flow[i];
    ld[W + o + 2] = lineAnim.dash[i];
    ld[W + o + 3] = tg.pulse;
    ld[2 * W + o] = lineAnim.width[i];
    ld[2 * W + o + 1] = code === CODE.restoring ? 1 : 0;
    ld[2 * W + o + 2] = live.planSwitchLines.has(i) ? 1 : 0;
    ld[2 * W + o + 3] = live.lineDir[i] < 0 ? -1 : 1;
    ld[3 * W + o] = code === CODE.restored ? 1 : 0;
  }
  lineTex.needsUpdate = true;

  // ── pipes
  const pd = pipeTex.image.data as Float32Array;
  const PW = N_PIPE * 4;
  for (let i = 0; i < N_PIPE; i++) {
    const open = live.pipeOpen[i] === 1;
    pipeTargetColor(i, tmp);
    const q = live.pipeFlow[i];
    const v = live.pipeVel[i];
    const hasData = !Number.isNaN(q);
    const moving = open && live.pipeDir[i] !== 0;
    // intensity ∝ flow (relative to the pipe's capacity at ~1.2 m/s)
    const cap = Math.PI * Math.pow(PIPES[i].diameterMM / 2000, 2) * 1.2 * 1000; // L/s
    const rel = hasData ? Math.min(1.4, Math.abs(q) / Math.max(cap, 1)) : 0.55;
    // intensity grows with flow (relative to the pipe capacity); a visible floor keeps low flows legible
    const inten = moving ? 1.25 + 1.9 * Math.sqrt(Math.min(1, rel / 0.5)) : 0.0;
    tmp.multiplyScalar(inten);
    const c = pipeAnim.col[i];
    const k = Math.min(1, dt * 3);
    c.r += (tmp.r - c.r) * k;
    c.g += (tmp.g - c.g) * k;
    c.b += (tmp.b - c.b) * k;
    pipeAnim.flow[i] = approach(pipeAnim.flow[i], moving ? 1 : 0, 2.5, dt);
    const vel = hasData && !Number.isNaN(v) ? Math.abs(v) : 0.6;
    const speed = moving ? 4 + 9 * Math.min(2, vel) : 0;
    pipeAnim.phase[i] = (pipeAnim.phase[i] + live.pipeDir[i] * speed * dt) % 100000;
    const o = i * 4;
    pd[o] = c.r;
    pd[o + 1] = c.g;
    pd[o + 2] = c.b;
    pd[o + 3] = 1;
    pd[PW + o] = pipeAnim.phase[i];
    pd[PW + o + 1] = pipeAnim.flow[i];
    pd[PW + o + 2] = open ? 0 : 1;
    pd[PW + o + 3] = (live.pipeDir[i] < 0 ? -1 : 1) * Math.max(speed, 0.001);
  }
  pipeTex.needsUpdate = true;
}

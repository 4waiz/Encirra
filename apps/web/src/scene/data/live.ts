/**
 * Transient bridge between the zustand store and the render loop.
 *
 * `sampleLive()` runs once per rendered frame (see <LiveSampler/>). It reads the store with
 * getState() (no React subscription → no re-renders), resolves the current simulation Frame
 * and writes typed arrays into the module-level `live` object. Scene components read `live`
 * in their own useFrame callbacks and push values straight into uniforms / textures.
 *
 * When no run is loaded (or a field is missing) every array holds the healthy normal state.
 */
import type { ElementState, FacilityState, Frame, RunResult, StageId } from '@encirra/shared';
import { useTwin } from '@/state/store';
import { LINES, N_BUS, N_LINE, N_PIPE, PIPES, PUMPS, TANKS, JUNCTIONS, NOMINAL_LINE_DIR, NOMINAL_PIPE_DIR } from './twin';

export const STATE_CODE: Record<ElementState, number> = {
  energized: 0,
  faulted: 1,
  isolated: 2,
  deenergized: 3,
  restoring: 4,
  restored: 5,
  open: 6,
};
export const CODE = { energized: 0, faulted: 1, isolated: 2, deenergized: 3, restoring: 4, restored: 5, open: 6 } as const;

export interface LiveState {
  hasRun: boolean;
  run: RunResult | null;
  frame: Frame | null;
  next: Frame | null;
  frameIndex: number;
  frac: number; // fractional part of the playhead (for continuous interpolation)
  stage: StageId | null;
  /** increments whenever the discrete frame (or run) changes */
  version: number;
  // electrical
  busCode: Uint8Array;
  busVm: Float32Array; // NaN = de-energized
  lineCode: Uint8Array;
  lineFlowKW: Float32Array; // signed, NaN when unknown
  lineDir: Float32Array; // −1, 0, +1
  lineSpeed: Float32Array; // 0…1 normalised by the run's max |flow|
  switchClosedByLine: Uint8Array;
  planSwitchLines: Set<number>; // lines whose switch is part of the selected plan
  // water
  pipeFlow: Float32Array; // L/s signed (interpolated)
  pipeVel: Float32Array; // m/s (interpolated)
  pipeOpen: Uint8Array;
  pipeDir: Float32Array;
  pipePressure: Float32Array; // min pressure of the pipe's end junctions (m), NaN when n/a
  junctionPressure: Float32Array;
  pumpOn: Uint8Array;
  pumpFlow: Float32Array;
  tankPct: Float32Array; // interpolated
  tankTrend: Float32Array; // %/frame (signed)
  facilities: Map<string, FacilityState>;
  serviceThresholdM: number;
}

const nominalTankPct = TANKS.map((t) => ((t.initLevelM - t.minLevelM) / (t.maxLevelM - t.minLevelM)) * 100);

export const live: LiveState = {
  hasRun: false,
  run: null,
  frame: null,
  next: null,
  frameIndex: -1,
  frac: 0,
  stage: null,
  version: 0,
  busCode: new Uint8Array(N_BUS),
  busVm: new Float32Array(N_BUS).fill(1),
  lineCode: Uint8Array.from(LINES.map((l) => (l.normallyOpen ? CODE.open : CODE.energized))),
  lineFlowKW: new Float32Array(N_LINE).fill(NaN),
  lineDir: Float32Array.from(NOMINAL_LINE_DIR),
  lineSpeed: Float32Array.from(LINES.map((l) => (l.normallyOpen ? 0 : 0.55))),
  switchClosedByLine: Uint8Array.from(LINES.map((l) => (l.normallyOpen ? 0 : 1))),
  planSwitchLines: new Set(),
  pipeFlow: new Float32Array(N_PIPE).fill(NaN),
  pipeVel: new Float32Array(N_PIPE).fill(NaN),
  pipeOpen: Uint8Array.from(PIPES.map((p) => (p.initialStatus === 'closed' ? 0 : 1))),
  pipeDir: Float32Array.from(NOMINAL_PIPE_DIR),
  pipePressure: new Float32Array(N_PIPE).fill(NaN),
  junctionPressure: new Float32Array(JUNCTIONS.length).fill(NaN),
  pumpOn: new Uint8Array(PUMPS.length).fill(1),
  pumpFlow: new Float32Array(PUMPS.length).fill(NaN),
  tankPct: Float32Array.from(nominalTankPct),
  tankTrend: new Float32Array(TANKS.length),
  facilities: new Map(),
  serviceThresholdM: 20,
};

let lastRun: RunResult | null = null;
let lastIndex = -2;
let lastTopoKey: unknown = null;
let switchLineOf: number[] = LINES.map((l) => l.id);
let maxAbsFlowKW = 1;
const pipeEnds = PIPES.map((p) => [JUNCTIONS.findIndex((j) => j.id === p.from), JUNCTIONS.findIndex((j) => j.id === p.to)]);

function resetHealthy() {
  live.busCode.fill(CODE.energized);
  live.busVm.fill(1);
  for (let i = 0; i < N_LINE; i++) {
    const open = LINES[i].normallyOpen;
    live.lineCode[i] = open ? CODE.open : CODE.energized;
    live.lineFlowKW[i] = NaN;
    live.lineDir[i] = NOMINAL_LINE_DIR[i];
    live.lineSpeed[i] = open ? 0 : 0.55;
    live.switchClosedByLine[i] = open ? 0 : 1;
  }
  live.planSwitchLines = new Set();
  for (let i = 0; i < N_PIPE; i++) {
    live.pipeFlow[i] = NaN;
    live.pipeVel[i] = NaN;
    live.pipeOpen[i] = PIPES[i].initialStatus === 'closed' ? 0 : 1;
    live.pipeDir[i] = NOMINAL_PIPE_DIR[i];
    live.pipePressure[i] = NaN;
  }
  live.junctionPressure.fill(NaN);
  live.pumpOn.fill(1);
  live.pumpFlow.fill(NaN);
  live.tankPct.set(nominalTankPct);
  live.tankTrend.fill(0);
  live.facilities = new Map();
  live.stage = null;
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Read the store and refresh `live`. Cheap when nothing changed. */
export function sampleLive() {
  const s = useTwin.getState();
  const run = s.run;
  const frames = run?.frames ?? null;

  // switch index → line id mapping from the loaded topology (falls back to line order)
  const topo = s.topology;
  if (topo !== lastTopoKey) {
    lastTopoKey = topo;
    switchLineOf = topo?.electrical?.switches?.length ? topo.electrical.switches.map((sw) => sw.lineId) : LINES.map((l) => l.id);
    if (topo?.water?.serviceThresholdM) live.serviceThresholdM = topo.water.serviceThresholdM;
  }

  if (!run || !frames || frames.length === 0) {
    if (lastRun !== null || lastIndex !== -1) {
      lastRun = null;
      lastIndex = -1;
      live.hasRun = false;
      live.run = null;
      live.frame = null;
      live.next = null;
      live.frameIndex = -1;
      resetHealthy();
      live.version++;
    }
    return;
  }

  const ph = Math.max(0, Math.min(frames.length - 1, s.playhead));
  const idx = Math.floor(ph);
  const frac = ph - idx;
  const f = frames[idx];
  const nx = frames[Math.min(frames.length - 1, idx + 1)];
  live.frac = frac;

  if (run !== lastRun) {
    lastRun = run;
    lastIndex = -2;
    // normalisation for flow animation speed
    let m = 1;
    for (const fr of frames) for (const v of fr.power?.lineFlowKW ?? []) if (v != null && Math.abs(v) > m) m = Math.abs(v);
    maxAbsFlowKW = m;
    live.planSwitchLines = new Set((run.plan?.actions ?? []).map((a) => a.lineId));
  }

  if (idx !== lastIndex) {
    lastIndex = idx;
    live.hasRun = true;
    live.run = run;
    live.frame = f;
    live.next = nx;
    live.frameIndex = idx;
    live.stage = f.stage ?? null;
    const p = f.power;
    // buses
    for (let i = 0; i < N_BUS; i++) {
      const st = p?.busState?.[i];
      live.busCode[i] = st ? STATE_CODE[st] ?? CODE.energized : CODE.energized;
      const vm = p?.busVmPu?.[i];
      live.busVm[i] = vm == null ? NaN : vm;
    }
    // lines
    for (let i = 0; i < N_LINE; i++) {
      const st = p?.lineState?.[i];
      const normal = LINES[i].normallyOpen ? CODE.open : CODE.energized;
      live.lineCode[i] = st ? STATE_CODE[st] ?? normal : normal;
      const fl = p?.lineFlowKW?.[i];
      live.lineFlowKW[i] = fl == null ? NaN : fl;
      if (fl == null || !Number.isFinite(fl)) {
        live.lineDir[i] = live.lineCode[i] === CODE.energized || live.lineCode[i] === CODE.restored ? NOMINAL_LINE_DIR[i] : 0;
        live.lineSpeed[i] = live.lineDir[i] !== 0 ? 0.5 : 0;
      } else {
        live.lineDir[i] = Math.abs(fl) < 0.5 ? 0 : Math.sign(fl);
        live.lineSpeed[i] = Math.min(1, Math.abs(fl) / maxAbsFlowKW);
      }
    }
    // switches
    for (let i = 0; i < N_LINE; i++) live.switchClosedByLine[i] = LINES[i].normallyOpen ? 0 : 1;
    const sc = p?.switchClosed;
    if (sc) for (let k = 0; k < sc.length; k++) {
      const li = switchLineOf[k];
      if (li != null && li >= 0 && li < N_LINE) live.switchClosedByLine[li] = sc[k] ? 1 : 0;
    }
    // water (discrete parts)
    const w = f.water;
    for (let i = 0; i < N_PIPE; i++) {
      const o = w?.pipeOpen?.[i];
      live.pipeOpen[i] = o == null ? (PIPES[i].initialStatus === 'closed' ? 0 : 1) : o ? 1 : 0;
    }
    for (let i = 0; i < JUNCTIONS.length; i++) live.junctionPressure[i] = num(w?.junctionPressureM?.[i], NaN);
    for (let i = 0; i < PUMPS.length; i++) {
      const on = w?.pumpOn?.[i];
      live.pumpOn[i] = on == null ? 1 : on ? 1 : 0;
      live.pumpFlow[i] = num(w?.pumpFlowLps?.[i], NaN);
    }
    for (let i = 0; i < N_PIPE; i++) {
      const [a, b] = pipeEnds[i];
      const pa = a >= 0 ? live.junctionPressure[a] : NaN;
      const pb = b >= 0 ? live.junctionPressure[b] : NaN;
      live.pipePressure[i] = Number.isNaN(pa) ? pb : Number.isNaN(pb) ? pa : Math.min(pa, pb);
    }
    const fac = new Map<string, FacilityState>();
    for (const fs of f.facilities ?? []) fac.set(fs.id, fs);
    live.facilities = fac;
    live.version++;
  }

  // continuous interpolation between frames (water flows, tank levels)
  const w0 = f.water;
  const w1 = nx.water;
  for (let i = 0; i < N_PIPE; i++) {
    const a = w0?.pipeFlowLps?.[i];
    const b = w1?.pipeFlowLps?.[i];
    if (a == null || !Number.isFinite(a)) {
      live.pipeFlow[i] = NaN;
      live.pipeVel[i] = NaN;
      live.pipeDir[i] = live.pipeOpen[i] ? NOMINAL_PIPE_DIR[i] : 0;
      continue;
    }
    const q = b == null || !Number.isFinite(b) ? a : a + (b - a) * frac;
    live.pipeFlow[i] = q;
    const va = num(w0?.pipeVelocityMs?.[i], NaN);
    const vb = num(w1?.pipeVelocityMs?.[i], va);
    live.pipeVel[i] = Number.isNaN(va) ? NaN : va + (vb - va) * frac;
    live.pipeDir[i] = Math.abs(q) < 0.05 ? 0 : Math.sign(q);
  }
  for (let i = 0; i < TANKS.length; i++) {
    const a = num(w0?.tankPct?.[i], nominalTankPct[i]);
    const b = num(w1?.tankPct?.[i], a);
    live.tankPct[i] = a + (b - a) * frac;
    live.tankTrend[i] = b - a;
  }
}

export function isPowered(code: number) {
  return code === CODE.energized || code === CODE.restored;
}

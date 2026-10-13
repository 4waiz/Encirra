/**
 * Pure derivations from simulation data. Every number the dashboard shows is either a contract
 * field read directly or one of the documented derivations below (no invented values).
 */
import type {
  CandidateEvaluation,
  FacilityInfo,
  FacilityKind,
  FacilityPower,
  FacilityStatus,
  FacilityWater,
  FeederId,
  Frame,
  NetworkTopology,
  RunResult,
  StageId,
  StrategyId,
  TimelineStep,
} from '@encirra/shared';
import { fmtKW } from './format';

// ───────────────────────────────────────────────────────────── labels
export const STAGE_LABEL: Record<StageId, string> = {
  ready: 'Normal operation',
  'fault-detected': 'Fault detected',
  'fault-isolated': 'Fault isolated',
  'impact-evaluated': 'Impact evaluated',
  'candidates-generated': 'Candidates evaluated',
  'verification-completed': 'Plan verified',
  'recovery-applied': 'Switching in progress',
  'recovery-complete': 'Recovery complete',
  'partially-restored': 'Partially restored',
  'recovery-infeasible': 'No feasible recovery',
  'no-intervention': 'No intervention',
};

export const STRATEGY_LABEL: Record<StrategyId, string> = {
  none: 'None',
  'grid-only': 'Grid-only',
  encirra: 'Encirra',
};

export const STRATEGY_LONG: Record<StrategyId, string> = {
  none: 'No intervention (baseline)',
  'grid-only': 'Grid-only restoration',
  encirra: 'Encirra coupled power + water',
};

// ───────────────────────────────────────────────────────────── topology index
export interface TopologyIndex {
  facility: Map<string, FacilityInfo>;
  junctionIdx: Map<string, number>;
  tankIdx: Map<string, number>;
  pumpIdx: Map<string, number>;
  pipeIdx: Map<string, number>;
  reservoirIdx: Map<string, number>;
  switchIdx: Map<string, number>;
  facilityByPump: Map<string, FacilityInfo>;
  facilitiesByBus: Map<number, FacilityInfo[]>;
  feederOfBus: Map<number, FeederId | 'S1'>;
  /** pressure zone ('West' | 'East') of each pump, from the zone of its discharge junction */
  pumpZone: Map<string, string | null>;
}

const topoCache = new WeakMap<NetworkTopology, TopologyIndex>();

export function indexTopology(t: NetworkTopology): TopologyIndex {
  const hit = topoCache.get(t);
  if (hit) return hit;
  const idx = <T extends { id: string }>(arr: T[]) => new Map(arr.map((x, i) => [x.id, i]));
  const facility = new Map(t.facilities.map((f) => [f.id, f]));
  const facilityByPump = new Map<string, FacilityInfo>();
  for (const p of t.water.pumps) {
    const f = facility.get(p.stationId) ?? t.facilities.find((x) => x.pumps?.includes(p.id));
    if (f) facilityByPump.set(p.id, f);
  }
  const facilitiesByBus = new Map<number, FacilityInfo[]>();
  for (const f of t.facilities) if (f.bus != null) facilitiesByBus.set(f.bus, [...(facilitiesByBus.get(f.bus) ?? []), f]);
  const junctionIdx = idx(t.water.junctions);
  const pumpZone = new Map<string, string | null>();
  for (const p of t.water.pumps) {
    const j = t.water.junctions[junctionIdx.get(p.to) ?? -1];
    pumpZone.set(p.id, j?.zone ?? null);
  }
  const out: TopologyIndex = {
    facility,
    junctionIdx,
    tankIdx: idx(t.water.tanks),
    pumpIdx: idx(t.water.pumps),
    pipeIdx: idx(t.water.pipes),
    reservoirIdx: idx(t.water.reservoirs),
    switchIdx: idx(t.electrical.switches),
    facilityByPump,
    facilitiesByBus,
    feederOfBus: new Map(t.electrical.buses.map((b) => [b.id, b.feeder])),
    pumpZone,
  };
  topoCache.set(t, out);
  return out;
}

// ───────────────────────────────────────────────────────────── time helpers
export function clampIndex(run: RunResult | null, playhead: number): number {
  const n = run?.frames.length ?? 0;
  if (n === 0) return 0;
  return Math.max(0, Math.min(n - 1, Math.floor(playhead)));
}

/** Simulated time (s) at a fractional playhead, linearly interpolated between frames. */
export function timeAt(run: RunResult, playhead: number): number {
  const f = run.frames;
  if (f.length === 0) return 0;
  const i = Math.max(0, Math.min(f.length - 1, Math.floor(playhead)));
  const j = Math.min(f.length - 1, i + 1);
  const frac = Math.max(0, Math.min(1, playhead - i));
  return f[i].t + (f[j].t - f[i].t) * frac;
}

/** Index of the first frame with t ≥ tSeconds (last frame when beyond the horizon). */
export function frameIndexAtT(run: RunResult, tSeconds: number): number {
  const f = run.frames;
  for (let i = 0; i < f.length; i++) if (f[i].t >= tSeconds - 1e-6) return i;
  return Math.max(0, f.length - 1);
}

/** Frame spacing in seconds (timebase.stepSeconds, else inferred from the first two frames). */
export function stepSeconds(run: RunResult): number {
  if (run.timebase?.stepSeconds > 0) return run.timebase.stepSeconds;
  const f = run.frames;
  return f.length > 1 ? Math.max(1, f[1].t - f[0].t) : 60;
}

// ───────────────────────────────────────────────────────────── event marks
export interface RunMarks {
  faultT: number | null; // fault event (or timeline "fault-detected")
  isolatedT: number | null;
  evaluatedT: number | null;
  verifiedT: number | null;
  restoredT: number | null; // timeline "service-restored" (or plan.appliedAtT)
  pumpTripT: number | null; // first frame with fewer pumps online than at the start
  pumpRecoveredT: number | null; // first later frame with the starting pump count back online
  pressureBelowT: number | null; // first frame with critical pressure below the service threshold
  pressureRecoveredT: number | null; // first later frame back at/above the threshold
}

const marksCache = new WeakMap<RunResult, RunMarks>();

export function runMarks(run: RunResult, serviceThresholdM?: number): RunMarks {
  const hit = marksCache.get(run);
  if (hit && serviceThresholdM === undefined) return hit;
  const step = (id: TimelineStep['id']) => run.timeline.find((s) => s.id === id) ?? null;
  const reachedT = (id: TimelineStep['id']) => {
    const s = step(id);
    return s && s.t != null && s.outcome !== 'skipped' ? s.t : null;
  };
  const faultEvent = run.events.find((e) => e.kind === 'fault');
  const frames = run.frames;
  const pumps0 = frames[0]?.water.pumpsOnline ?? 0;
  let pumpTripT: number | null = null;
  let pumpRecoveredT: number | null = null;
  for (const f of frames) {
    if (pumpTripT == null) {
      if (f.water.pumpsOnline < pumps0) pumpTripT = f.t;
    } else if (f.water.pumpsOnline >= pumps0) {
      pumpRecoveredT = f.t;
      break;
    }
  }
  const thr = serviceThresholdM ?? 20;
  let pressureBelowT: number | null = null;
  let pressureRecoveredT: number | null = null;
  for (const f of frames) {
    if (pressureBelowT == null) {
      if (f.water.criticalPressureM < thr) pressureBelowT = f.t;
    } else if (f.water.criticalPressureM >= thr) {
      pressureRecoveredT = f.t;
      break;
    }
  }
  const restoredStep = step('service-restored');
  const out: RunMarks = {
    faultT: faultEvent?.t ?? reachedT('fault-detected'),
    isolatedT: reachedT('fault-isolated'),
    evaluatedT: reachedT('recovery-evaluated'),
    verifiedT: reachedT('constraints-verified'),
    restoredT:
      restoredStep && restoredStep.t != null && (restoredStep.outcome === 'done' || restoredStep.outcome === 'partial')
        ? restoredStep.t
        : (run.plan?.appliedAtT ?? null),
    pumpTripT,
    pumpRecoveredT,
    pressureBelowT,
    pressureRecoveredT,
  };
  if (serviceThresholdM === undefined) marksCache.set(run, out);
  return out;
}

// ───────────────────────────────────────────────────────────── recovery timeline
export type StepStatus = 'done' | 'active' | 'pending' | 'failed' | 'partial' | 'skipped';
export interface TimelineItem {
  step: TimelineStep;
  status: StepStatus;
}

/**
 * Status of each timeline step relative to simulated time t (s):
 *  - a step with a completion time is resolved once t ≥ step.t (status = its outcome);
 *  - a step never reached in this run (t = null, outcome skipped/failed) resolves as soon as the
 *    last reached step before it has resolved;
 *  - the first unresolved step is "active" once the disturbance has begun (step 0 resolved);
 *  - everything else is "pending".
 */
export function timelineStatus(timeline: TimelineStep[], t: number): TimelineItem[] {
  const resolved: boolean[] = [];
  let lastReachedT: number | null = null;
  timeline.forEach((s, i) => {
    let r = false;
    if (s.t != null) r = t >= s.t;
    else if (s.outcome === 'skipped' || s.outcome === 'failed') {
      const prevResolved = i > 0 && resolved[i - 1];
      r = prevResolved && (lastReachedT == null || t >= lastReachedT);
    }
    resolved.push(r);
    if (s.t != null && r) lastReachedT = s.t;
  });
  const firstOpen = resolved.findIndex((r) => !r);
  return timeline.map((step, i) => {
    let status: StepStatus = 'pending';
    if (resolved[i]) {
      status = step.outcome === 'failed' ? 'failed' : step.outcome === 'partial' ? 'partial' : step.outcome === 'skipped' ? 'skipped' : 'done';
    } else if (i === firstOpen && i > 0 && resolved[0]) status = 'active';
    return { step, status };
  });
}

// ───────────────────────────────────────────────────────────── fault card
export interface FaultCardModel {
  active: boolean;
  faultLabel: string;
  clock: string;
  impactText: string;
  /** names of pump stations that lost supply after the fault (from frame pump states) */
  pumpStations: string[];
  metrics: { loadInterruptedKW: number; connectionsAffected: number; pumpsOffline: number; criticalAtRisk: number };
}

/** Pump stations whose pumps were off at any frame between the fault and the end of the run. */
export function lostPumpStations(run: RunResult, topology: NetworkTopology): string[] {
  const ix = indexTopology(topology);
  const marks = runMarks(run);
  if (marks.faultT == null) return [];
  const off = new Set<string>();
  const startOn = run.frames[0]?.water.pumpOn ?? [];
  for (const f of run.frames) {
    if (f.t < marks.faultT) continue;
    f.water.pumpOn.forEach((on, i) => {
      if (!on && startOn[i]) off.add(topology.water.pumps[i]?.id);
    });
  }
  const names: string[] = [];
  for (const pid of off) {
    const fac = ix.facilityByPump.get(pid);
    const name = fac?.name ?? pid;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

export function faultCardModel(run: RunResult, topology: NetworkTopology, frame: Frame): FaultCardModel {
  const marks = runMarks(run);
  const active = marks.faultT != null && frame.t >= marks.faultT && frame.stage !== 'ready';
  const s = run.summary;
  const stations = lostPumpStations(run, topology);
  const what = [fmtKW(s.loadInterruptedKW), ...stations];
  const impactText =
    what.length > 1 ? `Loss of supply affecting ${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}` : `Loss of supply affecting ${what[0]}`;
  return {
    active,
    faultLabel: s.faultLabel,
    clock: s.faultClock,
    impactText,
    pumpStations: stations,
    metrics: {
      loadInterruptedKW: s.loadInterruptedKW,
      connectionsAffected: s.connectionsAffected,
      pumpsOffline: s.pumpsOffline,
      criticalAtRisk: s.criticalAtRisk,
    },
  };
}

// ───────────────────────────────────────────────────────────── system recovery card
export type Tone = 'neutral' | 'info' | 'progress' | 'ok' | 'warn' | 'fault';

export interface RecoveryCardModel {
  tone: Tone;
  title: string;
  subtitle: string;
  clock: string | null;
  verified: boolean; // plan verification passed and the playhead has reached verification
  planVisible: boolean; // the playhead has reached candidate evaluation
  metrics: {
    restoredKW: number;
    restoredPct: number | null; // of summary.loadInterruptedKW
    criticalRecovered: number;
    criticalAffected: number;
    pumpsOnline: number;
    pumpsTotal: number;
    unservedKW: number;
    unservedPct: number | null; // of frame demand
  };
}

/**
 * Critical facilities affected by the disturbance up to frame index k (status ≠ safe at any frame
 * from the fault onwards), and how many of those are currently safe or restored.
 */
export function criticalProgress(run: RunResult, topology: NetworkTopology, k: number): { affected: number; recovered: number } {
  const ix = indexTopology(topology);
  const affected = new Set<string>();
  const frames = run.frames;
  const last = Math.min(k, frames.length - 1);
  for (let i = 0; i <= last; i++) {
    for (const fs of frames[i].facilities) {
      if (fs.status !== 'safe' && ix.facility.get(fs.id)?.critical) affected.add(fs.id);
    }
  }
  const now = frames[last];
  let recovered = 0;
  if (now) for (const fs of now.facilities) if (affected.has(fs.id) && (fs.status === 'safe' || fs.status === 'restored')) recovered++;
  return { affected: affected.size, recovered };
}

export function recoveryCardModel(run: RunResult, topology: NetworkTopology, k: number): RecoveryCardModel {
  const frame = run.frames[Math.max(0, Math.min(run.frames.length - 1, k))];
  const plan = run.plan;
  const marks = runMarks(run);
  const t = frame.t;
  const planVisible = plan != null && marks.evaluatedT != null && t >= marks.evaluatedT;
  const verifiedReached = plan != null && t >= (plan.verifiedAtT ?? Infinity);
  const verified = verifiedReached && plan!.verification.passed;
  const applied = plan != null && plan.appliedAtT != null && t >= plan.appliedAtT;

  let tone: Tone = 'neutral';
  let title = 'Awaiting disturbance';
  switch (frame.stage) {
    case 'ready':
      break;
    case 'fault-detected':
    case 'fault-isolated':
    case 'impact-evaluated':
    case 'candidates-generated':
      tone = 'info';
      title = 'Evaluating recovery…';
      break;
    case 'verification-completed':
      tone = verified ? 'info' : 'fault';
      title = verified ? 'Recovery plan verified' : 'Plan failed verification';
      break;
    case 'recovery-applied':
      tone = 'progress';
      title = 'System recovery in progress';
      break;
    case 'recovery-complete':
      if (verified && applied) {
        tone = 'ok';
        title = 'Recovery complete · Simulation Verified';
      } else {
        tone = 'warn';
        title = 'Recovery complete (not verified)';
      }
      break;
    case 'partially-restored':
      tone = 'warn';
      title = 'Partially restored';
      break;
    case 'recovery-infeasible':
      tone = 'fault';
      title = 'No feasible recovery';
      break;
    case 'no-intervention':
      tone = 'neutral';
      title = 'No intervention (baseline)';
      break;
  }

  let subtitle: string;
  if (frame.stage === 'ready') subtitle = run.strategy === 'none' ? 'Baseline run: no recovery actions will be taken' : 'Recovery planner on standby';
  else if (frame.stage === 'no-intervention' || run.strategy === 'none') subtitle = 'Outage persists by design (comparison baseline)';
  else if (frame.stage === 'recovery-infeasible') subtitle = plan?.label ?? `${run.summary.candidatesRejected} of ${run.summary.candidatesEvaluated} candidates rejected`;
  else if (planVisible && plan) subtitle = plan.label;
  else subtitle = frame.stage === 'fault-detected' ? 'Isolating the faulted section' : 'Assessing electrical and hydraulic impact';

  // clock of the latest event at or before t
  let clock: string | null = null;
  for (const e of run.events) if (e.t <= t) clock = e.clock;

  const crit = criticalProgress(run, topology, k);
  const interrupted = run.summary.loadInterruptedKW;
  return {
    tone,
    title,
    subtitle,
    clock: frame.stage === 'ready' ? null : clock,
    verified,
    planVisible,
    metrics: {
      restoredKW: frame.power.restoredKW,
      restoredPct: interrupted > 0 ? (100 * frame.power.restoredKW) / interrupted : null,
      criticalRecovered: crit.recovered,
      criticalAffected: crit.affected,
      pumpsOnline: frame.water.pumpsOnline,
      pumpsTotal: frame.water.pumpsTotal,
      unservedKW: frame.power.unservedKW,
      unservedPct: frame.power.demandKW > 0 ? (100 * frame.power.unservedKW) / frame.power.demandKW : null,
    },
  };
}

// ───────────────────────────────────────────────────────────── critical facilities table
export interface FacilityRow {
  id: string;
  name: string;
  kind: FacilityKind;
  critical: boolean;
  power: FacilityPower;
  water: FacilityWater;
  status: FacilityStatus;
  detail: string;
}

const KIND_ORDER: FacilityKind[] = ['hospital', 'pump-station', 'emergency-ops', 'water-tower', 'desalination-inlet', 'substation', 'cooling-plant', 'commercial'];

/** Joins frame.facilities (state) with topology.facilities (names, kinds); critical first, stable order. */
export function facilityRows(topology: NetworkTopology, frame: Frame | null): FacilityRow[] {
  const state = new Map((frame?.facilities ?? []).map((f) => [f.id, f]));
  const rows = topology.facilities.map((f, i) => {
    const s = state.get(f.id);
    return {
      row: {
        id: f.id,
        name: f.name,
        kind: f.kind,
        critical: f.critical,
        power: s?.power ?? (f.bus == null ? 'external' : 'online'),
        water: s?.water ?? 'n/a',
        status: s?.status ?? 'safe',
        detail: s?.detail ?? '',
      } satisfies FacilityRow,
      known: !!s,
      order: (f.critical ? 0 : 100) + KIND_ORDER.indexOf(f.kind) * 10 + i / 100,
    };
  });
  return rows
    .filter((r) => r.known || !frame)
    .sort((a, b) => a.order - b.order)
    .map((r) => r.row);
}

export const POWER_LABEL: Record<FacilityPower, string> = {
  online: 'Online',
  offline: 'Offline',
  backup: 'On backup',
  restored: 'Restored',
  external: 'External supply',
};
export const WATER_LABEL: Record<FacilityWater, string> = {
  normal: 'Normal',
  'low-pressure': 'Low pressure',
  'no-flow': 'No flow',
  restored: 'Restored',
  'n/a': 'n/a',
};
export const STATUS_LABEL: Record<FacilityStatus, string> = {
  safe: 'Safe',
  'at-risk': 'At risk',
  affected: 'Affected',
  restored: 'Restored',
};

// ───────────────────────────────────────────────────────────── chart series
export interface PowerPoint {
  t: number;
  min: number;
  clock: string;
  demandKW: number;
  servedKW: number;
  unservedKW: number;
  restoredKW: number;
}
const powerCache = new WeakMap<RunResult, PowerPoint[]>();
export function powerSeries(run: RunResult): PowerPoint[] {
  const hit = powerCache.get(run);
  if (hit) return hit;
  const out = run.frames.map((f) => ({
    t: f.t,
    min: f.t / 60,
    clock: f.clock,
    demandKW: f.power.demandKW,
    servedKW: f.power.servedKW,
    unservedKW: f.power.unservedKW,
    restoredKW: f.power.restoredKW,
  }));
  powerCache.set(run, out);
  return out;
}

export interface WaterPoint {
  t: number;
  min: number;
  clock: string;
  criticalPressureM: number;
  minPressureM: number;
  deliveredLps: number;
  requiredLps: number;
  deliveredPct: number;
  pumpsOnline: number;
  /** tank levels (% of usable range) keyed by tank id */
  tanks: Record<string, number>;
}
const waterCache = new WeakMap<RunResult, WaterPoint[]>();
export function waterSeries(run: RunResult, topology: NetworkTopology): WaterPoint[] {
  const hit = waterCache.get(run);
  if (hit) return hit;
  const ids = topology.water.tanks.map((t) => t.id);
  const out = run.frames.map((f) => ({
    t: f.t,
    min: f.t / 60,
    clock: f.clock,
    criticalPressureM: f.water.criticalPressureM,
    minPressureM: f.water.minPressureM,
    deliveredLps: f.water.deliveredLps,
    requiredLps: f.water.requiredLps,
    deliveredPct: f.water.deliveredPct,
    pumpsOnline: f.water.pumpsOnline,
    tanks: Object.fromEntries(ids.map((id, i) => [id, f.water.tankPct[i]])),
  }));
  waterCache.set(run, out);
  return out;
}

/** Pressure (m) at a facility's water node for a frame, or null when it has none / is not a junction. */
export function facilityPressure(topology: NetworkTopology, frame: Frame, facilityId: string): number | null {
  const ix = indexTopology(topology);
  const f = ix.facility.get(facilityId);
  if (!f?.waterNode) return null;
  const j = ix.junctionIdx.get(f.waterNode);
  return j == null ? null : (frame.water.junctionPressureM[j] ?? null);
}

/** Sum of synthetic service connections at buses without supply (deenergized / faulted / shed). */
export function connectionsWithoutSupply(topology: NetworkTopology, frame: Frame): number {
  let n = 0;
  topology.electrical.buses.forEach((b, i) => {
    const s = frame.power.busState[i];
    if (s === 'deenergized' || s === 'faulted' || s === 'isolated' || frame.power.busShed[i]) n += b.connections;
  });
  return n;
}

/** Served kW per feeder (sum of busServedKW over the feeder's buses). */
export function feederServedKW(topology: NetworkTopology, frame: Frame): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of topology.electrical.feeders) out[f.id] = f.buses.reduce((a, b) => a + (frame.power.busServedKW[b] ?? 0), 0);
  return out;
}

// ───────────────────────────────────────────────────────────── candidates
export function scoreFor(c: CandidateEvaluation, strategy: StrategyId): number | null {
  return strategy === 'grid-only' ? c.scoreGridOnly : c.scoreEncirra;
}
export function rankFor(c: CandidateEvaluation, strategy: StrategyId): number | null {
  return strategy === 'grid-only' ? c.rankGridOnly : c.rankEncirra;
}

/** Feasible candidates by rank for the strategy, then rejected ones. */
export function sortedCandidates(run: RunResult): CandidateEvaluation[] {
  const s = run.strategy;
  return [...run.candidates].sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    const ra = rankFor(a, s) ?? Infinity;
    const rb = rankFor(b, s) ?? Infinity;
    if (ra !== rb) return ra - rb;
    return (scoreFor(b, s) ?? -Infinity) - (scoreFor(a, s) ?? -Infinity);
  });
}

/** Run summaries per strategy: the loaded runs are authoritative; the comparison file fills gaps. */
export function summariesByStrategy(
  runs: Partial<Record<StrategyId, RunResult>>,
  comparison: { summaries: Record<StrategyId, RunResult['summary']> } | null,
): Partial<Record<StrategyId, RunResult['summary']>> {
  const out: Partial<Record<StrategyId, RunResult['summary']>> = {};
  for (const s of ['none', 'grid-only', 'encirra'] as StrategyId[]) {
    const v = runs[s]?.summary ?? comparison?.summaries?.[s];
    if (v) out[s] = v;
  }
  return out;
}

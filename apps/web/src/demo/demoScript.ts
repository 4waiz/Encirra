/**
 * The 3-minute guided demo. Every caption is composed from the loaded run data; timings are
 * relative to the demo clock (seconds). Playhead targets are simulated times from the runs, so the
 * sequence stays synchronized with the frames whatever the scenario horizon is.
 */
import type { NetworkTopology, RunResult, StrategyId } from '@encirra/shared';
import type { CameraShot, Layers, OverviewMode } from '@/state/store';
import { frameIndexAtT, runMarks, lostPumpStations } from '@/data/selectors';
import { fmtDuration, fmtInt, fmtKW, fmtNum } from '@/data/format';

export interface DemoCtx {
  runs: Partial<Record<StrategyId, RunResult>>;
  topology: NetworkTopology;
}

export interface Cue {
  at: number; // seconds into the step
  camera?: { shot: CameraShot; durationS?: number };
  strategy?: StrategyId;
  layers?: Partial<Layers>;
  overview?: OverviewMode;
  whyPlan?: boolean;
  /** jump the playhead (frame index) instantly */
  jump?: (c: DemoCtx) => number | null;
}

export interface Glide {
  from: number; // seconds into the step
  to: number;
  /** target frame index of the strategy shown at that moment */
  target: (c: DemoCtx) => number | null;
}

export interface DemoStep {
  id: string;
  title: string;
  start: number;
  duration: number;
  caption: (c: DemoCtx) => string;
  cues: Cue[];
  glides: Glide[];
}

const run = (c: DemoCtx, s: StrategyId = 'encirra') => c.runs[s] ?? c.runs.encirra ?? null;
const idxAt = (c: DemoCtx, s: StrategyId, t: number | null | undefined, offset = 0) => {
  const r = run(c, s);
  if (!r || t == null) return null;
  return Math.max(0, Math.min(r.frames.length - 1, frameIndexAtT(r, t) + offset));
};

export const DEMO_STEPS: DemoStep[] = [
  {
    id: 'intro',
    title: 'A living district',
    start: 0,
    duration: 30,
    caption: (c) => {
      const r = run(c);
      const pumps = c.topology.water.pumps.length;
      const f0 = r?.frames[0];
      return `A Dubai-inspired synthetic district: the IEEE 33-bus feeder (pandapower) serves ${fmtKW(f0?.power.servedKW)} of demand and powers ${pumps} pumping stations that keep the WNTR water network pressurised. Power is amber, water is cyan.`;
    },
    cues: [
      { at: 0, strategy: 'encirra', layers: { electrical: true, water: true, underground: false, labels: true }, overview: 'power', whyPlan: false, jump: () => 0, camera: { shot: 'aerial', durationS: 3.5 } },
      { at: 9, camera: { shot: 'home', durationS: 5 } },
      { at: 17, overview: 'water' },
      { at: 25, overview: 'power' },
    ],
    glides: [{ from: 4, to: 28, target: (c) => idxAt(c, 'encirra', runMarks(run(c)!).faultT, -1) }],
  },
  {
    id: 'fault',
    title: 'Trigger the fault',
    start: 30,
    duration: 30,
    caption: (c) => {
      const r = run(c);
      if (!r) return '';
      const s = r.summary;
      const st = lostPumpStations(r, c.topology);
      return `${s.faultClock}: ${s.faultLabel} faults. Protection trips and ${fmtKW(s.loadInterruptedKW)} across ${fmtInt(s.connectionsAffected)} service connections lose supply${st.length ? ` — including ${st.join(' and ')}` : ''}. The faulted section is isolated.`;
    },
    cues: [
      { at: 0, camera: { shot: 'west-district', durationS: 3 }, overview: 'power' },
      { at: 16, camera: { shot: 'substation', durationS: 3.5 } },
    ],
    glides: [
      { from: 2, to: 6, target: (c) => idxAt(c, 'encirra', runMarks(run(c)!).faultT) },
      { from: 9, to: 15, target: (c) => idxAt(c, 'encirra', runMarks(run(c)!).isolatedT) },
    ],
  },
  {
    id: 'cascade',
    title: 'The cascade',
    start: 60,
    duration: 30,
    caption: (c) => {
      const base = run(c, 'none');
      if (!base) return '';
      const thr = c.topology.water.serviceThresholdM;
      const m = runMarks(base, thr);
      const delay = base.summary.hydraulicDelayMin;
      const below = m.pressureBelowT != null ? base.frames[frameIndexAtT(base, m.pressureBelowT)]?.clock : null;
      return delay != null && below
        ? `Underground, the pumps on the lost feeder have stopped and the elevated tank carries the zone alone. Without intervention (baseline replay) it drains and critical pressure falls below ${fmtNum(thr, 0)} m after ${fmtDuration(delay)}, at ${below}.`
        : `Underground, the pumps on the lost feeder have stopped and the elevated tank carries the zone alone (baseline replay: ${fmtNum(base.summary.minCriticalPressureM, 1)} m minimum critical pressure).`;
    },
    cues: [
      { at: 0, strategy: 'none', layers: { underground: true }, overview: 'water', camera: { shot: 'underground-west', durationS: 3.5 } },
      { at: 15, camera: { shot: 'tank-t2', durationS: 3.5 } },
    ],
    glides: [
      {
        from: 3,
        to: 25,
        target: (c) => {
          const base = run(c, 'none');
          if (!base) return null;
          const m = runMarks(base, c.topology.water.serviceThresholdM);
          return idxAt(c, 'none', m.pressureBelowT ?? base.frames[base.frames.length - 1].t, 3);
        },
      },
    ],
  },
  {
    id: 'evaluate',
    title: 'Evaluate recovery',
    start: 90,
    duration: 45,
    caption: (c) => {
      const g = run(c, 'grid-only');
      const e = run(c, 'encirra');
      if (!e) return '';
      const es = e.summary;
      const gs = g?.summary;
      const grid = gs ? `Grid-only restoration (${g?.plan?.label ?? 'no plan'}) keeps ${gs.pumpsAvailableEnd}/${gs.pumpsTotal} pumps and ${fmtNum(gs.minCriticalPressureM, 1)} m minimum critical pressure. ` : '';
      return `${grid}Encirra scores ${es.candidatesEvaluated} switching candidates on the coupled objective, rejects ${es.candidatesRejected} that fail hard checks, and re-solves the chosen plan independently before acting.`;
    },
    cues: [
      { at: 0, strategy: 'grid-only', layers: { underground: false }, overview: 'combined', camera: { shot: 'recovery-path', durationS: 3.5 }, jump: (c) => idxAt(c, 'grid-only', runMarks(run(c, 'grid-only') ?? run(c)!).verifiedT ?? runMarks(run(c)!).verifiedT) },
      { at: 12, strategy: 'encirra', jump: (c) => idxAt(c, 'encirra', runMarks(run(c)!).verifiedT) },
      { at: 17, whyPlan: true },
      { at: 41, whyPlan: false },
    ],
    glides: [],
  },
  {
    id: 'restore',
    title: 'Restoration',
    start: 135,
    duration: 30,
    caption: (c) => {
      const e = run(c);
      const p = e?.plan;
      if (!e || !p) return '';
      const applied = p.appliedAtT != null ? e.frames[frameIndexAtT(e, p.appliedAtT)]?.clock : null;
      return `${applied ? `${applied}: ` : ''}switching executed — ${p.label}. ${fmtKW(e.summary.loadRestoredKW)} restored (${fmtNum(e.summary.loadRestoredPct, 0)}% of the interrupted load), ${e.summary.pumpsAvailableEnd}/${e.summary.pumpsTotal} pumps available, and the tank refills.`;
    },
    cues: [
      { at: 0, strategy: 'encirra', whyPlan: false, overview: 'power', camera: { shot: 'recovery-path', durationS: 3 } },
      { at: 16, camera: { shot: 'hospital', durationS: 4 }, overview: 'combined' },
    ],
    glides: [{ from: 2, to: 22, target: (c) => idxAt(c, 'encirra', runMarks(run(c)!).restoredT, 4) }],
  },
  {
    id: 'evidence',
    title: 'Evidence',
    start: 165,
    duration: 15,
    caption: (c) => {
      const e = run(c)?.summary;
      const n = run(c, 'none')?.summary;
      if (!e) return '';
      const vs = n
        ? `Unserved energy ${fmtInt(e.unservedEnergyKWh)} kWh vs ${fmtInt(n.unservedEnergyKWh)} kWh without intervention; ${fmtInt(e.minutesBelowServicePressure)} vs ${fmtInt(n.minutesBelowServicePressure)} minutes below service pressure at critical facilities. `
        : '';
      const verified = run(c)?.plan?.verification.passed;
      return `${vs}${fmtInt(e.constraintViolations)} hard-constraint violations${verified ? ' — plan Simulation Verified' : ''}. Full comparison in Reports.`;
    },
    cues: [{ at: 0, camera: { shot: 'home', durationS: 4 }, overview: 'combined' }],
    glides: [{ from: 0, to: 10, target: (c) => (run(c) ? run(c)!.frames.length - 1 : null) }],
  },
];

export const DEMO_LENGTH = DEMO_STEPS.reduce((a, s) => Math.max(a, s.start + s.duration), 0);

export function stepAt(elapsed: number): number {
  for (let i = DEMO_STEPS.length - 1; i >= 0; i--) if (elapsed >= DEMO_STEPS[i].start) return i;
  return 0;
}

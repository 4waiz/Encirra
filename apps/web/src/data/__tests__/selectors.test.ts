import { describe, expect, it } from 'vitest';
import {
  connectionsWithoutSupply,
  criticalProgress,
  facilityMinutesBelowService,
  facilityPressure,
  facilityRows,
  faultCardModel,
  frameIndexAtT,
  impactComparison,
  incidentModel,
  lostPumpStations,
  recoveryCardModel,
  restoredShare,
  runMarks,
  sortedCandidates,
  summariesByStrategy,
  timeAt,
  timelineStatus,
} from '../selectors';
import { makeFrame, makePlan, makeRun, makeTopology } from './builders';

const topo = makeTopology();

describe('timelineStatus (relative to the playhead)', () => {
  const run = makeRun('encirra');
  const at = (min: number) => timelineStatus(run.timeline, min * 60).map((x) => x.status);

  it('is all pending before the disturbance', () => {
    expect(at(0)).toEqual(['pending', 'pending', 'pending', 'pending', 'pending']);
  });
  it('marks the fault done and the next step active', () => {
    expect(at(2)).toEqual(['done', 'active', 'pending', 'pending', 'pending']);
  });
  it('progresses through evaluation and verification', () => {
    expect(at(4)).toEqual(['done', 'done', 'done', 'done', 'active']);
  });
  it('is fully done after service restoration', () => {
    expect(at(7)).toEqual(['done', 'done', 'done', 'done', 'done']);
  });
  it('resolves skipped steps (baseline) once the last reached step has resolved', () => {
    const none = makeRun('none');
    const s = (min: number) => timelineStatus(none.timeline, min * 60).map((x) => x.status);
    expect(s(2)).toEqual(['done', 'active', 'pending', 'pending', 'pending']);
    expect(s(3)).toEqual(['done', 'done', 'skipped', 'skipped', 'skipped']);
  });
  it('shows a failed verification in red at its time and skips what follows', () => {
    const tl = makeRun('encirra').timeline.map((st) =>
      st.id === 'constraints-verified' ? { ...st, outcome: 'failed' as const } : st.id === 'service-restored' ? { ...st, t: null, clock: null, outcome: 'skipped' as const } : st,
    );
    expect(timelineStatus(tl, 3.5 * 60).map((x) => x.status)).toEqual(['done', 'done', 'active', 'pending', 'pending']);
    expect(timelineStatus(tl, 4 * 60).map((x) => x.status)).toEqual(['done', 'done', 'done', 'failed', 'skipped']);
  });
  it('marks partial restoration as partial', () => {
    const run2 = makeRun('grid-only', { plan: makePlan({ strategy: 'grid-only', outcome: 'partial' }) });
    expect(timelineStatus(run2.timeline, 7 * 60)[4].status).toBe('partial');
  });
});

describe('time helpers', () => {
  const run = makeRun();
  it('interpolates time between frames', () => {
    expect(timeAt(run, 2.5)).toBe(150);
    expect(timeAt(run, 99)).toBe(420);
  });
  it('finds the first frame at or after t', () => {
    expect(frameIndexAtT(run, 120)).toBe(2);
    expect(frameIndexAtT(run, 121)).toBe(3);
    expect(frameIndexAtT(run, 10_000)).toBe(7);
  });
});

describe('runMarks', () => {
  it('derives fault, restoration, pump trip/recovery and pressure crossings from the data', () => {
    const m = runMarks(makeRun('encirra'), 20);
    expect(m.faultT).toBe(120);
    expect(m.isolatedT).toBe(180);
    expect(m.verifiedT).toBe(240);
    expect(m.restoredT).toBe(360);
    expect(m.pumpTripT).toBe(120);
    expect(m.pumpRecoveredT).toBe(360);
    expect(m.pressureBelowT).toBe(120);
    expect(m.pressureRecoveredT).toBe(360);
  });
  it('has no restoration for the baseline', () => {
    const m = runMarks(makeRun('none'));
    expect(m.restoredT).toBeNull();
    expect(m.pumpRecoveredT).toBeNull();
  });
});

describe('fault card', () => {
  const run = makeRun();
  it('is neutral before the fault', () => {
    expect(faultCardModel(run, topo, run.frames[1]).active).toBe(false);
  });
  it('reports the fault impact from the run summary after the fault', () => {
    const m = faultCardModel(run, topo, run.frames[2]);
    expect(m.active).toBe(true);
    expect(m.faultLabel).toBe('Feeder F3 · line B2–B3');
    expect(m.clock).toBe('17:02');
    expect(m.metrics).toEqual({ loadInterruptedKW: 200, connectionsAffected: 60, pumpsOffline: 1, criticalAtRisk: 2 });
    expect(m.impactText).toBe('Loss of supply affecting 200 kW and Pumping Station PS-2');
  });
  it('lists pump stations that lost supply after the fault', () => {
    expect(lostPumpStations(run, topo)).toEqual(['Pumping Station PS-2']);
  });
});

describe('system recovery card', () => {
  it('awaits the disturbance before the fault', () => {
    const run = makeRun();
    const m = recoveryCardModel(run, topo, 0);
    expect(m.title).toBe('Awaiting disturbance');
    expect(m.tone).toBe('neutral');
  });
  it('evaluates, then verifies, then applies the plan', () => {
    const run = makeRun();
    expect(recoveryCardModel(run, topo, 2).title).toBe('Evaluating recovery…');
    expect(recoveryCardModel(run, topo, 4).title).toBe('Recovery plan verified');
    expect(recoveryCardModel(run, topo, 4).subtitle).toBe('Close SW-01-03');
    expect(recoveryCardModel(run, topo, 5).title).toBe('System recovery in progress');
  });
  it('is green only when verification passed and the plan is applied', () => {
    const run = makeRun();
    const done = recoveryCardModel(run, topo, 7);
    expect(done.title).toBe('Recovery complete · Simulation Verified');
    expect(done.tone).toBe('ok');
    const unverified = makeRun('encirra', { plan: makePlan({ verification: { passed: false, status: 'rejected', checks: [], method: 'x' } }) });
    const m = recoveryCardModel(unverified, topo, 7);
    expect(m.tone).not.toBe('ok');
    expect(m.title).not.toContain('Simulation Verified');
  });
  it('is amber for partial restoration and grey for the baseline', () => {
    const partial = makeRun('grid-only', { plan: makePlan({ strategy: 'grid-only', outcome: 'partial' }) });
    expect(recoveryCardModel(partial, topo, 7)).toMatchObject({ title: 'Partially restored', tone: 'warn' });
    const none = makeRun('none');
    expect(recoveryCardModel(none, topo, 5)).toMatchObject({ title: 'No intervention (baseline)', tone: 'neutral' });
  });
  it('is red when no candidate is feasible', () => {
    const frames = makeRun('encirra', { plan: null }).frames.map((f, i) => (i >= 4 ? { ...f, stage: 'recovery-infeasible' as const } : f));
    const run = makeRun('encirra', { plan: null, frames });
    expect(recoveryCardModel(run, topo, 5)).toMatchObject({ title: 'No feasible recovery', tone: 'fault' });
  });
  it('derives restored kW (% of interrupted), pumps and unserved demand from the frame', () => {
    const run = makeRun();
    const m = recoveryCardModel(run, topo, 7).metrics;
    expect(m.restoredKW).toBe(200);
    expect(m.restoredPct).toBe(100);
    expect(m.pumpsOnline).toBe(1);
    expect(m.pumpsTotal).toBe(1);
    expect(m.unservedKW).toBe(0);
    const mid = recoveryCardModel(run, topo, 3).metrics;
    expect(mid.restoredPct).toBe(0);
    expect(mid.unservedPct).toBeCloseTo((100 * 200) / 300, 6);
    expect(recoveryCardModel(run, topo, 0).metrics.restoredPct).toBeNull();
  });
  it('counts critical facilities at risk (run-level) and how many have recovered so far', () => {
    const run = makeRun();
    expect(criticalProgress(run, topo, 1)).toEqual({ atRisk: 2, affected: 0, recovered: 0 });
    expect(criticalProgress(run, topo, 3)).toEqual({ atRisk: 2, affected: 2, recovered: 0 });
    expect(criticalProgress(run, topo, 7)).toEqual({ atRisk: 2, affected: 2, recovered: 2 });
    // the card hides the run-level denominator until the fault has happened
    expect(recoveryCardModel(run, topo, 1).metrics.criticalAtRisk).toBe(0);
    expect(recoveryCardModel(run, topo, 7).metrics).toMatchObject({ criticalRecovered: 2, criticalAtRisk: 2 });
  });
  it('does not count a facility as recovered before it was ever affected', () => {
    // hospital water only drops later in the run: at k=2 it is still safe → not "recovered"
    const run = makeRun();
    const frames = run.frames.map((f, i) => ({
      ...f,
      facilities: f.facilities.map((x) => (x.id === 'hosp' ? { ...x, status: (i >= 5 && i < 6 ? 'at-risk' : i >= 6 ? 'restored' : 'safe') as 'safe' } : x)),
    }));
    const r2 = { ...run, frames };
    expect(criticalProgress(r2, topo, 3)).toMatchObject({ atRisk: 2, recovered: 0 });
    expect(criticalProgress(r2, topo, 6).recovered).toBe(2);
  });
  it('restored share matches restored ÷ (restored + unserved)', () => {
    const f = makeFrame({ min: 7, stage: 'recovery-complete', lost: true, restored: true });
    expect(restoredShare(f)).toBe(100);
    expect(restoredShare(makeFrame({ min: 0, stage: 'ready' }))).toBeNull();
  });
});

describe('critical facilities table', () => {
  it('joins frame state with topology names, critical facilities first by kind', () => {
    const run = makeRun();
    const rows = facilityRows(topo, run.frames[3]);
    expect(rows.map((r) => r.id)).toEqual(['hosp', 'ps', 'sub']);
    expect(rows[0]).toMatchObject({ name: 'City Hospital', power: 'backup', water: 'low-pressure', status: 'at-risk', detail: 'hosp detail' });
    expect(rows[1]).toMatchObject({ name: 'Pumping Station PS-2', power: 'offline', status: 'affected' });
  });
  it('omits facilities missing from the frame', () => {
    const f = makeFrame({ min: 0, stage: 'ready' });
    const rows = facilityRows(topo, { ...f, facilities: f.facilities.filter((x) => x.id !== 'sub') });
    expect(rows.map((r) => r.id)).toEqual(['hosp', 'ps']);
  });
});

describe('other derivations', () => {
  it('reads facility pressure from its water node', () => {
    const f = makeFrame({ min: 0, stage: 'ready', pressure: 27.5 });
    expect(facilityPressure(topo, f, 'hosp')).toBe(27.5);
    expect(facilityPressure(topo, f, 'sub')).toBeNull();
  });
  it('sums service connections at buses without supply', () => {
    expect(connectionsWithoutSupply(topo, makeFrame({ min: 3, stage: 'fault-isolated', lost: true }))).toBe(60);
    expect(connectionsWithoutSupply(topo, makeFrame({ min: 0, stage: 'ready' }))).toBe(0);
  });
  it('prefers loaded run summaries over the comparison file', () => {
    const enc = makeRun('encirra');
    const other = { ...enc.summary, loadRestoredKW: 999 };
    const out = summariesByStrategy({ encirra: enc }, { summaries: { none: other, 'grid-only': other, encirra: other } });
    expect(out.encirra?.loadRestoredKW).toBe(200);
    expect(out.none?.loadRestoredKW).toBe(999);
  });
  it('sorts feasible candidates by rank before rejected ones', () => {
    const run = makeRun();
    const base = { actions: [], shedBuses: [], rejectedReasons: [], checks: [], scoreBreakdown: null, scoreGridOnly: null, rankGridOnly: null };
    const metrics = { restoredKW: 0, servedKW: 0, shedKW: 0, criticalRestored: 0, criticalTotal: 0, pumpsRestored: 0, waterDeliveredPct: 0, minCriticalPressureM: 0, tankMinPct: 0, vMinPu: null, maxLoadingPct: null, switchOps: 0 };
    run.candidates = [
      { ...base, id: 'C3', label: '', feasible: false, metrics, scoreEncirra: null, rankEncirra: null },
      { ...base, id: 'C2', label: '', feasible: true, metrics, scoreEncirra: 5, rankEncirra: 2 },
      { ...base, id: 'C1', label: '', feasible: true, metrics, scoreEncirra: 9, rankEncirra: 1 },
    ];
    expect(sortedCandidates(run).map((c) => c.id)).toEqual(['C1', 'C2', 'C3']);
  });
});

describe('impact: Encirra vs Grid-only', () => {
  const enc = makeRun('encirra');
  const grid = makeRun('grid-only', { plan: makePlan({ strategy: 'grid-only', label: 'Close SW-01-02', appliedAtT: null, outcome: 'partial' }) });
  grid.summary = { ...grid.summary, loadRestoredKW: 100, remainingUnservedKW: 100, pumpsAvailableEnd: 0 };

  it('counts minutes a facility is below the service threshold from the frames', () => {
    expect(facilityMinutesBelowService(enc, topo, 'hosp')).toBe(4); // frames 2–5 at 18 m
    expect(facilityMinutesBelowService(grid, topo, 'hosp')).toBe(6); // never restored: frames 2–7
    expect(facilityMinutesBelowService(enc, topo, 'sub')).toBeNull();
  });
  it('pairs both strategies with signed deltas and verdicts', () => {
    const m = impactComparison({ encirra: enc, 'grid-only': grid }, null, topo)!;
    const row = (k: string) => m.rows.find((r) => r.key === k)!;
    expect(row('hospital-water')).toMatchObject({ grid: 6, encirra: 4, verdict: 'better', deltaText: '−2 min', label: 'Hospital water outage' });
    expect(row('restored')).toMatchObject({ grid: 50, encirra: 100, verdict: 'better', deltaText: '+50.0 pts' });
    expect(row('pumps')).toMatchObject({ grid: 0, encirra: 1, verdict: 'better', deltaText: '+1', encirraText: '1/1' });
    expect(row('violations')).toMatchObject({ verdict: 'same', deltaText: 'Same' });
    expect(m.samePlan).toBe(false);
    expect(m.allSame).toBe(false);
  });
  it('reports "same plan" honestly when both strategies converge', () => {
    const m = impactComparison({ encirra: enc, 'grid-only': makeRun('grid-only') }, null, topo)!;
    expect(m.samePlan).toBe(true);
    expect(m.allSame).toBe(true);
    expect(m.rows.every((r) => r.deltaText === 'Same')).toBe(true);
  });
  it('marks a row where Grid-only does better as worse (never hidden)', () => {
    const better = makeRun('grid-only');
    better.summary = { ...better.summary, loadRestoredKW: 300, remainingUnservedKW: 0 };
    const enc2 = makeRun('encirra');
    enc2.summary = { ...enc2.summary, loadRestoredKW: 180, remainingUnservedKW: 20 };
    const r = impactComparison({ encirra: enc2, 'grid-only': better }, null, topo)!.rows.find((x) => x.key === 'restored')!;
    expect(r.verdict).toBe('worse');
    expect(r.deltaText).toBe('−10.0 pts');
  });
  it('falls back to the comparison summaries when runs are missing', () => {
    const m = impactComparison({}, { summaries: { none: enc.summary, 'grid-only': grid.summary, encirra: enc.summary } }, topo)!;
    expect(m.rows[0].label).toBe('Critical water outage');
    expect(m.rows[0].encirra).toBe(enc.summary.minutesBelowServicePressure);
  });
});

describe('incidentModel (left rail hero)', () => {
  it('is green before the fault', () => {
    expect(incidentModel(makeRun('encirra'), topo, 0)).toMatchObject({ tone: 'ok', title: 'Normal operation', active: false });
  });
  it('reports a critical facility below the service pressure first', () => {
    const m = incidentModel(makeRun('encirra'), topo, 3);
    expect(m.tone).toBe('fault');
    expect(m.title).toBe('City Hospital below 20 m');
    expect(m.sentence).toBe('Feeder F3 tripped at 17:02: 200 kW and Pumping Station PS-2 lost supply.');
  });
  it('turns green only when a verified plan restored every critical facility and pump', () => {
    expect(incidentModel(makeRun('encirra'), topo, 6)).toMatchObject({ tone: 'ok', title: 'Recovery complete' });
  });
  it('shows the stage, the stopped pump and a grey baseline when pressure holds', () => {
    const frames = [0, 1, 2, 3, 4].map((m) =>
      makeFrame({ min: m, stage: m >= 3 ? 'no-intervention' : m >= 2 ? 'fault-detected' : 'ready', lost: m >= 2, pressure: 30 }),
    );
    const none = makeRun('none', { frames });
    expect(incidentModel(none, topo, 2)).toMatchObject({ tone: 'fault', title: 'Feeder fault detected' });
    const m = incidentModel(none, topo, 3);
    expect(m).toMatchObject({ tone: 'neutral', title: 'Outage persists · baseline' });
    expect(m.watch).toBe('PS-2 stopped · Tank T2 at 67%');
  });
});

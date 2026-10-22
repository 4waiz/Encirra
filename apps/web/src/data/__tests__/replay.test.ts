/**
 * Cross-checks the dashboard's frame-level derivations against the simulation engine's own run
 * summaries for every bundled replay run (apps/web/public/replay). Skipped when no replay exists.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NetworkTopology, ReplayManifest, RunResult } from '@encirra/shared';
import { criticalProgress, facilityMinutesBelowService, facilityRows, faultCardModel, frameIndexAtT, impactComparison, recoveryCardModel, restoredShare, runMarks, summaryRestoredShare, timelineStatus } from '../selectors';

const dir = resolve(__dirname, '../../../public/replay');
const has = existsSync(join(dir, 'manifest.json'));
const read = <T,>(p: string): T => JSON.parse(readFileSync(join(dir, p), 'utf8')) as T;

const manifest = has ? read<ReplayManifest>('manifest.json') : null;
const topology = has && manifest ? read<NetworkTopology>(manifest.topology) : null;
const runs: RunResult[] = has && manifest ? manifest.scenarios.flatMap((s) => Object.values(s.runs).map((p) => read<RunResult>(p))) : [];

describe.skipIf(!has)('derivations agree with the engine summaries (bundled replay)', () => {
  it.each(runs.map((r) => [`${r.scenarioId}/${r.strategy}`, r] as const))('%s', (_, run) => {
    const topo = topology!;
    const s = run.summary;
    const last = run.frames.length - 1;
    const end = run.frames[last];

    // restored share on the System Recovery card at the last frame = the Reports value from the summary
    expect(end.power.restoredKW).toBeCloseTo(s.loadRestoredKW, 0);
    expect(end.power.unservedKW).toBeCloseTo(s.remainingUnservedKW, 0);
    expect(restoredShare(end) ?? 0).toBeCloseTo(summaryRestoredShare(s) ?? 0, 0);
    // …and the engine's own percentage when nothing outside the interrupted area is shed
    const shedOutside = end.power.busShed.some((sh, i) => sh && run.frames[frameIndexAtT(run, runMarks(run).faultT ?? 0)].power.busState[i] === 'energized');
    if (!shedOutside) expect(restoredShare(end) ?? 0).toBeCloseTo(s.loadRestoredPct, 0);

    // critical facilities: run-level at-risk set and recovered count
    const crit = criticalProgress(run, topo, last);
    expect(crit.atRisk).toBe(s.criticalAtRisk);
    expect(crit.recovered).toBe(s.criticalRecovered);
    expect(recoveryCardModel(run, topo, last).metrics).toMatchObject({ criticalAtRisk: s.criticalAtRisk, criticalRecovered: s.criticalRecovered });

    // fault card after the fault shows the summary's impact numbers
    const marks = runMarks(run, topo.water.serviceThresholdM);
    expect(marks.faultT).not.toBeNull();
    const kf = frameIndexAtT(run, marks.faultT!);
    expect(run.frames[kf].clock).toBe(s.faultClock);
    const fault = faultCardModel(run, topo, end);
    expect(fault.active).toBe(true);
    expect(fault.metrics.loadInterruptedKW).toBe(s.loadInterruptedKW);
    expect(fault.metrics.pumpsOffline).toBe(s.pumpsOffline);

    // pumps at the end, pressure delay window
    expect(end.water.pumpsOnline).toBe(s.pumpsAvailableEnd);
    if (s.hydraulicDelayMin != null && marks.pumpTripT != null && marks.pressureBelowT != null) {
      expect((marks.pressureBelowT - marks.pumpTripT) / 60).toBeCloseTo(s.hydraulicDelayMin, 6);
    }

    // timeline fully resolved at the end; every facility in the frame is listed in the table
    expect(timelineStatus(run.timeline, end.t).some((x) => x.status === 'pending' || x.status === 'active')).toBe(false);
    expect(facilityRows(topo, end)).toHaveLength(end.facilities.length);
  });
});

describe.skipIf(!has)('impact card agrees with the engine summaries (bundled replay)', () => {
  const scenarios = manifest ? manifest.scenarios.map((sc) => sc.definition.id) : [];
  it.each(scenarios.map((id) => [id] as const))('%s', (id) => {
    const topo = topology!;
    const byStrategy = Object.fromEntries(runs.filter((r) => r.scenarioId === id).map((r) => [r.strategy, r]));
    const m = impactComparison(byStrategy, null, topo)!;
    const hospital = topo.facilities.find((f) => f.kind === 'hospital')!;
    for (const s of ['grid-only', 'encirra'] as const) {
      const run = byStrategy[s];
      // hospital minutes from frames never exceed the engine's "any critical facility" minutes
      expect(facilityMinutesBelowService(run, topo, hospital.id)!).toBeLessThanOrEqual(run.summary.minutesBelowServicePressure + 1e-6);
    }
    const row = (k: string) => m.rows.find((r) => r.key === k)!;
    expect(row('restored').encirra).toBeCloseTo(summaryRestoredShare(byStrategy.encirra.summary)!, 6);
    expect(row('pumps').grid).toBe(byStrategy['grid-only'].summary.pumpsAvailableEnd);
    expect(row('violations').encirra).toBe(byStrategy.encirra.summary.constraintViolations);
    // identical plans must read as identical outcomes
    if (m.samePlan) expect(m.allSame).toBe(true);
  });
});

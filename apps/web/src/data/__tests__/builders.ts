/**
 * Tiny, contract-shaped test data (3 buses, 2 lines + 1 tie, 1 pump, 1 tank, 2 junctions,
 * 3 facilities). Values are arbitrary test inputs, chosen to exercise the derivations.
 */
import type { ElementState, FacilityState, Frame, NetworkTopology, RecoveryPlan, RunResult, StageId, StrategyId, TimelineStep } from '@encirra/shared';

export function makeTopology(): NetworkTopology {
  return {
    schemaVersion: 1,
    district: { id: 'D-T', name: 'Test district', label: 'test', disclaimer: 'test' },
    electrical: {
      benchmark: 'test',
      baseKV: 12.66,
      substationBus: 0,
      limits: { vMinPu: 0.9, vMaxPu: 1.05, vSoftMinPu: 0.95, loadingMaxPct: 100 },
      buses: [
        { id: 0, number: 1, name: 'B1', feeder: 'S1', vnKV: 12.66, loadKW: 0, loadKVAr: 0, connections: 0, critical: false, facilityIds: ['sub'], pos: [0, 0], label: 'sub' },
        { id: 1, number: 2, name: 'B2', feeder: 'F1', vnKV: 12.66, loadKW: 100, loadKVAr: 50, connections: 40, critical: false, facilityIds: [], pos: [10, 0], label: 'load' },
        { id: 2, number: 3, name: 'B3', feeder: 'F3', vnKV: 12.66, loadKW: 200, loadKVAr: 80, connections: 60, critical: true, facilityIds: ['hosp', 'ps'], pos: [20, 0], label: 'hospital' },
      ],
      lines: [
        { id: 0, from: 0, to: 1, kind: 'feeder', feeder: 'F1', rOhm: 0.1, xOhm: 0.05, ratingA: 300, normallyOpen: false, switchId: 'SW-01-02' },
        { id: 1, from: 1, to: 2, kind: 'feeder', feeder: 'F3', rOhm: 0.1, xOhm: 0.05, ratingA: 300, normallyOpen: false, switchId: 'SW-02-03' },
        { id: 2, from: 0, to: 2, kind: 'tie', feeder: 'tie', rOhm: 0.2, xOhm: 0.1, ratingA: 200, normallyOpen: true, switchId: 'SW-01-03' },
      ],
      switches: [
        { id: 'SW-01-02', lineId: 0, kind: 'breaker', normallyOpen: false, remote: true },
        { id: 'SW-02-03', lineId: 1, kind: 'sectionalizer', normallyOpen: false, remote: true },
        { id: 'SW-01-03', lineId: 2, kind: 'tie', normallyOpen: true, remote: true },
      ],
      feeders: [
        { id: 'F1', name: 'Feeder F1', description: '', buses: [1] },
        { id: 'F3', name: 'Feeder F3', description: '', buses: [2] },
      ],
      nominalLoadKW: 300,
      nominalLoadKVAr: 130,
    },
    water: {
      model: 'test',
      requiredPressureM: 20,
      minimumPressureM: 0,
      serviceThresholdM: 20,
      junctions: [
        { id: 'J-H', label: 'Hospital node', zone: 'West', elevationM: 10, baseDemandLps: 2, critical: true, facilityId: 'hosp', connections: 1, pos: [20, -6, 0] },
        { id: 'J-PSD', label: 'PS discharge', zone: 'West', elevationM: 10, baseDemandLps: 0, critical: false, facilityId: null, connections: 0, pos: [30, -6, 0] },
      ],
      reservoirs: [{ id: 'R1', label: 'R1', headM: 14, pos: [40, -20, 0], facilityId: null }],
      tanks: [{ id: 'T2', label: 'Tank T2', zone: 'West', elevationM: 44, minLevelM: 1, maxLevelM: 7, initLevelM: 5, diameterM: 8, pos: [0, 0, 0], facilityId: null }],
      pipes: [],
      pumps: [{ id: 'PU-2', label: 'PS duty pump', from: 'R1', to: 'J-PSD', stationId: 'ps', bus: 2, designFlowLps: 50, designHeadM: 46, efficiency: 0.74, ratedKW: 37 }],
    },
    facilities: [
      { id: 'sub', name: 'Substation', kind: 'substation', critical: true, bus: 0, waterNode: null, backup: null, pos: [0, 0], description: '' },
      { id: 'hosp', name: 'City Hospital', kind: 'hospital', critical: true, bus: 2, waterNode: 'J-H', backup: { kind: 'genset', kW: 150, hours: 8, coversWater: false }, pos: [20, 0], description: '' },
      { id: 'ps', name: 'Pumping Station PS-2', kind: 'pump-station', critical: true, bus: 2, waterNode: 'J-PSD', pumps: ['PU-2'], backup: null, pos: [30, 0], description: '' },
    ],
  };
}

interface FrameSpec {
  min: number;
  stage: StageId;
  lost?: boolean; // bus 2 without supply
  restored?: boolean; // bus 2 restored by the plan
  pumpOn?: boolean;
  pressure?: number; // hospital node pressure
  tankPct?: number;
  facilities?: Partial<Record<string, Partial<FacilityState>>>;
}

export function makeFrame(f: FrameSpec): Frame {
  const busState: ElementState[] = ['energized', 'energized', f.restored ? 'restored' : f.lost ? 'deenergized' : 'energized'];
  const served2 = f.lost && !f.restored ? 0 : 200;
  const pumpOn = f.pumpOn ?? !(f.lost && !f.restored);
  const p = f.pressure ?? 30;
  const fac = (id: string, def: FacilityState): FacilityState => ({ ...def, ...(f.facilities?.[id] ?? {}), id });
  return {
    t: f.min * 60,
    clock: `17:${String(f.min).padStart(2, '0')}`,
    stage: f.stage,
    power: {
      busVmPu: [1, 0.98, served2 ? 0.96 : null],
      busState,
      busServedKW: [0, 100, served2],
      busShed: [false, false, false],
      lineState: ['energized', f.lost && !f.restored ? 'faulted' : 'energized', f.restored ? 'restored' : 'open'],
      lineLoadingPct: [40, served2 ? 30 : null, null],
      lineFlowKW: [300, served2 ? 200 : null, null],
      switchClosed: [true, !(f.lost && !f.restored), !!f.restored],
      demandKW: 300,
      servedKW: 100 + served2,
      unservedKW: 200 - served2,
      restoredKW: f.restored ? 200 : 0,
      lossesKW: 5,
      pumpKW: pumpOn ? 30 : 0,
      criticalUnservedKW: served2 ? 0 : 200,
      vMinPu: served2 ? 0.96 : 0.98,
      vMinBus: served2 ? 2 : 1,
      vMaxPu: 1,
      voltageViolations: 0,
      voltageAdvisories: 0,
      thermalViolations: 0,
      converged: true,
    },
    water: {
      junctionPressureM: [p, p + 5],
      junctionDeliveredLps: [p >= 20 ? 2 : 1, 0],
      junctionRequiredLps: [2, 0],
      pipeFlowLps: [],
      pipeVelocityMs: [],
      pipeOpen: [],
      pumpOn: [pumpOn],
      pumpFlowLps: [pumpOn ? 50 : 0],
      pumpHeadM: [pumpOn ? 46 : 0],
      pumpPowerKW: [pumpOn ? 30 : 0],
      tankLevelM: [1 + ((f.tankPct ?? 67) / 100) * 6],
      tankPct: [f.tankPct ?? 67],
      requiredLps: 2,
      deliveredLps: p >= 20 ? 2 : 1,
      deliveredPct: p >= 20 ? 100 : 50,
      minPressureM: p,
      minPressureNode: 'J-H',
      criticalPressureM: p,
      nodesBelowService: p < 20 ? 1 : 0,
      connectionsInterrupted: p < 20 ? 1 : 0,
      pumpsOnline: pumpOn ? 1 : 0,
      pumpsTotal: 1,
    },
    facilities: [
      fac('sub', { id: 'sub', power: 'online', water: 'n/a', status: 'safe', detail: '' }),
      fac('hosp', { id: 'hosp', power: f.restored ? 'restored' : f.lost ? 'backup' : 'online', water: p < 20 ? 'low-pressure' : 'normal', status: f.restored ? 'restored' : f.lost ? 'at-risk' : 'safe', detail: 'hosp detail' }),
      fac('ps', { id: 'ps', power: f.restored ? 'restored' : f.lost ? 'offline' : 'online', water: 'normal', status: f.restored ? 'restored' : f.lost ? 'affected' : 'safe', detail: '' }),
    ],
  };
}

const step = (id: TimelineStep['id'], label: string, min: number | null, outcome: TimelineStep['outcome']): TimelineStep => ({
  id,
  label,
  t: min == null ? null : min * 60,
  clock: min == null ? null : `17:${String(min).padStart(2, '0')}`,
  outcome,
  detail: '',
});

export function makePlan(over: Partial<RecoveryPlan> = {}): RecoveryPlan {
  return {
    candidateId: 'C01',
    strategy: 'encirra',
    label: 'Close SW-01-03',
    actions: [{ switchId: 'SW-01-03', lineId: 2, action: 'close', reason: 'back-feed' }],
    shedBuses: [],
    verification: { passed: true, status: 'simulation-verified', checks: [], method: 'independent re-solve' },
    score: 10,
    scoreBreakdown: { servedLoad: 5, criticalLoad: 3, waterDelivered: 1, criticalWater: 1, pressureStorage: 0.5, switchingCost: -0.5, total: 10 },
    outcome: 'complete',
    verifiedAtT: 4 * 60,
    appliedAtT: 6 * 60,
    rationale: [],
    protectedFacilities: ['hosp'],
    unservedAfter: { buses: [], kW: 0, facilities: [] },
    assumptions: [],
    ...over,
  };
}

/** Run: fault at 17:02, isolation 17:03, evaluated 17:04 (verified), restored 17:06 (encirra). */
export function makeRun(strategy: StrategyId = 'encirra', over: { plan?: RecoveryPlan | null; frames?: Frame[]; timeline?: TimelineStep[] } = {}): RunResult {
  const plan = over.plan === undefined ? (strategy === 'none' ? null : makePlan({ strategy })) : over.plan;
  const restoreMin = plan?.appliedAtT != null ? plan.appliedAtT / 60 : Infinity;
  const frames =
    over.frames ??
    [0, 1, 2, 3, 4, 5, 6, 7].map((m) => {
      const lost = m >= 2;
      const restored = lost && m >= restoreMin;
      let stage: StageId = 'ready';
      if (m >= 2) stage = 'fault-detected';
      if (m >= 3) stage = strategy === 'none' ? 'no-intervention' : 'fault-isolated';
      if (m >= 4 && strategy !== 'none') stage = 'verification-completed';
      if (m >= 5 && strategy !== 'none') stage = 'recovery-applied';
      if (restored) stage = plan?.outcome === 'partial' ? 'partially-restored' : 'recovery-complete';
      return makeFrame({ min: m, stage, lost, restored, pressure: lost && !restored ? 18 : 30, tankPct: lost && !restored ? 50 : 67 });
    });
  const none = strategy === 'none';
  return {
    schemaVersion: 1,
    runId: `test-${strategy}`,
    scenarioId: 'feeder-fault',
    strategy,
    params: {
      loadMultiplier: 1,
      waterDemandMultiplier: 1,
      faultLineId: 1,
      faultTimeMin: 2,
      isolationDelayMin: 1,
      analysisDelayMin: 1,
      switchingDelayMin: 2,
      tankInitPct: 67,
      horizonMin: 7,
      stepMin: 1,
      repairTimeMin: null,
      seed: 1,
    },
    weights: { servedLoad: 1, criticalLoad: 2, waterDelivered: 1, criticalWater: 2, pressureStorage: 1, switchingCost: 0.5 },
    provenance: {
      engine: 'encirra-sim',
      engineVersion: 'test',
      pandapower: 'x',
      wntr: 'x',
      python: 'x',
      electricalSolver: 'x',
      hydraulicSolver: 'x',
      coupling: 'x',
      seed: 1,
      computedAt: '2026-01-01T00:00:00Z',
      computeMs: 1,
      source: 'replay',
    },
    timebase: { startClock: '17:00', startISO: '2026-04-28T17:00:00+04:00', stepSeconds: 60, steps: frames.length },
    events: [
      { id: 'e1', t: 120, clock: '17:02', stage: 'fault-detected', kind: 'fault', severity: 'critical', title: 'Fault', detail: '' },
      { id: 'e2', t: 180, clock: '17:03', stage: 'fault-isolated', kind: 'isolation', severity: 'warning', title: 'Isolated', detail: '' },
    ],
    timeline: over.timeline ?? [
      step('fault-detected', 'Fault detected', 2, 'done'),
      step('fault-isolated', 'Fault isolated', 3, 'done'),
      step('recovery-evaluated', 'Recovery evaluated', none ? null : 4, none ? 'skipped' : 'done'),
      step('constraints-verified', 'Constraints verified', none ? null : 4, none ? 'skipped' : 'done'),
      step('service-restored', 'Service restored', none ? null : 6, none ? 'skipped' : plan?.outcome === 'partial' ? 'partial' : 'done'),
    ],
    frames,
    plan,
    candidates: [],
    summary: {
      faultLabel: 'Feeder F3 · line B2–B3',
      faultLineId: 1,
      faultClock: '17:02',
      feederId: 'F3',
      loadInterruptedKW: 200,
      connectionsAffected: 60,
      pumpsOffline: 1,
      criticalAtRisk: 2,
      loadRestoredKW: none ? 0 : 200,
      loadRestoredPct: none ? 0 : 100,
      remainingUnservedKW: none ? 200 : 0,
      criticalRecovered: none ? 0 : 2,
      criticalTotal: 2,
      pumpsAvailableEnd: none ? 0 : 1,
      pumpsTotal: 1,
      servedEnergyKWh: 30,
      unservedEnergyKWh: 5,
      criticalUnservedKWh: 5,
      waterRequiredM3: 1,
      waterDeliveredM3: 0.9,
      waterDeliveredPct: 90,
      minPressureM: 18,
      minCriticalPressureM: 18,
      tankMinPct: 50,
      minutesBelowServicePressure: 4,
      hydraulicDelayMin: 0,
      constraintViolations: 0,
      switchOps: none ? 0 : 1,
      planComputeMs: 12,
      candidatesEvaluated: 3,
      candidatesRejected: 1,
      outcome: none ? 'no-intervention' : (plan?.outcome ?? 'infeasible'),
    },
  };
}

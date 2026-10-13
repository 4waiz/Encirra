/**
 * TEMPORARY DEVELOPMENT FIXTURE — not solver output.
 *
 * Used only by the dev server (import.meta.env.DEV) while /replay/manifest.json does not exist yet,
 * and always shown with a visible "DEV FIXTURE" badge. It is shaped exactly like the contract so the
 * dashboard can be built before the simulation service publishes replay files. Delete this file once
 * apps/web/public/replay/ is populated; it is never part of a production build.
 */
import { district } from '@encirra/shared';
import type {
  BusInfo,
  CandidateEvaluation,
  Comparison,
  ElementState,
  FacilityInfo,
  FacilityKind,
  FacilityState,
  FeederId,
  Frame,
  LineInfo,
  NetworkTopology,
  ObjectiveWeights,
  PipeInfo,
  RecoveryPlan,
  ReplayManifest,
  RunResult,
  RunSummary,
  ScenarioDefinition,
  ScenarioId,
  ScenarioParams,
  SimEvent,
  StageId,
  StrategyId,
  SwitchInfo,
  SwitchKind,
  TimelineStep,
  VerificationCheck,
} from '@encirra/shared';

const STRATS: StrategyId[] = ['none', 'grid-only', 'encirra'];
const WEIGHTS: ObjectiveWeights = { servedLoad: 1, criticalLoad: 4, waterDelivered: 2, criticalWater: 5, pressureStorage: 1, switchingCost: 0.5 };

function buildTopology(): NetworkTopology {
  const e = district.electrical;
  const w = district.water;
  const facilities: FacilityInfo[] = district.facilities.map((f) => ({
    id: f.id,
    name: f.name,
    kind: f.kind as FacilityKind,
    critical: f.critical,
    bus: f.bus == null ? null : f.bus - 1,
    waterNode: f.waterNode,
    pumps: (f as { pumps?: string[] }).pumps,
    backup: f.backup as FacilityInfo['backup'],
    pos: f.pos as [number, number],
    description: f.description,
  }));
  const buses: BusInfo[] = e.buses.map((b) => ({
    id: b.number - 1,
    number: b.number,
    name: b.name,
    feeder: b.feeder as FeederId | 'S1',
    vnKV: e.baseKV,
    loadKW: b.loadKW,
    loadKVAr: b.loadKVAr,
    connections: b.connections,
    critical: b.critical,
    facilityIds: district.facilities.filter((f) => f.bus === b.number).map((f) => f.id),
    pos: b.pos as [number, number],
    label: b.label,
  }));
  const lines: LineInfo[] = e.lines.map((l) => ({
    id: l.id,
    from: l.from - 1,
    to: l.to - 1,
    kind: l.kind as LineInfo['kind'],
    feeder: l.feeder as LineInfo['feeder'],
    rOhm: 0,
    xOhm: 0,
    ratingA: l.ratingA,
    normallyOpen: l.normallyOpen,
    switchId: l.switch.id,
  }));
  const switches: SwitchInfo[] = e.lines.map((l) => ({
    id: l.switch.id,
    lineId: l.id,
    kind: l.switch.kind as SwitchKind,
    normallyOpen: l.normallyOpen,
    remote: l.switch.remote,
  }));
  return {
    schemaVersion: 1,
    district: { id: district.district.id, name: district.district.name, label: district.district.label, disclaimer: district.district.disclaimer },
    electrical: {
      benchmark: e.benchmark,
      baseKV: e.baseKV,
      substationBus: e.substationBus - 1,
      limits: e.limits,
      buses,
      lines,
      switches,
      feeders: e.feeders.map((f) => ({ id: f.id as FeederId, name: f.name, description: f.description, buses: f.buses.map((n) => n - 1) })),
      nominalLoadKW: buses.reduce((a, b) => a + b.loadKW, 0),
      nominalLoadKVAr: buses.reduce((a, b) => a + b.loadKVAr, 0),
    },
    water: {
      model: w.model,
      requiredPressureM: w.options.requiredPressureM,
      minimumPressureM: w.options.minimumPressureM,
      serviceThresholdM: w.options.serviceThresholdM,
      junctions: w.junctions.map((j) => ({ ...j, zone: j.zone as 'West' | 'East', pos: j.pos as [number, number, number] })),
      reservoirs: w.reservoirs.map((r) => ({ ...r, pos: r.pos as [number, number, number] })),
      tanks: w.tanks.map((t) => ({ ...t, zone: t.zone as 'West' | 'East', pos: t.pos as [number, number, number] })),
      pipes: w.pipes.map((p) => ({ ...p, kind: p.kind as PipeInfo['kind'], initialStatus: p.initialStatus as 'open' | 'closed', route: p.route as [number, number, number][] })),
      pumps: w.pumps.map((p) => ({ ...p, bus: p.bus - 1 })),
    },
    facilities,
  };
}

const DEFAULTS: ScenarioParams = {
  loadMultiplier: 1,
  waterDemandMultiplier: 1,
  faultLineId: 25,
  faultTimeMin: 8,
  isolationDelayMin: 2,
  analysisDelayMin: 2,
  switchingDelayMin: 4,
  tankInitPct: 67,
  horizonMin: 120,
  stepMin: 1,
  repairTimeMin: null,
  seed: 33,
};

const SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'feeder-fault',
    name: 'Electrical Feeder Failure',
    shortName: 'Feeder fault',
    description: 'DEV FIXTURE — placeholder narrative until replay files are published.',
    narrative: ['DEV FIXTURE placeholder: fault on Feeder F3.', 'Replace with solver output.'],
    defaults: DEFAULTS,
    faultOptions: [{ lineId: 25, label: 'Feeder F3 · B26–B27' }],
    editable: ['loadMultiplier', 'waterDemandMultiplier', 'faultLineId', 'faultTimeMin', 'tankInitPct'],
  },
  {
    id: 'pump-power-loss',
    name: 'Pumping Station Power Loss',
    shortName: 'Pump power loss',
    description: 'DEV FIXTURE — placeholder narrative until replay files are published.',
    narrative: ['DEV FIXTURE placeholder.'],
    defaults: { ...DEFAULTS, faultLineId: 31 },
    faultOptions: [{ lineId: 31, label: 'Feeder F3 · B32–B33' }],
    editable: ['faultTimeMin', 'tankInitPct'],
  },
  {
    id: 'high-demand',
    name: 'Peak-Demand Heatwave',
    shortName: 'High demand',
    description: 'DEV FIXTURE — placeholder narrative until replay files are published.',
    narrative: ['DEV FIXTURE placeholder.'],
    defaults: { ...DEFAULTS, loadMultiplier: 1.2, waterDemandMultiplier: 1.25 },
    faultOptions: [{ lineId: 25, label: 'Feeder F3 · B26–B27' }],
    editable: ['loadMultiplier', 'waterDemandMultiplier'],
  },
];

const pad = (n: number) => String(n).padStart(2, '0');
const clockAt = (min: number) => `${pad(17 + Math.floor(min / 60))}:${pad(Math.floor(min % 60))}`;

function downstream(topo: NetworkTopology, faultLine: number): number[] {
  const line = topo.electrical.lines[faultLine];
  const adj = new Map<number, number[]>();
  for (const l of topo.electrical.lines) {
    if (l.normallyOpen || l.id === faultLine) continue;
    adj.set(l.from, [...(adj.get(l.from) ?? []), l.to]);
  }
  const out: number[] = [];
  const stack = [line.to];
  while (stack.length) {
    const b = stack.pop()!;
    out.push(b);
    stack.push(...(adj.get(b) ?? []));
  }
  return out;
}

function simulate(topo: NetworkTopology, def: ScenarioDefinition, strategy: StrategyId): RunResult {
  const p = def.defaults;
  const E = topo.electrical;
  const W = topo.water;
  const lost = new Set(downstream(topo, p.faultLineId));
  const faultLine = E.lines[p.faultLineId];
  const tie = strategy === 'grid-only' ? 35 : 36;
  const tFault = p.faultTimeMin;
  const tIso = tFault + p.isolationDelayMin;
  const tCand = tIso + p.analysisDelayMin;
  const tVer = tCand + 2;
  const tApplied = tVer + p.switchingDelayMin + (strategy === 'grid-only' ? 3 : 0);
  const shed = strategy === 'encirra' ? new Set([29]) : new Set<number>();
  const plan = strategy !== 'none';
  const pumpBus = new Map(W.pumps.map((pu, i) => [pu.bus, i]));
  const hops = (id: number) => (id === 0 ? 0 : Math.min(17, id % 18) + 1);
  const n = Math.floor(p.horizonMin / p.stepMin) + 1;
  const frames: Frame[] = [];
  let t2Level = W.tanks[1].initLevelM;
  let t1Level = W.tanks[0].initLevelM;
  const facilityEverLow = new Set<string>();

  for (let k = 0; k < n; k++) {
    const m = k * p.stepMin;
    const faulted = m >= tFault;
    const restored = plan && m >= tApplied;
    const restoring = plan && m >= tVer && !restored;
    const stage: StageId = !faulted
      ? 'ready'
      : m < tIso
        ? 'fault-detected'
        : !plan
          ? m < tIso + 1
            ? 'fault-isolated'
            : 'no-intervention'
          : m < tCand
            ? 'impact-evaluated'
            : m < tVer
              ? 'candidates-generated'
              : m < tApplied - 2
                ? 'verification-completed'
                : !restored
                  ? 'recovery-applied'
                  : strategy === 'encirra'
                    ? 'recovery-complete'
                    : 'partially-restored';
    const pumpOn = W.pumps.map((pu) => !(faulted && lost.has(pu.bus) && !restored));
    const pumpKW = W.pumps.map((pu, i) => (pumpOn[i] ? pu.ratedKW * 0.9 : 0));
    const busState: ElementState[] = E.buses.map((b) => {
      if (!faulted || !lost.has(b.id)) return 'energized';
      if (restored) return shed.has(b.id) ? 'deenergized' : 'restored';
      if (restoring) return shed.has(b.id) ? 'deenergized' : 'restoring';
      return 'deenergized';
    });
    const busVmPu = E.buses.map((b, i) => (busState[i] === 'deenergized' || busState[i] === 'restoring' ? null : +(1 - 0.0042 * hops(b.id) - (busState[i] === 'restored' ? 0.012 : 0)).toFixed(4)));
    const busServedKW = E.buses.map((b, i) => {
      if (busVmPu[i] == null) return 0;
      const pi = pumpBus.get(b.id);
      return b.loadKW * p.loadMultiplier + (pi != null ? pumpKW[pi] : 0);
    });
    const lineState: ElementState[] = E.lines.map((l) => {
      if (l.normallyOpen) return l.id === tie && restored ? 'restored' : l.id === tie && restoring ? 'restoring' : 'open';
      if (faulted && l.id === p.faultLineId) return 'faulted';
      if (faulted && lost.has(l.to)) return restored ? 'restored' : restoring ? 'restoring' : 'deenergized';
      return 'energized';
    });
    const switchClosed = E.lines.map((l) => (l.normallyOpen ? l.id === tie && restored : !(faulted && m >= tIso && l.id === p.faultLineId)));
    const demandKW = E.buses.reduce((a, b) => a + b.loadKW * p.loadMultiplier, 0) + W.pumps.reduce((a, pu) => a + pu.ratedKW * 0.9, 0);
    const servedKW = busServedKW.reduce((a, b) => a + b, 0);
    const lostKW = E.buses.filter((b) => lost.has(b.id)).reduce((a, b) => a + b.loadKW * p.loadMultiplier, 0);
    const restoredKW = restored ? E.buses.filter((b) => lost.has(b.id) && !shed.has(b.id)).reduce((a, b) => a + busServedKW[b.id], 0) : 0;
    const vs = busVmPu.map((v, i) => [v, i] as const).filter((x): x is readonly [number, number] => x[0] != null);
    const vmin = vs.reduce((a, b) => (b[0] < a[0] ? b : a), vs[0]);

    // tanks: T2 drains while PU-2 is off, refills when it runs
    if (!pumpOn[1]) t2Level = Math.max(W.tanks[1].minLevelM, t2Level - 0.17);
    else t2Level = Math.min(W.tanks[1].initLevelM, t2Level + (k > 0 && faulted ? 0.12 : 0));
    if (!pumpOn[0]) t1Level = Math.max(W.tanks[0].minLevelM, t1Level - 0.1);
    const westHGL = t2Level > W.tanks[1].minLevelM + 0.05 ? W.tanks[1].elevationM + t2Level : 24;
    const eastHGL = W.tanks[0].elevationM + t1Level;
    const junctionPressureM = W.junctions.map((j) => +Math.max(0, (j.zone === 'West' ? westHGL : eastHGL) - j.elevationM - (j.critical ? 2 : 0)).toFixed(2));
    const junctionRequiredLps = W.junctions.map((j) => j.baseDemandLps * p.waterDemandMultiplier);
    const junctionDeliveredLps = W.junctions.map((_, i) => {
      const pr = junctionPressureM[i];
      const f = pr >= W.requiredPressureM ? 1 : Math.sqrt(Math.max(0, pr) / W.requiredPressureM);
      return +(junctionRequiredLps[i] * f).toFixed(3);
    });
    const demandIdx = W.junctions.map((j, i) => (j.baseDemandLps > 0 ? i : -1)).filter((i) => i >= 0);
    const minIdx = demandIdx.reduce((a, b) => (junctionPressureM[b] < junctionPressureM[a] ? b : a), demandIdx[0]);
    const critIdx = W.junctions.map((j, i) => (j.critical ? i : -1)).filter((i) => i >= 0);
    const critP = Math.min(...critIdx.map((i) => junctionPressureM[i]));
    const requiredLps = junctionRequiredLps.reduce((a, b) => a + b, 0);
    const deliveredLps = junctionDeliveredLps.reduce((a, b) => a + b, 0);
    const below = demandIdx.filter((i) => junctionPressureM[i] < W.serviceThresholdM);

    const facilities: FacilityState[] = topo.facilities.map((f) => {
      const bs = f.bus == null ? null : busState[f.bus];
      const power = bs == null ? 'external' : bs === 'energized' ? 'online' : bs === 'restored' ? 'restored' : f.backup ? 'backup' : 'offline';
      const ji = W.junctions.findIndex((j) => j.id === f.waterNode);
      let water: FacilityState['water'] = 'n/a';
      if (ji >= 0) {
        const pr = junctionPressureM[ji];
        if (pr < W.serviceThresholdM) facilityEverLow.add(f.id);
        water = pr >= W.serviceThresholdM ? (facilityEverLow.has(f.id) ? 'restored' : 'normal') : pr > 2 ? 'low-pressure' : 'no-flow';
      }
      const status: FacilityState['status'] =
        power === 'offline' || water === 'no-flow'
          ? 'affected'
          : power === 'backup' || water === 'low-pressure'
            ? 'at-risk'
            : power === 'restored' || water === 'restored'
              ? 'restored'
              : 'safe';
      return { id: f.id, power, water, status, detail: `DEV FIXTURE · ${power} · ${ji >= 0 ? junctionPressureM[ji].toFixed(1) + ' m' : 'no water node'}` };
    });

    frames.push({
      t: m * 60,
      clock: clockAt(m),
      stage,
      power: {
        busVmPu,
        busState,
        busServedKW,
        busShed: E.buses.map((b) => restored && shed.has(b.id)),
        lineState,
        lineLoadingPct: E.lines.map((l) => (lineState[l.id] === 'energized' || lineState[l.id] === 'restored' ? 20 + ((l.id * 7) % 50) : null)),
        lineFlowKW: E.lines.map((l) => (lineState[l.id] === 'energized' || lineState[l.id] === 'restored' ? 400 - l.id * 9 : null)),
        switchClosed,
        demandKW,
        servedKW,
        unservedKW: Math.max(0, demandKW - servedKW),
        restoredKW,
        lossesKW: servedKW * 0.055,
        pumpKW: pumpKW.reduce((a, b) => a + b, 0),
        criticalUnservedKW: E.buses.filter((b) => b.critical && busServedKW[b.id] === 0).reduce((a, b) => a + b.loadKW, 0),
        vMinPu: vmin ? vmin[0] : null,
        vMinBus: vmin ? vmin[1] : null,
        vMaxPu: 1,
        voltageViolations: 0,
        voltageAdvisories: vs.filter((x) => x[0] < E.limits.vSoftMinPu).length,
        thermalViolations: 0,
        converged: true,
      },
      water: {
        junctionPressureM,
        junctionDeliveredLps,
        junctionRequiredLps,
        pipeFlowLps: W.pipes.map((pp, i) => (pp.initialStatus === 'open' ? 5 + (i % 7) : 0)),
        pipeVelocityMs: W.pipes.map((pp) => (pp.initialStatus === 'open' ? 0.4 : 0)),
        pipeOpen: W.pipes.map((pp) => pp.initialStatus === 'open'),
        pumpOn,
        pumpFlowLps: W.pumps.map((pu, i) => (pumpOn[i] ? pu.designFlowLps : 0)),
        pumpHeadM: W.pumps.map((pu, i) => (pumpOn[i] ? pu.designHeadM : 0)),
        pumpPowerKW: pumpKW,
        tankLevelM: [t1Level, t2Level],
        tankPct: W.tanks.map((tk, i) => (100 * ([t1Level, t2Level][i] - tk.minLevelM)) / (tk.maxLevelM - tk.minLevelM)),
        requiredLps,
        deliveredLps,
        deliveredPct: (100 * deliveredLps) / requiredLps,
        minPressureM: junctionPressureM[minIdx],
        minPressureNode: W.junctions[minIdx].id,
        criticalPressureM: critP,
        nodesBelowService: below.length,
        connectionsInterrupted: below.reduce((a, i) => a + W.junctions[i].connections, 0),
        pumpsOnline: pumpOn.filter(Boolean).length,
        pumpsTotal: W.pumps.length,
      },
      facilities,
    });
  }

  const ev = (id: string, m: number, stage: StageId, kind: SimEvent['kind'], severity: SimEvent['severity'], title: string, detail: string): SimEvent => ({ id, t: m * 60, clock: clockAt(m), stage, kind, severity, title, detail });
  const events: SimEvent[] = [
    ev('E1', tFault, 'fault-detected', 'fault', 'critical', 'Feeder fault detected', 'DEV FIXTURE event'),
    ev('E2', tIso, 'fault-isolated', 'isolation', 'warning', 'Faulted section isolated', 'DEV FIXTURE event'),
    ev('E3', tFault, 'fault-detected', 'hydraulic', 'warning', 'PU-2 tripped (loss of supply)', 'DEV FIXTURE event'),
  ];
  if (plan) {
    events.push(ev('E4', tCand, 'candidates-generated', 'candidates', 'info', 'Recovery candidates evaluated', 'DEV FIXTURE event'));
    events.push(ev('E5', tVer, 'verification-completed', 'verification', 'success', 'Plan verified', 'DEV FIXTURE event'));
    events.push(ev('E6', tApplied, strategy === 'encirra' ? 'recovery-complete' : 'partially-restored', 'restoration', 'success', 'Service restored', 'DEV FIXTURE event'));
  }
  const step = (id: TimelineStep['id'], label: string, m: number | null, outcome: TimelineStep['outcome']): TimelineStep => ({ id, label, t: m == null ? null : m * 60, clock: m == null ? null : clockAt(m), outcome, detail: 'DEV FIXTURE' });
  const timeline: TimelineStep[] = [
    step('fault-detected', 'Fault detected', tFault, 'done'),
    step('fault-isolated', 'Fault isolated', tIso, 'done'),
    step('recovery-evaluated', 'Recovery evaluated', plan ? tCand : null, plan ? 'done' : 'skipped'),
    step('constraints-verified', 'Constraints verified', plan ? tVer : null, plan ? 'done' : 'skipped'),
    step('service-restored', 'Service restored', plan ? tApplied : null, plan ? (strategy === 'encirra' ? 'done' : 'partial') : 'skipped'),
  ];
  const check = (id: string, name: string, passed: boolean, value: string, limit: string): VerificationCheck => ({ id, name, hard: true, passed, value, limit, detail: 'DEV FIXTURE check' });
  const okChecks = [
    check('pf-convergence', 'Power flow converges', true, 'converged', 'must converge'),
    check('voltage-band', 'Voltage within hard band', true, '0.921 pu', '≥ 0.90 pu'),
    check('radiality', 'Radial topology', true, 'radial', 'radial'),
    check('pressure-critical', 'Critical pressure', true, '31.0 m', '≥ 20 m'),
  ];
  const candidates: CandidateEvaluation[] = [
    { id: 'C01', label: 'Close SW-25-29 · shed B30 (DC-1)', actions: [{ switchId: 'SW-25-29', lineId: 36, action: 'close', reason: 'Back-feed F3 from F4' }], shedBuses: [29], feasible: true, rejectedReasons: [], checks: okChecks, metrics: { restoredKW: 1290, servedKW: 3580, shedKW: 200, criticalRestored: 2, criticalTotal: 2, pumpsRestored: 1, waterDeliveredPct: 99, minCriticalPressureM: 31, tankMinPct: 52, vMinPu: 0.921, maxLoadingPct: 71, switchOps: 2 }, scoreEncirra: 91.2, scoreGridOnly: 80.1, scoreBreakdown: { servedLoad: 30, criticalLoad: 25, waterDelivered: 18, criticalWater: 16, pressureStorage: 3.2, switchingCost: -1, total: 91.2 }, rankEncirra: 1, rankGridOnly: 2 },
    { id: 'C02', label: 'Close SW-18-33', actions: [{ switchId: 'SW-18-33', lineId: 35, action: 'close', reason: 'Back-feed F3 from F1' }], shedBuses: [], feasible: true, rejectedReasons: [], checks: okChecks, metrics: { restoredKW: 1490, servedKW: 3780, shedKW: 0, criticalRestored: 2, criticalTotal: 2, pumpsRestored: 1, waterDeliveredPct: 97, minCriticalPressureM: 24, tankMinPct: 31, vMinPu: 0.904, maxLoadingPct: 88, switchOps: 3 }, scoreEncirra: 84.0, scoreGridOnly: 86.3, scoreBreakdown: { servedLoad: 33, criticalLoad: 25, waterDelivered: 14, criticalWater: 11, pressureStorage: 2.5, switchingCost: -1.5, total: 84 }, rankEncirra: 2, rankGridOnly: 1 },
    { id: 'C03', label: 'Close SW-25-29 + SW-18-33', actions: [], shedBuses: [], feasible: false, rejectedReasons: ['Creates a loop (radiality check failed)'], checks: [check('radiality', 'Radial topology', false, 'meshed', 'radial')], metrics: { restoredKW: 1490, servedKW: 3780, shedKW: 0, criticalRestored: 2, criticalTotal: 2, pumpsRestored: 1, waterDeliveredPct: 99, minCriticalPressureM: 31, tankMinPct: 52, vMinPu: 0.93, maxLoadingPct: 60, switchOps: 3 }, scoreEncirra: null, scoreGridOnly: null, scoreBreakdown: null, rankEncirra: null, rankGridOnly: null },
  ];
  const chosen = strategy === 'encirra' ? candidates[0] : candidates[1];
  const recovery: RecoveryPlan | null = plan
    ? {
        candidateId: chosen.id,
        strategy,
        label: chosen.label,
        actions: chosen.actions,
        shedBuses: chosen.shedBuses,
        verification: { passed: true, status: 'simulation-verified', checks: okChecks, method: 'DEV FIXTURE — not verified by a solver' },
        score: (strategy === 'encirra' ? chosen.scoreEncirra : chosen.scoreGridOnly) ?? 0,
        scoreBreakdown: chosen.scoreBreakdown!,
        outcome: strategy === 'encirra' ? 'complete' : 'partial',
        verifiedAtT: tVer * 60,
        appliedAtT: tApplied * 60,
        rationale: ['DEV FIXTURE rationale bullet.'],
        protectedFacilities: ['hospital', 'ps-2'],
        unservedAfter: { buses: chosen.shedBuses, kW: chosen.metrics.shedKW, facilities: strategy === 'encirra' ? ['cooling-dc1'] : [] },
        assumptions: ['DEV FIXTURE assumption.'],
      }
    : null;
  const last = frames[frames.length - 1];
  const at = frames[tFault + 1] ?? last;
  const summary: RunSummary = {
    faultLabel: `${faultLine.feeder === 'tie' ? 'Tie' : 'Feeder ' + faultLine.feeder} · line B${faultLine.from + 1}–B${faultLine.to + 1}`,
    faultLineId: p.faultLineId,
    faultClock: clockAt(tFault),
    feederId: (faultLine.feeder === 'tie' ? 'F3' : faultLine.feeder) as FeederId,
    loadInterruptedKW: lostKW,
    connectionsAffected: E.buses.filter((b) => lost.has(b.id)).reduce((a, b) => a + b.connections, 0),
    pumpsOffline: at.water.pumpsTotal - at.water.pumpsOnline,
    criticalAtRisk: at.facilities.filter((f) => f.status !== 'safe' && topo.facilities.find((x) => x.id === f.id)?.critical).length,
    loadRestoredKW: last.power.restoredKW,
    loadRestoredPct: (100 * last.power.restoredKW) / lostKW,
    remainingUnservedKW: last.power.unservedKW,
    criticalRecovered: plan ? 2 : 0,
    criticalTotal: 2,
    pumpsAvailableEnd: last.water.pumpsOnline,
    pumpsTotal: last.water.pumpsTotal,
    servedEnergyKWh: frames.reduce((a, f) => a + f.power.servedKW / 60, 0),
    unservedEnergyKWh: frames.reduce((a, f) => a + f.power.unservedKW / 60, 0),
    criticalUnservedKWh: frames.reduce((a, f) => a + f.power.criticalUnservedKW / 60, 0),
    waterRequiredM3: frames.reduce((a, f) => a + (f.water.requiredLps * 60) / 1000, 0),
    waterDeliveredM3: frames.reduce((a, f) => a + (f.water.deliveredLps * 60) / 1000, 0),
    waterDeliveredPct: (100 * frames.reduce((a, f) => a + f.water.deliveredLps, 0)) / frames.reduce((a, f) => a + f.water.requiredLps, 0),
    minPressureM: Math.min(...frames.map((f) => f.water.minPressureM)),
    minCriticalPressureM: Math.min(...frames.map((f) => f.water.criticalPressureM)),
    tankMinPct: Math.min(...frames.map((f) => Math.min(...f.water.tankPct))),
    minutesBelowServicePressure: frames.filter((f) => f.water.criticalPressureM < W.serviceThresholdM).length,
    hydraulicDelayMin: (() => {
      const k = frames.findIndex((f) => f.water.criticalPressureM < W.serviceThresholdM);
      return k < 0 ? null : k - tFault;
    })(),
    constraintViolations: 0,
    switchOps: plan ? chosen.metrics.switchOps : 0,
    planComputeMs: plan ? 840 : 0,
    candidatesEvaluated: plan ? candidates.length : 0,
    candidatesRejected: plan ? 1 : 0,
    outcome: !plan ? 'no-intervention' : strategy === 'encirra' ? 'complete' : 'partial',
  };
  return {
    schemaVersion: 1,
    runId: `devfixture-${def.id}-${strategy}`,
    scenarioId: def.id,
    strategy,
    params: p,
    weights: WEIGHTS,
    provenance: {
      engine: 'encirra-sim',
      engineVersion: 'dev-fixture',
      pandapower: 'n/a (fixture)',
      wntr: 'n/a (fixture)',
      python: 'n/a',
      electricalSolver: 'DEV FIXTURE — no solver',
      hydraulicSolver: 'DEV FIXTURE — no solver',
      coupling: 'DEV FIXTURE — no coupling',
      seed: p.seed,
      computedAt: '2026-10-13T00:00:00Z',
      computeMs: 0,
      source: 'replay',
    },
    timebase: { startClock: '17:00', startISO: '2026-04-28T17:00:00+04:00', stepSeconds: p.stepMin * 60, steps: n },
    events: events.sort((a, b) => a.t - b.t),
    timeline,
    frames,
    plan: recovery,
    candidates: plan ? candidates : [],
    summary,
  };
}

export interface DevFixture {
  topology: NetworkTopology;
  manifest: ReplayManifest;
  runs: (id: ScenarioId) => Record<StrategyId, RunResult>;
  comparison: (id: ScenarioId) => Comparison;
}

export function createDevFixture(): DevFixture {
  const topology = buildTopology();
  const cache = new Map<ScenarioId, Record<StrategyId, RunResult>>();
  const runs = (id: ScenarioId) => {
    let r = cache.get(id);
    if (!r) {
      const def = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
      r = Object.fromEntries(STRATS.map((s) => [s, simulate(topology, def, s)])) as Record<StrategyId, RunResult>;
      cache.set(id, r);
    }
    return r;
  };
  return {
    topology,
    manifest: {
      schemaVersion: 1,
      generatedAt: '2026-10-13T00:00:00Z',
      engineVersion: 'dev-fixture',
      note: 'DEV FIXTURE — not solver output',
      topology: 'topology.json',
      scenarios: SCENARIOS.map((d) => ({ definition: d, runs: { none: '', 'grid-only': '', encirra: '' }, comparison: '' })),
      defaultScenario: 'feeder-fault',
      defaultStrategy: 'encirra',
      weights: WEIGHTS,
    },
    runs,
    comparison: (id) => {
      const r = runs(id);
      return {
        scenarioId: id,
        params: r.encirra.params,
        weights: WEIGHTS,
        generatedAt: '2026-10-13T00:00:00Z',
        summaries: { none: r.none.summary, 'grid-only': r['grid-only'].summary, encirra: r.encirra.summary },
        plans: { none: r.none.plan, 'grid-only': r['grid-only'].plan, encirra: r.encirra.plan },
      };
    },
  };
}

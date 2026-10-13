/**
 * QA-only fixture for scene screenshots (never imported by the app).
 * Produces a contract-shaped RunResult that walks through the feeder-fault storyline so the 3D
 * states (fault, isolation, restoring, restored, pump trip, tank drain) can be checked visually
 * before solver replay files exist. Numbers here are placeholders for rendering tests only.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const district = JSON.parse(readFileSync(resolve(here, '../../../packages/shared/config/district.json'), 'utf8'));

export function buildMockRun(scenario = 'feeder-fault') {
  const E = district.electrical;
  const W = district.water;
  const nb = E.buses.length;
  const nl = E.lines.length;
  const F3 = new Set(E.feeders.find((f) => f.id === 'F3').buses.map((n) => n - 1));
  const faultLine = 25; // B26–B27
  const tieLine = 35; // SW-18-33
  const stages = [
    'ready', 'ready', 'ready', 'fault-detected', 'fault-detected', 'fault-isolated', 'impact-evaluated', 'impact-evaluated',
    'candidates-generated', 'verification-completed', 'recovery-applied', 'recovery-complete', 'recovery-complete', 'recovery-complete',
    'recovery-complete', 'recovery-complete',
  ];
  const frames = stages.map((stage, k) => {
    const t = k * 120;
    const faulted = k >= 3;
    const isolated = k >= 5;
    const planned = k >= 8 && k < 10;
    const restored = k >= 10;
    const busState = [];
    for (let i = 0; i < nb; i++) {
      let s = 'energized';
      if (faulted && F3.has(i)) {
        if (isolated && i === 25) s = 'energized'; // B26 re-energised after isolation
        else s = restored ? 'restored' : 'deenergized';
      }
      if (scenario === 'pump-power-loss' && k >= 3 && k < 10 && i === 32) s = 'deenergized';
      busState.push(s);
    }
    const lineState = [];
    const lineFlowKW = [];
    for (let l = 0; l < nl; l++) {
      const L = E.lines[l];
      let s = L.normallyOpen ? 'open' : 'energized';
      const from = L.from - 1;
      const to = L.to - 1;
      if (scenario === 'feeder-fault' && faulted) {
        if (l === faultLine) s = isolated ? 'isolated' : 'faulted';
        else if (F3.has(to) && L.kind === 'feeder') {
          if (l === 24) s = isolated ? 'energized' : 'deenergized';
          else s = restored ? 'restored' : 'deenergized';
        }
        if (l === tieLine) s = planned ? 'restoring' : restored ? 'restored' : 'open';
      }
      lineState.push(s);
      const on = s === 'energized' || s === 'restored';
      let flow = on ? 300 + ((l * 137) % 900) : null;
      // after restoration the F3 tail is fed backwards from B18 through the tie
      if (on && restored && F3.has(to) && l !== 24) flow = -flow;
      if (l === tieLine && on) flow = 900;
      lineFlowKW.push(flow);
      void from;
    }
    const switchClosed = E.lines.map((L, l) => {
      if (l === faultLine && isolated) return false;
      if (l === tieLine) return restored;
      return !L.normallyOpen;
    });
    const pumpOn = W.pumps.map((p) => !(faulted && !restored && p.bus === 33));
    const ps2 = pumpOn[1];
    const westLow = faulted && !restored;
    const junctionPressureM = W.junctions.map((j) => {
      if (j.zone === 'West' && westLow) return Math.max(6, 28 - (k - 3) * 3.2);
      return 30 + (j.pos[0] % 7);
    });
    const pipeFlowLps = W.pipes.map((p, i) => {
      if (p.initialStatus === 'closed') return 0;
      const west = p.route[0][0] < 0;
      const base = 6 + (i % 5) * 3;
      if (p.id === 'S-R1-PS2') return ps2 ? 48 : 0;
      if (p.id.startsWith('P-PS2D')) return ps2 ? 22 : 0;
      if (p.id === 'P-T2C-T2') return ps2 ? 6 : -18;
      if (west && westLow) return base * 0.35;
      return base;
    });
    const pipeVelocityMs = pipeFlowLps.map((q, i) => Math.abs(q) / 1000 / (Math.PI * Math.pow(W.pipes[i].diameterMM / 2000, 2)));
    const tankPct = [62 + Math.sin(k / 3) * 2, westLow ? Math.max(8, 70 - (k - 3) * 9) : faulted ? Math.min(70, 30 + (k - 10) * 8) : 70];
    const facilities = district.facilities.map((f) => {
      const bus = f.bus == null ? null : f.bus - 1;
      const dark = bus != null && busState[bus] === 'deenergized';
      const rest = bus != null && busState[bus] === 'restored';
      let power = bus == null ? 'external' : dark ? (f.backup ? 'backup' : 'offline') : rest ? 'restored' : 'online';
      let water = 'normal';
      if (f.id === 'hospital' && westLow) water = k > 6 ? 'low-pressure' : 'normal';
      if (f.id === 'ps-2' && !ps2) water = 'no-flow';
      const status = dark ? (f.critical ? 'at-risk' : 'affected') : rest ? 'restored' : 'safe';
      return { id: f.id, power, water, status, detail: '' };
    });
    return {
      t,
      clock: `17:${String(k * 2).padStart(2, '0')}`,
      stage,
      power: {
        busVmPu: busState.map((s) => (s === 'deenergized' ? null : 0.97)),
        busState,
        busServedKW: E.buses.map((b, i) => (busState[i] === 'deenergized' ? 0 : b.loadKW)),
        busShed: E.buses.map(() => false),
        lineState,
        lineLoadingPct: lineFlowKW.map((f) => (f == null ? null : 40)),
        lineFlowKW,
        switchClosed,
        demandKW: 3715,
        servedKW: 3000,
        unservedKW: 0,
        restoredKW: 0,
        lossesKW: 120,
        pumpKW: 70,
        criticalUnservedKW: 0,
        vMinPu: 0.95,
        vMinBus: 17,
        vMaxPu: 1.0,
        voltageViolations: 0,
        voltageAdvisories: 0,
        thermalViolations: 0,
        converged: true,
      },
      water: {
        junctionPressureM,
        junctionDeliveredLps: W.junctions.map((j) => j.baseDemandLps),
        junctionRequiredLps: W.junctions.map((j) => j.baseDemandLps),
        pipeFlowLps,
        pipeVelocityMs,
        pipeOpen: W.pipes.map((p) => p.initialStatus !== 'closed'),
        pumpOn,
        pumpFlowLps: pumpOn.map((on, i) => (on ? W.pumps[i].designFlowLps : 0)),
        pumpHeadM: pumpOn.map((on) => (on ? 46 : 0)),
        pumpPowerKW: pumpOn.map((on) => (on ? 36 : 0)),
        tankLevelM: tankPct.map((p) => 1 + p * 0.06),
        tankPct,
        requiredLps: 72,
        deliveredLps: 70,
        deliveredPct: 97,
        minPressureM: Math.min(...junctionPressureM),
        minPressureNode: 'J-A1',
        criticalPressureM: 25,
        nodesBelowService: junctionPressureM.filter((p) => p < 20).length,
        connectionsInterrupted: 0,
        pumpsOnline: pumpOn.filter(Boolean).length,
        pumpsTotal: 2,
      },
      facilities,
    };
  });
  return {
    schemaVersion: 1,
    runId: `qa-${scenario}`,
    scenarioId: scenario,
    strategy: 'encirra',
    params: {},
    weights: {},
    provenance: { source: 'replay' },
    timebase: { startClock: '17:00', startISO: '2026-04-28T17:00:00+04:00', stepSeconds: 120, steps: frames.length },
    events: [],
    timeline: [],
    frames,
    plan: {
      candidateId: 'QA',
      strategy: 'encirra',
      label: 'Close SW-18-33',
      actions: [{ switchId: 'SW-18-33', lineId: tieLine, action: 'close', reason: 'QA' }, { switchId: 'SW-26-27', lineId: faultLine, action: 'open', reason: 'QA' }],
      shedBuses: [],
      verification: { passed: true, status: 'simulation-verified', checks: [], method: 'QA' },
      score: 0,
      scoreBreakdown: {},
      outcome: 'complete',
      verifiedAtT: 1080,
      appliedAtT: 1200,
      rationale: [],
      protectedFacilities: [],
      unservedAfter: { buses: [], kW: 0, facilities: [] },
      assumptions: [],
    },
    candidates: [],
    summary: { faultLabel: 'Feeder F3 · line B26–B27', feederId: 'F3', faultLineId: faultLine },
  };
}

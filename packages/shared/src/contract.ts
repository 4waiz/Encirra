/**
 * Encirra API contract — schemaVersion 1.
 *
 * Authoritative simulation data flows one way:
 *   services/simulation (Python, Pydantic) ──JSON──▶ apps/web (TypeScript).
 *
 * The Pydantic models in services/simulation/encirra_sim/models.py MUST mirror these types
 * exactly. All JSON keys are camelCase. Units are fixed per field (see suffixes):
 *   KW = kilowatts, KVAr = kilovolt-ampere reactive, Pu = per-unit voltage, Pct = percent (0–100),
 *   Lps = litres per second, M = metres (pressure in metres of water head), Ms = metres/second,
 *   M3 = cubic metres, KWh = kilowatt-hours, t = seconds since the run start.
 *
 * Electrical indices: arrays indexed by pandapower bus/line index (0-based). The 1-based
 * benchmark bus number is `index + 1` (Baran & Wu convention, used in labels: "B18").
 * Water arrays are indexed in the order of NetworkTopology.water.{junctions,pipes,pumps,tanks}.
 */

export const SCHEMA_VERSION = 1 as const;

// ─────────────────────────────────────────────────────────────── identifiers
export type ScenarioId = 'feeder-fault' | 'pump-power-loss' | 'high-demand';
export type StrategyId = 'none' | 'grid-only' | 'encirra';

/** Application/simulation state machine. Exactly one stage is current at any frame. */
export type StageId =
  | 'ready' // normal operation before the disturbance
  | 'fault-detected' // protection has operated; outage in progress
  | 'fault-isolated' // faulted section isolated by switching; healthy upstream re-energised
  | 'impact-evaluated' // cascading electrical + hydraulic impact computed
  | 'candidates-generated' // recovery candidates enumerated and evaluated
  | 'verification-completed' // independent verification finished for the selected plan
  | 'recovery-applied' // switching sequence executed
  | 'recovery-complete' // all recoverable service restored, all checks pass
  | 'partially-restored' // plan applied but some demand remains unserved
  | 'recovery-infeasible' // no candidate passed verification; outage persists
  | 'no-intervention'; // strategy "none": outage persists by design

export type Severity = 'info' | 'warning' | 'critical' | 'success';

// ─────────────────────────────────────────────────────────────── static topology
export type FeederId = 'F1' | 'F2' | 'F3' | 'F4';

export interface BusInfo {
  id: number; // pandapower index (0-based)
  number: number; // benchmark bus number (1-based)
  name: string; // "B18"
  feeder: FeederId | 'S1';
  vnKV: number;
  loadKW: number; // nominal benchmark active load (excluding pump demand)
  loadKVAr: number;
  connections: number; // synthetic service-connection count
  critical: boolean;
  facilityIds: string[];
  pos: [number, number]; // district plan position (x east, z south), metres
  label: string;
}

export interface LineInfo {
  id: number; // pandapower line index
  from: number; // bus id (0-based)
  to: number; // bus id (0-based)
  kind: 'feeder' | 'tie';
  feeder: FeederId | 'tie';
  rOhm: number;
  xOhm: number;
  ratingA: number; // synthetic thermal limit
  normallyOpen: boolean;
  switchId: string;
}

export type SwitchKind = 'breaker' | 'recloser' | 'sectionalizer' | 'tie';
export interface SwitchInfo {
  id: string; // "SW-26-27"
  lineId: number;
  kind: SwitchKind;
  normallyOpen: boolean;
  remote: boolean; // remotely operable by the planner
}

export interface FeederInfo {
  id: FeederId;
  name: string; // "Feeder F3"
  description: string;
  buses: number[]; // bus ids (0-based)
}

export interface ElectricalTopology {
  benchmark: string;
  baseKV: number;
  substationBus: number; // bus id (0-based)
  limits: { vMinPu: number; vMaxPu: number; vSoftMinPu: number; loadingMaxPct: number };
  buses: BusInfo[];
  lines: LineInfo[];
  switches: SwitchInfo[];
  feeders: FeederInfo[];
  nominalLoadKW: number;
  nominalLoadKVAr: number;
}

export interface JunctionInfo {
  id: string; // "J-B3"
  label: string;
  zone: 'West' | 'East';
  elevationM: number;
  baseDemandLps: number;
  critical: boolean;
  facilityId: string | null;
  connections: number; // synthetic water service connections
  pos: [number, number, number]; // x, y (depth, negative = underground), z
}
export interface ReservoirInfo { id: string; label: string; headM: number; pos: [number, number, number]; facilityId: string | null }
export interface TankInfo {
  id: string; label: string; zone: 'West' | 'East'; elevationM: number;
  minLevelM: number; maxLevelM: number; initLevelM: number; diameterM: number;
  pos: [number, number, number]; facilityId: string | null;
}
export interface PipeInfo {
  id: string; from: string; to: string; lengthM: number; diameterMM: number; roughnessC: number;
  kind: 'distribution' | 'transmission' | 'suction' | 'riser' | 'boundary';
  initialStatus: 'open' | 'closed';
  route: [number, number, number][]; // 3D polyline for rendering
}
export interface PumpInfo {
  id: string; label: string; from: string; to: string; stationId: string;
  bus: number; // bus id (0-based) supplying the pump motor
  designFlowLps: number; designHeadM: number; efficiency: number; ratedKW: number;
}
export interface WaterTopology {
  model: string;
  requiredPressureM: number; // PDD: pressure for full demand
  minimumPressureM: number; // PDD: pressure below which demand is zero
  serviceThresholdM: number; // "service available" threshold used for status
  junctions: JunctionInfo[];
  reservoirs: ReservoirInfo[];
  tanks: TankInfo[];
  pipes: PipeInfo[];
  pumps: PumpInfo[];
}

export type FacilityKind =
  | 'substation' | 'hospital' | 'emergency-ops' | 'pump-station' | 'water-tower'
  | 'desalination-inlet' | 'cooling-plant' | 'commercial';
export interface FacilityInfo {
  id: string;
  name: string;
  kind: FacilityKind;
  critical: boolean;
  bus: number | null; // bus id (0-based) or null when not supplied by the modelled feeder
  waterNode: string | null;
  pumps?: string[];
  backup: { kind: 'genset' | 'battery'; kW: number; hours: number; coversWater: boolean } | null;
  pos: [number, number];
  description: string;
}

export interface NetworkTopology {
  schemaVersion: typeof SCHEMA_VERSION;
  district: { id: string; name: string; label: string; disclaimer: string };
  electrical: ElectricalTopology;
  water: WaterTopology;
  facilities: FacilityInfo[];
}

// ─────────────────────────────────────────────────────────────── scenarios & requests
export interface ScenarioParams {
  loadMultiplier: number; // scales benchmark electrical demand (1.0 = nominal)
  waterDemandMultiplier: number;
  faultLineId: number; // line id (0-based) that faults
  faultTimeMin: number; // minutes after start
  isolationDelayMin: number; // fault → isolation complete
  analysisDelayMin: number; // isolation → candidates generated
  switchingDelayMin: number; // verification → switching complete
  tankInitPct: number; // initial level of all tanks, % of usable range
  horizonMin: number; // run length
  stepMin: number; // frame spacing
  repairTimeMin: number | null; // permanent repair time after start; null = not within horizon
  seed: number;
}

export interface ScenarioDefinition {
  id: ScenarioId;
  name: string; // "Electrical Feeder Failure"
  shortName: string;
  description: string;
  narrative: string[]; // bullet points for the Scenarios page
  defaults: ScenarioParams;
  faultOptions: { lineId: number; label: string }[];
  editable: (keyof ScenarioParams)[];
}

/** Objective weights for the Encirra planner (soft preferences). Hard constraints are never weighted. */
export interface ObjectiveWeights {
  servedLoad: number; // per MWh of electrical demand served
  criticalLoad: number; // per MWh of critical electrical demand served
  waterDelivered: number; // per 1,000 m³ of water demand delivered
  criticalWater: number; // per hour of critical-facility water service maintained
  pressureStorage: number; // per % of minimum tank level preserved / pressure margin
  switchingCost: number; // penalty per switching operation
}

export interface RunRequest {
  scenarioId: ScenarioId;
  strategy: StrategyId;
  params?: Partial<ScenarioParams>;
  weights?: Partial<ObjectiveWeights>;
}

// ─────────────────────────────────────────────────────────────── per-frame state
/** Element states. Colour language (3D): energized=amber, faulted=red, restored=green, isolated/deenergized=grey. */
export type ElementState =
  | 'energized' // normal supply
  | 'faulted' // the faulted element itself
  | 'isolated' // deliberately opened to isolate the fault
  | 'deenergized' // lost supply (downstream of the fault / not yet restored)
  | 'restoring' // part of the selected plan, awaiting switching
  | 'restored' // re-energised by the recovery plan (verified)
  | 'open'; // normally-open tie / open switch carrying no power

export interface PowerFrame {
  busVmPu: (number | null)[]; // null = de-energized
  busState: ElementState[];
  busServedKW: number[]; // load actually served at the bus (0 if de-energized or shed)
  busShed: boolean[]; // load deliberately shed by the plan
  lineState: ElementState[];
  lineLoadingPct: (number | null)[]; // null = out of service / no flow
  lineFlowKW: (number | null)[]; // signed, + = from→to
  switchClosed: boolean[]; // indexed like ElectricalTopology.switches
  demandKW: number; // total demand incl. pumps that WOULD be served in normal operation
  servedKW: number;
  unservedKW: number;
  restoredKW: number; // served load that had been lost and is now back via the plan
  lossesKW: number;
  pumpKW: number; // electrical demand of running pumps
  criticalUnservedKW: number;
  vMinPu: number | null;
  vMinBus: number | null; // bus id
  vMaxPu: number | null;
  voltageViolations: number; // buses outside the hard band [vMinPu, vMaxPu]
  voltageAdvisories: number; // energized buses below vSoftMinPu (soft preference)
  thermalViolations: number; // lines above loadingMaxPct
  converged: boolean;
}

export interface WaterFrame {
  junctionPressureM: number[];
  junctionDeliveredLps: number[];
  junctionRequiredLps: number[];
  pipeFlowLps: number[]; // signed, + = from→to
  pipeVelocityMs: number[];
  pipeOpen: boolean[];
  pumpOn: boolean[];
  pumpFlowLps: number[];
  pumpHeadM: number[];
  pumpPowerKW: number[]; // electrical input, P = ρ·g·Q·H / η
  tankLevelM: number[];
  tankPct: number[]; // % of usable range (min→max level)
  requiredLps: number;
  deliveredLps: number;
  deliveredPct: number;
  minPressureM: number; // over demand junctions
  minPressureNode: string;
  criticalPressureM: number; // min over critical junctions
  nodesBelowService: number;
  connectionsInterrupted: number; // water connections at nodes below service threshold
  pumpsOnline: number;
  pumpsTotal: number;
}

export type FacilityPower = 'online' | 'offline' | 'backup' | 'restored' | 'external';
export type FacilityWater = 'normal' | 'low-pressure' | 'no-flow' | 'restored' | 'n/a';
export type FacilityStatus = 'safe' | 'at-risk' | 'affected' | 'restored';
export interface FacilityState {
  id: string;
  power: FacilityPower;
  water: FacilityWater;
  status: FacilityStatus;
  detail: string; // e.g. "Genset carrying 150 kW · 31 m pressure"
}

export interface Frame {
  t: number; // seconds since run start
  clock: string; // "17:05"
  stage: StageId;
  power: PowerFrame;
  water: WaterFrame;
  facilities: FacilityState[];
}

// ─────────────────────────────────────────────────────────────── events & timeline
export type EventKind =
  | 'fault' | 'protection' | 'isolation' | 'analysis' | 'candidates' | 'verification'
  | 'switching' | 'restoration' | 'hydraulic' | 'info';

export interface SimEvent {
  id: string;
  t: number;
  clock: string;
  stage: StageId; // stage entered at (or current during) this event
  kind: EventKind;
  severity: Severity;
  title: string;
  detail: string;
  refs?: { buses?: number[]; lines?: number[]; switches?: string[]; pumps?: string[]; facilities?: string[]; junctions?: string[] };
}

export type TimelineStepId = 'fault-detected' | 'fault-isolated' | 'recovery-evaluated' | 'constraints-verified' | 'service-restored';
export interface TimelineStep {
  id: TimelineStepId;
  label: string;
  t: number | null; // completion time; null = never reached in this run
  clock: string | null;
  outcome: 'done' | 'failed' | 'skipped' | 'partial';
  detail: string;
}

// ─────────────────────────────────────────────────────────────── recovery & verification
export interface SwitchAction {
  switchId: string;
  lineId: number;
  action: 'open' | 'close';
  reason: string;
}

export interface VerificationCheck {
  id: string; // "pf-convergence", "voltage-band", "thermal", "radiality", "connectivity", "pump-supply", "pressure-critical", "critical-service", "switching-feasible", ...
  name: string;
  hard: boolean; // hard safety constraint (reject on failure) vs soft preference
  passed: boolean;
  value: string; // measured value, human-readable with units
  limit: string; // limit, human-readable with units
  detail: string;
}

export interface VerificationReport {
  passed: boolean; // all hard checks passed
  status: 'simulation-verified' | 'rejected';
  checks: VerificationCheck[];
  method: string; // how verification was performed (independent re-solve, etc.)
}

export interface ScoreBreakdown {
  servedLoad: number;
  criticalLoad: number;
  waterDelivered: number;
  criticalWater: number;
  pressureStorage: number;
  switchingCost: number; // negative contribution
  total: number;
}

export interface CandidateMetrics {
  restoredKW: number;
  servedKW: number;
  shedKW: number;
  criticalRestored: number;
  criticalTotal: number;
  pumpsRestored: number;
  waterDeliveredPct: number;
  minCriticalPressureM: number;
  tankMinPct: number;
  vMinPu: number | null;
  maxLoadingPct: number | null;
  switchOps: number;
}

export interface CandidateEvaluation {
  id: string; // "C07"
  label: string; // "Close SW-25-29 · open SW-30-31 · shed B30"
  actions: SwitchAction[];
  shedBuses: number[]; // bus ids
  feasible: boolean; // passed every hard check
  rejectedReasons: string[];
  checks: VerificationCheck[];
  metrics: CandidateMetrics;
  scoreEncirra: number | null; // null when infeasible
  scoreGridOnly: number | null;
  scoreBreakdown: ScoreBreakdown | null; // Encirra objective breakdown
  rankEncirra: number | null;
  rankGridOnly: number | null;
}

export interface RecoveryPlan {
  candidateId: string;
  strategy: StrategyId;
  label: string;
  actions: SwitchAction[];
  shedBuses: number[];
  verification: VerificationReport;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  outcome: 'complete' | 'partial' | 'infeasible';
  verifiedAtT: number;
  appliedAtT: number | null;
  rationale: string[]; // evidence bullets for "Why this plan?"
  protectedFacilities: string[];
  unservedAfter: { buses: number[]; kW: number; facilities: string[] };
  assumptions: string[];
}

// ─────────────────────────────────────────────────────────────── run result
export interface Provenance {
  engine: 'encirra-sim';
  engineVersion: string;
  pandapower: string;
  wntr: string;
  python: string;
  electricalSolver: string;
  hydraulicSolver: string;
  coupling: string; // description of the co-simulation scheme
  seed: number;
  computedAt: string; // ISO timestamp of computation
  computeMs: number;
  source: 'live' | 'replay'; // replay = precomputed solver output served from static files
}

export interface RunSummary {
  faultLabel: string; // "Feeder F3 · line B26–B27"
  faultLineId: number;
  faultClock: string;
  feederId: FeederId;
  loadInterruptedKW: number;
  connectionsAffected: number;
  pumpsOffline: number;
  criticalAtRisk: number;
  loadRestoredKW: number;
  loadRestoredPct: number; // restored / (restored + remaining event-related unserved incl. plan-shed load), end of horizon
  remainingUnservedKW: number; // at end of horizon, includes load deliberately shed by the plan
  loadShedKW?: number; // load deliberately disconnected by the plan (inside or outside the original outage), end of horizon
  criticalRecovered: number;
  criticalTotal: number;
  pumpsAvailableEnd: number;
  pumpsTotal: number;
  servedEnergyKWh: number;
  unservedEnergyKWh: number;
  criticalUnservedKWh: number;
  waterRequiredM3: number;
  waterDeliveredM3: number;
  waterDeliveredPct: number;
  minPressureM: number;
  minCriticalPressureM: number;
  tankMinPct: number;
  minutesBelowServicePressure: number; // at any critical facility
  hydraulicDelayMin: number | null; // pump trip → first critical node below service threshold
  constraintViolations: number; // hard-constraint violations observed in frames
  switchOps: number;
  planComputeMs: number;
  candidatesEvaluated: number;
  candidatesRejected: number;
  outcome: 'complete' | 'partial' | 'infeasible' | 'no-intervention';
}

export interface RunResult {
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string; // stable hash of (scenario, strategy, params, weights, engineVersion)
  scenarioId: ScenarioId;
  strategy: StrategyId;
  params: ScenarioParams;
  weights: ObjectiveWeights;
  provenance: Provenance;
  timebase: { startClock: string; startISO: string; stepSeconds: number; steps: number };
  events: SimEvent[];
  timeline: TimelineStep[];
  frames: Frame[];
  plan: RecoveryPlan | null;
  candidates: CandidateEvaluation[];
  summary: RunSummary;
}

export interface Comparison {
  scenarioId: ScenarioId;
  params: ScenarioParams;
  weights: ObjectiveWeights;
  generatedAt: string;
  summaries: Record<StrategyId, RunSummary>;
  plans: Record<StrategyId, RecoveryPlan | null>;
}

/** /replay/manifest.json — index of precomputed runs bundled for offline demos. */
export interface ReplayManifest {
  schemaVersion: typeof SCHEMA_VERSION;
  generatedAt: string;
  engineVersion: string;
  note: string;
  topology: string; // relative path, e.g. "topology.json"
  scenarios: { definition: ScenarioDefinition; runs: Record<StrategyId, string>; comparison: string }[];
  defaultScenario: ScenarioId;
  defaultStrategy: StrategyId;
  weights: ObjectiveWeights;
}

/** GET /api/health */
export interface HealthResponse {
  ok: boolean;
  engineVersion: string;
  pandapower: string;
  wntr: string;
  cachedRuns: number;
}

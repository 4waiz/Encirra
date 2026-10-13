"""Pydantic v2 models mirroring ``packages/shared/src/contract.ts`` (schemaVersion 1).

Python attributes are snake_case; the JSON wire format is camelCase. Aliases are produced by
:func:`camel_alias`, which follows pydantic's ``to_camel`` convention and additionally keeps the
unit acronyms used by the contract (``KW``, ``KVAr``, ``KV``, ``KWh``, ``MM``, ``M3``, ``ISO``).
Always serialise with ``model_dump(by_alias=True)`` / ``model_dump_json(by_alias=True)``.

``tests/test_contract_parity.py`` parses contract.ts and guards key parity for every interface.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

_ACRONYMS = {"kw": "KW", "kvar": "KVAr", "kv": "KV", "kwh": "KWh", "mm": "MM", "m3": "M3", "iso": "ISO"}


def camel_alias(name: str) -> str:
    """snake_case → camelCase with contract unit acronyms (``load_kvar`` → ``loadKVAr``)."""
    name = name.rstrip("_")  # ``from_`` → ``from``
    parts = name.split("_")
    if not any(p in _ACRONYMS for p in parts[1:]):
        return to_camel(name)
    return parts[0] + "".join(_ACRONYMS.get(p, p[:1].upper() + p[1:]) for p in parts[1:])


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=camel_alias, populate_by_name=True, extra="forbid")

    def dump(self) -> dict:
        return self.model_dump(by_alias=True, mode="json")


def _omit_none(v) -> bool:
    return v is None


# ─────────────────────────────────────────────────────────── identifiers
ScenarioId = Literal["feeder-fault", "pump-power-loss", "high-demand"]
StrategyId = Literal["none", "grid-only", "encirra"]
StageId = Literal[
    "ready",
    "fault-detected",
    "fault-isolated",
    "impact-evaluated",
    "candidates-generated",
    "verification-completed",
    "recovery-applied",
    "recovery-complete",
    "partially-restored",
    "recovery-infeasible",
    "no-intervention",
]
Severity = Literal["info", "warning", "critical", "success"]
FeederId = Literal["F1", "F2", "F3", "F4"]
SwitchKind = Literal["breaker", "recloser", "sectionalizer", "tie"]
ElementState = Literal["energized", "faulted", "isolated", "deenergized", "restoring", "restored", "open"]


# ─────────────────────────────────────────────────────────── static topology
class BusInfo(CamelModel):
    id: int
    number: int
    name: str
    feeder: Literal["F1", "F2", "F3", "F4", "S1"]
    vn_kv: float
    load_kw: float
    load_kvar: float
    connections: int
    critical: bool
    facility_ids: list[str]
    pos: tuple[float, float]
    label: str


class LineInfo(CamelModel):
    id: int
    from_: int
    to: int
    kind: Literal["feeder", "tie"]
    feeder: Literal["F1", "F2", "F3", "F4", "tie"]
    r_ohm: float
    x_ohm: float
    rating_a: float
    normally_open: bool
    switch_id: str


class SwitchInfo(CamelModel):
    id: str
    line_id: int
    kind: SwitchKind
    normally_open: bool
    remote: bool


class FeederInfo(CamelModel):
    id: FeederId
    name: str
    description: str
    buses: list[int]


class ElectricalLimits(CamelModel):
    v_min_pu: float
    v_max_pu: float
    v_soft_min_pu: float
    loading_max_pct: float


class ElectricalTopology(CamelModel):
    benchmark: str
    base_kv: float
    substation_bus: int
    limits: ElectricalLimits
    buses: list[BusInfo]
    lines: list[LineInfo]
    switches: list[SwitchInfo]
    feeders: list[FeederInfo]
    nominal_load_kw: float
    nominal_load_kvar: float


class JunctionInfo(CamelModel):
    id: str
    label: str
    zone: Literal["West", "East"]
    elevation_m: float
    base_demand_lps: float
    critical: bool
    facility_id: Optional[str]
    connections: int
    pos: tuple[float, float, float]


class ReservoirInfo(CamelModel):
    id: str
    label: str
    head_m: float
    pos: tuple[float, float, float]
    facility_id: Optional[str]


class TankInfo(CamelModel):
    id: str
    label: str
    zone: Literal["West", "East"]
    elevation_m: float
    min_level_m: float
    max_level_m: float
    init_level_m: float
    diameter_m: float
    pos: tuple[float, float, float]
    facility_id: Optional[str]


class PipeInfo(CamelModel):
    id: str
    from_: str
    to: str
    length_m: float
    diameter_mm: float
    roughness_c: float
    kind: Literal["distribution", "transmission", "suction", "riser", "boundary"]
    initial_status: Literal["open", "closed"]
    route: list[tuple[float, float, float]]


class PumpInfo(CamelModel):
    id: str
    label: str
    from_: str
    to: str
    station_id: str
    bus: int
    design_flow_lps: float
    design_head_m: float
    efficiency: float
    rated_kw: float


class WaterTopology(CamelModel):
    model: str
    required_pressure_m: float
    minimum_pressure_m: float
    service_threshold_m: float
    junctions: list[JunctionInfo]
    reservoirs: list[ReservoirInfo]
    tanks: list[TankInfo]
    pipes: list[PipeInfo]
    pumps: list[PumpInfo]


FacilityKind = Literal[
    "substation", "hospital", "emergency-ops", "pump-station", "water-tower", "desalination-inlet", "cooling-plant", "commercial"
]


class FacilityBackup(CamelModel):
    kind: Literal["genset", "battery"]
    kw: float = Field(alias="kW")
    hours: float
    covers_water: bool


class FacilityInfo(CamelModel):
    id: str
    name: str
    kind: FacilityKind
    critical: bool
    bus: Optional[int]
    water_node: Optional[str]
    pumps: Optional[list[str]] = Field(default=None, exclude_if=_omit_none)
    backup: Optional[FacilityBackup]
    pos: tuple[float, float]
    description: str


class DistrictInfo(CamelModel):
    id: str
    name: str
    label: str
    disclaimer: str


class NetworkTopology(CamelModel):
    schema_version: Literal[1] = 1
    district: DistrictInfo
    electrical: ElectricalTopology
    water: WaterTopology
    facilities: list[FacilityInfo]


# ─────────────────────────────────────────────────────────── scenarios & requests
class ScenarioParams(CamelModel):
    load_multiplier: float
    water_demand_multiplier: float
    fault_line_id: int
    fault_time_min: int
    isolation_delay_min: int
    analysis_delay_min: int
    switching_delay_min: int
    tank_init_pct: float
    horizon_min: int
    step_min: int
    repair_time_min: Optional[int]
    seed: int


class PartialScenarioParams(CamelModel):
    load_multiplier: Optional[float] = None
    water_demand_multiplier: Optional[float] = None
    fault_line_id: Optional[int] = None
    fault_time_min: Optional[int] = None
    isolation_delay_min: Optional[int] = None
    analysis_delay_min: Optional[int] = None
    switching_delay_min: Optional[int] = None
    tank_init_pct: Optional[float] = None
    horizon_min: Optional[int] = None
    step_min: Optional[int] = None
    repair_time_min: Optional[int] = None
    seed: Optional[int] = None


class FaultOption(CamelModel):
    line_id: int
    label: str


ScenarioParamKey = Literal[
    "loadMultiplier",
    "waterDemandMultiplier",
    "faultLineId",
    "faultTimeMin",
    "isolationDelayMin",
    "analysisDelayMin",
    "switchingDelayMin",
    "tankInitPct",
    "horizonMin",
    "stepMin",
    "repairTimeMin",
    "seed",
]


class ScenarioDefinition(CamelModel):
    id: ScenarioId
    name: str
    short_name: str
    description: str
    narrative: list[str]
    defaults: ScenarioParams
    fault_options: list[FaultOption]
    editable: list[ScenarioParamKey]


class ObjectiveWeights(CamelModel):
    served_load: float
    critical_load: float
    water_delivered: float
    critical_water: float
    pressure_storage: float
    switching_cost: float


class PartialObjectiveWeights(CamelModel):
    served_load: Optional[float] = None
    critical_load: Optional[float] = None
    water_delivered: Optional[float] = None
    critical_water: Optional[float] = None
    pressure_storage: Optional[float] = None
    switching_cost: Optional[float] = None


class RunRequest(CamelModel):
    scenario_id: ScenarioId
    strategy: StrategyId
    params: Optional[PartialScenarioParams] = Field(default=None, exclude_if=_omit_none)
    weights: Optional[PartialObjectiveWeights] = Field(default=None, exclude_if=_omit_none)


# ─────────────────────────────────────────────────────────── per-frame state
class PowerFrame(CamelModel):
    bus_vm_pu: list[Optional[float]]
    bus_state: list[ElementState]
    bus_served_kw: list[float]
    bus_shed: list[bool]
    line_state: list[ElementState]
    line_loading_pct: list[Optional[float]]
    line_flow_kw: list[Optional[float]]
    switch_closed: list[bool]
    demand_kw: float
    served_kw: float
    unserved_kw: float
    restored_kw: float
    losses_kw: float
    pump_kw: float
    critical_unserved_kw: float
    v_min_pu: Optional[float]
    v_min_bus: Optional[int]
    v_max_pu: Optional[float]
    voltage_violations: int
    voltage_advisories: int
    thermal_violations: int
    converged: bool


class WaterFrame(CamelModel):
    junction_pressure_m: list[float]
    junction_delivered_lps: list[float]
    junction_required_lps: list[float]
    pipe_flow_lps: list[float]
    pipe_velocity_ms: list[float]
    pipe_open: list[bool]
    pump_on: list[bool]
    pump_flow_lps: list[float]
    pump_head_m: list[float]
    pump_power_kw: list[float]
    tank_level_m: list[float]
    tank_pct: list[float]
    required_lps: float
    delivered_lps: float
    delivered_pct: float
    min_pressure_m: float
    min_pressure_node: str
    critical_pressure_m: float
    nodes_below_service: int
    connections_interrupted: int
    pumps_online: int
    pumps_total: int


FacilityPower = Literal["online", "offline", "backup", "restored", "external"]
FacilityWater = Literal["normal", "low-pressure", "no-flow", "restored", "n/a"]
FacilityStatus = Literal["safe", "at-risk", "affected", "restored"]


class FacilityState(CamelModel):
    id: str
    power: FacilityPower
    water: FacilityWater
    status: FacilityStatus
    detail: str


class Frame(CamelModel):
    t: int
    clock: str
    stage: StageId
    power: PowerFrame
    water: WaterFrame
    facilities: list[FacilityState]


# ─────────────────────────────────────────────────────────── events & timeline
EventKind = Literal[
    "fault", "protection", "isolation", "analysis", "candidates", "verification", "switching", "restoration", "hydraulic", "info"
]


class EventRefs(CamelModel):
    buses: Optional[list[int]] = Field(default=None, exclude_if=_omit_none)
    lines: Optional[list[int]] = Field(default=None, exclude_if=_omit_none)
    switches: Optional[list[str]] = Field(default=None, exclude_if=_omit_none)
    pumps: Optional[list[str]] = Field(default=None, exclude_if=_omit_none)
    facilities: Optional[list[str]] = Field(default=None, exclude_if=_omit_none)
    junctions: Optional[list[str]] = Field(default=None, exclude_if=_omit_none)


class SimEvent(CamelModel):
    id: str
    t: int
    clock: str
    stage: StageId
    kind: EventKind
    severity: Severity
    title: str
    detail: str
    refs: Optional[EventRefs] = Field(default=None, exclude_if=_omit_none)


TimelineStepId = Literal["fault-detected", "fault-isolated", "recovery-evaluated", "constraints-verified", "service-restored"]


class TimelineStep(CamelModel):
    id: TimelineStepId
    label: str
    t: Optional[int]
    clock: Optional[str]
    outcome: Literal["done", "failed", "skipped", "partial"]
    detail: str


# ─────────────────────────────────────────────────────────── recovery & verification
class SwitchAction(CamelModel):
    switch_id: str
    line_id: int
    action: Literal["open", "close"]
    reason: str


class VerificationCheck(CamelModel):
    id: str
    name: str
    hard: bool
    passed: bool
    value: str
    limit: str
    detail: str


class VerificationReport(CamelModel):
    passed: bool
    status: Literal["simulation-verified", "rejected"]
    checks: list[VerificationCheck]
    method: str


class ScoreBreakdown(CamelModel):
    served_load: float
    critical_load: float
    water_delivered: float
    critical_water: float
    pressure_storage: float
    switching_cost: float
    total: float


class CandidateMetrics(CamelModel):
    restored_kw: float
    served_kw: float
    shed_kw: float
    critical_restored: int
    critical_total: int
    pumps_restored: int
    water_delivered_pct: float
    min_critical_pressure_m: float
    tank_min_pct: float
    v_min_pu: Optional[float]
    max_loading_pct: Optional[float]
    switch_ops: int


class CandidateEvaluation(CamelModel):
    id: str
    label: str
    actions: list[SwitchAction]
    shed_buses: list[int]
    feasible: bool
    rejected_reasons: list[str]
    checks: list[VerificationCheck]
    metrics: CandidateMetrics
    score_encirra: Optional[float]
    score_grid_only: Optional[float]
    score_breakdown: Optional[ScoreBreakdown]
    rank_encirra: Optional[int]
    rank_grid_only: Optional[int]


class UnservedAfter(CamelModel):
    buses: list[int]
    kw: float = Field(alias="kW")
    facilities: list[str]


class RecoveryPlan(CamelModel):
    candidate_id: str
    strategy: StrategyId
    label: str
    actions: list[SwitchAction]
    shed_buses: list[int]
    verification: VerificationReport
    score: float
    score_breakdown: ScoreBreakdown
    outcome: Literal["complete", "partial", "infeasible"]
    verified_at_t: int
    applied_at_t: Optional[int]
    rationale: list[str]
    protected_facilities: list[str]
    unserved_after: UnservedAfter
    assumptions: list[str]


# ─────────────────────────────────────────────────────────── run result
class Provenance(CamelModel):
    engine: Literal["encirra-sim"] = "encirra-sim"
    engine_version: str
    pandapower: str
    wntr: str
    python: str
    electrical_solver: str
    hydraulic_solver: str
    coupling: str
    seed: int
    computed_at: str
    compute_ms: float
    source: Literal["live", "replay"]


class RunSummary(CamelModel):
    fault_label: str
    fault_line_id: int
    fault_clock: str
    feeder_id: FeederId
    load_interrupted_kw: float
    connections_affected: int
    pumps_offline: int
    critical_at_risk: int
    load_restored_kw: float
    load_restored_pct: float
    remaining_unserved_kw: float
    load_shed_kw: Optional[float] = Field(default=None, exclude_if=_omit_none)
    critical_recovered: int
    critical_total: int
    pumps_available_end: int
    pumps_total: int
    served_energy_kwh: float
    unserved_energy_kwh: float
    critical_unserved_kwh: float
    water_required_m3: float
    water_delivered_m3: float
    water_delivered_pct: float
    min_pressure_m: float
    min_critical_pressure_m: float
    tank_min_pct: float
    minutes_below_service_pressure: float
    hydraulic_delay_min: Optional[float]
    constraint_violations: int
    switch_ops: int
    plan_compute_ms: float
    candidates_evaluated: int
    candidates_rejected: int
    outcome: Literal["complete", "partial", "infeasible", "no-intervention"]


class Timebase(CamelModel):
    start_clock: str
    start_iso: str
    step_seconds: int
    steps: int


class RunResult(CamelModel):
    schema_version: Literal[1] = 1
    run_id: str
    scenario_id: ScenarioId
    strategy: StrategyId
    params: ScenarioParams
    weights: ObjectiveWeights
    provenance: Provenance
    timebase: Timebase
    events: list[SimEvent]
    timeline: list[TimelineStep]
    frames: list[Frame]
    plan: Optional[RecoveryPlan]
    candidates: list[CandidateEvaluation]
    summary: RunSummary


class StrategySummaries(CamelModel):
    """``Record<StrategyId, RunSummary>`` (keys are the strategy ids)."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    none: RunSummary
    grid_only: RunSummary = Field(alias="grid-only")
    encirra: RunSummary


class StrategyPlans(CamelModel):
    """``Record<StrategyId, RecoveryPlan | null>``."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    none: Optional[RecoveryPlan]
    grid_only: Optional[RecoveryPlan] = Field(alias="grid-only")
    encirra: Optional[RecoveryPlan]


class Comparison(CamelModel):
    scenario_id: ScenarioId
    params: ScenarioParams
    weights: ObjectiveWeights
    generated_at: str
    summaries: StrategySummaries
    plans: StrategyPlans


class StrategyRuns(CamelModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    none: str
    grid_only: str = Field(alias="grid-only")
    encirra: str


class ManifestScenario(CamelModel):
    definition: ScenarioDefinition
    runs: StrategyRuns
    comparison: str


class ReplayManifest(CamelModel):
    schema_version: Literal[1] = 1
    generated_at: str
    engine_version: str
    note: str
    topology: str
    scenarios: list[ManifestScenario]
    default_scenario: ScenarioId
    default_strategy: StrategyId
    weights: ObjectiveWeights


class HealthResponse(CamelModel):
    ok: bool
    engine_version: str
    pandapower: str
    wntr: str
    cached_runs: int

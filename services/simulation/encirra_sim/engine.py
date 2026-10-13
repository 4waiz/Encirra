"""Run orchestration: scenario → protection/isolation → planning → coupled simulation → RunResult.

Everything a frame reports comes from the final coupled simulation of that strategy's switching
timeline (pandapower AC power flow every frame + EPANET extended-period hydraulics). Events that
describe hydraulic threshold crossings are detected from those results, never scripted.

Facility state rules (documented in docs/METHODOLOGY.md):

* power — ``external`` when the facility is not supplied by the modelled feeder (tanks, R1);
  ``online`` when its bus is energised and not shed; ``restored`` when energised again after an
  interruption; ``backup`` when de-energised/shed but a genset is fitted; ``offline`` otherwise.
* water — ``n/a`` without a water node; for junction-served facilities ``normal`` (≥ 20 m),
  ``low-pressure`` (0.5–20 m), ``no-flow`` (< 0.5 m), ``restored`` (≥ 20 m after having been below);
  for pump stations ``normal``/``restored`` while the pump runs, else ``no-flow``; for tanks
  ``normal`` (≥ 25 %), ``low-pressure`` (< 25 %), ``no-flow`` (empty), ``restored`` (back ≥ 25 %).
* status — ``affected`` when service is lost (offline without backup, water low/no-flow, pump
  stopped, tank empty); ``at-risk`` when running on backup power, on storage only (zone pump
  stopped) or a tank below 25 %; ``restored`` when service lost after the fault is back;
  ``safe`` otherwise.
"""

from __future__ import annotations

import hashlib
import json
import platform
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import pandapower
import wntr

from . import profiles
from .config import (
    DEFAULT_WEIGHTS,
    ENGINE_VERSION,
    MAX_SWITCH_OPS,
    PUMP_UNDERVOLTAGE_TRIP_PU,
    SCENARIO_ORDER,
    TANK_LOW_PCT,
    District,
    cache_dir,
    code_fingerprint,
    district_mtime,
    load_district,
    load_scenario_files,
)
from .coupling import CoupledResult, Segment, SimSetup, SwitchingTimeline, simulate
from .electrical import PowerNetwork
from .models import (
    CandidateEvaluation,
    EventRefs,
    FacilityState,
    Frame,
    ObjectiveWeights,
    PowerFrame,
    Provenance,
    RecoveryPlan,
    RunRequest,
    RunResult,
    RunSummary,
    ScenarioDefinition,
    ScenarioParams,
    ScoreBreakdown,
    SimEvent,
    SwitchAction,
    Timebase,
    TimelineStep,
    UnservedAfter,
    VerificationReport,
    WaterFrame,
)
from .recovery import CandidateOutcome, PlanningContext, Scored, bus_list, evaluate_all, ranked, score_and_rank
from .topology import FaultPlan, plan_fault
from .verification import SwitchOp, VerificationRequest, verify

START_CLOCK_MIN = 16 * 60 + 30
COUPLING_TEXT = (
    "Block Gauss–Seidel co-simulation: switching timeline → bus energisation (NetworkX) → pump "
    "availability (energised and V ≥ 0.90 pu, latching undervoltage trip) → EPANET 2.2 extended-period "
    "hydraulics (60 s step, pressure-driven demand) → pump electrical demand P = ρgQH/η (pf 0.85) → "
    "pandapower AC Newton–Raphson power flow every frame → pump-bus voltage re-check; repeated until the "
    "pump schedule is a fixed point (≤ 4 iterations)."
)
MAX_VERIFY_ATTEMPTS = 3


# ─────────────────────────────────────────────────────────── scenarios & parameters
def scenario_definitions() -> list[ScenarioDefinition]:
    return [ScenarioDefinition.model_validate(v) for v in load_scenario_files().values()]


def scenario_definition(scenario_id: str) -> ScenarioDefinition:
    raw = load_scenario_files().get(scenario_id)
    if raw is None:
        raise KeyError(f"Unknown scenario '{scenario_id}'")
    return ScenarioDefinition.model_validate(raw)


def resolve_params(defn: ScenarioDefinition, overrides) -> ScenarioParams:
    base = defn.defaults.model_dump()
    if overrides is not None:
        for k, v in overrides.model_dump(exclude_unset=True).items():
            if v is not None or k == "repair_time_min":
                base[k] = v
    p = ScenarioParams.model_validate(base)
    validate_params(p)
    return p


def resolve_weights(overrides) -> ObjectiveWeights:
    base = {
        "served_load": DEFAULT_WEIGHTS["servedLoad"],
        "critical_load": DEFAULT_WEIGHTS["criticalLoad"],
        "water_delivered": DEFAULT_WEIGHTS["waterDelivered"],
        "critical_water": DEFAULT_WEIGHTS["criticalWater"],
        "pressure_storage": DEFAULT_WEIGHTS["pressureStorage"],
        "switching_cost": DEFAULT_WEIGHTS["switchingCost"],
    }
    if overrides is not None:
        for k, v in overrides.model_dump(exclude_unset=True).items():
            if v is not None:
                base[k] = float(v)
    for k, v in base.items():
        if not np.isfinite(v) or v < 0:
            raise ValueError(f"weight {k} must be a finite, non-negative number")
    return ObjectiveWeights(**base)


def validate_params(p: ScenarioParams) -> None:
    d = load_district()
    if p.step_min not in (1, 2, 5):
        raise ValueError("stepMin must be 1, 2 or 5")
    if not (30 <= p.horizon_min <= 360) or p.horizon_min % p.step_min:
        raise ValueError("horizonMin must be 30–360 and a multiple of stepMin")
    if not (0 <= p.fault_time_min < p.horizon_min) or p.fault_time_min % p.step_min:
        raise ValueError("faultTimeMin must lie inside the horizon and on a frame boundary")
    for name in ("isolation_delay_min", "analysis_delay_min", "switching_delay_min"):
        v = getattr(p, name)
        if v < 1 or v > 60 or v % p.step_min:
            raise ValueError(f"{name} must be 1–60 min and a multiple of stepMin")
    if not (0 <= p.fault_line_id < d.n_line) or d.lines[p.fault_line_id].kind != "feeder":
        raise ValueError("faultLineId must be a feeder (non-tie) line id")
    if not (0.5 <= p.load_multiplier <= 1.6):
        raise ValueError("loadMultiplier must be within 0.5–1.6")
    if not (0.5 <= p.water_demand_multiplier <= 1.6):
        raise ValueError("waterDemandMultiplier must be within 0.5–1.6")
    if not (0.0 <= p.tank_init_pct <= 100.0):
        raise ValueError("tankInitPct must be within 0–100")
    if p.repair_time_min is not None and (p.repair_time_min <= p.fault_time_min or p.repair_time_min % p.step_min):
        raise ValueError("repairTimeMin must be after the fault and on a frame boundary")


def run_id_for(scenario_id: str, strategy: str, params: ScenarioParams, weights: ObjectiveWeights) -> str:
    payload = json.dumps(
        {"s": scenario_id, "st": strategy, "p": params.model_dump(by_alias=True), "w": weights.model_dump(by_alias=True), "v": ENGINE_VERSION},
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def _clock(k: int, step_min: int) -> str:
    return profiles.clock_str(START_CLOCK_MIN, k * step_min * 60)


def _r(x: Optional[float], nd: int) -> Optional[float]:
    if x is None:
        return None
    x = float(x)
    if not np.isfinite(x):
        return None
    v = round(x, nd)
    return 0.0 if v == 0 else v


# ─────────────────────────────────────────────────────────── scenario runtime (physics shared by strategies)
@dataclass
class ScenarioRuntime:
    district: District
    scenario_id: str
    params: ScenarioParams
    setup: SimSetup
    fault: FaultPlan
    net: PowerNetwork
    k_fault: int
    k_iso: int
    k_impact: int
    k_cand: int
    k_verif: int
    k_switch: int
    k_repair: Optional[int]
    closed_normal: tuple[bool, ...]
    closed_trip: tuple[bool, ...]
    closed_iso: tuple[bool, ...]
    lock: threading.RLock = field(default_factory=threading.RLock)
    _outcomes: Optional[list[CandidateOutcome]] = None
    _plan_ms: float = 0.0
    _verifications: dict = field(default_factory=dict)
    _sims: dict = field(default_factory=dict)
    _baseline: Optional[np.ndarray] = None

    @property
    def n(self) -> int:
        return self.setup.n_frames

    def segments_none(self) -> list[Segment]:
        segs = [Segment(0, self.closed_normal, frozenset(), False, "normal"), Segment(self.k_fault, self.closed_trip, frozenset(), True, "protection")]
        return self._with_repair(segs)

    def segments_flisr(self) -> list[Segment]:
        segs = [
            Segment(0, self.closed_normal, frozenset(), False, "normal"),
            Segment(self.k_fault, self.closed_trip, frozenset(), True, "protection"),
        ]
        if self.k_iso < self.n and (self.k_repair is None or self.k_iso < self.k_repair):
            segs.append(Segment(self.k_iso, self.closed_iso, frozenset(), True, "isolation"))
        return segs

    def _with_repair(self, segs: list[Segment]) -> list[Segment]:
        if self.k_repair is not None and self.k_repair < self.n:
            segs = [s for s in segs if s.start < self.k_repair]
            segs.append(Segment(self.k_repair, self.closed_normal, frozenset(), False, "repair"))
        return segs

    def planning_context(self) -> PlanningContext:
        return PlanningContext(
            district=self.district,
            setup=self.setup,
            fault=self.fault,
            k_fault=self.k_fault,
            k_iso=self.k_iso,
            k_switch=self.k_switch,
            k_repair=self.k_repair,
            closed_iso=self.closed_iso,
            base_segments=self.segments_flisr(),
            net=self.net,
        )

    def outcomes(self) -> tuple[list[CandidateOutcome], float]:
        with self.lock:
            if self._outcomes is None:
                t = time.perf_counter()
                self._outcomes = evaluate_all(self.planning_context())
                self._plan_ms = (time.perf_counter() - t) * 1000.0
            return self._outcomes, self._plan_ms

    def timeline_for(self, outcome: Optional[CandidateOutcome], strategy: str) -> SwitchingTimeline:
        if strategy == "none":
            return SwitchingTimeline(self.segments_none(), self.fault.fault_line)
        segs = self.segments_flisr()
        if outcome is not None and self.k_switch < self.n and (self.k_repair is None or self.k_switch < self.k_repair):
            segs.append(Segment(self.k_switch, outcome.spec.closed, frozenset(outcome.spec.shed), True, "plan"))
        return SwitchingTimeline(self._with_repair(segs), self.fault.fault_line)

    def simulate(self, timeline: SwitchingTimeline) -> CoupledResult:
        key = tuple((s.start, s.closed, tuple(sorted(s.shed)), s.fault_active) for s in timeline.segments)
        with self.lock:
            if key not in self._sims:
                self._sims[key] = simulate(self.setup, timeline, self.net)
            return self._sims[key]

    def baseline_pump_kw(self) -> np.ndarray:
        """Pump electrical demand of the no-fault reference EPS (pumps always available)."""
        with self.lock:
            if self._baseline is None:
                from .water import simulate as eps

                avail = {pu.id: np.ones(self.setup.horizon_min + 1, dtype=bool) for pu in self.district.pumps}
                hyd = eps(self.district, self.setup.water_pattern_min, self.setup.tank_init_pct, avail, self.setup.horizon_min, self.setup.step_min)
                self._baseline = hyd.pump_kw.copy()
            return self._baseline

    def verification_for(self, outcome: CandidateOutcome) -> VerificationReport:
        with self.lock:
            if outcome.cid not in self._verifications:
                self._verifications[outcome.cid] = verify(self.verification_request(outcome))
            return self._verifications[outcome.cid]

    def switch_ops(self, outcome: Optional[CandidateOutcome]) -> list[SwitchOp]:
        d = self.district
        ops = [SwitchOp(self.k_fault, self.fault.protective_switch, False)]
        if self.k_iso < self.n:
            for s in self.fault.isolation_open:
                ops.append(SwitchOp(self.k_iso, s, False))
            for s in self.fault.reclose:
                ops.append(SwitchOp(self.k_iso, s, True))
        if outcome is not None:
            for a in outcome.actions:
                ops.append(SwitchOp(self.k_switch, a.switch_id, a.action == "close"))
        return ops

    def verification_request(self, outcome: CandidateOutcome) -> VerificationRequest:
        d = self.district
        claimed_pumps = [p.id for p in d.pumps if p.bus in outcome.restored_buses]
        return VerificationRequest(
            fault_line=self.fault.fault_line,
            fault_frame=self.k_fault,
            repair_frame=self.k_repair,
            ops=self.switch_ops(outcome),
            shed_buses=list(outcome.spec.shed),
            plan_frame=min(self.k_switch, self.n - 1),
            claimed_buses=sorted(outcome.restored_buses),
            claimed_pumps=claimed_pumps,
            plan_switch_ids=[a.switch_id for a in outcome.actions],
            horizon_min=self.params.horizon_min,
            step_min=self.params.step_min,
            start_clock_min=START_CLOCK_MIN,
            load_multiplier=self.params.load_multiplier,
            water_multiplier=self.params.water_demand_multiplier,
            tank_init_pct=self.params.tank_init_pct,
        )


_RUNTIMES: "OrderedDict[str, ScenarioRuntime]" = OrderedDict()
_RUNTIME_LOCK = threading.Lock()


def _runtime_key(scenario_id: str, params: ScenarioParams) -> str:
    return json.dumps({"s": scenario_id, "p": params.model_dump(by_alias=True), "v": ENGINE_VERSION, "m": district_mtime()}, sort_keys=True)


def get_runtime(scenario_id: str, params: ScenarioParams) -> ScenarioRuntime:
    key = _runtime_key(scenario_id, params)
    with _RUNTIME_LOCK:
        if key in _RUNTIMES:
            _RUNTIMES.move_to_end(key)
            return _RUNTIMES[key]
    d = load_district()
    step = params.step_min
    setup = SimSetup(d, params.horizon_min, step, START_CLOCK_MIN, params.load_multiplier, params.water_demand_multiplier, params.tank_init_pct)
    fault = plan_fault(d, params.fault_line_id)
    k_fault = params.fault_time_min // step
    k_iso = k_fault + params.isolation_delay_min // step
    k_verif = k_iso + params.analysis_delay_min // step
    k_impact = min(k_iso + 1, k_verif)
    k_cand = max(k_impact, k_verif - 1)
    k_switch = k_verif + params.switching_delay_min // step
    k_repair = params.repair_time_min // step if params.repair_time_min is not None else None
    normal = d.normal_switch_state()
    trip = list(normal)
    trip[fault.protective_line] = False
    iso = list(normal)
    for s in fault.isolation_open:
        iso[d.switch_index[s]] = False
    if not fault.reclose:
        iso[fault.protective_line] = False
    rt = ScenarioRuntime(
        district=d,
        scenario_id=scenario_id,
        params=params,
        setup=setup,
        fault=fault,
        net=PowerNetwork(d),
        k_fault=k_fault,
        k_iso=k_iso,
        k_impact=k_impact,
        k_cand=k_cand,
        k_verif=k_verif,
        k_switch=k_switch,
        k_repair=k_repair,
        closed_normal=normal,
        closed_trip=tuple(trip),
        closed_iso=tuple(iso),
    )
    with _RUNTIME_LOCK:
        _RUNTIMES[key] = rt
        while len(_RUNTIMES) > 6:
            _RUNTIMES.popitem(last=False)
    return rt


# ─────────────────────────────────────────────────────────── run cache
_MEM_CACHE: "OrderedDict[str, dict]" = OrderedDict()
_CACHE_LOCK = threading.Lock()


def _cache_path(run_id: str):
    return cache_dir() / f"run-{run_id}-{code_fingerprint()}.json"


def cached_runs() -> int:
    try:
        return len(list(cache_dir().glob(f"run-*-{code_fingerprint()}.json")))
    except OSError:
        return len(_MEM_CACHE)


def _cache_get(run_id: str) -> Optional[dict]:
    with _CACHE_LOCK:
        if run_id in _MEM_CACHE:
            _MEM_CACHE.move_to_end(run_id)
            return _MEM_CACHE[run_id]
    p = _cache_path(run_id)
    if p.is_file():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if data.get("provenance", {}).get("engineVersion") != ENGINE_VERSION:
            return None
        with _CACHE_LOCK:
            _MEM_CACHE[run_id] = data
        return data
    return None


def _cache_put(run_id: str, data: dict) -> None:
    with _CACHE_LOCK:
        _MEM_CACHE[run_id] = data
        while len(_MEM_CACHE) > 24:
            _MEM_CACHE.popitem(last=False)
    try:
        tmp = _cache_path(run_id).with_suffix(".tmp")
        tmp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
        tmp.replace(_cache_path(run_id))
    except OSError:
        pass


# ─────────────────────────────────────────────────────────── selection
@dataclass
class Selection:
    scored: dict[str, Scored]
    chosen: Optional[CandidateOutcome]
    report: Optional[VerificationReport]
    attempts: list[tuple[CandidateOutcome, VerificationReport]]
    plan_ms: float


def select_plan(rt: ScenarioRuntime, strategy: str, weights: ObjectiveWeights) -> Selection:
    outcomes, eval_ms = rt.outcomes()  # shared candidate evaluation (computed once per scenario/params)
    t = time.perf_counter()
    scored = score_and_rank(outcomes, weights)
    attempts = []
    chosen = None
    report = None
    for s in ranked(scored, strategy)[:MAX_VERIFY_ATTEMPTS]:
        rep = rt.verification_for(s.outcome)
        attempts.append((s.outcome, rep))
        if rep.passed:
            chosen, report = s.outcome, rep
            break
    plan_ms = eval_ms + (time.perf_counter() - t) * 1000.0
    return Selection(scored, chosen, report, attempts, plan_ms)


# ─────────────────────────────────────────────────────────── frame construction
@dataclass
class FrameContext:
    rt: ScenarioRuntime
    strategy: str
    cr: CoupledResult
    plan: Optional[CandidateOutcome]
    plan_verified: bool
    outcome: str  # complete | partial | infeasible | no-intervention


def stage_for(fc: FrameContext, k: int) -> str:
    rt = fc.rt
    if k < rt.k_fault:
        return "ready"
    if rt.k_repair is not None and k >= rt.k_repair:
        return "recovery-complete"
    if fc.strategy == "none":
        return "fault-detected" if k < rt.k_iso else "no-intervention"
    if k < rt.k_iso:
        return "fault-detected"
    if k < rt.k_impact:
        return "fault-isolated"
    if k < rt.k_cand:
        return "impact-evaluated"
    if k < rt.k_verif:
        return "candidates-generated"
    if not fc.plan_verified:
        return "recovery-infeasible"
    has_actions = fc.plan is not None and (fc.plan.actions or fc.plan.spec.shed)
    if k < rt.k_switch:
        return "verification-completed"
    if k == rt.k_switch and has_actions:
        return "recovery-applied"
    return "recovery-complete" if fc.outcome == "complete" else "partially-restored"


def build_frames(fc: FrameContext) -> tuple[list[Frame], dict]:
    rt = fc.rt
    d = rt.district
    cr = fc.cr
    st = rt.setup
    hyd = cr.hyd
    n = rt.n
    lim = d.limits
    vmin_l, vmax_l, vsoft = float(lim["vMinPu"]), float(lim["vMaxPu"]), float(lim["vSoftMinPu"])
    lmax = float(lim["loadingMaxPct"])
    thr = float(d.water_options["serviceThresholdM"])
    base_pump = rt.baseline_pump_kw()
    demand_j = [hyd.jidx(j) for j in d.demand_junction_ids]
    crit_j = [hyd.jidx(j) for j in d.critical_junction_ids]
    conn = np.array([float(j["connections"]) for j in d.junctions])
    zone_pumps = {z["id"]: z["pumps"] for z in d.raw["water"]["zones"]}
    zone_tanks = {z["id"]: z["tanks"] for z in d.raw["water"]["zones"]}
    jzone = {j["id"]: j["zone"] for j in d.junctions}
    pidx = {p.id: i for i, p in enumerate(d.pumps)}
    tidx = {t["id"]: i for i, t in enumerate(d.tanks)}
    iso_lines = {d.switch_index[s] for s in rt.fault.isolation_open}
    plan_lines = set()  # lines the plan will energise (closed ties + closed lines inside the restored area)
    plan_ties = set()
    plan_buses: set[int] = set()
    if fc.plan is not None and fc.plan_verified:
        plan_buses = set(fc.plan.restored_buses)
        plan_ties = {a.line_id for a in fc.plan.actions if a.action == "close"}
        plan_lines = set(plan_ties)
        for ln in d.lines:
            if fc.plan.spec.closed[ln.id] and ln.from_bus in fc.plan.energized_after and ln.to_bus in fc.plan.energized_after and (ln.from_bus in plan_buses or ln.to_bus in plan_buses):
                plan_lines.add(ln.id)

    interrupted = np.zeros(d.n_bus, dtype=bool)  # bus load lost supply (dark or shed) at some frame since the fault
    node_dark = np.zeros(d.n_bus, dtype=bool)  # bus node was de-energised at some frame since the fault
    line_was_dark = np.zeros(d.n_line, dtype=bool)
    pump_was_off = {p.id: False for p in d.pumps}
    jun_was_below = np.zeros(len(d.junctions), dtype=bool)
    tank_was_low = {t["id"]: False for t in d.tanks}
    fac_was_bad = {f.id: False for f in d.facilities}
    frames: list[Frame] = []
    series = {k: [] for k in ("served", "unserved", "demand", "critUnserved", "restored", "req", "dlv", "vviol", "tviol")}
    fac_status_series: dict[str, list[str]] = {f.id: [] for f in d.facilities}
    for k in range(n):
        seg = cr.timeline.at(k)
        en = cr.energized[k]
        pf = cr.pf.get(k)
        lf = float(st.load_factor[k])
        fault_on = seg.fault_active
        after_fault = k >= rt.k_fault
        # ── power
        pump_kw_now = {p.id: float(hyd.pump_kw[k, pidx[p.id]]) for p in d.pumps}
        pump_on_now = {p.id: bool(hyd.pump_on[k, pidx[p.id]]) for p in d.pumps}
        bus_served = np.zeros(d.n_bus)
        bus_demand = np.zeros(d.n_bus)
        for b in d.buses:
            bus_demand[b.id] = b.load_kw * lf
            if b.id in en and b.id not in seg.shed:
                bus_served[b.id] = b.load_kw * lf
        for p in d.pumps:
            would = pump_kw_now[p.id] if pump_on_now[p.id] else float(base_pump[k, pidx[p.id]])
            bus_demand[p.bus] += would
            if pump_on_now[p.id]:
                bus_served[p.bus] += pump_kw_now[p.id]
        if after_fault:
            for b in range(d.n_bus):
                if b not in en or b in seg.shed:
                    interrupted[b] = True
                if b not in en:
                    node_dark[b] = True
        restored_kw = float(sum(bus_served[b] for b in range(d.n_bus) if interrupted[b] and b in en and b not in seg.shed))
        vm = [None] * d.n_bus
        converged = bool(pf.converged) if pf is not None else False
        vlist = []
        if pf is not None and pf.converged:
            for b in en:
                v = pf.vm_pu[b]
                if not np.isnan(v):
                    vm[b] = _r(v, 4)
                    vlist.append((float(v), b))
        bus_state = []
        for b in range(d.n_bus):
            if b in rt.fault.section_buses and fault_on and k >= rt.k_iso and fc.strategy != "none":
                bus_state.append("isolated")
            elif b in en:
                bus_state.append("restored" if node_dark[b] and after_fault else "energized")
            elif fc.plan_verified and b in plan_buses and rt.k_verif <= k < rt.k_switch:
                bus_state.append("restoring")
            else:
                bus_state.append("deenergized")
        line_state = []
        loading = []
        flow = []
        for ln in d.lines:
            closed = seg.closed[ln.id]
            live = closed and ln.from_bus in en and ln.to_bus in en and not (fault_on and ln.id == rt.fault.fault_line)
            if after_fault and not live and ln.kind == "feeder":
                line_was_dark[ln.id] = True
            if fault_on and ln.id == rt.fault.fault_line:
                s = "faulted"
            elif fault_on and ln.id in iso_lines and not closed and fc.strategy != "none" and k >= rt.k_iso:
                s = "isolated"
            elif fc.plan_verified and ln.id in plan_lines and rt.k_verif <= k < rt.k_switch and not live:
                s = "restoring"
            elif not closed:
                s = "open"
            elif live:
                s = "restored" if (line_was_dark[ln.id] or ln.id in plan_ties) and after_fault else "energized"
            else:
                s = "deenergized"
            line_state.append(s)
            if pf is not None and pf.converged and live:
                loading.append(_r(pf.loading_pct[ln.id], 1))
                flow.append(_r(pf.p_from_kw[ln.id], 1))
            else:
                loading.append(None)
                flow.append(None)
        demand_kw = float(bus_demand.sum())
        served_kw = float(bus_served.sum())
        crit_unserved = 0.0
        for b in d.buses:
            if not b.critical:
                continue
            uns = max(0.0, bus_demand[b.id] - bus_served[b.id])
            if uns > 0 and (b.id not in en or b.id in seg.shed):
                uns = max(0.0, uns - d.backup_kw_on_bus(b.id))
            crit_unserved += uns
        vviol = sum(1 for v, _ in vlist if v < vmin_l - 1e-9 or v > vmax_l + 1e-9)
        vadv = sum(1 for v, _ in vlist if v < vsoft)
        tviol = sum(1 for x in loading if x is not None and x > lmax + 1e-9)
        vmin_t = min(vlist) if vlist else None
        vmax_t = max(vlist) if vlist else None
        power = PowerFrame(
            bus_vm_pu=vm,
            bus_state=bus_state,
            bus_served_kw=[_r(x, 1) for x in bus_served],
            bus_shed=[b in seg.shed for b in range(d.n_bus)],
            line_state=line_state,
            line_loading_pct=loading,
            line_flow_kw=flow,
            switch_closed=list(seg.closed),
            demand_kw=_r(demand_kw, 1),
            served_kw=_r(served_kw, 1),
            unserved_kw=_r(max(0.0, demand_kw - served_kw), 1),
            restored_kw=_r(restored_kw, 1),
            losses_kw=_r(pf.losses_kw, 1) if (pf is not None and pf.converged) else 0.0,
            pump_kw=_r(sum(pump_kw_now[p] for p in pump_kw_now if pump_on_now[p]), 1),
            critical_unserved_kw=_r(crit_unserved, 1),
            v_min_pu=_r(vmin_t[0], 4) if vmin_t else None,
            v_min_bus=vmin_t[1] if vmin_t else None,
            v_max_pu=_r(vmax_t[0], 4) if vmax_t else None,
            voltage_violations=vviol,
            voltage_advisories=vadv,
            thermal_violations=tviol,
            converged=converged,
        )
        # ── water
        p_raw = hyd.pressure_m[k]
        p_disp = np.maximum(p_raw, 0.0)  # negative gauge pressure only occurs in a drained, disconnected zone
        req = hyd.required_lps[k]
        dlv = hyd.delivered_lps[k]
        dmin_i = int(np.argmin(p_disp[demand_j]))
        below = [i for i in demand_j if p_raw[i] < thr]
        water = WaterFrame(
            junction_pressure_m=[_r(x, 2) for x in p_disp],
            junction_delivered_lps=[_r(x, 2) for x in dlv],
            junction_required_lps=[_r(x, 2) for x in req],
            pipe_flow_lps=[_r(x, 2) for x in hyd.pipe_flow_lps[k]],
            pipe_velocity_ms=[_r(x, 3) for x in hyd.pipe_velocity_ms[k]],
            pipe_open=[bool(x) for x in hyd.pipe_open[k]],
            pump_on=[bool(x) for x in hyd.pump_on[k]],
            pump_flow_lps=[_r(x, 2) for x in hyd.pump_flow_lps[k]],
            pump_head_m=[_r(x, 2) for x in hyd.pump_head_m[k]],
            pump_power_kw=[_r(x, 1) for x in hyd.pump_kw[k]],
            tank_level_m=[_r(x, 3) for x in hyd.tank_level_m[k]],
            tank_pct=[_r(x, 1) for x in hyd.tank_pct[k]],
            required_lps=_r(float(req.sum()), 2),
            delivered_lps=_r(float(dlv.sum()), 2),
            delivered_pct=_r(100.0 * float(dlv.sum()) / float(req.sum()), 2) if req.sum() > 0 else 100.0,
            min_pressure_m=_r(float(p_disp[demand_j][dmin_i]), 2),
            min_pressure_node=hyd.junction_ids[demand_j[dmin_i]],
            critical_pressure_m=_r(float(p_disp[crit_j].min()), 2),
            nodes_below_service=len(below),
            connections_interrupted=int(sum(conn[i] for i in below)),
            pumps_online=int(hyd.pump_on[k].sum()),
            pumps_total=len(d.pumps),
        )
        # ── facilities
        facs = []
        for f in d.facilities:
            # power
            if f.bus is None:
                fpow = "external"
            elif f.bus in en and f.bus not in seg.shed:
                fpow = "restored" if interrupted[f.bus] and after_fault else "online"
            else:
                fpow = "backup" if f.backup else "offline"
            # water
            details = []
            if f.water_node is None:
                fw = "n/a"
                bad_w = False
                risk_w = False
            elif f.pumps:
                on = all(pump_on_now[p] for p in f.pumps)
                for p in f.pumps:
                    if not pump_on_now[p] and after_fault:
                        pump_was_off[p] = True
                fw = ("restored" if any(pump_was_off[p] for p in f.pumps) else "normal") if on else "no-flow"
                bad_w = not on
                risk_w = False
                q = sum(hyd.pump_flow_lps[k, pidx[p]] for p in f.pumps)
                details.append(f"{' + '.join(f.pumps)} {'running' if on else 'stopped'}" + (f" · {q:.1f} L/s · {sum(pump_kw_now[p] for p in f.pumps):.1f} kW" if on else ""))
            elif f.water_node in tidx:
                pct = float(hyd.tank_pct[k, tidx[f.water_node]])
                lvl = float(hyd.tank_level_m[k, tidx[f.water_node]])
                if pct <= 0.5:
                    fw = "no-flow"
                elif pct < TANK_LOW_PCT:
                    fw = "low-pressure"
                else:
                    fw = "restored" if tank_was_low[f.water_node] else "normal"
                if pct < TANK_LOW_PCT and after_fault:
                    tank_was_low[f.water_node] = True
                bad_w = pct <= 0.5
                zone = next((z for z, tl in zone_tanks.items() if f.water_node in tl), None)
                zone_supply = any(pump_on_now[p] for p in zone_pumps.get(zone, []))
                risk_w = pct < TANK_LOW_PCT or not zone_supply
                details.append(f"{f.water_node} {pct:.0f}% ({lvl:.2f} m)" + ("" if zone_supply else " · zone pump stopped"))
            elif f.water_node in hyd.junction_ids:
                ji = hyd.jidx(f.water_node)
                pr = float(p_raw[ji])
                if pr >= thr:
                    fw = "restored" if jun_was_below[ji] else "normal"
                elif pr > 0.5:
                    fw = "low-pressure"
                else:
                    fw = "no-flow"
                if pr < thr and after_fault:
                    jun_was_below[ji] = True
                bad_w = pr < thr
                zone = jzone.get(f.water_node)
                zone_supply = any(pump_on_now[p] for p in zone_pumps.get(zone, []))
                risk_w = not zone_supply
                details.append(f"{max(pr, 0.0):.1f} m at {f.water_node}" + ("" if zone_supply else " · zone on tank storage"))
            else:  # reservoir
                fw = "normal"
                bad_w = False
                risk_w = False
                details.append("Fixed-head desalination supply")
            if f.bus is not None:
                if fpow in ("online", "restored"):
                    v = vm[f.bus]
                    details.insert(0, f"Grid supply · {v:.3f} pu" if v is not None else "Grid supply")
                elif fpow == "backup":
                    carried = min(f.backup_kw, d.buses[f.bus].load_kw * lf)
                    details.insert(0, f"Genset carrying {carried:.0f} kW")
                else:
                    details.insert(0, "Bus shed by plan" if f.bus in seg.shed else f"No supply · B{f.bus + 1} de-energised")
            elif fpow == "external":
                details.insert(0, "Not supplied by the modelled feeder")
            bad_p = fpow == "offline"
            if bad_p or bad_w:
                status = "affected"
            elif fpow == "backup" or risk_w:
                status = "at-risk"
            elif fac_was_bad[f.id] or fpow == "restored" or fw == "restored":
                status = "restored"
            else:
                status = "safe"
            if after_fault and status in ("affected", "at-risk"):
                fac_was_bad[f.id] = True
            if status == "restored" and not fac_was_bad[f.id] and fpow != "restored" and fw != "restored":
                status = "safe"
            fac_status_series[f.id].append(status)
            facs.append(FacilityState(id=f.id, power=fpow, water=fw, status=status, detail=" · ".join(details)))
        frames.append(
            Frame(t=k * st.step_min * 60, clock=_clock(k, st.step_min), stage=stage_for(fc, k), power=power, water=water, facilities=facs)
        )
        series["served"].append(served_kw)
        series["unserved"].append(max(0.0, demand_kw - served_kw))
        series["demand"].append(demand_kw)
        series["critUnserved"].append(crit_unserved)
        series["restored"].append(restored_kw)
        series["req"].append(float(req.sum()))
        series["dlv"].append(float(dlv.sum()))
        series["vviol"].append(vviol)
        series["tviol"].append(tviol)
    series["facStatus"] = fac_status_series
    return frames, series


# ─────────────────────────────────────────────────────────── events
class _Events:
    def __init__(self, fc: FrameContext, frames: list[Frame]):
        self.fc = fc
        self.frames = frames
        self.items: list[tuple[int, int, dict]] = []
        self._seq = 0

    def add(self, k: int, kind: str, severity: str, title: str, detail: str, refs: Optional[dict] = None, stage: Optional[str] = None):
        k = max(0, min(k, len(self.frames) - 1))
        self._seq += 1
        self.items.append((k, self._seq, dict(kind=kind, severity=severity, title=title, detail=detail, refs=refs, stage=stage)))

    _ORDER = {"fault": 1, "protection": 2, "info": 3, "isolation": 4, "analysis": 5, "candidates": 6, "verification": 7, "switching": 8, "restoration": 9, "hydraulic": 10}

    def build(self) -> list[SimEvent]:
        st = self.fc.rt.setup
        out = []
        last_k = len(self.frames) - 1
        key = lambda x: (x[0], self._ORDER.get(x[2]["kind"], 9) if not (x[0] == last_k and x[2]["title"] == "End of simulation horizon") else 99, x[1])  # noqa: E731
        for i, (k, _, e) in enumerate(sorted(self.items, key=key)):
            refs = EventRefs(**e["refs"]) if e["refs"] else None
            out.append(
                SimEvent(
                    id=f"E{i + 1:02d}",
                    t=k * st.step_min * 60,
                    clock=_clock(k, st.step_min),
                    stage=e["stage"] or self.frames[k].stage,
                    kind=e["kind"],
                    severity=e["severity"],
                    title=e["title"],
                    detail=e["detail"],
                    refs=refs,
                )
            )
        return out


def reason_category(reason: str) -> str:
    if "loop" in reason:
        return "loop"
    if "faulted section" in reason:
        return "fault re-energisation"
    if "rating" in reason:
        return "thermal"
    if "trip on undervoltage" in reason or "cannot run" in reason:
        return "pump trip"
    if "pu <" in reason:
        return "undervoltage"
    if "pu >" in reason:
        return "overvoltage"
    return "other"


def _first_cross(values: np.ndarray, start: int, pred) -> Optional[int]:
    for k in range(start, len(values)):
        if pred(values[k]):
            return k
    return None


def build_events(fc: FrameContext, frames: list[Frame], sel: Optional[Selection], series: dict, impact: Optional[dict]) -> list[SimEvent]:
    rt = fc.rt
    d = rt.district
    cr = fc.cr
    hyd = cr.hyd
    st = rt.setup
    ev = _Events(fc, frames)
    thr = float(d.water_options["serviceThresholdM"])
    f0 = frames[0]
    ev.add(
        0,
        "info",
        "info",
        "Normal operation",
        f"Demand {f0.power.demand_kw:.0f} kW (incl. {f0.power.pump_kw:.0f} kW pumping), Vmin {f0.power.v_min_pu:.3f} pu at B{(f0.power.v_min_bus or 0) + 1}; "
        f"{f0.water.pumps_online}/{f0.water.pumps_total} pumps running, tanks {', '.join(f'{t} {p:.0f}%' for t, p in zip(hyd.tank_ids, f0.water.tank_pct))}; "
        f"minimum service pressure {f0.water.min_pressure_m:.1f} m.",
    )
    fl = d.lines[rt.fault.fault_line]
    if rt.k_fault >= rt.n:
        return ev.build()
    kf = rt.k_fault
    tripped = sorted(rt.fault.tripped_buses)
    lost_kw = sum(frames[kf - 1].power.bus_served_kw[b] for b in tripped) if kf > 0 else 0.0
    fac_hit = [f for f in d.facilities if f.bus is not None and f.bus in rt.fault.tripped_buses]
    ev.add(
        kf,
        "fault",
        "critical",
        f"Fault on Feeder {fl.feeder} · line B{fl.from_bus + 1}–B{fl.to_bus + 1}",
        f"Permanent fault on line {fl.id} ({fl.switch_id} section).",
        {"lines": [fl.id], "buses": [fl.from_bus, fl.to_bus]},
    )
    ev.add(
        kf,
        "protection",
        "critical",
        f"{rt.fault.protective_switch} tripped",
        f"Protection opened {rt.fault.protective_switch}: {len(tripped)} buses ({bus_list(tripped)}) de-energised, {lost_kw:.0f} kW interrupted"
        + (f"; facilities affected: {', '.join(f.name for f in fac_hit)}." if fac_hit else "."),
        {"switches": [rt.fault.protective_switch], "buses": tripped, "facilities": [f.id for f in fac_hit]},
    )
    for f in fac_hit:
        if f.backup:
            ev.add(kf, "info", "warning", f"{f.name} on backup generation", f"{f.backup['kind'].capitalize()} {f.backup_kw:.0f} kW carries the essential electrical load; it does not supply water.", {"facilities": [f.id]})
    # pump stops / starts / trips detected from the hydraulic results
    for i, p in enumerate(d.pumps):
        on = hyd.pump_on[:, i]
        for k in range(max(1, kf), rt.n):
            if on[k - 1] and not on[k]:
                trip = next((t for t in cr.pump_trips if t[0] == p.id and t[1] == k), None)
                if trip is not None and trip[2] is not None:
                    det = f"Undervoltage trip: V(B{p.bus + 1})={trip[2]:.3f} pu < {PUMP_UNDERVOLTAGE_TRIP_PU:.2f} pu."
                elif p.bus not in cr.energized[k]:
                    det = f"Supply bus B{p.bus + 1} de-energised; zone now depends on tank storage."
                else:
                    det = "Pump stopped."
                ev.add(k, "hydraulic", "critical", f"{p.id} stopped ({p.label})", det, {"pumps": [p.id], "buses": [p.bus]})
            elif not on[k - 1] and on[k]:
                ev.add(k, "restoration", "success", f"{p.id} restarted", f"Supply restored at B{p.bus + 1}; pumping {hyd.pump_flow_lps[k, i]:.1f} L/s at {hyd.pump_head_m[k, i]:.1f} m ({hyd.pump_kw[k, i]:.1f} kW).", {"pumps": [p.id], "buses": [p.bus]})
    if fc.strategy != "none" and rt.k_iso < rt.n and (rt.k_repair is None or rt.k_iso < rt.k_repair):
        k = rt.k_iso
        re_en = sorted(b for b in rt.fault.tripped_buses if b in cr.energized[k])
        ev.add(
            k,
            "isolation",
            "warning",
            "Faulted section isolated",
            f"Opened {', '.join(rt.fault.isolation_open)}"
            + (f"; reclosed {', '.join(rt.fault.reclose)} — {bus_list(re_en)} re-energised" if rt.fault.reclose and re_en else "")
            + f". Isolated section: {bus_list(rt.fault.section_buses)}; still de-energised: {bus_list(rt.fault.downstream_dark) or 'none'}.",
            {"switches": list(rt.fault.isolation_open) + list(rt.fault.reclose), "buses": sorted(rt.fault.section_buses), "lines": [fl.id]},
        )
        if impact is not None and rt.k_impact < rt.n:
            ev.add(rt.k_impact, "analysis", "warning" if impact.get("risk") else "info", "Cascading impact evaluated", impact["text"], impact.get("refs"))
        if sel is not None and rt.k_cand < rt.n:
            outs = [s.outcome for s in sel.scored.values()]
            rej = [o for o in outs if not o.feasible]
            cats = {"loop": 0, "undervoltage": 0, "overvoltage": 0, "thermal": 0, "pump trip": 0, "fault re-energisation": 0, "other": 0}
            for o in rej:
                cats[reason_category(o.reasons[0]) if o.reasons else "other"] += 1
            breakdown = ", ".join(f"{v} {k}" for k, v in cats.items() if v)
            ev.add(
                rt.k_cand,
                "candidates",
                "info",
                f"{len(outs)} recovery candidates evaluated",
                f"Each candidate solved with AC power flow and the extended-period hydraulic model; {len(outs) - len(rej)} feasible, {len(rej)} rejected"
                + (f" ({breakdown})." if breakdown else "."),
            )
        if sel is not None and rt.k_verif < rt.n:
            for o, rep in sel.attempts:
                if rep.passed:
                    ev.add(
                        rt.k_verif,
                        "verification",
                        "success",
                        f"Plan {o.cid} Simulation Verified",
                        f"{o.label}. Independent re-solve: {sum(1 for c in rep.checks if c.hard)} hard checks passed"
                        + (f"; advisories: {', '.join(c.name for c in rep.checks if not c.hard and not c.passed)}." if any(not c.hard and not c.passed for c in rep.checks) else "."),
                        {"switches": [a.switch_id for a in o.actions], "buses": sorted(o.spec.shed) or None},
                    )
                else:
                    failed = [f"{c.name}: {c.value}" for c in rep.checks if c.hard and not c.passed]
                    ev.add(rt.k_verif, "verification", "warning", f"Plan {o.cid} rejected by independent verification", "; ".join(failed))
            if fc.plan is None:
                ev.add(rt.k_verif, "verification", "critical", "No candidate passed verification", "Outage persists; the post-isolation configuration is kept.")
        if fc.plan is not None and fc.plan_verified and rt.k_switch < rt.n and (rt.k_repair is None or rt.k_switch < rt.k_repair):
            k = rt.k_switch
            if fc.plan.actions or fc.plan.spec.shed:
                acts = [f"{a.action} {a.switch_id}" for a in fc.plan.actions] + [f"shed B{b + 1}" for b in fc.plan.spec.shed]
                ev.add(k, "switching", "info", "Switching sequence executed", "; ".join(acts) + ".", {"switches": [a.switch_id for a in fc.plan.actions], "lines": [a.line_id for a in fc.plan.actions], "buses": sorted(fc.plan.spec.shed) or None})
                rest = sorted(fc.plan.restored_buses)
                if rest:
                    kw = sum(frames[k].power.bus_served_kw[b] for b in rest)
                    ev.add(k, "restoration", "success", f"{kw:.0f} kW restored", f"Re-energised {bus_list(rest)} via the verified plan.", {"buses": rest})
                for b in fc.plan.spec.shed:
                    fac = [f.name for f in d.facilities_on_bus(b)]
                    shed_kw = d.buses[b].load_kw * st.load_factor[k]
                    shed_kvar = d.buses[b].load_kvar * st.load_factor[k]
                    if b in rt.fault.downstream_dark:
                        txt = f"Non-critical load ({shed_kw:.0f} kW, {shed_kvar:.0f} kVAr) left off so the restored area stays within every hard limit."
                    else:
                        txt = f"Supplied non-critical load ({shed_kw:.0f} kW, {d.buses[b].connections} connections) interrupted to create voltage headroom for the restoration path."
                    ev.add(k, "switching", "warning", f"B{b + 1} shed" + (f" ({', '.join(fac)})" if fac else ""), txt, {"buses": [b]})
            else:
                ev.add(k, "info", "info", "No further switching", "The verified plan keeps the post-isolation configuration.")
    # hydraulic threshold crossings (from the EPS results)
    for i, t in enumerate(d.tanks):
        pct = hyd.tank_pct[:, i]
        k = _first_cross(pct, kf, lambda v: v < TANK_LOW_PCT)
        if k is not None:
            ev.add(k, "hydraulic", "warning", f"Tank {t['id']} below {TANK_LOW_PCT:.0f}%", f"{t['label']} at {pct[k]:.0f}% ({hyd.tank_level_m[k, i]:.2f} m).", {"facilities": [t["facilityId"]] if t.get("facilityId") else None})
            k2 = _first_cross(pct, k, lambda v: v <= 0.5)
            if k2 is not None:
                ev.add(k2, "hydraulic", "critical", f"Tank {t['id']} empty", f"{t['label']} reached its minimum operating level; the zone has no remaining storage.", {"facilities": [t["facilityId"]] if t.get("facilityId") else None})
            k3 = _first_cross(pct, (k2 or k) + 1, lambda v: v >= TANK_LOW_PCT)
            if k3 is not None:
                ev.add(k3, "hydraulic", "success", f"Tank {t['id']} recovering", f"{t['label']} back above {TANK_LOW_PCT:.0f}% ({pct[k3]:.0f}%).", {"facilities": [t["facilityId"]] if t.get("facilityId") else None})
    for j in d.critical_junction_ids:
        ji = hyd.jidx(j)
        pr = hyd.pressure_m[:, ji]
        fac = next((f for f in d.facilities if f.water_node == j), None)
        name = fac.name if fac else j
        k = _first_cross(pr, kf, lambda v: v < thr)
        while k is not None:
            ev.add(k, "hydraulic", "critical", f"{name} pressure below {thr:.0f} m", f"{j} at {max(pr[k], 0):.1f} m — below the service threshold.", {"junctions": [j], "facilities": [fac.id] if fac else None})
            k_up = _first_cross(pr, k + 1, lambda v: v >= thr)
            if k_up is None:
                break
            ev.add(k_up, "hydraulic", "success", f"{name} pressure restored", f"{j} back to {pr[k_up]:.1f} m.", {"junctions": [j], "facilities": [fac.id] if fac else None})
            k = _first_cross(pr, k_up + 1, lambda v: v < thr)
    if rt.k_repair is not None and rt.k_repair < rt.n:
        ev.add(rt.k_repair, "restoration", "success", "Faulted section repaired", "Crew repair complete; normal configuration restored.", {"lines": [fl.id]})
    last = frames[-1]
    ev.add(
        rt.n - 1,
        "info",
        "info",
        "End of simulation horizon",
        f"Served {last.power.served_kw:.0f} of {last.power.demand_kw:.0f} kW; {last.water.pumps_online}/{last.water.pumps_total} pumps running; "
        f"critical-facility pressure {last.water.critical_pressure_m:.1f} m; tanks {', '.join(f'{t} {p:.0f}%' for t, p in zip(hyd.tank_ids, last.water.tank_pct))}.",
    )
    return ev.build()


def impact_assessment(rt: ScenarioRuntime, sel: Selection) -> Optional[dict]:
    """Projection of the post-isolation state with no further switching (from the evaluated candidate)."""
    d = rt.district
    keep = next((s.outcome for s in sel.scored.values() if not s.outcome.spec.ties and not s.outcome.spec.opens and not s.outcome.spec.shed), None)
    if keep is None or keep.cr is None:
        return None
    hyd = keep.cr.hyd
    thr = float(d.water_options["serviceThresholdM"])
    st = rt.setup
    parts = []
    refs_fac = []
    dark = sorted(rt.fault.downstream_dark)
    if dark:
        kw = sum(d.buses[b].load_kw * st.load_factor[rt.k_impact] for b in dark)
        parts.append(f"{len(dark)} healthy bus{'es' if len(dark) != 1 else ''} ({bus_list(dark)}, {kw:.0f} kW) remain{'s' if len(dark) == 1 else ''} de-energised")
    stopped = [p for i, p in enumerate(d.pumps) if not hyd.pump_on[min(rt.k_impact, rt.n - 1), i]]
    for p in stopped:
        parts.append(f"{p.id} offline")
        refs_fac.append(p.station_id)
    risk = False
    for i, t in enumerate(d.tanks):
        k = _first_cross(hyd.tank_pct[:, i], rt.k_impact, lambda v: v < TANK_LOW_PCT)
        if k is not None:
            parts.append(f"projected: Tank {t['id']} below {TANK_LOW_PCT:.0f}% at {_clock(k, st.step_min)}")
            risk = True
    for j in d.critical_junction_ids:
        k = _first_cross(hyd.pressure_m[:, hyd.jidx(j)], rt.k_impact, lambda v: v < thr)
        if k is not None:
            fac = next((f for f in d.facilities if f.water_node == j), None)
            parts.append(f"projected: {fac.name if fac else j} pressure below {thr:.0f} m at {_clock(k, st.step_min)}")
            if fac:
                refs_fac.append(fac.id)
            risk = True
    if not parts:
        parts.append("no further electrical or hydraulic impact projected")
    text = "Without further switching: " + "; ".join(parts) + " (coupled power flow + extended-period hydraulic projection)."
    return {"text": text, "risk": risk, "refs": {"facilities": sorted(set(refs_fac)) or None, "buses": dark or None}}


# ─────────────────────────────────────────────────────────── timeline & summary
def build_timeline(fc: FrameContext, sel: Optional[Selection], frames: list[Frame], summary_restored_pct: float) -> list[TimelineStep]:
    rt = fc.rt
    st = rt.setup

    def at(k):
        if k is None or k >= rt.n:
            return None, None
        return k * st.step_min * 60, _clock(k, st.step_min)

    steps = []
    t, c = at(rt.k_fault)
    steps.append(TimelineStep(id="fault-detected", label="Fault detected", t=t, clock=c, outcome="done" if t is not None else "skipped", detail=f"{rt.fault.protective_switch} tripped by protection"))
    if fc.strategy == "none":
        for sid, label in (("fault-isolated", "Fault isolated"), ("recovery-evaluated", "Recovery evaluated"), ("constraints-verified", "Constraints verified"), ("service-restored", "Service restored")):
            steps.append(TimelineStep(id=sid, label=label, t=None, clock=None, outcome="skipped", detail="No intervention strategy: the protective device stays open"))
        return steps
    t, c = at(rt.k_iso)
    steps.append(TimelineStep(id="fault-isolated", label="Fault isolated", t=t, clock=c, outcome="done" if t is not None else "skipped", detail=f"Opened {', '.join(rt.fault.isolation_open)}" + (f", reclosed {', '.join(rt.fault.reclose)}" if rt.fault.reclose else "")))
    n_c = len(sel.scored) if sel else 0
    n_rej = sum(1 for s in sel.scored.values() if not s.outcome.feasible) if sel else 0
    t, c = at(rt.k_cand)
    steps.append(TimelineStep(id="recovery-evaluated", label="Recovery evaluated", t=t, clock=c, outcome="done" if (t is not None and n_c) else "failed", detail=f"{n_c} candidates evaluated, {n_rej} rejected"))
    t, c = at(rt.k_verif)
    if fc.plan_verified and fc.plan is not None:
        steps.append(TimelineStep(id="constraints-verified", label="Constraints verified", t=t, clock=c, outcome="done", detail=f"{fc.plan.cid} Simulation Verified (independent re-solve)"))
    else:
        steps.append(TimelineStep(id="constraints-verified", label="Constraints verified", t=t, clock=c, outcome="failed", detail="No candidate passed every hard check"))
    t, c = at(rt.k_switch)
    if not fc.plan_verified:
        steps.append(TimelineStep(id="service-restored", label="Service restored", t=None, clock=None, outcome="failed", detail="Outage persists"))
    else:
        oc = "done" if fc.outcome == "complete" else "partial"
        steps.append(TimelineStep(id="service-restored", label="Service restored", t=t, clock=c, outcome=oc, detail=f"{summary_restored_pct:.0f}% of interrupted load served at end of horizon"))
    return steps


def build_summary(fc: FrameContext, frames: list[Frame], series: dict, sel: Optional[Selection], strategy: str) -> RunSummary:
    rt = fc.rt
    d = rt.district
    st = rt.setup
    hyd = fc.cr.hyd
    n = rt.n
    dt_h = st.step_min / 60.0
    thr = float(d.water_options["serviceThresholdM"])
    kf = min(rt.k_fault, n - 1)
    tripped = sorted(rt.fault.tripped_buses)
    pre = frames[kf - 1] if kf > 0 else frames[0]
    load_int = sum(pre.power.bus_served_kw[b] for b in tripped)
    conns = sum(d.buses[b].connections for b in tripped)
    last = frames[-1]
    rest_kw = sum(last.power.bus_served_kw[b] for b in tripped)
    # demand of the interrupted buses at the end (incl. would-be pump demand)
    base_pump = rt.baseline_pump_kw()
    dem_end = sum(d.buses[b].load_kw * st.load_factor[n - 1] for b in tripped)
    for i, p in enumerate(d.pumps):
        if p.bus in rt.fault.tripped_buses:
            dem_end += hyd.pump_kw[n - 1, i] if hyd.pump_on[n - 1, i] else base_pump[n - 1, i]
    rest_pct = 100.0 * rest_kw / dem_end if dem_end > 0 else 100.0
    pumps_off_max = 0
    for k in range(kf, n):
        pumps_off_max = max(pumps_off_max, int(len(d.pumps) - hyd.pump_on[k].sum()))
    crit_facs = [f for f in d.facilities if f.critical]
    at_risk = [f for f in crit_facs if any(s != "safe" for s in series["facStatus"][f.id][kf:])]
    recovered = [f for f in at_risk if series["facStatus"][f.id][-1] in ("safe", "restored")]
    served_e = sum(series["served"][:-1]) * dt_h
    unserved_e = sum(series["unserved"][:-1]) * dt_h
    crit_e = sum(series["critUnserved"][:-1]) * dt_h
    req_m3 = sum(series["req"][:-1]) * st.step_min * 60 / 1000.0
    dlv_m3 = sum(series["dlv"][:-1]) * st.step_min * 60 / 1000.0
    demand_j = [hyd.jidx(j) for j in d.demand_junction_ids]
    crit_j = [hyd.jidx(j) for j in d.critical_junction_ids]
    minp = float(max(0.0, hyd.pressure_m[:, demand_j].min()))
    minc = float(max(0.0, hyd.pressure_m[:, crit_j].min()))
    below_frames = [k for k in range(n) if any(hyd.pressure_m[k, j] < thr for j in crit_j)]
    first_pump_stop = None
    for k in range(max(1, kf), n):
        if hyd.pump_on[k].sum() < hyd.pump_on[k - 1].sum():
            first_pump_stop = k
            break
    delay = None
    if first_pump_stop is not None:
        kb = next((k for k in below_frames if k >= first_pump_stop), None)
        if kb is not None:
            delay = float((kb - first_pump_stop) * st.step_min)
    n_c = len(sel.scored) if sel else 0
    n_rej = sum(1 for s in sel.scored.values() if not s.outcome.feasible) if sel else 0
    ops = 0
    if strategy != "none" and rt.k_iso < n:
        ops += len(rt.fault.isolation_open) + len(rt.fault.reclose)
        if fc.plan is not None and fc.plan_verified and rt.k_switch < n:
            ops += len(fc.plan.actions) + len(fc.plan.spec.shed)
    fl = d.lines[rt.fault.fault_line]
    return RunSummary(
        fault_label=f"Feeder {fl.feeder} · line B{fl.from_bus + 1}–B{fl.to_bus + 1}",
        fault_line_id=fl.id,
        fault_clock=_clock(rt.k_fault, st.step_min),
        feeder_id=fl.feeder,
        load_interrupted_kw=_r(load_int, 1),
        connections_affected=int(conns),
        pumps_offline=pumps_off_max,
        critical_at_risk=len(at_risk),
        load_restored_kw=_r(rest_kw, 1),
        load_restored_pct=_r(rest_pct, 1),
        remaining_unserved_kw=_r(last.power.unserved_kw, 1),
        critical_recovered=len(recovered),
        critical_total=len(crit_facs),
        pumps_available_end=int(hyd.pump_on[-1].sum()),
        pumps_total=len(d.pumps),
        served_energy_kwh=_r(served_e, 1),
        unserved_energy_kwh=_r(unserved_e, 1),
        critical_unserved_kwh=_r(crit_e, 1),
        water_required_m3=_r(req_m3, 1),
        water_delivered_m3=_r(dlv_m3, 1),
        water_delivered_pct=_r(100.0 * dlv_m3 / req_m3, 2) if req_m3 > 0 else 100.0,
        min_pressure_m=_r(minp, 2),
        min_critical_pressure_m=_r(minc, 2),
        tank_min_pct=_r(float(hyd.tank_pct.min()), 1),
        minutes_below_service_pressure=float(len(below_frames) * st.step_min),
        hydraulic_delay_min=delay,
        constraint_violations=int(sum(series["vviol"]) + sum(series["tviol"])),
        switch_ops=ops,
        plan_compute_ms=_r(sel.plan_ms, 1) if sel else 0.0,
        candidates_evaluated=n_c,
        candidates_rejected=n_rej,
        outcome="no-intervention" if strategy == "none" else fc.outcome,
    )


def _plan_outcome(rt: ScenarioRuntime, outcome: CandidateOutcome, report: VerificationReport) -> str:
    dark_left = [b for b in rt.fault.downstream_dark if b not in outcome.restored_buses]
    soft_fail = any(not c.passed for c in report.checks if not c.hard)
    if not dark_left and not outcome.spec.shed and not soft_fail:
        return "complete"
    return "partial"


def build_plan(rt: ScenarioRuntime, strategy: str, sel: Selection, frames: list[Frame], fc: FrameContext) -> Optional[RecoveryPlan]:
    d = rt.district
    st = rt.setup
    best_attempt = sel.chosen
    report = sel.report
    if best_attempt is None:
        if not sel.attempts:
            return None
        best_attempt, report = sel.attempts[0]
    s = sel.scored[best_attempt.cid]
    o = best_attempt
    verified = report.passed
    k_after = min(rt.k_switch, rt.n - 1)
    fr = frames[k_after]
    unserved_buses = sorted(b for b in range(d.n_bus) if b not in fc.cr.energized[k_after] or b in fc.cr.timeline.at(k_after).shed)
    unserved_kw = sum(d.buses[b].load_kw * st.load_factor[k_after] for b in unserved_buses)
    unserved_fac = [f.id for f in d.facilities if f.bus is not None and f.bus in unserved_buses]
    protected = []
    for f in d.facilities:
        if not f.critical:
            continue
        if f.bus is not None and f.bus in o.restored_buses:
            protected.append(f.id)
    if any(p.bus in o.restored_buses for p in d.pumps):
        for z in d.raw["water"]["zones"]:
            if any(p.bus in o.restored_buses for p in d.pumps if p.id in z["pumps"]):
                for f in d.facilities:
                    if f.critical and f.water_node and (f.water_node in z["tanks"] or next((j for j in d.junctions if j["id"] == f.water_node and j["zone"] == z["id"]), None)):
                        if f.id not in protected:
                            protected.append(f.id)
    rationale = plan_rationale(rt, strategy, sel, o, s, report)
    assumptions = [
        "Synthetic district on the IEEE 33-bus benchmark; ratings, pump curves and demand profiles are declared assumptions.",
        "Loads are constant-power and follow the declared time-of-day profile; pump demand comes from the hydraulic solution.",
        "A pump runs only if its bus is energised and V ≥ 0.90 pu (latching undervoltage trip).",
        "Switching is executed remotely at the switching time; the faulted section stays isolated for the horizon"
        + (" until the repair time." if rt.k_repair is not None else "."),
        "Gensets carry essential electrical load only; they do not power pumping stations.",
    ]
    if strategy == "grid-only":
        assumptions.append("Grid-only objective: maximise restored electrical energy; facilities on backup generation count as served; pumps are ordinary loads; water ignored.")
    else:
        assumptions.append("Encirra objective: weighted served energy, critical energy, water delivered, critical water-service hours and storage, minus switching cost (weights in the run).")
    outcome = _plan_outcome(rt, o, report) if verified else "infeasible"
    return RecoveryPlan(
        candidate_id=o.cid,
        strategy=strategy,
        label=o.label,
        actions=o.actions,
        shed_buses=list(o.spec.shed),
        verification=report,
        score=(s.score_encirra if strategy == "encirra" else s.score_grid) or 0.0,
        score_breakdown=s.breakdown or ScoreBreakdown(served_load=0, critical_load=0, water_delivered=0, critical_water=0, pressure_storage=0, switching_cost=0, total=0),
        outcome=outcome,
        verified_at_t=min(rt.k_verif, rt.n - 1) * st.step_min * 60,
        applied_at_t=(rt.k_switch * st.step_min * 60) if (verified and (o.actions or o.spec.shed) and rt.k_switch < rt.n) else None,
        rationale=rationale,
        protected_facilities=protected,
        unserved_after=UnservedAfter(buses=unserved_buses, kw=_r(unserved_kw, 1), facilities=unserved_fac),
        assumptions=assumptions,
    )


def _first_below(o: CandidateOutcome, rt: ScenarioRuntime) -> Optional[tuple[str, int]]:
    """(junction id, frame) of the first critical-facility pressure below the service threshold."""
    if o.cr is None:
        return None
    thr = float(rt.district.water_options["serviceThresholdM"])
    hyd = o.cr.hyd
    best = None
    for j in rt.district.critical_junction_ids:
        k = _first_cross(hyd.pressure_m[:, hyd.jidx(j)], rt.k_fault, lambda v: v < thr)
        if k is not None and (best is None or k < best[1]):
            best = (j, k)
    return best


def plan_rationale(rt: ScenarioRuntime, strategy: str, sel: Selection, o: CandidateOutcome, s: Scored, report: VerificationReport) -> list[str]:
    d = rt.district
    st = rt.setup
    m = o.metrics
    region = rt.fault.downstream_dark
    k_sw = min(rt.k_switch, rt.n - 1)
    lf = float(st.load_factor[k_sw])
    out: list[str] = []
    feas = [x for x in sel.scored.values() if x.outcome.feasible]
    rej = [x for x in sel.scored.values() if not x.outcome.feasible]
    interrupting = [x for x in feas if x.outcome.extra.get("interrupts")]
    clock = lambda k: _clock(k, st.step_min)  # noqa: E731
    if strategy == "encirra":
        adm = [x for x in feas if x.score_encirra is not None]
        grid_txt = (
            f"rank {s.rank_grid} under the grid-only objective"
            if s.rank_grid is not None
            else "not admissible for grid-only, which never interrupts customers who still have supply"
        )
        out.append(f"Highest Encirra score among {len(adm)} admissible feasible candidates ({s.score_encirra:.2f}); {grid_txt}.")
    else:
        adm = [x for x in feas if x.score_grid is not None]
        out.append(
            f"Highest grid-only score among {len(adm)} admissible feasible candidates ({s.score_grid:.2f}): conventional restoration "
            "maximises restored electrical energy and never interrupts customers who still have supply."
        )
        # why grid-only values the west-district loads the way it does
        notes = []
        for f in d.facilities:
            if f.bus is not None and f.bus in region and f.backup:
                dem = d.buses[f.bus].load_kw * lf
                notes.append(f"{f.name}'s {f.backup_kw:.0f} kW genset-supplied load counts as already served, so re-energising B{f.bus + 1} is worth only {max(0.0, dem - f.backup_kw):.0f} kW")
        for p in d.pumps:
            if p.bus in region:
                kw = d.buses[p.bus].load_kw * lf + float(rt.baseline_pump_kw()[k_sw, [x.id for x in d.pumps].index(p.id)])
                notes.append(f"{p.station_id.upper()} (B{p.bus + 1}) is an ordinary {kw:.0f} kW load whose water service is outside the objective")
        if notes:
            out.append("Grid-only accounting: " + "; ".join(notes) + ".")
        if interrupting:
            ex = interrupting[0].outcome
            out.append(f"{len(interrupting)} feasible plan(s) that interrupt supplied customers for voltage headroom (e.g. {ex.cid}: {ex.label}) are outside this policy.")
    out.append(f"Restores {m.restored_kw:.0f} kW at switching; sheds {m.shed_kw:.0f} kW; {m.switch_ops} switching operation(s).")
    region_shed = [b for b in o.spec.shed if b in region]
    head_shed = [b for b in o.spec.shed if b not in region]
    if region_shed:
        names = []
        for b in region_shed:
            fac = d.facilities_on_bus(b)
            names.append(f"B{b + 1}" + (f" ({fac[0].name}, {d.buses[b].load_kw:.0f} kW / {d.buses[b].load_kvar:.0f} kVAr)" if fac else ""))
        out.append(f"Leaves {', '.join(names)} off so the rest of the de-energised area can be restored within every hard limit.")
    if head_shed:
        kw = sum(d.buses[b].load_kw * lf for b in head_shed)
        conn = sum(d.buses[b].connections for b in head_shed)
        out.append(
            f"Interrupts {bus_list(head_shed)} ({kw:.0f} kW, {conn} connections) — customers who still had supply — to create voltage headroom "
            "at the tie; admissible only because no plan without new interruptions protects the same critical facilities."
        )
    for p in [p for p in d.pumps if p.bus in region]:
        if p.bus in o.restored_buses and m.pumps_restored:
            out.append(f"{p.id} back in service: tank storage stays ≥ {m.tank_min_pct:.0f}% and critical-facility pressure ≥ {m.min_critical_pressure_m:.1f} m for the rest of the horizon.")
        else:
            fb = _first_below(o, rt)
            when = f" from {clock(fb[1])}" if fb else ""
            out.append(f"{p.id} stays without supply: the extended-period simulation shows critical-facility pressure falling to {m.min_critical_pressure_m:.1f} m{when} and tank storage to {m.tank_min_pct:.0f}%.")
    if m.v_min_pu is not None:
        load_txt = f"; peak line loading {m.max_loading_pct:.0f}%" if m.max_loading_pct is not None else ""
        out.append(f"Worst evaluated voltage {m.v_min_pu:.3f} pu (hard limit 0.90 pu){load_txt}.")
    other = "grid-only" if strategy == "encirra" else "encirra"
    alt_list = ranked(sel.scored, other)
    if alt_list and alt_list[0].outcome.cid != o.cid:
        a = alt_list[0].outcome
        fb = _first_below(a, rt)
        water = (
            f"critical-facility pressure falls below 20 m at {clock(fb[1])}" if fb else f"critical-facility pressure stays ≥ {a.metrics.min_critical_pressure_m:.1f} m"
        )
        txt = f"The {other} optimum ({a.cid}: {a.label}) restores {a.metrics.restored_kw:.0f} kW; with it {water} (tank minimum {a.metrics.tank_min_pct:.0f}%)."
        if strategy == "grid-only" and o.terms and a.terms:
            txt += f" In grid-only accounting it is worth {a.terms['gridValueMWh']:.2f} MWh against {o.terms['gridValueMWh']:.2f} MWh for this plan."
        out.append(txt)
    if rej:
        reasons = [f"{x.outcome.cid} — {x.outcome.reasons[0]}" for x in rej[:3]]
        out.append(f"{len(rej)} candidates rejected on hard constraints, e.g. " + "; ".join(reasons) + ".")
    hard = [c for c in report.checks if c.hard]
    out.append(f"Independent verification: {sum(1 for c in hard if c.passed)}/{len(hard)} hard checks passed ({'Simulation Verified' if report.passed else 'rejected'}).")
    return out


def candidate_models(sel: Selection) -> list[CandidateEvaluation]:
    out = []
    for cid in sorted(sel.scored):
        s = sel.scored[cid]
        o = s.outcome
        out.append(
            CandidateEvaluation(
                id=o.cid,
                label=o.label,
                actions=o.actions,
                shed_buses=list(o.spec.shed),
                feasible=o.feasible,
                rejected_reasons=o.reasons,
                checks=o.checks,
                metrics=o.metrics,
                score_encirra=s.score_encirra,
                score_grid_only=s.score_grid,
                score_breakdown=s.breakdown,
                rank_encirra=s.rank_encirra,
                rank_grid_only=s.rank_grid,
            )
        )
    return out


# ─────────────────────────────────────────────────────────── public entry point
def run(request: RunRequest, source: str = "live", use_cache: bool = True) -> RunResult:
    t_start = time.perf_counter()
    defn = scenario_definition(request.scenario_id)
    params = resolve_params(defn, request.params)
    weights = resolve_weights(request.weights)
    rid = run_id_for(request.scenario_id, request.strategy, params, weights)
    if use_cache:
        hit = _cache_get(rid)
        if hit is not None:
            res = RunResult.model_validate(hit)
            if res.provenance.source != source:
                res = res.model_copy(update={"provenance": res.provenance.model_copy(update={"source": source})})
            return res
    rt = get_runtime(request.scenario_id, params)
    strategy = request.strategy
    sel: Optional[Selection] = None
    plan_outcome: Optional[CandidateOutcome] = None
    verified = False
    if strategy != "none" and rt.k_iso < rt.n:
        sel = select_plan(rt, strategy, weights)
        plan_outcome = sel.chosen
        verified = sel.chosen is not None
    timeline = rt.timeline_for(plan_outcome if verified else None, strategy)
    cr = rt.simulate(timeline)
    if strategy == "none":
        outcome = "no-intervention"
    elif not verified:
        outcome = "infeasible"
    else:
        outcome = _plan_outcome(rt, plan_outcome, sel.report)
    fc = FrameContext(rt, strategy, cr, plan_outcome, verified, outcome)
    frames, series = build_frames(fc)
    impact = impact_assessment(rt, sel) if sel is not None else None
    events = build_events(fc, frames, sel, series, impact)
    summary = build_summary(fc, frames, series, sel, strategy)
    tl = build_timeline(fc, sel, frames, summary.load_restored_pct)
    plan = build_plan(rt, strategy, sel, frames, fc) if sel is not None else None
    candidates = candidate_models(sel) if sel is not None else []
    st = rt.setup
    date = load_district().raw["district"]["clock"]["date"]
    hh, mm = divmod(START_CLOCK_MIN, 60)
    prov = Provenance(
        engine_version=ENGINE_VERSION,
        pandapower=pandapower.__version__,
        wntr=wntr.__version__,
        python=platform.python_version(),
        electrical_solver="pandapower AC Newton–Raphson (IEEE 33-bus, case33bw)",
        hydraulic_solver="EPANET 2.2 via WNTR EpanetSimulator (pressure-driven demand)",
        coupling=COUPLING_TEXT + f" Final run: {cr.iterations} iteration(s), {'converged' if cr.converged else 'not converged'}.",
        seed=params.seed,
        computed_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        compute_ms=_r((time.perf_counter() - t_start) * 1000.0, 1),
        source=source,
    )
    result = RunResult(
        run_id=rid,
        scenario_id=request.scenario_id,
        strategy=strategy,
        params=params,
        weights=weights,
        provenance=prov,
        timebase=Timebase(start_clock=f"{hh:02d}:{mm:02d}", start_iso=f"{date}T{hh:02d}:{mm:02d}:00+04:00", step_seconds=st.step_min * 60, steps=rt.n),
        events=events,
        timeline=tl,
        frames=frames,
        plan=plan,
        candidates=candidates,
        summary=summary,
    )
    if use_cache:
        _cache_put(rid, result.model_dump(by_alias=True, mode="json"))
    return result


def default_strategies() -> tuple[str, ...]:
    return ("none", "grid-only", "encirra")


def scenario_ids() -> list[str]:
    return [sid for sid in SCENARIO_ORDER if sid in load_scenario_files()] + [s for s in load_scenario_files() if s not in SCENARIO_ORDER]


def compare(scenario_id: str, params=None, weights=None, source: str = "live", use_cache: bool = True):
    """Run all three strategies for one scenario; returns (Comparison, {strategy: RunResult})."""
    from .models import Comparison, StrategyPlans, StrategySummaries

    scenario_definition(scenario_id)  # KeyError for unknown scenarios
    runs = {}
    for strategy in default_strategies():
        runs[strategy] = run(RunRequest(scenario_id=scenario_id, strategy=strategy, params=params, weights=weights), source=source, use_cache=use_cache)
    ref = runs["encirra"]
    comp = Comparison(
        scenario_id=scenario_id,
        params=ref.params,
        weights=ref.weights,
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        summaries=StrategySummaries(none=runs["none"].summary, grid_only=runs["grid-only"].summary, encirra=runs["encirra"].summary),
        plans=StrategyPlans(none=runs["none"].plan, grid_only=runs["grid-only"].plan, encirra=runs["encirra"].plan),
    )
    return comp, runs

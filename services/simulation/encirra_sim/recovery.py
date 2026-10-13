"""Recovery planning: candidate generation, coupled evaluation, hard checks and scoring.

Candidate generation (after the faulted section is isolated)
------------------------------------------------------------
Let R be the healthy buses left de-energised after isolation. Candidates are radial
reconfigurations that

* close 1–2 remote, normally-open tie switches with at least one end in R,
* open 0–1 remote sectionalizer on a line inside R (to split R between two sources), and
* optionally shed 0–2 non-critical loads in R,

plus the "no further switching" option. Topologies producing an identical electrical state are
de-duplicated and the enumeration respects the switching-operation limit. This is an *exhaustive
constrained search*: at this network size every combination is evaluated, so the selected plan is
the exact optimum of each objective over the candidate set. The only pruning is dominance: for a
given topology, a shed set that is a superset of an already-feasible shed set energises the same
buses and pumps and only serves less load, so it cannot score higher under either objective.

Every candidate is screened with topological hard checks (remote operability, switch-count limit,
radiality, faulted-section isolation). Survivors are evaluated with the coupled co-simulation
(EPANET extended-period hydraulics every minute over the whole horizon; AC power flow at the
switching instant, every 15 min, at the peak-load minute and at the last minute of the remaining
horizon) and checked against the hard electrical limits. The selected plan is then verified
independently (verification.py) with a per-minute re-solve.

Objectives (soft, weighted — hard constraints are never weighted)
-----------------------------------------------------------------
* ``grid-only``: maximise restored electrical energy. Facilities already running on backup
  generation count as served (only their load above the backup rating has value); pumps are
  ordinary loads; water is ignored; life-safety facilities without backup are weighted by
  ``criticalLoad``.
* ``encirra``: ObjectiveWeights over the coupled result for the remaining horizon — served energy,
  critical-bus energy, water delivered, critical-facility water-service hours, minimum tank storage,
  minus a per-operation switching cost.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Optional

import networkx as nx
import numpy as np

from .config import (
    MAX_SECTIONALIZER_OPENS,
    MAX_SHED_BUSES,
    MAX_SWITCH_OPS,
    MAX_TIE_CLOSURES,
    PUMP_UNDERVOLTAGE_TRIP_PU,
    TANK_LOW_PCT,
    District,
)
from .coupling import CoupledResult, Segment, SimSetup, SwitchingTimeline, simulate
from .electrical import PowerNetwork
from .models import CandidateMetrics, ObjectiveWeights, ScoreBreakdown, SwitchAction, VerificationCheck
from .profiles import clock_str
from .screening import impedance_table, lindistflow_feasible, propose_shed_set
from .topology import FaultPlan, check_radiality, energized_buses
from .water import pump_power_kw

LIFE_SAFETY_KINDS = ("hospital", "emergency-ops")


@dataclass(frozen=True)
class CandidateSpec:
    ties: tuple[int, ...]
    opens: tuple[int, ...]
    shed: tuple[int, ...]
    closed: tuple[bool, ...]

    @property
    def ops(self) -> int:
        return len(self.ties) + len(self.opens) + len(self.shed)


@dataclass
class CandidateOutcome:
    cid: str
    spec: CandidateSpec
    label: str
    actions: list[SwitchAction]
    feasible: bool
    reasons: list[str]
    checks: list[VerificationCheck]
    metrics: CandidateMetrics
    terms: Optional[dict]
    restored_buses: frozenset[int]
    energized_after: frozenset[int]
    cr: Optional[CoupledResult] = None
    extra: dict = field(default_factory=dict)


@dataclass
class PlanningContext:
    district: District
    setup: SimSetup
    fault: FaultPlan
    k_fault: int
    k_iso: int
    k_switch: int
    k_repair: Optional[int]
    closed_iso: tuple[bool, ...]
    base_segments: list[Segment]  # normal → trip → isolation (shared by every candidate)
    net: PowerNetwork

    def candidate_timeline(self, spec: CandidateSpec | None) -> SwitchingTimeline:
        segs = [s for s in self.base_segments if self.k_repair is None or s.start < self.k_repair]
        if spec is not None and self.k_switch < self.setup.n_frames and (self.k_repair is None or self.k_switch < self.k_repair):
            segs.append(Segment(self.k_switch, spec.closed, frozenset(spec.shed), True, "plan"))
        if self.k_repair is not None and self.k_repair < self.setup.n_frames:
            segs.append(Segment(self.k_repair, self.district.normal_switch_state(), frozenset(), False, "repair"))
        segs.sort(key=lambda s: s.start)
        return SwitchingTimeline(segs, self.fault.fault_line)

    def sample_frames(self) -> list[int]:
        n = self.setup.n_frames
        k0 = min(self.k_switch, n - 1)
        end = n if self.k_repair is None else max(k0 + 1, min(n, self.k_repair))
        frames = set(range(k0, end, max(1, 15 // self.setup.step_min)))
        frames.add(end - 1)
        lf = self.setup.load_factor[k0:end]
        frames.add(k0 + int(np.argmax(lf)))
        return sorted(frames)


# ─────────────────────────────────────────────────────────── generation
def topologies(ctx: PlanningContext) -> list[tuple[tuple[int, ...], tuple[int, ...], tuple[bool, ...]]]:
    """Radial-reconfiguration topologies: close 1–2 ties touching R, open 0–1 sectionalizer inside R
    (plus the post-isolation configuration itself)."""
    d = ctx.district
    region = ctx.fault.downstream_dark
    section = ctx.fault.section_buses
    base = ctx.closed_iso
    out: list[tuple[tuple[int, ...], tuple[int, ...], tuple[bool, ...]]] = [((), (), base)]
    if not region:
        return out
    ties = [
        ln.id
        for ln in d.lines
        if ln.kind == "tie" and not base[ln.id] and (ln.from_bus in region or ln.to_bus in region or ln.from_bus in section or ln.to_bus in section)
    ]
    sects = [
        ln.id
        for ln in d.lines
        if ln.kind == "feeder" and base[ln.id] and ln.from_bus in region and ln.to_bus in region and ln.id != ctx.fault.fault_line
    ]
    oos = [ctx.fault.fault_line]
    seen: set = set()
    for nt in range(1, MAX_TIE_CLOSURES + 1):
        for tset in itertools.combinations(ties, nt):
            for nsect in range(0, MAX_SECTIONALIZER_OPENS + 1):
                for oset in itertools.combinations(sects, nsect):
                    if nt + nsect > MAX_SWITCH_OPS:
                        continue
                    closed = list(base)
                    for t in tset:
                        closed[t] = True
                    for o in oset:
                        closed[o] = False
                    closed_t = tuple(closed)
                    en = energized_buses(d, closed_t, oos)
                    if not any(b in en for b in region) and not any(b in en for b in section):
                        continue
                    # identical energised set and identical set of live closed lines ⇒ same electrical state
                    sig = (frozenset(en), frozenset(i for i, c in enumerate(closed_t) if c and d.lines[i].from_bus in en))
                    if sig in seen:
                        continue
                    seen.add(sig)
                    out.append((tuple(tset), tuple(oset), closed_t))
    return out


# ─────────────────────────────────────────────────────────── labels & actions
def _sw(d: District, line_id: int) -> str:
    return d.lines[line_id].switch_id


def label_for(d: District, spec: CandidateSpec) -> str:
    parts = []
    for t in spec.ties:
        parts.append(f"close {_sw(d, t)}")
    for o in spec.opens:
        parts.append(f"open {_sw(d, o)}")
    for b in spec.shed:
        parts.append(f"shed B{b + 1}")
    if not parts:
        return "No further switching (keep post-isolation configuration)"
    s = " · ".join(parts)
    return s[0].upper() + s[1:]


def bus_list(buses) -> str:
    bs = sorted(buses)
    if not bs:
        return "—"
    return ", ".join(f"B{b + 1}" for b in bs)


def fed_through(d: District, closed: tuple[bool, ...], oos: list[int]) -> dict[int, Optional[int]]:
    """For each energised bus, the tie line (if any) on its supply path from the substation."""
    g = nx.Graph()
    g.add_node(d.substation_bus)
    for ln in d.lines:
        if closed[ln.id] and ln.id not in oos:
            g.add_edge(ln.from_bus, ln.to_bus, line=ln.id)
    out: dict[int, Optional[int]] = {d.substation_bus: None}
    for u, v in nx.bfs_edges(g, d.substation_bus):
        lid = g.edges[u, v]["line"]
        out[v] = lid if d.lines[lid].kind == "tie" else out.get(u)
    return out


def actions_for(ctx: PlanningContext, spec: CandidateSpec, restored: frozenset[int]) -> list[SwitchAction]:
    """Switching sequence in execution order: sectionalizers open first, then ties close (never parallel sources)."""
    d = ctx.district
    acts: list[SwitchAction] = []
    feed = fed_through(d, spec.closed, [ctx.fault.fault_line])
    for o in spec.opens:
        ln = d.lines[o]
        acts.append(
            SwitchAction(
                switch_id=ln.switch_id,
                line_id=o,
                action="open",
                reason=f"Split the de-energised section between B{ln.from_bus + 1} and B{ln.to_bus + 1} so that each part has a single source (radial operation)",
            )
        )
    for t in spec.ties:
        ln = d.lines[t]
        picked = sorted(b for b in restored if feed.get(b) == t)
        src = ln.from_bus if ln.from_bus not in ctx.fault.downstream_dark else ln.to_bus
        acts.append(
            SwitchAction(
                switch_id=ln.switch_id,
                line_id=t,
                action="close",
                reason=f"Back-feed {bus_list(picked)} from Feeder {d.buses[src].feeder} (B{src + 1}) through tie B{ln.from_bus + 1}–B{ln.to_bus + 1}",
            )
        )
    return acts


# ─────────────────────────────────────────────────────────── objective
def objective_terms(ctx: PlanningContext, cr: CoupledResult, k0: int) -> dict:
    """Energy / water / service terms over the remaining horizon [k0, end) (one interval per frame)."""
    d = ctx.district
    st = ctx.setup
    dt_h = st.step_min / 60.0
    n = st.n_frames
    crit_buses = [b.id for b in d.buses if b.critical]
    served_mwh = critical_mwh = grid_value_mwh = grid_crit_mwh = 0.0
    life_safety_no_backup = set()
    backup_on_bus: dict[int, float] = {}
    for f in d.facilities:
        if f.bus is None:
            continue
        if f.backup:
            backup_on_bus[f.bus] = backup_on_bus.get(f.bus, 0.0) + f.backup_kw
        elif f.kind in LIFE_SAFETY_KINDS:
            life_safety_no_backup.add(f.bus)
    for k in range(k0, n - 1):
        s = cr.served_bus_kw(k)
        served_mwh += float(s.sum()) * dt_h / 1000.0
        critical_mwh += float(s[crit_buses].sum()) * dt_h / 1000.0
        lf = st.load_factor[k]
        for b in range(d.n_bus):
            if s[b] <= 0:
                continue
            covered = min(backup_on_bus.get(b, 0.0), d.buses[b].load_kw * lf)
            rem = max(0.0, s[b] - covered)
            grid_value_mwh += rem * dt_h / 1000.0
            if b in life_safety_no_backup:
                grid_crit_mwh += rem * dt_h / 1000.0
    hyd = cr.hyd
    step_s = st.step_min * 60.0
    water_m3 = float(hyd.delivered_lps[k0 : n - 1].sum()) * step_s / 1000.0
    required_m3 = float(hyd.required_lps[k0 : n - 1].sum()) * step_s / 1000.0
    thr = float(d.water_options["serviceThresholdM"])
    crit_idx = [hyd.jidx(j) for j in d.critical_junction_ids]
    crit_water_h = float((hyd.pressure_m[k0 : n - 1][:, crit_idx] >= thr).sum()) * dt_h
    tank_min = hyd.tank_pct[k0:n].min(axis=0)
    return {
        "servedMWh": served_mwh,
        "criticalMWh": critical_mwh,
        "gridValueMWh": grid_value_mwh,
        "gridCriticalMWh": grid_crit_mwh,
        "waterM3": water_m3,
        "requiredM3": required_m3,
        "criticalWaterH": crit_water_h,
        "storagePct": float(np.mean(tank_min)),
    }


def score_encirra(terms: dict, ops: int, w: ObjectiveWeights) -> ScoreBreakdown:
    sl = w.served_load * terms["servedMWh"]
    cl = w.critical_load * terms["criticalMWh"]
    wd = w.water_delivered * terms["waterM3"] / 1000.0
    cw = w.critical_water * terms["criticalWaterH"]
    ps = w.pressure_storage * terms["storagePct"]
    sc = -w.switching_cost * ops
    total = sl + cl + wd + cw + ps + sc
    r = lambda x: round(float(x), 4)  # noqa: E731
    return ScoreBreakdown(
        served_load=r(sl), critical_load=r(cl), water_delivered=r(wd), critical_water=r(cw), pressure_storage=r(ps), switching_cost=r(sc), total=r(total)
    )


def score_grid_only(terms: dict, ops: int, w: ObjectiveWeights) -> float:
    return round(w.served_load * terms["gridValueMWh"] + w.critical_load * terms["gridCriticalMWh"] - w.switching_cost * ops, 4)


# ─────────────────────────────────────────────────────────── checks
def _check(cid: str, name: str, hard: bool, passed: bool, value: str, limit: str, detail: str) -> VerificationCheck:
    return VerificationCheck(id=cid, name=name, hard=hard, passed=passed, value=value, limit=limit, detail=detail)


def topology_checks(ctx: PlanningContext, spec: CandidateSpec) -> tuple[list[VerificationCheck], list[str]]:
    d = ctx.district
    checks: list[VerificationCheck] = []
    reasons: list[str] = []
    non_remote = [d.lines[i].switch_id for i in (*spec.ties, *spec.opens) if not d.lines[i].remote]
    ok_ops = spec.ops <= MAX_SWITCH_OPS
    ok = ok_ops and not non_remote
    detail = "All operations are remote-controlled" if not non_remote else f"Not remotely operable: {', '.join(non_remote)}"
    checks.append(_check("switching-feasible", "Switching feasibility", True, ok, f"{spec.ops} operation(s)", f"≤ {MAX_SWITCH_OPS}, remote only", detail))
    if not ok_ops:
        reasons.append(f"{spec.ops} switching operations > limit of {MAX_SWITCH_OPS}")
    for s in non_remote:
        reasons.append(f"{s} is not remotely operable")
    oos = [ctx.fault.fault_line]
    rad = check_radiality(d, spec.closed, oos)
    if rad.radial:
        checks.append(_check("radiality", "Radial operation", True, True, "radial", "no closed loops", rad.detail))
    else:
        loop_txt = []
        for loop in rad.loops:
            sws = [d.lines[i].switch_id for i in loop if d.lines[i].kind == "tie" or i in spec.ties]
            if not sws:
                sws = [d.lines[i].switch_id for i in loop[:2]]
            loop_txt.append(" and ".join(sws) if len(sws) > 1 else f"{sws[0]} (both ends already energised)")
        msg = "; ".join(f"loop formed via {t}" for t in loop_txt)
        checks.append(_check("radiality", "Radial operation", True, False, f"{len(rad.loops)} loop(s)", "no closed loops", msg))
        reasons.append(msg)
    en = energized_buses(d, spec.closed, oos)
    fl = d.lines[ctx.fault.fault_line]
    live_section = sorted(b for b in ctx.fault.section_buses if b in en)
    fault_live = spec.closed[fl.id] and (fl.from_bus in en or fl.to_bus in en)
    ok = not live_section and not fault_live
    checks.append(
        _check(
            "fault-isolation",
            "Faulted section isolated",
            True,
            ok,
            "isolated" if ok else f"re-energised ({bus_list(live_section) if live_section else 'line ' + d.line_label(fl.id)})",
            "faulted section de-energised",
            f"Faulted line {d.line_label(fl.id)}; section buses {bus_list(ctx.fault.section_buses)}",
        )
    )
    if not ok:
        reasons.append(f"re-energises the faulted section ({bus_list(live_section) or d.line_label(fl.id)})")
    return checks, reasons


def electrical_checks(ctx: PlanningContext, cr: CoupledResult, frames: list[int], restored: frozenset[int]) -> tuple[list[VerificationCheck], list[str], dict]:
    d = ctx.district
    lim = d.limits
    vmin_lim, vmax_lim, vsoft = float(lim["vMinPu"]), float(lim["vMaxPu"]), float(lim["vSoftMinPu"])
    lmax_lim = float(lim["loadingMaxPct"])
    st = ctx.setup
    clk = lambda k: clock_str(st.start_clock_min, k * st.step_min * 60)  # noqa: E731
    checks: list[VerificationCheck] = []
    reasons: list[str] = []
    nonconv = [k for k in frames if not cr.pf[k].converged]
    checks.append(
        _check(
            "pf-convergence",
            "AC power-flow convergence",
            True,
            not nonconv,
            f"{len(frames) - len(nonconv)}/{len(frames)} solved",
            "all evaluated steps converge",
            "Newton–Raphson AC power flow (pandapower)" if not nonconv else f"No convergence at {', '.join(clk(k) for k in nonconv[:3])}",
        )
    )
    if nonconv:
        reasons.append(f"AC power flow did not converge at {clk(nonconv[0])} (voltage collapse)")
    worst_low = (None, None, None)
    worst_high = (None, None, None)
    worst_load = (None, None, None)
    soft_count = 0
    for k in frames:
        res = cr.pf[k]
        if not res.converged:
            continue
        for b in cr.energized[k]:
            v = res.vm_pu[b]
            if np.isnan(v):
                continue
            if v < vsoft:
                soft_count += 1
            if worst_low[0] is None or v < worst_low[0]:
                worst_low = (float(v), b, k)
            if worst_high[0] is None or v > worst_high[0]:
                worst_high = (float(v), b, k)
        for ln in d.lines:
            lp = res.loading_pct[ln.id]
            if np.isnan(lp):
                continue
            if worst_load[0] is None or lp > worst_load[0]:
                worst_load = (float(lp), ln.id, k)
    v_ok = (worst_low[0] is None or worst_low[0] >= vmin_lim - 1e-9) and (worst_high[0] is None or worst_high[0] <= vmax_lim + 1e-9)
    val = f"min {worst_low[0]:.3f} pu at B{worst_low[1] + 1} ({clk(worst_low[2])})" if worst_low[0] is not None else "n/a"
    checks.append(_check("voltage-band", "Voltage within hard band", True, v_ok, val, f"{vmin_lim:.2f}–{vmax_lim:.2f} pu", "All energised buses at every evaluated step"))
    if worst_low[0] is not None and worst_low[0] < vmin_lim - 1e-9:
        reasons.append(f"V(B{worst_low[1] + 1})={worst_low[0]:.3f} pu < {vmin_lim:.2f} pu at {clk(worst_low[2])}")
    if worst_high[0] is not None and worst_high[0] > vmax_lim + 1e-9:
        reasons.append(f"V(B{worst_high[1] + 1})={worst_high[0]:.3f} pu > {vmax_lim:.2f} pu at {clk(worst_high[2])}")
    checks.append(
        _check("voltage-soft", "Voltage advisory (soft)", False, soft_count == 0, f"{soft_count} bus-step(s) below {vsoft:.2f} pu", f"≥ {vsoft:.2f} pu preferred", "Soft preference only; never rejects a plan")
    )
    t_ok = worst_load[0] is None or worst_load[0] <= lmax_lim + 1e-9
    if worst_load[0] is not None:
        ln = d.lines[worst_load[1]]
        tval = f"max {worst_load[0]:.0f}% on {ln.switch_id} (B{ln.from_bus + 1}–B{ln.to_bus + 1}) at {clk(worst_load[2])}"
    else:
        tval = "n/a"
    checks.append(_check("thermal", "Thermal loading", True, t_ok, tval, f"≤ {lmax_lim:.0f}% of rating", "Synthetic line ratings from district.json"))
    if not t_ok:
        ln = d.lines[worst_load[1]]
        reasons.append(
            f"Line B{ln.from_bus + 1}–B{ln.to_bus + 1} ({ln.switch_id}) loaded {worst_load[0]:.0f}% > {lmax_lim:.0f}% of its {ln.rating_a:.0f} A rating at {clk(worst_load[2])}"
        )
    k0 = frames[0]
    missing = sorted(b for b in restored if b not in cr.energized[k0])
    checks.append(
        _check(
            "connectivity",
            "Claimed buses connected",
            True,
            not missing,
            f"{len(restored) - len(missing)}/{len(restored)} connected",
            "every restored bus energised from the substation",
            "Graph search over closed switches" if not missing else f"Disconnected: {bus_list(missing)}",
        )
    )
    trips_after = [(p, k, v) for (p, k, v) in cr.pump_trips if k >= k0]
    if not trips_after:
        pv = []
        for pu in d.pumps:
            vals = [cr.pf[k].vm_pu[pu.bus] for k in frames if cr.pf[k].converged and pu.bus in cr.energized[k]]
            pv.append(f"{pu.id} min {min(vals):.3f} pu" if vals else f"{pu.id} de-energised")
        val = ", ".join(pv)
    else:
        p, k, v = trips_after[0]
        val = f"{p} trip at {clk(k)}"
    checks.append(
        _check(
            "pump-supply",
            "Pump supply (no undervoltage trip)",
            True,
            not trips_after,
            val,
            f"energised pump buses ≥ {PUMP_UNDERVOLTAGE_TRIP_PU:.2f} pu",
            "A pump runs only if its bus is energised and V ≥ 0.90 pu",
        )
    )
    for p, k, v in trips_after:
        pu = next(x for x in d.pumps if x.id == p)
        if v is None:
            reasons.append(f"{p} cannot run at {clk(k)}: power flow at B{pu.bus + 1} did not converge")
        else:
            reasons.append(f"{p} would trip on undervoltage at {clk(k)}: V(B{pu.bus + 1})={v:.3f} pu < {PUMP_UNDERVOLTAGE_TRIP_PU:.2f} pu")
    v_all = worst_low[0]
    max_loading = worst_load[0]
    return checks, reasons, {"vMin": v_all, "maxLoading": max_loading}


def water_checks(ctx: PlanningContext, cr: CoupledResult, k0: int) -> list[VerificationCheck]:
    d = ctx.district
    st = ctx.setup
    hyd = cr.hyd
    n = st.n_frames
    thr = float(d.water_options["serviceThresholdM"])
    crit = d.critical_junction_ids
    mins = {j: float(max(0.0, hyd.pressure_m[k0:, hyd.jidx(j)].min())) for j in crit}
    worst = min(mins, key=lambda j: mins[j]) if mins else None
    below_min = sum(st.step_min for k in range(k0, n) if any(hyd.pressure_m[k, hyd.jidx(j)] < thr for j in crit))
    ok = all(v >= thr for v in mins.values())
    checks = [
        _check(
            "pressure-critical",
            "Critical-facility water pressure (soft)",
            False,
            ok,
            f"min {mins[worst]:.1f} m at {worst}" if worst else "n/a",
            f"≥ {thr:.0f} m over the remaining horizon",
            "Within service threshold for the whole horizon" if ok else f"Below service threshold for {below_min} min",
        )
    ]
    tmin = hyd.tank_pct[k0:].min(axis=0)
    empty = [hyd.tank_ids[i] for i, v in enumerate(tmin) if v <= 0.5]
    low = [hyd.tank_ids[i] for i, v in enumerate(tmin) if v < TANK_LOW_PCT]
    checks.append(
        _check(
            "tank-level",
            "Tank storage above minimum (soft)",
            False,
            not empty,
            ", ".join(f"{hyd.tank_ids[i]} min {v:.0f}%" for i, v in enumerate(tmin)),
            "never drained to minimum level",
            ("Drained: " + ", ".join(empty)) if empty else (f"Below {TANK_LOW_PCT:.0f}%: " + ", ".join(low) if low else "All tanks keep reserve"),
        )
    )
    return checks


# ─────────────────────────────────────────────────────────── evaluation
def _evaluate_one(ctx: PlanningContext, spec: CandidateSpec, frames: list[int], pre_checks, pre_reasons) -> CandidateOutcome:
    d = ctx.district
    region = ctx.fault.downstream_dark
    oos = [ctx.fault.fault_line]
    crit_fac_region = [f for f in d.facilities if f.critical and f.bus is not None and f.bus in region]
    pumps_region = [p for p in d.pumps if p.bus in region]
    k0 = frames[0]
    en = energized_buses(d, spec.closed, oos)
    restored = frozenset(b for b in region if b in en and b not in spec.shed)
    label = label_for(d, spec)
    actions = actions_for(ctx, spec, restored)
    lf = ctx.setup.load_factor[k0]
    shed_kw = sum(d.buses[b].load_kw * lf for b in spec.shed)
    if pre_reasons:
        metrics = CandidateMetrics(
            restored_kw=round(sum(d.buses[b].load_kw * lf for b in restored), 1),
            served_kw=0.0,
            shed_kw=round(shed_kw, 1),
            critical_restored=0,
            critical_total=len(crit_fac_region),
            pumps_restored=0,
            water_delivered_pct=0.0,
            min_critical_pressure_m=0.0,
            tank_min_pct=0.0,
            v_min_pu=None,
            max_loading_pct=None,
            switch_ops=spec.ops,
        )
        return CandidateOutcome("", spec, label, actions, False, list(pre_reasons), list(pre_checks), metrics, None, restored, en)
    interrupts = [b for b in spec.shed if b not in region]
    cr = simulate(ctx.setup, ctx.candidate_timeline(spec), ctx.net, pf_frames=frames)
    e_checks, e_reasons, stats = electrical_checks(ctx, cr, frames, restored)
    w_checks = water_checks(ctx, cr, k0)
    checks = list(pre_checks) + e_checks + w_checks
    reasons = list(pre_reasons) + e_reasons
    served = cr.served_bus_kw(k0)
    k1 = min(k0 + 1, cr.n - 1)
    pumps_restored = sum(1 for p in pumps_region if cr.hyd.pump_on[k1, cr.hyd.pump_ids.index(p.id)])
    crit_restored = 0
    for f in crit_fac_region:
        if f.bus not in restored:
            continue
        if f.pumps and not all(cr.hyd.pump_on[k1, cr.hyd.pump_ids.index(p)] for p in f.pumps):
            continue
        crit_restored += 1
    hyd = cr.hyd
    req = float(hyd.required_lps[k0:].sum())
    dlv = float(hyd.delivered_lps[k0:].sum())
    crit_idx = [hyd.jidx(j) for j in d.critical_junction_ids]
    metrics = CandidateMetrics(
        restored_kw=round(float(sum(served[b] for b in restored)), 1),
        served_kw=round(float(served.sum()), 1),
        shed_kw=round(shed_kw, 1),
        critical_restored=crit_restored,
        critical_total=len(crit_fac_region),
        pumps_restored=pumps_restored,
        water_delivered_pct=round(100.0 * dlv / req, 2) if req > 0 else 100.0,
        min_critical_pressure_m=round(float(max(0.0, hyd.pressure_m[k0:, crit_idx].min())), 2),
        tank_min_pct=round(float(hyd.tank_pct[k0:].min()), 1),
        v_min_pu=round(stats["vMin"], 4) if stats["vMin"] is not None else None,
        max_loading_pct=round(stats["maxLoading"], 1) if stats["maxLoading"] is not None else None,
        switch_ops=spec.ops,
    )
    terms = objective_terms(ctx, cr, k0)
    out = CandidateOutcome("", spec, label, actions, not reasons, reasons, checks, metrics, terms, restored, en, cr=cr)
    out.extra["interrupts"] = interrupts
    return out


VOLTAGE_REASONS = ("pu <", "trip on undervoltage", "cannot run")


def _voltage_only(reasons: list[str]) -> bool:
    """True when every hard-check failure is an undervoltage / pump-undervoltage issue."""
    return bool(reasons) and all(any(t in r for t in VOLTAGE_REASONS) and "rating" not in r and "loop" not in r for r in reasons)


def headroom_buses(ctx: PlanningContext, ties: tuple[int, ...], k: int = 3) -> list[int]:
    """Energised, non-critical buses outside the dark region whose load most depresses the voltage at
    the source end of the closed tie(s). Ranked by the LinDistFlow sensitivity
    sum over the shared supply path of (r*P_b + x*Q_b): bus b's share of the voltage drop."""
    d = ctx.district
    region = ctx.fault.downstream_dark
    section = ctx.fault.section_buses
    oos = [ctx.fault.fault_line]
    z = impedance_table(d)
    g = nx.Graph()
    g.add_node(d.substation_bus)
    for ln in d.lines:
        if ctx.closed_iso[ln.id] and ln.id not in oos:
            g.add_edge(ln.from_bus, ln.to_bus, line=ln.id)
    tree = nx.bfs_tree(g, d.substation_bus)
    path: dict[int, set[int]] = {d.substation_bus: set()}
    for u, v in nx.bfs_edges(tree, d.substation_bus):
        path[v] = path[u] | {g.edges[u, v]["line"]}
    sources = []
    for t in ties:
        ln = d.lines[t]
        for b in (ln.from_bus, ln.to_bus):
            if b in path and b not in region:
                sources.append(b)
    lf = float(ctx.setup.load_factor[min(ctx.k_switch, ctx.setup.n_frames - 1)])
    scores = []
    for b, p in path.items():
        bus = d.buses[b]
        if b in region or b in section or bus.critical or bus.load_kw <= 0:
            continue
        sc = 0.0
        for src in sources:
            for lid in p & path.get(src, set()):
                r, x = z[lid]
                sc += (r * bus.load_kw + x * bus.load_kvar) * lf
        if sc > 0:
            scores.append((sc, b))
    scores.sort(key=lambda t: (-t[0], t[1]))
    return [b for _, b in scores[:k]]


def evaluate_all(ctx: PlanningContext) -> list[CandidateOutcome]:
    """Enumerate and evaluate every candidate (exhaustive constrained search with dominance pruning).

    For each topology: shed sets of non-critical buses in the dark region (up to MAX_SHED_BUSES)
    are evaluated exactly. If none is feasible and every failure is voltage-related, shed sets that
    also interrupt some of the most voltage-relevant *energised* non-critical buses (headroom
    shedding, top 3 by LinDistFlow sensitivity) are evaluated; such sets are first screened with the
    lossless LinDistFlow model (if even the lossless model violates a limit, the AC model must too).
    Beyond the enumeration bound, CP-SAT proposes one larger shed set per topology.
    """
    d = ctx.district
    region = ctx.fault.downstream_dark
    oos = [ctx.fault.fault_line]
    frames = ctx.sample_frames()
    peak_lf = float(max(ctx.setup.load_factor[k] for k in frames))
    tanphi = 0.6197  # pf 0.85
    pump_extra = {}
    for pu in d.pumps:  # design-point motor input as the screening estimate of pump demand
        kw = float(pump_power_kw(pu.design_flow_lps / 1000.0, pu.design_head_m, pu.efficiency))
        pump_extra[pu.bus] = (kw, kw * tanphi)
    vmin = float(d.limits["vMinPu"])
    outcomes: list[CandidateOutcome] = []
    for ties, opens, closed in topologies(ctx):
        spec0 = CandidateSpec(ties, opens, (), closed)
        pre_checks, pre_reasons = topology_checks(ctx, spec0)
        if pre_reasons or not ties:
            outcomes.append(_evaluate_one(ctx, spec0, frames, pre_checks, pre_reasons))
            continue
        en = energized_buses(d, closed, oos)
        sheddable = sorted(b for b in region if b in en and not d.buses[b].critical and d.buses[b].load_kw > 0)
        feasible_sheds: list[set[int]] = []
        voltage_only = True
        for nshed in range(0, MAX_SHED_BUSES + 1):
            for dset in itertools.combinations(sheddable, nshed):
                spec = CandidateSpec(ties, opens, tuple(dset), closed)
                if spec.ops > MAX_SWITCH_OPS or any(f <= set(dset) for f in feasible_sheds):
                    continue
                checks, reasons = topology_checks(ctx, spec)
                o = _evaluate_one(ctx, spec, frames, checks, reasons)
                outcomes.append(o)
                if o.feasible:
                    feasible_sheds.append(set(dset))
                elif not _voltage_only(o.reasons):
                    voltage_only = False
        # Voltage headroom: interrupt energised non-critical load on the tie's supply path.
        if not feasible_sheds and voltage_only:
            extra = headroom_buses(ctx, ties)
            pool = sorted(set(sheddable) | set(extra))
            for nshed in range(1, MAX_SHED_BUSES + 1):
                for dset in itertools.combinations(pool, nshed):
                    if not any(b in extra for b in dset):
                        continue
                    spec = CandidateSpec(ties, opens, tuple(dset), closed)
                    if spec.ops > MAX_SWITCH_OPS or any(f <= set(dset) for f in feasible_sheds):
                        continue
                    if not lindistflow_feasible(d, closed, oos, dset, peak_lf, pump_extra, vmin):
                        continue
                    checks, reasons = topology_checks(ctx, spec)
                    o = _evaluate_one(ctx, spec, frames, checks, reasons)
                    o.extra["origin"] = "headroom"
                    outcomes.append(o)
                    if o.feasible:
                        feasible_sheds.append(set(dset))
            sheddable = pool
        # Beyond the enumeration bound: CP-SAT proposes the best larger shed set (LinDistFlow).
        budget = MAX_SWITCH_OPS - len(ties) - len(opens)
        if not feasible_sheds and len(sheddable) > MAX_SHED_BUSES and budget > MAX_SHED_BUSES:
            prop = propose_shed_set(d, closed, oos, sheddable, peak_lf, pump_extra, vmin, max_shed=budget)
            if prop is not None and len(prop) > MAX_SHED_BUSES:
                spec = CandidateSpec(ties, opens, prop, closed)
                checks, reasons = topology_checks(ctx, spec)
                o = _evaluate_one(ctx, spec, frames, checks, reasons)
                o.extra["origin"] = "cp-sat"
                outcomes.append(o)
    outcomes.sort(key=lambda o: (o.spec.ops, o.spec.ties, o.spec.opens, o.spec.shed))
    for i, o in enumerate(outcomes):
        o.cid = f"C{i + 1:02d}"
    return outcomes


# ─────────────────────────────────────────────────────────── scoring & ranking
@dataclass
class Scored:
    outcome: CandidateOutcome
    score_encirra: Optional[float]
    breakdown: Optional[ScoreBreakdown]
    score_grid: Optional[float]
    rank_encirra: Optional[int] = None
    rank_grid: Optional[int] = None


def score_and_rank(outcomes: list[CandidateOutcome], w: ObjectiveWeights) -> dict[str, Scored]:
    """Scores both objectives for every feasible candidate (does not mutate the shared outcomes)."""
    out: dict[str, Scored] = {}
    for o in outcomes:
        if o.feasible and o.terms is not None:
            bd = score_encirra(o.terms, o.spec.ops, w)
            grid = score_grid_only(o.terms, o.spec.ops, w) if grid_only_admissible(o) else None
            out[o.cid] = Scored(o, bd.total, bd, grid)
        else:
            out[o.cid] = Scored(o, None, None, None)
    feas = [s for s in out.values() if s.outcome.feasible]
    for rank, s in enumerate(sorted(feas, key=lambda x: (-x.score_encirra, x.outcome.spec.ops, x.outcome.cid)), start=1):
        s.rank_encirra = rank
    grid_feas = [s for s in feas if s.score_grid is not None]
    for rank, s in enumerate(sorted(grid_feas, key=lambda x: (-x.score_grid, x.outcome.spec.ops, x.outcome.cid)), start=1):
        s.rank_grid = rank
    return out


def grid_only_admissible(o: CandidateOutcome) -> bool:
    """Conventional FLISR policy: restoration never interrupts customers that currently have supply."""
    return not o.extra.get("interrupts")


def ranked(scored: dict[str, Scored], strategy: str) -> list[Scored]:
    feas = [s for s in scored.values() if s.outcome.feasible]
    if strategy == "encirra":
        return sorted(feas, key=lambda x: x.rank_encirra)
    return sorted((s for s in feas if s.rank_grid is not None), key=lambda x: x.rank_grid)

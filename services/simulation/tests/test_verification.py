"""Independent verification rejects unsafe plans and accepts the selected one."""

from __future__ import annotations

from encirra_sim.recovery import CandidateSpec, topology_checks
from encirra_sim.verification import verify


def _outcome(runtime, label_startswith=None, ties=(), opens=(), shed=()):
    outs, _ = runtime.outcomes()
    d = runtime.district
    t = tuple(sorted(d.switch_index[s] for s in ties))
    o = tuple(sorted(d.switch_index[s] for s in opens))
    for c in outs:
        if c.spec.ties == t and c.spec.opens == o and c.spec.shed == tuple(sorted(shed)):
            return c
    raise AssertionError(f"candidate not found: {ties} {opens} {shed}")


def _hard_failures(report):
    return {c.id for c in report.checks if c.hard and not c.passed}


def test_verification_rejects_undervoltage_candidate(feeder_fault_runtime):
    rt = feeder_fault_runtime
    cand = _outcome(rt, ties=["SW-18-33"])  # whole west district back-fed from the weak end of F1
    assert not cand.feasible
    assert any("pu < 0.90 pu" in r for r in cand.reasons)
    rep = verify(rt.verification_request(cand))
    assert rep.status == "rejected" and not rep.passed
    assert "voltage-band" in _hard_failures(rep)


def test_verification_rejects_non_radial_candidate(feeder_fault_runtime):
    rt = feeder_fault_runtime
    cand = _outcome(rt, ties=["SW-18-33", "SW-25-29"])
    assert not cand.feasible
    assert any("loop formed via SW-18-33 and SW-25-29" in r for r in cand.reasons)
    rep = verify(rt.verification_request(cand))
    assert not rep.passed
    assert "radiality" in _hard_failures(rep)


def test_planner_rejects_thermal_overload(feeder_fault_runtime):
    rt = feeder_fault_runtime
    cand = _outcome(rt, ties=["SW-25-29"])  # everything through the 44 A tie
    assert not cand.feasible
    assert any("rating" in r and "SW-25-29" in r for r in cand.reasons)


def test_planner_topology_checks_flag_reenergised_fault(feeder_fault_runtime):
    rt = feeder_fault_runtime
    d = rt.district
    closed = list(rt.closed_iso)
    closed[d.switch_index["SW-28-29"]] = True  # re-close an isolation boundary switch
    closed[d.switch_index["SW-25-29"]] = True
    spec = CandidateSpec((d.switch_index["SW-25-29"],), (), (), tuple(closed))
    checks, reasons = topology_checks(rt.planning_context(), spec)
    assert any("faulted section" in r for r in reasons)
    assert any(c.id == "fault-isolation" and not c.passed for c in checks)


def test_selected_plans_are_simulation_verified(feeder_fault_runs):
    _, runs = feeder_fault_runs
    for strategy in ("grid-only", "encirra"):
        plan = runs[strategy].plan
        assert plan is not None
        assert plan.verification.status == "simulation-verified"
        assert all(c.passed for c in plan.verification.checks if c.hard)
        ids = {c.id for c in plan.verification.checks}
        assert {"pf-convergence", "voltage-band", "thermal", "radiality", "connectivity", "fault-isolation", "pump-supply", "switching-feasible", "pressure-critical", "tank-level"} <= ids
        assert "field" not in plan.verification.method.lower() or "not a field certification" in plan.verification.method

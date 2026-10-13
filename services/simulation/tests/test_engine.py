"""End-to-end engine behaviour on the default Electrical Feeder Failure scenario."""

from __future__ import annotations

import json

import pytest

from encirra_sim import engine
from encirra_sim.models import PartialScenarioParams, RunRequest

THR = 20.0


def _ps2_index(result):
    return 1  # PU-2 (order of NetworkTopology.water.pumps)


def test_frames_shape(feeder_fault_runs, district):
    _, runs = feeder_fault_runs
    for r in runs.values():
        assert r.timebase.steps == len(r.frames) == 181
        assert r.timebase.start_clock == "16:30"
        for f in (r.frames[0], r.frames[90], r.frames[-1]):
            assert len(f.power.bus_vm_pu) == district.n_bus == len(f.power.bus_state)
            assert len(f.power.line_state) == district.n_line == len(f.power.switch_closed)
            assert len(f.water.junction_pressure_m) == len(district.junctions)
            assert len(f.water.pipe_flow_lps) == len(district.pipes)
            assert len(f.facilities) == len(district.facilities)
            assert f.power.converged


def test_normal_operation_is_hydraulically_sane(feeder_fault_runs):
    _, runs = feeder_fault_runs
    f = runs["none"].frames[0]
    assert all(f.water.pump_on)
    assert 25.0 <= f.water.min_pressure_m <= 45.0
    assert all(10.0 <= kw <= 60.0 for kw in f.water.pump_power_kw)  # tens of kW
    assert f.power.voltage_violations == 0 and f.power.v_min_pu >= 0.90


def test_strategies_tell_the_physics_story(feeder_fault_runs):
    _, runs = feeder_fault_runs
    none, grid, enc = runs["none"], runs["grid-only"], runs["encirra"]
    # no intervention: West zone drains, hospital pressure falls below service after a delay
    assert none.summary.outcome == "no-intervention"
    assert none.summary.min_critical_pressure_m < THR
    assert none.summary.hydraulic_delay_min is not None and none.summary.hydraulic_delay_min >= 30
    # both planners restore load; the coupled objective keeps PS-2 running
    assert enc.frames[-1].water.pump_on[_ps2_index(enc)]
    assert enc.summary.min_critical_pressure_m >= THR
    assert enc.summary.minutes_below_service_pressure == 0
    assert grid.summary.load_restored_kw > 0
    for r in (grid, enc):
        assert r.summary.constraint_violations == 0
        assert r.summary.candidates_rejected > 0
    # restoration is never reported as 100 % when load stays shed or dark
    assert enc.summary.load_restored_pct < 100.0


def test_hydraulic_events_are_detected_from_results(feeder_fault_runs):
    _, runs = feeder_fault_runs
    titles = [e.title for e in runs["none"].events]
    assert any("Tank T2 below 25%" in t for t in titles)
    assert any("pressure below 20 m" in t for t in titles)
    hosp = next(e for e in runs["none"].events if "pressure below 20 m" in e.title)
    k = hosp.t // 60
    assert runs["none"].frames[k].water.critical_pressure_m < THR
    assert runs["none"].frames[k - 1].water.critical_pressure_m >= THR


def test_timeline_and_stages(feeder_fault_runs):
    _, runs = feeder_fault_runs
    tl = {s.id: s for s in runs["encirra"].timeline}
    assert [s.id for s in runs["encirra"].timeline] == ["fault-detected", "fault-isolated", "recovery-evaluated", "constraints-verified", "service-restored"]
    assert tl["fault-detected"].clock == "17:00" and tl["fault-isolated"].clock == "17:02"
    assert tl["constraints-verified"].outcome == "done" and tl["service-restored"].clock == "17:10"
    assert all(s.outcome == "skipped" for s in runs["none"].timeline[1:])
    stages = [f.stage for f in runs["encirra"].frames]
    assert stages[0] == "ready" and stages[30] == "fault-detected" and stages[32] == "fault-isolated"
    assert stages[35] == "verification-completed" and stages[40] == "recovery-applied"
    assert stages[-1] in ("recovery-complete", "partially-restored")
    assert set(f.stage for f in runs["none"].frames) == {"ready", "fault-detected", "no-intervention"}


def _strip_volatile(d: dict) -> dict:
    d = json.loads(json.dumps(d))
    d["provenance"].pop("computedAt", None)
    d["provenance"].pop("computeMs", None)
    d["summary"].pop("planComputeMs", None)
    return d


def test_determinism_same_request_same_json():
    req = RunRequest(scenario_id="feeder-fault", strategy="encirra", params=PartialScenarioParams(horizon_min=90))
    a = engine.run(req, use_cache=False).model_dump(by_alias=True, mode="json")
    engine._RUNTIMES.clear()  # recompute every physics result from scratch
    b = engine.run(req, use_cache=False).model_dump(by_alias=True, mode="json")
    assert _strip_volatile(a) == _strip_volatile(b)
    assert a["runId"] == b["runId"]


def test_invalid_params_are_rejected():
    with pytest.raises(ValueError):
        engine.run(RunRequest(scenario_id="feeder-fault", strategy="none", params=PartialScenarioParams(fault_line_id=35)), use_cache=False)
    with pytest.raises(ValueError):
        engine.run(RunRequest(scenario_id="feeder-fault", strategy="none", params=PartialScenarioParams(fault_time_min=500)), use_cache=False)


@pytest.fixture(scope="module")
def pump_runs():
    return engine.compare("pump-power-loss", use_cache=False)[1]


def test_pump_power_loss_tie_is_evaluated_and_decision_differs(pump_runs):
    enc, grid = pump_runs["encirra"], pump_runs["grid-only"]
    tie = [c for c in enc.candidates if c.label == "Close SW-18-33"]
    assert tie, "the back-feed of B33 through SW-18-33 must be generated"
    assert not tie[0].feasible and any("V(B33)" in r and "< 0.90 pu" in r for r in tie[0].rejected_reasons)
    # Encirra creates voltage headroom by interrupting supplied non-critical load; grid-only (FLISR) may not
    assert enc.plan.shed_buses and enc.frames[-1].water.pump_on[1]
    assert not grid.frames[-1].water.pump_on[1]
    assert grid.summary.min_critical_pressure_m < THR <= enc.summary.min_critical_pressure_m
    assert any("Grid-only accounting" in r for r in grid.plan.rationale) or any("outside this policy" in r for r in grid.plan.rationale)


def test_restoration_metrics_are_net_of_shedding(feeder_fault_runs, pump_runs):
    """loadRestoredPct = restored / (restored + remaining unserved incl. plan-shed load), as the UI computes per frame."""
    for runs in (feeder_fault_runs[1], pump_runs):
        for r in runs.values():
            s, last = r.summary, r.frames[-1].power
            assert s.load_restored_kw == pytest.approx(last.restored_kw, abs=0.05)
            assert s.remaining_unserved_kw == pytest.approx(last.unserved_kw, abs=0.05)
            denom = last.restored_kw + last.unserved_kw
            assert s.load_restored_pct == pytest.approx(100.0 * last.restored_kw / denom if denom else 100.0, abs=0.06)
            shed = [b for b, x in enumerate(last.bus_shed) if x]
            assert (s.load_shed_kw > 0) == bool(shed)
            # shed load is part of the unserved load
            assert s.remaining_unserved_kw + 0.05 >= s.load_shed_kw
    enc = pump_runs["encirra"]
    assert enc.summary.load_shed_kw > 0 and 17 in enc.plan.unserved_after.buses  # B18 shed for voltage headroom
    assert any("shed" in r and "B18" in r for r in enc.plan.rationale)

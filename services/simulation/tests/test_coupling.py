"""Power ⇄ water coupling: pump availability, hydraulic response and pump-load feedback."""

from __future__ import annotations

import numpy as np
import pytest

from encirra_sim.config import PUMP_UNDERVOLTAGE_TRIP_PU
from encirra_sim.coupling import Segment, SimSetup, SwitchingTimeline, simulate
from encirra_sim.electrical import PowerNetwork
from encirra_sim.topology import plan_fault

START = 16 * 60 + 30


@pytest.fixture(scope="module")
def net(district):
    return PowerNetwork(district)


def _idx(district, pid):
    return [p.id for p in district.pumps].index(pid)


def _tank(district, tid):
    return [t["id"] for t in district.tanks].index(tid)


def _timelines(district):
    normal = district.normal_switch_state()
    trip = list(normal)
    trip[district.switch_index["SW-06-26"]] = False
    base = SwitchingTimeline([Segment(0, normal, frozenset(), False, "normal")], 26)
    fault = SwitchingTimeline([Segment(0, normal, frozenset(), False, "normal"), Segment(10, tuple(trip), frozenset(), True, "trip")], 26)
    return base, fault


def test_pump_stops_when_its_bus_is_deenergised(district, net):
    setup = SimSetup(district, 90, 1, START, 1.0, 1.0, 50.0)
    base, fault = _timelines(district)
    rb = simulate(setup, base, net, pf_frames=[5, 15, 60])
    rf = simulate(setup, fault, net, pf_frames=[5, 15, 60])
    i2, i1 = _idx(district, "PU-2"), _idx(district, "PU-1")
    assert rf.hyd.pump_on[5, i2] and not rf.hyd.pump_on[15, i2]
    assert rf.hyd.pump_on[15, i1]  # PS-1 is on Feeder F1, unaffected
    assert rf.hyd.pump_flow_lps[15, i2] == 0.0 and rf.hyd.pump_kw[15, i2] == 0.0
    # hydraulics change: Tank T2 drains while PS-2 is off, unlike the no-fault run
    t2 = _tank(district, "T2")
    assert rf.hyd.tank_level_m[60, t2] < rf.hyd.tank_level_m[10, t2] - 0.5
    assert rb.hyd.tank_level_m[60, t2] > rf.hyd.tank_level_m[60, t2] + 0.5
    # the East zone is unaffected by the West pump outage (boundary valves closed)
    t1 = _tank(district, "T1")
    assert rf.hyd.tank_level_m[60, t1] == pytest.approx(rb.hyd.tank_level_m[60, t1], abs=1e-3)
    # no electrical demand at the dark pump bus
    assert rf.pf[15].bus_p_kw[district.pumps[i2].bus] == 0.0


def test_tank_drain_eventually_drops_hospital_pressure(district, net):
    setup = SimSetup(district, 180, 1, START, 1.0, 1.0, 50.0)
    _, fault = _timelines(district)
    r = simulate(setup, fault, net, pf_frames=[0])
    j = r.hyd.jidx("J-HOSP")
    p = r.hyd.pressure_m[:, j]
    assert p[5] > 30.0  # normal operation: comfortably above 20 m
    below = np.where(p < 20.0)[0]
    assert below.size > 0
    first = int(below[0])
    assert first - 10 >= 30  # a delay of tens of minutes comes from the tank storage (EPS)
    t2 = _tank(district, "T2")
    assert r.hyd.tank_pct[first, t2] < 5.0  # pressure collapses when T2 reaches its minimum level


def test_pump_kw_feeds_back_into_power_flow(district, net):
    setup = SimSetup(district, 30, 1, START, 1.0, 1.0, 50.0)
    base, _ = _timelines(district)
    r = simulate(setup, base, net, pf_frames=[5])
    i2 = _idx(district, "PU-2")
    bus = district.pumps[i2].bus
    pump_kw = float(r.hyd.pump_kw[5, i2])
    assert pump_kw > 5.0  # tens of kW range
    lf = float(setup.load_factor[5])
    # the power flow applied the benchmark bus load plus the hydraulic pump demand
    assert r.pf[5].bus_p_kw[bus] == pytest.approx(district.buses[bus].load_kw * lf + pump_kw, abs=0.05)
    # and the pump load lowers the bus voltage compared with the same state without the pump
    without = net.solve(district.normal_switch_state(), lf, (), {p.id: (float(r.hyd.pump_kw[5, k]) if p.id != "PU-2" else 0.0) for k, p in enumerate(district.pumps)})
    assert without.vm_pu[bus] > r.pf[5].vm_pu[bus]


def test_undervoltage_trip_is_iterated_to_a_fixed_point(district, net):
    """Back-feeding the whole west district from B18 collapses the voltage: PU-2 must trip."""
    setup = SimSetup(district, 60, 1, START, 1.0, 1.0, 50.0)
    fp = plan_fault(district, 26)
    normal = district.normal_switch_state()
    trip = list(normal)
    trip[fp.protective_line] = False
    iso = list(normal)
    for s in fp.isolation_open:
        iso[district.switch_index[s]] = False
    plan = list(iso)
    plan[district.switch_index["SW-18-33"]] = True
    tl = SwitchingTimeline(
        [
            Segment(0, normal, frozenset(), False, "normal"),
            Segment(10, tuple(trip), frozenset(), True, "trip"),
            Segment(12, tuple(iso), frozenset(), True, "iso"),
            Segment(20, tuple(plan), frozenset(), True, "plan"),
        ],
        26,
    )
    r = simulate(setup, tl, net)
    i2 = _idx(district, "PU-2")
    trips = [t for t in r.pump_trips if t[0] == "PU-2"]
    assert trips, "PU-2 should trip on undervoltage"
    pid, k, v = trips[0]
    assert k >= 20 and v is not None and v < PUMP_UNDERVOLTAGE_TRIP_PU
    assert not r.pump_avail["PU-2"][k:].any()
    assert not r.hyd.pump_on[k:, i2].any()
    assert r.iterations >= 2 and r.converged

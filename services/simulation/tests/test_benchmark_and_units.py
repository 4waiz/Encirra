"""Benchmark sanity (IEEE 33-bus) and unit conversions."""

from __future__ import annotations

import numpy as np
import pandapower as pp
import pytest

from encirra_sim.config import GRAVITY_M_S2, WATER_DENSITY_KG_M3
from encirra_sim.electrical import PowerNetwork, benchmark_net
from encirra_sim.water import lps_to_m3s, m3s_to_lps, pump_curve_points, pump_power_kw, w_to_kw


def test_case33bw_benchmark_values():
    net = benchmark_net()
    pp.runpp(net, numba=False)
    vm = net.res_bus.vm_pu
    assert vm.min() == pytest.approx(0.9131, abs=5e-4)
    assert int(vm.idxmin()) == 17  # B18 (1-based)
    assert net.res_line.pl_mw.sum() * 1000 == pytest.approx(202.7, abs=0.2)


def test_district_matches_benchmark(district):
    net = benchmark_net()
    loads = {int(b): (p * 1000, q * 1000) for b, p, q in zip(net.load.bus, net.load.p_mw, net.load.q_mvar)}
    for b in district.buses:
        p, q = loads.get(b.id, (0.0, 0.0))
        assert b.load_kw == pytest.approx(p) and b.load_kvar == pytest.approx(q), b.name
    for ln in district.lines:
        assert {ln.from_bus, ln.to_bus} == {int(net.line.at[ln.id, "from_bus"]), int(net.line.at[ln.id, "to_bus"])}
    ties = [ln.id for ln in district.lines if ln.kind == "tie"]
    assert ties == [32, 33, 34, 35, 36]
    assert all(district.lines[i].normally_open for i in ties)


def test_switched_model_reproduces_benchmark(district):
    """Explicit switches (ties open) + district loads at factor 1.0 must equal case33bw."""
    pn = PowerNetwork(district)
    res = pn.solve(district.normal_switch_state(), 1.0, (), {p.id: 0.0 for p in district.pumps})
    assert res.converged
    assert np.nanmin(res.vm_pu) == pytest.approx(0.9131, abs=5e-4)
    assert int(np.nanargmin(res.vm_pu)) == 17
    assert res.losses_kw == pytest.approx(202.7, abs=0.2)
    assert np.all(np.isnan(res.loading_pct[32:37]))  # open ties carry no current


def test_unit_conversions():
    assert lps_to_m3s(40.0) == pytest.approx(0.040)
    assert m3s_to_lps(0.0431) == pytest.approx(43.1)
    assert w_to_kw(19_500.0) == pytest.approx(19.5)


def test_pump_power_formula():
    # P = rho * g * Q * H / eta  (W -> kW)
    q, h, eta = 0.040, 36.0, 0.74
    expected = WATER_DENSITY_KG_M3 * GRAVITY_M_S2 * q * h / eta / 1000.0
    assert pump_power_kw(q, h, eta) == pytest.approx(expected)
    assert expected == pytest.approx(19.09, abs=0.01)
    assert pump_power_kw(0.0, 36.0, 0.74) == 0.0
    assert pump_power_kw(-0.01, 36.0, 0.74) == 0.0  # reverse flow is not pumping


def test_pump_curve_through_design_point(district):
    for p in district.pumps:
        pts = pump_curve_points(p.design_flow_lps, p.design_head_m)
        assert pts[1] == pytest.approx((lps_to_m3s(p.design_flow_lps), p.design_head_m))
        assert pts[0][1] == pytest.approx(4.0 / 3.0 * p.design_head_m)
        assert pts[2] == pytest.approx((2 * lps_to_m3s(p.design_flow_lps), 0.0))
        # rated motor size covers the design-point electrical input
        assert p.rated_kw >= pump_power_kw(lps_to_m3s(p.design_flow_lps), p.design_head_m, p.efficiency)

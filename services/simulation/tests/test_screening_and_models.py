"""CP-SAT LinDistFlow shed proposal and agreement between the two independent model builders."""

from __future__ import annotations

import numpy as np
import pytest

from encirra_sim import profiles
from encirra_sim.screening import propose_shed_set
from encirra_sim.topology import plan_fault
from encirra_sim.verification import VerificationRequest, _inp_text, _run_inp
from encirra_sim.water import simulate as eps

PUMP_EXTRA = {13: (23.2, 14.4), 32: (19.1, 11.8)}


def _iso(district):
    fp = plan_fault(district, 26)
    c = list(district.normal_switch_state())
    for s in fp.isolation_open:
        c[district.switch_index[s]] = False
    return c


def test_cpsat_sheds_the_cooling_plant_to_fit_the_tie(district):
    c = _iso(district)
    c[district.switch_index["SW-25-29"]] = True
    prop = propose_shed_set(district, c, [26], [28, 29, 30], 1.0, PUMP_EXTRA, 0.90, max_shed=3)
    assert prop == (29,)  # B30 / DC-1: its 600 kVAr dominates the tie current


def test_cpsat_rejects_meshed_topology_and_respects_budget(district):
    c = _iso(district)
    c[district.switch_index["SW-25-29"]] = True
    c[district.switch_index["SW-18-33"]] = True
    assert propose_shed_set(district, c, [26], [28, 29, 30], 1.0, PUMP_EXTRA, 0.90, max_shed=3) is None
    # an impossible voltage target with no shedding budget has no solution
    assert propose_shed_set(district, district.normal_switch_state(), [], [29], 1.0, PUMP_EXTRA, 0.99, max_shed=1) is None


def test_independent_hydraulic_builders_agree(district):
    """The planner's programmatic WNTR model and the verifier's INP-text model give the same EPS."""
    horizon = 60
    pattern = profiles.per_minute(profiles.water_multiplier, 16 * 60 + 30, horizon)
    avail = {"PU-1": np.ones(horizon + 1, dtype=bool), "PU-2": np.array([m < 20 for m in range(horizon + 1)])}
    a = eps(district, pattern, 50.0, avail, horizon, 1)
    req = VerificationRequest(
        fault_line=26, fault_frame=20, repair_frame=None, ops=[], shed_buses=[], plan_frame=20, claimed_buses=[], claimed_pumps=[],
        plan_switch_ids=[], horizon_min=horizon, step_min=1, start_clock_min=16 * 60 + 30, load_multiplier=1.0, water_multiplier=1.0, tank_init_pct=50.0,
    )
    av = {k: [1.0 if x else 0.0 for x in v] + [1.0 if v[-1] else 0.0] * 2 for k, v in avail.items()}
    res = _run_inp(_inp_text(district.raw, req, av, list(pattern) + [float(pattern[-1])] * 2))
    p = res.node["pressure"]["J-HOSP"].to_numpy()[: horizon + 1]
    assert np.allclose(p, a.pressure_m[:, a.jidx("J-HOSP")], atol=0.01)
    lvl = res.node["head"]["T2"].to_numpy()[: horizon + 1] - 44.0
    assert np.allclose(lvl, a.tank_level_m[:, 1], atol=0.005)
    q = res.link["flowrate"]["PU-1"].to_numpy()[: horizon + 1] * 1000.0
    assert np.allclose(q, a.pump_flow_lps[:, 0], atol=0.05)

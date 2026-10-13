"""Electrical model: IEEE 33-bus feeder (pandapower ``case33bw``) with explicit line switches.

* Topology, impedances and nominal loads are the published Baran & Wu values loaded through
  ``pandapower.networks.case33bw()``. Tie lines 32–36 are put in service and controlled by
  normally-open switches instead of ``in_service = False``.
* Every line gets a load-break switch at its ``from`` end (``pp.create_switch(et="l")``).
* Synthetic thermal ratings from district.json replace the benchmark's 99 999 kA placeholder.
* Bus loads = nominal × loadMultiplier × time-of-day profile (constant-power, as in the benchmark).
  Shed buses have their load switched off.
* Pump motors are separate loads at their supply buses: P from the hydraulic solution
  (P = ρ·g·Q·H/η), Q at power factor 0.85.
* AC Newton–Raphson power flow (``pp.runpp``, flat start). Buses not connected to the slack are
  reported as de-energised (NaN voltages from pandapower's connectivity check).
"""

from __future__ import annotations

import math
import warnings
from dataclasses import dataclass
from typing import Iterable, Mapping, Sequence

import numpy as np
import pandapower as pp
import pandapower.networks as pn

from .config import PUMP_POWER_FACTOR, District

warnings.filterwarnings("ignore", category=FutureWarning, module="pandapower")
warnings.filterwarnings("ignore", category=DeprecationWarning, module="pandapower")

TAN_PHI_PUMP = math.tan(math.acos(PUMP_POWER_FACTOR))


@dataclass
class PFResult:
    converged: bool
    vm_pu: np.ndarray  # (n_bus,) NaN where de-energised
    loading_pct: np.ndarray  # (n_line,) NaN where not carrying current (open / de-energised)
    p_from_kw: np.ndarray  # (n_line,) signed, + = from→to
    i_ka: np.ndarray
    losses_kw: float
    bus_p_kw: np.ndarray  # load P actually applied at each bus (benchmark load + pumps, 0 if shed/dark)

    def v_at(self, bus: int) -> float | None:
        v = self.vm_pu[bus]
        return None if np.isnan(v) else float(v)


def benchmark_net():
    """Unmodified IEEE 33-bus benchmark (used by the sanity test)."""
    return pn.case33bw()


class PowerNetwork:
    """A reusable pandapower model of the district feeder; state is set per solve."""

    def __init__(self, district: District):
        self.district = district
        net = pn.case33bw()
        if len(net.bus) != district.n_bus or len(net.line) != district.n_line:
            raise ValueError("district.json does not match the case33bw benchmark dimensions")
        for ln in district.lines:
            fb, tb = int(net.line.at[ln.id, "from_bus"]), int(net.line.at[ln.id, "to_bus"])
            if {fb, tb} != {ln.from_bus, ln.to_bus}:
                raise ValueError(f"Line {ln.id} endpoints differ from case33bw ({fb}-{tb} vs {ln.from_bus}-{ln.to_bus})")
        net.line["in_service"] = True
        net.line["max_i_ka"] = [district.lines[i].rating_a / 1000.0 for i in net.line.index]
        for ln in district.lines:
            pp.create_switch(net, bus=ln.from_bus, element=ln.id, et="l", closed=not ln.normally_open, type="LBS", name=ln.switch_id)
        # Replace benchmark loads with one load per bus from the district configuration (same values).
        net.load.drop(net.load.index, inplace=True)
        self.bus_load_idx = np.zeros(district.n_bus, dtype=int) - 1
        self.p_nom_mw = np.zeros(district.n_bus)
        self.q_nom_mvar = np.zeros(district.n_bus)
        for b in district.buses:
            if b.load_kw > 0 or b.load_kvar > 0:
                idx = pp.create_load(net, bus=b.id, p_mw=b.load_kw / 1000.0, q_mvar=b.load_kvar / 1000.0, name=b.name)
                self.bus_load_idx[b.id] = idx
                self.p_nom_mw[b.id] = b.load_kw / 1000.0
                self.q_nom_mvar[b.id] = b.load_kvar / 1000.0
        self.pump_load_idx = {}
        for p in district.pumps:
            self.pump_load_idx[p.id] = pp.create_load(net, bus=p.bus, p_mw=0.0, q_mvar=0.0, name=p.id)
        self.net = net
        self._load_rows = np.array([self.bus_load_idx[b] for b in range(district.n_bus) if self.bus_load_idx[b] >= 0])
        self._load_buses = np.array([b for b in range(district.n_bus) if self.bus_load_idx[b] >= 0])
        self._switch_rows = np.arange(district.n_line)  # switches created in line order

    def solve(
        self,
        closed: Sequence[bool],
        load_factor: float,
        shed: Iterable[int] = (),
        pump_kw: Mapping[str, float] | None = None,
        out_of_service: Iterable[int] = (),
    ) -> PFResult:
        net = self.net
        d = self.district
        net.switch.loc[self._switch_rows, "closed"] = np.asarray(closed, dtype=bool)
        oos = set(out_of_service)
        net.line["in_service"] = [i not in oos for i in net.line.index]
        shed_set = set(shed)
        p = self.p_nom_mw[self._load_buses] * load_factor
        q = self.q_nom_mvar[self._load_buses] * load_factor
        in_svc = np.array([b not in shed_set for b in self._load_buses])
        net.load.loc[self._load_rows, "p_mw"] = p
        net.load.loc[self._load_rows, "q_mvar"] = q
        net.load.loc[self._load_rows, "in_service"] = in_svc
        pump_kw = pump_kw or {}
        for pid, idx in self.pump_load_idx.items():
            kw = max(0.0, float(pump_kw.get(pid, 0.0)))
            net.load.at[idx, "p_mw"] = kw / 1000.0
            net.load.at[idx, "q_mvar"] = kw / 1000.0 * TAN_PHI_PUMP
            net.load.at[idx, "in_service"] = kw > 0
        n_bus, n_line = d.n_bus, d.n_line
        try:
            pp.runpp(net, numba=False, init="flat", calculate_voltage_angles=False, max_iteration=30)
            converged = bool(net.converged)
        except pp.LoadflowNotConverged:
            converged = False
        if not converged:
            nan_b = np.full(n_bus, np.nan)
            nan_l = np.full(n_line, np.nan)
            return PFResult(False, nan_b, nan_l, nan_l.copy(), nan_l.copy(), float("nan"), np.zeros(n_bus))
        vm = net.res_bus.vm_pu.to_numpy(dtype=float).copy()
        loading = net.res_line.loading_percent.to_numpy(dtype=float).copy()
        p_from = net.res_line.p_from_mw.to_numpy(dtype=float) * 1000.0
        i_ka = net.res_line.i_ka.to_numpy(dtype=float).copy()
        losses = float(np.nansum(net.res_line.pl_mw.to_numpy(dtype=float)) * 1000.0)
        # Lines that carry no current (open switch, de-energised) -> NaN for loading/flow.
        sw_closed = np.asarray(closed, dtype=bool)
        for ln in d.lines:
            a, b = ln.from_bus, ln.to_bus
            live = sw_closed[ln.id] and ln.id not in oos and not np.isnan(vm[a]) and not np.isnan(vm[b])
            if not live:
                loading[ln.id] = np.nan
                p_from[ln.id] = np.nan
                i_ka[ln.id] = np.nan
        bus_p = np.zeros(n_bus)
        res_load = net.res_load
        for row, bus in zip(self._load_rows, self._load_buses):
            val = res_load.at[row, "p_mw"]
            if not np.isnan(vm[bus]) and not np.isnan(val):
                bus_p[bus] += float(val) * 1000.0
        for pid, idx in self.pump_load_idx.items():
            bus = int(net.load.at[idx, "bus"])
            val = res_load.at[idx, "p_mw"]
            if not np.isnan(vm[bus]) and not np.isnan(val):
                bus_p[bus] += float(val) * 1000.0
        return PFResult(True, vm, loading, p_from, i_ka, losses, bus_p)

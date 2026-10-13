"""Hydraulic model: WNTR network built from district.json, solved with EPANET 2.2 (EpanetSimulator).

* Junctions: elevation, base demand × waterDemandMultiplier × diurnal pattern (per-minute pattern).
* Pressure-driven demand (PDD): full demand at ≥ 20 m, zero at ≤ 0 m, exponent 0.5.
* Reservoir R1 (desalination ground storage, fixed head), elevated tanks T1/T2.
* Pipes: Hazen–Williams; boundary pipes BV-1…BV-4 closed (separate West/East pressure zones).
* Pumps: three-point head curve through the design point (shut-off 4/3·H_d, run-out 2·Q_d).
  Electrical availability is imposed with a per-minute *speed pattern* (1 = available, 0 = off),
  which EPANET treats as the pump being shut off.
* Extended-period simulation, 60 s hydraulic step; results reported every frame step.
* Pump electrical input: P = ρ·g·Q·H/η (W → kW), η = pump-set (wire-to-water) efficiency.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from dataclasses import dataclass
from typing import Mapping, Sequence

import numpy as np
import wntr

from .config import GRAVITY_M_S2, WATER_DENSITY_KG_M3, District

LPS_PER_M3S = 1000.0


def lps_to_m3s(q_lps: float) -> float:
    return q_lps / LPS_PER_M3S


def m3s_to_lps(q_m3s: float) -> float:
    return q_m3s * LPS_PER_M3S


def w_to_kw(p_w: float) -> float:
    return p_w / 1000.0


def pump_power_kw(flow_m3s, head_m, efficiency: float):
    """Electrical input power P = ρ·g·Q·H / η in kW (vectorised; zero when Q ≤ 0 or H ≤ 0)."""
    q = np.maximum(np.asarray(flow_m3s, dtype=float), 0.0)
    h = np.maximum(np.asarray(head_m, dtype=float), 0.0)
    return w_to_kw(WATER_DENSITY_KG_M3 * GRAVITY_M_S2 * q * h / efficiency)


def pump_curve_points(design_flow_lps: float, design_head_m: float) -> list[tuple[float, float]]:
    """Three-point head curve (m³/s, m) through the design point."""
    q = lps_to_m3s(design_flow_lps)
    h = design_head_m
    return [(0.0, 4.0 / 3.0 * h), (q, h), (2.0 * q, 0.0)]


@dataclass
class HydraulicResult:
    times_s: np.ndarray
    junction_ids: list[str]
    pressure_m: np.ndarray  # raw EPANET gauge pressure (can be slightly negative in a drained zone)
    delivered_lps: np.ndarray
    required_lps: np.ndarray
    pipe_ids: list[str]
    pipe_flow_lps: np.ndarray
    pipe_velocity_ms: np.ndarray
    pipe_open: np.ndarray
    pump_ids: list[str]
    pump_flow_lps: np.ndarray
    pump_head_m: np.ndarray
    pump_on: np.ndarray
    pump_kw: np.ndarray
    tank_ids: list[str]
    tank_level_m: np.ndarray
    tank_pct: np.ndarray

    @property
    def n(self) -> int:
        return len(self.times_s)

    def jidx(self, jid: str) -> int:
        return self.junction_ids.index(jid)


def tank_init_level(tank: dict, init_pct: float) -> float:
    lo, hi = float(tank["minLevelM"]), float(tank["maxLevelM"])
    return lo + (hi - lo) * max(0.0, min(100.0, init_pct)) / 100.0


def build_network(
    district: District,
    demand_pattern: Sequence[float],
    tank_init_pct: float,
    pump_speed: Mapping[str, Sequence[float]],
    duration_s: int,
    report_step_s: int,
) -> wntr.network.WaterNetworkModel:
    """Programmatic WNTR model (planner/engine code path)."""
    opts = district.water_options
    wn = wntr.network.WaterNetworkModel()
    o = wn.options
    o.time.duration = int(duration_s)
    o.time.hydraulic_timestep = 60
    o.time.pattern_timestep = 60
    o.time.report_timestep = int(report_step_s)
    o.time.quality_timestep = 60
    o.hydraulic.headloss = "H-W"
    o.hydraulic.demand_model = "PDD"
    o.hydraulic.required_pressure = float(opts["requiredPressureM"])
    o.hydraulic.minimum_pressure = float(opts["minimumPressureM"])
    o.hydraulic.pressure_exponent = float(opts["pressureExponent"])
    o.quality.parameter = "NONE"
    wn.add_pattern("DIURNAL", [float(v) for v in demand_pattern])
    for j in district.junctions:
        bd = float(j["baseDemandLps"])
        wn.add_junction(j["id"], base_demand=lps_to_m3s(bd), demand_pattern="DIURNAL" if bd > 0 else None, elevation=float(j["elevationM"]))
    for r in district.reservoirs:
        wn.add_reservoir(r["id"], base_head=float(r["headM"]))
    for t in district.tanks:
        wn.add_tank(
            t["id"],
            elevation=float(t["elevationM"]),
            init_level=tank_init_level(t, tank_init_pct),
            min_level=float(t["minLevelM"]),
            max_level=float(t["maxLevelM"]),
            diameter=float(t["diameterM"]),
        )
    for p in district.pipes:
        wn.add_pipe(
            p["id"],
            p["from"],
            p["to"],
            length=float(p["lengthM"]),
            diameter=float(p["diameterMM"]) / 1000.0,
            roughness=float(p["roughnessC"]),
            initial_status="OPEN" if p["initialStatus"] == "open" else "CLOSED",
        )
    for pu in district.pumps:
        wn.add_curve(f"HC-{pu.id}", "HEAD", pump_curve_points(pu.design_flow_lps, pu.design_head_m))
        pat = f"AV-{pu.id}"
        wn.add_pattern(pat, [float(v) for v in pump_speed[pu.id]])
        wn.add_pump(pu.id, pu.from_node, pu.to_node, pump_type="HEAD", pump_parameter=f"HC-{pu.id}", speed=1.0, pattern=pat)
    return wn


def run_epanet(wn: wntr.network.WaterNetworkModel):
    tmp = tempfile.mkdtemp(prefix="encirra-eps-")
    try:
        sim = wntr.sim.EpanetSimulator(wn)
        return sim.run_sim(file_prefix=os.path.join(tmp, "eps"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def extract_results(district: District, results, required_lps: np.ndarray) -> HydraulicResult:
    jids = [j["id"] for j in district.junctions]
    pids = [p["id"] for p in district.pipes]
    puids = [p.id for p in district.pumps]
    tids = [t["id"] for t in district.tanks]
    node = results.node
    link = results.link
    times = node["pressure"].index.to_numpy(dtype=float)
    pressure = node["pressure"][jids].to_numpy(dtype=float)
    delivered = node["demand"][jids].to_numpy(dtype=float) * LPS_PER_M3S
    delivered = np.maximum(delivered, 0.0)
    head = node["head"]
    pflow = link["flowrate"][pids].to_numpy(dtype=float) * LPS_PER_M3S
    pvel = np.abs(link["velocity"][pids].to_numpy(dtype=float))
    pstat = link["status"][pids].to_numpy(dtype=float)
    p_open = pstat > 0.5
    pu_flow_m3s = link["flowrate"][puids].to_numpy(dtype=float)
    pu_stat = link["status"][puids].to_numpy(dtype=float)
    pu_head = np.zeros_like(pu_flow_m3s)
    for k, pu in enumerate(district.pumps):
        pu_head[:, k] = head[pu.to_node].to_numpy(dtype=float) - head[pu.from_node].to_numpy(dtype=float)
    pu_on = (pu_stat > 0.5) & (pu_flow_m3s > 1e-6)
    pu_head = np.where(pu_on, pu_head, 0.0)  # head gain is reported only for a running pump
    pu_flow_m3s = np.where(pu_on, pu_flow_m3s, 0.0)
    pu_kw = np.zeros_like(pu_flow_m3s)
    for k, pu in enumerate(district.pumps):
        pu_kw[:, k] = pump_power_kw(pu_flow_m3s[:, k], pu_head[:, k], pu.efficiency)
    t_level = np.zeros((len(times), len(tids)))
    t_pct = np.zeros_like(t_level)
    for k, t in enumerate(district.tanks):
        lvl = head[t["id"]].to_numpy(dtype=float) - float(t["elevationM"])
        t_level[:, k] = lvl
        lo, hi = float(t["minLevelM"]), float(t["maxLevelM"])
        t_pct[:, k] = np.clip((lvl - lo) / (hi - lo) * 100.0, 0.0, 100.0)
    n = len(times)
    req = required_lps[:n]
    return HydraulicResult(
        times_s=times,
        junction_ids=jids,
        pressure_m=pressure,
        delivered_lps=delivered,
        required_lps=req,
        pipe_ids=pids,
        pipe_flow_lps=pflow,
        pipe_velocity_ms=pvel,
        pipe_open=p_open,
        pump_ids=puids,
        pump_flow_lps=pu_flow_m3s * LPS_PER_M3S,
        pump_head_m=pu_head,
        pump_on=pu_on,
        pump_kw=pu_kw,
        tank_ids=tids,
        tank_level_m=t_level,
        tank_pct=t_pct,
    )


def required_demand_lps(district: District, pattern_per_min: np.ndarray, report_step_min: int, n_frames: int) -> np.ndarray:
    base = np.array([float(j["baseDemandLps"]) for j in district.junctions])
    idx = np.arange(n_frames) * report_step_min
    return pattern_per_min[idx][:, None] * base[None, :]


def simulate(
    district: District,
    demand_pattern_per_min: np.ndarray,
    tank_init_pct: float,
    pump_avail_per_min: Mapping[str, np.ndarray],
    horizon_min: int,
    step_min: int,
) -> HydraulicResult:
    """Run the EPS for ``horizon_min`` with per-minute demand and pump availability."""
    pad = 2
    pattern = list(demand_pattern_per_min) + [float(demand_pattern_per_min[-1])] * pad
    speeds = {pid: [1.0 if a else 0.0 for a in arr] + [1.0 if arr[-1] else 0.0] * pad for pid, arr in pump_avail_per_min.items()}
    wn = build_network(district, pattern, tank_init_pct, speeds, horizon_min * 60, step_min * 60)
    res = run_epanet(wn)
    n_frames = horizon_min // step_min + 1
    req = required_demand_lps(district, np.asarray(pattern), step_min, n_frames)
    return extract_results(district, res, req)

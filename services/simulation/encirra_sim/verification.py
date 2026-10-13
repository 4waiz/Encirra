"""Independent verification of a recovery plan ("Simulation Verified").

The verifier deliberately shares no model-building code with the planner:

* **Electrical** — a fresh pandapower network is assembled element by element
  (``create_bus`` / ``create_line_from_parameters`` / ``create_switch`` / ``create_load``) from the
  raw district.json and the published benchmark impedances, instead of re-using the planner's
  ``PowerNetwork``. Energisation and radiality use ``pandapower.topology`` graphs (not the
  planner's NetworkX code).
* **Hydraulic** — an EPANET 2.2 input file (LPS units) is written as text from district.json and
  loaded through WNTR's INP reader, instead of the planner's programmatic WNTR model.
* **Coupling** — its own pump-availability fixed point (energisation + undervoltage trip).
* **Sequence** — switch states per minute are re-derived by replaying the switching sequence from
  the normal configuration.

AC power flow (Newton–Raphson) and the extended-period hydraulics are re-solved at every frame of
the remaining horizon after switching. The plan is "simulation-verified" only if every hard check
passes. This is a simulation-based verification of a synthetic model — not a field certification.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import tempfile
from dataclasses import dataclass
from typing import Optional

import networkx as nx
import numpy as np
import pandapower as pp
import pandapower.networks as pn
import pandapower.topology as top
import wntr

from . import profiles
from .config import (
    GRAVITY_M_S2,
    MAX_SWITCH_OPS,
    PUMP_POWER_FACTOR,
    PUMP_UNDERVOLTAGE_TRIP_PU,
    TANK_LOW_PCT,
    WATER_DENSITY_KG_M3,
    district_path,
)
from .models import VerificationCheck, VerificationReport

try:
    import numba  # noqa: F401

    _NUMBA = True
except ImportError:  # pragma: no cover
    _NUMBA = False

METHOD = (
    "Independent re-solve: both networks rebuilt from district.json through a separate code path "
    "(pandapower model assembled element-by-element from benchmark impedances; EPANET 2.2 input file "
    "generated as text and loaded through WNTR's INP reader); the full switching sequence replayed "
    "from the normal configuration; AC Newton–Raphson power flow and extended-period hydraulics "
    "(60 s step) re-solved every frame of the remaining horizon with an independent pump-availability "
    "fixed point. 'Simulation Verified' means every hard check passed in this re-simulation of the "
    "synthetic model; it is not a field certification."
)


@dataclass
class SwitchOp:
    frame: int
    switch_id: str
    close: bool


@dataclass
class VerificationRequest:
    fault_line: int
    fault_frame: int
    repair_frame: Optional[int]
    ops: list[SwitchOp]  # protection, isolation and plan operations in execution order
    shed_buses: list[int]  # applied at plan_frame
    plan_frame: int
    claimed_buses: list[int]  # buses the plan claims to serve after switching
    claimed_pumps: list[str]  # pumps the plan claims to run after switching
    plan_switch_ids: list[str]  # switches operated by the plan itself (feasibility check)
    horizon_min: int
    step_min: int
    start_clock_min: int
    load_multiplier: float
    water_multiplier: float
    tank_init_pct: float


# ─────────────────────────────────────────────────────────── independent electrical model
class _IndependentGrid:
    def __init__(self, cfg: dict):
        el = cfg["electrical"]
        ref = pn.case33bw()
        net = pp.create_empty_network(sn_mva=float(ref.sn_mva))
        for b in ref.bus.index:
            pp.create_bus(net, vn_kv=float(ref.bus.at[b, "vn_kv"]), index=int(b), name=f"B{int(b) + 1}")
        self.slack = int(el["substationBus"]) - 1
        pp.create_ext_grid(net, bus=self.slack, vm_pu=float(ref.ext_grid.vm_pu.iloc[0]), va_degree=0.0)
        self.lines = []
        for ln in el["lines"]:
            lid = int(ln["id"])
            fb, tb = int(ln["from"]) - 1, int(ln["to"]) - 1
            rf, rt = int(ref.line.at[lid, "from_bus"]), int(ref.line.at[lid, "to_bus"])
            if {fb, tb} != {rf, rt}:
                raise ValueError(f"benchmark mismatch on line {lid}")
            length = float(ref.line.at[lid, "length_km"])
            pp.create_line_from_parameters(
                net,
                from_bus=fb,
                to_bus=tb,
                length_km=length,
                r_ohm_per_km=float(ref.line.at[lid, "r_ohm_per_km"]),
                x_ohm_per_km=float(ref.line.at[lid, "x_ohm_per_km"]),
                c_nf_per_km=float(ref.line.at[lid, "c_nf_per_km"]),
                max_i_ka=float(ln["ratingA"]) / 1000.0,
                index=lid,
                name=ln["switch"]["id"],
            )
            sw = pp.create_switch(net, bus=fb, element=lid, et="l", closed=not ln["normallyOpen"], name=ln["switch"]["id"])
            self.lines.append({"id": lid, "from": fb, "to": tb, "switch": ln["switch"]["id"], "sw_idx": sw, "remote": bool(ln["switch"]["remote"]), "kind": ln["kind"], "rating": float(ln["ratingA"])})
        self.switch_row = {ln["switch"]: ln["sw_idx"] for ln in self.lines}
        self.bus_load = {}
        self.p0 = {}
        self.q0 = {}
        for b in el["buses"]:
            bid = int(b["number"]) - 1
            if float(b["loadKW"]) > 0 or float(b["loadKVAr"]) > 0:
                self.bus_load[bid] = pp.create_load(net, bus=bid, p_mw=0.0, q_mvar=0.0, name=f"L{bid + 1}")
                self.p0[bid] = float(b["loadKW"]) / 1000.0
                self.q0[bid] = float(b["loadKVAr"]) / 1000.0
        self.pump_load = {}
        self.pump_bus = {}
        for p in cfg["water"]["pumps"]:
            pb = int(p["bus"]) - 1
            self.pump_bus[p["id"]] = pb
            self.pump_load[p["id"]] = pp.create_load(net, bus=pb, p_mw=0.0, q_mvar=0.0, name=p["id"])
        self.net = net
        self.n_bus = len(ref.bus)

    def set_state(self, closed: dict[str, bool], factor: float, shed: set[int], pump_kw: dict[str, float], fault_line: Optional[int]):
        net = self.net
        for sid, row in self.switch_row.items():
            net.switch.at[row, "closed"] = bool(closed[sid])
        net.line["in_service"] = True
        if fault_line is not None:
            net.line.at[fault_line, "in_service"] = False
        for bid, row in self.bus_load.items():
            net.load.at[row, "p_mw"] = self.p0[bid] * factor
            net.load.at[row, "q_mvar"] = self.q0[bid] * factor
            net.load.at[row, "in_service"] = bid not in shed
        tanphi = math.tan(math.acos(PUMP_POWER_FACTOR))
        for pid, row in self.pump_load.items():
            kw = max(0.0, pump_kw.get(pid, 0.0))
            net.load.at[row, "p_mw"] = kw / 1000.0
            net.load.at[row, "q_mvar"] = kw / 1000.0 * tanphi
            net.load.at[row, "in_service"] = kw > 0

    def energised(self) -> set[int]:
        mg = top.create_nxgraph(self.net, respect_switches=True, include_out_of_service=False)
        return set(top.connected_component(mg, self.slack))

    def radial(self) -> tuple[bool, str]:
        mg = top.create_nxgraph(self.net, respect_switches=True, include_out_of_service=False)
        comp = set(top.connected_component(mg, self.slack))
        sub = mg.subgraph(comp)
        n_e = sub.number_of_edges()
        if n_e == len(comp) - 1:
            return True, f"{len(comp)} buses / {n_e} branches"
        simple = nx.Graph(sub)
        cycles = nx.cycle_basis(simple)
        return False, f"{n_e - len(comp) + 1} loop(s): " + "; ".join("–".join(f"B{b + 1}" for b in c) for c in cycles)

    def solve(self) -> dict:
        try:
            pp.runpp(self.net, numba=_NUMBA, init="flat", calculate_voltage_angles=False, max_iteration=30)
            ok = bool(self.net.converged)
        except pp.LoadflowNotConverged:
            ok = False
        if not ok:
            return {"ok": False}
        return {
            "ok": True,
            "vm": self.net.res_bus.vm_pu.to_numpy(dtype=float).copy(),
            "loading": self.net.res_line.loading_percent.to_numpy(dtype=float).copy(),
        }


# ─────────────────────────────────────────────────────────── independent hydraulic model (INP text)
def _inp_text(cfg: dict, req: VerificationRequest, avail_min: dict[str, list[float]], demand_pattern: list[float]) -> str:
    w = cfg["water"]
    o = w["options"]
    lines = ["[TITLE]", "Encirra independent verification model", ""]
    lines += ["[JUNCTIONS]", ";ID Elev Demand Pattern"]
    for j in w["junctions"]:
        pat = "DIURNAL" if float(j["baseDemandLps"]) > 0 else ""
        lines.append(f"{j['id']} {float(j['elevationM']):.4f} {float(j['baseDemandLps']):.6f} {pat}".rstrip())
    lines += ["", "[RESERVOIRS]", ";ID Head"]
    for r in w["reservoirs"]:
        lines.append(f"{r['id']} {float(r['headM']):.4f}")
    lines += ["", "[TANKS]", ";ID Elev InitLvl MinLvl MaxLvl Diam MinVol"]
    for t in w["tanks"]:
        lo, hi = float(t["minLevelM"]), float(t["maxLevelM"])
        init = lo + (hi - lo) * max(0.0, min(100.0, req.tank_init_pct)) / 100.0
        lines.append(f"{t['id']} {float(t['elevationM']):.4f} {init:.6f} {lo:.4f} {hi:.4f} {float(t['diameterM']):.4f} 0")
    lines += ["", "[PIPES]", ";ID Node1 Node2 Length Diam Rough MinorLoss Status"]
    for p in w["pipes"]:
        status = "Open" if p["initialStatus"] == "open" else "Closed"
        lines.append(f"{p['id']} {p['from']} {p['to']} {float(p['lengthM']):.4f} {float(p['diameterMM']):.4f} {float(p['roughnessC']):.4f} 0 {status}")
    lines += ["", "[PUMPS]", ";ID Node1 Node2 Parameters"]
    for p in w["pumps"]:
        lines.append(f"{p['id']} {p['from']} {p['to']} HEAD VC-{p['id']} PATTERN VA-{p['id']}")
    lines += ["", "[CURVES]", ";ID Flow(LPS) Head(m)"]
    for p in w["pumps"]:
        q, h = float(p["designFlowLps"]), float(p["designHeadM"])
        for x, y in ((0.0, 4.0 / 3.0 * h), (q, h), (2.0 * q, 0.0)):
            lines.append(f"VC-{p['id']} {x:.6f} {y:.6f}")
    lines += ["", "[PATTERNS]"]

    def emit(name, vals):
        for i in range(0, len(vals), 12):
            lines.append(name + " " + " ".join(f"{v:.6f}" for v in vals[i : i + 12]))

    emit("DIURNAL", demand_pattern)
    for pid, vals in avail_min.items():
        emit(f"VA-{pid}", vals)
    dur = req.horizon_min * 60
    lines += [
        "",
        "[TIMES]",
        f"Duration {dur // 3600}:{(dur % 3600) // 60:02d}",
        "Hydraulic Timestep 0:01",
        "Pattern Timestep 0:01",
        f"Report Timestep {req.step_min // 60}:{req.step_min % 60:02d}",
        "Report Start 0:00",
        "",
        "[OPTIONS]",
        "Units LPS",
        "Headloss H-W",
        "Demand Model PDA",
        f"Minimum Pressure {float(o['minimumPressureM']):.4f}",
        f"Required Pressure {float(o['requiredPressureM']):.4f}",
        f"Pressure Exponent {float(o['pressureExponent']):.4f}",
        "Quality None",
        "",
        "[REPORT]",
        "Status No",
        "Summary No",
        "",
        "[END]",
    ]
    return "\n".join(lines) + "\n"


def _run_inp(text: str):
    tmp = tempfile.mkdtemp(prefix="encirra-verify-")
    try:
        path = os.path.join(tmp, "verify.inp")
        with open(path, "w", encoding="ascii") as fh:
            fh.write(text)
        wn = wntr.network.WaterNetworkModel(path)
        sim = wntr.sim.EpanetSimulator(wn)
        return sim.run_sim(file_prefix=os.path.join(tmp, "verify"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ─────────────────────────────────────────────────────────── verification
def _chk(cid, name, hard, passed, value, limit, detail) -> VerificationCheck:
    return VerificationCheck(id=cid, name=name, hard=hard, passed=bool(passed), value=value, limit=limit, detail=detail)


def verify(req: VerificationRequest) -> VerificationReport:
    with open(district_path(), encoding="utf-8") as fh:
        cfg = json.load(fh)  # fresh read: no shared objects with the planner
    el = cfg["electrical"]
    lim = el["limits"]
    vmin_l, vmax_l, vsoft = float(lim["vMinPu"]), float(lim["vMaxPu"]), float(lim["vSoftMinPu"])
    lmax_l = float(lim["loadingMaxPct"])
    thr = float(cfg["water"]["options"]["serviceThresholdM"])
    grid = _IndependentGrid(cfg)
    n = req.horizon_min // req.step_min + 1
    k0 = req.plan_frame
    clk = lambda k: profiles.clock_str(req.start_clock_min, k * req.step_min * 60)  # noqa: E731

    # replay the switching sequence from the normal configuration
    normal = {ln["switch"]["id"]: not ln["normallyOpen"] for ln in el["lines"]}
    by_frame: dict[int, list[SwitchOp]] = {}
    for op in req.ops:  # execution order is preserved within a frame
        by_frame.setdefault(op.frame, []).append(op)
    states: list[dict[str, bool]] = []
    cur = dict(normal)
    for k in range(n):
        for op in by_frame.get(k, []):
            cur[op.switch_id] = op.close
        if req.repair_frame is not None and k == req.repair_frame:
            cur = dict(normal)  # permanent repair: normal configuration restored
        states.append(dict(cur))
    fault_active = [req.fault_frame <= k and (req.repair_frame is None or k < req.repair_frame) for k in range(n)]
    shed = [set(req.shed_buses) if (k >= k0 and (req.repair_frame is None or k < req.repair_frame)) else set() for k in range(n)]

    # energisation per frame (pandapower topology)
    load_f = req.load_multiplier * profiles.per_minute(profiles.electrical_multiplier, req.start_clock_min, req.horizon_min)
    water_f = req.water_multiplier * profiles.per_minute(profiles.water_multiplier, req.start_clock_min, req.horizon_min)
    energised: list[set[int]] = []
    cache: dict = {}
    for k in range(n):
        key = (tuple(sorted(states[k].items())), fault_active[k])
        if key not in cache:
            grid.set_state(states[k], 1.0, set(), {}, req.fault_line if fault_active[k] else None)
            cache[key] = grid.energised()
        energised.append(cache[key])

    pumps = cfg["water"]["pumps"]
    trips: dict[str, int] = {}
    pf: dict[int, dict] = {}
    hyd = None
    for _ in range(4):
        avail = {}
        for p in pumps:
            pb = int(p["bus"]) - 1
            a = [1.0 if pb in energised[k] else 0.0 for k in range(n)]
            if p["id"] in trips:
                t0 = trips[p["id"]]
                end = req.repair_frame if (req.repair_frame is not None and req.repair_frame > t0) else n
                for k in range(t0, end):
                    a[k] = 0.0
            per_min = [a[min(m // req.step_min, n - 1)] for m in range(req.horizon_min + 1)] + [a[-1]] * 2
            avail[p["id"]] = per_min
        pattern = list(water_f) + [float(water_f[-1])] * 2
        res = _run_inp(_inp_text(cfg, req, avail, pattern))
        node, link = res.node, res.link
        head = node["head"]
        pkw = np.zeros((n, len(pumps)))
        pon = np.zeros((n, len(pumps)), dtype=bool)
        for i, p in enumerate(pumps):
            q = link["flowrate"][p["id"]].to_numpy(dtype=float)[:n]
            st = link["status"][p["id"]].to_numpy(dtype=float)[:n]
            h = (head[p["to"]].to_numpy(dtype=float) - head[p["from"]].to_numpy(dtype=float))[:n]
            on = (st > 0.5) & (q > 1e-6)
            pon[:, i] = on
            pkw[:, i] = np.where(on, WATER_DENSITY_KG_M3 * GRAVITY_M_S2 * np.maximum(q, 0) * np.maximum(h, 0) / float(p["efficiency"]) / 1000.0, 0.0)
        hyd = {"node": node, "link": link, "pkw": pkw, "pon": pon}
        pf = {}
        new = 0
        for k in range(k0, n):
            pk = {p["id"]: float(pkw[k, i]) for i, p in enumerate(pumps)}
            grid.set_state(states[k], float(load_f[k * req.step_min]), shed[k], pk, req.fault_line if fault_active[k] else None)
            pf[k] = grid.solve()
            for i, p in enumerate(pumps):
                if p["id"] in trips or not pon[k, i]:
                    continue
                pb = int(p["bus"]) - 1
                v = pf[k]["vm"][pb] if pf[k]["ok"] else float("nan")
                if not pf[k]["ok"] or np.isnan(v) or v < PUMP_UNDERVOLTAGE_TRIP_PU:
                    trips[p["id"]] = k
                    new += 1
        if new == 0:
            break

    checks: list[VerificationCheck] = []
    frames = list(range(k0, n))
    # 1. convergence
    bad = [k for k in frames if not pf[k]["ok"]]
    checks.append(_chk("pf-convergence", "AC power-flow convergence", True, not bad, f"{len(frames) - len(bad)}/{len(frames)} frames", "every frame converges", "Newton–Raphson, flat start" if not bad else f"Failed at {clk(bad[0])}"))
    # 2./3. voltage band + soft advisory, 4. thermal
    worst_lo = (math.inf, None, None)
    worst_hi = (-math.inf, None, None)
    worst_ld = (-math.inf, None, None)
    soft = 0
    for k in frames:
        r = pf[k]
        if not r["ok"]:
            continue
        for b in energised[k]:
            v = r["vm"][b]
            if np.isnan(v):
                continue
            if v < worst_lo[0]:
                worst_lo = (float(v), b, k)
            if v > worst_hi[0]:
                worst_hi = (float(v), b, k)
            if v < vsoft:
                soft += 1
        for ln in grid.lines:
            if not states[k][ln["switch"]] or (fault_active[k] and ln["id"] == req.fault_line):
                continue
            lp = r["loading"][ln["id"]]
            if not np.isnan(lp) and lp > worst_ld[0]:
                worst_ld = (float(lp), ln, k)
    v_ok = worst_lo[1] is None or (worst_lo[0] >= vmin_l - 1e-9 and worst_hi[0] <= vmax_l + 1e-9)
    vval = f"{worst_lo[0]:.3f}–{worst_hi[0]:.3f} pu (min at B{worst_lo[1] + 1}, {clk(worst_lo[2])})" if worst_lo[1] is not None else "n/a"
    checks.append(_chk("voltage-band", "Voltage within hard band", True, v_ok, vval, f"{vmin_l:.2f}–{vmax_l:.2f} pu", f"All energised buses, {len(frames)} frames"))
    checks.append(_chk("voltage-soft", "Voltage advisory (soft)", False, soft == 0, f"{soft} bus-minute(s) < {vsoft:.2f} pu", f"≥ {vsoft:.2f} pu preferred", "Soft preference; reported, never used to reject"))
    t_ok = worst_ld[1] is None or worst_ld[0] <= lmax_l + 1e-9
    tval = f"max {worst_ld[0]:.0f}% on {worst_ld[1]['switch']} ({clk(worst_ld[2])})" if worst_ld[1] is not None else "n/a"
    checks.append(_chk("thermal", "Thermal loading", True, t_ok, tval, f"≤ {lmax_l:.0f}% of rating", "Synthetic ratings from district.json"))
    # 5. connectivity of claimed buses
    missing = sorted({b for k in frames for b in req.claimed_buses if b not in energised[k] or b in shed[k]})
    checks.append(
        _chk(
            "connectivity",
            "Claimed buses connected",
            True,
            not missing,
            f"{len(req.claimed_buses) - len(missing)}/{len(req.claimed_buses)} served",
            "every claimed bus energised for the whole remaining horizon",
            "pandapower.topology connected component of the slack bus" if not missing else "Not served: " + ", ".join(f"B{b + 1}" for b in missing),
        )
    )
    # 6. radiality (every distinct configuration after switching)
    rad_ok, rad_detail = True, ""
    seen = set()
    for k in frames:
        key = tuple(sorted(states[k].items()))
        if key in seen:
            continue
        seen.add(key)
        grid.set_state(states[k], 1.0, set(), {}, req.fault_line if fault_active[k] else None)
        ok, det = grid.radial()
        rad_ok &= ok
        rad_detail = det if ok and not rad_detail else (det if not ok else rad_detail)
    checks.append(_chk("radiality", "Radial operation", True, rad_ok, "radial" if rad_ok else "meshed", "no closed loops", rad_detail))
    # 7. fault isolation
    fl = next(ln for ln in grid.lines if ln["id"] == req.fault_line)
    live = [k for k in frames if fault_active[k] and states[k][fl["switch"]] and (fl["from"] in energised[k] or fl["to"] in energised[k])]
    checks.append(
        _chk(
            "fault-isolation",
            "Faulted section isolated",
            True,
            not live,
            "isolated" if not live else f"re-energised at {clk(live[0])}",
            "faulted line disconnected from every source",
            f"Faulted line B{fl['from'] + 1}–B{fl['to'] + 1}",
        )
    )
    # 8. pump supply
    pump_msgs = []
    pump_ok = True
    for i, p in enumerate(pumps):
        pb = int(p["bus"]) - 1
        vs = [pf[k]["vm"][pb] for k in frames if pf[k]["ok"] and pb in energised[k]]
        vmin_p = min(vs) if vs else None
        tripped = p["id"] in trips and trips[p["id"]] >= k0
        claimed = p["id"] in req.claimed_pumps
        not_running = claimed and any(not hyd["pon"][k, i] for k in frames)
        if tripped or not_running:
            pump_ok = False
        state = "tripped" if tripped else ("off" if not_running else "running" if vs else "de-energised")
        pump_msgs.append(f"{p['id']} {state}" + (f" (min {vmin_p:.3f} pu)" if vmin_p is not None else ""))
    checks.append(_chk("pump-supply", "Pump electricity availability", True, pump_ok, ", ".join(pump_msgs), f"claimed pumps run; no undervoltage trip (< {PUMP_UNDERVOLTAGE_TRIP_PU:.2f} pu)", "Pump runs only if its bus is energised and V ≥ 0.90 pu"))
    # 9. critical-facility pressure (soft)
    node = hyd["node"]
    crit = [j["id"] for j in cfg["water"]["junctions"] if j.get("critical")]
    pmin = {j: float(max(0.0, node["pressure"][j].to_numpy(dtype=float)[k0:n].min())) for j in crit}
    below = sum(1 for k in frames if any(node["pressure"][j].to_numpy(dtype=float)[k] < thr for j in crit)) * req.step_min
    worst = min(pmin, key=lambda j: pmin[j]) if pmin else None
    p_ok = all(v >= thr for v in pmin.values())
    checks.append(
        _chk(
            "pressure-critical",
            "Critical-facility water pressure (soft)",
            False,
            p_ok,
            f"min {pmin[worst]:.1f} m at {worst}" if worst else "n/a",
            f"≥ {thr:.0f} m over the remaining horizon",
            "Service threshold held" if p_ok else f"{below} min below service threshold",
        )
    )
    # 10. tank level (soft)
    tank_txt = []
    t_ok = True
    for t in cfg["water"]["tanks"]:
        lvl = node["head"][t["id"]].to_numpy(dtype=float)[k0:n] - float(t["elevationM"])
        lo, hi = float(t["minLevelM"]), float(t["maxLevelM"])
        pct = float(np.clip((lvl.min() - lo) / (hi - lo) * 100.0, 0, 100))
        tank_txt.append(f"{t['id']} min {pct:.0f}%")
        if pct <= 0.5:
            t_ok = False
    checks.append(_chk("tank-level", "Tank level above minimum (soft)", False, t_ok, ", ".join(tank_txt), f"> minimum level (advisory at {TANK_LOW_PCT:.0f}%)", "Extended-period simulation"))
    # 11. critical facility service (soft)
    issues = []
    for f in cfg["facilities"]:
        if not f.get("critical") or f.get("bus") is None:
            continue
        b = int(f["bus"]) - 1
        dark = [k for k in frames if b not in energised[k]]
        if dark and not f.get("backup"):
            issues.append(f"{f['name']} without power")
    for j in crit:
        if pmin.get(j, thr) < thr:
            issues.append(f"{j} below {thr:.0f} m")
    checks.append(_chk("critical-service", "Critical facility service (soft)", False, not issues, "all served" if not issues else f"{len(issues)} issue(s)", "power (grid or backup) and water for every critical facility", "; ".join(issues) if issues else "Every critical facility has power and water"))
    # 12. switching feasibility
    remote = {ln["switch"]: ln["remote"] for ln in grid.lines}
    non_remote = [s for s in req.plan_switch_ids if not remote.get(s, False)]
    n_ops = len(req.plan_switch_ids) + len(req.shed_buses)
    sw_ok = not non_remote and n_ops <= MAX_SWITCH_OPS
    checks.append(
        _chk(
            "switching-feasible",
            "Switching feasibility",
            True,
            sw_ok,
            f"{n_ops} operation(s)",
            f"≤ {MAX_SWITCH_OPS}, remote-controlled only",
            "All plan switches are remote-controlled" if not non_remote else "Manual switches: " + ", ".join(non_remote),
        )
    )
    passed = all(c.passed for c in checks if c.hard)
    return VerificationReport(passed=passed, status="simulation-verified" if passed else "rejected", checks=checks, method=METHOD)

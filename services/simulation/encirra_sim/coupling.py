"""Power ⇄ water co-simulation (block Gauss–Seidel fixed point).

Inputs: a switching timeline (piecewise-constant switch states / shed sets, plus the fault).
For every frame step k:

1. Energisation of each bus follows from the switch states (NetworkX, faulted line out of service).
2. Pump availability: a pump can run only if its supply bus is energised and the bus voltage with
   the pump running is ≥ 0.90 pu (undervoltage trip). A trip latches until the next switching
   event (motor restart requires a new switching/reset command).
3. The hydraulic extended-period simulation (EPANET, 60 s step) runs over the whole horizon with
   these availability schedules → pump flow Q and head H per step → pump electrical demand
   P = ρ·g·Q·H/η (Q at pf 0.85).
4. AC power flow per step with the bus loads (time-of-day profile) plus the pump loads.
5. Pump-bus voltages are re-checked. If any new undervoltage trip appears, the availability
   schedule is updated and steps 3–5 repeat (≤ 4 iterations). The fixed point is reached when the
   availability schedule no longer changes; the pump powers used by the last power flow are then
   exactly those of the last hydraulic solution.

Flows, pressures and tank levels therefore always come from the recalculated hydraulic simulation
of the final iteration, and voltages from power flows that include the corresponding pump loads.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Sequence

import numpy as np

from . import profiles
from .config import PUMP_UNDERVOLTAGE_TRIP_PU, District
from .electrical import PFResult, PowerNetwork
from .topology import energized_buses
from .water import HydraulicResult, simulate as simulate_eps

MAX_COUPLING_ITERATIONS = 4


@dataclass(frozen=True)
class Segment:
    start: int  # first frame index of the segment
    closed: tuple[bool, ...]
    shed: frozenset[int]
    fault_active: bool
    label: str


@dataclass
class SwitchingTimeline:
    segments: list[Segment]
    fault_line: int | None

    def segment_index(self, k: int) -> int:
        idx = 0
        for i, s in enumerate(self.segments):
            if s.start <= k:
                idx = i
            else:
                break
        return idx

    def at(self, k: int) -> Segment:
        return self.segments[self.segment_index(k)]


@dataclass
class SimSetup:
    """Time base and exogenous inputs shared by every simulation of one scenario run."""

    district: District
    horizon_min: int
    step_min: int
    start_clock_min: int
    load_multiplier: float
    water_multiplier: float
    tank_init_pct: float

    def __post_init__(self):
        self.n_frames = self.horizon_min // self.step_min + 1
        self.load_factor_min = self.load_multiplier * profiles.per_minute(profiles.electrical_multiplier, self.start_clock_min, self.horizon_min)
        self.water_pattern_min = self.water_multiplier * profiles.per_minute(profiles.water_multiplier, self.start_clock_min, self.horizon_min)
        self.load_factor = self.load_factor_min[np.arange(self.n_frames) * self.step_min]

    def frame_minutes(self, k: int) -> int:
        return k * self.step_min


@dataclass
class CoupledResult:
    setup: SimSetup
    timeline: SwitchingTimeline
    energized: list[frozenset[int]]
    seg_of_frame: np.ndarray
    hyd: HydraulicResult
    pf: dict[int, PFResult]
    pump_avail: dict[str, np.ndarray]
    pump_trips: list[tuple[str, int, float | None]]  # (pump id, frame, voltage or None if PF failed)
    iterations: int
    converged: bool
    history: list[dict] = field(default_factory=list)

    @property
    def n(self) -> int:
        return self.setup.n_frames

    def pump_kw(self, k: int) -> dict[str, float]:
        return {pid: float(self.hyd.pump_kw[k, i]) for i, pid in enumerate(self.hyd.pump_ids)}

    def served_bus_kw(self, k: int) -> np.ndarray:
        """Load actually supplied at each bus (benchmark load × factor if energised and not shed, plus running pumps)."""
        d = self.setup.district
        seg = self.timeline.at(k)
        en = self.energized[k]
        lf = self.setup.load_factor[k]
        out = np.zeros(d.n_bus)
        for b in d.buses:
            if b.id in en and b.id not in seg.shed:
                out[b.id] = b.load_kw * lf
        for i, pu in enumerate(d.pumps):
            if self.hyd.pump_on[k, i]:
                out[pu.bus] += float(self.hyd.pump_kw[k, i])
        return out


def _energized_cache(district: District, timeline: SwitchingTimeline) -> list[frozenset[int]]:
    out = []
    for seg in timeline.segments:
        oos = [timeline.fault_line] if (seg.fault_active and timeline.fault_line is not None) else []
        out.append(energized_buses(district, seg.closed, oos))
    return out


def simulate(
    setup: SimSetup,
    timeline: SwitchingTimeline,
    net: PowerNetwork,
    pf_frames: Iterable[int] | None = None,
) -> CoupledResult:
    """Run the coupled simulation. ``pf_frames`` limits the power flows to a subset of frames
    (used by candidate screening); ``None`` solves every frame."""
    d = setup.district
    n = setup.n_frames
    pf_set = sorted(set(range(n)) if pf_frames is None else {k for k in pf_frames if 0 <= k < n})
    seg_en = _energized_cache(d, timeline)
    seg_of_frame = np.array([timeline.segment_index(k) for k in range(n)])
    energized = [seg_en[seg_of_frame[k]] for k in range(n)]
    base_avail = {pu.id: np.array([pu.bus in energized[k] for k in range(n)]) for pu in d.pumps}
    trips: dict[tuple[str, int], int] = {}  # (pump, segment) -> first tripped frame
    trip_log: list[tuple[str, int, float | None]] = []
    history: list[dict] = []
    prev_kw = None
    hyd = None
    pf: dict[int, PFResult] = {}
    converged = False
    it = 0
    for it in range(1, MAX_COUPLING_ITERATIONS + 1):
        avail = {}
        for pu in d.pumps:
            a = base_avail[pu.id].copy()
            for (pid, seg), k0 in trips.items():
                if pid != pu.id:
                    continue
                seg_end = timeline.segments[seg + 1].start if seg + 1 < len(timeline.segments) else n
                a[k0:seg_end] = False
            avail[pu.id] = a
        avail_min = {pid: np.repeat(arr, setup.step_min)[: setup.horizon_min + 1] for pid, arr in avail.items()}
        for pid, arr in avail_min.items():
            if len(arr) < setup.horizon_min + 1:
                avail_min[pid] = np.concatenate([arr, np.repeat(arr[-1:], setup.horizon_min + 1 - len(arr))])
        hyd = simulate_eps(d, setup.water_pattern_min, setup.tank_init_pct, avail_min, setup.horizon_min, setup.step_min)
        pf = {}
        for k in pf_set:
            seg = timeline.at(k)
            oos = [timeline.fault_line] if (seg.fault_active and timeline.fault_line is not None) else []
            pk = {pid: float(hyd.pump_kw[k, i]) for i, pid in enumerate(hyd.pump_ids)}
            pf[k] = net.solve(seg.closed, float(setup.load_factor[k]), seg.shed, pk, oos)
        new_trips = 0
        for i, pu in enumerate(d.pumps):
            for k in pf_set:
                if not avail[pu.id][k] or not hyd.pump_on[k, i]:
                    continue
                seg_idx = int(seg_of_frame[k])
                if (pu.id, seg_idx) in trips:
                    continue
                res = pf[k]
                v = res.v_at(pu.bus) if res.converged else None
                if v is None or v < PUMP_UNDERVOLTAGE_TRIP_PU:
                    trips[(pu.id, seg_idx)] = k
                    trip_log.append((pu.id, k, v))
                    new_trips += 1
        kw = hyd.pump_kw.copy()
        dkw = float(np.max(np.abs(kw - prev_kw))) if prev_kw is not None else None
        prev_kw = kw
        history.append({"iteration": it, "newTrips": new_trips, "maxPumpKwChange": dkw})
        if new_trips == 0:
            converged = True
            break
    if not converged:
        # Final consistency pass is not available within the iteration budget; report as such.
        pass
    final_avail = {}
    for pu in d.pumps:
        a = base_avail[pu.id].copy()
        for (pid, seg), k0 in trips.items():
            if pid != pu.id:
                continue
            seg_end = timeline.segments[seg + 1].start if seg + 1 < len(timeline.segments) else n
            a[k0:seg_end] = False
        final_avail[pu.id] = a
    trip_log.sort(key=lambda x: (x[1], x[0]))
    return CoupledResult(
        setup=setup,
        timeline=timeline,
        energized=energized,
        seg_of_frame=seg_of_frame,
        hyd=hyd,
        pf=pf,
        pump_avail=final_avail,
        pump_trips=trip_log,
        iterations=it,
        converged=converged,
        history=history,
    )


def build_timeline(segments: Sequence[Segment], fault_line: int | None) -> SwitchingTimeline:
    segs = sorted(segments, key=lambda s: s.start)
    return SwitchingTimeline(list(segs), fault_line)

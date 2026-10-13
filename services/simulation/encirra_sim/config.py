"""Repository paths, district configuration and scenario definitions.

The district configuration (``packages/shared/config/district.json``) is the single source of
truth for buses, lines, switches, facilities and the water network. This module loads it once
and exposes convenient, index-stable views used by the electrical, hydraulic and planning code.

Conventions
-----------
* Electrical bus ids are pandapower indices (0-based). The benchmark bus *number* is ``id + 1``.
  ``district.json`` stores 1-based numbers; they are converted here exactly once.
* Line ids follow ``pandapower.networks.case33bw()`` order (0–31 feeder sections, 32–36 ties).
* Every line carries exactly one switch, modelled at the line's ``from`` end.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

ENGINE_VERSION = "1.0.0"
SCHEMA_VERSION = 1

SCENARIO_ORDER = ("feeder-fault", "pump-power-loss", "high-demand")
STRATEGIES = ("none", "grid-only", "encirra")

# Physical constants used for the pump electrical model (documented in docs/METHODOLOGY.md).
WATER_DENSITY_KG_M3 = 1000.0
GRAVITY_M_S2 = 9.81
PUMP_POWER_FACTOR = 0.85  # induction-motor power factor used for the pump reactive load
PUMP_UNDERVOLTAGE_TRIP_PU = 0.90  # pump motor undervoltage trip threshold

# Planner limits
MAX_SWITCH_OPS = 4  # maximum remote switching operations in a restoration plan
MAX_TIE_CLOSURES = 2
MAX_SECTIONALIZER_OPENS = 1
MAX_SHED_BUSES = 2
TANK_LOW_PCT = 25.0  # "low storage" advisory threshold (% of usable range)


def repo_root() -> Path:
    """Locate the repository root.

    ``ENCIRRA_REPO_ROOT`` overrides; otherwise walk up from this package until the shared
    district configuration is found.
    """
    env = os.environ.get("ENCIRRA_REPO_ROOT")
    if env:
        p = Path(env).resolve()
        if (p / "packages" / "shared" / "config" / "district.json").is_file():
            return p
        raise FileNotFoundError(f"ENCIRRA_REPO_ROOT={env} does not contain packages/shared/config/district.json")
    here = Path(__file__).resolve()
    for parent in [here, *here.parents]:
        if (parent / "packages" / "shared" / "config" / "district.json").is_file():
            return parent
    raise FileNotFoundError("Could not locate the Encirra repository root (packages/shared/config/district.json)")


def district_path() -> Path:
    return repo_root() / "packages" / "shared" / "config" / "district.json"


def scenarios_dir() -> Path:
    return repo_root() / "scenarios"


def cache_dir() -> Path:
    d = Path(__file__).resolve().parent.parent / ".cache"
    d.mkdir(parents=True, exist_ok=True)
    return d


@lru_cache(maxsize=1)
def code_fingerprint() -> str:
    """Hash of the engine source, district.json and scenario files (cache invalidation)."""
    import hashlib

    h = hashlib.sha256()
    pkg = Path(__file__).resolve().parent
    for f in sorted(pkg.glob("*.py")):
        h.update(f.name.encode())
        h.update(f.read_bytes())
    h.update(district_path().read_bytes())
    for f in sorted(scenarios_dir().glob("*.json")):
        h.update(f.read_bytes())
    return h.hexdigest()[:12]


def _read_json(path: Path) -> Any:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


@dataclass(frozen=True)
class Bus:
    id: int
    number: int
    name: str
    feeder: str
    load_kw: float
    load_kvar: float
    connections: int
    critical: bool
    pos: tuple[float, float]
    label: str
    facility_ids: tuple[str, ...]


@dataclass(frozen=True)
class Line:
    id: int
    from_bus: int  # 0-based
    to_bus: int  # 0-based
    kind: str  # feeder | tie
    feeder: str
    rating_a: float
    normally_open: bool
    switch_id: str
    switch_kind: str
    remote: bool


@dataclass(frozen=True)
class Facility:
    id: str
    name: str
    kind: str
    critical: bool
    bus: int | None  # 0-based
    water_node: str | None
    pumps: tuple[str, ...]
    backup: dict | None
    pos: tuple[float, float]
    description: str

    @property
    def backup_kw(self) -> float:
        return float(self.backup["kW"]) if self.backup else 0.0


@dataclass(frozen=True)
class Pump:
    id: str
    label: str
    from_node: str
    to_node: str
    station_id: str
    bus: int  # 0-based
    design_flow_lps: float
    design_head_m: float
    efficiency: float
    rated_kw: float


@dataclass
class District:
    raw: dict
    buses: list[Bus]
    lines: list[Line]
    facilities: list[Facility]
    pumps: list[Pump]
    substation_bus: int
    limits: dict
    junctions: list[dict]
    reservoirs: list[dict]
    tanks: list[dict]
    pipes: list[dict]
    water_options: dict
    switch_index: dict[str, int] = field(default_factory=dict)  # switch id -> line id
    facility_index: dict[str, Facility] = field(default_factory=dict)

    @property
    def n_bus(self) -> int:
        return len(self.buses)

    @property
    def n_line(self) -> int:
        return len(self.lines)

    def line_by_switch(self, switch_id: str) -> Line:
        return self.lines[self.switch_index[switch_id]]

    def bus_label(self, bus_id: int) -> str:
        return self.buses[bus_id].name

    def line_label(self, line_id: int) -> str:
        ln = self.lines[line_id]
        return f"B{ln.from_bus + 1}–B{ln.to_bus + 1}"

    def normal_switch_state(self) -> tuple[bool, ...]:
        return tuple(not ln.normally_open for ln in self.lines)

    def facilities_on_bus(self, bus_id: int) -> list[Facility]:
        return [f for f in self.facilities if f.bus == bus_id]

    def backup_kw_on_bus(self, bus_id: int) -> float:
        return sum(f.backup_kw for f in self.facilities_on_bus(bus_id) if f.backup)

    def pump_on_bus(self, bus_id: int) -> list[Pump]:
        return [p for p in self.pumps if p.bus == bus_id]

    @property
    def demand_junction_ids(self) -> list[str]:
        return [j["id"] for j in self.junctions if j["baseDemandLps"] > 0]

    @property
    def critical_junction_ids(self) -> list[str]:
        return [j["id"] for j in self.junctions if j.get("critical")]


def _build_district(raw: dict) -> District:
    el = raw["electrical"]
    fac_raw = raw["facilities"]
    fac_by_bus: dict[int, list[str]] = {}
    for f in fac_raw:
        if f.get("bus") is not None:
            fac_by_bus.setdefault(int(f["bus"]) - 1, []).append(f["id"])
    buses = []
    for b in sorted(el["buses"], key=lambda x: x["id"]):
        bid = int(b["id"])
        assert bid == int(b["number"]) - 1, "district.json bus id must equal number - 1"
        buses.append(
            Bus(
                id=bid,
                number=int(b["number"]),
                name=b["name"],
                feeder=b["feeder"],
                load_kw=float(b["loadKW"]),
                load_kvar=float(b["loadKVAr"]),
                connections=int(b["connections"]),
                critical=bool(b["critical"]),
                pos=(float(b["pos"][0]), float(b["pos"][1])),
                label=b["label"],
                facility_ids=tuple(fac_by_bus.get(bid, [])),
            )
        )
    lines = []
    for ln in sorted(el["lines"], key=lambda x: x["id"]):
        sw = ln["switch"]
        lines.append(
            Line(
                id=int(ln["id"]),
                from_bus=int(ln["from"]) - 1,
                to_bus=int(ln["to"]) - 1,
                kind=ln["kind"],
                feeder=ln["feeder"],
                rating_a=float(ln["ratingA"]),
                normally_open=bool(ln["normallyOpen"]),
                switch_id=sw["id"],
                switch_kind=sw["kind"],
                remote=bool(sw["remote"]),
            )
        )
    facilities = [
        Facility(
            id=f["id"],
            name=f["name"],
            kind=f["kind"],
            critical=bool(f["critical"]),
            bus=(int(f["bus"]) - 1) if f.get("bus") is not None else None,
            water_node=f.get("waterNode"),
            pumps=tuple(f.get("pumps", []) or []),
            backup=f.get("backup"),
            pos=(float(f["pos"][0]), float(f["pos"][1])),
            description=f.get("description", ""),
        )
        for f in fac_raw
    ]
    w = raw["water"]
    pumps = [
        Pump(
            id=p["id"],
            label=p["label"],
            from_node=p["from"],
            to_node=p["to"],
            station_id=p["stationId"],
            bus=int(p["bus"]) - 1,
            design_flow_lps=float(p["designFlowLps"]),
            design_head_m=float(p["designHeadM"]),
            efficiency=float(p["efficiency"]),
            rated_kw=float(p["ratedKW"]),
        )
        for p in w["pumps"]
    ]
    d = District(
        raw=raw,
        buses=buses,
        lines=lines,
        facilities=facilities,
        pumps=pumps,
        substation_bus=int(el["substationBus"]) - 1,
        limits=dict(el["limits"]),
        junctions=list(w["junctions"]),
        reservoirs=list(w["reservoirs"]),
        tanks=list(w["tanks"]),
        pipes=list(w["pipes"]),
        water_options=dict(w["options"]),
    )
    d.switch_index = {ln.switch_id: ln.id for ln in lines}
    d.facility_index = {f.id: f for f in facilities}
    return d


@lru_cache(maxsize=1)
def load_district() -> District:
    return _build_district(_read_json(district_path()))


def district_mtime() -> float:
    return district_path().stat().st_mtime


@lru_cache(maxsize=1)
def load_scenario_files() -> dict[str, dict]:
    """Raw ScenarioDefinition dicts from /scenarios/*.json, keyed by id (stable order)."""
    out: dict[str, dict] = {}
    files = sorted(scenarios_dir().glob("*.json"))
    found = {}
    for f in files:
        data = _read_json(f)
        found[data["id"]] = data
    for sid in SCENARIO_ORDER:
        if sid in found:
            out[sid] = found[sid]
    for sid in sorted(found):
        if sid not in out:
            out[sid] = found[sid]
    return out


DEFAULT_WEIGHTS: dict[str, float] = {
    # Soft preferences of the Encirra planner. Hard constraints are never weighted.
    "servedLoad": 1.0,  # per MWh of electrical demand served over the remaining horizon
    "criticalLoad": 2.0,  # per MWh of critical-bus demand served from the grid (additional)
    "waterDelivered": 2.0,  # per 1,000 m³ of water demand delivered
    "criticalWater": 1.5,  # per hour of water service (≥ service threshold) at each critical facility
    "pressureStorage": 0.01,  # per % of minimum tank level preserved (mean over tanks)
    "switchingCost": 0.05,  # penalty per switching operation
}

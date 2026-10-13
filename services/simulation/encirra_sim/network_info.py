"""Static NetworkTopology (contract) built from district.json and the benchmark impedances."""

from __future__ import annotations

from functools import lru_cache

import pandapower.networks as pn

from .config import district_mtime, load_district
from .models import (
    BusInfo,
    DistrictInfo,
    ElectricalLimits,
    ElectricalTopology,
    FacilityBackup,
    FacilityInfo,
    FeederInfo,
    JunctionInfo,
    LineInfo,
    NetworkTopology,
    PipeInfo,
    PumpInfo,
    ReservoirInfo,
    SwitchInfo,
    TankInfo,
    WaterTopology,
)


def build_topology() -> NetworkTopology:
    return _cached(district_mtime())


@lru_cache(maxsize=2)
def _cached(_mtime: float) -> NetworkTopology:
    d = load_district()
    raw = d.raw
    el = raw["electrical"]
    ref = pn.case33bw()
    vn = float(ref.bus.vn_kv.iloc[0])
    buses = [
        BusInfo(
            id=b.id,
            number=b.number,
            name=b.name,
            feeder=b.feeder,
            vn_kv=float(ref.bus.at[b.id, "vn_kv"]),
            load_kw=b.load_kw,
            load_kvar=b.load_kvar,
            connections=b.connections,
            critical=b.critical,
            facility_ids=list(b.facility_ids),
            pos=b.pos,
            label=b.label,
        )
        for b in d.buses
    ]
    lines = []
    for ln in d.lines:
        length = float(ref.line.at[ln.id, "length_km"])
        lines.append(
            LineInfo(
                id=ln.id,
                from_=ln.from_bus,
                to=ln.to_bus,
                kind=ln.kind,
                feeder=ln.feeder,
                r_ohm=round(float(ref.line.at[ln.id, "r_ohm_per_km"]) * length, 4),
                x_ohm=round(float(ref.line.at[ln.id, "x_ohm_per_km"]) * length, 4),
                rating_a=ln.rating_a,
                normally_open=ln.normally_open,
                switch_id=ln.switch_id,
            )
        )
    switches = [SwitchInfo(id=ln.switch_id, line_id=ln.id, kind=ln.switch_kind, normally_open=ln.normally_open, remote=ln.remote) for ln in d.lines]
    feeders = [FeederInfo(id=f["id"], name=f["name"], description=f["description"], buses=[int(b) - 1 for b in f["buses"]]) for f in el["feeders"]]
    electrical = ElectricalTopology(
        benchmark=el["benchmark"],
        base_kv=float(el.get("baseKV", vn)),
        substation_bus=d.substation_bus,
        limits=ElectricalLimits(**{k: float(v) for k, v in {"v_min_pu": el["limits"]["vMinPu"], "v_max_pu": el["limits"]["vMaxPu"], "v_soft_min_pu": el["limits"]["vSoftMinPu"], "loading_max_pct": el["limits"]["loadingMaxPct"]}.items()}),
        buses=buses,
        lines=lines,
        switches=switches,
        feeders=feeders,
        nominal_load_kw=sum(b.load_kw for b in d.buses),
        nominal_load_kvar=sum(b.load_kvar for b in d.buses),
    )
    w = raw["water"]
    junctions = [
        JunctionInfo(
            id=j["id"],
            label=j["label"],
            zone=j["zone"],
            elevation_m=float(j["elevationM"]),
            base_demand_lps=float(j["baseDemandLps"]),
            critical=bool(j.get("critical", False)),
            facility_id=j.get("facilityId"),
            connections=int(j.get("connections", 0)),
            pos=tuple(float(x) for x in j["pos"]),
        )
        for j in w["junctions"]
    ]
    reservoirs = [ReservoirInfo(id=r["id"], label=r["label"], head_m=float(r["headM"]), pos=tuple(float(x) for x in r["pos"]), facility_id=r.get("facilityId")) for r in w["reservoirs"]]
    tanks = [
        TankInfo(
            id=t["id"],
            label=t["label"],
            zone=t["zone"],
            elevation_m=float(t["elevationM"]),
            min_level_m=float(t["minLevelM"]),
            max_level_m=float(t["maxLevelM"]),
            init_level_m=float(t["initLevelM"]),
            diameter_m=float(t["diameterM"]),
            pos=tuple(float(x) for x in t["pos"]),
            facility_id=t.get("facilityId"),
        )
        for t in w["tanks"]
    ]
    pipes = [
        PipeInfo(
            id=p["id"],
            from_=p["from"],
            to=p["to"],
            length_m=float(p["lengthM"]),
            diameter_mm=float(p["diameterMM"]),
            roughness_c=float(p["roughnessC"]),
            kind=p["kind"],
            initial_status=p["initialStatus"],
            route=[tuple(float(x) for x in pt) for pt in p.get("route", [])],
        )
        for p in w["pipes"]
    ]
    pumps = [
        PumpInfo(
            id=p.id,
            label=p.label,
            from_=p.from_node,
            to=p.to_node,
            station_id=p.station_id,
            bus=p.bus,
            design_flow_lps=p.design_flow_lps,
            design_head_m=p.design_head_m,
            efficiency=p.efficiency,
            rated_kw=p.rated_kw,
        )
        for p in d.pumps
    ]
    water = WaterTopology(
        model=w["model"],
        required_pressure_m=float(w["options"]["requiredPressureM"]),
        minimum_pressure_m=float(w["options"]["minimumPressureM"]),
        service_threshold_m=float(w["options"]["serviceThresholdM"]),
        junctions=junctions,
        reservoirs=reservoirs,
        tanks=tanks,
        pipes=pipes,
        pumps=pumps,
    )
    facilities = []
    for f in raw["facilities"]:
        b = f.get("backup")
        facilities.append(
            FacilityInfo(
                id=f["id"],
                name=f["name"],
                kind=f["kind"],
                critical=bool(f["critical"]),
                bus=(int(f["bus"]) - 1) if f.get("bus") is not None else None,
                water_node=f.get("waterNode"),
                pumps=list(f["pumps"]) if f.get("pumps") else None,
                backup=FacilityBackup(kind=b["kind"], kw=float(b["kW"]), hours=float(b["hours"]), covers_water=bool(b["coversWater"])) if b else None,
                pos=(float(f["pos"][0]), float(f["pos"][1])),
                description=f.get("description", ""),
            )
        )
    dist = raw["district"]
    return NetworkTopology(
        district=DistrictInfo(id=dist["id"], name=dist["name"], label=dist["label"], disclaimer=dist["disclaimer"]),
        electrical=electrical,
        water=water,
        facilities=facilities,
    )

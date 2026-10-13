"""FastAPI service (``npm run dev:sim`` → http://127.0.0.1:8000).

Endpoints
---------
* ``GET  /api/health``                    HealthResponse
* ``GET  /api/topology``                  NetworkTopology
* ``GET  /api/scenarios``                 ScenarioDefinition[]
* ``POST /api/run``                       RunRequest → RunResult (provenance.source = "live")
* ``GET  /api/compare/{scenarioId}``      Comparison (optional weight overrides as query parameters)
* ``GET  /api/export/{scenarioId}.json``  comparison + per-frame time series for all strategies
* ``GET  /api/export/{scenarioId}.csv``   per-frame time series for all strategies (CSV)
"""

from __future__ import annotations

import csv
import io
from typing import Optional

import pandapower
import wntr
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from .config import ENGINE_VERSION
from .engine import cached_runs, compare, run, scenario_definitions
from .models import HealthResponse, PartialObjectiveWeights, RunRequest
from .network_info import build_topology

app = FastAPI(
    title="Encirra simulation service",
    version=ENGINE_VERSION,
    description="Coupled power–water co-simulation (pandapower + EPANET/WNTR), recovery planning and independent verification. Research prototype on synthetic/benchmark data.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:4173", "http://localhost:4173"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def _json(model) -> JSONResponse:
    return JSONResponse(model.model_dump(by_alias=True, mode="json"))


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc).strip("'\"")) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/health")
def health() -> JSONResponse:
    return _json(HealthResponse(ok=True, engine_version=ENGINE_VERSION, pandapower=pandapower.__version__, wntr=wntr.__version__, cached_runs=cached_runs()))


@app.get("/api/topology")
def topology() -> JSONResponse:
    return _json(build_topology())


@app.get("/api/scenarios")
def scenarios() -> JSONResponse:
    return JSONResponse([s.model_dump(by_alias=True, mode="json") for s in scenario_definitions()])


@app.post("/api/run")
def run_endpoint(request: RunRequest) -> JSONResponse:
    result = _guard(run, request, source="live")
    return _json(result)


def _weights(served_load, critical_load, water_delivered, critical_water, pressure_storage, switching_cost) -> Optional[PartialObjectiveWeights]:
    vals = dict(
        served_load=served_load,
        critical_load=critical_load,
        water_delivered=water_delivered,
        critical_water=critical_water,
        pressure_storage=pressure_storage,
        switching_cost=switching_cost,
    )
    if all(v is None for v in vals.values()):
        return None
    return PartialObjectiveWeights(**{k: v for k, v in vals.items() if v is not None})


WEIGHT_QUERY = dict(
    served_load=Query(None, alias="servedLoad", ge=0),
    critical_load=Query(None, alias="criticalLoad", ge=0),
    water_delivered=Query(None, alias="waterDelivered", ge=0),
    critical_water=Query(None, alias="criticalWater", ge=0),
    pressure_storage=Query(None, alias="pressureStorage", ge=0),
    switching_cost=Query(None, alias="switchingCost", ge=0),
)


@app.get("/api/compare/{scenario_id}")
def compare_endpoint(
    scenario_id: str,
    served_load: Optional[float] = WEIGHT_QUERY["served_load"],
    critical_load: Optional[float] = WEIGHT_QUERY["critical_load"],
    water_delivered: Optional[float] = WEIGHT_QUERY["water_delivered"],
    critical_water: Optional[float] = WEIGHT_QUERY["critical_water"],
    pressure_storage: Optional[float] = WEIGHT_QUERY["pressure_storage"],
    switching_cost: Optional[float] = WEIGHT_QUERY["switching_cost"],
) -> JSONResponse:
    w = _weights(served_load, critical_load, water_delivered, critical_water, pressure_storage, switching_cost)
    comp, _ = _guard(compare, scenario_id, None, w, "live")
    return _json(comp)


SERIES_COLUMNS = (
    ("t", lambda f: f.t),
    ("clock", lambda f: f.clock),
    ("stage", lambda f: f.stage),
    ("demandKW", lambda f: f.power.demand_kw),
    ("servedKW", lambda f: f.power.served_kw),
    ("unservedKW", lambda f: f.power.unserved_kw),
    ("restoredKW", lambda f: f.power.restored_kw),
    ("criticalUnservedKW", lambda f: f.power.critical_unserved_kw),
    ("lossesKW", lambda f: f.power.losses_kw),
    ("pumpKW", lambda f: f.power.pump_kw),
    ("vMinPu", lambda f: f.power.v_min_pu),
    ("voltageViolations", lambda f: f.power.voltage_violations),
    ("thermalViolations", lambda f: f.power.thermal_violations),
    ("requiredLps", lambda f: f.water.required_lps),
    ("deliveredLps", lambda f: f.water.delivered_lps),
    ("deliveredPct", lambda f: f.water.delivered_pct),
    ("minPressureM", lambda f: f.water.min_pressure_m),
    ("criticalPressureM", lambda f: f.water.critical_pressure_m),
    ("nodesBelowService", lambda f: f.water.nodes_below_service),
    ("pumpsOnline", lambda f: f.water.pumps_online),
)


def _series(result) -> dict:
    out = {name: [get(f) for f in result.frames] for name, get in SERIES_COLUMNS}
    tank_ids = [t.id for t in build_topology().water.tanks]
    for i, tid in enumerate(tank_ids):
        out[f"tank{tid}Pct"] = [f.water.tank_pct[i] for f in result.frames]
    return out


@app.get("/api/export/{scenario_id}.json")
def export_json(scenario_id: str) -> JSONResponse:
    comp, runs = _guard(compare, scenario_id, None, None, "live")
    return JSONResponse({"comparison": comp.model_dump(by_alias=True, mode="json"), "series": {k: _series(v) for k, v in runs.items()}})


@app.get("/api/export/{scenario_id}.csv")
def export_csv(scenario_id: str) -> Response:
    comp, runs = _guard(compare, scenario_id, None, None, "live")
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    tank_ids = [t.id for t in build_topology().water.tanks]
    w.writerow(["# Encirra comparison", scenario_id, f"engine {ENGINE_VERSION}", "synthetic district; simulation output"])
    w.writerow(["# summary"] + ["strategy", "outcome", "loadInterruptedKW", "loadRestoredKW", "loadRestoredPct", "minCriticalPressureM", "minutesBelowServicePressure", "tankMinPct", "constraintViolations", "switchOps", "candidatesEvaluated", "candidatesRejected"])
    for k, r in runs.items():
        s = r.summary
        w.writerow(["# summary", k, s.outcome, s.load_interrupted_kw, s.load_restored_kw, s.load_restored_pct, s.min_critical_pressure_m, s.minutes_below_service_pressure, s.tank_min_pct, s.constraint_violations, s.switch_ops, s.candidates_evaluated, s.candidates_rejected])
    w.writerow(["strategy"] + [c for c, _ in SERIES_COLUMNS] + [f"tank{t}Pct" for t in tank_ids])
    for k, r in runs.items():
        for f in r.frames:
            w.writerow([k] + [get(f) for _, get in SERIES_COLUMNS] + list(f.water.tank_pct))
    return Response(content=buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="encirra-{scenario_id}.csv"'})

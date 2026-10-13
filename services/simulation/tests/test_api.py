"""API smoke tests (FastAPI TestClient)."""

from __future__ import annotations

import warnings

import pytest

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    from fastapi.testclient import TestClient

from encirra_sim.api import app


@pytest.fixture(scope="module")
def client(feeder_fault_runs):  # reuse the session's computed runtime
    return TestClient(app)


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and set(body) == {"ok", "engineVersion", "pandapower", "wntr", "cachedRuns"}


def test_topology(client, district):
    r = client.get("/api/topology")
    assert r.status_code == 200
    t = r.json()
    assert t["schemaVersion"] == 1
    assert len(t["electrical"]["buses"]) == 33 and len(t["electrical"]["lines"]) == 37
    assert t["electrical"]["lines"][36]["from"] == 24 and t["electrical"]["lines"][36]["to"] == 28  # tie B25–B29, 0-based
    assert t["water"]["pumps"][1]["bus"] == 32  # PU-2 on B33


def test_scenarios(client):
    r = client.get("/api/scenarios")
    assert r.status_code == 200
    assert [s["id"] for s in r.json()] == ["feeder-fault", "pump-power-loss", "high-demand"]


def test_run_live(client):
    r = client.post("/api/run", json={"scenarioId": "feeder-fault", "strategy": "encirra"})
    assert r.status_code == 200
    body = r.json()
    assert body["provenance"]["source"] == "live"
    assert body["plan"]["verification"]["status"] == "simulation-verified"
    assert len(body["frames"]) == 181


def test_run_validation_errors(client):
    assert client.post("/api/run", json={"scenarioId": "feeder-fault", "strategy": "bogus"}).status_code == 422
    assert client.post("/api/run", json={"scenarioId": "feeder-fault", "strategy": "none", "params": {"faultLineId": 35}}).status_code == 422


def test_compare_and_exports(client):
    r = client.get("/api/compare/feeder-fault")
    assert r.status_code == 200
    comp = r.json()
    assert set(comp["summaries"]) == {"none", "grid-only", "encirra"}
    assert comp["plans"]["none"] is None
    assert client.get("/api/compare/unknown-scenario").status_code == 404
    j = client.get("/api/export/feeder-fault.json")
    assert j.status_code == 200 and set(j.json()["series"]) == {"none", "grid-only", "encirra"}
    c = client.get("/api/export/feeder-fault.csv")
    assert c.status_code == 200 and c.headers["content-type"].startswith("text/csv")
    assert "strategy,t,clock,stage" in c.text

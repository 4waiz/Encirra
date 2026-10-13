# Encirra simulation service

Physics-driven co-simulation of the synthetic district's electrical distribution network (IEEE 33-bus
benchmark, **pandapower**) and the water network that depends on it (**WNTR / EPANET 2.2**), with
optimization-assisted recovery planning and independent re-simulation ("Simulation Verified").
Research prototype on synthetic/benchmark data — see [`docs/METHODOLOGY.md`](../../docs/METHODOLOGY.md).

## Run

All commands from the repository root (Node 24 + [uv](https://docs.astral.sh/uv/)):

| Task | Command |
| --- | --- |
| Install / sync Python deps | `npm run setup:sim` |
| API on http://127.0.0.1:8000 | `npm run dev:sim` |
| Tests | `npm run test:sim` |
| Regenerate offline replays → `apps/web/public/replay/` | `npm run sim:export` |

Or directly from `services/simulation/`:

```bash
uv run python -m uvicorn encirra_sim.api:app --port 8000
uv run python -m pytest -q
uv run python -m encirra_sim.export --out ../../apps/web/public/replay
```

`ENCIRRA_REPO_ROOT` overrides repository discovery (the service reads
`packages/shared/config/district.json` and `scenarios/*.json`).

## API

| Endpoint | Returns |
| --- | --- |
| `GET /api/health` | `HealthResponse` |
| `GET /api/topology` | `NetworkTopology` |
| `GET /api/scenarios` | `ScenarioDefinition[]` |
| `POST /api/run` | `RunRequest` → `RunResult` (`provenance.source = "live"`) |
| `GET /api/compare/{scenarioId}` | `Comparison`; optional weight overrides as query parameters (`servedLoad`, `criticalLoad`, `waterDelivered`, `criticalWater`, `pressureStorage`, `switchingCost`) |
| `GET /api/export/{scenarioId}.json` / `.csv` | comparison summary + per-frame time series for all three strategies |

Wire format: `packages/shared/src/contract.ts` (camelCase JSON). The Pydantic models in
`encirra_sim/models.py` mirror it; `tests/test_contract_parity.py` parses `contract.ts` and fails on any
key mismatch.

**Latency.** A cold run evaluates every recovery candidate with the coupled simulation (≈ 15–25 s for
the feeder scenarios, ≈ 5 s for the pump scenario on a laptop). Results are cached in memory and in
`services/simulation/.cache/` (keyed by request hash, engine version and a fingerprint of the engine
source, district and scenario files); repeated requests return immediately. The web app uses the
precomputed replays by default.

## Modules

| Module | Role |
| --- | --- |
| `config.py` | repository discovery, `district.json` / scenario loading, constants, default objective weights |
| `models.py` | Pydantic v2 mirror of the contract |
| `profiles.py` | synthetic time-of-day electrical and water demand profiles |
| `topology.py` | NetworkX energisation, radiality, protection device, fault isolation |
| `electrical.py` | pandapower model (case33bw + explicit line switches, ratings, pump motor loads), AC power flow |
| `water.py` | WNTR model, EPANET extended-period simulation, pump power P = ρgQH/η |
| `coupling.py` | Gauss–Seidel power ⇄ water fixed point over a switching timeline |
| `recovery.py` | candidate generation, coupled evaluation, hard checks, objectives, ranking |
| `screening.py` | OR-Tools CP-SAT shed-set proposal and lossless LinDistFlow screening |
| `verification.py` | independent rebuild + per-minute re-solve of the selected plan |
| `engine.py` | run orchestration, frames, events, timeline, summary, caching |
| `network_info.py` | static `NetworkTopology` |
| `api.py`, `export.py` | FastAPI service and replay exporter |

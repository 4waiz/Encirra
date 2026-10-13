# Encirra

**Coupled Power + Water Resilience Twin** — *See more. Recover faster. Safer cities for tomorrow.*

Encirra is an optimization-assisted, physics-driven digital twin that models cascading failures between an urban
electrical distribution network and the water infrastructure that depends on it, then evaluates and independently
verifies safer recovery strategies.

> **Research Prototype — Synthetic/Benchmark Infrastructure Data.** The electrical model is the published IEEE 33-bus
> distribution benchmark (Baran & Wu, 1989); the water network is a student-created synthetic network. The district is
> Dubai-*inspired* only: no utility data is used and no real substation, pumping station or customer is represented.

Built for the IEEE NEECON 2026 Undergraduate Innovation Challenge.

## Status

Under active development. Full setup, architecture, methodology and demo instructions will be documented here.

## Repository layout

```
apps/web/              React + TypeScript + Vite + React Three Fiber front end
services/simulation/   Python simulation service (pandapower, WNTR, NetworkX, OR-Tools, FastAPI)
packages/shared/       Typed API contract, district configuration and layout generator
assets/blender/        Blender Python build scripts and editable .blend sources
assets/models/         Exported GLB assets served to the web app
scenarios/             Scenario definitions
tests/                 End-to-end browser tests
scripts/               Development and build helpers
docs/                  Architecture, methodology and demo documentation
```

---

[Built by Team Kanban](https://kanbanstudios.ae/team-kanban)

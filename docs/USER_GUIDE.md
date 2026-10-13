# Encirra — User Guide

Encirra is a research prototype: a physics-driven, optimization-assisted digital twin of a
**Dubai-inspired synthetic district** in which an urban electrical distribution network (the IEEE
33-bus benchmark, solved with pandapower) powers the pumps of a water network (solved with WNTR).
It shows how an electrical fault cascades into the water system, compares recovery strategies and
independently verifies the selected plan.

> **Research Prototype — Synthetic/Benchmark Infrastructure Data.** No private utility data is
> available or authorized. No real substation, pumping station or customer is represented.

---

## 1. Starting the app

```bash
npm install            # once, at the repository root
npm run dev:web        # http://127.0.0.1:5173
```

The app opens on a working example: scenario **Electrical Feeder Failure**, strategy **Encirra**,
playhead at the start of the run. Nothing needs to be configured first — press **Play**.

### Data source

The status pill under the clock (top right) always states where the numbers come from:

| Pill | Meaning |
|---|---|
| **Live solver** | The simulation service is running (`npm run dev:sim`, port 8000). Runs are computed on request; parameters and objective weights can be edited and recomputed. |
| **Replay · precomputed solver output** | No simulation service was found; the app plays the bundled replay files (`apps/web/public/replay/`), which were produced by the same solver. Nothing is recomputed in the browser. |

Replays are precomputed solver output — never real-time utility telemetry. The simulated date and
clock in the header are scenario time (marked *simulated*), and the ambient temperature pill is a
declared scenario assumption, not live weather.

---

## 2. Live Twin (main view)

The 3D district fills the screen; the dashboard sits around it.

**Top row**

1. **Feeder Fault Detected** — before the fault: *No active fault* and the current supply figures.
   After the fault: the faulted feeder section, the event clock and its impact (load interrupted,
   service connections affected, water pumps offline, critical facilities at risk).
2. **Feeder Status** — schematic of the 33-bus network on the district streets, coloured by line
   state: green = healthy/restored, red = faulted, amber = restoring (switching pending),
   grey = isolated/de-energized, dashed = open tie. The red haze marks buses without supply.
3. **System Recovery** — the recovery stage (awaiting disturbance → evaluating → plan verified →
   recovery in progress → complete). It turns green **only** when the plan passed independent
   verification and has been applied. Amber = partially restored, red = no feasible recovery,
   grey = no intervention (baseline). **Why this plan?** opens the decision evidence.
4. **Recovery Timeline** — fault detected → fault isolated → recovery evaluated → constraints
   verified → service restored, with the simulated clock of each step relative to the playhead.

**Bottom row**

- **Power Network** — total demand, served, restored and unserved load; lowest bus voltage and where
  it occurs; hard voltage violations and soft advisories; losses. The chart shows served vs demand
  over the run with *Fault* / *Restored* markers and the playhead.
- **Water Network** — delivered demand (m³/h and L/s), minimum and hospital pressure, pumps online,
  tank levels and interrupted connections. The charts show critical pressure against the 20 m
  service threshold and the level of the tank that carries the affected zone, with *Pump trip* /
  *Recovered* markers and the hydraulic delay (how long storage kept pressure up).
- **Critical Facilities** — power, water and overall status for each facility; click a row to fly
  the camera to it and open the inspector.
- **City Overview** — a 2D district map coloured by power, water or combined state. Click any
  building to focus it in 3D.

**Playback bar** (above the bottom panels): scenario selector · strategy (**None**, **Grid-only**,
**Encirra**) · reset / step back / play-pause / step forward · time scrubber with event ticks ·
speed in simulated minutes per second. Keyboard: `Space` play/pause, `←` / `→` step one frame,
`Esc` closes the inspector.

**Scene toolbar** (top right of the city): layer toggles (electrical network, water network,
underground x-ray, labels, skyline), auto-orbit, reset camera, camera focus presets, and
**Cinematic Demo**.

**Inspector**: selecting a facility, building or network element (in 3D, the tables or the City
Overview) opens a panel with its live state — supply bus and voltage, backup supply, water pressure
and delivery, pumps (flow, head, electrical input, efficiency), tanks (level and usable volume),
substation feeders and switch states.

---

## 3. Analytics

Charts for the current strategy at the playhead time: voltage profile by bus before / during /
after the event, line loading against the thermal limit, feeder loads, pump electrical input and
flow, junction pressures, tank levels, delivered vs required water, and strategy comparisons of
load served and critical pressure. Every chart has a **Table** toggle that shows the same values.

## 4. Scenarios

Three scenario cards — **Electrical Feeder Failure**, **Critical Pump Power Loss** and
**High-Demand Conditions** — each with its narrative. The parameter form lists the parameters each
scenario exposes; objective-weight sliders show the soft preferences of the Encirra planner (hard
safety constraints are never weighted).

- **Live solver:** edit parameters/weights and press **Recompute & run** — all three strategies
  are recomputed by the simulation service.
- **Replay:** the form is read-only; recomputing requires the live service.

**Run / Pause / Step / Reset** control playback; the strategy comparison table and exports are at
the bottom.

## 5. Assets

A searchable inventory of facilities, buildings, buses, lines, switches, pumps, pipes, tanks and
junctions with their current state. Select a row for details; **Show in 3D** switches to the Live
Twin, focuses the camera and opens the inspector.

## 6. Reports

- Comparison of **None vs Grid-only vs Encirra**: energy served and unserved, unserved critical
  load, water delivered, pressures, pump availability, hard-constraint violations, restoration
  decisions and computation time — as a table and as bar charts.
- The Encirra candidate list (feasible and rejected, with reasons), the protected critical
  infrastructure and what remains unserved.
- Methodology, assumptions and limitations, and acknowledgments.
- **Exports** generated in the browser from the loaded data: comparison CSV, time-series CSV
  (every frame of every strategy) and a JSON bundle with the complete run results. With the live
  service, the API's own exports are linked as well.

## 7. Cinematic Demo

A guided three-minute sequence synchronized with the run frames and camera shots:
intro → trigger the fault → the cascade → evaluate recovery → restoration → evidence. Captions
are composed from the loaded data. Pause, skip, step back, restart or exit at any time; using the
playback controls pauses the demo so you can explore, and **Resume** continues from there. The
narration is in [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md).

## 8. About

**About Encirra** (footer) summarises the method, the disclaimers and the acknowledgments.

---

### Display notes

Designed for 16:9 desktop displays (1440×900, 1600×900, 1920×1080) and verified down to
1280–1366 CSS px wide (e.g. laptops at 125–150 % scaling). URL options for presentations and
screenshots: `?page=analytics|scenarios|assets|reports`, `?frame=<index>`,
`?strategy=none|grid-only|encirra`, `?scenario=<id>`; `?view=scene` shows the 3D twin alone.

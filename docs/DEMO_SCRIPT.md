# Encirra — 3-minute demo script

**Launch:** Live Twin → scene toolbar → **Cinematic Demo** (top right of the city). The sequence
drives the camera, the playhead and the strategy selector by itself; captions on screen are
composed from the loaded run data. Pause, skip (⏭), step back (⏮), restart or exit at any time.
Touching the playback controls pauses the demo for manual exploration — **Resume** continues
from where you left the playhead.

**Data:** the default scenario *Electrical Feeder Failure* from the bundled replay (precomputed
solver output: pandapower AC power flow + EPANET 2.2 via WNTR, engine 1.0.0). The figures quoted
below are from that replay; if the replay is regenerated or the scenario is recomputed with the
live solver, read the numbers from the screen — the captions update automatically.

> Say once, early: *“Everything you see is a synthetic district on the IEEE 33-bus benchmark —
> research prototype data, not a real utility. The replay is recorded solver output, not live
> telemetry.”*

---

## 0:00 – 0:30 · A living district

**On screen:** aerial establishing shot → the home composition. Power (amber) and water (cyan)
layers on. The playhead runs through normal operation, 16:30 → 16:59 (simulated). The City
Overview briefly switches to its Water view and back.

**Talk track:**
> “This is Encirra — a coupled power and water resilience twin of a Dubai-inspired synthetic
> district. The IEEE 33-bus feeder, solved with pandapower, serves about 3,256 kW, including
> roughly 43 kW of pumping. Two pumping stations keep the WNTR water network pressurised; the
> elevated tanks T1 and T2 float on each pressure zone. Every number on these cards comes from
> the simulation.”

**Point at:** Feeder Fault card — *No active fault*; Power and Water panels; Critical Facilities
all *Safe*.

## 0:30 – 1:00 · Trigger the fault

**On screen:** camera to the west district, then the substation. The playhead reaches **17:00**:
the Feeder Fault card turns red; the Feeder Status map shows the faulted section and the red
haze over the de-energised lateral; by **17:02** the faulted section is isolated.

**Talk track:**
> “At 17:00 a permanent fault hits Feeder F3, line B27–B28. The recloser trips the whole lateral:
> 829 kW and 186 service connections lose supply — including Pumping Station PS-2, the only pump
> of the West pressure zone. City Hospital rides through on its 150 kW genset, but the genset does
> not power water. Three critical facilities are now at risk. At 17:02 the faulted section is
> isolated and the healthy upstream part, about 106 kW, comes back.”

**Point at:** Fault card metrics; Recovery Timeline (fault detected ✓, isolation in progress);
Critical Facilities (hospital *On backup*, PS-2 *Offline / No flow*).

## 1:00 – 1:30 · The cascade

**On screen:** underground x-ray of the West water main and PS-2, then Tank T2. The strategy
switches to **None** (baseline replay) and the playhead runs to about **18:15**.

**Talk track:**
> “This is the part a power-only view misses. With PS-2 stopped, Tank T2 carries the West zone
> alone. In the no-intervention baseline it drops below 25 % at 17:40 and is empty at 18:12 —
> 72 minutes after the pump trip — and the hospital’s pressure collapses below the 20 m service
> threshold. That hydraulic delay is our window to act.”

**Point at:** Water chart (critical pressure vs the 20 m line, the shaded tank-buffer window and
its *72 min* label, Tank T2 level), *Hydraulic delay 1 h 12 min* chip, System Recovery card
*No intervention (baseline)*.

## 1:30 – 2:15 · Evaluate recovery

**On screen:** recovery-path shot; strategy **Grid-only** at the 17:05 verification point, then
**Encirra**; the **Why this plan?** panel opens (candidate table, score breakdown, rejected
candidates, independent verification) and closes.

**Talk track:**
> “Two planners look at the same 46 switching candidates. 36 are rejected outright on hard
> limits — for example closing tie SW-18-33 drives bus B29 to 0.775 pu, and closing SW-25-29
> alone overloads the tie to 130 %. A grid-only planner maximises restored electricity and picks
> *Close SW-25-29 · open SW-31-32*: it restores more feeders but leaves PS-2 and the hospital
> without grid supply. Encirra scores the coupled objective — served and critical load, water
> delivered, critical water service, storage — and picks *Close SW-25-29 · shed B30*: it sheds the
> district cooling plant, a large non-critical load, to free voltage headroom and bring PS-2 back.
> Before acting, the plan is re-solved independently — 8 of 8 hard checks pass: Simulation
> Verified. Soft preferences are weighted; hard safety limits never are.”

**Point at:** Why-this-plan: selected plan and actions, score breakdown vs the runner-up,
rejected candidates with their failed checks, verification table, assumptions.

## 2:15 – 2:45 · Restoration

**On screen:** recovery-path shot, then the hospital. The playhead plays through **17:10**:
lines turn amber (restoring) then green (restored); the timeline completes.

**Talk track:**
> “At 17:10 the switching sequence executes: B30 is shed, PU-2 restarts and 500 kW comes back
> through the tie from Feeder F4. Pump availability returns to 2 of 2, Tank T2 starts refilling
> and the hospital keeps about 38 m of pressure for the rest of the evening. The outcome is
> honest: *Partially restored* — the cooling plant stays off by design — with the plan marked
> Verified.”

**Point at:** System Recovery card (load restored and % of interrupted demand, 3 / 3 critical
facilities recovered, 2 / 2 pumps), Feeder Status map, City Overview.

## 2:45 – 3:00 · Evidence

**On screen:** home shot; playhead to 19:30 (end of horizon); City Overview *Combined*.

**Talk track:**
> “Over the three-hour horizon: unserved energy 705 kWh with Encirra, 906 kWh grid-only and
> 2,236 kWh with no intervention; minutes below service pressure at critical facilities: 0 versus
> 79 for both alternatives; water delivered 100 % versus 78 %; zero hard-constraint violations.
> The full comparison, candidate list, methodology and limitations are in Reports, with CSV and
> JSON exports.”

**Optional close (if time allows):** open **Reports** to show the comparison table and the
*Research Prototype — Synthetic/Benchmark Infrastructure Data* banner.

---

### Presenter notes

- **Manual mode:** after the demo, the playback bar, strategy selector and the Scenarios page let
  you repeat any part. Keyboard: `Space` play/pause, `←` / `→` step.
- **Other scenarios** (scenario selector): *Critical Pump Power Loss* — no switching plan can
  re-energise PS-2 inside the isolated section, so the evidence is about how long Tank T2 holds;
  *High-Demand Conditions* — tighter limits reject more candidates (52 evaluated, 43 rejected).
- **Live solver:** with `npm run dev:sim` running, the header pill reads *Live solver* and the
  Scenarios page can recompute with edited parameters and objective weights.
- **Wording:** Encirra is physics-driven and optimization-assisted. Say “Simulation Verified”
  (verified in an independent re-simulation of the synthetic model), never “certified”.

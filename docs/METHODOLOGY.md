# Encirra — simulation methodology

> **Research prototype — synthetic/benchmark infrastructure data.** The electrical network is the
> published IEEE 33-bus distribution test feeder (Baran & Wu, 1989); the water network, facility
> placement, ratings, pump curves and demand profiles are synthetic. No utility data is used.
> "Simulation Verified" means that a plan passed every hard check in an independent re-simulation of
> this synthetic model — it is not a field certification.

Encirra is a **physics-driven, optimization-assisted** digital twin. Every number in a run — every
voltage, flow, pressure, tank level and pump power in every frame — comes from an AC power flow
(pandapower) or an extended-period hydraulic simulation (EPANET 2.2 via WNTR). Recovery plans are
chosen by an explicit, documented objective over an exhaustively evaluated candidate set; there is no
machine-learned or generative component anywhere in the decision path.

---

## 1. Pipeline

```
district.json + scenario ─► protection & isolation (topology) ─► candidate generation
       │                                                              │
       │                     ┌────────────────────────────────────────┘
       ▼                     ▼
 time base & profiles ─► coupled co-simulation (per candidate) ─► hard checks ─► objectives
                                                                                  │
                     independent verification (separate code path) ◄─ selected plan
                                       │
                                       ▼
          final coupled run of the chosen switching timeline ─► frames, events, timeline, summary
```

Strategies compared on identical physics:

| Strategy | Meaning |
| --- | --- |
| `none` | Protection operates and the lateral recloser stays open: no isolation, no restoration. The outage persists for the horizon. |
| `grid-only` | Conventional fault location, isolation and service restoration (FLISR): maximise restored electrical energy within the hard limits. Facilities running on backup generation count as served; pumps are ordinary loads; water is ignored; customers who still have supply are never interrupted. |
| `encirra` | Cross-domain objective (weights in §6.3) evaluated on the coupled power + water simulation over the remaining horizon. |

## 2. Time base

* Start 16:30 on 2026-04-28, simulated local time (UTC+4); horizon 180 min (to 19:30); frames every
  1 min (181 frames). Hydraulic step 60 s.
* Defaults: fault 17:00, isolation +2 min (17:02), impact evaluated 17:03, candidates generated 17:04,
  verification complete 17:05, switching complete +5 min (17:10). No permanent repair within the
  horizon unless `repairTimeMin` is set (then the normal configuration returns at that time).
* Deterministic: no random sampling is used anywhere; ordering is stable; the same request produces
  byte-identical results apart from the wall-clock fields (`computedAt`, `computeMs`, `planComputeMs`).
  The scenario `seed` is carried in the provenance for reproducibility bookkeeping.

## 3. Electrical model

* `pandapower.networks.case33bw()`: 33 buses, 12.66 kV, 32 feeder sections + 5 tie lines
  (32–36), Baran & Wu impedances and loads. Benchmark sanity (unmodified network): Vmin = 0.9131 pu at
  B18, losses 202.7 kW — reproduced by `tests/test_benchmark_and_units.py`, both for the raw benchmark
  and for the switched district model at load factor 1.0.
* **Switches.** Every line carries a load-break switch (`pp.create_switch(et="l")`); ties are in
  service but normally open. The **branch-switch abstraction** of the reconfiguration literature is
  used: opening a line's switch takes that line section out of service. Remote-operable switches
  (district.json `remote`) may be used by the planner; F1 trunk and F2/F4 sectionalizers are manual.
* **Ratings** (synthetic, district.json): feeder sections 200–400 A; tie lines 46 A (≈ 1.0 MVA
  emergency transfer capacity at 12.66 kV, see §10).
* **Loads.** Constant-power benchmark loads × `loadMultiplier` × time-of-day profile. Shed buses
  have their load switched off.
* **Pump motors** are separate loads at their supply buses (PU-1 on B14, PU-2 on B33): P from the
  hydraulic solution, Q at power factor 0.85.
* **Power flow.** AC Newton–Raphson (`pp.runpp`, flat start). Buses not connected to the slack are
  de-energised (connectivity check); lines with an open switch or a de-energised end carry no flow.
* **Limits.** Hard: 0.90 ≤ V ≤ 1.05 pu at every energised bus, line loading ≤ 100 % of rating, radial
  operation. Soft (advisory only): V ≥ 0.95 pu. The 33-bus benchmark is a heavily loaded feeder, so
  17 buses sit below 0.95 pu even in normal operation; the advisory is reported, never used to reject.

### Time-of-day electrical profile (declared assumption)

Benchmark nominal load is interpreted as the district's Dubai-summer **evening peak**, reached at
~19:00 (cooling plus residential return). Piecewise-linear multiplier, sampled per minute:

| Clock | 15:00 | 16:00 | 17:00 | 18:00 | 19:00 | 20:00 | 21:00 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Multiplier | 0.84 | 0.85 | 0.88 | 0.94 | 1.00 | 0.99 | 0.95 |

## 4. Hydraulic model

* WNTR network built from district.json, solved with `wntr.sim.EpanetSimulator` (EPANET 2.2).
  Hazen–Williams head loss; **pressure-driven demand**: full demand at ≥ 20 m, none at ≤ 0 m,
  exponent 0.5. Service threshold for status and events: 20 m.
* Two pressure zones (West: PS-2 + Tank T2 + hospital; East: PS-1 + Tank T1 + EOC) separated by the
  normally closed boundary valves BV-1…BV-4. R1 (desalination ground storage, powered outside the
  district) is a fixed-head reservoir (14 m).
* Tanks: T1 13 m Ø, levels 1–9 m above a 46 m base; T2 8 m Ø, levels 1–7 m above a 44 m base;
  initial level = `tankInitPct` of the usable range (default 50 %).
* **Pump curves**: three-point head curve through the design point (shut-off 4/3·H_d, run-out
  2·Q_d). Design points (district.json, see §10): PU-1 46 L/s at 38 m, PU-2 40 L/s at 36 m,
  efficiency 0.74 (pump-set, wire-to-water); motor ratings 30 kW and 22 kW.
* **Electrical availability** of each pump is imposed with a per-minute speed pattern (1 = may run,
  0 = shut off), which EPANET treats as the pump being off.
* **Pump power**: P = ρ·g·Q·H/η with ρ = 1000 kg/m³, g = 9.81 m/s², Q in m³/s, H the head gain
  across the running pump; W → kW.
* **Diurnal water profile** (multiplier on base demand = daily average; Dubai summer evening):

| Clock | 16:00 | 17:00 | 18:00 | 19:00 | 20:00 | 21:00 |
| --- | --- | --- | --- | --- | --- | --- |
| Multiplier | 1.00 | 1.06 | 1.16 | 1.24 | 1.26 | 1.20 |

* Reporting conventions: when a zone drains completely it becomes hydraulically disconnected and
  EPANET reports small negative gauge pressures (≈ −1 m) at the higher nodes; frames report these as
  0 m (no supply). Pump head is reported only while a pump runs.
* **Normal operation (16:30):** demand-node pressures 36.9–41 m; PU-1 47.7 L/s at 37.1 m (23.4 kW),
  PU-2 43.0 L/s at 34.1 m (19.5 kW); each zone roughly balanced — tank levels stay within 47–61 % of
  their usable range over the horizon without a fault.

## 5. Co-simulation (coupling)

Block Gauss–Seidel fixed point over the whole horizon for a given switching timeline
(`encirra_sim/coupling.py`):

1. Bus energisation per frame from the switch states (NetworkX; the faulted line is out of service
   while the fault is present).
2. Pump availability: a pump may run only if its supply bus is energised **and** the bus voltage with
   the pump running is ≥ 0.90 pu (undervoltage trip). A trip latches until the next switching event
   (a motor restart needs a new switching/reset command).
3. EPANET extended-period simulation with these availabilities → pump Q, H per minute → pump
   electrical demand.
4. AC power flow every frame with bus loads (profile) plus the pump loads.
5. Pump-bus voltages are re-checked; any new undervoltage trip updates the availability schedule and
   steps 3–5 repeat. The fixed point is reached when the schedule no longer changes — the pump powers
   in the last power flow are then exactly those of the last hydraulic solution. At most 4 iterations;
   the iteration count and convergence flag are written to `provenance.coupling`.

Flows, pressures and tank levels in every frame therefore always come from the recalculated hydraulic
simulation, and voltages from power flows that include the corresponding pump loads.
`tests/test_coupling.py` checks that a pump stops when its bus is de-energised, the West tank drains
and hospital pressure later drops, pump kW enters the power flow and lowers the bus voltage, and an
undervoltage trip is iterated to a fixed point.

## 6. Protection, isolation and recovery planning

### 6.1 Protection and isolation

* At the fault time the first recloser/breaker upstream of the faulted line trips (F3: recloser
  SW-06-26) and the whole lateral is de-energised.
* After `isolationDelayMin` the faulted section is isolated: its own remote switch opens (branch
  switch), and the protective device recloses so the healthy upstream section returns. If the faulted
  line's switch were manual, the isolated section grows through manual switches to the nearest remote
  ones and the buses inside it stay dark until repair.
* Healthy buses left without supply form the restoration region **R**.
* The impact evaluation (17:03) projects the post-isolation state with no further switching using the
  same coupled simulation (e.g. "Tank T2 below 25 % at 17:40; City Hospital pressure below 20 m at
  18:12").

### 6.2 Candidates (`recovery.py`)

* **Topologies**: close 1–2 remote normally-open tie switches with an end in R (ties touching an
  isolated section are generated too and rejected with an explicit reason), open 0–1 remote
  sectionalizer inside R, plus "no further switching". Identical electrical states are de-duplicated.
* **Shed sets**: 0–2 non-critical loads in R are left off (exact enumeration). If every such variant of
  a topology is infeasible **and every failure is voltage-related**, *headroom* shed sets are added:
  up to two of the three energised non-critical buses outside R whose load contributes most to the
  voltage drop on the tie's supply path (LinDistFlow sensitivity Σ r·P + x·Q over the shared path).
  Headroom sets are screened with the lossless LinDistFlow model first: neglecting losses only
  over-estimates voltages, so a set that fails there must fail the AC power flow too.
* **OR-Tools CP-SAT** (`screening.py`) proposes, for a still-infeasible topology with more sheddable
  buses than the enumeration bound, the shed set that maximises restorable load under LinDistFlow
  voltage limits and an octagon approximation of the line limits; the proposal is then simulated like
  any other candidate. In the three default scenarios the exact enumeration already covers every
  option, so CP-SAT added no candidates there; it matters for larger restoration regions.
* Limits: remote switches only; ≤ 4 operations per plan (switching + shedding).
* **Dominance pruning**: for a given topology a superset of an already-feasible shed set is skipped —
  it energises the same buses and pumps and only serves less load, so it cannot score higher under
  either objective. Everything else is evaluated: this is an exhaustive constrained search, so the
  selected plan is the exact optimum of each objective over the candidate set.

Each candidate is evaluated with the coupled co-simulation of its full switching timeline (EPANET every
minute; AC power flow at the switching instant, every 15 min, at the peak-load minute and at the last
minute) and checked against the hard limits. Rejected candidates carry specific reasons, e.g.
`V(B33)=0.900 pu < 0.90 pu at 19:00`, `Line B25–B29 (SW-25-29) loaded 130% > 100% of its 46 A rating
at 19:00`, `loop formed via SW-18-33 and SW-25-29`, `PU-2 would trip on undervoltage …`,
`re-energises the faulted section …`.

### 6.3 Objectives (soft) — hard constraints are never weighted

**Encirra** — over the remaining horizon (switching time → end), from the coupled simulation:

| Weight | Default | Unit of the term |
| --- | --- | --- |
| `servedLoad` | 1.0 | MWh of electrical demand served (whole district) |
| `criticalLoad` | 2.0 | MWh served at critical buses from the grid (hospital, EOC, PS-1, PS-2 incl. pumps) |
| `waterDelivered` | 2.0 | 1,000 m³ of water demand delivered |
| `criticalWater` | 1.5 | hours of water service (≥ 20 m) at each critical facility (hospital, EOC) |
| `pressureStorage` | 0.01 | % of minimum tank level preserved (mean over tanks) |
| `switchingCost` | 0.05 | per switching / shedding operation (subtracted) |

Weights are part of every request (`RunRequest.weights`, `GET /api/compare/{id}?criticalWater=…`) and
are echoed in every result.

**Grid-only** — w_servedLoad × restored-energy value + w_criticalLoad × life-safety energy without
backup − w_switchingCost × operations, where the part of a facility's load covered by its genset
counts as already served (restoring the hospital bus is worth only its load above 150 kW) and pumps
are ordinary loads.

**Policies (not weights).**
* Grid-only never interrupts customers who still have supply (conventional FLISR); plans that shed
  energised load for headroom are not admissible for it (`scoreGridOnly = null`).
* Encirra may interrupt supplied non-critical customers only as a last resort: such a plan is
  admissible only if no feasible plan without new interruptions protects every critical facility it
  protects. Candidates that interrupt supplied customers carry the advisory check `new-interruptions`.

Ties are broken by fewer operations, then candidate id. The top-ranked plan of each strategy is
verified independently (§7); if it were rejected, the next one would be tried (up to three).

## 7. Independent verification (`verification.py`)

The verifier shares no model-building code with the planner:

* **Electrical**: a fresh pandapower network assembled element by element
  (`create_bus` / `create_line_from_parameters` / `create_switch` / `create_load`) from the raw
  district.json and the benchmark impedances; energisation and radiality from `pandapower.topology`.
* **Hydraulic**: an EPANET 2.2 input file (LPS units) written as text from district.json and loaded
  through WNTR's INP reader (`tests/test_screening_and_models.py` shows both hydraulic builders agree
  within 0.01 m).
* **Sequence**: switch states re-derived per minute by replaying protection, isolation and plan
  operations from the normal configuration; its own pump-availability fixed point.
* AC power flow and EPS are re-solved at **every frame** of the remaining horizon.

| Check | Hard | Pass condition |
| --- | --- | --- |
| `pf-convergence` | ✓ | every frame converges |
| `voltage-band` | ✓ | 0.90–1.05 pu at every energised bus, every frame |
| `voltage-soft` | – | advisory count of bus-minutes below 0.95 pu |
| `thermal` | ✓ | every line ≤ 100 % of rating |
| `connectivity` | ✓ | every bus the plan claims to serve is energised and not shed |
| `radiality` | ✓ | energised network is a tree |
| `fault-isolation` | ✓ | the faulted section is disconnected from every source |
| `pump-supply` | ✓ | claimed pumps run; no undervoltage trip of any energised pump |
| `pressure-critical` | – | critical-facility pressure ≥ 20 m over the remaining horizon |
| `tank-level` | – | no tank drained to its minimum level |
| `critical-service` | – | every critical facility has power (grid or backup) and water |
| `switching-feasible` | ✓ | remote switches only, ≤ 4 operations |

`status = "simulation-verified"` only if every hard check passes. Water-service checks are soft
because they are objectives, not safety limits; they are reported with every plan (the grid-only plan
of the feeder-fault scenario is electrically safe and verified, but fails `pressure-critical`).

## 8. Frames, facility states, events and summary

* Frames: per-bus voltage (null when de-energised), served kW, shed flags, line loading and signed
  flow (from → to), switch states, totals; per-junction pressure / delivered / required demand, pipe
  flow / velocity / status, pump state / flow / head / kW, tank level / %.
* `demandKW` includes the pump demand that would be drawn in normal operation (from a no-fault
  reference EPS) whenever a pump is stopped, so that `unservedKW` counts lost pumping.
* `unservedKW = demandKW − servedKW` per frame. It includes load the plan deliberately sheds (inside or
  outside the original outage) and the demand of pumps that cannot run.
* `restoredKW`: load served at buses whose supply was lost after the fault (dark or shed) and is back.
* Net restoration (summary `loadRestoredPct`, and the same formula per frame in the UI):
  `restoredKW / (restoredKW + unservedKW)` at the end of the horizon. `loadRestoredKW` and
  `remainingUnservedKW` are the last frame's `restoredKW` and `unservedKW`; `loadShedKW` is the load
  deliberately disconnected by the plan at the end of the horizon; `unservedEnergyKWh` integrates
  `unservedKW` (so shed load is counted as unserved energy).
* `criticalUnservedKW`: unserved demand at critical buses minus what a facility genset carries.
* Facility power: `external` (not on the modelled feeder), `online`, `restored` (energised again after
  an interruption), `backup` (dark or shed but genset fitted), `offline`. Water: `n/a`, `normal`
  (≥ 20 m), `low-pressure` (0.5–20 m), `no-flow`, `restored`; pump stations follow their pumps; tanks
  are `low-pressure` below 25 % and `no-flow` when empty. Status: `affected` (service lost), `at-risk`
  (on backup power, zone running on storage, tank below 25 %), `restored`, `safe`.
* Events are generated from the results, not scripted: fault, protection, backup transfer, pump
  stop/restart (with the trip voltage when relevant), isolation, impact projection, candidate
  statistics, verification, switching, restoration, tank below 25 % / empty / recovering, critical
  pressure below / back above 20 m, repair, end of horizon.
* Timeline: `fault-detected`, `fault-isolated`, `recovery-evaluated`, `constraints-verified`,
  `service-restored` with outcomes `done | failed | skipped | partial`. A recovery is `complete` only if
  every healthy bus is served, nothing is shed and every verification check (hard and soft) passes;
  otherwise `partial`.
* `hydraulicDelayMin`: first pump stop after the fault → first critical-facility pressure below 20 m.
  `constraintViolations`: count of (bus, frame) and (line, frame) hard-limit violations.

## 9. Results (default scenarios, `npm run sim:export`)

Interrupted kW is the load lost when protection operated (17:00). Restored and shed kW are taken at
19:30; net restoration is restored ÷ (restored + unserved) at 19:30, where unserved includes plan-shed
load and stopped pumps. "Critical-facility min pressure" is the minimum over the horizon at
J-HOSP/J-EOC; "Minutes below 20 m" counts minutes in which a critical facility is below the service
threshold. Planning time is the wall-clock time of candidate generation, coupled evaluation and
independent verification (laptop, single process), shared by the two planning strategies of a
scenario.

| Scenario | Strategy | Plan | Interrupted kW (17:00) | Restored kW (19:30) | Shed kW (19:30) | Net restoration | PS-2 at 19:30 | Critical-facility min pressure | Minutes below 20 m | Hard violations | Candidates eval. / rej. | Planning time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| feeder-fault | none | — (recloser stays open) | 829 | 0 | 0 | 0.0 % | off | 0.0 m | 79 | 0 | 0 / 0 | — |
| feeder-fault | grid-only | C21: Close SW-25-29 · open SW-31-32 | 829 | 647 | 0 | 69.2 % | off | 0.0 m | 79 | 0 | 80 / 59 | 18.3 s |
| feeder-fault | encirra | C16: Close SW-25-29 · shed B30 | 829 | 736 | 199 | 78.7 % | running | 37.8 m | 0 | 0 | 80 / 59 | 18.1 s |
| pump-power-loss | none | — (recloser stays open) | 909 | 0 | 0 | 0.0 % | off | 0.0 m | 79 | 0 | 0 / 0 | — |
| pump-power-loss | grid-only | C01: No further switching (keep post-isolation configuration) | 909 | 941 | 0 | 91.7 % | off | 0.0 m | 79 | 0 | 5 / 2 | 2.5 s |
| pump-power-loss | encirra | C04: Close SW-18-33 · shed B18 | 909 | 1026 | 98 | 91.2 % | running | 37.8 m | 0 | 0 | 5 / 2 | 2.7 s |
| high-demand | none | — (recloser stays open) | 1031 | 0 | 0 | 0.0 % | off | 0.0 m | 91 | 0 | 0 / 0 | — |
| high-demand | grid-only | C16: Close SW-25-29 · shed B30 | 1031 | 915 | 249 | 78.6 % | running | 37.1 m | 0 | 0 | 83 / 70 | 19.8 s |
| high-demand | encirra | C16: Close SW-25-29 · shed B30 | 1031 | 915 | 249 | 78.6 % | running | 37.1 m | 0 | 0 | 83 / 70 | 18.0 s |

Reading the results:

* **feeder-fault** — both planners restore load, but they disagree on *which* load. Grid-only restores
  B28–B31 including the 200 kW cooling plant: in its accounting the hospital's 150 kW is already served
  by the genset and PS-2 is an ordinary ~80 kW load. PS-2 therefore stays dark; Tank T2 empties at 18:12
  and hospital pressure is below 20 m for the last 79 minutes. Encirra leaves DC-1 off (with it the
  ~1 MVA tie would be overloaded) and restores the hospital bus and PS-2: hospital pressure never drops
  below 37.8 m and T2 never falls below 47 %. Net restoration is 78.7 % against 69.2 %.
* **pump-power-loss** — after isolation only PS-2's bus is dark. Back-feeding it from B18 alone is
  rejected (`V(B33)=0.894 pu < 0.90 pu at 19:00`); interrupting the office cluster at B8 instead is
  rejected because PU-2 would still trip on undervoltage at 18:55 (0.899 pu). Grid-only keeps the
  post-isolation state — it does not interrupt supplied customers to restore one pump — and the hospital
  loses water at 18:12. Encirra sheds B18 (88 kW at 17:10, 98 kW at 19:30; 36 connections — the most
  voltage-relevant non-critical load on the tie path) to free voltage headroom, and the West zone keeps
  its pump. Net electrical restoration is practically equal (91.2 % vs 91.7 %): Encirra trades a
  residential block's supply for the hospital's water service, and the trade is reported, not hidden.
* **high-demand** — the strategies converge (see §10): at 125 % load the tie cannot carry DC-1, and
  with DC-1 off the remaining capacity restores the hospital and PS-2 under both objectives. Restoration
  ends partial (78.6 %) for both; without intervention the hospital loses water after 60 minutes.
* No plan selected by either strategy violates a hard limit in any frame (verified per minute).

## 10. Scenario design

The district geometry, facility placement and bus loads are unchanged. Two groups of synthetic
parameters in `packages/shared/config/district.json` were tuned and are documented here.

1. **Pump design points** (PU-1 62 → 46 L/s, 46 → 38 m, 45 → 30 kW; PU-2 50 → 40 L/s, 46 → 36 m,
   37 → 22 kW). With the original points each pump delivered 65–76 L/s against zone demands of
   35–48 L/s: the tanks filled in about an hour, the inlets closed and service pressures rose to
   ~55 m. The new design points put each pump's operating point at its zone's evening demand, so
   normal operation is balanced (pressures 37–41 m, tanks within 47–61 %, pumps 19–24 kW).
2. **Tie-line ratings** (200 A → 46 A, ≈ 1.0 MVA). With 200 A ties the strong 25–29 tie can
   back-feed the whole west district and every strategy restores everything — no decision exists. A
   ≈ 1 MVA emergency transfer limit (typical of a lightly rated normally-open tie) makes restoration
   capacity scarce: the cooling plant DC-1 (200 kW / 600 kVAr) competes with the hospital and PS-2.
   The rating applies to all five ties; tie 18–33 is voltage-limited (it lands on B18, the weakest
   point of F1) long before it is thermally limited.

Scenario parameters:

* **feeder-fault** — fault on line B27–B28 (F3), base load. The tie can carry B28–B31 including DC-1
  (grid-only optimum) or B28, B29, B31–B33 with DC-1 off (Encirra optimum), not both.
* **pump-power-loss** — fault on PS-2's supply cable (B32–B33) on a hot evening (`loadMultiplier`
  1.10). PS-2 can only be re-supplied through tie 18–33 from B18, the weakest point of F1, so restoring
  it needs voltage headroom — interrupting supplied customers on the F1 tail. **Sensitivity (reported
  honestly):** at base load (1.00) the back-feed is feasible on its own (V(B33) = 0.902 pu, a margin of
  0.002 pu) and both strategies restore PS-2 identically; at 1.05 it fails by only 0.0003 pu; at 1.10 it
  fails clearly (0.894 pu) while the B18-shed plan keeps 0.903 pu. The 10 % hotter evening is a declared
  scenario assumption chosen so that the decision does not rest on a sub-millivolt margin.
* **high-demand** — electrical ×1.25, water ×1.15, same fault as feeder-fault. Under stress the tie
  cannot carry DC-1 at all; once DC-1 is off, the remaining capacity restores the hospital and PS-2,
  which is also the maximum-energy choice — **both strategies converge** on the same plan and both end
  partially restored (DC-1 off). Tank T2 drains faster: without PS-2 the hospital would lose pressure
  after 60 min instead of 72.

**Planner sensitivity** (screening level: same candidate generation, coupled evaluation and
objectives; tie rating varied for all five ties):

| Case | Grid-only optimum | Encirra optimum |
| --- | --- | --- |
| feeder-fault, ties 42 A or 44 A | close SW-25-29 · shed B30 (PS-2 on) | close SW-25-29 · shed B30 (PS-2 on) |
| feeder-fault, ties 46 A (**default**) | close SW-25-29 · open SW-31-32 (PS-2 dark) | close SW-25-29 · shed B30 (PS-2 on) |
| feeder-fault, ties 50 A | close SW-25-29 · open SW-31-32 (PS-2 dark) | close SW-18-33 · close SW-25-29 · open SW-32-33 · shed B29 (PS-2 on) |
| feeder-fault, ties 55 A | close SW-18-33 · close SW-25-29 · open SW-32-33 · shed B28 (PS-2 on) | same |
| feeder-fault, ties 58 A | close SW-18-33 · close SW-25-29 · open SW-32-33 (all restored) | same |
| feeder-fault, ties 62 A | close SW-25-29 (all restored) | same |
| feeder-fault, load ×0.95 | close SW-25-29 · open SW-31-32 (PS-2 dark) | close SW-18-33 · close SW-25-29 · open SW-32-33 · shed B31 (PS-2 on) |
| feeder-fault, load ×1.05 | close SW-25-29 · shed B30 (PS-2 on) | same |
| pump-power-loss, load ×1.00 | close SW-18-33 (PS-2 on) | same |
| pump-power-loss, load ×1.05 / ×1.10 (**default**) | no further switching (PS-2 dark) | close SW-18-33 · shed B18 (PS-2 on) |
| high-demand, load ×1.10 / ×1.25 (**default**) | close SW-25-29 · shed B30 (PS-2 on) | same |

The strategies diverge only when restoration capacity is scarce but not exhausted: with very weak ties
both must shed DC-1, with strong ties everything is restored, and in between the grid-only accounting
(genset load counted as served, pumps as ordinary load, no new interruptions) leaves the PS-2 section
dark while the coupled objective restores it. The default scenarios sit inside that window by
construction of the synthetic ratings; this is a scenario-design choice, documented here, not a
property of real networks.

## 11. Assumptions and limitations

* Synthetic district: impedances and loads are the IEEE 33-bus benchmark; ratings, pump curves, tank
  sizes, water demands and profiles are declared assumptions, not measured data.
* Balanced single-phase-equivalent AC power flow; constant-power loads; no protection coordination
  study, transient stability, motor-starting transients or cold-load pickup.
* Gensets carry essential electrical load only (they do not power pumping stations); genset fuel is
  not depleted within the horizon (8–12 h autonomy).
* Undervoltage pump trip at 0.90 pu with latching; no automatic restart.
* Switching is assumed to execute successfully at the planned time; communication or switch failures
  are not modelled. No crew dispatch, mobile generation or water-side actions (e.g. opening the
  boundary valves to back-feed the West zone from the East zone) are part of a plan — the contract's
  plans are electrical switching and shedding only.
* Candidate screening evaluates the power flow at a subset of minutes; the selected plan is verified at
  every minute. Plans are static configurations held to the end of the horizon (no staged restoration).
* Water-service outcomes are soft objectives; critical-facility pressure is not a hard constraint.
* Results are a simulation of a synthetic model and must not be read as an assessment of any real
  utility asset.

## 12. Acknowledgments

* **pandapower** (Fraunhofer IEE & University of Kassel) — power-flow modelling and the `case33bw`
  benchmark; IEEE 33-bus test feeder: M. E. Baran and F. F. Wu, *Network reconfiguration in
  distribution systems for loss reduction and load balancing*, IEEE Trans. Power Delivery, 1989.
* **WNTR** (US EPA & Sandia National Laboratories) and **EPANET 2.2** (US EPA) — hydraulic modelling.
* **NetworkX** — graph analysis; **Google OR-Tools** (CP-SAT) — shed-set optimisation.
* **NumPy, SciPy, pandas, numba** — numerical computing.
* **FastAPI, Pydantic, Uvicorn** — service and data contract.

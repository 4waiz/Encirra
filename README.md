# ENCIRRA

**ENCIRRA | Barakah CBRN Command Center**: an integrated CBRN situational-awareness interface with an interactive 3D digital twin, synthetic camera and robot feeds, AI-assisted correlation and an incident-response workflow.

> Conceptual situational-awareness environment using synthetic local data. No connection to operational Barakah systems.
> All readings, events, images and AI observations are generated in the browser by a seeded scenario engine. The 3D campus is a fictional, generalized layout.

## Run

```bash
npm install
npm run dev            # http://localhost:5173
```

Production build:

```bash
npm run build          # type-check + Vite build → dist/
npm run preview        # http://localhost:4173
```

Requirements: Node 20+ and a WebGL2-capable browser (Chrome / Edge recommended).

### Screenshot capture

`npm run screenshots` drives the running app in the locally installed Microsoft Edge (via `playwright-core`, so no browser download is needed). It waits for the opening multi-source event to reach human validation, then writes five 1600×900 captures to `screenshots/phase-1/`:

```bash
npm run dev                                   # in one terminal
npm run screenshots                           # in another
node tools/screenshots/capture.mjs screenshots/phase-2 --suffix=-final
```

`tools/screenshots/functional-check.mjs` runs a scripted functional QA pass (navigation, command palette, scenarios, incident lifecycle, replay, picking, feeds, wind) and reports console errors.

## Using it

| | |
|---|---|
| **Overview** | KPI row (chemical, biological, radiological, nuclear readiness), AI fusion, stream health, field assets, 3D twin, four live scene cameras, telemetry lanes, event stream, response KPIs |
| **3D Twin** | Immersive twin with layers, incident status, environment, an inspector for sensors, assets and zones, and a replay timeline |
| **Live Feeds** | Main feed with Visible / Thermal / Fusion modes, drag-to-pan PTZ, zoom, detections, snapshot and playback |
| **AI Insights** | Observations, cross-source correlation, confidence timeline, evidence, recommended review, source integrity |
| **Incidents** | Incident timeline, acknowledge / assign / focus / severity / resolve / replay, checklist, dispatch, response KPIs |

- **Ctrl/⌘ + K**: command palette (navigate, focus UGV-01/UAV-01, trigger or reset scenarios, toggle layers, inspect sensors)
- **Alt + 1–5**: switch screen · **Esc**: clear selection / leave fullscreen
- **Settings → Scenario control**: preset, severity, location, wind direction and speed, duration. **Settings → About ENCIRRA** holds the disclosure.
- In the twin: drag to orbit, right-drag to pan, scroll to zoom, click to select, double-click to fly to an object.

## Architecture

```
src/
  simulation/   seeded scenario engine (engine.ts), scenario scripts, effects (dose field, plume,
                aerosol), sensors, weather, asset kinematics, bounded 30-min history buffers
  store/        zustand: sim snapshot (≈1 Hz) and UI state (persisted preferences)
  three/        R3F scene: one shared full-window canvas rendering the main twin and every camera
                feed into DOM "holes" (scissor viewports); terrain, ocean, facility, assets,
                overlays, thermal material system, post shaders, picking, camera rig
  components/   design-system primitives, panels, charts, twin overlays/HUD, feeds, command palette,
                settings, boot screen
  features/     the five screens
  data/         site-layout.json, a single source of truth shared with the Blender build script
tools/
  blender/      build_facility.py (procedural campus → GLB modules), render_preview.py
  screenshots/  capture.mjs, functional-check.mjs, scenario-check.mjs, perf-probe.mjs
public/models/  10 GLB modules generated in Blender (units are GPU-instanced in the app)
```

**One system, not widgets.** A scenario injects analytic *effects* (gamma field, Gaussian plume, aerosol cloud, thermal hotspot, telemetry dropout). The same field functions drive sensor readings in the engine and the GPU overlays in the twin. Scripts then raise events, AI observations and incidents, and task the UGV/UAV. Vehicle motion is analytic and append-only, so any moment in the last 30 minutes can be replayed.

**Rendering.** A single WebGL context draws the main view (HDR, MSAA, ACES) and up to five feeds per frame. Feeds render at a throttled rate into their own targets. Thermal feeds swap every mesh to a heat material (per-material heat + sun loading + world-space hotspots) and apply an ironbow LUT with detail enhancement, noise and scanlines. Detection boxes are projected from scene objects. A dynamic-resolution governor keeps interaction fluid on integrated GPUs.

### Regenerating the 3D assets

```bash
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --factory-startup --python tools/blender/build_facility.py
```

The script reads `src/data/site-layout.json` and writes the GLBs to `public/models/` and a source scene to `assets-src/encirra-facility.blend`.

---

Encirra for Barakah • Built by [Awaiz Ahmed](https://kanbanstudios.ae/team-kanban)

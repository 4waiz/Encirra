# ENCIRRA — Phase 2 QA notes

Scope: the five Phase 1 captures (`screenshots/phase-1/01–05`, 1600×900, production build in Edge), plus scripted
functional and performance passes. Owner feedback is merged in: **"make it so I can move around using WASD"**.

Status legend: **Fixed** · **Mitigated** (improved, residual documented) · **Accepted** (documented limitation)

## CRITICAL

| # | Finding | Where | Fix | Status |
|---|---------|-------|-----|--------|
| C1 | No keyboard navigation — owner asked to move around with WASD | Twin, Live Feeds | W/A/S/D ground-relative movement, Q/E height, Shift ×3, speed scales with zoom; in Live Feeds the same keys move a *virtual view* of CAM-01/CAM-02 (labelled, with "Return to mount"); keys ignored in inputs, sliders, menus and dialogs | Fixed |
| C2 | The opening story is hard to see on the Overview: from the home camera the heat field, UGV route and beacon at Unit 3 are a few pixels, so "the heat field appears / UGV is dispatched" does not land | 01-overview | Auto-frame new incidents: when an incident opens and the operator hasn't touched the camera for 20 s, the twin flies to a framing of the incident (setting, default on); home view tightened | Fixed |

## HIGH

| # | Finding | Where | Fix | Status |
|---|---------|-------|-----|--------|
| H1 | Wind-field arrows are white on white roofs — the weather layer is nearly invisible | 02-digital-twin | Darker cyan chevrons with normal blending, larger, and a ground-shadow pass so they read on sand, roofs and sea | Fixed |
| H2 | Visible CCTV/UAV feeds look washed out (milky, low contrast) | 01, 03 thumbnails | Lower feed exposure, S-curve contrast, slight saturation, vignette tuned | Fixed |
| H3 | Count KPIs ("Under review", "Samples to lab") use sparklines that are flat lines — read as meaningless rules | 01 KPI row | Replaced with 3-minute bucketed micro-bars (shows *when* reviews happened) | Fixed |
| H4 | Telemetry lane threshold label clips at the lane top ("review 0.8") | 01 telemetry | Label flips below the line near the top edge | Fixed |
| H5 | The selected sensor cannot be identified in the twin (RAD-S17 is "one of the orange badges"); flagged sensors carry no ID | 02 | Selected and flagged sensors always show an ID tag; the selected marker gets a cyan ring separated by a dark gap | Fixed |
| H6 | GPU memory: feed render targets of views that unmount (screen changes) are never released | RenderLoop | Targets of unregistered views are disposed every second | Fixed |
| H7 | 3D payload is 6.7 MB of uncompressed GLB | public/models | Draco-compressed export from Blender (6.7 MB → 0.68 MB) + locally served WebAssembly decoder (no CDN) | Fixed |
| H8 | Cold load floods the console with `GL_INVALID_OPERATION: Mismatch between texture format and sampler type` (found by the new warning capture in the functional script) — on a cold load the sun and models resolve after the 4-frame shadow warm-up, so for up to 20 frames standard materials sample three's placeholder depth texture (bound without a compare mode by the `sampler2DShadow` array path) and those draws are dropped | all | Render loop finds the sun when the scene graph resolves, restarts the warm-up, and forces a shadow pass whenever a shadow-casting light has no map yet; 0 GL errors across repeated cold loads (was 257) | Fixed |
| H9 | Overview document is 24 px taller than the viewport at every size: the telemetry chart's `sr-only` table ignores the 1 px clip (table boxes don't honour `height`/`overflow`), so the root becomes scrollable and `scrollIntoView` could shift the whole layout | 01 | Clip applied to a block wrapper around the table; scroll size equals the viewport at 1366×768, 1600×900 and 1920×1080 | Fixed |

## MEDIUM

| # | Finding | Where | Fix | Status |
|---|---------|-------|-----|--------|
| M1 | "Structure 98%" boxes float over a building facade in the UGV thermal feed (the domes behind it are occluded) and clutter CAM-01 | 03 | Line-of-sight test against the layout's building volumes and unit blocks, plus per-class range limits (structures ≤ 650 m, people ≤ 220 m) | Fixed |
| M2 | Live Feeds right column has a large empty area below Detections | 03 | New "Stream" panel: resolution, frame rate, codec/GOP, bitrate, glass-to-glass latency, link (hidden on short screens) | Fixed |
| M3 | Incidents centre columns end half-way down; no way to add an operator note | 05 | Operator-note input under the timeline (Enter to add, logged as "Operator note"); "Linked sources & evidence" under the checklist (live sensor values, linked AI observation, each row opens the source) | Fixed |
| M4 | AI Insights correlation graph renders small inside its panel (fixed viewBox, letterboxed) | 04 | Graph measures its panel and lays out in pixels; adds a "line width = evidence weight" key | Fixed |
| M5 | Long sessions: incidents, observations and vehicle plan segments are unbounded | engine | Capped (incidents 60, observations 60) and plan segments pruned beyond the 30-min replay window | Fixed |
| M6 | Console shows a third-party deprecation notice (`THREE.Clock`, emitted inside React Three Fiber) | console | Narrow filter for that exact upstream notice; no other warnings | Mitigated |
| M7 | Overview home view frames the campus small (lots of sea/desert) | 01 | Home camera 10 % closer, same composition (20 % cropped the outer units in the overview panel) | Fixed |
| M8 | Sensor callout sits over the incident it describes and hides the UGV label | 01 | Callout docked top-right under the compass with a dashed leader line to the sensor, updated per frame | Fixed |
| M9 | Detection labels run off the right edge of a feed ("Hotspot 88% · 50.8" cut) | 01 UAV tile | Labels are shifted back inside the frame before the overlap test | Fixed |
| M10 | Feed caption repeats the source ("UGV-01 UGV-01 · mast camera") | 03 | Feed metadata split into label / short label; captions no longer repeat the ID | Fixed |
| M11 | Confidence timeline: "human validation threshold" label is drawn on top of the series | 04 | Label moved to the left end under the line, with a halo | Fixed |
| M12 | Evidence table wraps findings into 4–5 lines and scrolls (narrow Finding column) | 04 | Source and time merged into one column; all five evidence rows fit | Fixed |
| M13 | Thumbnail detection labels can sit on top of the timestamp row | 01 UAV tile | Labels start below the timestamp row (22 px) | Fixed |
| M14 | With CAM-01/02 selected, the taller PTZ control squeezes Detections to a header on 900 px screens | 03 | Compact single-line WASD hint; the Stream card yields to Detections below 1000 px height for fixed cameras | Fixed |

## POLISH

| # | Finding | Where | Fix | Status |
|---|---------|-------|-----|--------|
| P1 | "Checklist 33 %" in Nuclear readiness is ambiguous during an incident | 01 | Label switches to "Response checklist" while an incident is active | Fixed |
| P2 | Feed tile titles truncate ("Exterior · Units …") | 01 | Shorter feed labels for tiles | Fixed |
| P3 | Event rows truncate details with no way to read them | 01 | Full text on hover; an expanded row shows the full title and detail | Fixed |
| P4 | Thermal ground reads flat in the UGV view | 03 | Added sun-baked mottling and asphalt/lawn contrast (Phase 1 late fix) — further radiometric realism out of scope | Accepted |
| P5 | Feed timestamps are hard to read over a bright sky | 01, 03 | Timestamp sits on a translucent dark backing | Fixed |
| P6 | Clocks tick out of step (header vs feed stamps); one timer per component | all | Shared ticker per cadence (`useSyncExternalStore`) — one interval, all clocks update together | Fixed |
| P7 | Main-feed OSD (REC/LIVE, mode/PTZ line, virtual-view tag) is low contrast over bright scenes | 03 | Translucent dark backing | Fixed |

## Checklists

**Visual:** header alignment ✓ · nav spacing ✓ · no clipped labels (H4, P2) · KPI baselines ✓ · padding/borders/radii consistent ✓ · icon sizes 12–15 px ✓ · no oversized elements ✓ · dead zones (M2, M3) · no decorative gradients ✓ · 3D model (C2, M7) · ocean ✓ · lighting ✓ · overlays don't obscure (M8) · marker size ✓ · chart axes/labels ✓ · charts fit ✓ · tooltips inside viewport ✓ · thermal (P4) · camera labels ✓ · event density ✓ · scroll areas ✓ · footer link ✓ · console (M6) · no 404s ✓ · no React warnings ✓ · scenario sync ✓ · selection consistent across screens ✓ · asset/feed/event positions consistent ✓ · navigation ✓

**Functional (scripted, `tools/screenshots/functional-check.mjs`):** see the Phase 2 run log in the final report.

**Performance:** frame loop has no per-frame React renders ✓ · single scene/context ✓ · capped buffers ✓ (+M5) · RT lifecycle (H6) · one engine interval ✓ · narrow zustand selectors (`useShallow` for derived arrays) ✓ · dynamic resolution governor ✓ · GLB size (H7).

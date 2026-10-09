# ENCIRRA — one-minute demo film

A 60-second, 1920×1080, 60 fps walkthrough of the whole application: the live overview detecting a
synthetic multi-source scenario, the 3D digital twin, the robot and camera feeds, AI insights with human
validation, incident response, and replay. The film is built as code in two steps.

1. **Record** (`capture.mjs`): the production build runs in headless Microsoft Edge on a controlled clock
   (Playwright fake timers cover `Date`, timers, `requestAnimationFrame` and `performance.now`), so every
   frame shows the app at an exact moment no matter how long the capture takes. CSS animations are pinned
   to the same clock. A scripted operator drives the real UI (command palette, clicks, typing, timeline
   scrubbing) and every frame is saved at 2880×1620 along with the cursor position, the screen rectangles
   of the elements the film points at, and a few app facts (incident status, latest event, confidence).
2. **Compose** (`src/`): each film frame is a pure function of time. The recorded frames sit in a framed
   window with a virtual camera that pushes in on details; captions, callouts (tracking the recorded UI
   rectangles), the cursor and click ripples, keycaps, the title card and the outro are drawn on a 2D
   canvas. Callouts and zooms are timed from the recording itself (clicks, keypresses, app events), so a
   new recording keeps everything in sync.

| Segment | Content |
| --- | --- |
| Title | Logo, wordmark, tagline |
| 01 · Live overview | `Ctrl K` → "Trigger Multi-source Scenario"; time-lapse; the gamma trend is flagged; AI fusion correlates three sources and opens an incident |
| 02 · 3D digital twin | Fly to the incident, select RAD-S17 (inspector trend), turn on the wind layer, UGV-01 dispatched |
| 03 · Live feeds | UGV-01 at the equipment skid: visible → thermal → fusion, hotspot detection |
| 04 · AI insights | Cross-source correlation, confidence timeline, operator validates |
| 05 · Incident response | Acknowledge, checklist, operator note into the audit timeline |
| 06 · Replay | Scrub the twin timeline back to the incident, play at 4×, return to live |
| Outro | Logo, URL, credit, disclosure (synthetic data, no link to operational systems) |

## Record

```bash
npm run build && npm run preview                 # serves the app on http://localhost:4173
node media/demo-video/capture.mjs                # all shots → media/demo-video/public/footage/
node media/demo-video/capture.mjs --only=twin    # re-record one shot (the others replay unrecorded)
```

The footage (about 1.5 GB of JPEGs) is not committed; it is regenerated from the script.

## Preview and render

```bash
npx vite media/demo-video --port 5181            # scrubbable preview (space, ←/→, , . [ ] l h, ?t=20)
node media/demo-video/render.mjs stills --t 5,14,24,40
node media/demo-video/render.mjs                 # → media/demo-video/out/encirra-demo.mp4
```

Render options: `--fps 60` · `--samples auto` (motion blur only on the window's rise and pull-back; UI
footage stays sharp) · `--crf 17` · `--scale 2` for 3840×2160 · `--from` / `--to`. Uses the installed
Microsoft Edge through `playwright-core` (`BROWSER_CHANNEL=chrome` for Chrome) and ffmpeg with libx264.

## Where things live

| Concept | Code |
| --- | --- |
| Recording script: shots, cursor paths, probes | `capture.mjs` |
| Edit: segment order, in-points, captions, callouts, camera keys | `src/timeline.ts` |
| Footage manifest, probe lookup, decoded-frame cache | `src/footage.ts` |
| App window, virtual camera, cursor, clicks, keycaps | `src/scenes/screen.ts` |
| Callouts (tracked outline, brackets, spotlight, chip) | `src/scenes/callouts.ts` |
| Caption band, chapter rail, time-lapse badge | `src/scenes/captions.ts` |
| Title card, outro, backdrop | `src/scenes/cards.ts` |
| Bézier easing, keyframes, layers, shapes | `src/engine/` (shared with `media/release-video`) |

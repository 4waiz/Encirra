# ENCIRRA — one-minute demo film

A 60-second, 1920×1080, 60 fps narrated walkthrough of the whole application: the live overview detecting
a synthetic multi-source scenario, the 3D digital twin, the robot and camera feeds, AI insights with human
validation, incident response, and replay. The film is built as code in three steps.

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
3. **Sound** (`audio/`, after /brag's voice mode): Kokoro narration (voice `af_heart`) generated through
   `hyperframes tts`, a music bed that ducks under the voice and lands its section re-entry on the outro
   logo, and CC0 UI sounds on every recorded click, shortcut and typed character. Each line is anchored to
   the same cue sheet as the picture, the mix is normalised to −14 LUFS / −1.5 dBTP, and the best frame is
   baked in as frame 0 so it becomes the thumbnail everywhere.

| Segment | Content |
| --- | --- |
| Title | Logo, wordmark, tagline |
| 01 · Live overview | `Ctrl K` → "Trigger Multi-source Scenario"; time-lapse; the gamma trend is flagged; AI fusion correlates three sources and opens an incident |
| 02 · 3D digital twin | Fly to the incident, select RAD-S17 (inspector trend), turn on the wind layer, incident pinned on the dose-rate field |
| 03 · Live feeds | UGV-01 at the equipment skid: visible → thermal → fusion, hotspot detection |
| 04 · AI insights | Cross-source correlation, confidence timeline, operator validates |
| 05 · Incident response | Acknowledge, checklist, operator note into the audit timeline |
| 06 · Replay | Scrub the twin timeline back to the incident, play at 4×, return to live |
| Outro | Logo, URL, credit, disclosure (synthetic data, no link to operational systems) |

The plan, storyboard and narration script are in [brag-plan.md](brag-plan.md); the caption for posting is
[share-copy.txt](share-copy.txt).

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
node media/demo-video/render.mjs                 # silent picture → out/picture.mp4
node media/demo-video/render.mjs cues            # cue sheet (cuts, clicks, keys, typing, events) → out/cues.json
```

Render options: `--fps 60` · `--samples auto` (motion blur only on the window's rise and pull-back; UI
footage stays sharp) · `--crf 17` · `--scale 2` for 3840×2160 · `--from` / `--to`. Uses the installed
Microsoft Edge through `playwright-core` (`BROWSER_CHANNEL=chrome` for Chrome) and ffmpeg with libx264.

## Sound

```bash
node media/demo-video/audio/build.mjs            # narration + mix + poster → out/encirra-demo.mp4
```

The narration WAVs are committed in `audio/voiceover/`, so the mix rebuilds without a voice model. A line is
regenerated only when its text, voice or speed in `audio/voiceover.json` changes; if it no longer fits its
slot the build speeds it up slightly (at most 1.12×) or asks for a shorter line. Generating lines needs
Python with `kokoro-onnx` and `soundfile`:

```bash
python -m venv %LOCALAPPDATA%\hyperframes-kokoro        # keep the path short: Windows' 260-character limit
%LOCALAPPDATA%\hyperframes-kokoro\Scripts\pip install kokoro-onnx soundfile
set HYPERFRAMES_PYTHON=%LOCALAPPDATA%\hyperframes-kokoro\Scripts\python.exe
```

Options: `--poster <seconds>` (the thumbnail frame, default 23.9) · `--stems` (also writes the voice, music
and effects buses to `out/` for level checks). Music and effects come from `audio/assets/`; see
[audio/assets/CREDITS.md](audio/assets/CREDITS.md) for sources and licenses.

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
| Narration script and the cue each line is anchored to | `audio/voiceover.json` |
| Soundtrack: narration, ducking, music beat lock, effects, loudness, poster, mux | `audio/build.mjs` |
| Bézier easing, keyframes, layers, shapes | `src/engine/` (shared with `media/release-video`) |

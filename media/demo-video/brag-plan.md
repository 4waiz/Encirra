# Brag Plan: ENCIRRA demo film (narrated)

## What is this app?
ENCIRRA is a conceptual CBRN situational-awareness command center: a live dashboard, a realistic 3D
digital twin of a generalized coastal site, robot and camera feeds with thermal analytics, explainable AI
correlation and an incident-response workflow, all running on synthetic data in the browser.

## The angle
Watch one synthetic incident travel through the whole product in a minute: detected, correlated,
inspected in 3D and on a robot's thermal camera, validated by a person, worked as an incident, then
replayed. The footage is the real app (recorded frame by frame from the production build), so nothing is
mocked. The narration explains *why* each screen matters instead of reading the captions.

## Hook (first 2-3 seconds)
Logo and wordmark on a dark grid, with the narrator: "This is Encirra." The app window rises straight
into a live dashboard that is already busy.

## Key moments (the middle)
- A gamma monitor trends up, and AI fusion correlates three sources into an incident.
- The 3D twin flies to the source; the sensor inspector and wind layer explain the situation.
- The ground robot's mast camera switches to thermal and the hotspot jumps out.
- The operator validates the AI observation ("a person always makes the call"), then works the incident.

## Outro / punchline
"Encirra. Developed by Awaiz Ahmed." The window pulls back beside the logo, URL and the disclosure
(conceptual environment, synthetic data, no link to operational systems), on the music's re-entry.

## User flow worth showing
Command palette → trigger scenario → detection → 3D inspection → thermal feed → validation →
acknowledge / checklist / note → replay. The whole video is this flow.

## Tone
- Preset: `polished`
- Creative direction: calm control-room briefing; confident, never alarmist
- Interpretation: one voice, short sentences, long holds on readable UI, a steady music bed and quiet,
  motion-matched UI sounds

## Format: landscape — 1920x1080, 60 fps
## Duration: 60 s (the brief asked for one minute that demonstrates the entire application, longer than /brag's usual 15–25 s)

## Visual identity (from the project)
- Background: `#0B0C10`
- Accent: `#4FFBDF` (cyan), `#00E676` (mint), `#F2B33D` (amber alerts)
- Text: `#FFFFFF`
- Display font: Inter · Mono: IBM Plex Mono
- Strongest visual element: the 3D twin with the incident pinned on the dose-rate field

## Share copy (draft)
See `share-copy.txt`.

## Audio direction
- Role: warm bed with sparse professional accents, under a single narrator
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (steady and clean, 110 BPM), CC BY 4.0
- Music treatment: fades in under the title; ducks to 0.13 for narration (lines closer than 1.6 s share
  one duck so it never pumps); fades out with the closing frame
- Music cue guidance: bundled preset; the track's section re-entry (strong cue at 61.10 s after a quiet
  stretch) is beat-locked to the outro logo at 55.28 s by starting the track 5.82 s in
- Audio-reactive treatment: none (the picture is recorded app footage, not a Hyperframes composition)
- SFX posture: sparse and motion-matched: a soft thud on each section change, clicks on every recorded
  click, key sounds on the shortcuts and on every typed character, a low bell when the incident opens,
  a success bell on validation, a slide on the replay scrub and a bell on the outro logo
- Restraint rule: no effect louder than the voice; nothing on the 16 callouts (the voice carries them)

## Storyboard

| Time | Scene | On screen | Narration |
| --- | --- | --- | --- |
| 0.0–3.4 | Title | Logo, wordmark, tagline | "This is Encirra." |
| 3.4–16.4 | 01 · Live overview | `Ctrl K` → multi-source scenario, time-lapse, trend flagged, incident opened | "Every chemical, biological, radiological and nuclear reading, in one live view." · "In this synthetic run, a gamma monitor trends up." · "AI fusion confirms it across three sources and opens an incident." |
| 16.4–25.9 | 02 · 3D digital twin | Fly to the source, select RAD-S17, wind layer on | "The 3D twin flies straight to it." · "Every sensor reports live, and the wind layer shows where a release would drift." |
| 25.9–32.4 | 03 · Live feeds | UGV-01 mast camera: visible → thermal → fusion | "Meanwhile, the ground robot reaches the equipment. In thermal, the hotspot stands out." |
| 32.4–39.5 | 04 · AI insights | Correlation graph, confidence timeline, Validate | "Insights show every source, and how much each counts." · "But a person always makes the call." |
| 39.5–47.5 | 05 · Incident response | Acknowledge, checklist, operator note | "The operator acknowledges, works the checklist, and adds a note." · "Every step lands in the audit trail." |
| 47.5–54.7 | 06 · Replay | Scrub back, play at 4×, back to live | "And the whole incident can be replayed, right in the twin." |
| 54.7–60.0 | Outro | Logo, URL, credit, disclosure | "Encirra. Developed by Awaiz Ahmed." |

## Voiceover script
Kokoro voice `af_heart` through `hyperframes tts` (/brag's voice mode). The lines, and the cue each one
is anchored to, live in `audio/voiceover.json`; `audio/build.mjs` places them on the cue sheet, checks
that none overruns its slot, and prints the final timing.

1. This is Encirra.
2. Every chemical, biological, radiological and nuclear reading, in one live view.
3. In this synthetic run, a gamma monitor trends up.
4. AI fusion confirms it across three sources and opens an incident.
5. The 3D twin flies straight to it.
6. Every sensor reports live, and the wind layer shows where a release would drift.
7. Meanwhile, the ground robot reaches the equipment. In thermal, the hotspot stands out.
8. Insights show every source, and how much each counts.
9. But a person always makes the call.
10. The operator acknowledges, works the checklist, and adds a note.
11. Every step lands in the audit trail.
12. And the whole incident can be replayed, right in the twin.
13. Encirra. Developed by Awaiz Ahmed.

**Music mood for this video:** polished, steady
**Audio summary:** a calm narrator walks one synthetic incident end to end over a clean, ducked bed; UI
sounds follow the cursor and keyboard, and the music's re-entry lands on the logo.

# ENCIRRA QA release — motion graphics

A 20-second, 1920×1080, 24 fps motion piece summarising the Phase 2 QA release, built as code. Each
scene draws its frame as a pure function of time, so the preview, a still and the final render always
agree.

| Scene | Time | Content |
| --- | --- | --- |
| 1 · Performance | 0:00–0:05 | Header and separator, grid fade-in, the "Performance Optimization" data card; frame cost counts up to ~1 ms with a frame-budget meter; memory counters and heap trace, decoding to "Stable (0 leaks detected)" |
| 2 · UI Enhancements | 0:05–0:13 | Before: overlapping labels and truncated feeds, fading to 30 %. After: the cyan sensor ring expands, labels slide apart while viewfinder brackets auto-frame them. Bottom: the correlation graph scales along X to fill its panel; the scrollbar goes away |
| 3 · WebGL & Optimization | 0:13–0:20 | "3D Model Weight: 6.7 MB" snaps in, a cyan wipe dissolves it into "Optimized Model: 0.68 MB", which turns mint (#00E676); the status badge types "WebGL Errors: 0 (Startup Shadow Bug Fixed)" |

## Preview

From the repo root:

```bash
npx vite media/release-video --port 5180
```

Then open http://localhost:5180. Keys: space play/pause · ←/→ 1 s (shift 5 s) · `,` `.` one frame ·
`[` `]` previous/next scene · `l` loop the scene · `h` hide the UI. Add `?t=13` to start at 13 s.

## Render

```bash
node media/release-video/render.mjs stills --t 2.4,8.9,19
node media/release-video/render.mjs
```

The first writes PNG stills to `out/stills/`; the second writes `out/encirra-qa-release.mp4` (H.264, yuv420p,
BT.709). Options: `--samples auto` (default: 8 motion-blur sub-samples, 20 in fast moves) · `--shutter 0.5`
(180°) · `--crf 16` · `--scale 2` for 3840×2160 · `--from` / `--to` for a range. Rendering uses the
locally installed Microsoft Edge through `playwright-core` (set `BROWSER_CHANNEL=chrome` for Chrome) and
ffmpeg with libx264 on the PATH.

## Where things live

| Concept | Code |
| --- | --- |
| Every on-screen string (live vector type, re-set each frame) | `src/copy.ts` |
| Master null controller: all bullet / readout text is parented to it; offset, scale or keyframe it to move them together | `src/controller.ts` (`MASTER_NULL`, `MASTER_KEYS`) |
| Bézier easing curves (no linear moves) | `src/engine/ease.ts` |
| Keyframe helpers (`prog`, `tween`, colour `mix`) | `src/engine/anim.ts` |
| Null and text layers | `src/engine/layers.ts` |
| Scene timing, fast-motion windows | `src/timeline.ts` |
| Scenes | `src/scenes/s1-performance.ts`, `s2-enhancements.ts`, `s3-webgl.ts`; header in `chrome.ts`, background in `backdrop.ts` |
| Motion blur + dither, frame output | `src/engine/renderer.ts`, `render.mjs` |

Counters are expressions of time, e.g. `value(t) = 1.0 ms × easeOut(progress)` in `s1-performance.ts`.
The MP4 is a flat video; the editable layers are the source files above, and any change re-renders at
any resolution.

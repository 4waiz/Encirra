#!/usr/bin/env node
// Offline renderer for the ENCIRRA one-minute demo. Vite serves the comp and the recorded footage,
// headless Microsoft Edge draws every frame (averaging sub-frames across the shutter in fast moves), and
// the PNG frames are piped straight into ffmpeg (H.264 High, yuv420p, BT.709).
//
//   node media/demo-video/render.mjs                           video  → media/demo-video/out/encirra-demo.mp4
//   node media/demo-video/render.mjs stills --t 2,9.5,16       stills → media/demo-video/out/stills/
//   node media/demo-video/render.mjs cues                      cue sheet for the soundtrack → media/demo-video/out/cues.json
//
// Footage comes from media/demo-video/capture.mjs (run that first).
// Options: --fps 60  --samples auto (1, or 3–6 in fast moves; or a number)  --shutter 0.5  --crf 17  --scale 1 (2 = 3840×2160)  --from 0  --to 60  --out <file|dir>
// Set BROWSER_CHANNEL=chrome to render with Google Chrome instead of Edge.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const mode = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'video';
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};

const fps = Number(opt('fps', 60));
const samplesArg = opt('samples', 'auto');
const samples = samplesArg === 'auto' ? 'auto' : Number(samplesArg);
const shutter = Number(opt('shutter', 0.5));
const crf = Number(opt('crf', 17));
const scale = Number(opt('scale', 1));

if (mode !== 'video' && mode !== 'stills' && mode !== 'cues') {
  console.error(`unknown mode "${mode}" (use video, stills or cues)`);
  process.exit(1);
}

const server = await createServer({ root: here, configFile: false, logLevel: 'error', server: { port: 5198, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL ?? 'msedge',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--force-color-profile=srgb'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page]', String(e)));
  page.on('console', (m) => m.type() === 'error' && console.error('[console]', m.text()));
  await page.goto(`${url}?render=1&scale=${scale}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__video?.ready === true, null, { timeout: 60000 });
  const duration = await page.evaluate(() => window.__video.duration);
  const grab = (t) => page.evaluate(([t, s, sh, f]) => window.__video.frame(t, s, sh, f), [t, samples, shutter, fps]);

  if (mode === 'cues') {
    const out = resolve(opt('out', resolve(here, 'out/cues.json')));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(await page.evaluate(() => window.__video.cues()), null, 1));
    console.log('saved', out);
  } else if (mode === 'stills') {
    const times = String(opt('t', '2.5,9,16')).split(',').map(Number).filter((v) => Number.isFinite(v));
    const outDir = resolve(opt('out', resolve(here, 'out/stills')));
    mkdirSync(outDir, { recursive: true });
    for (const t of times) {
      const file = resolve(outDir, `still-${t.toFixed(2).replace('.', '_')}s.png`);
      writeFileSync(file, Buffer.from(await grab(t), 'base64'));
      console.log('saved', file);
    }
  } else {
    const from = Number(opt('from', 0));
    const to = Math.min(duration, Number(opt('to', duration)));
    // the silent picture; audio/build.mjs adds the soundtrack and writes out/encirra-demo.mp4
    const out = resolve(opt('out', resolve(here, 'out/picture.mp4')));
    mkdirSync(dirname(out), { recursive: true });
    const frames = Math.round((to - from) * fps);
    const ff = spawn(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
        '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-profile:v', 'high',
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
        '-r', String(fps), '-movflags', '+faststart', out,
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    const started = Date.now();
    for (let i = 0; i < frames; i++) {
      const t = from + i / fps;
      const png = Buffer.from(await grab(t), 'base64');
      if (!ff.stdin.write(png)) await once(ff.stdin, 'drain');
      if (i % fps === 0 || i === frames - 1) {
        const done = (i + 1) / frames;
        const eta = ((Date.now() - started) / done - (Date.now() - started)) / 1000;
        process.stdout.write(`\r  frame ${String(i + 1).padStart(4)} / ${frames}  (${(done * 100).toFixed(0)}%)  eta ${eta.toFixed(0)} s   `);
      }
    }
    ff.stdin.end();
    const [code] = await once(ff, 'close');
    process.stdout.write('\n');
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    console.log(`saved ${out}  (${frames} frames, ${fps} fps, ${samples} samples, ${((Date.now() - started) / 1000).toFixed(0)} s)`);
  }
} finally {
  await browser.close();
  await server.close();
}

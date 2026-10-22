#!/usr/bin/env node
// Records frame-exact video clips of the running app (dev server) for the launch video.
// Playwright's fake clock drives Date, timers, requestAnimationFrame and performance.now, so every
// frame advances exactly 1/fps of simulated time regardless of how long a screenshot takes.
//
//   node scripts/qa/record-clips.mjs [--only=fault,restore] [--fps=30] [--out=brag-output/clips]
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const root = resolve(import.meta.dirname, '..', '..');
const url = args.url ?? 'http://127.0.0.1:5173/';
const fps = Number(args.fps ?? 30);
const out = resolve(root, args.out ?? 'brag-output/clips');
const only = args.only ? new Set(args.only.split(',')) : null;
const W = 1920, H = 1080;

// minute → frame index: frames are 1 min apart starting 16:30 (fault at 17:00 = frame 30)
const S = (code) => `(() => { const s = window.__encirra.useTwin.getState(); ${code} })()`;
const CLIPS = [
  { name: 'fault', seconds: 4.6, setup: S("s.setFocusTwin(true); s.switchStrategy('encirra'); s.setSpeed(2); s.setPlayhead(28.2); s.requestCamera({ shot: 'home', durationS: 0.01 });"), start: S('s.setPlaying(true);') },
  { name: 'cascade', seconds: 6.6, setup: S("s.setFocusTwin(true); s.switchStrategy('grid-only'); s.setSpeed(8); s.setPlayhead(34); s.requestCamera({ shot: 'home', durationS: 0.01 });"), start: S("s.setLayer('underground', true); s.setPlaying(true);"), after: S("s.setLayer('underground', false); s.setPlaying(false);") },
  { name: 'assemble', seconds: 4.2, setup: S("s.setFocusTwin(true); s.switchStrategy('encirra'); s.setPlaying(false); s.setPlayhead(5); s.requestCamera({ shot: 'home', durationS: 0.01 });"), start: S('s.playIntro();') },
  { name: 'decision', seconds: 7.4, setup: S("s.setFocusTwin(false); s.switchStrategy('encirra'); s.setPlaying(false); s.setPlayhead(35); s.requestCamera({ shot: 'home', durationS: 0.01 });"), start: S('s.setWhyPlanOpen(true);'), after: S('s.setWhyPlanOpen(false);') },
  { name: 'restore', seconds: 5.8, setup: S("s.setWhyPlanOpen(false); s.setFocusTwin(false); s.switchStrategy('encirra'); s.setSpeed(2); s.setPlayhead(38.5); s.requestCamera({ shot: 'home', durationS: 0.01 });"), start: S('s.setPlaying(true);') },
  { name: 'outro', seconds: 3.4, setup: S("s.setPlaying(false); s.setFocusTwin(true); s.setPlayhead(60); s.requestCamera({ shot: 'aerial', durationS: 0.01 });"), start: S("s.requestCamera({ shot: 'home', durationS: 3.6 });") },
];

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.clock.install({ time: new Date('2026-04-28T12:30:00Z') });
await page.clock.pauseAt(new Date('2026-04-28T12:30:01Z'));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
// boot: advance simulated time in small steps while assets, shaders and the intro settle
for (let i = 0; i < 160; i++) {
  await page.clock.runFor(100);
  if (i > 40 && (await page.evaluate(() => !!window.__encirra?.useTwin?.getState().run).catch(() => false)) && i > 120) break;
}
try { localStorage; } catch {}
await page.evaluate(() => { try { localStorage.setItem('encirra.welcome.dismissed', '1'); } catch {} });

const pinCss = async () => page.evaluate(() => document.getAnimations().forEach((a) => { try { a.pause(); } catch {} }));
for (const clip of CLIPS) {
  if (only && !only.has(clip.name)) continue;
  const dir = join(out, clip.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await page.evaluate(clip.setup);
  for (let i = 0; i < 30; i++) await page.clock.runFor(100); // settle 3 s of simulated time
  await page.evaluate(clip.start);
  const n = Math.round(clip.seconds * fps);
  const t0 = Date.now();
  for (let f = 0; f < n; f++) {
    await page.clock.runFor(1000 / fps);
    // CSS animations follow the real clock in Chromium; advance them by the same step
    await page.evaluate((dt) => document.getAnimations().forEach((a) => { if (a.playState === 'running') { a.pause(); } if (a.currentTime != null) a.currentTime = Number(a.currentTime) + dt; }), 1000 / fps).catch(() => {});
    await page.screenshot({ path: join(dir, `${String(f).padStart(5, '0')}.png`) });
  }
  if (clip.after) await page.evaluate(clip.after);
  const mp4 = join(out, `${clip.name}.mp4`);
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, '%05d.png'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', mp4], { stdio: 'inherit' });
  console.log(`${clip.name}: ${n} frames → ${mp4} (${Math.round((Date.now() - t0) / 1000)} s)`);
}
await browser.close();
if (errors.length) console.log('page errors:', errors.slice(0, 5));
void pinCss;

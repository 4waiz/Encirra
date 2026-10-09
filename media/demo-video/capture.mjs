#!/usr/bin/env node
// Records the ENCIRRA footage for the one-minute demo. The production build runs in headless Edge on a
// controlled clock (Playwright fake timers: Date, timers, requestAnimationFrame, performance.now), so
// every frame shows the app at an exact moment however long the capture takes; CSS animations are pinned
// to the same clock. Each shot writes JPEG frames (2880×1620) and a manifest entry with, per frame, the
// cursor position, the screen rectangles of the UI elements the video points at, and a few app facts.
//
//   npm run build && npm run preview                       (serves the app on http://localhost:4173)
//   node media/demo-video/capture.mjs [--url=http://localhost:4173/] [--only=overview,twin]
//
// Shots not listed in --only still run (unrecorded) so the app reaches the same state.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split('=').slice(1).join('=');
const BASE = arg('url', 'http://localhost:4173/');
const ONLY = arg('only', '').split(',').filter(Boolean);
const OUT = resolve(here, 'public/footage');
const VIEW = { width: 1920, height: 1080 };
const DSF = 1.5;
const START = new Date('2026-10-09T06:20:00Z'); // 10:20 GST

// UI elements the callouts and the cursor aim at (CSS px rects, recorded every frame)
const PROBES = {
  common: [
    ['alert', 'button[title^="System health"]'],
    ['pin', '[aria-label^="Incident INC"]'],
  ],
  overview: [
    ['palette', '[aria-label="Command palette"]'],
    ['events', '[aria-label="Event stream"] li'],
    ['eventsPanel', 'section[aria-label="AI Event Stream"], section:has([aria-label="Event stream"])'],
    ['fusion', 'section[aria-label="AI Fusion & Insights"]'],
    ['kpiRad', 'section[aria-label="Radiological"]'],
    ['twinPanel', 'section[aria-label="3D Site Digital Twin"]'],
    ['tabTwin', 'nav[aria-label="Primary"] button', '3D Twin'],
  ],
  twin: [
    ['tabTwin', 'nav[aria-label="Primary"] button', '3D Twin'],
    ['rad17', '[aria-label^="RAD-S17 "]'],
    ['inspector', 'aside[aria-label="Inspector"]'],
    ['weather', 'aside[aria-label="Twin controls"] label', 'Weather'],
    ['layers', 'aside[aria-label="Twin controls"] section'],
    ['ugv', 'button[aria-label^="UGV-01:"]'],
    ['uav', 'button[aria-label^="UAV-01:"]'],
  ],
  feeds: [
    ['thermalBtn', '[role="radio"]', 'Thermal'],
    ['fusionBtn', '[role="radio"]', 'Fusion'],
    ['hotspot', 'div.whitespace-nowrap', 'Hotspot', 'parent'],
    ['detections', 'section[aria-label="Detections"]'],
    ['sources', 'section[aria-label="Sources"]'],
  ],
  insights: [
    ['graph', 'section[aria-label="Cross-source correlation"]'],
    ['conf', 'section[aria-label="Confidence timeline"]'],
    ['evidence', 'section[aria-label="Evidence"]'],
    ['validate', 'button', 'Validate'],
  ],
  incidents: [
    ['ack', 'button', 'Acknowledge'],
    ['check1', 'button, label', 'Confirm monitor health'],
    ['check2', 'button, label', 'Notify shift supervisor'],
    ['checklist', 'section[aria-label="Response checklist"]'],
    ['note', 'input[aria-label="Operator note"]'],
    ['timeline', 'section[aria-label="Incident timeline"]'],
    ['kpis', 'section[aria-label="Response KPIs"]'],
  ],
  replay: [
    ['scrub', '[aria-label="Timeline scrubber"]'],
    ['live', '.panel:has([aria-label="Timeline scrubber"]) button', 'Live', 'exact'],
    ['play', '[aria-label="Play replay"], [aria-label="Pause replay"]'],
    ['speed4', '.panel:has([aria-label="Timeline scrubber"]) [role="radio"]', '4×', 'exact'],
    ['timelinePanel', '[aria-label="Timeline scrubber"]', null, 'panel'],
  ],
};

/** Runs in the page before every screenshot: pin CSS animations to the fake clock, read rects + facts. */
function pageFrame(probes) {
  const now = performance.now();
  const reg = (window.__demoAnims ??= new WeakMap());
  for (const a of document.getAnimations()) {
    if (!reg.has(a)) reg.set(a, now);
    const local = now - reg.get(a);
    try {
      const end = a.effect?.getComputedTiming().endTime ?? Infinity;
      if (Number.isFinite(end) && local >= end) a.finish();
      else {
        a.pause();
        a.currentTime = local;
      }
    } catch {
      /* animation already gone */
    }
  }
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let p = el; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    return true;
  };
  const rects = {};
  for (const [name, sel, text, mode] of probes) {
    let el = null;
    for (const cand of document.querySelectorAll(sel)) {
      if (text) {
        const t = (cand.innerText || cand.textContent || '').trim().replace(/\s+/g, ' ').toLowerCase();
        const want = text.toLowerCase();
        if (mode === 'exact' ? t !== want : !t.startsWith(want)) continue;
      }
      if (!shown(cand)) continue;
      el = cand;
      break;
    }
    if (el && mode === 'parent') el = el.parentElement;
    if (el && mode === 'panel') el = el.closest('.panel') ?? el;
    if (!el) continue;
    const r = el.getBoundingClientRect();
    rects[name] = [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10);
  }
  const s = window.__ENCIRRA__.sim.getState();
  const u = window.__ENCIRRA__.ui.getState();
  const inc = s.incidents.find((i) => i.status !== 'resolved') ?? s.incidents[0];
  const obs = s.observations[0];
  return {
    rects,
    facts: {
      screen: u.screen,
      inc: inc ? inc.status : null,
      incId: inc ? inc.id : null,
      obs: obs ? obs.status : null,
      conf: obs ? Math.round(obs.confidence * 100) : null,
      ev: s.events[0]?.title ?? null,
      replay: u.playback.mode === 'replay',
      clock: new Date().toISOString().slice(11, 19),
    },
  };
}

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2); // cubic in-out
const lerp = (a, b, k) => a + (b - a) * k;

class Shot {
  constructor(page, name, fps, record) {
    this.page = page;
    this.name = name;
    this.fps = fps;
    this.record = record;
    this.dir = join(OUT, name);
    this.frames = [];
    this.clicks = [];
    this.keys = [];
    this.typed = [];
    this.cursor = null;
    this.camera = null; // (seconds) => {pos, target}
    this.t = 0; // shot time in seconds
    this.probes = [...PROBES.common, ...(PROBES[name] ?? [])];
    if (record) {
      rmSync(this.dir, { recursive: true, force: true });
      mkdirSync(this.dir, { recursive: true });
    }
  }

  /** Advance the app by one frame (× speed for time-lapse), then capture it. */
  async frame(speed = 1) {
    const dt = 1 / this.fps;
    if (this.camera) {
      const pose = this.camera(this.t + dt);
      if (pose) await this.page.evaluate(([p, t]) => window.__ENCIRRA_CAMERA__.setCameraPose(p, t, false), [pose.pos, pose.target]);
    }
    await this.page.clock.runFor(Math.round(dt * speed * 1000 * 1000) / 1000);
    this.t += dt;
    if (!this.record) return;
    const info = await this.page.evaluate(pageFrame, this.probes);
    const buf = await this.page.screenshot({ type: 'jpeg', quality: 90 });
    writeFileSync(join(this.dir, `${String(this.frames.length).padStart(5, '0')}.jpg`), buf);
    this.frames.push({ c: this.cursor ? [Math.round(this.cursor[0] * 10) / 10, Math.round(this.cursor[1] * 10) / 10] : null, r: info.rects, f: info.facts, s: speed });
    if (this.frames.length % this.fps === 0) process.stdout.write(`\r  ${this.name}: ${this.frames.length} frames (${this.t.toFixed(1)} s)   `);
  }

  async hold(sec, speed = 1) {
    const n = Math.round(sec * this.fps);
    for (let i = 0; i < n; i++) await this.frame(speed);
  }

  /** Resolve a probe name (or a point) to a CSS px position. */
  async point(target, dx = 0.5, dy = 0.5) {
    if (Array.isArray(target)) return target;
    const info = await this.page.evaluate(pageFrame, this.probes.filter((p) => p[0] === target));
    const r = info.rects[target];
    if (!r) throw new Error(`[${this.name}] probe "${target}" not found`);
    return [r[0] + r[2] * dx, r[1] + r[3] * dy];
  }

  /** Glide the cursor to a target along a gentle arc, recording every frame (`track` re-aims each frame). */
  async move(target, sec, { dx = 0.5, dy = 0.5, arc = 0.06, track = false } = {}) {
    let to = await this.point(target, dx, dy);
    const from = this.cursor ?? to;
    const n = Math.max(1, Math.round(sec * this.fps));
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const nx = len ? -(to[1] - from[1]) / len : 0;
    const ny = len ? (to[0] - from[0]) / len : 0;
    for (let i = 1; i <= n; i++) {
      if (track && i > 1) to = await this.point(target, dx, dy);
      const k = ease(i / n);
      const bow = Math.sin(Math.PI * k) * arc * len;
      this.cursor = [lerp(from[0], to[0], k) + nx * bow, lerp(from[1], to[1], k) + ny * bow];
      await this.page.mouse.move(this.cursor[0], this.cursor[1]);
      await this.frame();
    }
  }

  async park(point) {
    this.cursor = point;
    await this.page.mouse.move(point[0], point[1]);
  }

  async click() {
    this.clicks.push(this.frames.length);
    await this.page.mouse.down();
    await this.frame();
    await this.page.mouse.up();
    await this.frame();
  }

  async key(combo, label) {
    this.keys.push({ frame: this.frames.length, label: label ?? combo });
    await this.page.keyboard.press(combo);
  }

  async type(text, cps = 14) {
    for (const ch of text) {
      this.typed.push(this.frames.length);
      await this.page.keyboard.type(ch);
      await this.hold(1 / cps);
    }
  }

  async run(fn, arg) {
    return this.page.evaluate(fn, arg);
  }

  manifest() {
    return { fps: this.fps, frames: this.frames.length, view: VIEW, dsf: DSF, clicks: this.clicks, keys: this.keys, typed: this.typed, data: this.frames };
  }
}

// ------------------------------------------------------------------------------------------ session

mkdirSync(OUT, { recursive: true });
const manifestPath = join(OUT, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL ?? 'msedge',
  headless: true,
  ignoreDefaultArgs: ['--hide-scrollbars'],
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--force-color-profile=srgb'],
});
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DSF, colorScheme: 'dark' });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('\n[pageerror]', String(e)));
await page.clock.install({ time: START });
// paused: time only moves when a frame advances it (otherwise it would also tick in real time)
await page.clock.pauseAt(new Date(START.getTime() + 500));
await page.goto(`${BASE}#/overview`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });

// boot: let the scene stream in, then settle on a quiet overview
for (let i = 0; i < 900; i++) {
  await page.clock.runFor(100);
  const ok = await page.evaluate(() => !!window.__ENCIRRA__?.sim.getState().ready && !document.body.innerText.includes('Telemetry buffers'));
  if (ok) break;
}
await page.evaluate(() => {
  window.__ENCIRRA__.engine.cancelAutoplay();
  window.__ENCIRRA__.ui.getState().setSettings({ autoplay: false, labels: true, autoFrame: true, quality: 'high' });
});
await page.clock.runFor(4000);
console.log('booted at', await page.evaluate(() => new Date().toISOString()));

const want = (name) => !ONLY.length || ONLY.includes(name);
const shots = [];
const shot = async (name, fps, body) => {
  const s = new Shot(page, name, fps, want(name));
  await body(s);
  if (s.record) {
    manifest[name] = s.manifest();
    writeFileSync(manifestPath, JSON.stringify(manifest));
    process.stdout.write(`\r  ${name}: ${s.frames.length} frames, ${s.t.toFixed(2)} s\n`);
  }
  shots.push(s);
  return s;
};

// 1 — Overview: run a synthetic multi-source scenario from the command palette, watch it get detected
await shot('overview', 30, async (s) => {
  await s.park([1600, 985]); // clear of the palette, so no list item shows a hover state
  await s.hold(0.6);
  await s.key('Control+k', 'Ctrl K');
  await s.hold(0.45);
  await s.type('multi', 9);
  await s.hold(0.5);
  await s.key('Enter', '↵');
  await s.move([1500, 640], 0.5);
  await s.hold(2.2, 2.5); // time-lapse: the first readings ramp up
  await s.hold(8.6); // trend flagged (+7 s), correlation and incident (+11 s), then a beat to read it
});

// 2 — Digital twin: open it from the header, fly to the incident, inspect the sensor, add the wind layer
await shot('twin', 60, async (s) => {
  await s.run(() => window.__ENCIRRA__.ui.getState().setSettings({ autoFrame: false }));
  await s.move('tabTwin', 0.7);
  await s.click();
  const T = [178, 6, -150];
  const start = await s.run(() => window.__ENCIRRA_CAMERA__.getCameraPose());
  const p1 = { pos: [T[0] + 250, 205, T[2] + 300], target: [T[0] - 10, 6, T[2] - 10] };
  const orbit = (k) => {
    // slow arc around the incident, easing in and out, drifting a little lower
    const a = 0.69 + 0.5 * k;
    const r = 395 - 40 * k;
    return { pos: [T[0] + Math.sin(a) * r, 205 - 30 * k, T[2] + Math.cos(a) * r], target: [T[0] - 10, 6, T[2] - 10] };
  };
  const t0 = s.t;
  s.camera = (t) => {
    const lt = t - t0;
    if (lt < 2.4) {
      const k = ease(Math.min(1, lt / 2.4));
      return { pos: start.pos.map((v, i) => lerp(v, p1.pos[i], k)), target: start.target.map((v, i) => lerp(v, p1.target[i], k)) };
    }
    return orbit(ease(Math.min(1, (lt - 2.4) / 8.4)));
  };
  await s.hold(1.75);
  await s.move('rad17', 0.75, { dy: 0.35, track: true });
  await s.click();
  await s.hold(1.0);
  await s.move('weather', 0.8);
  await s.click();
  await s.move([1300, 760], 0.8);
  await s.hold(3.6);
  s.camera = null;
});

// fast-forward while UGV-01 drives to the source (not recorded)
await page.evaluate(() => {
  const ui = window.__ENCIRRA__.ui.getState();
  ui.select(null);
  ui.setFeedMain('UGV-01');
  ui.setFeedMode('UGV-01', 'visible');
  ui.setScreen('feeds');
});
for (let i = 0; i < 240; i++) {
  await page.clock.runFor(500);
  const arrived = await page.evaluate(() => window.__ENCIRRA__.sim.getState().events.some((e) => e.title === 'UGV-01 onboard dosimeter'));
  if (arrived) break;
}
await page.clock.runFor(1500);

// 3 — Live feeds: UGV-01's mast camera, switched to thermal as it reaches the equipment skid
await shot('feeds', 30, async (s) => {
  await s.park([1250, 520]);
  await s.hold(0.7);
  await s.move('thermalBtn', 0.6);
  await s.click();
  await s.move([1240, 470], 0.7);
  await s.hold(1.8);
  await s.move('fusionBtn', 0.6);
  await s.click();
  await s.move([1180, 500], 0.6);
  await s.hold(1.4);
});

// 4 — AI insights: the observation reaches the validation threshold; the operator validates it
await page.evaluate(() => {
  const ui = window.__ENCIRRA__.ui.getState();
  const obs = window.__ENCIRRA__.sim.getState().observations[0];
  if (obs) ui.selectObservation(obs.id);
  ui.setScreen('insights');
});
await shot('insights', 30, async (s) => {
  await s.park([1000, 620]);
  await s.hold(1.0);
  await s.move('conf', 0.9, { dx: 0.955, dy: 0.42 });
  await s.hold(1.2);
  await s.move('validate', 0.8);
  await s.hold(0.2);
  await s.click();
  await s.move([1060, 560], 0.6);
  await s.hold(2.3);
});

// 5 — Incident response: acknowledge, work the checklist, log a note
await page.evaluate(() => {
  const ui = window.__ENCIRRA__.ui.getState();
  const inc = window.__ENCIRRA__.sim.getState().incidents.find((i) => i.status !== 'resolved');
  if (inc) ui.selectIncident(inc.id);
  ui.setScreen('incidents');
});
await shot('incidents', 30, async (s) => {
  await s.park([900, 520]);
  await s.hold(0.3);
  await s.move('ack', 0.7);
  await s.hold(0.15);
  await s.click();
  await s.hold(0.35);
  await s.move('check1', 0.7, { dx: 0.3 });
  await s.click();
  await s.move('check2', 0.5, { dx: 0.3 });
  await s.click();
  await s.move('note', 0.6, { dx: 0.4 });
  await s.click();
  await s.type('UGV-01 dosimeter matches the fixed monitor. Holding stand-off.', 30);
  await s.key('Enter', '↵');
  await s.hold(2.4);
});

// 6 — Replay: scrub the twin timeline back through the response, then return to live
await page.evaluate(() => {
  const ui = window.__ENCIRRA__.ui.getState();
  ui.select(null);
  ui.setScreen('twin');
  window.__ENCIRRA_CAMERA__.setCameraPose([520, 330, 260], [150, 0, -150], false);
});
await page.clock.runFor(1200);
await shot('replay', 30, async (s) => {
  await s.park([1250, 640]);
  await s.hold(0.3);
  await s.move('scrub', 0.6, { dx: 0.985, dy: 0.5 });
  await page.mouse.down();
  s.clicks.push(s.frames.length);
  // where on the track the incident opened (minus two seconds)
  const frac = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Timeline scrubber"]');
    const lo = Number(el.getAttribute('aria-valuemin'));
    const hi = Number(el.getAttribute('aria-valuemax'));
    const inc = window.__ENCIRRA__.sim.getState().incidents[0];
    return Math.min(0.98, Math.max(0.02, (inc.createdAt - 2000 - lo) / (hi - lo)));
  });
  const from = await s.point('scrub', 0.985, 0.5);
  const to = await s.point('scrub', frac, 0.5);
  const n = Math.round(1.0 * s.fps);
  for (let i = 1; i <= n; i++) {
    const k = ease(i / n);
    s.cursor = [lerp(from[0], to[0], k), from[1]];
    await page.mouse.move(s.cursor[0], s.cursor[1]);
    await s.frame();
  }
  await page.mouse.up();
  await s.hold(0.35);
  await s.move('speed4', 0.5);
  await s.click();
  await s.move('play', 0.45);
  await s.click();
  await s.move([1250, 600], 0.6);
  await s.hold(1.6);
  await s.move('live', 0.55);
  await s.click();
  await s.hold(1.0);
});

process.stdout.write('\n');
console.log('done', Object.keys(manifest).map((k) => `${k}:${manifest[k].frames}`).join('  '));
await browser.close();

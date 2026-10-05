// Scripted capture of the five ENCIRRA review screenshots at 1600×900.
//
//   node tools/screenshots/capture.mjs [outDir] [--suffix=-final] [--url=http://localhost:5173/]
//
// Uses the locally installed Microsoft Edge through playwright-core (no browser download) with GPU
// acceleration. The app exposes small automation hooks on window (synthetic state only).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const outDir = resolve(args.find((a) => !a.startsWith('--')) ?? 'screenshots/phase-1');
const suffix = (args.find((a) => a.startsWith('--suffix=')) ?? '--suffix=').split('=')[1];
const base = (args.find((a) => a.startsWith('--url=')) ?? '--url=http://localhost:5173/').split('=')[1];
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--force-color-profile=srgb'],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
const page = await context.newPage();
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e}`));

const wait = (ms) => page.waitForTimeout(ms);
const ui = (fn, arg) => page.evaluate(fn, arg);

await page.goto(`${base}#/overview`, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

// wait for the opening sequence: scenario → correlation → UGV arrival → human validation
const t0 = Date.now();
await page.waitForFunction(() => {
  const s = window.__ENCIRRA__?.sim.getState();
  return !!s && s.observations.some((o) => o.status === 'validation');
}, null, { timeout: 180000, polling: 1000 });
console.log(`opening sequence reached validation after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await wait(4000);

const shot = async (name) => {
  const path = resolve(outDir, `${name}${suffix}.png`);
  await page.screenshot({ path });
  console.log('saved', path);
};

// 01 — overview during the mild multi-source event
await ui(() => {
  const s = window.__ENCIRRA__.ui.getState();
  s.setScreen('overview');
  s.select({ kind: 'sensor', id: 'RAD-S17' });
});
await wait(2500);
await shot('01-overview');

// 02 — digital twin: selected sensor, heat field, UGV, weather layer, inspector
await ui(() => {
  const s = window.__ENCIRRA__.ui.getState();
  s.setScreen('twin');
  s.setLayer('weather', true);
  s.setLayer('radiation', true);
  s.select({ kind: 'sensor', id: 'RAD-S17' });
  window.__ENCIRRA_CAMERA__.setCameraPose([-70, 175, -330], [175, 0, -115], false);
});
await wait(3500);
await shot('02-digital-twin');

// 03 — live feeds: thermal UGV feed as the main view
await ui(() => {
  const s = window.__ENCIRRA__.ui.getState();
  s.setLayer('weather', false);
  s.setFeedMain('UGV-01');
  s.setFeedMode('UGV-01', 'thermal');
  s.setScreen('feeds');
});
await wait(3500);
await shot('03-live-feeds');

// 04 — AI insights
await ui(() => {
  const s = window.__ENCIRRA__.ui.getState();
  const obs = window.__ENCIRRA__.sim.getState().observations[0];
  if (obs) s.selectObservation(obs.id);
  s.setScreen('insights');
});
await wait(3500);
await shot('04-ai-insights');

// 05 — incidents: operator acknowledges, then the response screen
await ui(() => {
  const st = window.__ENCIRRA__.sim.getState();
  const inc = st.incidents.find((i) => i.status !== 'resolved');
  if (inc) {
    window.__ENCIRRA__.engine.acknowledge(inc.id);
    window.__ENCIRRA__.engine.toggleChecklist(inc.id, 'supervisor');
    window.__ENCIRRA__.ui.getState().selectIncident(inc.id);
  }
  window.__ENCIRRA__.ui.getState().setScreen('incidents');
});
await wait(3500);
await shot('05-incidents');

console.log(logs.length ? `console:\n${logs.join('\n')}` : 'console: clean (no errors or warnings)');
await browser.close();

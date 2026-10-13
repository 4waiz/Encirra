#!/usr/bin/env node
// Captures the curated documentation screenshots (docs/screenshots/*.jpg) from the running dev server
// in Microsoft Edge. Drives the app through the development store hook (window.__encirra), so it needs
// `npm run dev:web` (dev build). Also records console errors per shot.
//
//   node scripts/qa/docs-shots.mjs [--url=http://127.0.0.1:5173/] [--size=1920x1080] [--out=docs/screenshots]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const root = resolve(import.meta.dirname, '..', '..');
const url = args.url ?? 'http://127.0.0.1:5173/';
const [W, H] = (args.size ?? '1920x1080').split('x').map(Number);
const out = resolve(root, args.out ?? 'docs/screenshots');
const only = args.only ? new Set(args.only.split(',')) : null;
mkdirSync(out, { recursive: true });

const store = (fn) => `(() => { const s = window.__encirra.useTwin.getState(); ${fn} })()`;
const SHOTS = [
  { name: 'live-twin-normal', steps: [store("s.setPage('live'); s.setStrategy('encirra'); s.setPlayhead(10); s.requestCamera({ shot: 'home' });")], settle: 6000 },
  { name: 'live-twin-fault', steps: [store("s.setPage('live'); s.setPlayhead(32); s.requestCamera({ shot: 'home' });")], settle: 6000 },
  { name: 'live-twin-recovery', steps: [store("s.setPage('live'); s.setPlayhead(50); s.requestCamera({ shot: 'home' });")], settle: 6000 },
  { name: 'grid-only-hospital-water-loss', steps: [store("s.setPage('live'); s.setStrategy('grid-only');"), store('s.setPlayhead(110);')], settle: 7000, after: store("s.setStrategy('encirra');") },
  { name: 'underground-xray', steps: [store("s.setPage('live'); s.setStrategy('encirra'); s.setPlayhead(40); s.setLayer('underground', true); s.requestCamera({ shot: 'underground-front' });")], settle: 7000, after: store("s.setLayer('underground', false); s.requestCamera({ shot: 'home' });") },
  { name: 'why-this-plan', steps: [store("s.setPage('live'); s.setPlayhead(50); s.setWhyPlanOpen(true);")], settle: 3000, after: store('s.setWhyPlanOpen(false);') },
  { name: 'analytics', steps: [store("s.setWhyPlanOpen(false); s.setPage('analytics'); s.setPlayhead(50);")], settle: 4000 },
  { name: 'scenarios', steps: [store("s.setPage('scenarios');")], settle: 3000 },
  { name: 'assets', steps: [store("s.setPage('assets');")], settle: 3000 },
  { name: 'reports', steps: [store("s.setPage('reports');")], settle: 3000, after: store("s.setPage('live');") },
];

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'], ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForFunction(() => window.__encirra?.useTwin?.getState().run, null, { timeout: 90000 });
await page.waitForTimeout(9000); // models, shaders, shadow warm-up
const report = [];
for (const shot of SHOTS) {
  if (only && !only.has(shot.name)) continue;
  const before = errors.length;
  for (const step of shot.steps) {
    await page.evaluate(step);
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(shot.settle);
  const file = join(out, `${shot.name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
  report.push({ shot: shot.name, file, newErrors: errors.slice(before) });
  console.log(`${shot.name.padEnd(32)} ${file}${errors.length > before ? `  (${errors.length - before} console errors)` : ''}`);
  if (shot.after) { await page.evaluate(shot.after); await page.waitForTimeout(800); }
}
await browser.close();
writeFileSync(resolve(root, 'tests/e2e/output/docs-shots-report.json'), JSON.stringify({ size: `${W}x${H}`, report, errors }, null, 2));
const benign = errors.filter((e) => !/status of 502|Bad Gateway/.test(e));
console.log(`console errors: ${errors.length} (${errors.length - benign.length} are the expected /api 502s when the solver is not running)`);
for (const e of benign.slice(0, 10)) console.log('  ', e.slice(0, 240));

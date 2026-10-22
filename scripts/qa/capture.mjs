#!/usr/bin/env node
// Visual QA capture: opens the running app in the locally installed Microsoft Edge (real GPU)
// and saves screenshots at the reference resolutions, plus any console errors.
//
//   node scripts/qa/capture.mjs [--url=http://127.0.0.1:5173/] [--sizes=1600x900,1920x1080]
//        [--out=tests/e2e/output/qa] [--prefix=app] [--wait=6000] [--query=view=scene]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const root = resolve(import.meta.dirname, '..', '..');
const base = args.url ?? 'http://127.0.0.1:5173/';
const url = args.query ? `${base}${base.includes('?') ? '&' : '?'}${args.query}` : base;
const sizes = (args.sizes ?? '1600x900,1920x1080').split(',').map((s) => s.split('x').map(Number));
const out = resolve(root, args.out ?? 'tests/e2e/output/qa');
const prefix = args.prefix ?? 'app';
const wait = Number(args.wait ?? 6000);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  ignoreDefaultArgs: ['--hide-scrollbars'],
});
const report = [];
for (const [w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: Number(args.dsf ?? 1) });
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => logs.push(`[goto] ${e.message}`));
  await page.waitForSelector('canvas', { timeout: 30000 }).catch(() => logs.push('[wait] no canvas'));
  await page.waitForTimeout(wait);
  if (args.eval) {
    // e.g. --eval="__encirra.useTwin.getState().setPlayhead(40)"  (dev builds expose window.__encirra)
    await page.evaluate(args.eval).catch((e) => logs.push(`[eval] ${e.message}`));
    await page.waitForTimeout(Number(args.settle ?? 4000));
  }
  const file = join(out, `${prefix}-${w}x${h}.png`);
  await page.screenshot({ path: file });
  const fps = await page
    .evaluate(
      () =>
        new Promise((res) => {
          let n = 0;
          const t0 = performance.now();
          const tick = () => {
            n++;
            if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
            else res(Math.round((n * 1000) / (performance.now() - t0)));
          };
          requestAnimationFrame(tick);
        }),
    )
    .catch(() => null);
  report.push({ size: `${w}x${h}`, file, fps, logs: logs.slice(0, 40) });
  await page.close();
}
await browser.close();
writeFileSync(join(out, `${prefix}-report.json`), JSON.stringify(report, null, 2));
for (const r of report) {
  console.log(`${r.size}  fps≈${r.fps}  ${r.file}`);
  for (const l of r.logs) console.log('   ', l.slice(0, 300));
}

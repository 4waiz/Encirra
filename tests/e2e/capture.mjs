#!/usr/bin/env node
// Visual QA capture: screenshots of the app at several viewport sizes (real scrollbars).
//   node tests/e2e/capture.mjs --sizes=1600x900,1920x1080 --pages=live,reports --frame=20 --tag=pass1
import { join } from 'node:path';
import { BASE_URL, ensureServer, launch, outDir, parseArgs, waitForApp } from './lib.mjs';

const args = parseArgs();
const sizes = String(args.sizes ?? '1600x900,1920x1080,1440x900,1366x768')
  .split(',')
  .map((s) => s.split('x').map(Number));
const pages = String(args.pages ?? 'live').split(',');
const frames = args.frame != null ? String(args.frame).split(',') : [null];
const tag = args.tag ? `-${args.tag}` : '';
const extra = args.query ? `&${args.query}` : '';

const server = await ensureServer();
const browser = await launch();
const shots = [];
try {
  for (const [w, h] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    for (const p of pages) {
      for (const f of frames) {
        const q = `?page=${p}${f != null ? `&frame=${f}` : ''}${extra}`;
        await page.goto(BASE_URL + q, { waitUntil: 'domcontentloaded' });
        await waitForApp(page);
        await page.waitForTimeout(Number(args.wait ?? 1800));
        const file = join(outDir, `${p}-${w}x${h}${f != null ? `-f${f}` : ''}${tag}.png`);
        await page.screenshot({ path: file });
        shots.push(file);
      }
    }
    if (errors.length) console.log(`[${w}x${h}] console errors:\n  ${errors.slice(0, 8).join('\n  ')}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.stop();
}
console.log(shots.join('\n'));

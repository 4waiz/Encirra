#!/usr/bin/env node
// Phone / tablet screenshots with touch emulation (isMobile + hasTouch) in Microsoft Edge.
//   node tests/e2e/capture-mobile.mjs [--sizes=390x844,844x390] [--query=frame=32] [--prefix=m]
//        [--dsf=3] [--wait=8000] [--eval="..."] [--settle=2000] [--click=testid,testid]
import { join } from 'node:path';
import { BASE_URL, ensureServer, launch, outDir, parseArgs, waitForApp } from './lib.mjs';

const args = parseArgs();
const sizes = String(args.sizes ?? '390x844').split(',').map((s) => s.split('x').map(Number));
const query = args.query ? `?${args.query}` : '';
const prefix = args.prefix ?? 'm';
const dsf = Number(args.dsf ?? 3);
const server = await ensureServer();
const browser = await launch();
try {
  for (const [w, h] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const logs = [];
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && logs.push(`[error] ${m.text()}`));
    await page.goto(`${BASE_URL}${query}`, { waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await page.waitForTimeout(Number(args.wait ?? 8000));
    if (args.eval) {
      await page.evaluate(args.eval).catch((e) => logs.push(`[eval] ${e.message}`));
      await page.waitForTimeout(Number(args.settle ?? 2000));
    }
    for (const id of String(args.click ?? '').split(',').filter(Boolean)) {
      await page.locator(`[data-testid="${id}"]`).first().click({ timeout: 5000 }).catch((e) => logs.push(`[click ${id}] ${String(e.message).split('\n')[0]}`));
      await page.waitForTimeout(700);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const file = join(outDir, 'qa', `${prefix}-${w}x${h}.png`);
    await page.screenshot({ path: file });
    console.log(`${w}x${h} @${dsf}x  overflow-x=${overflow}px  ${file}`);
    for (const l of logs.slice(0, 10)) console.log('   ', l.slice(0, 240));
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.stop();
}

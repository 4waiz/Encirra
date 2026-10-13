#!/usr/bin/env node
// Captures interactive UI states for visual QA: inspector, About, Why-this-plan (grid-only), demo steps.
//   node tests/e2e/capture-ui.mjs --size=1600x900
import { join } from 'node:path';
import { BASE_URL, ensureServer, launch, outDir, parseArgs, waitForApp } from './lib.mjs';

const args = parseArgs();
const [w, h] = String(args.size ?? '1600x900').split('x').map(Number);
const server = await ensureServer();
const browser = await launch();
const out = [];
try {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  const sel = (id) => page.locator(`[data-testid="${id}"]`);
  const shot = async (name) => {
    const file = join(outDir, `ui-${name}-${w}x${h}.png`);
    await page.screenshot({ path: file });
    out.push(file);
  };

  // inspector: hospital mid-outage
  await page.goto(`${BASE_URL}?frame=36`, { waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  await sel('fac-row-hospital').click();
  await sel('inspector').waitFor({ state: 'visible' });
  await page.waitForTimeout(800);
  await shot('inspector-hospital');
  await sel('fac-row-ps-2').click();
  await page.waitForTimeout(600);
  await shot('inspector-ps2');
  await page.keyboard.press('Escape');

  // Why this plan (grid-only) at the end
  await page.goto(`${BASE_URL}?frame=180&strategy=grid-only`, { waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  await sel('why-plan-btn').click();
  await sel('why-plan').waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  await shot('why-grid-only');
  await page.keyboard.press('Escape');

  // About
  await sel('about-open').click();
  await sel('about').waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  await shot('about');
  await page.keyboard.press('Escape');

  // Demo: intro, then skip to the cascade and the evaluation step
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  await sel('demo-start').click();
  await page.waitForTimeout(3000);
  await shot('demo-intro');
  await sel('demo-skip').click();
  await sel('demo-skip').click();
  await page.waitForTimeout(9000);
  await shot('demo-cascade');
  await sel('demo-skip').click();
  await page.waitForTimeout(19000);
  await shot('demo-evaluate');
  await sel('demo-exit').click();
} finally {
  await browser.close();
  await server.stop();
}
console.log(out.join('\n'));

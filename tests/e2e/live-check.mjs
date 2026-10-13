#!/usr/bin/env node
// Live-solver check (optional): requires the simulation service to be running (`npm run dev:sim`).
// Verifies that the app shows the replay immediately, upgrades to the live solver in the background,
// and that an edited parameter is recomputed by the service.
//   node tests/e2e/live-check.mjs
import { BASE_URL, ensureServer, launch, waitForApp } from './lib.mjs';

const health = await fetch('http://127.0.0.1:8000/api/health').then((r) => r.json()).catch(() => null);
if (!health?.ok) {
  console.log('SKIP  simulation service not running on :8000 (start it with `npm run dev:sim`)');
  process.exit(0);
}

const server = await ensureServer();
const browser = await launch();
let failed = 0;
const log = (ok, msg) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
};
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const status = () => page.locator('[data-testid="sim-status"]').innerText();
  const t0 = Date.now();
  await page.goto(`${BASE_URL}?page=scenarios`, { waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  log(true, `interactive after ${Date.now() - t0} ms (${(await status()).replace(/\s+/g, ' ')})`);
  await page.waitForFunction(() => /Live solver/.test(document.querySelector('[data-testid="sim-status"]')?.textContent ?? ''), null, { timeout: 180_000 });
  log(true, `upgraded to the live solver after ${Date.now() - t0} ms`);

  const tank = page.locator('label:has-text("Initial tank level") input');
  const before = await tank.inputValue();
  const next = before === '30' ? '40' : '30';
  await tank.fill(next);
  const t1 = Date.now();
  await page.locator('[data-testid="scenario-run"]').click();
  await page.waitForSelector('[data-testid="busy"]', { timeout: 5_000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('[data-testid="busy"]'), null, { timeout: 300_000 });
  const alerts = (await page.locator('[role="alert"]').allInnerTexts()).join(' | ');
  log(!alerts, `recompute finished in ${Date.now() - t1} ms${alerts ? ` with alert: ${alerts}` : ''}`);
  await page.locator('[data-testid="pb-play"]').click().catch(() => {});
  await page.locator('[data-testid="nav-scenarios"]').click();
  await page.waitForTimeout(600);
  const after = await page.locator('label:has-text("Initial tank level") input').inputValue();
  log(after === next, `run parameters now report tankInitPct = ${after} (requested ${next})`);
} catch (err) {
  log(false, String(err?.message ?? err).split('\n')[0]);
} finally {
  await browser.close();
  await server.stop();
}
process.exitCode = failed ? 1 : 0;

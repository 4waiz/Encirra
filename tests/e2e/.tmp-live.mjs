import { BASE_URL, launch, waitForApp } from './lib.mjs';
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errs = [];
page.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 200)));
page.on('pageerror', (e) => errs.push('pageerror ' + String(e).slice(0, 300)));
const t0 = Date.now();
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await waitForApp(page);
const first = await page.locator('[data-testid="sim-status"]').innerText();
console.log(`interactive after ${Date.now() - t0} ms: ${first.replace(/\s+/g, ' ')}`);
try {
  await page.waitForFunction(() => /Live solver/.test(document.querySelector('[data-testid="sim-status"]')?.textContent ?? ''), null, { timeout: 120000 });
  console.log(`live after ${Date.now() - t0} ms: ${(await page.locator('[data-testid="sim-status"]').innerText()).replace(/\s+/g, ' ')}`);
} catch (e) { console.log('never switched to live'); }
await page.goto(`${BASE_URL}?page=scenarios`, { waitUntil: 'domcontentloaded' });
await waitForApp(page);
await page.waitForFunction(() => /Live solver/.test(document.querySelector('[data-testid="sim-status"]')?.textContent ?? ''), null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(800);
const form = await page.locator('[data-testid="param-form"] input:not([disabled])').count();
console.log('editable inputs in live mode:', form, '| run button:', await page.locator('[data-testid="scenario-run"]').innerText());
await page.screenshot({ path: 'tests/e2e/output/live-mode-scenarios.png' });
console.log('errors:', errs.filter((e) => !/Failed to load resource/.test(e)).join(' | ') || 'none');
await browser.close();

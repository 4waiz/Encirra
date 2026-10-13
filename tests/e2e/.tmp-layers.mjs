import { BASE_URL, launch, waitForApp } from './lib.mjs';
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
let errs = [];
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text().split('\n')[0].slice(0, 120)));
page.on('pageerror', (e) => errs.push('pageerror ' + String(e).slice(0, 160)));
const report = (label) => { console.log(`${label}: ${errs.length ? [...new Set(errs)].join(' | ') : 'no errors'}`); errs = []; };
await page.goto(`${BASE_URL}?frame=36`, { waitUntil: 'domcontentloaded' });
await waitForApp(page); await page.waitForTimeout(2500); report('load');
for (const l of ['underground', 'labels', 'skyline', 'electrical', 'water']) {
  await page.locator(`[data-testid="layer-${l}"]`).click(); await page.waitForTimeout(1500); report(`toggle ${l}`);
  await page.locator(`[data-testid="layer-${l}"]`).click(); await page.waitForTimeout(800); report(`toggle ${l} back`);
}
await page.locator('[data-testid="auto-orbit"]').click(); await page.waitForTimeout(1500); report('auto-orbit');
await page.locator('[data-testid="focus-menu-btn"]').click(); await page.locator('text=Underground · West main').click(); await page.waitForTimeout(2500); report('shot underground-west');
await page.locator('[data-testid="nav-scenarios"]').click(); await page.waitForTimeout(1500); report('scenarios page');
await browser.close();

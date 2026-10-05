// Visual smoke test of each scenario preset (writes review images; not part of the deliverable set).
//   node tools/screenshots/scenario-check.mjs <outDir>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? 'scenario-check');
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
page.on('pageerror', (e) => logs.push(String(e)));
await page.goto('http://localhost:5173/#/twin', { waitUntil: 'networkidle' });
await page.evaluate(() => {
  localStorage.setItem('encirra-ui-v1', JSON.stringify({ state: { settings: { quality: 'high', labels: true, reduceMotion: false, autoplay: false, palette: 'ironbow' } }, version: 0 }));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(6000);

const run = async (name, preset, locationId, pose, waitMs, screen = 'twin', extra) => {
  await page.evaluate(
    ({ preset, locationId, pose, screen }) => {
      const E = window.__ENCIRRA__;
      E.engine.trigger({ preset, severity: 'moderate', locationId, windDir: 315, windSpeed: 12, duration: 0 });
      const ui = E.ui.getState();
      ui.setScreen(screen);
      ['radiation', 'chemical', 'biological', 'assets', 'weather'].forEach((l) => ui.setLayer(l, true));
      if (pose) window.__ENCIRRA_CAMERA__.setCameraPose(pose[0], pose[1], false);
    },
    { preset, locationId, pose, screen },
  );
  await page.waitForTimeout(waitMs);
  if (extra) await page.evaluate(extra);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(outDir, `${name}.png`) });
  console.log('saved', name);
};

await run('chemical', 'chemical', 'SERVICE', [[700, 330, 380], [480, 0, 130]], 40000);
await run('chemical-wind-change', 'chemical', 'SERVICE', [[700, 330, 380], [480, 0, 130]], 25000, 'twin', () => {
  window.__ENCIRRA__.engine.setWind(200, 18);
});
await run('biological', 'biological', 'ADMIN', [[-200, 330, 380], [-470, 0, 110]], 45000);
await run('thermal', 'thermal', 'SWITCHYARD', [[260, 260, 420], [40, 0, 190]], 70000);
await run('degraded', 'degraded', 'U1-WEST', null, 25000, 'overview');
console.log(logs.length ? `errors:\n${logs.join('\n')}` : 'no console errors');
await browser.close();

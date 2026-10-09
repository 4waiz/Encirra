// Look-dev captures: the immersive 3D twin from a few fixed camera poses (no UI chrome), for judging
// materials, lighting and terrain between iterations.
//   node tools/screenshots/look.mjs [outDir] [--url=http://localhost:5173/] [--only=home,unit]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const outDir = resolve(args.find((a) => !a.startsWith('--')) ?? 'look');
const base = (args.find((a) => a.startsWith('--url=')) ?? '--url=http://localhost:5173/').split('=')[1];
const only = (args.find((a) => a.startsWith('--only=')) ?? '').split('=')[1]?.split(',').filter(Boolean);
mkdirSync(outDir, { recursive: true });

const POSES = {
  home: [[-970, 505, -1110], [30, 0, -40]],
  unit: [[-40, 130, -360], [110, 12, -100]],
  yard: [[600, 120, 430], [430, 0, 160]],
  inland: [[-200, 320, -800], [150, 0, 1400]],
  dunes: [[-500, 180, 900], [400, 0, 2400]],
  coast: [[-1500, 260, -900], [-700, 0, -150]],
  containers: [[600, 45, 150], [541, 0, 233]],
};

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--force-color-profile=srgb'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(m.text()));
page.on('pageerror', (e) => logs.push(String(e)));
await page.goto(`${base}#/twin`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ENCIRRA__?.sim.getState().ready, null, { timeout: 30000 });
await page.evaluate(() => {
  const s = window.__ENCIRRA__.ui.getState();
  s.setSettings({ autoplay: false, labels: false });
  window.__ENCIRRA__.engine.cancelAutoplay();
  s.setTwinImmersive(true);
  s.setLayer('assets', false);
});
await page.waitForTimeout(3500);
for (const [name, [pos, target]] of Object.entries(POSES)) {
  if (only && !only.includes(name)) continue;
  await page.evaluate(([p, t]) => window.__ENCIRRA_CAMERA__.setCameraPose(p, t, false), [pos, target]);
  await page.waitForTimeout(1600);
  // hide every DOM overlay so the frame shows the render only
  await page.addStyleTag({ content: 'body *{visibility:hidden !important} canvas{visibility:visible !important}' }).catch(() => {});
  await page.screenshot({ path: resolve(outDir, `${name}.png`) });
  await page.evaluate(() => document.querySelectorAll('style').forEach((s) => s.textContent?.includes('visibility:hidden !important') && s.remove()));
  console.log('saved', name);
}
console.log(logs.length ? `console:\n${[...new Set(logs)].join('\n')}` : 'console clean');
await browser.close();

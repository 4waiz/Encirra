import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:5173/';
const reload = !process.argv.includes('--noreload');
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const t0 = Date.now();
const out = [];
page.on('console', (m) => { const t = m.text(); if (/GL_INVALID|too many|Mismatch/.test(t)) out.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${t.slice(0, 150)}`); });
await page.goto(`${base}#/overview`, { waitUntil: 'networkidle' });
console.log('loaded', ((Date.now() - t0) / 1000).toFixed(1));
if (reload) {
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  console.log('reloaded', ((Date.now() - t0) / 1000).toFixed(1));
}
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => ({ ready: !!window.__ENCIRRA__?.sim.getState().ready, fps: Math.round(window.__ENCIRRA_RENDER__?.perfStats.fps ?? 0), tex: window.__ENCIRRA_RENDER__?.perfStats.textures }));
  console.log(((Date.now() - t0) / 1000).toFixed(1), JSON.stringify(st), 'errors so far', out.length);
}
console.log(out.slice(0, 4).join('\n'));
await browser.close();

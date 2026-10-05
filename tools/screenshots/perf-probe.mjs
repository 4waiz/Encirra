// Measures real frame rate, render statistics and GPU memory in Microsoft Edge via playwright-core
// (no browser download), then cycles every screen several times to check that render targets,
// textures and geometries return to a steady state (no leaks).
// Usage: node tools/screenshots/perf-probe.mjs [url] [--headed]
import { chromium } from 'playwright-core';

const url = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5173/#/overview';
const headed = process.argv.includes('--headed');

const browser = await chromium.launch({
  channel: 'msedge',
  headless: !headed,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader=false'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(12000);

const measure = () =>
  page.evaluate(async () => {
    const c = document.querySelector('canvas');
    const gl = c?.getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    let n = 0;
    let worst = 0;
    let last = performance.now();
    const t0 = last;
    await new Promise((res) => {
      const f = () => {
        const now = performance.now();
        worst = Math.max(worst, now - last);
        last = now;
        n++;
        if (now - t0 < 4000) requestAnimationFrame(f);
        else res();
      };
      requestAnimationFrame(f);
    });
    const R = window.__ENCIRRA_RENDER__;
    const p = R ? { ...R.perfStats } : {};
    return {
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a',
      rafPerSec: +(n / 4).toFixed(1),
      worstFrameMs: +worst.toFixed(1),
      frameMs: +p.frameMs?.toFixed(2),
      drawCalls: p.drawCalls,
      triangles: p.triangles,
      renderScale: p.renderScale,
      feedTargets: p.feedTargets,
      textures: p.textures,
      geometries: p.geometries,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    };
  });

const report = { overview: await measure() };
const screens = ['twin', 'feeds', 'insights', 'incidents', 'overview'];
for (let round = 1; round <= 3; round++) {
  for (const s of screens) {
    await page.evaluate((sc) => window.__ENCIRRA__.ui.getState().setScreen(sc), s);
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(1500);
  report[`overview after cycle ${round}`] = await measure();
}
await page.evaluate(() => window.__ENCIRRA__.ui.getState().setScreen('feeds'));
await page.waitForTimeout(2500);
report.feeds = await measure();
console.log(JSON.stringify({ ...report, errors }, null, 2));
await browser.close();

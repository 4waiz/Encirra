// Measures real frame rate + GPU info in Microsoft Edge via playwright-core (no browser download).
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
const result = await page.evaluate(async () => {
  const c = document.querySelector('canvas');
  const gl = c?.getContext('webgl2');
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
  let n = 0;
  const t0 = performance.now();
  await new Promise((res) => {
    const f = () => {
      n++;
      if (performance.now() - t0 < 4000) requestAnimationFrame(f);
      else res();
    };
    requestAnimationFrame(f);
  });
  const R = window.__ENCIRRA_RENDER__;
  return {
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a',
    rafPerSec: n / 4,
    perf: R ? { ...R.perfStats } : null,
  };
});
console.log(JSON.stringify({ ...result, errors }, null, 2));
await browser.close();

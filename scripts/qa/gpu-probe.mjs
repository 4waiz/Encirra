#!/usr/bin/env node
// Reports which GPU Edge renders with and the frame rate of the Live Twin.
//   node scripts/qa/gpu-probe.mjs [--url=http://127.0.0.1:5173/] [--low-power] [--size=1920x1080] [--quality=high|medium|low]
// --low-power asks Chromium to prefer the integrated GPU (where the OS honours it).
import { chromium } from 'playwright-core';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || 'true']; }));
const base = args.url ?? 'http://127.0.0.1:5173/';
const url = args.quality ? `${base}${base.includes('?') ? '&' : '?'}quality=${args.quality}` : base;
const [W, H] = (args.size ?? '1920x1080').split('x').map(Number);
const flags = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
if (args['low-power']) flags.push('--force_low_power_gpu');
if (args['high-perf']) flags.push('--force_high_performance_gpu');

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: flags });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForSelector('canvas', { timeout: 60000 });
await page.waitForTimeout(12000);
const info = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  const frames = [];
  await new Promise((res) => {
    let last = performance.now();
    const t0 = last;
    const tick = (now) => {
      frames.push(now - last);
      last = now;
      if (now - t0 < 5000) requestAnimationFrame(tick);
      else res();
    };
    requestAnimationFrame(tick);
  });
  frames.shift();
  const sorted = [...frames].sort((a, b) => a - b);
  const mean = frames.reduce((s, x) => s + x, 0) / frames.length;
  const tier = window.__encirra?.useSceneQuality?.getState?.().tier ?? 'n/a';
  return { renderer, fps: Math.round(1000 / mean), p95ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10, tier };
});
console.log(JSON.stringify({ url, size: `${W}x${H}`, flags: flags.slice(3), ...info }));
await browser.close();

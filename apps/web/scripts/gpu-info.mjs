#!/usr/bin/env node
/** Prints the WebGL renderer that headless Edge uses for the QA captures (and the GPU flags tried). */
import { chromium } from 'playwright-core';

const variants = [
  ['default', ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']],
  ['high-perf', ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu']],
];
for (const [name, args] of variants) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args });
  const page = await browser.newPage();
  await page.goto('about:blank');
  const info = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { powerPreference: 'high-performance' });
    if (!gl) return 'no webgl2';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  console.log(`${name}: ${info}`);
  await browser.close();
}

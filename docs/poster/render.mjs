#!/usr/bin/env node
// Renders docs/poster/poster.html to an A1 portrait PDF (and a PNG preview) with Microsoft Edge.
//   node docs/poster/render.mjs [--out="docs/poster/Awaiz Ahmed.pdf"]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const here = import.meta.dirname;
const outArg = process.argv.find((a) => a.startsWith('--out='));
const out = resolve(outArg ? outArg.slice(6) : resolve(here, 'Awaiz Ahmed.pdf'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
// 594 × 841 mm at 96 dpi ≈ 2245 × 3179 CSS px
const page = await browser.newPage({ viewport: { width: 2245, height: 3179 } });
await page.goto(pathToFileURL(resolve(here, 'poster.html')).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const overflow = await page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('section, header, footer, .hero')) {
    if (el.scrollHeight > el.clientHeight + 2) bad.push(el.querySelector('h2')?.textContent ?? el.tagName);
  }
  const main = document.querySelector('main');
  const cols = [...document.querySelectorAll('.col')].map((c) => c.scrollHeight - main.clientHeight);
  return { bad, cols };
});
await page.screenshot({ path: resolve(here, 'poster-preview.png'), scale: 'css' });
await page.pdf({ path: out, width: '594mm', height: '841mm', printBackground: true, pageRanges: '1' });
await browser.close();
console.log(out);
console.log('column overflow px (≤0 is fine):', overflow.cols.join(', '), overflow.bad.length ? `clipped: ${overflow.bad.join(' | ')}` : '');

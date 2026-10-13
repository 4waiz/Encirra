#!/usr/bin/env node
/**
 * Writes a downscaled JPEG of the reference image (and optional crops) for side-by-side review.
 *   node apps/web/scripts/ref-preview.mjs [width]
 */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const out = join(repo, 'tests', 'e2e', 'output');
mkdirSync(out, { recursive: true });
const src = join(repo, 'Encirra Smart City Resilience Dashboard.png');
const width = Number(process.argv[2] ?? 1600);
const b64 = readFileSync(src).toString('base64');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const crops = [
  ['ref', 0, 0, 1, 1],
  ['ref-mid', 0.15, 0.25, 0.85, 0.75],
];
for (const [name, x0, y0, x1, y1] of crops) {
  const data = await page.evaluate(
    async ({ b64, width, x0, y0, x1, y1 }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const sw = (x1 - x0) * img.width;
      const sh = (y1 - y0) * img.height;
      const w = Math.round(Math.min(width, sw));
      const h = Math.round((w * sh) / sw);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, x0 * img.width, y0 * img.height, sw, sh, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.85).split(',')[1];
    },
    { b64, width, x0, y0, x1, y1 },
  );
  const f = join(out, `${name}.jpg`);
  writeFileSync(f, Buffer.from(data, 'base64'));
  console.log(f);
}
await browser.close();

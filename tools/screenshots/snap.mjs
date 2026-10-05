// Quick progress screenshot: node tools/screenshots/snap.mjs <out.png> [hash] [waitMs] [width] [height]
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? 'snap.png';
const hash = process.argv[3] ?? '#/overview';
const wait = Number(process.argv[4] ?? 45000);
const width = Number(process.argv[5] ?? 1600);
const height = Number(process.argv[6] ?? 900);

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://localhost:5173/${hash}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(wait);
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out, errors.length ? `errors: ${errors.join(' | ')}` : 'no errors');

// Quick progress screenshot: node tools/screenshots/snap.mjs <out.png> [hash] [waitMs]
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? 'snap.png';
const hash = process.argv[3] ?? '#/overview';
const wait = Number(process.argv[4] ?? 45000);

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`http://localhost:5173/${hash}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(wait);
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);

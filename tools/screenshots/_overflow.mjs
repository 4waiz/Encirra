import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
for (const [w, h] of [[1366, 768], [1600, 900], [1920, 1080]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto('http://localhost:5173/#/overview', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__ENCIRRA__?.sim.getState().ready, null, { timeout: 30000 });
  await page.waitForTimeout(4000);
  const r = await page.evaluate(() => {
    const H = innerHeight;
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect();
      if (b.bottom > H + 0.5 && b.height > 0) out.push({ tag: el.tagName, cls: (el.className?.baseVal ?? el.className ?? '').toString().slice(0, 90), bottom: Math.round(b.bottom), top: Math.round(b.top), h: Math.round(b.height), text: (el.textContent || '').trim().slice(0, 40) });
    }
    return { sh: document.documentElement.scrollHeight, H, out: out.slice(0, 12) };
  });
  console.log(w, h, 'scrollHeight', r.sh);
  for (const o of r.out) console.log('  ', JSON.stringify(o));
  await page.close();
}
await browser.close();

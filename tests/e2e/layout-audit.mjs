#!/usr/bin/env node
// Layout audit across viewport sizes (real scrollbars): reports cards whose content overflows their
// box, header blocks that collide with the top cards, and controls that leave their region.
//   node tests/e2e/layout-audit.mjs [--sizes=1280x720,1366x768,...] [--frames=0,44,180]
import { BASE_URL, ensureServer, launch, parseArgs, waitForApp } from './lib.mjs';

const args = parseArgs();
const sizes = String(args.sizes ?? '1280x720,1366x768,1440x900,1600x900,1920x1080')
  .split(',')
  .map((s) => s.split('x').map(Number));
const frames = String(args.frames ?? '0,36,44,180').split(',');
const strategies = String(args.strategies ?? 'encirra,none').split(',');

const AUDIT = () => {
  const issues = [];
  const box = (el) => el.getBoundingClientRect();
  const name = (el) => el.getAttribute('data-testid') || el.className.toString().slice(0, 40);
  const cards = [...document.querySelectorAll('[data-testid="live-twin"] section > .enc-panel')];
  for (const c of cards) {
    if (c.scrollHeight > c.clientHeight + 1) issues.push(`overflow-y ${name(c)} ${c.scrollHeight}>${c.clientHeight}`);
    if (c.scrollWidth > c.clientWidth + 1) issues.push(`overflow-x ${name(c)} ${c.scrollWidth}>${c.clientWidth}`);
    // direct children escaping the card box
    const cb = box(c);
    for (const k of c.querySelectorAll('*')) {
      const r = box(k);
      if (r.width === 0 || r.height === 0) continue;
      if (getComputedStyle(k).position === 'absolute' && k.closest('svg')) continue;
      if (r.bottom > cb.bottom + 1.5 || r.right > cb.right + 1.5) {
        const clipped = k.closest('.overflow-hidden, .overflow-y-auto, .overflow-auto, svg, .recharts-wrapper');
        if (!clipped || clipped === k) issues.push(`escapes ${name(c)}: <${k.tagName.toLowerCase()}> "${(k.textContent || '').trim().slice(0, 30)}"`);
        break;
      }
    }
  }
  const header = document.querySelector('header');
  const top = document.querySelector('[data-testid="live-twin"] section');
  if (header && top) {
    const t = box(top).top;
    for (const el of header.querySelectorAll('.enc-panel')) if (box(el).bottom > t + 0.5) issues.push(`header block overlaps top cards by ${Math.round(box(el).bottom - t)}px`);
  }
  const bar = document.querySelector('[data-testid="playback-bar"]');
  if (bar) {
    if (bar.scrollWidth > bar.clientWidth + 1) issues.push(`playback bar content overflow ${bar.scrollWidth}>${bar.clientWidth}`);
    const b = box(bar);
    if (b.left < 0 || b.right > window.innerWidth) issues.push('playback bar outside viewport');
    for (const k of bar.children) {
      const r = box(k);
      if (r.right > b.right + 1) issues.push(`playback control clipped: ${name(k)}`);
    }
  }
  const tb = document.querySelector('[data-testid="scene-toolbar"]');
  if (tb && bar && box(tb).bottom > box(bar).top) issues.push('toolbar overlaps playback bar');
  if (document.documentElement.scrollWidth > window.innerWidth) issues.push('page scrolls horizontally');
  return issues;
};

const server = await ensureServer();
const browser = await launch();
let total = 0;
try {
  for (const [w, h] of sizes) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    for (const st of strategies) {
      for (const f of frames) {
        await page.goto(`${BASE_URL}?frame=${f}&strategy=${st}`, { waitUntil: 'domcontentloaded' });
        await waitForApp(page);
        await page.waitForTimeout(500);
        const issues = await page.evaluate(AUDIT);
        total += issues.length;
        console.log(`${w}x${h} ${st} f${f}: ${issues.length ? issues.join(' | ') : 'OK'}`);
      }
    }
    await page.context().close();
  }
} finally {
  await browser.close();
  await server.stop();
}
console.log(total ? `\n${total} layout issue(s)` : '\nNo layout issues');
process.exitCode = total ? 1 : 0;

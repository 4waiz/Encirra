#!/usr/bin/env node
// Layout audit across viewport sizes (real scrollbars): reports cards whose content overflows their
// box sideways, rails that need scrolling on tall screens, header/bottom-bar collisions, overlapping
// scrubber labels and controls that leave their region.
//   node tests/e2e/layout-audit.mjs [--sizes=1280x720,1366x768,...] [--frames=0,44,180]
import { BASE_URL, ensureServer, launch, parseArgs, waitForApp } from './lib.mjs';

const args = parseArgs();
const sizes = String(args.sizes ?? '1280x720,1366x768,1440x900,1600x900,1920x1080')
  .split(',')
  .map((s) => s.split('x').map(Number));
const frames = String(args.frames ?? '0,36,44,180').split(',');
const strategies = String(args.strategies ?? 'encirra,grid-only,none').split(',');

const AUDIT = () => {
  const issues = [];
  const box = (el) => el.getBoundingClientRect();
  const name = (el) => el.getAttribute('data-testid') || el.className.toString().slice(0, 40);
  const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  // rail modules: no horizontal overflow, nothing escaping sideways
  const modules = [...document.querySelectorAll('[data-testid="live-twin"] aside > .glass')];
  for (const m of modules) {
    if (m.scrollWidth > m.clientWidth + 1) issues.push(`overflow-x ${name(m)} ${m.scrollWidth}>${m.clientWidth}`);
    const mb = box(m);
    for (const k of m.querySelectorAll('*')) {
      const r = box(k);
      if (r.width === 0 || r.height === 0 || k.closest('svg')) continue;
      if (r.right > mb.right + 1.5 || r.left < mb.left - 1.5) {
        const clipped = k.closest('.overflow-hidden, .overflow-y-auto, .overflow-auto, .rail-scroll, .truncate, .recharts-wrapper');
        if (!clipped || clipped === k) issues.push(`escapes ${name(m)}: <${k.tagName.toLowerCase()}> "${(k.textContent || '').trim().slice(0, 30)}"`);
        break;
      }
    }
  }
  // rails: never scroll sideways; on tall viewports (>= 1050 px) the story must fit without scrolling
  for (const id of ['rail-left', 'rail-right']) {
    const r = document.querySelector(`[data-testid="${id}"]`);
    if (!r || getComputedStyle(r).opacity === '0') continue;
    if (r.scrollWidth > r.clientWidth + 1) issues.push(`${id} scrolls horizontally`);
    if (window.innerHeight >= 1050 && r.scrollHeight > r.clientHeight + 2) issues.push(`${id} needs scrolling at this height (${r.scrollHeight}>${r.clientHeight})`);
  }
  // header: title, nav and context must not collide; the header must not cover the rails
  const header = document.querySelector('header .glass');
  if (header) {
    const parts = [...header.children];
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (overlap(box(parts[i]), box(parts[j]))) issues.push(`header parts overlap: ${i} × ${j}`);
    if (header.scrollWidth > header.clientWidth + 1) issues.push('header content overflow');
    for (const id of ['sim-status', 'nav', 'sim-clock']) {
      const el = header.querySelector(`[data-testid="${id}"]`);
      if (el && el.scrollWidth > el.clientWidth + 1) issues.push(`header ${id} content overflows its box`);
    }
    const ctx = header.lastElementChild;
    if (ctx && ctx.scrollWidth > ctx.clientWidth + 1) issues.push('header context group overflows');
    const rail = document.querySelector('[data-testid="rail-left"]');
    if (rail && box(header).bottom > box(rail).top + 0.5) issues.push('header overlaps the rails');
  }
  // bottom bar: content fits, controls inside, playback group and toolbar side by side
  const bar = document.querySelector('[data-testid="bottom-bar"]');
  if (bar) {
    if (bar.scrollWidth > bar.clientWidth + 1) issues.push(`bottom bar content overflow ${bar.scrollWidth}>${bar.clientWidth}`);
    const b = box(bar);
    if (b.left < 0 || b.right > window.innerWidth + 0.5) issues.push('bottom bar outside viewport');
    for (const k of bar.querySelectorAll('button, select, input')) {
      const r = box(k);
      if (r.width && (r.right > b.right + 1 || r.left < b.left - 1)) issues.push(`bottom bar control clipped: ${name(k)}`);
    }
    const pb = document.querySelector('[data-testid="playback-bar"]');
    const tb = document.querySelector('[data-testid="scene-toolbar"]');
    if (pb && tb && overlap(box(pb), box(tb))) issues.push('toolbar overlaps playback controls');
    const scrub = document.querySelector('[data-testid="scrubber"]');
    if (scrub && box(scrub).width < 120) issues.push(`scrubber too narrow (${Math.round(box(scrub).width)} px)`);
  }
  // scrubber marker labels must not overlap each other
  const marks = [...document.querySelectorAll('[data-testid^="scrub-mark-"]')].map(box);
  for (let i = 0; i < marks.length; i++) for (let j = i + 1; j < marks.length; j++) if (overlap(marks[i], marks[j])) issues.push('scrubber marker labels overlap');
  // twin centre keeps a usable size
  const safe = document.querySelector('[data-testid="twin-safe-area"]');
  if (safe && (box(safe).width < 480 || box(safe).height < 360)) issues.push(`twin area small ${Math.round(box(safe).width)}x${Math.round(box(safe).height)}`);
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
        await page.goto(`${BASE_URL}?frame=${f}&strategy=${st}&welcome=0`, { waitUntil: 'domcontentloaded' });
        await waitForApp(page);
        await page.waitForTimeout(900); // rail entrance animation
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

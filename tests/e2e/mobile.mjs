#!/usr/bin/env node
// Phone / tablet checks with touch emulation (isMobile + hasTouch, 3× DPR) in headless Edge.
// Used by `npm run test:e2e` (after the desktop smoke suite); standalone: node tests/e2e/mobile.mjs
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BASE_URL, ensureServer, launch, outDir, waitForApp } from './lib.mjs';

const CREDIT = { text: 'Built by Team Kanban', href: 'https://kanbanstudios.ae/team-kanban' };
const PHONE = { width: 390, height: 844 };

/** Facts every phone view must satisfy: no sideways scroll, touch targets, legible text. */
const PHONE_FACTS = () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  };
  const small = [];
  for (const b of document.querySelectorAll('[data-testid="m-header"] button, [data-testid="m-controls"] button, [data-testid="m-controls"] input, [data-testid="m-sheet-tabs"] button')) {
    if (!vis(b)) continue;
    const r = b.getBoundingClientRect();
    if (b.getAttribute('data-testid') === 'm-sheet-handle') continue; // grab bar: the whole strip drags
    if (r.height < 43.5 || (r.width < 43.5 && b.tagName !== 'INPUT')) small.push(`${b.getAttribute('aria-label') || b.textContent.trim().slice(0, 16)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  let minFont = 99;
  let minEl = '';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode;
    const el = t.parentElement;
    if (!el || !t.textContent.trim() || el.closest('svg, .sr-only, [aria-hidden="true"], [data-testid="twin-canvas"]') || !vis(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < minFont) {
      minFont = fs;
      minEl = t.textContent.trim().slice(0, 24);
    }
  }
  return { overflowX: document.documentElement.scrollWidth - innerWidth, small, minFont, minEl };
};

export async function runMobile({ baseUrl = BASE_URL } = {}) {
  const results = [];
  const check = async (name, fn) => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      results.push({ name: `[mobile] ${name}`, ok: true, ms: Date.now() - t0, detail: detail ?? '' });
    } catch (err) {
      results.push({ name: `[mobile] ${name}`, ok: false, ms: Date.now() - t0, detail: String(err?.message ?? err).split('\n')[0] });
    }
  };
  const browser = await launch();
  const errors = [];
  const newPage = async (viewport) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    return page;
  };
  const shot = (page, name) => page.screenshot({ path: join(outDir, `mobile-${name}.png`) });

  try {
    const page = await newPage(PHONE);
    const sel = (id) => page.locator(`[data-testid="${id}"]`);

    await check('phone portrait loads the touch layout with the welcome sheet', async () => {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await waitForApp(page);
      if (!(await sel('m-header').isVisible())) throw new Error('no phone header');
      if (await page.locator('header [data-testid="nav"]').count()) throw new Error('desktop nav rendered on a phone');
      await sel('welcome').waitFor({ state: 'visible', timeout: 8_000 });
      const wb = await sel('welcome').boundingBox();
      if (Math.round(wb.y + wb.height) < PHONE.height - 2) throw new Error('welcome is not docked at the bottom');
      await sel('welcome-explore').tap();
      await sel('welcome').waitFor({ state: 'hidden', timeout: 3_000 });
      return `welcome sheet ${Math.round(wb.width)}×${Math.round(wb.height)} docked at the bottom; dismissed`;
    });

    await check('no horizontal overflow, touch targets ≥ 44 px, text ≥ 12 px', async () => {
      await page.waitForTimeout(4500); // let the assembly intro and the module entrance settle
      const f = await page.evaluate(PHONE_FACTS);
      if (f.overflowX > 0) throw new Error(`page scrolls sideways by ${f.overflowX}px`);
      if (f.small.length) throw new Error(`small targets: ${f.small.slice(0, 4).join(', ')}`);
      if (f.minFont < 12) throw new Error(`text ${f.minFont}px ("${f.minEl}")`);
      const band = await sel('twin-safe-area').boundingBox();
      const share = band.height / PHONE.height;
      if (share < 0.5 || share > 0.62) throw new Error(`twin band ${(share * 100).toFixed(0)}% of the height`);
      await shot(page, '01-peek');
      return `twin ${(share * 100).toFixed(0)}% of the screen; min text ${f.minFont}px`;
    });

    await check('bottom sheet snaps peek → half → full → peek and drags', async () => {
      const snaps = [await sel('m-sheet').getAttribute('data-snap')];
      for (let i = 0; i < 3; i++) {
        await sel('m-sheet-handle').tap();
        await page.waitForTimeout(450);
        snaps.push(await sel('m-sheet').getAttribute('data-snap'));
      }
      if (snaps.join(',') !== 'peek,half,full,peek') throw new Error(snaps.join(','));
      const peek = await sel('m-peek').boundingBox();
      await page.mouse.move(peek.x + peek.width / 2, peek.y + 10);
      await page.mouse.down();
      await page.mouse.move(peek.x + peek.width / 2, peek.y - 120, { steps: 8 });
      await page.mouse.move(peek.x + peek.width / 2, peek.y - 260, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      const dragged = await sel('m-sheet').getAttribute('data-snap');
      if (dragged === 'peek') throw new Error('drag did not move the sheet');
      await shot(page, '02-dragged');
      await sel('m-sheet-handle').tap(); // back towards peek
      if (dragged === 'half') {
        await page.waitForTimeout(400);
        await sel('m-sheet-handle').tap();
      }
      await page.waitForTimeout(400);
      return `${snaps.join(' → ')}; drag → ${dragged}`;
    });

    await check('Story / Live tabs switch sections', async () => {
      await page.locator('[data-testid="m-sheet-tabs"] [data-value="live"]').tap();
      await sel('power-panel').waitFor({ state: 'visible', timeout: 3_000 });
      const snap = await sel('m-sheet').getAttribute('data-snap');
      await shot(page, '03-live');
      await page.locator('[data-testid="m-sheet-tabs"] [data-value="story"]').tap();
      await sel('impact-card').waitFor({ state: 'visible', timeout: 3_000 });
      return `Live shows telemetry (sheet ${snap}); Story shows the impact card`;
    });

    await check('strategy switch from the control row (end of run)', async () => {
      await page.goto(`${baseUrl}?frame=99999`, { waitUntil: 'domcontentloaded' });
      await waitForApp(page);
      const enc = await sel('m-peek-title').innerText();
      await page.locator('[data-testid="m-strategy"] [data-value="grid-only"]').tap();
      await page.waitForFunction((t) => document.querySelector('[data-testid="m-peek-title"]')?.textContent !== t, enc, { timeout: 5_000 });
      const grid = await sel('m-peek-title').innerText();
      const impact = await sel('m-peek-impact').innerText();
      await shot(page, '04-grid-only');
      await page.locator('[data-testid="m-strategy"] [data-value="encirra"]').tap();
      return `encirra "${enc}" → grid-only "${grid}" · peek: ${impact.replace(/\s+/g, ' ')}`;
    });

    await check('menu sheet: five tabs, pages single column, credit link reachable', async () => {
      const visited = [];
      for (const id of ['analytics', 'scenarios', 'assets', 'reports', 'live']) {
        await sel('m-menu-btn').tap();
        await sel('m-menu').waitFor({ state: 'visible', timeout: 3_000 });
        await sel(`nav-${id}`).tap();
        await (id === 'live' ? sel('m-sheet') : sel(`page-${id}`)).waitFor({ state: 'visible', timeout: 8_000 });
        await page.waitForTimeout(500);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (over > 0) throw new Error(`${id} scrolls sideways by ${over}px`);
        if (id !== 'live') await shot(page, `05-${id}`);
        visited.push(id);
      }
      await sel('m-menu-btn').tap();
      const link = page.locator('[data-testid="m-menu"] [data-testid="credit-link"]');
      await link.waitFor({ state: 'visible', timeout: 3_000 });
      const [text, href, target, rel] = await Promise.all([link.innerText(), link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel')]);
      if (text.trim() !== CREDIT.text || href !== CREDIT.href || target !== '_blank' || !/noopener/.test(rel) || !/noreferrer/.test(rel)) throw new Error(`credit link ${text} ${href} ${target} ${rel}`);
      const lb = await link.boundingBox();
      if (lb.height < 43.5) throw new Error('credit link target too small');
      await shot(page, '06-menu');
      await page.keyboard.press('Escape');
      await sel('m-menu').waitFor({ state: 'hidden', timeout: 3_000 });
      return `${visited.join(', ')}; credit link exact (${Math.round(lb.height)}px tall)`;
    });

    await check('overflow controls and cinematic demo on a phone', async () => {
      await sel('m-more').tap();
      await sel('m-more-sheet').waitFor({ state: 'visible', timeout: 3_000 });
      const layers = await page.locator('[data-testid="m-more-sheet"] [data-testid^="layer-"]').count();
      await sel('demo-start').tap();
      await sel('demo-overlay').waitFor({ state: 'visible', timeout: 5_000 });
      await page.waitForTimeout(600);
      const db = await sel('demo-overlay').boundingBox();
      const cb = await sel('m-controls').boundingBox();
      if (db.y + db.height > cb.y + 1) throw new Error('demo captions overlap the controls');
      await shot(page, '07-demo');
      await sel('demo-exit').tap();
      await sel('demo-overlay').waitFor({ state: 'hidden', timeout: 5_000 });
      return `${layers} layer toggles; demo captions above the control row`;
    });

    await check('inspector opens as a full-height sheet; Why-this-plan is full screen', async () => {
      await page.goto(`${baseUrl}?welcome=0&frame=99999`, { waitUntil: 'domcontentloaded' }); // the demo rewound the playhead
      await waitForApp(page);
      await page.locator('[data-testid="m-sheet-tabs"] [data-value="live"]').tap();
      await sel('fac-row-hospital').tap();
      await sel('inspector').waitFor({ state: 'visible', timeout: 5_000 });
      await page.waitForTimeout(400);
      const ib = await sel('inspector').boundingBox();
      if (ib.width < PHONE.width - 1 || ib.y + ib.height < PHONE.height - 2) throw new Error(`inspector ${Math.round(ib.width)}×${Math.round(ib.height)}`);
      await sel('inspector-close').tap();
      await sel('inspector').waitFor({ state: 'hidden', timeout: 5_000 });
      await page.locator('[data-testid="m-sheet-tabs"] [data-value="story"]').tap();
      await sel('why-plan-btn').tap();
      await sel('why-plan').waitFor({ state: 'visible', timeout: 5_000 });
      await page.waitForTimeout(400);
      const mb = await sel('why-plan').boundingBox();
      if (mb.width < PHONE.width - 1 || mb.height < PHONE.height - 2) throw new Error(`modal ${Math.round(mb.width)}×${Math.round(mb.height)}`);
      const over = await page.evaluate(() => {
        const body = document.querySelector('[data-testid="why-plan"] .enc-scroll');
        return body ? body.scrollWidth - body.clientWidth : 0;
      });
      if (over > 0) throw new Error(`modal body scrolls sideways by ${over}px`);
      await shot(page, '08-why');
      await page.keyboard.press('Escape');
      return 'inspector full width × full height; modal full screen without sideways scroll';
    });
    await page.context().close();

    await check('landscape phone: twin left, side sheet right, controls bottom', async () => {
      const p = await newPage({ width: 844, height: 390 });
      await p.goto(`${baseUrl}?welcome=0&frame=110&strategy=grid-only`, { waitUntil: 'domcontentloaded' });
      await waitForApp(p);
      await p.waitForTimeout(800);
      const layout = await p.locator('[data-testid="live-twin"]').getAttribute('data-layout');
      const snap = await p.locator('[data-testid="m-sheet"]').getAttribute('data-snap');
      const sb = await p.locator('[data-testid="m-sheet"]').boundingBox();
      const cb = await p.locator('[data-testid="m-controls"]').boundingBox();
      const f = await p.evaluate(PHONE_FACTS);
      if (layout !== 'landscape' || snap !== 'side') throw new Error(`${layout}/${snap}`);
      if (sb.x + sb.width > 844.5 || cb.x + cb.width > sb.x + 0.5) throw new Error('controls run under the side sheet');
      if (f.overflowX > 0 || f.small.length || f.minFont < 12) throw new Error(JSON.stringify(f));
      await p.screenshot({ path: join(outDir, 'mobile-09-landscape.png') });
      await p.context().close();
      return `side sheet ${Math.round(sb.width)} px; controls ${Math.round(cb.width)} px`;
    });

    await check('tablet portrait: Story and Live side by side', async () => {
      const p = await newPage({ width: 768, height: 1024 });
      await p.goto(`${baseUrl}?welcome=0&frame=32`, { waitUntil: 'domcontentloaded' });
      await waitForApp(p);
      await p.locator('[data-testid="m-sheet-handle"]').tap();
      await p.waitForTimeout(600);
      const s = await p.locator('[data-testid="m-story"]').boundingBox();
      const l = await p.locator('[data-testid="m-live"]').boundingBox();
      if (!s || !l || Math.abs(s.y - l.y) > 2 || l.x <= s.x) throw new Error('sections not side by side');
      const f = await p.evaluate(PHONE_FACTS);
      if (f.overflowX > 0) throw new Error(`overflow ${f.overflowX}`);
      await p.screenshot({ path: join(outDir, 'mobile-10-tablet.png') });
      await p.context().close();
      return `two columns ${Math.round(s.width)} + ${Math.round(l.width)} px`;
    });

    await check('no uncaught errors on phones', async () => {
      if (errors.length) throw new Error(errors.slice(0, 3).join(' | '));
      return 'none';
    });
  } finally {
    await browser.close();
  }
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { report } = await import('./smoke.mjs');
  const server = await ensureServer();
  try {
    const failed = report(await runMobile());
    process.exitCode = failed ? 1 : 0;
  } finally {
    await server.stop();
  }
}

#!/usr/bin/env node
// Encirra end-to-end smoke test (playwright-core + installed Microsoft Edge, headless, real scrollbars).
// Used by `npm run test:e2e` through run-e2e.mjs; can also run standalone: node tests/e2e/smoke.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BASE_URL, ensureServer, launch, outDir, waitForApp } from './lib.mjs';

const CREDIT = { text: 'Built by Team Kanban', href: 'https://kanbanstudios.ae/team-kanban' };

export async function runSmoke({ baseUrl = BASE_URL, viewport = { width: 1600, height: 900 } } = {}) {
  const results = [];
  const check = async (name, fn) => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      results.push({ name, ok: true, ms: Date.now() - t0, detail: detail ?? '' });
    } catch (err) {
      results.push({ name, ok: false, ms: Date.now() - t0, detail: String(err?.message ?? err).split('\n')[0] });
    }
  };

  const browser = await launch();
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedResponses = [];
  const pageErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 400) failedResponses.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });

  const shot = (name) => page.screenshot({ path: join(outDir, `smoke-${name}.png`) });
  const sel = (id) => page.locator(`[data-testid="${id}"]`);

  try {
    await check('app loads with simulation data', async () => {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await waitForApp(page);
      const status = (await sel('sim-status').innerText()).replace(/\s+/g, ' ');
      await shot('01-loaded');
      return status;
    });

    await check('3D canvas present', async () => {
      await page.waitForSelector('canvas', { timeout: 20_000 });
      const n = await page.locator('canvas').count();
      if (n < 1) throw new Error('no <canvas>');
      return `${n} canvas element(s)`;
    });

    await check('default example: feeder-fault · Encirra · playhead at start', async () => {
      const scenario = await sel('scenario-select').inputValue();
      const strategy = await page.locator('[data-testid="strategy-select"] [aria-checked="true"]').getAttribute('data-value');
      const fault = await sel('fault-card').getAttribute('data-state');
      if (scenario !== 'feeder-fault') throw new Error(`scenario ${scenario}`);
      if (strategy !== 'encirra') throw new Error(`strategy ${strategy}`);
      if (fault !== 'normal') throw new Error(`fault card ${fault} at start`);
      return `${scenario} / ${strategy} / ${await sel('playback-clock').innerText()}`;
    });

    await check('playback advances and the fault progresses through the cards', async () => {
      await sel('speed-select').selectOption('10');
      const before = await sel('playback-clock').innerText();
      await sel('pb-play').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="fault-card"]')?.getAttribute('data-state') === 'fault', null, { timeout: 30_000 });
      await page.waitForFunction(
        () => !/Awaiting disturbance/.test(document.querySelector('[data-testid="recovery-title"]')?.textContent ?? ''),
        null,
        { timeout: 10_000 },
      );
      await sel('pb-play').click(); // pause
      const after = await sel('playback-clock').innerText();
      const label = await sel('fault-label').innerText();
      const title = await sel('recovery-title').innerText();
      await shot('02-fault');
      if (before === after) throw new Error('clock did not advance');
      return `${before} → ${after} · ${label} · "${title}"`;
    });

    await check('timeline reflects the playhead', async () => {
      const statuses = await page.locator('[data-testid="timeline-card"] li').evaluateAll((els) => els.map((e) => e.getAttribute('data-status')));
      if (statuses[0] !== 'done') throw new Error(`first step ${statuses[0]}`);
      return statuses.join(',');
    });

    await check('step and reset controls', async () => {
      const c0 = await sel('playback-clock').innerText();
      await sel('pb-fwd').click();
      const c1 = await sel('playback-clock').innerText();
      await sel('pb-reset').click();
      const c2 = await sel('playback-clock').innerText();
      if (c0 === c1) throw new Error('step did not move');
      if ((await sel('fault-card').getAttribute('data-state')) !== 'normal') throw new Error('reset did not rewind before the fault');
      return `${c0} → ${c1} → reset ${c2}`;
    });

    await check('strategy switch (None → baseline; back to Encirra)', async () => {
      await page.goto(`${baseUrl}?frame=99999`, { waitUntil: 'domcontentloaded' });
      await waitForApp(page);
      await page.locator('[data-testid="strategy-select"] [data-value="none"]').click();
      await page.waitForFunction(() => /No intervention/.test(document.querySelector('[data-testid="recovery-title"]')?.textContent ?? ''), null, { timeout: 5_000 });
      const none = await sel('recovery-title').innerText();
      await page.locator('[data-testid="strategy-select"] [data-value="encirra"]').click();
      await page.waitForFunction(() => !/No intervention/.test(document.querySelector('[data-testid="recovery-title"]')?.textContent ?? ''), null, { timeout: 5_000 });
      const enc = await sel('recovery-title').innerText();
      await shot('03-end-encirra');
      return `none: "${none}" · encirra: "${enc}"`;
    });

    await check('"Why this plan?" opens with candidates and verification', async () => {
      await sel('why-plan-btn').click();
      await sel('why-plan').waitFor({ state: 'visible', timeout: 5_000 });
      const text = await sel('why-plan').innerText();
      if (!/Candidates considered/i.test(text)) throw new Error('no candidate list');
      const verified = await sel('verified-badge').count();
      await page.waitForTimeout(450); // let the open transition settle before the screenshot
      await shot('04-why-plan');
      await page.keyboard.press('Escape');
      await sel('why-plan').waitFor({ state: 'hidden', timeout: 5_000 });
      return verified ? 'Simulation Verified badge shown' : 'opened (plan not verified)';
    });

    await check('all five tabs render', async () => {
      const out = [];
      for (const id of ['analytics', 'scenarios', 'assets', 'reports', 'live']) {
        await sel(`nav-${id}`).click();
        await (id === 'live' ? sel('live-twin') : sel(`page-${id}`)).waitFor({ state: 'visible', timeout: 8_000 });
        if (id !== 'live') await shot(`05-${id}`);
        out.push(id);
      }
      return out.join(', ');
    });

    await check('reports: CSV and JSON downloads', async () => {
      await sel('nav-reports').click();
      await sel('page-reports').waitFor({ state: 'visible' });
      const files = [];
      for (const [id, ext] of [
        ['export-csv', '.csv'],
        ['export-timeseries', '.csv'],
        ['export-json', '.json'],
      ]) {
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10_000 }), sel(id).click()]);
        const name = dl.suggestedFilename();
        if (!name.endsWith(ext)) throw new Error(`${id} → ${name}`);
        const path = join(outDir, `download-${name}`);
        await dl.saveAs(path);
        const body = readFileSync(path, 'utf8');
        if (ext === '.json') {
          const j = JSON.parse(body);
          if (!j.runs || !j.runs.encirra) throw new Error('JSON missing runs.encirra');
        } else if (!/^[a-zA-Z_]+,/.test(body) || body.split('\n').length < 3) throw new Error(`${name} looks empty`);
        files.push(`${name} (${body.length.toLocaleString()} B)`);
      }
      return files.join(', ');
    });

    await check('credit link: exact text, href, target, rel (footer + About)', async () => {
      const verify = async (loc) => {
        const [text, href, target, rel] = await Promise.all([loc.innerText(), loc.getAttribute('href'), loc.getAttribute('target'), loc.getAttribute('rel')]);
        if (text.trim() !== CREDIT.text) throw new Error(`text "${text}"`);
        if (href !== CREDIT.href) throw new Error(`href ${href}`);
        if (target !== '_blank') throw new Error(`target ${target}`);
        const r = (rel ?? '').split(/\s+/);
        if (!r.includes('noopener') || !r.includes('noreferrer')) throw new Error(`rel ${rel}`);
      };
      await verify(page.locator('footer [data-testid="credit-link"]'));
      await sel('about-open').click();
      await sel('about').waitFor({ state: 'visible' });
      await verify(page.locator('[data-testid="about"] [data-testid="credit-link"]'));
      await page.waitForTimeout(450);
      await shot('06-about');
      await page.keyboard.press('Escape');
      return 'footer + About OK';
    });

    await check('demo mode starts, advances in sync with frames, pauses and exits', async () => {
      await sel('nav-live').click();
      await sel('demo-start').click();
      await sel('demo-overlay').waitFor({ state: 'visible', timeout: 5_000 });
      const step0 = await sel('demo-overlay').getAttribute('data-step');
      const t0 = await sel('demo-time').innerText();
      await page.waitForTimeout(2_500);
      const t1 = await sel('demo-time').innerText();
      if (t0 === t1) throw new Error(`demo clock did not advance (${t0})`);
      // skip to "Trigger the fault": within its first seconds the playhead reaches the fault frame
      await sel('demo-skip').click();
      const step1 = await sel('demo-overlay').getAttribute('data-step');
      await page.waitForFunction(() => document.querySelector('[data-testid="fault-card"]')?.getAttribute('data-state') === 'fault', null, { timeout: 12_000 });
      const clock = await sel('playback-clock').innerText();
      await shot('07-demo');
      await sel('demo-pause').click();
      const paused = await sel('demo-overlay').getAttribute('data-paused');
      if (paused !== 'true') throw new Error('did not pause');
      const tp = await sel('demo-time').innerText();
      await page.waitForTimeout(1_200);
      if ((await sel('demo-time').innerText()) !== tp) throw new Error('clock kept running while paused');
      await sel('demo-exit').click();
      await sel('demo-overlay').waitFor({ state: 'hidden', timeout: 5_000 });
      return `${step0} ${t0}→${t1}; skipped to ${step1}, fault reached at ${clock}; paused at ${tp}; exited`;
    });

    await check('no uncaught errors or unexpected console errors', async () => {
      if (pageErrors.length) throw new Error(`page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
      // /api/* probes fail by design when the simulation service is offline (replay mode)
      const expected = (r) => / \/api\//.test(r);
      const unexpected = failedResponses.filter((r) => !expected(r));
      const apiOnly = consoleErrors.filter((m) => !/Failed to load resource/.test(m));
      const resourceErrors = consoleErrors.filter((m) => /Failed to load resource/.test(m)).length;
      const expectedApi = failedResponses.length - unexpected.length;
      if (unexpected.length) throw new Error(`failed responses: ${[...new Set(unexpected)].join(', ')}`);
      if (apiOnly.length) throw new Error(`console errors: ${apiOnly.slice(0, 3).join(' | ')}`);
      if (resourceErrors > expectedApi) throw new Error(`${resourceErrors} resource errors vs ${expectedApi} expected /api probes`);
      return `${expectedApi} expected probe failure(s) (${[...new Set(failedResponses)].join(', ') || 'none'}); no other errors`;
    });
  } finally {
    await browser.close();
  }
  return results;
}

export function report(results) {
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.ms} ms)${r.detail ? `\n      ${r.detail}` : ''}`);
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed · screenshots in ${outDir}`);
  return failed;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await ensureServer();
  try {
    const failed = report(await runSmoke());
    process.exitCode = failed ? 1 : 0;
  } finally {
    await server.stop();
  }
}

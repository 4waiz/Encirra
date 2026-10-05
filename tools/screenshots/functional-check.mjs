// Scripted functional QA of the main interactions. Prints PASS/FAIL per check.
//   node tools/screenshots/functional-check.mjs [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? 'functional-check');
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const results = [];
const check = async (name, fn) => {
  try {
    const ok = await fn();
    results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  } catch (e) {
    results.push(`FAIL  ${name} — ${e.message.split('\n')[0]}`);
  }
};
const state = (fn) => page.evaluate(fn);

await page.goto('http://localhost:5173/#/overview', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ENCIRRA__?.sim.getState().ready, null, { timeout: 30000 });
await page.waitForTimeout(5000);

await check('footer attribution link', async () => {
  const a = page.locator('footer a', { hasText: 'Awaiz Ahmed' });
  return (await a.getAttribute('href')) === 'https://kanbanstudios.ae/team-kanban' && (await a.getAttribute('target')) === '_blank' && (await a.getAttribute('rel')) === 'noreferrer';
});

await check('primary navigation (5 screens)', async () => {
  for (const label of ['3D Twin', 'Live Feeds', 'AI Insights', 'Incidents', 'Overview']) {
    await page.getByRole('button', { name: label, exact: false }).first().click();
    await page.waitForTimeout(500);
  }
  return (await state(() => window.location.hash)) === '#/overview';
});

await check('command palette opens with Ctrl+K and focuses UGV-01', async () => {
  await page.keyboard.press('Control+k');
  await page.waitForSelector('[aria-label="Command palette"]');
  await page.keyboard.type('Focus UGV');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const sel = await state(() => window.__ENCIRRA__.ui.getState().selection);
  return sel?.kind === 'asset' && sel.id === 'UGV-01';
});

await check('trigger radiological scenario from palette', async () => {
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Radiological Scenario');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  return (await state(() => window.__ENCIRRA__.sim.getState().run?.preset)) === 'radiological';
});

await check('settings drawer → About shows the disclosure', async () => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'About ENCIRRA' }).click();
  const text = await page.locator('[aria-label="Settings"]').innerText();
  await page.screenshot({ path: resolve(outDir, 'settings-about.png') });
  await page.keyboard.press('Escape');
  return text.includes('Conceptual situational-awareness environment using synthetic local data. No connection to operational Barakah systems.');
});

await check('scenario control tab renders and resets', async () => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Scenario control' }).click();
  await page.screenshot({ path: resolve(outDir, 'settings-scenario.png') });
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  return (await state(() => window.__ENCIRRA__.sim.getState().run)) === null;
});

await check('chemical scenario → incident → acknowledge → assign UAV → resolve', async () => {
  await state(() => window.__ENCIRRA__.engine.trigger({ preset: 'chemical', severity: 'moderate', locationId: 'SERVICE', windDir: 315, windSpeed: 12, duration: 0 }));
  await page.waitForFunction(() => window.__ENCIRRA__.sim.getState().incidents.some((i) => i.status === 'new'), null, { timeout: 30000 });
  await state(() => window.__ENCIRRA__.ui.getState().setScreen('incidents'));
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).first().click();
  await page.getByRole('button', { name: /Assign asset/ }).click();
  await page.getByRole('menuitem', { name: /UAV-01/ }).click();
  await page.screenshot({ path: resolve(outDir, 'incident-flow.png') });
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm resolve' }).click();
  await page.waitForTimeout(800);
  const inc = await state(() => window.__ENCIRRA__.sim.getState().incidents[0]);
  return inc.status === 'resolved' && inc.assigned.includes('UAV-01') && !!inc.acknowledgedAt;
});

await check('replay: timeline scrub enters replay mode and Live returns', async () => {
  await state(() => window.__ENCIRRA__.ui.getState().setScreen('twin'));
  await page.waitForTimeout(800);
  const slider = page.getByRole('slider', { name: 'Timeline scrubber' });
  const box = await slider.boundingBox();
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2);
  await page.waitForTimeout(600);
  const mode1 = await state(() => window.__ENCIRRA__.ui.getState().playback.mode);
  await page.screenshot({ path: resolve(outDir, 'replay.png') });
  await page.getByRole('button', { name: 'Live', exact: true }).first().click();
  const mode2 = await state(() => window.__ENCIRRA__.ui.getState().playback.mode);
  return mode1 === 'replay' && mode2 === 'live';
});

await check('3D picking: click the twin selects a zone or asset', async () => {
  await state(() => window.__ENCIRRA_CAMERA__.setCameraPose([-1080, 560, -1230], [30, 0, -40], false));
  await page.waitForTimeout(1200);
  const vp = page.locator('[role="application"]');
  const b = await vp.boundingBox();
  await page.mouse.click(b.x + b.width * 0.52, b.y + b.height * 0.5);
  await page.waitForTimeout(500);
  const sel = await state(() => window.__ENCIRRA__.ui.getState().selection);
  return !!sel;
});

await check('live feeds: switch source + thermal toggle + snapshot', async () => {
  await state(() => window.__ENCIRRA__.ui.getState().setScreen('feeds'));
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /CAM-02/ }).first().click();
  await page.getByRole('radio', { name: 'Thermal' }).first().click();
  await page.waitForTimeout(1200);
  const mode = await state(() => window.__ENCIRRA__.ui.getState().feedModes['CAM-02']);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.getByRole('button', { name: 'Snapshot' }).click()]);
  await page.screenshot({ path: resolve(outDir, 'feeds-cam02-thermal.png') });
  return mode === 'thermal' && !!download;
});

await check('wind change rotates plume direction state', async () => {
  await state(() => window.__ENCIRRA__.engine.setWind(200, 18));
  await page.waitForTimeout(3000);
  const w = await state(() => window.__ENCIRRA__.sim.getState().weather.windDir);
  return Math.abs(w - 200) < 15;
});

console.log(results.join('\n'));
console.log(errors.length ? `\nconsole/page errors:\n${errors.join('\n')}` : '\nno console errors');
await browser.close();

import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:5173/#/overview', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
const pose = () => page.evaluate(() => JSON.stringify(window.__ENCIRRA_CAMERA__?.getCameraPose(), (k, v) => (typeof v === 'number' ? Math.round(v) : v)));
await page.waitForFunction(() => !!window.__ENCIRRA_CAMERA__?.getCameraPose(), null, { timeout: 30000 });
await page.evaluate(() => {
  window.__poseLog = [];
  const cam = window.__ENCIRRA_CAMERA__;
  for (const k of ['focusOn', 'resetView', 'setCameraPose']) {
    const f = cam[k];
    cam[k] = (...a) => { window.__poseLog.push(`${(performance.now() / 1000).toFixed(1)} ${k} ${JSON.stringify(a)}`); return f(...a); };
  }
  setInterval(() => {
    const p = window.__ENCIRRA_CAMERA__.getCameraPose();
    const s = JSON.stringify(p, (k, v) => (typeof v === 'number' ? Math.round(v) : v));
    if (s !== window.__lastPose) { window.__poseLog.push(`${(performance.now() / 1000).toFixed(1)} pose ${s} inc=${window.__ENCIRRA__.sim.getState().incidents.map((i) => i.id + ':' + i.status).join(',')} screen=${window.__ENCIRRA__.ui.getState().screen} follow=${window.__ENCIRRA__.ui.getState().follow}`); window.__lastPose = s; }
  }, 250);
});
await page.waitForFunction(() => window.__ENCIRRA__?.sim.getState().observations.some((o) => o.status === 'validation'), null, { timeout: 180000, polling: 1000 });
await page.waitForTimeout(4000);
await page.evaluate(() => { const s = window.__ENCIRRA__.ui.getState(); s.setScreen('overview'); s.select({ kind: 'sensor', id: 'RAD-S17' }); });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  window.__poseLog.push('--- 02 step');
  const s = window.__ENCIRRA__.ui.getState();
  s.setScreen('twin'); s.setTwinImmersive(true); s.setLayer('weather', true); s.setLayer('radiation', true);
  s.select({ kind: 'sensor', id: 'RAD-S17' });
  window.__ENCIRRA_CAMERA__.setCameraPose([470, 300, 150], [185, 0, -120], false);
});
await page.waitForTimeout(3500);
const log = await page.evaluate(() => window.__poseLog.filter((l, i, a) => !l.includes(' pose ') || i > a.length - 40 || true).join('\n'));
console.log(log.split('\n').filter((l) => !/pose .*target":\[(?:-?\d+),0,(?:-?\d+)\]/.test(l) || true).slice(-60).join('\n'));
await browser.close();

import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
let warn = [];
page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warn.push(m.text().slice(0, 140)); });
const flush = (label) => { const w = warn.filter((x) => !x.includes('X4122') && !x.includes('Program Info Log')); console.log(`[${label}]`, w.length ? w.join(' | ') : 'clean'); warn = []; };
await page.goto(`${base}#/overview`, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ENCIRRA__?.sim.getState().ready, null, { timeout: 30000 });
await page.evaluate(() => { window.__ENCIRRA__.ui.getState().setSettings({ autoplay: false }); window.__ENCIRRA__.engine.cancelAutoplay(); });
await page.waitForTimeout(5000); flush('overview idle');
const ev = (fn, arg) => page.evaluate(fn, arg);
await ev(() => window.__ENCIRRA__.engine.trigger({ preset: 'radiological', severity: 'moderate', locationId: 'U3-EAST', windDir: 315, windSpeed: 12, duration: 0 }));
console.log('preset after rad', await ev(() => window.__ENCIRRA__.sim.getState().run?.preset));
await page.waitForTimeout(1200);
await ev(() => window.__ENCIRRA__.engine.trigger({ preset: 'chemical', severity: 'moderate', locationId: 'SERVICE', windDir: 315, windSpeed: 12, duration: 0 }));
console.log('preset right after chem', await ev(() => window.__ENCIRRA__.sim.getState().run?.preset));
await page.waitForTimeout(1200);
console.log('preset 1.2s after chem', await ev(() => window.__ENCIRRA__.sim.getState().run?.preset), await ev(() => JSON.stringify(window.__ENCIRRA__.sim.getState().run)));
flush('scenarios');
for (const s of ['twin', 'feeds', 'insights', 'incidents', 'overview']) { await ev((sc) => window.__ENCIRRA__.ui.getState().setScreen(sc), s); await page.waitForTimeout(1500); flush('screen ' + s); }
await ev(() => window.__ENCIRRA__.ui.getState().setLayer('weather', true)); await page.waitForTimeout(1500); flush('weather on');
await ev(() => window.__ENCIRRA__.ui.getState().setLayer('zones', true)); await page.waitForTimeout(1500); flush('zones on');
await ev(() => { const u = window.__ENCIRRA__.ui.getState(); u.setScreen('feeds'); u.setFeedMain('CAM-02'); }); await page.waitForTimeout(1500); flush('feeds CAM-02');
await ev(() => window.__ENCIRRA__.ui.getState().setFeedMode('CAM-02', 'thermal')); await page.waitForTimeout(1500); flush('CAM-02 thermal');
await ev(() => window.__ENCIRRA__.ui.getState().setFeedMode('CAM-02', 'fusion')); await page.waitForTimeout(1500); flush('CAM-02 fusion');
await ev(() => window.__ENCIRRA__.ui.getState().setFeedMode('CAM-02', 'visible')); await page.waitForTimeout(1500); flush('CAM-02 visible');
await ev(() => window.__ENCIRRA__.ui.getState().setFeedMain('UAV-01')); await page.waitForTimeout(1500); flush('feeds UAV');
await ev(() => window.__ENCIRRA__.ui.getState().setScreen('twin')); await page.waitForTimeout(800);
await page.keyboard.down('w'); await page.waitForTimeout(1000); await page.keyboard.up('w'); await page.waitForTimeout(800); flush('wasd twin');
await page.setViewportSize({ width: 1366, height: 768 });
for (const s of ['overview', 'twin', 'feeds', 'insights', 'incidents']) {
  await ev((sc) => window.__ENCIRRA__.ui.getState().setScreen(sc), s); await page.waitForTimeout(500);
  const o = await ev(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, w: innerWidth, h: innerHeight, bsw: document.body.scrollWidth, bsh: document.body.scrollHeight }));
  console.log('1366', s, JSON.stringify(o));
}
flush('1366');
await page.setViewportSize({ width: 1920, height: 1080 });
for (const s of ['overview', 'twin', 'feeds', 'insights', 'incidents']) {
  await ev((sc) => window.__ENCIRRA__.ui.getState().setScreen(sc), s); await page.waitForTimeout(500);
  const o = await ev(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, w: innerWidth, h: innerHeight }));
  console.log('1920', s, JSON.stringify(o));
}
flush('1920');
await browser.close();

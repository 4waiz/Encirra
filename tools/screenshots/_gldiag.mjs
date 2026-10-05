import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.addInitScript(() => {
  const P = WebGL2RenderingContext.prototype;
  const names = new WeakMap();
  const shaderSrc = new WeakMap();
  const oSS = P.shaderSource;
  P.shaderSource = function (sh, src) { shaderSrc.set(sh, src); return oSS.call(this, sh, src); };
  const oAS = P.attachShader;
  P.attachShader = function (prog, sh) {
    const src = shaderSrc.get(sh) || '';
    const m = src.match(/#define SHADER_NAME (.*)/);
    if (m) names.set(prog, m[1]);
    else if (!names.has(prog)) names.set(prog, (src.match(/uniform sampler2D\w* \w+/g) || []).join(',').slice(0, 80) || 'unnamed');
    return oAS.call(this, prog, sh);
  };
  let cur = null;
  const oUP = P.useProgram;
  P.useProgram = function (p) { cur = p; return oUP.call(this, p); };
  window.__glbad = new Map();
  const ring = [];
  let n = 0;
  for (const fn of ['drawElements', 'drawElementsInstanced', 'drawArrays', 'drawArraysInstanced', 'drawRangeElements']) {
    const o = P[fn];
    if (!o) continue;
    P[fn] = function (...a) {
      const r = o.apply(this, a);
      ring.push(cur);
      if (++n % 40 === 0) {
        const e = this.getError();
        if (e) {
          const set = new Set(ring.map((p) => (p && names.get(p)) || 'unknown'));
          const key = `err=${e} among: ${[...set].join(' | ')}`;
          window.__glbad.set(key, (window.__glbad.get(key) || 0) + 1);
        }
        ring.length = 0;
      }
      return r;
    };
  }
});
await page.goto(`${base}#/overview`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ENCIRRA__?.sim.getState().ready, null, { timeout: 30000 });
await page.evaluate(() => { window.__ENCIRRA__.ui.getState().setSettings({ autoplay: false }); window.__ENCIRRA__.engine.cancelAutoplay(); });
await page.waitForTimeout(9000);
const bad = await page.evaluate(() => [...window.__glbad.entries()].map(([k, v]) => `${v}× ${k}`).join('\n'));
console.log(bad || 'no GL errors');
await browser.close();

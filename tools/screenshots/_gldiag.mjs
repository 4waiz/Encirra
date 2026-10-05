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
  let checks = 0;
  for (const fn of ['drawElements', 'drawElementsInstanced', 'drawArrays', 'drawArraysInstanced']) {
    const o = P[fn];
    P[fn] = function (...a) {
      const r = o.apply(this, a);
      if (checks++ < 400000) {
        const e = this.getError();
        if (e) {
          const n = (cur && names.get(cur)) || 'unknown';
          // list sampler uniforms of the current program
          let samplers = '';
          try {
            const cnt = this.getProgramParameter(cur, this.ACTIVE_UNIFORMS);
            for (let i = 0; i < cnt; i++) {
              const u = this.getActiveUniform(cur, i);
              if ([this.SAMPLER_2D, this.SAMPLER_2D_SHADOW, this.SAMPLER_CUBE, this.SAMPLER_3D, this.SAMPLER_2D_ARRAY, this.INT_SAMPLER_2D, this.UNSIGNED_INT_SAMPLER_2D].includes(u.type)) {
                const unit = this.getUniform(cur, this.getUniformLocation(cur, u.name));
                samplers += `${u.name}:${u.type === this.SAMPLER_2D_SHADOW ? 'shadow' : u.type === this.SAMPLER_2D ? '2d' : u.type}@${unit};`;
              }
            }
          } catch {}
          const key = `${fn} ${n} err=${e} ${samplers}`;
          window.__glbad.set(key, (window.__glbad.get(key) || 0) + 1);
        }
      }
      return r;
    };
  }
});
await page.goto(`${base}#/overview`, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ENCIRRA__?.sim.getState().ready, null, { timeout: 30000 });
await page.evaluate(() => { window.__ENCIRRA__.ui.getState().setSettings({ autoplay: false }); window.__ENCIRRA__.engine.cancelAutoplay(); });
await page.waitForTimeout(9000);
const bad = await page.evaluate(() => [...window.__glbad.entries()].map(([k, v]) => `${v}× ${k}`).join('\n'));
console.log(bad || 'no GL errors');
await browser.close();

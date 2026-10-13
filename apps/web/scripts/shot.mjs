#!/usr/bin/env node
/**
 * Visual QA capture for the 3D twin (headless Microsoft Edge with GPU via playwright-core).
 *
 *   node apps/web/scripts/shot.mjs [options]
 *
 * Options
 *   --url <url>          default http://127.0.0.1:5173/?view=scene
 *   --sizes <WxH,...>    default 1600x900,1920x1080
 *   --name <prefix>      output file prefix (default "scene")
 *   --shot <CameraShot>  request a named camera shot before capturing
 *   --focus <kind:id>    request a camera focus on a selection (e.g. facility:hospital)
 *   --run <spec>         load a run: "replay:<path under /replay>" or "mock:<scenario>" (QA fixture)
 *   --frame <n|stage>    playhead frame index (or first frame of a stage id)
 *   --layers <k=v,...>   layer overrides, e.g. underground=1,skyline=0
 *   --select <kind:id>   set the store selection
 *   --hover <kind:id>    set the store hover
 *   --wait <ms>          settle time after setup (default 3500)
 *   --fps <s>            measure fps for N seconds (default 3)
 *   --quality <tier>     force a quality tier (high|medium|low)
 *   --cinematic          enable the cinematic auto-orbit
 *   --eval <js>          extra JS evaluated in the page before capture
 *
 * Writes PNGs to tests/e2e/output/ and prints console errors/warnings, fps and renderer stats.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMockRun } from './qa-fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const outDir = join(repo, 'tests', 'e2e', 'output');
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  if (i < 0) return d;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};

let url = opt('url', 'http://127.0.0.1:5173/?view=scene');
if (url === 'qa') url = 'http://127.0.0.1:5173/src/scene/qa/index.html';
const quality = opt('quality', null);
if (quality) url += (url.includes('?') ? '&' : '?') + `quality=${quality}`;
if (opt('gputime', false)) url += (url.includes('?') ? '&' : '?') + 'gputime=1';
const sizes = String(opt('sizes', '1600x900,1920x1080'))
  .split(',')
  .map((s) => s.split('x').map(Number));
const name = opt('name', 'scene');
const shot = opt('shot', null);
const focus = opt('focus', null);
const runSpec = opt('run', null);
const frame = opt('frame', null);
const layers = opt('layers', null);
const select = opt('select', null);
const hover = opt('hover', null);
const wait = Number(opt('wait', 3500));
const fpsSeconds = Number(opt('fps', 3));
const cinematic = opt('cinematic', false);
const extra = opt('eval', null);
const cams = opt('cams', null); // JSON: [[px,py,pz,tx,ty,tz,fov], ...] captured in one session

const parseSel = (s) => {
  if (!s || s === true) return null;
  const [kind, ...rest] = String(s).split(':');
  return { kind, id: rest.join(':') };
};

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false'],
});

let failed = false;
for (const [w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: 'vite-error-overlay{display:none!important}' }).catch(() => {});
  try {
    await page.waitForFunction(() => window.__encirra?.fx?.frames > 20, null, { timeout: 90000 });
  } catch {
    logs.push('[qa] scene never reached 20 frames');
    failed = true;
  }
  // wait for the asset kit (all files loaded or failed) so measurements exclude streaming/compiles
  await page
    .waitForFunction(
      () => {
        const k = window.__encirra?.useKit?.getState();
        if (!k) return true;
        if (k.manifest === 'missing') return true;
        if (!k.manifest) return false;
        const files = Object.keys(k.manifest.files ?? {});
        return files.every((f) => k.files[f] && k.files[f] !== 'loading');
      },
      null,
      { timeout: 60000 },
    )
    .catch(() => logs.push('[qa] kit did not finish loading'));
  const loadMs = Date.now() - t0;

  // ── state setup
  let run = null;
  if (runSpec && String(runSpec).startsWith('mock:')) run = buildMockRun(String(runSpec).slice(5));
  await page.evaluate(
    async ({ run, runSpec, frame, layers, select, hover, shot, focus, cinematic }) => {
      const api = window.__encirra;
      const st = api.useTwin.getState();
      let r = run;
      if (!r && runSpec && runSpec.startsWith('replay:')) {
        const res = await fetch('/replay/' + runSpec.slice(7));
        r = await res.json();
        const topo = await fetch('/replay/topology.json').then((x) => (x.ok ? x.json() : null)).catch(() => null);
        if (topo) st.setData({ topology: topo });
      }
      if (r) st.setRun(r);
      if (frame !== null && r) {
        let idx = Number(frame);
        if (Number.isNaN(idx)) idx = Math.max(0, r.frames.findIndex((f) => f.stage === frame));
        api.useTwin.getState().setPlayhead(idx);
      }
      if (layers) {
        for (const kv of String(layers).split(',')) {
          const [k, v] = kv.split('=');
          api.useTwin.getState().setLayer(k, v === '1' || v === 'true');
        }
      }
      if (select) api.useTwin.getState().setSelected(select);
      if (hover) api.useTwin.getState().setHovered(hover);
      if (cinematic) api.useTwin.getState().setCameraMode('cinematic');
      if (shot) api.useTwin.getState().requestCamera({ shot, durationS: 0.05 });
      if (focus) api.useTwin.getState().requestCamera({ focus, durationS: 0.05 });
    },
    { run, runSpec: runSpec && String(runSpec), frame, layers, select: parseSel(select), hover: parseSel(hover), shot, focus: parseSel(focus), cinematic },
  );
  if (extra) await page.evaluate(String(extra));
  await page.waitForTimeout(wait);

  // ── fps estimate (rAF cadence) + renderer stats
  const perf = await page.evaluate(
    (secs) =>
      new Promise((res) => {
        const api = window.__encirra;
        if (api.gl) api.gl.info.autoReset = false;
        const f0 = api.fx.frames;
        const t0 = performance.now();
        const deltas = [];
        let last = t0;
        function tick(now) {
          deltas.push(now - last);
          last = now;
          if (now - t0 < secs * 1000) requestAnimationFrame(tick);
          else {
            const elapsed = (now - t0) / 1000;
            deltas.sort((a, b) => a - b);
            const p95 = deltas[Math.floor(deltas.length * 0.95)] ?? 0;
            const info = api.fx.stats ?? {};
            res({
              fps: (api.fx.frames - f0) / elapsed,
              p95FrameMs: p95,
              calls: info.calls,
              triangles: info.triangles,
              tier: api.useSceneQuality?.getState().tier,
              gpuMs: api.fx.gpuMs,
              cpuMs: api.fx.cpuMs,
              dpr: api.gl?.getPixelRatio?.(),
            });
          }
        }
        requestAnimationFrame(tick);
      }),
    fpsSeconds,
  );

  const file = join(outDir, `${name}-${w}x${h}.png`);
  await page.screenshot({ path: file });
  console.log(`\n▶ ${file}`);
  console.log(`  load ${loadMs} ms · fps ${perf.fps.toFixed(1)} · p95 frame ${perf.p95FrameMs.toFixed(1)} ms · gpu ${perf.gpuMs?.toFixed?.(2)} ms · cpu ${perf.cpuMs?.toFixed?.(2)} ms · tier ${perf.tier} · dpr ${perf.dpr} · draw calls ${perf.calls} · tris ${perf.triangles}`);
  const uniq = [...new Set(logs)];
  if (uniq.length) {
    console.log(`  console (${uniq.length}):`);
    for (const l of uniq.slice(0, 25)) console.log('   ', l.slice(0, 400));
  } else console.log('  console: clean');
  if (cams) {
    const list = JSON.parse(String(cams));
    for (let k = 0; k < list.length; k++) {
      await page.evaluate((c) => {
        const st = window.__encirra.r3f();
        if (c[6]) st.camera.fov = c[6];
        st.camera.updateProjectionMatrix();
        st.controls.setLookAt(c[0], c[1], c[2], c[3], c[4], c[5], false);
      }, list[k]);
      await page.waitForTimeout(900);
      const f = join(outDir, `${name}-cam${k}-${w}x${h}.png`);
      await page.screenshot({ path: f });
      console.log('  cam', k, JSON.stringify(list[k]), '→', f);
    }
  }
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);

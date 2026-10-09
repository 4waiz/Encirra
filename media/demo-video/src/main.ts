// Preview + render host. In the browser this is a scrubbable preview; with ?render=1 it exposes an
// async frame() hook that the offline renderer (render.mjs) drives in headless Edge, after making sure
// every footage frame the shot needs is decoded.
import '@fontsource-variable/inter/wght.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import { Renderer } from './engine/renderer';
import { clipTime, activeSegments } from './scenes';
import { loadLogo } from './scenes/cards';
import { frameIndex, load, loadManifest, type ClipName } from './footage';
import { DURATION, FPS, SEGMENTS, autoSamples, buildTimeline, segmentAt } from './timeline';

declare global {
  interface Window {
    __video?: {
      ready: boolean;
      fps: number;
      duration: number;
      frame: (t: number, samples: number | 'auto', shutter: number, fps: number) => Promise<string>;
    };
  }
}

const params = new URLSearchParams(location.search);
const renderMode = params.has('render');
const scale = Math.max(1, Math.min(2, Number(params.get('scale') ?? 1) || 1));
const canvas = document.getElementById('c') as HTMLCanvasElement;

async function loadFonts() {
  const sample = 'ENCIRRA CBRN situational awareness 3D digital twin ·→×▸↵ 0123456789 %°';
  await Promise.all(
    ['500 24px "Inter Variable"', '600 40px "Inter Variable"', '700 92px "Inter Variable"', '400 16px "IBM Plex Mono"', '500 16px "IBM Plex Mono"'].map((f) =>
      document.fonts.load(f, sample),
    ),
  );
  await document.fonts.ready;
}

/** Footage frames needed to draw film time `t` (every sub-sample, every dissolving segment). */
function needed(times: number[]) {
  const out = new Map<string, [ClipName, number]>();
  for (const ts of times) {
    for (const [s] of activeSegments(ts)) {
      const i = frameIndex(s.id, clipTime(s, ts));
      out.set(`${s.id}/${i}`, [s.id, i]);
    }
  }
  return [...out.values()];
}

async function boot() {
  await Promise.all([loadFonts(), loadManifest(), loadLogo()]);
  const layout = buildTimeline();
  console.info('timeline', layout.segments.map((s) => `${s.id} ${s.start.toFixed(2)}–${s.end.toFixed(2)}`).join(' | '), `outro ${layout.outro.toFixed(2)} (${layout.outroLength.toFixed(2)} s)`);
  const renderer = new Renderer(canvas, scale);
  if (renderMode) {
    document.body.classList.add('render');
    window.__video = {
      ready: true,
      fps: FPS,
      duration: DURATION,
      frame: async (t, samples, shutter, fps) => {
        const n = samples === 'auto' ? autoSamples(t) : samples;
        const times = Renderer.sampleTimes(t, n, shutter, fps);
        await Promise.all(needed(times).map(([c, i]) => load(c, i)));
        // warm the next frames while this one encodes
        for (const [c, i] of needed([t + 1 / fps, t + 2 / fps, t + 3 / fps])) void load(c, i).catch(() => undefined);
        renderer.frame(t, n, shutter, fps);
        return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
      },
    };
    return;
  }
  preview(renderer);
}

// ------------------------------------------------------------------------------------------ preview

function preview(renderer: Renderer) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const ui = $('ui');
  const play = $<HTMLButtonElement>('play');
  const scrub = $<HTMLInputElement>('scrub');
  const time = $('time');
  const scene = $('scene');
  const loopChip = $('loop');
  scrub.max = String(DURATION);
  scrub.step = String(1 / FPS);
  const marks = [0, ...SEGMENTS.map((s) => s.start), SEGMENTS[SEGMENTS.length - 1].end];

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
  let t = Math.max(0, Math.min(DURATION - 1e-3, Number(params.get('t') ?? 0) || 0));
  let playing = false;
  let loopScene = false;
  let last = performance.now();

  const span = (v: number) => {
    const i = marks.findIndex((m, k) => v >= m && v < (marks[k + 1] ?? Infinity));
    return [marks[i], marks[i + 1] ?? DURATION] as const;
  };
  const seek = (v: number) => {
    t = Math.max(0, Math.min(DURATION - 1 / FPS, v));
  };
  const step = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      const [a, b] = span(t);
      t += dt;
      if (loopScene && t >= b) t = a;
      else if (t >= DURATION) t = 0;
    }
    for (const [c, i] of needed([t + 0.05, t + 0.1, t + 0.2])) void load(c, i).catch(() => undefined);
    renderer.frame(t);
    const seg = segmentAt(t);
    time.textContent = `${fmt(t)} / ${fmt(DURATION)}   f ${Math.floor(t * FPS + 1e-6)}`;
    scene.textContent = seg ? `${seg.index}  ${seg.kicker}` : t < SEGMENTS[0].start ? 'title' : 'outro';
    if (document.activeElement !== scrub) scrub.value = String(t);
    play.textContent = playing ? '❚❚' : '▶';
    loopChip.dataset.on = String(loopScene);
    requestAnimationFrame(step);
  };

  play.onclick = () => (playing = !playing);
  scrub.oninput = () => seek(Number(scrub.value));
  loopChip.onclick = () => (loopScene = !loopScene);
  window.addEventListener('keydown', (e) => {
    const big = e.shiftKey ? 5 : 1;
    const [a] = span(t);
    const i = marks.indexOf(a);
    if (e.code === 'Space') playing = !playing;
    else if (e.code === 'ArrowRight') seek(t + big);
    else if (e.code === 'ArrowLeft') seek(t - big);
    else if (e.key === '.') seek(t + 1 / FPS);
    else if (e.key === ',') seek(t - 1 / FPS);
    else if (e.key === ']') seek(marks[Math.min(marks.length - 1, i + 1)]);
    else if (e.key === '[') seek(marks[Math.max(0, t - a > 0.5 ? i : i - 1)]);
    else if (e.key === 'l') loopScene = !loopScene;
    else if (e.key === 'h') ui.classList.toggle('hidden');
    else if (e.code === 'Home') seek(0);
    else return;
    e.preventDefault();
  });
  requestAnimationFrame(step);
}

void boot();

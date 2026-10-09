// Preview + render host. In the browser this is a scrubbable preview; with ?render=1 it exposes a
// frame() hook that the offline renderer (render.mjs) drives in headless Edge.
import '@fontsource-variable/inter/wght.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import { Renderer } from './engine/renderer';
import { COPY } from './copy';
import { DURATION, FPS, SCENES, autoSamples, sceneAt } from './timeline';

declare global {
  interface Window {
    __video?: { ready: boolean; fps: number; duration: number; frame: (t: number, samples: number | 'auto', shutter: number, fps: number) => string };
  }
}

const params = new URLSearchParams(location.search);
const renderMode = params.has('render');
const scale = Math.max(1, Math.min(2, Number(params.get('scale') ?? 1) || 1));
const canvas = document.getElementById('c') as HTMLCanvasElement;

async function loadFonts() {
  // pass every string on screen so each needed unicode-range subset is fetched (→, −, ·, …)
  const sample = JSON.stringify(COPY) + ' →−·…~%0123456789';
  await Promise.all(
    ['500 24px "Inter Variable"', '600 36px "Inter Variable"', '700 112px "Inter Variable"', '400 16px "IBM Plex Mono"', '500 16px "IBM Plex Mono"'].map((f) =>
      document.fonts.load(f, sample),
    ),
  );
  await document.fonts.ready;
}

async function boot() {
  await loadFonts();
  const renderer = new Renderer(canvas, scale);
  if (renderMode) {
    document.body.classList.add('render');
    window.__video = {
      ready: true,
      fps: FPS,
      duration: DURATION,
      frame: (t, samples, shutter, fps) => {
        renderer.frame(t, samples === 'auto' ? autoSamples(t) : samples, shutter, fps);
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

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
  let t = Math.max(0, Math.min(DURATION - 1e-3, Number(params.get('t') ?? 0) || 0));
  let playing = false;
  let loopScene = false;
  let last = performance.now();

  const seek = (v: number) => {
    t = Math.max(0, Math.min(DURATION - 1 / FPS, v));
  };
  const step = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      const sc = sceneAt(t);
      t += dt;
      if (loopScene && t >= sc.end) t = sc.start;
      else if (t >= DURATION) t = 0;
    }
    renderer.frame(t);
    const sc = sceneAt(t);
    time.textContent = `${fmt(t)} / ${fmt(DURATION)}   f ${Math.floor(t * FPS + 1e-6)}`;
    scene.textContent = `${sc.index}  ${sc.label}`;
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
    const i = SCENES.indexOf(sceneAt(t));
    if (e.code === 'Space') playing = !playing;
    else if (e.code === 'ArrowRight') seek(t + big);
    else if (e.code === 'ArrowLeft') seek(t - big);
    else if (e.key === '.') seek(t + 1 / FPS);
    else if (e.key === ',') seek(t - 1 / FPS);
    else if (e.key === ']') seek(SCENES[Math.min(SCENES.length - 1, i + 1)].start);
    else if (e.key === '[') seek(SCENES[Math.max(0, t - SCENES[i].start > 0.5 ? i : i - 1)].start);
    else if (e.key === 'l') loopScene = !loopScene;
    else if (e.key === 'h') ui.classList.toggle('hidden');
    else if (e.code === 'Home') seek(0);
    else return;
    e.preventDefault();
  });
  requestAnimationFrame(step);
}

void boot();

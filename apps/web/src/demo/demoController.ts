/**
 * Demo director: advances the demo clock with requestAnimationFrame (pausable), fires the script's
 * cues (camera shots, strategy, layers, Why-this-plan) and glides the playhead to each step's
 * data-derived target. Manual playback actions pause it (see playback.ts); Resume continues from
 * wherever the user left the playhead.
 */
import { useEffect } from 'react';
import { useTwin, type Layers } from '@/state/store';
import { DEMO_LENGTH, DEMO_STEPS, stepAt, type DemoCtx } from './demoScript';

const director = {
  elapsed: 0,
  fired: new Set<string>(),
  lastPublished: -1,
};

function demoCtx(): DemoCtx | null {
  const s = useTwin.getState();
  if (!s.topology || !s.runsByStrategy.encirra) return null;
  return { runs: s.runsByStrategy, topology: s.topology };
}

function fireCues(stepIdx: number, localT: number, c: DemoCtx) {
  const s = useTwin.getState();
  DEMO_STEPS[stepIdx].cues.forEach((cue, ci) => {
    const key = `${stepIdx}:${ci}`;
    if (cue.at > localT || director.fired.has(key)) return;
    director.fired.add(key);
    if (cue.strategy) s.switchStrategy(cue.strategy);
    if (cue.layers) for (const [k, v] of Object.entries(cue.layers)) s.setLayer(k as keyof Layers, !!v);
    if (cue.overview) s.setOverviewMode(cue.overview);
    if (cue.whyPlan !== undefined) s.setWhyPlanOpen(cue.whyPlan);
    if (cue.jump) {
      const f = cue.jump(c);
      if (f != null) s.setPlayhead(f);
    }
    if (cue.minFrame) {
      const f = cue.minFrame(c);
      if (f != null && useTwin.getState().playhead < f) s.setPlayhead(f);
    }
    if (cue.camera) s.requestCamera({ shot: cue.camera.shot, durationS: cue.camera.durationS });
  });
}

function glide(stepIdx: number, localT: number, dt: number, c: DemoCtx) {
  const g = DEMO_STEPS[stepIdx].glides.find((x) => localT >= x.from && localT <= x.to + dt);
  if (!g) return;
  const target = g.target(c);
  if (target == null) return;
  const s = useTwin.getState();
  const remaining = g.to - localT;
  const next = remaining <= dt ? target : s.playhead + (target - s.playhead) * Math.min(1, dt / remaining);
  s.setPlayhead(next);
}

function seekTo(t: number) {
  director.elapsed = Math.max(0, Math.min(DEMO_LENGTH, t));
  const i = stepAt(director.elapsed);
  // cues of the target step (and later) fire again; earlier steps count as done
  for (const key of [...director.fired]) if (Number(key.split(':')[0]) >= i) director.fired.delete(key);
  DEMO_STEPS.slice(0, i).forEach((st, si) => st.cues.forEach((_, ci) => director.fired.add(`${si}:${ci}`)));
  director.lastPublished = -1;
  const c = demoCtx();
  if (c) fireCues(i, director.elapsed - DEMO_STEPS[i].start, c);
  useTwin.getState().setDemo({ stepIndex: i, elapsedS: director.elapsed, stepStartedAt: performance.now() });
}

export function startDemo() {
  const s = useTwin.getState();
  if (!demoCtx()) return;
  director.fired.clear();
  s.setPage('live');
  s.setSelected(null);
  s.setPlaying(false);
  s.setAboutOpen(false);
  s.setFocusTwin(false);
  s.playIntro();
  s.setCameraMode('cinematic');
  s.setDemo({ active: true, paused: false, stepIndex: 0, elapsedS: 0, stepStartedAt: performance.now() });
  seekTo(0);
}

export const demoControls = {
  pause() {
    useTwin.getState().setDemo({ paused: true });
  },
  resume() {
    const s = useTwin.getState();
    if (director.elapsed >= DEMO_LENGTH) return startDemo();
    s.setPlaying(false);
    s.setCameraMode('cinematic');
    s.setDemo({ paused: false });
  },
  skip() {
    const i = stepAt(director.elapsed);
    if (i + 1 < DEMO_STEPS.length) seekTo(DEMO_STEPS[i + 1].start);
    else seekTo(DEMO_LENGTH);
  },
  back() {
    const i = stepAt(director.elapsed);
    const local = director.elapsed - DEMO_STEPS[i].start;
    seekTo(local > 3 || i === 0 ? DEMO_STEPS[i].start : DEMO_STEPS[i - 1].start);
  },
  restart() {
    startDemo();
  },
  exit() {
    const s = useTwin.getState();
    s.setDemo({ active: false, paused: false });
    s.setWhyPlanOpen(false);
    s.setLayer('underground', false);
    s.setCameraMode('orbit');
  },
  elapsed: () => director.elapsed,
};

/** Mount once (AppShell). Runs the demo clock while the demo is active and not paused. */
export function useDemoDirector() {
  const active = useTwin((s) => s.demo.active);
  const paused = useTwin((s) => s.demo.paused);
  useEffect(() => {
    if (!active || paused) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const s = useTwin.getState();
      if (!s.demo.active || s.demo.paused) return;
      const c = demoCtx();
      if (!c) return;
      director.elapsed = Math.min(DEMO_LENGTH, director.elapsed + dt);
      const i = stepAt(director.elapsed);
      const localT = director.elapsed - DEMO_STEPS[i].start;
      fireCues(i, localT, c);
      glide(i, localT, dt, c);
      const tick8 = Math.floor(director.elapsed * 8);
      if (tick8 !== director.lastPublished || i !== s.demo.stepIndex) {
        director.lastPublished = tick8;
        s.setDemo({ elapsedS: director.elapsed, ...(i !== s.demo.stepIndex ? { stepIndex: i, stepStartedAt: now } : {}) });
      }
      if (director.elapsed >= DEMO_LENGTH) {
        s.setDemo({ paused: true, elapsedS: DEMO_LENGTH });
        s.setCameraMode('orbit');
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, paused]);
}

/**
 * Playback of a run's frames. The playhead is a fractional frame index advanced by a
 * requestAnimationFrame loop at `speed` simulated minutes per real second; it stops at the end.
 */
import { useEffect } from 'react';
import { useTwin } from '@/state/store';
import { frameIndexAtT, stepSeconds } from '@/data/selectors';

export const SPEEDS = [0.5, 1, 2, 5, 10] as const;

/** Mount once (AppShell). Runs only while `playing` is true. */
export function usePlaybackLoop() {
  const playing = useTwin((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
      last = now;
      const s = useTwin.getState();
      const run = s.run;
      if (!s.playing || !run || run.frames.length < 2) return;
      const end = run.frames.length - 1;
      const next = s.playhead + (dt * s.speed * 60) / stepSeconds(run);
      if (next >= end) {
        s.setPlayhead(end);
        s.setPlaying(false);
        return;
      }
      s.setPlayhead(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

/** A manual playback action pauses a running guided demo (manual intervention). */
export function interruptDemo() {
  const s = useTwin.getState();
  if (s.demo.active && !s.demo.paused) s.setDemo({ paused: true });
}

export const playback = {
  play() {
    interruptDemo();
    const s = useTwin.getState();
    const n = s.run?.frames.length ?? 0;
    if (n > 1 && s.playhead >= n - 1) s.setPlayhead(0); // replay from the start
    s.setPlaying(true);
  },
  pause() {
    interruptDemo();
    useTwin.getState().setPlaying(false);
  },
  toggle() {
    if (useTwin.getState().playing) playback.pause();
    else playback.play();
  },
  step(delta: number) {
    interruptDemo();
    const s = useTwin.getState();
    s.setPlaying(false);
    const base = delta > 0 ? Math.floor(s.playhead + 1e-6) : Math.ceil(s.playhead - 1e-6);
    s.setPlayhead(base + delta);
  },
  reset() {
    interruptDemo();
    const s = useTwin.getState();
    s.setPlaying(false);
    s.setPlayhead(0);
  },
  seek(frame: number) {
    interruptDemo();
    useTwin.getState().setPlayhead(frame);
  },
  seekT(tSeconds: number) {
    const s = useTwin.getState();
    if (!s.run) return;
    playback.seek(frameIndexAtT(s.run, tSeconds));
  },
  setSpeed(speed: number) {
    useTwin.getState().setSpeed(speed);
  },
};

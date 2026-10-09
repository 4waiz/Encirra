// When each scene plays. Times are in seconds; scenes cross-fade over the boundaries.

export const FPS = 24;
export const DURATION = 20;

export interface SceneSpec {
  id: 'performance' | 'enhancements' | 'webgl';
  index: string;
  label: string;
  start: number;
  end: number;
}

export const SCENES: SceneSpec[] = [
  { id: 'performance', index: '01 / 03', label: 'Performance', start: 0, end: 5 },
  { id: 'enhancements', index: '02 / 03', label: 'UI Enhancements', start: 5, end: 13 },
  { id: 'webgl', index: '03 / 03', label: 'WebGL & Optimization', start: 13, end: 20 },
];

/** Fast moves get more motion-blur sub-samples in "auto" mode (seconds, inclusive). */
export const FAST_MOTION: [number, number][] = [
  [0.85, 1.8], // data card entrance
  [7.85, 9.3], // sensor ring pulses
  [8.7, 10.0], // labels separating, brackets framing
  [10.75, 12.35], // correlation graph filling the panel
  [12.5, 13.65], // scene change + snap-in
  [14.45, 15.4], // wipe
  [16.0, 16.55], // delta chip pop
];

export function autoSamples(t: number) {
  return FAST_MOTION.some(([a, b]) => t >= a && t <= b) ? 20 : 8;
}

export const sceneAt = (t: number) => SCENES.find((s) => t >= s.start && t < s.end) ?? SCENES[SCENES.length - 1];

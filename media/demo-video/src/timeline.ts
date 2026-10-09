// The edit: a title card, six recorded segments laid end to end with short dissolves, and an outro.
// Segment timing comes from the recorded clips (in/out points below); callouts and camera moves are in
// segment-local seconds, and the ones tied to app events read their timing from the manifest.
import { clip, clipDuration, firstInside, firstWhen, type ClipName, type Rect } from './footage';

export const FPS = 60;
export const DURATION = 60;
/** title card length before the first segment */
export const TITLE = 3.4;
/** dissolve between segments (centred on each cut) */
export const XF = 0.32;

export interface CamKey {
  /** segment-local start of the move */
  at: number;
  /** move duration (default 1.2 s) */
  dur?: number;
  z: number;
  /** focus point: a probe's centre at `at` (plus dx/dy), or explicit CSS px */
  probe?: string;
  dx?: number;
  dy?: number;
  x?: number;
  y?: number;
}

export interface Callout {
  at: number;
  dur: number;
  probe: string;
  label: string;
  sub?: string;
  side: 'top' | 'bottom' | 'left' | 'right';
  tone?: 'cyan' | 'mint' | 'amber';
  spot?: boolean;
  pad?: number;
  /** shift the chip along its edge (px) */
  nudge?: number;
}

export interface Segment {
  id: ClipName;
  index: string;
  kicker: string;
  title: string;
  start: number;
  end: number;
  /** clip time shown at `start` */
  clipIn: number;
  camera: CamKey[];
  callouts: Callout[];
}

/** Moments in a recording, in segment-local seconds (already offset by the cut's in-point). */
export interface Moments {
  /** first moment the app facts satisfy `test` */
  ev: (test: Parameters<typeof firstWhen>[1]) => number;
  /** the n-th recorded click (0-based) */
  click: (n: number) => number;
  /** the n-th recorded keypress */
  key: (n: number) => number;
  /** first moment ≥ after when a probe sits fully inside an area (CSS px) */
  inside: (probe: string, area: Rect, after?: number) => number;
}

interface Cut {
  id: ClipName;
  kicker: string;
  title: string;
  in: number;
  /** clip time to end on (default: end of clip) */
  out?: number;
  camera?: (m: Moments) => CamKey[];
  callouts?: (m: Moments) => Callout[];
}

/** the twin viewport, inside its side panels (CSS px) — where a 3D marker can be pointed at */
const TWIN_AREA: Rect = [300, 70, 1180, 760];

// Callouts in a segment never overlap in time, so their chips never collide.
const CUTS: Cut[] = [
  {
    id: 'overview',
    kicker: '01 · Live overview',
    title: 'Every CBRN signal on one screen',
    in: 0.4,
    callouts: (m) => [
      { at: m.key(0) + 0.3, dur: m.key(1) - m.key(0) - 0.25, probe: 'palette', label: 'Run a synthetic scenario', sub: 'COMMAND PALETTE', side: 'right', pad: 4 },
      { at: m.ev((f) => f.ev === 'Sensor trend flagged') + 0.15, dur: 2.7, probe: 'events', label: 'Gamma trend flagged at RAD-S17', sub: 'AI EVENT STREAM', side: 'top', tone: 'amber', pad: 2 },
      { at: m.ev((f) => f.inc === 'new') + 0.3, dur: 2.6, probe: 'fusion', label: '3 sources correlated · incident opened', sub: 'AI FUSION · 74% CONFIDENCE', side: 'right', spot: true, pad: 4 },
    ],
    camera: (m) => [
      { at: m.ev((f) => f.ev === 'Sensor trend flagged') - 0.5, z: 1.28, probe: 'events', dy: -70, dur: 1.3 },
      { at: m.ev((f) => f.inc === 'new') - 0.3, z: 1.2, x: 700, y: 500, dur: 1.3 },
    ],
  },
  {
    id: 'twin',
    kicker: '02 · 3D digital twin',
    title: 'The site, the sensors and the response in 3D',
    in: 0,
    callouts: (m) => [
      { at: m.click(1) + 0.25, dur: 2.0, probe: 'inspector', label: 'RAD-S17 · live reading and trend', sub: 'INSPECTOR', side: 'left', tone: 'amber', pad: 2 },
      { at: m.click(2) + 0.15, dur: 1.9, probe: 'weather', label: 'Wind field drives the plume model', sub: 'LAYERS', side: 'right', pad: 2 },
      m.inside('ugv', TWIN_AREA, m.click(2) + 2.2) < 1e5
        ? { at: m.inside('ugv', TWIN_AREA, m.click(2) + 2.2), dur: 2.0, probe: 'ugv', label: 'UGV-01 dispatched to inspect', sub: 'AUTONOMOUS TASKING', side: 'top', pad: 4 }
        : { at: m.click(2) + 2.15, dur: 2.0, probe: 'pin', label: 'Incident pinned on the dose-rate field', sub: 'RADIATION LAYER', side: 'right', tone: 'amber', pad: 4 },
    ],
  },
  {
    id: 'feeds',
    kicker: '03 · Live feeds',
    title: 'Robot and camera feeds with thermal analytics',
    in: 0,
    callouts: (m) => [
      { at: 0.35, dur: m.click(0) - 0.45, probe: 'hotspot', label: 'Hotspot on the equipment skid', sub: 'UGV-01 MAST CAMERA', side: 'left', tone: 'amber', pad: 6 },
      { at: m.click(0) + 0.45, dur: 2.1, probe: 'hotspot', label: 'Thermal signature confirms it', sub: 'LWIR · SYNTHETIC ANALYTICS', side: 'left', tone: 'amber', pad: 6 },
    ],
    camera: (m) => [
      { at: 0.0, z: 1.22, x: 760, y: 420, dur: 1.2 },
      { at: m.click(1) + 0.3, z: 1, x: 960, y: 540, dur: 1.1 },
    ],
  },
  {
    id: 'insights',
    kicker: '04 · AI insights',
    title: 'Explainable correlation. A person makes the call.',
    in: 0,
    callouts: (m) => [
      { at: 0.3, dur: 1.75, probe: 'graph', label: 'Every source and its weight', sub: 'CROSS-SOURCE CORRELATION', side: 'top', pad: 2 },
      { at: 2.15, dur: m.click(0) - 2.3, probe: 'conf', label: 'Above the 85% human-validation line', sub: 'CONFIDENCE TIMELINE', side: 'top', tone: 'amber', pad: 2 },
      { at: m.click(0) + 0.15, dur: 2.1, probe: 'validate', label: 'Validated by the operator', sub: 'ADVISORY ONLY · NO AUTO-ACTION', side: 'bottom', tone: 'mint', pad: 4 },
    ],
  },
  {
    id: 'incidents',
    kicker: '05 · Incident response',
    title: 'Acknowledge, task and log every decision',
    in: 0,
    callouts: (m) => [
      { at: m.click(0) + 0.15, dur: m.click(1) - m.click(0) - 0.25, probe: 'ack', label: 'Acknowledged', sub: 'RESPONSE TIMER STOPS', side: 'bottom', tone: 'mint', pad: 4 },
      { at: m.click(1) - 0.05, dur: m.click(3) - m.click(1) + 0.1, probe: 'checklist', label: 'Response checklist', sub: 'PRIORITISED STEPS', side: 'left', pad: 2 },
      { at: m.key(0) + 0.2, dur: 1.7, probe: 'timeline', label: 'Logged to the audit timeline', sub: 'INCIDENT LOG', side: 'right', pad: 2 },
    ],
    camera: (m) => [
      { at: m.click(0) - 0.8, z: 1.18, x: 1000, y: 380, dur: 1.0 },
      { at: m.key(0) - 0.1, z: 1, x: 960, y: 540, dur: 1.0 },
    ],
  },
  {
    id: 'replay',
    kicker: '06 · Replay',
    title: 'Rewind the incident in the twin',
    in: 0,
    callouts: (m) => [
      { at: m.click(0) + 0.15, dur: m.click(1) - m.click(0) - 0.1, probe: 'scrub', label: 'Scrub back to any moment', sub: 'TIMELINE · LAST 30 MINUTES', side: 'top', pad: 2 },
      { at: m.click(2) + 0.2, dur: 1.9, probe: 'pin', label: 'The incident plays back at 4×', sub: 'REPLAY', side: 'top', tone: 'amber', pad: 4 },
    ],
    camera: (m) => [
      { at: m.click(0) - 0.7, z: 1.3, x: 1100, y: 860, dur: 0.9 },
      { at: m.click(2) + 0.05, z: 1, x: 960, y: 540, dur: 1.0 },
    ],
  },
];

export let SEGMENTS: Segment[] = [];
/** start of the outro (end of the last segment) */
export let OUTRO = DURATION - 6;

/** Lays the segments out from the recorded clip lengths. Call once the manifest is loaded. */
export function buildTimeline() {
  let t = TITLE;
  SEGMENTS = CUTS.map((c, i) => {
    const out = Math.min(c.out ?? clipDuration(c.id), clipDuration(c.id));
    const len = out - c.in;
    const rec = clip(c.id);
    const m: Moments = {
      ev: (test) => (firstWhen(c.id, test) ?? 1e6) - c.in,
      click: (n) => (rec.clicks[n] ?? 1e6) / rec.fps - c.in,
      key: (n) => (rec.keys[n]?.frame ?? 1e6) / rec.fps - c.in,
      inside: (id, area, after = 0) => (firstInside(c.id, id, area, after + c.in) ?? 1e6) - c.in,
    };
    const seg: Segment = {
      id: c.id,
      index: `${String(i + 1).padStart(2, '0')} / ${String(CUTS.length).padStart(2, '0')}`,
      kicker: c.kicker,
      title: c.title,
      start: t,
      end: t + len,
      clipIn: c.in,
      camera: c.camera?.(m) ?? [],
      callouts: c.callouts?.(m).filter((k) => k.at < len && k.dur > 0.3) ?? [],
    };
    t += len;
    return seg;
  });
  OUTRO = t;
  return { segments: SEGMENTS, outro: OUTRO, outroLength: DURATION - OUTRO };
}

export const segmentAt = (t: number) => SEGMENTS.find((s) => t >= s.start && t < s.end) ?? null;

/** Fast moves get more motion-blur sub-samples in "auto" mode. */
export function autoSamples(t: number) {
  // screen text must stay crisp, so footage moves get no blur; only the window's rise and pull-back do
  if (t > TITLE - 0.75 && t < TITLE + 0.4) return 3;
  if (t > OUTRO && t < OUTRO + 1.05) return 3;
  return 1;
}

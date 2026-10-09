// Recorded app footage: the manifest written by capture.mjs and a small cache of decoded frames.
// The footage is 2880×1620 (the app's 1920×1080 CSS layout at 1.5×); manifest rects are in CSS px.

export type ClipName = 'overview' | 'twin' | 'feeds' | 'insights' | 'incidents' | 'replay';
export type Rect = [number, number, number, number];

export interface Facts {
  screen: string;
  inc: string | null;
  incId: string | null;
  obs: string | null;
  conf: number | null;
  ev: string | null;
  replay: boolean;
  clock: string;
}

export interface FrameData {
  /** cursor position (CSS px) or null before the cursor is placed */
  c: [number, number] | null;
  /** probe rectangles (CSS px) */
  r: Record<string, Rect>;
  f: Facts;
  /** time-lapse factor this frame was recorded at */
  s: number;
}

export interface Clip {
  fps: number;
  frames: number;
  dsf: number;
  clicks: number[];
  keys: { frame: number; label: string }[];
  data: FrameData[];
}

let manifest: Partial<Record<ClipName, Clip>> = {};

export async function loadManifest() {
  manifest = await (await fetch('/footage/manifest.json')).json();
}

export function clip(name: ClipName): Clip {
  const c = manifest[name];
  if (!c) throw new Error(`footage "${name}" missing — run media/demo-video/capture.mjs`);
  return c;
}

export const clipDuration = (name: ClipName) => clip(name).frames / clip(name).fps;

export function frameIndex(name: ClipName, ct: number) {
  const c = clip(name);
  return Math.max(0, Math.min(c.frames - 1, Math.floor(ct * c.fps + 1e-6)));
}

export const frameData = (name: ClipName, ct: number) => clip(name).data[frameIndex(name, ct)];

/** A probe rect at clip time `ct` (bridging a dropped frame or two), or null when it is not on screen. */
export function probe(name: ClipName, ct: number, id: string): Rect | null {
  const c = clip(name);
  const i0 = frameIndex(name, ct);
  for (let i = i0; i >= Math.max(0, i0 - 3); i--) {
    const r = c.data[i].r[id];
    if (r) return r;
  }
  return null;
}

/** First clip time ≥ `after` at which a probe sits fully inside `area` (CSS px) — for moving 3D markers. */
export function firstInside(name: ClipName, id: string, area: Rect, after = 0) {
  const c = clip(name);
  for (let i = Math.ceil(after * c.fps); i < c.frames; i++) {
    const r = c.data[i].r[id];
    if (r && r[0] >= area[0] && r[1] >= area[1] && r[0] + r[2] <= area[0] + area[2] && r[1] + r[3] <= area[1] + area[3]) return i / c.fps;
  }
  return null;
}

/** First clip time at which `test` holds for the recorded app facts (for timing callouts to events). */
export function firstWhen(name: ClipName, test: (f: Facts) => boolean) {
  const c = clip(name);
  const i = c.data.findIndex((d) => test(d.f));
  return i < 0 ? null : i / c.fps;
}

// ------------------------------------------------------------------------------------------ frame cache

const MAX = 14;
const cache = new Map<string, ImageBitmap>();
const pending = new Map<string, Promise<ImageBitmap>>();
const lastShown = new Map<ClipName, ImageBitmap>();

const keyOf = (name: ClipName, i: number) => `${name}/${String(i).padStart(5, '0')}`;

export function load(name: ClipName, i: number): Promise<ImageBitmap> {
  const k = keyOf(name, i);
  const hit = cache.get(k);
  if (hit) {
    cache.delete(k);
    cache.set(k, hit); // most recently used last
    return Promise.resolve(hit);
  }
  let p = pending.get(k);
  if (!p) {
    p = fetch(`/footage/${k}.jpg`)
      .then((r) => {
        if (!r.ok) throw new Error(`footage frame ${k} missing`);
        return r.blob();
      })
      .then((b) => createImageBitmap(b))
      .then((bmp) => {
        pending.delete(k);
        cache.set(k, bmp);
        while (cache.size > MAX) {
          const [oldest, img] = cache.entries().next().value as [string, ImageBitmap];
          cache.delete(oldest);
          if (![...lastShown.values()].includes(img)) img.close();
        }
        return bmp;
      });
    pending.set(k, p);
  }
  return p;
}

/** The decoded frame if it is ready; otherwise the last frame shown from this clip (preview never flashes). */
export function bitmap(name: ClipName, i: number): ImageBitmap | null {
  const bmp = cache.get(keyOf(name, i));
  if (bmp) {
    lastShown.set(name, bmp);
    return bmp;
  }
  void load(name, i).catch(() => undefined);
  return lastShown.get(name) ?? null;
}

/**
 * Decorative context plan (NOT part of the modelled district).
 *
 * Water bodies and the skyline are authored in a "context frame" whose −Z axis points along the
 * home view direction (camera south-west of the district looking north-east, CONTEXT_ROT): a bay
 * runs across the view behind the district with the skyline on its far shore, a creek comes in
 * from the left and a marina basin opens on the right — the reference composition. The lower city
 * street grid stays aligned with the district grid.
 */
import { mulberry32 } from '../lib/GeoBuilder';

export const GROUND_Y = -48;
export const CONTEXT_ROT = -Math.PI / 4;
const CR = Math.cos(CONTEXT_ROT);
const SR = Math.sin(CONTEXT_ROT);

/** world (x, z) → context frame */
export function toCtx(x: number, z: number): [number, number] {
  return [x * CR - z * SR, x * SR + z * CR];
}
/** context frame → world */
export function fromCtx(x: number, z: number): [number, number] {
  return [x * CR + z * SR, -x * SR + z * CR];
}

// ── water bodies in the context frame (identical formulas in WATER_GLSL)
const bayNear = (x: number) => -560 + 40 * Math.sin(x / 300 + 0.4) + 18 * Math.sin(x / 130);
const bayFar = (x: number) => -850 + 50 * Math.sin(x / 260 + 1.0) + 20 * Math.sin(x / 110 + 2.0);
const creekC = (z: number) => -480 + 40 * Math.sin(z / 300) + 18 * Math.sin(z / 110 + 1.3);
const CREEK_HALF = 68;

/** signed distance-ish in the context frame: < 0 inside water */
function waterSdCtx(x: number, z: number) {
  const bay = Math.max(z - bayNear(x), bayFar(x) - z);
  const creek = Math.max(Math.abs(x - creekC(z)) - CREEK_HALF, bayNear(x) - 30 - z);
  const marina = Math.max(
    Math.max(500 + 30 * Math.sin(z / 200) - x, x - (820 + 40 * Math.sin(z / 170))),
    Math.max(z - (-100 + 30 * Math.sin(x / 150)), bayNear(x) - 30 - z),
  );
  const sea = z + 2400;
  return Math.min(bay, creek, marina, sea);
}
function isWaterCtx(x: number, z: number, margin: number) {
  return waterSdCtx(x, z) < margin;
}
/** world-space water test */
export function isWater(x: number, z: number, margin = 0) {
  const [cx, cz] = toCtx(x, z);
  return isWaterCtx(cx, cz, margin);
}

export const WATER_GLSL = /* glsl */ `
vec2 encToCtx(vec2 w) { return vec2(w.x * ${CR.toFixed(6)} - w.y * ${SR.toFixed(6)}, w.x * ${SR.toFixed(6)} + w.y * ${CR.toFixed(6)}); }
float encBayNear(float x) { return -560.0 + 40.0 * sin(x / 300.0 + 0.4) + 18.0 * sin(x / 130.0); }
float encBayFar(float x) { return -850.0 + 50.0 * sin(x / 260.0 + 1.0) + 20.0 * sin(x / 110.0 + 2.0); }
float encCreekC(float z) { return -480.0 + 40.0 * sin(z / 300.0) + 18.0 * sin(z / 110.0 + 1.3); }
// signed distance-ish (world input): < 0 inside water
float encWaterSd(vec2 pw) {
  vec2 p = encToCtx(pw);
  float bn = encBayNear(p.x);
  float bay = max(p.y - bn, encBayFar(p.x) - p.y);
  float creek = max(abs(p.x - encCreekC(p.y)) - ${CREEK_HALF.toFixed(1)}, bn - 30.0 - p.y);
  float marina = max(max(500.0 + 30.0 * sin(p.y / 200.0) - p.x, p.x - (820.0 + 40.0 * sin(p.y / 170.0))),
                     max(p.y - (-100.0 + 30.0 * sin(p.x / 150.0)), bn - 30.0 - p.y));
  float sea = p.y + 2400.0;
  return min(min(bay, creek), min(marina, sea));
}
`;

/** Push a context-frame point back (−Z, away from the camera) until it stands on land. */
export function ensureLandCtx(x: number, z: number, margin = 45): [number, number] {
  let zz = z;
  for (let i = 0; i < 80 && isWaterCtx(x, zz, margin); i++) zz -= 20;
  return [x, zz];
}

/** Keep-out zone around the district platform (clear sight-lines to the cut-away faces). */
export function nearDistrict(x: number, z: number, m = 0) {
  return x > -275 - m && x < 275 + m * 0.4 && z > -185 - m * 0.4 && z < 185 + m;
}

export interface TowerSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rot: number;
  kind: 0 | 1; // 0 box, 1 cylinder
  seed: number;
  tone: number; // 0 glass-blue … 1 warm stone
  base: number;
}

/** Generic background towers (context frame) around the kit landmarks. */
function cluster(out: TowerSpec[], rnd: () => number, cx: number, cz: number, rx: number, rz: number, n: number, hMin: number, hMax: number, skew = 2.2) {
  let tries = 0;
  while (n > 0 && tries++ < n * 40) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd());
    const x = cx + Math.cos(a) * rx * r;
    const z = cz + Math.sin(a) * rz * r;
    if (isWaterCtx(x, z, 35)) continue;
    const [wx, wz] = fromCtx(x, z);
    if (nearDistrict(wx, wz, 250)) continue;
    const w = 20 + rnd() * 22;
    const d = 18 + rnd() * 20;
    if (out.some((t) => Math.abs(t.x - x) < (t.w + w) * 0.7 && Math.abs(t.z - z) < (t.d + d) * 0.7)) continue;
    const h = hMin + (hMax - hMin) * Math.pow(rnd(), skew);
    out.push({ x, z, w, d, h, rot: rnd() < 0.7 ? 0 : rnd() * Math.PI, kind: rnd() < 0.12 ? 1 : 0, seed: rnd() * 1000, tone: rnd() < 0.75 ? rnd() * 0.45 : 0.5 + rnd() * 0.5, base: GROUND_Y });
    n--;
  }
}

export function skylineTowers(): TowerSpec[] {
  const rnd = mulberry32(2026);
  const out: TowerSpec[] = [];
  cluster(out, rnd, 0, -1120, 1050, 210, 70, 110, 330, 1.9); // dense waterfront on the far shore
  cluster(out, rnd, -150, -1500, 1400, 200, 46, 120, 360, 1.8); // downtown behind it
  cluster(out, rnd, -860, -420, 180, 380, 16, 90, 230, 1.8); // left, beyond the creek
  cluster(out, rnd, 1050, -380, 200, 420, 16, 90, 240, 1.8); // right, beyond the marina
  cluster(out, rnd, -100, -2050, 1700, 230, 30, 140, 300, 2.0); // far silhouettes
  return out;
}

export interface LowSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rot: number;
  seed: number;
  /** 0 glass, 1 white render, 2 beige stone, 3 grey concrete, 4 villa */
  type: number;
}

/** Dense low/mid-rise lower city on a street grid aligned with the district (spacing 120 m). */
export const LOW_GRID = 120;
export const LOW_STREET = 16;
export function lowerCity(): LowSpec[] {
  const rnd = mulberry32(77);
  const out: LowSpec[] = [];
  const R = 1900;
  for (let gx = -R; gx < R; gx += LOW_GRID) {
    for (let gz = -R; gz < R; gz += LOW_GRID) {
      const bcx = gx + LOW_GRID / 2;
      const bcz = gz + LOW_GRID / 2;
      const rb = Math.hypot(bcx, bcz);
      // block character: villa compounds near the district, mixed mid-rise further out
      const villas = rb < 760 && rnd() < 0.42;
      const bx0 = gx + LOW_STREET / 2 + 4;
      const bz0 = gz + LOW_STREET / 2 + 4;
      const span = LOW_GRID - LOW_STREET - 8;
      const nx = villas ? 4 : rnd() < 0.5 ? 3 : 4;
      const nz = villas ? 4 : rnd() < 0.5 ? 3 : 4;
      const cw = span / nx;
      const cd = span / nz;
      for (let i = 0; i < nx; i++) {
        for (let k = 0; k < nz; k++) {
          if (rnd() < (villas ? 0.25 : 0.07)) continue; // courtyards, gardens, plazas
          const x = bx0 + cw * (i + 0.5) + (rnd() - 0.5) * 4;
          const z = bz0 + cd * (k + 0.5) + (rnd() - 0.5) * 4;
          const r = Math.hypot(x, z);
          if (r > R) continue;
          if (isWater(x, z, 20) || nearDistrict(x, z, 4)) continue;
          if (villas) {
            out.push({ x, z, w: cw * (0.55 + rnd() * 0.2), d: cd * (0.55 + rnd() * 0.2), h: 6 + rnd() * 4, rot: 0, seed: rnd() * 1000, type: 4 });
            continue;
          }
          const w = cw * (0.74 + rnd() * 0.22);
          const d = cd * (0.74 + rnd() * 0.22);
          const cap = r < 700 ? 16 : r < 1200 ? 36 : 58;
          // mostly 2–6 storeys, occasional 10–20 storey blocks
          const h = rnd() < 0.12 ? 22 + rnd() * cap * 1.5 : 7 + Math.pow(rnd(), 1.5) * cap * 0.75;
          const t = rnd();
          const type = h > 30 && t < 0.45 ? 0 : t < 0.38 ? 1 : t < 0.68 ? 2 : t < 0.9 ? 3 : 0;
          out.push({ x, z, w, d, h, rot: 0, seed: rnd() * 1000, type });
        }
      }
    }
  }
  return out;
}

/** Palms along the lower-city streets on the camera side of the district: [x, z, scale, rot]. */
export function lowerCityPalms(): [number, number, number, number][] {
  const rnd = mulberry32(911);
  const out: [number, number, number, number][] = [];
  const off = LOW_STREET / 2 + 2.6;
  const add = (x: number, z: number) => {
    const [, cz] = toCtx(x, z);
    const r = Math.hypot(x, z);
    if (r < 300 || r > 760 || cz < -120) return;
    if (isWater(x, z, 8) || nearDistrict(x, z, 12)) return;
    if (rnd() > 0.55) return;
    out.push([x + (rnd() - 0.5) * 2, z + (rnd() - 0.5) * 2, 0.85 + rnd() * 0.4, rnd() * Math.PI * 2]);
  };
  for (let g = -840; g <= 840; g += LOW_GRID) {
    for (let s = -840; s <= 840; s += 15) {
      const m = ((s % LOW_GRID) + LOW_GRID) % LOW_GRID;
      if (m < 12 || m > LOW_GRID - 12) continue; // keep intersections clear
      add(g - off, s);
      add(g + off, s);
      add(s, g - off);
      add(s, g + off);
    }
  }
  return out;
}

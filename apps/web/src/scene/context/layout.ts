/**
 * Decorative context plan (NOT part of the modelled district).
 *
 * The skyline and water bodies are authored in a "context frame" for a camera looking north
 * (−Z) and rotated by CONTEXT_ROT so they frame the corner-on home view (camera south-west of
 * the district looking north-east): creek/marina on the left, bay on the right, supertall
 * behind-left, downtown behind. The lower city street grid stays aligned with the district grid.
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

// ── water bodies in the context frame (same formulas in GLSL: WATER_GLSL)
export function creekCenter(z: number) {
  return -500 + 70 * Math.sin(z / 380) + 30 * Math.sin(z / 150 + 1.3);
}
export const CREEK_HALF = 85;
export function bayEdge(z: number) {
  return 520 + 110 * Math.sin(z / 460 + 0.6) + 40 * Math.sin(z / 190);
}
function isWaterCtx(x: number, z: number, margin: number) {
  if (Math.abs(x - creekCenter(z)) < CREEK_HALF + margin) return true;
  if (x > bayEdge(z) - margin && z < 700) return true;
  if (z < -2300 + margin) return true;
  return false;
}
/** world-space water test */
export function isWater(x: number, z: number, margin = 0) {
  const [cx, cz] = toCtx(x, z);
  return isWaterCtx(cx, cz, margin);
}

export const WATER_GLSL = /* glsl */ `
float encCreekC(float z) { return -500.0 + 70.0 * sin(z / 380.0) + 30.0 * sin(z / 150.0 + 1.3); }
float encBayE(float z) { return 520.0 + 110.0 * sin(z / 460.0 + 0.6) + 40.0 * sin(z / 190.0); }
vec2 encToCtx(vec2 w) { return vec2(w.x * ${CR.toFixed(6)} - w.y * ${SR.toFixed(6)}, w.x * ${SR.toFixed(6)} + w.y * ${CR.toFixed(6)}); }
// signed distance-ish (world input): < 0 inside water
float encWaterSd(vec2 pw) {
  vec2 p = encToCtx(pw);
  float creek = abs(p.x - encCreekC(p.y)) - ${CREEK_HALF.toFixed(1)};
  float bay = max(encBayE(p.y) - p.x, p.y - 700.0);
  float sea = p.y + 2300.0;
  return min(min(creek, bay), sea);
}
`;

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

/** Generic background towers (context frame), kept beyond the kit landmarks as hazy silhouettes. */
function cluster(out: TowerSpec[], rnd: () => number, cx: number, cz: number, rx: number, rz: number, n: number, hMin: number, hMax: number, skew = 2.2) {
  let tries = 0;
  while (n > 0 && tries++ < n * 40) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd());
    const x = cx + Math.cos(a) * rx * r;
    const z = cz + Math.sin(a) * rz * r;
    if (isWaterCtx(x, z, 30)) continue;
    const [wx, wz] = fromCtx(x, z);
    if (nearDistrict(wx, wz, 250)) continue;
    const w = 22 + rnd() * 22;
    const d = 20 + rnd() * 20;
    if (out.some((t) => Math.abs(t.x - x) < (t.w + w) * 0.7 && Math.abs(t.z - z) < (t.d + d) * 0.7)) continue;
    const h = hMin + (hMax - hMin) * Math.pow(rnd(), skew);
    out.push({ x, z, w, d, h, rot: rnd() < 0.7 ? 0 : rnd() * Math.PI, kind: rnd() < 0.12 ? 1 : 0, seed: rnd() * 1000, tone: rnd() < 0.72 ? rnd() * 0.45 : 0.5 + rnd() * 0.5, base: GROUND_Y });
    n--;
  }
}

export function skylineTowers(): TowerSpec[] {
  const rnd = mulberry32(2026);
  const out: TowerSpec[] = [];
  cluster(out, rnd, 0, -1350, 950, 260, 34, 90, 250, 2.2); // downtown band behind
  cluster(out, rnd, -1150, -650, 260, 700, 26, 110, 300, 1.8); // left (marina) frame
  cluster(out, rnd, 1000, -700, 200, 650, 22, 100, 280, 1.8); // right frame
  cluster(out, rnd, -200, -1900, 1400, 260, 30, 120, 320, 2.0); // far silhouettes
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
      // block interior (street centre lines on multiples of LOW_GRID)
      const bx0 = gx + LOW_STREET / 2 + 4;
      const bz0 = gz + LOW_STREET / 2 + 4;
      const span = LOW_GRID - LOW_STREET - 8;
      const nx = rnd() < 0.5 ? 3 : 4;
      const nz = rnd() < 0.5 ? 3 : 4;
      const cw = span / nx;
      const cd = span / nz;
      for (let i = 0; i < nx; i++) {
        for (let k = 0; k < nz; k++) {
          if (rnd() < 0.07) continue; // courtyard / plaza
          const x = bx0 + cw * (i + 0.5) + (rnd() - 0.5) * 4;
          const z = bz0 + cd * (k + 0.5) + (rnd() - 0.5) * 4;
          const r = Math.hypot(x, z);
          if (r > R) continue;
          if (isWater(x, z, 20) || nearDistrict(x, z, 4)) continue;
          const w = cw * (0.74 + rnd() * 0.22);
          const d = cd * (0.74 + rnd() * 0.22);
          const near = r < 700;
          const cap = near ? 15 : r < 1200 ? 34 : 56;
          // mostly 2–5 storeys with occasional taller blocks
          const h = rnd() < 0.12 ? 18 + rnd() * cap * 1.4 : 6 + Math.pow(rnd(), 1.6) * cap * 0.7;
          out.push({ x, z, w, d, h, rot: 0, seed: rnd() * 1000 });
        }
      }
    }
  }
  return out;
}

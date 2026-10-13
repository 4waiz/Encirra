/**
 * Decorative context plan (NOT part of the modelled district): creek on the west, a bay on the
 * east, a lower city grid all around and skyline clusters arranged like the reference
 * composition (supertall behind-left, towers framing both sides, downtown behind the district).
 */
import { mulberry32 } from '../lib/GeoBuilder';
import { bendDrop } from './bend';

export const GROUND_Y = -48;

// ── water bodies (same formulas in GLSL: see WATER_GLSL)
export function creekCenter(z: number) {
  return -660 + 80 * Math.sin(z / 380) + 35 * Math.sin(z / 150 + 1.3);
}
export const CREEK_HALF = 85;
export function bayEdge(z: number) {
  return 820 + 140 * Math.sin(z / 460 + 0.6) + 50 * Math.sin(z / 190);
}
export function isWater(x: number, z: number, margin = 0) {
  if (Math.abs(x - creekCenter(z)) < CREEK_HALF + margin) return true;
  if (x > bayEdge(z) - margin && z < 900) return true;
  if (z < -2600 + margin) return true;
  return false;
}

export const WATER_GLSL = /* glsl */ `
float encCreekC(float z) { return -660.0 + 80.0 * sin(z / 380.0) + 35.0 * sin(z / 150.0 + 1.3); }
float encBayE(float z) { return 820.0 + 140.0 * sin(z / 460.0 + 0.6) + 50.0 * sin(z / 190.0); }
// signed distance-ish: < 0 inside water
float encWaterSd(vec2 p) {
  float creek = abs(p.x - encCreekC(p.y)) - ${CREEK_HALF.toFixed(1)};
  float bay = max(encBayE(p.y) - p.x, p.y - 900.0);
  float sea = p.y + 2600.0;
  return min(min(creek, bay), sea);
}
`;

/** Keep-out zone around the district platform (clear sight-lines to the cut-away faces). */
export function nearDistrict(x: number, z: number, m = 0) {
  return x > -330 - m && x < 320 + m && z > -230 - m && z < 235 + m;
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
  base: number; // world y of the base (after the curved-world drop)
}

function cluster(out: TowerSpec[], rnd: () => number, cx: number, cz: number, rx: number, rz: number, n: number, hMin: number, hMax: number, skew = 2.2) {
  let tries = 0;
  while (n > 0 && tries++ < n * 30) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd());
    const x = cx + Math.cos(a) * rx * r;
    const z = cz + Math.sin(a) * rz * r;
    if (isWater(x, z, 30) || nearDistrict(x, z, 120)) continue;
    const w = 26 + rnd() * 34;
    const d = 24 + rnd() * 30;
    if (out.some((t) => Math.abs(t.x - x) < (t.w + w) * 0.6 && Math.abs(t.z - z) < (t.d + d) * 0.6)) continue;
    const h = hMin + (hMax - hMin) * Math.pow(rnd(), skew);
    out.push({ x, z, w, d, h, rot: rnd() < 0.7 ? 0 : rnd() * Math.PI, kind: rnd() < 0.22 ? 1 : 0, seed: rnd() * 1000, tone: rnd(), base: GROUND_Y });
    n--;
  }
}

export function skylineTowers(): TowerSpec[] {
  const rnd = mulberry32(2026);
  const out: TowerSpec[] = [];
  // downtown behind the district
  cluster(out, rnd, 60, -1350, 650, 520, 70, 110, 420, 2.0);
  // west marina across the creek
  cluster(out, rnd, -1180, -700, 330, 900, 55, 90, 320, 2.2);
  // east waterfront
  cluster(out, rnd, 600, -800, 200, 650, 36, 90, 300, 2.0);
  // far ring (silhouettes)
  cluster(out, rnd, -200, -2150, 1500, 330, 60, 80, 260, 2.4);
  cluster(out, rnd, 1500, 300, 260, 900, 25, 70, 220, 2.4);
  cluster(out, rnd, -1500, 900, 300, 500, 22, 60, 200, 2.4);
  for (const t of out) t.base = GROUND_Y - bendDrop(t.x, t.z);
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

/** Low/mid-rise lower city on a street grid (spacing 120 m) around the platform. */
export const LOW_GRID = 120;
export function lowerCity(): LowSpec[] {
  const rnd = mulberry32(77);
  const out: LowSpec[] = [];
  const R = 2600;
  for (let gx = -R; gx < R; gx += LOW_GRID) {
    for (let gz = -R; gz < R; gz += LOW_GRID) {
      const n = 2 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const x = gx + 20 + rnd() * (LOW_GRID - 40);
        const z = gz + 20 + rnd() * (LOW_GRID - 40);
        const r = Math.hypot(x, z);
        if (r > R) continue;
        if (isWater(x, z, 25) || nearDistrict(x, z, 40)) continue;
        // keep the foreground in front of the cut-away low
        const front = z > 160 && z < 900 && x > -800 && x < 500;
        const w = 18 + rnd() * 26;
        const d = 16 + rnd() * 26;
        let h = 10 + Math.pow(rnd(), 2.2) * (front ? 22 : 70);
        if (r > 1600) h *= 1.3;
        out.push({ x, z, w, d, h, rot: rnd() < 0.85 ? 0 : Math.PI / 4, seed: rnd() * 1000 });
      }
    }
  }
  return out;
}

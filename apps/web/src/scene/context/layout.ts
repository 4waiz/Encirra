/**
 * Decorative context plan (NOT part of the modelled district): creek on the west, a bay on the
 * east, a lower city grid all around and skyline clusters arranged like the reference
 * composition (supertall behind-left, towers framing both sides, downtown behind the district).
 */
import { mulberry32 } from '../lib/GeoBuilder';

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
  // generous clearance to the south and west (cut-away sight lines), tighter to the north/east
  return x > -340 - m && x < 285 + m * 0.4 && z > -200 - m * 0.4 && z < 240 + m;
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
    const w = 24 + rnd() * 26;
    const d = 22 + rnd() * 24;
    if (out.some((t) => Math.abs(t.x - x) < (t.w + w) * 0.6 && Math.abs(t.z - z) < (t.d + d) * 0.6)) continue;
    const h = hMin + (hMax - hMin) * Math.pow(rnd(), skew);
    out.push({ x, z, w, d, h, rot: rnd() < 0.7 ? 0 : rnd() * Math.PI, kind: rnd() < 0.1 ? 1 : 0, seed: rnd() * 1000, tone: rnd() < 0.68 ? rnd() * 0.45 : 0.5 + rnd() * 0.5, base: GROUND_Y });
    n--;
  }
}

export function skylineTowers(): TowerSpec[] {
  const rnd = mulberry32(2026);
  const out: TowerSpec[] = [];
  // downtown behind the district (kept lower so the dusk sky stays visible above it)
  cluster(out, rnd, 120, -1050, 650, 300, 34, 90, 260, 2.4);
  // west marina across the creek (tall, frames the left side)
  cluster(out, rnd, -1080, -560, 280, 640, 34, 140, 380, 1.6);
  // east waterfront (frames the right side)
  cluster(out, rnd, 680, -620, 170, 520, 26, 130, 340, 1.6);
  // far silhouettes
  cluster(out, rnd, -150, -1550, 1300, 250, 24, 120, 320, 2.0);
  cluster(out, rnd, 1180, 120, 200, 640, 16, 90, 260, 2.0);
  cluster(out, rnd, -1350, 600, 240, 380, 14, 80, 220, 2.2);
  // base is the flat-world height; the curved-world drop is applied in the vertex shader
  for (const t of out) t.base = GROUND_Y;
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
        const front = z > 160 && z < 1100 && x > -900 && x < 200;
        const w = 18 + rnd() * 26;
        const d = 16 + rnd() * 26;
        const cap = front ? 10 : r < 650 ? 20 : r < 1100 ? 42 : 75;
        const h = 6 + Math.pow(rnd(), 2.0) * cap;
        out.push({ x, z, w, d, h, rot: rnd() < 0.85 ? 0 : Math.PI / 4, seed: rnd() * 1000 });
      }
    }
  }
  return out;
}

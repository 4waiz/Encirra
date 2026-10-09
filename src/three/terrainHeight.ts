// Inland desert relief as a pure function of (x, z), shared by the dune geometry and everything that
// sits on the ground (vegetation). The campus and the coastal plain stay flat; dunes begin inland and
// grow with distance from the sea; roads and the power-line corridor are graded flat.
//
// Coordinates: x = east, z = south (inland), metres. The prevailing wind is from the north-west, so
// transverse dune crests run north-east → south-west with steep slip faces on their lee side.

export const DUNE_START = 650;
/** north–south access road and the inland east–west highway */
export const ROAD_X = -588;
export const HIGHWAY_Z = 2600;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function hash2(ix: number, iz: number) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/** Fractal value noise in [0, 1]. */
export function fbm(x: number, z: number, octaves = 4) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq + i * 17.31, z * freq - i * 9.73);
    norm += amp;
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

// unit vector the wind blows toward (south-south-east)
const WX = 0.62;
const WZ = 0.785;

/** 0 on graded ground (campus, coastal plain, roads, power lines), 1 where dunes form freely. */
export function duneMask(x: number, z: number) {
  if (z <= DUNE_START) return 0;
  const inland = smoothstep(DUNE_START, DUNE_START + 700, z);
  const powerLines = 1 - (1 - smoothstep(110, 210, Math.abs(x))) * (1 - smoothstep(1850, 2080, z));
  const road = smoothstep(26, 90, Math.abs(x - ROAD_X));
  const highway = smoothstep(28, 100, Math.abs(z - HIGHWAY_Z));
  return inland * powerLines * road * highway;
}

export function terrainHeight(x: number, z: number) {
  const mask = duneMask(x, z);
  if (mask <= 0) return 0;
  const u = x * WX + z * WZ; // along the wind
  const v = -x * WZ + z * WX; // along the crests
  const warp = (fbm(v * 0.0011 + 3.1, u * 0.0009 - 1.7, 3) - 0.5) * 560;
  const phase = (u + warp) / 300;
  const s = phase - Math.floor(phase);
  const brink = 0.8;
  // long convex windward slope, short steep slip face
  const profile = s < brink ? Math.pow(Math.sin(((s / brink) * Math.PI) / 2), 1.3) : 1 - smoothstep(0, 1, (s - brink) / (1 - brink));
  const crest = 0.4 + 0.6 * fbm(v * 0.0023 + 7.7, u * 0.0011 + 2.2, 3);
  const grow = 12 + 27 * smoothstep(900, 6500, z);
  const swell = (fbm(x * 0.00055 + 11.0, z * 0.00055 - 4.0, 3) - 0.38) * 18;
  return mask * Math.max(0, grow * profile * crest + swell);
}

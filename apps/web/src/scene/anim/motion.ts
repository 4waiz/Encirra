/**
 * Scene motion: intro assembly, exploded underground view and fault / restore moments.
 *
 * The district surface is cut into TILES — one per city block (block + half of each surrounding
 * street, the layout's block grid). Every frame the CPU advances a small spring per tile and a grow
 * value per building and writes them into two float textures; the district vertex shaders (buildings,
 * block surface, props, glow sprites) read them (`TILE_VERT_GLSL`). No per-object React state.
 *
 *  tileTex (N_TILE × 3)  row0: offset xyz, yaw   row1: tiltX, tiltZ, —, —   row2: pivot x, z (static)
 *  bldAnimTex (N_BLD)    r: grow 0…1 (height scale)   g: tile index (static)
 *
 * Honours prefers-reduced-motion (instant state, no bobbing / jolts / bursts).
 */
import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import { district } from '@encirra/shared';
import { BUILDINGS, N_BLD, PLATFORM } from '../data/twin';

// ───────────────────────────────────────────── tiles (layout block grid)
const ST = district.streets.streetsX; // x centre lines
const AV = district.streets.avenuesZ; // z centre lines
const XE = [PLATFORM.minX, ...ST, PLATFORM.maxX];
const ZE = [PLATFORM.minZ, ...AV, PLATFORM.maxZ];
export const N_COL = XE.length - 1;
export const N_ROW = ZE.length - 1;
export const N_TILE = N_COL * N_ROW;

export interface TileDef {
  index: number;
  col: number;
  row: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  cx: number;
  cz: number;
  dist: number; // from the platform centre
}
export const TILES: TileDef[] = [];
for (let c = 0; c < N_COL; c++)
  for (let r = 0; r < N_ROW; r++) {
    const cx = (XE[c] + XE[c + 1]) / 2;
    const cz = (ZE[r] + ZE[r + 1]) / 2;
    TILES.push({ index: c * N_ROW + r, col: c, row: r, x0: XE[c], x1: XE[c + 1], z0: ZE[r], z1: ZE[r + 1], cx, cz, dist: Math.hypot(cx, cz) });
  }
export function tileAt(x: number, z: number) {
  let c = 0;
  while (c < N_COL - 1 && x >= XE[c + 1]) c++;
  let r = 0;
  while (r < N_ROW - 1 && z >= ZE[r + 1]) r++;
  return c * N_ROW + r;
}
const MAX_DIST = Math.max(...TILES.map((t) => t.dist));

function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ───────────────────────────────────────────── GPU state
function floatTex(w: number, h: number) {
  const t = new DataTexture(new Float32Array(w * h * 4), w, h, RGBAFormat, FloatType);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}
export const tileTex = floatTex(N_TILE, 3);
{
  const d = tileTex.image.data as Float32Array;
  for (const t of TILES) {
    const o = (2 * N_TILE + t.index) * 4;
    d[o] = t.cx;
    d[o + 1] = t.cz;
  }
}
export const bldAnimTex = floatTex(Math.max(1, N_BLD), 1);
const BLD_TILE = BUILDINGS.map((b) => tileAt(b.pos[0], b.pos[1]));
{
  const d = bldAnimTex.image.data as Float32Array;
  BUILDINGS.forEach((_, i) => {
    d[i * 4] = 1;
    d[i * 4 + 1] = BLD_TILE[i];
  });
}

/** Uniforms shared by every motion-aware material (same objects → one update per frame). */
export const motionUniforms = {
  uTileTex: { value: tileTex },
  uBldAnim: { value: bldAnimTex },
  /** seconds since props started popping in (large = settled) */
  uPropT: { value: 1e4 },
  /** cable / pipe draw-on progress 0…1 */
  uDraw: { value: 1 },
  /** uniform lift of the cable overlay in the exploded view (m) */
  uLayerLift: { value: 0 },
  /** restore energy pulse: x = start time (s), y = active 0/1 */
  uPulse: { value: [-1e4, 0] as [number, number] },
  /** ground ripples: xy = position, z = start time, w = kind (1 fault red, 2 restore green) */
  uRipple: { value: [0, 0, -1e4, 0] as [number, number, number, number] },
  uMotionTime: { value: 0 },
};

/**
 * GLSL (vertex): tile transform. `encTile(ti, p, n)` moves a district-local position p (and rotates
 * its normal n) with tile ti; `encGrow(bld, y)` scales a building's height for the intro.
 */
export const TILE_VERT_GLSL = /* glsl */ `
uniform sampler2D uTileTex;
uniform sampler2D uBldAnim;
uniform float uPropT;
float encTileOf(vec2 xz) {
  float c = 0.0;
  ${ST.map((x) => `c += step(${x.toFixed(1)}, xz.x);`).join(' ')}
  float r = 0.0;
  ${AV.map((z) => `r += step(${z.toFixed(1)}, xz.y);`).join(' ')}
  return c * ${N_ROW.toFixed(1)} + r;
}
mat3 encTileRot(vec4 a, vec4 b) {
  float cy = cos(a.w), sy = sin(a.w);
  float cx = cos(b.x), sx = sin(b.x);
  float cz = cos(b.y), sz = sin(b.y);
  mat3 ry = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
  mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
  mat3 rz = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0);
  return ry * rx * rz;
}
vec3 encTile(float ti, vec3 p, inout vec3 n) {
  int i = int(ti + 0.5);
  vec4 a = texelFetch(uTileTex, ivec2(i, 0), 0);
  vec4 b = texelFetch(uTileTex, ivec2(i, 1), 0);
  vec4 c = texelFetch(uTileTex, ivec2(i, 2), 0);
  mat3 R = encTileRot(a, b);
  vec3 piv = vec3(c.x, 0.0, c.y);
  n = R * n;
  return piv + R * (p - piv) + a.xyz;
}
vec4 encBldAnim(float bld) { return texelFetch(uBldAnim, ivec2(int(bld + 0.5), 0), 0); }
// props pop-in: staggered from the platform centre (seconds since the prop phase began)
float encPropPop(vec2 xz) {
  float delay = length(xz) / 300.0 * 0.55 + fract(sin(dot(xz, vec2(12.9898, 78.233))) * 43758.5453) * 0.15;
  float t = clamp((uPropT - delay) / 0.38, 0.0, 1.0);
  // ease-out-back pop
  float s = 1.70158;
  float u = t - 1.0;
  return t >= 1.0 ? 1.0 : max(0.0, 1.0 + (s + 1.0) * u * u * u + s * u * u);
}
`;

// ───────────────────────────────────────────── timeline / springs (CPU)
const reduceQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();

export const INTRO = {
  duration: 3.9,
  platformEnd: 1.05,
  tilesStart: 0.3,
  tileStagger: 1.0,
  tileDur: 0.9,
  growDelay: 0.5,
  growDur: 0.75,
  propsStart: 2.35,
  drawStart: 2.55,
  drawEnd: 3.65,
  labelsStart: 3.45,
};

interface Spring {
  x: number;
  v: number;
}
const sp = () => ({ x: 0, v: 0 });

const tileState = TILES.map((t) => ({
  // exploded-view springs (lift, spread) and impulse springs (jolt / lift)
  lift: sp(),
  imp: sp(),
  yaw: sp(),
  tilt: sp(),
  explodeAt: 0, // time at which this tile switches to the current explode target
  liftTarget: 42 + hash(t.index + 3) * 28,
  phase: hash(t.index + 11) * Math.PI * 2,
  // intro fly-in start pose
  fx: (t.cx / (Math.abs(t.cx) + 60)) * (90 + hash(t.index) * 140) + (hash(t.index + 5) - 0.5) * 80,
  fy: 150 + hash(t.index + 7) * 140,
  fz: (t.cz / (Math.abs(t.cz) + 60)) * (90 + hash(t.index + 1) * 140) + (hash(t.index + 6) - 0.5) * 80,
  fyaw: (hash(t.index + 2) - 0.5) * 1.2,
  ftx: (hash(t.index + 8) - 0.5) * 0.7,
  ftz: (hash(t.index + 9) - 0.5) * 0.7,
}));

export const motion = {
  /** reduced motion requested by the OS */
  reduced: !!reduceQuery?.matches,
  /** intro clock (s); < 0 = waiting for assets; ≥ INTRO.duration = done */
  introT: params.get('intro') === '0' ? 1e4 : -1,
  introPlaying: false,
  /** QA: freeze the intro at this time (s) */
  introHold: null as number | null,
  /** 0…1 platform rise progress, labels opacity, camera push-in progress */
  platform: 1,
  labels: params.get('intro') === '0' ? 1 : 0,
  push: 1,
  /** exploded underground amount (smoothed, 0…1) */
  explode: 0,
  explodeTarget: 0,
  /** set by the scene while anything moves (shadow map refresh, label anchors) */
  moving: false,
  time: 0,
};
reduceQuery?.addEventListener?.('change', (e) => (motion.reduced = e.matches));

/** Start (or restart) the intro assembly. */
export function startIntro() {
  if (motion.reduced) {
    motion.introT = 1e4;
    motion.introPlaying = false;
    return;
  }
  motion.introT = 0;
  motion.introPlaying = true;
}
/** Hold the intro in its pre-assembly state until assets are ready. */
export function armIntro() {
  if (motion.reduced) return;
  motion.introT = -1;
  motion.introPlaying = false;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
function easeOutBack(t: number, s = 1.5) {
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
}
function stepSpring(s: Spring, target: number, k: number, damp: number, dt: number) {
  // semi-implicit Euler, sub-stepped for stability
  const n = Math.max(1, Math.ceil(dt / 0.008));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (k * (target - s.x) - damp * s.v) * h;
    s.x += s.v * h;
  }
}

/** Kick tiles: dy = vertical velocity (m/s), shake = yaw/tilt velocity (rad/s). */
export function kickTiles(indices: Iterable<number>, dy: number, shake: number) {
  if (motion.reduced) return;
  for (const i of indices) {
    const st = tileState[i];
    if (!st) continue;
    st.imp.v += dy;
    st.yaw.v += (hash(i + motion.time) - 0.5) * shake;
    st.tilt.v += (hash(i * 3.1 + motion.time) - 0.5) * shake;
  }
}

export function setExplode(on: boolean) {
  const target = on ? 1 : 0;
  if (target === motion.explodeTarget) return;
  motion.explodeTarget = target;
  // ripple from the centre outwards when lifting, from the outside in when landing
  for (const t of TILES) {
    const st = tileState[t.index];
    const f = t.dist / MAX_DIST;
    st.explodeAt = motion.time + (on ? f : 1 - f) * 0.45;
  }
}

/** Advance all animation state and upload the textures. */
export function updateMotion(time: number, dt: number) {
  motion.time = time;
  const d = Math.min(dt, 0.05);
  const reduced = motion.reduced;
  // ── intro clock
  if (motion.introPlaying) {
    motion.introT = motion.introHold ?? motion.introT + d;
    if (motion.introT >= INTRO.duration) {
      motion.introPlaying = false;
      motion.introT = 1e4;
    }
  }
  const it = motion.introT;
  const waiting = it < 0;
  const introOn = waiting || it < INTRO.duration;
  motion.platform = waiting ? 0 : clamp01(it / INTRO.platformEnd);
  motion.push = waiting ? 0 : clamp01(it / INTRO.duration);
  motion.labels = waiting ? 0 : clamp01((it - INTRO.labelsStart) / 0.45);
  motionUniforms.uPropT.value = waiting ? -1 : it >= 1e3 ? 1e4 : it - INTRO.propsStart;
  motionUniforms.uDraw.value = waiting ? 0 : clamp01((it - INTRO.drawStart) / (INTRO.drawEnd - INTRO.drawStart));
  motionUniforms.uMotionTime.value = time;

  // ── exploded amount (global, for fades / cable lift)
  const eT = motion.explodeTarget;
  motion.explode = reduced ? eT : motion.explode + (eT - motion.explode) * Math.min(1, d * 2.6);
  if (Math.abs(motion.explode - eT) < 0.002) motion.explode = eT;
  motionUniforms.uLayerLift.value = motion.explode * 52;

  // ── tiles
  const td = tileTex.image.data as Float32Array;
  let moving = introOn;
  for (const t of TILES) {
    const st = tileState[t.index];
    const target = time >= st.explodeAt ? eT : 1 - eT;
    if (reduced) {
      st.lift.x = target;
      st.lift.v = 0;
      st.imp.x = st.imp.v = st.yaw.x = st.yaw.v = st.tilt.x = st.tilt.v = 0;
    } else {
      // underdamped on landing → a small bounce when the tiles lock back together
      stepSpring(st.lift, target, 16, target > 0.5 ? 8 : 5.2, d);
      stepSpring(st.imp, 0, 60, 6, d);
      stepSpring(st.yaw, 0, 70, 7, d);
      stepSpring(st.tilt, 0, 70, 7, d);
    }
    const e = st.lift.x;
    const bob = reduced ? 0 : Math.sin(time * 0.7 + st.phase) * 2.2 * clamp01(e);
    let ox = t.cx * 0.16 * e;
    let oy = e * st.liftTarget + bob + st.imp.x;
    let oz = t.cz * 0.2 * e;
    let yaw = st.yaw.x + (reduced ? 0 : Math.sin(time * 0.45 + st.phase) * 0.012 * clamp01(e));
    let tx = st.tilt.x + (reduced ? 0 : Math.sin(time * 0.6 + st.phase * 1.3) * 0.02 * clamp01(e));
    let tz = st.tilt.x * 0.6 + (reduced ? 0 : Math.cos(time * 0.5 + st.phase) * 0.02 * clamp01(e));
    // intro fly-in (staggered ripple from the centre, overshoot + settle)
    if (introOn) {
      const delay = INTRO.tilesStart + (t.dist / MAX_DIST) * INTRO.tileStagger + hash(t.index + 21) * 0.12;
      const p = waiting ? 0 : clamp01((it - delay) / INTRO.tileDur);
      const k = 1 - easeOutBack(p, 1.3);
      const kr = 1 - easeOutCubic(p);
      ox += st.fx * kr;
      oy += st.fy * k;
      oz += st.fz * kr;
      yaw += st.fyaw * kr;
      tx += st.ftx * kr;
      tz += st.ftz * kr;
    }
    if (Math.abs(st.lift.v) > 1e-3 || Math.abs(st.imp.x) > 1e-3 || Math.abs(st.yaw.x) > 1e-4 || (e > 0.001 && !reduced)) moving = true;
    const o0 = t.index * 4;
    td[o0] = ox;
    td[o0 + 1] = oy;
    td[o0 + 2] = oz;
    td[o0 + 3] = yaw;
    const o1 = (N_TILE + t.index) * 4;
    td[o1] = tx;
    td[o1 + 1] = tz;
  }
  tileTex.needsUpdate = true;

  // ── buildings grow (intro)
  const bd = bldAnimTex.image.data as Float32Array;
  for (let i = 0; i < N_BLD; i++) {
    let g = 1;
    if (introOn) {
      const t = TILES[BLD_TILE[i]];
      const delay = INTRO.tilesStart + (t.dist / MAX_DIST) * INTRO.tileStagger + INTRO.growDelay + INTRO.tileDur * 0.5 + hash(i + 40) * 0.3;
      const p = waiting ? 0 : clamp01((it - delay) / INTRO.growDur);
      g = p <= 0 ? 0.001 : Math.max(0.001, easeOutBack(p, 1.2));
    }
    bd[i * 4] = g;
  }
  bldAnimTex.needsUpdate = true;
  motion.moving = moving;
}

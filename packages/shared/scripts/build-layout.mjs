#!/usr/bin/env node
// Generates packages/shared/generated/city-layout.json from config/district.json.
//
// The district config is the single source of truth for buses, facilities and the water
// network. This script derives everything spatial that the 3D twin, the mini-maps and the
// asset inspector need: roads, blocks, building placements (each mapped to the bus that
// supplies it), street props, street-following cable routes and label anchors.
// Deterministic: the same config + seed always produces byte-identical output.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const district = JSON.parse(readFileSync(join(root, 'config', 'district.json'), 'utf8'));
const SEED = 3301;

// ------------------------------------------------------------------ helpers
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const r2 = (v) => Math.round(v * 100) / 100;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + (b - a) * rand();

const P = district.platform;
const S = district.streets;
const AV = S.avenuesZ;
const ST = S.streetsX;
const halfAv = S.avenueWidth / 2;
const halfSt = S.streetWidth / 2;
const SIDEWALK = 4;

// ------------------------------------------------------------------ roads
const roads = [];
AV.forEach((z, i) => roads.push({ id: `AV-${i + 1}`, kind: 'avenue', width: S.avenueWidth, points: [[P.minX, z], [P.maxX, z]] }));
ST.forEach((x, i) => roads.push({ id: `ST-${i + 1}`, kind: 'street', width: S.streetWidth, points: [[x, P.minZ], [x, P.maxZ]] }));

// ------------------------------------------------------------------ blocks
const xEdges = [P.minX, ...ST, P.maxX];
const zEdges = [P.minZ, ...AV, P.maxZ];
const blocks = [];
for (let ci = 0; ci < xEdges.length - 1; ci++) {
  for (let ri = 0; ri < zEdges.length - 1; ri++) {
    const minX = xEdges[ci] + (ci === 0 ? 0 : halfSt);
    const maxX = xEdges[ci + 1] - (ci === xEdges.length - 2 ? 0 : halfSt);
    const minZ = zEdges[ri] + (ri === 0 ? 0 : halfAv);
    const maxZ = zEdges[ri + 1] - (ri === zEdges.length - 2 ? 0 : halfAv);
    const edge = ci === 0 || ri === 0 || ci === xEdges.length - 2 || ri === zEdges.length - 2;
    const cx = (minX + maxX) / 2;
    blocks.push({
      id: `BLK-${'abcdefg'[ci]}${ri}`,
      col: ci,
      row: ri,
      minX: r2(minX), maxX: r2(maxX), minZ: r2(minZ), maxZ: r2(maxZ),
      edge,
      zone: cx < 0 ? 'West' : 'East',
    });
  }
}

// ------------------------------------------------------------------ buses & facilities
const buses = district.electrical.buses;
const busByNumber = new Map(buses.map((b) => [b.number, b]));
const facilities = district.facilities;

function blockAt(x, z) {
  return blocks.find((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) ?? null;
}

function nearestBus(x, z, blockId) {
  let best = null;
  let bestD = Infinity;
  for (const b of buses) {
    if (b.number === 1) continue; // the substation bus carries no customer load
    const sameBlock = blockAt(b.pos[0], b.pos[1])?.id === blockId;
    const d = Math.hypot(b.pos[0] - x, b.pos[1] - z) * (sameBlock ? 0.35 : 1);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best.number;
}

// ------------------------------------------------------------------ buildings
const FACILITY_HEIGHT = {
  substation: 14, hospital: 34, 'emergency-ops': 22, 'pump-station': 11, 'water-tower': 46,
  'desalination-inlet': 13, 'cooling-plant': 18, commercial: 28,
};
const buildings = [];
const occupied = []; // rectangles [minX, maxX, minZ, maxZ]

for (const f of facilities) {
  const [w, d] = f.footprint;
  const [x, z] = f.pos;
  let height = FACILITY_HEIGHT[f.kind] ?? 20;
  if (f.id === 'office-complex') height = 62;
  if (f.id === 'mall') height = 24;
  buildings.push({
    id: `BLD-${f.id}`,
    kind: f.kind === 'commercial' ? (f.id === 'mall' ? 'mall' : 'office-complex') : f.kind,
    variant: 0,
    pos: [x, z],
    rot: 0,
    size: [w, d],
    height,
    floors: f.kind === 'pump-station' ? 1 : Math.max(1, Math.round(height / 4)),
    bus: f.bus ?? null,
    facilityId: f.id,
    name: f.name,
    roofSolar: false,
  });
  occupied.push([x - w / 2 - 6, x + w / 2 + 6, z - d / 2 - 6, z + d / 2 + 6]);
}

function overlaps(r) {
  return occupied.some((o) => r[0] < o[1] && r[1] > o[0] && r[2] < o[3] && r[3] > o[2]);
}

let bldCounter = 0;
function heightBand(z, x) {
  // taller towards the back so the cut-away front stays readable, as in the reference view
  if (z < -120) return 'tower';
  if (z < -40) return Math.abs(x) > 150 ? 'high' : 'tower-mid';
  if (z < 40) return 'mid';
  if (z < 120) return 'low-mid';
  return 'low';
}

// In-district buildings are deliberately capped at mid-rise: the modelled feeder carries
// 3.7 MW in total (≈47 kW per building), so supertall towers would contradict the electrical
// model. The Dubai-style supertall skyline is rendered as unmodelled background context.
const KIND_BY_BAND = {
  tower: [['tower-residential', 0.55], ['tower-office', 0.45]],
  'tower-mid': [['tower-residential', 0.3], ['tower-office', 0.2], ['midrise-residential', 0.5]],
  high: [['midrise-residential', 0.65], ['tower-residential', 0.35]],
  mid: [['midrise-residential', 0.65], ['commercial-podium', 0.25], ['tower-office', 0.1]],
  'low-mid': [['midrise-residential', 0.55], ['lowrise-residential', 0.3], ['commercial-podium', 0.15]],
  low: [['lowrise-residential', 0.6], ['villa', 0.4]],
};
const HEIGHT_RANGE = {
  'tower-residential': [40, 58], 'tower-office': [42, 62],
  'midrise-residential': [18, 36], 'lowrise-residential': [10, 16], villa: [7, 9], 'commercial-podium': [10, 18],
};
const VARIANTS = {
  'tower-residential': 4, 'tower-office': 4, 'midrise-residential': 4,
  'lowrise-residential': 3, villa: 2, 'commercial-podium': 3,
};

function weighted(list) {
  const t = rand();
  let acc = 0;
  for (const [k, w] of list) {
    acc += w;
    if (t <= acc) return k;
  }
  return list[list.length - 1][0];
}

for (const blk of blocks) {
  const minX = blk.minX + SIDEWALK;
  const maxX = blk.maxX - SIDEWALK;
  const minZ = blk.minZ + SIDEWALK;
  const maxZ = blk.maxZ - SIDEWALK;
  const w = maxX - minX;
  const d = maxZ - minZ;
  if (w < 14 || d < 14) continue;
  const nx = Math.max(1, Math.round(w / 30));
  const nz = Math.max(1, Math.round(d / 30));
  const lotW = w / nx;
  const lotD = d / nz;
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      const cx = minX + lotW * (i + 0.5);
      const cz = minZ + lotD * (k + 0.5);
      const band = heightBand(cz, cx);
      const kind = weighted(KIND_BY_BAND[band]);
      const isTower = kind.startsWith('tower');
      const fw = Math.min(lotW - 6, isTower ? between(18, 26) : kind === 'villa' ? between(12, 16) : between(16, lotW - 6));
      const fd = Math.min(lotD - 6, isTower ? between(18, 26) : kind === 'villa' ? between(12, 16) : between(16, lotD - 6));
      if (fw < 9 || fd < 9) continue;
      const rect = [cx - fw / 2, cx + fw / 2, cz - fd / 2, cz + fd / 2];
      if (overlaps(rect)) continue;
      occupied.push(rect);
      const [h0, h1] = HEIGHT_RANGE[kind];
      const height = r2(between(h0, h1));
      const floorH = kind.startsWith('tower-office') ? 4.0 : 3.2;
      bldCounter += 1;
      buildings.push({
        id: `BLD-${String(bldCounter).padStart(3, '0')}`,
        kind,
        variant: Math.floor(rand() * VARIANTS[kind]),
        pos: [r2(cx), r2(cz)],
        rot: pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]),
        size: [r2(fw), r2(fd)],
        height,
        floors: Math.max(2, Math.round(height / floorH)),
        bus: nearestBus(cx, cz, blk.id),
        facilityId: null,
        name: null,
        roofSolar: !isTower && kind !== 'villa' && (cx > 20 ? rand() < 0.75 : rand() < 0.3),
      });
    }
  }
}

// ------------------------------------------------------------------ props
const palms = [];
const streetLights = [];
const onFacility = (x, z) => occupied.slice(0, facilities.length).some((o) => x > o[0] && x < o[1] && z > o[2] && z < o[3]);
const nearIntersection = (x, z, r) => ST.some((sx) => AV.some((az) => Math.abs(sx - x) < r && Math.abs(az - z) < r));

for (const z of AV) {
  for (const side of [-1, 1]) {
    for (let x = P.minX + 8; x <= P.maxX - 8; x += 15) {
      const pz = z + side * (halfAv + 2.2);
      if (pz < P.minZ + 2 || pz > P.maxZ - 2 || nearIntersection(x, pz, 14) || onFacility(x, pz)) continue;
      palms.push([r2(x + between(-1.5, 1.5)), r2(pz), r2(between(0.85, 1.2)), r2(between(0, Math.PI * 2))]);
    }
    for (let x = P.minX + 20; x <= P.maxX - 10; x += 32) {
      const pz = z + side * (halfAv - 0.8);
      if (nearIntersection(x, pz, 10)) continue;
      streetLights.push([r2(x), r2(pz), side > 0 ? Math.PI : 0]);
    }
  }
}
for (const x of ST) {
  for (const side of [-1, 1]) {
    for (let z = P.minZ + 8; z <= P.maxZ - 8; z += 17) {
      const px = x + side * (halfSt + 2.0);
      if (nearIntersection(px, z, 14) || onFacility(px, z)) continue;
      if (rand() < 0.75) palms.push([r2(px), r2(z + between(-1.5, 1.5)), r2(between(0.8, 1.15)), r2(between(0, Math.PI * 2))]);
    }
    for (let z = P.minZ + 16; z <= P.maxZ - 10; z += 34) {
      const px = x + side * (halfSt - 0.8);
      if (nearIntersection(px, z, 10)) continue;
      streetLights.push([r2(px), r2(z), side > 0 ? -Math.PI / 2 : Math.PI / 2]);
    }
  }
}
// palm clusters inside facility grounds and the platform edges (as in the reference)
for (const f of facilities) {
  const [w, d] = f.footprint;
  const n = f.kind === 'hospital' ? 10 : f.kind === 'substation' ? 0 : 4;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    palms.push([r2(f.pos[0] + Math.cos(ang) * (w / 2 + 4)), r2(f.pos[1] + Math.sin(ang) * (d / 2 + 4)), r2(between(0.9, 1.25)), r2(between(0, Math.PI * 2))]);
  }
}

// ------------------------------------------------------------------ cable routes along streets
// Street graph: nodes at every intersection; buses connect to the nearest street point.
const nodeKey = (x, z) => `${r2(x)},${r2(z)}`;
const graph = new Map();
function addEdge(a, b) {
  const ka = nodeKey(...a);
  const kb = nodeKey(...b);
  if (!graph.has(ka)) graph.set(ka, { p: a, n: new Map() });
  if (!graph.has(kb)) graph.set(kb, { p: b, n: new Map() });
  const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
  graph.get(ka).n.set(kb, d);
  graph.get(kb).n.set(ka, d);
}
const xs = [...ST];
const zs = [...AV];
// avenues: split at street crossings; streets: split at avenue crossings
for (const z of zs) for (let i = 0; i < xs.length - 1; i++) addEdge([xs[i], z], [xs[i + 1], z]);
for (const x of xs) for (let i = 0; i < zs.length - 1; i++) addEdge([x, zs[i]], [x, zs[i + 1]]);
// open-ended avenue/street stubs to the platform edge (for buses in edge strips)
for (const z of zs) {
  addEdge([P.minX + 6, z], [xs[0], z]);
  addEdge([xs[xs.length - 1], z], [P.maxX - 6, z]);
}
for (const x of xs) {
  addEdge([x, P.minZ + 6], [x, zs[0]]);
  addEdge([x, zs[zs.length - 1]], [x, P.maxZ - 6]);
}

function attach(x, z) {
  // project the bus point onto every street segment and choose the closest projection
  let best = null;
  for (const [ka, na] of graph) {
    for (const [kb] of na.n) {
      if (ka > kb) continue;
      const a = na.p;
      const b = graph.get(kb).p;
      const vx = b[0] - a[0];
      const vz = b[1] - a[1];
      const L2 = vx * vx + vz * vz;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / L2));
      const px = a[0] + vx * t;
      const pz = a[1] + vz * t;
      const d = Math.hypot(px - x, pz - z);
      if (!best || d < best.d) best = { d, p: [px, pz], a: ka, b: kb };
    }
  }
  return best;
}

function shortestPath(src, dst) {
  // Dijkstra on a temporary copy that includes the two attachment points
  const g = new Map([...graph].map(([k, v]) => [k, { p: v.p, n: new Map(v.n) }]));
  const link = (att) => {
    const k = nodeKey(...att.p);
    if (!g.has(k)) g.set(k, { p: att.p, n: new Map() });
    for (const end of [att.a, att.b]) {
      const d = Math.hypot(g.get(end).p[0] - att.p[0], g.get(end).p[1] - att.p[1]);
      g.get(k).n.set(end, d);
      g.get(end).n.set(k, d);
    }
    if (att.a !== att.b) {
      // splitting the segment: keep direct link between src and dst if both on same segment
    }
    return k;
  };
  const ks = link(src);
  const kd = link(dst);
  if (src.a === dst.a && src.b === dst.b) {
    const d = Math.hypot(src.p[0] - dst.p[0], src.p[1] - dst.p[1]);
    g.get(ks).n.set(kd, d);
    g.get(kd).n.set(ks, d);
  }
  const dist = new Map([[ks, 0]]);
  const prev = new Map();
  const done = new Set();
  while (true) {
    let u = null;
    let ud = Infinity;
    for (const [k, d] of dist) if (!done.has(k) && d < ud) { u = k; ud = d; }
    if (u === null || u === kd) break;
    done.add(u);
    for (const [v, w] of g.get(u).n) {
      const nd = ud + w;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); }
    }
  }
  const path = [];
  for (let k = kd; k !== undefined; k = prev.get(k)) path.unshift(g.get(k).p);
  return path;
}

const lineRoutesRaw = new Map();
for (const line of district.electrical.lines) {
  const a = busByNumber.get(line.from);
  const b = busByNumber.get(line.to);
  const sa = attach(...a.pos);
  const sb = attach(...b.pos);
  const path = shortestPath(sa, sb);
  const pts = [a.pos, ...path, b.pos].map(([x, z]) => [r2(x), r2(z)]);
  // drop consecutive duplicates; keep every street-graph vertex so shared edges can be detected
  const clean = [];
  for (const p of pts) {
    const last = clean[clean.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 0.01 && Math.abs(last[1] - p[1]) < 0.01) continue;
    clean.push(p);
  }
  lineRoutesRaw.set(line.id, clean);
}

function simplify(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 0.05 && Math.abs(last[1] - p[1]) < 0.05) continue;
    out.push(p);
  }
  return out.filter((p, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const a0 = out[i - 1];
    const b0 = out[i + 1];
    const cross = (p[0] - a0[0]) * (b0[1] - a0[1]) - (p[1] - a0[1]) * (b0[0] - a0[0]);
    return Math.abs(cross) > 0.5;
  });
}

// Lane offsets: cables that share a street edge are spread across the carriageway so each stays readable.
const segKey = (p, q) => {
  const a = `${Math.round(p[0])},${Math.round(p[1])}`;
  const b = `${Math.round(q[0])},${Math.round(q[1])}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};
const segUsers = new Map();
for (const [id, pts] of lineRoutesRaw) {
  for (let i = 0; i < pts.length - 1; i++) {
    const k = segKey(pts[i], pts[i + 1]);
    if (!segUsers.has(k)) segUsers.set(k, []);
    if (!segUsers.get(k).includes(id)) segUsers.get(k).push(id);
  }
}
const LANE = 2.4;
const lineRoutes = {};
for (const [id, pts] of lineRoutesRaw) {
  const n = pts.length;
  const dirs = [];
  const offs = [];
  for (let i = 0; i < n - 1; i++) {
    const users = segUsers.get(segKey(pts[i], pts[i + 1]));
    const o = (users.indexOf(id) - (users.length - 1) / 2) * LANE;
    const dx = pts[i + 1][0] - pts[i][0];
    const dz = pts[i + 1][1] - pts[i][1];
    const L = Math.hypot(dx, dz) || 1;
    dirs.push([dx / L, dz / L]);
    offs.push([(-dz / L) * o, (dx / L) * o]);
  }
  const out = [pts[0]];
  for (let i = 1; i < n - 1; i++) {
    const p = pts[i];
    const [ax, az] = offs[i - 1];
    const [bx, bz] = offs[i];
    const [d1x, d1z] = dirs[i - 1];
    const [d2x, d2z] = dirs[i];
    const cross = d1x * d2z - d1z * d2x;
    if (Math.abs(cross) < 0.05) {
      // straight through: keep the lane, or jog between lanes when the offset changes
      out.push([p[0] + ax, p[1] + az]);
      if (Math.hypot(ax - bx, az - bz) > 0.01) out.push([p[0] + bx, p[1] + bz]);
    } else {
      // corner: intersection of the two offset centre-lines
      const t = ((bx - ax) * d2z - (bz - az) * d2x) / cross;
      out.push([p[0] + ax + d1x * t, p[1] + az + d1z * t]);
    }
  }
  out.push(pts[n - 1]);
  lineRoutes[id] = simplify(out.map(([x, z]) => [r2(x), r2(z)]));
}

// ------------------------------------------------------------------ labels
const labels = facilities.map((f) => {
  const b = buildings.find((x) => x.facilityId === f.id);
  return { id: `LBL-${f.id}`, facilityId: f.id, anchor: [f.pos[0], r2((b?.height ?? 20) + 8), f.pos[1]] };
});

// ------------------------------------------------------------------ output
const layout = {
  schemaVersion: 1,
  generatedFrom: 'packages/shared/config/district.json',
  seed: SEED,
  platform: P,
  roads,
  blocks,
  buildings,
  props: { palms, streetLights },
  electrical: { lineRoutes, cableY: 0.25 },
  labels,
  stats: {
    buildings: buildings.length,
    palms: palms.length,
    streetLights: streetLights.length,
  },
};

const outDir = join(root, 'generated');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'city-layout.json'), JSON.stringify(layout) + '\n');

// ------------------------------------------------------------------ mapping documentation
// docs/MAPPING.md is regenerated with the layout so the documented bus ↔ asset mapping
// can never drift from the configuration the simulation and the 3D twin actually use.
const md = [];
const feederName = new Map(district.electrical.feeders.map((f) => [f.id, `${f.name} (${f.description})`]));
md.push('# Simulation ↔ 3D asset mapping');
md.push('');
md.push('> Generated by `npm run layout` from `packages/shared/config/district.json`. Do not edit by hand —');
md.push('> change the configuration and regenerate. Positions are plan coordinates in metres (x east, z towards the default camera).');
md.push('');
md.push('## How the mapping works');
md.push('');
md.push('- **Electrical buses → buildings.** Every building on the district platform is supplied by exactly one bus of the');
md.push('  IEEE 33-bus benchmark (1-based bus numbers; pandapower index = number − 1). The layout generator assigns each building');
md.push('  to the bus whose service point lies in the same block (or the nearest one). When a bus loses supply in the simulation,');
md.push('  every building mapped to it goes dark in the 3D twin.');
md.push('- **Facilities** are mapped explicitly (`facilities[].bus`, `facilities[].waterNode`).');
md.push('- **Pumps → buses.** A pump motor is supplied by `water.pumps[].bus`; its electrical demand is computed from the hydraulic');
md.push('  solution (P = ρ·g·Q·H / η) and added to that bus. If the bus is de-energized the pump stops and the hydraulic model is re-solved.');
md.push('- **Cable routes** follow streets and are illustrative; impedances are the published Baran–Wu values.');
md.push('');
md.push('## Feeders');
md.push('');
md.push('| Feeder | Description | Buses |');
md.push('|---|---|---|');
for (const f of district.electrical.feeders) md.push(`| ${f.id} | ${f.description} | ${f.buses.map((b) => `B${b}`).join(', ')} |`);
md.push('');
md.push('## Buses');
md.push('');
md.push('| Bus | Feeder | P (kW) | Q (kVAr) | Connections | Critical | Buildings | Facilities | Plan position | Label |');
md.push('|---|---|---:|---:|---:|:---:|---:|---|---|---|');
for (const b of buses) {
  const nb = buildings.filter((x) => x.bus === b.number).length;
  const facs = facilities.filter((f) => f.bus === b.number).map((f) => f.name).join(', ') || '—';
  md.push(`| B${b.number} | ${b.feeder} | ${b.loadKW} | ${b.loadKVAr} | ${b.connections} | ${b.critical ? 'yes' : ''} | ${nb} | ${facs} | (${b.pos[0]}, ${b.pos[1]}) | ${b.label} |`);
}
md.push('');
md.push('## Facilities');
md.push('');
md.push('| Facility | Kind | Critical | Bus | Water node | Backup | Notes |');
md.push('|---|---|:---:|---|---|---|---|');
for (const f of facilities) {
  const bk = f.backup ? `${f.backup.kind} ${f.backup.kW} kW / ${f.backup.hours} h${f.backup.coversWater ? '' : ' (no water)'}` : '—';
  md.push(`| ${f.name} | ${f.kind} | ${f.critical ? 'yes' : ''} | ${f.bus ? `B${f.bus} (${feederName.get(busByNumber.get(f.bus).feeder)?.split(' (')[0] ?? 'S1'})` : 'not on modelled feeder'} | ${f.waterNode ?? '—'} | ${bk} | ${f.description} |`);
}
md.push('');
md.push('## Water network');
md.push('');
md.push('| Pump | Station | Supply bus | Design point | Efficiency |');
md.push('|---|---|---|---|---:|');
for (const p of district.water.pumps) md.push(`| ${p.id} | ${p.stationId} | B${p.bus} | ${p.designFlowLps} L/s @ ${p.designHeadM} m | ${Math.round(p.efficiency * 100)} % |`);
md.push('');
md.push('| Tank | Zone | Floor elevation (m) | Level range (m) | Diameter (m) | Usable volume (m³) |');
md.push('|---|---|---:|---|---:|---:|');
for (const t of district.water.tanks) {
  const vol = Math.PI * (t.diameterM / 2) ** 2 * (t.maxLevelM - t.minLevelM);
  md.push(`| ${t.id} | ${t.zone} | ${t.elevationM} | ${t.minLevelM}–${t.maxLevelM} | ${t.diameterM} | ${Math.round(vol)} |`);
}
md.push('');
const zones = ['West', 'East'].map((z) => {
  const js = district.water.junctions.filter((j) => j.zone === z);
  return `| ${z} | ${js.length} | ${js.reduce((s, j) => s + j.baseDemandLps, 0).toFixed(1)} | ${js.filter((j) => j.critical).map((j) => j.id).join(', ') || '—'} |`;
});
md.push('| Zone | Junctions | Base demand (L/s) | Critical nodes |');
md.push('|---|---:|---:|---|');
md.push(...zones);
md.push('');
md.push(`Boundary pipes between the zones (normally closed): ${district.water.pipes.filter((p) => p.kind === 'boundary').map((p) => p.id).join(', ')}.`);
md.push('');
md.push(`Layout statistics: ${buildings.length} buildings, ${palms.length} palms, ${streetLights.length} street lights, ${Object.keys(lineRoutes).length} cable routes (seed ${SEED}).`);
md.push('');
const docsDir = join(root, '..', '..', 'docs');
mkdirSync(docsDir, { recursive: true });
writeFileSync(join(docsDir, 'MAPPING.md'), md.join('\n'));
console.log(`city-layout.json: ${buildings.length} buildings, ${palms.length} palms, ${streetLights.length} street lights, ${Object.keys(lineRoutes).length} cable routes`);

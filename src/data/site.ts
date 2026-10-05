import layoutJson from './site-layout.json';
import type { Vec2 } from '../types';

// ---------------------------------------------------------------------------------------------
// Typed access to the generalized site layout (shared with the Blender build script).
// ---------------------------------------------------------------------------------------------

export interface RoadDef {
  id: string;
  label: string;
  points: [number, number][];
  width: number;
}
export interface BuildingDef {
  id: string;
  label: string;
  kind: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}
export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export interface SiteLayout {
  platform: Rect;
  seawall: { z: number; minX: number; maxX: number };
  coastline: [number, number][];
  roads: RoadDef[];
  units: { id: string; label: string; x: number; z: number }[];
  buildings: BuildingDef[];
  tanks: { id: string; x: number; z: number; r: number; h: number }[];
  intakes: { unit: string; x: number; crane: boolean }[];
  parking: { id: string; minX: number; maxX: number; rows: number[]; stall: number; fill: number }[];
  switchyard: Rect;
  laydown: Rect;
  serviceYard: Rect;
  lawns: [number, number, number, number][];
  unitPads: { minDX: number; maxDX: number; minDZ: number; maxDZ: number };
  breakwaters: { id: string; points: [number, number][] }[];
  pylonLines: { id: string; x: number; zs: number[] }[];
  metMast: { x: number; z: number; h: number };
  skids: { id: string; label: string; x: number; z: number }[];
  ugvDock: Vec2;
}

export const SITE = layoutJson as unknown as SiteLayout;

// ---------------------------------------------------------------------------------------------
// Generic operational zones (fictional sectors used for picking, overlays and filtering)
// ---------------------------------------------------------------------------------------------

export interface Zone extends Rect {
  id: string;
  label: string;
  short: string;
  sector: string;
  height: number;
  color: string;
  overlay: boolean;
}

const unitZones: Zone[] = SITE.units.map((u) => ({
  id: u.id,
  label: `${u.label} block`,
  short: u.label,
  sector: u.id === 'U1' || u.id === 'U2' ? 'Sector A' : 'Sector B',
  minX: u.x + SITE.unitPads.minDX,
  maxX: u.x + SITE.unitPads.maxDX,
  minZ: u.z + SITE.unitPads.minDZ,
  maxZ: u.z + SITE.unitPads.maxDZ,
  height: 72,
  color: '#4c94ff',
  overlay: false,
}));

export const ZONES: Zone[] = [
  ...unitZones,
  { id: 'SEC-A', label: 'Sector A · Units 1–2', short: 'Sector A', sector: 'Sector A', minX: -395, maxX: -5, minZ: -227, maxZ: -9, height: 40, color: '#4c94ff', overlay: true },
  { id: 'SEC-B', label: 'Sector B · Units 3–4', short: 'Sector B', sector: 'Sector B', minX: 5, maxX: 395, minZ: -227, maxZ: -9, height: 40, color: '#8aa4ff', overlay: true },
  { id: 'COAST', label: 'Marine intake & seawall', short: 'Marine', sector: 'Coastal band', minX: -600, maxX: 600, minZ: -350, maxZ: -229, height: 22, color: '#3cc8dc', overlay: true },
  { id: 'SERVICE', label: 'Service zone', short: 'Service', sector: 'Service zone', minX: 405, maxX: 600, minZ: 9, maxZ: 300, height: 22, color: '#f2b33d', overlay: true },
  { id: 'ADMIN', label: 'Administration campus', short: 'Admin', sector: 'Admin zone', minX: -600, maxX: -405, minZ: 9, maxZ: 300, height: 24, color: '#9aa7b4', overlay: true },
  { id: 'SWITCHYARD', label: 'Switchyard', short: 'Switchyard', sector: 'Electrical', minX: -155, maxX: 155, minZ: 140, maxZ: 258, height: 20, color: '#c9a3ff', overlay: true },
  { id: 'SUPPORT', label: 'Support facilities', short: 'Support', sector: 'Support', minX: -395, maxX: 395, minZ: 9, maxZ: 138, height: 20, color: '#7fb0a8', overlay: true },
  { id: 'WEST', label: 'West utilities', short: 'West utilities', sector: 'Utilities', minX: -600, maxX: -405, minZ: -227, maxZ: -9, height: 22, color: '#a7b1bb', overlay: true },
  { id: 'EAST', label: 'East utilities', short: 'East utilities', sector: 'Utilities', minX: 405, maxX: 600, minZ: -227, maxZ: -9, height: 22, color: '#a7b1bb', overlay: true },
];

const area = (z: Rect) => (z.maxX - z.minX) * (z.maxZ - z.minZ);

/** Smallest zone containing the point (units win over sectors). */
export function zoneAt(x: number, z: number): Zone | undefined {
  let best: Zone | undefined;
  for (const zone of ZONES) {
    if (x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ) {
      if (!best || area(zone) < area(best)) best = zone;
    }
  }
  return best;
}

export const zoneById = (id: string) => ZONES.find((z) => z.id === id);

// ---------------------------------------------------------------------------------------------
// Road graph + routing
// ---------------------------------------------------------------------------------------------

interface GraphNode {
  id: number;
  x: number;
  z: number;
  edges: { to: number; len: number }[];
}

const key = (x: number, z: number) => `${Math.round(x * 2)}:${Math.round(z * 2)}`;

export class RoadGraph {
  nodes: GraphNode[] = [];
  private index = new Map<string, number>();
  segments: { a: number; b: number }[] = [];

  constructor(roads: RoadDef[], extraPoints: Vec2[] = []) {
    const segs = roads.map((r) => ({ a: { x: r.points[0][0], z: r.points[0][1] }, b: { x: r.points[1][0], z: r.points[1][1] } }));
    segs.forEach((s, i) => {
      const pts: Vec2[] = [s.a, s.b];
      segs.forEach((o, j) => {
        if (i === j) return;
        const p = intersect(s.a, s.b, o.a, o.b);
        if (p) pts.push(p);
      });
      for (const e of extraPoints) if (onSegment(e, s.a, s.b)) pts.push(e);
      const dx = s.b.x - s.a.x;
      const dz = s.b.z - s.a.z;
      const len2 = dx * dx + dz * dz;
      pts.sort((p, q) => ((p.x - s.a.x) * dx + (p.z - s.a.z) * dz) / len2 - ((q.x - s.a.x) * dx + (q.z - s.a.z) * dz) / len2);
      let prev = -1;
      for (const p of pts) {
        const id = this.nodeAt(p.x, p.z);
        if (prev >= 0 && prev !== id) this.connect(prev, id);
        prev = id;
      }
    });
  }

  private nodeAt(x: number, z: number) {
    const k = key(x, z);
    const found = this.index.get(k);
    if (found !== undefined) return found;
    const id = this.nodes.length;
    this.nodes.push({ id, x, z, edges: [] });
    this.index.set(k, id);
    return id;
  }

  private connect(a: number, b: number) {
    const na = this.nodes[a];
    const nb = this.nodes[b];
    if (na.edges.some((e) => e.to === b)) return;
    const len = Math.hypot(nb.x - na.x, nb.z - na.z);
    na.edges.push({ to: b, len });
    nb.edges.push({ to: a, len });
    this.segments.push({ a, b });
  }

  /** Closest point on the network to p. */
  project(p: Vec2): { a: number; b: number; point: Vec2; dist: number } {
    let best = { a: 0, b: 0, point: { x: this.nodes[0].x, z: this.nodes[0].z }, dist: Infinity };
    for (const s of this.segments) {
      const A = this.nodes[s.a];
      const B = this.nodes[s.b];
      const q = closestOnSegment(p, A, B);
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < best.dist) best = { a: s.a, b: s.b, point: q, dist: d };
    }
    return best;
  }

  /** Shortest road route between two arbitrary points (both snapped onto the network). */
  route(from: Vec2, to: Vec2): Vec2[] {
    const ps = this.project(from);
    const pt = this.project(to);
    // same edge: direct
    if ((ps.a === pt.a && ps.b === pt.b) || (ps.a === pt.b && ps.b === pt.a)) {
      return dedupe([from, ps.point, pt.point, to]);
    }
    const starts = [ps.a, ps.b].map((id) => ({ id, cost: dist(ps.point, this.nodes[id]) }));
    const goals = new Map<number, number>([
      [pt.a, dist(pt.point, this.nodes[pt.a])],
      [pt.b, dist(pt.point, this.nodes[pt.b])],
    ]);
    // Dijkstra with multiple sources/targets (graph is small)
    const n = this.nodes.length;
    const g = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const open = new Set<number>();
    for (const s of starts) {
      if (s.cost < g[s.id]) g[s.id] = s.cost;
      open.add(s.id);
    }
    const closed = new Set<number>();
    let bestGoal = -1;
    let bestCost = Infinity;
    while (open.size) {
      let u = -1;
      let uc = Infinity;
      for (const id of open) if (g[id] < uc) (uc = g[id]), (u = id);
      open.delete(u);
      if (closed.has(u)) continue;
      closed.add(u);
      if (goals.has(u)) {
        const c = g[u] + (goals.get(u) as number);
        if (c < bestCost) (bestCost = c), (bestGoal = u);
      }
      if (uc > bestCost) break;
      for (const e of this.nodes[u].edges) {
        const c = g[u] + e.len;
        if (c < g[e.to]) {
          g[e.to] = c;
          prev[e.to] = u;
          open.add(e.to);
        }
      }
    }
    const chain: Vec2[] = [];
    let cur = bestGoal;
    while (cur >= 0) {
      chain.unshift({ x: this.nodes[cur].x, z: this.nodes[cur].z });
      cur = prev[cur];
    }
    return dedupe([from, ps.point, ...chain, pt.point, to]);
  }
}

function dist(a: Vec2, b: { x: number; z: number }) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function onSegment(p: Vec2, a: Vec2, b: Vec2) {
  const q = closestOnSegment(p, a, b);
  return Math.hypot(q.x - p.x, q.z - p.z) < 0.6;
}

function closestOnSegment(p: Vec2, a: { x: number; z: number }, b: { x: number; z: number }): Vec2 {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + dx * t, z: a.z + dz * t };
}

function intersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = { x: b.x - a.x, z: b.z - a.z };
  const s = { x: d.x - c.x, z: d.z - c.z };
  const den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den;
  const u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { x: a.x + r.x * t, z: a.z + r.z * t };
}

function dedupe(pts: Vec2[]) {
  const out: Vec2[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 0.5) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Polyline helpers (corner fillets + arc-length parameterisation) used for vehicle motion
// ---------------------------------------------------------------------------------------------

export function filletPath(pts: Vec2[], radius = 8, steps = 6): Vec2[] {
  if (pts.length < 3) return pts.slice();
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const A = pts[i - 1];
    const B = pts[i];
    const C = pts[i + 1];
    const l1 = Math.hypot(B.x - A.x, B.z - A.z);
    const l2 = Math.hypot(C.x - B.x, C.z - B.z);
    if (l1 < 0.01 || l2 < 0.01) continue;
    const u = { x: (B.x - A.x) / l1, z: (B.z - A.z) / l1 };
    const v = { x: (C.x - B.x) / l2, z: (C.z - B.z) / l2 };
    const cross = Math.abs(u.x * v.z - u.z * v.x);
    if (cross < 0.02) {
      out.push(B);
      continue;
    }
    const r = Math.min(radius, l1 * 0.45, l2 * 0.45);
    const P1 = { x: B.x - u.x * r, z: B.z - u.z * r };
    const P2 = { x: B.x + v.x * r, z: B.z + v.z * r };
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      out.push({ x: a * P1.x + b * B.x + c * P2.x, z: a * P1.z + b * B.z + c * P2.z });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Fillet every corner of a closed loop (returned without repeating the first point). */
export function filletLoop(pts: Vec2[], radius = 8, steps = 6): Vec2[] {
  const n = pts.length;
  const wrapped = [pts[n - 1], ...pts, pts[0]];
  const out = filletPath(wrapped, radius, steps);
  // drop the duplicated endpoints introduced by wrapping
  return out.slice(1, out.length - 1);
}

export class Polyline {
  readonly pts: Vec2[];
  readonly cum: number[];
  readonly length: number;

  constructor(pts: Vec2[]) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    }
    this.length = this.cum[this.cum.length - 1];
  }

  at(s: number): Vec2 {
    if (this.pts.length === 1) return this.pts[0];
    const d = Math.max(0, Math.min(this.length, s));
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const seg = this.cum[hi] - this.cum[lo] || 1;
    const f = (d - this.cum[lo]) / seg;
    const a = this.pts[lo];
    const b = this.pts[hi];
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
  }

  /** Heading (radians, three.js rotation.y for a +z-forward model) using a look-ahead window. */
  headingAt(s: number, look = 3): number {
    const a = this.at(s - look * 0.35);
    const b = this.at(s + look);
    return Math.atan2(b.x - a.x, b.z - a.z);
  }
}

/** Loop polyline (closed): `at` wraps around. */
export class LoopPath extends Polyline {
  constructor(pts: Vec2[]) {
    super([...pts, pts[0]]);
  }
  wrap(s: number) {
    return ((s % this.length) + this.length) % this.length;
  }
  at(s: number): Vec2 {
    return super.at(this.wrap(s));
  }
  headingAt(s: number, look = 3): number {
    const a = this.at(s - look * 0.35);
    const b = this.at(s + look);
    return Math.atan2(b.x - a.x, b.z - a.z);
  }
}

export const ROAD_GRAPH_EXTRA: Vec2[] = [];

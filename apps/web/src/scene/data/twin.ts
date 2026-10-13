/**
 * Static, derived view of the district used by the 3D scene.
 * Built once from `cityLayout` (generated spatial layout) and `district` (authoritative config).
 *
 * Index conventions (match the simulation contract):
 *  - bus index = pandapower index = benchmark bus number − 1
 *  - line index = line id (0-based)
 *  - water arrays follow district.json order (= topology.water order)
 */
import { cityLayout, district } from '@encirra/shared';
import type { LayoutBuilding } from '@encirra/shared';

export const PLATFORM = cityLayout.platform;
export const DEPTH = PLATFORM.undergroundDepth; // 42 m
export const CABLE_Y = cityLayout.electrical.cableY ?? 0.25;

// ───────────────────────────────────────────── electrical
export interface BusDef {
  index: number;
  number: number;
  name: string;
  feeder: string;
  pos: [number, number];
  critical: boolean;
  label: string;
}
export const BUSES: BusDef[] = district.electrical.buses.map((b) => ({
  index: b.number - 1,
  number: b.number,
  name: b.name,
  feeder: b.feeder,
  pos: b.pos as [number, number],
  critical: b.critical,
  label: b.label,
}));
export const N_BUS = BUSES.length;

export interface LineDef {
  id: number;
  from: number; // bus index
  to: number; // bus index
  kind: 'feeder' | 'tie';
  feeder: string;
  normallyOpen: boolean;
  switchId: string;
  switchKind: string;
  route: [number, number][];
  length: number;
}
function polyLength(pts: [number, number][]) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}
export const LINES: LineDef[] = district.electrical.lines.map((l) => {
  const route = (cityLayout.electrical.lineRoutes[String(l.id)] ?? []) as [number, number][];
  const fallback: [number, number][] = [
    district.electrical.buses[l.from - 1].pos as [number, number],
    district.electrical.buses[l.to - 1].pos as [number, number],
  ];
  const r = route.length >= 2 ? route : fallback;
  return {
    id: l.id,
    from: l.from - 1,
    to: l.to - 1,
    kind: l.kind as 'feeder' | 'tie',
    feeder: l.feeder,
    normallyOpen: l.normallyOpen,
    switchId: l.switch.id,
    switchKind: l.switch.kind,
    route: r,
    length: polyLength(r),
  };
});
export const N_LINE = LINES.length;

/** Point at distance `s` along a plan polyline. */
export function pointAlong(pts: [number, number][], s: number): [number, number, number] {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + seg >= s || i === pts.length - 1) {
      const t = seg > 0 ? Math.min(1, Math.max(0, (s - acc) / seg)) : 0;
      const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t;
      const z = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
      return [x, z, Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0])];
    }
    acc += seg;
  }
  return [pts[0][0], pts[0][1], 0];
}

// ───────────────────────────────────────────── facilities & buildings
export type FacilityDef = (typeof district.facilities)[number];
export const FACILITIES = district.facilities;
export const FACILITY_BY_ID = new Map(FACILITIES.map((f) => [f.id, f]));

export interface BuildingDef extends LayoutBuilding {
  index: number;
  busIndex: number; // -1 when not supplied by the modelled feeder
}
export const BUILDINGS: BuildingDef[] = cityLayout.buildings.map((b, index) => ({
  ...b,
  index,
  busIndex: b.bus == null ? -1 : b.bus - 1,
}));
export const N_BLD = BUILDINGS.length;
export const BUILDING_BY_ID = new Map(BUILDINGS.map((b) => [b.id, b]));
export const BUILDING_BY_FACILITY = new Map(BUILDINGS.filter((b) => b.facilityId).map((b) => [b.facilityId as string, b]));

// ───────────────────────────────────────────── water
const W = district.water;
export const SURFACE_ELEV = W.surfaceElevationM;
export const JUNCTIONS = W.junctions;
export const RESERVOIRS = W.reservoirs;
export const TANKS = W.tanks;
export const PUMPS = W.pumps;
export const PIPES = W.pipes.map((p, index) => ({
  ...p,
  index,
  route: p.route as [number, number, number][],
}));
export type PipeDef = (typeof PIPES)[number];
export const N_PIPE = PIPES.length;
export const JUNCTION_INDEX = new Map(JUNCTIONS.map((j, i) => [j.id, i]));
export const NODE_POS = new Map<string, [number, number, number]>([
  ...JUNCTIONS.map((j) => [j.id, j.pos as [number, number, number]] as const),
  ...RESERVOIRS.map((r) => [r.id, r.pos as [number, number, number]] as const),
  ...TANKS.map((t) => [t.id, t.pos as [number, number, number]] as const),
]);

/** Visual radius (m) for a pipe — exaggerated for legibility. */
export function pipeRadius(diameterMM: number, kind: string) {
  // ≈0.9 m for the 300 mm mains (matches the kit's gallery saddles)
  const base = 0.5 + (diameterMM / 1000) * 1.35;
  return kind === 'distribution' ? base * 0.92 : base;
}

// ───────────────────────────────────────────── nominal (healthy) defaults when no run is loaded
/** Healthy-state line flow direction from the radial structure (+1 from→to, 0 = open tie). */
export const NOMINAL_LINE_DIR = LINES.map((l) => (l.normallyOpen ? 0 : 1));

/** Healthy-state pipe flow direction: BFS from the pumped / stored sources outwards. */
export const NOMINAL_PIPE_DIR: number[] = (() => {
  const depth = new Map<string, number>();
  const sources = ['R1'];
  const q: string[] = [];
  for (const s of sources) {
    depth.set(s, 0);
    q.push(s);
  }
  // adjacency (open pipes + pumps)
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(b);
  };
  for (const p of PIPES) {
    if (p.initialStatus === 'closed') continue;
    add(p.from, p.to);
    add(p.to, p.from);
  }
  for (const pu of PUMPS) add(pu.from, pu.to);
  while (q.length) {
    const u = q.shift()!;
    for (const v of adj.get(u) ?? []) {
      if (!depth.has(v)) {
        depth.set(v, depth.get(u)! + 1);
        q.push(v);
      }
    }
  }
  return PIPES.map((p) => {
    if (p.initialStatus === 'closed') return 0;
    // risers flow into the tanks in the healthy (filling) state
    if (p.kind === 'riser') return 1;
    const a = depth.get(p.from) ?? 99;
    const b = depth.get(p.to) ?? 99;
    return a <= b ? 1 : -1;
  });
})();

/** Nearest non-substation bus to a plan point (used for street props without explicit mapping). */
export function nearestBusIndex(x: number, z: number): number {
  let best = 1;
  let bd = Infinity;
  for (const b of BUSES) {
    if (b.number === 1) continue;
    const d = Math.hypot(b.pos[0] - x, b.pos[1] - z);
    if (d < bd) {
      bd = d;
      best = b.index;
    }
  }
  return best;
}

/** Nearest building (by footprint centre) to a plan point → its bus; falls back to nearest bus. */
export function propBusIndex(x: number, z: number): number {
  let best: BuildingDef | null = null;
  let bd = Infinity;
  for (const b of BUILDINGS) {
    if (b.busIndex < 1) continue;
    const d = Math.hypot(b.pos[0] - x, b.pos[1] - z);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best && bd < 60 ? best.busIndex : nearestBusIndex(x, z);
}

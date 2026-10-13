/**
 * Plan-view geometry for the 2D maps. World convention (packages/shared/src/layout.ts):
 * metres, X east (right), Z south (down on a north-up map). SVG uses x → x, z → y directly.
 */
import { cityLayout } from '@encirra/shared';
import type { LayoutBuilding } from '@encirra/shared';
import type { NetworkTopology } from '@encirra/shared';

export type P2 = [number, number];

export const PLATFORM = cityLayout.platform;

export function pathD(points: P2[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
}

/** Street-following cable route for a line; falls back to a straight segment between its buses. */
export function lineRoute(topology: NetworkTopology, lineId: number): P2[] {
  const r = cityLayout.electrical.lineRoutes[String(lineId)];
  if (r && r.length >= 2) return r as P2[];
  const l = topology.electrical.lines[lineId];
  const a = topology.electrical.buses[l?.from]?.pos;
  const b = topology.electrical.buses[l?.to]?.pos;
  return a && b ? [a as P2, b as P2] : [];
}

/** Point at fraction f (0…1) of a polyline's length. */
export function pointAlong(points: P2[], f = 0.5): P2 {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return points[0];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    seg.push(d);
    total += d;
  }
  let target = total * f;
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i] || i === seg.length - 1) {
      const u = seg[i] === 0 ? 0 : Math.min(1, target / seg[i]);
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * u, points[i][1] + (points[i + 1][1] - points[i][1]) * u];
    }
    target -= seg[i];
  }
  return points[points.length - 1];
}

/** Corners of a building footprint (rotation about +Y; plan rotation is negated for z-down). */
export function buildingCorners(b: LayoutBuilding): P2[] {
  const [w, d] = b.size;
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const pts: P2[] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
  // three.js rotation about +Y maps (x, z) → (x·cos + z·sin, −x·sin + z·cos)
  return pts.map(([x, z]) => [b.pos[0] + x * c + z * s, b.pos[1] - x * s + z * c]);
}

export function polyPoints(pts: P2[]): string {
  return pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
}

/** 0-based bus id of a layout building (layout stores the 1-based benchmark number). */
export const buildingBusId = (b: LayoutBuilding): number | null => (b.bus == null ? null : b.bus - 1);

const nearestCache = new WeakMap<NetworkTopology, Map<string, number>>();

/**
 * Water service node for each building: its facility's water node when it has one, otherwise the
 * nearest demand junction in the same pressure zone (plan distance). Used for the water overview.
 */
export function buildingJunctions(topology: NetworkTopology): Map<string, number> {
  const hit = nearestCache.get(topology);
  if (hit) return hit;
  const js = topology.water.junctions;
  const out = new Map<string, number>();
  for (const b of cityLayout.buildings) {
    const fac = b.facilityId ? topology.facilities.find((f) => f.id === b.facilityId) : null;
    const direct = fac?.waterNode ? js.findIndex((j) => j.id === fac.waterNode) : -1;
    if (direct >= 0) {
      out.set(b.id, direct);
      continue;
    }
    if (fac && !fac.waterNode) continue; // facility without a water service connection
    const zone = b.pos[0] < 0 ? 'West' : 'East';
    let best = -1;
    let bestD = Infinity;
    js.forEach((j, i) => {
      if (j.baseDemandLps <= 0 || j.zone !== zone) return;
      const d = Math.hypot(j.pos[0] - b.pos[0], j.pos[2] - b.pos[1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) out.set(b.id, best);
  }
  nearestCache.set(topology, out);
  return out;
}

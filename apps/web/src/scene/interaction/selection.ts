/**
 * Selection helpers: map store selections (facility / building ids) to scene indices and
 * world-space focus targets for the camera.
 */
import type { Selection } from '@/state/store';
import {
  BUILDING_BY_FACILITY,
  BUILDING_BY_ID,
  BUSES,
  FACILITY_BY_ID,
  JUNCTIONS,
  LINES,
  PIPES,
  PUMPS,
  TANKS,
  pointAlong,
} from '../data/twin';

export function selectionToBuildingIndex(sel: Selection | null): number {
  if (!sel) return -1;
  if (sel.kind === 'building') return BUILDING_BY_ID.get(sel.id)?.index ?? -1;
  if (sel.kind === 'facility') return BUILDING_BY_FACILITY.get(sel.id)?.index ?? -1;
  return -1;
}

export interface FocusTarget {
  center: [number, number, number];
  radius: number;
  underground?: boolean;
}

/** World-space centre + radius for any selectable element (used by camera focus). */
export function focusTargetFor(sel: Selection): FocusTarget | null {
  switch (sel.kind) {
    case 'facility': {
      const b = BUILDING_BY_FACILITY.get(sel.id);
      const f = FACILITY_BY_ID.get(sel.id);
      if (!b && !f) return null;
      const pos = b?.pos ?? (f!.pos as [number, number]);
      const h = b?.height ?? 20;
      const size = b ? Math.max(b.size[0], b.size[1]) : 40;
      return { center: [pos[0], h * 0.45, pos[1]], radius: Math.max(size, h) * 0.9 + 18 };
    }
    case 'building': {
      const b = BUILDING_BY_ID.get(sel.id);
      if (!b) return null;
      return { center: [b.pos[0], b.height * 0.45, b.pos[1]], radius: Math.max(b.size[0], b.size[1], b.height) * 0.9 + 14 };
    }
    case 'bus': {
      const b = BUSES[Number(sel.id)];
      if (!b) return null;
      return { center: [b.pos[0], 4, b.pos[1]], radius: 45 };
    }
    case 'line':
    case 'switch': {
      const line = sel.kind === 'line' ? LINES[Number(sel.id)] : LINES.find((l) => l.switchId === sel.id);
      if (!line) return null;
      const [x, z] = pointAlong(line.route, line.length / 2);
      return { center: [x, 2, z], radius: Math.max(40, line.length * 0.45) };
    }
    case 'pipe': {
      const p = PIPES.find((q) => q.id === sel.id);
      if (!p) return null;
      const a = p.route[0];
      const b = p.route[p.route.length - 1];
      return { center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], radius: 50, underground: true };
    }
    case 'pump': {
      const pu = PUMPS.find((q) => q.id === sel.id);
      const j = pu ? JUNCTIONS.find((q) => q.id === pu.to) : null;
      if (!j) return null;
      return { center: [j.pos[0], j.pos[1] - 3, j.pos[2]], radius: 30, underground: true };
    }
    case 'tank': {
      const t = TANKS.find((q) => q.id === sel.id);
      if (!t) return null;
      return { center: [t.pos[0], 30, t.pos[2]], radius: 55 };
    }
    case 'junction': {
      const j = JUNCTIONS.find((q) => q.id === sel.id);
      if (!j) return null;
      return { center: j.pos as [number, number, number], radius: 35, underground: true };
    }
  }
  return null;
}

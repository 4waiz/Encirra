import { memo, useMemo } from 'react';
import { cityLayout } from '@encirra/shared';
import type { ElementState, Frame, NetworkTopology } from '@encirra/shared';
import type { OverviewMode, Selection } from '@/state/store';
import { buildingBusId, buildingCorners, buildingJunctions, polyPoints, pathD, type P2 } from './geometry';

const P = cityLayout.platform;
const M = 10;
export const OVERVIEW_VIEWBOX = `${P.minX - M} ${P.minZ - M} ${P.maxX - P.minX + 2 * M} ${P.maxZ - P.minZ + 2 * M}`;

/** Severity classes shared by the map, its legend and tests. */
export type MapClass = 'normal' | 'restored' | 'restoring' | 'at-risk' | 'affected' | 'unmodelled';

export const MAP_COLORS: Record<OverviewMode, Record<MapClass, string>> = {
  power: { normal: '#F5B847', restored: '#22B573', restoring: '#F08C2E', 'at-risk': '#F08C2E', affected: '#8E99A5', unmodelled: '#D7DDE3' },
  water: { normal: '#38C6EE', restored: '#22B573', restoring: '#F08C2E', 'at-risk': '#F5A623', affected: '#F04438', unmodelled: '#D7DDE3' },
  combined: { normal: '#9DB7D3', restored: '#22B573', restoring: '#F08C2E', 'at-risk': '#F5A623', affected: '#F04438', unmodelled: '#D7DDE3' },
};

export const MAP_LEGEND: Record<OverviewMode, { cls: MapClass; label: string }[]> = {
  power: [
    { cls: 'normal', label: 'Energized' },
    { cls: 'affected', label: 'No supply' },
    { cls: 'restoring', label: 'Restoring' },
    { cls: 'restored', label: 'Restored' },
  ],
  water: [
    { cls: 'normal', label: '≥ service pressure' },
    { cls: 'at-risk', label: 'Low pressure' },
    { cls: 'affected', label: 'No flow' },
    { cls: 'restored', label: 'Restored' },
  ],
  combined: [
    { cls: 'normal', label: 'Normal' },
    { cls: 'at-risk', label: 'At risk' },
    { cls: 'affected', label: 'Affected' },
    { cls: 'restored', label: 'Restored' },
  ],
};

const RANK: Record<MapClass, number> = { unmodelled: -1, normal: 0, restored: 1, restoring: 2, 'at-risk': 3, affected: 4 };

function powerClass(st: ElementState | undefined, shed: boolean): MapClass {
  if (st == null) return 'unmodelled';
  if (shed) return 'affected';
  if (st === 'energized') return 'normal';
  if (st === 'restored') return 'restored';
  if (st === 'restoring') return 'restoring';
  return 'affected'; // deenergized / faulted / isolated
}

/** Classifies every layout building for a frame (exported for tests). */
export function classifyBuildings(topology: NetworkTopology, frame: Frame, everLow: Set<number>): Map<string, { power: MapClass; water: MapClass; combined: MapClass }> {
  const junctions = buildingJunctions(topology);
  const thr = topology.water.serviceThresholdM;
  const out = new Map<string, { power: MapClass; water: MapClass; combined: MapClass }>();
  for (const b of cityLayout.buildings) {
    const bus = buildingBusId(b);
    const power: MapClass = bus == null ? 'unmodelled' : powerClass(frame.power.busState[bus], !!frame.power.busShed[bus]);
    const j = junctions.get(b.id);
    let water: MapClass = 'unmodelled';
    if (j != null) {
      const p = frame.water.junctionPressureM[j];
      const delivered = frame.water.junctionDeliveredLps[j];
      const required = frame.water.junctionRequiredLps[j];
      if (p >= thr) water = everLow.has(j) ? 'restored' : 'normal';
      else if (required > 0 && delivered <= required * 0.02) water = 'affected';
      else water = 'at-risk';
    }
    const combined = RANK[power] >= RANK[water] ? power : water;
    out.set(b.id, { power, water, combined: combined === 'restoring' ? 'at-risk' : combined });
  }
  return out;
}

/** Junction indices that were below the service threshold at any frame up to k (for "restored"). */
export function junctionsEverLow(frames: Frame[], k: number, thr: number): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i <= Math.min(k, frames.length - 1); i++) frames[i].water.junctionPressureM.forEach((p, j) => p < thr && s.add(j));
  return s;
}

const Base = memo(function Base() {
  return (
    <g>
      <rect x={P.minX} y={P.minZ} width={P.maxX - P.minX} height={P.maxZ - P.minZ} rx={8} fill="#dfe6ed" />
      {cityLayout.blocks.map((b) => (
        <rect key={b.id} x={b.minX} y={b.minZ} width={b.maxX - b.minX} height={b.maxZ - b.minZ} rx={3} fill="#eef2f6" />
      ))}
      {cityLayout.roads.map((r) => (
        <path key={r.id} d={pathD(r.points as P2[])} stroke="#ffffff" strokeWidth={r.width * 0.7} fill="none" strokeLinecap="square" />
      ))}
    </g>
  );
});

export function OverviewMap({
  topology,
  frames,
  k,
  mode,
  selected,
  onPick,
  onHover,
}: {
  topology: NetworkTopology;
  frames: Frame[];
  k: number;
  mode: OverviewMode;
  selected: Selection | null;
  onPick: (sel: Selection) => void;
  onHover?: (sel: Selection | null) => void;
}) {
  const frame = frames[Math.min(k, frames.length - 1)];
  const thr = topology.water.serviceThresholdM;
  const everLow = useMemo(() => junctionsEverLow(frames, k, thr), [frames, k, thr]);
  const classes = useMemo(() => classifyBuildings(topology, frame, everLow), [topology, frame, everLow]);
  const colors = MAP_COLORS[mode];
  const polys = useMemo(() => cityLayout.buildings.map((b) => polyPoints(buildingCorners(b))), []);

  return (
    <svg viewBox={OVERVIEW_VIEWBOX} preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img" aria-label={`District overview (${mode})`}>
      <defs>
        <filter id="ov-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
      </defs>
      <Base />
      <g filter="url(#ov-blur)" opacity={0.5}>
        {cityLayout.buildings.map((b) => {
          const c = classes.get(b.id)?.[mode];
          return c === 'affected' ? <circle key={b.id} cx={b.pos[0]} cy={b.pos[1]} r={26} fill="#F04438" opacity={0.55} /> : null;
        })}
      </g>
      {cityLayout.buildings.map((b, i) => {
        const cls = classes.get(b.id)?.[mode] ?? 'unmodelled';
        const sel: Selection = b.facilityId ? { kind: 'facility', id: b.facilityId } : { kind: 'building', id: b.id };
        const isSel = selected && selected.kind === sel.kind && selected.id === sel.id;
        return (
          <polygon
            key={b.id}
            points={polys[i]}
            fill={colors[cls]}
            stroke={isSel ? '#15283C' : b.facilityId ? '#2B3D50' : 'rgba(255,255,255,0.9)'}
            strokeWidth={isSel ? 3 : b.facilityId ? 1.6 : 1}
            className="cursor-pointer transition-[fill] duration-300 hover:brightness-95"
            onClick={() => onPick(sel)}
            onMouseEnter={() => onHover?.(sel)}
            onMouseLeave={() => onHover?.(null)}
            data-building={b.id}
            data-class={cls}
          >
            <title>{`${b.name ?? b.kind.replace(/-/g, ' ')}${b.bus != null ? ` · bus B${b.bus}` : ''}`}</title>
          </polygon>
        );
      })}
    </svg>
  );
}

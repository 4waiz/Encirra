import { memo, useMemo } from 'react';
import { cityLayout } from '@encirra/shared';
import type { ElementState, Frame, NetworkTopology } from '@encirra/shared';
import { STATE_COLOR } from '@/ui/primitives';
import { lineRoute, pathD, pointAlong, type P2 } from './geometry';

const P = cityLayout.platform;
const M = 14; // margin (m)
export const FEEDER_VIEWBOX = `${P.minX - M} ${P.minZ - M} ${P.maxX - P.minX + 2 * M} ${P.maxZ - P.minZ + 2 * M}`;

const DARK_STATES: ElementState[] = ['deenergized', 'faulted', 'isolated'];

/** Static district base: blocks and roads (memoized once). */
const DistrictBase = memo(function DistrictBase({ ground = '#e9eef3', block = '#f6f8fa', road = '#ffffff' }: { ground?: string; block?: string; road?: string }) {
  return (
    <g>
      <rect x={P.minX} y={P.minZ} width={P.maxX - P.minX} height={P.maxZ - P.minZ} rx={6} fill={ground} />
      {cityLayout.blocks.map((b) => (
        <rect key={b.id} x={b.minX} y={b.minZ} width={b.maxX - b.minX} height={b.maxZ - b.minZ} rx={3} fill={block} />
      ))}
      {cityLayout.roads.map((r) => (
        <path key={r.id} d={pathD(r.points as P2[])} stroke={road} strokeWidth={r.width * 0.55} fill="none" strokeLinecap="square" />
      ))}
    </g>
  );
});

export function FeederMap({
  topology,
  frame,
  faultActive,
  faultLineId,
  theme = 'light',
}: {
  topology: NetworkTopology;
  frame: Frame;
  faultActive: boolean;
  faultLineId: number | null;
  theme?: 'light' | 'dark';
}) {
  const dark = theme === 'dark';
  const ring = dark ? '#0d1a2a' : '#fff';
  const routes = useMemo(() => topology.electrical.lines.map((l) => lineRoute(topology, l.id)), [topology]);
  const ps = frame.power;
  const faulted = ps.lineState.findIndex((s) => s === 'faulted');
  const sparkLine = faulted >= 0 ? faulted : faultActive ? faultLineId : null;
  const spark = sparkLine != null && routes[sparkLine] ? pointAlong(routes[sparkLine], 0.5) : null;
  const subId = topology.electrical.substationBus;

  return (
    <svg viewBox={FEEDER_VIEWBOX} preserveAspectRatio={dark ? 'xMidYMid meet' : 'xMinYMid meet'} className="h-full w-full" role="img" aria-label="Feeder status map">
      <defs>
        <filter id="fm-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>
      {dark ? <DistrictBase ground="#101d2f" block="#16263b" road="#22364f" /> : <DistrictBase />}
      {/* affected area: de-energized / faulted buses */}
      <g filter="url(#fm-blur)" opacity={0.55}>
        {topology.electrical.buses.map((b, i) =>
          DARK_STATES.includes(ps.busState[i]) || ps.busShed[i] ? <circle key={b.id} cx={b.pos[0]} cy={b.pos[1]} r={34} fill="#F04438" opacity={0.55} /> : null,
        )}
      </g>
      {/* lines */}
      {topology.electrical.lines.map((l, i) => {
        const st = ps.lineState[i] ?? 'energized';
        const d = pathD(routes[i]);
        if (!d) return null;
        const open = st === 'open';
        return (
          <g key={l.id}>
            {(st === 'faulted' || st === 'restored') && (
              <path d={d} stroke={STATE_COLOR[st]} strokeOpacity={0.28} strokeWidth={7} fill="none" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
            )}
            <path
              d={d}
              stroke={STATE_COLOR[st]}
              strokeWidth={open ? 1.4 : 2.2}
              strokeDasharray={open ? '3 3' : st === 'restoring' ? '5 3' : undefined}
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      })}
      {/* buses */}
      {topology.electrical.buses.map((b, i) => {
        const st = ps.busState[i] ?? 'energized';
        const c = ps.busShed[i] ? STATE_COLOR.deenergized : STATE_COLOR[st];
        if (b.id === subId)
          return <rect key={b.id} x={b.pos[0] - 9} y={b.pos[1] - 9} width={18} height={18} rx={3} fill={dark ? '#6AA8EE' : '#1d4f86'} stroke={ring} strokeWidth={2.5} />;
        return <circle key={b.id} cx={b.pos[0]} cy={b.pos[1]} r={b.critical ? 7.5 : 6} fill={c} stroke={ring} strokeWidth={2.5} />;
      })}
      {spark && (
        <g transform={`translate(${spark[0]} ${spark[1]})`}>
          <circle r={19} fill="#F04438" opacity={0.25} />
          <circle r={14} fill="#F04438" stroke="#fff" strokeWidth={2.5} />
          <path d="M2.5 -9 L-5.5 1.5 L-0.5 1.5 L-2.5 9 L5.5 -1.5 L0.5 -1.5 Z" fill="#fff" />
        </g>
      )}
    </svg>
  );
}

export { DistrictBase };

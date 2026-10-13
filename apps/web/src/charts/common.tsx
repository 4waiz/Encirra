/** Shared chart styling (recessive hairline grid/axes, text tokens, crosshair tooltip). */
import type { ReactNode } from 'react';
import { clockFromT, fmtNum } from '@/data/format';

export const AXIS_TICK = { fontSize: 10, fill: '#5b6b7c' } as const;
export const AXIS_LINE = { stroke: '#d3dae2' } as const;
export const GRID = { stroke: '#e8edf2', strokeWidth: 1 } as const;

/**
 * Series colours (validated with the dataviz palette checker: CVD/normal-vision separation pass;
 * the grey slots are intentional de-emphasis for reference/baseline series and always ship with
 * a legend plus a table view).
 */
export const SERIES = {
  served: '#D4880F',
  servedWash: '#F5A623',
  demand: '#7f93a8',
  pressure: '#00A9D4',
  tank: '#1d7fa6',
  threshold: '#c8281d',
  minPressure: '#5b6b7c',
  noneS: '#98A2AD',
  gridS: '#C97E0A',
  encirraS: '#2A6CB5',
} as const;

export const STRATEGY_COLOR = { none: SERIES.noneS, 'grid-only': SERIES.gridS, encirra: SERIES.encirraS } as const;

/** Nice tick step for a time axis in minutes. */
export function timeTicks(maxMin: number, target = 4): number[] {
  const steps = [5, 10, 15, 20, 30, 60, 120, 180, 240];
  const step = steps.find((s) => maxMin / s <= target) ?? 240;
  const out: number[] = [];
  for (let m = 0; m <= maxMin + 1e-6; m += step) out.push(m);
  return out;
}

export function clockTick(startClock: string) {
  return (min: number) => clockFromT(startClock, min * 60);
}

export interface TipRow {
  label: string;
  value: string;
  color?: string;
}

/** Tooltip body rendered by Recharts' content prop. */
export function TipBox({ title, rows }: { title: ReactNode; rows: TipRow[] }) {
  return (
    <div className="rounded-md border border-line bg-white/97 px-2.5 py-1.5 text-[11px] shadow-lg">
      <div className="mb-0.5 font-semibold text-navy tabular">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-3 text-ink">
          <span className="flex items-center gap-1.5">
            {r.color && <span className="inline-block h-[3px] w-3 rounded" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="font-semibold text-navy tabular">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export const n0 = (v: unknown) => (typeof v === 'number' ? fmtNum(v, 0) : '—');
export const n1 = (v: unknown) => (typeof v === 'number' ? fmtNum(v, 1) : '—');

export function LegendKey({ items }: { items: { label: string; color: string; dashed?: boolean; area?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 t-micro text-slate">
          <svg width="14" height="8" aria-hidden>
            {it.area && <rect x="0" y="1" width="14" height="6" fill={it.color} opacity="0.18" />}
            <line x1="0" y1="4" x2="14" y2="4" stroke={it.color} strokeWidth="2" strokeDasharray={it.dashed ? '3 2' : undefined} />
          </svg>
          {it.label}
        </span>
      ))}
    </div>
  );
}

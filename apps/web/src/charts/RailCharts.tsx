/**
 * Compact time-series charts for the dark Live Twin rails: 1.5 px strokes with soft area fills,
 * small labelled event ticks, the playhead and a
 * dimmed future. Values come straight from the run frames (powerSeries / waterSeries); markers
 * come from runMarks.
 */
import { memo, useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { NetworkTopology, RunResult } from '@encirra/shared';
import { focusTank, powerSeries, runMarks, waterSeries } from '@/data/selectors';
import { fmtNum } from '@/data/format';
import { clockTick, timeTicks } from './common';

export const DARK = {
  tick: { fontSize: 10.5, fill: '#9FB0C2' },
  axis: { stroke: 'rgba(255,255,255,0.12)' },
  grid: { stroke: 'rgba(255,255,255,0.06)', strokeWidth: 1 },
  power: '#F5A623',
  demand: '#8395A8',
  pressure: '#00BFEA',
  tank: '#8CB8E2',
  fault: '#F04438',
  faultInk: '#FF8A80',
  ok: '#17A769',
  okInk: '#4ED69B',
  playhead: '#F2F6FA',
  future: '#0B1624',
} as const;

interface ViewBox {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** Event tick label beside its marker line; `row` staggers neighbours vertically. */
function Tick({ viewBox, text, color, row = 0, align = 'start' }: { viewBox?: ViewBox; text: string; color: string; row?: number; align?: 'start' | 'end' }) {
  const x = (viewBox?.x ?? 0) + (align === 'start' ? 4 : -4);
  const y = (viewBox?.y ?? 0) - 16 + row * 12;
  return (
    <text x={x} y={y} textAnchor={align} fontSize={10.5} fontWeight={600} fill={color} stroke="#0d1a2a" strokeWidth={3} paintOrder="stroke">
      {text}
    </text>
  );
}

function TipCard({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#0b1624]/95 px-2.5 py-1.5 text-[11px] text-[#d3dde8] shadow-lg">
      <div className="mb-0.5 font-semibold text-[#f2f6fa] tabular">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5">
            {r.color && <span className="inline-block h-[3px] w-3 rounded" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="font-semibold text-[#f2f6fa] tabular">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Y tick that marks the service threshold in red ("20 m"); other ticks are plain numbers. */
function ThresholdTick({ x, y, payload, thr }: { x?: number; y?: number; payload?: { value: number }; thr: number }) {
  const v = payload?.value ?? 0;
  const isThr = Math.abs(v - thr) < 1e-6;
  return (
    <text x={(x ?? 0) - 4} y={(y ?? 0) + 3.5} textAnchor="end" fontSize={10.5} fontWeight={isThr ? 700 : 400} fill={isThr ? DARK.faultInk : DARK.tick.fill}>
      {v}
    </text>
  );
}

const kTick = (v: number) => (Math.abs(v) >= 1000 ? `${fmtNum(v / 1000, v % 1000 === 0 ? 0 : 1)}k` : fmtNum(v, 0));

function Fade({ id, color, top = 0.32 }: { id: string; color: string; top?: number }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={top} />
        <stop offset="100%" stopColor={color} stopOpacity={0.02} />
      </linearGradient>
    </defs>
  );
}

const MARGIN = { top: 30, right: 6, bottom: 0, left: -10 };

// ───────────────────────────────────────────────────────────── power
export const PowerSpark = memo(function PowerSpark({ run, playMin }: { run: RunResult; playMin: number }) {
  const data = powerSeries(run);
  const marks = runMarks(run);
  const maxMin = data.length ? data[data.length - 1].min : 0;
  const ticks = useMemo(() => timeTicks(maxMin), [maxMin]);
  const fmtX = useMemo(() => clockTick(run.timebase.startClock), [run]);
  const faultMin = marks.faultT != null ? marks.faultT / 60 : null;
  const restoredMin = marks.restoredT != null ? marks.restoredT / 60 : null;
  const yMax = Math.max(...data.map((d) => d.demandKW)) * 1.08;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={MARGIN}>
        <Fade id="fade-power" color={DARK.power} />
        <CartesianGrid vertical={false} {...DARK.grid} />
        <XAxis dataKey="min" type="number" domain={[0, maxMin]} ticks={ticks} tickFormatter={fmtX} tick={DARK.tick} axisLine={DARK.axis} tickLine={false} height={18} />
        <YAxis tick={DARK.tick} axisLine={false} tickLine={false} width={38} tickFormatter={kTick} domain={[0, yMax]} ticks={[0, Math.round(yMax / 2 / 500) * 500, Math.floor(yMax / 1000) * 1000]} />
        {faultMin != null && <ReferenceArea x1={faultMin} x2={restoredMin ?? maxMin} fill={DARK.fault} fillOpacity={0.08} ifOverflow="hidden" />}
        <Area dataKey="servedKW" type="linear" stroke={DARK.power} strokeWidth={1.5} fill="url(#fade-power)" isAnimationActive={false} dot={false} activeDot={{ r: 3.5, strokeWidth: 2, stroke: '#0b1624' }} />
        <Line dataKey="demandKW" type="linear" stroke={DARK.demand} strokeWidth={1.25} strokeDasharray="3 3" dot={false} isAnimationActive={false} activeDot={false} />
        {playMin < maxMin && <ReferenceArea x1={playMin} x2={maxMin} fill={DARK.future} fillOpacity={0.5} ifOverflow="hidden" />}
        {faultMin != null && <ReferenceLine x={faultMin} stroke={DARK.fault} strokeWidth={1.2} label={<Tick text="Fault" color={DARK.faultInk} />} />}
        {restoredMin != null && <ReferenceLine x={restoredMin} stroke={DARK.ok} strokeWidth={1.2} label={<Tick text="Restored" color={DARK.okInk} row={1} />} />}
        <ReferenceLine x={playMin} stroke={DARK.playhead} strokeWidth={1} strokeOpacity={0.8} />
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: 'rgba(255,255,255,0.35)', strokeWidth: 1 }}
          content={({ active, payload }) => {
            const p = active && payload?.[0]?.payload;
            if (!p) return null;
            return (
              <TipCard
                title={p.clock}
                rows={[
                  { label: 'Served', value: `${fmtNum(p.servedKW, 0)} kW`, color: DARK.power },
                  { label: 'Demand', value: `${fmtNum(p.demandKW, 0)} kW`, color: DARK.demand },
                  { label: 'Unserved', value: `${fmtNum(p.unservedKW, 0)} kW` },
                ]}
              />
            );
          }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
});

// ───────────────────────────────────────────────────────────── water: critical pressure + tank
/**
 * The cascade in one picture: pump trip tick → critical pressure (cyan) falling below the dashed
 * service line, with the hidden delay shaded and annotated. The focus tank's level (% of usable
 * range) sits in a thin strip underneath on the same time axis, so the draining buffer is visible.
 */
export const WaterSpark = memo(function WaterSpark({ run, topology, playMin }: { run: RunResult; topology: NetworkTopology; playMin: number }) {
  const series = waterSeries(run, topology);
  const thr = topology.water.serviceThresholdM;
  const marks = runMarks(run, thr);
  const maxMin = series.length ? series[series.length - 1].min : 0;
  const ticks = useMemo(() => timeTicks(maxMin), [maxMin]);
  const fmtX = useMemo(() => clockTick(run.timebase.startClock), [run]);
  const ti = focusTank(run, topology);
  const tank = topology.water.tanks[ti];
  const data = useMemo(() => series.map((d) => ({ ...d, level: d.tanks[tank?.id ?? ''] ?? null })), [series, tank]);
  const tripMin = marks.pumpTripT != null ? marks.pumpTripT / 60 : null;
  const recMin = marks.pumpRecoveredT != null ? marks.pumpRecoveredT / 60 : null;
  const belowMin = marks.pressureBelowT != null ? marks.pressureBelowT / 60 : null;
  const backMin = marks.pressureRecoveredT != null ? marks.pressureRecoveredT / 60 : null;
  const delay = run.summary.hydraulicDelayMin;
  const pMax = Math.max(thr * 1.5, ...series.map((d) => d.criticalPressureM));
  const pTop = Math.ceil(pMax / 10) * 10;
  const dim = playMin < maxMin;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-[3]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={MARGIN} syncId="rail-water">
            <Fade id="fade-pressure" color={DARK.pressure} />
            <CartesianGrid vertical={false} {...DARK.grid} />
            <XAxis dataKey="min" type="number" domain={[0, maxMin]} ticks={ticks} tick={false} axisLine={DARK.axis} tickLine={false} height={1} />
            <YAxis tick={<ThresholdTick thr={thr} />} axisLine={false} tickLine={false} width={38} domain={[0, pTop]} ticks={[0, thr, pTop]} />
            {tripMin != null && belowMin != null && belowMin > tripMin && (
              <ReferenceArea
                x1={tripMin}
                x2={belowMin}
                fill={DARK.pressure}
                fillOpacity={0.08}
                ifOverflow="hidden"
                label={delay != null ? { value: `${fmtNum(delay, 0)} min delay`, position: 'insideBottom', fontSize: 10.5, fill: '#52D4F3', fontWeight: 600, offset: 6 } : undefined}
              />
            )}
            <ReferenceLine y={thr} stroke={DARK.fault} strokeDasharray="4 3" strokeWidth={1.1} strokeOpacity={0.85} />
            <Area dataKey="criticalPressureM" type="linear" stroke={DARK.pressure} strokeWidth={1.5} fill="url(#fade-pressure)" isAnimationActive={false} dot={false} activeDot={{ r: 3.5, strokeWidth: 2, stroke: '#0b1624' }} />
            {dim && <ReferenceArea x1={playMin} x2={maxMin} fill={DARK.future} fillOpacity={0.5} ifOverflow="hidden" />}
            {tripMin != null && <ReferenceLine x={tripMin} stroke={DARK.fault} strokeWidth={1.2} label={<Tick text="Pump trip" color={DARK.faultInk} />} />}
            {recMin != null && <ReferenceLine x={recMin} stroke={DARK.ok} strokeWidth={1.2} label={<Tick text="Pump back" color={DARK.okInk} row={1} />} />}
            {belowMin != null && (
              <ReferenceLine x={belowMin} stroke={DARK.fault} strokeWidth={1.2} strokeDasharray="2 2" label={<Tick text={`< ${thr} m`} color={DARK.faultInk} align={belowMin > maxMin * 0.8 ? 'end' : 'start'} />} />
            )}
            {backMin != null && recMin == null && <ReferenceLine x={backMin} stroke={DARK.ok} strokeWidth={1.2} label={<Tick text="Recovered" color={DARK.okInk} row={1} />} />}
            <ReferenceLine x={playMin} stroke={DARK.playhead} strokeWidth={1} strokeOpacity={0.8} />
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: 'rgba(255,255,255,0.35)', strokeWidth: 1 }}
          content={({ active, payload }) => {
            const p = active && payload?.[0]?.payload;
            if (!p) return null;
            return (
              <TipCard
                title={p.clock}
                rows={[
                  { label: 'Critical pressure', value: `${fmtNum(p.criticalPressureM, 1)} m`, color: DARK.pressure },
                  { label: `Tank ${tank?.id ?? ''}`, value: `${fmtNum(p.level, 0)}%`, color: DARK.tank },
                  { label: 'Service level', value: `${fmtNum(thr, 0)} m` },
                ]}
              />
            );
          }}
        />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -10 }} syncId="rail-water">
            <Fade id="fade-tank" color={DARK.tank} top={0.24} />
            <XAxis dataKey="min" type="number" domain={[0, maxMin]} ticks={ticks} tickFormatter={fmtX} tick={DARK.tick} axisLine={DARK.axis} tickLine={false} height={18} />
            <YAxis axisLine={false} tickLine={false} width={38} domain={[0, 100]} ticks={[0, 100]} tick={DARK.tick} tickFormatter={(v: number) => (v === 100 ? `${tank?.id ?? ''}` : '0%')} />
            <Area dataKey="level" type="linear" stroke={DARK.tank} strokeWidth={1.5} fill="url(#fade-tank)" isAnimationActive={false} dot={false} activeDot={{ r: 3, strokeWidth: 2, stroke: '#0b1624' }} />
            {dim && <ReferenceArea x1={playMin} x2={maxMin} fill={DARK.future} fillOpacity={0.5} ifOverflow="hidden" />}
            {tripMin != null && <ReferenceLine x={tripMin} stroke={DARK.fault} strokeWidth={1} strokeOpacity={0.6} />}
            <ReferenceLine x={playMin} stroke={DARK.playhead} strokeWidth={1} strokeOpacity={0.8} />
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: 'rgba(255,255,255,0.35)', strokeWidth: 1 }}
          content={({ active, payload }) => {
            const p = active && payload?.[0]?.payload;
            if (!p) return null;
            return (
              <TipCard
                title={p.clock}
                rows={[
                  { label: 'Critical pressure', value: `${fmtNum(p.criticalPressureM, 1)} m`, color: DARK.pressure },
                  { label: `Tank ${tank?.id ?? ''}`, value: `${fmtNum(p.level, 0)}%`, color: DARK.tank },
                  { label: 'Service level', value: `${fmtNum(thr, 0)} m` },
                ]}
              />
            );
          }}
        />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

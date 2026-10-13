import { memo, useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { NetworkTopology, RunResult } from '@encirra/shared';
import { powerSeries, runMarks, waterSeries } from '@/data/selectors';
import { fmtNum } from '@/data/format';
import { AXIS_LINE, AXIS_TICK, GRID, SERIES, TipBox, clockTick, timeTicks } from './common';

interface ViewBox {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** Event marker label to the right of its line; `row` staggers neighbouring markers vertically so they never collide. */
function MarkerLabel({ viewBox, text, color, row = 0 }: { viewBox?: ViewBox; text: string; color: string; row?: number }) {
  const x = (viewBox?.x ?? 0) + 3;
  const y = (viewBox?.y ?? 0) + 9 + row * 11;
  return (
    <text x={x} y={y} textAnchor="start" fontSize={10} fontWeight={600} fill={color} stroke="#fff" strokeWidth={3} paintOrder="stroke">
      {text}
    </text>
  );
}

const kTick = (v: number) => (Math.abs(v) >= 1000 ? `${fmtNum(v / 1000, v % 1000 === 0 ? 0 : 1)}k` : fmtNum(v, 0));

// ───────────────────────────────────────────────────────────── power: served vs demand
export const PowerChart = memo(function PowerChart({ run, playMin, height }: { run: RunResult; playMin: number; height?: number }) {
  const data = powerSeries(run);
  const marks = runMarks(run);
  const maxMin = data.length ? data[data.length - 1].min : 0;
  const ticks = useMemo(() => timeTicks(maxMin), [maxMin]);
  const fmtX = useMemo(() => clockTick(run.timebase.startClock), [run]);
  const faultMin = marks.faultT != null ? marks.faultT / 60 : null;
  const restoredMin = marks.restoredT != null ? marks.restoredT / 60 : null;
  return (
    <ResponsiveContainer width="100%" height={height ?? '100%'}>
      <ComposedChart data={data} margin={{ top: 14, right: 10, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} {...GRID} />
        <XAxis dataKey="min" type="number" domain={[0, maxMin]} ticks={ticks} tickFormatter={fmtX} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} height={16} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} tickFormatter={kTick} domain={[0, 'auto']} />
        {faultMin != null && <ReferenceArea x1={faultMin} x2={restoredMin ?? maxMin} fill="#F04438" fillOpacity={0.06} ifOverflow="hidden" />}
        <Area dataKey="servedKW" type="linear" stroke={SERIES.served} strokeWidth={2} fill={SERIES.servedWash} fillOpacity={0.12} isAnimationActive={false} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
        <Line dataKey="demandKW" type="linear" stroke={SERIES.demand} strokeWidth={1.5} dot={false} isAnimationActive={false} activeDot={{ r: 3.5, strokeWidth: 2, stroke: '#fff' }} />
        {faultMin != null && (
          <ReferenceLine x={faultMin} stroke="#F04438" strokeWidth={1.2} label={<MarkerLabel text="Fault" color="#c8281d" />} />
        )}
        {restoredMin != null && (
          <ReferenceLine x={restoredMin} stroke="#17A769" strokeWidth={1.2} label={<MarkerLabel text="Restored" color="#0f7f4f" row={1} />} />
        )}
        <ReferenceLine x={playMin} stroke="#15283C" strokeWidth={1} strokeOpacity={0.7} />
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: '#5b6b7c', strokeWidth: 1 }}
          content={({ active, payload }) => {
            const p = active && payload?.[0]?.payload;
            if (!p) return null;
            return (
              <TipBox
                title={p.clock}
                rows={[
                  { label: 'Served', value: `${fmtNum(p.servedKW, 0)} kW`, color: SERIES.served },
                  { label: 'Demand', value: `${fmtNum(p.demandKW, 0)} kW`, color: SERIES.demand },
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

// ───────────────────────────────────────────────────────────── water: critical pressure + tank level (small multiples)
/** Tank shown with the pressure chart: the tank in the pressure zone of the first pump that tripped (else T2, else the first). */
export function focusTank(run: RunResult, topology: NetworkTopology): number {
  const tanks = topology.water.tanks;
  const first = run.frames[0];
  if (first) {
    for (const f of run.frames) {
      const i = f.water.pumpOn.findIndex((on, j) => !on && first.water.pumpOn[j]);
      if (i >= 0) {
        const pump = topology.water.pumps[i];
        const zone = topology.water.junctions.find((j) => j.id === pump?.to)?.zone;
        const ti = tanks.findIndex((t) => t.zone === zone);
        if (ti >= 0) return ti;
        break;
      }
    }
  }
  const t2 = tanks.findIndex((t) => t.id === 'T2');
  return t2 >= 0 ? t2 : 0;
}

export const WaterCharts = memo(function WaterCharts({ run, topology, playMin }: { run: RunResult; topology: NetworkTopology; playMin: number }) {
  const data = waterSeries(run, topology);
  const thr = topology.water.serviceThresholdM;
  const marks = runMarks(run, thr);
  const maxMin = data.length ? data[data.length - 1].min : 0;
  const ticks = useMemo(() => timeTicks(maxMin), [maxMin]);
  const fmtX = useMemo(() => clockTick(run.timebase.startClock), [run]);
  const ti = focusTank(run, topology);
  const tank = topology.water.tanks[ti];
  const tankData = useMemo(() => data.map((d) => ({ min: d.min, clock: d.clock, level: d.tanks[tank?.id ?? ''] ?? null })), [data, tank]);
  const tripMin = marks.pumpTripT != null ? marks.pumpTripT / 60 : null;
  const recMin = marks.pumpRecoveredT != null ? marks.pumpRecoveredT / 60 : marks.pressureRecoveredT != null ? marks.pressureRecoveredT / 60 : null;
  const belowMin = marks.pressureBelowT != null ? marks.pressureBelowT / 60 : null;
  const pMax = Math.max(thr * 1.5, ...data.map((d) => d.criticalPressureM));

  const markers = (withLabels: boolean) => (
    <>
      {tripMin != null && (
        <ReferenceLine x={tripMin} stroke="#F04438" strokeWidth={1.2} label={withLabels ? <MarkerLabel text="Pump trip" color="#c8281d" /> : undefined} />
      )}
      {recMin != null && (
        <ReferenceLine x={recMin} stroke="#17A769" strokeWidth={1.2} label={withLabels ? <MarkerLabel text="Recovered" color="#0f7f4f" row={1} /> : undefined} />
      )}
      <ReferenceLine x={playMin} stroke="#15283C" strokeWidth={1} strokeOpacity={0.7} />
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-[1.7]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 14, right: 10, bottom: 0, left: 0 }} syncId="water">
            <CartesianGrid vertical={false} {...GRID} />
            <XAxis dataKey="min" type="number" domain={[0, maxMin]} ticks={ticks} tick={false} axisLine={AXIS_LINE} tickLine={false} height={2} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} domain={[0, Math.ceil(pMax / 10) * 10]} tickCount={4} />
            {tripMin != null && belowMin != null && belowMin > tripMin && <ReferenceArea x1={tripMin} x2={belowMin} fill="#00BFEA" fillOpacity={0.08} ifOverflow="hidden" />}
            <ReferenceLine y={thr} stroke={SERIES.threshold} strokeDasharray="4 3" strokeWidth={1} strokeOpacity={0.7} />
            <Area dataKey="criticalPressureM" type="linear" stroke={SERIES.pressure} strokeWidth={2} fill={SERIES.pressure} fillOpacity={0.1} isAnimationActive={false} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
            {markers(true)}
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: '#5b6b7c', strokeWidth: 1 }}
              content={({ active, payload }) => {
                const p = active && payload?.[0]?.payload;
                if (!p) return null;
                return (
                  <TipBox
                    title={p.clock}
                    rows={[
                      { label: 'Critical pressure', value: `${fmtNum(p.criticalPressureM, 1)} m`, color: SERIES.pressure },
                      { label: 'Min pressure', value: `${fmtNum(p.minPressureM, 1)} m` },
                      { label: `Tank ${tank?.id ?? ''}`, value: `${fmtNum(p.tanks[tank?.id ?? ''], 0)}%`, color: SERIES.tank },
                      { label: 'Service threshold', value: `${fmtNum(thr, 0)} m` },
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
          <ComposedChart data={tankData} margin={{ top: 4, right: 10, bottom: 0, left: 0 }} syncId="water">
            <CartesianGrid vertical={false} {...GRID} />
            <XAxis dataKey="min" type="number" domain={[0, maxMin]} ticks={ticks} tickFormatter={fmtX} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} height={16} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v: number) => `${v}%`} />
            <Area dataKey="level" type="linear" stroke={SERIES.tank} strokeWidth={2} fill={SERIES.tank} fillOpacity={0.1} isAnimationActive={false} dot={false} activeDot={{ r: 3.5, strokeWidth: 2, stroke: '#fff' }} />
            {markers(false)}
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: '#5b6b7c', strokeWidth: 1 }}
              content={({ active, payload }) => {
                const p = active && payload?.[0]?.payload;
                if (!p) return null;
                return <TipBox title={p.clock} rows={[{ label: `Tank ${tank?.id ?? ''} level`, value: `${fmtNum(p.level, 0)}%`, color: SERIES.tank }]} />;
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

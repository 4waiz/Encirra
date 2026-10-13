import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Area } from 'recharts';
import type { Frame, NetworkTopology, RunResult, StrategyId } from '@encirra/shared';
import { useTwin } from '@/state/store';
import { useRunCtx } from '@/data/hooks';
import { feederServedKW, frameIndexAtT, runMarks, STRATEGY_LABEL, waterSeries } from '@/data/selectors';
import { fmtNum } from '@/data/format';
import { AXIS_LINE, AXIS_TICK, GRID, LegendKey, SERIES, STRATEGY_COLOR, TipBox, clockTick, timeTicks } from '@/charts/common';
import { ChartCard, PageFrame } from './PageFrame';

const PROFILE = { before: '#98A2AD', during: '#C97E0A', after: '#2A6CB5' } as const;
const PUMP_COLORS = ['#2A6CB5', '#C97E0A', '#0E9F8E', '#B5446E'];
const STRATS: StrategyId[] = ['none', 'grid-only', 'encirra'];

/** Representative frames: last pre-fault frame, the frame just before restoration (or isolation + 1 step), last frame. */
export function profileFrames(run: RunResult): { before: Frame; during: Frame; after: Frame } {
  const f = run.frames;
  const m = runMarks(run);
  const iFault = m.faultT != null ? frameIndexAtT(run, m.faultT) : 0;
  const before = f[Math.max(0, iFault - 1)];
  const iRest = m.restoredT != null ? frameIndexAtT(run, m.restoredT) : null;
  const iDuring = iRest != null ? Math.max(iFault, iRest - 1) : Math.min(f.length - 1, (m.isolatedT != null ? frameIndexAtT(run, m.isolatedT) : iFault) + 1);
  return { before, during: f[iDuring], after: f[f.length - 1] };
}

function useTimeAxis(run: RunResult) {
  const maxMin = run.frames.length ? run.frames[run.frames.length - 1].t / 60 : 0;
  return { maxMin, ticks: timeTicks(maxMin, 6), fmt: clockTick(run.timebase.startClock) };
}

function VoltageProfile({ run, topology }: { run: RunResult; topology: NetworkTopology }) {
  const fr = useMemo(() => profileFrames(run), [run]);
  const lim = topology.electrical.limits;
  const data = useMemo(
    () =>
      topology.electrical.buses.map((b, i) => ({
        bus: b.number,
        before: fr.before.power.busVmPu[i],
        during: fr.during.power.busVmPu[i],
        after: fr.after.power.busVmPu[i],
      })),
    [topology, fr],
  );
  const vals = data.flatMap((d) => [d.before, d.during, d.after]).filter((v): v is number => v != null);
  const lo = Math.min(lim.vMinPu - 0.01, ...vals);
  return (
    <ChartCard
      title="Voltage profile by bus"
      subtitle={`pu · before ${fr.before.clock}, during ${fr.during.clock}, after ${fr.after.clock} · gaps = de-energized`}
      legend={
        <LegendKey
          items={[
            { label: `Before (${fr.before.clock})`, color: PROFILE.before },
            { label: `During (${fr.during.clock})`, color: PROFILE.during },
            { label: `After (${fr.after.clock})`, color: PROFILE.after },
            { label: `Hard min ${lim.vMinPu}`, color: '#c8281d', dashed: true },
            { label: `Soft min ${lim.vSoftMinPu}`, color: '#E08A00', dashed: true },
          ]}
        />
      }
      table={{
        columns: ['Bus', 'Before (pu)', 'During (pu)', 'After (pu)'],
        rows: data.map((d) => [`B${d.bus}`, d.before == null ? '—' : fmtNum(d.before, 4), d.during == null ? '—' : fmtNum(d.during, 4), d.after == null ? '—' : fmtNum(d.after, 4)]),
      }}
      testId="chart-voltage"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} {...GRID} />
          <XAxis dataKey="bus" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval={3} tickFormatter={(v) => `B${v}`} height={18} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} domain={[Math.floor(lo * 100) / 100, 1.01]} tickFormatter={(v: number) => v.toFixed(2)} />
          <ReferenceLine y={lim.vMinPu} stroke="#c8281d" strokeDasharray="4 3" />
          <ReferenceLine y={lim.vSoftMinPu} stroke="#E08A00" strokeDasharray="4 3" />
          {(['before', 'during', 'after'] as const).map((k) => (
            <Line key={k} dataKey={k} stroke={PROFILE[k]} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: PROFILE[k] }} isAnimationActive={false} connectNulls={false} />
          ))}
          <Tooltip
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = active && payload?.[0]?.payload;
              if (!p) return null;
              const f = (v: number | null) => (v == null ? 'de-energized' : `${fmtNum(v, 4)} pu`);
              return (
                <TipBox
                  title={`Bus B${p.bus}`}
                  rows={[
                    { label: 'Before', value: f(p.before), color: PROFILE.before },
                    { label: 'During', value: f(p.during), color: PROFILE.during },
                    { label: 'After', value: f(p.after), color: PROFILE.after },
                  ]}
                />
              );
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function LineLoading({ topology, frame }: { topology: NetworkTopology; frame: Frame }) {
  const lim = topology.electrical.limits.loadingMaxPct;
  const data = topology.electrical.lines.map((l, i) => ({ name: `${l.from + 1}–${l.to + 1}`, id: l.id, tie: l.kind === 'tie', loading: frame.power.lineLoadingPct[i], state: frame.power.lineState[i] }));
  return (
    <ChartCard
      title="Line loading"
      subtitle={`% of synthetic thermal rating at ${frame.clock} · limit ${lim}% · empty = out of service`}
      table={{ columns: ['Line', 'Type', 'State', 'Loading %'], rows: data.map((d) => [d.name, d.tie ? 'tie' : 'feeder', d.state, d.loading == null ? '—' : fmtNum(d.loading, 1)]) }}
      testId="chart-loading"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} {...GRID} />
          <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 9 }} axisLine={AXIS_LINE} tickLine={false} interval={2} height={18} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={42} domain={[0, (max: number) => Math.max(lim * 1.1, Math.ceil(max / 10) * 10)]} tickFormatter={(v: number) => `${Math.round(v)}%`} />
          <ReferenceLine y={lim} stroke="#c8281d" strokeDasharray="4 3" />
          <Bar dataKey="loading" isAnimationActive={false} radius={[3, 3, 0, 0]} maxBarSize={14}>
            {data.map((d) => (
              <Cell key={d.id} fill={d.loading != null && d.loading > lim ? '#F04438' : d.tie ? '#0E9F8E' : '#2A6CB5'} />
            ))}
          </Bar>
          <Tooltip
            isAnimationActive={false}
            cursor={{ fill: 'rgba(42,108,181,0.06)' }}
            content={({ active, payload }) => {
              const p = active && payload?.[0]?.payload;
              if (!p) return null;
              return <TipBox title={`Line B${p.name}${p.tie ? ' (tie)' : ''}`} rows={[{ label: 'Loading', value: p.loading == null ? 'out of service' : `${fmtNum(p.loading, 1)}%` }, { label: 'State', value: p.state }]} />;
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function FeederLoads({ run, topology, frame }: { run: RunResult; topology: NetworkTopology; frame: Frame }) {
  const fr = profileFrames(run);
  const pre = feederServedKW(topology, fr.before);
  const now = feederServedKW(topology, frame);
  const data = topology.electrical.feeders.map((f) => ({ feeder: f.id, name: f.name, pre: pre[f.id], now: now[f.id] }));
  return (
    <ChartCard
      title="Feeder loads"
      subtitle={`Served kW per feeder · pre-fault (${fr.before.clock}) vs now (${frame.clock})`}
      legend={
        <LegendKey
          items={[
            { label: 'Pre-fault', color: PROFILE.before },
            { label: `Now (${frame.clock})`, color: PROFILE.after },
          ]}
        />
      }
      table={{ columns: ['Feeder', 'Pre-fault kW', 'Now kW'], rows: data.map((d) => [d.name, fmtNum(d.pre, 0), fmtNum(d.now, 0)]) }}
      testId="chart-feeders"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid vertical={false} {...GRID} />
          <XAxis dataKey="feeder" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} height={18} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => fmtNum(v, 0)} />
          <Bar dataKey="pre" fill={PROFILE.before} isAnimationActive={false} radius={[4, 4, 0, 0]} maxBarSize={24} />
          <Bar dataKey="now" fill={PROFILE.after} isAnimationActive={false} radius={[4, 4, 0, 0]} maxBarSize={24} />
          <Tooltip
            isAnimationActive={false}
            cursor={{ fill: 'rgba(42,108,181,0.06)' }}
            content={({ active, payload }) => {
              const p = active && payload?.[0]?.payload;
              if (!p) return null;
              return (
                <TipBox
                  title={p.name}
                  rows={[
                    { label: 'Pre-fault', value: `${fmtNum(p.pre, 0)} kW`, color: PROFILE.before },
                    { label: 'Now', value: `${fmtNum(p.now, 0)} kW`, color: PROFILE.after },
                  ]}
                />
              );
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Generic multi-series time chart (one y-axis). */
function TimeSeries({
  run,
  title,
  subtitle,
  unit,
  series,
  data,
  threshold,
  playMin,
  testId,
  domain,
  digits = 1,
}: {
  run: RunResult;
  title: string;
  subtitle: string;
  unit: string;
  series: { key: string; label: string; color: string; area?: boolean }[];
  data: Record<string, number | string | null>[];
  threshold?: { y: number; label: string };
  playMin: number;
  testId?: string;
  domain?: [number | 'auto', number | 'auto'];
  digits?: number;
}) {
  const ax = useTimeAxis(run);
  const step = Math.max(1, Math.round(data.length / 60));
  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      testId={testId}
      legend={<LegendKey items={[...series.map((s) => ({ label: s.label, color: s.color, area: s.area })), ...(threshold ? [{ label: threshold.label, color: '#c8281d', dashed: true }] : [])]} />}
      table={{
        columns: ['Time', ...series.map((s) => `${s.label} (${unit})`)],
        rows: data.filter((_, i) => i % step === 0).map((d) => [String(d.clock), ...series.map((s) => (typeof d[s.key] === 'number' ? fmtNum(d[s.key] as number, digits) : '—'))]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} {...GRID} />
          <XAxis dataKey="min" type="number" domain={[0, ax.maxMin]} ticks={ax.ticks} tickFormatter={ax.fmt} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} height={18} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} domain={domain ?? [0, 'auto']} tickFormatter={(v: number) => fmtNum(v, 0)} />
          {threshold && <ReferenceLine y={threshold.y} stroke="#c8281d" strokeDasharray="4 3" />}
          {series.map((s) =>
            s.area ? (
              <Area key={s.key} dataKey={s.key} type="linear" stroke={s.color} strokeWidth={2} fill={s.color} fillOpacity={0.1} dot={false} isAnimationActive={false} />
            ) : (
              <Line key={s.key} dataKey={s.key} type="linear" stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} />
            ),
          )}
          <ReferenceLine x={playMin} stroke="#15283C" strokeOpacity={0.6} />
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: '#5b6b7c', strokeWidth: 1 }}
            content={({ active, payload }) => {
              const p = active && payload?.[0]?.payload;
              if (!p) return null;
              return <TipBox title={String(p.clock)} rows={series.map((s) => ({ label: s.label, value: typeof p[s.key] === 'number' ? `${fmtNum(p[s.key], digits)} ${unit}` : '—', color: s.color }))} />;
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function AnalyticsPage() {
  const ctx = useRunCtx();
  const runs = useTwin((s) => s.runsByStrategy);
  const strategy = useTwin((s) => s.strategy);
  const data = useMemo(() => {
    if (!ctx) return null;
    const { run, topology } = ctx;
    const ws = waterSeries(run, topology);
    const pumps = topology.water.pumps;
    const pumpRows = run.frames.map((f) => {
      const row: Record<string, number | string | null> = { min: f.t / 60, clock: f.clock };
      pumps.forEach((p, i) => {
        row[`kw_${p.id}`] = f.water.pumpPowerKW[i];
        row[`q_${p.id}`] = f.water.pumpFlowLps[i];
      });
      return row;
    });
    const waterRows = ws.map((w) => ({ min: w.min, clock: w.clock, crit: w.criticalPressureM, minP: w.minPressureM, delivered: w.deliveredLps, required: w.requiredLps, ...Object.fromEntries(Object.entries(w.tanks).map(([k, v]) => [`tank_${k}`, v])) }));
    const n = run.frames.length;
    const cmpRows = Array.from({ length: n }, (_, i) => {
      const row: Record<string, number | string | null> = { min: run.frames[i].t / 60, clock: run.frames[i].clock };
      for (const s of STRATS) {
        const r = runs[s];
        row[`served_${s}`] = r?.frames[i]?.power.servedKW ?? null;
        row[`crit_${s}`] = r?.frames[i]?.water.criticalPressureM ?? null;
      }
      return row;
    });
    return { pumpRows, waterRows, cmpRows };
  }, [ctx?.run, ctx?.topology, runs]);

  if (!ctx || !data) return <PageFrame title="Analytics">Loading…</PageFrame>;
  const { run, topology, frame } = ctx;
  const playMin = frame.t / 60;
  const thr = topology.water.serviceThresholdM;
  const pumps = topology.water.pumps;
  return (
    <PageFrame
      title="Analytics"
      testId="analytics"
      subtitle={
        <>
          {STRATEGY_LABEL[strategy]} strategy · {run.summary.faultLabel} · cursor at {frame.clock} (simulated). Change the strategy or time in the Live Twin playback bar.
        </>
      }
    >
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr))]">
        <VoltageProfile run={run} topology={topology} />
        <LineLoading topology={topology} frame={frame} />
        <FeederLoads run={run} topology={topology} frame={frame} />
        <TimeSeries
          run={run}
          title="Pump electrical input"
          subtitle="kW per pump (P = ρ·g·Q·H / η)"
          unit="kW"
          data={data.pumpRows}
          playMin={playMin}
          series={pumps.map((p, i) => ({ key: `kw_${p.id}`, label: p.id, color: PUMP_COLORS[i % PUMP_COLORS.length] }))}
          testId="chart-pump-kw"
        />
        <TimeSeries
          run={run}
          title="Pump flow"
          subtitle="L/s per pump"
          unit="L/s"
          data={data.pumpRows}
          playMin={playMin}
          series={pumps.map((p, i) => ({ key: `q_${p.id}`, label: p.id, color: PUMP_COLORS[i % PUMP_COLORS.length] }))}
          testId="chart-pump-flow"
        />
        <TimeSeries
          run={run}
          title="Junction pressures"
          subtitle="Minimum over critical junctions and over all demand junctions (m of head)"
          unit="m"
          data={data.waterRows}
          playMin={playMin}
          threshold={{ y: thr, label: `${thr} m service threshold` }}
          series={[
            { key: 'crit', label: 'Critical (min)', color: SERIES.pressure, area: true },
            { key: 'minP', label: 'All junctions (min)', color: '#5b6b7c' },
          ]}
          testId="chart-pressure"
        />
        <TimeSeries
          run={run}
          title="Tank levels"
          subtitle="% of usable range"
          unit="%"
          domain={[0, 100]}
          digits={0}
          data={data.waterRows}
          playMin={playMin}
          series={topology.water.tanks.map((t, i) => ({ key: `tank_${t.id}`, label: t.id, color: PUMP_COLORS[i % PUMP_COLORS.length] }))}
          testId="chart-tanks"
        />
        <TimeSeries
          run={run}
          title="Delivered vs required water"
          subtitle="District total, L/s (pressure-driven demand)"
          unit="L/s"
          data={data.waterRows}
          playMin={playMin}
          series={[
            { key: 'delivered', label: 'Delivered', color: SERIES.pressure, area: true },
            { key: 'required', label: 'Required', color: '#7f93a8' },
          ]}
          testId="chart-water-balance"
        />
        <TimeSeries
          run={run}
          title="Strategy comparison · electrical load served"
          subtitle="kW served over time for each strategy (same scenario)"
          unit="kW"
          digits={0}
          data={data.cmpRows}
          playMin={playMin}
          series={STRATS.filter((s) => runs[s]).map((s) => ({ key: `served_${s}`, label: STRATEGY_LABEL[s], color: STRATEGY_COLOR[s] }))}
          testId="chart-cmp-served"
        />
        <TimeSeries
          run={run}
          title="Strategy comparison · critical pressure"
          subtitle="Minimum critical-junction pressure (m) for each strategy"
          unit="m"
          data={data.cmpRows}
          playMin={playMin}
          threshold={{ y: thr, label: `${thr} m` }}
          series={STRATS.filter((s) => runs[s]).map((s) => ({ key: `crit_${s}`, label: STRATEGY_LABEL[s], color: STRATEGY_COLOR[s] }))}
          testId="chart-cmp-pressure"
        />
      </div>
    </PageFrame>
  );
}

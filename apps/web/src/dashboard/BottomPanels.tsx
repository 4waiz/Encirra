import { useMemo } from 'react';
import { Building2, Droplet, Factory, Hospital, Siren, Store, Warehouse, Waves, Zap, Container, Snowflake } from 'lucide-react';
import clsx from 'clsx';
import type { FacilityKind } from '@encirra/shared';
import { useTwin } from '@/state/store';
import { useRunCtx, useSource } from '@/data/hooks';
import { POWER_LABEL, STATUS_LABEL, WATER_LABEL, facilityPressure, facilityRows, runMarks } from '@/data/selectors';
import { busName, fmtDuration, fmtInt, fmtNum, fmtPct, lpsToM3h } from '@/data/format';
import { Card, Dot, Metric, Segmented, SourceChip, POWER_TONE, STATUS_TONE, TONE_DOT, WATER_TONE } from '@/ui/primitives';
import { PowerChart, WaterCharts, focusTank } from '@/charts/TimeCharts';
import { LegendKey, SERIES } from '@/charts/common';
import { MAP_COLORS, MAP_LEGEND, OverviewMap } from '@/maps/OverviewMap';

const PANEL = '@container flex h-full flex-col p-[clamp(10px,0.8vw,15px)] pb-[clamp(9px,0.78vw,15px)] short:pb-[7px]';

function PanelHeader({ icon, title, right }: { icon: React.ReactNode; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <h3 className="t-title truncate">{title}</h3>
      </div>
      {right}
    </div>
  );
}

function StatLine({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx('flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 t-micro text-slate', className)}>{children}</div>;
}
const B = ({ children }: { children: React.ReactNode }) => <b className="font-semibold text-navy tabular">{children}</b>;

// ───────────────────────────────────────────────────────────── Power network
/** Chart legend: its own row on tall viewports, overlaid inside the plot on short ones. */
function ChartLegend({ items, extra }: { items: Parameters<typeof LegendKey>[0]['items']; extra?: React.ReactNode }) {
  return (
    <div className="mt-1 flex items-center justify-between gap-2 short:hidden">
      <LegendKey items={items} />
      {extra}
    </div>
  );
}
function OverlayLegend({ items, className }: { items: Parameters<typeof LegendKey>[0]['items']; className?: string }) {
  return (
    <div className={clsx('pointer-events-none absolute right-2.5 hidden rounded bg-white/85 px-1.5 py-[1px] short:block', className)}>
      <LegendKey items={items} />
    </div>
  );
}

export function PowerPanel() {
  const ctx = useRunCtx();
  const { dataSource } = useSource();
  if (!ctx) return <Card className="h-full" />;
  const { run, frame } = ctx;
  const p = frame.power;
  const limits = ctx.topology.electrical.limits;
  const playMin = frame.t / 60;
  const legend = [
    { label: 'Served', color: SERIES.served, area: true },
    { label: 'Demand', color: SERIES.demand },
  ];
  return (
    <Card className={PANEL} data-testid="power-panel">
      <PanelHeader icon={<Zap size={18} className="fill-power text-power" />} title="Power Network" right={<SourceChip source={dataSource} />} />
      <div className="mt-[clamp(4px,0.8vh,8px)] grid grid-cols-4 gap-2 short:[&_.t-label]:line-clamp-1">
        <Metric value={fmtInt(p.demandKW)} unit="kW" label="Total demand" short="Demand" bp="xs" />
        <Metric value={fmtInt(p.servedKW)} unit="kW" label="Served" testId="m-served" />
        <Metric value={fmtInt(p.restoredKW)} unit="kW" label="Restored" />
        <Metric value={fmtInt(p.unservedKW)} unit="kW" label="Unserved" />
      </div>
      <StatLine className="mt-[clamp(2px,0.5vh,6px)]">
        <span data-tip={`Lowest energized bus voltage (hard band ${limits.vMinPu}–${limits.vMaxPu} pu)`} data-tip-pos="top">
          V<sub>min</sub> <B>{p.vMinPu == null ? '—' : fmtNum(p.vMinPu, 3)}</B> pu @ <B>{busName(p.vMinBus)}</B>
        </span>
        <span data-tip={`Hard: buses outside ${limits.vMinPu}–${limits.vMaxPu} pu. Soft: energized buses below ${limits.vSoftMinPu} pu.`} data-tip-pos="top">
          Violations <B>{p.voltageViolations}</B> hard · <B>{p.voltageAdvisories}</B> soft
        </span>
        <span>
          Losses <B>{fmtInt(p.lossesKW)}</B> kW
        </span>
      </StatLine>
      <ChartLegend items={legend} extra={<span className="t-micro text-mist">kW</span>} />
      <div className="relative min-h-0 flex-1">
        <PowerChart run={run} playMin={playMin} />
        <OverlayLegend items={legend} className="bottom-[22px]" />
      </div>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────── Water network
export function WaterPanel() {
  const ctx = useRunCtx();
  const { dataSource } = useSource();
  if (!ctx) return <Card className="h-full" />;
  const { run, frame, topology } = ctx;
  const w = frame.water;
  const thr = topology.water.serviceThresholdM;
  const hospital = topology.facilities.find((f) => f.kind === 'hospital');
  const hospP = hospital ? facilityPressure(topology, frame, hospital.id) : null;
  const playMin = frame.t / 60;
  const ti = focusTank(run, topology);
  const delay = run.summary.hydraulicDelayMin;
  const marks = runMarks(run);
  const showDelay = delay != null && marks.pumpTripT != null && frame.t >= marks.pumpTripT;
  const legend = [
    { label: 'Critical pressure (m)', color: SERIES.pressure, area: true },
    { label: `${thr} m service`, color: SERIES.threshold, dashed: true },
    { label: `Tank ${topology.water.tanks[ti]?.id ?? ''} (%)`, color: SERIES.tank, area: true },
  ];
  return (
    <Card className={PANEL} data-testid="water-panel">
      <PanelHeader icon={<Droplet size={18} className="fill-water text-water" />} title="Water Network" right={<SourceChip source={dataSource} />} />
      <div className="mt-[clamp(4px,0.8vh,8px)] grid grid-cols-4 gap-2 short:[&_.t-label]:line-clamp-1">
        <Metric value={fmtInt(lpsToM3h(w.deliveredLps))} unit="m³/h" label="Delivered" />
        <Metric value={fmtNum(w.minPressureM, 1)} unit="m" label={`Min · ${w.minPressureNode}`} />
        <Metric value={fmtNum(hospP ?? w.criticalPressureM, 1)} unit="m" label={hospP != null ? 'Hospital' : 'Critical min'} testId="m-critical-pressure" />
        <Metric value={`${w.pumpsOnline}/${w.pumpsTotal}`} label="Pumps online" short="Pumps" bp="xs" />
      </div>
      <StatLine className="mt-[clamp(2px,0.5vh,6px)]">
        <span>
          <B>{fmtNum(w.deliveredLps, 1)}</B> L/s · <B>{fmtPct(w.deliveredPct, 0)}</B> of demand
        </span>
        <span>
          Tanks{' '}
          {topology.water.tanks.map((t, i) => (
            <span key={t.id} className="mr-1">
              {t.id} <B>{fmtPct(w.tankPct[i])}</B>
            </span>
          ))}
        </span>
        <span>
          Critical min <B>{fmtNum(w.criticalPressureM, 1)}</B> m
        </span>
        <span>
          <B>{fmtInt(w.connectionsInterrupted)}</B> connections interrupted
        </span>
        {showDelay && (
          <span
            className="rounded bg-water-soft px-1 font-semibold text-water-deep"
            data-tip="Pump trip → first critical node below the service threshold (summary.hydraulicDelayMin)"
            data-tip-pos="top"
          >
            Hydraulic delay {fmtDuration(delay)}
          </span>
        )}
      </StatLine>
      <ChartLegend items={legend} />
      <div className="relative min-h-0 flex-1">
        <WaterCharts run={run} topology={topology} playMin={playMin} />
      </div>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────── Critical facilities
const KIND_ICON: Record<FacilityKind, typeof Hospital> = {
  substation: Zap,
  hospital: Hospital,
  'emergency-ops': Siren,
  'pump-station': Factory,
  'water-tower': Container,
  'desalination-inlet': Waves,
  'cooling-plant': Snowflake,
  commercial: Store,
};
const KIND_COLOR: Partial<Record<FacilityKind, string>> = {
  hospital: 'text-fault',
  'pump-station': 'text-info',
  'water-tower': 'text-water-deep',
  'desalination-inlet': 'text-water-deep',
  substation: 'text-power-deep',
  'emergency-ops': 'text-info',
};

export function FacilitiesPanel() {
  const ctx = useRunCtx();
  const { dataSource } = useSource();
  const selected = useTwin((s) => s.selected);
  const setSelected = useTwin((s) => s.setSelected);
  const requestCamera = useTwin((s) => s.requestCamera);
  const rows = useMemo(() => (ctx ? facilityRows(ctx.topology, ctx.frame) : []), [ctx?.topology, ctx?.frame]);
  return (
    <Card className={PANEL} data-testid="facilities-panel">
      <PanelHeader icon={<Building2 size={18} className="text-info" />} title="Critical Facilities" right={<SourceChip source={dataSource} />} />
      <div className="enc-scroll mt-[clamp(4px,0.8vh,8px)] min-h-0 flex-1 overflow-y-auto rounded-md border border-line/70">
        <table className="w-full border-collapse text-left t-micro">
          <thead className="sticky top-0 z-[1] bg-[#f3f6f9]">
            <tr className="text-ink">
              <th className="w-full px-2 py-1.5 font-semibold">Facility</th>
              <th className="px-1.5 py-1.5 font-semibold whitespace-nowrap">Power</th>
              <th className="px-1.5 py-1.5 font-semibold whitespace-nowrap">Water</th>
              <th className="px-1.5 py-1.5 pr-2 font-semibold whitespace-nowrap">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const Icon = KIND_ICON[r.kind] ?? Warehouse;
              const isSel = selected?.kind === 'facility' && selected.id === r.id;
              return (
                <tr
                  key={r.id}
                  className={clsx('cursor-pointer border-t border-line/70 hover:bg-info-soft/50', isSel && 'bg-info-soft/70')}
                  onClick={() => {
                    setSelected({ kind: 'facility', id: r.id });
                    requestCamera({ focus: { kind: 'facility', id: r.id } });
                  }}
                  title={r.detail}
                  data-testid={`fac-row-${r.id}`}
                  data-status={r.status}
                >
                  <td className="max-w-0 px-2 py-[clamp(3px,0.45vh,6px)]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Icon size={14} className={clsx('shrink-0', KIND_COLOR[r.kind] ?? 'text-slate')} />
                      <span className={clsx('truncate', r.critical ? 'text-navy' : 'text-slate')}>{r.name}</span>
                    </span>
                  </td>
                  <td className="px-1.5">
                    <span className="flex items-center gap-1 whitespace-nowrap text-ink">
                      <Dot color={TONE_DOT[POWER_TONE[r.power]]} size={7} />
                      <span className="truncate">{POWER_LABEL[r.power]}</span>
                    </span>
                  </td>
                  <td className="px-1.5">
                    <span className="flex items-center gap-1 whitespace-nowrap text-ink">
                      {r.water === 'n/a' ? <span className="text-mist">—</span> : <Droplet size={11} style={{ color: TONE_DOT[WATER_TONE[r.water]], fill: TONE_DOT[WATER_TONE[r.water]] }} />}
                      {r.water !== 'n/a' && <span className="truncate">{WATER_LABEL[r.water]}</span>}
                    </span>
                  </td>
                  <td className="px-1.5 pr-2">
                    <StatusPill status={r.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function StatusPill({ status }: { status: keyof typeof STATUS_LABEL }) {
  const tone = STATUS_TONE[status];
  const cls = {
    ok: 'bg-ok-soft text-ok-deep',
    warn: 'bg-warn-soft text-warn',
    fault: 'bg-fault-soft text-fault',
    neutral: 'bg-wash text-slate',
    info: 'bg-info-soft text-info',
    progress: 'bg-info-soft text-info',
  }[tone];
  return (
    <span className={clsx('inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-[1px] font-semibold whitespace-nowrap', cls)}>
      <Dot color={TONE_DOT[tone]} size={6} />
      {STATUS_LABEL[status]}
    </span>
  );
}

// ───────────────────────────────────────────────────────────── City overview
export function CityOverviewPanel() {
  const ctx = useRunCtx();
  const mode = useTwin((s) => s.overviewMode);
  const setMode = useTwin((s) => s.setOverviewMode);
  const selected = useTwin((s) => s.selected);
  const setSelected = useTwin((s) => s.setSelected);
  const setHovered = useTwin((s) => s.setHovered);
  const requestCamera = useTwin((s) => s.requestCamera);
  return (
    <Card className={PANEL} data-testid="overview-panel">
      <PanelHeader
        icon={<Building2 size={18} className="text-navy" />}
        title="City Overview"
        right={
          <Segmented
            size="xs"
            value={mode}
            onChange={setMode}
            testId="overview-tabs"
            options={[
              { value: 'power', label: 'Power' },
              { value: 'water', label: 'Water' },
              { value: 'combined', label: 'Combined' },
            ]}
          />
        }
      />
      <div className="relative mt-[clamp(4px,0.8vh,8px)] min-h-0 flex-1 overflow-hidden rounded-md bg-[#dfe6ed]">
        {ctx && (
          <OverviewMap
            topology={ctx.topology}
            frames={ctx.run.frames}
            k={ctx.k}
            mode={mode}
            selected={selected}
            onPick={(sel) => {
              setSelected(sel);
              requestCamera({ focus: sel });
            }}
            onHover={setHovered}
          />
        )}
        {ctx && <OverviewChips mode={mode} />}
        <ul className="pointer-events-none absolute bottom-1.5 left-1.5 flex flex-wrap gap-x-2 gap-y-0.5 rounded bg-white/80 px-1.5 py-1">
          {MAP_LEGEND[mode].map((l) => (
            <li key={l.cls} className="flex items-center gap-1 text-[9.5px] text-ink">
              <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: MAP_COLORS[mode][l.cls] }} />
              {l.label}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function OverviewChips({ mode }: { mode: 'power' | 'water' | 'combined' }) {
  const ctx = useRunCtx();
  if (!ctx) return null;
  const { frame, run } = ctx;
  const chips: { value: string; label: string; tone?: 'ok' | 'fault' }[] = [];
  if (mode === 'power') {
    chips.push({ value: `${fmtInt(frame.power.restoredKW)} kW`, label: 'Restored', tone: frame.power.restoredKW > 0 ? 'ok' : undefined });
    chips.push({ value: `${fmtInt(frame.power.unservedKW)} kW`, label: 'Unserved', tone: frame.power.unservedKW > 0.5 ? 'fault' : undefined });
  } else if (mode === 'water') {
    chips.push({ value: fmtPct(frame.water.deliveredPct, 1), label: 'Demand delivered' });
    chips.push({ value: fmtInt(frame.water.nodesBelowService), label: `Nodes < ${ctx.topology.water.serviceThresholdM} m`, tone: frame.water.nodesBelowService > 0 ? 'fault' : undefined });
  } else {
    const safe = frame.facilities.filter((f) => f.status === 'safe' || f.status === 'restored').length;
    chips.push({ value: `${safe}/${frame.facilities.length}`, label: 'Facilities safe' });
    if (run.summary.faultClock && frame.stage !== 'ready') chips.push({ value: run.summary.faultClock, label: 'Fault' , tone: 'fault' });
  }
  return (
    <div className="pointer-events-none absolute top-1.5 right-1.5 flex flex-col items-end gap-1">
      {chips.map((c) => (
        <div key={c.label} className="rounded-md bg-white/90 px-1.5 py-[3px] text-right shadow-sm">
          <div className={clsx('text-[12px] leading-none font-semibold tabular', c.tone === 'ok' ? 'text-ok-deep' : c.tone === 'fault' ? 'text-fault' : 'text-navy')}>{c.value}</div>
          <div className="mt-[2px] text-[9.5px] leading-none text-slate">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

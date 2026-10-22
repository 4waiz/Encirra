/**
 * Right rail — live telemetry at the playhead: power, water (the cascade), critical facilities and
 * the district mini-map. Each module leads with one or two large numbers; secondary values sit
 * behind a details disclosure.
 */
import { useEffect, useMemo, useState } from 'react';
import { Building2, ChevronDown, Container, Droplet, Factory, Hospital, Map as MapIcon, Siren, Snowflake, Store, Warehouse, Waves, Zap } from 'lucide-react';
import clsx from 'clsx';
import type { FacilityKind, FacilityStatus } from '@encirra/shared';
import { useTwin, type OverviewMode } from '@/state/store';
import { useRunCtx } from '@/data/hooks';
import { POWER_LABEL, STATUS_LABEL, WATER_LABEL, facilityPressure, facilityRows, focusTank, runMarks } from '@/data/selectors';
import { busName, fmtDuration, fmtInt, fmtNum, fmtPct, lpsToM3h } from '@/data/format';
import { Segmented, POWER_TONE, STATUS_TONE, TONE_DOT, WATER_TONE } from '@/ui/primitives';
import { DARK, PowerSpark, WaterSpark } from '@/charts/RailCharts';
import { MAP_COLORS, MAP_LEGEND, OverviewMap } from '@/maps/OverviewMap';
import { FeederMap } from '@/maps/FeederMap';
import { AnimatedNumber, DetailsButton, DetailsGrid, KV, Module, ModuleHeader, SeriesKey, Stat, Unit } from './kit';

const int = (v: number) => fmtInt(v);
const one = (v: number) => fmtNum(v, 1);

// ───────────────────────────────────────────────────────────── power
export function PowerModule() {
  const ctx = useRunCtx();
  const [open, setOpen] = useState(false);
  if (!ctx) return <Module side="right" index={0} className="h-[220px]" data-testid="power-panel" />;
  const { run, frame, topology } = ctx;
  const p = frame.power;
  const limits = topology.electrical.limits;
  return (
    <Module side="right" index={0} data-testid="power-panel">
      <ModuleHeader icon={<Zap size={15} className="fill-power text-power" />} title="Power"
        right={
          <span className="flex min-w-0 items-center gap-2">
            <SeriesKey items={[{ label: 'Served', color: DARK.power }, { label: 'Demand', color: DARK.demand, dashed: true }]} />
            <DetailsButton open={open} onToggle={() => setOpen((v) => !v)} testId="power-details-btn" />
          </span>
        }
      />
      <div className="mt-2 grid grid-cols-[1.3fr_1fr_1fr] items-end gap-x-3">
        <Stat label="Served" size="xl" testId="m-served" subWide sub={`of ${fmtInt(p.demandKW)} kW demand`}>
          <AnimatedNumber value={p.servedKW} format={int} />
          <Unit>kW</Unit>
        </Stat>
        <Stat label="Restored" tone={p.restoredKW > 0 ? 'ok' : undefined} subWide sub="via the plan">
          <AnimatedNumber value={p.restoredKW} format={int} />
          <Unit>kW</Unit>
        </Stat>
        <Stat label="Unserved" tone={p.unservedKW > 0.5 ? 'fault' : undefined} subWide sub={p.demandKW > 0 ? `${fmtPct((100 * p.unservedKW) / p.demandKW, 1)} of demand` : undefined}>
          <AnimatedNumber value={p.unservedKW} format={int} />
          <Unit>kW</Unit>
        </Stat>
      </div>
      <div className="mt-1 h-[clamp(88px,9.5vh,120px)] short:h-[80px]">
        <PowerSpark run={run} playMin={frame.t / 60} />
      </div>
      {open && (
        <DetailsGrid testId="power-details">
          <KV k="Lowest voltage" tip={`Lowest energized bus voltage (hard band ${limits.vMinPu}–${limits.vMaxPu} pu)`}>
            {p.vMinPu == null ? '—' : `${fmtNum(p.vMinPu, 3)} pu @ ${busName(p.vMinBus)}`}
          </KV>
          <KV k="Losses">{fmtInt(p.lossesKW)} kW</KV>
          <KV k="Hard violations" tip={`Buses outside ${limits.vMinPu}–${limits.vMaxPu} pu`}>
            {p.voltageViolations}
          </KV>
          <KV k="Soft advisories" tip={`Energized buses below ${limits.vSoftMinPu} pu`}>
            {p.voltageAdvisories}
          </KV>
          <KV k="Thermal violations">{p.thermalViolations}</KV>
          <KV k="Pump load">{fmtInt(p.pumpKW)} kW</KV>
        </DetailsGrid>
      )}
    </Module>
  );
}

// ───────────────────────────────────────────────────────────── water
export function WaterModule() {
  const ctx = useRunCtx();
  const [open, setOpen] = useState(false);
  if (!ctx) return <Module side="right" index={1} className="h-[260px]" data-testid="water-panel" />;
  const { run, frame, topology } = ctx;
  const w = frame.water;
  const thr = topology.water.serviceThresholdM;
  const hospital = topology.facilities.find((f) => f.kind === 'hospital');
  const hospP = hospital ? facilityPressure(topology, frame, hospital.id) : null;
  const pressure = hospP ?? w.criticalPressureM;
  const ti = focusTank(run, topology);
  const tank = topology.water.tanks[ti];
  const marks = runMarks(run, thr);
  const delay = run.summary.hydraulicDelayMin;
  const showDelay = delay != null && marks.pumpTripT != null && frame.t >= marks.pumpTripT;
  return (
    <Module side="right" index={1} data-testid="water-panel">
      <ModuleHeader icon={<Droplet size={15} className="fill-water text-water" />} title="Water"
        right={
          <span className="flex min-w-0 items-center gap-2">
            <SeriesKey
              items={[
                { label: 'Pressure', color: DARK.pressure },
                { label: `Tank ${tank?.id ?? ''} %`, color: DARK.tank },
                { label: `${thr} m`, color: DARK.fault, dashed: true, wide: true },
              ]}
            />
            <DetailsButton open={open} onToggle={() => setOpen((v) => !v)} testId="water-details-btn" />
          </span>
        }
      />
      <div className="mt-2 grid grid-cols-[1.3fr_1fr_1fr] items-end gap-x-3">
        <Stat
          label={
            <>
              <span className="compact:hidden">{hospP != null ? 'Hospital pressure' : 'Critical pressure'}</span>
              <span className="hidden compact:inline">{hospP != null ? 'Hospital' : 'Critical'}</span>
            </>
          }
          subWide
          size="xl"
          testId="m-critical-pressure"
          tone={pressure < thr ? 'fault' : undefined}
          sub={pressure < thr ? `below ${thr} m service` : `service level ${thr} m`}
        >
          <AnimatedNumber value={pressure} format={one} />
          <Unit>m</Unit>
        </Stat>
        <Stat label="Pumps on" subWide tone={w.pumpsOnline < w.pumpsTotal ? 'fault' : undefined} testId="m-pumps" sub={w.pumpsOnline < w.pumpsTotal ? `${w.pumpsTotal - w.pumpsOnline} stopped` : 'all running'}>
          {w.pumpsOnline}
          <Unit>/ {w.pumpsTotal}</Unit>
        </Stat>
        <Stat label={tank ? `Tank ${tank.id}` : 'Tank'} subWide tone={tank && w.tankPct[ti] < 25 ? 'warn' : undefined} sub={`${tank?.zone ?? ''} zone storage`}>
          <AnimatedNumber value={w.tankPct[ti]} format={int} />
          <Unit>%</Unit>
        </Stat>
      </div>
      <div className="mt-1 h-[clamp(120px,13vh,160px)] short:h-[112px]">
        <WaterSpark run={run} topology={topology} playMin={frame.t / 60} />
      </div>
      {open && (
        <DetailsGrid testId="water-details">
          <KV k="Delivered">{fmtInt(lpsToM3h(w.deliveredLps))} m³/h</KV>
          <KV k="Of demand">{fmtPct(w.deliveredPct, 1)}</KV>
          <KV k={`Min · ${w.minPressureNode}`}>{fmtNum(w.minPressureM, 1)} m</KV>
          <KV k="Critical min">{fmtNum(w.criticalPressureM, 1)} m</KV>
          {topology.water.tanks.map((t, i) => (
            <KV key={t.id} k={t.label}>
              {fmtPct(w.tankPct[i])}
            </KV>
          ))}
          <KV k="Connections out">{fmtInt(w.connectionsInterrupted)}</KV>
          <KV k="Nodes below service">{fmtInt(w.nodesBelowService)}</KV>
          {showDelay && (
            <KV k="Hydraulic delay" tip="Pump trip → first critical node below the service threshold (summary.hydraulicDelayMin)">
              {fmtDuration(delay)}
            </KV>
          )}
        </DetailsGrid>
      )}
    </Module>
  );
}

// ───────────────────────────────────────────────────────────── critical facilities
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

export function StatusPill({ status }: { status: FacilityStatus }) {
  const tone = STATUS_TONE[status];
  const cls = {
    ok: 'bg-ok-soft text-ok-deep',
    warn: 'bg-warn-soft text-warn',
    fault: 'bg-fault-soft text-fault-deep',
    neutral: 'bg-wash text-slate',
    info: 'bg-info-soft text-info',
    progress: 'bg-info-soft text-info',
  }[tone];
  return <span className={clsx('inline-flex w-[64px] items-center justify-center rounded-full py-[2px] text-[11px] compact:w-[56px] font-semibold whitespace-nowrap', cls)}>{STATUS_LABEL[status]}</span>;
}

export function FacilitiesModule() {
  const ctx = useRunCtx();
  const selected = useTwin((s) => s.selected);
  const setSelected = useTwin((s) => s.setSelected);
  const requestCamera = useTwin((s) => s.requestCamera);
  const [all, setAll] = useState(false);
  const rows = useMemo(() => (ctx ? facilityRows(ctx.topology, ctx.frame) : []), [ctx?.topology, ctx?.frame]);
  const critical = rows.filter((r) => r.critical);
  const shown = all ? rows : critical;
  const hidden = rows.length - critical.length;
  const notSafe = critical.filter((r) => r.status !== 'safe' && r.status !== 'restored').length;
  return (
    <Module side="right" index={2} data-testid="facilities-panel" className="!px-0 !pb-0">
      <div className="px-4">
        <ModuleHeader
          icon={<Building2 size={15} className="text-info" />}
          title="Critical facilities"
          className="pb-2"
          right={
            <span className={clsx('text-[11.5px] font-semibold tabular', notSafe ? 'text-warn' : 'text-ok-deep')}>
              {notSafe ? `${notSafe} of ${critical.length} not safe` : `All ${critical.length} safe`}
            </span>
          }
        />
      </div>
      <ul className="rail-scroll fade-bottom max-h-[clamp(118px,11.5vh,170px)] pb-2 short:max-h-[120px]" data-testid="facilities-list">
        {shown.map((r) => {
          const Icon = KIND_ICON[r.kind] ?? Warehouse;
          const isSel = selected?.kind === 'facility' && selected.id === r.id;
          return (
            <li key={r.id}>
              <button
                type="button"
                className={clsx(
                  'grid w-full grid-cols-[minmax(0,1fr)_14px_14px_64px] items-center gap-x-2 compact:grid-cols-[minmax(0,1fr)_12px_12px_56px] compact:gap-x-1.5 border-t border-line px-4 py-[4px] text-left transition-colors hover:bg-white/[0.05]',
                  isSel && 'bg-info-soft',
                )}
                onClick={() => {
                  setSelected({ kind: 'facility', id: r.id });
                  requestCamera({ focus: { kind: 'facility', id: r.id } });
                }}
                title={r.detail}
                data-testid={`fac-row-${r.id}`}
                data-status={r.status}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon size={13} className="shrink-0 text-slate" />
                  <span className={clsx('truncate text-[12.5px]', r.critical ? 'text-navy' : 'text-slate')}>{r.name}</span>
                </span>
                <span className="flex justify-center" data-tip={`Power · ${POWER_LABEL[r.power]}`} data-tip-pos="left">
                  <span className="h-2 w-2 rounded-full" style={{ background: TONE_DOT[POWER_TONE[r.power]] }} />
                </span>
                <span className="flex justify-center" data-tip={r.water === 'n/a' ? 'No water service modelled' : `Water · ${WATER_LABEL[r.water]}`} data-tip-pos="left">
                  {r.water === 'n/a' ? <span className="h-[2px] w-2 rounded bg-mist/60" /> : <span className="h-2 w-2 rounded-full" style={{ background: TONE_DOT[WATER_TONE[r.water]] }} />}
                </span>
                <StatusPill status={r.status} />
              </button>
            </li>
          );
        })}
        {hidden > 0 && (
          <li className="border-t border-line px-4 pt-1.5">
            <button type="button" onClick={() => setAll((v) => !v)} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-slate hover:text-navy" data-testid="facilities-toggle">
              <ChevronDown size={13} className={clsx('transition-transform', all && 'rotate-180')} />
              {all ? 'Critical only' : `Show ${hidden} non-critical`}
            </button>
          </li>
        )}
      </ul>
    </Module>
  );
}

// ───────────────────────────────────────────────────────────── city overview (+ feeder topology)
const FEEDER_LEGEND: { label: string; color: string; dashed?: boolean }[] = [
  { label: 'Healthy', color: '#17A769' },
  { label: 'Faulted', color: '#F04438' },
  { label: 'Restoring', color: '#F5A623' },
  { label: 'Isolated', color: '#98A2AD' },
  { label: 'Open tie', color: '#B8C2CC', dashed: true },
];

type Tab = OverviewMode | 'feeder';

export function OverviewModule() {
  const ctx = useRunCtx();
  const mode = useTwin((s) => s.overviewMode);
  const setMode = useTwin((s) => s.setOverviewMode);
  const selected = useTwin((s) => s.selected);
  const setSelected = useTwin((s) => s.setSelected);
  const setHovered = useTwin((s) => s.setHovered);
  const requestCamera = useTwin((s) => s.requestCamera);
  const [feeder, setFeeder] = useState(false);
  // a scripted change of the overview mode (demo) leaves the feeder tab
  useEffect(() => setFeeder(false), [mode]);
  const tab: Tab = feeder ? 'feeder' : mode;
  const marks = ctx ? runMarks(ctx.run) : null;
  return (
    <Module side="right" index={3} data-testid="overview-panel">
      <ModuleHeader
        icon={<MapIcon size={15} className="text-slate" />}
        title="District"
        right={
          <Segmented<Tab>
            size="xs"
            value={tab}
            testId="overview-tabs"
            onChange={(v) => {
              if (v === 'feeder') setFeeder(true);
              else {
                setFeeder(false);
                setMode(v);
              }
            }}
            options={[
              { value: 'power', label: 'Power' },
              { value: 'water', label: 'Water' },
              { value: 'combined', label: 'Both' },
              { value: 'feeder', label: 'Feeder' },
            ]}
          />
        }
      />
      <div className="mt-2.5 flex h-[clamp(116px,12.8vh,180px)] gap-3 short:h-[118px]">
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-[10px] bg-[#101d2f] ring-1 ring-white/5" data-testid={tab === 'feeder' ? 'feeder-card' : 'overview-map'}>
        {ctx && tab === 'feeder' && marks && (
          <FeederMap topology={ctx.topology} frame={ctx.frame} faultActive={marks.faultT != null && ctx.frame.t >= marks.faultT} faultLineId={ctx.run.summary.faultLineId} theme="dark" />
        )}
        {ctx && tab !== 'feeder' && (
          <OverviewMap
            topology={ctx.topology}
            frames={ctx.run.frames}
            k={ctx.k}
            mode={tab}
            selected={selected}
            onPick={(sel) => {
              setSelected(sel);
              requestCamera({ focus: sel });
            }}
            onHover={setHovered}
            theme="dark"
          />
        )}
      </div>
      <ul className="flex w-[104px] shrink-0 flex-col justify-center gap-1.5 compact:w-[92px]" data-testid="overview-legend">
        {(tab === 'feeder'
          ? FEEDER_LEGEND.map((l) => ({ key: l.label, label: l.label, color: l.color, dashed: l.dashed }))
          : MAP_LEGEND[tab].map((l) => ({ key: l.cls, label: l.label, color: MAP_COLORS[tab][l.cls], dashed: false }))
        ).map((l) => (
          <li key={l.key} className="flex items-center gap-2 text-[11.5px] text-ink">
            {l.dashed ? (
              <svg width="12" height="6" aria-hidden>
                <line x1="0" y1="3" x2="12" y2="3" stroke={l.color} strokeWidth="1.6" strokeDasharray="3 2" />
              </svg>
            ) : (
              <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: l.color }} />
            )}
            {l.label}
          </li>
        ))}
      </ul>
      </div>
    </Module>
  );
}

export function RightRail() {
  return (
    <>
      <PowerModule />
      <WaterModule />
      <FacilitiesModule />
      <OverviewModule />
    </>
  );
}

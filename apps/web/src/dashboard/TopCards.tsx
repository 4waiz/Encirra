import { useMemo } from 'react';
import { Check, CircleAlert, CircleCheck, CircleDashed, HelpCircle, Loader, Minus, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import clsx from 'clsx';
import { useTwin } from '@/state/store';
import { useRunCtx, useSource } from '@/data/hooks';
import { faultCardModel, recoveryCardModel, runMarks, timelineStatus, connectionsWithoutSupply, type StepStatus, type Tone } from '@/data/selectors';
import { fmtInt, fmtNum, fmtPct } from '@/data/format';
import { Card, Metric, SourceChip, TONE_TEXT } from '@/ui/primitives';
import { FeederMap } from '@/maps/FeederMap';

function IconBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const bg: Record<Tone, string> = {
    neutral: 'bg-[#e9eef3] text-slate',
    info: 'bg-info text-white',
    progress: 'bg-info text-white',
    ok: 'bg-ok text-white',
    warn: 'bg-warn text-white',
    fault: 'bg-fault text-white',
  };
  return (
    <div
      className={clsx(
        'flex h-[clamp(32px,2.4vw,42px)] w-[clamp(32px,2.4vw,42px)] shrink-0 items-center justify-center rounded-full shadow-[0_0_0_4px_rgba(255,255,255,0.8)]',
        bg[tone],
        tone === 'fault' && 'shadow-[0_0_0_4px_rgba(240,68,56,0.16)]',
      )}
    >
      {children}
    </div>
  );
}

function MetricRow({ children }: { children: React.ReactNode }) {
  return <div className="mt-auto grid grid-cols-4 gap-0 divide-x divide-line border-t border-line pt-[clamp(6px,0.9vh,10px)] [&>*]:px-[clamp(6px,0.6vw,12px)] [&>*:first-child]:pl-0">{children}</div>;
}

// ───────────────────────────────────────────────────────────── 1. Feeder fault
export function FaultCard() {
  const ctx = useRunCtx();
  const model = useMemo(() => (ctx ? faultCardModel(ctx.run, ctx.topology, ctx.frame) : null), [ctx?.run, ctx?.topology, ctx?.frame]);
  if (!ctx || !model) return <Card className="h-full" />;
  const { frame, topology } = ctx;
  const active = model.active;
  const pumpsOff = frame.water.pumpsTotal - frame.water.pumpsOnline;
  const notSafe = frame.facilities.filter((f) => f.status !== 'safe' && topology.facilities.find((x) => x.id === f.id)?.critical).length;
  return (
    <Card className="flex h-full flex-col p-[clamp(10px,0.8vw,15px)]" data-testid="fault-card" data-state={active ? 'fault' : 'normal'}>
      <div className="flex min-w-0 gap-[clamp(8px,0.7vw,12px)]">
        <IconBadge tone={active ? 'fault' : 'neutral'}>{active ? <TriangleAlert size={20} strokeWidth={2.4} /> : <ShieldCheck size={19} />}</IconBadge>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className={clsx('t-title truncate', active ? 'text-fault' : 'text-navy')}>{active ? 'Feeder Fault Detected' : 'No active fault'}</h3>
            {active && <span className="t-label shrink-0 tabular">{model.clock}</span>}
          </div>
          {active ? (
            <>
              <div className="t-body truncate font-semibold text-navy" data-testid="fault-label">
                {model.faultLabel}
              </div>
              <div className="t-label truncate" title={model.impactText}>
                {model.impactText}
              </div>
            </>
          ) : (
            <>
              <div className="t-body truncate font-medium text-ink">All modelled feeders supplied</div>
              <div className="t-label truncate">
                {fmtInt(frame.power.servedKW)} kW served · {frame.water.pumpsOnline}/{frame.water.pumpsTotal} pumps online · {fmtPct(frame.water.deliveredPct)} water demand met
              </div>
            </>
          )}
        </div>
      </div>
      <MetricRow>
        {active ? (
          <>
            <Metric value={fmtInt(model.metrics.loadInterruptedKW)} unit="kW" label="Load interrupted" testId="m-load-interrupted" />
            <Metric value={fmtInt(model.metrics.connectionsAffected)} label="Service connections affected" />
            <Metric value={fmtInt(model.metrics.pumpsOffline)} label={model.metrics.pumpsOffline === 1 ? 'Water pump offline' : 'Water pumps offline'} />
            <Metric value={fmtInt(model.metrics.criticalAtRisk)} label="Critical facilities at risk" />
          </>
        ) : (
          <>
            <Metric dim value={fmtInt(frame.power.unservedKW)} unit="kW" label="Load interrupted" testId="m-load-interrupted" />
            <Metric dim value={fmtInt(connectionsWithoutSupply(topology, frame))} label="Service connections affected" />
            <Metric dim value={fmtInt(pumpsOff)} label="Water pumps offline" />
            <Metric dim value={fmtInt(notSafe)} label="Critical facilities at risk" />
          </>
        )}
      </MetricRow>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────── 2. Feeder status mini-map
const LEGEND: { label: string; color: string; dashed?: boolean }[] = [
  { label: 'Healthy', color: '#17A769' },
  { label: 'Faulted', color: '#F04438' },
  { label: 'Restoring', color: '#F5A623' },
  { label: 'Isolated', color: '#98A2AD' },
  { label: 'Open tie', color: '#B8C2CC', dashed: true },
];

export function FeederStatusCard() {
  const ctx = useRunCtx();
  const marks = ctx ? runMarks(ctx.run) : null;
  return (
    <Card className="h-full overflow-hidden bg-[rgba(233,238,243,0.92)]" data-testid="feeder-card">
      {ctx && marks && (
        <div className="absolute inset-0">
          <FeederMap
            topology={ctx.topology}
            frame={ctx.frame}
            faultActive={marks.faultT != null && ctx.frame.t >= marks.faultT}
            faultLineId={ctx.run.summary.faultLineId}
          />
        </div>
      )}
      <div className="pointer-events-none absolute top-0 left-0 rounded-br-[10px] bg-gradient-to-br from-white/90 via-white/70 to-transparent px-[clamp(10px,0.8vw,14px)] pt-[clamp(8px,0.7vw,12px)] pb-3 pr-6">
        <h3 className="t-title">Feeder Status</h3>
      </div>
      <ul className="absolute right-[clamp(8px,0.6vw,12px)] bottom-[clamp(8px,0.7vw,12px)] space-y-[3px] rounded-md bg-white/75 px-2 py-1.5">
        {LEGEND.map((l) => (
          <li key={l.label} className="flex items-center gap-1.5 t-micro text-ink">
            {l.dashed ? (
              <svg width="12" height="6" aria-hidden>
                <line x1="0" y1="3" x2="12" y2="3" stroke={l.color} strokeWidth="1.6" strokeDasharray="3 2" />
              </svg>
            ) : (
              <span className="inline-block h-[8px] w-[8px] rounded-full" style={{ background: l.color }} />
            )}
            {l.label}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────── 3. System recovery
export function RecoveryCard() {
  const ctx = useRunCtx();
  const setWhy = useTwin((s) => s.setWhyPlanOpen);
  const model = useMemo(() => (ctx ? recoveryCardModel(ctx.run, ctx.topology, ctx.k) : null), [ctx?.run, ctx?.topology, ctx?.k]);
  if (!ctx || !model) return <Card className="h-full" />;
  const m = model.metrics;
  const icon =
    model.tone === 'ok' ? (
      <CircleCheck size={22} strokeWidth={2.3} />
    ) : model.tone === 'fault' ? (
      <X size={20} strokeWidth={2.6} />
    ) : model.tone === 'warn' ? (
      <CircleAlert size={21} strokeWidth={2.3} />
    ) : model.tone === 'progress' ? (
      <Loader size={19} strokeWidth={2.4} className="animate-[spin_2.4s_linear_infinite]" />
    ) : model.tone === 'info' ? (
      model.verified ? <Check size={20} strokeWidth={2.8} /> : <CircleDashed size={19} strokeWidth={2.4} />
    ) : (
      <Minus size={19} strokeWidth={2.4} />
    );
  const showPct = ctx.frame.stage !== 'ready';
  return (
    <Card className="flex h-full flex-col p-[clamp(10px,0.8vw,15px)]" data-testid="recovery-card" data-tone={model.tone}>
      <div className="flex min-w-0 gap-[clamp(8px,0.7vw,12px)]">
        <IconBadge tone={model.tone}>{icon}</IconBadge>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className={clsx('t-title truncate', TONE_TEXT[model.tone])} data-testid="recovery-title">
              {model.title}
            </h3>
            <div className="flex shrink-0 items-center gap-2">
              {model.clock && <span className="t-label tabular">{model.clock}</span>}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="t-body min-w-0 truncate text-slate" title={model.subtitle} data-testid="recovery-subtitle">
              {model.subtitle}
            </div>
            <button
              type="button"
              onClick={() => setWhy(true)}
              disabled={!model.planVisible && ctx.run.candidates.length === 0}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-info/25 bg-info-soft px-2 py-[2px] t-micro font-semibold text-info hover:bg-info hover:text-white disabled:opacity-40"
              data-testid="why-plan-btn"
            >
              <HelpCircle size={12} />
              Why this plan?
            </button>
          </div>
        </div>
      </div>
      <MetricRow>
        <Metric
          value={fmtInt(m.restoredKW)}
          unit="kW"
          label="Load restored"
          sub={showPct ? `${fmtPct(m.restoredPct)} of interrupted` : undefined}
          subTone={m.restoredPct != null && m.restoredPct >= 99.5 ? 'ok' : m.restoredKW > 0 ? 'progress' : 'neutral'}
          testId="m-load-restored"
        />
        <Metric
          value={m.criticalAffected > 0 ? `${m.criticalRecovered} / ${m.criticalAffected}` : '—'}
          label="Critical infrastructure recovered"
          sub={showPct && m.criticalAffected > 0 ? fmtPct((100 * m.criticalRecovered) / m.criticalAffected) : undefined}
          subTone={m.criticalAffected > 0 && m.criticalRecovered === m.criticalAffected ? 'ok' : 'warn'}
        />
        <Metric
          value={`${m.pumpsOnline} / ${m.pumpsTotal}`}
          label="Water pumping availability"
          sub={showPct ? fmtPct((100 * m.pumpsOnline) / Math.max(1, m.pumpsTotal)) : undefined}
          subTone={m.pumpsOnline === m.pumpsTotal ? 'ok' : 'fault'}
        />
        <Metric
          value={fmtNum(m.unservedKW, 0)}
          unit="kW"
          label="Remaining unserved demand"
          sub={showPct ? `${fmtPct(m.unservedPct, 1)} of demand` : undefined}
          subTone={m.unservedKW < 0.5 ? 'ok' : 'fault'}
        />
      </MetricRow>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────── 4. Recovery timeline
const STEP_STYLE: Record<StepStatus, string> = {
  done: 'bg-ok text-white border-ok',
  partial: 'bg-warn text-white border-warn',
  failed: 'bg-fault text-white border-fault',
  skipped: 'bg-white text-mist border-line-strong',
  active: 'bg-white text-info border-info enc-pulse',
  pending: 'bg-white text-mist border-line-strong',
};

export function TimelineCard() {
  const ctx = useRunCtx();
  const { dataSource, devFixture } = useSource();
  const items = useMemo(() => (ctx ? timelineStatus(ctx.run.timeline, ctx.frame.t) : []), [ctx?.run, ctx?.frame]);
  return (
    <Card className="flex h-full flex-col p-[clamp(10px,0.8vw,15px)]" data-testid="timeline-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="t-title">Recovery Timeline</h3>
        <SourceChip source={dataSource} devFixture={devFixture} />
      </div>
      <ol className="relative mt-auto mb-auto grid pt-1" style={{ gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))` }}>
        {items.map(({ step, status }, i) => {
          const prevDone = i > 0 && ['done', 'partial', 'failed'].includes(items[i - 1].status) && status !== 'pending';
          return (
            <li key={step.id} className="relative flex min-w-0 flex-col items-center text-center" data-testid={`tl-${step.id}`} data-status={status}>
              {i > 0 && (
                <span
                  aria-hidden
                  className={clsx('absolute top-[11px] right-1/2 h-[2px] w-full -translate-y-1/2', prevDone ? 'bg-ok' : 'bg-line-strong')}
                  style={{ right: '50%' }}
                />
              )}
              <span className={clsx('relative z-[1] flex h-[22px] w-[22px] items-center justify-center rounded-full border-2', STEP_STYLE[status])} title={step.detail}>
                {status === 'done' || status === 'partial' ? (
                  <Check size={13} strokeWidth={3} />
                ) : status === 'failed' ? (
                  <X size={13} strokeWidth={3} />
                ) : status === 'skipped' ? (
                  <Minus size={12} strokeWidth={3} />
                ) : status === 'active' ? (
                  <span className="h-2 w-2 rounded-full bg-info" />
                ) : null}
              </span>
              <span className={clsx('mt-1.5 line-clamp-2 t-label leading-tight', status === 'pending' || status === 'skipped' ? 'text-mist' : 'text-navy')}>{step.label}</span>
              <span className={clsx('mt-0.5 t-micro tabular', status === 'active' ? 'font-semibold text-info' : status === 'failed' ? 'text-fault' : 'text-slate')}>
                {status === 'pending' ? '—' : status === 'active' ? 'in progress' : status === 'skipped' ? 'not attempted' : (step.clock ?? '—')}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

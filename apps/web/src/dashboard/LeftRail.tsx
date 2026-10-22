/**
 * Left rail — the story, top to bottom: what happened (incident), where recovery stands (stepper),
 * what Encirra changes (impact vs Grid-only) and the plan itself (verification, strategy switch).
 */
import { useMemo } from 'react';
import { ArrowRight, Check, HelpCircle, Minus, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import clsx from 'clsx';
import type { StrategyId } from '@encirra/shared';
import { useTwin } from '@/state/store';
import { useRunCtx } from '@/data/hooks';
import {
  STRATEGY_LABEL,
  STRATEGY_LONG,
  connectionsWithoutSupply,
  faultCardModel,
  impactComparison,
  incidentModel,
  recoveryCardModel,
  runMarks,
  timelineStatus,
  type StepStatus,
  type Tone,
} from '@/data/selectors';
import { fmtInt, fmtNum, fmtPct } from '@/data/format';
import { interruptDemo } from '@/playback/playback';
import { Segmented } from '@/ui/primitives';
import { AnimatedNumber, DeltaBadge, Module, ModuleHeader, Stat, TONE_FILL, TONE_INK, Unit, useMediaQuery, type RailTone } from './kit';

const int = (v: number) => fmtInt(v);
/** keep asset ids such as "PS-2" on one line (non-breaking hyphen, U+2011) */
const nbHyphen = (t: string) => t.replace(/([A-Za-z]{1,3})-(\d)/g, `$1${String.fromCharCode(0x2011)}$2`);

// ───────────────────────────────────────────────────────────── 1. incident hero
export function IncidentHero() {
  const ctx = useRunCtx();
  const inc = useMemo(() => (ctx ? incidentModel(ctx.run, ctx.topology, ctx.k) : null), [ctx?.run, ctx?.topology, ctx?.k]);
  const fault = useMemo(() => (ctx ? faultCardModel(ctx.run, ctx.topology, ctx.frame) : null), [ctx?.run, ctx?.topology, ctx?.frame]);
  if (!ctx || !inc || !fault) return <Module side="left" index={0} className="h-[180px]" data-testid="fault-card" data-state="normal" />;
  const { frame, topology } = ctx;
  const active = fault.active;
  const m = fault.metrics;
  const pumpsOff = frame.water.pumpsTotal - frame.water.pumpsOnline;
  const critNow = frame.facilities.filter((f) => f.status !== 'safe' && topology.facilities.find((x) => x.id === f.id)?.critical).length;
  const vals = active
    ? { load: m.loadInterruptedKW, conn: m.connectionsAffected, pumps: m.pumpsOffline, crit: m.criticalAtRisk }
    : { load: frame.power.unservedKW, conn: connectionsWithoutSupply(topology, frame), pumps: pumpsOff, crit: critNow };
  const tone: RailTone = inc.tone;
  return (
    <Module side="left" index={0} accent={tone} data-testid="fault-card" data-state={active ? 'fault' : 'normal'} data-tone={tone}>
      <div className="flex items-start gap-2.5">
        <span
          className="mt-[2px] flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors duration-500"
          style={{ background: `${TONE_FILL[tone]}26`, color: TONE_FILL[tone] }}
          aria-hidden
        >
          {tone === 'ok' ? <ShieldCheck size={16} strokeWidth={2.2} /> : tone === 'neutral' ? <Minus size={16} strokeWidth={2.4} /> : <TriangleAlert size={15} strokeWidth={2.3} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="t-kicker">Incident{active ? ` · fault at ${fault.clock}` : ''}</div>
          <h2 className={clsx('mt-0.5 text-[19px] leading-[1.2] font-semibold tracking-[-0.015em] transition-colors duration-500 compact:text-[16.5px] short:text-[17px]', TONE_INK[tone] === 'text-slate' ? 'text-navy' : TONE_INK[tone])} data-testid="incident-title">
            {inc.title}
          </h2>
          {active && (
            <div className="mt-0.5 truncate text-[12.5px] font-medium text-ink" data-testid="fault-label">
              {fault.faultLabel}
            </div>
          )}
        </div>
      </div>
      <p className="mt-2 text-[12.5px] leading-[1.45] text-pretty text-slate" data-testid="incident-sentence">
        {nbHyphen(inc.sentence)}
      </p>
      {inc.watch && (
        <div className="mt-2 flex items-center gap-1.5 rounded-md bg-wash px-2 py-1 text-[11.5px] font-medium text-ink" data-testid="incident-watch">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: inc.tone === 'fault' ? TONE_FILL.fault : '#00BFEA' }} />
          <span className="min-w-0 truncate" title={inc.watch}>
            {nbHyphen(inc.watch)}
          </span>
        </div>
      )}
      <div className={clsx('mt-3 grid grid-cols-[1.25fr_1fr_1fr] gap-x-3 border-t border-line pt-3 tight:hidden', !active && 'opacity-60')}>
        <Stat label="Load lost" testId="m-load-interrupted" tone={active && vals.load > 0 ? 'fault' : undefined} subWide sub={`${fmtInt(vals.conn)} connections`} tip="Load interrupted by the fault and service connections affected">
          <AnimatedNumber value={vals.load} format={int} />
          <Unit>kW</Unit>
        </Stat>
        <Stat label={vals.pumps === 1 ? 'Pump lost' : 'Pumps lost'} tone={active && vals.pumps > 0 ? 'fault' : undefined} subWide sub="water pumping">
          <AnimatedNumber value={vals.pumps} format={int} />
        </Stat>
        <Stat label="Critical" tone={active && vals.crit > 0 ? 'warn' : undefined} subWide sub="facilities at risk">
          <AnimatedNumber value={vals.crit} format={int} />
        </Stat>
      </div>
    </Module>
  );
}

// ───────────────────────────────────────────────────────────── 2. recovery stepper
const STEP_DOT: Record<StepStatus, string> = {
  done: 'bg-ok border-ok text-white',
  partial: 'bg-warn border-warn text-[#0b1624]',
  failed: 'bg-fault border-fault text-white',
  skipped: 'border-line-strong text-mist',
  active: 'border-warn text-warn enc-ring',
  pending: 'border-line-strong text-mist',
};

const STEP_SHORT: Record<string, string> = {
  'fault-detected': 'Fault',
  'fault-isolated': 'Isolated',
  'recovery-evaluated': 'Evaluated',
  'constraints-verified': 'Verified',
  'service-restored': 'Restored',
};

function StepDot({ status, title }: { status: StepStatus; title?: string }) {
  return (
    <span className={clsx('relative z-[1] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 bg-[#0f1c2d] transition-colors duration-300', STEP_DOT[status])} title={title}>
      {status === 'done' || status === 'partial' ? (
        <Check size={12} strokeWidth={3.2} />
      ) : status === 'failed' ? (
        <X size={12} strokeWidth={3.2} />
      ) : status === 'skipped' ? (
        <Minus size={11} strokeWidth={3} />
      ) : status === 'active' ? (
        <span className="h-2 w-2 rounded-full bg-warn" />
      ) : null}
    </span>
  );
}

const stepClock = (status: StepStatus, clock: string | null, compact = false) =>
  status === 'pending' ? '—' : status === 'active' ? (compact ? 'now' : 'in progress') : status === 'skipped' ? (compact ? 'n/a' : 'not attempted') : status === 'partial' && !compact ? `${clock ?? '—'} · partial` : (clock ?? '—');
const clockTone = (status: StepStatus) =>
  status === 'active' ? 'font-semibold text-warn' : status === 'failed' ? 'text-fault-deep' : status === 'partial' ? 'text-warn' : 'text-slate';

export function RecoveryStepper() {
  const ctx = useRunCtx();
  // viewports under 1000 px tall get a horizontal stepper so the whole story fits the rail
  const horizontal = useMediaQuery('(max-height: 999.98px)');
  const items = useMemo(() => (ctx ? timelineStatus(ctx.run.timeline, ctx.frame.t) : []), [ctx?.run, ctx?.frame]);
  return (
    <Module side="left" index={1} data-testid="timeline-card" data-layout={horizontal ? 'horizontal' : 'vertical'}>
      <ModuleHeader title="Recovery timeline" right={<span className="t-kicker">{ctx ? STRATEGY_LABEL[ctx.run.strategy] : ''}</span>} />
      {horizontal ? (
        <ol className="mt-2.5 grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))` }}>
          {items.map(({ step, status }, i) => {
            const prevLit = i > 0 && ['done', 'partial', 'failed'].includes(items[i - 1].status) && status !== 'pending';
            return (
              <li key={step.id} className="relative flex min-w-0 flex-col items-center text-center" data-testid={`tl-${step.id}`} data-status={status}>
                {i > 0 && <span aria-hidden className={clsx('absolute top-[10px] right-1/2 h-[2px] w-full', prevLit ? 'bg-ok/70' : 'bg-line-strong')} />}
                <StepDot status={status} title={step.detail} />
                <span className={clsx('mt-1 truncate text-[11.5px]', status === 'pending' || status === 'skipped' ? 'text-mist' : 'font-medium text-navy')} title={step.label}>
                  {STEP_SHORT[step.id] ?? step.label}
                </span>
                <span className={clsx('text-[10.5px] tabular', clockTone(status))}>{stepClock(status, step.clock, true)}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        <ol className="relative mt-2.5">
          {items.map(({ step, status }, i) => {
            const last = i === items.length - 1;
            const lit = status === 'done' || status === 'partial';
            return (
              <li key={step.id} className="relative flex min-h-[29px] items-start gap-3" data-testid={`tl-${step.id}`} data-status={status}>
                {!last && <span aria-hidden className={clsx('absolute top-[22px] bottom-[-2px] left-[10px] w-[2px] rounded transition-colors duration-500', lit ? 'bg-ok/70' : 'bg-line-strong')} />}
                <StepDot status={status} title={step.detail} />
                <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2 pt-[2px]">
                  <span className={clsx('truncate text-[13px]', status === 'pending' || status === 'skipped' ? 'text-mist' : 'font-medium text-navy')} title={step.label}>
                    {step.label}
                  </span>
                  <span className={clsx('shrink-0 text-[11.5px] tabular', clockTone(status))}>{stepClock(status, step.clock)}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Module>
  );
}

// ───────────────────────────────────────────────────────────── 3. impact vs Grid-only
const IMPACT_SHORT: Record<string, string> = { restored: 'Load restored', pumps: 'Pumps at end', violations: 'Violations' };

export function ImpactCard() {
  const runs = useTwin((s) => s.runsByStrategy);
  const comparison = useTwin((s) => s.comparison);
  const topology = useTwin((s) => s.topology);
  const setWhy = useTwin((s) => s.setWhyPlanOpen);
  const setPage = useTwin((s) => s.setPage);
  const ctx = useRunCtx();
  const model = useMemo(() => (topology ? impactComparison(runs, comparison, topology) : null), [runs, comparison, topology]);
  if (!ctx || !model) return <Module side="left" index={2} className="h-[200px]" data-testid="impact-card" />;
  const marks = runMarks(ctx.run);
  const preFault = marks.faultT == null || ctx.frame.t < marks.faultT;
  const ended = ctx.k >= ctx.run.frames.length - 1;
  const strategy = ctx.run.strategy;
  return (
    <Module side="left" index={2} data-testid="impact-card" data-same={model.allSame ? 'true' : 'false'} className="!px-0 !pb-0">
      <div className="px-4">
        <ModuleHeader
          title={
            <span>
              Encirra <span className="font-medium text-slate">vs</span> Grid-only
            </span>
          }
          right={
            <button type="button" onClick={() => setPage('reports')} className="inline-flex shrink-0 items-center gap-1 rounded text-[11.5px] font-semibold text-info hover:text-navy" data-testid="impact-reports">
              Full comparison <ArrowRight size={12} />
            </button>
          }
        />
      </div>
      <button
        type="button"
        onClick={() => setWhy(true)}
        className="group mt-2 block w-full px-4 pb-1.5 text-left transition-colors hover:bg-white/[0.03]"
        data-testid="impact-open-why"
        aria-label="Why this plan? Open the plan evidence"
      >
        <div className="grid grid-cols-[minmax(0,1fr)_52px_52px_62px] items-center gap-x-2 pb-1.5 text-[10.5px] font-semibold tracking-[0.06em] text-mist uppercase compact:grid-cols-[minmax(0,1fr)_46px_46px_58px]">
          {model.samePlan ? (
            <span className="truncate normal-case tracking-normal" data-testid="impact-same-plan" data-tip="Both strategies selected the same switching plan in this scenario, so their outcomes are identical." data-tip-pos="top">
              <span className="rounded-full bg-wash px-2 py-[2px] text-[11px] font-semibold text-ink">Same plan</span>
            </span>
          ) : (
            <span className={clsx('truncate', !preFault && 'text-slate')} data-testid="impact-label">
              <span className="compact:hidden">{preFault ? 'Projected · full run' : ended ? 'Full-run result' : 'Full-run outcome'}</span>
              <span className="hidden compact:inline">{preFault ? 'Projected' : 'Full run'}</span>
            </span>
          )}
          <span className={clsx('text-right', strategy === 'grid-only' && 'text-ink')}>Grid</span>
          <span className={clsx('text-right', strategy === 'encirra' && 'text-ink')}>Encirra</span>
          <span className="text-right">Δ</span>
        </div>
        {model.rows.map((r) => (
          <div
            key={r.key}
            className="grid grid-cols-[minmax(0,1fr)_52px_52px_62px] items-center gap-x-2 border-t border-line py-[6px] compact:grid-cols-[minmax(0,1fr)_46px_46px_58px] short:py-[5px]"
            data-testid={`impact-${r.key}`}
            data-tip={r.tip}
            data-tip-pos="top"
          >
            <span className="truncate text-[12.5px] text-ink">
              <span className="compact:hidden">{r.label}</span>
              <span className="hidden compact:inline">{r.key === 'hospital-water' ? r.label.replace(/ outage$/, '') : IMPACT_SHORT[r.key]}</span>
            </span>
            <span className="text-right text-[13px] text-slate tabular">{r.gridText}</span>
            <span className={clsx('text-right text-[13px] font-semibold tabular', r.verdict === 'better' ? 'text-ok-deep' : r.verdict === 'worse' ? 'text-warn' : 'text-navy')}>{r.encirraText}</span>
            <span className="flex justify-end">
              <DeltaBadge verdict={r.verdict}>{r.deltaText}</DeltaBadge>
            </span>
          </div>
        ))}
      </button>
    </Module>
  );
}

// ───────────────────────────────────────────────────────────── 4. plan
/** The plan box (with the strategy switch) stays pinned to the rail bottom when the rail scrolls. */
const PLAN_STICKY = 'glass-solid sticky bottom-0 z-10';

const RECOVERY_TONE: Record<Tone, RailTone> = { neutral: 'neutral', info: 'warn', progress: 'warn', ok: 'ok', warn: 'warn', fault: 'fault' };

export function PlanBox() {
  const ctx = useRunCtx();
  const setWhy = useTwin((s) => s.setWhyPlanOpen);
  const strategy = useTwin((s) => s.strategy);
  const switchStrategy = useTwin((s) => s.switchStrategy);
  const runs = useTwin((s) => s.runsByStrategy);
  const model = useMemo(() => (ctx ? recoveryCardModel(ctx.run, ctx.topology, ctx.k) : null), [ctx?.run, ctx?.topology, ctx?.k]);
  const switcher = (
    <Segmented
      value={strategy}
      testId="strategy-select"
      size="md"
      stretch
      className="w-full"
      tipPos="top"
      onChange={(v) => {
        interruptDemo();
        switchStrategy(v as StrategyId);
      }}
      options={(['none', 'grid-only', 'encirra'] as StrategyId[]).map((s) => ({ value: s, label: STRATEGY_LABEL[s], tip: STRATEGY_LONG[s], disabled: !runs[s] }))}
    />
  );
  if (!ctx || !model) {
    return (
      <Module side="left" index={3} data-testid="recovery-card" className={PLAN_STICKY}>
        {switcher}
      </Module>
    );
  }
  const m = model.metrics;
  const tone = RECOVERY_TONE[model.tone];
  const showPct = ctx.frame.stage !== 'ready';
  const whyEnabled = model.planVisible || (ctx.run.strategy === 'none' && ctx.frame.stage !== 'ready');
  return (
    <Module side="left" index={3} accent={tone} data-testid="recovery-card" data-tone={model.tone} className={PLAN_STICKY}>
      <div>{switcher}</div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <h3 className={clsx('min-w-0 truncate text-[15px] leading-tight font-semibold transition-colors duration-500', tone === 'neutral' ? 'text-navy' : TONE_INK[tone])} data-testid="recovery-title" title={model.title}>
          {model.title}
        </h3>
        <button
          type="button"
          onClick={() => setWhy(true)}
          disabled={!whyEnabled}
          data-tip={whyEnabled ? 'Candidates, scores and the independent verification' : 'Available once recovery candidates have been evaluated'}
          data-tip-pos="bottom-end"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line-strong px-2 py-[3px] text-[11.5px] font-semibold text-navy transition-colors hover:border-white/30 hover:bg-white/10 disabled:opacity-40"
          data-testid="why-plan-btn"
        >
          <HelpCircle size={13} />
          Why this plan?
        </button>
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-[12px] text-slate" title={model.subtitle} data-testid="recovery-subtitle">
          {model.subtitle}
        </span>
        {model.verified && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ok-soft px-2 py-[2px] text-[11px] font-semibold text-ok-deep"
            data-tip="The selected plan passed every hard check in an independent re-simulation"
            data-tip-pos="bottom-end"
            data-testid="plan-verified-pill"
          >
            <ShieldCheck size={12} /> Simulation Verified
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 border-t border-line pt-3 tight:hidden">
        <Stat
          label="Load restored"
          testId="m-load-restored"
          tone={m.restoredKW > 0 ? 'ok' : undefined}
          sub={showPct && m.restoredPct != null ? `${fmtPct(m.restoredPct)} of affected demand` : '—'}
          tip="Share of the demand affected by the event that is supplied again at this time: load restored ÷ (load restored + remaining unserved demand)."
        >
          <AnimatedNumber value={m.restoredKW} format={int} />
          <Unit>kW</Unit>
        </Stat>
        <Stat
          label="Critical recovered"
          tone={m.criticalAtRisk > 0 && m.criticalRecovered === m.criticalAtRisk ? 'ok' : undefined}
          sub={showPct ? `${fmtNum(m.unservedKW, 0)} kW still unserved` : '—'}
        >
          {m.criticalAtRisk > 0 ? `${m.criticalRecovered} / ${m.criticalAtRisk}` : '—'}
        </Stat>
      </div>
    </Module>
  );
}

export function LeftRail() {
  return (
    <>
      <IncidentHero />
      <RecoveryStepper />
      <ImpactCard />
      <PlanBox />
    </>
  );
}

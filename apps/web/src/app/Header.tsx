import { BarChart3, Boxes, CircleHelp, FileText, Layers3, Loader2, ShieldCheck, Sun } from 'lucide-react';
import clsx from 'clsx';
import { district } from '@encirra/shared';
import { useTwin, useFrame, type PageId } from '@/state/store';
import { simDate } from '@/data/format';
import { STAGE_LABEL } from '@/data/selectors';
import { Dot } from '@/ui/primitives';
import { LogoMark } from './Logo';

const NAV: { id: PageId; label: string; icon: typeof Layers3 }[] = [
  { id: 'live', label: 'Live Twin', icon: Layers3 },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'scenarios', label: 'Scenarios', icon: ShieldCheck },
  { id: 'assets', label: 'Assets', icon: Boxes },
  { id: 'reports', label: 'Reports', icon: FileText },
];

function TitleBlock() {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-white/95 shadow-[inset_0_-1px_0_rgba(0,0,0,0.08)]">
        <LogoMark size={20} />
      </span>
      <h1 className="shrink-0 text-[17px] leading-none font-semibold tracking-[-0.02em] text-navy">Encirra</h1>
      <span className="h-4 w-px shrink-0 bg-line-strong compact:hidden" />
      <span className="truncate text-[12.5px] text-slate compact:hidden">Coupled power + water resilience twin</span>
    </div>
  );
}

function Nav() {
  const page = useTwin((s) => s.page);
  const setPage = useTwin((s) => s.setPage);
  return (
    <nav aria-label="Primary" className="flex items-center gap-0.5 rounded-[10px] bg-white/[0.05] p-[3px]" data-testid="nav">
      {NAV.map(({ id, label, icon: Icon }) => {
        const active = id === page;
        return (
          <button
            key={id}
            type="button"
            data-testid={`nav-${id}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => setPage(id)}
            className={clsx(
              'flex h-8 items-center gap-1.5 rounded-[8px] px-[clamp(9px,0.8vw,14px)] text-[13px] font-medium whitespace-nowrap transition-colors',
              active ? 'bg-white/[0.13] text-navy shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]' : 'text-slate hover:bg-white/[0.06] hover:text-navy',
            )}
          >
            <Icon size={15} strokeWidth={active ? 2.1 : 1.8} className={active ? 'text-navy' : 'text-slate'} />
            {label}
          </button>
        );
      })}
    </nav>
  );
}

function Context() {
  const run = useTwin((s) => s.run);
  const frame = useFrame();
  const dataSource = useTwin((s) => s.dataSource);
  const liveSync = useTwin((s) => s.liveSync);
  const setWelcome = useTwin((s) => s.setWelcomeOpen);
  const amb = district.district.ambient;
  const date = run && frame ? simDate(run.timebase.startISO, run.timebase.startClock, frame.t) : '—';
  const stage = frame ? STAGE_LABEL[frame.stage] : dataSource === 'loading' ? 'Loading…' : '—';
  const live = dataSource === 'live';
  return (
    <div className="flex min-w-0 items-center justify-end gap-2">
      <div
        className="flex shrink-0 items-baseline gap-2 px-1 tabular"
        data-tip={`Simulated scenario time (${district.district.clock.timezone}) in the ${district.district.label} (${district.district.id}). Not the current date.`}
        data-tip-pos="bottom-end"
        data-testid="sim-clock"
      >
        <span className="text-[12px] whitespace-nowrap text-slate">
          <span className="hide-below-1800">{date}</span>
          <span className="show-below-1800">{date.replace(/^[A-Za-z]{3}, /, '').replace(/, \d{4}$/, '')}</span>
        </span>
        <span className="text-[15px] font-semibold text-navy">{frame?.clock ?? '—'}</span>
        <span className="text-[9.5px] font-semibold tracking-[0.08em] text-mist uppercase">sim</span>
      </div>
      <div
        className="hide-below-1400 flex shrink-0 items-center gap-1 px-1 text-[12.5px] font-semibold text-navy"
        data-tip={`${amb.temperatureC} °C, ${amb.condition.toLowerCase()}. Scenario assumption (${amb.source.toLowerCase()}), not live weather.`}
        data-tip-pos="bottom-end"
        data-testid="ambient"
      >
        <Sun size={15} className="text-power" />
        {amb.temperatureC}&#8201;°C
      </div>
      <div
        className="flex min-w-0 items-center gap-2 rounded-full border border-line-strong bg-white/[0.04] py-[5px] pr-3 pl-2.5 text-[12px] text-ink"
        data-testid="sim-status"
        data-tip={
          live
            ? 'Results computed on request by the simulation service (pandapower + WNTR).'
            : 'Replay of precomputed solver output bundled with the app. Not real-time utility telemetry.'
        }
        data-tip-pos="bottom-end"
      >
        <Dot color={dataSource === 'error' ? '#F04438' : live ? '#17A769' : '#6AA8EE'} size={7} className={dataSource === 'loading' ? 'enc-blink' : ''} />
        <span className="shrink-0 font-medium whitespace-nowrap">
          {dataSource === 'loading' ? (
            'Loading simulation data'
          ) : dataSource === 'error' ? (
            'Data unavailable'
          ) : live ? (
            'Live solver'
          ) : (
            <>
              Replay<span className="hide-below-1800"> · precomputed solver output</span>
            </>
          )}
        </span>
        {liveSync === 'syncing' && !live && (
          <span className="inline-flex shrink-0 items-center gap-1 text-info" data-tip="Live simulation service detected: recomputing this scenario. The replay stays on screen until it is ready." data-tip-pos="bottom-end">
            <Loader2 size={12} className="animate-spin" />
          </span>
        )}
        <span className="text-mist">·</span>
        <span className="truncate font-semibold text-navy" data-testid="sim-stage">
          {stage}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setWelcome(true, 'help')}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate transition-colors hover:bg-white/10 hover:text-navy"
        aria-label="Help and keyboard shortcuts"
        data-tip="How to read the twin · shortcuts (?)"
        data-tip-pos="bottom-end"
        data-testid="help-open"
      >
        <CircleHelp size={18} />
      </button>
    </div>
  );
}

export function Header() {
  return (
    <header className="ui-dark absolute inset-x-0 top-0 z-20 h-[var(--header-h)] px-[var(--pad-x)] pt-[var(--gap)]">
      <div className="glass grid h-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-[12px] px-3">
        <TitleBlock />
        <Nav />
        <Context />
      </div>
    </header>
  );
}

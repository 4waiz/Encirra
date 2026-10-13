import { BarChart3, Boxes, FileText, Layers3, MapPin, ShieldCheck, Sun } from 'lucide-react';
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
    <div className="pointer-events-auto flex min-w-0 items-start gap-[clamp(8px,0.7vw,14px)]">
      <LogoMark className="mt-[3px] h-auto w-[clamp(36px,2.75vw,50px)] shrink-0 drop-shadow-[0_2px_4px_rgba(21,40,60,0.18)]" />
      <div className="min-w-0 [text-shadow:0_1px_10px_rgba(255,255,255,0.75)]">
        <h1 className="text-[clamp(26px,2.15vw,38px)] font-semibold leading-[1.02] tracking-[-0.02em] text-navy">Encirra</h1>
        <div className="mt-[2px] truncate text-[clamp(13.5px,1.08vw,19px)] font-medium leading-tight tracking-[-0.01em] text-navy">
          Coupled Power + Water Resilience Twin
        </div>
        <div className="mt-[3px] truncate text-[clamp(11px,0.8vw,14px)] leading-tight text-ink">See more. Recover faster. Safer cities for tomorrow.</div>
      </div>
    </div>
  );
}

function Nav() {
  const page = useTwin((s) => s.page);
  const setPage = useTwin((s) => s.setPage);
  return (
    <nav aria-label="Primary" className="enc-panel pointer-events-auto flex items-center gap-[clamp(0px,0.25vw,6px)] rounded-[12px] p-[5px]" data-testid="nav">
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
              'flex items-center gap-[7px] whitespace-nowrap rounded-[9px] px-[clamp(9px,1vw,18px)] py-[clamp(7px,0.62vw,11px)] text-[clamp(12px,0.8vw,14px)] font-medium transition-colors',
              active ? 'bg-active text-info shadow-[inset_0_0_0_1px_rgba(42,108,181,0.12)]' : 'text-ink hover:bg-white/70',
            )}
          >
            <Icon size={17} strokeWidth={active ? 2.1 : 1.8} className={active ? 'text-info' : 'text-slate'} />
            {label}
          </button>
        );
      })}
    </nav>
  );
}

function ClockAndContext() {
  const run = useTwin((s) => s.run);
  const frame = useFrame();
  const dataSource = useTwin((s) => s.dataSource);
  const devFixture = useTwin((s) => s.devFixture);
  const amb = district.district.ambient;
  const date = run && frame ? simDate(run.timebase.startISO, run.timebase.startClock, frame.t) : '—';
  const stage = frame ? STAGE_LABEL[frame.stage] : dataSource === 'loading' ? 'Loading…' : '—';
  const live = dataSource === 'live';
  return (
    <div className="pointer-events-auto flex min-w-0 flex-col items-end gap-[6px]">
      <div className="enc-panel flex min-w-0 items-center rounded-[12px] py-[5px] pr-[6px] pl-[4px] short:py-[3px]">
        <div
          className="flex min-w-0 items-center gap-1.5 px-[clamp(6px,0.6vw,12px)] py-[5px] text-[clamp(11px,0.72vw,13px)] text-navy"
          data-tip={`${district.district.label} (${district.district.id}). ${district.district.disclaimer}`}
          data-tip-pos="bottom-end"
        >
          <MapPin size={15} className="shrink-0 text-navy" />
          <span className="truncate">
            <span className="hide-below-1500">Dubai-inspired synthetic district · </span>
            <span className="show-below-1500">Synthetic district · </span>
            {district.district.id}
          </span>
        </div>
        <div className="h-6 w-px bg-line" />
        <div
          className="flex flex-col items-end px-[clamp(6px,0.6vw,12px)] leading-none"
          data-tip={`Simulated scenario time (${district.district.clock.timezone}). Not the current date.`}
          data-tip-pos="bottom-end"
          data-testid="sim-clock"
        >
          <span className="whitespace-nowrap text-[clamp(11px,0.72vw,13px)] text-navy tabular">
            <span className="hide-below-1400">{date}</span>
            <span className="show-below-1400">{date.replace(/^[A-Za-z]{3}, /, '').replace(/, \d{4}$/, '')}</span>
            <span className="ml-2 font-semibold">{frame?.clock ?? '—'}</span>
          </span>
          <span className="mt-[3px] text-[9px] font-semibold uppercase tracking-[0.08em] text-slate">simulated</span>
        </div>
        <div className="h-6 w-px bg-line" />
        <div
          className="flex items-center gap-1.5 px-[clamp(6px,0.6vw,12px)]"
          data-tip={`${amb.temperatureC} °C, ${amb.condition}. ${amb.source}: a scenario assumption, not live weather.`}
          data-tip-pos="bottom-end"
          data-testid="ambient"
        >
          <Sun size={22} className="text-power" strokeWidth={2} />
          <div className="leading-none">
            <div className="text-[clamp(12px,0.82vw,15px)] font-semibold whitespace-nowrap text-navy">{amb.temperatureC}°C</div>
            <div className="hide-below-1400 mt-[3px] text-[10px] whitespace-nowrap text-slate">{amb.condition.split(',')[0]}</div>
          </div>
        </div>
      </div>
      <div
        className="enc-panel flex max-w-full items-center gap-2 rounded-full px-3 py-[4px] text-[clamp(10.5px,0.66vw,12px)] text-ink"
        data-testid="sim-status"
        data-tip={
          live
            ? 'Results computed on request by the simulation service (pandapower + WNTR).'
            : 'Replay of precomputed solver output bundled with the app. Not real-time utility telemetry.'
        }
        data-tip-pos="bottom-end"
      >
        <Dot color={dataSource === 'error' ? '#F04438' : live ? '#17A769' : '#2A6CB5'} size={7} className={dataSource === 'loading' ? 'enc-blink' : ''} />
        <span className="shrink-0 font-medium whitespace-nowrap">
          {dataSource === 'loading' ? 'Loading simulation data' : dataSource === 'error' ? 'Data unavailable' : live ? 'Live solver' : 'Replay · precomputed solver output'}
        </span>
        {devFixture && <span className="shrink-0 rounded bg-fault px-1.5 py-[1px] text-[10px] font-bold tracking-wide whitespace-nowrap text-white">DEV FIXTURE</span>}
        <span className="text-mist narrow:hidden">·</span>
        <span className="truncate font-semibold text-navy narrow:sr-only" data-testid="sim-stage">
          {stage}
        </span>
      </div>
    </div>
  );
}

export function Header() {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 grid h-[var(--header-h)] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3 px-[var(--pad-x)] pt-[clamp(8px,1.3vh,14px)]">
      <TitleBlock />
      <Nav />
      <div className="flex min-w-0 justify-end">
        <ClockAndContext />
      </div>
    </header>
  );
}

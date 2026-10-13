import { useEffect, useRef, useState } from 'react';
import {
  Building2,
  ChevronDown,
  Clapperboard,
  Crosshair,
  Droplet,
  Orbit,
  Pause,
  Play,
  RotateCcw,
  ScanEye,
  SkipBack,
  StepBack,
  StepForward,
  Tag,
  Zap,
} from 'lucide-react';
import clsx from 'clsx';
import type { ScenarioId, StrategyId } from '@encirra/shared';
import { useTwin, type CameraShot, type Layers } from '@/state/store';
import { playback, SPEEDS } from '@/playback/playback';
import { runMarks, STRATEGY_LABEL, STRATEGY_LONG } from '@/data/selectors';
import { loadScenario } from '@/data/loader';
import { IconButton, Segmented } from '@/ui/primitives';
import { startDemo } from '@/demo/demoController';

// ───────────────────────────────────────────────────────────── scrubber (only part that follows the fractional playhead)
function Scrubber() {
  const run = useTwin((s) => s.run);
  const playhead = useTwin((s) => s.playhead);
  const n = run?.frames.length ?? 1;
  const max = Math.max(1, n - 1);
  const marks = run ? runMarks(run) : null;
  const tAt = (t: number | null) => {
    if (t == null || !run) return null;
    const f = run.frames;
    const span = f[f.length - 1].t - f[0].t || 1;
    return ((t - f[0].t) / span) * 100;
  };
  const ticks = marks
    ? ([
        { t: marks.faultT, color: '#F04438', label: 'Fault' },
        { t: marks.pumpTripT, color: '#00A9D4', label: 'Pump trip' },
        { t: marks.isolatedT, color: '#5b6b7c', label: 'Isolated' },
        { t: marks.verifiedT, color: '#2A6CB5', label: 'Verified' },
        { t: marks.restoredT, color: '#17A769', label: 'Restored' },
      ] as const)
    : [];
  const frame = run?.frames[Math.min(n - 1, Math.floor(playhead))];
  const pct = (playhead / max) * 100;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <span className="w-[38px] shrink-0 text-right text-[12px] font-semibold text-navy tabular" data-testid="playback-clock">
        {frame?.clock ?? '—'}
      </span>
      <div className="relative min-w-[120px] flex-1">
        <div className="pointer-events-none absolute inset-x-[7px] top-1/2 h-0">
          {ticks.map((tk) =>
            tAt(tk.t) == null ? null : (
              <span
                key={tk.label}
                className="absolute top-[-9px] h-[18px] w-[2px] -translate-x-1/2 rounded"
                style={{ left: `${tAt(tk.t)}%`, background: tk.color, opacity: 0.85 }}
                title={tk.label}
              />
            ),
          )}
        </div>
        <input
          type="range"
          aria-label="Simulation time"
          className="enc-range relative w-full"
          min={0}
          max={max}
          step={0.01}
          value={playhead}
          disabled={!run}
          onChange={(e) => playback.seek(Number(e.target.value))}
          style={{ ['--track' as string]: `linear-gradient(90deg, #2A6CB5 ${pct}%, #d6dee7 ${pct}%)` }}
          data-testid="scrubber"
        />
      </div>
      <span className="w-[38px] shrink-0 text-[11px] text-slate tabular">{run?.frames[n - 1]?.clock ?? '—'}</span>
    </div>
  );
}

export function PlaybackBar() {
  const playing = useTwin((s) => s.playing);
  const speed = useTwin((s) => s.speed);
  const strategy = useTwin((s) => s.strategy);
  const switchStrategy = useTwin((s) => s.switchStrategy);
  const scenarioId = useTwin((s) => s.scenarioId);
  const scenarios = useTwin((s) => s.scenarios);
  const runs = useTwin((s) => s.runsByStrategy);
  const busy = useTwin((s) => s.busy);
  const hasRun = useTwin((s) => !!s.run);
  return (
    <div
      className="enc-panel pointer-events-auto flex w-[min(100%,clamp(720px,60vw,1040px))] items-center gap-[clamp(6px,0.7vw,12px)] rounded-[12px] px-2.5 py-1.5"
      data-testid="playback-bar"
    >
      <label className="relative flex shrink-0 items-center" data-tip="Scenario" data-tip-pos="top">
        <select
          aria-label="Scenario"
          className="h-8 max-w-[clamp(120px,11vw,190px)] appearance-none truncate rounded-lg border border-line bg-white/80 pr-7 pl-2.5 text-[12px] font-medium text-navy outline-none hover:border-line-strong disabled:opacity-50"
          value={scenarioId}
          disabled={!!busy || scenarios.length === 0}
          onChange={(e) => void loadScenario(e.target.value as ScenarioId)}
          data-testid="scenario-select"
        >
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2 text-slate" />
      </label>
      <Segmented
        value={strategy}
        testId="strategy-select"
        onChange={(v) => switchStrategy(v as StrategyId)}
        options={(['none', 'grid-only', 'encirra'] as StrategyId[]).map((s) => ({
          value: s,
          label: STRATEGY_LABEL[s],
          tip: STRATEGY_LONG[s],
          disabled: !runs[s],
        }))}
      />
      <div className="h-6 w-px shrink-0 bg-line" />
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton tip="Reset to start" tipPos="top" onClick={playback.reset} disabled={!hasRun} data-testid="pb-reset">
          <SkipBack size={16} />
        </IconButton>
        <IconButton tip="Step back one frame" tipPos="top" onClick={() => playback.step(-1)} disabled={!hasRun} data-testid="pb-back">
          <StepBack size={16} />
        </IconButton>
        <button
          type="button"
          onClick={playback.toggle}
          disabled={!hasRun}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-info text-white shadow-sm transition-colors hover:bg-brand-deep disabled:opacity-40"
          data-testid="pb-play"
          data-playing={playing}
        >
          {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="ml-[2px]" />}
        </button>
        <IconButton tip="Step forward one frame" tipPos="top" onClick={() => playback.step(1)} disabled={!hasRun} data-testid="pb-fwd">
          <StepForward size={16} />
        </IconButton>
      </div>
      <Scrubber />
      <label className="relative flex shrink-0 items-center" data-tip="Playback speed (simulated minutes per second)" data-tip-pos="top">
        <select
          aria-label="Playback speed"
          className="h-8 appearance-none rounded-lg border border-line bg-white/80 pr-6 pl-2 text-[12px] font-medium text-navy outline-none"
          value={speed}
          onChange={(e) => playback.setSpeed(Number(e.target.value))}
          data-testid="speed-select"
        >
          {SPEEDS.map((v) => (
            <option key={v} value={v}>
              {v} min/s
            </option>
          ))}
        </select>
        <ChevronDown size={13} className="pointer-events-none absolute right-1.5 text-slate" />
      </label>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── scene toolbar
const LAYER_BTNS: { key: keyof Layers; label: string; icon: typeof Zap }[] = [
  { key: 'electrical', label: 'Electrical network', icon: Zap },
  { key: 'water', label: 'Water network', icon: Droplet },
  { key: 'underground', label: 'Underground x-ray', icon: ScanEye },
  { key: 'labels', label: 'Labels', icon: Tag },
  { key: 'skyline', label: 'Skyline context', icon: Building2 },
];

export const SHOTS: { shot: CameraShot; label: string }[] = [
  { shot: 'home', label: 'Home view' },
  { shot: 'aerial', label: 'Aerial' },
  { shot: 'overview-top', label: 'Top-down' },
  { shot: 'substation', label: 'Substation S1' },
  { shot: 'hospital', label: 'City Hospital' },
  { shot: 'ps-1', label: 'Pumping Station PS-1' },
  { shot: 'ps-2', label: 'Pumping Station PS-2' },
  { shot: 'tank-t1', label: 'Tank T1' },
  { shot: 'tank-t2', label: 'Tank T2' },
  { shot: 'west-district', label: 'West district (Feeder F3)' },
  { shot: 'underground-west', label: 'Underground · West main' },
  { shot: 'underground-front', label: 'Underground · front cut-away' },
  { shot: 'recovery-path', label: 'Recovery path (tie switches)' },
];

function FocusMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const requestCamera = useTwin((s) => s.requestCamera);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <IconButton tip={open ? undefined : 'Focus presets'} active={open} onClick={() => setOpen((o) => !o)} data-testid="focus-menu-btn">
        <Crosshair size={16} />
      </IconButton>
      {open && (
        <div className="enc-panel enc-panel-strong absolute top-[calc(100%+8px)] right-0 z-30 w-[220px] rounded-[10px] p-1" role="menu">
          <div className="px-2 pt-1 pb-1 t-micro font-semibold tracking-wide text-slate uppercase">Camera focus</div>
          {SHOTS.map((s) => (
            <button
              key={s.shot}
              type="button"
              role="menuitem"
              className="block w-full rounded-md px-2 py-1.5 text-left text-[12px] text-navy hover:bg-info-soft"
              onClick={() => {
                requestCamera({ shot: s.shot });
                setOpen(false);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SceneToolbar() {
  const layers = useTwin((s) => s.layers);
  const toggleLayer = useTwin((s) => s.toggleLayer);
  const autoOrbit = useTwin((s) => s.autoOrbit);
  const setAutoOrbit = useTwin((s) => s.setAutoOrbit);
  const requestCamera = useTwin((s) => s.requestCamera);
  const demoActive = useTwin((s) => s.demo.active);
  const hasRun = useTwin((s) => !!s.run);
  return (
    <div className="enc-panel pointer-events-auto flex items-center gap-0.5 rounded-[12px] p-1" data-testid="scene-toolbar">
      <span className="hidden px-1.5 t-micro font-semibold tracking-wide text-slate uppercase 2xl:inline">Layers</span>
      {LAYER_BTNS.map(({ key, label, icon: Icon }) => (
        <IconButton key={key} tip={label} active={layers[key]} onClick={() => toggleLayer(key)} data-testid={`layer-${key}`}>
          <Icon size={16} />
        </IconButton>
      ))}
      <div className="mx-0.5 h-6 w-px bg-line" />
      <IconButton tip="Auto-orbit" active={autoOrbit} onClick={() => setAutoOrbit(!autoOrbit)} data-testid="auto-orbit">
        <Orbit size={16} />
      </IconButton>
      <IconButton tip="Reset camera" onClick={() => requestCamera({ shot: 'home' })} data-testid="camera-reset">
        <RotateCcw size={16} />
      </IconButton>
      <FocusMenu />
      <div className="mx-0.5 h-6 w-px bg-line" />
      <button
        type="button"
        disabled={!hasRun}
        onClick={() => startDemo()}
        data-testid="demo-start"
        data-tip="Guided 3-minute sequence: fault, cascade, recovery, evidence"
        data-tip-pos="bottom-end"
        className={clsx(
          'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold whitespace-nowrap transition-colors disabled:opacity-40',
          demoActive ? 'bg-info-soft text-info' : 'bg-info text-white hover:bg-brand-deep',
        )}
      >
        <Clapperboard size={15} />
        Cinematic Demo
      </button>
    </div>
  );
}

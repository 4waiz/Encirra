/**
 * Bottom transport bar: scenario, playback, a wide scrubber with labelled event markers, speed,
 * and the twin controls (focus, layers, camera, cinematic demo). In focus mode it collapses to a
 * minimal pill (play, scrubber, "Show dashboard").
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  ChevronDown,
  Clapperboard,
  Crosshair,
  Droplet,
  Maximize2,
  Minimize2,
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
import type { ScenarioId } from '@encirra/shared';
import { useTwin, type CameraShot, type Layers } from '@/state/store';
import { interruptDemo, playback, SPEEDS } from '@/playback/playback';
import { runMarks } from '@/data/selectors';
import { loadScenario } from '@/data/loader';
import { IconButton } from '@/ui/primitives';
import { startDemo } from '@/demo/demoController';

// ───────────────────────────────────────────────────────────── scrubber with labelled markers
interface Marker {
  key: string;
  t: number;
  label: string;
  color: string;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Scrubber({ labels = true }: { labels?: boolean }) {
  const run = useTwin((s) => s.run);
  const topology = useTwin((s) => s.topology);
  const playhead = useTwin((s) => s.playhead);
  const n = run?.frames.length ?? 1;
  const max = Math.max(1, n - 1);
  const [trackRef, width] = useWidth<HTMLDivElement>();
  const thr = topology?.water.serviceThresholdM ?? 20;

  // markers merged when they share a time; labels alternate above/below when they would collide
  const placed = useMemo(() => {
    if (!run) return [];
    const m = runMarks(run, thr);
    const raw: Marker[] = [
      { key: 'fault', t: m.faultT, label: 'Fault', color: '#F04438' },
      { key: 'trip', t: m.pumpTripT, label: 'Pump trip', color: '#00BFEA' },
      { key: 'isolated', t: m.isolatedT, label: 'Isolated', color: '#9FB0C2' },
      { key: 'verified', t: m.verifiedT, label: 'Verified', color: '#6AA8EE' },
      { key: 'restored', t: m.restoredT, label: 'Restored', color: '#17A769' },
      { key: 'below', t: m.pressureBelowT, label: `Pressure < ${thr} m`, color: '#F04438' },
    ].filter((x): x is Marker => x.t != null);
    raw.sort((a, b) => a.t - b.t);
    const merged: Marker[] = [];
    for (const r of raw) {
      const prev = merged[merged.length - 1];
      if (prev && Math.abs(prev.t - r.t) < 1) merged[merged.length - 1] = { ...prev, key: `${prev.key}+${r.key}`, label: `${prev.label} · ${r.label}` };
      else merged.push(r);
    }
    const f = run.frames;
    const span = f[f.length - 1].t - f[0].t || 1;
    return merged.map((mk) => ({ ...mk, pct: ((mk.t - f[0].t) / span) * 100 }));
  }, [run, thr]);

  const rows = useMemo(() => {
    // Labels go above (row 0) or below (row 1) the track. They are placed in priority order and a
    // label that fits in neither row is dropped (its tick stays, with a tooltip).
    const PRIORITY = ['fault', 'below', 'restored', 'trip', 'verified', 'isolated'];
    const rank = (key: string) => Math.min(...key.split('+').map((k) => PRIORITY.indexOf(k)).filter((i) => i >= 0));
    const taken: [number, number][][] = [[], []];
    const out = new Map<string, { row: number; start: number }>();
    for (const mk of [...placed].sort((a, b) => rank(a.key) - rank(b.key))) {
      const x = 7 + (mk.pct / 100) * Math.max(0, width - 14);
      const w = mk.label.length * 6.1 + 6;
      const start = Math.min(Math.max(0, x - 3), Math.max(0, width - w));
      const span: [number, number] = [start - 6, start + w + 6];
      const row = [0, 1].find((r) => taken[r].every(([a, b]) => span[1] <= a || span[0] >= b));
      if (row == null) continue;
      taken[row].push(span);
      out.set(mk.key, { row, start });
    }
    return placed.flatMap((mk) => {
      const p = out.get(mk.key);
      return p ? [{ ...mk, ...p }] : [];
    });
  }, [placed, width]);

  const frame = run?.frames[Math.min(n - 1, Math.floor(playhead))];
  const pct = (playhead / max) * 100;
  return (
    <div className="flex h-full min-w-0 flex-1 items-center gap-3">
      <span className="w-[40px] shrink-0 text-right text-[13px] font-semibold text-navy tabular" data-testid="playback-clock">
        {frame?.clock ?? '—'}
      </span>
      <div ref={trackRef} className="relative h-full min-w-[140px] flex-1">
        {labels &&
          rows.map((mk) => (
            <span
              key={mk.key}
              className={clsx('pointer-events-none absolute text-[10.5px] leading-none font-semibold whitespace-nowrap', mk.row === 0 ? 'top-[6px]' : 'bottom-[5px]')}
              style={{ left: mk.start, color: mk.color }}
              data-testid={`scrub-mark-${mk.key}`}
            >
              {mk.label}
            </span>
          ))}
        <div className="pointer-events-none absolute inset-x-[7px] top-1/2 h-0">
          {placed.map((mk) => (
            <span key={mk.key} className="absolute top-[-8px] h-[16px] w-[2px] -translate-x-1/2 rounded" style={{ left: `${mk.pct}%`, background: mk.color }} title={mk.label} />
          ))}
        </div>
        <input
          type="range"
          aria-label="Simulation time"
          className="enc-range absolute inset-x-0 top-1/2 w-full -translate-y-1/2"
          min={0}
          max={max}
          step={0.01}
          value={playhead}
          disabled={!run}
          onChange={(e) => playback.seek(Number(e.target.value))}
          style={{ ['--track' as string]: `linear-gradient(90deg, #F2F6FA ${pct}%, rgba(255,255,255,0.16) ${pct}%)` }}
          data-testid="scrubber"
        />
      </div>
      <span className="w-[38px] shrink-0 text-[11.5px] text-slate tabular compact:hidden">{run?.frames[n - 1]?.clock ?? '—'}</span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── camera presets (opens upward)
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <IconButton tip={open ? undefined : 'Camera presets'} tipPos="top" active={open} onClick={() => setOpen((o) => !o)} data-testid="focus-menu-btn" compact>
        <Crosshair size={15} />
      </IconButton>
      {open && (
        <div
          className="glass glass-solid enc-scroll absolute right-0 bottom-[calc(100%+12px)] z-40 grid max-h-[calc(100vh-var(--header-h)-var(--bar-h)-48px)] w-[380px] grid-cols-2 gap-x-1 overflow-y-auto rounded-[12px] p-1.5"
          role="menu"
          data-testid="focus-menu"
        >
          <div className="col-span-2 px-2 pt-1 pb-1 t-kicker">Camera</div>
          {SHOTS.map((s) => (
            <button
              key={s.shot}
              type="button"
              role="menuitem"
              className="block w-full rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-white/10 hover:text-navy"
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

const LAYER_BTNS: { key: keyof Layers; label: string; icon: typeof Zap }[] = [
  { key: 'electrical', label: 'Electrical network', icon: Zap },
  { key: 'water', label: 'Water network', icon: Droplet },
  { key: 'underground', label: 'Underground x-ray', icon: ScanEye },
  { key: 'labels', label: 'Labels', icon: Tag },
  { key: 'skyline', label: 'Skyline context', icon: Building2 },
];

const Sep = () => <div className="mx-1 h-6 w-px shrink-0 bg-line-strong" />;

function FocusButton() {
  const focus = useTwin((s) => s.focusTwin);
  const setFocus = useTwin((s) => s.setFocusTwin);
  return (
    <button
      type="button"
      onClick={() => setFocus(!focus)}
      data-testid="focus-twin"
      aria-pressed={focus}
      aria-label={focus ? 'Show dashboard' : 'Focus twin'}
      data-tip={focus ? 'Show the dashboard (F)' : 'Hide the rails so the 3D twin fills the view (F)'}
      data-tip-pos="top"
      className={clsx(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors',
        focus ? 'bg-[#F2F6FA] text-[#0b1624] hover:bg-white' : 'text-ink hover:bg-white/10 hover:text-navy',
      )}
    >
      {focus ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      <span className={clsx(!focus && 'compact:hidden')}>{focus ? 'Show dashboard' : 'Focus twin'}</span>
    </button>
  );
}

function PlayButton() {
  const playing = useTwin((s) => s.playing);
  const hasRun = useTwin((s) => !!s.run);
  return (
    <button
      type="button"
      onClick={playback.toggle}
      disabled={!hasRun}
      aria-label={playing ? 'Pause' : 'Play'}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F2F6FA] text-[#0b1624] shadow-[0_4px_14px_-4px_rgba(0,0,0,0.5)] transition-transform hover:scale-[1.04] active:scale-95 disabled:opacity-40"
      data-testid="pb-play"
      data-playing={playing}
    >
      {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="ml-[2px]" />}
    </button>
  );
}

export function BottomBar() {
  const speed = useTwin((s) => s.speed);
  const scenarioId = useTwin((s) => s.scenarioId);
  const scenarios = useTwin((s) => s.scenarios);
  const busy = useTwin((s) => s.busy);
  const hasRun = useTwin((s) => !!s.run);
  const layers = useTwin((s) => s.layers);
  const toggleLayer = useTwin((s) => s.toggleLayer);
  const autoOrbit = useTwin((s) => s.autoOrbit);
  const setAutoOrbit = useTwin((s) => s.setAutoOrbit);
  const requestCamera = useTwin((s) => s.requestCamera);
  const demoActive = useTwin((s) => s.demo.active);
  const focus = useTwin((s) => s.focusTwin);

  if (focus) {
    return (
      <div className="glass pointer-events-auto mx-auto flex h-full w-[min(100%,760px)] items-center gap-3 rounded-full px-2.5" data-testid="bottom-bar" data-compact="true">
        <div className="flex h-full min-w-0 flex-1 items-center gap-3" data-testid="playback-bar">
          <PlayButton />
          <Scrubber labels={false} />
        </div>
        <div className="flex shrink-0 items-center" data-testid="scene-toolbar">
          <FocusButton />
        </div>
      </div>
    );
  }

  return (
    <div className="glass pointer-events-auto flex h-full items-center gap-2 px-3" data-testid="bottom-bar">
      <div className="flex h-full min-w-0 flex-1 items-center gap-2" data-testid="playback-bar">
        <label className="relative flex shrink-0 items-center" data-tip="Scenario" data-tip-pos="top">
          <select
            aria-label="Scenario"
            className="h-9 max-w-[clamp(150px,11vw,210px)] appearance-none truncate rounded-lg border border-line-strong bg-white/[0.06] pr-7 pl-3 text-[12.5px] font-medium text-navy outline-none hover:border-white/25 disabled:opacity-50 [&>option]:bg-[#0b1624] [&>option]:text-[#f2f6fa]"
            value={scenarioId}
            disabled={!!busy || scenarios.length === 0}
            onChange={(e) => {
              interruptDemo();
              void loadScenario(e.target.value as ScenarioId);
            }}
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
        <Sep />
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton tip="Reset to start" tipPos="top" onClick={playback.reset} disabled={!hasRun} data-testid="pb-reset">
            <SkipBack size={16} />
          </IconButton>
          <IconButton tip="Step back (←)" tipPos="top" onClick={() => playback.step(-1)} disabled={!hasRun} data-testid="pb-back">
            <StepBack size={16} />
          </IconButton>
          <PlayButton />
          <IconButton tip="Step forward (→)" tipPos="top" onClick={() => playback.step(1)} disabled={!hasRun} data-testid="pb-fwd">
            <StepForward size={16} />
          </IconButton>
        </div>
        <Scrubber />
        <label className="relative flex shrink-0 items-center" data-tip="Playback speed (simulated minutes per second)" data-tip-pos="top">
          <select
            aria-label="Playback speed"
            className="h-9 appearance-none rounded-lg border border-line-strong bg-white/[0.06] pr-6 pl-2.5 text-[12.5px] font-medium text-navy outline-none hover:border-white/25 [&>option]:bg-[#0b1624] [&>option]:text-[#f2f6fa]"
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
      <Sep />
      <div className="flex shrink-0 items-center gap-0.5" data-testid="scene-toolbar">
        <FocusButton />
        <Sep />
        {LAYER_BTNS.map(({ key, label, icon: Icon }) => (
          <IconButton key={key} tip={`${label} layer`} tipPos="top" active={layers[key]} onClick={() => toggleLayer(key)} data-testid={`layer-${key}`} compact>
            <Icon size={15} />
          </IconButton>
        ))}
        <Sep />
        <IconButton tip="Auto-orbit" tipPos="top" active={autoOrbit} onClick={() => setAutoOrbit(!autoOrbit)} data-testid="auto-orbit" compact>
          <Orbit size={15} />
        </IconButton>
        <IconButton tip="Reset camera" tipPos="top" onClick={() => requestCamera({ shot: 'home' })} data-testid="camera-reset" compact>
          <RotateCcw size={15} />
        </IconButton>
        <FocusMenu />
        <Sep />
        <button
          type="button"
          disabled={!hasRun}
          onClick={() => startDemo()}
          data-testid="demo-start"
          data-tip="Guided 3-minute story: fault, cascade, recovery, evidence"
          data-tip-pos="top"
          className={clsx(
            'flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold whitespace-nowrap transition-colors disabled:opacity-40',
            demoActive ? 'bg-white/10 text-navy' : 'bg-[#2A6CB5] text-white hover:bg-[#3a7cc6]',
          )}
        >
          <Clapperboard size={14} />
          <span className="compact:hidden">Cinematic Demo</span>
          <span className="hidden compact:inline">Demo</span>
        </button>
      </div>
    </div>
  );
}

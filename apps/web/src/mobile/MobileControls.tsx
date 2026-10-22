/**
 * Phone transport controls docked on top of the sheet: play / step, a scrubber whose event markers
 * collapse to dots with the latest passed event spelled out, the strategy switch, and an overflow
 * menu with scenario, speed, layers, camera, focus and the cinematic demo.
 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Building2, Clapperboard, Droplet, Maximize2, Minimize2, MoreHorizontal, Orbit, Pause, Play, RotateCcw, ScanEye, SkipBack, StepBack, StepForward, Tag, X, Zap } from 'lucide-react';
import clsx from 'clsx';
import type { ScenarioId, StrategyId } from '@encirra/shared';
import { useTwin, type Layers } from '@/state/store';
import { interruptDemo, playback, SPEEDS } from '@/playback/playback';
import { runMarks, STRATEGY_LABEL } from '@/data/selectors';
import { loadScenario } from '@/data/loader';
import { Segmented } from '@/ui/primitives';
import { startDemo } from '@/demo/demoController';
import { SHOTS } from '@/dashboard/BottomBar';

interface Mark {
  key: string;
  t: number;
  label: string;
  color: string;
}

function useMarks() {
  const run = useTwin((s) => s.run);
  const thr = useTwin((s) => s.topology?.water.serviceThresholdM ?? 20);
  return useMemo(() => {
    if (!run) return [];
    const m = runMarks(run, thr);
    const raw: Mark[] = [
      { key: 'fault', t: m.faultT, label: 'Fault', color: '#F04438' },
      { key: 'trip', t: m.pumpTripT, label: 'Pump trip', color: '#00BFEA' },
      { key: 'isolated', t: m.isolatedT, label: 'Isolated', color: '#9FB0C2' },
      { key: 'verified', t: m.verifiedT, label: 'Verified', color: '#6AA8EE' },
      { key: 'restored', t: m.restoredT, label: 'Restored', color: '#17A769' },
      { key: 'below', t: m.pressureBelowT, label: `Pressure < ${thr} m`, color: '#F04438' },
    ].filter((x): x is Mark => x.t != null);
    raw.sort((a, b) => a.t - b.t);
    const f = run.frames;
    const span = f[f.length - 1].t - f[0].t || 1;
    return raw.map((mk) => ({ ...mk, pct: ((mk.t - f[0].t) / span) * 100 }));
  }, [run, thr]);
}

export function MobileScrubber() {
  const run = useTwin((s) => s.run);
  const playhead = useTwin((s) => s.playhead);
  const marks = useMarks();
  const n = run?.frames.length ?? 1;
  const max = Math.max(1, n - 1);
  const pct = (playhead / max) * 100;
  const frame = run?.frames[Math.min(n - 1, Math.floor(playhead))];
  // latest passed events (those sharing a time are joined: "Fault · Pump trip")
  const passed = marks.filter((m) => frame && m.t <= frame.t + 1e-6);
  const lastT = passed.length ? passed[passed.length - 1].t : null;
  const latest = lastT == null ? null : passed.filter((m) => Math.abs(m.t - lastT) < 1);
  const next = marks.find((m) => frame && m.t > frame.t + 1e-6);
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-2 text-[12px] leading-none">
        <span className="font-semibold text-navy tabular" data-testid="playback-clock">
          {frame?.clock ?? '—'}
        </span>
        <span className="min-w-0 truncate text-right" data-testid="m-active-mark">
          {latest ? (
            <span className="font-semibold" style={{ color: latest[0].color }}>
              {latest.map((m) => m.label).join(' · ')}
            </span>
          ) : next ? (
            <span className="text-slate">Next: {next.label}</span>
          ) : (
            <span className="text-slate">Normal operation</span>
          )}
        </span>
      </div>
      <div className="relative mt-1.5 h-[28px]">
        <div className="pointer-events-none absolute inset-x-[9px] top-1/2 h-0">
          {marks.map((mk) => (
            <span
              key={mk.key}
              className="absolute top-[-4px] h-2 w-2 -translate-x-1/2 rounded-full ring-2 ring-[#0c1828]"
              style={{ left: `${mk.pct}%`, background: mk.color, opacity: frame && mk.t <= frame.t ? 1 : 0.55 }}
            />
          ))}
        </div>
        <input
          type="range"
          aria-label="Simulation time"
          className="enc-range m-range absolute inset-x-0 top-1/2 w-full -translate-y-1/2"
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
    </div>
  );
}

function RoundButton({ onClick, label, children, testId, primary, disabled }: { onClick: () => void; label: string; children: React.ReactNode; testId?: string; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      data-testid={testId}
      className={clsx(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95 disabled:opacity-40',
        primary ? 'bg-[#F2F6FA] text-[#0b1624] shadow-[0_4px_14px_-4px_rgba(0,0,0,0.5)]' : 'text-ink active:bg-white/10',
      )}
    >
      {children}
    </button>
  );
}

export function TransportRow({ compact = false }: { compact?: boolean }) {
  const playing = useTwin((s) => s.playing);
  const hasRun = useTwin((s) => !!s.run);
  return (
    <div className="flex items-center gap-1" data-testid="playback-bar">
      <RoundButton onClick={playback.toggle} label={playing ? 'Pause' : 'Play'} testId="pb-play" primary disabled={!hasRun}>
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-[2px]" />}
      </RoundButton>
      {!compact && (
        <>
          <RoundButton onClick={() => playback.step(-1)} label="Step back" testId="pb-back" disabled={!hasRun}>
            <StepBack size={18} />
          </RoundButton>
          <RoundButton onClick={() => playback.step(1)} label="Step forward" testId="pb-fwd" disabled={!hasRun}>
            <StepForward size={18} />
          </RoundButton>
        </>
      )}
      <div className="ml-1 min-w-0 flex-1">
        <MobileScrubber />
      </div>
    </div>
  );
}

export function StrategySwitch({ className }: { className?: string }) {
  const strategy = useTwin((s) => s.strategy);
  const switchStrategy = useTwin((s) => s.switchStrategy);
  const runs = useTwin((s) => s.runsByStrategy);
  return (
    <Segmented
      value={strategy}
      testId="m-strategy"
      size="md"
      stretch
      className={clsx('w-full min-w-0', className)}
      onChange={(v) => {
        interruptDemo();
        switchStrategy(v as StrategyId);
      }}
      options={(['none', 'grid-only', 'encirra'] as StrategyId[]).map((s) => ({ value: s, label: STRATEGY_LABEL[s], disabled: !runs[s] }))}
    />
  );
}

export function MoreButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="More controls"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line-strong text-navy active:bg-white/10"
      data-testid="m-more"
    >
      <MoreHorizontal size={20} />
    </button>
  );
}

export function StrategyRow({ onMore }: { onMore: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <StrategySwitch />
      </div>
      <MoreButton onClick={onMore} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────── overflow menu
const LAYERS: { key: keyof Layers; label: string; icon: typeof Zap }[] = [
  { key: 'electrical', label: 'Power', icon: Zap },
  { key: 'water', label: 'Water', icon: Droplet },
  { key: 'underground', label: 'X-ray', icon: ScanEye },
  { key: 'labels', label: 'Labels', icon: Tag },
  { key: 'skyline', label: 'Skyline', icon: Building2 },
];

export function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const scenarioId = useTwin((s) => s.scenarioId);
  const scenarios = useTwin((s) => s.scenarios);
  const busy = useTwin((s) => s.busy);
  const speed = useTwin((s) => s.speed);
  const layers = useTwin((s) => s.layers);
  const toggleLayer = useTwin((s) => s.toggleLayer);
  const autoOrbit = useTwin((s) => s.autoOrbit);
  const setAutoOrbit = useTwin((s) => s.setAutoOrbit);
  const requestCamera = useTwin((s) => s.requestCamera);
  const focus = useTwin((s) => s.focusTwin);
  const setFocus = useTwin((s) => s.setFocusTwin);
  const hasRun = useTwin((s) => !!s.run);
  const [shots, setShots] = useState(false);
  useEffect(() => {
    if (!open) setShots(false);
  }, [open]);
  const sel = 'h-11 w-full appearance-none rounded-xl border border-line-strong bg-white/[0.06] px-3 text-[14px] font-medium text-navy outline-none [&>option]:bg-[#0b1624] [&>option]:text-[#f2f6fa]';
  return (
    <AnimatePresence>
      {open && (
        <motion.div key="more" className="fixed inset-0 z-[44]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <div className="absolute inset-0 bg-[rgba(4,10,18,0.5)]" onClick={onClose} aria-hidden />
          <motion.div
            className="ui-dark glass-solid m-scroll absolute inset-x-0 bottom-0 max-h-[82dvh] rounded-t-[20px] border-t border-white/10 pb-[max(16px,env(safe-area-inset-bottom))] shadow-[0_-24px_60px_-20px_rgba(0,0,0,0.7)] landscape:mx-auto landscape:max-w-[560px]"
            initial={{ y: 40 }}
            animate={{ y: 0 }}
            exit={{ y: 40 }}
            transition={{ duration: 0.24, ease: [0.2, 0.7, 0.2, 1] }}
            role="dialog"
            aria-label="More controls"
            data-testid="m-more-sheet"
          >
            <div className="m-safe-x flex items-center justify-between pt-2">
              <span className="t-kicker">Controls</span>
              <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-xl text-navy active:bg-white/10" aria-label="Close controls">
                <X size={20} />
              </button>
            </div>
            <div className="m-safe-x grid gap-4">
              <div className="grid grid-cols-[1.5fr_1fr] gap-2">
                <label className="grid gap-1">
                  <span className="t-kicker">Scenario</span>
                  <select
                    aria-label="Scenario"
                    className={sel}
                    value={scenarioId}
                    disabled={!!busy || scenarios.length === 0}
                    onChange={(e) => {
                      interruptDemo();
                      void loadScenario(e.target.value as ScenarioId);
                      onClose();
                    }}
                    data-testid="scenario-select"
                  >
                    {scenarios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="t-kicker">Speed</span>
                  <select aria-label="Playback speed" className={sel} value={speed} onChange={(e) => playback.setSpeed(Number(e.target.value))} data-testid="speed-select">
                    {SPEEDS.map((v) => (
                      <option key={v} value={v}>
                        {v} min/s
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!hasRun}
                  onClick={() => {
                    onClose();
                    startDemo();
                  }}
                  className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#2A6CB5] text-[14px] font-semibold text-white active:bg-[#3a7cc6] disabled:opacity-40"
                  data-testid="demo-start"
                >
                  <Clapperboard size={17} /> Cinematic Demo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFocus(!focus);
                    onClose();
                  }}
                  className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line-strong text-[14px] font-semibold text-navy active:bg-white/10"
                  data-testid="focus-twin"
                  aria-pressed={focus}
                >
                  {focus ? <Minimize2 size={17} /> : <Maximize2 size={17} />} {focus ? 'Show dashboard' : 'Focus twin'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playback.reset();
                    onClose();
                  }}
                  disabled={!hasRun}
                  className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line-strong text-[14px] font-semibold text-navy active:bg-white/10 disabled:opacity-40"
                  data-testid="pb-reset"
                >
                  <SkipBack size={17} /> Reset to start
                </button>
                <button
                  type="button"
                  onClick={() => setAutoOrbit(!autoOrbit)}
                  aria-pressed={autoOrbit}
                  className={clsx('flex h-12 items-center justify-center gap-2 rounded-xl border text-[14px] font-semibold', autoOrbit ? 'border-transparent bg-[#F2F6FA] text-[#0b1624]' : 'border-line-strong text-navy active:bg-white/10')}
                  data-testid="auto-orbit"
                >
                  <Orbit size={17} /> Auto-orbit
                </button>
              </div>
              <div>
                <span className="t-kicker">Layers</span>
                <div className="mt-2 grid grid-cols-5 gap-1.5">
                  {LAYERS.map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleLayer(key)}
                      aria-pressed={layers[key]}
                      className={clsx('flex h-14 flex-col items-center justify-center gap-1 rounded-xl text-[12px] font-medium', layers[key] ? 'bg-white/[0.14] text-navy' : 'text-slate active:bg-white/10')}
                      data-testid={`layer-${key}`}
                    >
                      <Icon size={17} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="t-kicker">Camera</span>
                  <button type="button" onClick={() => requestCamera({ shot: 'home' })} className="flex h-11 items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-info" data-testid="camera-reset">
                    <RotateCcw size={15} /> Reset view
                  </button>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-1.5" data-testid="focus-menu" role="menu">
                  {(shots ? SHOTS : SHOTS.slice(0, 6)).map((s) => (
                    <button
                      key={s.shot}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        requestCamera({ shot: s.shot });
                        onClose();
                      }}
                      className="flex h-11 items-center rounded-xl bg-white/[0.04] px-3 text-left text-[13px] text-ink active:bg-white/10"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                {!shots && (
                  <button type="button" onClick={() => setShots(true)} className="mt-1 flex h-11 items-center text-[13px] font-semibold text-slate" data-testid="m-more-shots">
                    All {SHOTS.length} camera views
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

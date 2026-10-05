import { useEffect, useRef } from 'react';
import { Plus, Minus, RotateCcw, Crosshair, Maximize2, Minimize2, Radiation, FlaskConical, Biohazard, Bot, Wind, Grid3x3 } from 'lucide-react';
import * as THREE from 'three';
import { useUI, type LayerId } from '../../store/ui';
import { useSim } from '../../store/sim';
import { frameBus } from '../../three/frameBus';
import { focusOn, resetView, zoomBy } from '../../three/CameraRig';
import { IconButton, cx, Kbd } from '../ui/primitives';
import { compassLabel } from '../../utils/math';
import { CATEGORY_HEX } from '../ui/tone';
import { fmtClock } from '../../utils/format';

export const LAYER_DEFS: { id: LayerId; label: string; icon: typeof Radiation; color: string }[] = [
  { id: 'radiation', label: 'Radiation', icon: Radiation, color: CATEGORY_HEX.rad },
  { id: 'chemical', label: 'Chemical', icon: FlaskConical, color: CATEGORY_HEX.chem },
  { id: 'biological', label: 'Biological', icon: Biohazard, color: CATEGORY_HEX.bio },
  { id: 'assets', label: 'Assets', icon: Bot, color: '#4c94ff' },
  { id: 'weather', label: 'Weather', icon: Wind, color: '#bde9ff' },
  { id: 'zones', label: 'Zones', icon: Grid3x3, color: '#a7b1bb' },
];

export function LayerToggles({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const layers = useUI((s) => s.layers);
  const toggle = useUI((s) => s.toggleLayer);
  return (
    <div className="flex items-center gap-1" role="group" aria-label="3D layers">
      {LAYER_DEFS.map((l) => {
        const on = layers[l.id];
        const Icon = l.icon;
        return (
          <button
            key={l.id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(l.id)}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-[5px] border font-cond font-semibold uppercase tracking-[0.06em] transition-colors',
              size === 'sm' ? 'h-[22px] px-2 text-[10.5px]' : 'h-[26px] px-2.5 text-[11px]',
              on ? 'border-line-bright bg-surface-3 text-ink-1' : 'border-line bg-transparent text-ink-3 hover:text-ink-2',
            )}
            title={`${on ? 'Hide' : 'Show'} ${l.label.toLowerCase()} layer`}
          >
            <Icon size={12} strokeWidth={2} style={{ color: on ? l.color : undefined }} aria-hidden />
            <span className="max-[1500px]:sr-only">{l.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Compass() {
  const rose = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLDivElement>(null);
  const windDir = useRef(315);
  const weather = useSim((s) => s.weather);
  windDir.current = weather.windDir;
  useEffect(() => {
    const dir = new THREE.Vector3();
    return frameBus.onMain((f) => {
      f.camera.getWorldDirection(dir);
      const heading = (Math.atan2(dir.x, -dir.z) * 180) / Math.PI;
      if (rose.current) rose.current.style.transform = `rotate(${-heading}deg)`;
      if (arrow.current) arrow.current.style.transform = `rotate(${windDir.current + 180 - heading}deg)`;
    });
  }, []);
  return (
    <div className="pointer-events-auto flex items-center gap-2.5 rounded-[7px] border border-line-strong bg-surface-1/88 py-1.5 pl-1.5 pr-3 shadow-[0_6px_18px_rgb(0_0_0/0.35)]">
      <div className="relative h-[46px] w-[46px]">
        <div ref={rose} className="absolute inset-0">
          <svg viewBox="0 0 46 46" className="h-full w-full" aria-hidden>
            <circle cx="23" cy="23" r="21" fill="none" stroke="rgb(148 163 184 / 0.35)" strokeWidth="1" />
            {Array.from({ length: 24 }, (_, i) => {
              const a = (i * 15 * Math.PI) / 180;
              const r0 = i % 6 === 0 ? 16.5 : 18.5;
              return <line key={i} x1={23 + Math.sin(a) * r0} y1={23 - Math.cos(a) * r0} x2={23 + Math.sin(a) * 21} y2={23 - Math.cos(a) * 21} stroke="rgb(148 163 184 / 0.5)" strokeWidth={i % 6 === 0 ? 1.2 : 0.7} />;
            })}
            <path d="M23 3 L26 11 L23 9.6 L20 11 Z" fill="#f0534d" />
            <text x="23" y="19" textAnchor="middle" fontSize="7" fill="#ece7df" fontFamily="IBM Plex Sans Condensed" fontWeight="600">N</text>
          </svg>
        </div>
        <div ref={arrow} className="absolute inset-0">
          <svg viewBox="0 0 46 46" className="h-full w-full" aria-hidden>
            <line x1="23" y1="33" x2="23" y2="15" stroke="#bde9ff" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M23 12 L26.5 18 L19.5 18 Z" fill="#bde9ff" />
          </svg>
        </div>
      </div>
      <div className="flex flex-col leading-tight">
        <span className="font-cond text-[10px] uppercase tracking-[0.1em] text-ink-3">Wind</span>
        <span className="num text-[12.5px] font-medium text-ink-1">
          {Math.round(weather.windSpeed)} km/h {compassLabel(weather.windDir)}
        </span>
        <span className="num text-[10.5px] text-ink-3">
          {weather.temperature.toFixed(1)} °C · {Math.round(weather.humidity)}% RH
        </span>
      </div>
    </div>
  );
}

function Legend() {
  const layers = useUI((s) => s.layers);
  const run = useSim((s) => s.run);
  const showRad = layers.radiation && (run?.preset === 'radiological' || run?.preset === 'multi');
  const showChem = layers.chemical && run?.preset === 'chemical';
  const showBio = layers.biological && run?.preset === 'biological';
  if (!showRad && !showChem && !showBio) return null;
  return (
    <div className="pointer-events-auto flex flex-col gap-1.5 rounded-[7px] border border-line-strong bg-surface-1/88 px-2.5 py-2 shadow-[0_6px_18px_rgb(0_0_0/0.35)]">
      {showRad && (
        <div className="w-[168px]">
          <div className="flex justify-between font-cond text-[10px] uppercase tracking-[0.1em] text-ink-3">
            <span>Gamma dose rate</span>
            <span>µSv/h</span>
          </div>
          <div className="mt-1 h-[6px] rounded-full" style={{ background: 'linear-gradient(90deg, rgba(255,214,102,0.15), #ffd166 25%, #ff8a3d 60%, #e0342c)' }} />
          <div className="mono mt-0.5 flex justify-between text-[9.5px] text-ink-3">
            <span>0.10</span>
            <span>0.20</span>
            <span>0.30+</span>
          </div>
        </div>
      )}
      {showChem && (
        <div className="w-[168px]">
          <div className="flex justify-between font-cond text-[10px] uppercase tracking-[0.1em] text-ink-3">
            <span>VOC plume (model)</span>
            <span>ppm</span>
          </div>
          <div className="mt-1 h-[6px] rounded-full" style={{ background: 'linear-gradient(90deg, rgba(45,212,191,0.12), #2dd4bf 50%, #b5ffe3)' }} />
          <div className="mono mt-0.5 flex justify-between text-[9.5px] text-ink-3">
            <span>0.4</span>
            <span>1.0</span>
            <span>2.0+</span>
          </div>
        </div>
      )}
      {showBio && (
        <div className="w-[168px]">
          <div className="flex justify-between font-cond text-[10px] uppercase tracking-[0.1em] text-ink-3">
            <span>Aerosol screening</span>
            <span>index</span>
          </div>
          <div className="mt-1 h-[6px] rounded-full" style={{ background: 'linear-gradient(90deg, rgba(110,193,245,0.12), #6ec1f5 60%, #d9f1ff)' }} />
        </div>
      )}
    </div>
  );
}

function ReplayChip() {
  const pb = useUI((s) => s.playback);
  if (pb.mode !== 'replay') return null;
  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-[6px] border border-amber/50 bg-[rgb(242_179_61/0.12)] px-2.5 py-1">
      <span className="h-1.5 w-1.5 rounded-full bg-amber animate-blink" aria-hidden />
      <span className="font-cond text-[11px] font-semibold uppercase tracking-[0.1em] text-amber">Replay</span>
      <span className="mono text-[11px] text-ink-1">{fmtClock(pb.cursor)}</span>
      <button type="button" className="ctl h-[20px]" onClick={() => useUI.getState().goLive()}>
        Live
      </button>
    </div>
  );
}

export function TwinHud({
  expandable = true,
  showLegend = true,
  leftInset = 10,
  rightInset = 10,
  bottomInset = 10,
}: {
  expandable?: boolean;
  showLegend?: boolean;
  leftInset?: number;
  rightInset?: number;
  bottomInset?: number;
}) {
  const selection = useUI((s) => s.selection);
  const screen = useUI((s) => s.screen);
  const immersive = useUI((s) => s.twinImmersive);
  return (
    <>
      <div className="pointer-events-none absolute top-2.5 z-10 flex flex-col gap-1" style={{ left: leftInset }}>
        <div className="pointer-events-auto flex flex-col gap-1 rounded-[7px] border border-line-strong bg-surface-1/88 p-1 shadow-[0_6px_18px_rgb(0_0_0/0.35)]">
          <IconButton icon={Plus} label="Zoom in" onClick={() => zoomBy(0.35)} size={26} />
          <IconButton icon={Minus} label="Zoom out" onClick={() => zoomBy(-0.5)} size={26} />
          <IconButton icon={RotateCcw} label="Reset view" onClick={resetView} size={26} />
          <IconButton icon={Crosshair} label="Focus selection" onClick={() => selection && focusOn(selection)} size={26} disabled={!selection} />
          {expandable && (
            <IconButton
              icon={screen === 'twin' && immersive ? Minimize2 : Maximize2}
              label={screen === 'twin' && immersive ? 'Exit fullscreen' : 'Fullscreen twin'}
              onClick={() => {
                const ui = useUI.getState();
                if (ui.screen !== 'twin') {
                  ui.setScreen('twin');
                  ui.setTwinImmersive(true);
                } else ui.setTwinImmersive(!ui.twinImmersive);
                if (!document.fullscreenElement && !(ui.screen === 'twin' && ui.twinImmersive === false)) {
                  document.documentElement.requestFullscreen?.().catch(() => undefined);
                } else if (document.fullscreenElement) {
                  document.exitFullscreen?.().catch(() => undefined);
                }
              }}
              size={26}
            />
          )}
        </div>
      </div>
      <div className="pointer-events-none absolute top-2.5 z-10 flex flex-col items-end gap-2" style={{ right: rightInset }}>
        <Compass />
        <ReplayChip />
      </div>
      <div className="pointer-events-none absolute z-10 flex items-end gap-2" style={{ left: leftInset, bottom: bottomInset }}>
        <span className="rounded-[4px] border border-line bg-surface-1/80 px-2 py-[3px] font-cond text-[10px] uppercase tracking-[0.12em] text-ink-3">Generalized site layout</span>
        <span className="flex items-center gap-1 rounded-[4px] border border-line bg-surface-1/80 px-1.5 py-[2px] text-[10px] text-ink-3 max-[1500px]:hidden" title="Keyboard navigation: W A S D move, Q / E height, Shift faster">
          <Kbd>W</Kbd>
          <Kbd>A</Kbd>
          <Kbd>S</Kbd>
          <Kbd>D</Kbd>
          <span className="ml-0.5">move</span>
          <Kbd>Q</Kbd>
          <Kbd>E</Kbd>
          <span>height</span>
        </span>
      </div>
      {showLegend && (
        <div className="pointer-events-none absolute z-10" style={{ right: rightInset, bottom: bottomInset }}>
          <Legend />
        </div>
      )}
    </>
  );
}

import { useMemo, useRef, useState } from 'react';
import { Play, Pause, Radio, Clock } from 'lucide-react';
import { useSim } from '../../store/sim';
import { useUI } from '../../store/ui';
import { Segmented, cx, useNow } from '../../components/ui/primitives';
import { CATEGORY_HEX, SEVERITY_TONE, TONE_HEX } from '../../components/ui/tone';
import { fmtClock, fmtClockShort } from '../../utils/format';
import { engine } from '../../simulation/engine';
import { focusOn } from '../../three/CameraRig';

const RANGE_MIN = 15;

export function Timeline() {
  const events = useSim((s) => s.events);
  const incidents = useSim((s) => s.incidents);
  const pb = useUI((s) => s.playback);
  const setPlayback = useUI((s) => s.setPlayback);
  const goLive = useUI((s) => s.goLive);
  const now = useNow(1000);
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const to = now;
  const from = Math.max(engine.bootTime - 1800 * 1000, to - RANGE_MIN * 60_000);
  const pct = (t: number) => ((t - from) / (to - from)) * 100;
  const cursor = pb.mode === 'live' ? to : pb.cursor;

  const ticks = useMemo(() => {
    const step = 60_000;
    const out: number[] = [];
    for (let t = Math.ceil(from / step) * step; t <= to; t += step) out.push(t);
    return out;
  }, [from, to]);

  const timeAt = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r) return to;
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return from + f * (to - from);
  };
  const scrub = (clientX: number) => {
    const t = timeAt(clientX);
    if (to - t < 1500) goLive();
    else setPlayback({ mode: 'replay', cursor: t, playing: false });
  };

  const visibleEvents = events.filter((e) => e.t >= from && e.category !== 'system');
  const color = (c: string) => (c === 'asset' ? '#4c94ff' : c === 'ai' ? '#b4a8ff' : CATEGORY_HEX[c as keyof typeof CATEGORY_HEX] ?? '#a7b1bb');

  return (
    <div className="flex h-full items-stretch gap-3 px-3 py-2.5">
      <div className="flex w-[218px] shrink-0 flex-col justify-between">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-ink-3" aria-hidden />
          <span className="panel-title">Timeline</span>
          {pb.mode === 'live' ? (
            <span className="ml-auto inline-flex items-center gap-1 font-cond text-[10.5px] font-semibold uppercase tracking-[0.1em] text-green">
              <span className="h-[6px] w-[6px] rounded-full bg-green" aria-hidden /> Live
            </span>
          ) : (
            <span className="ml-auto inline-flex items-center gap-1 font-cond text-[10.5px] font-semibold uppercase tracking-[0.1em] text-amber">
              <span className="h-[6px] w-[6px] rounded-full bg-amber animate-blink" aria-hidden /> Replay
            </span>
          )}
        </div>
        <div className="mono text-[20px] font-medium leading-none text-ink-1">
          {fmtClock(cursor)} <span className="text-[11px] text-ink-3">GST</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="ctl ctl-icon"
            aria-label={pb.playing ? 'Pause replay' : 'Play replay'}
            onClick={() => {
              if (pb.mode === 'live') setPlayback({ mode: 'replay', cursor: to - 5 * 60_000, playing: true });
              else setPlayback({ playing: !pb.playing });
            }}
          >
            {pb.playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <Segmented
            label="Playback speed"
            value={String(pb.speed) as '1' | '2' | '4'}
            onChange={(v) => setPlayback({ speed: Number(v) as 1 | 2 | 4 })}
            options={[
              { value: '1', label: '1×' },
              { value: '2', label: '2×' },
              { value: '4', label: '4×' },
            ]}
          />
          <button type="button" className="ctl ml-auto" data-active={pb.mode === 'live'} onClick={goLive}>
            <Radio size={12} /> Live
          </button>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={trackRef}
          className="relative mt-1 h-[52px] cursor-pointer rounded-[5px] bg-[rgb(148_163_184/0.06)]"
          role="slider"
          aria-label="Timeline scrubber"
          aria-valuemin={from}
          aria-valuemax={to}
          aria-valuenow={cursor}
          aria-valuetext={fmtClock(cursor)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setPlayback({ mode: 'replay', cursor: Math.max(from, cursor - 10_000), playing: false });
            if (e.key === 'ArrowRight') {
              const t = cursor + 10_000;
              if (t >= to - 1000) goLive();
              else setPlayback({ mode: 'replay', cursor: t, playing: false });
            }
          }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            setDrag(true);
            scrub(e.clientX);
          }}
          onPointerMove={(e) => {
            setHover(timeAt(e.clientX));
            if (drag) scrub(e.clientX);
          }}
          onPointerUp={() => setDrag(false)}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <span key={t} className="absolute top-0 h-full w-px bg-[rgb(148_163_184/0.1)]" style={{ left: `${pct(t)}%` }} />
          ))}
          {/* incident spans */}
          {incidents
            .filter((i) => (i.resolvedAt ?? to) >= from)
            .map((i, k) => (
              <span
                key={i.id}
                className="absolute h-[6px] rounded-full"
                style={{
                  left: `${Math.max(0, pct(i.createdAt))}%`,
                  width: `${Math.max(0.6, pct(i.resolvedAt ?? to) - Math.max(0, pct(i.createdAt)))}%`,
                  bottom: 6 + (k % 2) * 8,
                  background: TONE_HEX[SEVERITY_TONE[i.severity]],
                  opacity: i.status === 'resolved' ? 0.45 : 0.9,
                }}
                title={`${i.id} · ${i.title}`}
              />
            ))}
          {/* event ticks */}
          {visibleEvents.map((e) => (
            <span
              key={e.id}
              className="absolute top-[6px] h-[18px] w-[2px] rounded-full"
              style={{ left: `${pct(e.t)}%`, background: color(e.category), opacity: e.tone === 'info' || e.tone === 'ok' ? 0.55 : 1 }}
              title={`${fmtClock(e.t)} · ${e.title}`}
            />
          ))}
          {hover !== null && !drag && <span className="pointer-events-none absolute top-0 h-full w-px bg-ink-2/50" style={{ left: `${pct(hover)}%` }} />}
          <span className={cx('pointer-events-none absolute top-[-3px] h-[calc(100%+6px)] w-[2px] rounded-full', pb.mode === 'live' ? 'bg-green' : 'bg-amber')} style={{ left: `calc(${pct(cursor)}% - 1px)` }}>
            <span className={cx('absolute -top-[3px] left-1/2 h-[8px] w-[8px] -translate-x-1/2 rotate-45 rounded-[1px]', pb.mode === 'live' ? 'bg-green' : 'bg-amber')} />
          </span>
        </div>
        <div className="relative mt-1 h-[14px]">
          {ticks
            .filter((_, i) => i % 2 === 0)
            .map((t) => (
              <span key={t} className="mono absolute -translate-x-1/2 text-[9.5px] text-ink-3" style={{ left: `${pct(t)}%` }}>
                {fmtClockShort(t)}
              </span>
            ))}
        </div>
      </div>

      <div className="flex w-[250px] shrink-0 flex-col">
        <span className="micro">Incident history</span>
        <div className="mt-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {incidents.length === 0 && <span className="text-[11px] text-ink-3">No incidents in the retained window.</span>}
          {incidents.slice(0, 4).map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => {
                setPlayback({ mode: 'replay', cursor: i.createdAt - 8000, playing: true });
                focusOn({ kind: 'location', x: i.location.x, z: i.location.z, radius: 120 });
              }}
              className="flex items-center gap-2 rounded-[4px] px-1.5 py-[3px] text-left hover:bg-surface-3"
              title="Replay from incident start"
            >
              <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: TONE_HEX[SEVERITY_TONE[i.severity]], opacity: i.status === 'resolved' ? 0.5 : 1 }} />
              <span className="mono text-[10.5px] text-ink-2">{i.id}</span>
              <span className="min-w-0 truncate text-[10.5px] text-ink-3">{i.status === 'resolved' ? 'Resolved' : fmtClock(i.createdAt)}</span>
              <Play size={10} className="ml-auto shrink-0 text-ink-3" aria-hidden />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSim } from '../../store/sim';
import { history } from '../../simulation/history';
import type { Observation } from '../../types';
import { fmtClock, fmtClockShort } from '../../utils/format';

const ACCENT = '#b4a8ff';

/** Confidence (0–100 %) of one AI observation over time, with evidence milestones. */
export function ConfidenceChart({ obs }: { obs: Observation }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const version = useSim((s) => s.historyVersion);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const series = useMemo(() => {
    const s = history.get(`obs:${obs.id}`);
    if (!s) return { t: [] as number[], v: [] as number[] };
    return s.slice(obs.createdAt - 1000);
  }, [version, obs.id, obs.createdAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const padL = 34;
  const padR = 10;
  const padT = 10;
  const padB = 20;
  const W = size.w;
  const H = size.h;
  const t0 = obs.createdAt - 5000;
  const t1 = Math.max(Date.now(), t0 + 60_000);
  const x = (t: number) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v) * (H - padT - padB);
  const path = series.t.map((t, i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(series.v[i]).toFixed(1)}`).join('');
  const area = series.t.length > 1 ? `${path}L${x(series.t[series.t.length - 1]).toFixed(1)},${y(0)}L${x(series.t[0]).toFixed(1)},${y(0)}Z` : '';
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const timeTicks = useMemo(() => {
    const span = t1 - t0;
    const step = span > 600_000 ? 120_000 : span > 240_000 ? 60_000 : 30_000;
    const out: number[] = [];
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) out.push(t);
    return out;
  }, [t0, t1]);
  const hv = hover !== null && series.t.length ? (() => {
    let best = 0;
    for (let i = 0; i < series.t.length; i++) if (Math.abs(series.t[i] - hover) < Math.abs(series.t[best] - hover)) best = i;
    return { t: series.t[best], v: series.v[best] };
  })() : null;

  return (
    <div ref={ref} className="relative h-full w-full" onMouseLeave={() => setHover(null)}>
      {W > 0 && (
        <svg
          width={W}
          height={H}
          role="img"
          aria-label={`Confidence timeline for ${obs.id}`}
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = e.clientX - r.left;
            if (px < padL || px > W - padR) return setHover(null);
            setHover(t0 + ((px - padL) / (W - padL - padR)) * (t1 - t0));
          }}
        >
          <defs>
            <linearGradient id="conf-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={ACCENT} stopOpacity="0.24" />
              <stop offset="1" stopColor={ACCENT} stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="rgb(148 163 184 / 0.09)" />
              <text x={padL - 6} y={y(v) + 3} fontSize="9.5" textAnchor="end" fill="#75818e" className="mono">
                {Math.round(v * 100)}
              </text>
            </g>
          ))}
          <line x1={padL} x2={W - padR} y1={y(0.85)} y2={y(0.85)} stroke="#f2b33d" strokeOpacity="0.55" strokeDasharray="3 3" />
          {/* left end, under the line: confidence usually starts low, so the label stays clear of the series */}
          <text x={padL + 5} y={y(0.85) + 11} fontSize="9" fill="#a9b3be" stroke="#121922" strokeWidth="3" paintOrder="stroke" className="font-cond">
            human validation threshold
          </text>
          {timeTicks.map((t) => (
            <text key={t} x={x(t)} y={H - 5} fontSize="9.5" textAnchor="middle" fill="#75818e" className="mono">
              {t1 - t0 > 600_000 ? fmtClockShort(t) : fmtClock(t)}
            </text>
          ))}
          {area && <path d={area} fill="url(#conf-fill)" />}
          <path d={path} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinejoin="round" />
          {obs.evidence.map((e) => (
            <g key={e.id}>
              <line x1={x(e.t)} x2={x(e.t)} y1={padT} y2={H - padB} stroke="rgb(236 231 223 / 0.18)" strokeDasharray="2 3" />
              <circle cx={x(e.t)} cy={padT + 2} r="3.5" fill="#121922" stroke={ACCENT} strokeWidth="1.5">
                <title>{`${fmtClock(e.t)} · ${e.source}: ${e.summary}`}</title>
              </circle>
            </g>
          ))}
          {hv && (
            <g pointerEvents="none">
              <line x1={x(hv.t)} x2={x(hv.t)} y1={padT} y2={H - padB} stroke="rgb(236 231 223 / 0.45)" />
              <circle cx={x(hv.t)} cy={y(hv.v)} r="4" fill={ACCENT} stroke="#0b0f14" strokeWidth="2" />
            </g>
          )}
        </svg>
      )}
      {hv && (
        <div className="pointer-events-none absolute top-1 rounded-[5px] border border-line-strong bg-surface-2/95 px-2 py-1 text-[11px]" style={{ left: Math.min(W - 120, x(hv.t) + 10) }}>
          <span className="mono text-ink-3">{fmtClock(hv.t)}</span> <span className="num ml-1 font-semibold text-ink-1">{Math.round(hv.v * 100)}%</span>
        </div>
      )}
    </div>
  );
}

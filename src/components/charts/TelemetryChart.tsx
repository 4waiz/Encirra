import { useEffect, useMemo, useRef, useState } from 'react';
import { useSim } from '../../store/sim';
import { useUI } from '../../store/ui';
import { history } from '../../simulation/history';
import { CATEGORY_HEX } from '../ui/tone';
import { fmtClock, fmtClockShort } from '../../utils/format';

export interface LaneDef {
  key: 'chem' | 'bio' | 'rad';
  series: string;
  label: string;
  short: string;
  unit: string;
  color: string;
  decimals: number;
  threshold: number;
  floor: [number, number];
}

export const LANES: LaneDef[] = [
  { key: 'chem', series: 'voc', label: 'Chemical · VOC (site max)', short: 'C', unit: 'ppm', color: CATEGORY_HEX.chem, decimals: 2, threshold: 0.8, floor: [0.3, 0.9] },
  { key: 'bio', series: 'aerosol', label: 'Biological · aerosol index', short: 'B', unit: 'idx', color: CATEGORY_HEX.bio, decimals: 0, threshold: 30, floor: [0, 34] },
  { key: 'rad', series: 'gamma', label: 'Radiological · gamma (site max)', short: 'R', unit: 'µSv/h', color: CATEGORY_HEX.rad, decimals: 3, threshold: 0.18, floor: [0.06, 0.2] },
];

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function sliceSeries(key: string, from: number, to: number, maxPts: number) {
  const s = history.get(key);
  if (!s) return { t: [] as number[], v: [] as number[] };
  const raw = s.slice(from);
  const t: number[] = [];
  const v: number[] = [];
  const step = Math.max(1, Math.floor(raw.t.length / maxPts));
  for (let i = 0; i < raw.t.length; i += step) {
    if (raw.t[i] > to) break;
    // keep local peaks when decimating so short spikes never disappear
    let peak = raw.v[i];
    for (let k = 1; k < step && i + k < raw.v.length; k++) if (raw.v[i + k] > peak) peak = raw.v[i + k];
    t.push(raw.t[i]);
    v.push(peak);
  }
  return { t, v };
}

export function TelemetryChart({ lanes = LANES, compact }: { lanes?: LaneDef[]; compact?: boolean }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const version = useSim((s) => s.historyVersion);
  const tel = useUI((s) => s.telemetry);
  const playback = useUI((s) => s.playback);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const now = tel.paused && tel.pausedAt ? tel.pausedAt : Date.now();
  const from = now - tel.range * 60_000;
  const visible = lanes.filter((l) => tel.series[l.key]);

  const padL = 44;
  const padR = 56;
  const axisH = 18;
  const gap = 6;
  const W = Math.max(0, size.w);
  const H = Math.max(0, size.h);
  const plotW = Math.max(10, W - padL - padR);
  const laneH = visible.length ? Math.max(18, (H - axisH - gap * (visible.length - 1)) / visible.length) : 0;
  const x = (t: number) => padL + ((t - from) / (now - from)) * plotW;

  const data = useMemo(
    () =>
      visible.map((l) => {
        const s = sliceSeries(l.series, from, now, Math.max(60, Math.floor(plotW / 2)));
        const finite = s.v.filter((v) => Number.isFinite(v));
        const peak = finite.length ? Math.max(...finite) : l.floor[1];
        const low = finite.length ? Math.min(...finite) : l.floor[0];
        const lo = Math.min(l.floor[0], low);
        const hi = Math.max(l.floor[1], peak * 1.12, l.threshold * 1.15);
        return { lane: l, ...s, lo, hi };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, tel.range, tel.paused, tel.pausedAt, visible.map((l) => l.key).join(), plotW],
  );

  const ticks = useMemo(() => {
    const stepMin = tel.range <= 5 ? 1 : tel.range <= 15 ? 2.5 : 5;
    const step = stepMin * 60_000;
    const out: number[] = [];
    for (let t = Math.ceil(from / step) * step; t <= now; t += step) out.push(t);
    return out;
  }, [from, now, tel.range]);

  const hoverT = hoverX !== null ? from + ((hoverX - padL) / plotW) * (now - from) : null;
  const valueAt = (d: (typeof data)[number], t: number) => {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < d.t.length; i++) {
      const dd = Math.abs(d.t[i] - t);
      if (dd < bd) (bd = dd), (best = i);
    }
    return best >= 0 ? { v: d.v[best], t: d.t[best] } : null;
  };

  return (
    <div ref={ref} className="relative h-full w-full select-none" onMouseLeave={() => setHoverX(null)}>
      {W > 0 && H > 0 && (
        <svg
          width={W}
          height={H}
          className="block"
          role="img"
          aria-label={`CBRN telemetry, last ${tel.range} minutes`}
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = e.clientX - r.left;
            setHoverX(px >= padL && px <= padL + plotW ? px : null);
          }}
        >
          {data.map((d, li) => {
            const top = li * (laneH + gap);
            const y = (v: number) => top + laneH - ((v - d.lo) / (d.hi - d.lo)) * laneH;
            const pts: string[] = [];
            let path = '';
            let pen = false;
            d.t.forEach((t, i) => {
              const v = d.v[i];
              if (!Number.isFinite(v)) {
                pen = false;
                return;
              }
              const px = x(t).toFixed(1);
              const py = y(v).toFixed(1);
              path += `${pen ? 'L' : 'M'}${px},${py}`;
              pen = true;
              pts.push(`${px},${py}`);
            });
            const last = [...d.v].reverse().find((v) => Number.isFinite(v));
            const lastY = last !== undefined ? y(last) : top + laneH / 2;
            const area = pts.length > 1 ? `M${pts[0].split(',')[0]},${top + laneH} L${pts.join(' L')} L${pts[pts.length - 1].split(',')[0]},${top + laneH} Z` : '';
            const ty = y(d.lane.threshold);
            const gid = `tg-${d.lane.key}`;
            return (
              <g key={d.lane.key}>
                <defs>
                  <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor={d.lane.color} stopOpacity="0.22" />
                    <stop offset="1" stopColor={d.lane.color} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <rect x={padL} y={top} width={plotW} height={laneH} fill="rgb(148 163 184 / 0.035)" rx="3" />
                {[0.5].map((f) => (
                  <line key={f} x1={padL} x2={padL + plotW} y1={top + laneH * f} y2={top + laneH * f} stroke="rgb(148 163 184 / 0.08)" />
                ))}
                {ty > top && ty < top + laneH && (
                  <>
                    <line x1={padL} x2={padL + plotW} y1={ty} y2={ty} stroke="#f2b33d" strokeOpacity="0.55" strokeDasharray="3 3" />
                    {!compact && laneH > 30 && (
                      <text x={padL + 5} y={ty - 3} fontSize="9" fill="#a9b3be" className="font-cond">
                        review {d.lane.threshold}
                      </text>
                    )}
                  </>
                )}
                {area && <path d={area} fill={`url(#${gid})`} />}
                <path d={path} fill="none" stroke={d.lane.color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
                {last !== undefined && <circle cx={padL + plotW} cy={lastY} r="2.6" fill={d.lane.color} stroke="#121922" strokeWidth="1.5" />}
                {/* lane label (identity: swatch + text in ink) */}
                <g transform={`translate(4, ${top + 2})`}>
                  <rect width="3" height={Math.min(laneH - 4, 24)} rx="1.5" fill={d.lane.color} />
                  <text x="8" y="9" fontSize="10.5" fontWeight="600" fill="#ece7df" className="font-cond">
                    {d.lane.short}
                  </text>
                  <text x="8" y="20" fontSize="8.5" fill="#75818e" className="font-cond">
                    {d.lane.unit}
                  </text>
                </g>
                <text x={padL + plotW + 8} y={Math.max(top + 11, Math.min(top + laneH - 2, lastY + 4))} fontSize="11.5" fill="#ece7df" className="num" fontWeight="600">
                  {last !== undefined ? last.toFixed(d.lane.decimals) : '—'}
                </text>
              </g>
            );
          })}
          {/* time axis */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={0} y2={H - axisH + 2} stroke="rgb(148 163 184 / 0.07)" />
              <text x={x(t)} y={H - 4} fontSize="9.5" fill="#75818e" textAnchor="middle" className="mono">
                {fmtClockShort(t)}
              </text>
            </g>
          ))}
          {playback.mode === 'replay' && playback.cursor >= from && playback.cursor <= now && (
            <line x1={x(playback.cursor)} x2={x(playback.cursor)} y1={0} y2={H - axisH} stroke="#f2b33d" strokeWidth="1.5" />
          )}
          {hoverT !== null && hoverX !== null && (
            <g pointerEvents="none">
              <line x1={hoverX} x2={hoverX} y1={0} y2={H - axisH} stroke="rgb(236 231 223 / 0.45)" strokeWidth="1" />
              {data.map((d, li) => {
                const top = li * (laneH + gap);
                const hv = valueAt(d, hoverT);
                if (!hv || !Number.isFinite(hv.v)) return null;
                const cy = top + laneH - ((hv.v - d.lo) / (d.hi - d.lo)) * laneH;
                return <circle key={d.lane.key} cx={x(hv.t)} cy={cy} r="3.5" fill={d.lane.color} stroke="#0b0f14" strokeWidth="2" />;
              })}
            </g>
          )}
        </svg>
      )}
      {hoverT !== null && hoverX !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-[150px] rounded-[6px] border border-line-strong bg-surface-2/96 px-2.5 py-1.5 shadow-[0_8px_22px_rgb(0_0_0/0.45)]"
          style={{ left: hoverX > W - 200 ? hoverX - 162 : hoverX + 12 }}
        >
          <div className="mono text-[10.5px] text-ink-3">{fmtClock(hoverT)} GST</div>
          {data.map((d) => {
            const hv = valueAt(d, hoverT);
            return (
              <div key={d.lane.key} className="mt-0.5 flex items-center gap-2 text-[11px]">
                <span className="h-[8px] w-[8px] rounded-[2px]" style={{ background: d.lane.color }} />
                <span className="text-ink-2">{d.lane.label.split(' · ')[0]}</span>
                <span className="num ml-auto font-medium text-ink-1">
                  {hv && Number.isFinite(hv.v) ? hv.v.toFixed(d.lane.decimals) : '—'} <span className="text-ink-3">{d.lane.unit}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {!visible.length && <div className="absolute inset-0 flex items-center justify-center text-label text-ink-3">All series hidden — enable a series above.</div>}
      {/* screen-reader table of the latest values */}
      <table className="sr-only">
        <caption>Latest synthetic telemetry values</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.lane.key}>
              <th scope="row">{d.lane.label}</th>
              <td>
                {[...d.v].reverse().find((v) => Number.isFinite(v))?.toFixed(d.lane.decimals) ?? '—'} {d.lane.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

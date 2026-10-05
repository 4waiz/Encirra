import { X, ArrowUpRight } from 'lucide-react';
import { SENSOR_BY_ID, SENSOR_KIND_LABEL } from '../../simulation/sensors';
import { useSim } from '../../store/sim';
import { useUI } from '../../store/ui';
import { history } from '../../simulation/history';
import { Chip, Sparkline } from '../ui/primitives';
import { SENSOR_STATUS_LABEL, SENSOR_STATUS_TONE, TONE_HEX } from '../ui/tone';
import { fmtClock, fmtNum, fmtSigned } from '../../utils/format';
import { SENSOR_COLOR } from './TwinMarkers';

/** Compact telemetry callout anchored to the selected sensor (overview twin). */
export function SensorCallout({ id, setRef }: { id: string; setRef: (el: HTMLElement | null) => void }) {
  const def = SENSOR_BY_ID[id];
  const st = useSim((s) => s.sensors[id]);
  useSim((s) => s.historyVersion);
  if (!def) return null;
  const status = st?.status ?? 'online';
  const tone = SENSOR_STATUS_TONE[status];
  const series = history.get(`sensor:${id}`);
  const data = series ? series.tail(900).filter((_, i) => i % 6 === 0) : [];
  const dec = def.kind === 'rad' ? 3 : def.kind === 'chem' ? 2 : def.kind === 'met' ? 1 : 0;
  return (
    <div ref={setRef} className="group pointer-events-none absolute left-0 top-0 z-20 will-change-transform" style={{ visibility: 'hidden' }} data-side="right">
      <svg className="absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden>
        <line x1="0" y1="-30" x2="30" y2="-62" stroke={TONE_HEX[tone]} strokeOpacity="0.7" strokeWidth="1" className="group-data-[side=left]:hidden" />
        <line x1="0" y1="-30" x2="-30" y2="-62" stroke={TONE_HEX[tone]} strokeOpacity="0.7" strokeWidth="1" className="hidden group-data-[side=left]:block" />
      </svg>
      <div
        className="pointer-events-auto absolute top-[-150px] left-[30px] w-[248px] rounded-[7px] border border-line-strong bg-surface-1/96 p-2.5 shadow-[0_12px_32px_rgb(0_0_0/0.5)] group-data-[side=left]:left-auto group-data-[side=left]:right-[30px] group-data-[vside=below]:top-[14px]"
        role="dialog"
        aria-label={`${id} telemetry`}
      >
        <div className="flex items-center gap-2">
          <span className="mono text-[12px] font-medium text-ink-1">{id}</span>
          <span className="truncate text-[10.5px] text-ink-3">{SENSOR_KIND_LABEL[def.kind]}</span>
          <button type="button" className="ml-auto text-ink-3 hover:text-ink-1" onClick={() => useUI.getState().select(null)} aria-label="Close callout">
            <X size={13} />
          </button>
        </div>
        <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-[3px] text-[11px]">
          <span className="text-ink-3">Status</span>
          <span style={{ color: TONE_HEX[tone] }}>{SENSOR_STATUS_LABEL[status]}</span>
          <span className="text-ink-3">Reading</span>
          <span className="num text-ink-1">
            <span className="text-[13px] font-semibold" style={{ color: status === 'online' ? 'var(--color-ink-1)' : TONE_HEX[tone] }}>
              {fmtNum(st?.value ?? null, dec)}
            </span>{' '}
            <span className="text-ink-3">{def.unit}</span>
          </span>
          <span className="text-ink-3">Trend (5 min)</span>
          <span className="num text-ink-1">{st ? `${fmtSigned(st.trend, 1)}%` : '—'}</span>
          <span className="text-ink-3">Last update</span>
          <span className="mono text-ink-2">{st ? fmtClock(st.updatedAt) : '—'}</span>
        </div>
        <div className="mt-2 rounded-[4px] bg-bg-1/70 px-1.5 pt-1">
          <Sparkline data={data} color={SENSOR_COLOR[def.kind]} height={30} threshold={def.kind === 'met' ? undefined : def.reviewAt} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Chip tone={tone}>{status === 'online' ? 'Within band' : status === 'offline' ? 'Stale' : 'Review'}</Chip>
          <button
            type="button"
            className="ctl ml-auto h-[22px]"
            onClick={() => {
              useUI.getState().setScreen('twin');
            }}
          >
            Inspect <ArrowUpRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

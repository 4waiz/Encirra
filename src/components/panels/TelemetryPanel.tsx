import { Activity, Pause, Play } from 'lucide-react';
import { useUI } from '../../store/ui';
import { Panel, Segmented, IconButton } from '../ui/primitives';
import { TelemetryChart, LANES } from '../charts/TelemetryChart';

export function SeriesToggles() {
  const series = useUI((s) => s.telemetry.series);
  const setTelemetry = useUI((s) => s.setTelemetry);
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Series visibility">
      {LANES.map((l) => {
        const on = series[l.key];
        return (
          <button
            key={l.key}
            type="button"
            aria-pressed={on}
            onClick={() => setTelemetry({ series: { ...series, [l.key]: !on } })}
            className="inline-flex h-[22px] items-center gap-1.5 rounded-[4px] border border-line-strong px-1.5 text-[10.5px] text-ink-2 transition-colors hover:text-ink-1"
            style={{ opacity: on ? 1 : 0.5 }}
            title={`${on ? 'Hide' : 'Show'} ${l.label}`}
          >
            <span className="flex h-[11px] w-[11px] items-center justify-center rounded-[2px]" style={{ background: on ? l.color : 'transparent', boxShadow: `inset 0 0 0 1.5px ${l.color}` }}>
              {on && <svg viewBox="0 0 10 10" className="h-[8px] w-[8px]" aria-hidden><path d="M2 5.2 L4.2 7.2 L8 3" stroke="#0b0f14" strokeWidth="1.7" fill="none" /></svg>}
            </span>
            {l.label.split(' · ')[0]}
          </button>
        );
      })}
    </div>
  );
}

export function TelemetryPanel({ className }: { className?: string }) {
  const tel = useUI((s) => s.telemetry);
  const setTelemetry = useUI((s) => s.setTelemetry);
  return (
    <Panel
      title={
        <>
          Live CBRN telemetry <span className="ml-1 font-sans text-[11px] font-normal normal-case tracking-normal text-ink-3">(last {tel.range} min)</span>
        </>
      }
      icon={Activity}
      iconColor="#3cc8dc"
      className={className}
      actions={
        <>
          <SeriesToggles />
          <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />
          <Segmented
            label="Time range"
            value={String(tel.range) as '5' | '15' | '30'}
            onChange={(v) => setTelemetry({ range: Number(v) as 5 | 15 | 30 })}
            options={[
              { value: '5', label: '5m' },
              { value: '15', label: '15m' },
              { value: '30', label: '30m' },
            ]}
          />
          <IconButton
            icon={tel.paused ? Play : Pause}
            label={tel.paused ? 'Resume live updates' : 'Pause chart'}
            active={tel.paused}
            onClick={() => setTelemetry(tel.paused ? { paused: false, pausedAt: null } : { paused: true, pausedAt: Date.now() })}
          />
        </>
      }
    >
      <div className="absolute inset-0 px-2 pb-1.5 pt-2">
        <TelemetryChart />
      </div>
      {tel.paused && (
        <span className="pointer-events-none absolute right-3 top-2 rounded-[3px] bg-[rgb(242_179_61/0.16)] px-1.5 py-[1px] font-cond text-[10px] font-semibold uppercase tracking-[0.1em] text-amber">
          Paused
        </span>
      )}
    </Panel>
  );
}

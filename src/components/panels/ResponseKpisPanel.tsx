import { Timer, Users, Cctv, ClipboardList, Target } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSim } from '../../store/sim';
import { useSeriesTail } from '../charts/useSeries';
import { Panel, Metric, MicroBars, Sparkline, cx } from '../ui/primitives';
import { TONE_HEX } from '../ui/tone';
import { fmtDuration } from '../../utils/format';

function Instrument({ icon: Icon, label, color, children, sub, chart }: { icon: LucideIcon; label: string; color: string; children: ReactNode; sub: ReactNode; chart?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-[6px] border border-line bg-surface-2/60 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <Icon size={13} strokeWidth={1.9} style={{ color }} aria-hidden />
        <span className="micro truncate">{label}</span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1">{children}</div>
        <div className="mb-[3px] min-w-0 flex-1">{chart}</div>
      </div>
      <div className="mt-0.5 truncate text-[10.5px] text-ink-3">{sub}</div>
    </div>
  );
}

export function ResponseKpisPanel({ className }: { className?: string }) {
  const k = useSim((s) => s.kpis);
  const coverage = useSeriesTail('coverage', 40, 6);
  const personnel = useSeriesTail('personnel', 5, 4).map((v) => (v - 95) / 5);
  const actions = useSeriesTail('openActions', 40, 6);
  const ackTone = k.ackSeconds === null ? 'neutral' : k.ackRunning ? (k.ackSeconds > 300 ? 'critical' : 'watch') : k.ackSeconds <= 300 ? 'ok' : 'warn';
  return (
    <Panel title="Response KPIs" icon={Target} className={className}>
      <div className="grid h-full grid-cols-2 grid-rows-2 gap-1.5 p-2">
        <Instrument
          icon={Timer}
          label="Acknowledgement"
          color={TONE_HEX[ackTone]}
          sub={k.ackRunning ? <span className="text-amber">Pending · target 5 min</span> : 'Target < 5 min'}
        >
          <span className={cx('mono text-[22px] font-semibold leading-[24px]', k.ackRunning ? 'text-amber' : 'text-ink-1')}>{k.ackSeconds === null ? '--:--' : fmtDuration(k.ackSeconds)}</span>
        </Instrument>
        <Instrument icon={Users} label="Personnel" color={TONE_HEX[k.personnelPct >= 99.9 ? 'ok' : 'watch']} sub={`${k.personnelPresent} / ${k.personnelTotal} accounted for`} chart={<div className="flex justify-end"><MicroBars values={personnel} color={TONE_HEX.ok} bars={5} height={16} /></div>}>
          <Metric value={k.personnelPct} decimals={k.personnelPct >= 99.95 ? 0 : 1} className="text-[22px] font-semibold leading-[24px] text-ink-1" />
          <span className="text-[11px] text-ink-3">%</span>
        </Instrument>
        <Instrument icon={Cctv} label="Remote coverage" color={TONE_HEX.info} sub="CCTV + UGV + UAV" chart={<Sparkline data={coverage} color="#3cc8dc" height={20} min={60} max={100} />}>
          <Metric value={k.remoteCoverage} className="text-[22px] font-semibold leading-[24px] text-ink-1" />
          <span className="text-[11px] text-ink-3">%</span>
        </Instrument>
        <Instrument
          icon={ClipboardList}
          label="Open actions"
          color={TONE_HEX[k.openHigh ? 'warn' : k.openActions ? 'watch' : 'ok']}
          sub={k.openActions ? `${k.openHigh} high · ${k.openMedium} medium` : 'No open actions'}
          chart={<Sparkline data={actions} color="#a9b3be" height={20} min={0} max={8} fill={false} />}
        >
          <Metric value={k.openActions} className="text-[22px] font-semibold leading-[24px] text-ink-1" />
        </Instrument>
      </div>
    </Panel>
  );
}

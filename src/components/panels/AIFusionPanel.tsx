import { BrainCircuit, Waypoints, TriangleAlert, UserCheck, Activity, Cctv, Wind, Radio, FlaskConical, ShieldCheck, ChevronRight, Network } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSim } from '../../store/sim';
import { useUI } from '../../store/ui';
import { Panel, ProgressBar, Chip, Metric, cx } from '../ui/primitives';
import { TONE_HEX } from '../ui/tone';
import type { Evidence, Observation, ObservationStatus, Tone } from '../../types';
import { fmtClock } from '../../utils/format';

export const OBS_STATUS: Record<ObservationStatus, { label: string; tone: Tone }> = {
  monitoring: { label: 'Monitoring', tone: 'info' },
  review: { label: 'Review suggested', tone: 'watch' },
  validation: { label: 'Human validation required', tone: 'watch' },
  validated: { label: 'Validated by operator', tone: 'ok' },
  cleared: { label: 'Cleared', tone: 'neutral' },
};

export const EVIDENCE_ICON: Record<Evidence['sourceKind'], LucideIcon> = {
  sensor: Activity,
  camera: Cctv,
  asset: Radio,
  model: Wind,
  lab: FlaskConical,
  network: Network,
};

const RANK: Record<ObservationStatus, number> = { validation: 0, review: 1, monitoring: 2, validated: 3, cleared: 4 };

export function topObservation(list: Observation[]) {
  return [...list].filter((o) => o.status !== 'cleared').sort((a, b) => RANK[a.status] - RANK[b.status] || b.updatedAt - a.updatedAt)[0];
}

export function confidenceTone(c: number): string {
  return c >= 0.85 ? TONE_HEX.warn : c >= 0.65 ? TONE_HEX.watch : TONE_HEX.info;
}

export function AIFusionPanel() {
  const observations = useSim((s) => s.observations);
  const sensorsOnline = useSim((s) => s.metrics.sensorsOnline);
  const now = useSim((s) => s.now);
  const top = topObservation(observations);
  const open = () => {
    const ui = useUI.getState();
    if (top) ui.selectObservation(top.id);
    ui.setScreen('insights');
  };

  return (
    <Panel title="AI Fusion & Insights" icon={BrainCircuit} iconColor="#b4a8ff" actions={<button type="button" className="ctl h-[22px]" onClick={open}>Open <ChevronRight size={12} /></button>}>
      {!top ? (
        <div className="flex h-full flex-col gap-2 p-3">
          <div className="flex items-center gap-2 text-[12px] text-ink-1">
            <ShieldCheck size={15} className="text-green" aria-hidden />
            No active observations
          </div>
          <p className="text-[11px] leading-[15px] text-ink-3">
            Fusion model correlating <span className="num text-ink-2">{sensorsOnline}</span> sources, camera analytics and the synthetic wind model. Last correlation pass{' '}
            <span className="mono text-ink-2">{fmtClock(now)}</span>.
          </p>
          <div className="mt-auto flex flex-wrap gap-1.5">
            <Chip tone="ok">Below review threshold</Chip>
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col gap-2 p-2.5">
          <div className="flex items-center gap-2 rounded-[6px] bg-surface-2 px-2.5 py-1.5">
            <Waypoints size={14} className="text-[#b4a8ff]" aria-hidden />
            <span className="text-[12px] text-ink-1">
              <span className="num font-semibold">{top.sources.length}</span> sources correlated
            </span>
            <span className="mono ml-auto text-[10.5px] text-ink-3">{top.id}</span>
          </div>
          <button
            type="button"
            onClick={open}
            className="flex items-start gap-2 rounded-[6px] border px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
            style={{ borderColor: `${TONE_HEX[OBS_STATUS[top.status].tone]}55`, background: `${TONE_HEX[OBS_STATUS[top.status].tone]}0d` }}
          >
            <TriangleAlert size={15} className="mt-[1px] shrink-0" style={{ color: TONE_HEX[OBS_STATUS[top.status].tone] }} aria-hidden />
            <span className="min-w-0">
              <span className="block text-[12.5px] font-medium leading-[16px] text-ink-1">{top.title}</span>
              <span className="mt-0.5 block truncate text-[10.5px] text-ink-3">{top.location.label}</span>
            </span>
          </button>
          <div>
            <div className="flex items-baseline justify-between">
              <span className="micro">Confidence</span>
              <Metric value={top.confidence * 100} className="text-[15px] font-semibold text-ink-1" suffix="%" />
            </div>
            <ProgressBar value={top.confidence} color={confidenceTone(top.confidence)} height={5} className="mt-1" />
          </div>
          <div className="flex flex-wrap gap-1">
            {top.evidence.slice(-4).map((e) => {
              const Icon = EVIDENCE_ICON[e.sourceKind];
              return (
                <span key={e.id} className="inline-flex h-[20px] items-center gap-1 rounded-[4px] border border-line-strong bg-surface-2 px-1.5 text-[10.5px] text-ink-2" title={e.summary}>
                  <Icon size={11} aria-hidden />
                  {e.source}
                </span>
              );
            })}
          </div>
          <button
            type="button"
            onClick={open}
            className={cx(
              'mt-auto flex h-[30px] items-center gap-2 rounded-[6px] px-2.5 text-left text-[12px] font-medium transition-colors',
              top.status === 'validation' ? 'bg-[rgb(242_179_61/0.16)] text-amber hover:bg-[rgb(242_179_61/0.24)]' : 'bg-surface-2 text-ink-1 hover:bg-surface-3',
            )}
          >
            <UserCheck size={14} aria-hidden />
            {OBS_STATUS[top.status].label}
            <ChevronRight size={13} className="ml-auto opacity-70" aria-hidden />
          </button>
        </div>
      )}
    </Panel>
  );
}

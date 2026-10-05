import { Activity, Wifi, Video, Clock, HardHat, Gauge } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSim } from '../../store/sim';
import { useSeriesTail } from '../charts/useSeries';
import { Panel, Metric, MicroBars, cx } from '../ui/primitives';
import { TONE_HEX } from '../ui/tone';
import type { Tone } from '../../types';

function Row({ icon: Icon, label, children, bars, tone, optional }: { icon: LucideIcon; label: string; children: ReactNode; bars: number[]; tone: Tone; optional?: boolean }) {
  return (
    <div className={cx('flex h-[27px] items-center gap-2.5 border-b border-line px-3 last:border-b-0', optional && '[@media(max-height:820px)]:hidden')}>
      <Icon size={14} strokeWidth={1.9} style={{ color: TONE_HEX[tone] }} aria-hidden />
      <span className="text-[12px] text-ink-2">{label}</span>
      <span className="ml-auto flex items-baseline gap-1 whitespace-nowrap text-[12.5px] text-ink-1">{children}</span>
      <MicroBars values={bars} color={TONE_HEX[tone]} bars={5} height={13} />
    </div>
  );
}

export function StreamHealthPanel() {
  const m = useSim((s) => s.metrics);
  const sensors = useSeriesTail('sensorsOnline', 5, 3).map((v) => (v - 170) / 30);
  const video = useSeriesTail('videoUp', 5, 3).map((v) => v / 4);
  const ppe = useSeriesTail('ppe', 5, 3).map((v) => (v - 90) / 10);
  const lat = useSeriesTail('latency', 5, 3).map((v) => 1 - Math.min(1, (v - 150) / 500));
  const sensorTone: Tone = m.sensorsOnline < 190 ? 'watch' : 'ok';
  return (
    <Panel title="Stream health" icon={Activity}>
      <div className="flex flex-col py-1">
        <Row icon={Wifi} label="Sensors" tone={sensorTone} bars={sensors}>
          <Metric value={m.sensorsOnline} className="font-semibold" />
          <span className="text-[11px] text-ink-3">/ {m.sensorsTotal} online</span>
        </Row>
        <Row icon={Video} label="Video" tone={m.videoUp < m.videoTotal ? 'watch' : 'ok'} bars={video}>
          <Metric value={m.videoUp} className="font-semibold" />
          <span className="text-[11px] text-ink-3">/ {m.videoTotal} connected</span>
        </Row>
        <Row icon={Clock} label="Stale feeds" tone={m.staleFeeds ? 'watch' : 'ok'} bars={[1, 1, 1, 1, m.staleFeeds ? 0.3 : 1]}>
          <Metric value={m.staleFeeds} className="font-semibold" />
        </Row>
        <Row icon={HardHat} label="PPE detection" tone="ok" bars={ppe}>
          <Metric value={m.ppe} className="font-semibold" suffix="%" />
        </Row>
        <Row icon={Gauge} label="Link latency" tone={m.latencyMs > 400 ? 'watch' : 'ok'} bars={lat} optional>
          <Metric value={m.latencyMs} className="font-semibold" />
          <span className="text-[11px] text-ink-3">ms</span>
        </Row>
      </div>
    </Panel>
  );
}

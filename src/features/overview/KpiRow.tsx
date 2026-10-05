import { FlaskConical, Biohazard, Radiation, Atom, CircleCheck, TriangleAlert, Eye } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSim } from '../../store/sim';
import { useSeriesTail } from '../../components/charts/useSeries';
import { Chip, Metric, MicroBars, ProgressBar, Sparkline } from '../../components/ui/primitives';
import { CATEGORY_HEX } from '../../components/ui/tone';
import type { Tone } from '../../types';

function Section({ title, icon: Icon, color, status, children, footnote }: { title: string; icon: LucideIcon; color: string; status: { tone: Tone; label: string }; children: ReactNode; footnote?: string }) {
  const StatusIcon = status.tone === 'ok' ? CircleCheck : status.tone === 'info' ? Eye : TriangleAlert;
  return (
    <section className="panel min-w-0 px-3 pb-2 pt-2" aria-label={title}>
      <div className="flex items-center gap-2">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px]" style={{ background: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}40` }}>
          <Icon size={13} strokeWidth={2} style={{ color }} aria-hidden />
        </span>
        <h2 className="panel-title text-[13px]">{title}</h2>
        {footnote && <span className="hidden truncate text-[10.5px] text-ink-3 min-[1800px]:inline">{footnote}</span>}
        <span className="ml-auto">
          <Chip tone={status.tone} icon={StatusIcon}>
            {status.label}
          </Chip>
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-[1.35fr_1fr_1fr] gap-3">{children}</div>
    </section>
  );
}

function Block({ label, children, chart }: { label: string; children: ReactNode; chart?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="micro truncate">{label}</span>
      <div className="mt-[3px] flex items-baseline gap-1 whitespace-nowrap">{children}</div>
      <div className="mt-1 h-[18px]">{chart}</div>
    </div>
  );
}

const big = 'text-[21px] font-semibold leading-[24px] text-ink-1';
const unit = 'text-[11px] text-ink-3';

function Chemical() {
  const m = useSim((s) => s.metrics);
  const voc = useSeriesTail('voc', 120, 5);
  const online = useSeriesTail('gasOnline', 10, 6).map((v) => v / m.gasTotal);
  const alerts = useSeriesTail('chemAlerts', 60, 10);
  const status: { tone: Tone; label: string } = m.chemAlerts > 0 ? { tone: 'watch', label: 'Review' } : { tone: 'ok', label: 'Nominal' };
  return (
    <Section title="Chemical" icon={FlaskConical} color={CATEGORY_HEX.chem} status={status}>
      <Block label="VOC · site max" chart={<Sparkline data={voc} color={CATEGORY_HEX.chem} height={18} threshold={0.8} />}>
        <Metric value={m.voc} decimals={2} className={big} />
        <span className={unit}>ppm</span>
      </Block>
      <Block label="Gas sensors" chart={<MicroBars values={online} color={CATEGORY_HEX.chem} bars={10} height={16} />}>
        <Metric value={m.gasOnline} className={big} />
        <span className={unit}>/ {m.gasTotal}</span>
      </Block>
      <Block label="Under review" chart={<Sparkline data={alerts} color="#a9b3be" height={18} min={0} max={4} fill={false} />}>
        <Metric value={m.chemAlerts} className={big} />
      </Block>
    </Section>
  );
}

function Biological() {
  const m = useSim((s) => s.metrics);
  const aer = useSeriesTail('aerosol', 120, 5);
  const samples = useSeriesTail('samples', 60, 10);
  const status: { tone: Tone; label: string } = m.bioAlerts > 0 ? { tone: 'watch', label: 'Screening' } : { tone: 'ok', label: 'Nominal' };
  return (
    <Section title="Biological" icon={Biohazard} color={CATEGORY_HEX.bio} status={status} footnote="Screening only · lab confirmation required">
      <Block label="Aerosol index" chart={<Sparkline data={aer} color={CATEGORY_HEX.bio} height={18} min={0} threshold={30} />}>
        <Metric value={m.aerosol} className={big} />
        <span className={unit}>/ 100</span>
      </Block>
      <Block label="Samples to lab" chart={<Sparkline data={samples} color="#a9b3be" height={18} min={0} max={6} fill={false} />}>
        <Metric value={m.samplesPending} className={big} />
      </Block>
      <Block label="Detectors" chart={<MicroBars values={[1, 1, 1, 1, 1, 1, 1, 1, 1, m.bioOnline / m.bioTotal]} color={CATEGORY_HEX.bio} bars={10} height={16} />}>
        <Metric value={m.bioOnline} className={big} />
        <span className={unit}>/ {m.bioTotal}</span>
      </Block>
    </Section>
  );
}

function Radiological() {
  const m = useSim((s) => s.metrics);
  const gamma = useSeriesTail('gamma', 120, 5);
  const dos = useSeriesTail('dosimeters', 10, 6).map((v) => v / m.dosimetersTotal);
  const alerts = useSeriesTail('radAlerts', 60, 10);
  const status: { tone: Tone; label: string } =
    m.radAlerts > 1 || m.gamma >= 0.32 ? { tone: 'warn', label: 'Elevated' } : m.radAlerts > 0 ? { tone: 'watch', label: 'Review' } : { tone: 'ok', label: 'Nominal' };
  return (
    <Section title="Radiological" icon={Radiation} color={CATEGORY_HEX.rad} status={status}>
      <Block label="Gamma · site max" chart={<Sparkline data={gamma} color={CATEGORY_HEX.rad} height={18} threshold={0.18} />}>
        <Metric value={m.gamma} decimals={2} className={big} />
        <span className={unit}>µSv/h</span>
      </Block>
      <Block label="Dosimeters" chart={<MicroBars values={dos} color={CATEGORY_HEX.rad} bars={10} height={16} />}>
        <Metric value={m.dosimetersOnline} className={big} />
        <span className={unit}>/ {m.dosimetersTotal}</span>
      </Block>
      <Block label="Under review" chart={<Sparkline data={alerts} color="#a9b3be" height={18} min={0} max={4} fill={false} />}>
        <Metric value={m.radAlerts} className={big} />
      </Block>
    </Section>
  );
}

function Readiness() {
  const m = useSim((s) => s.metrics);
  const ready = useSeriesTail('readiness', 120, 5);
  const comms = useSeriesTail('commsUp', 10, 6).map((v) => v / m.commsTotal);
  const status: { tone: Tone; label: string } = m.commsUp < m.commsTotal ? { tone: 'watch', label: 'Degraded' } : { tone: 'ok', label: 'Ready' };
  return (
    <Section title="Nuclear readiness" icon={Atom} color={CATEGORY_HEX.nuc} status={status}>
      <Block label="Readiness" chart={<Sparkline data={ready} color={CATEGORY_HEX.nuc} height={18} min={88} max={100} />}>
        <Metric value={m.readiness} className={big} />
        <span className={unit}>%</span>
      </Block>
      <Block label="Comms" chart={<MicroBars values={comms} color={CATEGORY_HEX.nuc} bars={10} height={16} />}>
        <Metric value={m.commsUp} className={big} />
        <span className={unit}>/ {m.commsTotal}</span>
      </Block>
      <Block label="Checklist" chart={<div className="pt-[7px]"><ProgressBar value={m.checklistPct / 100} color={CATEGORY_HEX.nuc} /></div>}>
        <Metric value={m.checklistPct} className={big} />
        <span className={unit}>%</span>
      </Block>
    </Section>
  );
}

export function KpiRow() {
  return (
    <div className="grid grid-cols-4 gap-2">
      <Chemical />
      <Biological />
      <Radiological />
      <Readiness />
    </div>
  );
}

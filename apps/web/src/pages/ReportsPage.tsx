import { useMemo } from 'react';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Check, X as XIcon } from 'lucide-react';
import clsx from 'clsx';
import { district } from '@encirra/shared';
import type { RunSummary, StrategyId } from '@encirra/shared';
import { useTwin } from '@/state/store';
import { STRATEGY_LABEL, sortedCandidates, rankFor, scoreFor } from '@/data/selectors';
import { fmtDuration, fmtInt, fmtKW, fmtM, fmtMs, fmtNum, fmtPct, fmtPu } from '@/data/format';
import { STRATEGY_COLOR, TipBox } from '@/charts/common';
import { ACKNOWLEDGMENTS } from '@/modals/AboutModal';
import { VerifiedBadge } from '@/modals/WhyPlanModal';
import { Pill } from '@/ui/primitives';
import { ComparisonTable, Disclaimer, ExportButtons, STRATS, useSummaries } from './shared';
import { PageFrame } from './PageFrame';

interface BarSpec {
  key: string;
  title: string;
  unit: string;
  value: (s: RunSummary) => number | null;
  fmt: (v: number) => string;
  better: 'higher' | 'lower' | null;
}

const BARS: BarSpec[] = [
  { key: 'served', title: 'Electrical energy served', unit: 'kWh over the horizon', value: (s) => s.servedEnergyKWh, fmt: (v) => `${fmtInt(v)} kWh`, better: 'higher' },
  { key: 'critUnserved', title: 'Unserved critical load', unit: 'kWh', value: (s) => s.criticalUnservedKWh, fmt: (v) => `${fmtInt(v)} kWh`, better: 'lower' },
  { key: 'water', title: 'Water delivered', unit: '% of required volume', value: (s) => s.waterDeliveredPct, fmt: (v) => fmtPct(v, 1), better: 'higher' },
  { key: 'pressure', title: 'Min critical pressure', unit: 'm of head', value: (s) => s.minCriticalPressureM, fmt: (v) => fmtM(v), better: 'higher' },
  { key: 'pumps', title: 'Pump availability (end)', unit: '% of pumps', value: (s) => (s.pumpsTotal ? (100 * s.pumpsAvailableEnd) / s.pumpsTotal : null), fmt: (v) => fmtPct(v), better: 'higher' },
  { key: 'viol', title: 'Hard-constraint violations', unit: 'count in frames', value: (s) => s.constraintViolations, fmt: (v) => fmtInt(v), better: 'lower' },
  { key: 'ops', title: 'Restoration decisions', unit: 'switch operations', value: (s) => s.switchOps, fmt: (v) => fmtInt(v), better: null },
  { key: 'ms', title: 'Computation time', unit: 'plan computation', value: (s) => s.planComputeMs, fmt: (v) => fmtMs(v), better: null },
];

function MiniBars({ spec, sums }: { spec: BarSpec; sums: Partial<Record<StrategyId, RunSummary>> }) {
  const data = STRATS.filter((s) => sums[s]).map((s) => ({ s, label: STRATEGY_LABEL[s], v: spec.value(sums[s]!) ?? 0 }));
  return (
    <div className="rounded-[10px] border border-line bg-white px-3 pt-2.5 pb-1.5" data-testid={`bars-${spec.key}`}>
      <div className="text-[12.5px] font-semibold text-navy">{spec.title}</div>
      <div className="text-[11px] text-slate">
        {spec.unit}
        {spec.better && <span className="text-mist"> · {spec.better} is better</span>}
      </div>
      <div className="mt-1 h-[86px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 2, right: 64, bottom: 2, left: 0 }} barCategoryGap={5}>
            <XAxis type="number" hide domain={[0, (max: number) => (max > 0 ? max : 1)]} />
            <YAxis type="category" dataKey="label" width={64} tick={{ fontSize: 11, fill: '#2b3d50' }} axisLine={false} tickLine={false} />
            <Bar dataKey="v" isAnimationActive={false} radius={[0, 4, 4, 0]} maxBarSize={18} minPointSize={2}>
              {data.map((d) => (
                <Cell key={d.s} fill={STRATEGY_COLOR[d.s]} />
              ))}
              <LabelList dataKey="v" position="right" formatter={(v: unknown) => spec.fmt(Number(v))} style={{ fontSize: 11, fill: '#15283C', fontWeight: 600 }} />
            </Bar>
            <Tooltip
              isAnimationActive={false}
              cursor={{ fill: 'rgba(42,108,181,0.06)' }}
              content={({ active, payload }) => {
                const p = active && payload?.[0]?.payload;
                if (!p) return null;
                return <TipBox title={spec.title} rows={[{ label: p.label, value: spec.fmt(p.v), color: STRATEGY_COLOR[p.s as StrategyId] }]} />;
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-navy">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function ReportsPage() {
  const sums = useSummaries();
  const runs = useTwin((s) => s.runsByStrategy);
  const comparison = useTwin((s) => s.comparison);
  const scenarios = useTwin((s) => s.scenarios);
  const scenarioId = useTwin((s) => s.scenarioId);
  const topology = useTwin((s) => s.topology);
  const enc = runs.encirra ?? null;
  const cands = useMemo(() => (enc ? sortedCandidates(enc) : []), [enc]);
  const def = scenarios.find((s) => s.id === scenarioId);
  const prov = enc?.provenance ?? runs['grid-only']?.provenance ?? runs.none?.provenance;
  const fname = (id: string) => topology?.facilities.find((f) => f.id === id)?.name ?? id;

  return (
    <PageFrame
      title="Reports"
      testId="reports"
      subtitle={`${def?.name ?? 'Scenario'} · ${enc?.summary.faultLabel ?? ''} · None vs Grid-only vs Encirra`}
      actions={<ExportButtons />}
    >
      <Disclaimer />

      <Section title="Strategy comparison">
        <ComparisonTable testId="report-comparison" />
      </Section>

      <Section title="Key outcomes">
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))]">
          {BARS.map((b) => (
            <MiniBars key={b.key} spec={b} sums={sums} />
          ))}
        </div>
      </Section>

      <Section
        title={`Recovery candidates · Encirra (${cands.length})`}
        right={enc?.plan ? <VerifiedBadge passed={enc.plan.verification.passed} /> : undefined}
      >
        {cands.length === 0 ? (
          <p className="text-[12.5px] text-slate">No candidates in the loaded Encirra run.</p>
        ) : (
          <>
          <p className="mb-1.5 text-[12px] text-slate lg:hidden">Swipe the table sideways to see every column →</p>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[720px] border-collapse text-left text-[12px]">
              <thead className="bg-wash text-slate">
                <tr>
                  <th className="px-2.5 py-1.5 font-medium">Rank</th>
                  <th className="px-2.5 py-1.5 font-medium">Candidate</th>
                  <th className="px-2.5 py-1.5 font-medium">Restored</th>
                  <th className="px-2.5 py-1.5 font-medium">Critical</th>
                  <th className="px-2.5 py-1.5 font-medium">Pumps</th>
                  <th className="px-2.5 py-1.5 font-medium">Crit. pressure</th>
                  <th className="px-2.5 py-1.5 font-medium">V<sub>min</sub></th>
                  <th className="px-2.5 py-1.5 font-medium">Score</th>
                  <th className="px-2.5 py-1.5 font-medium">Result / reasons</th>
                </tr>
              </thead>
              <tbody>
                {cands.map((c) => (
                  <tr key={c.id} className={clsx('border-t border-line/60 align-top', enc?.plan?.candidateId === c.id && 'bg-info-soft/60')}>
                    <td className="px-2.5 py-1.5 tabular">{rankFor(c, 'encirra') ?? '—'}</td>
                    <td className="px-2.5 py-1.5">
                      <div className="font-medium text-navy">{c.id}</div>
                      <div className="text-[11.5px] text-slate">{c.label}</div>
                    </td>
                    <td className="px-2.5 py-1.5 tabular">{fmtKW(c.metrics.restoredKW)}</td>
                    <td className="px-2.5 py-1.5 tabular">
                      {c.metrics.criticalRestored}/{c.metrics.criticalTotal}
                    </td>
                    <td className="px-2.5 py-1.5 tabular">{c.metrics.pumpsRestored}</td>
                    <td className="px-2.5 py-1.5 tabular">{fmtM(c.metrics.minCriticalPressureM)}</td>
                    <td className="px-2.5 py-1.5 tabular">{fmtPu(c.metrics.vMinPu)}</td>
                    <td className="px-2.5 py-1.5 tabular">{scoreFor(c, 'encirra') == null ? '—' : fmtNum(scoreFor(c, 'encirra'), 2)}</td>
                    <td className="px-2.5 py-1.5">
                      {c.feasible ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-ok-deep">
                          <Check size={13} strokeWidth={3} /> Feasible{enc?.plan?.candidateId === c.id ? ' · selected' : ''}
                        </span>
                      ) : (
                        <div>
                          <span className="inline-flex items-center gap-1 font-semibold text-fault">
                            <XIcon size={13} strokeWidth={3} /> Rejected
                          </span>
                          <ul className="mt-0.5 text-[11.5px] text-ink">
                            {c.rejectedReasons.map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
        {enc?.plan && (
          <div className="mt-2 grid gap-3 text-[12.5px] md:grid-cols-2">
            <div className="rounded-lg border border-line bg-white px-3 py-2">
              <div className="font-semibold text-navy">Critical infrastructure protected</div>
              <div className="mt-0.5 text-ink">{enc.plan.protectedFacilities.map(fname).join(', ') || '—'}</div>
            </div>
            <div className="rounded-lg border border-line bg-white px-3 py-2">
              <div className="font-semibold text-navy">Remaining unserved after the plan</div>
              <div className="mt-0.5 text-ink">
                {fmtKW(enc.plan.unservedAfter.kW)}
                {enc.plan.unservedAfter.facilities.length > 0 && ` · ${enc.plan.unservedAfter.facilities.map(fname).join(', ')}`}
              </div>
            </div>
          </div>
        )}
      </Section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Section title="Methodology">
          <div className="space-y-2 text-[12.5px] leading-relaxed text-ink">
            <p>
              <b className="text-navy">Electrical:</b> {topology?.electrical.benchmark ?? district.electrical.benchmark}. {prov?.electricalSolver}
            </p>
            <p>
              <b className="text-navy">Hydraulic:</b> {topology?.water.model ?? district.water.model}. {prov?.hydraulicSolver}
            </p>
            <p>
              <b className="text-navy">Coupling:</b> {prov?.coupling}
            </p>
            <p>
              <b className="text-navy">Recovery planning:</b> candidates combine tie-switch closures, sectionalizing and load shedding. Each is scored on weighted soft objectives (served and
              critical load, water delivered, critical-facility water service, pressure/storage margin, switching cost); any candidate failing a hard check is rejected regardless of score.
            </p>
            <p>
              <b className="text-navy">Verification:</b> {enc?.plan?.verification.method ?? 'The selected plan is re-checked independently before it is applied.'}
            </p>
            <p>
              <b className="text-navy">Strategies:</b> None = no intervention (baseline); Grid-only = restoration ranked on electrical objectives only; Encirra = coupled power + water objective.
            </p>
            {prov && (
              <p className="text-[11.5px] text-slate">
                Engine {prov.engine} {prov.engineVersion} · pandapower {prov.pandapower} · WNTR {prov.wntr} · Python {prov.python} · seed {prov.seed} · computed {prov.computedAt} in{' '}
                {fmtMs(prov.computeMs)} · source: {prov.source === 'live' ? 'live solver' : 'replay of precomputed solver output'}
                {comparison && <> · comparison generated {comparison.generatedAt}</>}
              </p>
            )}
          </div>
        </Section>
        <Section title="Assumptions & limitations">
          <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-ink">
            {district.electrical.assumptions.map((a, i) => (
              <li key={`e${i}`}>{a}</li>
            ))}
            {district.water.assumptions.map((a, i) => (
              <li key={`w${i}`}>{a}</li>
            ))}
            {(enc?.plan?.assumptions ?? []).map((a, i) => (
              <li key={`p${i}`}>{a}</li>
            ))}
            <li>Results describe a synthetic district on benchmark data; they demonstrate the method and are not operational guidance for any real network.</li>
            <li>Ambient conditions ({district.district.ambient.temperatureC} °C, {district.district.ambient.condition.toLowerCase()}) are a declared scenario assumption, not weather data.</li>
            {enc?.summary.hydraulicDelayMin != null && (
              <li>Hydraulic delay figures ({fmtDuration(enc.summary.hydraulicDelayMin)} for Encirra) depend on the assumed initial tank levels and demand pattern.</li>
            )}
          </ul>
        </Section>
      </div>

      <Section title="Acknowledgments">
        <div className="flex flex-wrap gap-1.5">
          {ACKNOWLEDGMENTS.map((a) => (
            <Pill key={a.name} tone="neutral" className="!py-[3px] !text-[11.5px]">
              <span className="font-semibold text-navy">{a.name}</span>
              <span className="font-normal text-slate">· {a.role}</span>
            </Pill>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-slate">
          CSV and JSON exports above are generated in the browser from the loaded data, without recomputation{runs.encirra?.provenance.source === 'live' ? '; API exports come from the live simulation service' : ''}.
        </p>
      </Section>
    </PageFrame>
  );
}

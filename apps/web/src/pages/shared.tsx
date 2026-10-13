import { Download, ExternalLink, FileJson, FileSpreadsheet } from 'lucide-react';
import clsx from 'clsx';
import type { RunSummary, StrategyId } from '@encirra/shared';
import { useTwin } from '@/state/store';
import { STRATEGY_LABEL, summariesByStrategy, summaryRestoredShare } from '@/data/selectors';
import { fmtDuration, fmtInt, fmtKW, fmtKWh, fmtM, fmtM3, fmtMs, fmtPct } from '@/data/format';
import { comparisonCsv, downloadText, exportJson, timeseriesCsv } from '@/data/export';
import { liveApi } from '@/data/api';
import { STRATEGY_COLOR } from '@/charts/common';

export const STRATS: StrategyId[] = ['none', 'grid-only', 'encirra'];

export interface MetricDef {
  key: string;
  label: string;
  fmt: (s: RunSummary) => string;
  value: (s: RunSummary) => number | null;
  better?: 'higher' | 'lower';
  hint?: string;
}

export const COMPARISON_METRICS: MetricDef[] = [
  { key: 'outcome', label: 'Outcome', fmt: (s) => s.outcome.replace('-', ' '), value: () => null },
  { key: 'servedEnergyKWh', label: 'Electrical energy served', fmt: (s) => fmtKWh(s.servedEnergyKWh), value: (s) => s.servedEnergyKWh, better: 'higher' },
  { key: 'unservedEnergyKWh', label: 'Electrical energy unserved', fmt: (s) => fmtKWh(s.unservedEnergyKWh), value: (s) => s.unservedEnergyKWh, better: 'lower' },
  { key: 'criticalUnservedKWh', label: 'Unserved critical load', fmt: (s) => fmtKWh(s.criticalUnservedKWh), value: (s) => s.criticalUnservedKWh, better: 'lower' },
  {
    key: 'loadRestoredKW',
    label: 'Load restored at end of horizon (% of affected demand)',
    hint: 'Affected demand = load restored + unserved at the end of the horizon (both rows of this table).',
    fmt: (s) => `${fmtKW(s.loadRestoredKW)} (${fmtPct(summaryRestoredShare(s))})`,
    value: (s) => s.loadRestoredKW,
    better: 'higher',
  },
  { key: 'remainingUnservedKW', label: 'Unserved at end of horizon', fmt: (s) => fmtKW(s.remainingUnservedKW), value: (s) => s.remainingUnservedKW, better: 'lower' },
  { key: 'waterDeliveredPct', label: 'Water delivered', fmt: (s) => `${fmtM3(s.waterDeliveredM3)} (${fmtPct(s.waterDeliveredPct, 1)})`, value: (s) => s.waterDeliveredPct, better: 'higher' },
  { key: 'minCriticalPressureM', label: 'Min critical pressure', fmt: (s) => fmtM(s.minCriticalPressureM), value: (s) => s.minCriticalPressureM, better: 'higher' },
  { key: 'minPressureM', label: 'Min pressure (all junctions)', fmt: (s) => fmtM(s.minPressureM), value: (s) => s.minPressureM, better: 'higher' },
  { key: 'minutesBelowServicePressure', label: 'Minutes below service pressure (critical)', fmt: (s) => fmtDuration(s.minutesBelowServicePressure), value: (s) => s.minutesBelowServicePressure, better: 'lower' },
  { key: 'tankMinPct', label: 'Lowest tank level', fmt: (s) => fmtPct(s.tankMinPct), value: (s) => s.tankMinPct, better: 'higher' },
  { key: 'pumps', label: 'Pump availability (end)', fmt: (s) => `${s.pumpsAvailableEnd} / ${s.pumpsTotal}`, value: (s) => (s.pumpsTotal ? (100 * s.pumpsAvailableEnd) / s.pumpsTotal : null), better: 'higher' },
  {
    key: 'criticalRecovered',
    label: 'Critical facilities recovered (of those at risk)',
    fmt: (s) => `${s.criticalRecovered} / ${s.criticalAtRisk} · ${s.criticalTotal} critical in total`,
    value: (s) => s.criticalRecovered,
    better: 'higher',
  },
  { key: 'constraintViolations', label: 'Hard-constraint violations', fmt: (s) => fmtInt(s.constraintViolations), value: (s) => s.constraintViolations, better: 'lower' },
  { key: 'switchOps', label: 'Restoration decisions (switch operations)', fmt: (s) => fmtInt(s.switchOps), value: (s) => s.switchOps },
  { key: 'candidates', label: 'Candidates evaluated / rejected', fmt: (s) => `${fmtInt(s.candidatesEvaluated)} / ${fmtInt(s.candidatesRejected)}`, value: (s) => s.candidatesEvaluated },
  { key: 'planComputeMs', label: 'Computation time (plan)', fmt: (s) => fmtMs(s.planComputeMs), value: (s) => s.planComputeMs },
  { key: 'hydraulicDelayMin', label: 'Hydraulic delay (pump trip → low pressure)', fmt: (s) => (s.hydraulicDelayMin == null ? 'not reached' : fmtDuration(s.hydraulicDelayMin)), value: (s) => s.hydraulicDelayMin },
];

export function useSummaries() {
  const runs = useTwin((s) => s.runsByStrategy);
  const comparison = useTwin((s) => s.comparison);
  return summariesByStrategy(runs, comparison);
}

export function ComparisonTable({ compact, testId }: { compact?: boolean; testId?: string }) {
  const sums = useSummaries();
  const runs = useTwin((s) => s.runsByStrategy);
  const current = useTwin((s) => s.strategy);
  const metrics = compact ? COMPARISON_METRICS.filter((m) => ['outcome', 'unservedEnergyKWh', 'criticalUnservedKWh', 'waterDeliveredPct', 'minCriticalPressureM', 'minutesBelowServicePressure', 'pumps', 'constraintViolations', 'switchOps', 'planComputeMs'].includes(m.key)) : COMPARISON_METRICS;
  return (
    <div className="overflow-x-auto rounded-lg border border-line" data-testid={testId}>
      <table className="w-full min-w-[560px] border-collapse text-left text-[12.5px]">
        <thead>
          <tr className="bg-wash text-slate">
            <th className="px-3 py-2 font-medium">Metric</th>
            {STRATS.map((s) => (
              <th key={s} className={clsx('px-3 py-2 font-semibold', s === current ? 'text-navy' : 'text-ink')}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: STRATEGY_COLOR[s] }} />
                  {STRATEGY_LABEL[s]}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => {
            const vals = STRATS.map((s) => (sums[s] ? m.value(sums[s]!) : null));
            const nums = vals.filter((v): v is number => v != null);
            const best = m.better && nums.length > 1 ? (m.better === 'higher' ? Math.max(...nums) : Math.min(...nums)) : null;
            return (
              <tr key={m.key} className="border-t border-line/70">
                <td className="px-3 py-1.5 text-ink" title={m.hint}>
                  {m.label}
                </td>
                {STRATS.map((s, i) => (
                  <td key={s} className={clsx('px-3 py-1.5 tabular', best != null && vals[i] === best ? 'font-semibold text-navy' : 'text-ink')}>
                    {sums[s] ? m.fmt(sums[s]!) : '—'}
                  </td>
                ))}
              </tr>
            );
          })}
          <tr className="border-t border-line/70">
            <td className="px-3 py-1.5 text-ink">Recovery plan</td>
            {STRATS.map((s) => (
              <td key={s} className="px-3 py-1.5 text-[11.5px] text-ink">
                {runs[s]?.plan ? (
                  <>
                    {runs[s]!.plan!.label}
                    <span className={clsx('ml-1 font-semibold', runs[s]!.plan!.verification.passed ? 'text-ok-deep' : 'text-fault')}>
                      · {runs[s]!.plan!.verification.passed ? 'Simulation Verified' : 'failed verification'}
                    </span>
                  </>
                ) : (
                  <span className="text-slate">{s === 'none' ? 'No action (baseline)' : 'No feasible plan'}</span>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <div className="border-t border-line/70 bg-wash/50 px-3 py-1.5 text-[11px] text-slate">Bold = best value across strategies where a direction is meaningful. All values from the loaded run summaries.</div>
    </div>
  );
}

export function ExportButtons({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const runs = useTwin((s) => s.runsByStrategy);
  const topology = useTwin((s) => s.topology);
  const comparison = useTwin((s) => s.comparison);
  const scenarios = useTwin((s) => s.scenarios);
  const scenarioId = useTwin((s) => s.scenarioId);
  const dataSource = useTwin((s) => s.dataSource);
  const has = !!runs.encirra || !!runs.none || !!runs['grid-only'];
  const base = `encirra-${scenarioId}`;
  const disclaimer = 'Research Prototype — Synthetic/Benchmark Infrastructure Data. No private utility data is available or authorized.';
  const btn = clsx(
    'inline-flex items-center gap-1.5 rounded-lg border border-line bg-white font-medium text-navy hover:border-info/40 hover:bg-info-soft disabled:opacity-40',
    size === 'sm' ? 'px-2 py-1 text-[11.5px]' : 'px-2.5 py-1.5 text-[12.5px]',
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={btn} disabled={!has} onClick={() => downloadText(`${base}-comparison.csv`, comparisonCsv(runs), 'text/csv')} data-testid="export-csv">
        <FileSpreadsheet size={14} className="text-ok-deep" /> Comparison CSV
      </button>
      <button type="button" className={btn} disabled={!has} onClick={() => downloadText(`${base}-timeseries.csv`, timeseriesCsv(runs, topology), 'text/csv')} data-testid="export-timeseries">
        <Download size={14} className="text-info" /> Time series CSV
      </button>
      <button
        type="button"
        className={btn}
        disabled={!has}
        onClick={() =>
          downloadText(
            `${base}.json`,
            exportJson(
              { exportedAt: new Date().toISOString(), dataSource, disclaimer },
              scenarios.find((s) => s.id === scenarioId) ?? null,
              runs,
              comparison,
            ),
            'application/json',
          )
        }
        data-testid="export-json"
      >
        <FileJson size={14} className="text-power-deep" /> JSON
      </button>
      {dataSource === 'live' && (
        <>
          <a className={btn} href={liveApi.exportUrl(scenarioId, 'csv')} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} /> API CSV
          </a>
          <a className={btn} href={liveApi.exportUrl(scenarioId, 'json')} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} /> API JSON
          </a>
        </>
      )}
    </div>
  );
}

export function Disclaimer() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warn/30 bg-warn-soft/70 px-3 py-2 text-[12.5px]" data-testid="report-disclaimer">
      <span className="font-semibold text-navy">Research Prototype — Synthetic/Benchmark Infrastructure Data</span>
      <span className="text-ink">No private utility data is available or authorized.</span>
    </div>
  );
}


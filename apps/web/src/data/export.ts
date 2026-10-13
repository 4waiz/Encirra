/**
 * Client-side exports generated from the loaded simulation data (no recomputation):
 *  - comparison CSV: one row per strategy with its run summary;
 *  - timeseries CSV: one row per frame per strategy with the headline power/water quantities;
 *  - JSON bundle: provenance + the complete run results exactly as loaded.
 */
import type { Comparison, NetworkTopology, RunResult, ScenarioDefinition, StrategyId } from '@encirra/shared';

const STRATS: StrategyId[] = ['none', 'grid-only', 'encirra'];

export function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

const SUMMARY_FIELDS = [
  'outcome',
  'faultLabel',
  'faultClock',
  'loadInterruptedKW',
  'connectionsAffected',
  'pumpsOffline',
  'criticalAtRisk',
  'loadRestoredKW',
  'loadRestoredPct',
  'remainingUnservedKW',
  'criticalRecovered',
  'criticalTotal',
  'pumpsAvailableEnd',
  'pumpsTotal',
  'servedEnergyKWh',
  'unservedEnergyKWh',
  'criticalUnservedKWh',
  'waterRequiredM3',
  'waterDeliveredM3',
  'waterDeliveredPct',
  'minPressureM',
  'minCriticalPressureM',
  'tankMinPct',
  'minutesBelowServicePressure',
  'hydraulicDelayMin',
  'constraintViolations',
  'switchOps',
  'planComputeMs',
  'candidatesEvaluated',
  'candidatesRejected',
] as const;

export function comparisonCsv(runs: Partial<Record<StrategyId, RunResult>>): string {
  const header = ['scenarioId', 'strategy', 'runId', 'source', 'engineVersion', 'plan', 'verification', ...SUMMARY_FIELDS];
  const rows: unknown[][] = [];
  for (const s of STRATS) {
    const r = runs[s];
    if (!r) continue;
    rows.push([
      r.scenarioId,
      s,
      r.runId,
      r.provenance.source,
      r.provenance.engineVersion,
      r.plan?.label ?? '',
      r.plan ? r.plan.verification.status : '',
      ...SUMMARY_FIELDS.map((k) => r.summary[k]),
    ]);
  }
  return toCsv(header, rows);
}

export function timeseriesCsv(runs: Partial<Record<StrategyId, RunResult>>, topology: NetworkTopology | null): string {
  const tankIds = topology?.water.tanks.map((t) => t.id) ?? [];
  const header = [
    'strategy',
    't_s',
    'clock',
    'stage',
    'demand_kW',
    'served_kW',
    'unserved_kW',
    'restored_kW',
    'losses_kW',
    'pump_kW',
    'critical_unserved_kW',
    'vmin_pu',
    'vmin_bus',
    'voltage_violations',
    'voltage_advisories',
    'thermal_violations',
    'water_required_Lps',
    'water_delivered_Lps',
    'water_delivered_pct',
    'min_pressure_m',
    'min_pressure_node',
    'critical_pressure_m',
    'nodes_below_service',
    'connections_interrupted',
    'pumps_online',
    'pumps_total',
    ...tankIds.map((id) => `tank_${id}_pct`),
  ];
  const rows: unknown[][] = [];
  for (const s of STRATS) {
    const r = runs[s];
    if (!r) continue;
    for (const f of r.frames) {
      const p = f.power;
      const w = f.water;
      rows.push([
        s,
        f.t,
        f.clock,
        f.stage,
        p.demandKW,
        p.servedKW,
        p.unservedKW,
        p.restoredKW,
        p.lossesKW,
        p.pumpKW,
        p.criticalUnservedKW,
        p.vMinPu,
        p.vMinBus == null ? '' : `B${p.vMinBus + 1}`,
        p.voltageViolations,
        p.voltageAdvisories,
        p.thermalViolations,
        w.requiredLps,
        w.deliveredLps,
        w.deliveredPct,
        w.minPressureM,
        w.minPressureNode,
        w.criticalPressureM,
        w.nodesBelowService,
        w.connectionsInterrupted,
        w.pumpsOnline,
        w.pumpsTotal,
        ...tankIds.map((_, i) => w.tankPct[i]),
      ]);
    }
  }
  return toCsv(header, rows);
}

export interface ExportMeta {
  exportedAt: string;
  dataSource: string;
  disclaimer: string;
}

export function exportJson(
  meta: ExportMeta,
  scenario: ScenarioDefinition | null,
  runs: Partial<Record<StrategyId, RunResult>>,
  comparison: Comparison | null,
): string {
  return JSON.stringify(
    {
      meta: { ...meta, generator: 'Encirra dashboard client-side export (no recomputation)' },
      scenario,
      comparison,
      runs,
    },
    null,
    2,
  );
}

/** Triggers a browser download of text content. Returns the object URL's file name. */
export function downloadText(filename: string, text: string, mime: string): string {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return filename;
}

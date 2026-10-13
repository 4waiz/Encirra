import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Lock, Pause, Play, RotateCcw, SkipForward, Zap } from 'lucide-react';
import clsx from 'clsx';
import type { ObjectiveWeights, ScenarioParams } from '@encirra/shared';
import { useTwin } from '@/state/store';
import { loadScenario, recompute } from '@/data/loader';
import { playback } from '@/playback/playback';
import { fmtNum } from '@/data/format';
import { ComparisonTable, ExportButtons } from './shared';
import { PageFrame } from './PageFrame';

const PARAM_META: Record<keyof ScenarioParams, { label: string; unit?: string; min?: number; max?: number; step?: number; hint?: string }> = {
  loadMultiplier: { label: 'Electrical load multiplier', unit: '×', min: 0.5, max: 1.6, step: 0.05, hint: 'Scales the benchmark electrical demand' },
  waterDemandMultiplier: { label: 'Water demand multiplier', unit: '×', min: 0.5, max: 1.6, step: 0.05 },
  faultLineId: { label: 'Faulted line' },
  faultTimeMin: { label: 'Fault time', unit: 'min after start', min: 0, step: 1 },
  isolationDelayMin: { label: 'Fault → isolation', unit: 'min', min: 0, step: 1 },
  analysisDelayMin: { label: 'Isolation → candidates', unit: 'min', min: 0, step: 1 },
  switchingDelayMin: { label: 'Verification → switching complete', unit: 'min', min: 0, step: 1 },
  tankInitPct: { label: 'Initial tank level', unit: '% of usable range', min: 0, max: 100, step: 1 },
  horizonMin: { label: 'Horizon', unit: 'min', min: 10, step: 5 },
  stepMin: { label: 'Frame spacing', unit: 'min', min: 0.5, step: 0.5 },
  repairTimeMin: { label: 'Permanent repair time', unit: 'min (blank = beyond horizon)', min: 0, step: 1 },
  seed: { label: 'Random seed', step: 1 },
};

const WEIGHT_META: { key: keyof ObjectiveWeights; label: string; unit: string }[] = [
  { key: 'servedLoad', label: 'Electrical demand served', unit: 'per MWh' },
  { key: 'criticalLoad', label: 'Critical electrical demand served', unit: 'per MWh' },
  { key: 'waterDelivered', label: 'Water demand delivered', unit: 'per 1,000 m³' },
  { key: 'criticalWater', label: 'Critical-facility water service', unit: 'per hour maintained' },
  { key: 'pressureStorage', label: 'Pressure & storage margin', unit: 'per %' },
  { key: 'switchingCost', label: 'Switching operation penalty', unit: 'per operation' },
];

export function ScenariosPage() {
  const scenarios = useTwin((s) => s.scenarios);
  const scenarioId = useTwin((s) => s.scenarioId);
  const run = useTwin((s) => s.run);
  const manifest = useTwin((s) => s.manifest);
  const dataSource = useTwin((s) => s.dataSource);
  const busy = useTwin((s) => s.busy);
  const playing = useTwin((s) => s.playing);
  const setPage = useTwin((s) => s.setPage);
  const live = dataSource === 'live';
  const def = scenarios.find((s) => s.id === scenarioId) ?? null;

  const [params, setParams] = useState<ScenarioParams | null>(run?.params ?? def?.defaults ?? null);
  const [weights, setWeights] = useState<ObjectiveWeights | null>(run?.weights ?? manifest?.weights ?? null);
  useEffect(() => {
    setParams(run?.params ?? def?.defaults ?? null);
    setWeights(run?.weights ?? manifest?.weights ?? null);
  }, [run, def, manifest]);

  const baseWeights = run?.weights ?? manifest?.weights ?? null;
  const dirty = useMemo(
    () => JSON.stringify(params) !== JSON.stringify(run?.params ?? def?.defaults ?? null) || JSON.stringify(weights) !== JSON.stringify(baseWeights),
    [params, weights, run, def, baseWeights],
  );

  const onRun = async () => {
    if (live && dirty && params && weights) {
      const editable = def?.editable ?? [];
      const p = Object.fromEntries(editable.map((k) => [k, params[k]])) as Partial<ScenarioParams>;
      const ok = await recompute(p, weights);
      if (ok) {
        setPage('live');
        playback.play();
      }
      return;
    }
    playback.reset();
    setPage('live');
    playback.play();
  };

  return (
    <PageFrame
      title="Scenarios"
      testId="scenarios"
      subtitle="Choose a disturbance, inspect its parameters and objective weights, and compare recovery strategies."
      actions={
        <>
          <button
            type="button"
            onClick={onRun}
            disabled={!run || !!busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-info px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-deep disabled:opacity-40"
            data-testid="scenario-run"
          >
            <Play size={14} fill="currentColor" /> {live && dirty ? 'Recompute & run' : 'Run'}
          </button>
          <button type="button" onClick={playback.pause} disabled={!playing} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-navy hover:bg-wash disabled:opacity-40">
            <Pause size={14} /> Pause
          </button>
          <button type="button" onClick={() => playback.step(1)} disabled={!run} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-navy hover:bg-wash disabled:opacity-40">
            <SkipForward size={14} /> Step
          </button>
          <button type="button" onClick={playback.reset} disabled={!run} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-navy hover:bg-wash disabled:opacity-40">
            <RotateCcw size={14} /> Reset
          </button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        {scenarios.map((s) => {
          const active = s.id === scenarioId;
          return (
            <div key={s.id} className={clsx('flex flex-col rounded-[10px] border bg-white px-4 py-3', active ? 'border-info shadow-[0_0_0_3px_rgba(42,108,181,0.12)]' : 'border-line')} data-testid={`scenario-card-${s.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold tracking-wide text-slate uppercase">{s.shortName}</div>
                  <div className="text-[15px] font-semibold text-navy">{s.name}</div>
                </div>
                {active && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-[2px] text-[11px] font-semibold text-info">
                    <CheckCircle2 size={12} /> Loaded
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[12.5px] text-ink">{s.description}</p>
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[12px] text-slate">
                {s.narrative.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              <div className="mt-auto pt-3">
                <button
                  type="button"
                  disabled={active || !!busy}
                  onClick={() => void loadScenario(s.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-medium text-navy hover:border-info/40 hover:bg-info-soft disabled:opacity-50"
                  data-testid={`scenario-load-${s.id}`}
                >
                  <Zap size={13} /> {active ? 'Current scenario' : 'Load scenario'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-[10px] border border-line bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[14px] font-semibold text-navy">Parameters · {def?.name ?? '—'}</h3>
            {!live && (
              <span className="inline-flex items-center gap-1 rounded-full bg-wash px-2 py-[2px] text-[11px] font-medium text-slate">
                <Lock size={11} /> Read-only in replay
              </span>
            )}
          </div>
          {!live && (
            <p className="mt-1 text-[12px] text-slate">
              Replay mode shows precomputed solver output. Editing parameters requires the live simulation service (<code className="text-[11px]">npm run dev:sim</code>) to recompute.
            </p>
          )}
          <div className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2" data-testid="param-form">
            {params &&
              (def?.editable ?? []).map((k) => {
                const meta = PARAM_META[k];
                const v = params[k];
                if (k === 'faultLineId' && def?.faultOptions.length) {
                  return (
                    <label key={k} className="block text-[12px]">
                      <span className="text-slate">{meta.label}</span>
                      <select
                        disabled={!live}
                        value={String(v)}
                        onChange={(e) => setParams({ ...params, faultLineId: Number(e.target.value) })}
                        className="mt-0.5 block w-full rounded-md border border-line bg-white px-2 py-1 text-[12.5px] text-navy disabled:bg-wash disabled:text-ink"
                      >
                        {def.faultOptions.map((o) => (
                          <option key={o.lineId} value={o.lineId}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                }
                return (
                  <label key={k} className="block text-[12px]" title={meta.hint}>
                    <span className="text-slate">
                      {meta.label}
                      {meta.unit && <span className="text-mist"> ({meta.unit})</span>}
                    </span>
                    <input
                      type="number"
                      disabled={!live}
                      value={v == null ? '' : String(v)}
                      min={meta.min}
                      max={meta.max}
                      step={meta.step}
                      onChange={(e) => setParams({ ...params, [k]: e.target.value === '' ? (k === 'repairTimeMin' ? null : 0) : Number(e.target.value) })}
                      className="mt-0.5 block w-full rounded-md border border-line bg-white px-2 py-1 text-[12.5px] text-navy tabular disabled:bg-wash disabled:text-ink"
                    />
                  </label>
                );
              })}
          </div>
          {params && (
            <div className="mt-3 border-t border-line pt-2 text-[11.5px] text-slate">
              Fixed in this scenario: horizon {fmtNum(params.horizonMin, 0)} min · frames every {fmtNum(params.stepMin, 1)} min · seed {params.seed}
            </div>
          )}
        </div>

        <div className="rounded-[10px] border border-line bg-white px-4 py-3" data-testid="weights-form">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[14px] font-semibold text-navy">Objective weights (Encirra planner)</h3>
            {baseWeights && (
              <button type="button" className="text-[11.5px] font-medium text-info hover:underline disabled:opacity-40" disabled={!dirty} onClick={() => setWeights(baseWeights)}>
                Restore loaded weights
              </button>
            )}
          </div>
          <p className="mt-1 text-[12px] text-slate">
            Soft preferences only — hard safety constraints are never weighted. {live ? 'Recompute to re-rank candidates with these weights.' : 'Recomputing with new weights needs the live simulation service; the replay keeps the weights it was computed with.'}
          </p>
          <div className="mt-2 space-y-2">
            {weights &&
              WEIGHT_META.map((w) => {
                const base = baseWeights?.[w.key] ?? 1;
                const max = Math.max(10, Math.ceil(base * 3));
                return (
                  <label key={w.key} className="grid grid-cols-[minmax(0,1fr)_120px_48px] items-center gap-3 text-[12px]">
                    <span className="min-w-0">
                      <span className="text-navy">{w.label}</span> <span className="text-mist">({w.unit})</span>
                    </span>
                    <input
                      type="range"
                      className="enc-range"
                      min={0}
                      max={max}
                      step={max / 100}
                      value={weights[w.key]}
                      onChange={(e) => setWeights({ ...weights, [w.key]: Number(e.target.value) })}
                      aria-label={w.label}
                    />
                    <span className="text-right font-semibold text-navy tabular">{fmtNum(weights[w.key], 2)}</span>
                  </label>
                );
              })}
          </div>
          {!live && dirty && <p className="mt-2 rounded-md bg-warn-soft px-2 py-1 text-[11.5px] text-warn">Edited weights are not applied in replay mode.</p>}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-navy">Strategy comparison · {def?.name ?? ''}</h3>
          <ExportButtons size="sm" />
        </div>
        <ComparisonTable compact testId="scenario-comparison" />
      </div>
    </PageFrame>
  );
}

import { useMemo } from 'react';
import { Check, ShieldCheck, ShieldX, X as XIcon } from 'lucide-react';
import clsx from 'clsx';
import type { CandidateEvaluation, ObjectiveWeights, RunResult, ScoreBreakdown, VerificationCheck } from '@encirra/shared';
import { useTwin } from '@/state/store';
import { Modal } from '@/ui/Modal';
import { rankFor, scoreFor, sortedCandidates, STRATEGY_LONG } from '@/data/selectors';
import { busName, fmtInt, fmtKW, fmtMs, fmtNum, fmtPu } from '@/data/format';
import { Pill } from '@/ui/primitives';

const COMPONENTS: { key: keyof Omit<ScoreBreakdown, 'total'>; label: string; weight: keyof ObjectiveWeights; unit: string }[] = [
  { key: 'servedLoad', label: 'Electrical demand served', weight: 'servedLoad', unit: 'per MWh' },
  { key: 'criticalLoad', label: 'Critical electrical demand served', weight: 'criticalLoad', unit: 'per MWh' },
  { key: 'waterDelivered', label: 'Water demand delivered', weight: 'waterDelivered', unit: 'per 1,000 m³' },
  { key: 'criticalWater', label: 'Critical-facility water service', weight: 'criticalWater', unit: 'per hour' },
  { key: 'pressureStorage', label: 'Pressure & storage margin', weight: 'pressureStorage', unit: 'per %' },
  { key: 'switchingCost', label: 'Switching operations (penalty)', weight: 'switchingCost', unit: 'per operation' },
];

function H({ children, n }: { children: React.ReactNode; n?: number }) {
  return (
    <h3 className="mt-5 mb-2 flex items-center gap-2 text-[13px] font-semibold tracking-wide text-navy uppercase first:mt-0">
      {children}
      {n != null && <span className="rounded-full bg-wash px-1.5 text-[11px] font-semibold text-slate normal-case">{n}</span>}
    </h3>
  );
}

export function VerifiedBadge({ passed }: { passed: boolean }) {
  return passed ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-ok px-2 py-[3px] text-[11px] font-semibold text-white" data-testid="verified-badge">
      <ShieldCheck size={13} /> Simulation Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-fault-soft px-2 py-[3px] text-[11px] font-semibold text-fault">
      <ShieldX size={13} /> Failed verification
    </span>
  );
}

function CheckTable({ checks }: { checks: VerificationCheck[] }) {
  return (
    <table className="w-full border-collapse text-left text-[12px]">
      <thead>
        <tr className="border-b border-line text-slate">
          <th className="py-1 pr-2 font-medium">Check</th>
          <th className="py-1 pr-2 font-medium">Type</th>
          <th className="py-1 pr-2 font-medium">Measured</th>
          <th className="py-1 pr-2 font-medium">Limit</th>
          <th className="py-1 font-medium">Result</th>
        </tr>
      </thead>
      <tbody>
        {checks.map((c) => (
          <tr key={c.id} className="border-b border-line/60 align-top" title={c.detail}>
            <td className="py-1 pr-2 text-navy">{c.name}</td>
            <td className="py-1 pr-2 text-slate">{c.hard ? 'Hard' : 'Soft'}</td>
            <td className="py-1 pr-2 text-ink tabular">{c.value}</td>
            <td className="py-1 pr-2 text-slate tabular">{c.limit}</td>
            <td className="py-1">
              {c.passed ? (
                <span className="inline-flex items-center gap-1 font-semibold text-ok-deep">
                  <Check size={13} strokeWidth={3} /> Pass
                </span>
              ) : (
                <span className={clsx('inline-flex items-center gap-1 font-semibold', c.hard ? 'text-fault' : 'text-warn')}>
                  <XIcon size={13} strokeWidth={3} /> {c.hard ? 'Fail' : 'Advisory'}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Breakdown({ run, chosen, runnerUp }: { run: RunResult; chosen: ScoreBreakdown; runnerUp: CandidateEvaluation | null }) {
  const rb = runnerUp?.scoreBreakdown ?? null;
  const max = Math.max(1e-9, ...COMPONENTS.flatMap((c) => [Math.abs(chosen[c.key]), rb ? Math.abs(rb[c.key]) : 0]));
  return (
    <div className="rounded-lg border border-line">
      <table className="w-full border-collapse text-left text-[12px]">
        <thead>
          <tr className="border-b border-line bg-wash text-slate">
            <th className="px-3 py-1.5 font-medium">Objective term</th>
            <th className="px-2 py-1.5 font-medium">Weight</th>
            <th className="px-2 py-1.5 font-medium">Selected plan</th>
            {rb && <th className="px-2 py-1.5 font-medium">Runner-up ({runnerUp!.id})</th>}
          </tr>
        </thead>
        <tbody>
          {COMPONENTS.map((c) => (
            <tr key={c.key} className="border-b border-line/60">
              <td className="px-3 py-1.5 text-navy">{c.label}</td>
              <td className="px-2 py-1.5 text-slate tabular" title={c.unit}>
                {fmtNum(run.weights[c.weight], 2)} <span className="text-[10px] text-mist">{c.unit}</span>
              </td>
              <td className="px-2 py-1.5">
                <Bar value={chosen[c.key]} max={max} color="#2A6CB5" />
              </td>
              {rb && (
                <td className="px-2 py-1.5">
                  <Bar value={rb[c.key]} max={max} color="#98A2AD" />
                </td>
              )}
            </tr>
          ))}
          <tr className="bg-wash/60 font-semibold">
            <td className="px-3 py-1.5 text-navy">Total score</td>
            <td />
            <td className="px-2 py-1.5 text-navy tabular">{fmtNum(chosen.total, 2)}</td>
            {rb && <td className="px-2 py-1.5 text-ink tabular">{fmtNum(rb.total, 2)}</td>}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = (Math.abs(value) / max) * 100;
  return (
    <div className="flex items-center gap-2">
      <div className="h-[8px] w-[110px] shrink-0 overflow-hidden rounded-sm bg-wash">
        <div className="h-full rounded-r-[3px]" style={{ width: `${w}%`, background: value < 0 ? '#F04438' : color }} />
      </div>
      <span className="text-ink tabular">{fmtNum(value, 2)}</span>
    </div>
  );
}

export function WhyPlanModal() {
  const open = useTwin((s) => s.whyPlanOpen);
  const setOpen = useTwin((s) => s.setWhyPlanOpen);
  const run = useTwin((s) => s.run);
  const topology = useTwin((s) => s.topology);
  const fname = (id: string) => topology?.facilities.find((f) => f.id === id)?.name ?? id;
  const cands = useMemo(() => (run ? sortedCandidates(run) : []), [run]);
  const plan = run?.plan ?? null;
  const strategy = run?.strategy ?? 'encirra';
  const feasible = cands.filter((c) => c.feasible);
  const rejected = cands.filter((c) => !c.feasible);
  const runnerUp = plan ? (feasible.find((c) => c.id !== plan.candidateId) ?? null) : null;
  const clockAt = (t: number | null | undefined) => (run && t != null ? (run.frames.find((f) => f.t >= t)?.clock ?? null) : null);

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      testId="why-plan"
      title="Why this plan?"
      badge={plan ? <VerifiedBadge passed={plan.verification.passed} /> : undefined}
      subtitle={run ? `${STRATEGY_LONG[strategy]} · ${run.summary.faultLabel} · ${run.provenance.source === 'live' ? 'live solver run' : 'replay of precomputed solver output'}` : undefined}
    >
      {!run ? (
        <p className="text-[13px] text-slate">No run loaded.</p>
      ) : (
        <div className="text-[13px] text-ink">
          {!plan ? (
            <div className="rounded-lg border border-line bg-wash px-4 py-3">
              <div className="font-semibold text-navy">{strategy === 'none' ? 'Baseline: no recovery action is taken' : 'No feasible recovery plan'}</div>
              <p className="mt-1 text-slate">
                {strategy === 'none'
                  ? 'The no-intervention run is the comparison baseline. Switch the strategy to Grid-only or Encirra to see the selected plan and its verification.'
                  : `${run.summary.candidatesRejected} of ${run.summary.candidatesEvaluated} candidates failed at least one hard check, so the outage persists.`}
              </p>
            </div>
          ) : (
            <>
              <H>Selected plan</H>
              <div className="rounded-lg border border-line px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-navy">{plan.label}</span>
                  <Pill tone="info">Candidate {plan.candidateId}</Pill>
                  <Pill tone={plan.outcome === 'complete' ? 'ok' : plan.outcome === 'partial' ? 'warn' : 'fault'}>Outcome: {plan.outcome}</Pill>
                </div>
                <ul className="mt-2 space-y-1">
                  {plan.actions.map((a) => (
                    <li key={`${a.switchId}-${a.action}`} className="flex gap-2">
                      <span className={clsx('w-12 shrink-0 font-semibold uppercase', a.action === 'close' ? 'text-ok-deep' : 'text-fault')}>{a.action}</span>
                      <span className="font-medium text-navy">{a.switchId}</span>
                      <span className="text-slate">— {a.reason}</span>
                    </li>
                  ))}
                  {plan.shedBuses.length > 0 && (
                    <li className="flex gap-2">
                      <span className="w-12 shrink-0 font-semibold text-warn uppercase">shed</span>
                      <span className="text-navy">{plan.shedBuses.map(busName).join(', ')}</span>
                    </li>
                  )}
                </ul>
                <div className="mt-2 text-[12px] text-slate">
                  Verified at {clockAt(plan.verifiedAtT) ?? '—'} · applied at {clockAt(plan.appliedAtT) ?? 'not applied'} · score {fmtNum(plan.score, 2)} · plan computed in {fmtMs(run.summary.planComputeMs)}
                </div>
              </div>

              <H>Why it ranked highest</H>
              {plan.rationale.length > 0 && (
                <ul className="mb-3 list-disc space-y-1 pl-5 text-ink">
                  {plan.rationale.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
              <Breakdown run={run} chosen={plan.scoreBreakdown} runnerUp={runnerUp} />
              <p className="mt-1.5 text-[11.5px] text-slate">
                Weighted soft objectives only; hard safety constraints are never traded off against score — a candidate that fails any hard check is rejected outright.
              </p>
            </>
          )}

          {cands.length > 0 && (
            <>
              <H n={cands.length}>Candidates considered</H>
              <div className="enc-scroll max-h-[260px] overflow-auto rounded-lg border border-line">
                <table className="w-full border-collapse text-left text-[12px]">
                  <thead className="sticky top-0 bg-wash text-slate">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Rank</th>
                      <th className="px-2 py-1.5 font-medium">Candidate</th>
                      <th className="px-2 py-1.5 font-medium">Restored</th>
                      <th className="px-2 py-1.5 font-medium">Pumps</th>
                      <th className="px-2 py-1.5 font-medium">Crit. pressure</th>
                      <th className="px-2 py-1.5 font-medium">V<sub>min</sub></th>
                      <th className="px-2 py-1.5 font-medium">Score</th>
                      <th className="px-2 py-1.5 font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cands.map((c) => {
                      const sel = plan?.candidateId === c.id;
                      return (
                        <tr key={c.id} className={clsx('border-t border-line/60 align-top', sel && 'bg-info-soft/70')} data-testid={`cand-${c.id}`}>
                          <td className="px-2 py-1.5 text-navy tabular">{rankFor(c, strategy) ?? '—'}</td>
                          <td className="px-2 py-1.5">
                            <div className="font-medium text-navy">
                              {c.id} {sel && <span className="ml-1 text-[11px] font-semibold text-info">selected</span>}
                            </div>
                            <div className="text-[11.5px] text-slate">{c.label}</div>
                          </td>
                          <td className="px-2 py-1.5 tabular">{fmtKW(c.metrics.restoredKW)}</td>
                          <td className="px-2 py-1.5 tabular">{fmtInt(c.metrics.pumpsRestored)}</td>
                          <td className="px-2 py-1.5 tabular">{fmtNum(c.metrics.minCriticalPressureM, 1)} m</td>
                          <td className="px-2 py-1.5 tabular">{fmtPu(c.metrics.vMinPu)}</td>
                          <td className="px-2 py-1.5 tabular">{scoreFor(c, strategy) == null ? '—' : fmtNum(scoreFor(c, strategy), 2)}</td>
                          <td className="px-2 py-1.5">{c.feasible ? <Pill tone="ok">Feasible</Pill> : <Pill tone="fault">Rejected</Pill>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {rejected.length > 0 && (
            <>
              <H n={rejected.length}>Rejected candidates</H>
              <ul className="space-y-2">
                {rejected.map((c) => {
                  const failed = c.checks.filter((k) => !k.passed && k.hard);
                  return (
                    <li key={c.id} className="rounded-lg border border-fault/20 bg-fault-soft/40 px-3 py-2" data-testid={`rejected-${c.id}`}>
                      <div className="font-medium text-navy">
                        {c.id} · <span className="font-normal text-ink">{c.label}</span>
                      </div>
                      <ul className="mt-1 space-y-0.5 text-[12px]">
                        {c.rejectedReasons.map((r, i) => (
                          <li key={i} className="flex gap-1.5 text-fault">
                            <XIcon size={13} className="mt-[2px] shrink-0" strokeWidth={3} />
                            <span className="text-ink">{r}</span>
                          </li>
                        ))}
                        {failed.map((k) => (
                          <li key={k.id} className="pl-5 text-slate">
                            {k.name}: {k.value} (limit {k.limit})
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {plan && (
            <>
              <H>Independent verification</H>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-slate">
                <VerifiedBadge passed={plan.verification.passed} />
                <span>{plan.verification.method}</span>
              </div>
              <CheckTable checks={plan.verification.checks} />

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div>
                  <H>Critical infrastructure protected</H>
                  {plan.protectedFacilities.length ? (
                    <ul className="space-y-1">
                      {plan.protectedFacilities.map((id) => (
                        <li key={id} className="flex items-center gap-1.5">
                          <ShieldCheck size={14} className="text-ok" /> {fname(id)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-slate">None listed by the planner.</p>
                  )}
                </div>
                <div>
                  <H>What remains unserved</H>
                  <p>
                    <b className="text-navy">{fmtKW(plan.unservedAfter.kW)}</b>
                    {plan.unservedAfter.buses.length > 0 && <> at {plan.unservedAfter.buses.map(busName).join(', ')}</>}
                  </p>
                  {plan.unservedAfter.facilities.length > 0 && <p className="mt-1 text-slate">Facilities: {plan.unservedAfter.facilities.map(fname).join(', ')}</p>}
                  <p className="mt-1 text-slate">End of horizon: {fmtKW(run.summary.remainingUnservedKW)} unserved (all causes).</p>
                </div>
              </div>

              {plan.assumptions.length > 0 && (
                <>
                  <H>Assumptions limiting this conclusion</H>
                  <ul className="list-disc space-y-1 pl-5 text-ink">
                    {plan.assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

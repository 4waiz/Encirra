import { useMemo } from 'react';
import {
  BrainCircuit,
  Crosshair,
  ScanSearch,
  Siren,
  UserCheck,
  ListChecks,
  ShieldCheck,
  Waypoints,
  Activity,
  CalendarClock,
  BadgeCheck,
  Box,
  Circle,
} from 'lucide-react';
import { useSim } from '../../store/sim';
import { useUI } from '../../store/ui';
import { engine } from '../../simulation/engine';
import { SENSOR_BY_ID } from '../../simulation/sensors';
import { Panel, Chip, ProgressBar, Metric, EmptyState, cx, StatusDot } from '../../components/ui/primitives';
import { OBS_STATUS, EVIDENCE_ICON, confidenceTone } from '../../components/panels/AIFusionPanel';
import { ConfidenceChart } from '../../components/charts/ConfidenceChart';
import { TelemetryChart, LANES } from '../../components/charts/TelemetryChart';
import { FeedViewport } from '../../components/feeds/FeedViewport';
import { focusOn } from '../../three/CameraRig';
import { INCIDENT_CATEGORY_LABEL, TONE_HEX } from '../../components/ui/tone';
import { fmtClock, fmtAgo } from '../../utils/format';
import { SeededRandom, hashString } from '../../utils/random';
import type { Observation } from '../../types';

function ObservationList({ list, selected }: { list: Observation[]; selected: Observation | undefined }) {
  return (
    <Panel title="Active observations" icon={BrainCircuit} iconColor="#b4a8ff" className="min-h-0">
      <div className="absolute inset-0 overflow-y-auto p-2">
        {list.length === 0 && <EmptyState icon={ShieldCheck} title="No observations" detail="The fusion model has nothing above the review threshold." />}
        {list.map((o) => {
          const st = OBS_STATUS[o.status];
          const on = selected?.id === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => useUI.getState().selectObservation(o.id)}
              className={cx(
                'mb-1.5 flex w-full flex-col gap-1.5 rounded-[6px] border px-2.5 py-2 text-left transition-colors',
                on ? 'border-[rgb(180_168_255/0.55)] bg-[rgb(180_168_255/0.07)]' : 'border-line hover:bg-surface-2',
                (o.status === 'cleared' || o.status === 'validated') && 'opacity-70',
              )}
              aria-pressed={on}
            >
              <span className="flex items-center gap-2">
                <span className="mono text-[10.5px] text-ink-3">{o.id}</span>
                <Chip tone={st.tone} className="ml-auto">
                  {o.status === 'validation' ? 'Validation' : st.label}
                </Chip>
              </span>
              <span className="text-[12.5px] font-medium leading-[16px] text-ink-1">{o.title}</span>
              <span className="truncate text-[10.5px] text-ink-3">{o.location.label}</span>
              <span className="flex items-center gap-2">
                <ProgressBar value={o.confidence} color={confidenceTone(o.confidence)} height={4} />
                <span className="num w-[34px] text-right text-[11px] text-ink-1">{Math.round(o.confidence * 100)}%</span>
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

/** Sources → fusion → observation, link width = evidence weight. */
function CorrelationGraph({ obs }: { obs: Observation }) {
  const nodes = obs.evidence.slice(-5);
  const W = 520;
  const H = 168;
  const fx = 300;
  const fy = H / 2;
  const ox = 470;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Cross-source correlation">
      {nodes.map((e, i) => {
        const y = 18 + (i * (H - 36)) / Math.max(1, nodes.length - 1 || 1);
        const yy = nodes.length === 1 ? fy : y;
        return (
          <g key={e.id}>
            <path d={`M150,${yy} C220,${yy} 230,${fy} ${fx - 22},${fy}`} fill="none" stroke="#b4a8ff" strokeOpacity={0.25 + e.weight * 0.6} strokeWidth={1 + e.weight * 4.5} />
            <rect x="6" y={yy - 13} width="144" height="26" rx="5" fill="#151d27" stroke="rgb(148 163 184 / 0.22)" />
            <text x="16" y={yy + 4} fontSize="11" fill="#ece7df" className="mono">
              {e.source.length > 17 ? `${e.source.slice(0, 16)}…` : e.source}
            </text>
            <text x={fx - 34 - (i % 2) * 10} y={(yy + fy) / 2 - 3} fontSize="9" fill="#a9b3be" className="num" textAnchor="end">
              {Math.round(e.weight * 100)}%
            </text>
          </g>
        );
      })}
      <circle cx={fx} cy={fy} r="22" fill="rgb(180 168 255 / 0.12)" stroke="#b4a8ff" strokeWidth="1.5" />
      <text x={fx} y={fy - 2} fontSize="9.5" fill="#ece7df" textAnchor="middle" className="font-cond" fontWeight="600">
        FUSION
      </text>
      <text x={fx} y={fy + 10} fontSize="9" fill="#a9b3be" textAnchor="middle" className="num">
        {Math.round(obs.confidence * 100)}%
      </text>
      <path d={`M${fx + 22},${fy} L${ox - 30},${fy}`} stroke="#b4a8ff" strokeWidth={2 + obs.confidence * 3} strokeOpacity="0.8" markerEnd="url(#arrow)" />
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#b4a8ff" />
        </marker>
      </defs>
      <rect x={ox - 28} y={fy - 20} width="76" height="40" rx="6" fill="rgb(255 138 61 / 0.1)" stroke={TONE_HEX[OBS_STATUS[obs.status].tone]} />
      <text x={ox + 10} y={fy - 3} fontSize="9.5" fill="#ece7df" textAnchor="middle" className="font-cond" fontWeight="600">
        OBSERVATION
      </text>
      <text x={ox + 10} y={fy + 10} fontSize="9" fill="#a9b3be" textAnchor="middle" className="mono">
        {obs.id}
      </text>
    </svg>
  );
}

function HistoricalPattern({ obs }: { obs: Observation }) {
  const bars = useMemo(() => {
    const rng = new SeededRandom(hashString(`${obs.category}:${obs.location.label}`));
    return Array.from({ length: 30 }, (_, i): number => (i === 29 ? 1 : rng.float() < 0.12 ? 1 : rng.float() < 0.04 ? 2 : 0));
  }, [obs.category, obs.location.label]);
  const total = bars.reduce((a, b) => a + b, 0) - 1;
  return (
    <div className="flex h-full flex-col p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11.5px] text-ink-2">Similar patterns · last 30 days</span>
        <span className="num text-[11.5px] text-ink-1">{total} prior</span>
      </div>
      <div className="mt-2 flex min-h-0 flex-1 items-end gap-[3px]" role="img" aria-label={`${total} similar anomaly patterns in the previous 30 days`}>
        {bars.map((b, i) => (
          <div key={i} className="flex flex-1 flex-col justify-end" title={`Day −${29 - i}: ${b}`}>
            <div
              className="w-full rounded-t-[2px]"
              style={{ height: b ? `${Math.min(100, b * 45)}%` : '2px', background: i === 29 ? '#ff8a3d' : b ? '#7f8a97' : 'rgb(148 163 184 / 0.18)' }}
            />
          </div>
        ))}
      </div>
      <div className="mono mt-1 flex justify-between text-[9.5px] text-ink-3">
        <span>−30 d</span>
        <span>today</span>
      </div>
      <p className="mt-1.5 text-[10.5px] leading-[14px] text-ink-3">
        {total <= 1 ? 'Pattern is uncommon for this location — review suggested.' : 'Recurring pattern; prior events closed after operator review.'}
      </p>
    </div>
  );
}

function SourceIntegrity({ obs }: { obs: Observation }) {
  const sensors = useSim((s) => s.sensors);
  const metrics = useSim((s) => s.metrics);
  const assets = useSim((s) => s.assets);
  return (
    <div className="absolute inset-0 overflow-y-auto">
      {obs.sources.map((src) => {
        const id = src.split(' ')[0];
        const def = SENSOR_BY_ID[id];
        let tone: 'ok' | 'watch' | 'offline' = 'ok';
        let line = '';
        if (def) {
          const st = sensors[id];
          tone = st?.status === 'offline' ? 'offline' : 'ok';
          const cal = 18 + (hashString(id) % 70);
          line = `${st ? Math.round(st.quality * 100) : 0}% complete · cal ${cal} d · ${metrics.latencyMs} ms`;
        } else if (id.startsWith('UGV') || id.startsWith('UAV')) {
          const a = assets[id as 'UGV-01' | 'UAV-01'];
          line = `Link ${a ? Math.round(a.signal) : 0}% · frame integrity verified`;
        } else if (id === 'Wind') {
          line = 'Dispersion model v2.3 · refreshed each tick';
        } else {
          line = 'Integrity verified';
        }
        return (
          <div key={src} className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0">
            <StatusDot tone={tone === 'offline' ? 'offline' : 'ok'} />
            <div className="min-w-0 flex-1">
              <div className="mono text-[11.5px] text-ink-1">{src}</div>
              <div className="truncate text-[10.5px] text-ink-3">{line}</div>
            </div>
            <Chip tone={tone === 'offline' ? 'offline' : 'ok'} icon={BadgeCheck}>
              {tone === 'offline' ? 'Stale' : 'Trusted'}
            </Chip>
          </div>
        );
      })}
    </div>
  );
}

function Detail({ obs }: { obs: Observation }) {
  const incident = useSim((s) => (obs.incidentId ? s.incidents.find((i) => i.id === obs.incidentId) : undefined));
  const st = OBS_STATUS[obs.status];
  const primary = obs.sources.find((s) => SENSOR_BY_ID[s]);
  const openIncident = (id: string) => {
    useUI.getState().selectIncident(id);
    useUI.getState().setScreen('incidents');
  };
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <section className="panel shrink-0 p-3.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-cond text-[11px] font-semibold uppercase tracking-[0.14em] text-[#b4a8ff]">
                {obs.category === 'multi' ? 'Multi-source observation' : `${INCIDENT_CATEGORY_LABEL[obs.category]} observation`}
              </span>
              <span className="mono text-[11px] text-ink-3">{obs.id}</span>
              <Chip tone={st.tone}>{st.label}</Chip>
            </div>
            <h2 className="mt-1.5 text-[19px] font-semibold leading-[24px] text-ink-1">{obs.title}</h2>
            <p className="mt-1 max-w-[760px] text-[12.5px] leading-[18px] text-ink-2">{obs.summary}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-3">
              <span>{obs.location.label}</span>
              <span>Opened {fmtClock(obs.createdAt)} GST</span>
              <span>Updated {fmtAgo(Date.now(), obs.updatedAt)}</span>
              <span>{obs.sources.length} supporting sources</span>
            </div>
          </div>
          <div className="w-[170px] shrink-0 text-right">
            <div className="micro">Confidence</div>
            <Metric value={obs.confidence * 100} suffix="%" className="text-[34px] font-semibold leading-[38px] text-ink-1" />
            <ProgressBar value={obs.confidence} color={confidenceTone(obs.confidence)} height={5} className="mt-1" />
            <div className="mt-1 text-[10.5px] text-ink-3">Not a determination — operator review applies</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button type="button" className="ctl h-[28px]" onClick={() => {
            useUI.getState().setScreen('twin');
            useUI.getState().select({ kind: 'location', x: obs.location.x, z: obs.location.z, label: obs.location.label });
            focusOn({ kind: 'location', x: obs.location.x, z: obs.location.z, radius: 110 });
          }}>
            <Crosshair size={13} /> Focus in Twin
          </button>
          <button
            type="button"
            className="ctl h-[28px]"
            onClick={() => {
              useUI.getState().setScreen('twin');
              if (primary) {
                useUI.getState().select({ kind: 'sensor', id: primary });
                focusOn({ kind: 'sensor', id: primary });
              }
            }}
          >
            <ScanSearch size={13} /> Inspect Sources
          </button>
          {incident ? (
            <button type="button" className="ctl h-[28px]" onClick={() => openIncident(incident.id)}>
              <Siren size={13} /> Open {incident.id}
            </button>
          ) : (
            <button
              type="button"
              className="ctl h-[28px]"
              onClick={() => {
                const id = engine.createIncidentFromObservation(obs.id);
                if (id) {
                  useUI.getState().notify(`Incident ${id} created`, 'ok');
                  openIncident(id);
                }
              }}
            >
              <Siren size={13} /> Create Incident
            </button>
          )}
          <button
            type="button"
            className={cx('ctl h-[28px]', obs.status === 'validation' && 'border-amber/60 text-amber')}
            disabled={obs.status === 'validated' || obs.status === 'cleared'}
            onClick={() => {
              engine.validateObservation(obs.id);
              useUI.getState().notify(`${obs.id} validated by operator`, 'ok');
            }}
          >
            <UserCheck size={13} /> {obs.status === 'validated' ? 'Validated' : 'Validate observation'}
          </button>
        </div>
      </section>

      <div className="grid min-h-0 flex-1 gap-2" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gridTemplateRows: 'minmax(0,0.9fr) minmax(0,1.1fr)' }}>
        <Panel title="Cross-source correlation" icon={Waypoints} iconColor="#b4a8ff" className="min-h-0">
          <div className="absolute inset-0 p-2">
            <CorrelationGraph obs={obs} />
          </div>
        </Panel>
        <Panel title="Confidence timeline" icon={Activity} iconColor="#b4a8ff" className="min-h-0">
          <div className="absolute inset-0 px-2 pb-1 pt-2">
            <ConfidenceChart obs={obs} />
          </div>
        </Panel>
        <Panel title="Evidence" icon={ListChecks} className="min-h-0">
          <div className="absolute inset-0 overflow-y-auto">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 bg-surface-1">
                <tr className="micro">
                  <th className="px-3 py-1.5 font-normal">Time</th>
                  <th className="px-2 py-1.5 font-normal">Source</th>
                  <th className="px-2 py-1.5 font-normal">Finding</th>
                  <th className="px-3 py-1.5 text-right font-normal">Weight</th>
                </tr>
              </thead>
              <tbody>
                {obs.evidence.map((e) => {
                  const Icon = EVIDENCE_ICON[e.sourceKind];
                  return (
                    <tr key={e.id} className="border-t border-line align-top">
                      <td className="mono whitespace-nowrap px-3 py-1.5 text-[10.5px] text-ink-3">{fmtClock(e.t)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <span className="flex items-center gap-1.5 text-[11px] text-ink-1">
                          <Icon size={12} className="text-ink-3" aria-hidden />
                          {e.source}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-[11px] leading-[14px] text-ink-2">
                        {e.summary}
                        {e.value && <span className="num ml-1.5 text-ink-1">{e.value}</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-[44px]">
                            <ProgressBar value={e.weight} color="#b4a8ff" height={3} />
                          </div>
                          <span className="num w-[28px] text-right text-[10.5px] text-ink-2">{Math.round(e.weight * 100)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Recommended review" icon={UserCheck} className="min-h-0">
          <ol className="absolute inset-0 overflow-y-auto p-3">
            {obs.recommended.map((r, i) => (
              <li key={r} className="flex gap-2.5 border-b border-line py-1.5 last:border-b-0">
                <span className="mono mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] bg-surface-3 text-[10px] text-ink-2">{i + 1}</span>
                <span className="text-[11.5px] leading-[16px] text-ink-1">{r}</span>
              </li>
            ))}
            <li className="mt-2 flex items-center gap-2 text-[10.5px] text-ink-3">
              <Circle size={8} aria-hidden /> Recommendations are advisory; no action is taken automatically.
            </li>
          </ol>
        </Panel>
      </div>
    </div>
  );
}

export function InsightsScreen() {
  const observations = useSim((s) => s.observations);
  const selectedId = useUI((s) => s.selectedObservationId);
  const list = useMemo(() => {
    const rank = { validation: 0, review: 1, monitoring: 2, validated: 3, cleared: 4 } as const;
    return [...observations].sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt - a.updatedAt);
  }, [observations]);
  const selected = list.find((o) => o.id === selectedId) ?? list[0];
  const lanes = useMemo(() => {
    if (!selected) return LANES;
    const cat = selected.category;
    if (cat === 'chem') return LANES.filter((l) => l.key === 'chem');
    if (cat === 'bio') return LANES.filter((l) => l.key === 'bio');
    if (cat === 'rad' || cat === 'multi') return LANES.filter((l) => l.key === 'rad');
    return LANES;
  }, [selected]);

  return (
    <div className="absolute inset-0 grid gap-2 p-2" style={{ gridTemplateColumns: 'clamp(250px, 18vw, 300px) minmax(0, 1fr) clamp(320px, 24vw, 400px)' }}>
      <ObservationList list={list} selected={selected} />
      {selected ? (
        <Detail obs={selected} />
      ) : (
        <section className="panel">
          <EmptyState icon={ShieldCheck} title="No active observations" detail="The fusion model is monitoring all sources. Observations appear here when correlated readings exceed the review threshold." />
        </section>
      )}
      <div className="flex min-h-0 flex-col gap-2">
        <Panel title="Corresponding telemetry" icon={Activity} iconColor="#3cc8dc" className="min-h-0 flex-[1.05]">
          <div className="absolute inset-0 px-2 pb-1 pt-2">
            <TelemetryChart lanes={lanes} compact />
          </div>
        </Panel>
        {selected && (
          <Panel title="Spatial context" icon={Box} iconColor="#4c94ff" className="min-h-0 flex-1" transparentBody>
            <FeedViewport viewId="insights-pip" source="PIP" mode="visible" size="thumb" pip={{ x: selected.location.x, z: selected.location.z }} detections={false} className="absolute inset-0">
              <span className="pointer-events-none absolute bottom-1.5 left-2 font-cond text-[10px] uppercase tracking-[0.12em] text-ink-1" style={{ textShadow: '0 1px 2px #000' }}>
                Twin view · {selected.location.label}
              </span>
            </FeedViewport>
          </Panel>
        )}
        {selected && (
          <Panel title="Historical anomaly pattern" icon={CalendarClock} className="min-h-0 flex-[0.8]">
            <HistoricalPattern obs={selected} />
          </Panel>
        )}
        {selected && (
          <Panel title="Source integrity" icon={ShieldCheck} className="min-h-0 flex-[0.85]">
            <SourceIntegrity obs={selected} />
          </Panel>
        )}
      </div>
    </div>
  );
}


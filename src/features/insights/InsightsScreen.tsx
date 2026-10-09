import { useEffect, useMemo, useRef, useState } from 'react';
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

function FusionEngineCard() {
  const sensors = useSim((s) => s.metrics.sensorsOnline);
  const now = useSim((s) => s.now);
  const models: [string, string][] = [
    ['Trend detector', 'v3.1'],
    ['Dispersion model', 'v2.3'],
    ['Thermal analytics', 'v1.8'],
    ['Visual detector', 'v4.0'],
  ];
  return (
    <div className="mt-auto rounded-[7px] border border-line bg-surface-2/50 p-2.5">
      <div className="flex items-center gap-2">
        <Waypoints size={13} className="text-[#b4a8ff]" aria-hidden />
        <span className="panel-title text-[11px]">Fusion engine</span>
        <span className="ml-auto flex items-center gap-1 text-[10.5px] text-green">
          <StatusDot tone="ok" size={6} /> Running
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
        {[
          [String(sensors), 'sensors'],
          ['4', 'cameras'],
          ['2', 'robots'],
        ].map(([v, l]) => (
          <div key={l} className="rounded-[5px] bg-bg-1/60 py-1">
            <div className="num text-[14px] font-semibold text-ink-1">{v}</div>
            <div className="text-[9.5px] uppercase tracking-[0.08em] text-ink-3">{l}</div>
          </div>
        ))}
      </div>
      <div className="mt-2">
        {models.map(([m, v]) => (
          <div key={m} className="flex items-center justify-between py-[2px] text-[11px]">
            <span className="text-ink-2">{m}</span>
            <span className="mono text-[10.5px] text-ink-3">{v}</span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 border-t border-line pt-1.5 text-[10.5px] text-ink-3">
        Review ≥ 60% · human validation ≥ 85% · last pass <span className="mono text-ink-2">{fmtClock(now)}</span>
      </div>
    </div>
  );
}

function ObservationList({ list, selected }: { list: Observation[]; selected: Observation | undefined }) {
  return (
    <Panel title="Active observations" icon={BrainCircuit} iconColor="#b4a8ff" className="min-h-0">
      <div className="absolute inset-0 flex flex-col overflow-y-auto p-2">
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
        <FusionEngineCard />
      </div>
    </Panel>
  );
}

/** Sources → fusion → observation, link width = evidence weight. Laid out to the panel's own size. */
function CorrelationGraph({ obs }: { obs: Observation }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { w: W, h: H } = size;
  const recent = obs.evidence.slice(-5);
  const fitCount = Math.max(1, Math.floor((H - 22) / 22));
  const nodes = recent.length > fitCount ? [...recent].sort((a, b) => b.weight - a.weight).slice(0, fitCount) : recent;
  const hidden = recent.length - nodes.length;
  // source names get the room first; on narrow panels the observation box, then the source column,
  // then the fusion node shrink so the three never touch
  const obsW = W < 400 ? 86 : 104;
  const rMax = W < 400 ? 22 : 26;
  const gapFor = (rad: number) => 2 * rad + 34;
  let nodeW = Math.round(Math.min(196, Math.max(160, W * 0.4)));
  if (W - obsW - 10 - nodeW < gapFor(rMax)) nodeW = Math.max(132, W - obsW - 10 - gapFor(rMax));
  const r = Math.max(15, Math.min(rMax, (W - obsW - 10 - nodeW - 34) / 2));
  const nodeH = Math.max(18, Math.min(28, Math.floor((H - 22) / Math.max(1, nodes.length)) - 4));
  const ox = W - obsW - 4;
  const fx = nodeW + 6 + (ox - nodeW - 6) * 0.5;
  const fy = (H - 14) / 2;
  const top = 8 + nodeH / 2;
  const span = Math.max(0, H - 22 - nodeH);
  const ny = (i: number) => (nodes.length === 1 ? fy : top + (i * span) / (nodes.length - 1));
  // mono advance is 0.6 em; the name ends a few px before the right-aligned weight
  const nameSize = nodeH < 24 ? 10 : nodeW < 170 ? 10.5 : 11;
  const maxChars = Math.floor((nodeW - 43) / (nameSize * 0.6));
  return (
    <div ref={ref} className="relative h-full w-full">
      {W > 0 && H > 0 && (
        <svg width={W} height={H} role="img" aria-label={`Cross-source correlation: ${nodes.map((e) => `${e.source} ${Math.round(e.weight * 100)}%`).join(', ')}`}>
          <defs>
            <marker id="corr-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#b4a8ff" />
            </marker>
          </defs>
          {nodes.map((e, i) => {
            const y = ny(i);
            const x0 = nodeW + 6;
            const mx = (x0 + fx - r) / 2;
            return (
              <g key={e.id}>
                <path d={`M${x0},${y} C${mx},${y} ${mx},${fy} ${fx - r},${fy}`} fill="none" stroke="#b4a8ff" strokeOpacity={0.25 + e.weight * 0.6} strokeWidth={1 + e.weight * 5} />
                <rect x="6" y={y - nodeH / 2} width={nodeW} height={nodeH} rx="5" fill="#151d27" stroke="rgb(148 163 184 / 0.24)" />
                <text x="15" y={y + 4} fontSize={nameSize} fill="#ece7df" className="mono">
                  {e.source.length > maxChars ? `${e.source.slice(0, maxChars - 1)}…` : e.source}
                </text>
                <text x={nodeW - 3} y={y + 4} fontSize="10.5" fill="#a9b3be" className="num" textAnchor="end">
                  {Math.round(e.weight * 100)}%
                </text>
              </g>
            );
          })}
          <circle cx={fx} cy={fy} r={r} fill="rgb(180 168 255 / 0.12)" stroke="#b4a8ff" strokeWidth="1.5" />
          <text x={fx} y={fy - 2} fontSize={r < 20 ? 8.5 : 10} fill="#ece7df" textAnchor="middle" className="font-cond" fontWeight="600">
            FUSION
          </text>
          <text x={fx} y={fy + (r < 20 ? 9 : 11)} fontSize={r < 20 ? 8.5 : 10} fill="#a9b3be" textAnchor="middle" className="num">
            {Math.round(obs.confidence * 100)}%
          </text>
          <path d={`M${fx + r},${fy} L${ox - 4},${fy}`} stroke="#b4a8ff" strokeWidth={2 + obs.confidence * 3} strokeOpacity="0.8" markerEnd="url(#corr-arrow)" />
          <rect x={ox} y={fy - 23} width={obsW} height="46" rx="6" fill="rgb(255 138 61 / 0.1)" stroke={TONE_HEX[OBS_STATUS[obs.status].tone]} />
          <text x={ox + obsW / 2} y={fy - 3} fontSize="10" fill="#ece7df" textAnchor="middle" className="font-cond" fontWeight="600">
            OBSERVATION
          </text>
          <text x={ox + obsW / 2} y={fy + 12} fontSize="10" fill="#a9b3be" textAnchor="middle" className="mono">
            {obs.id}
          </text>
          <text x="6" y={H - 2} fontSize="9.5" fill="#75818e" className="font-cond">
            Line width = evidence weight{hidden > 0 ? ` · +${hidden} more in Evidence` : ''}
          </text>
        </svg>
      )}
    </div>
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
          <div key={i} className="flex h-full flex-1 flex-col justify-end" title={`Day −${29 - i}: ${b}`}>
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
                  <th className="px-3 py-1.5 font-normal">Source · time</th>
                  <th className="px-2 py-1.5 font-normal">Finding</th>
                  <th className="px-3 py-1.5 text-right font-normal">Weight</th>
                </tr>
              </thead>
              <tbody>
                {obs.evidence.map((e) => {
                  const Icon = EVIDENCE_ICON[e.sourceKind];
                  return (
                    <tr key={e.id} className="border-t border-line align-top">
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <span className="flex items-center gap-1.5 text-[11px] text-ink-1">
                          <Icon size={12} className="text-ink-3" aria-hidden />
                          {e.source}
                        </span>
                        <span className="mono block pl-[18px] text-[10px] text-ink-3">{fmtClock(e.t)}</span>
                      </td>
                      <td className="px-2 py-1.5 text-[11px] leading-[14px] text-ink-2">
                        {e.summary}
                        {e.value && <span className="num ml-1.5 text-ink-1">{e.value}</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-[36px]">
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
    <div className="absolute inset-0 overflow-y-auto">
      <div className="grid h-full min-h-[640px] gap-2 p-2" style={{ gridTemplateColumns: 'clamp(250px, 18vw, 300px) minmax(0, 1fr) clamp(320px, 24vw, 400px)' }}>
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
    </div>
  );
}


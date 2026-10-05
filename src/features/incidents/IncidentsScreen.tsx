import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Siren,
  CircleCheck,
  Crosshair,
  Play,
  UserPlus,
  Check,
  BrainCircuit,
  Bot,
  Cpu,
  ScanEye,
  UserRound,
  Activity,
  ClipboardList,
  Radio,
  Box,
  ChevronDown,
  ShieldCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSim } from '../../store/sim';
import { useUI } from '../../store/ui';
import { engine } from '../../simulation/engine';
import { focusOn } from '../../three/CameraRig';
import { Panel, Chip, Segmented, ProgressBar, StatusDot, EmptyState, cx, useNow } from '../../components/ui/primitives';
import { ResponseKpisPanel } from '../../components/panels/ResponseKpisPanel';
import { FeedViewport } from '../../components/feeds/FeedViewport';
import { ASSET_ICON } from '../../components/twin/TwinMarkers';
import { SEVERITY_LABEL, SEVERITY_TONE, TONE_HEX, INCIDENT_CATEGORY_LABEL } from '../../components/ui/tone';
import { fmtClock, fmtDuration, fmtDistance } from '../../utils/format';
import type { AssetId, Incident, Severity, TimelineKind } from '../../types';

const TL_ICON: Record<TimelineKind, LucideIcon> = {
  detect: Activity,
  ai: BrainCircuit,
  asset: Bot,
  operator: UserRound,
  system: Cpu,
  evidence: ScanEye,
};
const TL_COLOR: Record<TimelineKind, string> = {
  detect: '#ff8a3d',
  ai: '#b4a8ff',
  asset: '#4c94ff',
  operator: '#3dd68c',
  system: '#a7b1bb',
  evidence: '#3cc8dc',
};

const STATUS_LABEL: Record<Incident['status'], string> = {
  new: 'New · awaiting acknowledgement',
  acknowledged: 'Acknowledged',
  investigating: 'Investigating',
  resolved: 'Resolved',
};

function IncidentList({ selected }: { selected: Incident | undefined }) {
  const incidents = useSim((s) => s.incidents);
  const now = useNow(1000);
  const active = incidents.filter((i) => i.status !== 'resolved');
  const resolved = incidents.filter((i) => i.status === 'resolved');
  const card = (i: Incident) => {
    const tone = SEVERITY_TONE[i.severity];
    const on = selected?.id === i.id;
    return (
      <button
        key={i.id}
        type="button"
        onClick={() => useUI.getState().selectIncident(i.id)}
        aria-pressed={on}
        className={cx(
          'relative mb-1.5 flex w-full flex-col gap-1 overflow-hidden rounded-[6px] border py-2 pl-3.5 pr-2.5 text-left transition-colors',
          on ? 'border-line-bright bg-surface-3' : 'border-line hover:bg-surface-2',
          i.status === 'resolved' && 'opacity-65',
        )}
      >
        <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: TONE_HEX[tone] }} aria-hidden />
        <span className="flex items-center gap-2">
          <span className="mono text-[11px] text-ink-1">{i.id}</span>
          <Chip tone={tone}>{SEVERITY_LABEL[i.severity]}</Chip>
          <span className="mono ml-auto text-[10.5px] text-ink-3">{fmtDuration(((i.resolvedAt ?? now) - i.createdAt) / 1000)}</span>
        </span>
        <span className="text-[12px] font-medium leading-[15px] text-ink-1">{i.title}</span>
        <span className="flex items-center gap-1.5 text-[10.5px] text-ink-3">
          {i.status === 'new' && <StatusDot tone="warn" size={6} pulse />}
          {STATUS_LABEL[i.status]} · {INCIDENT_CATEGORY_LABEL[i.category]}
        </span>
      </button>
    );
  };
  return (
    <Panel title="Incidents" icon={Siren} iconColor="#ff8a3d" className="min-h-0" subtitle={`${active.length} active`}>
      <div className="absolute inset-0 overflow-y-auto p-2">
        {incidents.length === 0 && <EmptyState icon={ShieldCheck} title="No incidents" detail="The site is operating within its baseline. New incidents appear here automatically." />}
        {active.length > 0 && <div className="micro mb-1 px-1">Active</div>}
        {active.map(card)}
        {resolved.length > 0 && <div className="micro mb-1 mt-2 px-1">Resolved</div>}
        {resolved.map(card)}
      </div>
    </Panel>
  );
}

function AssignMenu({ inc }: { inc: Incident }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const assets = useSim((s) => s.assets);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const opts: AssetId[] = ['UGV-01', 'UAV-01', 'TEAM-1', 'RV-02'];
  return (
    <div ref={ref} className="relative">
      <button type="button" className="ctl h-[28px]" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} disabled={inc.status === 'resolved'}>
        <UserPlus size={13} /> Assign asset <ChevronDown size={12} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-[32px] z-30 w-[250px] rounded-[7px] border border-line-strong bg-surface-2 p-1 shadow-[0_14px_36px_rgb(0_0_0/0.5)]">
          {opts.map((id) => {
            const a = assets[id];
            const Icon = ASSET_ICON[id];
            const assigned = inc.assigned.includes(id);
            return (
              <button
                key={id}
                type="button"
                role="menuitem"
                disabled={assigned}
                onClick={() => {
                  engine.assign(inc.id, id);
                  useUI.getState().notify(`${a?.name ?? id} assigned to ${inc.id}`, 'ok');
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left hover:bg-surface-3 disabled:opacity-50"
              >
                <Icon size={14} className="text-blue" aria-hidden />
                <span className="mono text-[11.5px] text-ink-1">{a?.name ?? id}</span>
                <span className="truncate text-[10.5px] text-ink-3">{a?.status}</span>
                {assigned && <Check size={12} className="ml-auto text-green" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IncidentDetail({ inc }: { inc: Incident }) {
  const now = useNow(1000);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const id = setTimeout(() => setConfirm(false), 3500);
    return () => clearTimeout(id);
  }, [confirm]);
  const tone = SEVERITY_TONE[inc.severity];
  const resolved = inc.status === 'resolved';
  const done = inc.checklist.filter((c) => c.done).length;
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [inc.timeline.length]);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <section className="panel shrink-0 p-3.5">
        <div className="flex items-start gap-3">
          <span className="mt-[2px] flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[8px]" style={{ background: `${TONE_HEX[tone]}1f`, boxShadow: `inset 0 0 0 1px ${TONE_HEX[tone]}55` }}>
            <Siren size={18} style={{ color: TONE_HEX[tone] }} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mono text-[12px] text-ink-2">{inc.id}</span>
              <Chip tone={resolved ? 'ok' : inc.status === 'new' ? 'warn' : 'info'}>{STATUS_LABEL[inc.status]}</Chip>
              <span className="text-[11px] text-ink-3">{INCIDENT_CATEGORY_LABEL[inc.category]}</span>
            </div>
            <h2 className="mt-1 text-[19px] font-semibold leading-[24px] text-ink-1">{inc.title}</h2>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
              <span>{inc.location.label}</span>
              <span>Opened {fmtClock(inc.createdAt)} GST</span>
              <span>
                Elapsed <span className="mono text-ink-2">{fmtDuration(((inc.resolvedAt ?? now) - inc.createdAt) / 1000)}</span>
              </span>
              {inc.acknowledgedAt && (
                <span>
                  Acknowledged in <span className="mono text-ink-2">{fmtDuration((inc.acknowledgedAt - inc.createdAt) / 1000)}</span>
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="micro">Severity</span>
            <Segmented<Severity>
              label="Severity"
              value={inc.severity}
              onChange={(v) => engine.setSeverity(inc.id, v)}
              options={[
                { value: 'low', label: 'Low', color: TONE_HEX.watch },
                { value: 'moderate', label: 'Moderate', color: TONE_HEX.warn },
                { value: 'high', label: 'High', color: TONE_HEX.critical },
              ]}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={cx('ctl h-[28px]', inc.status === 'new' && 'border-amber/70 bg-[rgb(242_179_61/0.12)] text-amber')}
            disabled={inc.status !== 'new'}
            onClick={() => {
              engine.acknowledge(inc.id);
              useUI.getState().notify(`${inc.id} acknowledged`, 'ok');
            }}
          >
            <CircleCheck size={13} /> {inc.status === 'new' ? 'Acknowledge' : 'Acknowledged'}
          </button>
          <AssignMenu inc={inc} />
          <button
            type="button"
            className="ctl h-[28px]"
            onClick={() => {
              useUI.getState().setScreen('twin');
              useUI.getState().select({ kind: 'location', x: inc.location.x, z: inc.location.z, label: inc.location.label });
              focusOn({ kind: 'location', x: inc.location.x, z: inc.location.z, radius: 110 });
            }}
          >
            <Crosshair size={13} /> Focus location
          </button>
          <button
            type="button"
            className="ctl h-[28px]"
            onClick={() => {
              const ui = useUI.getState();
              ui.setPlayback({ mode: 'replay', cursor: inc.createdAt - 12_000, playing: true, speed: 2 });
              ui.setScreen('twin');
              focusOn({ kind: 'location', x: inc.location.x, z: inc.location.z, radius: 120 });
            }}
          >
            <Play size={13} /> Replay
          </button>
          {inc.observationId && (
            <button
              type="button"
              className="ctl h-[28px]"
              onClick={() => {
                useUI.getState().selectObservation(inc.observationId ?? null);
                useUI.getState().setScreen('insights');
              }}
            >
              <BrainCircuit size={13} /> {inc.observationId}
            </button>
          )}
          <button
            type="button"
            className={cx('ctl ml-auto h-[28px]', confirm && 'border-green/70 bg-[rgb(61_214_140/0.12)] text-green')}
            disabled={resolved}
            onClick={() => {
              if (!confirm) return setConfirm(true);
              engine.resolve(inc.id);
              setConfirm(false);
              useUI.getState().notify(`${inc.id} resolved`, 'ok');
            }}
          >
            <Check size={13} /> {resolved ? 'Resolved' : confirm ? 'Confirm resolve' : 'Resolve'}
          </button>
        </div>
      </section>

      <div className="grid min-h-0 flex-1 gap-2" style={{ gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)' }}>
        <Panel title="Incident timeline" icon={Activity} className="min-h-0" subtitle={`${inc.timeline.length} entries`}>
          <ol ref={listRef} className="absolute inset-0 overflow-y-auto px-3 py-2">
            {inc.timeline.map((e, k) => {
              const Icon = TL_ICON[e.kind];
              return (
                <li key={e.id} className="relative flex gap-3 pb-3 animate-fade-in">
                  {k < inc.timeline.length - 1 && <span className="absolute left-[13px] top-[28px] h-[calc(100%-26px)] w-px bg-line-strong" aria-hidden />}
                  <span className="relative z-10 flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full border" style={{ borderColor: `${TL_COLOR[e.kind]}66`, background: `${TL_COLOR[e.kind]}14` }}>
                    <Icon size={13} style={{ color: TL_COLOR[e.kind] }} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 pt-[2px]">
                    <div className="flex items-baseline gap-2">
                      <span className="mono text-[11.5px] text-ink-1">{fmtClock(e.t)}</span>
                      <span className="mono text-[10px] text-ink-3">+{fmtDuration(Math.max(0, (e.t - inc.createdAt) / 1000))}</span>
                      <span className="ml-auto text-[10.5px] text-ink-3">{e.actor}</span>
                    </div>
                    <div className="text-[12.5px] font-medium leading-[16px] text-ink-1">{e.text}</div>
                    {e.detail && <div className="text-[11px] leading-[14px] text-ink-2">{e.detail}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
        </Panel>
        <Panel title="Response checklist" icon={ClipboardList} className="min-h-0" subtitle={`${done}/${inc.checklist.length} complete`}>
          <div className="absolute inset-0 flex flex-col">
            <div className="px-3 pt-2.5">
              <ProgressBar value={inc.checklist.length ? done / inc.checklist.length : 0} color={TONE_HEX.ok} height={4} />
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {inc.checklist.map((c) => (
                <li key={c.id}>
                  <label className={cx('flex cursor-pointer items-start gap-2.5 rounded-[5px] px-1.5 py-[6px] hover:bg-surface-2', resolved && 'cursor-default')}>
                    <input
                      type="checkbox"
                      className="mt-[2px] h-[14px] w-[14px] accent-[var(--color-green)]"
                      checked={c.done}
                      disabled={resolved}
                      onChange={() => engine.toggleChecklist(inc.id, c.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cx('block text-[12px] leading-[15px]', c.done ? 'text-ink-3 line-through decoration-ink-4' : 'text-ink-1')}>{c.text}</span>
                      <span className="block text-[10px] uppercase tracking-[0.08em] text-ink-3">
                        {c.priority} priority{c.doneAt ? ` · done ${fmtClock(c.doneAt)}` : ''}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Dispatch({ inc }: { inc: Incident | undefined }) {
  const assets = useSim((s) => s.assets);
  if (!inc) return null;
  if (!inc.assigned.length) return <p className="p-3 text-[11.5px] text-ink-3">No assets assigned yet.</p>;
  return (
    <div className="absolute inset-0 overflow-y-auto p-2">
      {inc.assigned.map((id) => {
        const a = assets[id];
        if (!a) return null;
        const Icon = ASSET_ICON[id];
        const total = a.distance !== null && a.eta !== null ? a.distance + 1 : null;
        return (
          <div key={id} className="mb-1.5 rounded-[6px] border border-line bg-surface-2/50 px-2.5 py-2">
            <div className="flex items-center gap-2">
              <Icon size={14} className="text-blue" aria-hidden />
              <span className="mono text-[11.5px] text-ink-1">{a.name}</span>
              <span className="flex items-center gap-1 text-[11px]" style={{ color: TONE_HEX[a.tone] }}>
                <StatusDot tone={a.tone} size={6} pulse={a.status === 'En route'} /> {a.status}
              </span>
              <button type="button" className="ml-auto text-ink-3 hover:text-ink-1" aria-label={`Locate ${a.name}`} onClick={() => focusOn({ kind: 'asset', id })}>
                <Crosshair size={13} />
              </button>
            </div>
            <div className="mt-1 truncate text-[10.5px] text-ink-3">{a.task}</div>
            {a.eta !== null && a.distance !== null && total !== null && (
              <div className="mt-1.5 flex items-center gap-2">
                <ProgressBar value={1 - a.distance / Math.max(total, a.distance + 1)} color={TONE_HEX.info} height={3} />
                <span className="mono shrink-0 text-[10.5px] text-ink-2">
                  {fmtDistance(a.distance)} · {fmtDuration(a.eta)}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Comms() {
  const commsUp = useSim((s) => s.metrics.commsUp);
  const channels = ['Operations radio', 'Site public address', 'Emergency line', 'Field data link'];
  return (
    <div className="px-3 py-2">
      {channels.map((c, i) => {
        const up = i < commsUp;
        return (
          <div key={c} className="flex items-center gap-2 py-[3px]">
            <Radio size={12} className={up ? 'text-green' : 'text-amber'} aria-hidden />
            <span className="text-[11.5px] text-ink-2">{c}</span>
            <span className={cx('ml-auto text-[11px]', up ? 'text-ink-1' : 'text-amber')}>{up ? 'Available' : 'Degraded'}</span>
          </div>
        );
      })}
    </div>
  );
}

export function IncidentsScreen() {
  const incidents = useSim((s) => s.incidents);
  const selectedId = useUI((s) => s.selectedIncidentId);
  const selected = useMemo(() => incidents.find((i) => i.id === selectedId) ?? incidents.find((i) => i.status !== 'resolved') ?? incidents[0], [incidents, selectedId]);
  return (
    <div className="absolute inset-0 grid gap-2 p-2" style={{ gridTemplateColumns: 'clamp(260px, 19vw, 320px) minmax(0, 1fr) clamp(320px, 24vw, 400px)' }}>
      <IncidentList selected={selected} />
      {selected ? (
        <IncidentDetail inc={selected} />
      ) : (
        <section className="panel">
          <EmptyState icon={ShieldCheck} title="No incidents" detail="Nothing requires a response. Incidents opened by the fusion engine or by operators appear here." />
        </section>
      )}
      <div className="flex min-h-0 flex-col gap-2">
        <ResponseKpisPanel className="h-[212px] shrink-0" />
        <Panel title="Asset dispatch" icon={Bot} iconColor="#4c94ff" className="min-h-0 flex-1">
          <Dispatch inc={selected} />
        </Panel>
        {selected && (
          <Panel title="Incident location" icon={Box} iconColor="#4c94ff" className="min-h-0 flex-1" transparentBody>
            <FeedViewport viewId="incident-pip" source="PIP" mode="visible" size="thumb" pip={{ x: selected.location.x, z: selected.location.z }} detections={false} className="absolute inset-0">
              <span className="pointer-events-none absolute bottom-1.5 left-2 font-cond text-[10px] uppercase tracking-[0.12em] text-ink-1" style={{ textShadow: '0 1px 2px #000' }}>
                Twin view · {selected.location.label}
              </span>
            </FeedViewport>
          </Panel>
        )}
        <Panel title="Communications" icon={Radio} className="shrink-0">
          <Comms />
        </Panel>
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Crosshair, X } from 'lucide-react';
import clsx from 'clsx';
import { cityLayout } from '@encirra/shared';
import type { ElementState, FacilityInfo, Frame, NetworkTopology, RunResult } from '@encirra/shared';
import { useTwin, type Selection } from '@/state/store';
import { useRunCtx } from '@/data/hooks';
import { indexTopology, POWER_LABEL, STATUS_LABEL, WATER_LABEL } from '@/data/selectors';
import { busName, fmtInt, fmtKW, fmtLps, fmtM, fmtNum, fmtPct, fmtPu, titleCase } from '@/data/format';
import { Pill, POWER_TONE, STATUS_TONE, WATER_TONE, Dot, STATE_COLOR } from '@/ui/primitives';
import { buildingJunctions } from '@/maps/geometry';

const STATE_LABEL: Record<ElementState, string> = {
  energized: 'Energized',
  faulted: 'Faulted',
  isolated: 'Isolated',
  deenergized: 'De-energized',
  restoring: 'Restoring (plan pending)',
  restored: 'Restored',
  open: 'Open',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h4 className="mb-1.5 text-[11px] font-semibold tracking-wider text-slate uppercase">{title}</h4>
      <dl className="divide-y divide-line/70 rounded-lg border border-line bg-white/70">{children}</dl>
    </section>
  );
}
function Row({ k, v, tip }: { k: string; v: ReactNode; tip?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-[6px] text-[12.5px]" title={tip}>
      <dt className="shrink-0 text-slate">{k}</dt>
      <dd className="min-w-0 text-right font-medium text-navy tabular">{v}</dd>
    </div>
  );
}
function StateBadge({ s }: { s: ElementState | undefined }) {
  if (!s) return <>—</>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Dot color={STATE_COLOR[s]} size={8} />
      {STATE_LABEL[s]}
    </span>
  );
}

function busRows(topology: NetworkTopology, frame: Frame, busId: number) {
  const b = topology.electrical.buses[busId];
  if (!b) return null;
  const feeder = topology.electrical.feeders.find((f) => f.id === b.feeder);
  return (
    <>
      <Row k="Supply bus" v={`${b.name} · ${feeder?.name ?? b.feeder}`} />
      <Row k="Bus state" v={<StateBadge s={frame.power.busState[busId]} />} />
      <Row k="Bus voltage" v={fmtPu(frame.power.busVmPu[busId])} />
      <Row k="Load served at bus" v={fmtKW(frame.power.busServedKW[busId])} tip="Total served at the bus (benchmark load + any pump demand)" />
      {frame.power.busShed[busId] && <Row k="Load shedding" v={<span className="text-warn">Shed by the plan</span>} />}
    </>
  );
}

function junctionRows(topology: NetworkTopology, frame: Frame, j: number) {
  const jn = topology.water.junctions[j];
  if (!jn) return null;
  const p = frame.water.junctionPressureM[j];
  const thr = topology.water.serviceThresholdM;
  return (
    <>
      <Row k="Water node" v={`${jn.id} · ${jn.zone} zone`} />
      <Row k="Pressure" v={<span className={p < thr ? 'text-fault' : undefined}>{fmtM(p)}</span>} tip={`Service threshold ${thr} m`} />
      <Row k="Delivered / required" v={`${fmtLps(frame.water.junctionDeliveredLps[j], 2)} / ${fmtLps(frame.water.junctionRequiredLps[j], 2)}`} />
    </>
  );
}

function zoneAssets(topology: NetworkTopology, frame: Frame, zone: string | undefined) {
  if (!zone) return null;
  const ix = indexTopology(topology);
  const pumps = topology.water.pumps.map((p, i) => ({ p, i })).filter(({ p }) => ix.pumpZone.get(p.id) === zone);
  const tanks = topology.water.tanks.map((t, i) => ({ t, i })).filter(({ t }) => t.zone === zone);
  if (!pumps.length && !tanks.length) return null;
  return (
    <Section title={`Related water assets · ${zone} zone`}>
      {pumps.map(({ p, i }) => (
        <Row key={p.id} k={`${p.id} (${ix.facilityByPump.get(p.id)?.name ?? p.stationId})`} v={frame.water.pumpOn[i] ? `On · ${fmtLps(frame.water.pumpFlowLps[i])}` : <span className="text-fault">Off</span>} />
      ))}
      {tanks.map(({ t, i }) => (
        <Row key={t.id} k={t.label} v={`${fmtPct(frame.water.tankPct[i])} · ${fmtM(frame.water.tankLevelM[i], 2)}`} />
      ))}
    </Section>
  );
}

function FacilityBody({ f, run, topology, frame }: { f: FacilityInfo; run: RunResult; topology: NetworkTopology; frame: Frame }) {
  const ix = indexTopology(topology);
  const st = frame.facilities.find((x) => x.id === f.id);
  const j = f.waterNode ? ix.junctionIdx.get(f.waterNode) : undefined;
  const ti = f.waterNode ? ix.tankIdx.get(f.waterNode) : undefined;
  const ri = f.waterNode ? ix.reservoirIdx.get(f.waterNode) : undefined;
  const zone = j != null ? topology.water.junctions[j].zone : ti != null ? topology.water.tanks[ti].zone : undefined;
  return (
    <>
      {st && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Pill tone={STATUS_TONE[st.status]}>{STATUS_LABEL[st.status]}</Pill>
          <Pill tone={POWER_TONE[st.power]}>Power · {POWER_LABEL[st.power]}</Pill>
          {st.water !== 'n/a' && <Pill tone={WATER_TONE[st.water]}>Water · {WATER_LABEL[st.water]}</Pill>}
        </div>
      )}
      {st?.detail && <p className="mt-2 text-[12.5px] text-ink">{st.detail}</p>}

      <Section title="Power">
        {f.bus != null ? busRows(topology, frame, f.bus) : <Row k="Supply" v="Outside the modelled feeder" />}
        {f.backup ? (
          <Row
            k={`Backup ${f.backup.kind}`}
            v={`${fmtInt(f.backup.kW)} kW · ${fmtNum(f.backup.hours, 0)} h${f.backup.coversWater ? ' · covers water' : ''}`}
            tip="Declared backup capacity (topology)"
          />
        ) : (
          <Row k="Backup supply" v="None" />
        )}
      </Section>

      {j != null && <Section title="Water">{junctionRows(topology, frame, j)}</Section>}

      {f.kind === 'substation' && <SubstationRows topology={topology} frame={frame} run={run} />}

      {f.kind === 'pump-station' &&
        (f.pumps ?? topology.water.pumps.filter((p) => p.stationId === f.id).map((p) => p.id)).map((pid) => {
          const i = ix.pumpIdx.get(pid);
          if (i == null) return null;
          const p = topology.water.pumps[i];
          return (
            <Section key={pid} title={`Pump ${p.id}`}>
              <Row k="Status" v={frame.water.pumpOn[i] ? <span className="text-ok-deep">Running</span> : <span className="text-fault">Stopped</span>} />
              <Row k="Supply bus voltage" v={fmtPu(frame.power.busVmPu[p.bus])} />
              <Row k="Flow" v={fmtLps(frame.water.pumpFlowLps[i])} />
              <Row k="Head" v={fmtM(frame.water.pumpHeadM[i])} />
              <Row k="Electrical input" v={fmtKW(frame.water.pumpPowerKW[i])} tip="P = ρ·g·Q·H / η" />
              <Row k="Efficiency (design)" v={fmtPct(p.efficiency * 100)} />
              <Row k="Design point" v={`${fmtLps(p.designFlowLps, 0)} @ ${fmtM(p.designHeadM, 0)} · ${fmtInt(p.ratedKW)} kW rated`} />
            </Section>
          );
        })}

      {ti != null && <TankRows topology={topology} frame={frame} i={ti} />}
      {ri != null && (
        <Section title="Supply reservoir">
          <Row k="Node" v={topology.water.reservoirs[ri].id} />
          <Row k="Fixed head" v={fmtM(topology.water.reservoirs[ri].headM)} />
        </Section>
      )}

      {(f.kind === 'hospital' || f.kind === 'emergency-ops') && zoneAssets(topology, frame, zone)}

      <p className="mt-4 text-[12px] leading-relaxed text-slate">{f.description}</p>
    </>
  );
}

function TankRows({ topology, frame, i }: { topology: NetworkTopology; frame: Frame; i: number }) {
  const t = topology.water.tanks[i];
  const area = Math.PI * (t.diameterM / 2) ** 2;
  const level = frame.water.tankLevelM[i];
  return (
    <Section title={t.label}>
      <Row k="Level" v={`${fmtPct(frame.water.tankPct[i])} of usable range`} />
      <Row k="Water depth" v={`${fmtM(level, 2)} (min ${fmtM(t.minLevelM, 1)}, max ${fmtM(t.maxLevelM, 1)})`} />
      <Row k="Usable volume" v={`${fmtInt(area * Math.max(0, level - t.minLevelM))} m³ of ${fmtInt(area * (t.maxLevelM - t.minLevelM))} m³`} tip="π·(D/2)²·(level − min level)" />
      <Row k="Base elevation" v={fmtM(t.elevationM)} />
    </Section>
  );
}

function SubstationRows({ topology, frame, run }: { topology: NetworkTopology; frame: Frame; run: RunResult }) {
  const E = topology.electrical;
  const sub = E.substationBus;
  const outgoing = E.lines.filter((l) => l.from === sub || l.to === sub);
  const changed = E.switches.map((sw, i) => ({ sw, i, closed: frame.power.switchClosed[i] })).filter(({ sw, closed }) => closed === sw.normallyOpen);
  const planned = new Set(run.plan?.actions.map((a) => a.switchId) ?? []);
  return (
    <>
      <Section title="Connected buses">
        {outgoing.map((l) => {
          const other = l.from === sub ? l.to : l.from;
          return <Row key={l.id} k={`${busName(sub)} → ${busName(other)}`} v={<StateBadge s={frame.power.lineState[l.id]} />} />;
        })}
      </Section>
      <Section title="Feeder status">
        {E.feeders.map((f) => {
          const on = f.buses.filter((b) => ['energized', 'restored'].includes(frame.power.busState[b])).length;
          const kw = f.buses.reduce((a, b) => a + (frame.power.busServedKW[b] ?? 0), 0);
          return <Row key={f.id} k={f.name} v={`${on}/${f.buses.length} buses supplied · ${fmtKW(kw)}`} />;
        })}
      </Section>
      <Section title="Switches not in their normal state">
        {changed.length === 0 ? (
          <Row k="All switches" v="Normal configuration" />
        ) : (
          changed.map(({ sw, closed }) => (
            <Row key={sw.id} k={`${sw.id} (${sw.kind}${sw.remote ? ', remote' : ''})`} v={<span className={closed ? 'text-ok-deep' : 'text-fault'}>{closed ? 'Closed' : 'Open'}{planned.has(sw.id) ? ' · plan' : ''}</span>} />
          ))
        )}
      </Section>
    </>
  );
}

function AssetBody({ sel, run, topology, frame }: { sel: Selection; run: RunResult; topology: NetworkTopology; frame: Frame }) {
  const ix = indexTopology(topology);
  const E = topology.electrical;
  const W = topology.water;
  switch (sel.kind) {
    case 'building': {
      const b = cityLayout.buildings.find((x) => x.id === sel.id);
      if (!b) return <p className="mt-3 text-slate">Unknown building.</p>;
      const bus = b.bus == null ? null : b.bus - 1;
      const j = buildingJunctions(topology).get(b.id);
      return (
        <>
          <Section title="Building">
            <Row k="Type" v={titleCase(b.kind.replace(/-/g, ' '))} />
            <Row k="Height" v={`${fmtInt(b.height)} m · ${b.floors} floors`} />
          </Section>
          <Section title="Power">
            {bus != null ? busRows(topology, frame, bus) : <Row k="Supply" v="Not on the modelled feeder" />}
            {bus != null && <Row k="Bus service connections" v={fmtInt(E.buses[bus]?.connections)} tip="Synthetic connection count of the whole bus" />}
          </Section>
          {j != null && <Section title="Water (nearest demand node)">{junctionRows(topology, frame, j)}</Section>}
        </>
      );
    }
    case 'bus': {
      const id = Number(sel.id);
      const b = E.buses[id];
      if (!b) return null;
      return (
        <>
          <Section title="Bus">
            <Row k="Description" v={b.label} />
            <Row k="Nominal load" v={`${fmtKW(b.loadKW)} · ${fmtNum(b.loadKVAr, 0)} kVAr`} />
            <Row k="Service connections" v={fmtInt(b.connections)} />
            <Row k="Critical" v={b.critical ? 'Yes' : 'No'} />
            {b.facilityIds.length > 0 && <Row k="Facilities" v={b.facilityIds.map((f) => ix.facility.get(f)?.name ?? f).join(', ')} />}
          </Section>
          <Section title="State">{busRows(topology, frame, id)}</Section>
        </>
      );
    }
    case 'line': {
      const l = E.lines[Number(sel.id)];
      if (!l) return null;
      const si = ix.switchIdx.get(l.switchId);
      return (
        <Section title="Line">
          <Row k="Section" v={`${busName(l.from)} – ${busName(l.to)}`} />
          <Row k="Type" v={l.kind === 'tie' ? 'Tie (normally open)' : `Feeder ${l.feeder}`} />
          <Row k="State" v={<StateBadge s={frame.power.lineState[l.id]} />} />
          <Row k="Loading" v={fmtPct(frame.power.lineLoadingPct[l.id], 1)} tip={`Thermal limit ${E.limits.loadingMaxPct}%`} />
          <Row k="Flow" v={fmtKW(frame.power.lineFlowKW[l.id])} />
          <Row k="Rating" v={`${fmtInt(l.ratingA)} A (synthetic)`} />
          <Row k="Impedance" v={`${fmtNum(l.rOhm, 4)} + j${fmtNum(l.xOhm, 4)} Ω`} />
          <Row k="Switch" v={`${l.switchId} · ${si != null && frame.power.switchClosed[si] ? 'closed' : 'open'}`} />
        </Section>
      );
    }
    case 'switch': {
      const i = ix.switchIdx.get(sel.id);
      if (i == null) return null;
      const sw = E.switches[i];
      const act = run.plan?.actions.find((a) => a.switchId === sw.id);
      return (
        <Section title="Switch">
          <Row k="Kind" v={`${titleCase(sw.kind)}${sw.remote ? ' · remote-operable' : ' · manual'}`} />
          <Row k="Line" v={`${busName(E.lines[sw.lineId]?.from)} – ${busName(E.lines[sw.lineId]?.to)}`} />
          <Row k="Normal state" v={sw.normallyOpen ? 'Open' : 'Closed'} />
          <Row k="Current state" v={frame.power.switchClosed[i] ? 'Closed' : 'Open'} />
          {act && <Row k="Recovery plan" v={`${act.action} — ${act.reason}`} />}
        </Section>
      );
    }
    case 'pump': {
      const i = ix.pumpIdx.get(sel.id);
      if (i == null) return null;
      const p = W.pumps[i];
      return (
        <Section title={p.label}>
          <Row k="Status" v={frame.water.pumpOn[i] ? 'Running' : <span className="text-fault">Stopped</span>} />
          <Row k="Supply bus" v={`${busName(p.bus)} · ${fmtPu(frame.power.busVmPu[p.bus])}`} />
          <Row k="Flow" v={fmtLps(frame.water.pumpFlowLps[i])} />
          <Row k="Head" v={fmtM(frame.water.pumpHeadM[i])} />
          <Row k="Electrical input" v={fmtKW(frame.water.pumpPowerKW[i])} />
          <Row k="Efficiency (design)" v={fmtPct(p.efficiency * 100)} />
        </Section>
      );
    }
    case 'pipe': {
      const i = ix.pipeIdx.get(sel.id);
      if (i == null) return null;
      const p = W.pipes[i];
      return (
        <Section title="Pipe">
          <Row k="Section" v={`${p.from} → ${p.to}`} />
          <Row k="Kind" v={titleCase(p.kind)} />
          <Row k="Length · diameter" v={`${fmtInt(p.lengthM)} m · ${fmtInt(p.diameterMM)} mm`} />
          <Row k="Hazen–Williams C" v={fmtInt(p.roughnessC)} />
          <Row k="Status" v={frame.water.pipeOpen[i] ? 'Open' : 'Closed'} />
          <Row k="Flow" v={fmtLps(frame.water.pipeFlowLps[i], 2)} />
          <Row k="Velocity" v={`${fmtNum(frame.water.pipeVelocityMs[i], 2)} m/s`} />
        </Section>
      );
    }
    case 'tank': {
      const i = ix.tankIdx.get(sel.id);
      return i == null ? null : <TankRows topology={topology} frame={frame} i={i} />;
    }
    case 'junction': {
      const j = ix.junctionIdx.get(sel.id);
      if (j == null) return null;
      const jn = W.junctions[j];
      return (
        <>
          <Section title="Junction">
            <Row k="Elevation" v={fmtM(jn.elevationM)} />
            <Row k="Base demand" v={fmtLps(jn.baseDemandLps, 2)} />
            <Row k="Service connections" v={fmtInt(jn.connections)} />
            <Row k="Critical" v={jn.critical ? `Yes${jn.facilityId ? ` · ${ix.facility.get(jn.facilityId)?.name ?? jn.facilityId}` : ''}` : 'No'} />
          </Section>
          <Section title="State">{junctionRows(topology, frame, j)}</Section>
        </>
      );
    }
    default:
      return null;
  }
}

export function titleFor(sel: Selection, topology: NetworkTopology): { title: string; sub: string } {
  const ix = indexTopology(topology);
  switch (sel.kind) {
    case 'facility': {
      const f = ix.facility.get(sel.id);
      return { title: f?.name ?? sel.id, sub: `${titleCase((f?.kind ?? 'facility').replace(/-/g, ' '))}${f?.critical ? ' · critical facility' : ''}` };
    }
    case 'building': {
      const b = cityLayout.buildings.find((x) => x.id === sel.id);
      return { title: b?.name ?? `Building ${sel.id.replace('BLD-', '')}`, sub: b ? `${titleCase(b.kind.replace(/-/g, ' '))}${b.bus != null ? ` · bus B${b.bus}` : ''}` : '' };
    }
    case 'bus':
      return { title: busName(Number(sel.id)), sub: 'Distribution bus' };
    case 'line': {
      const l = topology.electrical.lines[Number(sel.id)];
      return { title: l ? `Line ${busName(l.from)}–${busName(l.to)}` : `Line ${sel.id}`, sub: l?.kind === 'tie' ? 'Tie line' : 'Feeder section' };
    }
    case 'switch':
      return { title: sel.id, sub: 'Switch' };
    case 'pump':
      return { title: sel.id, sub: 'Pump' };
    case 'pipe':
      return { title: sel.id, sub: 'Water main' };
    case 'tank':
      return { title: topology.water.tanks.find((t) => t.id === sel.id)?.label ?? sel.id, sub: 'Elevated storage' };
    case 'junction':
      return { title: topology.water.junctions.find((j) => j.id === sel.id)?.label ?? sel.id, sub: 'Water junction' };
  }
}

/** Details body for any selection (used by the inspector and the Assets page). */
export function AssetDetails({ sel, run, topology, frame }: { sel: Selection; run: RunResult; topology: NetworkTopology; frame: Frame }) {
  const facility = sel.kind === 'facility' ? indexTopology(topology).facility.get(sel.id) : undefined;
  return facility ? <FacilityBody f={facility} run={run} topology={topology} frame={frame} /> : <AssetBody sel={sel} run={run} topology={topology} frame={frame} />;
}

export function FacilityInspector() {
  const sel = useTwin((s) => s.selected);
  const setSelected = useTwin((s) => s.setSelected);
  const requestCamera = useTwin((s) => s.requestCamera);
  const ctx = useRunCtx();
  const page = useTwin((s) => s.page);
  const focus = useTwin((s) => s.focusTwin);
  const head = sel && ctx ? titleFor(sel, ctx.topology) : null;
  // Docked inside the free band between the top cards and the bottom panels (or the whole area in
  // focus mode) so it never covers another card; the toolbar and playback bar make room for it.
  const top = focus ? 'calc(var(--header-h) + var(--gap))' : 'calc(var(--header-h) + var(--top-h) + var(--gap))';
  const bottom = focus ? 'calc(var(--footer-h) + var(--gap))' : 'calc(var(--footer-h) + var(--bottom-h) + var(--gap) * 2)';
  return (
    <AnimatePresence>
      {sel && ctx && head && page === 'live' && (
        <motion.aside
          key="inspector"
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 24, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
          className="absolute right-[var(--pad-x)] z-30 flex w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden rounded-[12px] border border-line-strong bg-white shadow-[0_18px_44px_-14px_rgba(21,40,60,0.45),0_3px_10px_-3px_rgba(21,40,60,0.18)] transition-[top,bottom] duration-300"
          style={{ top, bottom }}
          data-testid="inspector"
          aria-label="Asset inspector"
        >
          <div className="flex items-start gap-2 border-b border-line px-4 pt-3 pb-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold text-navy">{head.title}</div>
              <div className="truncate text-[12px] text-slate">{head.sub}</div>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-semibold text-info hover:bg-info-soft"
              onClick={() => requestCamera({ focus: sel })}
              data-tip="Frame in 3D"
              data-tip-pos="bottom-end"
            >
              <Crosshair size={14} /> Focus
            </button>
            <button type="button" className="rounded-md p-1 text-slate hover:bg-wash" onClick={() => setSelected(null)} aria-label="Close inspector">
              <X size={16} />
            </button>
          </div>
          <div className={clsx('enc-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4')}>
            <AssetDetails sel={sel} run={ctx.run} topology={ctx.topology} frame={ctx.frame} />
            <p className="mt-4 text-[11px] text-mist">
              State at {ctx.frame.clock} (simulated) · {ctx.run.provenance.source === 'live' ? 'live solver' : 'replay of precomputed solver output'}
            </p>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

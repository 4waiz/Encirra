import { useMemo, useState } from 'react';
import { Crosshair, Search } from 'lucide-react';
import clsx from 'clsx';
import { cityLayout } from '@encirra/shared';
import type { Frame, NetworkTopology } from '@encirra/shared';
import { useTwin, type Selection, type SelectionKind } from '@/state/store';
import { useRunCtx } from '@/data/hooks';
import { POWER_LABEL, STATUS_LABEL, WATER_LABEL, indexTopology, type TopologyIndex } from '@/data/selectors';
import { busName, fmtInt, fmtKW, fmtLps, fmtM, fmtPct, fmtPu, titleCase } from '@/data/format';
import { AssetDetails, titleFor } from '@/inspector/FacilityInspector';
import { Dot, TONE_DOT } from '@/ui/primitives';
import type { Tone } from '@/data/selectors';
import { PageFrame } from './PageFrame';

export interface AssetItem {
  sel: Selection;
  name: string;
  type: string;
  attrs: string;
  state: string;
  tone: Tone;
  search: string;
}

const KINDS: { kind: SelectionKind; label: string }[] = [
  { kind: 'facility', label: 'Facilities' },
  { kind: 'building', label: 'Buildings' },
  { kind: 'bus', label: 'Buses' },
  { kind: 'line', label: 'Lines' },
  { kind: 'switch', label: 'Switches' },
  { kind: 'pump', label: 'Pumps' },
  { kind: 'pipe', label: 'Pipes' },
  { kind: 'tank', label: 'Tanks' },
  { kind: 'junction', label: 'Junctions' },
];

const elTone = (s: string | undefined): Tone =>
  s === 'energized' ? 'ok' : s === 'restored' ? 'ok' : s === 'restoring' ? 'warn' : s === 'faulted' ? 'fault' : s === 'deenergized' || s === 'isolated' ? 'fault' : 'neutral';

/** Builds the full inventory for a frame (exported for tests). */
export function buildInventory(topology: NetworkTopology, frame: Frame, ix: TopologyIndex = indexTopology(topology)): AssetItem[] {
  const E = topology.electrical;
  const W = topology.water;
  const thr = W.serviceThresholdM;
  const items: AssetItem[] = [];
  const add = (it: Omit<AssetItem, 'search'>) => items.push({ ...it, search: `${it.sel.id} ${it.name} ${it.type} ${it.attrs}`.toLowerCase() });

  for (const f of topology.facilities) {
    const st = frame.facilities.find((x) => x.id === f.id);
    add({
      sel: { kind: 'facility', id: f.id },
      name: f.name,
      type: titleCase(f.kind.replace(/-/g, ' ')),
      attrs: `${f.bus != null ? busName(f.bus) : 'external supply'}${f.waterNode ? ` · ${f.waterNode}` : ''}${f.critical ? ' · critical' : ''}`,
      state: st ? `${STATUS_LABEL[st.status]} · ${POWER_LABEL[st.power]}${st.water !== 'n/a' ? ` · ${WATER_LABEL[st.water]}` : ''}` : '—',
      tone: st ? (st.status === 'safe' || st.status === 'restored' ? 'ok' : st.status === 'at-risk' ? 'warn' : 'fault') : 'neutral',
    });
  }
  for (const b of cityLayout.buildings) {
    if (b.facilityId) continue;
    const bus = b.bus == null ? null : b.bus - 1;
    const s = bus == null ? undefined : frame.power.busState[bus];
    add({
      sel: { kind: 'building', id: b.id },
      name: b.name ?? `${titleCase(b.kind.replace(/-/g, ' '))} ${b.id.replace('BLD-', '')}`,
      type: titleCase(b.kind.replace(/-/g, ' ')),
      attrs: `${b.floors} floors${bus != null ? ` · ${busName(bus)}` : ''}`,
      state: s ? titleCase(s) : 'Not on modelled feeder',
      tone: elTone(s),
    });
  }
  E.buses.forEach((b, i) =>
    add({
      sel: { kind: 'bus', id: String(b.id) },
      name: b.name,
      type: `Bus · ${b.feeder}`,
      attrs: `${b.label} · ${fmtKW(b.loadKW)}`,
      state: `${titleCase(frame.power.busState[i] ?? '—')} · ${fmtPu(frame.power.busVmPu[i])}`,
      tone: elTone(frame.power.busState[i]),
    }),
  );
  E.lines.forEach((l, i) =>
    add({
      sel: { kind: 'line', id: String(l.id) },
      name: `${busName(l.from)}–${busName(l.to)}`,
      type: l.kind === 'tie' ? 'Tie line' : `Line · ${l.feeder}`,
      attrs: `${fmtInt(l.ratingA)} A · ${l.switchId}`,
      state: `${titleCase(frame.power.lineState[i] ?? '—')}${frame.power.lineLoadingPct[i] != null ? ` · ${fmtPct(frame.power.lineLoadingPct[i], 0)}` : ''}`,
      tone: frame.power.lineState[i] === 'open' ? 'neutral' : elTone(frame.power.lineState[i]),
    }),
  );
  E.switches.forEach((sw, i) => {
    const closed = frame.power.switchClosed[i];
    const abnormal = closed === sw.normallyOpen;
    add({
      sel: { kind: 'switch', id: sw.id },
      name: sw.id,
      type: `Switch · ${sw.kind}`,
      attrs: `${sw.remote ? 'remote' : 'manual'} · normally ${sw.normallyOpen ? 'open' : 'closed'}`,
      state: closed ? 'Closed' : 'Open',
      tone: abnormal ? 'warn' : 'neutral',
    });
  });
  W.pumps.forEach((p, i) =>
    add({
      sel: { kind: 'pump', id: p.id },
      name: p.id,
      type: 'Pump',
      attrs: `${ix.facilityByPump.get(p.id)?.name ?? p.stationId} · ${busName(p.bus)}`,
      state: frame.water.pumpOn[i] ? `Running · ${fmtLps(frame.water.pumpFlowLps[i], 0)}` : 'Stopped',
      tone: frame.water.pumpOn[i] ? 'ok' : 'fault',
    }),
  );
  W.pipes.forEach((p, i) =>
    add({
      sel: { kind: 'pipe', id: p.id },
      name: p.id,
      type: `Pipe · ${p.kind}`,
      attrs: `${p.from} → ${p.to} · ${fmtInt(p.diameterMM)} mm`,
      state: frame.water.pipeOpen[i] ? `Open · ${fmtLps(frame.water.pipeFlowLps[i], 1)}` : 'Closed',
      tone: 'neutral',
    }),
  );
  W.tanks.forEach((t, i) =>
    add({
      sel: { kind: 'tank', id: t.id },
      name: t.label,
      type: 'Tank',
      attrs: `${t.zone} zone · Ø ${fmtM(t.diameterM, 0)}`,
      state: fmtPct(frame.water.tankPct[i]),
      tone: frame.water.tankPct[i] < 20 ? 'fault' : frame.water.tankPct[i] < 50 ? 'warn' : 'ok',
    }),
  );
  W.junctions.forEach((j, i) => {
    const p = frame.water.junctionPressureM[i];
    add({
      sel: { kind: 'junction', id: j.id },
      name: j.label,
      type: `Junction · ${j.zone}`,
      attrs: `${fmtLps(j.baseDemandLps, 1)} base${j.critical ? ' · critical' : ''}`,
      state: fmtM(p),
      tone: j.baseDemandLps <= 0 ? 'neutral' : p >= thr ? 'ok' : p > 2 ? 'warn' : 'fault',
    });
  });
  return items;
}

export function AssetsPage() {
  const ctx = useRunCtx();
  const [kind, setKind] = useState<SelectionKind | 'all'>('facility');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Selection | null>(null);
  const setSelected = useTwin((s) => s.setSelected);
  const requestCamera = useTwin((s) => s.requestCamera);
  const setPage = useTwin((s) => s.setPage);
  const items = useMemo(() => (ctx ? buildInventory(ctx.topology, ctx.frame) : []), [ctx?.topology, ctx?.frame]);
  const counts = useMemo(() => Object.fromEntries(KINDS.map((k) => [k.kind, items.filter((i) => i.sel.kind === k.kind).length])), [items]);
  const needle = q.trim().toLowerCase();
  const shown = items.filter((i) => (kind === 'all' || i.sel.kind === kind) && (!needle || i.search.includes(needle)));
  const active = picked ?? shown[0]?.sel ?? null;

  const showIn3D = (sel: Selection) => {
    setSelected(sel);
    setPage('live');
    requestCamera({ focus: sel });
  };

  return (
    <PageFrame title="Assets" testId="assets" subtitle={`Inventory of the modelled district at ${ctx?.frame.clock ?? '—'} (simulated) — select an asset for details, or show it in the 3D twin.`}>
      <div className="grid h-full min-h-0 gap-3 max-lg:h-auto lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative flex min-w-[220px] flex-1 items-center">
              <Search size={14} className="absolute left-2.5 text-slate" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search id, name, bus, node…"
                className="w-full rounded-lg border border-line bg-white py-1.5 pr-2 pl-8 text-[12.5px] text-navy outline-none focus:border-info/50"
                data-testid="asset-search"
              />
            </label>
            <div className="flex flex-wrap gap-1 max-lg:m-scroll max-lg:-mx-1 max-lg:w-full max-lg:flex-nowrap max-lg:overflow-x-auto max-lg:px-1 max-lg:[&>button]:shrink-0" role="tablist" data-testid="asset-kinds">
              <button type="button" role="tab" aria-selected={kind === 'all'} onClick={() => setKind('all')} className={chip(kind === 'all')}>
                All <span className="opacity-70">{items.length}</span>
              </button>
              {KINDS.map((k) => (
                <button key={k.kind} type="button" role="tab" aria-selected={kind === k.kind} onClick={() => setKind(k.kind)} className={chip(kind === k.kind)} data-testid={`asset-kind-${k.kind}`}>
                  {k.label} <span className="opacity-70">{counts[k.kind]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="enc-scroll mt-2 min-h-[240px] flex-1 overflow-auto rounded-lg border border-line bg-white max-lg:max-h-[55dvh]">
            <table className="w-full border-collapse text-left text-[12.5px] max-lg:min-w-[560px]">
              <thead className="sticky top-0 z-[1] bg-wash text-slate">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Name</th>
                  <th className="px-2 py-1.5 font-medium">Type</th>
                  <th className="px-2 py-1.5 font-medium">Attributes</th>
                  <th className="px-2 py-1.5 font-medium">State</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {shown.map((it) => {
                  const isActive = active && active.kind === it.sel.kind && active.id === it.sel.id;
                  return (
                    <tr
                      key={`${it.sel.kind}:${it.sel.id}`}
                      onClick={() => setPicked(it.sel)}
                      className={clsx('cursor-pointer border-t border-line/60 hover:bg-info-soft/40', isActive && 'bg-info-soft/70')}
                      data-testid={`asset-row-${it.sel.kind}-${it.sel.id}`}
                    >
                      <td className="px-3 py-1.5 font-medium text-navy">{it.name}</td>
                      <td className="px-2 py-1.5 text-ink">{it.type}</td>
                      <td className="px-2 py-1.5 text-slate">{it.attrs}</td>
                      <td className="px-2 py-1.5">
                        <span className="inline-flex items-center gap-1.5 text-ink">
                          <Dot color={TONE_DOT[it.tone]} size={7} />
                          {it.state}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            showIn3D(it.sel);
                          }}
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap text-info hover:bg-info-soft"
                        >
                          <Crosshair size={12} /> Show in 3D
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate">
                      No assets match “{q}”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="enc-scroll min-h-0 overflow-y-auto rounded-lg border border-line bg-white px-4 py-3 max-lg:overflow-visible" data-testid="asset-details">
          {ctx && active ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-navy">{titleFor(active, ctx.topology).title}</div>
                  <div className="truncate text-[12px] text-slate">{titleFor(active, ctx.topology).sub}</div>
                </div>
                <button
                  type="button"
                  onClick={() => showIn3D(active)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-info px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-brand-deep"
                  data-testid="asset-show-3d"
                >
                  <Crosshair size={13} /> Show in 3D
                </button>
              </div>
              <AssetDetails sel={active} run={ctx.run} topology={ctx.topology} frame={ctx.frame} />
            </>
          ) : (
            <p className="text-[12.5px] text-slate">Select an asset.</p>
          )}
        </aside>
      </div>
    </PageFrame>
  );
}

function chip(on: boolean) {
  return clsx('rounded-full border px-2.5 py-[3px] text-[11.5px] font-medium whitespace-nowrap', on ? 'border-info bg-info text-white' : 'border-line bg-white text-ink hover:bg-wash');
}


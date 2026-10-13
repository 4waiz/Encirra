/**
 * State-driven 3D callouts (drei <Html>), styled like the reference: dark pill, coloured icon,
 * white 12–13 px text, thin leader line to the asset. Text is derived strictly from the current
 * frame / run (no invented numbers). At most 5 are shown, by priority, with screen-space
 * de-overlapping done in the render loop (no React re-render per frame).
 */
import { useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Vector3 } from 'three';
import { useTwin } from '@/state/store';
import { cityLayout } from '@encirra/shared';
import { BUILDING_BY_FACILITY, BUILDING_BY_ID, FACILITY_BY_ID, LINES, N_LINE, PUMPS, TANKS, JUNCTIONS, pointAlong } from '../data/twin';
import { CODE, live } from '../data/live';
import { COLORS } from '../config';
import { fx } from '../runtime';
import './labels.css';

type Tone = 'fault' | 'warn' | 'ok' | 'water' | 'info';
type Icon = 'bolt' | 'x' | 'check' | 'drop' | 'gear' | 'cross' | 'info';

export interface LabelSpec {
  key: string;
  pos: [number, number, number];
  title: string;
  sub?: string;
  tone: Tone;
  icon: Icon;
  priority: number;
}

const TONE: Record<Tone, string> = {
  fault: COLORS.faulted,
  warn: COLORS.energized,
  ok: COLORS.restored,
  water: COLORS.water,
  info: '#9AA4B2',
};

const anchorOf = (facilityId: string): [number, number, number] => {
  const l = cityLayout.labels.find((q) => q.facilityId === facilityId);
  if (l) return l.anchor as [number, number, number];
  const f = FACILITY_BY_ID.get(facilityId);
  return f ? [f.pos[0], 24, f.pos[1]] : [0, 20, 0];
};

const shortName = (facilityId: string) => {
  const f = FACILITY_BY_ID.get(facilityId);
  if (!f) return facilityId;
  const m = f.name.match(/\b([A-Z]{1,3}-?\d+)\b/);
  return m ? m[1] : f.name;
};

const fmt = (v: number, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

/** Derive the candidate callouts from the live frame. */
export function deriveLabels(): LabelSpec[] {
  const out: LabelSpec[] = [];
  const st = useTwin.getState();
  const topo = st.topology;
  if (!live.hasRun || !live.frame) return out;
  const stage = live.stage;

  // 1 · faulted / isolated feeder section
  let faultIdx = -1;
  let isolatedIdx = -1;
  for (let i = 0; i < N_LINE; i++) {
    if (live.lineCode[i] === CODE.faulted) faultIdx = i;
    else if (live.lineCode[i] === CODE.isolated && LINES[i].kind === 'feeder') isolatedIdx = i;
  }
  const fl = faultIdx >= 0 ? faultIdx : isolatedIdx;
  if (fl >= 0) {
    const line = LINES[fl];
    const feederName = topo?.electrical.feeders.find((f) => f.id === line.feeder)?.name ?? `Feeder ${line.feeder}`;
    const [x, z] = pointAlong(line.route, line.length / 2);
    let lost = 0;
    for (let b = 0; b < live.busCode.length; b++) if (live.busCode[b] === CODE.deenergized) lost++;
    out.push({
      key: 'fault',
      pos: [x, 30, z],
      title: faultIdx >= 0 ? `${feederName} Fault` : `${feederName} · Fault Isolated`,
      // isolated = the faulted section's own switch is open (or a feeder section is reported isolated)
      sub: lost > 0 ? 'Supply Lost' : live.switchClosedByLine[fl] === 0 || isolatedIdx >= 0 ? 'Section Isolated' : 'Supply Lost',
      tone: 'fault',
      icon: 'bolt',
      priority: 100,
    });
  }

  // 2 · pumps (offline / back online)
  PUMPS.forEach((pu, i) => {
    const station = pu.stationId;
    const name = shortName(station);
    const fs = live.facilities.get(station);
    if (live.pumpOn[i] === 0) {
      out.push({ key: `pump-${pu.id}`, pos: anchorOf(station), title: `${name} Offline`, sub: 'No Water Flow', tone: 'fault', icon: 'x', priority: 95 });
    } else if (fs && (fs.power === 'restored' || fs.status === 'restored')) {
      const q = live.pumpFlow[i];
      out.push({
        key: `pump-${pu.id}`,
        pos: anchorOf(station),
        title: `${name} Online`,
        sub: Number.isFinite(q) ? `${fmt(q, 1)} L/s` : 'Flow Restored',
        tone: 'ok',
        icon: 'check',
        priority: 70,
      });
    }
  });

  // 3 · substation reconfiguration
  const restoring = Array.from(live.lineCode).some((c) => c === CODE.restoring);
  const reconfStages = new Set(['candidates-generated', 'verification-completed', 'recovery-applied']);
  if (restoring || (stage && reconfStages.has(stage))) {
    out.push({ key: 'substation', pos: anchorOf('substation-s1'), title: 'Substation', sub: '(Feeder Reconfiguration)', tone: 'warn', icon: 'gear', priority: 90 });
  }

  // 4 · hospital supply
  const hf = live.facilities.get('hospital');
  if (hf?.power === 'backup') out.push({ key: 'hospital', pos: anchorOf('hospital'), title: 'Hospital on Backup Power', sub: hf.water === 'low-pressure' ? 'Water Pressure Low' : undefined, tone: 'warn', icon: 'cross', priority: 85 });
  else if (hf?.power === 'offline') out.push({ key: 'hospital', pos: anchorOf('hospital'), title: 'Hospital Supply Lost', tone: 'fault', icon: 'cross', priority: 92 });
  else if (hf?.power === 'restored') out.push({ key: 'hospital', pos: anchorOf('hospital'), title: 'Hospital Supply Restored', tone: 'ok', icon: 'cross', priority: 60 });

  // 5 · tanks
  TANKS.forEach((t, i) => {
    const pct = live.tankPct[i];
    const f = live.frame!;
    const prev = live.run?.frames[Math.max(0, live.frameIndex - 1)];
    const trend = prev ? (f.water?.tankPct?.[i] ?? pct) - (prev.water?.tankPct?.[i] ?? pct) : 0;
    const zone = t.zone;
    const zonePumpsOn = PUMPS.every((pu, k) => {
      const j = JUNCTIONS.find((q) => q.id === pu.to);
      return j?.zone !== zone || live.pumpOn[k] === 1;
    });
    let zoneOk = true;
    JUNCTIONS.forEach((j, k) => {
      if (j.zone === zone && j.baseDemandLps > 0) {
        const p = live.junctionPressure[k];
        if (Number.isFinite(p) && p < live.serviceThresholdM) zoneOk = false;
      }
    });
    const pos: [number, number, number] = [t.pos[0], t.elevationM - 10 + t.maxLevelM + 10, t.pos[2]];
    if (trend < -0.05) {
      out.push({ key: `tank-${t.id}`, pos, title: `Tank ${t.id} ${fmt(pct)}%`, sub: 'Level Falling', tone: pct < 25 ? 'fault' : 'warn', icon: 'drop', priority: 80 });
    } else if (zonePumpsOn && zoneOk) {
      out.push({ key: `tank-${t.id}`, pos, title: 'Water Supply Stable', sub: `Tank ${t.id} ${fmt(pct)}%`, tone: 'ok', icon: 'check', priority: zone === 'East' ? 50 : 40 });
    } else if (trend > 0.05) {
      out.push({ key: `tank-${t.id}`, pos, title: `Tank ${t.id} ${fmt(pct)}%`, sub: 'Refilling', tone: 'water', icon: 'drop', priority: 55 });
    }
  });

  out.sort((a, b) => b.priority - a.priority);
  return out.slice(0, 5);
}

function hoverLabel(): LabelSpec | null {
  const h = useTwin.getState().hovered;
  if (!h) return null;
  if (h.kind === 'facility') {
    const f = FACILITY_BY_ID.get(h.id);
    const b = BUILDING_BY_FACILITY.get(h.id);
    if (!f) return null;
    return { key: 'hover', pos: [f.pos[0], (b?.height ?? 20) + 10, f.pos[1]], title: f.name, tone: 'info', icon: 'info', priority: 200 };
  }
  if (h.kind === 'building') {
    const b = BUILDING_BY_ID.get(h.id);
    if (!b) return null;
    return { key: 'hover', pos: [b.pos[0], b.height + 8, b.pos[1]], title: b.bus ? `Supplied by bus B${b.bus}` : b.id, sub: b.kind.replace(/-/g, ' '), tone: 'info', icon: 'info', priority: 200 };
  }
  return null;
}

function IconSvg({ icon, color }: { icon: Icon; color: string }) {
  const p = { fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <span className="enc-lbl-icon" style={{ background: color }}>
      <svg viewBox="0 0 24 24" width="14" height="14">
        {icon === 'bolt' && <path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="#fff" stroke="none" />}
        {icon === 'x' && <path d="M7 7l10 10M17 7 7 17" {...p} strokeWidth={2.6} />}
        {icon === 'check' && <path d="M5 12.5l4.2 4L19 7" {...p} strokeWidth={2.6} />}
        {icon === 'drop' && <path d="M12 3c3.5 4.6 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2.5-6.4 6-11z" fill="#fff" stroke="none" />}
        {icon === 'gear' && (
          <g {...p}>
            <circle cx="12" cy="12" r="3.2" />
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
          </g>
        )}
        {icon === 'cross' && <path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z" fill="#fff" stroke="none" />}
        {icon === 'info' && (
          <g {...p}>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 11v5.5M12 7.6v.1" />
          </g>
        )}
      </svg>
    </span>
  );
}

const tmp = new Vector3();

/**
 * Vertical UI safe band (fractions of the viewport height) for 3D callouts: the dashboard
 * header/top cards cover the top ~27% and the playback bar + bottom panels the bottom ~28%.
 * `?view=scene` has no overlay but keeps the same band so screenshots match the app.
 */
export const SAFE = { top: 0.27, bottom: 0.72 };

export function Labels() {
  const [labels, setLabels] = useState<LabelSpec[]>([]);
  const sig = useRef('');
  const els = useRef(new Map<string, HTMLDivElement>());
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const show = useTwin((s) => s.layers.labels);
  const offsets = useMemo(() => new Map<string, number>(), []);

  useFrame(() => {
    const list = deriveLabels();
    const hv = hoverLabel();
    if (hv && !list.some((l) => Math.hypot(l.pos[0] - hv.pos[0], l.pos[2] - hv.pos[2]) < 10)) list.unshift(hv);
    const s = JSON.stringify(list.map((l) => [l.key, l.title, l.sub, l.tone, Math.round(l.pos[0]), Math.round(l.pos[2])]));
    if (s !== sig.current) {
      sig.current = s;
      setLabels(list.slice(0, 6));
    }
    // Placement: greedy in priority order. Each pill tries a few lifts / sideways shifts and takes
    // the first slot that overlaps no placed pill and stays inside the UI safe band (between the
    // header + top cards and the bottom panels). Labels that cannot be placed are hidden.
    const H = size.height;
    const W = size.width;
    // free band published by the dashboard overlay (CSS px); default band for ?view=scene
    const ol = useTwin.getState().overlayLayout;
    const safeTop = ol ? ol.safe.y : H * SAFE.top;
    const safeBottom = ol ? ol.safe.y + ol.safe.height : H * SAFE.bottom;
    const safeLeft = ol ? ol.safe.x + 8 : 8;
    const safeRight = ol ? ol.safe.x + ol.safe.width - 8 : W - 8;
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = (ol?.occluders ?? []).map((r) => ({
      x0: r.x - 6,
      x1: r.x + r.width + 6,
      y0: r.y - 6,
      y1: r.y + r.height + 6,
    }));
    const occluderCount = placed.length;
    for (const l of labels) {
      const el = els.current.get(l.key);
      if (!el) continue;
      tmp.set(...l.pos).project(camera);
      const ax = (tmp.x * 0.5 + 0.5) * W;
      const ay = (-tmp.y * 0.5 + 0.5) * H;
      const pill = el.firstElementChild as HTMLElement | null;
      const pw = (pill?.offsetWidth || 170) + 8;
      const ph = (pill?.offsetHeight || 38) + 6;
      let best: { lift: number; shift: number; below: boolean } | null = null;
      const anchorHidden = placed.slice(0, occluderCount).some((p) => ax > p.x0 && ax < p.x1 && ay > p.y0 && ay < p.y1);
      if (tmp.z < 1 && !anchorHidden && ay <= safeBottom && ay >= safeTop - 60 && ax > safeLeft && ax < safeRight) {
        const lifts = [0, 34, 68, 102, 136];
        const shifts = [0, -(pw * 0.45), pw * 0.45];
        outer: for (const below of [false, true]) {
          for (const lift of lifts) {
            for (const shift of shifts) {
              const cx = ax + shift;
              const y0 = below ? ay + 29 + lift : ay - 29 - lift - ph;
              const y1 = y0 + ph;
              const x0 = cx - pw / 2;
              const x1 = cx + pw / 2;
              if (y0 < safeTop || y1 > safeBottom || x0 < safeLeft || x1 > safeRight) continue;
              if (!below && ay < safeTop) continue;
              if (placed.some((p) => x0 < p.x1 && x1 > p.x0 && y0 < p.y1 && y1 > p.y0)) continue;
              best = { lift, shift, below };
              placed.push({ x0, x1, y0, y1 });
              break outer;
            }
          }
        }
      }
      if (!best) {
        el.style.opacity = '0';
        continue;
      }
      el.classList.toggle('enc-lbl-below', best.below);
      const prev = offsets.get(l.key) ?? best.lift;
      const next = prev + (best.lift - prev) * 0.3;
      offsets.set(l.key, next);
      const prevS = offsets.get(l.key + ':s') ?? best.shift;
      const nextS = prevS + (best.shift - prevS) * 0.3;
      offsets.set(l.key + ':s', nextS);
      el.style.setProperty('--lift', `${next.toFixed(1)}px`);
      el.style.setProperty('--shiftx', `${nextS.toFixed(1)}px`);
      el.style.opacity = String(1 - fx.xray * 0.15);
    }
  });

  if (!show) return null;
  return (
    <>
      {labels.map((l) => (
        <Html key={l.key} position={l.pos} zIndexRange={[30, 10]} style={{ pointerEvents: 'none' }}>
          <div
            className={`enc-lbl enc-lbl-${l.tone}`}
            ref={(el) => {
              if (el) els.current.set(l.key, el);
              else els.current.delete(l.key);
            }}
            style={{ ['--tone' as string]: TONE[l.tone] }}
          >
            <div className="enc-lbl-pill">
              <IconSvg icon={l.icon} color={TONE[l.tone]} />
              <div className="enc-lbl-text">
                <div className="enc-lbl-title">{l.title}</div>
                {l.sub && <div className="enc-lbl-sub">{l.sub}</div>}
              </div>
            </div>
            <div className="enc-lbl-leader" />
            <div className="enc-lbl-dot" />
          </div>
        </Html>
      ))}
    </>
  );
}

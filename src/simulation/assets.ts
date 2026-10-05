import type { Vec2 } from '../types';
import { LoopPath, Polyline, RoadGraph, SITE, filletLoop, filletPath } from '../data/site';
import { angleDeltaRad, clamp, smoothstep } from '../utils/math';

// Analytic, replayable kinematics for the synthetic field assets. Every asset keeps an append-only
// list of plan segments, so its pose can be evaluated for any past time (timeline replay).

export const ROADS = new RoadGraph(SITE.roads);

export interface Pose {
  x: number;
  y: number;
  z: number;
  /** three.js rotation.y for a model whose forward axis is +z */
  heading: number;
  speed: number;
}

// ---------------------------------------------------------------------------------------------- UGV

export const UGV_PATROL = new LoopPath(
  filletLoop(
    [
      { x: -400, z: 0 },
      { x: 400, z: 0 },
      { x: 400, z: -222 },
      { x: -400, z: -222 },
    ],
    10,
  ),
);

export type UgvSegment =
  | { type: 'patrol'; t0: number; s0: number; speed: number }
  | {
      type: 'route';
      t0: number;
      path: Polyline;
      vmax: number;
      accel: number;
      duration: number;
      purpose: 'inspect' | 'return';
      lookAt: Vec2 | null;
      label: string;
    }
  | { type: 'hold'; t0: number; x: number; z: number; heading: number; lookAt: Vec2 | null; label: string; mode: 'inspecting' | 'holding' };

function routeDuration(L: number, vmax: number, a: number) {
  const ta = vmax / a;
  const da = 0.5 * a * ta * ta;
  if (L >= 2 * da) return 2 * ta + (L - 2 * da) / vmax;
  return 2 * Math.sqrt(L / a);
}

function routeS(tau: number, L: number, vmax: number, a: number) {
  const T = routeDuration(L, vmax, a);
  const t = clamp(tau, 0, T);
  const ta = vmax / a;
  const da = 0.5 * a * ta * ta;
  if (L >= 2 * da) {
    if (t < ta) return 0.5 * a * t * t;
    if (t < T - ta) return da + vmax * (t - ta);
    const r = T - t;
    return L - 0.5 * a * r * r;
  }
  const th = T / 2;
  if (t < th) return 0.5 * a * t * t;
  const r = T - t;
  return L - 0.5 * a * r * r;
}

function routeV(tau: number, L: number, vmax: number, a: number) {
  const T = routeDuration(L, vmax, a);
  if (tau <= 0 || tau >= T) return 0;
  return Math.min(vmax, a * tau, a * (T - tau));
}

const findSegment = <T extends { t0: number }>(segs: T[], t: number) => {
  let lo = 0;
  let hi = segs.length - 1;
  if (t <= segs[0].t0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

export class UgvController {
  segments: UgvSegment[];
  readonly patrolSpeed = 3.6;

  constructor(t0: number) {
    this.segments = [{ type: 'patrol', t0, s0: 905, speed: this.patrolSpeed }];
  }

  current(t: number) {
    return this.segments[findSegment(this.segments, t)];
  }

  pose(t: number): Pose {
    const seg = this.current(t);
    switch (seg.type) {
      case 'patrol': {
        const s = seg.s0 + (seg.speed * (t - seg.t0)) / 1000;
        const p = UGV_PATROL.at(s);
        return { x: p.x, y: 0, z: p.z, heading: UGV_PATROL.headingAt(s, 4), speed: seg.speed };
      }
      case 'route': {
        const tau = (t - seg.t0) / 1000;
        const L = seg.path.length;
        const s = routeS(tau, L, seg.vmax, seg.accel);
        const p = seg.path.at(s);
        let heading = seg.path.headingAt(Math.min(s, L - 0.5), 4);
        if (s >= L - 0.01 && seg.lookAt) heading = Math.atan2(seg.lookAt.x - p.x, seg.lookAt.z - p.z);
        return { x: p.x, y: 0, z: p.z, heading, speed: routeV(tau, L, seg.vmax, seg.accel) };
      }
      case 'hold': {
        let heading = seg.heading;
        if (seg.lookAt) {
          const target = Math.atan2(seg.lookAt.x - seg.x, seg.lookAt.z - seg.z);
          const k = smoothstep(0, 1, (t - seg.t0) / 2500);
          heading = seg.heading + angleDeltaRad(seg.heading, target) * k;
        }
        return { x: seg.x, y: 0, z: seg.z, heading, speed: 0 };
      }
    }
  }

  /** Route end time for the active route segment (null when not routing). */
  arrivalTime(t: number): number | null {
    const seg = this.current(t);
    if (seg.type !== 'route') return null;
    return seg.t0 + seg.duration * 1000;
  }

  remaining(t: number): { distance: number; eta: number } | null {
    const seg = this.current(t);
    if (seg.type !== 'route') return null;
    const tau = (t - seg.t0) / 1000;
    const s = routeS(tau, seg.path.length, seg.vmax, seg.accel);
    return { distance: Math.max(0, seg.path.length - s), eta: Math.max(0, seg.duration - tau) };
  }

  dispatch(t: number, target: Vec2, lookAt: Vec2 | null, purpose: 'inspect' | 'return', label: string) {
    const p = this.pose(t);
    const raw = ROADS.route({ x: p.x, z: p.z }, target);
    const path = new Polyline(filletPath(raw, 9, 7));
    const vmax = 8;
    const accel = 1.4;
    const duration = routeDuration(path.length, vmax, accel);
    this.segments.push({ type: 'route', t0: t, path, vmax, accel, duration, purpose, lookAt, label });
    return { distance: path.length, duration, path };
  }

  hold(t: number, mode: 'inspecting' | 'holding', label: string, lookAt: Vec2 | null) {
    const p = this.pose(t);
    this.segments.push({ type: 'hold', t0: t, x: p.x, z: p.z, heading: p.heading, lookAt, label, mode });
  }

  /** Route back to the nearest point of the patrol loop, then resume patrolling from there. */
  returnToPatrol(t: number) {
    const p = this.pose(t);
    let bestS = 0;
    let bestD = Infinity;
    for (let s = 0; s < UGV_PATROL.length; s += 6) {
      const q = UGV_PATROL.at(s);
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bestD) (bestD = d), (bestS = s);
    }
    if (bestD < 3) {
      this.segments.push({ type: 'patrol', t0: t, s0: bestS, speed: this.patrolSpeed });
      return;
    }
    const target = UGV_PATROL.at(bestS);
    const { duration } = this.dispatch(t, target, null, 'return', 'Returning to patrol');
    this.segments.push({ type: 'patrol', t0: t + duration * 1000, s0: bestS, speed: this.patrolSpeed });
  }

  /** Active route polyline (for drawing the planned path), if any. */
  activeRoute(t: number): Polyline | null {
    const seg = this.current(t);
    return seg.type === 'route' ? seg.path : null;
  }
}

// ---------------------------------------------------------------------------------------------- UAV

export const UAV_PERIMETER = new LoopPath(
  filletLoop(
    [
      { x: -680, z: -360 },
      { x: 680, z: -360 },
      { x: 680, z: 330 },
      { x: -680, z: 330 },
    ],
    110,
    10,
  ),
);

export type UavSegment =
  | { type: 'perimeter'; t0: number; s0: number; speed: number; alt: number }
  | { type: 'orbit'; t0: number; cx: number; cz: number; r: number; alt: number; omega: number; phase0: number; label: string };

const UAV_BLEND_MS = 14000;

export class UavController {
  segments: UavSegment[];

  constructor(t0: number) {
    this.segments = [{ type: 'perimeter', t0, s0: 2450, speed: 17, alt: 118 }];
  }

  current(t: number) {
    return this.segments[findSegment(this.segments, t)];
  }

  private segPose(seg: UavSegment, t: number): Pose {
    if (seg.type === 'perimeter') {
      const s = seg.s0 + (seg.speed * (t - seg.t0)) / 1000;
      const p = UAV_PERIMETER.at(s);
      return { x: p.x, y: seg.alt, z: p.z, heading: UAV_PERIMETER.headingAt(s, 30), speed: seg.speed };
    }
    const ph = seg.phase0 + (seg.omega * (t - seg.t0)) / 1000;
    const x = seg.cx + seg.r * Math.cos(ph);
    const z = seg.cz + seg.r * Math.sin(ph);
    // tangent direction for positive omega
    const tx = -Math.sin(ph);
    const tz = Math.cos(ph);
    return { x, y: seg.alt, z, heading: Math.atan2(tx, tz), speed: Math.abs(seg.omega * seg.r) };
  }

  pose(t: number, index?: number): Pose {
    const i = index ?? findSegment(this.segments, t);
    const seg = this.segments[i];
    const p = this.segPose(seg, t);
    if (i > 0 && t - seg.t0 < UAV_BLEND_MS) {
      const q = this.pose(t, i - 1);
      const k = smoothstep(0, 1, (t - seg.t0) / UAV_BLEND_MS);
      return {
        x: q.x + (p.x - q.x) * k,
        y: q.y + (p.y - q.y) * k,
        z: q.z + (p.z - q.z) * k,
        heading: q.heading + angleDeltaRad(q.heading, p.heading) * k,
        speed: q.speed + (p.speed - q.speed) * k,
      };
    }
    return p;
  }

  /** Ground point the gimbal camera looks at. */
  lookTarget(t: number): Vec2 & { y: number } {
    const seg = this.current(t);
    const p = this.pose(t);
    if (seg.type === 'orbit') {
      const k = smoothstep(0, 1, (t - seg.t0) / UAV_BLEND_MS);
      const fx = p.x + Math.sin(p.heading) * 130;
      const fz = p.z + Math.cos(p.heading) * 130;
      return { x: fx + (seg.cx - fx) * k, y: 0, z: fz + (seg.cz - fz) * k };
    }
    // perimeter: look forward-down, biased towards the site centre
    const fx = p.x + Math.sin(p.heading) * 110;
    const fz = p.z + Math.cos(p.heading) * 110;
    return { x: fx * 0.82, y: 0, z: fz * 0.82 - 20 };
  }

  orbit(t: number, cx: number, cz: number, label: string) {
    const p = this.pose(t);
    const r = 150;
    const v = 14;
    const phase0 = Math.atan2(p.z - cz, p.x - cx);
    this.segments.push({ type: 'orbit', t0: t, cx, cz, r, alt: 96, omega: v / r, phase0, label });
  }

  resumePerimeter(t: number) {
    const p = this.pose(t);
    let bestS = 0;
    let bestD = Infinity;
    for (let s = 0; s < UAV_PERIMETER.length; s += 20) {
      const q = UAV_PERIMETER.at(s);
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bestD) (bestD = d), (bestS = s);
    }
    this.segments.push({ type: 'perimeter', t0: t, s0: bestS, speed: 17, alt: 118 });
  }

  isOrbiting(t: number) {
    return this.current(t).type === 'orbit';
  }
}

// ---------------------------------------------------------------------------------------------- Team & vehicle

const TEAM_LOOP = new LoopPath(
  filletLoop(
    [
      { x: 420, z: 188 },
      { x: 486, z: 188 },
      { x: 486, z: 212 },
      { x: 420, z: 212 },
    ],
    5,
  ),
);

export const TEAM_MEMBERS = [
  { id: 'TM-1', role: 'Survey lead' },
  { id: 'TM-2', role: 'Radiation protection technician' },
  { id: 'TM-3', role: 'Field technician' },
];

export function teamPose(index: number, t: number): Pose {
  if (index === 0) {
    const s = (1.15 * t) / 1000;
    const p = TEAM_LOOP.at(s);
    return { x: p.x, y: 0, z: p.z, heading: TEAM_LOOP.headingAt(s, 1.5), speed: 1.15 };
  }
  // two technicians working by the robotics apron, shifting weight occasionally
  const base = index === 1 ? { x: 437, z: 214.5, h: 2.6 } : { x: 439.2, z: 216.2, h: -2.2 };
  const sway = Math.sin(t / 2300 + index) * 0.25;
  return { x: base.x, y: 0, z: base.z, heading: base.h + sway, speed: 0 };
}

export const RESPONSE_VEHICLE_POSE: Pose = { x: 470, y: 0, z: 192.5, heading: -Math.PI / 2, speed: 0 };

import * as THREE from 'three';
import { SITE } from '../data/site';
import { engine } from '../simulation/engine';
import { envelope } from '../simulation/effects';
import { assetVisual } from './AssetLayer';
import { RESPONSE_VEHICLE_POSE } from '../simulation/assets';

// Synthetic object detection: known scene objects are projected into each feed camera and drawn as
// tracking boxes. Confidence values are generated locally.

export interface Detection {
  id: string;
  label: string;
  confidence: number;
  /** box in viewport pixels */
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'person' | 'robot' | 'vehicle' | 'structure' | 'hotspot' | 'aircraft';
  extra?: string;
}

interface Trackable {
  id: string;
  label: string;
  kind: Detection['kind'];
  base: number;
  center: THREE.Vector3;
  size: THREE.Vector3;
  extra?: string;
}

const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
const v = new THREE.Vector3();

function trackables(t: number): Trackable[] {
  const out: Trackable[] = [];
  const ugv = assetVisual.ugv;
  out.push({ id: 'ugv', label: 'UGV', kind: 'robot', base: 0.96, center: new THREE.Vector3(ugv.x, 1.5, ugv.z), size: new THREE.Vector3(3.4, 3.2, 3.4) });
  assetVisual.team.forEach((p, i) =>
    out.push({ id: `person-${i}`, label: 'Person', kind: 'person', base: 0.97 + (i === 1 ? 0.01 : 0), center: new THREE.Vector3(p.x, 0.9, p.z), size: new THREE.Vector3(0.75, 1.85, 0.75) }),
  );
  out.push({ id: 'rv', label: 'Vehicle', kind: 'vehicle', base: 0.94, center: new THREE.Vector3(RESPONSE_VEHICLE_POSE.x, 1.6, RESPONSE_VEHICLE_POSE.z), size: new THREE.Vector3(8.6, 3.2, 2.6) });
  const uav = assetVisual.uav;
  out.push({ id: 'uav', label: 'UAV', kind: 'aircraft', base: 0.91, center: new THREE.Vector3(uav.x, uav.y, uav.z), size: new THREE.Vector3(3.6, 1.2, 3.6) });
  for (const u of SITE.units) {
    out.push({ id: `dome-${u.id}`, label: 'Structure', kind: 'structure', base: 0.99, center: new THREE.Vector3(u.x, 34, u.z), size: new THREE.Vector3(55, 68, 55) });
  }
  for (const e of engine.liveEffects(t)) {
    if (e.kind !== 'thermal') continue;
    const env = envelope(e, t);
    if (env < 0.25) continue;
    const temp = engine.weather.current.temperature + e.amplitude * env;
    out.push({
      id: `hot-${e.id}`,
      label: 'Hotspot',
      kind: 'hotspot',
      base: 0.7 + 0.18 * env,
      center: new THREE.Vector3(e.x, 1.6, e.z),
      size: new THREE.Vector3(7.5, 3.4, 6),
      extra: `${temp.toFixed(1)} °C`,
    });
  }
  return out;
}

export function detect(camera: THREE.PerspectiveCamera, width: number, height: number, t: number, exclude?: string): Detection[] {
  const out: Detection[] = [];
  camera.updateMatrixWorld();
  const jitter = (id: string) => Math.sin(t / 900 + id.length * 1.7) * 0.006;
  for (const tr of trackables(t)) {
    if (tr.id === exclude) continue;
    // in front of the camera?
    v.copy(tr.center).applyMatrix4(camera.matrixWorldInverse);
    if (v.z > -1) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let k = 0;
    for (let ix = -1; ix <= 1; ix += 2)
      for (let iy = -1; iy <= 1; iy += 2)
        for (let iz = -1; iz <= 1; iz += 2) {
          const c = corners[k++];
          c.set(tr.center.x + (ix * tr.size.x) / 2, tr.center.y + (iy * tr.size.y) / 2, tr.center.z + (iz * tr.size.z) / 2).project(camera);
          minX = Math.min(minX, c.x);
          maxX = Math.max(maxX, c.x);
          minY = Math.min(minY, c.y);
          maxY = Math.max(maxY, c.y);
        }
    const x0 = ((minX + 1) / 2) * width;
    const x1 = ((maxX + 1) / 2) * width;
    const y0 = ((1 - maxY) / 2) * height;
    const y1 = ((1 - minY) / 2) * height;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    if (cx < 0 || cx > width || cy < 0 || cy > height) continue;
    const w = x1 - x0;
    const h = y1 - y0;
    if (w * h < (tr.kind === 'person' ? 30 : 60) || w > width * 0.85 || h > height * 0.9) continue;
    const cx0 = Math.max(1, x0);
    const cy0 = Math.max(1, y0);
    out.push({
      id: tr.id,
      label: tr.label,
      kind: tr.kind,
      confidence: Math.min(0.989, tr.base + jitter(tr.id)),
      x: cx0,
      y: cy0,
      w: Math.min(width - 1, x1) - cx0,
      h: Math.min(height - 1, y1) - cy0,
      extra: tr.extra,
    });
  }
  return out;
}

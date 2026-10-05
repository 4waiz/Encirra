import * as THREE from 'three';
import type { Selection } from '../store/ui';
import { LAYER } from './layers';

// Invisible pick volumes (zones, vehicles) raycast from the main twin view.

interface Pickable {
  object: THREE.Object3D;
  selection: Exclude<Selection, null>;
  /** lower wins when several volumes are hit */
  priority: number;
  area: number;
}

const pickables: Pickable[] = [];
const raycaster = new THREE.Raycaster();
raycaster.layers.set(LAYER.PICK);
const ndc = new THREE.Vector2();

export function registerPickable(p: Pickable) {
  p.object.traverse((o) => o.layers.set(LAYER.PICK));
  pickables.push(p);
  return () => {
    const i = pickables.indexOf(p);
    if (i >= 0) pickables.splice(i, 1);
  };
}

export function pickAt(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  camera: THREE.Camera,
): { selection: Exclude<Selection, null>; point: THREE.Vector3 } | null {
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  let best: { p: Pickable; hit: THREE.Intersection } | null = null;
  for (const p of pickables) {
    const hits = raycaster.intersectObject(p.object, true);
    if (!hits.length) continue;
    const hit = hits[0];
    if (
      !best ||
      p.priority < best.p.priority ||
      (p.priority === best.p.priority && (p.area < best.p.area || (p.area === best.p.area && hit.distance < best.hit.distance)))
    ) {
      best = { p, hit };
    }
  }
  return best ? { selection: best.p.selection, point: best.hit.point } : null;
}

/** Ray–ground intersection (y = 0) for pointer positions over open ground. */
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const gRay = new THREE.Raycaster();
export function groundPointAt(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  camera: THREE.Camera,
): THREE.Vector3 | null {
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  gRay.setFromCamera(ndc, camera);
  const out = new THREE.Vector3();
  return gRay.ray.intersectPlane(ground, out);
}

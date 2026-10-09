import * as THREE from 'three';

const v = new THREE.Vector3();
const w = new THREE.Vector3();
const camPos = new THREE.Vector3();

export interface Projected {
  x: number;
  y: number;
  visible: boolean;
  distance: number;
}

/** World → pixel coordinates inside a viewport rectangle. */
export function project(camera: THREE.Camera, rect: { width: number; height: number }, x: number, y: number, z: number, out?: Projected): Projected {
  v.set(x, y, z).project(camera);
  camPos.setFromMatrixPosition(camera.matrixWorld);
  const o = out ?? { x: 0, y: 0, visible: false, distance: 0 };
  o.x = ((v.x + 1) / 2) * rect.width;
  o.y = ((1 - v.y) / 2) * rect.height;
  o.visible = v.z > -1 && v.z < 1 && v.x > -1.08 && v.x < 1.08 && v.y > -1.12 && v.y < 1.12;
  o.distance = camPos.distanceTo(w.set(x, y, z));
  return o;
}

export function placeEl(el: HTMLElement | null, p: Projected, scale = 1) {
  if (!el) return;
  if (!p.visible) {
    if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden';
    return;
  }
  if (el.style.visibility !== 'visible') el.style.visibility = 'visible';
  el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
}

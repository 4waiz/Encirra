import * as THREE from 'three';
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import type CameraControlsImpl from 'camera-controls';
import { useViewports } from './viewports';
import { useUI, type Selection } from '../store/ui';
import { SENSOR_BY_ID } from '../simulation/sensors';
import { zoneById } from '../data/site';
import { assetVisual } from './AssetLayer';
import type { AssetId, FocusTarget } from '../types';
import { RESPONSE_VEHICLE_POSE } from '../simulation/assets';

/** Initial oblique aerial view from over the sea, looking south-east across the campus. */
export const HOME = { pos: new THREE.Vector3(-1080, 560, -1230), target: new THREE.Vector3(30, 0, -40) };

const rig: { controls: CameraControlsImpl | null } = { controls: null };

function lookAtFrom(target: THREE.Vector3, distance: number, polar: number, smooth = true) {
  const c = rig.controls;
  if (!c) return;
  const az = c.azimuthAngle;
  const pos = new THREE.Vector3(
    target.x + distance * Math.sin(polar) * Math.sin(az),
    target.y + distance * Math.cos(polar),
    target.z + distance * Math.sin(polar) * Math.cos(az),
  );
  void c.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, smooth);
}

function assetPosition(id: AssetId): THREE.Vector3 {
  if (id === 'UGV-01') return new THREE.Vector3(assetVisual.ugv.x, 2, assetVisual.ugv.z);
  if (id === 'UAV-01') return new THREE.Vector3(assetVisual.uav.x, assetVisual.uav.y, assetVisual.uav.z);
  if (id === 'TEAM-1') return new THREE.Vector3(assetVisual.team[0].x, 1, assetVisual.team[0].z);
  return new THREE.Vector3(RESPONSE_VEHICLE_POSE.x, 2, RESPONSE_VEHICLE_POSE.z);
}

export function focusOn(target: FocusTarget | Exclude<Selection, null>) {
  const ui = useUI.getState();
  switch (target.kind) {
    case 'sensor': {
      const s = SENSOR_BY_ID[target.id];
      if (!s) return;
      ui.setFollow(null);
      lookAtFrom(new THREE.Vector3(s.x, s.kind === 'met' ? 30 : 4, s.z), s.kind === 'met' ? 260 : 190, 0.92);
      return;
    }
    case 'asset': {
      const p = assetPosition(target.id);
      lookAtFrom(p, target.id === 'UAV-01' ? 210 : target.id === 'UGV-01' ? 95 : 110, target.id === 'UAV-01' ? 1.0 : 0.95);
      ui.setFollow(target.id === 'UGV-01' || target.id === 'UAV-01' || target.id === 'TEAM-1' ? target.id : null);
      return;
    }
    case 'zone': {
      const z = zoneById(target.id);
      if (!z) return;
      ui.setFollow(null);
      const size = Math.max(z.maxX - z.minX, z.maxZ - z.minZ);
      lookAtFrom(new THREE.Vector3((z.minX + z.maxX) / 2, 10, (z.minZ + z.maxZ) / 2), Math.max(220, size * 1.9), 0.9);
      return;
    }
    case 'location': {
      ui.setFollow(null);
      const r = 'radius' in target && target.radius ? target.radius : 120;
      lookAtFrom(new THREE.Vector3(target.x, 6, target.z), Math.max(200, r * 3), 0.92);
      return;
    }
  }
}

export function resetView() {
  useUI.getState().setFollow(null);
  void rig.controls?.setLookAt(HOME.pos.x, HOME.pos.y, HOME.pos.z, HOME.target.x, HOME.target.y, HOME.target.z, true);
}

export function zoomBy(factor: number) {
  const c = rig.controls;
  if (!c) return;
  void c.dolly(c.distance * factor, true);
}

export function cameraAzimuth() {
  return rig.controls?.azimuthAngle ?? 0;
}

export function setCameraPose(pos: [number, number, number], target: [number, number, number], smooth = true) {
  useUI.getState().setFollow(null);
  void rig.controls?.setLookAt(pos[0], pos[1], pos[2], target[0], target[1], target[2], smooth);
}

// automation hook (scripted demos / screenshot capture)
(window as unknown as { __ENCIRRA_CAMERA__: unknown }).__ENCIRRA_CAMERA__ = { focusOn, resetView, setCameraPose };

export function CameraRig() {
  const main = useViewports((s) => s.main);
  const ref = useRef<CameraControlsImpl>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    rig.controls = c;
    void c.setLookAt(HOME.pos.x, HOME.pos.y, HOME.pos.z, HOME.target.x, HOME.target.y, HOME.target.z, false);
    const stopFollow = () => useUI.getState().setFollow(null);
    c.addEventListener('controlstart', stopFollow);
    return () => {
      c.removeEventListener('controlstart', stopFollow);
      rig.controls = null;
    };
  }, []);

  const tmpTarget = useRef(new THREE.Vector3());
  useFrame(() => {
    const c = rig.controls;
    const follow = useUI.getState().follow;
    if (!c || !follow) return;
    const p = assetPosition(follow);
    c.getTarget(tmpTarget.current);
    if (tmpTarget.current.distanceTo(p) > 120) {
      // large jump (replay scrub, re-tasking): re-frame from a clean angle instead of dragging
      // the camera through buildings
      lookAtFrom(p, follow === 'UAV-01' ? 210 : 95, follow === 'UAV-01' ? 1.0 : 0.95);
      return;
    }
    void c.moveTo(p.x, p.y, p.z, true);
  }, 0.6);

  return (
    <CameraControls
      ref={ref}
      makeDefault
      domElement={main?.inputEl}
      smoothTime={0.55}
      draggingSmoothTime={0.12}
      minDistance={18}
      maxDistance={3800}
      minPolarAngle={0.12}
      maxPolarAngle={1.38}
      dollyToCursor
      azimuthRotateSpeed={0.55}
      polarRotateSpeed={0.55}
      truckSpeed={1.6}
      dollySpeed={0.7}
    />
  );
}

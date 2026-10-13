/**
 * All district buildings as a single merged mesh with the facade/window shader.
 * Power state per building is driven by the bus that supplies it (layout `bus`, 1-based).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { Mesh } from 'three';
import { useTwin } from '@/state/store';
import { BUILDINGS, N_BLD, BUILDING_BY_FACILITY } from '../data/twin';
import { CODE, isPowered, live } from '../data/live';
import { fx } from '../runtime';
import { buildDistrictBuildings } from './massing';
import { createFacadeMaterial, createStateTexture } from './facadeMaterial';
import { selectionToBuildingIndex } from '../interaction/selection';

export function Buildings() {
  const geometry = useMemo(() => buildDistrictBuildings(), []);
  const stateTex = useMemo(() => createStateTexture(N_BLD), []);
  const material = useMemo(() => createFacadeMaterial(stateTex), [stateTex]);
  const meshRef = useRef<Mesh>(null);
  const setHovered = useTwin((s) => s.setHovered);
  const setSelected = useTwin((s) => s.setSelected);

  // per-building animation state
  const anim = useMemo(
    () => ({
      power: new Float32Array(N_BLD).fill(1),
      restoreAt: new Float64Array(N_BLD).fill(-1e9),
      wasPowered: new Uint8Array(N_BLD).fill(1),
      highlight: new Float32Array(N_BLD),
      seenVersion: -1,
    }),
    [],
  );

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
    stateTex.dispose();
  }, [geometry, material, stateTex]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const u = material.userData.uniforms;
    u.uTime.value = t;
    const data = stateTex.image.data as Float32Array;
    const s = useTwin.getState();
    const hov = selectionToBuildingIndex(s.hovered);
    const sel = selectionToBuildingIndex(s.selected);
    let dirty = false;
    for (let i = 0; i < N_BLD; i++) {
      const b = BUILDINGS[i];
      let target = 1;
      let emergency = 0;
      let powered = true;
      const fac = b.facilityId ? live.facilities.get(b.facilityId) : undefined;
      if (fac && (fac.power === 'backup' || fac.power === 'offline')) {
        powered = false;
        target = fac.power === 'backup' ? 0.42 : 0;
        emergency = 1;
      } else if (b.busIndex >= 0) {
        const code = live.busCode[b.busIndex];
        powered = isPowered(code);
        target = powered ? 1 : 0;
        emergency = powered ? 0 : 1;
        if (code === CODE.restored && !anim.wasPowered[i]) anim.restoreAt[i] = t;
      }
      if (fac && fac.power === 'restored' && !anim.wasPowered[i]) anim.restoreAt[i] = t;
      anim.wasPowered[i] = powered ? 1 : 0;
      const cur = anim.power[i];
      const rate = target > cur ? 0.9 : 3.5; // slow fade-in, fast blackout
      const next = cur + Math.sign(target - cur) * Math.min(Math.abs(target - cur), rate * dt);
      anim.power[i] = next;
      const tint = Math.max(0, 1 - (t - anim.restoreAt[i]) / 3.2);
      const hTarget = i === sel ? 1 : i === hov ? 0.65 : 0;
      anim.highlight[i] += (hTarget - anim.highlight[i]) * Math.min(1, dt * 10);
      const o = i * 4;
      const vals = [next, tint, anim.highlight[i], emergency];
      for (let k = 0; k < 4; k++) {
        if (Math.abs(data[o + k] - vals[k]) > 1e-4) {
          data[o + k] = vals[k];
          dirty = true;
        }
      }
    }
    if (dirty) stateTex.needsUpdate = true;
    // x-ray ghosting
    const fade = 1 - 0.86 * fx.xray;
    u.uFade.value = fade;
    const wantTransparent = fade < 0.999;
    if (material.transparent !== wantTransparent) {
      material.transparent = wantTransparent;
      material.depthWrite = !wantTransparent;
      material.needsUpdate = true;
    }
    if (meshRef.current) meshRef.current.castShadow = !wantTransparent;
  });

  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const idx = geometry.index;
    if (e.faceIndex == null || !idx) return -1;
    const v = idx.getX(e.faceIndex * 3);
    return Math.round(geometry.getAttribute('aExtra').getX(v));
  };
  const toSelection = (bi: number) => {
    const b = BUILDINGS[bi];
    if (!b) return null;
    return b.facilityId ? { kind: 'facility' as const, id: b.facilityId } : { kind: 'building' as const, id: b.id };
  };

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      castShadow
      receiveShadow
      onPointerMove={(e) => {
        if (fx.xray > 0.5) return;
        e.stopPropagation();
        const bi = pick(e);
        const sel = toSelection(bi);
        const cur = useTwin.getState().hovered;
        if (sel && (!cur || cur.id !== sel.id || cur.kind !== sel.kind)) setHovered(sel);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHovered(null);
        document.body.style.cursor = '';
      }}
      onClick={(e) => {
        if (fx.xray > 0.5) return;
        e.stopPropagation();
        const sel = toSelection(pick(e));
        if (sel) setSelected(sel);
      }}
    />
  );
}

export { BUILDING_BY_FACILITY };

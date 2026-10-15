/**
 * Procedural fallback buildings: one merged mesh with the facade/window shader for every layout
 * building that the asset kit does not (yet) cover. Power state per building is driven by the
 * bus that supplies it (layout `bus`, 1-based) through the shared building state texture.
 */
import { useEffect, useMemo } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { BufferGeometry, Material } from 'three';
import { useTwin } from '@/state/store';
import { BUILDINGS } from '../data/twin';
import { fx } from '../runtime';
import { buildDistrictBuildings } from './massing';
import { createFacadeMaterial } from './facadeMaterial';
import { bldStateTex } from './buildingState';

/** Shared pointer handlers for merged building meshes (vertex attribute → building index). */
export function useBuildingPicking(geometry: BufferGeometry | null, attr: 'aExtra' | 'aBld') {
  const setHovered = useTwin((s) => s.setHovered);
  const setSelected = useTwin((s) => s.setSelected);
  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const idx = geometry?.index;
    if (!geometry || e.faceIndex == null || !idx) return -1;
    const v = idx.getX(e.faceIndex * 3);
    return Math.round(geometry.getAttribute(attr).getX(v));
  };
  const toSelection = (bi: number) => {
    const b = BUILDINGS[bi];
    if (!b) return null;
    return b.facilityId ? { kind: 'facility' as const, id: b.facilityId } : { kind: 'building' as const, id: b.id };
  };
  return {
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      if (fx.xray > 0.5) return;
      e.stopPropagation();
      const sel = toSelection(pick(e));
      const cur = useTwin.getState().hovered;
      if (sel && (!cur || cur.id !== sel.id || cur.kind !== sel.kind)) setHovered(sel);
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      setHovered(null);
      document.body.style.cursor = '';
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (fx.xray > 0.5) return;
      e.stopPropagation();
      const sel = toSelection(pick(e));
      if (sel) setSelected(sel);
    },
  };
}

/** Fade a set of materials for the underground x-ray view (toggles transparency only when needed). */
export function useXrayFade(materials: Material[], min = 0.14, onShadow?: (cast: boolean) => void) {
  useFrame(() => {
    const fade = 1 - (1 - min) * fx.xray;
    const transparent = fade < 0.999;
    for (const m of materials) {
      const base = (m.userData.baseTransparent as boolean | undefined) ?? false;
      const want = transparent || base;
      if (m.transparent !== want) {
        m.transparent = want;
        m.needsUpdate = true;
      }
      // exploded view: half-transparent ghosts that still depth-write (read as solids, no inner faces)
      const dw = !base && fade > 0.4;
      if (m.depthWrite !== dw) m.depthWrite = dw;
      const u = (m.userData as { uniforms?: { uFade?: { value: number } } }).uniforms;
      if (u?.uFade) u.uFade.value = fade;
      else m.opacity = fade * ((m.userData.baseOpacity as number | undefined) ?? 1);
    }
    onShadow?.(!transparent);
  });
}

export function Buildings({ skip }: { skip?: Set<number> }) {
  const key = skip ? [...skip].sort((a, b) => a - b).join(',') : '';
  const geometry = useMemo(() => buildDistrictBuildings(skip ? (b) => !skip.has(b.index) : undefined), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const material = useMemo(() => createFacadeMaterial(bldStateTex, { tiles: true }), []);
  const handlers = useBuildingPicking(geometry, 'aExtra');

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((state) => {
    material.userData.uniforms.uTime.value = state.clock.elapsedTime;
  });
  useXrayFade([material], 0.5);

  if (geometry.getAttribute('position').count === 0) return null;
  return <mesh geometry={geometry} material={material} castShadow receiveShadow {...handlers} />;
}

/**
 * Kit buildings: every layout building / facility placed from the Blender kit (scaled kit
 * buildings, unscaled facilities), statically batched per material (≈ a dozen draw calls),
 * with per-building colour variation, the lit-window shader on "glazing", state-driven lamps
 * and signage, live water-level columns in the elevated tanks, and the below-grade pump /
 * intake cut-away nodes kept visible in the underground x-ray view.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { type BufferGeometry, Matrix4, type Material, type Mesh, Object3D, Quaternion, Vector3 } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BUILDINGS, TANKS, type BuildingDef } from '../data/twin';
import { live } from '../data/live';
import { mulberry32 } from '../lib/GeoBuilder';
import { kitFiles, kitManifest, type KitAsset, type KitManifest } from '../assets/kit';
import { collectMeshes, mergeItems, type MergeItem } from '../assets/merge';
import { createKitMaterial, type KitUniforms } from '../assets/kitMaterials';
import { bldStateTex } from './buildingState';
import { useBuildingPicking, useXrayFade } from './Buildings';

export const KIT_BUILDING_FILES = [
  'tower-residential.glb',
  'tower-office.glb',
  'midrise-residential.glb',
  'lowrise-residential.glb',
  'villa.glb',
  'commercial-podium.glb',
  'hospital.glb',
  'substation.glb',
  'pump-station.glb',
  'water-tower.glb',
  'desalination-inlet.glb',
  'cooling-plant.glb',
  'emergency-ops.glb',
  'mall.glb',
  'office-complex.glb',
];

export interface Placement {
  b: BuildingDef;
  asset: KitAsset;
  matrix: Matrix4;
  scale: Vector3;
  roofY: number;
}

/** Resolve the kit node for each layout building (null → procedural fallback). */
export function resolvePlacements(m: KitManifest, loaded: Record<string, GLTF>): Placement[] {
  const out: Placement[] = [];
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  for (const b of BUILDINGS) {
    let asset: KitAsset | undefined;
    if (b.facilityId) asset = m.assets.find((a) => a.facilityId === b.facilityId) ?? m.assets.find((a) => a.kind === b.kind);
    else {
      let kind: string = b.kind;
      if (kind === 'midrise-residential' && b.height < 22) kind = 'lowrise-residential';
      const variants = m.assets.filter((a) => a.kind === kind).sort((x, y) => x.variant - y.variant);
      if (variants.length) asset = variants[b.variant % variants.length];
    }
    if (!asset || !loaded[asset.file]) continue;
    const ns = asset.nominalSize ?? [b.size[0], b.size[1], b.height];
    const isFacility = !!b.facilityId;
    const clamp = (v: number, a: number, c: number) => Math.min(c, Math.max(a, v));
    const s = isFacility
      ? new Vector3(1, 1, 1)
      : new Vector3(clamp(b.size[0] / ns[0], 0.72, 1.3), clamp(b.height / ns[2], 0.78, 1.28), clamp(b.size[1] / ns[1], 0.72, 1.3));
    q.setFromAxisAngle(up, b.rot);
    const matrix = new Matrix4().compose(new Vector3(b.pos[0], 0, b.pos[1]), q, s);
    out.push({ b, asset, matrix, scale: s, roofY: (asset.roofY ?? ns[2]) * s.y });
  }
  return out;
}

// colour variation (multipliers on the kit base colours)
// near-white / cream stone with a few beige and cool-grey accents (kit COLOR_0 adds a per-variant stone tint)
const FACADE_TINTS: [number, number, number][] = [
  [1.08, 1.08, 1.1],
  [1.04, 1.04, 1.06],
  [1.02, 1.0, 0.97],
  [0.98, 0.96, 0.92],
  [1.06, 1.06, 1.09],
  [0.95, 0.96, 1.0],
];
const ALT_TINTS: [number, number, number][] = [
  [1.0, 1.0, 1.0],
  [1.06, 1.05, 1.03],
  [0.96, 0.95, 0.93],
  [0.92, 0.89, 0.84],
  [1.03, 1.01, 0.98],
];
const GLAZING_TINTS: [number, number, number][] = [
  [1.0, 1.0, 1.0],
  [0.78, 0.9, 1.05],
  [0.85, 1.0, 0.97],
  [0.68, 0.7, 0.74],
  [1.0, 0.95, 0.88],
];
const TRIM_TINTS: [number, number, number][] = [
  [1.0, 1.0, 1.0],
  [1.35, 1.12, 0.85],
  [0.8, 0.82, 0.86],
];

const isDynamic = (o: Object3D) => /^water_level/.test(o.name);
const isUnderground = (o: Object3D) => /cutaway/.test(o.name);

interface Batch {
  name: string;
  geometry: BufferGeometry;
  material: Material;
  underground: boolean;
}

function buildBatches(placements: Placement[], loaded: Record<string, GLTF>, m: KitManifest, uniforms: KitUniforms) {
  const groups = new Map<string, { items: MergeItem[]; src: Material; underground: boolean; name: string }>();
  const levels: { tank: number; mesh: Mesh; base: Matrix4; facilityId: string }[] = [];
  for (const p of placements) {
    const gltf = loaded[p.asset.file];
    const node = gltf.scene.getObjectByName(p.asset.node);
    if (!node) continue;
    const r = mulberry32(5000 + p.b.index * 31);
    const fac = !!p.b.facilityId;
    const tints: Record<string, [number, number, number]> = {
      facade: fac ? [1, 1, 1] : FACADE_TINTS[Math.floor(r() * FACADE_TINTS.length)],
      facade_alt: fac ? [1, 1, 1] : ALT_TINTS[Math.floor(r() * ALT_TINTS.length)],
      glazing: fac ? [1, 1, 1] : GLAZING_TINTS[Math.floor(r() * GLAZING_TINTS.length)],
      trim: TRIM_TINTS[Math.floor(r() * TRIM_TINTS.length)],
    };
    // root-relative transforms; node transforms are identity for kit assets
    const meshes = collectMeshes(node, gltf.scene, isDynamic);
    for (const mm of meshes) {
      let o: Object3D | null = mm.owner;
      let under = false;
      while (o && o !== node) {
        if (isUnderground(o)) under = true;
        o = o.parent;
      }
      const key = `${under ? 'u:' : 's:'}${mm.name}`;
      if (!groups.has(key)) groups.set(key, { items: [], src: mm.material, underground: under, name: mm.name });
      const world = new Matrix4().multiplyMatrices(p.matrix, mm.matrix);
      groups.get(key)!.items.push({ geometry: mm.geometry, matrix: world, bld: p.b.index, tint: tints[mm.name] ?? [1, 1, 1] });
    }
    // live water level columns
    const tankIdx = TANKS.findIndex((t) => t.facilityId === p.b.facilityId);
    if (tankIdx >= 0) {
      gltf.scene.updateMatrixWorld(true);
      const inv = new Matrix4().copy(gltf.scene.matrixWorld).invert();
      const seen = new Set<Object3D>();
      node.traverse((o) => {
        if (!isDynamic(o)) return;
        o.traverse((c) => {
          if (!(c as Mesh).isMesh || seen.has(c)) return;
          seen.add(c);
          const rel = new Matrix4().multiplyMatrices(inv, c.matrixWorld);
          levels.push({ tank: tankIdx, mesh: c as Mesh, base: new Matrix4().multiplyMatrices(p.matrix, rel), facilityId: p.b.facilityId! });
        });
      });
    }
  }
  const batches: Batch[] = [];
  for (const [, g] of groups) {
    const geometry = mergeItems(g.items);
    if (!geometry) continue;
    const material = createKitMaterial(g.name, g.src, m, uniforms, { darkenOutage: !g.underground });
    material.userData.baseTransparent = material.transparent;
    material.userData.baseOpacity = material.opacity;
    batches.push({ name: g.name, geometry, material, underground: g.underground });
  }
  return { batches, levels };
}

export function KitBuildings({ placements, signature }: { placements: Placement[]; signature: string }) {
  const uniforms = useMemo<KitUniforms>(() => ({ uState: { value: bldStateTex }, uTime: { value: 0 }, uFade: { value: 1 } }), []);
  const built = useMemo(() => {
    const m = kitManifest();
    if (!m) return null;
    return buildBatches(placements, kitFiles(KIT_BUILDING_FILES), m, uniforms);
  }, [placements, signature, uniforms]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      built?.batches.forEach((b) => {
        b.geometry.dispose();
        b.material.dispose();
      });
    },
    [built],
  );

  const surfaceMats = useMemo(() => (built?.batches ?? []).filter((b) => !b.underground).map((b) => b.material), [built]);
  const meshRefs = useRef<(Mesh | null)[]>([]);
  useXrayFade(surfaceMats, 0.12, (cast) => {
    meshRefs.current.forEach((mm) => {
      if (mm && !mm.userData.underground) mm.castShadow = cast;
    });
  });
  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
  });

  if (!built) return null;
  return (
    <group>
      {built.batches.map((b, i) => (
        <BatchMesh key={`${b.name}-${b.underground}`} batch={b} refCb={(mm) => (meshRefs.current[i] = mm)} />
      ))}
      <WaterLevels levels={built.levels} />
    </group>
  );
}

function BatchMesh({ batch, refCb }: { batch: Batch; refCb: (m: Mesh | null) => void }) {
  const handlers = useBuildingPicking(batch.geometry, 'aBld');
  const pickable = !batch.underground && batch.name !== 'glass_clear';
  return (
    <mesh
      ref={(m) => {
        if (m) m.userData.underground = batch.underground;
        refCb(m);
      }}
      geometry={batch.geometry}
      material={batch.material}
      castShadow={batch.name !== 'glass_clear' && batch.name !== 'light_emissive'}
      receiveShadow
      renderOrder={batch.material.transparent ? 11 : 0}
      {...(pickable ? handlers : {})}
    />
  );
}

/** Water columns inside the elevated tanks: scale.y = level / max level (manifest convention). */
function WaterLevels({ levels }: { levels: { tank: number; mesh: Mesh; base: Matrix4; facilityId: string }[] }) {
  const objs = useMemo(
    () =>
      levels.map((l) => {
        const mesh = l.mesh.clone();
        mesh.matrixAutoUpdate = false;
        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone() as Material & { emissiveIntensity?: number };
        if ('emissiveIntensity' in mat) mat.emissiveIntensity = 1.4;
        mesh.material = mat;
        return { ...l, mesh, mat };
      }),
    [levels],
  );
  const scaleM = useMemo(() => new Matrix4(), []);
  useFrame(() => {
    for (const o of objs) {
      const t = TANKS[o.tank];
      const pct = Math.max(0, Math.min(100, live.tankPct[o.tank] ?? 50));
      const levelM = t.minLevelM + ((t.maxLevelM - t.minLevelM) * pct) / 100;
      const sy = Math.max(0.001, Math.min(1, levelM / t.maxLevelM));
      scaleM.makeScale(1, sy, 1);
      o.mesh.matrix.multiplyMatrices(o.base, scaleM);
      o.mesh.matrixWorldNeedsUpdate = true;
    }
  });
  useEffect(() => () => objs.forEach((o) => o.mat.dispose()), [objs]);
  return (
    <>
      {objs.map((o, i) => (
        <primitive key={i} object={o.mesh} />
      ))}
    </>
  );
}

/**
 * Kit street props: instanced palms (3 variants) and street lights from the asset kit, plus
 * rooftop PV arrays on layout buildings flagged roofSolar. Street-light lamp heads follow the
 * bus of the nearest building (dark when that bus has lost supply).
 */
import { useEffect, useMemo } from 'react';
import { BufferGeometry, InstancedBufferAttribute, InstancedMesh, type Material, Matrix4, type Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { cityLayout } from '@encirra/shared';
import { propBusIndex } from '../data/twin';
import { busTex } from '../data/stateTextures';
import { collectMeshes } from '../assets/merge';
import { kitFiles, kitManifest, useKitSignature } from '../assets/kit';
import { KIT_BUILDING_FILES, resolvePlacements } from '../buildings/KitBuildings';
import { useXrayFade } from '../buildings/Buildings';
import { useSceneQuality } from '../runtime';
import { patchWorldTiles, withPatch } from '../anim/patch';

const PALMS = cityLayout.props.palms;
const LIGHTS = cityLayout.props.streetLights;

function instanced(gltf: GLTF, nodeName: string, matrices: Matrix4[], mats: Map<string, Material>, busIdx?: number[]) {
  const node = gltf.scene.getObjectByName(nodeName);
  if (!node || matrices.length === 0) return [] as InstancedMesh[];
  const out: InstancedMesh[] = [];
  for (const mm of collectMeshes(node, gltf.scene)) {
    let mat = mats.get(mm.name);
    if (!mat) {
      const src = mm.material as MeshStandardMaterial;
      const m = src.clone();
      m.vertexColors = !!mm.geometry.getAttribute('color');
      if (mm.name === 'light_emissive') {
        m.emissiveIntensity = (src.emissiveIntensity ?? 6) * 0.6;
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uBusTex = { value: busTex };
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float aBus;\nuniform sampler2D uBusTex;\nvarying float vOn;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOn = aBus >= 0.0 ? texelFetch(uBusTex, ivec2(int(aBus + 0.5), 0), 0).b : 1.0;');
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying float vOn;')
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= mix(0.04, 1.0, vOn);');
        };
        m.customProgramCacheKey = () => 'encirra-lamp-bus';
      }
      withPatch(m, 'tiles-pop', (s) => patchWorldTiles(s, { pop: true }));
      mats.set(mm.name, m);
      mat = m;
    }
    const geo = mm.geometry.clone() as BufferGeometry;
    if (busIdx) geo.setAttribute('aBus', new InstancedBufferAttribute(Float32Array.from(busIdx), 1));
    const im = new InstancedMesh(geo, mat, matrices.length);
    const tmp = new Matrix4();
    matrices.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, mm.matrix)));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = mm.name !== 'light_emissive';
    im.receiveShadow = true;
    im.computeBoundingSphere();
    out.push(im);
  }
  return out;
}

export function KitProps({ palms, lights }: { palms: boolean; lights: boolean }) {
  const sigProps = useKitSignature(['palm.glb', 'streetlight.glb']);
  const sigSolar = useKitSignature(['solar-array.glb', ...KIT_BUILDING_FILES]);
  const sig = sigProps + '#' + sigSolar;
  const tier = useSceneQuality((s) => s.tier);
  const built = useMemo(() => {
    if (!sigProps.startsWith('ready:')) return null;
    const files = kitFiles(['palm.glb', 'streetlight.glb', 'solar-array.glb', ...KIT_BUILDING_FILES]);
    const mats = new Map<string, Material>();
    const meshes: InstancedMesh[] = [];
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    if (palms && files['palm.glb']) {
      const byVariant: Matrix4[][] = [[], [], []];
      PALMS.forEach(([x, z, s, r], i) => {
        if (tier === 'low' && i % 2 === 1) return; // half the palms on the low tier
        q.setFromAxisAngle(up, r);
        const v = (i * 7 + Math.floor(s * 10)) % 3;
        byVariant[v].push(new Matrix4().compose(new Vector3(x, 0, z), q, new Vector3(s, s * (v === 2 ? 0.85 : 1), s)));
      });
      byVariant.forEach((list, v) => meshes.push(...instanced(files['palm.glb'], `palm_v${v}`, list, mats)));
    }
    if (lights && files['streetlight.glb']) {
      const list: Matrix4[] = [];
      const bus: number[] = [];
      LIGHTS.forEach(([x, z, r]) => {
        // kit lights reach along +Z (towards the carriageway) like the layout rotation convention
        q.setFromAxisAngle(up, r);
        list.push(new Matrix4().compose(new Vector3(x, 0, z), q, new Vector3(1, 1, 1)));
        bus.push(propBusIndex(x, z));
      });
      meshes.push(...instanced(files['streetlight.glb'], 'streetlight_v0', list, mats, bus));
    }
    const m = kitManifest();
    if (m && sigSolar.startsWith('ready:') && files['solar-array.glb']) {
      const list: Matrix4[] = [];
      for (const p of resolvePlacements(m, files)) {
        if (!p.b.roofSolar || p.b.facilityId) continue;
        const ns = p.asset.nominalSize ?? [20, 18, 30];
        const w = ns[0] * p.scale.x * 0.62;
        const d = ns[1] * p.scale.z * 0.55;
        const nx = Math.max(1, Math.floor(w / 10.4));
        const nz = Math.max(1, Math.floor(d / 6.1));
        q.setFromAxisAngle(up, p.b.rot);
        for (let i = 0; i < nx; i++)
          for (let k = 0; k < nz; k++) {
            const lx = (i - (nx - 1) / 2) * 10.4;
            const lz = (k - (nz - 1) / 2) * 6.1;
            const off = new Vector3(lx, p.roofY + 0.35, lz).applyQuaternion(q);
            list.push(new Matrix4().compose(new Vector3(p.b.pos[0] + off.x, off.y, p.b.pos[1] + off.z), q, new Vector3(1, 1, 1)));
          }
      }
      meshes.push(...instanced(files['solar-array.glb'], 'solar-array_v0', list, mats));
    }
    return { meshes, mats: [...mats.values()] };
  }, [sig, palms, lights, tier]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      built?.meshes.forEach((m) => m.geometry.dispose());
      built?.mats.forEach((m) => m.dispose());
    },
    [built],
  );
  useXrayFade(built?.mats ?? [], 0.5);

  if (!built) return null;
  return (
    <group>
      {built.meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}

export type { Mesh };

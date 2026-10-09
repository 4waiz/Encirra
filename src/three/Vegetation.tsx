import * as THREE from 'three';
import { useEffect, useMemo } from 'react';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SeededRandom } from '../utils/random';
import { DUNE_START, HIGHWAY_Z, ROAD_X, terrainHeight } from './terrainHeight';
import { registerThermal, thermalSolid } from './thermal';

// Desert vegetation around the campus: low shrubs in the interdune hollows and on the coastal plain,
// and scattered ghaf-style trees. Two instanced draw calls; placement is seeded, so it never changes.

const CAMPUS = { minX: -660, maxX: 660, minZ: -320, maxZ: 340 };

/** Is (x, z) somewhere a plant could grow? */
function open(x: number, z: number) {
  if (x > CAMPUS.minX && x < CAMPUS.maxX && z > CAMPUS.minZ && z < CAMPUS.maxZ) return false;
  if (z < -60 + 0.012 * Math.abs(x)) return false; // keep off the beach and the shore
  if (Math.abs(x - ROAD_X) < 22 && z > 280) return false;
  if (Math.abs(z - HIGHWAY_Z) < 24) return false;
  if (Math.abs(x) < 130 && z > 280 && z < 2000) return false; // power-line corridor
  return true;
}

function shrubGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(1, 0.55, 1);
  g.translate(0, 0.32, 0);
  return g;
}

function treeGeometry() {
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 2.6, 6);
  trunk.translate(0, 1.3, 0);
  const canopy = new THREE.IcosahedronGeometry(1, 1);
  canopy.scale(3.1, 1.5, 3.1);
  canopy.translate(0, 3.4, 0);
  const paint = (g: THREE.BufferGeometry, hex: string) => {
    const c = new THREE.Color(hex);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
  const merged = mergeGeometries([paint(flat(trunk), '#6b5845'), paint(flat(canopy), '#6c7b45')]);
  trunk.dispose();
  canopy.dispose();
  return merged;
}

export function Vegetation() {
  const { shrubs, trees } = useMemo(() => {
    const rng = new SeededRandom('desert-vegetation');
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();

    // shrubs: denser on the coastal plain and in dune hollows, sparse on crests
    const shrubMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0, name: 'shrub' });
    const SHRUBS = 2600;
    const shrubs = new THREE.InstancedMesh(shrubGeometry(), shrubMat, SHRUBS);
    shrubs.name = 'shrubs';
    const greens = ['#6f7a4c', '#7c8253', '#5f6b45', '#8a865b', '#9b8a62'];
    let n = 0;
    for (let tries = 0; n < SHRUBS && tries < SHRUBS * 30; tries++) {
      const near = rng.float() < 0.55;
      const x = near ? rng.range(-3200, 3200) : rng.range(-9000, 9000);
      const z = near ? rng.range(-180, 2400) : rng.range(-180, 8000);
      if (!open(x, z)) continue;
      const h = terrainHeight(x, z);
      const keep = z < DUNE_START ? 0.55 : 1 - THREE.MathUtils.smoothstep(h, 2, 14) * 0.92;
      if (rng.float() > keep) continue;
      const r = rng.range(0.7, 2.1) * (z < DUNE_START ? 1 : 0.85);
      q.setFromAxisAngle(up, rng.range(0, Math.PI * 2));
      m.compose(new THREE.Vector3(x, h - 0.15, z), q, new THREE.Vector3(r, r * rng.range(0.7, 1.15), r));
      shrubs.setMatrixAt(n, m);
      col.set(greens[Math.floor(rng.float() * greens.length)]).multiplyScalar(rng.range(0.85, 1.12));
      shrubs.setColorAt(n, col);
      n++;
    }
    shrubs.count = n;
    shrubs.instanceMatrix.needsUpdate = true;
    if (shrubs.instanceColor) shrubs.instanceColor.needsUpdate = true;
    shrubs.receiveShadow = true;
    shrubs.computeBoundingSphere();

    // ghaf-style trees: on the plain and the flat corridors' margins, never on dune crests
    const treeMat = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.92, metalness: 0, name: 'ghaf' });
    const TREES = 240;
    const trees = new THREE.InstancedMesh(treeGeometry(), treeMat, TREES);
    trees.name = 'trees';
    let t = 0;
    for (let tries = 0; t < TREES && tries < TREES * 60; tries++) {
      const x = rng.range(-5200, 5200);
      const z = rng.range(-150, 3600);
      if (!open(x, z)) continue;
      const h = terrainHeight(x, z);
      if (h > 1.5) continue;
      const s = rng.range(0.75, 1.35);
      q.setFromAxisAngle(up, rng.range(0, Math.PI * 2));
      m.compose(new THREE.Vector3(x, h - 0.1, z), q, new THREE.Vector3(s, s * rng.range(0.85, 1.15), s));
      trees.setMatrixAt(t, m);
      // neutral brightness / hue jitter (vertex colours carry the trunk and canopy tones)
      const v = rng.range(0.86, 1.12);
      col.setRGB(v * rng.range(0.94, 1.04), v, v * rng.range(0.9, 1.02));
      trees.setColorAt(t, col);
      t++;
    }
    trees.count = t;
    trees.instanceMatrix.needsUpdate = true;
    if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
    trees.castShadow = true;
    trees.receiveShadow = true;
    trees.computeBoundingSphere();
    return { shrubs, trees };
  }, []);

  useEffect(() => {
    const offs = [registerThermal(shrubs, thermalSolid(0.36, 0.1)), registerThermal(trees, thermalSolid(0.34, 0.1))];
    return () => {
      offs.forEach((f) => f());
      for (const mesh of [shrubs, trees]) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        mesh.dispose();
      }
    };
  }, [shrubs, trees]);

  return (
    <>
      <primitive object={shrubs} />
      <primitive object={trees} />
    </>
  );
}

/**
 * Static batching for kit meshes: bake many (geometry, matrix) items into one Float32 geometry
 * with per-vertex building index (aBld), tinted baked AO (color) and the glazing grid (aGrid).
 * Handles meshopt-quantized / normalized source attributes via getX/getY/getZ.
 */
import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Mesh, type Material, Object3D, Vector3 } from 'three';

export interface MergeItem {
  geometry: BufferGeometry;
  matrix: Matrix4;
  bld: number;
  tint: [number, number, number];
}

export function mergeItems(items: MergeItem[]): BufferGeometry | null {
  let nv = 0;
  let ni = 0;
  for (const it of items) {
    const p = it.geometry.getAttribute('position');
    if (!p) continue;
    nv += p.count;
    ni += it.geometry.index ? it.geometry.index.count : p.count;
  }
  if (nv === 0) return null;
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const col = new Float32Array(nv * 3);
  const grid = new Float32Array(nv * 2);
  const bld = new Float32Array(nv);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const v = new Vector3();
  const n = new Vector3();
  const nm = new Matrix3();
  let vo = 0;
  let io = 0;
  for (const it of items) {
    const g = it.geometry;
    const P = g.getAttribute('position');
    if (!P) continue;
    const N = g.getAttribute('normal');
    const UV = g.getAttribute('uv');
    const C = g.getAttribute('color');
    nm.getNormalMatrix(it.matrix);
    const flip = it.matrix.determinant() < 0;
    for (let i = 0; i < P.count; i++) {
      v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(it.matrix);
      pos[(vo + i) * 3] = v.x;
      pos[(vo + i) * 3 + 1] = v.y;
      pos[(vo + i) * 3 + 2] = v.z;
      if (N) n.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(nm).normalize();
      else n.set(0, 1, 0);
      nor[(vo + i) * 3] = n.x;
      nor[(vo + i) * 3 + 1] = n.y;
      nor[(vo + i) * 3 + 2] = n.z;
      const ao = C ? [C.getX(i), C.getY(i), C.getZ(i)] : [1, 1, 1];
      col[(vo + i) * 3] = ao[0] * it.tint[0];
      col[(vo + i) * 3 + 1] = ao[1] * it.tint[1];
      col[(vo + i) * 3 + 2] = ao[2] * it.tint[2];
      if (UV) {
        grid[(vo + i) * 2] = UV.getX(i);
        grid[(vo + i) * 2 + 1] = UV.getY(i);
      }
      bld[vo + i] = it.bld;
    }
    if (g.index) {
      const I = g.index;
      for (let k = 0; k < I.count; k += 3) {
        const a = I.getX(k) + vo;
        const b = I.getX(k + 1) + vo;
        const c = I.getX(k + 2) + vo;
        idx[io++] = a;
        idx[io++] = flip ? c : b;
        idx[io++] = flip ? b : c;
      }
    } else {
      for (let k = 0; k < P.count; k++) idx[io++] = vo + k;
    }
    vo += P.count;
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nor, 3));
  out.setAttribute('color', new BufferAttribute(col, 3));
  out.setAttribute('aGrid', new BufferAttribute(grid, 2));
  out.setAttribute('aBld', new BufferAttribute(bld, 1));
  out.setIndex(new BufferAttribute(idx.subarray(0, io), 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Collect (geometry, material name, world matrix relative to `root`) for every mesh under `node`. */
export function collectMeshes(node: Object3D, root: Object3D, skip?: (o: Object3D) => boolean) {
  root.updateMatrixWorld(true);
  const inv = new Matrix4().copy(root.matrixWorld).invert();
  const out: { geometry: BufferGeometry; material: Material; name: string; matrix: Matrix4; owner: Object3D }[] = [];
  const visit = (o: Object3D) => {
    if (o !== node && skip?.(o)) return;
    if ((o as Mesh).isMesh) {
      const m = o as Mesh;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const rel = new Matrix4().multiplyMatrices(inv, m.matrixWorld);
      // multi-material meshes are split into groups by GLTFLoader as separate primitives/meshes
      for (const mat of mats) out.push({ geometry: m.geometry, material: mat, name: mat.name, matrix: rel, owner: m });
    }
    for (const c of o.children) visit(c);
  };
  visit(node);
  return out;
}

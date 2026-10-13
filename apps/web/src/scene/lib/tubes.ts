/**
 * Merged tube geometry for 3D polylines (pipes). Straight cylinders per segment plus spherical
 * joints; attributes: aId (pipe index), aS (arc length, m), aAround (0…1 around the tube).
 */
import { BufferAttribute, BufferGeometry, Vector3 } from 'three';

export interface TubeSpec {
  id: number;
  points: [number, number, number][];
  radius: number;
}

export function buildTubes(specs: TubeSpec[], radial = 12, joints = true, radiusScale = 1): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const aId: number[] = [];
  const aS: number[] = [];
  const aAround: number[] = [];
  const idx: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const dir = new Vector3();
  const u = new Vector3();
  const v = new Vector3();
  const tmp = new Vector3();
  for (const spec of specs) {
    const r = spec.radius * radiusScale;
    let s = 0;
    for (let i = 0; i < spec.points.length - 1; i++) {
      a.set(...spec.points[i]);
      b.set(...spec.points[i + 1]);
      dir.subVectors(b, a);
      const len = dir.length();
      if (len < 1e-3) continue;
      dir.divideScalar(len);
      // frame
      tmp.set(0, 1, 0);
      if (Math.abs(dir.y) > 0.9) tmp.set(1, 0, 0);
      u.crossVectors(dir, tmp).normalize();
      v.crossVectors(dir, u).normalize();
      const base = pos.length / 3;
      for (let k = 0; k <= radial; k++) {
        const ang = (k / radial) * Math.PI * 2;
        const cx = Math.cos(ang);
        const cy = Math.sin(ang);
        const nx = u.x * cx + v.x * cy;
        const ny = u.y * cx + v.y * cy;
        const nz = u.z * cx + v.z * cy;
        for (const [p, sv] of [
          [a, s],
          [b, s + len],
        ] as const) {
          pos.push(p.x + nx * r, p.y + ny * r, p.z + nz * r);
          nor.push(nx, ny, nz);
          aId.push(spec.id);
          aS.push(sv);
          aAround.push(k / radial);
        }
      }
      for (let k = 0; k < radial; k++) {
        const i0 = base + k * 2;
        const i1 = base + (k + 1) * 2;
        idx.push(i0, i1, i0 + 1, i1, i1 + 1, i0 + 1);
      }
      s += len;
      // spherical joint at the end of the segment (except last)
      if (joints && i < spec.points.length - 2) {
        const jb = pos.length / 3;
        const rings = 6;
        const seg = radial;
        for (let ri = 0; ri <= rings; ri++) {
          const th = (ri / rings) * Math.PI;
          for (let k = 0; k <= seg; k++) {
            const ph = (k / seg) * Math.PI * 2;
            const nx = Math.sin(th) * Math.cos(ph);
            const ny = Math.cos(th);
            const nz = Math.sin(th) * Math.sin(ph);
            pos.push(b.x + nx * r, b.y + ny * r, b.z + nz * r);
            nor.push(nx, ny, nz);
            aId.push(spec.id);
            aS.push(s);
            aAround.push(k / seg);
          }
        }
        for (let ri = 0; ri < rings; ri++) {
          for (let k = 0; k < seg; k++) {
            const p0 = jb + ri * (seg + 1) + k;
            const p1 = p0 + seg + 1;
            idx.push(p0, p0 + 1, p1, p0 + 1, p1 + 1, p1);
          }
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('aId', new BufferAttribute(new Float32Array(aId), 1));
  g.setAttribute('aS', new BufferAttribute(new Float32Array(aS), 1));
  g.setAttribute('aAround', new BufferAttribute(new Float32Array(aAround), 1));
  g.setIndex(pos.length / 3 > 65535 ? new BufferAttribute(new Uint32Array(idx), 1) : new BufferAttribute(new Uint16Array(idx), 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * Small procedural geometry builder.
 *
 * Accumulates boxes / prisms / quads in a local frame (position + rotation about +Y) and emits a
 * single merged BufferGeometry with the attributes used by the facade shader:
 *   position, normal, color          — standard
 *   aFacade  (vec2)  u = metres along the facade from its left corner, v = world height (m)
 *   aStyle   (vec4)  facade style id, floor height, bay width, facade length
 *   aExtra   (vec4)  building index, base y of the volume, face seed, top y of the volume
 */
import { BufferAttribute, BufferGeometry } from 'three';

export const STYLE = {
  plain: 0, // no windows (roof, plinths, equipment)
  punched: 1, // residential punched windows
  curtain: 2, // office curtain wall
  ribbon: 3, // horizontal ribbon windows (hospital, commercial)
  storefront: 4, // tall ground-floor glazing
  louvre: 5, // industrial louvres
  villa: 6, // large villa openings
  solar: 7, // rooftop PV (top faces)
  roof: 8, // roof slab with subtle panels
  glassBlock: 9, // fully glazed (atrium, lobby)
  balcony: 10, // residential with balcony recesses
} as const;

export interface FaceOpts {
  color: [number, number, number];
  style?: number;
  roofStyle?: number;
  roofColor?: [number, number, number];
  floorH?: number;
  bayW?: number;
  bld?: number;
  seed?: number;
  top?: boolean;
  bottom?: boolean;
  /** skip individual walls: +x, −x, +z, −z */
  skip?: Partial<Record<'px' | 'nx' | 'pz' | 'nz', boolean>>;
}

export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private fac: number[] = [];
  private sty: number[] = [];
  private ext: number[] = [];
  private idx: number[] = [];
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private c = 1;
  private s = 0;
  private faceCounter = 0;

  /** Local frame: world = R_y(rot)·local + (x, y, z). */
  frame(x: number, y: number, z: number, rot = 0) {
    this.ox = x;
    this.oy = y;
    this.oz = z;
    this.c = Math.cos(rot);
    this.s = Math.sin(rot);
    return this;
  }

  private tx(lx: number, ly: number, lz: number): [number, number, number] {
    return [this.ox + lx * this.c + lz * this.s, this.oy + ly, this.oz - lx * this.s + lz * this.c];
  }
  private tn(nx: number, ny: number, nz: number): [number, number, number] {
    return [nx * this.c + nz * this.s, ny, -nx * this.s + nz * this.c];
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  /**
   * Quad from 4 local corners (counter-clockwise seen from the normal side).
   * uvs: facade coordinates per corner.
   */
  quad(
    p: [number, number, number][],
    n: [number, number, number],
    uv: [number, number][],
    color: [number, number, number],
    style: [number, number, number, number],
    extra: [number, number, number, number],
  ) {
    const base = this.vertexCount;
    const wn = this.tn(n[0], n[1], n[2]);
    for (let i = 0; i < 4; i++) {
      const w = this.tx(p[i][0], p[i][1], p[i][2]);
      this.pos.push(w[0], w[1], w[2]);
      this.nor.push(wn[0], wn[1], wn[2]);
      this.col.push(color[0], color[1], color[2]);
      this.fac.push(uv[i][0], uv[i][1] + this.oy);
      this.sty.push(style[0], style[1], style[2], style[3]);
      this.ext.push(extra[0], extra[1] + this.oy, extra[2], extra[3] + this.oy);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Axis-aligned (in the local frame) box centred at (cx, cz) from y0 to y1. */
  box(cx: number, cz: number, w: number, d: number, y0: number, y1: number, o: FaceOpts) {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    const style = o.style ?? STYLE.plain;
    const fh = o.floorH ?? 3.2;
    const bw = o.bayW ?? 3.0;
    const bld = o.bld ?? 0;
    const seed = (o.seed ?? 0) + this.faceCounter++ * 7.31;
    const ex = (k: number): [number, number, number, number] => [bld, y0, seed + k * 13.7, y1];
    const skip = o.skip ?? {};
    // +z face (front): left corner seen from outside is x0
    if (!skip.pz)
      this.quad(
        [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
        [0, 0, 1],
        [[0, y0], [w, y0], [w, y1], [0, y1]],
        o.color,
        [style, fh, bw, w],
        ex(1),
      );
    // −z face (back): left corner seen from outside is x1
    if (!skip.nz)
      this.quad(
        [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
        [0, 0, -1],
        [[0, y0], [w, y0], [w, y1], [0, y1]],
        o.color,
        [style, fh, bw, w],
        ex(2),
      );
    // +x face: left corner seen from outside is z1
    if (!skip.px)
      this.quad(
        [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
        [1, 0, 0],
        [[0, y0], [d, y0], [d, y1], [0, y1]],
        o.color,
        [style, fh, bw, d],
        ex(3),
      );
    // −x face
    if (!skip.nx)
      this.quad(
        [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
        [-1, 0, 0],
        [[0, y0], [d, y0], [d, y1], [0, y1]],
        o.color,
        [style, fh, bw, d],
        ex(4),
      );
    if (o.top !== false) {
      const rs = o.roofStyle ?? STYLE.roof;
      this.quad(
        [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
        [0, 1, 0],
        [[x0, z1], [x1, z1], [x1, z0], [x0, z0]],
        o.roofColor ?? o.color,
        [rs, fh, bw, w],
        [bld, y1, seed + 99, y1],
      );
    }
    if (o.bottom) {
      this.quad(
        [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
        [0, -1, 0],
        [[0, 0], [w, 0], [w, d], [0, d]],
        o.color,
        [STYLE.plain, fh, bw, w],
        [bld, y0, seed, y0],
      );
    }
    return this;
  }

  /** Parapet ring (4 thin walls) around a rectangle at roof height. */
  parapet(cx: number, cz: number, w: number, d: number, y: number, h: number, t: number, o: FaceOpts) {
    const oo = { ...o, style: STYLE.plain, roofStyle: STYLE.plain };
    this.box(cx, cz + d / 2 - t / 2, w, t, y, y + h, oo);
    this.box(cx, cz - d / 2 + t / 2, w, t, y, y + h, oo);
    this.box(cx + w / 2 - t / 2, cz, t, d - 2 * t, y, y + h, oo);
    this.box(cx - w / 2 + t / 2, cz, t, d - 2 * t, y, y + h, oo);
    return this;
  }

  /** Regular prism (n sides) — cylinders, tanks, chamfered towers. Facade u wraps around. */
  prism(cx: number, cz: number, r: number, y0: number, y1: number, n: number, o: FaceOpts & { phase?: number; r1?: number }) {
    const style = o.style ?? STYLE.plain;
    const fh = o.floorH ?? 3.2;
    const bw = o.bayW ?? 3.0;
    const bld = o.bld ?? 0;
    const seed = (o.seed ?? 0) + this.faceCounter++ * 5.17;
    const ph = o.phase ?? 0;
    const rTop = o.r1 ?? r;
    const side = 2 * r * Math.sin(Math.PI / n);
    const smooth = n > 10;
    for (let i = 0; i < n; i++) {
      const a0 = ph + (i / n) * Math.PI * 2;
      const a1 = ph + ((i + 1) / n) * Math.PI * 2;
      const p0: [number, number, number] = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r];
      const p1: [number, number, number] = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
      const p2: [number, number, number] = [cx + Math.cos(a1) * rTop, y1, cz + Math.sin(a1) * rTop];
      const p3: [number, number, number] = [cx + Math.cos(a0) * rTop, y1, cz + Math.sin(a0) * rTop];
      const am = (a0 + a1) / 2;
      const slope = (r - rTop) / Math.max(0.01, y1 - y0);
      const nl = Math.hypot(1, slope);
      const n0: [number, number, number] = [Math.cos(am) / nl, slope / nl, Math.sin(am) / nl];
      // winding: seen from outside p1 is bottom-left, p0 bottom-right → quad(p1, p0, p3, p2)
      const base = this.vertexCount;
      const corners = [p1, p0, p3, p2];
      const angs = [a1, a0, a0, a1];
      // facade u increases to the right (towards p0). Smooth prisms wrap continuously.
      const uL = smooth ? (n - i - 1) * side : 0;
      const us = [uL, uL + side, uL + side, uL];
      const ys = [y0, y0, y1, y1];
      for (let k = 0; k < 4; k++) {
        const w = this.tx(corners[k][0], corners[k][1], corners[k][2]);
        this.pos.push(w[0], w[1], w[2]);
        const nn = smooth ? this.tn(Math.cos(angs[k]) / nl, slope / nl, Math.sin(angs[k]) / nl) : this.tn(n0[0], n0[1], n0[2]);
        this.nor.push(nn[0], nn[1], nn[2]);
        this.col.push(o.color[0], o.color[1], o.color[2]);
        this.fac.push(us[k], ys[k] + this.oy);
        this.sty.push(style, fh, bw, smooth ? n * side : side);
        this.ext.push(bld, y0 + this.oy, smooth ? seed : seed + i * 3.1, y1 + this.oy);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    if (o.top !== false) {
      const base = this.vertexCount;
      const nn = this.tn(0, 1, 0);
      const cw = this.tx(cx, y1, cz);
      this.pos.push(cw[0], cw[1], cw[2]);
      this.nor.push(nn[0], nn[1], nn[2]);
      const rc = o.roofColor ?? o.color;
      this.col.push(rc[0], rc[1], rc[2]);
      this.fac.push(cx, cz);
      const rs = o.roofStyle ?? STYLE.roof;
      this.sty.push(rs, fh, bw, 2 * rTop);
      this.ext.push(bld, y1 + this.oy, seed + 99, y1 + this.oy);
      for (let i = 0; i <= n; i++) {
        const a = ph + (i / n) * Math.PI * 2;
        const w = this.tx(cx + Math.cos(a) * rTop, y1, cz + Math.sin(a) * rTop);
        this.pos.push(w[0], w[1], w[2]);
        this.nor.push(nn[0], nn[1], nn[2]);
        this.col.push(rc[0], rc[1], rc[2]);
        this.fac.push(cx + Math.cos(a) * rTop, cz + Math.sin(a) * rTop);
        this.sty.push(rs, fh, bw, 2 * rTop);
        this.ext.push(bld, y1 + this.oy, seed + 99, y1 + this.oy);
      }
      for (let i = 0; i < n; i++) this.idx.push(base, base + 2 + i, base + 1 + i);
    }
    return this;
  }

  /** Thin box between two local points (struts, beams, rails). */
  beam(a: [number, number, number], b: [number, number, number], t: number, o: FaceOpts) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return this;
    // build an orthonormal frame
    const ax = [dx / len, dy / len, dz / len];
    const up = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let ux = ax[1] * up[2] - ax[2] * up[1];
    let uy = ax[2] * up[0] - ax[0] * up[2];
    let uz = ax[0] * up[1] - ax[1] * up[0];
    const ul = Math.hypot(ux, uy, uz);
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = ay(ax, [ux, uy, uz]);
    const h = t / 2;
    const corners = (p: number[]) => [
      [p[0] + (ux + vx[0]) * h, p[1] + (uy + vx[1]) * h, p[2] + (uz + vx[2]) * h],
      [p[0] + (-ux + vx[0]) * h, p[1] + (-uy + vx[1]) * h, p[2] + (-uz + vx[2]) * h],
      [p[0] + (-ux - vx[0]) * h, p[1] + (-uy - vx[1]) * h, p[2] + (-uz - vx[2]) * h],
      [p[0] + (ux - vx[0]) * h, p[1] + (uy - vx[1]) * h, p[2] + (uz - vx[2]) * h],
    ];
    const A = corners(a);
    const B = corners(b);
    const style: [number, number, number, number] = [STYLE.plain, 3, 3, len];
    const ex: [number, number, number, number] = [o.bld ?? 0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const k1 = (k + 1) % 4;
      const nx = (A[k][0] + A[k1][0]) / 2 - a[0];
      const ny = (A[k][1] + A[k1][1]) / 2 - a[1];
      const nz = (A[k][2] + A[k1][2]) / 2 - a[2];
      const nl = Math.hypot(nx, ny, nz) || 1;
      this.quad(
        [A[k] as [number, number, number], A[k1] as [number, number, number], B[k1] as [number, number, number], B[k] as [number, number, number]],
        [nx / nl, ny / nl, nz / nl],
        [[0, 0], [t, 0], [t, len], [0, len]],
        o.color,
        style,
        ex,
      );
    }
    return this;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aFacade', new BufferAttribute(new Float32Array(this.fac), 2));
    g.setAttribute('aStyle', new BufferAttribute(new Float32Array(this.sty), 4));
    g.setAttribute('aExtra', new BufferAttribute(new Float32Array(this.ext), 4));
    const n = this.vertexCount;
    g.setIndex(n > 65535 ? new BufferAttribute(new Uint32Array(this.idx), 1) : new BufferAttribute(new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function ay(a: number[], u: number[]): [number, number, number] {
  // v = a × u
  return [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]];
}

/** Deterministic PRNG. */
export function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** sRGB hex → linear rgb triple (for vertex colours, which three treats as linear). */
export function lin(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  const f = (c: number) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return [f((v >> 16) & 255), f((v >> 8) & 255), f(v & 255)];
}

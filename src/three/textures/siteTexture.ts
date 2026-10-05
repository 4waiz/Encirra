import * as THREE from 'three';
import { SITE } from '../../data/site';
import { SeededRandom } from '../../utils/random';

/** World rectangle covered by the generated site texture (x east, z south). */
export const SITE_TEX_RECT = { minX: -640, maxX: 640, minZ: -330, maxZ: 330 };

const C = {
  paving: '#cbc4b5',
  pavingLight: '#d6d0c3',
  pad: '#d2ccbf',
  promenade: '#dcd6ca',
  asphalt: '#3f4349',
  asphaltLot: '#474b51',
  edgeLine: 'rgba(214,208,196,0.55)',
  centerLine: 'rgba(236,230,214,0.62)',
  grass: '#789a50',
  grassStripe: '#81a359',
  grassEdge: '#5e7d3e',
  curb: '#d9d3c7',
  gravel: '#a7a297',
  laydown: '#bdb6a7',
  yard: '#c4bdaf',
  hatch: 'rgba(214,178,74,0.75)',
  bund: '#a59f92',
};

/**
 * Paints the campus ground (paving, pads, lawns, roads, parking, gravel) onto a canvas.
 * Everything comes from the shared site layout, so roads line up with vehicle routing.
 */
export function createSiteTexture(quality: 'high' | 'balanced', maxAnisotropy = 8) {
  const W = quality === 'high' ? 4096 : 2048;
  const H = W / 2;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const R = SITE_TEX_RECT;
  const sx = W / (R.maxX - R.minX);
  const sz = H / (R.maxZ - R.minZ);
  ctx.setTransform(sx, 0, 0, sz, -R.minX * sx, -R.minZ * sz);
  const px = 1 / sx; // one pixel in metres
  const rng = new SeededRandom('site-texture');

  const rect = (x0: number, z0: number, x1: number, z1: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
  };
  const outline = (x0: number, z0: number, x1: number, z1: number, stroke: string, w = px * 1.2) => {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = w;
    ctx.strokeRect(x0, z0, x1 - x0, z1 - z0);
  };

  // ---- platform paving with soft large-scale variation
  const P = SITE.platform;
  rect(P.minX, P.minZ, P.maxX, P.maxZ, C.paving);
  for (let i = 0; i < 420; i++) {
    const x = rng.range(P.minX, P.maxX);
    const z = rng.range(P.minZ, P.maxZ);
    const r = rng.range(8, 46);
    const g = ctx.createRadialGradient(x, z, 0, x, z, r);
    const light = rng.float() < 0.5;
    g.addColorStop(0, light ? 'rgba(232,226,214,0.10)' : 'rgba(150,142,128,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, z - r, r * 2, r * 2);
  }
  // coastal promenade along the seawall
  rect(P.minX, P.minZ, P.maxX, P.minZ + 11, C.promenade);
  ctx.strokeStyle = 'rgba(120,114,104,0.5)';
  ctx.lineWidth = px * 1.5;
  ctx.beginPath();
  ctx.moveTo(P.minX, P.minZ + 11);
  ctx.lineTo(P.maxX, P.minZ + 11);
  ctx.stroke();

  // ---- unit pads and building pads
  for (const u of SITE.units) {
    const p = SITE.unitPads;
    rect(u.x + p.minDX, u.z + p.minDZ, u.x + p.maxDX, u.z + p.maxDZ, C.pavingLight);
    outline(u.x + p.minDX, u.z + p.minDZ, u.x + p.maxDX, u.z + p.maxDZ, 'rgba(110,104,94,0.35)');
  }
  for (const b of SITE.buildings) {
    const m = 3.5;
    rect(b.x - b.w / 2 - m, b.z - b.d / 2 - m, b.x + b.w / 2 + m, b.z + b.d / 2 + m, C.pad);
    outline(b.x - b.w / 2 - m, b.z - b.d / 2 - m, b.x + b.w / 2 + m, b.z + b.d / 2 + m, 'rgba(110,104,94,0.28)');
  }
  // pump-house aprons on the seawall
  for (const it of SITE.intakes) rect(it.x - 34, P.minZ, it.x + 34, P.minZ + 14, C.pavingLight);

  // ---- tank farm bund
  rect(-374, 36, -276, 104, C.pad);
  outline(-374, 36, -276, 104, C.bund, 1.1);
  for (const t of SITE.tanks.filter((t) => t.id.startsWith('FW') || t.id.startsWith('DT'))) {
    rect(t.x - t.r - 4, t.z - t.r - 4, t.x + t.r + 4, t.z + t.r + 4, C.pad);
    outline(t.x - t.r - 4, t.z - t.r - 4, t.x + t.r + 4, t.z + t.r + 4, C.bund, 0.9);
  }

  // ---- switchyard gravel with speckle and fence line
  const sy = SITE.switchyard;
  rect(sy.minX, sy.minZ, sy.maxX, sy.maxZ, C.gravel);
  for (let i = 0; i < 9000; i++) {
    const x = rng.range(sy.minX, sy.maxX);
    const z = rng.range(sy.minZ, sy.maxZ);
    ctx.fillStyle = rng.float() < 0.5 ? 'rgba(80,76,70,0.22)' : 'rgba(235,230,220,0.18)';
    ctx.fillRect(x, z, px * 1.5, px * 1.5);
  }
  outline(sy.minX - 2, sy.minZ - 2, sy.maxX + 2, sy.maxZ + 2, 'rgba(90,88,82,0.75)', 0.6);

  // ---- laydown + service yard
  const ld = SITE.laydown;
  rect(ld.minX, ld.minZ, ld.maxX, ld.maxZ, C.laydown);
  ctx.strokeStyle = 'rgba(110,104,94,0.25)';
  ctx.lineWidth = px;
  for (let x = ld.minX; x <= ld.maxX; x += 6.7) {
    ctx.beginPath();
    ctx.moveTo(x, ld.minZ);
    ctx.lineTo(x, ld.maxZ);
    ctx.stroke();
  }
  const yd = SITE.serviceYard;
  rect(yd.minX, yd.minZ, yd.maxX, yd.maxZ, C.yard);
  // hatched robotics apron
  ctx.save();
  ctx.beginPath();
  ctx.rect(410, 224, 22, 16);
  ctx.clip();
  ctx.strokeStyle = C.hatch;
  ctx.lineWidth = 0.55;
  for (let k = -20; k < 40; k += 2.2) {
    ctx.beginPath();
    ctx.moveTo(410 + k, 224);
    ctx.lineTo(410 + k + 16, 240);
    ctx.stroke();
  }
  ctx.restore();
  outline(410, 224, 432, 240, C.hatch, 0.5);

  // ---- lawns with mowing stripes
  for (const [x0, x1, z0, z1] of SITE.lawns) {
    rect(x0 - 0.8, z0 - 0.8, x1 + 0.8, z1 + 0.8, C.curb);
    rect(x0, z0, x1, z1, C.grass);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, z0, x1 - x0, z1 - z0);
    ctx.clip();
    ctx.fillStyle = C.grassStripe;
    const horizontal = x1 - x0 >= z1 - z0;
    for (let k = 0; k < 400; k += 8) {
      if (horizontal) ctx.fillRect(x0, z0 + k, x1 - x0, 4);
      else ctx.fillRect(x0 + k, z0, 4, z1 - z0);
    }
    // subtle irrigation patches
    for (let i = 0; i < 6; i++) {
      const x = rng.range(x0, x1);
      const z = rng.range(z0, z1);
      const r = rng.range(4, 12);
      const g = ctx.createRadialGradient(x, z, 0, x, z, r);
      g.addColorStop(0, 'rgba(70,100,40,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, z - r, 2 * r, 2 * r);
    }
    ctx.restore();
    outline(x0, z0, x1, z1, C.grassEdge, 0.5);
  }

  // ---- parking lots
  for (const lot of SITE.parking) {
    const zMin = Math.min(...lot.rows) - 6;
    const zMax = Math.max(...lot.rows) + 6;
    rect(lot.minX - 2, zMin, lot.maxX + 2, zMax, C.asphaltLot);
    ctx.strokeStyle = 'rgba(232,228,218,0.7)';
    ctx.lineWidth = Math.max(px, 0.14);
    const n = Math.floor((lot.maxX - lot.minX) / lot.stall);
    for (const rz of lot.rows) {
      for (let k = 0; k <= n; k++) {
        const x = lot.minX + k * lot.stall;
        ctx.beginPath();
        ctx.moveTo(x, rz - 2.6);
        ctx.lineTo(x, rz + 2.6);
        ctx.stroke();
      }
    }
  }

  // ---- roads (asphalt, edge lines, dashed centre lines)
  ctx.lineCap = 'square';
  for (const r of SITE.roads) {
    const [[x0, z0], [x1, z1]] = r.points;
    ctx.strokeStyle = C.curb;
    ctx.lineWidth = r.width + 2.4;
    ctx.beginPath();
    ctx.moveTo(x0, z0);
    ctx.lineTo(x1, z1);
    ctx.stroke();
  }
  for (const r of SITE.roads) {
    const [[x0, z0], [x1, z1]] = r.points;
    ctx.strokeStyle = C.asphalt;
    ctx.lineWidth = r.width;
    ctx.beginPath();
    ctx.moveTo(x0, z0);
    ctx.lineTo(x1, z1);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  for (const r of SITE.roads) {
    if (r.width < 8) continue;
    const [[x0, z0], [x1, z1]] = r.points;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const nx = -(z1 - z0) / len;
    const nz = (x1 - x0) / len;
    const off = r.width / 2 - 0.7;
    ctx.strokeStyle = C.edgeLine;
    ctx.lineWidth = Math.max(px, 0.16);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x0 + nx * off * s, z0 + nz * off * s);
      ctx.lineTo(x1 + nx * off * s, z1 + nz * off * s);
      ctx.stroke();
    }
    ctx.strokeStyle = C.centerLine;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.moveTo(x0, z0);
    ctx.lineTo(x1, z1);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

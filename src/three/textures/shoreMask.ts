import * as THREE from 'three';
import { SITE } from '../../data/site';

/** World rectangle covered by the shoreline mask. */
export const SHORE_RECT = { minX: -2400, maxX: 2400, minZ: -1500, maxZ: 900 };

/**
 * Land/breakwater mask blurred at two radii:
 *  R = narrow falloff (surf + wet sand line), G = wide falloff (shallow-water tint), B = hard land mask.
 */
export function createShoreMask() {
  const W = 1024;
  const H = 512;
  const R = SHORE_RECT;
  const sx = W / (R.maxX - R.minX);
  const sz = H / (R.maxZ - R.minZ);

  const paint = (blurPx: number) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;
    ctx.setTransform(sx, 0, 0, sz, -R.minX * sx, -R.minZ * sz);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    SITE.coastline.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
    ctx.closePath();
    ctx.fill();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 30;
    for (const bw of SITE.breakwaters) {
      ctx.beginPath();
      bw.points.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
      ctx.stroke();
    }
    for (const it of SITE.intakes) ctx.fillRect(it.x - 26, SITE.seawall.z - 46, 52, 46);
    return ctx.getImageData(0, 0, W, H).data;
  };

  const narrow = paint(5);
  const wide = paint(30);
  const hard = paint(0);
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = narrow[i * 4];
    data[i * 4 + 1] = wide[i * 4];
    data[i * 4 + 2] = hard[i * 4];
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  // canvas rows go top→bottom in +z; DataTexture row 0 is v = 0 → keep (no flip) and map v = (z - minZ)/size
  tex.flipY = false;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

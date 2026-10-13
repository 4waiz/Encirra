/**
 * Canvas-generated textures (no downloaded imagery): soil strata for the cutaway faces,
 * gallery concrete, palm fronds, glow sprites and small icons.
 */
import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import { mulberry32 } from '../lib/GeoBuilder';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

/** Strata texture: v = 0 at y = −42 m (bottom) … 1 at y = 0 (top); u repeats every 12 m. */
export const STRATA_U_METRES = 12;
export function createStrataTexture() {
  const W = 288;
  const H = 1008; // 24 px per metre
  const [c, g] = canvas(W, H);
  const rnd = mulberry32(42);
  const pxm = H / 42;
  const yToPx = (y: number) => (-y) * pxm; // y ≤ 0 → px from the top
  const layers: { y0: number; y1: number; col: [number, number, number]; speck: number; pebbles: number }[] = [
    { y0: 0, y1: -0.7, col: [190, 184, 172], speck: 0.15, pebbles: 0 },
    { y0: -0.7, y1: -2.3, col: [128, 118, 104], speck: 0.5, pebbles: 40 },
    { y0: -2.3, y1: -6.5, col: [150, 110, 72], speck: 0.35, pebbles: 25 },
    { y0: -6.5, y1: -9.2, col: [122, 86, 56], speck: 0.35, pebbles: 30 },
    { y0: -9.2, y1: -15, col: [112, 78, 50], speck: 0.3, pebbles: 40 },
    { y0: -15, y1: -21, col: [96, 66, 44], speck: 0.3, pebbles: 50 },
    { y0: -21, y1: -28, col: [104, 74, 50], speck: 0.3, pebbles: 40 },
    { y0: -28, y1: -34, col: [84, 58, 40], speck: 0.35, pebbles: 70 },
    { y0: -34, y1: -42, col: [70, 62, 54], speck: 0.45, pebbles: 120 },
  ];
  for (const L of layers) {
    const top = yToPx(L.y0);
    const bot = yToPx(L.y1);
    // wavy boundary
    g.fillStyle = `rgb(${L.col.join(',')})`;
    g.beginPath();
    g.moveTo(0, top);
    for (let x = 0; x <= W; x += 8) g.lineTo(x, top + (L.y0 === 0 ? 0 : Math.sin((x / W) * Math.PI * 4 + L.y0) * 3));
    g.lineTo(W, bot + 4);
    g.lineTo(0, bot + 4);
    g.closePath();
    g.fill();
    // vertical gradient for depth
    const grad = g.createLinearGradient(0, top, 0, bot);
    grad.addColorStop(0, 'rgba(255,255,255,0.06)');
    grad.addColorStop(1, 'rgba(0,0,0,0.18)');
    g.fillStyle = grad;
    g.fillRect(0, top, W, bot - top);
    // speckles
    const n = Math.floor((bot - top) * W * 0.02 * L.speck);
    for (let i = 0; i < n; i++) {
      const x = rnd() * W;
      const y = top + rnd() * (bot - top);
      const k = rnd() < 0.5 ? 0 : 255;
      g.fillStyle = `rgba(${k},${k},${k},${0.05 + rnd() * 0.08})`;
      g.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    // pebbles / rocks
    for (let i = 0; i < L.pebbles; i++) {
      const x = rnd() * W;
      const y = top + 4 + rnd() * (bot - top - 8);
      const r = 2 + rnd() * (L.y1 < -33 ? 12 : 5);
      const shade = 0.7 + rnd() * 0.5;
      g.fillStyle = `rgb(${Math.round(L.col[0] * shade + 20)},${Math.round(L.col[1] * shade + 18)},${Math.round(L.col[2] * shade + 16)})`;
      g.beginPath();
      g.ellipse(x, y, r, r * (0.55 + rnd() * 0.3), rnd() * Math.PI, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 1;
      g.stroke();
    }
  }
  // rock cracks in the bedrock
  g.strokeStyle = 'rgba(20,16,12,0.35)';
  for (let i = 0; i < 14; i++) {
    let x = rnd() * W;
    let y = yToPx(-34) + rnd() * pxm * 7;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rnd() - 0.5) * 30;
      y += rnd() * 18;
      g.lineTo(x, y);
    }
    g.lineWidth = 1 + rnd();
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  t.minFilter = LinearMipmapLinearFilter;
  return t;
}

/** Utility-gallery concrete lining: panel joints every 6 m, grime toward the floor. */
export function createGalleryTexture() {
  const [c, g] = canvas(512, 512); // 24 m × 24 m
  const rnd = mulberry32(7);
  g.fillStyle = '#8b8984';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4000; i++) {
    const k = rnd() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${k},${k},${k},${0.03 + rnd() * 0.05})`;
    g.fillRect(rnd() * 512, rnd() * 512, 2 + rnd() * 4, 2 + rnd() * 4);
  }
  g.strokeStyle = 'rgba(40,40,40,0.55)';
  g.lineWidth = 2;
  for (let x = 0; x <= 512; x += 128) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 512);
    g.stroke();
  }
  for (let y = 0; y <= 512; y += 170) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Soft radial glow sprite (white, alpha falloff). */
export function createGlowTexture(size = 128) {
  const [c, g] = canvas(size, size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.15, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  return t;
}

/** Palm frond texture (alpha): central rib with feathered leaflets. */
export function createFrondTexture() {
  const W = 128;
  const H = 512;
  const [c, g] = canvas(W, H);
  g.clearRect(0, 0, W, H);
  const rnd = mulberry32(11);
  // leaflets
  for (let i = 0; i < 70; i++) {
    const t = i / 70;
    const y = 10 + t * (H - 20);
    const len = (W / 2 - 4) * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05)) * (0.85 + rnd() * 0.15);
    for (const side of [-1, 1]) {
      const shade = 70 + rnd() * 50;
      g.strokeStyle = `rgb(${Math.round(shade * 0.55)},${Math.round(shade * 1.05)},${Math.round(shade * 0.35)})`;
      g.lineWidth = 3 + rnd() * 1.5;
      g.beginPath();
      g.moveTo(W / 2, y);
      g.quadraticCurveTo(W / 2 + side * len * 0.6, y + 6, W / 2 + side * len, y + 18 + rnd() * 8);
      g.stroke();
    }
  }
  g.strokeStyle = 'rgb(96,104,48)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(W / 2, 0);
  g.lineTo(W / 2, H);
  g.stroke();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Text label texture (signage). */
export function createTextTexture(text: string, opts: { font?: string; color?: string; bg?: string; w?: number; h?: number } = {}) {
  const w = opts.w ?? 512;
  const h = opts.h ?? 128;
  const [c, g] = canvas(w, h);
  if (opts.bg) {
    g.fillStyle = opts.bg;
    g.fillRect(0, 0, w, h);
  } else g.clearRect(0, 0, w, h);
  g.fillStyle = opts.color ?? '#ffffff';
  g.font = opts.font ?? `700 ${Math.round(h * 0.62)}px Inter, Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + h * 0.03);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

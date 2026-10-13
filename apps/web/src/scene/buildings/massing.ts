/**
 * Procedural architectural massing for every layout building.
 * One merged geometry (single draw call) — facade detail comes from the window shader.
 * Each vertex carries its building index so picking, hover and power state map back to the layout.
 */
import type { BufferGeometry } from 'three';
import { BUILDINGS, type BuildingDef } from '../data/twin';
import { GeoBuilder, STYLE, lin, mulberry32 } from '../lib/GeoBuilder';

const PALETTE = {
  white: lin('#F1EFEA'),
  ivory: lin('#ECE5D8'),
  sand: lin('#E0D2B6'),
  sandDark: lin('#CDB894'),
  stone: lin('#D8D0C2'),
  cream: lin('#F4EFE4'),
  greyFrame: lin('#59636C'),
  darkFrame: lin('#2E3740'),
  roof: lin('#A9A39A'),
  roofDark: lin('#7F7B75'),
  mech: lin('#8E9399'),
  hospital: lin('#F4F2EE'),
  industrial: lin('#B9C0C4'),
  eoc: lin('#3B4A57'),
};

const RES_COLS = [PALETTE.white, PALETTE.ivory, PALETTE.sand, PALETTE.cream, PALETTE.stone, PALETTE.sandDark];

function pick<T>(r: () => number, arr: T[]): T {
  return arr[Math.floor(r() * arr.length) % arr.length];
}

function rooftop(g: GeoBuilder, r: () => number, w: number, d: number, h: number, bld: number, n = 2) {
  for (let i = 0; i < n; i++) {
    const uw = 2 + r() * Math.min(5, w * 0.25);
    const ud = 2 + r() * Math.min(5, d * 0.25);
    const ux = (r() - 0.5) * (w - uw - 3);
    const uz = (r() - 0.5) * (d - ud - 3);
    g.box(ux, uz, uw, ud, h, h + 1.2 + r() * 1.8, { color: PALETTE.mech, style: STYLE.plain, roofStyle: STYLE.plain, bld });
  }
}

function solarArray(g: GeoBuilder, w: number, d: number, h: number, bld: number) {
  const aw = w * 0.72;
  const ad = d * 0.62;
  if (aw < 5 || ad < 5) return;
  const rows = Math.max(1, Math.floor(ad / 3.2));
  for (let i = 0; i < rows; i++) {
    const z = -ad / 2 + (i + 0.5) * (ad / rows);
    g.box(0, z, aw, 2.4, h + 0.5, h + 1.0, { color: PALETTE.mech, style: STYLE.plain, roofStyle: STYLE.solar, bld });
  }
}

function tower(g: GeoBuilder, b: BuildingDef, r: () => number) {
  const [w, d] = b.size;
  const h = b.height;
  const bld = b.index;
  const office = b.kind === 'tower-office';
  const podH = office ? 6 : 7;
  const podCol = office ? PALETTE.stone : pick(r, [PALETTE.sand, PALETTE.ivory]);
  g.box(0, 0, w, d, 0, podH, { color: podCol, style: STYLE.storefront, floorH: podH, bayW: 4.2, bld, roofColor: PALETTE.roof });
  const v = b.variant % 4;
  if (office) {
    const glassFrame = pick(r, [PALETTE.greyFrame, PALETTE.darkFrame, lin('#4E6470')]);
    const opts = { color: glassFrame, style: STYLE.curtain, floorH: 4.0, bayW: 1.6, bld, roofColor: PALETTE.roofDark };
    if (v === 0) {
      g.box(0, 0, w - 2, d - 2, podH, h - 3, opts);
      g.box(0, 0, w - 3.2, d - 3.2, h - 3, h, { ...opts, style: STYLE.glassBlock, bayW: 2.4 });
    } else if (v === 1) {
      const hs = podH + (h - podH) * 0.62;
      g.box(0, 0, w - 2, d - 2, podH, hs, opts);
      g.box(-0.8, -0.8, w - 5.5, d - 5.5, hs, h, opts);
      g.box(-0.8, -0.8, w - 7, d - 7, h, h + 3, { ...opts, style: STYLE.plain, color: PALETTE.mech });
    } else if (v === 2) {
      g.prism(0, 0, Math.min(w, d) / 2 - 0.8, podH, h, 8, { ...opts, phase: Math.PI / 8 });
      g.prism(0, 0, Math.min(w, d) / 2 - 2.5, h, h + 4, 8, { ...opts, style: STYLE.plain, color: PALETTE.mech, phase: Math.PI / 8 });
    } else {
      g.box(-w * 0.18, 0, w * 0.55, d - 2, podH, h, opts);
      g.box(w * 0.26, 0, w * 0.4, d - 4, podH, h * 0.82, opts);
    }
    rooftop(g, r, w - 6, d - 6, v === 3 ? h * 0.82 : h, bld, 1);
  } else {
    const col = pick(r, [PALETTE.white, PALETTE.ivory, PALETTE.cream, PALETTE.sand]);
    const opts = { color: col, style: STYLE.balcony, floorH: 3.2, bayW: 3.4, bld, roofColor: PALETTE.roof };
    if (v === 0 || v === 2) {
      g.box(0, 0, w - 3, d - 3, podH, h - 3.2, opts);
      g.box(0, 0, w - 5, d - 5, h - 3.2, h, { ...opts, style: STYLE.punched });
      // balcony slabs on the long faces
      const n = Math.floor((h - podH - 3.2) / 3.2);
      for (let i = 1; i < n; i += v === 0 ? 1 : 2) {
        const y = podH + i * 3.2;
        g.box(0, (d - 3) / 2 + 0.45, w - 4, 0.9, y - 0.18, y, { color: PALETTE.white, style: STYLE.plain, roofStyle: STYLE.plain, bld, skip: { nz: true } });
        g.box(0, -(d - 3) / 2 - 0.45, w - 4, 0.9, y - 0.18, y, { color: PALETTE.white, style: STYLE.plain, roofStyle: STYLE.plain, bld, skip: { pz: true } });
      }
    } else if (v === 1) {
      const hs = podH + (h - podH) * 0.7;
      g.box(0, 0, w - 3, d - 3, podH, hs, opts);
      g.box(1, 1, w - 7, d - 7, hs, h, opts);
      g.parapet(1, 1, w - 7, d - 7, h, 1.0, 0.35, { color: col, bld });
    } else {
      g.box(-w * 0.15, 0, w * 0.62, d - 3, podH, h, opts);
      g.box(w * 0.28, d * 0.12, w * 0.36, d * 0.6, podH, h * 0.78, opts);
    }
    // crown frame
    g.parapet(0, 0, w - 3, d - 3, v === 1 ? podH + (h - podH) * 0.7 : h, 1.1, 0.4, { color: col, bld });
    rooftop(g, r, w - 7, d - 7, h, bld, 2);
  }
}

function midrise(g: GeoBuilder, b: BuildingDef, r: () => number) {
  const [w, d] = b.size;
  const h = b.height;
  const bld = b.index;
  const col = pick(r, RES_COLS);
  const v = b.variant % 4;
  const opts = { color: col, style: v === 3 ? STYLE.balcony : STYLE.punched, floorH: 3.2, bayW: 3.1 + r() * 0.6, bld, roofColor: PALETTE.roof };
  const groundRetail = r() < 0.45;
  const y0 = groundRetail ? 4.5 : 0;
  if (groundRetail) g.box(0, 0, w, d, 0, 4.5, { color: PALETTE.stone, style: STYLE.storefront, floorH: 4.5, bayW: 4.5, bld, roofColor: PALETTE.roof });
  if (v === 0 || v === 3) {
    g.box(0, 0, w - (groundRetail ? 1 : 0), d - (groundRetail ? 1 : 0), y0, h, opts);
    g.parapet(0, 0, w - (groundRetail ? 1 : 0), d - (groundRetail ? 1 : 0), h, 0.9, 0.3, { color: col, bld });
  } else if (v === 1) {
    g.box(0, 0, w, d, y0, h - 3.2, opts);
    g.box(-w * 0.12, -d * 0.1, w * 0.62, d * 0.6, h - 3.2, h + 0.4, { ...opts, style: STYLE.glassBlock, bayW: 2.6, color: PALETTE.greyFrame });
    g.parapet(0, 0, w, d, h - 3.2, 1.0, 0.3, { color: col, bld });
  } else {
    // two wings (L)
    g.box(-w * 0.2, 0, w * 0.6, d, y0, h, opts);
    g.box(w * 0.3, -d * 0.2, w * 0.4, d * 0.6, y0, h - 3.2 * Math.floor(1 + r() * 2), opts);
    g.parapet(-w * 0.2, 0, w * 0.6, d, h, 0.9, 0.3, { color: col, bld });
  }
  if (b.roofSolar) solarArray(g, w, d, v === 1 ? h - 3.2 : h, bld);
  else rooftop(g, r, w, d, h, bld, 2);
}

function lowrise(g: GeoBuilder, b: BuildingDef, r: () => number) {
  const [w, d] = b.size;
  const h = b.height;
  const bld = b.index;
  const col = pick(r, [PALETTE.sand, PALETTE.ivory, PALETTE.cream, PALETTE.sandDark]);
  g.box(0, 0, w, d, 0, h, { color: col, style: STYLE.punched, floorH: 3.3, bayW: 3.4, bld, roofColor: PALETTE.roof });
  g.parapet(0, 0, w, d, h, 0.9, 0.3, { color: col, bld });
  if (b.roofSolar) solarArray(g, w, d, h, bld);
  else rooftop(g, r, w, d, h, bld, 1);
}

function villa(g: GeoBuilder, b: BuildingDef, r: () => number) {
  const [w, d] = b.size;
  const h = b.height;
  const bld = b.index;
  const col = pick(r, [PALETTE.cream, PALETTE.ivory, PALETTE.sand]);
  g.box(0, 0, w, d, 0, h * 0.5, { color: col, style: STYLE.villa, floorH: h * 0.5, bayW: 3.8, bld, roofColor: PALETTE.roof });
  g.box(-w * 0.12, -d * 0.1, w * 0.7, d * 0.72, h * 0.5, h, { color: col, style: STYLE.villa, floorH: h * 0.5, bayW: 3.6, bld, roofColor: PALETTE.roof });
  g.parapet(-w * 0.12, -d * 0.1, w * 0.7, d * 0.72, h, 0.8, 0.25, { color: col, bld });
}

function podium(g: GeoBuilder, b: BuildingDef, r: () => number) {
  const [w, d] = b.size;
  const h = b.height;
  const bld = b.index;
  const col = pick(r, [PALETTE.stone, PALETTE.ivory, PALETTE.white]);
  g.box(0, 0, w, d, 0, 5, { color: col, style: STYLE.storefront, floorH: 5, bayW: 5, bld, roofColor: PALETTE.roof });
  g.box(0, 0, w - 1.5, d - 1.5, 5, h, { color: col, style: STYLE.ribbon, floorH: 3.8, bayW: 6, bld, roofColor: PALETTE.roof });
  g.parapet(0, 0, w - 1.5, d - 1.5, h, 1.0, 0.35, { color: col, bld });
  if (b.roofSolar) solarArray(g, w - 2, d - 2, h, bld);
  else rooftop(g, r, w - 2, d - 2, h, bld, 3);
}

// ───────────────────────────────────────────── facility main volumes
function facility(g: GeoBuilder, b: BuildingDef) {
  const [w, d] = b.size;
  const h = b.height;
  const bld = b.index;
  switch (b.kind) {
    case 'hospital': {
      const c = PALETTE.hospital;
      // main slab facing the camera (south / +z) and two rear wings
      g.box(0, 6, w, 16, 0, h, { color: c, style: STYLE.ribbon, floorH: 3.8, bayW: 4.0, bld, roofColor: PALETTE.roof });
      g.box(-w / 2 + 9, -8, 18, d - 16, 0, h - 11.4, { color: c, style: STYLE.ribbon, floorH: 3.8, bayW: 4.0, bld, roofColor: PALETTE.roof });
      g.box(w / 2 - 9, -8, 18, d - 16, 0, h - 15.2, { color: c, style: STYLE.ribbon, floorH: 3.8, bayW: 4.0, bld, roofColor: PALETTE.roof });
      // lobby / emergency entrance
      g.box(0, d / 2 + 2, 22, 6, 0, 5.5, { color: lin('#DDE6EA'), style: STYLE.glassBlock, floorH: 5.5, bayW: 2.2, bld, roofColor: PALETTE.white });
      g.parapet(0, 6, w, 16, h, 1.2, 0.4, { color: c, bld });
      // rooftop plant + helipad deck
      g.box(-14, 6, 10, 8, h, h + 3, { color: PALETTE.mech, style: STYLE.plain, roofStyle: STYLE.plain, bld });
      g.box(12, 6, 15, 12, h, h + 0.8, { color: lin('#6F7880'), style: STYLE.plain, roofStyle: STYLE.plain, bld });
      break;
    }
    case 'emergency-ops': {
      g.box(0, 0, w, d, 0, 14, { color: PALETTE.eoc, style: STYLE.curtain, floorH: 3.5, bayW: 1.8, bld, roofColor: PALETTE.roof });
      g.box(-4, -3, w - 14, d - 10, 14, h, { color: PALETTE.eoc, style: STYLE.curtain, floorH: 4, bayW: 1.8, bld, roofColor: PALETTE.roofDark });
      g.parapet(0, 0, w, d, 14, 1.0, 0.35, { color: PALETTE.white, bld });
      break;
    }
    case 'pump-station': {
      const c = PALETTE.industrial;
      g.box(0, 0, w, d, 0, h - 3, { color: c, style: STYLE.louvre, floorH: h - 3, bayW: 3.2, bld, roofColor: PALETTE.roof });
      g.box(-w * 0.22, 0, w * 0.4, d * 0.7, h - 3, h, { color: c, style: STYLE.louvre, floorH: 3, bayW: 2.4, bld, roofColor: PALETTE.roofDark });
      g.box(w * 0.25, d * 0.15, 3, 3, h - 3, h + 1.5, { color: PALETTE.mech, style: STYLE.plain, roofStyle: STYLE.plain, bld });
      break;
    }
    case 'cooling-plant': {
      const c = lin('#C9CDD0');
      g.box(0, 0, w, d, 0, 12, { color: c, style: STYLE.louvre, floorH: 4, bayW: 3, bld, roofColor: PALETTE.roof });
      for (let i = 0; i < 2; i++)
        for (let k = 0; k < 2; k++) {
          const cx = -w / 4 + (i * w) / 2;
          const cz = -d / 4 + (k * d) / 2;
          g.prism(cx, cz, 5.2, 12, h, 16, { color: lin('#B7BEC3'), style: STYLE.plain, roofStyle: STYLE.plain, roofColor: lin('#3A4148'), bld, r1: 4.6 });
        }
      break;
    }
    case 'mall': {
      g.box(0, 0, w, d, 0, 6, { color: PALETTE.stone, style: STYLE.storefront, floorH: 6, bayW: 5, bld, roofColor: PALETTE.roof });
      g.box(0, 0, w - 2, d - 2, 6, h - 6, { color: PALETTE.ivory, style: STYLE.ribbon, floorH: 6, bayW: 8, bld, roofColor: PALETTE.roof });
      g.box(-4, -2, w * 0.6, d * 0.55, h - 6, h, { color: PALETTE.greyFrame, style: STYLE.glassBlock, floorH: 6, bayW: 3, bld, roofColor: PALETTE.roofDark });
      g.parapet(0, 0, w - 2, d - 2, h - 6, 1.0, 0.4, { color: PALETTE.ivory, bld });
      break;
    }
    case 'office-complex': {
      g.box(0, 0, w, d, 0, 10, { color: PALETTE.stone, style: STYLE.storefront, floorH: 5, bayW: 4.5, bld, roofColor: PALETTE.roof });
      const gl = { color: lin('#3F5562'), style: STYLE.curtain, floorH: 4, bayW: 1.6, bld, roofColor: PALETTE.roofDark };
      g.box(-w / 2 + 11, -d / 2 + 10, 19, 18, 10, h, gl);
      g.box(w / 2 - 10, d / 2 - 10, 17, 17, 10, h - 12, gl);
      g.box(-w / 2 + 11, -d / 2 + 10, 15, 14, h, h + 3, { ...gl, style: STYLE.plain, color: PALETTE.mech });
      // sky bridge
      g.box(1, 0, 14, 4, h - 22, h - 18, { ...gl, style: STYLE.glassBlock, bayW: 2 });
      break;
    }
    case 'substation': {
      // control building (rest of the compound is equipment, see Facilities)
      g.box(-w / 2 + 11, -d / 2 + 8, 18, 11, 0, 7.5, { color: PALETTE.ivory, style: STYLE.ribbon, floorH: 3.7, bayW: 3.2, bld, roofColor: PALETTE.roof });
      break;
    }
    case 'desalination-inlet': {
      g.box(w / 2 - 8, -d / 2 + 6, 14, 10, 0, 7, { color: PALETTE.industrial, style: STYLE.louvre, floorH: 3.5, bayW: 3, bld, roofColor: PALETTE.roof });
      break;
    }
    case 'water-tower':
    default:
      break;
  }
}

export function buildDistrictBuildings(): BufferGeometry {
  const g = new GeoBuilder();
  for (const b of BUILDINGS) {
    const r = mulberry32(1000 + b.index * 97);
    g.frame(b.pos[0], 0, b.pos[1], b.rot);
    switch (b.kind) {
      case 'tower-office':
      case 'tower-residential':
        tower(g, b, r);
        break;
      case 'midrise-residential':
        midrise(g, b, r);
        break;
      case 'lowrise-residential':
        lowrise(g, b, r);
        break;
      case 'villa':
        villa(g, b, r);
        break;
      case 'commercial-podium':
        podium(g, b, r);
        break;
      default:
        facility(g, b);
    }
  }
  return g.build();
}

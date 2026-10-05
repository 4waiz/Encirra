import * as THREE from 'three';
import { SeededRandom } from '../../utils/random';

/**
 * Tileable water normal map built from a sum of integer-frequency directional waves
 * (periodic by construction, so it repeats seamlessly).
 */
export function createWaveNormalMap(size = 256, maxAnisotropy = 8) {
  const rng = new SeededRandom('waves');
  const waves = Array.from({ length: 28 }, (_, i) => {
    const f = 1 + Math.floor(rng.range(0, 1) ** 1.6 * 14);
    const a = rng.range(0, Math.PI * 2);
    return {
      kx: Math.round(Math.cos(a) * f),
      ky: Math.round(Math.sin(a) * f) || (i % 2 ? 1 : -1),
      amp: 1 / (1 + f * 0.9),
      ph: rng.range(0, Math.PI * 2),
    };
  });
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let s = 0;
      for (const w of waves) {
        const p = 2 * Math.PI * (w.kx * u + w.ky * v) + w.ph;
        // sharpened crests read more like real wind waves
        const sv = Math.sin(p);
        s += w.amp * (sv - 0.25 * Math.abs(sv));
      }
      h[y * size + x] = s;
    }
  }
  const data = new Uint8Array(size * size * 4);
  const k = 2.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const d = h[((y - 1 + size) % size) * size + x];
      const u = h[((y + 1) % size) * size + x];
      const nx = (l - r) * k;
      const ny = (d - u) * k;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      data[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

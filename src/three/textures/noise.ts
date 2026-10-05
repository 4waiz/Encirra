import * as THREE from 'three';
import { SeededRandom } from '../../utils/random';

/**
 * Tileable multi-octave value noise baked once into a texture so ground shading is a couple of
 * texture fetches instead of per-pixel fbm (important on integrated GPUs).
 * R = broad patches, G = mid detail, B = fine grain.
 */
export function createNoiseTexture(size = 256) {
  const rng = new SeededRandom('ground-noise');
  const lattice = (period: number) => {
    const g = new Float32Array(period * period);
    for (let i = 0; i < g.length; i++) g[i] = rng.float();
    return { g, period };
  };
  const sample = (l: { g: Float32Array; period: number }, x: number, y: number) => {
    const p = l.period;
    const fx = (x / size) * p;
    const fy = (y / size) * p;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const at = (a: number, b: number) => l.g[((b % p) + p) % p * p + (((a % p) + p) % p)];
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
    return a + (b - a) * sy;
  };
  const octaves = [4, 8, 16, 32, 64].map(lattice);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const broad = 0.55 * sample(octaves[0], x, y) + 0.3 * sample(octaves[1], x, y) + 0.15 * sample(octaves[2], x, y);
      const mid = 0.5 * sample(octaves[2], x, y) + 0.35 * sample(octaves[3], x, y) + 0.15 * sample(octaves[4], x, y);
      const fine = sample(octaves[4], x, y);
      const i = (y * size + x) * 4;
      data[i] = Math.round(broad * 255);
      data[i + 1] = Math.round(mid * 255);
      data[i + 2] = Math.round(fine * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

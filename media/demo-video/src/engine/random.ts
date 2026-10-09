// Seeded randomness: every "random" detail (decode glyphs, dither) is a pure function of its seed.

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless hash of a few integers to [0, 1). */
export function hash(...n: number[]) {
  let h = 2166136261;
  for (const v of n) {
    h ^= v | 0;
    h = Math.imul(h, 16777619);
  }
  return mulberry32(h)();
}

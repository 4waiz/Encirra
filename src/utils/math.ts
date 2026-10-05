export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export const DEG = Math.PI / 180;

/** Wrap an angle in degrees to [0, 360). */
export const wrapDeg = (d: number) => ((d % 360) + 360) % 360;

/** Shortest signed difference b - a in degrees, in (-180, 180]. */
export const angleDeltaDeg = (a: number, b: number) => {
  let d = wrapDeg(b) - wrapDeg(a);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
};

export const lerpAngleDeg = (a: number, b: number, t: number) => wrapDeg(a + angleDeltaDeg(a, b) * t);

/** Shortest signed difference in radians. */
export const angleDeltaRad = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/**
 * Wind blowing FROM `fromDeg` (meteorological convention, clockwise from north) moves air towards
 * the opposite bearing. In world space north is -z and east is +x.
 */
export const windVector = (fromDeg: number) => {
  const toRad = wrapDeg(fromDeg + 180) * DEG;
  return { x: Math.sin(toRad), z: -Math.cos(toRad) };
};

export const compassLabel = (deg: number) => {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(wrapDeg(deg) / 22.5) % 16];
};

export const dist2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(bx - ax, bz - az);

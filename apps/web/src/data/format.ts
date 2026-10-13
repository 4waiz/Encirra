/** Display formatting. Pure functions: no rounding tricks beyond what the label states. */

const nf = (digits: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const nf0 = nf(0);
const nf1 = nf(1);
const nf2 = nf(2);
const nf3 = nf(3);

export const DASH = '—';

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function fmtNum(v: number | null | undefined, digits = 0): string {
  if (!isNum(v)) return DASH;
  const f = digits === 0 ? nf0 : digits === 1 ? nf1 : digits === 2 ? nf2 : digits === 3 ? nf3 : nf(digits);
  // avoid "-0"
  const out = f.format(v);
  return out === '-0' || /^-0\.0+$/.test(out) ? out.slice(1) : out;
}

export const fmtInt = (v: number | null | undefined) => fmtNum(v, 0);
export const fmtKW = (v: number | null | undefined) => (isNum(v) ? `${fmtNum(v, 0)} kW` : DASH);
export const fmtKWh = (v: number | null | undefined) => (isNum(v) ? `${fmtNum(v, 0)} kWh` : DASH);
export const fmtPct = (v: number | null | undefined, digits = 0) => (isNum(v) ? `${fmtNum(v, digits)}%` : DASH);
export const fmtPu = (v: number | null | undefined) => (isNum(v) ? `${fmtNum(v, 3)} pu` : DASH);
export const fmtM = (v: number | null | undefined, digits = 1) => (isNum(v) ? `${fmtNum(v, digits)} m` : DASH);
export const fmtLps = (v: number | null | undefined, digits = 1) => (isNum(v) ? `${fmtNum(v, digits)} L/s` : DASH);
export const fmtM3 = (v: number | null | undefined) => (isNum(v) ? `${fmtNum(v, 0)} m³` : DASH);
export const fmtMs = (v: number | null | undefined) => (isNum(v) ? (v >= 1000 ? `${fmtNum(v / 1000, 2)} s` : `${fmtNum(v, 0)} ms`) : DASH);

/** L/s → m³/h (1 L/s = 3.6 m³/h). */
export const lpsToM3h = (lps: number) => lps * 3.6;

/** Percentage a / b × 100, or null when b is 0 / missing. */
export function pct(a: number | null | undefined, b: number | null | undefined): number | null {
  if (!isNum(a) || !isNum(b) || b === 0) return null;
  return (100 * a) / b;
}

/** "B18" from a 0-based bus id (benchmark numbering is id + 1). */
export const busName = (id: number | null | undefined) => (isNum(id) ? `B${id + 1}` : DASH);

/** Minutes → "1 h 05 min" / "23 min". */
export function fmtDuration(min: number | null | undefined): string {
  if (!isNum(min)) return DASH;
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Simulated calendar date for time t (s) of a run: date part of timebase.startISO plus whole days
 * elapsed from timebase.startClock. Computed in UTC so the viewer's own time zone never shifts it.
 */
export function simDate(startISO: string, startClock: string, tSeconds: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startISO);
  if (!m) return DASH;
  const [hh, mm] = startClock.split(':').map(Number);
  const startMin = (hh || 0) * 60 + (mm || 0);
  const dayOffset = Math.floor((startMin + tSeconds / 60) / 1440);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dayOffset));
  return `${DOW[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "HH:MM" for t seconds after the run start (used for chart axes). */
export function clockFromT(startClock: string, tSeconds: number): string {
  const [hh, mm] = startClock.split(':').map(Number);
  const total = Math.round(((hh || 0) * 60 + (mm || 0) + tSeconds / 60) % 1440);
  const t = (total + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function titleCase(s: string): string {
  return s.replace(/(^|[\s-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

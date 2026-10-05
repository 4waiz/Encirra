// Formatting helpers. Application time is shown in Gulf Standard Time (UTC+4, no DST).

const GST_OFFSET_MS = 4 * 3600 * 1000;

const pad = (n: number, w = 2) => String(Math.floor(Math.abs(n))).padStart(w, '0');

function gstParts(t: number) {
  const d = new Date(t + GST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth(),
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    m: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
  };
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export const fmtClock = (t: number) => {
  const p = gstParts(t);
  return `${pad(p.h)}:${pad(p.m)}:${pad(p.s)}`;
};

export const fmtClockShort = (t: number) => {
  const p = gstParts(t);
  return `${pad(p.h)}:${pad(p.m)}`;
};

export const fmtDate = (t: number) => {
  const p = gstParts(t);
  return `${pad(p.d)} ${MONTHS[p.mo]} ${p.y}`;
};

/** mm:ss (or h:mm:ss when longer than an hour). */
export const fmtDuration = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
};

export const fmtAgo = (now: number, t: number) => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad(s % 60)}s ago`;
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m ago`;
};

export const fmtNum = (v: number | null | undefined, decimals = 0) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(decimals);

export const fmtPct = (v: number, decimals = 0) => `${v.toFixed(decimals)}%`;

export const fmtSigned = (v: number, decimals = 0) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(decimals)}`;

export const fmtDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

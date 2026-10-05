import { memo, useCallback, useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Tone } from '../../types';
import { TONE_HEX } from './tone';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

// ------------------------------------------------------------------------------------------ Panel

export function Panel({
  title,
  icon: Icon,
  iconColor,
  actions,
  children,
  className,
  bodyClassName,
  transparentBody,
  subtitle,
  id,
}: {
  title: ReactNode;
  icon?: LucideIcon;
  iconColor?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  transparentBody?: boolean;
  subtitle?: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cx('panel', className)}
      style={transparentBody ? { background: 'transparent' } : undefined}
      aria-label={typeof title === 'string' ? title : undefined}
    >
      <header className="panel-header" style={transparentBody ? { background: 'var(--color-surface-1)', borderTopLeftRadius: 8, borderTopRightRadius: 8 } : undefined}>
        {Icon && <Icon size={14} strokeWidth={1.9} style={{ color: iconColor ?? 'var(--color-ink-2)' }} aria-hidden />}
        <h2 className="panel-title">{title}</h2>
        {subtitle && <span className="truncate text-label text-ink-3">{subtitle}</span>}
        <div className="ml-auto flex items-center gap-1.5">{actions}</div>
      </header>
      <div className={cx('relative min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------ Status

export function StatusDot({ tone, pulse, size = 7 }: { tone: Tone; pulse?: boolean; size?: number }) {
  const c = TONE_HEX[tone];
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} aria-hidden>
      {pulse && <span className="absolute inset-0 rounded-full animate-pulse-ring" style={{ background: c }} />}
      <span className="relative inline-block rounded-full" style={{ width: size, height: size, background: c, boxShadow: `0 0 0 2px ${c}22` }} />
    </span>
  );
}

export function Chip({ tone = 'neutral', children, icon: Icon, solid, className, title }: { tone?: Tone; children: ReactNode; icon?: LucideIcon; solid?: boolean; className?: string; title?: string }) {
  const c = TONE_HEX[tone];
  return (
    <span
      title={title}
      className={cx('inline-flex h-[18px] items-center gap-1 rounded-[4px] px-1.5 font-cond text-[10.5px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap', className)}
      style={{ color: solid ? '#0b0f14' : c, background: solid ? c : `${c}1a`, boxShadow: solid ? 'none' : `inset 0 0 0 1px ${c}38` }}
    >
      {Icon && <Icon size={11} strokeWidth={2.2} aria-hidden />}
      {children}
    </span>
  );
}

// ------------------------------------------------------------------------------------------ Animated number

export const Metric = memo(function Metric({
  value,
  decimals = 0,
  className,
  suffix,
  prefix,
}: {
  value: number | null | undefined;
  decimals?: number;
  className?: string;
  suffix?: string;
  prefix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(value ?? null);
  const raf = useRef(0);
  const fmt = (v: number | null) => (v === null || Number.isNaN(v) ? '—' : `${prefix ?? ''}${v.toFixed(decimals)}${suffix ?? ''}`);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const to = value ?? null;
    const from = shown.current;
    cancelAnimationFrame(raf.current);
    if (to === null || from === null || from === to) {
      shown.current = to;
      el.textContent = fmt(to);
      return;
    }
    const big = Math.abs(to - from) > Math.max(Math.abs(from) * 0.04, 10 ** -decimals * 4);
    if (big) {
      el.classList.remove('animate-flash');
      void el.offsetWidth;
      el.classList.add('animate-flash');
    }
    const start = performance.now();
    const dur = 420;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      const v = from + (to - from) * e;
      shown.current = v;
      el.textContent = fmt(v);
      if (k < 1) raf.current = requestAnimationFrame(step);
      else shown.current = to;
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, decimals]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span ref={ref} className={cx('num', className)}>
      {fmt(value ?? null)}
    </span>
  );
});

// ------------------------------------------------------------------------------------------ Sparkline

export const Sparkline = memo(function Sparkline({
  data,
  color,
  height = 22,
  fill = true,
  min,
  max,
  className,
  threshold,
  strokeWidth = 1.4,
}: {
  data: number[];
  color: string;
  height?: number;
  fill?: boolean;
  min?: number;
  max?: number;
  className?: string;
  threshold?: number;
  strokeWidth?: number;
}) {
  const gid = useId();
  const clean = data.map((v) => (Number.isFinite(v) ? v : NaN));
  const finite = clean.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return <svg className={className} height={height} aria-hidden />;
  let lo = min ?? Math.min(...finite);
  let hi = max ?? Math.max(...finite);
  if (threshold !== undefined) hi = Math.max(hi, threshold * 1.05);
  if (hi - lo < 1e-9) {
    hi += 0.5;
    lo -= 0.5;
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;
  const W = 100;
  const n = clean.length;
  const pts: string[] = [];
  clean.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    const x = (i / (n - 1)) * W;
    const y = height - ((v - lo) / (hi - lo)) * height;
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  });
  const line = pts.join(' ');
  const area = `0,${height} ${line} ${W},${height}`;
  const ty = threshold !== undefined ? height - ((threshold - lo) / (hi - lo)) * height : null;
  return (
    <svg className={className} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" height={height} width="100%" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <polygon points={area} fill={`url(#${gid})`} />}
      {ty !== null && ty > 0 && ty < height && (
        <line x1="0" x2={W} y1={ty} y2={ty} stroke="#f2b33d" strokeOpacity="0.5" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" strokeWidth="1" />
      )}
      <polyline points={line} fill="none" stroke={color} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
});

// ------------------------------------------------------------------------------------------ Micro bars

export const MicroBars = memo(function MicroBars({ values, color, bars = 5, height = 14 }: { values: number[]; color: string; bars?: number; height?: number }) {
  // values in 0..1, most recent last
  const v = values.slice(-bars);
  while (v.length < bars) v.unshift(0);
  return (
    <span className="inline-flex items-end gap-[2px]" style={{ height }} aria-hidden>
      {v.map((x, i) => (
        <span
          key={i}
          className="w-[3px] rounded-[1px] transition-[height] duration-500"
          style={{ height: Math.max(2, Math.round(x * height)), background: color, opacity: 0.35 + 0.65 * ((i + 1) / bars) }}
        />
      ))}
    </span>
  );
});

// ------------------------------------------------------------------------------------------ Count bars

/**
 * A small count over time as bucketed bars (each bar = the highest count in its bucket); empty buckets
 * keep a faint baseline tick so the time axis stays legible when the count is zero.
 */
export const CountBars = memo(function CountBars({
  values,
  color,
  buckets = 15,
  height = 16,
  scaleMax = 4,
  title,
}: {
  values: number[];
  color: string;
  buckets?: number;
  height?: number;
  scaleMax?: number;
  title?: string;
}) {
  const n = values.length;
  const out: number[] = [];
  for (let b = 0; b < buckets; b++) {
    let m = 0;
    for (let i = Math.floor((b * n) / buckets); i < Math.floor(((b + 1) * n) / buckets); i++) if (values[i] > m) m = values[i];
    out.push(m);
  }
  const hi = Math.max(scaleMax, ...out);
  return (
    <span className="flex w-full items-end gap-[2px]" style={{ height }} title={title} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {out.map((v, i) => (
        <span
          key={i}
          className="min-w-0 flex-1 rounded-[1px] transition-[height] duration-500"
          style={{ height: v > 0 ? Math.max(5, Math.round((v / hi) * height)) : 2, background: v > 0 ? color : 'rgb(148 163 184 / 0.22)' }}
        />
      ))}
    </span>
  );
});

// ------------------------------------------------------------------------------------------ Controls

export function IconButton({
  icon: Icon,
  label,
  onClick,
  active,
  className,
  size = 24,
  disabled,
  shortcut,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  size?: number;
  disabled?: boolean;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      className={cx('ctl ctl-icon', className)}
      style={{ width: size, height: size }}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      data-active={active ? 'true' : undefined}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={Math.round(size * 0.56)} strokeWidth={1.9} aria-hidden />
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  label,
}: {
  options: { value: T; label: ReactNode; title?: string; color?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center rounded-[5px] border border-line-strong bg-surface-2 p-[2px]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex items-center justify-center gap-1 rounded-[4px] font-cond font-semibold uppercase tracking-[0.06em] transition-colors',
              size === 'sm' ? 'h-[20px] px-2 text-[10.5px]' : 'h-[26px] px-3 text-[11.5px]',
              on ? 'bg-surface-4 text-ink-1 shadow-[inset_0_0_0_1px_rgb(148_163_184/0.22)]' : 'text-ink-3 hover:text-ink-1',
            )}
            style={on && o.color ? { color: o.color } : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label, color }: { checked: boolean; onChange: (v: boolean) => void; label: string; color?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative inline-flex h-[16px] w-[28px] shrink-0 items-center rounded-full border transition-colors', checked ? 'border-transparent' : 'border-line-strong bg-surface-3')}
      style={checked ? { background: color ?? 'var(--color-cyan)' } : undefined}
    >
      <span className={cx('absolute h-[10px] w-[10px] rounded-full bg-ink-1 transition-transform', checked ? 'translate-x-[14px]' : 'translate-x-[3px] bg-ink-3')} />
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[3px] border border-line-strong bg-surface-3 px-1 font-mono text-[10px] text-ink-2">{children}</kbd>;
}

export function ProgressBar({ value, color, height = 4, className }: { value: number; color: string; height?: number; className?: string }) {
  return (
    <div className={cx('relative w-full overflow-hidden rounded-full bg-[rgb(148_163_184/0.12)]', className)} style={{ height }} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

/** Re-renders a component at an interval (for "time ago" style labels). */
// One shared ticker per interval: every clock on screen updates in the same tick, and the app runs a
// single timer per cadence instead of one per component.
type Ticker = { now: number; subs: Set<() => void>; id: ReturnType<typeof setInterval> | null };
const tickers = new Map<number, Ticker>();

function ticker(ms: number) {
  let t = tickers.get(ms);
  if (!t) {
    t = { now: Date.now(), subs: new Set(), id: null };
    tickers.set(ms, t);
  }
  return t;
}

function subscribeTicker(ms: number, cb: () => void) {
  const t = ticker(ms);
  t.subs.add(cb);
  if (t.id === null) {
    t.now = Date.now();
    t.id = setInterval(() => {
      t.now = Date.now();
      for (const f of t.subs) f();
    }, ms);
  }
  return () => {
    t.subs.delete(cb);
    if (!t.subs.size && t.id !== null) {
      clearInterval(t.id);
      t.id = null;
    }
  };
}

export function useNow(intervalMs = 1000) {
  const subscribe = useCallback((cb: () => void) => subscribeTicker(intervalMs, cb), [intervalMs]);
  return useSyncExternalStore(subscribe, () => ticker(intervalMs).now);
}

export function EmptyState({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail?: string }) {
  return (
    <div className="flex h-full min-h-[80px] flex-col items-center justify-center gap-1.5 px-4 text-center">
      <Icon size={18} strokeWidth={1.6} className="text-ink-4" aria-hidden />
      <div className="font-cond text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-2">{title}</div>
      {detail && <div className="max-w-[260px] text-label text-ink-3">{detail}</div>}
    </div>
  );
}

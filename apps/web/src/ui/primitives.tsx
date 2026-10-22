import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import type { ElementState, FacilityPower, FacilityStatus, FacilityWater } from '@encirra/shared';
import type { Tone } from '@/data/selectors';

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('enc-panel pointer-events-auto relative min-w-0', className)} {...rest}>
      {children}
    </div>
  );
}

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-navy',
  info: 'text-info',
  progress: 'text-info',
  ok: 'text-ok-deep',
  warn: 'text-warn',
  fault: 'text-fault',
};
export const TONE_BG: Record<Tone, string> = {
  neutral: 'bg-wash text-slate',
  info: 'bg-info-soft text-info',
  progress: 'bg-info-soft text-info',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  fault: 'bg-fault-soft text-fault',
};

/** Colour language for 2D maps & dots (Feeder Status uses green for healthy supply, per the reference). */
export const STATE_COLOR: Record<ElementState, string> = {
  energized: '#17A769',
  faulted: '#F04438',
  isolated: '#98A2AD',
  deenergized: '#98A2AD',
  restoring: '#F5A623',
  restored: '#17A769',
  open: '#B8C2CC',
};

export const POWER_TONE: Record<FacilityPower, Tone> = {
  online: 'ok',
  offline: 'fault',
  backup: 'warn',
  restored: 'ok',
  external: 'neutral',
};
export const WATER_TONE: Record<FacilityWater, Tone> = {
  normal: 'ok',
  'low-pressure': 'warn',
  'no-flow': 'fault',
  restored: 'ok',
  'n/a': 'neutral',
};
export const STATUS_TONE: Record<FacilityStatus, Tone> = {
  safe: 'ok',
  'at-risk': 'warn',
  affected: 'fault',
  restored: 'ok',
};
export const TONE_DOT: Record<Tone, string> = {
  neutral: '#98A2AD',
  info: '#2A6CB5',
  progress: '#2A6CB5',
  ok: '#17A769',
  warn: '#E08A00',
  fault: '#F04438',
};

export function Dot({ color, className, size = 8 }: { color: string; className?: string; size?: number }) {
  return <span aria-hidden className={clsx('inline-block shrink-0 rounded-full', className)} style={{ width: size, height: size, background: color }} />;
}

export function Pill({ tone = 'neutral', children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-[2px] t-micro font-semibold', TONE_BG[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; tip?: string; tipPos?: string; compact?: boolean }>(
  function IconButton({ active, tip, tipPos, compact, className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={rest['aria-label'] ?? tip}
        aria-pressed={active}
        data-tip={tip}
        data-tip-pos={tipPos}
        className={clsx(
          'inline-flex items-center justify-center rounded-lg transition-colors',
          compact ? 'h-7 w-7' : 'h-8 w-8',
          active ? 'bg-info-soft text-info' : 'text-ink hover:bg-wash',
          'disabled:opacity-40',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'sm',
  className,
  testId,
  stretch,
  tipPos,
}: {
  value: T;
  options: { value: T; label: ReactNode; tip?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  testId?: string;
  /** buttons share the full width */
  stretch?: boolean;
  tipPos?: string;
}) {
  return (
    <div role="radiogroup" data-testid={testId} className={clsx('inline-flex items-center gap-0.5 rounded-lg bg-wash p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          data-tip={o.tip}
          data-tip-pos={o.tip ? tipPos : undefined}
          data-value={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'whitespace-nowrap rounded-md font-medium transition-colors disabled:opacity-40',
            stretch && 'flex-1',
            size === 'xs' ? 'px-2 py-[3px] text-[11px]' : size === 'md' ? 'px-3 py-[6px] text-[12.5px] font-semibold' : 'px-2.5 py-1 text-[12px]',
            o.value === value ? 'bg-[var(--seg-on-bg)] text-[var(--seg-on-fg)] shadow-sm' : 'text-ink hover:bg-wash hover:text-navy',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Small "Replay" / "Live solver" badge used in panel headers. */
export function SourceChip({ source }: { source: string }) {
  const live = source === 'live';
  return (
    <span
      data-tip={live ? 'Computed by the live simulation service (pandapower + WNTR)' : 'Replay of precomputed solver output — not real-time telemetry'}
      data-tip-pos="bottom-end"
      className="inline-flex items-center gap-1.5 whitespace-nowrap t-micro font-medium text-slate"
    >
      <Dot color={live ? '#17A769' : '#2A6CB5'} size={7} />
      {live ? 'Live solver' : 'Replay'}
    </span>
  );
}

/**
 * Headline number. `short` is shown instead of `label` when the enclosing `@container` is narrow
 * (breakpoint `bp`); `sub` sits under the label, or next to the value on short viewports.
 */
export function Metric({
  value,
  unit,
  label,
  short,
  bp = 'md',
  sub,
  subShort,
  subTone,
  className,
  dim,
  testId,
  oneLine,
  tip,
}: {
  value: ReactNode;
  unit?: string;
  label: string;
  short?: string;
  bp?: 'xs' | 'sm' | 'md';
  sub?: ReactNode;
  subShort?: ReactNode;
  subTone?: Tone;
  className?: string;
  dim?: boolean;
  testId?: string;
  oneLine?: boolean;
  /** tooltip explaining how the number is derived */
  tip?: string;
}) {
  const subCls = clsx('font-semibold', subTone ? TONE_TEXT[subTone] : 'text-slate');
  return (
    <div className={clsx('min-w-0', className)} data-testid={testId} title={!tip && short ? label : undefined} data-tip={tip} data-tip-pos={tip ? 'top' : undefined}>
      <div className={clsx('t-metric', dim && 'text-mist')}>
        {value}
        {unit && <span className="t-unit">{unit}</span>}
        {sub != null && <span className={clsx('sub-inline t-micro ml-1.5', subCls)}>{subShort ?? sub}</span>}
      </div>
      <div className={clsx('t-label mt-0.5', oneLine ? 'truncate' : 'line-clamp-2')}>
        {short ? (
          <>
            <span className={bp === 'xs' ? '@max-[299px]:hidden' : bp === 'sm' ? '@max-[359px]:hidden' : '@max-[399px]:hidden'}>{label}</span>
            <span className={bp === 'xs' ? '@min-[300px]:hidden' : bp === 'sm' ? '@min-[360px]:hidden' : '@min-[400px]:hidden'}>{short}</span>
          </>
        ) : (
          label
        )}
      </div>
      {sub != null && <div className={clsx('sub-below t-label mt-0.5', subCls)}>{sub}</div>}
    </div>
  );
}

export function SectionTitle({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex items-center justify-between gap-2', className)}>
      <h3 className="t-title truncate">{children}</h3>
      {right}
    </div>
  );
}

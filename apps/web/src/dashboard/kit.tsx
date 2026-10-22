/**
 * Building blocks of the Live Twin rails: glass modules with a staggered entrance, animated
 * numbers, compact stats, delta badges and a details disclosure. Purely presentational.
 */
import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { animate, useAnimate, useReducedMotion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { useTwin } from '@/state/store';

export type RailTone = 'ok' | 'fault' | 'warn' | 'neutral' | 'info';

/** Accent colours (fill) and readable text colours on the navy glass. */
export const TONE_FILL: Record<RailTone, string> = {
  ok: '#17A769',
  fault: '#F04438',
  warn: '#F5A623',
  neutral: '#6F8296',
  info: '#6AA8EE',
};
export const TONE_INK: Record<RailTone, string> = {
  ok: 'text-ok-deep',
  fault: 'text-fault-deep',
  warn: 'text-warn',
  neutral: 'text-slate',
  info: 'text-info',
};

/**
 * Glass module. Slides in from its rail side with a stagger and replays on store.introNonce;
 * `accent` paints a state-coloured bar along the left edge (colour transitions smoothly).
 */
export function Module({
  side,
  index,
  accent,
  className,
  children,
  as: Tag = 'section',
  ...rest
}: {
  side: 'left' | 'right';
  index: number;
  accent?: RailTone | null;
  as?: 'section' | 'div';
} & HTMLAttributes<HTMLElement>) {
  const nonce = useTwin((s) => s.introNonce);
  const reduce = useReducedMotion();
  const [scope, run] = useAnimate<HTMLElement>();
  useEffect(() => {
    const el = scope.current;
    if (!el || reduce) return;
    const controls = run(
      el,
      { opacity: [0, 1], x: [side === 'left' ? -36 : 36, 0] },
      { duration: 0.55, ease: [0.2, 0.7, 0.2, 1], delay: 0.35 + index * 0.08 },
    );
    return () => controls.stop();
  }, [nonce, reduce, run, scope, side, index]);
  return (
    <Tag
      ref={scope as never}
      className={clsx('glass glass-hover pointer-events-auto relative shrink-0 overflow-hidden px-4 py-3 short:py-2.5', className)}
      {...rest}
    >
      {accent && (
        <span
          aria-hidden
          className="absolute top-0 bottom-0 left-0 w-[3px] transition-colors duration-500"
          style={{ background: TONE_FILL[accent], boxShadow: `0 0 18px 1px ${TONE_FILL[accent]}55` }}
        />
      )}
      {children}
    </Tag>
  );
}

export function ModuleHeader({ icon, title, right, className }: { icon?: ReactNode; title: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex min-h-[20px] items-center justify-between gap-2', className)}>
      <div className="flex shrink-0 items-center gap-2">
        {icon}
        <h3 className="t-section truncate">{title}</h3>
      </div>
      {right}
    </div>
  );
}

/**
 * Number that eases to its new value when the frame changes (≈ 0.45 s, no continuous animation).
 * The DOM text is written directly so the tween does not re-render React; the final text is
 * exactly `format(value)`.
 */
export function AnimatedNumber({ value, format, className }: { value: number | null | undefined; format: (v: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const reduce = useReducedMotion();
  const fmt = useRef(format);
  fmt.current = format;
  const final = value == null || !Number.isFinite(value) ? '—' : format(value);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = shown.current;
    if (value == null || !Number.isFinite(value) || from == null || reduce || Math.abs(value - from) < 1e-9) {
      el.textContent = final;
      shown.current = value ?? null;
      return;
    }
    const controls = animate(from, value, {
      duration: 0.45,
      ease: [0.2, 0.7, 0.2, 1],
      onUpdate: (v) => {
        shown.current = v;
        el.textContent = fmt.current(v);
      },
      onComplete: () => {
        shown.current = value;
        el.textContent = final;
      },
    });
    return () => controls.stop();
  }, [value, final, reduce]);
  return (
    <span ref={ref} className={className}>
      {final}
    </span>
  );
}

/** Compact series key for a module header. */
export function SeriesKey({ items }: { items: { label: string; color: string; dashed?: boolean; wide?: boolean }[] }) {
  return (
    <span className="flex min-w-0 items-center gap-x-2.5 overflow-hidden">
      {items.map((it) => (
        <span key={it.label} className={clsx('inline-flex shrink-0 items-center gap-1 text-[11px] whitespace-nowrap text-slate', it.wide && 'compact:hidden')}>
          <svg width="12" height="6" aria-hidden>
            <line x1="0" y1="3" x2="12" y2="3" stroke={it.color} strokeWidth="2" strokeDasharray={it.dashed ? '3 2' : undefined} />
          </svg>
          {it.label}
        </span>
      ))}
    </span>
  );
}

/** Label-over-value stat used across the rails. */
export function Stat({
  label,
  children,
  sub,
  tone,
  testId,
  tip,
  size = 'md',
  className,
  subWide,
}: {
  /** show `sub` only when the rail is wide (≥ 1500 px viewports) */
  subWide?: boolean;
  label: ReactNode;
  children: ReactNode;
  sub?: ReactNode;
  tone?: RailTone;
  testId?: string;
  tip?: string;
  size?: 'md' | 'xl';
  className?: string;
}) {
  return (
    <div className={clsx('min-w-0', className)} data-testid={testId} data-tip={tip} data-tip-pos={tip ? 'top' : undefined}>
      <div className="t-kicker truncate">{label}</div>
      <div className={clsx('mt-1.5', size === 'xl' ? 't-num-xl' : 't-num', tone && tone !== 'neutral' ? TONE_INK[tone] : 'text-navy')}>{children}</div>
      {sub != null && <div className={clsx('mt-1 truncate text-[11.5px] text-slate tabular', subWide && 'compact:hidden tight:hidden')}>{sub}</div>}
    </div>
  );
}

export const Unit = ({ children }: { children: ReactNode }) => <span className="u">{children}</span>;

/** Delta chip: green when Encirra is better, amber when worse, neutral when equal. */
export function DeltaBadge({ verdict, children, testId }: { verdict: 'better' | 'worse' | 'same' | 'n/a'; children: ReactNode; testId?: string }) {
  return (
    <span
      data-testid={testId}
      data-verdict={verdict}
      className={clsx(
        'inline-flex min-w-[58px] items-center justify-center rounded-full px-2 py-[3px] text-[11px] font-semibold whitespace-nowrap tabular',
        verdict === 'better' && 'bg-ok-soft text-ok-deep',
        verdict === 'worse' && 'bg-warn-soft text-warn',
        (verdict === 'same' || verdict === 'n/a') && 'bg-wash text-slate',
      )}
    >
      {children}
    </span>
  );
}

/** Header toggle for a module's secondary values (progressive disclosure). */
export function DetailsButton({ open, onToggle, testId }: { open: boolean; onToggle: () => void; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? 'Hide details' : 'Show details'}
      data-tip={open ? 'Hide details' : 'More values'}
      data-tip-pos="bottom-end"
      className={clsx(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors',
        open ? 'bg-white/10 text-navy' : 'text-slate hover:bg-white/[0.07] hover:text-navy',
      )}
      data-testid={testId}
    >
      <ChevronDown size={13} className={clsx('transition-transform', open && 'rotate-180')} />
    </button>
  );
}

export function DetailsGrid({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-line pt-2.5 text-[11.5px]" data-testid={testId}>
      {children}
    </div>
  );
}

export function KV({ k, children, tip }: { k: ReactNode; children: ReactNode; tip?: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2" data-tip={tip} data-tip-pos={tip ? 'top' : undefined}>
      <span className="truncate text-slate">{k}</span>
      <span className="shrink-0 font-semibold text-navy tabular">{children}</span>
    </div>
  );
}

/** Reactive CSS media query (layout variants that must not render twice). */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/**
 * Phone header (48 px + safe area): logo, name, simulated clock, source pill and a menu button
 * that opens a sheet with the five tabs, help, About, the disclaimer and the credit link.
 */
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BarChart3, Boxes, CircleHelp, FileText, Info, Layers3, Menu, ShieldCheck, X } from 'lucide-react';
import clsx from 'clsx';
import { useTwin, useFrame, type PageId } from '@/state/store';
import { STAGE_LABEL } from '@/data/selectors';
import { Dot } from '@/ui/primitives';
import { LogoMark } from '@/app/Logo';
import { CreditLink } from '@/app/Footer';
import { create } from 'zustand';

const NAV: { id: PageId; label: string; icon: typeof Layers3; hint: string }[] = [
  { id: 'live', label: 'Live Twin', icon: Layers3, hint: '3D twin, story and live telemetry' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, hint: 'Time series and strategy curves' },
  { id: 'scenarios', label: 'Scenarios', icon: ShieldCheck, hint: 'Scenario library and parameters' },
  { id: 'assets', label: 'Assets', icon: Boxes, hint: 'Every modelled asset and its state' },
  { id: 'reports', label: 'Reports', icon: FileText, hint: 'Strategy comparison and exports' },
];

/** Local UI state for the phone menu (not part of the app store). */
export const useMobileMenu = create<{ open: boolean; setOpen: (o: boolean) => void }>()((set) => ({ open: false, setOpen: (open) => set({ open }) }));

function SourcePill({ long = false }: { long?: boolean }) {
  const dataSource = useTwin((s) => s.dataSource);
  const frame = useFrame();
  const live = dataSource === 'live';
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-line-strong bg-white/[0.04] px-2.5 py-1 text-[12px] text-ink" data-testid={long ? 'm-sim-status' : 'sim-status'}>
      <Dot color={dataSource === 'error' ? '#F04438' : live ? '#17A769' : '#6AA8EE'} size={7} className={dataSource === 'loading' ? 'enc-blink' : ''} />
      <span className="truncate font-medium whitespace-nowrap">
        {dataSource === 'loading' ? 'Loading' : dataSource === 'error' ? 'Data unavailable' : live ? 'Live solver' : long ? 'Replay · precomputed solver output' : 'Replay'}
      </span>
      {long ? (
        frame && (
          <>
            <span className="text-mist">·</span>
            <span className="truncate font-semibold text-navy">{STAGE_LABEL[frame.stage]}</span>
          </>
        )
      ) : (
        <span className="sr-only" data-testid="sim-stage">
          {frame ? STAGE_LABEL[frame.stage] : dataSource === 'loading' ? 'Loading…' : '—'}
        </span>
      )}
    </span>
  );
}

export function MobileHeader() {
  const frame = useFrame();
  const page = useTwin((s) => s.page);
  const open = useMobileMenu((s) => s.open);
  const setOpen = useMobileMenu((s) => s.setOpen);
  const current = NAV.find((n) => n.id === page);
  return (
    <header className="ui-dark glass-solid fixed inset-x-0 top-0 z-30 border-b border-white/[0.08] pt-[env(safe-area-inset-top)]" data-testid="m-header">
      <div className="m-safe-x flex h-[var(--m-header)] items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-white/95">
          <LogoMark size={19} />
        </span>
        <div className="min-w-0 leading-tight">
          <h1 className="text-[16px] font-semibold tracking-[-0.02em] text-navy">Encirra</h1>
          {page !== 'live' && <div className="truncate text-[12px] text-slate">{current?.label}</div>}
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <span className="flex items-baseline gap-1 tabular" data-testid="sim-clock">
            <span className="text-[15px] font-semibold text-navy">{frame?.clock ?? '—'}</span>
            <span className="text-[12px] font-semibold tracking-[0.06em] text-mist uppercase">sim</span>
          </span>
          <SourcePill />
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-navy active:bg-white/10"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            data-testid="m-menu-btn"
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
    </header>
  );
}

export function MobileMenu() {
  const open = useMobileMenu((s) => s.open);
  const setOpen = useMobileMenu((s) => s.setOpen);
  const page = useTwin((s) => s.page);
  const setPage = useTwin((s) => s.setPage);
  const setAbout = useTwin((s) => s.setAboutOpen);
  const setWelcome = useTwin((s) => s.setWelcomeOpen);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div key="menu" className="fixed inset-0 z-[45]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <div className="absolute inset-0 bg-[rgba(4,10,18,0.55)]" onClick={() => setOpen(false)} aria-hidden />
          <motion.nav
            aria-label="Primary"
            className="ui-dark glass-solid m-scroll absolute inset-x-0 top-0 max-h-[100dvh] rounded-b-[20px] border-b border-white/10 pt-[env(safe-area-inset-top)] pb-3 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]"
            initial={{ y: -24 }}
            animate={{ y: 0 }}
            exit={{ y: -24 }}
            transition={{ duration: 0.24, ease: [0.2, 0.7, 0.2, 1] }}
            data-testid="m-menu"
          >
            <div className="m-safe-x flex h-[var(--m-header)] items-center justify-between">
              <span className="t-kicker">Menu</span>
              <button type="button" onClick={() => setOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-xl text-navy active:bg-white/10" aria-label="Close menu">
                <X size={22} />
              </button>
            </div>
            <ul className="m-safe-x grid gap-1">
              {NAV.map(({ id, label, icon: Icon, hint }) => {
                const active = id === page;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      data-testid={`nav-${id}`}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => {
                        setPage(id);
                        setOpen(false);
                      }}
                      className={clsx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', active ? 'bg-white/[0.1]' : 'active:bg-white/[0.06]')}
                    >
                      <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', active ? 'bg-[#F2F6FA] text-[#0b1624]' : 'bg-white/[0.06] text-ink')}>
                        <Icon size={18} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[15px] font-semibold text-navy">{label}</span>
                        <span className="block truncate text-[12px] text-slate">{hint}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="m-safe-x mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setWelcome(true, 'help');
                }}
                className="flex items-center justify-center gap-2 rounded-xl border border-line-strong py-2.5 text-[14px] font-semibold text-navy active:bg-white/10"
                data-testid="help-open"
              >
                <CircleHelp size={17} /> How to read it
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setAbout(true);
                }}
                className="flex items-center justify-center gap-2 rounded-xl border border-line-strong py-2.5 text-[14px] font-semibold text-navy active:bg-white/10"
                data-testid="about-open"
              >
                <Info size={17} /> About Encirra
              </button>
            </div>
            <div className="m-safe-x mt-3 space-y-2">
              <SourcePill long />
              <p className="text-[12px] leading-snug text-slate" data-testid="footer-disclaimer">
                Research Prototype — Synthetic/Benchmark Infrastructure Data. No private utility data is available or authorized.
              </p>
              <CreditLink className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-info underline-offset-2 active:underline" />
            </div>
          </motion.nav>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

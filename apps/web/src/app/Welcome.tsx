/**
 * First-visit welcome card (not a blocker): what Encirra shows, how to read the colours, and two
 * ways in. Reopened from the header "?" button, where it also lists the keyboard shortcuts.
 * Dismissal is remembered per browser (localStorage, guarded: storage may be unavailable).
 */
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Clapperboard, Compass, X } from 'lucide-react';
import { useTwin } from '@/state/store';
import { startDemo } from '@/demo/demoController';

const KEY = 'encirra.welcome.v1';

function dismissedBefore(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'dismissed';
  } catch {
    return false;
  }
}
function rememberDismissed() {
  try {
    window.localStorage.setItem(KEY, 'dismissed');
  } catch {
    /* storage unavailable: the card simply shows again next time */
  }
}

/** Opens the card on the first visit (deep links with ?frame= or ?welcome=0 skip it). */
export function useFirstVisitWelcome() {
  const setOpen = useTwin((s) => s.setWelcomeOpen);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('welcome') === '0' || q.has('frame') || q.get('view') === 'scene') return;
    if (q.get('welcome') === '1' || !dismissedBefore()) setOpen(true);
  }, [setOpen]);
}

const LEGEND: { color: string; title: string; text: string }[] = [
  { color: '#F5A623', title: 'Power', text: 'Amber lines carry electricity.' },
  { color: '#00BFEA', title: 'Water', text: 'Cyan pipes; pumps need power.' },
  { color: '#F04438', title: 'Fault', text: 'Red is the fault and what it hits.' },
  { color: '#17A769', title: 'Verified restore', text: 'Green is a verified recovery.' },
];

const KEYS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['← →', 'Step one frame'],
  ['F', 'Focus twin'],
  ['Esc', 'Close panel'],
  ['?', 'This help'],
];

export function WelcomeCard() {
  const open = useTwin((s) => s.welcomeOpen);
  const help = useTwin((s) => s.welcomeMode === 'help');
  const setOpen = useTwin((s) => s.setWelcomeOpen);
  const page = useTwin((s) => s.page);
  const hasRun = useTwin((s) => !!s.runsByStrategy.encirra);
  const close = () => {
    rememberDismissed();
    setOpen(false);
  };
  return (
    <AnimatePresence>
      {open && page === 'live' && (
        <motion.div
          key="welcome"
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
          className="ui-dark glass glass-solid pointer-events-auto absolute bottom-[calc(var(--footer-h)+var(--bar-h)+var(--gap)*2)] left-1/2 z-30 w-[min(460px,calc(100vw-2*var(--rail-w)-4*var(--gap)))] min-w-[340px] -translate-x-1/2 rounded-[16px] p-5"
          role="dialog"
          aria-label="Welcome to Encirra"
          data-testid="welcome"
        >
          <button type="button" onClick={close} className="absolute top-3 right-3 rounded-md p-1 text-slate hover:bg-white/10 hover:text-navy" aria-label="Close welcome" data-testid="welcome-close">
            <X size={16} />
          </button>
          <div className="t-kicker">{help ? 'How to read the twin' : 'Welcome to Encirra'}</div>
          <p className="mt-2 pr-6 text-[14.5px] leading-[1.45] font-medium text-navy">
            A physics-driven twin of one district&apos;s coupled power and water networks: watch a feeder fault stop a water pump, a tank hide the problem, and how each recovery strategy protects the hospital.
          </p>
          <ol className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
            {LEGEND.map((l) => (
              <li key={l.title} className="flex gap-2.5">
                <span className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.color, boxShadow: `0 0 10px ${l.color}88` }} />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-semibold text-navy">{l.title}</span>
                  <span className="block text-[11.5px] leading-snug text-slate">{l.text}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              disabled={!hasRun}
              onClick={() => {
                close();
                startDemo();
              }}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#F2F6FA] py-2.5 text-[13px] font-semibold text-[#0b1624] transition-colors hover:bg-white disabled:opacity-50"
              data-testid="welcome-demo"
            >
              <Clapperboard size={15} /> Play the 3-minute story
            </button>
            <button
              type="button"
              onClick={close}
              className="flex items-center justify-center gap-2 rounded-lg border border-line-strong px-4 py-2.5 text-[13px] font-semibold text-navy transition-colors hover:bg-white/10"
              data-testid="welcome-explore"
            >
              <Compass size={15} /> Explore
            </button>
          </div>
          {help && (
          <div className="mt-4 border-t border-line pt-3">
            <div className="t-kicker">Keyboard</div>
            <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-3 gap-y-1.5" data-testid="welcome-shortcuts">
              {KEYS.map(([k, v]) => (
                <li key={k} className="flex items-center gap-2 text-[11.5px] text-slate">
                  <kbd className="min-w-[26px] rounded-[5px] border border-line-strong bg-white/[0.06] px-1.5 py-[1px] text-center font-sans text-[11px] font-semibold text-navy">{k}</kbd>
                  {v}
                </li>
              ))}
            </ul>
          </div>
          )}
          {!help && (
            <p className="mt-3 text-center text-[11px] text-mist">
              Press <kbd className="rounded border border-line-strong px-1 font-sans font-semibold text-ink">?</kbd> any time for help and shortcuts
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

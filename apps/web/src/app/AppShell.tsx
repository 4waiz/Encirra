import { Suspense, lazy, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { TwinCanvas } from '@/scene';
import { useTwin } from '@/state/store';
import { bootstrap } from '@/data/loader';
import { usePlaybackLoop, playback } from '@/playback/playback';
import { useDemoDirector } from '@/demo/demoController';
import { LiveTwin } from '@/dashboard/LiveTwin';
import { FacilityInspector } from '@/inspector/FacilityInspector';
import { WhyPlanModal } from '@/modals/WhyPlanModal';
import { AboutModal } from '@/modals/AboutModal';

// content pages load on first visit (keeps the initial bundle to the twin + dashboard)
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const ScenariosPage = lazy(() => import('@/pages/ScenariosPage').then((m) => ({ default: m.ScenariosPage })));
const AssetsPage = lazy(() => import('@/pages/AssetsPage').then((m) => ({ default: m.AssetsPage })));
const ReportsPage = lazy(() => import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
import { Header } from './Header';
import { Footer } from './Footer';
import { WelcomeCard, useFirstVisitWelcome } from './Welcome';
import { useIsMobile } from './viewport';
import { MobileHeader, MobileMenu } from '@/mobile/MobileHeader';
import { MobileTwin } from '@/mobile/MobileTwin';
import { useSceneQuality } from '@/scene/runtime';

/** Phones render the scene at the low quality tier; touch tablets cap at medium. */
function useDeviceQuality(mobile: boolean) {
  useEffect(() => {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const q = useSceneQuality.getState();
    if (mobile) q.setMaxTier('low');
    else if (coarse) q.setMaxTier('medium');
  }, [mobile]);
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.closest('input, textarea, select, [contenteditable="true"]') || el.getAttribute('role') === 'dialog')) return;
      const s = useTwin.getState();
      if (s.whyPlanOpen || s.aboutOpen) return;
      if (e.key === 'Escape' && s.welcomeOpen) {
        s.setWelcomeOpen(false);
        try {
          window.localStorage.setItem('encirra.welcome.v1', 'dismissed');
        } catch {
          /* storage unavailable */
        }
        return;
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        s.setWelcomeOpen(!s.welcomeOpen, 'help');
        return;
      }
      if (e.key === ' ' && !(el instanceof HTMLButtonElement)) {
        e.preventDefault();
        playback.toggle();
      } else if (e.key === 'ArrowRight' && !e.altKey) playback.step(1);
      else if (e.key === 'ArrowLeft' && !e.altKey) playback.step(-1);
      else if (e.key === 'Escape' && s.selected) s.setSelected(null);
      else if (e.key === 'Escape' && s.focusTwin) s.setFocusTwin(false);
      else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey && s.page === 'live') s.setFocusTwin(!s.focusTwin);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function StatusOverlay() {
  const dataSource = useTwin((s) => s.dataSource);
  const busy = useTwin((s) => s.busy);
  const dataError = useTwin((s) => s.dataError);
  const runError = useTwin((s) => s.runError);
  const setData = useTwin((s) => s.setData);
  return (
    <>
      <AnimatePresence>
        {(dataSource === 'loading' || busy) && (
          <motion.div
            key="busy"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="enc-panel enc-panel-strong pointer-events-none fixed top-1/2 left-1/2 z-40 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-[12px] px-4 py-3 text-[13px] text-navy"
            data-testid="busy"
          >
            <Loader2 size={16} className="animate-spin text-info" />
            {busy ?? 'Loading simulation data…'}
          </motion.div>
        )}
      </AnimatePresence>
      {dataSource === 'error' && (
        <div className="enc-panel enc-panel-strong fixed top-1/2 left-1/2 z-40 w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-[12px] p-5 text-[13px] text-navy" role="alert">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-fault">
            <AlertTriangle size={18} /> Simulation data unavailable
          </div>
          <p className="mt-2 text-ink">
            Neither the live simulation service (<code>npm run dev:sim</code>) nor the bundled replay files (<code>apps/web/public/replay/</code>) could be loaded.
          </p>
          <p className="mt-2 font-mono text-[11px] break-all text-slate">{dataError}</p>
        </div>
      )}
      {runError && (
        <div className="enc-panel enc-panel-strong fixed top-[calc(var(--header-h)+8px)] left-1/2 z-40 flex max-w-[min(92vw,640px)] -translate-x-1/2 items-start gap-2 rounded-[10px] px-3 py-2 text-[12px] text-navy" role="alert">
          <AlertTriangle size={15} className="mt-[1px] shrink-0 text-fault" />
          <span className="min-w-0 break-words">
            Request failed — the previous results stay displayed. <span className="text-slate">{runError}</span>
          </span>
          <button type="button" className="ml-2 shrink-0 font-semibold text-info" onClick={() => setData({ runError: null })}>
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}

function PageLayer({ mobile }: { mobile: boolean }) {
  const page = useTwin((s) => s.page);
  return (
    <AnimatePresence mode="wait" initial={false}>
      {page === 'live' ? (
        mobile ? (
          <MobileTwin key="live-m" />
        ) : (
          <LiveTwin key="live" />
        )
      ) : (
        <motion.main
          key={page}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-x-0 top-[var(--header-h)] bottom-[var(--footer-h)] z-10 px-[var(--pad-x)] pb-[var(--gap)]"
          data-testid={`page-${page}`}
        >
          <Suspense
            fallback={
              <div className="enc-panel enc-panel-strong flex h-full items-center justify-center rounded-[12px] text-[13px] text-slate">
                <Loader2 size={16} className="mr-2 animate-spin text-info" /> Loading…
              </div>
            }
          >
            {page === 'analytics' && <AnalyticsPage />}
            {page === 'scenarios' && <ScenariosPage />}
            {page === 'assets' && <AssetsPage />}
            {page === 'reports' && <ReportsPage />}
          </Suspense>
        </motion.main>
      )}
    </AnimatePresence>
  );
}

export function AppShell() {
  usePlaybackLoop();
  useDemoDirector();
  useKeyboard();
  useFirstVisitWelcome();
  useEffect(() => {
    void bootstrap();
  }, []);
  const page = useTwin((s) => s.page);
  const mobile = useIsMobile();
  useDeviceQuality(mobile);
  return (
    <div className="relative h-full w-full overflow-hidden" data-testid="app" data-mobile={mobile ? 'true' : undefined}>
      <div className="absolute inset-0 z-0">
        <TwinCanvas />
      </div>
      {/* soft edge vignettes behind the rails and bars: the glass reads as one surface with the dusk scene */}
      <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(8,16,27,0.28)_100%)]" />
      <AnimatePresence>
        {page !== 'live' && (
          <motion.div
            key="veil"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="pointer-events-none absolute inset-0 z-[2] bg-[linear-gradient(180deg,rgba(255,255,255,0.72)_0%,rgba(250,250,248,0.62)_45%,rgba(246,245,242,0.78)_100%)] backdrop-blur-[2px]"
          />
        )}
      </AnimatePresence>
      {mobile ? <MobileHeader /> : <Header />}
      <PageLayer mobile={mobile} />
      {mobile ? <MobileMenu /> : <Footer />}
      <WelcomeCard />
      <FacilityInspector />
      <WhyPlanModal />
      <AboutModal />
      <StatusOverlay />
    </div>
  );
}

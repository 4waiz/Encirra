import { useEffect } from 'react';
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
import { AnalyticsPage } from '@/pages/AnalyticsPage';
import { ScenariosPage } from '@/pages/ScenariosPage';
import { AssetsPage } from '@/pages/AssetsPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { Header } from './Header';
import { Footer } from './Footer';

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.closest('input, textarea, select, [contenteditable="true"]') || el.getAttribute('role') === 'dialog')) return;
      const s = useTwin.getState();
      if (s.whyPlanOpen || s.aboutOpen) return;
      if (e.key === ' ' && !(el instanceof HTMLButtonElement)) {
        e.preventDefault();
        playback.toggle();
      } else if (e.key === 'ArrowRight' && !e.altKey) playback.step(1);
      else if (e.key === 'ArrowLeft' && !e.altKey) playback.step(-1);
      else if (e.key === 'Escape' && s.selected) s.setSelected(null);
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

function PageLayer() {
  const page = useTwin((s) => s.page);
  return (
    <AnimatePresence mode="wait" initial={false}>
      {page === 'live' ? (
        <LiveTwin key="live" />
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
          {page === 'analytics' && <AnalyticsPage />}
          {page === 'scenarios' && <ScenariosPage />}
          {page === 'assets' && <AssetsPage />}
          {page === 'reports' && <ReportsPage />}
        </motion.main>
      )}
    </AnimatePresence>
  );
}

export function AppShell() {
  usePlaybackLoop();
  useDemoDirector();
  useKeyboard();
  useEffect(() => {
    void bootstrap();
  }, []);
  const page = useTwin((s) => s.page);
  return (
    <div className="relative h-full w-full overflow-hidden" data-testid="app">
      <div className="absolute inset-0 z-0">
        <TwinCanvas />
      </div>
      {/* light veil: keeps the header legible over the sky, and softens the city behind content pages */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-[calc(var(--header-h)+40px)] bg-gradient-to-b from-white/55 via-white/25 to-transparent" />
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
      <Header />
      <PageLayer />
      <Footer />
      <FacilityInspector />
      <WhyPlanModal />
      <AboutModal />
      <StatusOverlay />
    </div>
  );
}

import { lazy, Suspense, useEffect } from 'react';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { OverviewScreen } from './features/overview/OverviewScreen';
import { TwinScreen } from './features/digital-twin/TwinScreen';
import { FeedsScreen } from './features/feeds/FeedsScreen';
import { InsightsScreen } from './features/insights/InsightsScreen';
import { IncidentsScreen } from './features/incidents/IncidentsScreen';
import { CommandPalette } from './components/command/CommandPalette';
import { SettingsDrawer } from './components/command/SettingsDrawer';
import { Toasts } from './components/command/Toasts';
import { BootScreen } from './components/command/BootScreen';
import { useUI, SCREENS } from './store/ui';
import { useSceneStatus } from './three/sceneStatus';
import { engine } from './simulation/engine';
import { cx } from './components/ui/primitives';

const SceneCanvas = lazy(() => import('./three/Scene'));

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      const ui = useUI.getState();
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        ui.setScreen(SCREENS[Number(e.key) - 1]);
        return;
      }
      if (e.key === 'Escape' && !typing && !ui.paletteOpen && !ui.settingsOpen) {
        if (ui.twinImmersive) ui.setTwinImmersive(false);
        else ui.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function App() {
  const screen = useUI((s) => s.screen);
  const reduceMotion = useUI((s) => s.settings.reduceMotion);
  const immersive = useUI((s) => s.twinImmersive && s.screen === 'twin');
  const ready = useSceneStatus((s) => s.ready);
  useShortcuts();

  // the opening story: once the twin is visible, a mild multi-source event unfolds
  useEffect(() => {
    if (!ready) return;
    if (useUI.getState().settings.autoplay) engine.scheduleAutoplay(6000);
  }, [ready]);

  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement && useUI.getState().twinImmersive) useUI.getState().setTwinImmersive(false);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  return (
    <>
      <ErrorBoundary label="3D renderer" fallback={() => null}>
        <Suspense fallback={null}>
          <SceneCanvas />
        </Suspense>
      </ErrorBoundary>
      <div className={cx('relative z-10 flex h-full flex-col', reduceMotion && 'reduce-motion')}>
        {!immersive && <Header />}
        <main className="relative min-h-0 flex-1" id="main">
          <ErrorBoundary label="Screen" key={screen}>
            {screen === 'overview' && <OverviewScreen />}
            {screen === 'twin' && <TwinScreen />}
            {screen === 'feeds' && <FeedsScreen />}
            {screen === 'insights' && <InsightsScreen />}
            {screen === 'incidents' && <IncidentsScreen />}
          </ErrorBoundary>
        </main>
        {!immersive && <Footer />}
      </div>
      <CommandPalette />
      <SettingsDrawer />
      <Toasts />
      <BootScreen />
    </>
  );
}

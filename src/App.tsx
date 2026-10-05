import { lazy, Suspense, useEffect } from 'react';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { OverviewScreen } from './features/overview/OverviewScreen';
import { useUI } from './store/ui';
import { useSceneStatus } from './three/sceneStatus';
import { engine } from './simulation/engine';
import { cx } from './components/ui/primitives';

const SceneCanvas = lazy(() => import('./three/Scene'));

function Placeholder({ name }: { name: string }) {
  return <div className="absolute inset-0 flex items-center justify-center text-ink-3">{name}</div>;
}

export default function App() {
  const screen = useUI((s) => s.screen);
  const reduceMotion = useUI((s) => s.settings.reduceMotion);
  const ready = useSceneStatus((s) => s.ready);

  // the first-run story: once the twin is visible, a mild multi-source event unfolds
  useEffect(() => {
    if (!ready) return;
    if (useUI.getState().settings.autoplay) engine.scheduleAutoplay(6000);
  }, [ready]);

  return (
    <>
      <ErrorBoundary label="3D renderer" fallback={() => null}>
        <Suspense fallback={null}>
          <SceneCanvas />
        </Suspense>
      </ErrorBoundary>
      <div className={cx('relative z-10 flex h-full flex-col', reduceMotion && 'reduce-motion')}>
        <Header />
        <main className="relative min-h-0 flex-1">
          <ErrorBoundary label="Screen" key={screen}>
            {screen === 'overview' && <OverviewScreen />}
            {screen === 'twin' && <Placeholder name="3D Twin" />}
            {screen === 'feeds' && <Placeholder name="Live Feeds" />}
            {screen === 'insights' && <Placeholder name="AI Insights" />}
            {screen === 'incidents' && <Placeholder name="Incidents" />}
          </ErrorBoundary>
        </main>
        <Footer />
      </div>
    </>
  );
}

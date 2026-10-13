import { Suspense, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { useTwin } from '@/state/store';
import { Scene } from './Scene';
import { fx, useSceneQuality, type QualityTier } from './runtime';
import { useKit } from './assets/kit';

const TIERS: QualityTier[] = ['low', 'medium', 'high'];
const DPR: Record<QualityTier, [number, number]> = { high: [1, 1.5], medium: [1, 1], low: [0.75, 0.85] };

/**
 * Full-screen WebGL canvas that hosts the 3D digital twin.
 * Rendered behind the dashboard overlay on every page.
 */
export function TwinCanvas() {
  const tier = useSceneQuality((s) => s.tier);
  const setTier = useSceneQuality((s) => s.setTier);
  const setSelected = useTwin((s) => s.setSelected);

  // QA / debugging hook (development builds only): lets the screenshot scripts drive the store.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, Record<string, unknown> | undefined>;
    w.__encirra = { ...(w.__encirra ?? {}), useTwin, fx, useSceneQuality, useKit };
  }, []);
  const forced = typeof window !== 'undefined' && !!new URLSearchParams(window.location.search).get('quality');

  return (
    <div className="absolute inset-0" data-testid="twin-canvas" style={{ position: 'absolute', inset: 0, background: '#E8B994' }}>
      <Canvas
        shadows="percentage"
        dpr={DPR[tier]}
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false }}
        camera={{ position: [-420, 215, 420], fov: 40, near: 2, far: 14000 }}
        onPointerMissed={() => setSelected(null)}
        onCreated={(state) => {
          state.gl.toneMappingExposure = 1.0;
          if (import.meta.env.DEV) {
            const w = window as unknown as Record<string, Record<string, unknown> | undefined>;
            w.__encirra = { ...(w.__encirra ?? {}), gl: state.gl, r3f: state.get, useTwin, fx, useSceneQuality, useKit };
          }
        }}
      >
        <PerformanceMonitor
          bounds={(refresh) => (refresh > 90 ? [50, 80] : [40, 58])}
          flipflops={3}
          onDecline={() => {
            const i = TIERS.indexOf(useSceneQuality.getState().tier);
            if (i > 0 && !forced) setTier(TIERS[i - 1]);
          }}
          onIncline={() => {
            const i = TIERS.indexOf(useSceneQuality.getState().tier);
            if (i < TIERS.length - 1 && !forced) setTier(TIERS[i + 1]);
          }}
        />
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
    </div>
  );
}

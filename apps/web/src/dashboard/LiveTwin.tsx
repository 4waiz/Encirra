import { useEffect, useRef, type RefObject } from 'react';
import { motion } from 'motion/react';
import { useTwin, type OverlayLayout, type ScreenRect } from '@/state/store';
import { FaultCard, FeederStatusCard, RecoveryCard, TimelineCard } from './TopCards';
import { CityOverviewPanel, FacilitiesPanel, PowerPanel, WaterPanel } from './BottomPanels';
import { PlaybackBar, SceneToolbar } from './Controls';
import { DemoOverlay } from '@/demo/DemoOverlay';

const OCCLUDERS = ['scene-toolbar', 'playback-bar', 'demo-overlay', 'inspector'];

const rect = (b: DOMRect): ScreenRect => ({ x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) });

/**
 * Publishes store.overlayLayout: the unobstructed band between the top cards and the bottom
 * panels plus the floating controls inside it, so the 3D scene can keep its callouts visible.
 */
function useOverlayLayout(middle: RefObject<HTMLElement | null>) {
  const setOverlayLayout = useTwin((s) => s.setOverlayLayout);
  const selected = useTwin((s) => s.selected);
  const demoActive = useTwin((s) => s.demo.active);
  const measureRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = middle.current;
    if (!el) return;
    let last = '';
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const occluders = OCCLUDERS.map((id) => document.querySelector(`[data-testid="${id}"]`))
          .filter((n): n is Element => n != null)
          .map((n) => rect(n.getBoundingClientRect()))
          .filter((r) => r.width > 0 && r.height > 0);
        const next: OverlayLayout = { safe: rect(el.getBoundingClientRect()), occluders };
        const key = JSON.stringify(next);
        if (key !== last) {
          last = key;
          setOverlayLayout(next);
        }
      });
    };
    measureRef.current = measure;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      cancelAnimationFrame(raf);
      measureRef.current = () => {};
    };
  }, [middle, setOverlayLayout]);

  // floating controls move/appear with the inspector and the demo captions (after their transitions)
  useEffect(() => {
    measureRef.current();
    const t = setTimeout(() => measureRef.current(), 350);
    return () => clearTimeout(t);
  }, [selected, demoActive]);

  useEffect(() => () => setOverlayLayout(null), [setOverlayLayout]);
}

/**
 * Live Twin overlay, matching the reference composition: header (shell) · four top cards ·
 * the 3D city (pointer events pass through) · four bottom panels.
 */
export function LiveTwin() {
  const inspecting = useTwin((s) => s.selected != null);
  const middle = useRef<HTMLElement>(null);
  useOverlayLayout(middle);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="pointer-events-none absolute inset-x-0 top-[var(--header-h)] bottom-[var(--footer-h)] z-10 grid gap-[var(--gap)] px-[var(--pad-x)] pb-[var(--gap)]"
      style={{ gridTemplateRows: 'var(--top-h) minmax(0, 1fr) var(--bottom-h)' }}
      data-testid="live-twin"
    >
      <section className="grid min-h-0 gap-[var(--gap)]" style={{ gridTemplateColumns: '1.27fr 0.98fr 1.42fr 1.06fr', gridTemplateRows: 'minmax(0, 1fr)' }} aria-label="Incident and recovery status">
        <FaultCard />
        <FeederStatusCard />
        <RecoveryCard />
        <TimelineCard />
      </section>
      <section ref={middle} className="relative min-h-0" aria-label="3D twin controls" data-testid="twin-safe-area">
        <div className="pointer-events-none absolute top-0 left-0 flex max-w-[calc(100%-420px)] min-w-[360px]">
          <DemoOverlay />
        </div>
        <div className="pointer-events-none absolute top-0 z-30 flex justify-end transition-[right] duration-200" style={{ right: inspecting ? 'min(372px, calc(100vw - 24px))' : 0 }}>
          <SceneToolbar />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center">
          <PlaybackBar />
        </div>
      </section>
      <section className="grid min-h-0 gap-[var(--gap)]" style={{ gridTemplateColumns: '1fr 1fr 1.21fr 1.18fr', gridTemplateRows: 'minmax(0, 1fr)' }} aria-label="Network panels">
        <PowerPanel />
        <WaterPanel />
        <FacilitiesPanel />
        <CityOverviewPanel />
      </section>
    </motion.div>
  );
}

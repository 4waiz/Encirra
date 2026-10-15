import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { motion, useAnimate, useReducedMotion } from 'motion/react';
import { useTwin, type OverlayLayout, type ScreenRect } from '@/state/store';
import { FaultCard, FeederStatusCard, RecoveryCard, TimelineCard } from './TopCards';
import { CityOverviewPanel, FacilitiesPanel, PowerPanel, WaterPanel } from './BottomPanels';
import { PlaybackBar, SceneToolbar } from './Controls';
import { DemoOverlay } from '@/demo/DemoOverlay';

/**
 * Dashboard tile entrance: each card flies in from a scattered offset with a slight 3D tilt and
 * snaps into place with a staggered spring ("tiles coming together"). Replays on store.introNonce.
 */
function Tile({ i, row, children }: { i: number; row: 'top' | 'bottom'; children: ReactNode }) {
  const nonce = useTwin((s) => s.introNonce);
  const reduce = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLDivElement>();
  useEffect(() => {
    const el = scope.current;
    if (!el || reduce) return;
    const dir = row === 'top' ? -1 : 1;
    const spread = [-1.4, -0.5, 0.5, 1.4][i] ?? 0;
    const controls = animate(
      el,
      {
        opacity: [0, 1],
        x: [spread * 70, 0],
        y: [dir * 90, 0],
        transformPerspective: [900, 900],
        rotateX: [dir * -28, 0],
        rotateZ: [spread * 4, 0],
        scale: [0.86, 1],
      },
      { type: 'spring', stiffness: 140, damping: 17, mass: 0.9, delay: 0.25 + (row === 'top' ? 0 : 0.18) + Math.abs(spread) * 0.07 + i * 0.03 },
    );
    return () => controls.stop();
  }, [nonce, reduce, animate, scope, i, row]);
  return (
    <div ref={scope} className="grid min-h-0 min-w-0" style={{ gridTemplateRows: 'minmax(0, 1fr)' }}>
      {children}
    </div>
  );
}

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
  const focus = useTwin((s) => s.focusTwin);
  const middle = useRef<HTMLElement>(null);
  useOverlayLayout(middle);
  // Focus mode collapses both card rows (animated grid tracks) so the twin fills the view; the
  // safe-area observer reports the larger band and the camera re-centres on it.
  const rowStyle = (hidden: boolean, dir: 1 | -1) => ({
    opacity: hidden ? 0 : 1,
    transform: hidden ? `translateY(${dir * 14}px)` : 'none',
    overflow: hidden ? ('hidden' as const) : ('visible' as const),
    transition: 'opacity 260ms ease, transform 320ms ease',
  });
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="pointer-events-none absolute inset-x-0 top-[var(--header-h)] bottom-[var(--footer-h)] z-10 grid px-[var(--pad-x)] pb-[var(--gap)]"
      style={{
        gridTemplateRows: focus ? '0px minmax(0, 1fr) 0px' : 'var(--top-h) minmax(0, 1fr) var(--bottom-h)',
        rowGap: focus ? 0 : 'var(--gap)',
        transition: 'grid-template-rows 360ms cubic-bezier(.4,0,.2,1), row-gap 360ms ease',
      }}
      data-testid="live-twin"
      data-focus={focus ? 'on' : 'off'}
    >
      <section
        className="grid min-h-0 gap-[var(--gap)]"
        style={{ gridTemplateColumns: '1.27fr 0.98fr 1.42fr 1.06fr', gridTemplateRows: 'minmax(0, 1fr)', ...rowStyle(focus, -1) }}
        aria-label="Incident and recovery status"
        inert={focus}
      >
        <Tile i={0} row="top">
          <FaultCard />
        </Tile>
        <Tile i={1} row="top">
          <FeederStatusCard />
        </Tile>
        <Tile i={2} row="top">
          <RecoveryCard />
        </Tile>
        <Tile i={3} row="top">
          <TimelineCard />
        </Tile>
      </section>
      <section ref={middle} className="relative min-h-0" aria-label="3D twin controls" data-testid="twin-safe-area">
        <div className="pointer-events-none absolute top-0 left-0 flex max-w-[calc(100%-420px)] min-w-[360px]">
          <DemoOverlay />
        </div>
        <div className="pointer-events-none absolute top-0 z-30 flex justify-end transition-[right] duration-200" style={{ right: inspecting ? 'calc(min(360px, 100vw - 24px) + var(--gap))' : 0 }}>
          <SceneToolbar />
        </div>
        <div className="pointer-events-none absolute bottom-0 left-0 flex justify-center transition-[right] duration-200" style={{ right: inspecting ? 'calc(min(360px, 100vw - 24px) + var(--gap))' : 0 }}>
          <PlaybackBar />
        </div>
      </section>
      <section
        className="grid min-h-0 gap-[var(--gap)]"
        style={{ gridTemplateColumns: '1fr 1fr 1.21fr 1.18fr', gridTemplateRows: 'minmax(0, 1fr)', ...rowStyle(focus, 1) }}
        aria-label="Network panels"
        inert={focus}
      >
        <Tile i={0} row="bottom">
          <PowerPanel />
        </Tile>
        <Tile i={1} row="bottom">
          <WaterPanel />
        </Tile>
        <Tile i={2} row="bottom">
          <FacilitiesPanel />
        </Tile>
        <Tile i={3} row="bottom">
          <CityOverviewPanel />
        </Tile>
      </section>
    </motion.div>
  );
}

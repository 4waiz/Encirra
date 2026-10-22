import { useEffect, useRef, type RefObject } from 'react';
import { motion } from 'motion/react';
import { useTwin, type OverlayLayout, type ScreenRect } from '@/state/store';
import { DemoOverlay } from '@/demo/DemoOverlay';
import { LeftRail } from './LeftRail';
import { RightRail } from './RightRail';
import { BottomBar } from './BottomBar';

const OCCLUDERS = ['demo-overlay', 'inspector', 'welcome'];

const rect = (b: DOMRect): ScreenRect => ({ x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) });

/**
 * Publishes store.overlayLayout: the unobstructed centre between the rails, the header and the
 * bottom bar, plus floating elements over it (demo captions, welcome card, inspector), so the 3D
 * scene can centre the district and keep its callouts visible.
 */
function useOverlayLayout(middle: RefObject<HTMLElement | null>) {
  const setOverlayLayout = useTwin((s) => s.setOverlayLayout);
  const selected = useTwin((s) => s.selected);
  const demoActive = useTwin((s) => s.demo.active);
  const welcome = useTwin((s) => s.welcomeOpen);
  const focus = useTwin((s) => s.focusTwin);
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

  // floating elements appear / move with their transitions: re-measure after they settle
  useEffect(() => {
    measureRef.current();
    const t1 = setTimeout(() => measureRef.current(), 380);
    const t2 = setTimeout(() => measureRef.current(), 700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [selected, demoActive, welcome, focus]);

  useEffect(() => () => setOverlayLayout(null), [setOverlayLayout]);
}

const EASE = 'cubic-bezier(.4,0,.2,1)';

/**
 * Live Twin overlay — command centre with side rails: the story on the left, live telemetry on
 * the right, the transport bar along the bottom and the 3D city in the centre (pointer events
 * pass through). Focus mode slides both rails out and shrinks the bar to a pill.
 */
export function LiveTwin() {
  const inspecting = useTwin((s) => s.selected != null);
  const focus = useTwin((s) => s.focusTwin);
  const middle = useRef<HTMLElement>(null);
  useOverlayLayout(middle);
  const rail = (side: 'left' | 'right', hidden: boolean) => ({
    width: 'var(--rail-w)',
    justifySelf: side === 'left' ? ('end' as const) : ('start' as const),
    transform: hidden ? `translateX(${side === 'left' ? 'calc(-100% - 24px)' : 'calc(100% + 24px)'})` : 'none',
    opacity: hidden ? 0 : 1,
    transition: `transform 380ms ${EASE}, opacity 260ms ease`,
  });
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="ui-dark pointer-events-none absolute inset-x-0 top-[var(--header-h)] bottom-[var(--footer-h)] z-10 grid px-[var(--pad-x)] pt-[var(--gap)] pb-[var(--gap)]"
      style={{
        gridTemplateColumns: focus ? '0px minmax(0, 1fr) 0px' : 'var(--rail-w) minmax(0, 1fr) var(--rail-w)',
        gridTemplateRows: focus ? 'minmax(0, 1fr) 52px' : 'minmax(0, 1fr) var(--bar-h)',
        columnGap: focus ? 0 : 'var(--gap)',
        rowGap: 'var(--gap)',
        transition: `grid-template-columns 380ms ${EASE}, grid-template-rows 380ms ${EASE}, column-gap 380ms ease`,
      }}
      data-testid="live-twin"
      data-focus={focus ? 'on' : 'off'}
    >
      <aside
        className="rail-scroll pointer-events-auto flex min-h-0 flex-col gap-[var(--gap)]"
        style={rail('left', focus)}
        aria-label="Incident, recovery and impact"
        data-testid="rail-left"
        inert={focus}
      >
        <LeftRail />
      </aside>
      <section ref={middle} className="relative min-h-0 min-w-0" aria-label="3D twin" data-testid="twin-safe-area">
        <div className="pointer-events-none absolute top-0 left-0 flex w-full max-w-[680px] justify-start">
          <DemoOverlay />
        </div>
      </section>
      <aside
        className="rail-scroll pointer-events-auto flex min-h-0 flex-col gap-[var(--gap)]"
        style={rail('right', focus || inspecting)}
        aria-label="Live telemetry"
        data-testid="rail-right"
        inert={focus || inspecting}
      >
        <RightRail />
      </aside>
      <div className="col-span-3 min-h-0">
        <BottomBar />
      </div>
    </motion.div>
  );
}

/**
 * Live Twin on phones and small tablets.
 *  - Portrait: the 3D twin fills the top of the screen; a bottom sheet (drag handle, snap points
 *    peek / half / full) carries the transport controls, a peek summary and the Story / Live
 *    sections (tabbed, swipeable; side by side on tablets).
 *  - Landscape: twin on the left, Story / Live in a right side sheet, controls along the bottom.
 * Publishes store.overlayLayout with the visible twin rectangle so the scene centres the district
 * and keeps its 3D callouts inside it.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { animate, motion, useDragControls, useMotionValue } from 'motion/react';
import { Maximize2, Minimize2 } from 'lucide-react';
import clsx from 'clsx';
import { useTwin, type OverlayLayout, type ScreenRect } from '@/state/store';
import { useRunCtx } from '@/data/hooks';
import { impactComparison, incidentModel, runMarks } from '@/data/selectors';
import { Segmented } from '@/ui/primitives';
import { CreditLink } from '@/app/Footer';
import { useIsLandscapePhone, useIsTwoColumn } from '@/app/viewport';
import { DemoOverlay } from '@/demo/DemoOverlay';
import { IncidentHero, ImpactCard, PlanBox, RecoveryStepper } from '@/dashboard/LeftRail';
import { FacilitiesModule, OverviewModule, PowerModule, WaterModule } from '@/dashboard/RightRail';
import { DeltaBadge, TONE_FILL, TONE_INK } from '@/dashboard/kit';
import { MoreButton, MoreSheet, StrategyRow, StrategySwitch, TransportRow } from './MobileControls';

type Snap = 'peek' | 'half' | 'full';
type Section = 'story' | 'live';

// ───────────────────────────────────────────────────────────── viewport metrics
function useViewportSize() {
  const read = () => ({ w: window.innerWidth, h: window.visualViewport?.height ?? window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const on = () => setSize(read());
    window.addEventListener('resize', on);
    window.visualViewport?.addEventListener('resize', on);
    return () => {
      window.removeEventListener('resize', on);
      window.visualViewport?.removeEventListener('resize', on);
    };
  }, []);
  return size;
}

function useHeaderHeight() {
  const [h, setH] = useState(48);
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="m-header"]');
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    setH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  return h;
}

const rect = (b: DOMRect): ScreenRect => ({ x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) });
const OCCLUDERS = ['demo-overlay', 'welcome', 'm-controls'];

/** overlayLayout from an invisible element that tracks the visible twin area. */
function usePublishBand(band: RefObject<HTMLElement | null>, deps: unknown[]) {
  const setOverlayLayout = useTwin((s) => s.setOverlayLayout);
  useEffect(() => {
    const el = band.current;
    if (!el) return;
    let raf = 0;
    let last = '';
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
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const t = setTimeout(measure, 450);
    return () => {
      ro.disconnect();
      clearTimeout(t);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band, setOverlayLayout, ...deps]);
  useEffect(() => () => setOverlayLayout(null), [setOverlayLayout]);
}

// ───────────────────────────────────────────────────────────── peek summary
function PeekSummary() {
  const ctx = useRunCtx();
  const runs = useTwin((s) => s.runsByStrategy);
  const comparison = useTwin((s) => s.comparison);
  const topology = useTwin((s) => s.topology);
  const inc = useMemo(() => (ctx ? incidentModel(ctx.run, ctx.topology, ctx.k) : null), [ctx?.run, ctx?.topology, ctx?.k]);
  const impact = useMemo(() => (topology ? impactComparison(runs, comparison, topology) : null), [runs, comparison, topology]);
  if (!ctx || !inc) return <div className="h-[64px]" />;
  const key = impact?.rows.find((r) => r.verdict !== 'same') ?? null;
  const marks = runMarks(ctx.run);
  const preFault = marks.faultT == null || ctx.frame.t < marks.faultT;
  return (
    <div className="grid gap-2" data-testid="m-peek">
      <div className="flex items-center gap-2.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full transition-colors duration-500" style={{ background: TONE_FILL[inc.tone], boxShadow: `0 0 12px ${TONE_FILL[inc.tone]}` }} />
        <h2 className={clsx('min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.01em]', inc.tone === 'neutral' ? 'text-navy' : TONE_INK[inc.tone])} data-testid="m-peek-title">
          {inc.title}
        </h2>
        <span className="shrink-0 text-[13px] font-semibold text-slate tabular">{ctx.frame.clock}</span>
      </div>
      {impact && (
        <div className="flex items-center gap-2 rounded-xl bg-white/[0.05] px-3 py-2" data-testid="m-peek-impact">
          {key ? (
            <>
              <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink">
                <span className="text-slate">{preFault ? 'Projected · ' : ''}</span>
                {key.label}: <b className="font-semibold text-navy tabular">{key.encirraText}</b> <span className="text-slate">Encirra vs</span> <span className="tabular">{key.gridText}</span>{' '}
                <span className="text-slate">Grid-only</span>
              </span>
              <DeltaBadge verdict={key.verdict}>{key.deltaText}</DeltaBadge>
            </>
          ) : (
            <span className="text-[13px] text-ink">
              <b className="font-semibold text-navy">Same plan</b> <span className="text-slate">· Encirra and Grid-only converge in this scenario</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── sections
function SheetFooter() {
  return (
    <div className="grid gap-1 px-1 pt-1 pb-2 text-[12px] text-slate">
      <span>Research Prototype — Synthetic/Benchmark Infrastructure Data · replay of precomputed solver output.</span>
      <CreditLink className="inline-flex min-h-[44px] items-center font-semibold text-ink" />
    </div>
  );
}

function StorySection() {
  return (
    <div className="grid gap-[var(--gap)]" data-testid="m-story">
      <IncidentHero />
      <RecoveryStepper />
      <ImpactCard />
      <PlanBox pinned={false} />
    </div>
  );
}

function LiveSection() {
  return (
    <div className="grid gap-[var(--gap)]" data-testid="m-live">
      <PowerModule />
      <WaterModule />
      <FacilitiesModule />
      <OverviewModule />
    </div>
  );
}

function Sections({ section, setSection, twoColumn }: { section: Section; setSection: (s: Section) => void; twoColumn: boolean }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  if (twoColumn) {
    return (
      <div className="grid grid-cols-2 gap-[var(--gap)]">
        <StorySection />
        <LiveSection />
        <div className="col-span-2">
          <SheetFooter />
        </div>
      </div>
    );
  }
  // horizontal swipe switches Story ↔ Live
  return (
    <div
      onPointerDown={(e) => (start.current = { x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (!s) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) setSection(dx < 0 ? 'live' : 'story');
      }}
    >
      {section === 'story' ? <StorySection /> : <LiveSection />}
      <SheetFooter />
    </div>
  );
}

function SectionTabs({ section, onChange }: { section: Section; onChange: (s: Section) => void }) {
  return (
    <Segmented<Section>
      value={section}
      onChange={onChange}
      size="md"
      stretch
      className="w-full"
      testId="m-sheet-tabs"
      options={[
        { value: 'story', label: 'Story' },
        { value: 'live', label: 'Live telemetry' },
      ]}
    />
  );
}

// ───────────────────────────────────────────────────────────── portrait
function PortraitTwin() {
  const { w, h } = useViewportSize();
  const headerH = useHeaderHeight();
  const twoColumn = useIsTwoColumn();
  const focus = useTwin((s) => s.focusTwin);
  const setFocus = useTwin((s) => s.setFocusTwin);
  const demoActive = useTwin((s) => s.demo.active);
  const selected = useTwin((s) => s.selected);
  const welcome = useTwin((s) => s.welcomeOpen);
  const [snap, setSnap] = useState<Snap>('peek');
  const [section, setSection] = useState<Section>('story');
  const [more, setMore] = useState(false);
  const controls = useDragControls();
  const scroller = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);

  const sheetH = h - headerH;
  const peekH = Math.round(Math.min(Math.max(h * (twoColumn ? 0.38 : 0.4), 300), h * 0.5));
  const offsets: Record<Snap, number> = useMemo(
    () => ({ full: 0, half: Math.max(0, Math.round(h * 0.42) - headerH), peek: Math.max(0, sheetH - peekH) }),
    [h, headerH, sheetH, peekH],
  );
  const hiddenOffset = sheetH - 76; // focus mode: only the transport pill stays
  const target = focus ? hiddenOffset : offsets[snap];
  const y = useMotionValue(target);
  useEffect(() => {
    const c = animate(y, target, { type: 'spring', stiffness: 380, damping: 38 });
    return () => c.stop();
  }, [target, y]);

  // the visible twin: from the header to the sheet top (the full snap keeps the half band)
  const visibleTop = headerH + (focus ? hiddenOffset : snap === 'full' ? offsets.half : offsets[snap]);
  usePublishBand(band, [visibleTop, demoActive, welcome, selected, w]);

  const onDragEnd = (_: unknown, info: { velocity: { y: number } }) => {
    const projected = y.get() + info.velocity.y * 0.18;
    const order: Snap[] = ['full', 'half', 'peek'];
    let best: Snap = 'peek';
    let d = Infinity;
    for (const s of order) {
      const dd = Math.abs(offsets[s] - projected);
      if (dd < d) {
        d = dd;
        best = s;
      }
    }
    if (best === snap) animate(y, offsets[best], { type: 'spring', stiffness: 380, damping: 38 });
    setSnap(best);
  };
  const cycle = () => setSnap((s) => (s === 'peek' ? 'half' : s === 'half' ? 'full' : 'peek'));
  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, a, [role="radio"]')) return;
    controls.start(e);
  };
  const scrollable = !focus && snap !== 'peek';
  useEffect(() => {
    if (snap === 'peek') scroller.current?.scrollTo({ top: 0 });
  }, [snap]);

  return (
    <>
      <div ref={band} aria-hidden className="pointer-events-none fixed inset-x-0" style={{ top: headerH, height: Math.max(80, visibleTop - headerH) }} data-testid="twin-safe-area" />
      {/* demo captions sit above the sheet */}
      <div className="pointer-events-none fixed inset-x-0 z-20 flex justify-center px-2" style={{ bottom: h - visibleTop + 8 }}>
        <DemoOverlay />
      </div>
      <motion.section
        className="ui-dark m-sheet fixed inset-x-0 z-20 flex flex-col rounded-t-[22px] border-t border-white/10 bg-[linear-gradient(180deg,#15243a_0%,#0b1626_140px)] shadow-[0_-18px_48px_-18px_rgba(0,0,0,0.75)]"
        style={{ top: headerH, height: sheetH, y }}
        drag="y"
        dragListener={false}
        dragControls={controls}
        dragConstraints={{ top: 0, bottom: offsets.peek }}
        dragElastic={0.06}
        dragMomentum={false}
        onDragEnd={onDragEnd}
        data-testid="m-sheet"
        data-snap={focus ? 'hidden' : snap}
        aria-label="Story and live telemetry"
      >
        <div className="m-safe-x shrink-0 touch-none pb-2" onPointerDown={startDrag} data-testid="m-controls">
          <button
            type="button"
            onClick={focus ? () => setFocus(false) : cycle}
            className="mx-auto flex h-6 !min-h-[24px] w-24 items-center justify-center"
            aria-label={focus ? 'Show dashboard' : snap === 'full' ? 'Collapse sheet' : 'Expand sheet'}
            data-testid="m-sheet-handle"
          >
            <span className="h-[5px] w-10 rounded-full bg-white/30" />
          </button>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <TransportRow compact={focus} />
            </div>
            {focus && (
              <button type="button" onClick={() => setFocus(false)} className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-[#F2F6FA] px-3 text-[13px] font-semibold text-[#0b1624]" data-testid="m-show-dashboard">
                <Minimize2 size={16} /> Dashboard
              </button>
            )}
          </div>
          {!focus && (
            <div className="mt-2">
              <StrategyRow onMore={() => setMore(true)} />
            </div>
          )}
        </div>
        {!focus && (
          <div className="m-safe-x shrink-0 touch-none border-t border-white/[0.07] pt-3 pb-2" onPointerDown={startDrag}>
            <PeekSummary />
            {!twoColumn && (
              <div className="mt-3">
                <SectionTabs
                  section={section}
                  onChange={(s) => {
                    setSection(s);
                    if (snap === 'peek') setSnap('half');
                  }}
                />
              </div>
            )}
          </div>
        )}
        <div
          ref={scroller}
          className={clsx('m-scroll m-safe-x min-h-0 flex-1 pt-1', scrollable ? 'overflow-y-auto' : '!overflow-hidden')}
          style={{ paddingBottom: `calc(${(focus ? 0 : offsets[snap]) + 16}px + env(safe-area-inset-bottom))` }}
          data-testid="m-sheet-content"
          onClick={() => snap === 'peek' && setSnap('half')}
        >
          <Sections section={section} setSection={setSection} twoColumn={twoColumn} />
        </div>
      </motion.section>
      {!focus && snap === "half" && (
        <button
          type="button"
          onClick={() => setFocus(true)}
          className="ui-dark glass fixed right-2 z-20 flex h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-navy"
          style={{ top: headerH + 8 }}
          aria-label="Focus twin"
          data-testid="m-focus"
        >
          <Maximize2 size={15} /> Twin
        </button>
      )}
      <MoreSheet open={more} onClose={() => setMore(false)} />
    </>
  );
}

// ───────────────────────────────────────────────────────────── landscape
function LandscapeTwin() {
  const { w, h } = useViewportSize();
  const headerH = useHeaderHeight();
  const focus = useTwin((s) => s.focusTwin);
  const setFocus = useTwin((s) => s.setFocusTwin);
  const demoActive = useTwin((s) => s.demo.active);
  const welcome = useTwin((s) => s.welcomeOpen);
  const [section, setSection] = useState<Section>('story');
  const [more, setMore] = useState(false);
  const band = useRef<HTMLDivElement>(null);
  const sideW = focus ? 0 : Math.round(Math.min(380, Math.max(300, w * 0.42)));
  const controlsH = 64;
  usePublishBand(band, [sideW, demoActive, welcome, w, h]);
  return (
    <>
      <div
        ref={band}
        aria-hidden
        className="pointer-events-none fixed left-0"
        style={{ top: headerH, width: w - sideW, height: h - headerH - controlsH }}
        data-testid="twin-safe-area"
      />
      <div className="pointer-events-none fixed left-0 z-20 flex justify-center px-2" style={{ right: sideW, bottom: controlsH + 8 }}>
        <DemoOverlay />
      </div>
      <div
        className="ui-dark glass-solid fixed bottom-0 left-0 z-20 flex items-center gap-2 border-t border-white/10 pr-2 pl-[max(8px,env(safe-area-inset-left))] pb-[env(safe-area-inset-bottom)]"
        style={{ right: sideW, height: `calc(${controlsH}px + env(safe-area-inset-bottom))` }}
        data-testid="m-controls"
      >
        <div className="min-w-0 flex-1">
          <TransportRow />
        </div>
        <MoreButton onClick={() => setMore(true)} />
        {focus && (
          <button type="button" onClick={() => setFocus(false)} className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-[#F2F6FA] px-3 text-[13px] font-semibold text-[#0b1624]" data-testid="m-show-dashboard">
            <Minimize2 size={16} /> Dashboard
          </button>
        )}
      </div>
      <motion.aside
        className="ui-dark m-sheet fixed right-0 bottom-0 z-20 flex flex-col border-l border-white/10 bg-[#0c1828] pr-[env(safe-area-inset-right)]"
        style={{ top: headerH, width: Math.round(Math.min(380, Math.max(300, w * 0.42))) }}
        animate={{ x: focus ? '105%' : 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 40 }}
        data-testid="m-sheet"
        data-snap={focus ? 'hidden' : 'side'}
        aria-label="Story and live telemetry"
      >
        <div className="m-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-[max(12px,env(safe-area-inset-bottom))]" data-testid="m-sheet-content">
          <div className="pt-3">
            <PeekSummary />
          </div>
          <div className="mt-2">
            <StrategySwitch />
          </div>
          <div className="sticky top-0 z-10 -mx-3 mt-2 bg-[#0c1828] px-3 py-2">
            <SectionTabs section={section} onChange={setSection} />
          </div>
          <Sections section={section} setSection={setSection} twoColumn={false} />
        </div>
      </motion.aside>
      <MoreSheet open={more} onClose={() => setMore(false)} />
    </>
  );
}

export function MobileTwin() {
  const landscape = useIsLandscapePhone();
  const focus = useTwin((s) => s.focusTwin);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      data-testid="live-twin"
      data-layout={landscape ? 'landscape' : 'portrait'}
      data-focus={focus ? 'on' : 'off'}
    >
      {landscape ? <LandscapeTwin /> : <PortraitTwin />}
    </motion.div>
  );
}


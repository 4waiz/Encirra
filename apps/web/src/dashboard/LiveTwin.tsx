import { motion } from 'motion/react';
import { useTwin } from '@/state/store';
import { FaultCard, FeederStatusCard, RecoveryCard, TimelineCard } from './TopCards';
import { CityOverviewPanel, FacilitiesPanel, PowerPanel, WaterPanel } from './BottomPanels';
import { PlaybackBar, SceneToolbar } from './Controls';
import { DemoOverlay } from '@/demo/DemoOverlay';

/**
 * Live Twin overlay, matching the reference composition: header (shell) · four top cards ·
 * the 3D city (pointer events pass through) · four bottom panels.
 */
export function LiveTwin() {
  const inspecting = useTwin((s) => s.selected != null);
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
      <section className="relative min-h-0" aria-label="3D twin controls">
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

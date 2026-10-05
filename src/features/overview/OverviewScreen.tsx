import { Box, Cctv, ChevronRight, Maximize2 } from 'lucide-react';
import { useUI } from '../../store/ui';
import { KpiRow } from './KpiRow';
import { AIFusionPanel } from '../../components/panels/AIFusionPanel';
import { StreamHealthPanel } from '../../components/panels/StreamHealthPanel';
import { FieldAssetsPanel } from '../../components/panels/FieldAssetsPanel';
import { TelemetryPanel } from '../../components/panels/TelemetryPanel';
import { EventStreamPanel } from '../../components/panels/EventStreamPanel';
import { ResponseKpisPanel } from '../../components/panels/ResponseKpisPanel';
import { TwinViewport } from '../../components/twin/TwinViewport';
import { TwinHud, LayerToggles } from '../../components/twin/TwinHud';
import { FeedTile } from '../../components/feeds/FeedTile';
import { Panel, IconButton } from '../../components/ui/primitives';
import { FEED_SOURCES } from '../../store/ui';

function TwinPanel() {
  return (
    <Panel
      title="3D Site Digital Twin"
      icon={Box}
      iconColor="#4c94ff"
      className="h-full"
      transparentBody
      actions={
        <>
          <LayerToggles />
          <IconButton
            icon={Maximize2}
            label="Open immersive 3D twin"
            onClick={() => {
              useUI.getState().setScreen('twin');
            }}
          />
        </>
      }
    >
      <TwinViewport compact hud={<TwinHud expandable={false} />} />
    </Panel>
  );
}

function FeedsPanel() {
  return (
    <Panel
      title="Live CCTV + Robot Feeds"
      icon={Cctv}
      iconColor="#3cc8dc"
      className="h-full"
      transparentBody
      actions={
        <button type="button" className="ctl h-[22px]" onClick={() => useUI.getState().setScreen('feeds')}>
          All feeds <ChevronRight size={12} />
        </button>
      }
    >
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-1.5 p-1.5">
        {FEED_SOURCES.map((s) => (
          <FeedTile key={s} source={s} viewId={`overview-${s}`} />
        ))}
      </div>
    </Panel>
  );
}

export function OverviewScreen() {
  return (
    <div className="absolute inset-0 flex flex-col gap-2 p-2">
      <KpiRow />
      <div
        className="grid min-h-0 flex-1 gap-2"
        style={{
          gridTemplateColumns: 'clamp(250px, 17.5vw, 300px) minmax(0, 1fr) minmax(0, 1fr) clamp(340px, 27vw, 500px)',
          gridTemplateRows: 'minmax(0, 1fr) clamp(170px, 23vh, 236px)',
        }}
      >
        <div className="row-span-2 flex min-h-0 flex-col gap-2">
          <div className="min-h-0 flex-[1.15]">
            <AIFusionPanel />
          </div>
          <div className="min-h-0 flex-[0.85]">
            <StreamHealthPanel />
          </div>
          <div className="min-h-0 flex-1">
            <FieldAssetsPanel />
          </div>
        </div>
        <div className="col-span-2 min-h-0">
          <TwinPanel />
        </div>
        <div className="min-h-0">
          <FeedsPanel />
        </div>
        <TelemetryPanel className="min-h-0" />
        <EventStreamPanel className="min-h-0" />
        <ResponseKpisPanel className="min-h-0" />
      </div>
    </div>
  );
}

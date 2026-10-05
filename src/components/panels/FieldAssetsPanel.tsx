import { Truck, ChevronRight, BatteryMedium } from 'lucide-react';
import { useSim } from '../../store/sim';
import { useUI } from '../../store/ui';
import { focusOn } from '../../three/CameraRig';
import { Panel, StatusDot, cx } from '../ui/primitives';
import { ASSET_ICON } from '../twin/TwinMarkers';
import { TONE_HEX } from '../ui/tone';
import { fmtDuration } from '../../utils/format';
import type { AssetId } from '../../types';

const ORDER: AssetId[] = ['UGV-01', 'UAV-01', 'TEAM-1', 'RV-02'];

export function focusAssetFromAnywhere(id: AssetId) {
  const ui = useUI.getState();
  if (ui.screen !== 'overview' && ui.screen !== 'twin') ui.setScreen('twin');
  ui.select({ kind: 'asset', id });
  focusOn({ kind: 'asset', id });
}

export function FieldAssetsPanel({ limit = 4 }: { limit?: number }) {
  const assets = useSim((s) => s.assets);
  const selection = useUI((s) => s.selection);
  return (
    <Panel title="Field assets" icon={Truck}>
      <div className="flex h-full flex-col">
        {ORDER.slice(0, limit).map((id) => {
          const a = assets[id];
          if (!a) return null;
          const Icon = ASSET_ICON[id];
          const sel = selection?.kind === 'asset' && selection.id === id;
          const sub =
            a.eta !== null && a.eta !== undefined
              ? `${a.task} · ETA ${fmtDuration(a.eta)}`
              : a.headcount
                ? `${a.headcount.present} / ${a.headcount.total} on site · ${a.area}`
                : `${a.task} · ${a.area}`;
          return (
            <button
              key={id}
              type="button"
              onClick={() => focusAssetFromAnywhere(id)}
              className={cx('group flex min-h-[40px] flex-1 items-center gap-2.5 border-b border-line px-3 text-left transition-colors last:border-b-0 hover:bg-surface-2', sel && 'bg-surface-2')}
              aria-label={`Focus ${a.name} in the digital twin`}
            >
              <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] bg-[rgb(76_148_255/0.12)]">
                <Icon size={15} strokeWidth={1.9} className="text-blue" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="mono text-[12px] font-medium text-ink-1">{a.name}</span>
                  <span className="flex items-center gap-1 text-[11px]" style={{ color: TONE_HEX[a.tone] }}>
                    <StatusDot tone={a.tone} size={6} pulse={a.status === 'En route'} />
                    {a.status}
                  </span>
                </span>
                <span className="mt-[1px] block truncate text-[10.5px] text-ink-3">{sub}</span>
              </span>
              {a.battery !== null && (
                <span className="num flex items-center gap-1 text-[10.5px] text-ink-3" title="Battery">
                  <BatteryMedium size={12} aria-hidden />
                  {Math.round(a.battery)}%
                </span>
              )}
              <ChevronRight size={14} className="text-ink-4 transition-colors group-hover:text-ink-2" aria-hidden />
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

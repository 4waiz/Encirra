import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { registerFeed, unregisterFeed, updateFeed, type FeedViewSource } from '../../three/viewports';
import { frameBus } from '../../three/frameBus';
import { detect, type Detection } from '../../three/detections';
import type { FeedMode } from '../../store/ui';
import { cx } from '../ui/primitives';

const KIND_COLOR: Record<Detection['kind'], string> = {
  person: '#3dd68c',
  robot: '#f2d03d',
  vehicle: '#3cc8dc',
  structure: '#7fd8b0',
  hotspot: '#ff8a3d',
  aircraft: '#8fd3ff',
};

function bracket(c: string) {
  const g = `linear-gradient(${c},${c})`;
  const L = '9px';
  const T = '1.5px';
  return {
    backgroundImage: [g, g, g, g, g, g, g, g].join(','),
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'top left, top left, top right, top right, bottom left, bottom left, bottom right, bottom right',
    backgroundSize: `${L} ${T}, ${T} ${L}, ${L} ${T}, ${T} ${L}, ${L} ${T}, ${T} ${L}, ${L} ${T}, ${T} ${L}`,
  };
}

/** Pool of DOM boxes positioned from projected scene objects at the feed's render rate. */
function DetectionOverlay({ viewId, exclude, compact, onDetections }: { viewId: string; exclude?: string; compact?: boolean; onDetections?: (d: Detection[]) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onDetections);
  cb.current = onDetections;
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const pool: HTMLDivElement[] = [];
    return frameBus.onFeed(viewId, (f) => {
      const dets = detect(f.camera, f.rect.width, f.rect.height, f.t, exclude);
      cb.current?.(dets);
      while (pool.length < dets.length) {
        const box = document.createElement('div');
        box.className = 'absolute rounded-[1px]';
        const label = document.createElement('div');
        label.className = 'absolute left-[-1px] whitespace-nowrap rounded-[2px] px-1 font-mono font-medium text-[#0b0f14]';
        box.appendChild(label);
        host.appendChild(box);
        pool.push(box);
      }
      pool.forEach((box, i) => {
        const d = dets[i];
        if (!d) {
          box.style.display = 'none';
          return;
        }
        const c = KIND_COLOR[d.kind];
        box.style.display = 'block';
        box.style.left = `${d.x}px`;
        box.style.top = `${d.y}px`;
        box.style.width = `${Math.max(6, d.w)}px`;
        box.style.height = `${Math.max(6, d.h)}px`;
        Object.assign(box.style, bracket(c));
        box.style.boxShadow = `inset 0 0 0 1px ${c}55`;
        const label = box.firstChild as HTMLDivElement;
        label.style.background = c;
        label.style.fontSize = compact ? '9.5px' : '10.5px';
        label.style.lineHeight = compact ? '13px' : '15px';
        label.style.top = compact ? '-14px' : '-16px';
        label.textContent = `${d.label} ${Math.round(d.confidence * 100)}%${d.extra ? ` · ${d.extra}` : ''}`;
      });
    });
  }, [viewId, exclude, compact]);
  return <div ref={ref} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />;
}

export function FeedViewport({
  viewId,
  source,
  mode,
  size,
  pip,
  detections = true,
  compact,
  className,
  children,
  onDetections,
}: {
  viewId: string;
  source: FeedViewSource;
  mode: FeedMode;
  size: 'thumb' | 'large';
  pip?: { x: number; z: number };
  detections?: boolean;
  compact?: boolean;
  className?: string;
  children?: ReactNode;
  onDetections?: (d: Detection[]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    registerFeed({ id: viewId, el: ref.current, source, mode, size, pip });
    return () => unregisterFeed(viewId);
  }, [viewId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    updateFeed(viewId, { source, mode, size, pip });
  }, [viewId, source, mode, size, pip?.x, pip?.z]); // eslint-disable-line react-hooks/exhaustive-deps

  const exclude = source === 'UGV-01' ? 'ugv' : source === 'UAV-01' ? 'uav' : undefined;
  return (
    <div ref={ref} className={cx('hole', className)}>
      {detections && <DetectionOverlay viewId={viewId} exclude={exclude} compact={compact} onDetections={onDetections} />}
      {children}
    </div>
  );
}

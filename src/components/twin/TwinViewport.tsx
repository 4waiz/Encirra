import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import type * as THREE from 'three';
import { useProgress } from '@react-three/drei';
import { useViewports } from '../../three/viewports';
import { frameBus } from '../../three/frameBus';
import { pickAt } from '../../three/picking';
import { focusOn } from '../../three/CameraRig';
import { useUI } from '../../store/ui';
import { useSceneStatus } from '../../three/sceneStatus';
import { TwinMarkers } from './TwinMarkers';
import { cx } from '../ui/primitives';

function SceneLoading() {
  const ready = useSceneStatus((s) => s.ready);
  const error = useSceneStatus((s) => s.error);
  const { progress, item } = useProgress();
  if (ready && !error) return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg-1" role="status" aria-live="polite">
      <div className="skeleton absolute inset-0 opacity-60" />
      <div className="relative flex w-[280px] flex-col gap-2">
        <div className="flex items-center justify-between font-cond text-[11px] uppercase tracking-[0.12em] text-ink-2">
          <span>{error ? 'Renderer unavailable' : 'Loading digital twin'}</span>
          {!error && <span className="mono text-ink-1">{Math.round(progress)}%</span>}
        </div>
        {!error && (
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-[rgb(148_163_184/0.14)]">
            <div className="h-full rounded-full bg-cyan transition-[width] duration-300" style={{ width: `${Math.max(4, progress)}%` }} />
          </div>
        )}
        <div className="truncate text-[10.5px] text-ink-3">{error ?? (item ? `Streaming ${item.split('/').pop()}` : 'Compiling scene shaders…')}</div>
      </div>
    </div>
  );
}

/**
 * Transparent window onto the shared WebGL canvas. Camera controls and picking listen on a
 * dedicated input layer; overlays and HUD sit above it so their clicks never move the camera.
 */
export function TwinViewport({ hud, compact, className }: { hud?: ReactNode; compact?: boolean; className?: string }) {
  const rectRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const frame = useRef<{ camera: THREE.PerspectiveCamera; rect: { left: number; top: number; width: number; height: number } } | null>(null);

  useLayoutEffect(() => {
    const rectEl = rectRef.current;
    const inputEl = inputRef.current;
    if (!rectEl || !inputEl) return;
    const entry = { rectEl, inputEl };
    useViewports.getState().setMain(entry);
    return () => {
      if (useViewports.getState().main === entry) useViewports.getState().setMain(null);
    };
  }, []);

  useEffect(() => frameBus.onMain((f) => (frame.current = f)), []);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    let down: { x: number; y: number; t: number } | null = null;
    let raf = 0;
    let lastMove: PointerEvent | null = null;

    const doPick = (e: { clientX: number; clientY: number }) => {
      const f = frame.current;
      if (!f) return null;
      return pickAt(e.clientX, e.clientY, f.rect, f.camera);
    };
    const onMove = (e: PointerEvent) => {
      lastMove = e;
      if (down || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!lastMove || down) return;
        const hit = doPick(lastMove);
        useUI.getState().setHovered(hit ? hit.selection : null);
        el.style.cursor = hit ? 'pointer' : '';
      });
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 450;
      down = null;
      if (moved > 5 || !quick || e.button !== 0) return;
      const hit = doPick(e);
      const ui = useUI.getState();
      if (hit) ui.select(hit.selection);
      else ui.select(null);
    };
    const onDbl = (e: MouseEvent) => {
      const hit = doPick(e);
      if (hit) focusOn(hit.selection);
    };
    const onLeave = () => {
      useUI.getState().setHovered(null);
      el.style.cursor = '';
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('dblclick', onDbl);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('dblclick', onDbl);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <div ref={rectRef} className={cx('hole absolute inset-0', className)}>
      <div
        ref={inputRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        aria-label="Interactive 3D digital twin. Drag to orbit, right-drag to pan, scroll to zoom."
        role="application"
      />
      <TwinMarkers compact={compact} />
      {hud}
      <SceneLoading />
      <div className="pointer-events-none absolute inset-0 rounded-b-[7px]" style={{ boxShadow: '0 0 0 14px var(--color-bg-0), inset 0 0 0 1px rgb(148 163 184 / 0.06)' }} />
    </div>
  );
}

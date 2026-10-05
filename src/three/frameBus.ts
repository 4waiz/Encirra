import type * as THREE from 'three';

// Per-frame notifications from the render loop to DOM overlays (markers, labels, detection boxes).
// Overlays update their own element styles directly — no React state changes per frame.

export interface ViewFrame {
  camera: THREE.PerspectiveCamera;
  /** rectangle of the view relative to the window */
  rect: { left: number; top: number; width: number; height: number };
  /** scene time (ms, wall clock; replay-aware) */
  t: number;
}

type Listener = (f: ViewFrame) => void;

const mainListeners = new Set<Listener>();
const feedListeners = new Map<string, Set<Listener>>();

export const frameBus = {
  onMain(fn: Listener) {
    mainListeners.add(fn);
    return () => void mainListeners.delete(fn);
  },
  emitMain(f: ViewFrame) {
    for (const fn of mainListeners) fn(f);
  },
  onFeed(id: string, fn: Listener) {
    let set = feedListeners.get(id);
    if (!set) {
      set = new Set();
      feedListeners.set(id, set);
    }
    set.add(fn);
    return () => void set?.delete(fn);
  },
  emitFeed(id: string, f: ViewFrame) {
    const set = feedListeners.get(id);
    if (set) for (const fn of set) fn(f);
  },
};

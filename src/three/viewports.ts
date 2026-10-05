import { create } from 'zustand';
import type { FeedMode, FeedSource } from '../store/ui';

// One WebGL canvas covers the whole window behind the UI. DOM "holes" register here and the render
// loop draws the main twin view and every camera feed into their screen rectangles (scissor), so all
// views share a single scene, GPU context and asset set.

export interface MainViewport {
  /** element whose rectangle receives the main render */
  rectEl: HTMLElement;
  /** element that receives camera-control and picking input */
  inputEl: HTMLElement;
}

export const useViewports = create<{ main: MainViewport | null; setMain: (m: MainViewport | null) => void }>((set) => ({
  main: null,
  setMain: (main) => set({ main }),
}));

export type FeedViewSource = FeedSource | 'PIP';

export interface FeedView {
  id: string;
  el: HTMLElement;
  source: FeedViewSource;
  mode: FeedMode;
  size: 'thumb' | 'large';
  /** for 'PIP': orbit centre */
  pip?: { x: number; z: number };
}

export const feedViews = new Map<string, FeedView>();

export function registerFeed(v: FeedView) {
  feedViews.set(v.id, v);
}

export function updateFeed(id: string, patch: Partial<FeedView>) {
  const v = feedViews.get(id);
  if (v) feedViews.set(id, { ...v, ...patch });
}

export function unregisterFeed(id: string) {
  feedViews.delete(id);
}

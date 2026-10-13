/**
 * Scene-local runtime state (not part of the app store): quality tier, animated layer fades and
 * shared per-frame values. Mutable module state read inside useFrame callbacks.
 */
import { create } from 'zustand';

export type QualityTier = 'high' | 'medium' | 'low';

interface SceneQuality {
  tier: QualityTier;
  setTier: (t: QualityTier) => void;
}

function initialTier(): QualityTier {
  if (typeof window === 'undefined') return 'high';
  const q = new URLSearchParams(window.location.search).get('quality');
  if (q === 'high' || q === 'medium' || q === 'low') return q;
  return 'high';
}

export const useSceneQuality = create<SceneQuality>()((set) => ({
  tier: initialTier(),
  setTier: (tier) => set({ tier }),
}));

export const fx = {
  time: 0,
  /** 0 = normal, 1 = full underground x-ray */
  xray: 0,
  surfaceFade: 1,
  electrical: 1,
  water: 1,
  skyline: 1,
  frames: 0,
  ready: false,
};

import { create } from 'zustand';

/** Loading / failure state of the shared 3D canvas (read by DOM overlays and the boot screen). */
export const useSceneStatus = create<{ ready: boolean; error: string | null; setReady: () => void; setError: (e: string) => void }>((set) => ({
  ready: false,
  error: null,
  setReady: () => set({ ready: true }),
  setError: (error) => set({ error }),
}));

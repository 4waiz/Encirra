import type { Frame, NetworkTopology, RunResult } from '@encirra/shared';
import { useTwin, useFrame, useFrameIndex } from '@/state/store';

export interface RunCtx {
  run: RunResult;
  topology: NetworkTopology;
  frame: Frame;
  k: number; // integer frame index
}

/** Run + topology + current frame, or null while loading. Re-renders on frame changes only. */
export function useRunCtx(): RunCtx | null {
  const run = useTwin((s) => s.run);
  const topology = useTwin((s) => s.topology);
  const frame = useFrame();
  const k = useFrameIndex();
  if (!run || !topology || !frame) return null;
  return { run, topology, frame, k };
}

export function useSource() {
  const dataSource = useTwin((s) => s.dataSource);
  const devFixture = useTwin((s) => s.devFixture);
  return { dataSource, devFixture, live: dataSource === 'live' };
}

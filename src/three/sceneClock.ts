import { useUI } from '../store/ui';
import { engine } from '../simulation/engine';

// Scene time used by every 3D layer: wall clock when live, the playback cursor when replaying.

export const sceneClock = {
  t: Date.now(),
  replay: false,
  lastPush: 0,
};

export function advanceSceneClock(dtMs: number) {
  const ui = useUI.getState();
  const pb = ui.playback;
  if (pb.mode === 'live') {
    sceneClock.t = Date.now();
    sceneClock.replay = false;
    return;
  }
  sceneClock.replay = true;
  let t = pb.cursor;
  if (pb.playing) {
    t = Math.min(Date.now(), pb.cursor + dtMs * pb.speed);
    const now = performance.now();
    // push cursor to the UI at ~8 Hz for the timeline scrubber; keep exact value locally
    if (now - sceneClock.lastPush > 120 || t >= Date.now() - 50) {
      sceneClock.lastPush = now;
      if (t >= Date.now() - 50) ui.goLive();
      else ui.setPlayback({ cursor: t });
    } else {
      // advance locally between pushes
      pb.cursor = t;
    }
  }
  sceneClock.t = Math.max(engine.bootTime - 1800 * 1000, t);
}

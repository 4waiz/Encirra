/**
 * Data orchestration: decides the source (live solver → replay files → dev fixture), loads the
 * topology, scenario definitions and ALL three strategies of the current scenario (the dashboard
 * compares them), and pushes everything into the store unchanged.
 */
import type { Comparison, ObjectiveWeights, RunResult, ScenarioId, ScenarioParams, StrategyId } from '@encirra/shared';
import { useTwin, type PageId } from '@/state/store';
import { DataError, STRATEGIES, detectBackend, liveApi, replayApi } from './api';

type Runs = Record<StrategyId, RunResult>;

const PAGES: PageId[] = ['live', 'analytics', 'scenarios', 'assets', 'reports'];

async function fetchRuns(scenarioId: ScenarioId, extra?: { params?: Partial<ScenarioParams>; weights?: Partial<ObjectiveWeights> }): Promise<Runs> {
  const s = useTwin.getState();
  if (s.dataSource === 'live') return liveRuns(scenarioId, extra);
  if (!s.manifest) throw new DataError('Replay manifest not loaded');
  const manifest = s.manifest;
  const list = await Promise.all(STRATEGIES.map((strategy) => replayApi.run(manifest, scenarioId, strategy)));
  return Object.fromEntries(STRATEGIES.map((st, i) => [st, list[i]])) as Runs;
}

async function fetchComparison(scenarioId: ScenarioId): Promise<Comparison | null> {
  const s = useTwin.getState();
  try {
    if (s.dataSource === 'live') return await liveApi.compare(scenarioId);
    if (s.manifest) return await replayApi.comparison(s.manifest, scenarioId);
  } catch (err) {
    console.warn('[encirra] comparison unavailable; the dashboard derives it from the loaded runs', err);
  }
  return null;
}

function urlOptions() {
  const q = new URLSearchParams(window.location.search);
  const page = q.get('page') as PageId | null;
  const strategy = q.get('strategy') as StrategyId | null;
  const frame = q.get('frame');
  return {
    page: page && PAGES.includes(page) ? page : null,
    scenario: q.get('scenario') as ScenarioId | null,
    strategy: strategy && STRATEGIES.includes(strategy) ? strategy : null,
    frame: frame != null && !Number.isNaN(Number(frame)) ? Number(frame) : null,
  };
}

async function liveRuns(scenarioId: ScenarioId, extra?: { params?: Partial<ScenarioParams>; weights?: Partial<ObjectiveWeights> }): Promise<Runs> {
  const list = await Promise.all(STRATEGIES.map((strategy) => liveApi.run({ scenarioId, strategy, ...extra })));
  return Object.fromEntries(list.map((r) => [r.strategy, r])) as Runs;
}

/**
 * Switch to the live solver. Everything is fetched first and swapped in at once, so the replay
 * stays on screen (and interactive) while the service computes.
 */
async function upgradeToLive(scenarioId: ScenarioId | null, keepPlayhead: boolean) {
  const [topology, scenarios] = await Promise.all([liveApi.topology(), liveApi.scenarios()]);
  const wanted = scenarioId ?? useTwin.getState().scenarioId;
  const id = scenarios.some((d) => d.id === wanted) ? wanted : (scenarios[0]?.id ?? 'feeder-fault');
  const runs = await liveRuns(id);
  let comparison: Comparison | null = null;
  try {
    comparison = await liveApi.compare(id);
  } catch (err) {
    console.warn('[encirra] live comparison unavailable; derived from the runs', err);
  }
  const st = useTwin.getState();
  const scenarioChanged = st.scenarioId !== id && st.dataSource === 'replay' && st.run != null;
  st.setData({ dataSource: 'live', topology, scenarios, manifest: null });
  if (scenarioChanged) {
    // the viewer switched scenario while the service was computing: reload that one live
    st.setData({ comparison: null });
    await loadScenario(st.scenarioId);
    return;
  }
  st.setRuns(runs, st.strategy, { resetPlayhead: !keepPlayhead });
  st.setData({ comparison });
}

async function startReplay(scenarioId: ScenarioId | null, strategy: StrategyId | null) {
  const st = useTwin.getState();
  const manifest = await replayApi.manifest();
  const topology = await replayApi.topology(manifest);
  const scenarios = manifest.scenarios.map((s) => s.definition);
  const id = scenarioId && scenarios.some((d) => d.id === scenarioId) ? scenarioId : manifest.defaultScenario;
  st.setData({ dataSource: 'replay', topology, scenarios, manifest });
  const runs = await fetchRuns(id);
  st.setRuns(runs, strategy ?? manifest.defaultStrategy, { resetPlayhead: true });
  st.setData({ comparison: await fetchComparison(id) });
}

let booted = false;

function applyUrlOptions(opts: ReturnType<typeof urlOptions>) {
  const st = useTwin.getState();
  if (opts.page) st.setPage(opts.page);
  if (opts.frame != null) st.setPlayhead(opts.frame);
}

/**
 * Loads the default working example (scenario feeder-fault, strategy Encirra, playhead at the
 * start) from the bundled replay immediately; if the live simulation service answers, the same
 * scenario is then recomputed live in the background and swapped in.
 */
export async function bootstrap(): Promise<void> {
  if (booted) return;
  booted = true;
  const st = useTwin.getState();
  const opts = urlOptions();
  st.setData({ dataSource: 'loading', busy: 'Loading simulation data…', dataError: null });

  const healthP = detectBackend();
  let replayError: Error | null = null;
  try {
    await startReplay(opts.scenario, opts.strategy);
    applyUrlOptions(opts);
    st.setData({ busy: null });
  } catch (err) {
    replayError = err as Error;
  }

  const health = await healthP;
  if (health) {
    const replayShown = replayError == null;
    st.setData({ health, liveSync: 'syncing', busy: replayShown ? null : 'Running the live solver…' });
    try {
      await upgradeToLive(opts.scenario, replayShown);
      if (!replayShown) {
        if (opts.strategy) useTwin.getState().switchStrategy(opts.strategy);
        applyUrlOptions(opts);
      }
      st.setData({ liveSync: 'idle', busy: null });
      return;
    } catch (err) {
      console.warn('[encirra] live simulation service failed; staying on the replay files', err);
      st.setData({ health: null, liveSync: 'failed' });
    }
  }
  if (replayError) st.setData({ dataSource: 'error', dataError: replayError.message, busy: null });
  else st.setData({ busy: null });
}

/** Switch scenario: loads all three strategies (keeps the selected strategy, rewinds the playhead). */
export async function loadScenario(scenarioId: ScenarioId): Promise<void> {
  const st = useTwin.getState();
  if (st.busy || st.dataSource === 'loading' || st.dataSource === 'error') return;
  st.setPlaying(false);
  st.setData({ busy: st.dataSource === 'live' ? 'Running the live solver…' : 'Loading replay…', runError: null });
  try {
    const runs = await fetchRuns(scenarioId);
    const comparison = await fetchComparison(scenarioId);
    useTwin.getState().setRuns(runs, useTwin.getState().strategy, { resetPlayhead: true });
    useTwin.getState().setData({ comparison, busy: null });
  } catch (err) {
    useTwin.getState().setData({ busy: null, runError: (err as Error).message });
  }
}

/** Live mode only: recompute all three strategies with edited parameters and objective weights. */
export async function recompute(params: Partial<ScenarioParams>, weights: Partial<ObjectiveWeights>): Promise<boolean> {
  const st = useTwin.getState();
  if (st.dataSource !== 'live' || st.busy) return false;
  st.setPlaying(false);
  st.setData({ busy: 'Recomputing with the live solver…', runError: null });
  try {
    const runs = await fetchRuns(st.scenarioId, { params, weights });
    useTwin.getState().setRuns(runs, useTwin.getState().strategy, { resetPlayhead: true });
    // /api/compare reflects default parameters; with custom inputs the comparison is derived from these runs.
    useTwin.getState().setData({ comparison: null, busy: null });
    return true;
  } catch (err) {
    useTwin.getState().setData({ busy: null, runError: (err as Error).message });
    return false;
  }
}

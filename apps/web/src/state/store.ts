/**
 * Encirra application store (zustand).
 *
 * Two kinds of state live here and must not be confused:
 *  - AUTHORITATIVE simulation data (`topology`, `run`, `comparison`, …) exactly as returned by the
 *    simulation service or its precomputed replay files. Components never mutate it.
 *  - PRESENTATION state (page, selection, layers, camera requests, playback position, demo mode).
 *
 * Shared contract between the dashboard UI (src/app, src/dashboard, src/pages…) and the 3D twin
 * (src/scene/**). Fields may be added; existing fields keep their meaning.
 */
import { create } from 'zustand';
import type {
  Comparison,
  Frame,
  HealthResponse,
  NetworkTopology,
  ObjectiveWeights,
  ReplayManifest,
  RunResult,
  ScenarioDefinition,
  ScenarioId,
  ScenarioParams,
  StrategyId,
} from '@encirra/shared';

export type PageId = 'live' | 'analytics' | 'scenarios' | 'assets' | 'reports';
export type DataSource = 'loading' | 'live' | 'replay' | 'error';

export type SelectionKind = 'facility' | 'building' | 'bus' | 'line' | 'switch' | 'pump' | 'pipe' | 'tank' | 'junction';
/** ids are strings: facility id, building id, String(busId), String(lineId), switch id, pump id, pipe id, tank id, junction id */
export interface Selection {
  kind: SelectionKind;
  id: string;
}

export interface Layers {
  surface: boolean; // buildings, roads, props
  electrical: boolean; // glowing cable network
  water: boolean; // pipe network + flow
  underground: boolean; // x-ray: fade the surface to reveal the full underground network
  labels: boolean; // 3D callouts
  skyline: boolean; // background context city (not part of the model)
}

/** Named camera shots implemented by src/scene/camera (keep names in sync). */
export type CameraShot =
  | 'home' // default reference composition
  | 'aerial' // high establishing shot
  | 'substation'
  | 'hospital'
  | 'ps-1'
  | 'ps-2'
  | 'tank-t1'
  | 'tank-t2'
  | 'west-district' // faulted Feeder F3 area
  | 'underground-west' // cut-away view of the West water main / PS-2
  | 'underground-front' // full front cut-away
  | 'recovery-path' // view framing the tie switches used by the plan
  | 'overview-top'; // near top-down

export interface CameraRequest {
  nonce: number; // increments on every request so identical requests still fire
  shot?: CameraShot;
  focus?: Selection; // frame a specific asset
  durationS?: number;
}

export type OverviewMode = 'power' | 'water' | 'combined';

export interface DemoState {
  active: boolean;
  paused: boolean;
  stepIndex: number; // index into the demo script
  stepStartedAt: number; // performance.now() when the step began
  elapsedS: number; // seconds into the demo script (updated a few times per second)
}

export interface TwinState {
  // ── navigation
  page: PageId;
  setPage: (page: PageId) => void;

  // ── authoritative data
  dataSource: DataSource;
  dataError: string | null;
  /** /api/health response when the live simulation service is reachable */
  health: HealthResponse | null;
  /** background upgrade from the bundled replay to the live solver: 'syncing' while it computes */
  liveSync: 'idle' | 'syncing' | 'failed';
  topology: NetworkTopology | null;
  manifest: ReplayManifest | null;
  scenarios: ScenarioDefinition[];
  scenarioId: ScenarioId;
  strategy: StrategyId;
  params: ScenarioParams | null;
  weights: ObjectiveWeights | null;
  run: RunResult | null;
  runsByStrategy: Partial<Record<StrategyId, RunResult>>;
  comparison: Comparison | null;
  /** human-readable progress message while a scenario loads or the live solver recomputes */
  busy: string | null;
  /** last error from a scenario load / live recompute (the previous data stays displayed) */
  runError: string | null;

  // ── playback (frame cursor over run.frames)
  playhead: number; // fractional frame position, 0 … frames.length − 1
  playing: boolean;
  speed: number; // simulated minutes per real second

  // ── presentation
  selected: Selection | null;
  hovered: Selection | null;
  layers: Layers;
  overviewMode: OverviewMode;
  camera: { mode: 'orbit' | 'cinematic'; request: CameraRequest | null };
  /** slow automatic orbit of the 3D camera (scene reads it) */
  autoOrbit: boolean;
  demo: DemoState;
  whyPlanOpen: boolean;
  aboutOpen: boolean;

  // ── actions
  setData: (
    patch: Partial<
      Pick<
        TwinState,
        | 'dataSource'
        | 'dataError'
        | 'health'
        | 'liveSync'
        | 'topology'
        | 'manifest'
        | 'scenarios'
        | 'comparison'
        | 'busy'
        | 'runError'
      >
    >,
  ) => void;
  setRun: (run: RunResult) => void;
  /** Replace all runs of the current scenario at once and show `strategy`. */
  setRuns: (runs: Partial<Record<StrategyId, RunResult>>, strategy: StrategyId, opts?: { resetPlayhead?: boolean }) => void;
  setScenario: (id: ScenarioId) => void;
  setStrategy: (s: StrategyId) => void;
  /** Show another strategy of the loaded scenario (keeps the playhead: all strategies share one timebase). */
  switchStrategy: (s: StrategyId) => void;
  setParams: (p: ScenarioParams | null) => void;
  setWeights: (w: ObjectiveWeights | null) => void;
  setPlayhead: (p: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  setSelected: (s: Selection | null) => void;
  setHovered: (s: Selection | null) => void;
  setLayer: (layer: keyof Layers, on: boolean) => void;
  toggleLayer: (layer: keyof Layers) => void;
  setOverviewMode: (m: OverviewMode) => void;
  requestCamera: (req: Omit<CameraRequest, 'nonce'>) => void;
  setCameraMode: (mode: 'orbit' | 'cinematic') => void;
  setAutoOrbit: (on: boolean) => void;
  setDemo: (patch: Partial<DemoState>) => void;
  setWhyPlanOpen: (open: boolean) => void;
  setAboutOpen: (open: boolean) => void;
}

let cameraNonce = 0;

export const useTwin = create<TwinState>()((set, get) => ({
  page: 'live',
  setPage: (page) => set({ page }),

  dataSource: 'loading',
  dataError: null,
  health: null,
  liveSync: 'idle',
  topology: null,
  manifest: null,
  scenarios: [],
  scenarioId: 'feeder-fault',
  strategy: 'encirra',
  params: null,
  weights: null,
  run: null,
  runsByStrategy: {},
  comparison: null,
  busy: null,
  runError: null,

  playhead: 0,
  playing: false,
  speed: 2,

  selected: null,
  hovered: null,
  layers: { surface: true, electrical: true, water: true, underground: false, labels: true, skyline: true },
  overviewMode: 'power',
  camera: { mode: 'orbit', request: null },
  autoOrbit: false,
  demo: { active: false, paused: false, stepIndex: 0, stepStartedAt: 0, elapsedS: 0 },
  whyPlanOpen: false,
  aboutOpen: false,

  setData: (patch) => set(patch),
  setRun: (run) =>
    set((s) => ({
      run,
      runsByStrategy: { ...s.runsByStrategy, [run.strategy]: run },
      playhead: Math.min(s.playhead, Math.max(0, run.frames.length - 1)),
    })),
  setRuns: (runs, strategy, opts) =>
    set((s) => {
      const run = runs[strategy] ?? Object.values(runs)[0] ?? null;
      const n = run?.frames.length ?? 1;
      return {
        runsByStrategy: runs,
        strategy: run?.strategy ?? strategy,
        run,
        scenarioId: run?.scenarioId ?? s.scenarioId,
        params: run?.params ?? s.params,
        weights: run?.weights ?? s.weights,
        playhead: opts?.resetPlayhead ? 0 : Math.max(0, Math.min(n - 1, s.playhead)),
        playing: opts?.resetPlayhead ? false : s.playing,
      };
    }),
  setScenario: (scenarioId) => set({ scenarioId }),
  setStrategy: (strategy) => set({ strategy }),
  switchStrategy: (strategy) =>
    set((s) => {
      const run = s.runsByStrategy[strategy];
      if (!run) return { strategy };
      return { strategy, run, playhead: Math.max(0, Math.min(run.frames.length - 1, s.playhead)) };
    }),
  setParams: (params) => set({ params }),
  setWeights: (weights) => set({ weights }),
  setPlayhead: (p) => {
    const n = get().run?.frames.length ?? 1;
    set({ playhead: Math.max(0, Math.min(n - 1, p)) });
  },
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setSelected: (selected) => set({ selected }),
  setHovered: (hovered) => set({ hovered }),
  setLayer: (layer, on) => set((s) => ({ layers: { ...s.layers, [layer]: on } })),
  toggleLayer: (layer) => set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
  setOverviewMode: (overviewMode) => set({ overviewMode }),
  requestCamera: (req) => set((s) => ({ camera: { ...s.camera, request: { ...req, nonce: ++cameraNonce } } })),
  setCameraMode: (mode) => set((s) => ({ camera: { ...s.camera, mode } })),
  setAutoOrbit: (autoOrbit) => set({ autoOrbit }),
  setDemo: (patch) => set((s) => ({ demo: { ...s.demo, ...patch } })),
  setWhyPlanOpen: (whyPlanOpen) => set({ whyPlanOpen }),
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
}));

/** Current frame (integer cursor) — null until a run is loaded. */
export function selectFrame(s: TwinState): Frame | null {
  const frames = s.run?.frames;
  if (!frames || frames.length === 0) return null;
  return frames[Math.max(0, Math.min(frames.length - 1, Math.floor(s.playhead)))];
}

export const useFrame = () => useTwin(selectFrame);

/** Integer frame index of the playhead (re-renders only when the frame changes). */
export function selectFrameIndex(s: TwinState): number {
  const n = s.run?.frames.length ?? 0;
  if (n === 0) return 0;
  return Math.max(0, Math.min(n - 1, Math.floor(s.playhead)));
}

export const useFrameIndex = () => useTwin(selectFrameIndex);

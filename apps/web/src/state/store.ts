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
}

export interface TwinState {
  // ── navigation
  page: PageId;
  setPage: (page: PageId) => void;

  // ── authoritative data
  dataSource: DataSource;
  dataError: string | null;
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
  demo: DemoState;
  whyPlanOpen: boolean;
  aboutOpen: boolean;

  // ── actions
  setData: (patch: Partial<Pick<TwinState, 'dataSource' | 'dataError' | 'topology' | 'manifest' | 'scenarios' | 'comparison'>>) => void;
  setRun: (run: RunResult) => void;
  setScenario: (id: ScenarioId) => void;
  setStrategy: (s: StrategyId) => void;
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

  playhead: 0,
  playing: false,
  speed: 2,

  selected: null,
  hovered: null,
  layers: { surface: true, electrical: true, water: true, underground: false, labels: true, skyline: true },
  overviewMode: 'power',
  camera: { mode: 'orbit', request: null },
  demo: { active: false, paused: false, stepIndex: 0, stepStartedAt: 0 },
  whyPlanOpen: false,
  aboutOpen: false,

  setData: (patch) => set(patch),
  setRun: (run) =>
    set((s) => ({
      run,
      runsByStrategy: { ...s.runsByStrategy, [run.strategy]: run },
      playhead: Math.min(s.playhead, Math.max(0, run.frames.length - 1)),
    })),
  setScenario: (scenarioId) => set({ scenarioId }),
  setStrategy: (strategy) => set({ strategy }),
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

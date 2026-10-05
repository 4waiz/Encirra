import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AssetId, ScenarioParams } from '../types';

export type Screen = 'overview' | 'twin' | 'feeds' | 'insights' | 'incidents';
export const SCREENS: Screen[] = ['overview', 'twin', 'feeds', 'insights', 'incidents'];

export type LayerId = 'radiation' | 'chemical' | 'biological' | 'assets' | 'weather' | 'zones';

export type Selection =
  | { kind: 'sensor'; id: string }
  | { kind: 'asset'; id: AssetId }
  | { kind: 'zone'; id: string }
  | { kind: 'location'; x: number; z: number; label: string }
  | null;

export type FeedSource = 'CAM-01' | 'CAM-02' | 'UGV-01' | 'UAV-01';
export const FEED_SOURCES: FeedSource[] = ['CAM-01', 'CAM-02', 'UGV-01', 'UAV-01'];
export type FeedMode = 'visible' | 'thermal' | 'fusion';
export type EventFilter = 'all' | 'chem' | 'bio' | 'rad' | 'assets';
export type Quality = 'high' | 'balanced';

export interface Ptz {
  yaw: number;
  pitch: number;
  zoom: number;
}

interface PlaybackState {
  mode: 'live' | 'replay';
  cursor: number;
  playing: boolean;
  speed: 1 | 2 | 4;
}

interface UIState {
  screen: Screen;
  layers: Record<LayerId, boolean>;
  selection: Selection;
  hovered: Selection;
  selectedIncidentId: string | null;
  selectedObservationId: string | null;
  feedMain: FeedSource;
  feedModes: Record<FeedSource, FeedMode>;
  feedOverlays: boolean;
  ptz: Record<'CAM-01' | 'CAM-02', Ptz>;
  /** distance (m) the virtual view of each fixed camera has been moved from its mount */
  feedMoved: Record<'CAM-01' | 'CAM-02', number>;
  telemetry: { paused: boolean; pausedAt: number | null; range: 5 | 15 | 30; series: { chem: boolean; bio: boolean; rad: boolean } };
  eventFilter: EventFilter;
  playback: PlaybackState;
  settings: { quality: Quality; labels: boolean; reduceMotion: boolean; autoplay: boolean; palette: 'ironbow' | 'whitehot' };
  scenarioDraft: ScenarioParams;
  paletteOpen: boolean;
  settingsOpen: boolean;
  settingsTab: 'scenario' | 'display' | 'about';
  twinImmersive: boolean;
  follow: AssetId | null;
  toast: { id: number; text: string; tone: 'info' | 'ok' | 'warn' } | null;

  setScreen: (s: Screen) => void;
  toggleLayer: (l: LayerId) => void;
  setLayer: (l: LayerId, on: boolean) => void;
  select: (s: Selection) => void;
  setHovered: (s: Selection) => void;
  selectIncident: (id: string | null) => void;
  selectObservation: (id: string | null) => void;
  setFeedMain: (f: FeedSource) => void;
  setFeedMode: (f: FeedSource, m: FeedMode) => void;
  toggleFeedOverlays: () => void;
  setPtz: (f: 'CAM-01' | 'CAM-02', p: Partial<Ptz>) => void;
  setFeedMoved: (f: 'CAM-01' | 'CAM-02', meters: number) => void;
  setTelemetry: (p: Partial<UIState['telemetry']>) => void;
  setEventFilter: (f: EventFilter) => void;
  setPlayback: (p: Partial<PlaybackState>) => void;
  goLive: () => void;
  setSettings: (p: Partial<UIState['settings']>) => void;
  setScenarioDraft: (p: Partial<ScenarioParams>) => void;
  setPaletteOpen: (o: boolean) => void;
  openSettings: (tab?: UIState['settingsTab']) => void;
  closeSettings: () => void;
  setTwinImmersive: (v: boolean) => void;
  setFollow: (a: AssetId | null) => void;
  notify: (text: string, tone?: 'info' | 'ok' | 'warn') => void;
}

const screenFromHash = (): Screen => {
  const h = window.location.hash.replace(/^#\/?/, '') as Screen;
  return SCREENS.includes(h) ? h : 'overview';
};

let toastSeq = 0;

export const useUI = create<UIState>()(
  persist(
    (set, get) => ({
      screen: screenFromHash(),
      layers: { radiation: true, chemical: true, biological: true, assets: true, weather: false, zones: false },
      selection: null,
      hovered: null,
      selectedIncidentId: null,
      selectedObservationId: null,
      feedMain: 'UGV-01',
      feedModes: { 'CAM-01': 'visible', 'CAM-02': 'visible', 'UGV-01': 'thermal', 'UAV-01': 'visible' },
      feedOverlays: true,
      ptz: { 'CAM-01': { yaw: 0, pitch: 0, zoom: 1 }, 'CAM-02': { yaw: 0, pitch: 0, zoom: 1 } },
      feedMoved: { 'CAM-01': 0, 'CAM-02': 0 },
      telemetry: { paused: false, pausedAt: null, range: 15, series: { chem: true, bio: true, rad: true } },
      eventFilter: 'all',
      playback: { mode: 'live', cursor: Date.now(), playing: false, speed: 1 },
      settings: { quality: 'high', labels: true, reduceMotion: false, autoplay: true, palette: 'ironbow' },
      scenarioDraft: { preset: 'radiological', severity: 'moderate', locationId: 'U3-EAST', windDir: 315, windSpeed: 12, duration: 0 },
      paletteOpen: false,
      settingsOpen: false,
      settingsTab: 'scenario',
      twinImmersive: false,
      follow: null,
      toast: null,

      setScreen: (screen) => {
        if (get().screen === screen) return;
        set({ screen, twinImmersive: screen === 'twin' ? get().twinImmersive : false });
        const target = `#/${screen}`;
        if (window.location.hash !== target) window.history.replaceState(null, '', target);
      },
      toggleLayer: (l) => set((s) => ({ layers: { ...s.layers, [l]: !s.layers[l] } })),
      setLayer: (l, on) => set((s) => ({ layers: { ...s.layers, [l]: on } })),
      select: (selection) => set({ selection }),
      setHovered: (hovered) => {
        const cur = get().hovered;
        if (JSON.stringify(cur) !== JSON.stringify(hovered)) set({ hovered });
      },
      selectIncident: (selectedIncidentId) => set({ selectedIncidentId }),
      selectObservation: (selectedObservationId) => set({ selectedObservationId }),
      setFeedMain: (feedMain) => set({ feedMain }),
      setFeedMode: (f, m) => set((s) => ({ feedModes: { ...s.feedModes, [f]: m } })),
      toggleFeedOverlays: () => set((s) => ({ feedOverlays: !s.feedOverlays })),
      setPtz: (f, p) => set((s) => ({ ptz: { ...s.ptz, [f]: { ...s.ptz[f], ...p } } })),
      setFeedMoved: (f, meters) => {
        if (Math.round(get().feedMoved[f]) !== Math.round(meters)) set((s) => ({ feedMoved: { ...s.feedMoved, [f]: meters } }));
      },
      setTelemetry: (p) => set((s) => ({ telemetry: { ...s.telemetry, ...p } })),
      setEventFilter: (eventFilter) => set({ eventFilter }),
      setPlayback: (p) => set((s) => ({ playback: { ...s.playback, ...p } })),
      goLive: () => set((s) => ({ playback: { ...s.playback, mode: 'live', playing: false, cursor: Date.now() } })),
      setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      setScenarioDraft: (p) => set((s) => ({ scenarioDraft: { ...s.scenarioDraft, ...p } })),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      openSettings: (tab) => set((s) => ({ settingsOpen: true, settingsTab: tab ?? s.settingsTab })),
      closeSettings: () => set({ settingsOpen: false }),
      setTwinImmersive: (twinImmersive) => set({ twinImmersive }),
      setFollow: (follow) => set({ follow }),
      notify: (text, tone = 'info') => set({ toast: { id: ++toastSeq, text, tone } }),
    }),
    {
      name: 'encirra-ui-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        layers: s.layers,
        feedMain: s.feedMain,
        feedModes: s.feedModes,
        feedOverlays: s.feedOverlays,
        telemetry: { ...s.telemetry, paused: false, pausedAt: null },
        eventFilter: s.eventFilter,
        settings: s.settings,
        scenarioDraft: s.scenarioDraft,
      }),
    },
  ),
);

window.addEventListener('hashchange', () => {
  const s = screenFromHash();
  if (useUI.getState().screen !== s) useUI.getState().setScreen(s);
});

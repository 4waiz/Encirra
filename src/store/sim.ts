import { create } from 'zustand';
import type {
  AssetId,
  AssetState,
  Incident,
  Metrics,
  Observation,
  ResponseKpis,
  ScenarioRun,
  SensorState,
  SimEvent,
  SystemHealthLevel,
  Weather,
} from '../types';

/**
 * Snapshot of the synthetic world published by the simulation engine (≈1 Hz).
 * Components subscribe to narrow slices so a tick only re-renders what changed.
 * Per-frame motion (vehicles, plumes) never goes through React — the 3D layer samples the engine.
 */
export interface SimSnapshot {
  ready: boolean;
  now: number;
  tick: number;
  lastUpdate: number;
  run: ScenarioRun | null;
  metrics: Metrics;
  weather: Weather;
  kpis: ResponseKpis;
  sensors: Record<string, SensorState>;
  assets: Record<AssetId, AssetState>;
  events: SimEvent[];
  incidents: Incident[];
  observations: Observation[];
  health: { level: SystemHealthLevel; label: string };
  feeds: Record<string, { stale: boolean; staleSince: number | null }>;
  historyVersion: number;
}

const emptyMetrics: Metrics = {
  voc: 0,
  vocSensor: '',
  gasOnline: 0,
  gasTotal: 24,
  chemAlerts: 0,
  aerosol: 0,
  aerosolSensor: '',
  samplesPending: 0,
  bioOnline: 0,
  bioTotal: 12,
  bioAlerts: 0,
  gamma: 0,
  gammaSensor: '',
  dosimetersOnline: 0,
  dosimetersTotal: 48,
  radAlerts: 0,
  readiness: 0,
  commsUp: 0,
  commsTotal: 4,
  checklistPct: 0,
  drillClosedPct: 0,
  sensorsOnline: 0,
  sensorsTotal: 200,
  videoUp: 0,
  videoTotal: 4,
  staleFeeds: 0,
  ppe: 0,
  networkHealth: 0,
  latencyMs: 0,
};

export const useSim = create<SimSnapshot>(() => ({
  ready: false,
  now: Date.now(),
  tick: 0,
  lastUpdate: 0,
  run: null,
  metrics: emptyMetrics,
  weather: {
    windDir: 315,
    windSpeed: 12,
    gust: 16,
    temperature: 33,
    humidity: 52,
    pressure: 1009,
    visibility: 9.6,
    stability: 'D',
  },
  kpis: {
    ackSeconds: null,
    ackRunning: false,
    personnelPct: 100,
    personnelPresent: 342,
    personnelTotal: 342,
    remoteCoverage: 86,
    openActions: 0,
    openHigh: 0,
    openMedium: 0,
  },
  sensors: {},
  assets: {} as Record<AssetId, AssetState>,
  events: [],
  incidents: [],
  observations: [],
  health: { level: 'nominal', label: 'All systems nominal' },
  feeds: {},
  historyVersion: 0,
}));

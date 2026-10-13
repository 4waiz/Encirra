/**
 * Transport for simulation data.
 *
 *  Live mode   — the Python simulation service (FastAPI, proxied by Vite under /api).
 *  Replay mode — precomputed solver output bundled as static JSON under /replay/.
 *
 * Both return the exact shapes defined in @encirra/shared (contract.ts); nothing here
 * modifies the data.
 */
import type {
  Comparison,
  HealthResponse,
  NetworkTopology,
  ReplayManifest,
  RunRequest,
  RunResult,
  ScenarioDefinition,
  ScenarioId,
  StrategyId,
} from '@encirra/shared';

export const STRATEGIES: StrategyId[] = ['none', 'grid-only', 'encirra'];

export class DataError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DataError';
  }
}

async function request<T>(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { Accept: 'application/json', ...init.headers } });
    if (!res.ok) throw new DataError(`${init.method ?? 'GET'} ${url} → HTTP ${res.status}`, res.status);
    const type = res.headers.get('content-type') ?? '';
    // The dev server answers unknown paths with index.html (SPA fallback); treat that as "missing".
    if (!type.includes('json')) throw new DataError(`${url} did not return JSON`, 404);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof DataError) throw err;
    if ((err as Error).name === 'AbortError') throw new DataError(`${url} timed out after ${Math.round(timeoutMs / 1000)} s`);
    throw new DataError(`${url}: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────────────────────────────────────────── live simulation service
/** Returns the health payload when the simulation service answers within the timeout, else null. */
export async function detectBackend(timeoutMs = 1500): Promise<HealthResponse | null> {
  try {
    const health = await request<HealthResponse>('/api/health', {}, timeoutMs);
    return health && health.ok ? health : null;
  } catch {
    return null;
  }
}

export const liveApi = {
  topology: () => request<NetworkTopology>('/api/topology'),
  async scenarios(): Promise<ScenarioDefinition[]> {
    const raw = await request<ScenarioDefinition[] | { scenarios: ScenarioDefinition[] }>('/api/scenarios');
    return Array.isArray(raw) ? raw : raw.scenarios;
  },
  run: (req: RunRequest, timeoutMs = 120_000) =>
    request<RunResult>('/api/run', { method: 'POST', body: JSON.stringify(req), headers: { 'Content-Type': 'application/json' } }, timeoutMs),
  compare: (scenarioId: ScenarioId) => request<Comparison>(`/api/compare/${encodeURIComponent(scenarioId)}`, {}, 120_000),
  exportUrl: (scenarioId: ScenarioId, format: 'json' | 'csv') => `/api/export/${encodeURIComponent(scenarioId)}.${format}`,
};

// ───────────────────────────────────────────────────────────── replay files
const REPLAY_BASE = '/replay/';
const replayUrl = (path: string) => REPLAY_BASE + path.replace(/^\.?\//, '').replace(/^replay\//, '');

export const replayApi = {
  manifest: () => request<ReplayManifest>(replayUrl('manifest.json'), {}, 10_000),
  topology: (manifest: ReplayManifest) => request<NetworkTopology>(replayUrl(manifest.topology || 'topology.json')),
  run: (manifest: ReplayManifest, scenarioId: ScenarioId, strategy: StrategyId) => {
    const entry = manifest.scenarios.find((s) => s.definition.id === scenarioId);
    return request<RunResult>(replayUrl(entry?.runs?.[strategy] ?? `${scenarioId}/${strategy}.json`));
  },
  comparison: (manifest: ReplayManifest, scenarioId: ScenarioId) => {
    const entry = manifest.scenarios.find((s) => s.definition.id === scenarioId);
    return request<Comparison>(replayUrl(entry?.comparison ?? `${scenarioId}/comparison.json`));
  },
};

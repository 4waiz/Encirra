/**
 * Asset kit loader (assets/models → served at /models). Non-blocking: the manifest and GLBs load
 * in the background into a small zustand store; every consumer keeps rendering its procedural
 * fallback until (and unless) the asset it needs arrives. Missing or failing files simply keep
 * the fallback.
 */
import { create } from 'zustand';
import type { Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export interface KitAsset {
  id: string;
  kind: string;
  variant: number;
  node: string;
  nominalSize?: [number, number, number];
  facilityId?: string;
  file: string;
  floors?: number;
  storeyHeight?: number;
  lobbyHeight?: number;
  roofY?: number;
  anchors?: Record<string, unknown>;
  placement?: { position: [number, number, number]; rotationY?: number };
  materials?: string[];
}

export interface KitManifest {
  version: string;
  basePath: string;
  assets: KitAsset[];
  files: Record<string, { bytes: number; group: string; nodes: string[] }>;
  materialPBR?: Record<string, { baseColor?: string; roughness?: number; metalness?: number; emissive?: string; emissiveIntensity?: number; opacity?: number }>;
}

type FileState = GLTF | 'loading' | 'error';

interface KitStore {
  manifest: KitManifest | null | 'missing';
  files: Record<string, FileState>;
}

export const useKit = create<KitStore>()(() => ({ manifest: null, files: {} }));

let loader: GLTFLoader | null = null;
function getLoader() {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

const DISABLED = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('kit') === '0';

let started = false;
/** Kick off manifest + GLB loading (idempotent). `priority` files load first. */
export function startKitLoading(priority: string[] = []) {
  if (started || DISABLED) {
    if (DISABLED) useKit.setState({ manifest: 'missing' });
    return;
  }
  started = true;
  fetch('/models/manifest.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((m: KitManifest) => {
      useKit.setState({ manifest: m });
      const files = Object.keys(m.files ?? {});
      const order = [...priority.filter((f) => files.includes(f)), ...files.filter((f) => !priority.includes(f))];
      // limited concurrency keeps the first frames smooth
      let i = 0;
      const next = () => {
        const f = order[i++];
        if (!f) return;
        useKit.setState((s) => ({ files: { ...s.files, [f]: 'loading' } }));
        getLoader().load(
          (m.basePath ?? '/models/') + f,
          (gltf) => {
            useKit.setState((s) => ({ files: { ...s.files, [f]: gltf } }));
            next();
          },
          undefined,
          () => {
            useKit.setState((s) => ({ files: { ...s.files, [f]: 'error' } }));
            next();
          },
        );
      };
      for (let k = 0; k < 3; k++) next();
    })
    .catch(() => useKit.setState({ manifest: 'missing' }));
}

/** GLTF for a file once loaded (null while loading / missing / failed). */
export function useKitFile(file: string): GLTF | null {
  return useKit((s) => {
    const f = s.files[file];
    return f && f !== 'loading' && f !== 'error' ? f : null;
  });
}

/**
 * Stable signature for a set of files: 'pending' while any of them is still loading,
 * 'missing' when there is no manifest, otherwise 'ready:<loaded files>' (failed files omitted).
 */
export function useKitSignature(files: string[]): string {
  return useKit((s) => {
    if (s.manifest === 'missing') return 'missing';
    if (!s.manifest) return 'pending';
    const ok: string[] = [];
    for (const f of files) {
      if (!s.manifest.files?.[f]) continue; // not delivered → fallback
      const st = s.files[f];
      if (!st || st === 'loading') return 'pending';
      if (st !== 'error') ok.push(f);
    }
    return 'ready:' + ok.join('|');
  });
}

/** Loaded GLTFs for a list of files (snapshot; pair with useKitSignature for reactivity). */
export function kitFiles(files: string[]): Record<string, GLTF> {
  const s = useKit.getState();
  const out: Record<string, GLTF> = {};
  for (const f of files) {
    const st = s.files[f];
    if (st && st !== 'loading' && st !== 'error') out[f] = st;
  }
  return out;
}

export function kitManifest(): KitManifest | null {
  const m = useKit.getState().manifest;
  return m && m !== 'missing' ? m : null;
}

export function manifestAsset(m: KitManifest, pred: (a: KitAsset) => boolean) {
  return m.assets.find(pred);
}

/** Find a node by name in a loaded GLTF scene. */
export function findNode(gltf: GLTF, name: string): Object3D | null {
  return gltf.scene.getObjectByName(name) ?? null;
}

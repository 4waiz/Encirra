import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createReadStream, existsSync, statSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve, join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const webRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(webRoot, '../..');
const modelsDir = join(repoRoot, 'assets', 'models');

const MIME: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.hdr': 'application/octet-stream',
};

/** Serves /models/* from assets/models in dev and copies it into dist/models on build. */
function modelsFromAssets(): Plugin {
  return {
    name: 'encirra-models-from-assets',
    configureServer(server) {
      server.middlewares.use('/models', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const file = join(modelsDir, rel);
        if (!file.startsWith(modelsDir) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
    writeBundle(options) {
      if (!existsSync(modelsDir)) return;
      const out = join(options.dir ?? resolve(webRoot, 'dist'), 'models');
      const copyDir = (src: string, dst: string) => {
        mkdirSync(dst, { recursive: true });
        for (const entry of readdirSync(src, { withFileTypes: true })) {
          const s = join(src, entry.name);
          const d = join(dst, entry.name);
          if (entry.isDirectory()) copyDir(s, d);
          else if (!entry.name.endsWith('.md')) copyFileSync(s, d);
        }
      };
      copyDir(modelsDir, out);
    },
  };
}

const apiTarget = process.env.ENCIRRA_API_URL ?? 'http://127.0.0.1:8000';

/**
 * Answers GET /api/health locally when the simulation service is not running, with
 * `{ ok: false }` instead of a proxy 502, so the replay fallback starts without a console error.
 * When the service is up, its own health response is passed through unchanged.
 */
function solverHealth(): Plugin {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== 'GET' || !req.url?.startsWith('/api/health')) return next();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1200);
    try {
      const upstream = await fetch(`${apiTarget}/api/health`, { signal: ctrl.signal });
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
      res.end(await upstream.text());
    } catch {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ ok: false, reason: 'Simulation service not running; the app uses the bundled replay.' }));
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    name: 'encirra-solver-health',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), modelsFromAssets(), solverHealth()],
  resolve: {
    alias: { '@': resolve(webRoot, 'src') },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
    fs: { allow: [repoRoot] },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
});

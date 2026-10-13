// Shared helpers for the Encirra browser tests (playwright-core driving the installed Microsoft Edge).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '..', '..');
export const outDir = join(here, 'output');
mkdirSync(outDir, { recursive: true });

export const BASE_URL = process.env.ENCIRRA_URL ?? 'http://127.0.0.1:5173/';

export async function launch() {
  return chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
    // keep real scrollbars so layout checks match what users see
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
}

async function responds(url, timeoutMs = 1500) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** Reuses a running dev server, or starts one (and returns a stop function for the one we started). */
export async function ensureServer(url = BASE_URL) {
  if (await responds(url)) return { started: false, stop: async () => {} };
  const isWin = process.platform === 'win32';
  const child = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'dev:web'], { cwd: repoRoot, stdio: 'ignore', shell: isWin, detached: !isWin });
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    if (await responds(url)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!(await responds(url))) throw new Error(`dev server did not start at ${url}`);
  return {
    started: true,
    stop: async () => {
      try {
        if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: true });
        else process.kill(-child.pid);
      } catch {
        /* already gone */
      }
    },
  };
}

/** Waits until simulation data is loaded and the loading indicator is gone. */
export async function waitForApp(page, timeout = 45_000) {
  await page.waitForSelector('[data-testid="app"]', { timeout });
  await page.waitForFunction(
    () => {
      const stage = document.querySelector('[data-testid="sim-stage"]');
      const busy = document.querySelector('[data-testid="busy"]');
      return stage && stage.textContent && !/Loading|—/.test(stage.textContent) && !busy;
    },
    null,
    { timeout },
  );
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

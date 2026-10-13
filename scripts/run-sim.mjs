#!/usr/bin/env node
// Cross-platform runner for the Python simulation service.
// Prefers `uv` (fast, reproducible); falls back to a plain venv + pip.
//
//   node scripts/run-sim.mjs setup    install backend dependencies
//   node scripts/run-sim.mjs serve    start the FastAPI service on :8000
//   node scripts/run-sim.mjs test     run the pytest suite
//   node scripts/run-sim.mjs export   regenerate offline replay files from the solvers
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const simDir = join(root, 'services', 'simulation');
const isWin = process.platform === 'win32';
const venvPython = join(simDir, '.venv', isWin ? 'Scripts/python.exe' : 'bin/python');
const port = process.env.ENCIRRA_SIM_PORT ?? '8000';
const host = process.env.ENCIRRA_SIM_HOST ?? '127.0.0.1';

function has(cmd) {
  const r = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: opts.cwd ?? root, env: { ...process.env, ...opts.env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const useUv = has('uv') && process.env.ENCIRRA_NO_UV !== '1';
const task = process.argv[2] ?? 'serve';
const extra = process.argv.slice(3);

function py(args, opts) {
  if (useUv) run('uv', ['run', '--project', simDir, 'python', ...args], opts);
  else {
    if (!existsSync(venvPython)) {
      console.error('Simulation venv missing. Run: npm run setup:sim');
      process.exit(1);
    }
    run(venvPython, args, opts);
  }
}

switch (task) {
  case 'setup':
    if (useUv) run('uv', ['sync', '--project', simDir, '--all-extras']);
    else {
      const sysPy = isWin ? 'python' : 'python3';
      if (!existsSync(venvPython)) run(sysPy, ['-m', 'venv', join(simDir, '.venv')]);
      run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
      run(venvPython, ['-m', 'pip', 'install', '-e', `${simDir}[dev]`]);
    }
    break;
  case 'serve':
    py(['-m', 'uvicorn', 'encirra_sim.api:app', '--host', host, '--port', port, ...extra], { cwd: simDir });
    break;
  case 'test':
    py(['-m', 'pytest', '-q', ...extra], { cwd: simDir });
    break;
  case 'export':
    py(['-m', 'encirra_sim.export', '--out', join(root, 'apps', 'web', 'public', 'replay'), ...extra], { cwd: simDir });
    break;
  default:
    console.error(`Unknown task: ${task}`);
    process.exit(1);
}

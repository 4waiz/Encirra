#!/usr/bin/env node
// `npm run test:e2e` — reuses a running dev server (http://127.0.0.1:5173) or starts one, then runs
// the smoke suite in headless Microsoft Edge. Screenshots and downloads go to tests/e2e/output/.
import { BASE_URL, ensureServer } from './lib.mjs';
import { report, runSmoke } from './smoke.mjs';

const server = await ensureServer(BASE_URL);
console.log(`${server.started ? 'Started' : 'Reusing'} dev server at ${BASE_URL}\n`);
let failed = 1;
try {
  failed = report(await runSmoke({ baseUrl: BASE_URL }));
} catch (err) {
  console.error('E2E run aborted:', err);
} finally {
  await server.stop();
}
process.exit(failed ? 1 : 0);

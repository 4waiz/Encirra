#!/usr/bin/env node
// `npm run test:e2e` — reuses a running dev server (http://127.0.0.1:5173) or starts one, then runs
// the desktop smoke suite and the phone/tablet suite (touch emulation) in headless Microsoft Edge. Screenshots and downloads go to tests/e2e/output/.
import { BASE_URL, ensureServer } from './lib.mjs';
import { report, runSmoke } from './smoke.mjs';
import { runMobile } from './mobile.mjs';

const server = await ensureServer(BASE_URL);
console.log(`${server.started ? 'Started' : 'Reusing'} dev server at ${BASE_URL}\n`);
let failed = 1;
try {
  const desktop = await runSmoke({ baseUrl: BASE_URL });
  const phone = await runMobile({ baseUrl: BASE_URL });
  failed = report([...desktop, ...phone]);
} catch (err) {
  console.error('E2E run aborted:', err);
} finally {
  await server.stop();
}
process.exit(failed ? 1 : 0);

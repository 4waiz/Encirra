#!/usr/bin/env node
// Layout probe: evaluates a JS expression in the app (Edge, headless) and prints the JSON result.
//   node tests/e2e/probe.mjs --size=1600x900 --query="page=live&frame=16" --expr="..."
import { BASE_URL, ensureServer, launch, parseArgs, waitForApp } from './lib.mjs';

const args = parseArgs();
const [w, h] = String(args.size ?? '1600x900').split('x').map(Number);
const server = await ensureServer();
const browser = await launch();
try {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  await page.goto(`${BASE_URL}?${args.query ?? ''}`, { waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  await page.waitForTimeout(Number(args.wait ?? 800));
  const result = await page.evaluate(String(args.expr ?? 'document.title'));
  console.log(JSON.stringify(result, null, 1));
} finally {
  await browser.close();
  await server.stop();
}

// Usage: node tools/shot.mjs --scenario <name> [--out shots/name.png] [--w 1600] [--h 900] [--seed 42] [--wait 1500]
//        node tools/shot.mjs --list
// Scenarios are defined in the game itself: window.__game.debug.scenarios (see docs/ARCHITECTURE.md).
// The tool loads the game, calls window.__game.debug.runScenario(name, {seed}), waits, and captures a PNG.
// Exit code is non-zero if the page threw errors or the scenario is unknown.
import { startServer, launchBrowser, waitReady, advance } from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : []).filter(Boolean));
const scenario = args.scenario || 'default';
const width = Number(args.w || 1600), height = Number(args.h || 900);
const seed = Number(args.seed || 42);
const wait = Number(args.wait || 1500);
const out = args.out || `shots/${scenario}.png`;

const server = await startServer();
const b = await launchBrowser({ width, height });
let code = 0;
try {
  await b.page.goto(server.url + `?debug=1&seed=${seed}&scenario=${encodeURIComponent(scenario)}`, { waitUntil: 'load' });
  await waitReady(b.page);
  if (args.list) {
    const names = await b.page.evaluate(() => Object.keys(window.__game?.debug?.scenarios || {}));
    console.log(names.join('\n'));
  } else {
    const ok = await b.page.evaluate(async ({ scenario, seed }) => {
      const d = window.__game?.debug; if (!d?.runScenario) return 'no-debug-api';
      return await d.runScenario(scenario, { seed });
    }, { scenario, seed });
    if (ok === 'no-debug-api') { console.error('window.__game.debug.runScenario missing'); code = 2; }
    else if (ok === false) { console.error('unknown scenario: ' + scenario); code = 3; }
    await advance(b.page, wait);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await b.page.screenshot({ path: out });
    console.log('wrote ' + out);
  }
  if (b.errors.length) { console.error('PAGE ERRORS:\n' + b.errors.join('\n')); code = code || 1; }
} catch (e) { console.error(e); code = 1; }
finally { await b.close(); server.stop(); }
process.exit(code);

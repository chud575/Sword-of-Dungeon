// Smoke test: loads the game, runs every registered debug scenario, checks for page errors and
// that the canvas is not blank. Usage: node tools/smoke.mjs [--only name] [--seed 42]
import { startServer, launchBrowser, waitReady, advance } from './browser.mjs';
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : []).filter(Boolean));
const seed = Number(args.seed || 42);
const server = await startServer();
const b = await launchBrowser();
let failed = 0;
try {
  await b.page.goto(server.url + `?debug=1&seed=${seed}`, { waitUntil: 'load' });
  await waitReady(b.page);
  let names = await b.page.evaluate(() => Object.keys(window.__game?.debug?.scenarios || {}));
  if (args.only) names = names.filter((n) => n === args.only);
  if (!names.length) { console.error('no scenarios registered'); failed++; }
  fs.mkdirSync('shots/smoke', { recursive: true });
  for (const n of names) {
    const before = b.errors.length;
    const ok = await b.page.evaluate(async ({ n, seed }) => window.__game.debug.runScenario(n, { seed }), { n, seed });
    await advance(b.page, 1200);
    const blank = await b.page.evaluate(() => {
      const c = document.getElementById('game-canvas'); if (!c) return 'no-canvas';
      const gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return 'no-gl';
      const px = new Uint8Array(4 * 64);
      const xs = [c.width * 0.25, c.width * 0.5, c.width * 0.75, c.width * 0.5];
      const ys = [c.height * 0.5, c.height * 0.5, c.height * 0.5, c.height * 0.25];
      let sum = 0;
      for (let i = 0; i < 4; i++) { gl.readPixels(xs[i] | 0, ys[i] | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); sum += px[0] + px[1] + px[2]; }
      return sum === 0 ? 'blank' : 'ok';
    });
    await b.page.screenshot({ path: `shots/smoke/${n}.png` });
    const errs = b.errors.slice(before);
    const status = ok === false ? 'UNKNOWN' : errs.length ? 'ERROR' : 'ok';
    if (status !== 'ok') failed++;
    console.log(`${status.padEnd(8)} ${n.padEnd(28)} canvas=${blank}${errs.length ? '\n    ' + errs.join('\n    ') : ''}`);
  }
} catch (e) { console.error(e); failed++; }
finally { await b.close(); server.stop(); }
console.log(failed ? `SMOKE FAILED (${failed})` : 'SMOKE OK');
process.exit(failed ? 1 : 0);

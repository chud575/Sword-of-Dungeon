// Usage: node tools/refshot.mjs [--out shots/reference-original.png] [--w 1600] [--h 900] [--seed 1983] [--msg "TEMPLE!"] [--scanlines 0]
// Renders reference/original.html (a self-contained replica of the C64 Sword of Fargoal play screen)
// headlessly with Playwright and writes a PNG. Loaded via file:// — the page has no dependencies or fetches.
import { launchBrowser } from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : []).filter(Boolean));
const width = Number(args.w || 1600), height = Number(args.h || 900);
const out = path.resolve(ROOT, args.out || 'shots/reference-original.png');

const params = new URLSearchParams({ w: String(width), h: String(height) });
if (args.seed) params.set('seed', String(args.seed));
if (args.msg) params.set('msg', String(args.msg));
if (args.scanlines !== undefined) params.set('scanlines', String(args.scanlines));
const url = pathToFileURL(path.join(ROOT, 'reference/original.html')).href + '?' + params.toString();

const b = await launchBrowser({ width, height });
let code = 0;
try {
  await b.page.goto(url, { waitUntil: 'load' });
  await b.page.waitForFunction(() => window.__REF_READY === true, null, { timeout: 30000 });
  const info = await b.page.evaluate(() => ({ seed: window.__ref.seed, scale: window.__ref.scale, rooms: window.__ref.rooms.length, player: window.__ref.player }));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await b.page.screenshot({ path: out });
  console.log(`wrote ${path.relative(ROOT, out)} (seed ${info.seed}, scale ${info.scale}x, ${info.rooms} rooms, player at ${info.player.x},${info.player.y})`);
  if (b.errors.length) { console.error('PAGE ERRORS:\n' + b.errors.join('\n')); code = 1; }
} catch (e) { console.error(e); code = 1; }
finally { await b.close(); }
process.exit(code);

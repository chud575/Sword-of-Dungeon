// lumen: mean scene luminance of a rendered frame, per scenario.
//
// The "board-bright" pass needed a number, not an adjective: how much light is actually on screen,
// and how much of the frame is crushed to near-black. This runs the same scenarios shot.mjs does,
// reads the canvas back through a 2D context and reports:
//   mean   — mean sRGB luminance of the frame (0..1)
//   dark   — fraction of pixels under 0.06 (the "black hole" share)
//   clip   — fraction of pixels over 0.98 (blown highlights)
//   p50/p90
// Usage: node tools/lumen.mjs [--scenarios a,b,c] [--depths 2,18] [--seed 42] [--json out.json] [--shots dir]
import { startServer, launchBrowser, waitReady, advance } from './browser.mjs';
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : []).filter(Boolean));
const names = String(args.scenarios || 'default,dungeon-overview,deep-level,room-crypt,treasure').split(',').map((s) => s.trim()).filter(Boolean);
const depths = String(args.depths || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
const seed = Number(args.seed || 42);

const server = await startServer();
const b = await launchBrowser({ width: 1600, height: 900 });
const rows = [];
try {
  await b.page.goto(server.url + `?debug=1&seed=${seed}`, { waitUntil: 'load' });
  await waitReady(b.page);
  const measure = () => b.page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    const cv = document.createElement('canvas');
    cv.width = c.width; cv.height = c.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    const hist = new Float64Array(256);
    let sum = 0, n = 0, dark = 0, clip = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      sum += l; n++;
      if (l < 0.06) dark++;
      if (l > 0.98) clip++;
      hist[Math.min(255, (l * 255) | 0)]++;
    }
    const pct = (p) => { let acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * p) return i / 255; } return 1; };
    return { mean: sum / n, dark: dark / n, clip: clip / n, p50: pct(0.5), p90: pct(0.9) };
  });
  for (const name of names) {
    const list = depths.length ? depths : [null];
    for (const depth of list) {
      const ok = await b.page.evaluate(async ({ name, seed }) => window.__game.debug.runScenario(name, { seed }), { name, seed });
      if (ok === false) { console.error('unknown scenario: ' + name); continue; }
      if (depth !== null) {
        const moved = await b.page.evaluate((d) => {
          try { window.__game.debug.goToDepth(d); window.__game.debug.revealAll(); return true; } catch (e) { return String(e && e.message); }
        }, depth);
        if (moved !== true) { console.error(`${name} @${depth}: ${moved}`); continue; }
      }
      await advance(b.page, 900);
      const m = await measure();
      if (args.shots) {
        fs.mkdirSync(String(args.shots), { recursive: true });
        await b.page.screenshot({ path: `${args.shots}/${name}${depth !== null ? '-d' + depth : ''}.png` });
      }
      rows.push({ scenario: name, depth, ...m });
      console.log(`${(name + (depth !== null ? '@' + depth : '')).padEnd(26)} mean=${m.mean.toFixed(4)}  dark<0.06=${(m.dark * 100).toFixed(1)}%  clip=${(m.clip * 100).toFixed(2)}%  p50=${m.p50.toFixed(3)}  p90=${m.p90.toFixed(3)}`);
    }
  }
  if (b.errors.length) console.error('PAGE ERRORS:\n' + b.errors.join('\n'));
} catch (e) { console.error(e); }
finally { await b.close(); server.stop(); }
if (args.json) fs.writeFileSync(String(args.json), JSON.stringify(rows, null, 2));

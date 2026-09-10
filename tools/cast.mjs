// cast: how much of a floor field's OWN colour survives the trip to the screen.
//
// The standing complaint is that the depth grade lands as a hue multiplier on the fields, so a
// tan-brick room, a teal room and the corridor between them all arrive the same colour — gold in
// the shallow bands, violet in the deep. "Looks gold" is not a number, so this reads the real
// pixels back and prints three:
//
//   cast     the rendered R:B ratio divided by the AUTHORED R:B ratio. 1.00 = the field's own
//            colour balance reached the screen. 1.40 = 40% more red-over-blue than was painted.
//   spread   the largest per-channel gap (0-255) between any two DIFFERENT fields on the level.
//            This is boardfix gate (c): under ~30 a player cannot tell a red crypt from a teal
//            grid, whatever the atlas says.
//   dE       mean per-channel distance between each field's rendered hue direction and its
//            authored one, after removing brightness — the part of "it went gold" that is not
//            just exposure.
//
// Tiles are located exactly, not guessed: every floor tile is projected through the live camera
// to a screen pixel, so the sample is the field itself and never a prop, a torch pool or a wall.
// Usage: node tools/cast.mjs [--scenarios a,b] [--depths 4,8,20] [--seed 42] [--json out.json]
import { startServer, launchBrowser, waitReady, advance } from './browser.mjs';
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : []).filter(Boolean));
const depths = String(args.depths || '4,8,14,20').split(',').map(Number).filter((n) => !Number.isNaN(n));
const seed = Number(args.seed || 42);
const MIN_LIT = 8;   // a field needs this many LIT tiles before its hue means anything

const server = await startServer();
const b = await launchBrowser({ width: 1600, height: 900 });
const rows = [];
try {
  await b.page.goto(server.url + `?debug=1&seed=${seed}`, { waitUntil: 'load' });
  await waitReady(b.page);
  for (const depth of depths) {
    const r = await b.page.evaluate(async ({ depth, MIN_LIT }) => {
      const G = window.__game, g = G.game;
      g.goToDepth(depth);
      g.revealAll();
      G.renderer.fog.override = 'all';
      // whole level in frame, straight down: a tilted view samples wall faces into floor tiles
      const lv = g.level;
      let x0 = lv.width, y0 = lv.height, x1 = 0, y1 = 0;
      for (let y = 0; y < lv.height; y++) for (let x = 0; x < lv.width; x++) if (lv.get(x, y) !== 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      G.renderer.cameraRig.setOverview((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0 + 3) * 1.1, (y1 - y0 + 3) * 1.2, { elevation: 89.5 });
      G.renderer.cameraRig.snap();
      G.debug.step(500);

      const cam = G.renderer.camera, canvas = document.getElementById('game-canvas');
      const cv = document.createElement('canvas'); cv.width = canvas.width; cv.height = canvas.height;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(canvas, 0, 0);
      const d = cx.getImageData(0, 0, cv.width, cv.height).data;
      const at = (px, py) => { const i = ((py | 0) * cv.width + (px | 0)) * 4; return [d[i], d[i + 1], d[i + 2]]; };
      const v = cam.position.clone();
      const toScreen = (wx, wz) => {
        v.set(wx, 0.02, wz).project(cam);
        return [(v.x * 0.5 + 0.5) * cv.width, (-v.y * 0.5 + 0.5) * cv.height];
      };

      // group floor tiles by the field they are painted in; corridors are their own field
      const byStyle = new Map();
      const styleAt = (x, y) => {
        const t = lv.get(x, y);
        if (t === 2) return 'corridor';
        for (const rm of lv.rooms) if (x >= rm.x && x < rm.x + rm.w && y >= rm.y && y < rm.y + rm.h) return rm.tileStyle || null;
        return null;
      };
      for (let y = 0; y < lv.height; y++) for (let x = 0; x < lv.width; x++) {
        const t = lv.get(x, y);
        if (t !== 1 && t !== 2) continue;                       // FLOOR / CORRIDOR only
        if (lv.decorBlocked && lv.decorBlocked(x, y)) continue;
        if (lv.entityAt(x, y) || lv.itemsAt(x, y).length) continue;
        const s = styleAt(x, y); if (!s) continue;
        const [sx, sy] = toScreen(x, y);
        if (sx < 2 || sy < 2 || sx > cv.width - 3 || sy > cv.height - 3) continue;
        const p = at(sx, sy);
        // ONLY TILES WITH LIGHT ON THEM. A hue measured on a near-black pixel is noise: the ratio
        // that defines the cast divides by a channel that is almost zero, and one torch-lit tile
        // in a field of dim ones swings the median by 200. The exposure of the frame is a separate
        // complaint with its own tool (lumen.mjs); this one is only about COLOUR.
        if ((p[0] + p[1] + p[2]) / 3 < 45) continue;
        if (!byStyle.has(s)) byStyle.set(s, []);
        byStyle.get(s).push(p);
      }
      const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
      const out = {};
      for (const [s, list] of byStyle) {
        if (list.length < MIN_LIT) continue;
        out[s] = { n: list.length, rgb: [0, 1, 2].map((k) => median(list.map((p) => p[k]))) };
      }
      return { depth, fields: out };
    }, { depth, MIN_LIT });
    rows.push(r);
  }
} catch (e) { console.error(e); process.exitCode = 1; }
finally { await b.close(); server.stop(); }

// authored colours, straight from the approved vocabulary
const { TILE_STYLES } = await import('../src/render/tiles.js');
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

const fmt = (n, w = 6, p = 2) => String(n.toFixed(p)).padStart(w);
for (const row of rows) {
  const names = Object.keys(row.fields).filter((s) => TILE_STYLES[s]);
  if (!names.length) { console.log(`depth ${row.depth}: no field sampled`); continue; }
  console.log(`\n=== depth ${row.depth} ===`);
  console.log('field            n   authored rgb      rendered rgb    cast   dHue');
  let castSum = 0, dSum = 0;
  for (const s of names) {
    const a = hex(TILE_STYLES[s].base), r = row.fields[s].rgb;
    const aRB = a[0] / Math.max(1, a[2]), rRB = r[0] / Math.max(1, r[2]);
    const cast = rRB / aRB;
    // hue direction with brightness removed: normalise each to its own sum, compare
    const na = a.map((k) => k / (a[0] + a[1] + a[2])), nr = r.map((k) => k / Math.max(1, r[0] + r[1] + r[2]));
    const dHue = Math.max(...[0, 1, 2].map((k) => Math.abs(na[k] - nr[k]))) * 255;
    castSum += cast; dSum += dHue;
    console.log(`${s.padEnd(14)}${String(row.fields[s].n).padStart(4)}   ${a.map((k) => String(k).padStart(3)).join(',')}    ${r.map((k) => String(k).padStart(3)).join(',')}  ${fmt(cast)}  ${fmt(dHue, 5, 1)}`);
  }
  // gate (c): the largest channel gap between any two DIFFERENT fields
  let spread = 0, pair = '';
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const A = row.fields[names[i]].rgb, B = row.fields[names[j]].rgb;
    const g = Math.max(...[0, 1, 2].map((k) => Math.abs(A[k] - B[k])));
    if (g > spread) { spread = g; pair = `${names[i]} vs ${names[j]}`; }
  }
  row.summary = { cast: castSum / names.length, dHue: dSum / names.length, spread };
  console.log(`  MEAN CAST ${fmt(castSum / names.length)}   MEAN dHUE ${fmt(dSum / names.length, 5, 1)}   SPREAD ${spread} (${pair})`);
}
if (args.json) fs.writeFileSync(args.json, JSON.stringify(rows, null, 1));

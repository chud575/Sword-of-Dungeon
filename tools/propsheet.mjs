// propsheet: every decor type the game can place, every variant, photographed at the PLAY camera and
// labelled with where its art actually came from.
//
// Usage: node tools/propsheet.mjs [--out shots/props] [--params "props=supplied"] [--only <regex>]
//
// WHY IT READS THE ANSWER INSTEAD OF WORKING IT OUT. A decor entry is drawn by whichever of five
// builders answers first, and the order is spread over two files:
//   DungeonView.addDecor   -> modelFor(d)            the owner's Dungeon Crawlers library, only for a type
//                                                    the kit does not cut (furniture.js isModelled)
//   RenderProps.decor      -> buildFurniture / buildDressing, which try in turn
//                             buildSuppliedProp      the owner's Top-Down packs, only with ?props=supplied
//                             buildFreeportProp      the owner's Freeport models
//                             buildKitProp / Wall    the procedural solid kit
//                             painted billboard      the procedural pixel art
// ...and some types come back as an EMPTY group on purpose (kitProps UNDRAWN_*). So each cell is built
// through `level.setDecor` + `DungeonView.rebuildDecor` — the exact path a generated level takes — and
// labelled from the markers the winning builder leaves on `userData.decor`.
//
// Writes one PNG per class (standing / decal / wall) and catalogue.json with every row.
import { startServer, launchBrowser, waitReady, advance } from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : []).filter(Boolean));
const outDir = typeof args.out === 'string' ? args.out : 'shots/props';
const extra = typeof args.params === 'string' ? '&' + args.params.replace(/^[&?]/, '') : '';
const only = typeof args.only === 'string' ? new RegExp(args.only) : null;

const server = await startServer();
const b = await launchBrowser({ width: 1600, height: 900 });
let code = 0;
try {
  await b.page.goto(server.url + `?debug=1&seed=42&scenario=prop-catalogue${extra}`, { waitUntil: 'load' });
  await waitReady(b.page);
  const ok = await b.page.evaluate(async () => window.__game.debug.runScenario('prop-catalogue', { seed: 42 }));
  if (ok === false) throw new Error('scenario prop-catalogue missing');
  await advance(b.page, 600);

  // The Dungeon Crawlers library inflates in the background and NOTHING waits for it (dungeon.js
  // loadModels). Photographing before it lands would label every one of its pieces as my pixel art.
  const lib = await b.page.evaluate(async () => {
    const dv = window.__game.renderer.dungeon;
    for (let i = 0; i < 200 && !dv.modelLib; i++) await new Promise((r) => setTimeout(r, 100));
    return !!dv.modelLib;
  });
  if (!lib) console.warn('WARNING: the Dungeon Crawlers library never loaded — its pieces will show their fallbacks');

  const specs = await b.page.evaluate(async () => {
    const { DECOR_TYPES } = await import('/src/world/generator.js');
    return Object.entries(DECOR_TYPES).map(([type, t]) => ({ type, cls: t.cls, variants: t.v, span: t.span || 0, blk: !!t.blk, run: !!t.run }));
  });

  const rows = [];
  for (const s of specs) {
    if (only && !only.test(s.type)) continue;
    for (let v = 0; v < s.variants; v++) {
      const row = await b.page.evaluate(async ({ s, v }) => {
        const G = window.__game, R = G.renderer, lv = G.game.level, dv = R.dungeon;
        const { MODEL_MAP } = await import('/src/render/props/models.js');
        const wall = s.cls === 'wall';
        const x = 4, y = wall ? 0 : 3;
        const d = { type: s.type, x, y, facing: 's', variant: v, blocking: false };
        if (s.span) d.span = s.span;
        lv.setDecor([d]);
        dv.rebuildDecor();
        const view = dv.decorViews[0] || null;
        const ud = view ? (view.userData.decor || {}) : null;
        let meshes = 0;
        if (view) view.traverse((o) => { if (o.isMesh || o.isSprite) meshes++; });

        let source, asset = '';
        if (!view) source = 'dropped';
        else if (ud.supplied) { source = 'owner-supplied'; asset = String(ud.supplied); }
        else if (ud.freeport) { source = 'owner-freeport'; asset = String(ud.freeport); }
        else if (ud.model) {
          source = 'owner-dc';
          const n = MODEL_MAP[s.type] || [];
          asset = n.length ? n[v % n.length] : '';
        } else if (ud.drawn === false || meshes === 0) source = 'none';
        else if (ud.kit) source = 'claude-kit';
        else source = 'claude-pixel';

        // let textures and materials settle, then PIN the camera on the piece and draw one frame
        G.debug.step(200);
        const rig = R.cameraRig, cam = rig.camera;
        const cx = x + (s.span > 1 ? (s.span - 1) / 2 : 0), cz = wall ? 1 : y;
        rig.smoothTarget.set(cx, 0, cz); rig.place(); cam.updateMatrixWorld(true);
        R.draw();
        const cvs = R.gl.domElement;
        const V = Object.getPrototypeOf(cam.position).constructor;
        const P = (px, py, pz) => { const q = new V(px, py, pz).project(cam); return [(q.x * 0.5 + 0.5) * cvs.width, (-q.y * 0.5 + 0.5) * cvs.height]; };
        const a = P(cx, 0, wall ? 0.5 : y), b2 = P(cx + 1, 0, wall ? 0.5 : y);
        const tile = Math.hypot(b2[0] - a[0], b2[1] - a[1]);
        const wT = Math.max(2.2, (s.span || 1) + 1.2), hT = 2.4;
        const w = Math.round(wT * tile), h = Math.round(hT * tile);
        const sx = Math.round(a[0] - w / 2), sy = Math.round(a[1] - h * (wall ? 0.62 : 0.72));

        window.__cells = window.__cells || [];
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(cvs, sx, sy, w, h, 0, 0, w, h);
        window.__cells.push(c);
        return { type: s.type, cls: s.cls, variant: v, variants: s.variants, source, asset, blocksByDefault: s.blk, span: s.span, run: s.run, cell: window.__cells.length - 1, tilePx: Math.round(tile) };
      }, { s, v });
      rows.push(row);
      process.stdout.write(`\r${rows.length} photographed (${row.type} v${row.variant}: ${row.source})          `);
    }
  }
  process.stdout.write('\n');

  // compose one labelled sheet per class, in the page (it has the canvases and a 2D context)
  fs.mkdirSync(outDir, { recursive: true });
  for (const cls of ['prop', 'decal', 'wall']) {
    const mine = rows.filter((r) => r.cls === cls);
    if (!mine.length) continue;
    const url = await b.page.evaluate(({ mine, cls }) => {
      const SRC = {
        'owner-dc': ['#2f7d4f', "OWNER · Dungeon Crawlers"],
        'owner-freeport': ['#2f7d4f', 'OWNER · Freeport'],
        'owner-supplied': ['#2f7d4f', 'OWNER · Top-Down pack'],
        'claude-kit': ['#9c3b22', 'CLAUDE · procedural kit'],
        'claude-pixel': ['#9c3b22', 'CLAUDE · painted pixels'],
        none: ['#777', 'NOT DRAWN'],
        dropped: ['#777', 'DROPPED'],
      };
      const CW = 210, IH = 190, LH = 58, cols = 8;
      const title = { prop: 'STANDING PROPS', decal: 'FLOOR DECALS', wall: 'WALL-MOUNTED' }[cls];
      const n = mine.length, rowsN = Math.ceil(n / cols), HEAD = 64;
      const sheet = document.createElement('canvas');
      sheet.width = cols * CW; sheet.height = HEAD + rowsN * (IH + LH);
      const g = sheet.getContext('2d');
      g.fillStyle = '#1b1814'; g.fillRect(0, 0, sheet.width, sheet.height);
      g.fillStyle = '#ece1c6'; g.font = 'bold 26px Helvetica, Arial, sans-serif'; g.textBaseline = 'top';
      g.fillText(`${title} — ${new Set(mine.map((r) => r.type)).size} types, ${n} variants, at the play camera`, 14, 10);
      g.font = '14px Helvetica, Arial, sans-serif';
      g.fillStyle = '#6fbf8a'; g.fillText('green = the owner\'s own art', 14, 42);
      g.fillStyle = '#e07a5a'; g.fillText('rust = procedural, written by Claude', 220, 42);
      g.fillStyle = '#aaa'; g.fillText('grey = placed but draws nothing', 500, 42);
      mine.forEach((r, i) => {
        const X = (i % cols) * CW, Y = HEAD + Math.floor(i / cols) * (IH + LH);
        const c = window.__cells[r.cell];
        const k = Math.min((CW - 8) / c.width, (IH - 8) / c.height);
        g.imageSmoothingEnabled = false;
        g.fillStyle = '#000'; g.fillRect(X + 2, Y + 2, CW - 4, IH - 4);
        g.drawImage(c, X + (CW - c.width * k) / 2, Y + (IH - c.height * k) / 2, c.width * k, c.height * k);
        const [col, label] = SRC[r.source] || ['#777', r.source];
        g.fillStyle = col; g.fillRect(X + 2, Y + IH, CW - 4, LH - 4);
        g.fillStyle = '#fff'; g.font = 'bold 15px Helvetica, Arial, sans-serif';
        g.fillText(`${r.type}  v${r.variant}${r.blocksByDefault ? '  ■blocks' : ''}`, X + 8, Y + IH + 5);
        g.font = '12px Helvetica, Arial, sans-serif';
        g.fillText(label, X + 8, Y + IH + 24);
        if (r.asset) { g.fillStyle = 'rgba(255,255,255,.8)'; g.fillText(r.asset.length > 30 ? '…' + r.asset.slice(-29) : r.asset, X + 8, Y + IH + 39); }
      });
      return sheet.toDataURL('image/png');
    }, { mine, cls });
    const file = path.join(outDir, `${cls}.png`);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote ' + file);
  }
  fs.writeFileSync(path.join(outDir, 'catalogue.json'), JSON.stringify(rows.map(({ cell, ...r }) => r), null, 2));
  console.log('wrote ' + path.join(outDir, 'catalogue.json'));
  if (b.errors.length) { console.error('PAGE ERRORS:\n' + b.errors.slice(0, 20).join('\n')); code = 1; }
} catch (e) { console.error(e); code = 1; }
finally { await b.close(); server.stop(); }
process.exit(code);

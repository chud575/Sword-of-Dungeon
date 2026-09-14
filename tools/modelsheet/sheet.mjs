// Composite rendered thumbnails into contact sheets, grouped by the library's own folders.
// Usage: node tools/modelsheet/sheet.mjs --out shots/models [--per 50] [--cols 10]
//
// One 998-cell image is a poster, not a reference: at a readable thumbnail size it is 5000px wide
// and you cannot find anything in it. So the sheets follow the library's own categories and cap at
// `--per` models each, which is how you would actually look for a barrel.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : []).filter(Boolean));
const OUT = path.resolve(REPO, args.out || 'shots/models');
const PER = Number(args.per || 50), COLS = Number(args.cols || 10), S = Number(args.size || 160);

let meta = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8')).filter((m) => m.png && fs.existsSync(m.png));
// `Name@Clip.fbx` is a Unity ANIMATION CLIP: the same mesh again with no material on it. 185 of the
// 904 are these, and they pad the character sheets with grey duplicates of the model beside them.
if (args['skip-clips']) meta = meta.filter((m) => !path.basename(m.rel).includes('@'));
/** Category = the first two path segments, which is how this library is actually organised. */
const catOf = (rel) => { const p = rel.split(path.sep); return p.length > 2 ? `${p[0]}/${p[1]}` : p[0]; };
const groups = new Map();
for (const m of meta) { const c = catOf(m.rel); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(m); }
for (const list of groups.values()) list.sort((a, b) => a.rel.localeCompare(b.rel));

const sheets = [];
for (const [cat, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const n = Math.ceil(list.length / PER);
  for (let i = 0; i < n; i++) sheets.push({ cat, part: i + 1, of: n, items: list.slice(i * PER, (i + 1) * PER) });
}
console.log(`${meta.length} thumbnails | ${groups.size} categories | ${sheets.length} sheets`);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 600, height: 400 } })).newPage();
fs.mkdirSync(path.join(OUT, 'sheets'), { recursive: true });
const written = [];
for (const sh of sheets) {
  const items = sh.items.map((m) => ({
    name: path.basename(m.rel).replace(/\.fbx$/i, ''),
    b64: fs.readFileSync(m.png).toString('base64'),
    tex: !!m.tex,   // a texture was MATCHED — stable across runs, unlike the render-time flag
  }));
  const title = `${sh.cat}${sh.of > 1 ? `  ·  ${sh.part} / ${sh.of}` : ''}`;
  const url = await page.evaluate(async ({ items, title, S, COLS, count }) => {
    const PAD = 8, LBL = 20, HEAD = 52, CELL = S + PAD * 2, ROWH = CELL + LBL;
    const rows = Math.ceil(items.length / COLS);
    const c = document.createElement('canvas');
    c.width = COLS * CELL; c.height = HEAD + rows * ROWH + 10;
    const x = c.getContext('2d');
    x.fillStyle = '#14141c'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#1c1c26'; x.fillRect(0, 0, c.width, HEAD);
    x.fillStyle = '#e8b84a'; x.font = 'bold 22px ui-serif, Georgia, serif'; x.textAlign = 'left';
    x.fillText(title, 16, 33);
    x.fillStyle = '#8a8f9a'; x.font = '13px ui-monospace, monospace'; x.textAlign = 'right';
    x.fillText(`${count} models`, c.width - 16, 33);
    for (let i = 0; i < items.length; i++) {
      const im = new Image();
      await new Promise((r) => { im.onload = r; im.onerror = r; im.src = 'data:image/png;base64,' + items[i].b64; });
      const cx = (i % COLS) * CELL, cy = HEAD + Math.floor(i / COLS) * ROWH;
      x.fillStyle = (Math.floor(i / COLS) + i) % 2 ? '#181820' : '#15151d';
      x.fillRect(cx, cy, CELL, ROWH);
      x.drawImage(im, cx + PAD, cy + PAD, S, S);
      // name under the thumb, shrunk until it fits the cell rather than being clipped
      let name = items[i].name, fs2 = 11;
      x.textAlign = 'center'; x.fillStyle = items[i].tex ? '#d8d2c4' : '#9a9188';
      x.font = `${fs2}px ui-monospace, monospace`;
      while (x.measureText(name).width > CELL - 8 && fs2 > 7) { fs2 -= 0.5; x.font = `${fs2}px ui-monospace, monospace`; }
      if (x.measureText(name).width > CELL - 8) { while (name.length > 4 && x.measureText(name + '…').width > CELL - 8) name = name.slice(0, -1); name += '…'; }
      x.fillText(name, cx + CELL / 2, cy + CELL + 13);
    }
    return c.toDataURL('image/png');
  }, { items, title, S, COLS, count: sh.items.length });
  const safe = sh.cat.replace(/[^a-z0-9]+/gi, '_').toLowerCase() + (sh.of > 1 ? `_${String(sh.part).padStart(2, '0')}` : '');
  const file = path.join(OUT, 'sheets', `${safe}.png`);
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  written.push({ file, cat: sh.cat, n: sh.items.length });
  process.stdout.write(`\r  ${written.length}/${sheets.length} sheets  `);
}
console.log('');
await browser.close();
for (const w of written) console.log(`  ${String(w.n).padStart(3)}  ${path.basename(w.file)}`);

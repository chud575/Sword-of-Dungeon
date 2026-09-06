// Slice a labelled sprite sheet into individual sprites.
//
//   node tools/sheet-slice.mjs <sheet.png> <outDir> [--contact contact.png] [--x0 340]
//
// `--x0` starts the ROW scan at a column, which is how a title block in the sheet's corner is kept
// from bridging the gap between a section header and the row of sprites under it. Columns are still
// scanned across the whole width, because the sprite rows themselves do start at the left edge —
// any extra column that finds is decoration, and the rightmost N are the sprites.
//
// The sheet is art on a near-black ground, laid out in rows of sprites with a caption strip under
// each row and a section header above it. Nothing here is hard-coded to one sheet: rows are found
// by projecting ink onto the y axis and cutting at the empty bands, sprites by doing the same on x
// inside each row, and caption/header strips are told apart from sprite strips by height. Names
// come from `NAMES` below, in reading order, because there is no OCR here.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const SHEET = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3] || 'sheet-out');
const contactAt = process.argv.indexOf('--contact');
const CONTACT = contactAt > 0 ? path.resolve(process.argv[contactAt + 1]) : null;
const x0At = process.argv.indexOf('--x0');
const X0 = x0At > 0 ? Number(process.argv[x0At + 1]) : 0;

/** Reading order, row by row. A row with no entry here is skipped as a caption or header. */
const NAMES = [
  ['warrior', 'wizard', 'cleric', 'elf', 'dwarf', 'rogue', 'paladin'],
  ['skeleton', 'zombie', 'ghoul', 'ghost', 'ogre', 'goblin', 'orc', 'troll'],
  ['ogre-mage', 'specter', 'vampire', 'demon', 'beholder', 'medusa', 'minotaur', 'dragon'],
  ['giant-spider', 'giant-rat', 'wolf', 'bear', 'snake', 'bat', 'scorpion', 'slime', 'treasure-chest'],
];

const INK = 26;        // luminance above this counts as art, not background
const MIN_ROW_H = 40;  // a strip shorter than this is a caption or a section rule, not sprites
const GAP = 3;         // empty scanlines needed to call it a break

const b = await chromium.launch();
const page = await b.newPage();
const png = fs.readFileSync(SHEET).toString('base64');

const result = await page.evaluate(async ({ png, INK, MIN_ROW_H, GAP, NAMES, X0 }) => {
  const img = new Image();
  await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = 'data:image/png;base64,' + png; });
  const W = img.width, H = img.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, W, H).data;
  const lum = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  const inked = (x, y) => px[(y * W + x) * 4 + 3] > 8 && lum((y * W + x) * 4) > INK;

  /** Contiguous bands of `hit(i)` along 0..n, separated by at least GAP misses. */
  const bands = (n, hit) => {
    const out = [];
    let start = -1, miss = 0;
    for (let i = 0; i < n; i++) {
      if (hit(i)) { if (start < 0) start = i; miss = 0; }
      else if (start >= 0 && ++miss >= GAP) { out.push([start, i - miss]); start = -1; }
    }
    if (start >= 0) out.push([start, n - 1]);
    return out;
  };

  const rowHit = (y) => { for (let x = X0; x < W; x++) if (inked(x, y)) return true; return false; };
  const rows = bands(H, rowHit).filter(([a, z]) => z - a + 1 >= MIN_ROW_H);

  const sprites = [];
  const rowReport = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const [y0, y1] = rows[ri];
    const colHit = (x) => { for (let y = y0; y <= y1; y++) if (inked(x, y)) return true; return false; };
    let cols = bands(W, colHit);
    const names = NAMES[ri];
    if (!names || cols.length < names.length) {
      rowReport.push({ y: [y0, y1], cols: cols.length, want: names ? names.length : 0, used: false });
      continue;
    }
    // Extra columns on the left are decoration (a section rule, a leftover of the title block);
    // the sprites are the rightmost `names.length` of them.
    if (cols.length > names.length) cols = cols.slice(cols.length - names.length);
    rowReport.push({ y: [y0, y1], cols: cols.length, want: names.length, used: true });
    cols.forEach(([x0, x1], i) => {
      // tighten to the sprite's own ink
      let tx0 = x1, tx1 = x0, ty0 = y1, ty1 = y0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (!inked(x, y)) continue;
        if (x < tx0) tx0 = x; if (x > tx1) tx1 = x;
        if (y < ty0) ty0 = y; if (y > ty1) ty1 = y;
      }
      const w = tx1 - tx0 + 1, h = ty1 - ty0 + 1;
      const cut = document.createElement('canvas');
      cut.width = w; cut.height = h;
      cut.getContext('2d').drawImage(c, tx0, ty0, w, h, 0, 0, w, h);
      sprites.push({ name: names[i], x: tx0, y: ty0, w, h, png: cut.toDataURL('image/png').split(',')[1] });
    });
  }

  // one contact sheet, sprites laid out on their own baselines at native size
  const PAD = 18, LAB = 18;
  const perRow = 8;
  const cw = Math.max(...sprites.map((s) => s.w)) + PAD;
  const ch = Math.max(...sprites.map((s) => s.h)) + PAD + LAB;
  const sheetC = document.createElement('canvas');
  sheetC.width = cw * perRow;
  sheetC.height = ch * Math.ceil(sprites.length / perRow);
  const sg = sheetC.getContext('2d');
  sg.fillStyle = '#101014'; sg.fillRect(0, 0, sheetC.width, sheetC.height);
  sg.imageSmoothingEnabled = false;
  for (let i = 0; i < sprites.length; i++) {
    const s = sprites[i], col = i % perRow, row = Math.floor(i / perRow);
    const im = new Image();
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { im.onload = r; im.src = 'data:image/png;base64,' + s.png; });
    sg.drawImage(im, col * cw + (cw - s.w) / 2, row * ch + (ch - LAB - s.h));
    sg.fillStyle = '#8e94a6'; sg.font = '400 12px system-ui, sans-serif'; sg.textAlign = 'center';
    sg.fillText(`${s.name} ${s.w}x${s.h}`, col * cw + cw / 2, row * ch + ch - 4);
  }
  return { W, H, rowReport, sprites, contact: sheetC.toDataURL('image/png').split(',')[1] };
}, { png, INK, MIN_ROW_H, GAP, NAMES, X0 });

fs.mkdirSync(OUT, { recursive: true });
for (const s of result.sprites) fs.writeFileSync(path.join(OUT, `${s.name}.png`), Buffer.from(s.png, 'base64'));
if (CONTACT) fs.writeFileSync(CONTACT, Buffer.from(result.contact, 'base64'));

console.log(`sheet ${result.W}x${result.H}`);
for (const r of result.rowReport) console.log(`  strip y=${r.y[0]}..${r.y[1]}  ${r.cols} columns (want ${r.want})  ${r.used ? 'SPRITES' : 'SKIPPED - column count too low'}`);
console.log(`\n${result.sprites.length} sprites -> ${OUT}`);
const hs = result.sprites.map((s) => s.h);
console.log(`height range ${Math.min(...hs)}..${Math.max(...hs)} px, median ${hs.slice().sort((a, x) => a - x)[hs.length >> 1]}`);
for (const s of result.sprites) console.log(`  ${s.name.padEnd(15)} ${String(s.w).padStart(3)}x${String(s.h).padStart(3)}  @ ${s.x},${s.y}`);
await b.close();

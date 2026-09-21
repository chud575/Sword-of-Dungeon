// slice: cut the owner's dungeon-props sprite sheet into one PNG per sprite.
//
//   node tools/props2d-import/slice.mjs <sheet.(webp|png)> <outDir> [--ink 26] [--gap 4] [--minh 34]
//                                        [--contact shots/flat/sheet-index.png] [--names names.json]
//
// The sheet is art on a near-black ground in TWO COLUMNS of captioned sections, so a band of ink
// across the page holds sprites from both columns. Rows are found by projecting ink onto y and
// cutting at the empty scanlines, sprites by the same on x inside each row; captions and section
// rules fall out because they are shorter than `minh`. There is no OCR: sprites come out numbered in
// reading order and `--names` (a JSON array, `null` to drop one) names them.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(4).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]] : []).filter(Boolean));
const SHEET = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3] || 'sheet-out');
const INK = Number(args.ink ?? 26), GAP = Number(args.gap ?? 4), MIN_H = Number(args.minh ?? 26);
const MERGE = Number(args.merge ?? 3);   // texels of slack when joining the parts of one piece
const NAMES = args.names ? JSON.parse(fs.readFileSync(path.resolve(args.names), 'utf8')) : null;
const mime = SHEET.endsWith('.webp') ? 'image/webp' : SHEET.endsWith('.jpg') || SHEET.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';

const b = await chromium.launch();
const page = await b.newPage();
const data = fs.readFileSync(SHEET).toString('base64');

const result = await page.evaluate(async ({ data, mime, INK, GAP, MIN_H, MERGE, NAMES }) => {
  const img = new Image();
  await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = `data:${mime};base64,` + data; });
  const W = img.width, H = img.height;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, W, H).data;
  const lum = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  const inked = (x, y) => { const i = (y * W + x) * 4; return px[i + 3] > 8 && lum(i) > INK; };
  const bands = (n, hit) => {
    const out = []; let start = -1, miss = 0;
    for (let i = 0; i < n; i++) {
      if (hit(i)) { if (start < 0) start = i; miss = 0; }
      else if (start >= 0 && ++miss >= GAP) { out.push([start, i - miss]); start = -1; }
    }
    if (start >= 0) out.push([start, n - 1]);
    return out;
  };
  // CONNECTED COMPONENTS, not bands. The captions under each sprite are wider than the sprite and
  // nearly touch their neighbours, so a column projection merges whole sections into one blob (measured:
  // a 19-sprite band came out as 5 columns). Blobs of ink are labelled instead, the parts of one object
  // are merged by proximity, and the caption glyphs fall out on height.
  const seen = new Uint8Array(W * H);
  const boxes = [];
  const stack = new Int32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i0 = y * W + x;
    if (seen[i0] || !inked(x, y)) continue;
    let sp = 0; stack[sp++] = i0; seen[i0] = 1;
    let x0 = x, x1 = x, y0 = y, y1 = y, n = 0;
    while (sp) {
      const i = stack[--sp], cx = i % W, cy = (i / W) | 0;
      n++;
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (seen[ni] || !inked(nx, ny)) continue;
        seen[ni] = 1; stack[sp++] = ni;
      }
    }
    boxes.push({ x0, y0, x1, y1, n });
  }
  // merge boxes that are parts of one piece (a flame over its bracket, a chain over a lantern)
  const near = (a, b2) => a.x0 <= b2.x1 + MERGE && b2.x0 <= a.x1 + MERGE && a.y0 <= b2.y1 + MERGE && b2.y0 <= a.y1 + MERGE;
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length && !merged; i++) for (let j = i + 1; j < boxes.length; j++) {
      if (!near(boxes[i], boxes[j])) continue;
      boxes[i] = { x0: Math.min(boxes[i].x0, boxes[j].x0), y0: Math.min(boxes[i].y0, boxes[j].y0), x1: Math.max(boxes[i].x1, boxes[j].x1), y1: Math.max(boxes[i].y1, boxes[j].y1), n: boxes[i].n + boxes[j].n };
      boxes.splice(j, 1); merged = true; break;
    }
  }
  // a sprite is big; a caption is a strip of small glyphs
  const keep = boxes.filter((b2) => (b2.y1 - b2.y0 + 1) >= MIN_H && (b2.x1 - b2.x0 + 1) >= 10 && b2.n >= 120);
  keep.sort((a, b2) => (a.y0 - b2.y0 > 30 ? 1 : b2.y0 - a.y0 > 30 ? -1 : a.x0 - b2.x0));
  const strips = keep.map((b2) => ({ y: [b2.y0, b2.y1], h: b2.y1 - b2.y0 + 1, cols: 1, kept: true }));
  const sprites = [];
  for (const b2 of keep) {
    const w = b2.x1 - b2.x0 + 1, h = b2.y1 - b2.y0 + 1;
    const cut = document.createElement('canvas'); cut.width = w; cut.height = h;
    cut.getContext('2d').drawImage(c, b2.x0, b2.y0, w, h, 0, 0, w, h);
    sprites.push({ x: b2.x0, y: b2.y0, w, h, png: cut.toDataURL('image/png').split(',')[1] });
  }
  // an INDEXED contact sheet: every sprite with the number to name it by
  const PAD = 26, LAB = 20, perRow = 10;
  const cw = Math.max(...sprites.map((s) => s.w)) + PAD, ch = Math.max(...sprites.map((s) => s.h)) + PAD + LAB;
  const sc = document.createElement('canvas');
  sc.width = cw * perRow; sc.height = ch * Math.ceil(sprites.length / perRow);
  const sg = sc.getContext('2d');
  sg.fillStyle = '#101014'; sg.fillRect(0, 0, sc.width, sc.height);
  sg.imageSmoothingEnabled = false;
  for (let i = 0; i < sprites.length; i++) {
    const s = sprites[i], col = i % perRow, row = (i / perRow) | 0;
    const im = new Image();
    await new Promise((r) => { im.onload = r; im.src = 'data:image/png;base64,' + s.png; });
    sg.drawImage(im, col * cw + (cw - s.w) / 2, row * ch + (ch - LAB - s.h));
    sg.fillStyle = '#ffcf8a'; sg.font = 'bold 12px system-ui, sans-serif'; sg.textAlign = 'center';
    sg.fillText(NAMES && NAMES[i] ? NAMES[i] : String(i), col * cw + cw / 2, row * ch + ch - 18);
    sg.fillStyle = '#8e94a6'; sg.font = '11px system-ui, sans-serif';
    sg.fillText(`${s.w}x${s.h}`, col * cw + cw / 2, row * ch + ch - 4);
  }
  return { W, H, strips, sprites, contact: sc.toDataURL('image/png').split(',')[1] };
}, { data, mime, INK, GAP, MIN_H, MERGE, NAMES });

fs.mkdirSync(OUT, { recursive: true });
let kept = 0;
result.sprites.forEach((s, i) => {
  const name = NAMES ? NAMES[i] : `s${String(i).padStart(3, '0')}`;
  if (!name) return;
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.png, 'base64'));
  kept++;
});
if (args.contact) { fs.mkdirSync(path.dirname(path.resolve(args.contact)), { recursive: true }); fs.writeFileSync(path.resolve(args.contact), Buffer.from(result.contact, 'base64')); }
console.log(`sheet ${result.W}x${result.H}`);
console.log(`${result.strips.length} pieces, heights ${Math.min(...result.strips.map((s) => s.h))}..${Math.max(...result.strips.map((s) => s.h))}`);
console.log(`${result.sprites.length} sprites found, ${kept} written -> ${OUT}`);
result.sprites.forEach((s, i) => console.log(`  ${String(i).padStart(3)}  x=${String(s.x).padStart(4)} y=${String(s.y).padStart(4)}  ${String(s.w).padStart(3)}x${String(s.h).padStart(3)}${NAMES && NAMES[i] ? '  ' + NAMES[i] : ''}`));
await b.close();

// pack: the sliced sheet sprites into one atlas PNG + a manifest for the game.
//
//   node tools/props2d-import/pack.mjs <spriteDir> [--out src/assets/props2d] [--width 1024] [--bg 46]
//
// TWO THINGS HAPPEN HERE.
//  1. THE GROUND IS KEYED OUT BY FLOOD FILL, not by a luminance threshold. This art is drawn with hard
//     black outlines and black shadow sides; thresholding on darkness eats them and leaves the piece in
//     lace. The near-black that touches the crop's EDGE is the sheet's ground and nothing else, so the
//     fill starts there and stops at the outline.
//  2. Sprites are shelf-packed, tallest first, into one atlas with a one-texel gutter, and the manifest
//     records each one's rect and its trimmed size so the renderer can size a quad in texels.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(3).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]] : []).filter(Boolean));
const DIR = path.resolve(process.argv[2]);
const OUT = path.resolve(args.out || 'src/assets/props2d');
const WIDTH = Number(args.width || 1024);
// The sheet's ground is luma 0-4 almost everywhere (measured over every crop edge: 15,307 of ~17k edge
// pixels). It was 46, which let the fill run on into the black outlines and every dark interior — the
// shelf's back, the crate's shadow side, the portcullis — and left half the sheet in lace (2026-09-21).
const BG = Number(args.bg || 6);           // luma at or under this, reached from the edge, is ground

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.png')).sort();
const b = await chromium.launch();
const page = await b.newPage();
const input = files.map((f) => ({ name: f.replace(/\.png$/, ''), png: fs.readFileSync(path.join(DIR, f)).toString('base64') }));

const res = await page.evaluate(async ({ input, WIDTH, BG }) => {
  const load = async (png) => { const im = new Image(); await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = 'data:image/png;base64,' + png; }); return im; };
  // THE PIXEL GRID, DETECTED. Art handed over at 16x its own resolution (the loot sprites) must be
  // resampled back to native or NearestFilter tears it when the quad scales it down. The block size is
  // the most common run of identical pixels along the rows; art already at native resolution measures 1
  // and is left alone.
  const blockOf = (px, W, H) => {
    const runs = new Map();
    for (let y = 0; y < H; y += Math.max(1, H >> 5)) {
      let run = 1;
      for (let x = 1; x < W; x++) {
        const i = (y * W + x) * 4, j = i - 4;
        // NEAR-equal, not equal: these files have been through WebP, so a flat block of one colour
        // comes back with a point or two of noise on every pixel and exact runs measure 2 everywhere.
        const near = Math.abs(px[i] - px[j]) + Math.abs(px[i + 1] - px[j + 1]) + Math.abs(px[i + 2] - px[j + 2]) <= 24
          && Math.abs(px[i + 3] - px[j + 3]) <= 24;
        if (near) run++;
        else { if (run > 1) runs.set(run, (runs.get(run) || 0) + 1); run = 1; }
      }
    }
    // The block size is the most common run, but a run of 2k is also consistent with a block of k, so
    // the winner is checked against its own half: art at 16x shows runs at 16 AND at 32.
    let best = 1, n = 0;
    for (const [len, count] of runs) if (count > n && len <= 64) { n = count; best = len; }
    for (const half of [best / 2, best / 3, best / 4]) {
      if (half >= 2 && Number.isInteger(half) && (runs.get(half) || 0) > n * 0.35) best = half;
    }
    return Math.max(1, best);
  };

  const blocks = [];
  const cut = [];
  for (const it of input) {
    let im = await load(it.png);
    let c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    let g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    const probe = g.getImageData(0, 0, c.width, c.height);
    const blk = blockOf(probe.data, c.width, c.height);
    if (blk > 1) {                                   // resample to the art's own resolution
      const nw = Math.max(1, Math.round(c.width / blk)), nh = Math.max(1, Math.round(c.height / blk));
      const small = document.createElement('canvas'); small.width = nw; small.height = nh;
      const sg = small.getContext('2d', { willReadFrequently: true });
      const out = sg.createImageData(nw, nh);
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
        const sx = Math.min(c.width - 1, Math.floor((x + 0.5) * blk)), sy = Math.min(c.height - 1, Math.floor((y + 0.5) * blk));
        const si = (sy * c.width + sx) * 4, di = (y * nw + x) * 4;
        out.data[di] = probe.data[si]; out.data[di + 1] = probe.data[si + 1];
        out.data[di + 2] = probe.data[si + 2]; out.data[di + 3] = probe.data[si + 3];
      }
      sg.putImageData(out, 0, 0);
      c = small; g = sg;
      blocks.push(`${it.name} /${blk}`);
    }
    const d = g.getImageData(0, 0, c.width, c.height);
    const px = d.data, W = c.width, H = c.height;
    const lum = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    // A source that already carries its own transparency (edge pixels clear) is trusted as it is. The
    // flood below is for sheet cuts on a dark ground: on a cut-out it poured in through the gaps between
    // the owner's pit-rim stones and erased the pit's earth and both staircases (2026-09-21).
    let clearEdge = 0, edgeN = 0;
    for (let x = 0; x < W; x++) { edgeN += 2; if (px[x * 4 + 3] < 16) clearEdge++; if (px[((H - 1) * W + x) * 4 + 3] < 16) clearEdge++; }
    for (let y = 0; y < H; y++) { edgeN += 2; if (px[(y * W) * 4 + 3] < 16) clearEdge++; if (px[(y * W + W - 1) * 4 + 3] < 16) clearEdge++; }
    const ownAlpha = clearEdge > edgeN * 0.5;
    // flood the ground in from every edge pixel that is dark enough
    const q = [];
    const seen = new Uint8Array(W * H);
    const push = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = y * W + x; if (seen[i]) return; if (lum(i * 4) > BG) return; seen[i] = 1; q.push(i); };
    if (!ownAlpha) {
      for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
      for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
    }
    while (q.length) {
      const i = q.pop(), x = i % W, y = (i / W) | 0;
      px[i * 4 + 3] = 0;
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    }
    // trim to what is left
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) continue;
    g.putImageData(d, 0, 0);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const t = document.createElement('canvas'); t.width = w; t.height = h;
    t.getContext('2d').drawImage(c, x0, y0, w, h, 0, 0, w, h);
    cut.push({ name: it.name, w, h, canvas: t });
  }
  // shelf pack, tallest first
  const order = cut.slice().sort((a, z) => z.h - a.h);
  const PADDING = 1;
  let x = PADDING, y = PADDING, shelf = 0, total = PADDING;
  const place = [];
  for (const s of order) {
    if (x + s.w + PADDING > WIDTH) { x = PADDING; y += shelf + PADDING; shelf = 0; }
    place.push({ s, x, y });
    x += s.w + PADDING;
    if (s.h > shelf) shelf = s.h;
    total = y + shelf + PADDING;
  }
  const atlas = document.createElement('canvas');
  atlas.width = WIDTH; atlas.height = Math.pow(2, Math.ceil(Math.log2(total)));
  const ag = atlas.getContext('2d');
  ag.imageSmoothingEnabled = false;
  const map = {};
  for (const p of place) {
    ag.drawImage(p.s.canvas, p.x, p.y);
    map[p.s.name] = { x: p.x, y: p.y, w: p.s.w, h: p.s.h };
  }
  return { png: atlas.toDataURL('image/png').split(',')[1], map, W: atlas.width, H: atlas.height, n: place.length, blocks };
}, { input, WIDTH, BG });

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'atlas.png'), Buffer.from(res.png, 'base64'));
const names = Object.keys(res.map).sort();
fs.writeFileSync(path.join(OUT, 'map.js'),
  `// Generated by tools/props2d-import/pack.mjs — the owner's dungeon-props sprite sheet, sliced and packed.\n`
  + `// Each entry is the sprite's rect in atlas.png, in pixels. The sheet's own art size IS the game size:\n`
  + `// render/props/props2d.js builds a quad of w x h TEXELS, so 32 across is one tile.\n`
  + `export const PROPS2D_ATLAS = { w: ${res.W}, h: ${res.H} };\n`
  + `export const PROPS2D = ${JSON.stringify(res.map, null, 1)};\n`);
console.log(`packed ${res.n} sprites into ${res.W}x${res.H} -> ${path.relative(process.cwd(), OUT)}/atlas.png`);
if (res.blocks.length) console.log('resampled to native: ' + res.blocks.join(', '));
console.log(names.join(' '));
await b.close();

// Turn a directory of sliced sheet sprites (tools/sheet-slice.mjs) into src/assets/castSheet.js.
//
//   node tools/sheet-import.mjs <slicedDir>
//
// WHAT THIS HAS TO FIX ABOUT THE SOURCE ART
//  · NO ALPHA. The sheet is painted on opaque black, and every one of these sprites also uses black
//    for its OUTLINE and its darkest shading. Keying by colour would eat holes in them, so the
//    background is removed by a flood fill inwards from the border: only black that is connected to
//    the outside is dropped, and a black pixel enclosed by the figure is kept.
//  · WRONG SIZE. The art is ~150 px tall; the hero this game draws is 46 texels. Everything is
//    fitted into one texel box (`FIT_W` x `FIT_H`) with its aspect kept, so the cast lands on the
//    same grid as the floor it stands on.
//  · NOT ACTUALLY PIXEL ART. Measured on the source: 99.4% of horizontal colour runs are a single
//    pixel, so there is no coarse grid underneath to snap to. The downscale is a plain high-quality
//    resample and alpha is re-hardened afterwards (the billboard material uses an alpha test, so a
//    soft edge would fringe).
//
// The atlas ships UNCOMPRESSED base64. Every other generated asset here is gzipped, but those are
// inflated behind an async loader; sprite builders are called synchronously by CharacterFactory, so
// this one has to be readable with a bare atob(). See the note in src/render/sprites/castSheet.js.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAST_MAP } from '../src/render/sprites/castMap.js';

const DIR = path.resolve(process.argv[2]);
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/assets');

/** Texel box every sprite is fitted inside; 46 is the hero's own figure height (AMBIENCE §1). */
const FIT_W = 56, FIT_H = 46;
/** Alpha below this after the resample is cut; above it is forced opaque. */
const ALPHA_CUT = 130;
/** A pixel this dark, and connected to the border, is background. */
const BG = 26;


const names = [...new Set(Object.values(CAST_MAP))];
const missing = names.filter((n) => !fs.existsSync(path.join(DIR, `${n}.png`)));
if (missing.length) { console.error('missing sliced sprites:', missing.join(', ')); process.exit(1); }

const b = await chromium.launch();
const page = await b.newPage();
const payload = names.map((n) => ({ n, png: fs.readFileSync(path.join(DIR, `${n}.png`)).toString('base64') }));

const result = await page.evaluate(async ({ payload, FIT_W, FIT_H, ALPHA_CUT, BG }) => {
  const cut = [];
  for (const p of payload) {
    const img = new Image();
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = 'data:image/png;base64,' + p.png; });
    const W = img.width, H = img.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W, H);
    const px = d.data;

    // flood fill the background in from every border pixel that is dark
    const seen = new Uint8Array(W * H);
    const stack = [];
    const dark = (i) => px[i * 4] <= BG && px[i * 4 + 1] <= BG && px[i * 4 + 2] <= BG;
    for (let x = 0; x < W; x++) { stack.push(x, (H - 1) * W + x); }
    for (let y = 0; y < H; y++) { stack.push(y * W, y * W + W - 1); }
    while (stack.length) {
      const i = stack.pop();
      if (seen[i] || !dark(i)) continue;
      seen[i] = 1;
      const x = i % W, y = (i / W) | 0;
      if (x > 0) stack.push(i - 1);
      if (x < W - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - W);
      if (y < H - 1) stack.push(i + W);
    }
    for (let i = 0; i < W * H; i++) if (seen[i]) px[i * 4 + 3] = 0;
    g.putImageData(d, 0, 0);

    // trim to what is left
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (px[(y * W + x) * 4 + 3] < 8) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const tw = x1 - x0 + 1, th = y1 - y0 + 1;

    // fit inside the texel box, aspect kept
    const k = Math.min(FIT_W / tw, FIT_H / th);
    const dw = Math.max(1, Math.round(tw * k)), dh = Math.max(1, Math.round(th * k));
    const s = document.createElement('canvas'); s.width = dw; s.height = dh;
    const sg = s.getContext('2d', { willReadFrequently: true });
    sg.imageSmoothingEnabled = true; sg.imageSmoothingQuality = 'high';
    sg.drawImage(c, x0, y0, tw, th, 0, 0, dw, dh);
    const sd = sg.getImageData(0, 0, dw, dh);
    // re-harden alpha: the billboard material alpha-tests, so a soft edge would fringe
    for (let i = 0; i < dw * dh; i++) {
      const a = sd.data[i * 4 + 3];
      sd.data[i * 4 + 3] = a >= ALPHA_CUT ? 255 : 0;
    }
    cut.push({ n: p.n, w: dw, h: dh, rgba: Array.from(sd.data) });
  }

  // shelf-pack into a power-of-two atlas
  cut.sort((a, z) => z.h - a.h);
  const PAD = 1;
  let AW = 128;
  while (true) {
    let x = PAD, y = PAD, rowH = 0, ok = true;
    for (const s of cut) {
      if (x + s.w + PAD > AW) { x = PAD; y += rowH + PAD; rowH = 0; }
      s.x = x; s.y = y; x += s.w + PAD; rowH = Math.max(rowH, s.h);
    }
    const need = y + rowH + PAD;
    if (need <= AW * 2 && ok) { var AH = 1; while (AH < need) AH <<= 1; break; }
    AW <<= 1;
  }
  const data = new Uint8ClampedArray(AW * AH * 4);
  for (const s of cut) {
    for (let yy = 0; yy < s.h; yy++) {
      for (let xx = 0; xx < s.w; xx++) {
        const si = (yy * s.w + xx) * 4, di = ((s.y + yy) * AW + (s.x + xx)) * 4;
        data[di] = s.rgba[si]; data[di + 1] = s.rgba[si + 1];
        data[di + 2] = s.rgba[si + 2]; data[di + 3] = s.rgba[si + 3];
      }
    }
  }
  let bin = ''; const CH = 0x8000;
  for (let i = 0; i < data.length; i += CH) bin += String.fromCharCode.apply(null, data.subarray(i, i + CH));
  return { AW, AH, b64: btoa(bin), index: cut.map((s) => ({ n: s.n, x: s.x, y: s.y, w: s.w, h: s.h })) };
}, { payload, FIT_W, FIT_H, ALPHA_CUT, BG });

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/castSheet.js`,
`// GENERATED - do not edit by hand. See tools/sheet-import.mjs.
// The imported character sheet: every sprite keyed off its black ground, fitted into a
// ${FIT_W}x${FIT_H} texel box and packed into one atlas. Raw RGBA, base64, NOT gzipped - sprite
// builders run synchronously (see src/render/sprites/castSheet.js).
export const CAST_ATLAS_W = ${result.AW}, CAST_ATLAS_H = ${result.AH};
export const CAST_RECTS = ${JSON.stringify(result.index)};
export const CAST_RGBA_B64 = '${result.b64}';
`);

const kb = (n) => (n / 1024).toFixed(0) + 'KB';
for (const r of result.index) console.log(`  ${r.n.padEnd(15)} ${String(r.w).padStart(3)}x${String(r.h).padStart(2)} @ ${r.x},${r.y}`);
console.log(`atlas ${result.AW}x${result.AH}, ${result.index.length} sprites`);
console.log(`castSheet.js ${kb(result.b64.length)}`);
await b.close();

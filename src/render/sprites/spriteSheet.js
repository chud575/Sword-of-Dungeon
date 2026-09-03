// spriteSheet: packs animation frames into one RGBA atlas (row per animation+facing) and keeps
// per-frame metadata (rect, pivot, UVs, durations). `packSheet` is pure data; `createSheetTexture`
// turns it into a THREE.DataTexture (NearestFilter, no mipmaps, sRGB); `drawSheet` paints the sheet
// on a 2D canvas for inspection.
import * as THREE from 'three';
import { toRGBA } from './pixelPainter.js';

/**
 * @typedef {{name:string, facing:string, index:number, x:number, y:number, w:number, h:number, px:number, py:number,
 *   u0:number, v0:number, u1:number, v1:number, duration:number, foot:{w:number, cx:number, drop:number}}} SheetFrame
 * @typedef {{width:number, height:number, data:Uint8ClampedArray, frames:SheetFrame[],
 *   anims:Object<string, Object<string, {frames:number[], durations:number[], loop:boolean, total:number}>>, rows:{label:string, y:number, h:number}[]}} Sheet
 */

/**
 * Pack a built character (see heroSprite.buildHero) into an atlas. Frames of one animation+facing
 * share a row so the sheet reads like a classic strip.
 * @param {{anims:object, palette:import('./pixelPainter.js').Palette, w:number, h:number, pivot:{x:number,y:number}}} built
 * @param {{pad?:number, order?:string[], facings?:string[]}} [opts]
 * @returns {Sheet}
 */
export function packSheet(built, { pad = 1, order = null, facings = ['S', 'E', 'N'] } = {}) {
  const names = order || Object.keys(built.anims);
  const rows = [];
  let width = 0, y = pad;
  const frames = [];
  const anims = {};
  for (const name of names) {
    for (const f of facings) {
      const a = built.anims[name] && built.anims[name][f];
      if (!a) continue;
      const rowH = Math.max(...a.frames.map((p) => p.h));
      const idxs = [];
      let x = pad;
      a.frames.forEach((p, i) => {
        const fr = { name, facing: f, index: i, x, y, w: p.w, h: p.h, px: built.pivot.x, py: built.pivot.y, u0: 0, v0: 0, u1: 0, v1: 0, duration: a.durations[i] ?? 100, pix: p };
        idxs.push(frames.length); frames.push(fr);
        x += p.w + pad;
      });
      width = Math.max(width, x);
      rows.push({ label: `${name} ${f}`, y, h: rowH });
      (anims[name] ||= {})[f] = { frames: idxs, durations: a.durations.slice(), loop: !!a.loop, total: a.durations.reduce((s, d) => s + d, 0) };
      y += rowH + pad;
    }
  }
  const height = y;
  const W = pow2(width), H = pow2(height);
  const data = new Uint8ClampedArray(W * H * 4);
  const emissive = new Set((built.emissive || '').split('').map((c) => c.charCodeAt(0)));
  for (const fr of frames) {
    const rgba = toRGBA(fr.pix, built.palette);
    // emissive keys (glints, magic) are flagged in alpha (< 255, still above the alpha test)
    if (emissive.size) for (let i = 0; i < fr.pix.d.length; i++) if (emissive.has(fr.pix.d[i])) rgba[i * 4 + 3] = 240;
    for (let yy = 0; yy < fr.h; yy++) {
      const src = yy * fr.w * 4, dst = ((fr.y + yy) * W + fr.x) * 4;
      data.set(rgba.subarray(src, src + fr.w * 4), dst);
    }
    // DataTexture rows start at the bottom: v runs upward
    fr.u0 = fr.x / W; fr.u1 = (fr.x + fr.w) / W;
    fr.v1 = 1 - fr.y / H; fr.v0 = 1 - (fr.y + fr.h) / H;
    fr.foot = footMetrics(fr.pix, fr.px, fr.py);
    delete fr.pix;
  }
  return { width: W, height: H, data, frames, anims, rows };
}

function pow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

/** How many rows above the lowest opaque row still count as "the feet". */
const FOOT_ROWS = 2;
/**
 * Contact-shadow metrics for one frame, in texels: the opaque span of the figure's bottom
 * `FOOT_ROWS` rows (`w` wide, centred `cx` texels right of the pivot) and how far that lowest row
 * sits below the pivot row (`drop`, usually 0 — the pivot is on the ground). spriteBillboard scales
 * its blob shadow from this so the shadow hugs the actual boots at any animation frame.
 * @param {import('./pixelPainter.js').Pix} pix @param {number} pivotX @param {number} pivotY
 */
function footMetrics(pix, pivotX, pivotY) {
  let by = -1;
  for (let y = pix.h - 1; y >= 0 && by < 0; y--) for (let x = 0; x < pix.w; x++) if (pix.d[y * pix.w + x]) { by = y; break; }
  if (by < 0) return { w: 4, cx: 0, drop: 0 };
  let x0 = pix.w, x1 = -1;
  for (let y = Math.max(0, by - FOOT_ROWS + 1); y <= by; y++)
    for (let x = 0; x < pix.w; x++) if (pix.d[y * pix.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  return { w: x1 - x0 + 1, cx: (x0 + x1 + 1) / 2 - pivotX, drop: (by + 1) - pivotY };
}

/**
 * A crisp texture for the atlas.
 * @param {Sheet} sheet
 */
export function createSheetTexture(sheet) {
  // flip rows so data row 0 is the bottom (GL convention for DataTexture)
  const W = sheet.width, H = sheet.height;
  const flipped = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) flipped.set(sheet.data.subarray(y * W * 4, (y + 1) * W * 4), (H - 1 - y) * W * 4);
  const tex = new THREE.DataTexture(flipped, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false; tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Draw the whole sheet at an integer zoom on a 2D canvas context with row labels (debug overlay).
 * @param {Sheet} sheet @param {CanvasRenderingContext2D} ctx
 * @param {{zoom?:number, x?:number, y?:number, labelW?:number, bg?:string, columns?:number}} [o]
 */
export function drawSheet(sheet, ctx, { zoom = 4, x = 16, y = 16, labelW = 96, bg = null, columns = 1 } = {}) {
  const off = document.createElement('canvas');
  off.width = sheet.width; off.height = sheet.height;
  const octx = off.getContext('2d');
  octx.putImageData(new ImageData(sheet.data, sheet.width, sheet.height), 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
  ctx.textBaseline = 'top';
  const perCol = Math.ceil(sheet.rows.length / columns);
  const rowW = Math.max(...sheet.rows.map((r) => { const fr = sheet.frames.filter((f) => f.y === r.y); const last = fr[fr.length - 1]; return last ? last.x + last.w : 0; })) * zoom;
  const colW = labelW + rowW + 24;
  sheet.rows.forEach((r, i) => {
    const col = Math.floor(i / perCol), row = i % perCol;
    const cx = x + col * colW, cy = y + row * (r.h * zoom + 6);
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(cx + labelW, cy, rowW, r.h * zoom); }
    ctx.fillStyle = '#cfc8d8';
    ctx.fillText(r.label, cx, cy + Math.max(0, r.h * zoom / 2 - 7));
    const fr = sheet.frames.filter((f) => f.y === r.y);
    for (const f of fr) {
      ctx.drawImage(off, f.x, f.y, f.w, f.h, cx + labelW + f.x * zoom, cy, f.w * zoom, f.h * zoom);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.strokeRect(cx + labelW + f.x * zoom + 0.5, cy + 0.5, f.w * zoom - 1, f.h * zoom - 1);
    }
  });
}

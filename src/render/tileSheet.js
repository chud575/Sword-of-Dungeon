// tileSheet: an IMPORTED hand-painted tile sheet, decoded into floor-atlas cells.
//
// WHAT THIS IS FOR
// `tiles.js` authors the board's field vocabulary procedurally and is approved; this module is the
// other way in — a sheet somebody painted, sliced at import to the game's own 32-texel grid
// (tools/tilesheet-import.mjs) and dropped into the SAME atlas cells the procedural fields
// normally fill. Nothing here restyles `tiles.js`. A skin is opt-in and asynchronous: the game
// boots on the procedural atlas exactly as before, and applying a skin repaints it in place.
//
// WHY IT IS ASYNC AND THE ATLAS IS NOT
// The sheet ships gzipped (the bundle allows no fetch and no data: URIs), and `DecompressionStream`
// is a stream — so the bytes cannot be there when `getTextures()` paints the atlas on first use.
// Hence: paint procedurally, then repaint when the sheet has inflated. That ordering is also why a
// skin can be switched at runtime at all, which is the whole point of comparing two of them.
import { SHEET_COLS, SHEET_ROWS, SHEET_CELL, SHEET_W, SHEET_RGBA_GZ_B64 } from '../assets/tilesheet.js';

let sheet = null;      // Uint8ClampedArray RGBA, SHEET_W x SHEET_H
let pending = null;

/** Inflate the sheet once. Resolves to the RGBA bytes, or null if the environment cannot. */
export async function loadTileSheet() {
  if (sheet) return sheet;
  if (!pending) {
    pending = (async () => {
      const bin = atob(SHEET_RGBA_GZ_B64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const buf = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      sheet = new Uint8ClampedArray(buf);
      return sheet;
    })().catch((e) => { console.warn('tileSheet: could not inflate the sheet', e); return null; });
  }
  return pending;
}

/** True once the sheet is in memory and `readCell` will return pixels. */
export function sheetReady() { return !!sheet; }

/** How many cells the sheet holds. `col` is 0-based left to right, `row` 0-based top to bottom. */
export const SHEET = { cols: SHEET_COLS, rows: SHEET_ROWS, cell: SHEET_CELL };

/**
 * Copy one sheet cell into a caller's albedo/height buffers at (x0, y0).
 *
 * The height field is derived from the cell's own LUMINANCE, which is what keeps a sheet cell
 * honest in this renderer: `flagstoneAtlas` builds the normal map and the roughness from the
 * height and nothing else, so relief, lighting and sheen cannot disagree with the picture. A
 * painted grout line is dark, so it sits low and reads matte — the same thing `paintTile` arranges
 * deliberately. `RELIEF` is kept well under 1 because these tiles already have their lighting
 * PAINTED IN; a full-strength normal off them would light the same bump twice.
 *
 * @param {[number,number]} cell [col, row] into the sheet
 * @param {{alb:Float32Array, hgt:Float32Array, W:number, x0:number, y0:number, S:number}} dst
 */
export function blitCell([col, row], { alb, hgt, W, x0, y0, S }) {
  if (!sheet) return false;
  const c = Math.max(0, Math.min(SHEET_COLS - 1, col | 0)), r = Math.max(0, Math.min(SHEET_ROWS - 1, row | 0));
  const sx = c * SHEET_CELL, sy = r * SHEET_CELL;
  const RELIEF = 0.62, FLOOR = 0.24;
  for (let py = 0; py < S; py++) {
    // a sheet cell is exactly SHEET_CELL square and the atlas cell is exactly S; they are the same
    // number by construction (the importer is given TEXELS_PER_TILE), but clamp rather than assume
    const ry = Math.min(SHEET_CELL - 1, py);
    for (let px = 0; px < S; px++) {
      const rx = Math.min(SHEET_CELL - 1, px);
      const si = ((sy + ry) * SHEET_W + sx + rx) * 4;
      const gi = (y0 + py) * W + x0 + px;
      const R = sheet[si] / 255, G = sheet[si + 1] / 255, B = sheet[si + 2] / 255;
      alb[gi * 3] = R; alb[gi * 3 + 1] = G; alb[gi * 3 + 2] = B;
      hgt[gi] = FLOOR + (R * 0.3 + G * 0.59 + B * 0.11) * RELIEF;
    }
  }
  return true;
}

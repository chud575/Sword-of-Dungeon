// Symmetric shadowcasting (Albert Ford's algorithm) with exact rational slopes.
// Visibility is symmetric between floor tiles: if A sees B then B sees A (same radius).
import { DIRS8 } from '../core/constants.js';

function floorDiv(a, b) { return Math.floor(a / b); }
function ceilDiv(a, b) { return Math.ceil(a / b); }

/**
 * Compute a field of view.
 * @param {number} ox origin x
 * @param {number} oy origin y
 * @param {number} radius max distance
 * @param {(x:number,y:number)=>boolean} isOpaque
 * @param {(x:number,y:number)=>void} reveal called once per visible tile (origin included)
 */
export function computeFov(ox, oy, radius, isOpaque, reveal) {
  const r2 = radius * radius + radius;
  const seen = new Set();
  const mark = (x, y) => {
    const dx = x - ox, dy = y - oy;
    if (dx * dx + dy * dy > r2) return;
    const key = y * 100000 + x;
    if (seen.has(key)) return;
    seen.add(key);
    reveal(x, y);
  };
  mark(ox, oy);
  for (let q = 0; q < 4; q++) {
    const transform = (row, col) => {
      switch (q) {
        case 0: return [ox + col, oy - row]; // north
        case 1: return [ox + col, oy + row]; // south
        case 2: return [ox + row, oy + col]; // east
        default: return [ox - row, oy + col]; // west
      }
    };
    // row: { depth, sn, sd, en, ed } slopes as fractions sn/sd (start) and en/ed (end)
    const rows = [{ depth: 1, sn: -1, sd: 1, en: 1, ed: 1 }];
    while (rows.length) {
      const row = rows.pop();
      if (row.depth > radius) continue;
      // tiles: col from round_ties_up(depth*start) to round_ties_down(depth*end)
      const minCol = floorDiv(2 * row.depth * row.sn + row.sd, 2 * row.sd);
      const maxCol = ceilDiv(2 * row.depth * row.en - row.ed, 2 * row.ed);
      let prevWall = null; // null = no previous tile
      for (let col = minCol; col <= maxCol; col++) {
        const [tx, ty] = transform(row.depth, col);
        const wall = isOpaque(tx, ty);
        // symmetric check: col >= depth*start && col <= depth*end
        const symmetric = col * row.sd >= row.depth * row.sn && col * row.ed <= row.depth * row.en;
        if (wall || symmetric) mark(tx, ty);
        if (prevWall === true && !wall) { row.sn = 2 * col - 1; row.sd = 2 * row.depth; }
        if (prevWall === false && wall) {
          rows.push({ depth: row.depth + 1, sn: row.sn, sd: row.sd, en: 2 * col - 1, ed: 2 * row.depth });
        }
        prevWall = wall;
      }
      if (prevWall === false) rows.push({ depth: row.depth + 1, sn: row.sn, sd: row.sd, en: row.en, ed: row.ed });
    }
  }
}

/**
 * Update level.visible (reset) and level.explored (accumulated) from a viewpoint.
 * The 8 neighbouring tiles are always revealed (the original's radius-1 reveal).
 * @returns {number} number of visible tiles
 */
export function computeVisibility(level, x, y, radius) {
  level.visible.fill(0);
  let n = 0;
  const reveal = (tx, ty) => {
    if (!level.inBounds(tx, ty)) return;
    const i = level.idx(tx, ty);
    if (!level.visible[i]) { level.visible[i] = 1; level.explored[i] = 1; n++; }
  };
  computeFov(x, y, radius, (tx, ty) => level.isOpaque(tx, ty), reveal);
  for (const d of DIRS8) reveal(x + d.dx, y + d.dy);
  return n;
}

/** Is (bx,by) visible from (ax,ay) within radius? (pure, does not touch masks) */
export function canSee(level, ax, ay, bx, by, radius) {
  const dx = bx - ax, dy = by - ay;
  if (dx * dx + dy * dy > radius * radius + radius) return false;
  let found = false;
  computeFov(ax, ay, radius, (tx, ty) => level.isOpaque(tx, ty), (tx, ty) => { if (tx === bx && ty === by) found = true; });
  return found;
}

/** Bresenham line of sight (walls block; endpoints excluded). */
export function lineOfSight(level, x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (;;) {
    if (x === x1 && y === y1) return true;
    if (!(x === x0 && y === y0) && level.isOpaque(x, y)) return false;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

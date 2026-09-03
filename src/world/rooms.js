// Room shape library for the level generator. Each builder returns a local boolean mask
// (row-major, w*h) describing which cells of the bounding box are open floor. Shapes are
// always 4-connected so the digger can start from the room centre. Pure and rng-driven.
import { DIRS4, DIRS8 } from '../core/constants.js';

/** @typedef {{w:number,h:number,mask:Uint8Array,shape:string,pillars:number}} RoomMask */

/** Bounding-box size ranges per shape. */
const SIZES = {
  rect: { w: [3, 8], h: [3, 6] },
  bitten: { w: [5, 9], h: [4, 7] },
  cross: { w: [6, 10], h: [5, 8] },
  round: { w: [5, 9], h: [5, 7] },
  cave: { w: [6, 11], h: [5, 8] },
  hall: { w: [9, 14], h: [6, 9] },
};

/** Shape weights by level style (0 = shallow masonry .. 1 = deep caverns). */
export function shapeWeights(caveBias) {
  return {
    rect: 4 - caveBias * 2,
    bitten: 2,
    cross: 1.5,
    round: 1.2,
    cave: 0.6 + caveBias * 5,
    hall: 0, // halls are placed deliberately, see generator
  };
}

/** Weighted pick of a shape name. */
export function pickShape(rng, weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rng.next() * total;
  for (const [name, w] of entries) { r -= w; if (r <= 0) return name; }
  return entries[entries.length - 1][0];
}

/** Random box size for a shape. */
export function rollSize(rng, shape) {
  const s = SIZES[shape] || SIZES.rect;
  return { w: rng.int(s.w[0], s.w[1]), h: rng.int(s.h[0], s.h[1]) };
}

/**
 * Build a room mask of the given shape and size.
 * @returns {RoomMask}
 */
export function buildMask(rng, shape, w, h) {
  switch (shape) {
    case 'bitten': return bitten(rng, w, h);
    case 'cross': return cross(rng, w, h);
    case 'round': return round(w, h);
    case 'cave': return cave(rng, w, h);
    case 'hall': return hall(rng, w, h);
    default: return rect(w, h);
  }
}

function make(w, h, shape) { return { w, h, mask: new Uint8Array(w * h), shape, pillars: 0 }; }

function rect(w, h) {
  const m = make(w, h, 'rect');
  m.mask.fill(1);
  return m;
}

/** Rectangle with 1–3 corners bitten off (L / T / stepped outlines). */
function bitten(rng, w, h) {
  const m = rect(w, h); m.shape = 'bitten';
  const corners = rng.shuffle([[0, 0], [1, 0], [0, 1], [1, 1]]).slice(0, rng.int(1, 3));
  for (const [cx, cy] of corners) {
    const bw = rng.int(1, Math.max(1, Math.floor(w / 3))), bh = rng.int(1, Math.max(1, Math.floor(h / 3)));
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const px = cx ? w - 1 - x : x, py = cy ? h - 1 - y : y;
      m.mask[py * w + px] = 0;
    }
  }
  return m;
}

/** Union of a horizontal and a vertical band: cross, T and thick-L outlines. */
function cross(rng, w, h) {
  const m = make(w, h, 'cross');
  const bh = rng.int(2, Math.max(2, h - 2)), by = rng.int(0, h - bh);
  const bw = rng.int(2, Math.max(2, w - 2)), bx = rng.int(0, w - bw);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if ((y >= by && y < by + bh) || (x >= bx && x < bx + bw)) m.mask[y * w + x] = 1;
  }
  return m;
}

/** Ellipse sampled at cell centres. */
function round(w, h) {
  const m = make(w, h, 'round');
  const a = w / 2, b = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5 - a) / a, dy = (y + 0.5 - b) / b;
    if (dx * dx + dy * dy <= 1.02) m.mask[y * w + x] = 1;
  }
  return m;
}

/** Cellular-automaton cavern: random fill, smoothing, keep the largest blob. */
function cave(rng, w, h) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const m = make(w, h, 'cave');
    const g = m.mask;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      g[y * w + x] = rng.chance(edge ? 0.25 : 0.58) ? 1 : 0;
    }
    // a seed blob in the middle so the cave has a heart
    const cx = w >> 1, cy = h >> 1;
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 2; x <= cx + 2; x++) g[y * w + x] = 1;
    const next = new Uint8Array(w * h);
    for (let it = 0; it < 4; it++) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let open = 0;
        for (const d of DIRS8) {
          const nx = x + d.dx, ny = y + d.dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && g[ny * w + nx]) open++;
        }
        const self = g[y * w + x];
        next[y * w + x] = self ? (open >= 3 ? 1 : 0) : (open >= 5 ? 1 : 0);
      }
      g.set(next);
    }
    keepLargest(m);
    let count = 0;
    for (let i = 0; i < g.length; i++) count += g[i];
    // stalagmite pillars inside big caves: lone rock cells that survived smoothing count as pillars
    m.pillars = countPillars(m);
    if (count >= Math.max(12, w * h * 0.38)) return m;
  }
  // fallback: a rounded blob
  const m = round(w, h); m.shape = 'cave';
  return m;
}

/** Wide hall with either a grid of columns or a colonnade along the long axis. */
function hall(rng, w, h) {
  const m = rect(w, h); m.shape = 'hall';
  const g = m.mask;
  const colonnade = rng.chance(0.5);
  if (colonnade) {
    // two rows of pillars one tile in from the long walls
    const step = rng.int(2, 3), off = rng.int(1, 2);
    const rows = h >= 7 ? [1, h - 2] : [1, h - 2];
    for (let x = off; x < w - 1; x += step) for (const y of rows) { g[y * w + x] = 0; m.pillars++; }
  } else {
    const sx = rng.int(2, 3), sy = rng.int(2, 3);
    const ox = 1 + ((w - 2 - 1) % sx >> 1), oy = 1 + ((h - 2 - 1) % sy >> 1);
    for (let y = oy; y < h - 1; y += sy) for (let x = ox; x < w - 1; x += sx) { g[y * w + x] = 0; m.pillars++; }
  }
  return m;
}

/** Keep only the largest 4-connected open component of a mask. */
export function keepLargest(m) {
  const { w, h, mask } = m;
  const label = new Int16Array(w * h).fill(-1);
  const sizes = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [i];
    label[i] = id;
    while (stack.length) {
      const j = stack.pop();
      size++;
      const x = j % w, y = (j / w) | 0;
      for (const d of DIRS4) {
        const nx = x + d.dx, ny = y + d.dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (!mask[k] || label[k] >= 0) continue;
        label[k] = id;
        stack.push(k);
      }
    }
    sizes.push(size);
  }
  if (sizes.length <= 1) return m;
  let best = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
  for (let i = 0; i < mask.length; i++) if (mask[i] && label[i] !== best) mask[i] = 0;
  return m;
}

/** Count enclosed rock cells (rock surrounded on all 4 sides by open floor). */
function countPillars(m) {
  const { w, h, mask } = m;
  let n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (mask[y * w + x]) continue;
    if (mask[y * w + x - 1] && mask[y * w + x + 1] && mask[(y - 1) * w + x] && mask[(y + 1) * w + x]) n++;
  }
  return n;
}

/** Open cell nearest the box centre (used as the room's centre / tunnel start). */
export function maskCentre(m) {
  const { w, h, mask } = m;
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  let best = -1, bestD = Infinity;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    if (d < bestD) { bestD = d; best = y * w + x; }
  }
  return best < 0 ? { x: w >> 1, y: h >> 1 } : { x: best % w, y: (best / w) | 0 };
}

/** Number of open cells in a mask. */
export function maskArea(m) { let n = 0; for (let i = 0; i < m.mask.length; i++) n += m.mask[i]; return n; }

// floorField: the level's ground, painted ONCE, in WORLD space, for the whole level.
//
// WHY THE FLOOR IS NOT A GRID OF TILES ANY MORE
// The floor used to be one instanced slab per tile, each wearing one 32-texel atlas cell, each
// chamfered, turned, tilted a hair and given its own value step, laid over a dirt bed that showed
// in the gaps. Every one of those choices drew the 1m grid: the chamfer lit a square, the gap drew a
// dark line round it, the value step made neighbours read as different tiles, and a cell's stones
// stopped dead at its edge because the cell could not know what its neighbour held. From the play
// camera the grid was the loudest thing on the screen — the reference art is a continuous floor of
// chunky, bevelled, irregular flagstones in which the tile grid simply is not there.
//
// So the floor is now a picture of the whole level at `TEXELS_PER_TILE` texels a tile — 1536x1024
// for a 48x32 map — painted here once per level and laid on ONE flat mesh with world-space uvs.
// Stones are laid out over REGIONS (a room, the corridor network, the wall mass), not over tiles, so
// they run straight across tile boundaries; the tile grid survives only where a region changes, at a
// doorway, which is exactly where the old board wanted a change of field. Nothing is resampled: the
// picture is on the same 32-texels-a-tile grid the cast is, and the surface shader snaps its lookup
// to the live world texel grid like every other patched surface (materials.js "ONE TEXEL, ONE SIZE").
//
// The painter is pure (no DOM, no three): a Level in, typed arrays out, deterministic from the level
// seed — it can be run and inspected in node (tools/fieldpreview.mjs).
import * as THREE from 'three';
import { TILE } from '../core/constants.js';
import { TILE_STYLES, FOREST_STYLES } from './tiles.js';
import { LOOK } from './look.js';
import { PAINTED, DC, DC_CORRIDOR, DC_CIRCLES } from './paintedTiles.js';

/** Texels a tile. Must equal materials.js TEXELS_PER_TILE (import would be circular via tiles.js). */
export const FIELD_S = 32;
/**
 * Texels a tile for the CLEAN stone painter (render/look.js). 64 is the look; the mobile profile
 * (core/mobile.js) drops it to 32, a quarter of the memory — the field's albedo, normal and roughness
 * textures and their CPU mirrors are ~300 MB at 64 on a 48x32 level. Set once, before the first level.
 */
export let CLEAN_FIELD_S = 64;
/** @param {32|64} s */
export function setCleanFieldTexels(s) { CLEAN_FIELD_S = s === 32 ? 32 : 64; return CLEAN_FIELD_S; }

// ------------------------------------------------------------------ deterministic noise
function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const hash3 = (a, b, c, s) => hash2(a + Math.imul(c | 0, 7919), b - Math.imul(c | 0, 104729), s);
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct = 3) {
  let v = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { v += vnoise(x * f, y * f, s + i * 17) * a; n += a; a *= 0.5; f *= 2.03; }
  return v / n;
}
const hexRgb = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** A tiny seeded stream for layout (never Math.random). */
function stream(seed) {
  let s = (seed >>> 0) || 1;
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  return { next, int: (a, b) => a + Math.floor(next() * (b - a + 1)), chance: (p) => next() < p };
}

// ------------------------------------------------------------------ stone layouts per pattern
/**
 * How each field pattern (tiles.js PATTERN_TURNS) is LAID. Row height and stone width are ranges in
 * texels; `tall` is the chance a stone runs on into the next course, which is what turns rows of
 * bricks into flagstones. Sizes are deliberately incommensurate with the 32-texel tile.
 */
const LAYOUT = {
  // RANDOM ASHLAR (`skyline`, the r3 layout, restored in review-04 after the coursed bond read as brick laid flat):
  // stones are stacked by filling the lowest open slot next, so a horizontal joint runs one or two stones and
  // stops — no course runs the width of a room — and the bond rule keeps a stone end off the joints below it.
  cobble:      { kind: 'skyline', rowH: [9, 16], w: [9, 18], round: 2, bevel: 1, crack: 0.14 },
  grid:        { kind: 'skyline', rowH: [11, 21], w: [11, 22], round: 1, bevel: 1, crack: 0.22 },
  bigSlab:     { kind: 'skyline', rowH: [16, 30], w: [18, 34], round: 1, bevel: 1, crack: 0.55 },
  speckle:     { kind: 'skyline', rowH: [14, 24], w: [15, 28], round: 1, bevel: 1, crack: 0.25, mottle: 1 },
  // a running bond on a FLOOR reads as a wall laid flat: brick fields are large square-ish flags
  // (review-04: at 16-30 wide the default start room read coursed, joint runs 1.6x across; a touch narrower keeps it flag-shaped)
  brick:       { kind: 'skyline', rowH: [15, 26], w: [13, 24], round: 1, bevel: 1, crack: 0.3 },
  bars:        { kind: 'skyline', rowH: [11, 16], w: [22, 40], round: 1, bevel: 1, crack: 0.2 },
  basketweave: { kind: 'plank', rowH: [7, 7], w: [30, 72] },
  // fixed lattices on a pitch the 32-texel tile does not divide, so their joints drift off the grid
  checker:     { kind: 'ashlar', rowH: [21, 21], w: [21, 21], fixed: true, duo: true, round: 1, bevel: 1, crack: 0.15 },
  xcross:      { kind: 'ashlar', rowH: [21, 21], w: [21, 21], fixed: true, xmark: true, round: 1, bevel: 1, crack: 0.1 },
  crackedPoly: { kind: 'voronoi', cell: 13, crack: 0 },
  // the harlequin lattice read as the old atlas tile through and around a pool (review-03 F8): laid stone now
  diamond:     { kind: 'skyline', rowH: [11, 21], w: [11, 22], round: 1, bevel: 1, crack: 0.2 },
  wallBlock:   { kind: 'skyline', rowH: [14, 20], w: [16, 26], round: 1, bevel: 2, crack: 0.1, cap: true },
};

/**
 * Live-tunable layout choices (tools read and set these, then rebuild the level):
 *  phaseRule 'hist' | 'far' | 'none' — how a course height is chosen against the 1m rhythm (see coursedStones);
 *  coldCap — in the cold bands (6-12) a room field brighter than this albedo luma is scaled down to it (0 = off);
 *  coldTint — the cold-band counter-tint on room fields;
 *  pairP / pairMinK — how often a stone at least pairMinK x its course height is laid as a stacked pair;
 *  gain — the floor fields' value (not the wall caps').
 */
export const FIELD_LAYOUT_TUNE = { phaseRule: 'hist', coldCap: 0, coldTint: [1.04, 1.0, 0.92], pairP: 0.35, pairMinK: 2, gain: 1.12 };

/**
 * Coursed flagstone: see LAYOUT. Returns rects [x0,x1)x[y0,y1) in texels (last col/row is joint).
 */
function coursedStones(bb, P, seed) {
  const r = stream(seed);
  const stones = [];
  const K = P.lenK || 1.6, OFF = P.off == null ? 0.3 : P.off;
  let below = [];
  let y = bb.y0 - r.int(0, P.rowH[1] - 1), row = 0;
  const phases = [];   // the tile phase of the last few bed joints
  while (y < bb.y1) {
    // BED JOINTS OFF THE 1M RHYTHM (review-03/r4): a course height drawn blind averaged ~11 texels, so three
    // courses came to one tile and a room's bed joints lined up with the tile rows. Of a few candidate heights,
    // take the one whose joint lands farthest (round the tile) from the last three bed joints' phases.
    let h = r.int(P.rowH[0], P.rowH[1]);
    const rule = FIELD_LAYOUT_TUNE.phaseRule;
    if (rule === 'far') {
      let far = -1;
      for (let t = 0; t < 5; t++) {
        const c = t ? r.int(P.rowH[0], P.rowH[1]) : h, ph = (((y + c) % 32) + 32) % 32;
        let dmin = 99;
        for (const q of phases) { const dd = Math.abs(ph - q); dmin = Math.min(dmin, dd, 32 - dd); }
        if (dmin > far) { far = dmin; h = c; }
      }
    } else if (rule === 'hist') {
      // the least-used 4-texel phase bin among the last eight bed joints; ties keep the blind draw
      let best = 99;
      for (let t = 0; t < 4; t++) {
        const c = t ? r.int(P.rowH[0], P.rowH[1]) : h, bin = ((((y + c) % 32) + 32) % 32) >> 2;
        const used = phases.filter((q) => q >> 2 === bin).length;
        if (used < best) { best = used; h = c; }
      }
    }
    phases.push((((y + h) % 32) + 32) % 32); if (phases.length > 8) phases.shift();
    // flags, not bricks: 1.6-2.8x as long as the course is tall (a longer run read as a wall laid flat, review-01 F2)
    const wMin = Math.max(P.w[0], Math.ceil(h * K)), wMax = Math.max(wMin + 4, Math.min(P.w[1], Math.ceil(h * 2.8)));
    const joints = [];
    let x = bb.x0 - r.int(1, wMax);
    while (x < bb.x1) {
      let best = wMin, bestScore = -1;
      for (let t = 0; t < 16; t++) {
        const w = r.int(wMin, wMax), jx = x + w;
        let d = 1e9;
        for (const bj of below) { const dd = Math.abs(jx - bj); if (dd < d) d = dd; }
        const score = d / (OFF * w);
        if (score >= 1) { best = w; bestScore = score; break; }
        if (score > bestScore) { bestScore = score; best = w; }
      }
      // A STACKED PAIR in place of one long stone, now and then: the bed joint jogs for one stone's length, so no
      // course reads as a ruled line, and both halves still share the stone's two head joints — nothing stacks.
      if (h >= 10 && best >= (P.pairMinK || FIELD_LAYOUT_TUNE.pairMinK) * h && r.next() < (P.pairP == null ? FIELD_LAYOUT_TUNE.pairP : P.pairP)) {
        const h1 = Math.round(h * (0.42 + r.next() * 0.16));
        stones.push({ x0: x, x1: x + best, y0: y, y1: y + h1, id: stones.length + 1, col: Math.floor((x - bb.x0) / 16), row });
        stones.push({ x0: x, x1: x + best, y0: y + h1, y1: y + h, id: stones.length + 1, col: Math.floor((x - bb.x0) / 16), row });
      } else stones.push({ x0: x, x1: x + best, y0: y, y1: y + h, id: stones.length + 1, col: Math.floor((x - bb.x0) / 16), row });
      joints.push(x + best);
      x += best;
    }
    below = joints; y += h; row++;
  }
  return stones;
}

/**
 * Lay a region's stones as rects [x0,x1)x[y0,y1) in texels. The last column and row of every rect
 * is its mortar. Courses start at a random phase so their joints never sit on tile lines.
 */
function ashlarStones(bb, P, seed) {
  const r = stream(seed);
  const stones = [];
  let carry = [];          // stones from the course above that run on into this one
  let row = 0;
  let y = bb.y0 - (P.align ? 0 : P.fixed ? (5 + (seed & 7)) % P.rowH[0] : r.int(0, P.rowH[1] - 1));
  while (y < bb.y1) {
    const h = r.int(P.rowH[0], P.rowH[1]);
    for (const c of carry) c.y1 = y + h;
    const occupied = carry.map((c) => [c.x0, c.x1]).sort((a, b) => a[0] - b[0]);
    const next = [];
    let x = bb.x0 - (P.align ? 0 : P.fixed ? (11 + (seed & 5)) % P.w[0] : P.bond ? ((row & 1) ? P.w[0] / 2 : 0) + (seed % P.w[0]) : r.int(0, P.w[1] - 1));
    let oi = 0;
    while (x < bb.x1) {
      while (oi < occupied.length && occupied[oi][1] <= x) oi++;
      if (oi < occupied.length && occupied[oi][0] <= x) { x = occupied[oi][1]; continue; }
      let w = r.int(P.w[0], P.w[1]);
      if (oi < occupied.length && x + w > occupied[oi][0]) w = occupied[oi][0] - x;
      if (w < 5 && stones.length && !P.fixed) {        // a sliver: fold it into the stone before
        const prev = stones[stones.length - 1];
        if (prev.y0 === y && prev.x1 === x) { prev.x1 += w; x += w; continue; }
      }
      const st = { x0: x, x1: x + w, y0: y, y1: y + h, id: stones.length + 1, col: Math.floor((x - bb.x0) / P.w[0]), row };
      stones.push(st);
      if (P.tall && !st.ranOn && r.chance(P.tall) && w >= 10) { st.ranOn = true; next.push(st); }
      x += w;
    }
    carry = next;
    y += h; row++;
  }
  return stones;
}

/**
 * Random ashlar: fill the lowest open slot of a skyline with a stone of random width and height.
 * A slot narrower than a stone is brought level with its lower neighbour, so nothing is left as a
 * deep sliver. Returns rects [x0,x1)x[y0,y1) in texels (last col/row is joint), like `ashlarStones`.
 */
function skylineStones(bb, P, seed) {
  const r = stream(seed);
  const stones = [];
  const sky = [];   // the open top of the field: {x0, x1, y, j} — j is the joints in the course a slot sits on
  for (let x = bb.x0 - r.int(0, P.w[1]); x < bb.x1;) {
    const w = r.int(P.w[0], P.w[1]);
    sky.push({ x0: x, x1: x + w, y: bb.y0 - r.int(0, P.rowH[1]), j: [] });
    x += w;
  }
  const minRest = Math.ceil(P.w[0] * 0.6), GAP = 4;
  for (let guard = 0; guard < 400000; guard++) {
    let mi = 0;
    for (let k = 1; k < sky.length; k++) if (sky[k].y < sky[mi].y) mi = k;
    const sl = sky[mi];
    if (sl.y >= bb.y1) break;
    const segW = sl.x1 - sl.x0;
    // THE BOND RULE (review-02 F9). Random widths alone left vertical joints running straight on through
    // two to four courses, and the floor read in files. A stone may not END within GAP texels of a joint
    // in the course it sits on; a width that would is simply drawn again.
    let w = -1;
    for (let tries = 0; tries < 12 && w < 0; tries++) {
      let c = r.int(P.w[0], P.w[1]);
      if (c >= segW || segW - c < minRest) c = segW;
      if (c === segW || sl.j.every((jx) => Math.abs(sl.x0 + c - jx) >= GAP)) w = c;
    }
    if (w < 0) w = segW;
    let h = r.int(P.rowH[0], P.rowH[1]);
    const nbL = mi > 0 ? sky[mi - 1].y : null, nbR = mi < sky.length - 1 ? sky[mi + 1].y : null;
    if (segW < P.w[0]) {
      const nb = Math.min(nbL ?? 1e9, nbR ?? 1e9);
      if (nb < 1e9 && nb - sl.y >= 5) h = nb - sl.y;
    }
    stones.push({ x0: sl.x0, x1: sl.x0 + w, y0: sl.y, y1: sl.y + h, id: stones.length + 1, col: Math.floor((sl.x0 - bb.x0) / 16), row: Math.floor((sl.y - bb.y0) / 16) });
    if (w === segW) { sl.y += h; sl.j = []; }
    else sky.splice(mi, 1, { x0: sl.x0, x1: sl.x0 + w, y: sl.y + h, j: [] }, { x0: sl.x0 + w, x1: sl.x1, y: sl.y, j: sl.j.filter((jx) => jx > sl.x0 + w) });
    for (let k = sky.length - 1; k > 0; k--) {
      if (sky[k].y !== sky[k - 1].y) continue;
      sky[k - 1].j = [...sky[k - 1].j, sky[k - 1].x1, ...sky[k].j];
      sky[k - 1].x1 = sky[k].x1; sky.splice(k, 1);
    }
  }
  return stones;
}

/** A style's paint: the field's tones as rgb, how worn, and how light the region is. */
function paletteOf(style, value, opts) {
  return {
    base: hexRgb(style.base), alt: hexRgb(style.alt), grout: hexRgb(style.grout), edge: hexRgb(style.edge),
    wear: style.wear, value, moss: opts.moss == null ? 1 : opts.moss, gseed: opts.gseed | 0,
  };
}

/**
 * ONE ATLAS CELL of a style, laid by the same painter as the level's field — for the few surfaces
 * still cut from the atlas (stair treads, pool kerbs, pit lips: materials.js). Stones stop at the
 * cell's edge with a joint, which is what a kerb block or a tread is.
 * @returns {{alb:Float32Array, hgt:Float32Array}} 32x32
 */
export function paintSwatch(styleId, seed = 1) {
  const S = FIELD_S, style = TILE_STYLES[styleId] || TILE_STYLES.corridor;
  const out = { S, W: 1, H: 1, TW: S, TH: S, alb: new Float32Array(S * S * 3), hgt: new Float32Array(S * S) };
  const P = LAYOUT[style.pattern] || LAYOUT.grid;
  const regionOf = new Int16Array(1), stoneOf = new Int32Array(S * S).fill(-1);
  const pal = paletteOf(style, 1, { gseed: seed });
  const bb = { x0: 0, y0: 0, x1: S, y1: S };
  if (P.kind === 'coursed' || P.kind === 'skyline' || P.kind === 'ashlar' || P.kind === 'plank') {
    const stones = P.kind === 'coursed' ? coursedStones(bb, P, seed) : P.kind === 'skyline' ? skylineStones(bb, P, seed) : ashlarStones(bb, P, seed);
    for (const st of stones) paintStone(out, st, P, pal, seed, 0, regionOf, stoneOf, () => true);
  } else paintCellular(out, bb, P, pal, seed, 0, regionOf, stoneOf);
  return out;
}

/**
 * THE STREAM'S FORDS (review-02 G4). A glade's centre is kept dry (world/forest.js), which cuts the
 * stream; the dry FLOOR tiles in that cut, with water above and below them, are laid as a ford of
 * stepping stones over shallow water instead of leaving the channel to end in a squared-off pool.
 * dungeon.js lays water under these tiles too. Nothing here changes what is walkable.
 * @returns {{x:number,y:number}[]}
 */
export function streamFords(level) {
  const out = [];
  if (!level || level.biome !== 'forest') return out;
  const W = level.width, H = level.height;
  // a ford is a run of at most three dry FLOOR tiles in one column with water directly above and directly below:
  // anything looser painted isolated square ponds beside the stream (review-03 G7)
  for (let x = 0; x < W; x++) {
    for (let y = 1; y < H - 1; y++) {
      if (level.get(x, y - 1) !== TILE.WATER || level.get(x, y) !== TILE.FLOOR) continue;
      let e = y;
      while (e < H && level.get(x, e) === TILE.FLOOR && e - y < 4) e++;
      if (e - y <= 3 && e < H && level.get(x, e) === TILE.WATER) for (let k = y; k < e; k++) out.push({ x, y: k });
    }
  }
  return out;
}

// ------------------------------------------------------------------ the dungeon
/**
 * Paint the level. `opts.tint` is the level's stone family multiplier (materials.js stoneFamily);
 * `opts.glass` re-reads the value through the sword level's violet-black glass.
 * @returns {{W:number,H:number,S:number,TW:number,TH:number,alb:Float32Array,hgt:Float32Array,alpha:Uint8Array,aux:Float32Array}}
 */
export function paintFloorField(level, opts = {}) {
  // CLEAN STONE IS PAINTED AT 64 TEXELS A TILE (render/look.js). At the play camera 32 texels a tile is two device
  // pixels a texel, so 64 is one: still nearest-sampled on the shader's texel snap (materials.js uFieldScale).
  const S = LOOK.clean && level.biome !== 'forest' ? CLEAN_FIELD_S : FIELD_S, W = level.width, H = level.height, TW = W * S, TH = H * S;
  const out = {
    W, H, S, TW, TH,
    alb: new Float32Array(TW * TH * 3), hgt: new Float32Array(TW * TH),
    alpha: new Uint8Array(TW * TH).fill(255), aux: new Float32Array(TW * TH),
  };
  if (level.biome === 'forest') paintForest(level, out, opts);
  else paintDungeon(level, out, opts);
  return out;
}

/**
 * THE PAINTED TILES (render/paintedTiles.js). Hand-painted art replaces the procedural stone tile by tile:
 * walls take the wall-top set, corridors the corridor set, every other floor the flagstone set, each tile
 * one of four variants turned a hashed quarter-turn so a room is not one stamp. Floors then take a
 * sparse scatter of the painted overlays (cracks, bones, rubble, blood). Everything that follows in
 * paintDungeon — the pool bed, the wall-top front band, the wall-foot shade, the level tint — still
 * applies on top. The paint stands in for relief too, gently: dark joints sit low, lit faces high.
 */
function paintPaintedTiles(level, out, seed, roomOf) {
  const { S, W, H, TW, alb, hgt } = out;
  const P = PAINTED;
  // ?tiles=dc: this level's Dungeon Crawlers atlas (levels 1-5 take atlases 1-5, then round again). Every room lays
  // one of its six materials; the corridors share one material for the whole level.
  let dcSet = null, dcN = 0;
  if (DC) {
    const loaded = DC.map((m, n) => (m ? n : 0)).filter(Boolean);
    const want = (((level.depth | 0) - 1) % 5) + 1;
    const n = DC[want] ? want : loaded.length ? loaded[((level.depth | 0) - 1) % loaded.length] : 0;
    dcSet = n ? DC[n] : null; dcN = n;
  }
  // corridors are the atlas's brick run; rooms take one of the other five materials
  const dcCorr = DC_CORRIDOR;
  // A ROOM IS ONE CONTINUOUS FIELD: a seamless flagstone texture laid in world space across the room, one of the
  // set picked per room, shifted per room so neighbouring rooms do not repeat in step
  const field = (tex, x, y, ox, oy) => {
    const FS = tex.size;
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const sx = (x * S + px + ox) % FS, sy = (y * S + py + oy) % FS, si = sy * FS + sx, di = (y * S + py) * TW + x * S + px;
      const r = tex.rgb[si * 3], g = tex.rgb[si * 3 + 1], b = tex.rgb[si * 3 + 2];
      alb[di * 3] = r; alb[di * 3 + 1] = g; alb[di * 3 + 2] = b;
      hgt[di] = 0.38 + (0.2126 * r + 0.7152 * g + 0.0722 * b) * 0.24;
    }
  };
  const blit = (tile, x, y, rot, overlay) => {
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      let sx = px, sy = py;
      if (rot === 1) { sx = py; sy = S - 1 - px; } else if (rot === 2) { sx = S - 1 - px; sy = S - 1 - py; } else if (rot === 3) { sx = S - 1 - py; sy = px; }
      const si = sy * S + sx, di = (y * S + py) * TW + x * S + px;
      const a = overlay ? tile.a[si] : 1;
      if (a <= 0) continue;
      const r = tile.rgb[si * 3], g = tile.rgb[si * 3 + 1], b = tile.rgb[si * 3 + 2];
      alb[di * 3] += (r - alb[di * 3]) * a; alb[di * 3 + 1] += (g - alb[di * 3 + 1]) * a; alb[di * 3 + 2] += (b - alb[di * 3 + 2]) * a;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      hgt[di] += (0.38 + l * 0.24 - hgt[di]) * a;
    }
  };
  // overlay weights: cracks most often, blood rarely
  const OVERLAY_P = [0.014, 0.008, 0.03, 0.012];   // bones, blood, crack, rubble (paintedTiles.js SETS order)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = level.get(x, y);
    if (t === TILE.WATER) continue;
    if (dcSet && t !== TILE.WALL) {
      const rm = roomOf[y * W + x];
      const mi = t === TILE.CORRIDOR || rm < 0 ? dcCorr : [0, 1, 2, 3, 4][Math.floor(hash2(rm + 1, 5, seed + 4010) * 5) % 5];
      // a circle set lays its quarters as 2×2 blocks counted from the room's corner, so every circle is whole
      const circle = DC_CIRCLES[dcN] && DC_CIRCLES[dcN][mi];
      let vi = Math.floor(hash2(x, y, seed + 4011) * 4) % 4;
      if (circle) {
        const room = rm >= 0 ? level.rooms[rm] : null;
        const rx = x - (room ? room.x : 0), ry = y - (room ? room.y : 0);
        vi = circle[((ry & 1) << 1) | (rx & 1)];
      }
      const tile = dcSet[mi][vi];
      blit(tile, x, y, 0, false);
      if (tile.n) {
        // the tile's painted normal map rides along into the field's normal texture (fieldTextures)
        if (!out.nrm) out.nrm = new Uint8Array(out.TW * out.TH * 3);
        for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
          const si = (py * S + px) * 3, di = ((y * S + py) * TW + x * S + px) * 3;
          out.nrm[di] = tile.n[si]; out.nrm[di + 1] = tile.n[si + 1]; out.nrm[di + 2] = tile.n[si + 2];
        }
      }
    } else if (t !== TILE.WALL && t !== TILE.CORRIDOR && P.field && P.field.length) {
      const rm = roomOf[y * W + x], key = rm >= 0 ? rm + 1 : 0;
      const tex = P.field[Math.floor(hash2(key, 7, seed + 4005) * P.field.length) % P.field.length];
      field(tex, x, y, Math.floor(hash2(key, 11, seed + 4006) * tex.size), Math.floor(hash2(key, 13, seed + 4007) * tex.size));
    } else {
      const set = t === TILE.WALL ? P.wall : t === TILE.CORRIDOR ? P.corridor : P.floor;
      const pick = Math.floor(hash2(x, y, seed + 4001) * set.length) % set.length;
      // wall tops are coursed rectangular blocks: a quarter turn stands them on end and the band reads jumbled
      blit(set[pick], x, y, t === TILE.WALL ? 0 : Math.floor(hash2(x, y, seed + 4002) * 4) % 4, false);
    }
    if (t !== TILE.FLOOR) continue;
    let h = hash2(x, y, seed + 4003);
    for (let k = 0; k < OVERLAY_P.length; k++) {
      if (h < OVERLAY_P[k]) { blit(P.overlay[k], x, y, Math.floor(hash2(x, y, seed + 4004) * 4) % 4, true); break; }
      h -= OVERLAY_P[k];
    }
  }
}

function roomIndex(level) {
  const W = level.width, H = level.height, roomOf = new Int16Array(W * H).fill(-1);
  level.rooms.forEach((r, i) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (x >= 0 && y >= 0 && x < W && y < H) roomOf[y * W + x] = i; });
  return roomOf;
}

function paintDungeon(level, out, opts) {
  const { S, W, H, TW, TH, alb, hgt } = out;
  const seed = ((level.seed | 0) * 31 + (level.depth | 0) * 977) ^ 0x2c1b3c6d;
  const tint = opts.tint || [1, 1, 1];
  const gseed = seed ^ 0x3779b9;
  const roomOf = roomIndex(level);
  const T = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? level.get(x, y) : TILE.WALL);

  // ---- regions: the wall mass, the corridor network, and each room
  const regionOf = new Int16Array(W * H);
  const regions = [];
  const keyIndex = new Map();
  const regionFor = (key, styleId, room) => {
    if (!keyIndex.has(key)) { keyIndex.set(key, regions.length); regions.push({ key, styleId, room, x0: TW, y0: TH, x1: 0, y1: 0 }); }
    return keyIndex.get(key);
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = level.get(x, y);
    let ri;
    if (t === TILE.WALL) ri = regionFor('wall', 'wallTop', null);
    else if (t === TILE.CORRIDOR) ri = regionFor('corr', 'corridor', null);
    else {
      const rm = roomOf[y * W + x];
      const id = rm >= 0 ? level.rooms[rm].tileStyle : null;
      ri = rm >= 0 ? regionFor('room' + rm, id && TILE_STYLES[id] ? id : 'corridor', level.rooms[rm]) : regionFor('corr', 'corridor', null);
    }
    regionOf[y * W + x] = ri;
    const g = regions[ri];
    g.x0 = Math.min(g.x0, x * S); g.y0 = Math.min(g.y0, y * S); g.x1 = Math.max(g.x1, (x + 1) * S); g.y1 = Math.max(g.y1, (y + 1) * S);
  }

  const stoneOf = new Int32Array(TW * TH).fill(-1);
  regions.forEach((rg, ri) => {
    let style = TILE_STYLES[rg.styleId];
    let P = LAYOUT[style.pattern] || LAYOUT.grid;
    // THE BOARD LOOK (render/look.js): every floor is one neutral grey flagstone, every wall top one pale block masonry
    if (LOOK.base) { const cap = rg.styleId === 'wallTop'; style = cap ? LOOK_CAP : LOOK_FLOOR; P = lookLayout(cap, S); }
    const rseed = seed + ri * 7919;
    const room = rg.room;
    let value = 1;
    const rt = room && room.type;
    if (rt === 'crypt') value = 0.9; else if (rt === 'cistern') value = 0.94; else if (rt === 'library') value = 1.03; else if (rt === 'vault') value = 1.06;
    else if (rt === 'temple' || rt === 'shrine') value = 1.04;
    const pal = paletteOf(style, LOOK.base ? 1 : rg.styleId === 'wallTop' ? value : value * FIELD_LAYOUT_TUNE.gain, { ...opts, gseed });
    // COLD BANDS TINT A PALE ROOM (review-03 F1d: chroma 0.145, measured hue 207-225 — the band's blue key on
    // warm-grey stone). The field leans warm by as much, so under that key it lands near grey.
    // (Its VALUE is no longer capped here: glare is the field shader's highlight shoulder — materials.js — which
    // leaves dim rooms at depth 8-9 alone, where the old albedo cap took a third of their light, review-03 F12.)
    const depth = level.depth | 0;
    if (room && depth >= 6 && depth <= 12) {
      const k3 = FIELD_LAYOUT_TUNE.coldTint;
      for (const key of ['base', 'alt', 'edge']) pal[key] = [pal[key][0] * k3[0], pal[key][1] * k3[1], pal[key][2] * k3[2]];
      const cap = FIELD_LAYOUT_TUNE.coldCap, lb = pal.base[0] * 0.2126 + pal.base[1] * 0.7152 + pal.base[2] * 0.0722;
      if (cap > 0 && lb > cap) for (const key of ['base', 'alt', 'edge']) pal[key] = pal[key].map((c) => c * cap / lb);
    }
    const inRegion = (px, py) => regionOf[((py / S) | 0) * W + ((px / S) | 0)] === ri;
    if (!LOOK.base && room && (room.type === 'temple' || room.type === 'shrine')) {
      // THE TEMPLE IS A RING OF SLABS ROUND ITS ALTAR (review-02 F11), not whatever field was dealt it —
      // a pale checker read as a bathroom floor and was the brightest floor in the frame
      paintRings(out, rg, room, paletteOf(TILE_STYLES.slabGrey, 0.9, { ...opts, gseed }), rseed, ri, regionOf, stoneOf);
    } else if (P.kind === 'coursed' || P.kind === 'skyline' || P.kind === 'ashlar' || P.kind === 'plank') {
      const stones = P.kind === 'coursed' ? coursedStones(rg, P, rseed) : P.kind === 'skyline' ? skylineStones(rg, P, rseed) : ashlarStones(rg, P, rseed);
      for (const st of stones) paintStone(out, st, P, pal, rseed, ri, regionOf, stoneOf, inRegion);
    } else {
      paintCellular(out, rg, P, pal, rseed, ri, regionOf, stoneOf);
    }
  });

  // ---- THE PAINTED TILES replace the procedural stone wherever they are loaded at this density
  if (LOOK.base && PAINTED && PAINTED.size === S) paintPaintedTiles(level, out, seed, roomOf);

  // ---- THRESHOLDS (F7): where one field meets another, a row of long worn slabs straddles the line,
  // so a doorway is a laid sill and not a straight cut between two patterns
  if (!LOOK.base) {
    const corrStyle = TILE_STYLES.corridor, cp = paletteOf(corrStyle, 1.04, { ...opts, gseed });
    cp.base = mixInto([0, 0, 0], cp.base, cp.edge, 0.12);
    const TP = { round: 1, bevel: 1 };
    const floorT = (x, y) => x >= 0 && y >= 0 && x < W && y < H && level.get(x, y) !== TILE.WALL && level.get(x, y) !== TILE.WATER;
    const runs = [];   // [vertical?, line, from, to] in tiles
    for (let pass = 0; pass < 2; pass++) {
      const vert = pass === 0;
      const lines = vert ? W - 1 : H - 1, len = vert ? H : W;
      for (let a = 0; a < lines; a++) {
        let start = -1;
        for (let b = 0; b <= len; b++) {
          const x = vert ? a : b, y = vert ? b : a, x2 = vert ? a + 1 : b, y2 = vert ? b : a + 1;
          const on = b < len && floorT(x, y) && floorT(x2, y2) && regionOf[y * W + x] !== regionOf[y2 * W + x2];
          if (on && start < 0) start = b;
          if (!on && start >= 0) { runs.push([vert, a + 1, start, b]); start = -1; }
        }
      }
    }
    const HALF = 6;
    for (const [vert, line, from, to] of runs) {
      const r = stream(seed * 7 + line * 131 + from * 17 + (vert ? 1 : 2));
      const L0 = from * S, L1 = to * S, c = line * S;
      for (let u = L0; u < L1;) {
        let n = r.int(18, 30);
        if (L1 - (u + n) < 12) n = L1 - u;
        const st = { id: 900000 + u, col: 0, row: 0, fw: n - 1, fh: HALF * 2 - 1, tone: r.next(), vj: r.next(), hj: r.next() };
        for (let q = 0; q < n; q++) for (let w = 0; w < HALF * 2; w++) {
          const px = vert ? c - HALF + w : u + q, py = vert ? u + q : c - HALF + w;
          if (px < 0 || py < 0 || px >= TW || py >= TH) continue;
          // along the run: q; across it: w. The last texel of each is the joint.
          const along0 = q, along1 = n - 2 - q, across0 = w, across1 = HALF * 2 - 2 - w;
          const dl = vert ? across0 : along0, dr = vert ? across1 : along1, dt = vert ? along0 : across0, db = vert ? along1 : across1;
          const i = py * TW + px;
          shadeTexel(out, i, px, py, dl, dr, dt, db, st, cp, TP, seed + 11);
          stoneOf[i] = hgt[i] > 0.2 ? -2 : -1;
        }
        u += n;
      }
    }
  }

  // ---- UNDER A POOL, A PEBBLED BED (review-02 F8). The water shader shows the field through itself, and
  // a room's diamond or grid field seen through water was the old lattice all over again.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (level.get(x, y) !== TILE.WATER) continue;
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const gx = x * S + px, gy = y * S + py, i = gy * TW + gx;
      mixInto(_c, [0.24, 0.23, 0.21], [0.44, 0.42, 0.38], clamp01(fbm(gx * 0.15, gy * 0.15, seed + 300, 2) * 1.3 - 0.15));
      if (hash2(gx >> 1, gy >> 1, seed + 301) < 0.16) mixInto(_c, _c, [0.62, 0.6, 0.55], 0.45);
      alb[i * 3] = _c[0]; alb[i * 3 + 1] = _c[1]; alb[i * 3 + 2] = _c[2]; hgt[i] = 0.3; stoneOf[i] = -1;
    }
  }

  // ---- A WALL TOP HAS A FRONT (review-02 F1c). From this camera the south edge of a cap is the block's
  // face turning away: a dark band 4 texels deep there, and a lit lip on the north edge, is what tells a
  // cap from a floor of the same stone.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (level.get(x, y) !== TILE.WALL) continue;
    const south = T(x, y + 1) !== TILE.WALL, north = T(x, y - 1) !== TILE.WALL;
    if (!south && !north) continue;
    for (let py = 0; py < S; py++) {
      let k = 1;
      const FB = Math.round(4 * S / 32);
      if (south && py >= S - FB) k *= 0.8 - (py - (S - FB)) * 0.05 * 32 / S;
      if (north && py <= 1) k *= 1.06;
      if (k === 1) continue;
      for (let px = 0; px < S; px++) { const i = (y * S + py) * TW + x * S + px; alb[i * 3] *= k; alb[i * 3 + 1] *= k; alb[i * 3 + 2] *= k; }
    }
  }

  // ---- THE DEEP BANDS: a violet key light all but erases a red or olive field, so below depth 18
  // the floor is lifted and pulled a little toward its own grey (the band still gives it its hue)
  if ((level.depth | 0) >= 19) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (level.get(x, y) === TILE.WALL) continue;
      for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
        const i = (y * S + py) * TW + x * S + px, j = i * 3;
        const l = alb[j] * 0.2126 + alb[j + 1] * 0.7152 + alb[j + 2] * 0.0722;
        for (let k = 0; k < 3; k++) alb[j + k] = Math.min(1, (l + (alb[j + k] - l) * 0.55) * 1.7);
      }
    }
  }

  // ---- light and wet: contact shade at the wall foot, the bank of a pool, rubble
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = level.get(x, y);
    if (t === TILE.WALL) continue;
    const walls = [], wet = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const n = T(x + dx, y + dy);
      if (n === TILE.WALL) walls.push([dx, dy]);
      else if (n === TILE.WATER && t !== TILE.WATER) wet.push([dx, dy]);
    }
    const rubble = t === TILE.RUBBLE;
    if (!walls.length && !wet.length && !rubble) continue;
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const dist = (list) => {
        let d = 99;
        for (const [dx, dy] of list) {
          const ex = dx < 0 ? px + 0.5 : dx > 0 ? S - px - 0.5 : 0;
          const ey = dy < 0 ? py + 0.5 : dy > 0 ? S - py - 0.5 : 0;
          const dd = dx && dy ? Math.hypot(ex, ey) : dx ? ex : ey;
          if (dd < d) d = dd;
        }
        return d;
      };
      let k = 1;
      // THE BOARD LOOK (render/look.js): a soft dark ambient-occlusion band ~0.3 tile wide along every wall base
      if (walls.length) {
        const d = dist(walls);
        if (LOOK.base) {
          // THE WALL CASTS A SHADOW (the top-down map benchmark): a soft contact shade on every side, and a
          // wide dark band thrown south and east of the wall — the key light is from the north-west
          k *= 1 - 0.3 * Math.exp(-d / (S * 0.07));
          const cast = walls.filter(([dx, dy]) => dy < 0 || dx < 0);
          if (cast.length) {
            const dc = dist(cast), edge = S * 0.3;
            k *= 1 - 0.6 * (dc <= edge ? 1 : Math.exp(-(dc - edge) / (S * 0.07)));
          }
        } else k *= 1 - 0.36 * Math.exp(-d / 3.2) - 0.07 * Math.exp(-d / 12);
      }
      if (wet.length) { const d = dist(wet); k *= 1 - 0.3 * Math.exp(-d / 6); }
      if (rubble) k *= 0.86 - 0.08 * vnoise((x * S + px) * 0.3, (y * S + py) * 0.3, seed + 5);
      const i = (y * S + py) * TW + x * S + px;
      alb[i * 3] *= k; alb[i * 3 + 1] *= k; alb[i * 3 + 2] *= k;
    }
  }

  // ---- the level's quarry, and the sword level's glass
  for (let i = 0; i < TW * TH; i++) {
    let r = alb[i * 3] * tint[0], g = alb[i * 3 + 1] * tint[1], b = alb[i * 3 + 2] * tint[2];
    if (opts.glass) {
      const l = clamp01(r * 0.3 + g * 0.59 + b * 0.11);
      r = 0.08 + l * 0.52; g = 0.065 + l * 0.44; b = 0.11 + l * 0.6;
    }
    alb[i * 3] = r; alb[i * 3 + 1] = g; alb[i * 3 + 2] = b;
  }
  out.stoneOf = stoneOf;
  out.aux.fill(0.5);
}

/** Mix `a` toward `b` by t, in place into `o`. */
function mixInto(o, a, b, t) { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; }

/**
 * Distance, in texels, from (px,py) to the nearest edge of its tile that borders another region —
 * the stones of a room stop at the doorway with a joint of their own. Returns [dl, dr, dt, db].
 */
function regionEdges(px, py, S, W, H, regionOf, ri) {
  const tx = (px / S) | 0, ty = (py / S) | 0, lx = px - tx * S, ly = py - ty * S;
  const other = (x, y) => x < 0 || y < 0 || x >= W || y >= H || regionOf[y * W + x] !== ri;
  return [
    other(tx - 1, ty) ? lx - 1 : 99, other(tx + 1, ty) ? S - 1 - lx : 99,
    other(tx, ty - 1) ? ly - 1 : 99, other(tx, ty + 1) ? S - 1 - ly : 99,
  ];
}

const _c = [0, 0, 0], _d = [0, 0, 0];

/**
 * Shade one texel of a laid stone from its distances to the stone's four edges (dl, dr, dt, db, in
 * texels; negative = in the joint). The key light rakes in from the north-west (lighting.js `moon`),
 * so the north and west lips are lit and the south and east lips fall into the joint's shadow — the
 * bevel the reference art reads by, painted, and echoed in the height field for the normal map.
 */
function shadeTexel(out, i, px, py, dl, dr, dt, db, stone, pal, P, seed) {
  if (LOOK.clean) { shadeClean(out, i, dl, dr, dt, db, stone, pal, P); return; }
  const { alb, hgt } = out;
  const round = P.round || 1, bev = P.bevel || 1;
  const corner = Math.min(dl, dr) + Math.min(dt, db);
  const col = _c;
  if (dl < 0 || dr < 0 || dt < 0 || db < 0 || corner < round - 1 || (round > 1 && corner < round && Math.min(dl, dr) < 1 && Math.min(dt, db) < 1)) {
    // THE JOINT: soft, dark, never black, with grit and (in a damp quarry) moss in it
    const n = vnoise(px * 0.45, py * 0.45, seed + 3);
    mixInto(col, pal.grout, pal.base, 0.52 + n * 0.16);
    const m = vnoise(px * 0.12, py * 0.12, seed + 8);
    if (m > 0.62 && pal.moss > 0.5) mixInto(col, col, [0.26, 0.34, 0.18], Math.min(0.55, (m - 0.62) * 2.2 * pal.moss));
    const k = pal.value;
    alb[i * 3] = col[0] * k; alb[i * 3 + 1] = col[1] * k; alb[i * 3 + 2] = col[2] * k;
    hgt[i] = 0.1 + n * 0.05;
    return;
  }
  const e = Math.min(dl, dr, dt, db);
  // the stone's own tone: a step between the field's two tones, a trace of hue, and for a checker an
  // explicit second colour
  let tone = stone.tone;
  if (P.duo) mixInto(col, ((stone.col + stone.row) & 1) ? pal.base : mixInto(_d, pal.alt, pal.grout, 0.28), pal.base, 0);
  else mixInto(col, pal.base, pal.alt, tone);
  const vj = 1 + (stone.vj - 0.5) * 0.22;
  col[0] *= vj * (1 + (stone.hj - 0.5) * 0.05); col[1] *= vj; col[2] *= vj * (1 - (stone.hj - 0.5) * 0.05);
  // painted form: a stone is a little lighter toward its lit corner and settles darker toward the other
  const fw = stone.fw, fh = stone.fh;
  const gx = fw > 1 ? (dl / (dl + dr + 1e-3)) : 0.5, gy = fh > 1 ? (dt / (dt + db + 1e-3)) : 0.5;
  const form = 1.12 - (gx + gy) * 0.07;
  // wear: broad soft patches across a stone, fine grain inside it
  const patch = fbm(px * 0.06, py * 0.06, seed + 21, 2) - 0.5;
  const grain = vnoise(px * 0.5, py * 0.5, seed + stone.id) - 0.5;
  let k = form * (1 + patch * 0.2 + grain * 0.07) * pal.value;
  if (P.mottle) k *= 1 + (fbm(px * 0.2, py * 0.2, seed + 40, 2) - 0.5) * 0.28;
  // a slow drift of light and warmth across 3-5 tiles, level-wide, so a room is never one value
  const dv = fbm(px * 0.0085, py * 0.0085, pal.gseed + 90, 2) - 0.5, dh = fbm(px * 0.0065 + 31, py * 0.0065, pal.gseed + 97, 2) - 0.5;
  k *= 1 + dv * 0.34;
  // a wall cap is a block seen from above: its lip takes the light, its middle sits back
  if (P.cap && e > bev) k *= 0.78;
  col[0] *= k * (1 + dh * 0.1); col[1] *= k; col[2] *= k * (1 - dh * 0.1);
  // the bevel
  // the lit lip is as strong on the west edge as the north (review-04): a top lip lit harder than the side gave every
  // stone a horizontal line, and a torch picked those out as orange stripes
  if (dt === 0 || dl === 0) mixInto(col, col, pal.edge, dt === 0 && dl === 0 ? 0.48 : 0.34);
  else if (bev > 1 && (dt === 1 || dl === 1)) mixInto(col, col, pal.edge, 0.26);
  else if (dt === bev || dl === bev) mixInto(col, col, pal.edge, 0.1);
  if (db === 0 || dr === 0) mixInto(col, col, pal.grout, db === 0 && dr === 0 ? 0.24 : 0.17);
  else if (db === 1 || dr === 1) mixInto(col, col, pal.grout, bev > 1 ? 0.24 : 0.12);
  // pits and flecks, as many as the field is worn
  const hp = hash2(px, py, seed + 77);
  let h = 0.5 + (stone.hj - 0.5) * 0.08 + Math.min(e, bev + 1) / (bev + 1) * 0.3;
  // wear as soft stains a few texels across, never a single-texel speck
  const stain = vnoise(px * 0.23, py * 0.23, seed + 61 + stone.id);
  if (stain > 0.8) mixInto(col, col, pal.grout, (stain - 0.8) * 0.9 * (0.5 + pal.wear));
  else if (hp > 1 - pal.wear * 0.004) mixInto(col, col, pal.edge, 0.12);
  if (P.xmark) {
    const lx = dl - dr, ly = dt - db;
    if (Math.abs(Math.abs(lx) - Math.abs(ly)) < 1 && e > 1) { mixInto(col, col, pal.grout, 0.45); h -= 0.12; }
  }
  alb[i * 3] = col[0]; alb[i * 3 + 1] = col[1]; alb[i * 3 + 2] = col[2];
  hgt[i] = h;
}

// ------------------------------------------------------------------ THE BOARD LOOK (render/look.js)
const LOOK_FLOOR = { name: 'look floor', pattern: 'look', base: 0x6d6b68, alt: 0x63615e, grout: 0x2b2a29, edge: 0x8a8884, wear: 0.3 };
const LOOK_CAP = { name: 'look cap', pattern: 'look', base: 0xaeacaa, alt: 0xa19f9c, grout: 0x3c3b3a, edge: 0xcfcdca, wear: 0.2 };
/** Floor: skyline flagstones (bigger and softer from look 3). Cap: a fixed 2x2-blocks-a-tile lattice, tile-aligned. */
function lookLayout(cap, S) {
  const u = S / 32;
  if (cap) return { kind: 'ashlar', rowH: [S / 2, S / 2], w: [S / 2, S / 2], fixed: true, align: true, round: LOOK.clean ? 3 * u : 1, bevel: LOOK.clean ? 3 * u : 2, crack: 0.05, joint: LOOK.clean ? 2 : 1 };
  // near-square flags: wider stones laid their bed joints in long runs and read as brick laid flat (floorField.test.js)
  if (LOOK.clean) return { kind: 'skyline', rowH: [Math.round(22 * u), Math.round(32 * u)], w: [Math.round(22 * u), Math.round(34 * u)], round: 3 * u, bevel: 3 * u, crack: 0, joint: 1 };
  return { kind: 'skyline', rowH: [14, 22], w: [16, 28], round: 1, bevel: 1, crack: 0.12 };
}
/**
 * LOOK 3+: a stone with no per-texel noise — its own flat tone with a gentle per-stone value step,
 * a rounded corner and a soft bevel over `P.bevel` texels, lit from the top-left.
 */
function shadeClean(out, i, dl, dr, dt, db, stone, pal, P) {
  const { alb, hgt } = out;
  const R = P.round || 3, B = P.bevel || 3;
  const cx = Math.min(dl, dr), cy = Math.min(dt, db);
  let ed = Math.min(cx, cy);
  if (cx < R && cy < R) ed = R - Math.hypot(R - cx, R - cy);
  const col = _c;
  if (dl < 0 || dr < 0 || dt < 0 || db < 0 || ed < 0) {
    mixInto(col, pal.grout, pal.base, 0.3);
    alb[i * 3] = col[0]; alb[i * 3 + 1] = col[1]; alb[i * 3 + 2] = col[2]; hgt[i] = 0.1;
    return;
  }
  mixInto(col, pal.base, pal.alt, stone.tone);
  const t = Math.min(1, ed / B), sm = t * t * (3 - 2 * t);
  // which edge is nearest decides whether the bevel faces the light (top / left) or away (bottom / right)
  const litSide = Math.min(dl, dt) <= Math.min(dr, db) ? 1 : -1;
  let k = (1 + (stone.vj - 0.5) * 0.12) * (1 + (1 - sm) * 0.2 * litSide) * (1 - (1 - Math.min(1, ed / 1.2)) * 0.25);
  alb[i * 3] = col[0] * k; alb[i * 3 + 1] = col[1] * k; alb[i * 3 + 2] = col[2] * k;
  hgt[i] = 0.3 + 0.3 * sm;
}
/** Paint one laid stone (ashlar course or plank) into the field. */
function paintStone(out, st, P, pal, seed, ri, regionOf, stoneOf, inRegion) {
  const { S, W, H, TW, TH, alb, hgt } = out;
  const sid = st.id;
  const x0 = Math.max(0, st.x0), x1 = Math.min(TW, st.x1), y0 = Math.max(0, st.y0), y1 = Math.min(TH, st.y1);
  if (x0 >= x1 || y0 >= y1) return;
  const J = P.joint || 1;
  const fw = st.x1 - st.x0 - J, fh = st.y1 - st.y0 - J;        // the face; the last col/row(s) are joint
  const stone = {
    id: sid, col: st.col, row: st.row, fw, fh,
    tone: hash2(sid, ri, seed + 1), vj: hash2(sid, ri, seed + 2), hj: hash2(sid, ri, seed + 3),
  };
  const chipSeg = 4, chipP = P.kind === 'plank' || LOOK.clean ? 0 : 0.2;
  const inset = (side, t) => (hash3(sid, side, Math.floor((t + side * 3) / chipSeg), seed + 9) < chipP ? 1 : 0);
  const plank = P.kind === 'plank';
  const stoneKey = ri * 1000003 + sid;
  for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
    if (!inRegion(px, py)) continue;
    const lx = px - st.x0, ly = py - st.y0;
    let dl = lx - inset(1, ly), dr = (fw - 1 - lx) - inset(2, ly), dt = ly - inset(3, lx), db = (fh - 1 - ly) - inset(4, lx);
    const re = regionEdges(px, py, S, W, H, regionOf, ri);
    dl = Math.min(dl, re[0]); dr = Math.min(dr, re[1]); dt = Math.min(dt, re[2]); db = Math.min(db, re[3]);
    const i = py * TW + px;
    if (plank) { shadePlank(out, i, px, py, dl, dr, dt, db, stone, pal, seed); stoneOf[i] = stoneKey; continue; }
    shadeTexel(out, i, px, py, dl, dr, dt, db, stone, pal, P, seed);
    stoneOf[i] = hgt[i] > 0.2 ? stoneKey : -1;
  }
  // a crack across the bigger stones: a dark wandering line with a lit lip on its south-east side
  if (!LOOK.clean && !plank && fw * fh > 110 && hash2(sid, ri, seed + 13) < (P.crack || 0) * (0.5 + pal.wear)) {
    const r = stream(sid * 131 + ri * 17 + seed);
    let cx = st.x0 + 1 + r.int(0, Math.max(0, fw - 3)), cy = st.y0 + 1;
    let dirx = r.chance(0.5) ? 1 : -1;
    const len = r.int(Math.floor(fh * 0.5), fh + Math.floor(fw * 0.3));
    if (r.chance(0.5)) { cx = st.x0 + 1; cy = st.y0 + 1 + r.int(0, Math.max(0, fh - 3)); dirx = 1; }
    for (let s = 0; s < len; s++) {
      if (cx < 0 || cy < 0 || cx >= TW || cy >= TH) break;
      const i = cy * TW + cx;
      if (stoneOf[i] !== stoneKey) break;
      mixInto(_c, [alb[i * 3], alb[i * 3 + 1], alb[i * 3 + 2]], pal.grout, 0.55);
      alb[i * 3] = _c[0]; alb[i * 3 + 1] = _c[1]; alb[i * 3 + 2] = _c[2]; hgt[i] -= 0.16;
      const j = i + TW + 1;
      if (cx + 1 < TW && cy + 1 < TH && stoneOf[j] === stoneKey) {
        mixInto(_c, [alb[j * 3], alb[j * 3 + 1], alb[j * 3 + 2]], pal.edge, 0.16);
        alb[j * 3] = _c[0]; alb[j * 3 + 1] = _c[1]; alb[j * 3 + 2] = _c[2];
      }
      const m = r.next();
      if (m < 0.45) cy++; else if (m < 0.8) cx += dirx; else { cx += dirx; cy++; }
    }
  }
}

/** Board floors: a plank with a grain running along it, nail heads at its ends, a dark gap round it. */
function shadePlank(out, i, px, py, dl, dr, dt, db, stone, pal, seed) {
  const { alb, hgt } = out;
  const col = _c;
  if (dl < 0 || dr < 0 || dt < 0 || db < 0) {
    mixInto(col, pal.grout, pal.alt, 0.12);
    alb[i * 3] = col[0] * pal.value; alb[i * 3 + 1] = col[1] * pal.value; alb[i * 3 + 2] = col[2] * pal.value;
    hgt[i] = 0.12; return;
  }
  mixInto(col, pal.base, pal.alt, stone.tone);
  const grain = vnoise(px * 0.09 + stone.id * 3.1, py * 1.3, seed + 5);
  const fine = vnoise(px * 0.35, py * 2.1 + stone.id, seed + 6);
  let k = (0.92 + (stone.vj - 0.5) * 0.18) * (1 + (fine - 0.5) * 0.1) * pal.value;
  if (grain > 0.68) k *= 0.84; else if (grain < 0.2) k *= 1.06;
  col[0] *= k; col[1] *= k; col[2] *= k;
  if (dt === 0) mixInto(col, col, pal.edge, 0.34);
  if (db === 0) mixInto(col, col, pal.grout, 0.34);
  if ((dl === 2 || dr === 2) && (dt === 1 || db === 1)) mixInto(col, col, pal.grout, 0.6);
  if (dl === 0) mixInto(col, col, pal.edge, 0.12);
  if (dr === 0) mixInto(col, col, pal.grout, 0.25);
  alb[i * 3] = col[0]; alb[i * 3 + 1] = col[1]; alb[i * 3 + 2] = col[2];
  hgt[i] = 0.5 + (dt === 0 ? 0.12 : 0.2) + (stone.hj - 0.5) * 0.06;
}

/**
 * Fields laid by a formula rather than in courses: crazy paving (a jittered lattice of sites, each
 * texel belonging to its nearest) and the harlequin diamond.
 */
function paintCellular(out, rg, P, pal, seed, ri, regionOf, stoneOf) {
  const { S, W, H, TW, alb, hgt } = out;
  const n = P.cell;
  for (let py = rg.y0; py < rg.y1; py++) for (let px = rg.x0; px < rg.x1; px++) {
    if (regionOf[((py / S) | 0) * W + ((px / S) | 0)] !== ri) continue;
    let id, dl, dr, dt, db, col = 0, row = 0;
    if (P.kind === 'voronoi') {
      const cu = Math.floor(px / n), cv = Math.floor(py / n);
      let b1 = 1e9, b2 = 1e9, s1x = 0, s1y = 0, s2x = 0, s2y = 0, bid = 0;
      for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) {
        const u = cu + du, v = cv + dv;
        const sx = (u + 0.5 + (hash2(u, v, seed) - 0.5) * 0.8) * n, sy = (v + 0.5 + (hash2(u, v, seed + 31) - 0.5) * 0.8) * n;
        const d = (px + 0.5 - sx) ** 2 + (py + 0.5 - sy) ** 2;
        if (d < b1) { b2 = b1; s2x = s1x; s2y = s1y; b1 = d; s1x = sx; s1y = sy; bid = (u * 7919 + v * 104729) | 0; }
        else if (d < b2) { b2 = d; s2x = sx; s2y = sy; }
      }
      // distance to the bisector between the two nearest sites, in texels
      const vx = s2x - s1x, vy = s2y - s1y, vl = Math.hypot(vx, vy) || 1;
      const mx = (s1x + s2x) / 2, my = (s1y + s2y) / 2;
      const e = ((mx - px - 0.5) * vx + (my - py - 0.5) * vy) / vl - 0.5;
      const lit = vx + vy * 1.2 < 0;         // the neighbour lies north-west: this is the lit lip
      const ef = Math.floor(e);
      dl = dr = dt = db = 9;
      if (lit) dt = ef; else db = ef;
      id = bid;
      // a stone's form gradient off its own site
      const ox = (px + 0.5 - s1x) / n, oy = (py + 0.5 - s1y) / n;
      dl = Math.min(dl, Math.max(0, Math.round(4 + ox * 8))); dr = Math.min(dr, Math.max(0, Math.round(4 - ox * 8)));
      if (lit) { db = Math.max(0, Math.round(4 - oy * 8)); } else { dt = Math.max(0, Math.round(4 + oy * 8)); }
      if (lit) dt = ef; else db = ef;
      dl = Math.max(dl, 2); dr = Math.max(dr, 2); if (!lit) dt = Math.max(dt, 2); else db = Math.max(db, 2);
    } else {
      // harlequin: a 45-degree lattice; its NW face is lit, SE face shaded
      const u = (px + py + 0.5) / n, v = (px - py + 0.5) / n;
      const ui = Math.floor(u), vi = Math.floor(v);
      const fu = u - ui, fv = v - vi, k = n / Math.SQRT2;
      dt = Math.floor(fu * k) - 1; db = Math.floor((1 - fu) * k) - 1;
      dr = Math.floor(fv * k) + 1; dl = Math.floor((1 - fv) * k) + 1;   // NE / SW faces: kept off the joint, softly
      if (Math.floor(fv * k) < 1 || Math.floor((1 - fv) * k) < 1) { dt = -1; }
      id = (ui * 7919 + vi * 104729) | 0; col = ui; row = vi;
    }
    const re = regionEdges(px, py, S, W, H, regionOf, ri);
    dl = Math.min(dl, re[0]); dr = Math.min(dr, re[1]); dt = Math.min(dt, re[2]); db = Math.min(db, re[3]);
    const stone = { id, col, row, fw: 12, fh: 12, tone: hash2(id, ri, seed + 1), vj: hash2(id, ri, seed + 2), hj: hash2(id, ri, seed + 3) };
    const i = py * TW + px;
    // crazy paving is a third joint by area: its shards are laid a step lighter so the field reads at the value of a coursed one
    shadeTexel(out, i, px, py, dl, dr, dt, db, stone, P.kind === 'voronoi' ? { ...pal, value: pal.value * 1.16 } : pal, { round: 0, bevel: 1, duo: P.kind === 'diamond', mottle: P.kind === 'voronoi' }, seed);
    stoneOf[i] = hgt[i] > 0.2 ? ri * 1000003 + (id & 0xffff) : -1;
  }
}

/**
 * Concentric rings of slabs round a room's centre: a disc, then courses ~11 texels deep, each cut into
 * stones ~20 texels of arc long, the cuts turned a different way on every ring. Lit on the edge that
 * faces the north-west, like every other stone.
 */
function paintRings(out, rg, room, pal, seed, ri, regionOf, stoneOf) {
  const { S, W, H, TW, hgt } = out;
  const cx = (room.x + room.w / 2) * S, cy = (room.y + room.h / 2) * S;
  const RW = 11, R0 = 10;
  for (let py = rg.y0; py < rg.y1; py++) for (let px = rg.x0; px < rg.x1; px++) {
    if (regionOf[((py / S) | 0) * W + ((px / S) | 0)] !== ri) continue;
    const dx = px + 0.5 - cx, dy = py + 0.5 - cy, rr = Math.hypot(dx, dy);
    let id, dl = 9, dr = 9, dt = 9, db = 9;
    if (rr < R0) {
      id = 1;
      const e = Math.floor(R0 - 1 - rr);
      if (dx + dy < 0) dt = e; else db = e;
    } else {
      const k = Math.floor((rr - R0) / RW), rin = R0 + k * RW, rout = rin + RW;
      const circ = 2 * Math.PI * (rin + RW / 2), segs = Math.max(6, Math.round(circ / 20));
      let a = Math.atan2(dy, dx) / (2 * Math.PI) + 0.5 + hash2(k, 7, seed);
      a -= Math.floor(a);
      const si = Math.floor(a * segs), fa = a * segs - si, arc = circ / segs;
      const ea = Math.floor(Math.min(fa, 1 - fa) * arc);
      const eIn = Math.floor(rr - rin), eOut = Math.floor(rout - 1 - rr);
      const litIn = dx + dy > 0;           // the inner edge faces the north-west on this side of the ring
      dt = litIn ? eIn : eOut; db = litIn ? eOut : eIn;
      if (fa < 0.5) dl = ea - 1; else dr = ea;
      id = k * 1000 + si + 2;
    }
    const re = regionEdges(px, py, S, W, H, regionOf, ri);
    dl = Math.min(dl, re[0]); dr = Math.min(dr, re[1]); dt = Math.min(dt, re[2]); db = Math.min(db, re[3]);
    const stone = { id, col: 0, row: 0, fw: 12, fh: 12, tone: hash2(id, ri, seed + 1), vj: hash2(id, ri, seed + 2), hj: hash2(id, ri, seed + 3) };
    const i = py * TW + px;
    shadeTexel(out, i, px, py, dl, dr, dt, db, stone, pal, { round: 0, bevel: 1 }, seed);
    stoneOf[i] = hgt[i] > 0.2 ? ri * 1000003 + id : -1;
  }
}

// ------------------------------------------------------------------ the forest
const G = {
  // blue in the lights and mids (review-03 G1c): the daylight key and the grade strip ~40/255 of blue, and
  // yellow-green with no blue in it is neon on screen
  olive: hexRgb(0x3e4c36), deep: hexRgb(0x5e7a46), dark: hexRgb(0x7e9a54), mid: hexRgb(0x9eb05e), light: hexRgb(0xb2c070), sun: hexRgb(0xc8d088),
  shade: hexRgb(0x3a4a38), tip: hexRgb(0xdce2a4),
  dirt: hexRgb(0x9a7a4e), dirtDark: hexRgb(0x6e5434), dirtLight: hexRgb(0xbfa06c),
  mud: hexRgb(0x3a2d1e), mudDark: hexRgb(0x231b13), sand: hexRgb(0xb9a47a),
  stone: hexRgb(0x9c9c94), stoneLight: hexRgb(0xcfcdc2), stoneDark: hexRgb(0x55544f),
  leaf: [hexRgb(0xb8742c), hexRgb(0x8c5a28), hexRgb(0xc9a040)],
  flower: [hexRgb(0xf4f0e6), hexRgb(0xf2d34a), hexRgb(0xe58ab8), hexRgb(0x9cc2f0), hexRgb(0xb08ae6)],
};

/**
 * THE WOOD'S GROUND, painted as one continuous surface: grass with broad sunlit and shaded drifts,
 * tufts and flowers; trails worn into it with soft ragged edges; dark wet banks along the stream, a
 * pebbled bed under the water (the ground is cut away over it — `alpha` — so the water shows through
 * with an edge that follows the bank, not the tile grid); stepping stones where a trail fords it.
 */
function paintForest(level, out, opts) {
  const { S, W, H, TW, TH, alb, hgt, alpha, aux } = out;
  const seed = ((level.seed | 0) * 131 + 7) ^ 0x51f15e;
  const roomOf = roomIndex(level);
  const field = (pred) => {
    const f = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = pred(level.get(x, y), x, y) ? 1 : 0;
    return f;
  };
  // smooth tile fields, sampled between tile centres: 1 on the tile, 0.5 at its edge
  const trail = field((t) => t === TILE.CORRIDOR);
  const water = field((t) => t === TILE.WATER);
  const wood = field((t) => t === TILE.WALL);
  const moss = field((t, x, y) => { const r = roomOf[y * W + x]; return r >= 0 && level.rooms[r].tileStyle === 'moss'; });
  const litter = field((t, x, y) => { const r = roomOf[y * W + x]; return r >= 0 && level.rooms[r].tileStyle === 'litter'; });
  const fordSet = new Set(streamFords(level).map((t) => t.y * W + t.x));
  const ford = field((t, x, y) => fordSet.has(y * W + x));
  const bil = (f, fx, fy) => {
    const x = fx - 0.5, y = fy - 0.5, xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi;
    const at = (a, b) => f[Math.max(0, Math.min(H - 1, b)) * W + Math.max(0, Math.min(W - 1, a))];
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    return (at(xi, yi) * (1 - su) + at(xi + 1, yi) * su) * (1 - sv) + (at(xi, yi + 1) * (1 - su) + at(xi + 1, yi + 1) * su) * sv;
  };
  const col = [0, 0, 0];
  const ramp = [G.olive, G.deep, G.dark, G.mid, G.light, G.sun];
  for (let py = 0; py < TH; py++) for (let px = 0; px < TW; px++) {
    const i = py * TW + px, fx = (px + 0.5) / S, fy = (py + 0.5) / S;
    const rag = (fbm(px * 0.11, py * 0.11, seed + 1, 2) - 0.5) * 0.34;
    const tw = bil(trail, fx, fy) + rag;
    // the glade's light and the wood's shade are sampled through a slow warp (review-02 G5), so their
    // borders wander across tiles; trails and water are gameplay and keep their true outline
    const wx = (fbm(px * 0.028, py * 0.028, seed + 50, 2) - 0.5) * 1.8, wy = (fbm(px * 0.028 + 17, py * 0.028, seed + 51, 2) - 0.5) * 1.8;
    const wd = bil(wood, fx + wx, fy + wy);
    const mw = bil(moss, fx + wx, fy + wy), lw = bil(litter, fx + wx, fy + wy);
    const fordW = bil(ford, fx + wx * 0.5, fy + wy * 0.5) + (fbm(px * 0.09, py * 0.09, seed + 60, 2) - 0.5) * 0.3;
    const ww = Math.max(bil(water, fx, fy) + (fbm(px * 0.08, py * 0.08, seed + 2, 2) - 0.5) * 0.3, fordW * 0.95);
    // ---- grass: broad drifts of light and shade, blended, never dithered
    const drift = fbm(px * 0.014, py * 0.014, seed + 3, 3) * 0.7 + fbm(px * 0.05, py * 0.05, seed + 4, 2) * 0.3;
    // one palette family whatever glade a seed deals (review-03 G6): moss and litter only nudge the ramp
    let g = 0.6 + (drift - 0.5) * 2.6 - wd * 0.5 - mw * 0.06 + lw * 0.02;
    const step = clamp01(g) * (ramp.length - 1);
    const si = Math.min(ramp.length - 2, Math.floor(step));
    mixInto(col, ramp[si], ramp[si + 1], step - si);
    if (mw > 0.3) mixInto(col, col, hexRgb(0x7a9c62), Math.min(0.18, (mw - 0.3) * 0.4));
    if (lw > 0.3) mixInto(col, col, hexRgb(0xa09c62), Math.min(0.18, (lw - 0.3) * 0.4));
    let h = 0.5 + (drift - 0.5) * 0.2;
    // ---- clumps: soft rounded tussocks, lit on top, shaded underneath, a few blades standing out of
    // their crown — gathered where the ground is lush and absent where it is thin, never on a lattice
    {
      const L = 9, cu = Math.floor(px / L), cv = Math.floor(py / L);
      let done = false;
      for (let dv = -1; dv <= 1 && !done; dv++) for (let du = -1; du <= 1 && !done; du++) {
        const u = cu + du, v = cv + dv;
        const lush = fbm(u * 0.33, v * 0.33, seed + 9, 2);
        if (hash2(u, v, seed + 5) > sstep(0.38, 0.72, lush) * 0.85) continue;
        const cx = u * L + 1 + hash2(u, v, seed + 6) * (L - 2), cy = v * L + 1 + hash2(u, v, seed + 7) * (L - 2);
        const rx = 2.6 + hash2(u, v, seed + 10) * 2.4, ry = 1.9 + hash2(u, v, seed + 11) * 1.6;
        const dx = (px + 0.5 - cx) / rx, dy = (py + 0.5 - cy) / ry;
        const q = dx * dx + dy * dy;
        // blades: short strokes up out of the crown
        const bx = Math.round(cx + (hash2(u, v, seed + 12) - 0.5) * rx * 1.2);
        const bladeUp = Math.round(cy - ry) - py;
        if ((px === bx || px === bx + 2 || px === bx - 2) && bladeUp >= 0 && bladeUp <= (px === bx ? 2 : 1) && q < 3.2) {
          mixInto(col, col, G.tip, bladeUp === (px === bx ? 2 : 1) ? 0.6 : 0.35); h = 0.72; done = true; break;
        }
        if (q > 1) {
          if (q < 1.7 && dy > 0.2) { mixInto(col, col, G.shade, 0.32 * (1.7 - q) / 0.7); done = true; }   // its shadow on the ground
          continue;
        }
        // two tones: a lit crown over a dark olive underside
        const lit = dx * 0.45 + dy;                 // light from above-left
        if (lit < 0) { mixInto(col, col, hash2(u, v, seed + 13) < 0.5 ? G.light : G.sun, 0.42); if (lit < -0.6) mixInto(col, col, G.tip, 0.35); }
        else mixInto(col, col, G.shade, 0.2 + lit * 0.3);
        h = 0.62 + (1 - q) * 0.12; done = true;
      }
    }
    // ---- single tufts: small dark V's in the thin ground between clumps
    {
      const L = 6, cu = Math.floor(px / L), cv = Math.floor(py / L);
      if (hash2(cu, cv, seed + 14) < 0.2) {
        const bx = cu * L + 1 + Math.floor(hash2(cu, cv, seed + 15) * (L - 2)), by = cv * L + 2 + Math.floor(hash2(cu, cv, seed + 16) * (L - 3));
        const dx = px - bx, up = by - py;
        if ((dx === 0 && up >= 0 && up <= 1) || (Math.abs(dx) === 1 && up === 1)) mixInto(col, col, up === 1 && dx === 0 ? G.light : G.shade, 0.4);
      }
    }
    // ---- flowers: a few small clusters, a lit petal texel over a shadow texel
    {
      const L = 19, cu = Math.floor(px / L), cv = Math.floor(py / L);
      const hc = hash2(cu, cv, seed + 11);
      if (hc < 0.2 - lw * 0.1 - wd * 0.15) {
        const kind = Math.floor(hash2(cu, cv, seed + 12) * G.flower.length);
        for (let k = 0; k < 4; k++) {
          const bx = cu * L + 3 + Math.floor(hash3(cu, cv, k, seed + 13) * (L - 6)), by = cv * L + 3 + Math.floor(hash3(cu, cv, k, seed + 14) * (L - 6));
          if (px === bx && py === by) { mixInto(col, col, G.flower[kind], 0.92); h = 0.75; }
          else if ((px === bx + 1 && py === by + 1)) mixInto(col, col, G.shade, 0.35);
          else if (kind !== 1 && Math.abs(px - bx) + Math.abs(py - by) === 1 && hash3(px, py, k, seed) < 0.5) mixInto(col, col, G.flower[kind], 0.5);
        }
      }
    }
    // ---- fallen leaves in a litter glade and under the trees
    if (lw > 0.45) {
      // a fallen leaf is two texels, lit on its upper one — never a lone orange speck
      const lu = px >> 3, lv = py >> 3;
      if (hash2(lu, lv, seed + 15) < (lw - 0.45) * 0.9) {
        const lx = (lu << 3) + 1 + Math.floor(hash2(lu, lv, seed + 16) * 5), ly = (lv << 3) + 1 + Math.floor(hash2(lu, lv, seed + 17) * 5);
        const lf = G.leaf[Math.floor(hash2(lu, lv, seed + 18) * 3)];
        if ((px === lx || px === lx + 1) && py === ly) mixInto(col, col, lf, 0.8);
        else if ((px === lx || px === lx + 1) && py === ly + 1) mixInto(col, col, G.leaf[1], 0.6);
      }
    }
    // ---- the trail: packed earth, darker ruts along its edges, pebbles and a few flat stones
    let T = sstep(0.42, 0.56, tw);
    if (T > 0) {
      const earth = [0, 0, 0];
      const n = fbm(px * 0.09, py * 0.09, seed + 18, 3);
      mixInto(earth, G.dirtDark, G.dirtLight, clamp01(0.2 + n * 0.9));
      const rut = 1 - sstep(0.56, 0.8, tw);
      mixInto(earth, earth, G.dirtDark, rut * 0.35);
      // pebbles
      const pl = 5, pu = Math.floor(px / pl), pv = Math.floor(py / pl);
      const ph = hash2(pu, pv, seed + 19);
      if (ph < 0.3) {
        const bx = pu * pl + 1 + Math.floor(hash2(pu, pv, seed + 20) * 3), by = pv * pl + 1 + Math.floor(hash2(pu, pv, seed + 21) * 3);
        if (px === bx && py === by) mixInto(earth, earth, G.stoneLight, 0.8);
        else if ((px === bx + 1 && py === by) || (px === bx && py === by + 1)) mixInto(earth, earth, G.stone, 0.7);
        else if (px === bx + 1 && py === by + 1) mixInto(earth, earth, G.mudDark, 0.4);
      }
      // flat stones set into the worn middle
      const fl = 11, fu = Math.floor((px + 5) / fl), fv = Math.floor((py + 3) / fl);
      if (tw > 0.75 && hash2(fu, fv, seed + 22) < 0.45) {
        const cx = fu * fl - 5 + 5.5 + (hash2(fu, fv, seed + 23) - 0.5) * 2, cy = fv * fl - 3 + 5.5 + (hash2(fu, fv, seed + 24) - 0.5) * 2;
        const rx = 3.2 + hash2(fu, fv, seed + 25) * 1.5, ry = 2.6 + hash2(fu, fv, seed + 26) * 1.3;
        const q = ((px + 0.5 - cx) / rx) ** 2 + ((py + 0.5 - cy) / ry) ** 2;
        if (q < 1) {
          const lit = (px + 0.5 - cx) / rx + (py + 0.5 - cy) / ry;
          mixInto(earth, G.stone, lit < -0.7 ? G.stoneLight : lit > 0.8 ? G.stoneDark : G.stone, lit < -0.7 ? 0.8 : lit > 0.8 ? 0.55 : 0);
          const gr = vnoise(px * 0.6, py * 0.6, seed + 27);
          earth[0] *= 0.94 + gr * 0.12; earth[1] *= 0.94 + gr * 0.12; earth[2] *= 0.94 + gr * 0.12;
          h = 0.72;
        } else if (q < 1.5) mixInto(earth, earth, G.mudDark, 0.35);
      }
      // grass creeping over the ragged edge of the trail
      if (T < 1 && hash2(px, py, seed + 28) < (1 - T) * 0.7) T *= 0.4;
      mixInto(col, col, earth, T);
      if (T > 0.5) h = Math.max(h - 0.1, 0.4);
    }
    // ---- the bank and the stream bed
    let wet = sstep(0.05, 0.5, ww) * (1 - T * 0.85);
    if (wet > 0) {
      const bank = [0, 0, 0];
      mixInto(bank, G.mud, G.mudDark, sstep(0.3, 0.5, ww));
      const n = vnoise(px * 0.3, py * 0.3, seed + 29);
      if (n > 0.72) mixInto(bank, bank, G.stoneDark, 0.6);
      mixInto(col, col, bank, wet * 0.9);
      h -= wet * 0.25;
    }
    // under the water: the ground is cut away, and what shows is the bed the water shader tints
    const under = ww > 0.5 && T < 0.5;
    aux[i] = clamp01((ww - 0.5) * 2.2);
    if (under) {
      const bed = [0, 0, 0];
      const n = fbm(px * 0.15, py * 0.15, seed + 30, 2);
      mixInto(bed, G.sand, G.stoneDark, clamp01(n * 1.4 - 0.2));
      const pb = hash2(px >> 1, py >> 1, seed + 31);
      if (pb < 0.18) mixInto(bed, bed, G.stoneLight, 0.5);
      col[0] = bed[0]; col[1] = bed[1]; col[2] = bed[2];
      alpha[i] = 0; h = 0.2;
    }
    // a ford: the trail runs on through the water as stepping stones, with the water between them
    if ((T > 0.5 || fordW > 0.55) && ww > 0.35) {
      const trailFord = T > 0.5;
      const L = trailFord ? 8 : 10, su = Math.floor((px + 2) / L), sv = Math.floor((py + 5) / L);
      const present = trailFord || hash2(su, sv, seed + 34) < 0.5;
      const jit = trailFord ? 2 : 4;
      const cx = su * L - 2 + L / 2 + (hash2(su, sv, seed + 32) - 0.5) * jit, cy = sv * L - 5 + L / 2 + (hash2(su, sv, seed + 33) - 0.5) * jit;
      const rx = trailFord ? 3.3 : 2.4 + hash2(su, sv, seed + 35) * 1.3, ry = trailFord ? 3.0 : 2.0 + hash2(su, sv, seed + 36) * 1.1;
      const q = present ? ((px + 0.5 - cx) / rx) ** 2 + ((py + 0.5 - cy) / ry) ** 2 : 9;
      if (q < 1) {
        const lit = (px + 0.5 - cx) + (py + 0.5 - cy);
        mixInto(col, G.stone, lit < -2 ? G.stoneLight : lit > 2 ? G.stoneDark : G.stone, 0.7);
        h = 0.75; alpha[i] = 255;
      } else if (q < 1.45) { mixInto(col, col, G.mudDark, 0.6); h = 0.3; alpha[i] = 255; }
      else { alpha[i] = 0; aux[i] = Math.max(aux[i], 0.35); }
    }
    alb[i * 3] = col[0]; alb[i * 3 + 1] = col[1]; alb[i * 3 + 2] = col[2];
    hgt[i] = h;
  }
}

// ------------------------------------------------------------------ textures
/**
 * Upload a painted field: albedo (sRGB, alpha = where there is ground), a normal map and a roughness
 * map derived from the one height field, and an aux map (R: roughness, G: water depth for the stream).
 * Textures are reused when the level size matches, so a new level only re-uploads.
 */
export function fieldTextures(f, prev = null) {
  const { TW, TH, alb, hgt, alpha, aux, nrm } = f;
  const same = prev && prev.albedo.image.width === TW && prev.albedo.image.height === TH;
  const a = same ? prev.albedo.image.data : new Uint8Array(TW * TH * 4);
  const n = same ? prev.normal.image.data : new Uint8Array(TW * TH * 4);
  const r = same ? prev.rough.image.data : new Uint8Array(TW * TH * 4);
  const hAt = (x, y) => hgt[(y < 0 ? 0 : y >= TH ? TH - 1 : y) * TW + (x < 0 ? 0 : x >= TW ? TW - 1 : x)];
  const STRENGTH = 2.2;
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const i = y * TW + x, j = i * 4;
    // albedo is authored in display space; store it sRGB-encoded as painted
    a[j] = Math.round(clamp01(alb[i * 3]) * 255); a[j + 1] = Math.round(clamp01(alb[i * 3 + 1]) * 255);
    a[j + 2] = Math.round(clamp01(alb[i * 3 + 2]) * 255); a[j + 3] = alpha[i];
    // data row y = +v = world +z: no flip, texture space and the painting agree
    const dx = (hAt(x + 1, y - 1) + 2 * hAt(x + 1, y) + hAt(x + 1, y + 1)) - (hAt(x - 1, y - 1) + 2 * hAt(x - 1, y) + hAt(x - 1, y + 1));
    const dy = (hAt(x - 1, y + 1) + 2 * hAt(x, y + 1) + hAt(x + 1, y + 1)) - (hAt(x - 1, y - 1) + 2 * hAt(x, y - 1) + hAt(x + 1, y - 1));
    let nx = -dx * STRENGTH, ny = -dy * STRENGTH, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    // a painted normal map (the Dungeon Crawlers tiles) wins where one was laid; its blue is never 0 on a real normal
    if (nrm && nrm[i * 3 + 2]) { n[j] = nrm[i * 3]; n[j + 1] = nrm[i * 3 + 1]; n[j + 2] = nrm[i * 3 + 2]; }
    else { n[j] = Math.round((nx * 0.5 + 0.5) * 255); n[j + 1] = Math.round((ny * 0.5 + 0.5) * 255); n[j + 2] = Math.round((nz * 0.5 + 0.5) * 255); }
    n[j + 3] = 255;
    const rough = clamp01(0.98 - hgt[i] * 0.32);
    r[j] = Math.round(rough * 255); r[j + 1] = Math.round(rough * 255); r[j + 2] = Math.round(clamp01(aux[i]) * 255); r[j + 3] = 255;
  }
  if (same) { prev.albedo.needsUpdate = true; prev.normal.needsUpdate = true; prev.rough.needsUpdate = true; return prev; }
  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, TW, TH, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    const lin = LOOK.clean && LOOK.fieldLinear;   // render/look.js: linear only as a fallback experiment
    t.magFilter = lin ? THREE.LinearFilter : THREE.NearestFilter; t.minFilter = lin ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapNearestFilter;
    t.generateMipmaps = true; t.flipY = false; t.anisotropy = 1;
    t.needsUpdate = true;
    return t;
  };
  if (prev) { prev.albedo.dispose(); prev.normal.dispose(); prev.rough.dispose(); }
  return { albedo: mk(a, true), normal: mk(n, false), rough: mk(r, false) };
}

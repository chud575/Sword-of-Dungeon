// kit: the builder every solid prop is cut from — bevelled boxes, lathes and lumpy blobs, textured
// from one hand-pixelled material atlas at the floor's own density, and sheared into the cast's
// projection.
//
// WHY SOLID PROPS AGAIN, AFTER props.js RETIRED THEM
// props.js explains why the pickups became hand-pixelled billboards: a chest built from SMOOTH,
// UNTEXTURED low-poly primitives sits in a painted room like a render test. That diagnosis was right
// and this file keeps it — nothing here is smooth or untextured. What it does not accept is the cure
// for FURNITURE: at the play camera a painted billboard furniture piece came out as a thin icon laid
// on the floor (measured in 'furnished-guardroom' and 'dressed-crypt' before this pass), with no
// mass, no lit top edge and no real shadow, which is the opposite of the target frames. The walls,
// the floor and the stairs are already geometry textured texel-for-texel from painted cells; the
// furniture now is too.
//
// THE THREE RULES THAT MAKE A SOLID PROP BELONG
//  1. ONE TEXEL SIZE. Every face is mapped at `TPU` = 32 atlas texels per world unit, the density the
//     flagstones are painted at, and the material goes through `patchSurface`'s `quant` path so its
//     lookups snap to the live world texel grid exactly as the floor's do (materials.js "ONE TEXEL,
//     ONE SIZE"). A face never stretches a cell: a face wider than a cell is a request for a second
//     face, not for fatter texels.
//  2. THE CAST'S PROJECTION. The camera is 17 degrees off vertical, so an honest upright face keeps
//     sin(17°) = 0.29 of its height and a table is a plan drawing with a four-texel lip. The cast does
//     not have that problem because it is billboarded at full height. So a prop's geometry is SHEARED
//     once, at build time: every vertex moves north by `SHEAR * y`. Its footprint does not move (the
//     shear is zero at y = 0, so contact shadows and the tile it blocks are untouched), its top is
//     still a plan view, and its upright faces now come to the screen at cos(17°) of their height —
//     the same foreshortening the floor's own texels have, so a front face's texels are the floor's
//     texels, square on the one grid. This is a cabinet projection: the convention the painted
//     billboards and the concept art were already drawn in.
//  3. THE HOUSE KEY LIGHT IN THE VERTEX COLOUR, UNDER 1. Top faces brightest, the north and west
//     bevel lit, south and east bevel in shade, upright faces falling into occlusion at their foot.
//     The room's own lights still land on top of it; the bake is what keeps a lid reading as a lid
//     in a room lit flat, and nothing is above the material's white point, so nothing blooms.
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { patchSurface } from '../materials.js';
import { patchFog } from '../lighting.js';
import { getFog } from '../propFx.js';

/** Atlas texels per world unit — the floor's `TEXELS_PER_TILE`. */
export const TPU = 32;
/**
 * The cabinet shear: z' = z - SHEAR * y. Chosen so an upright face lands on screen at the floor's own
 * foreshortening at the default 17° tilt: sin17 + SHEAR*cos17 = cos17  ->  SHEAR = 1 - tan17 = 0.694.
 */
export const SHEAR = 1 - Math.tan(17 * Math.PI / 180);

const CELL = 64, COLS = 8, ROWS = 4, AW = CELL * COLS, AH = CELL * ROWS;

// ------------------------------------------------------------------------------ the materials
// dark -> light, six steps each. Values sit inside the floor's range: the brightest step of anything
// that is not metal or flame stays under the corridor's light cobble. The woods were first cut a step
// darker and measured as brown holes on the board-bright floor ('treasure', 'furnished-guardroom'):
// the target's wood is a warm MID value with a lit edge, never the darkest thing in the room.
const PAL = {
  oak: [0x3e2716, 0x7a4e2a, 0x96623a, 0xb07844, 0xc88f54, 0xdcaa6c],
  dark: [0x2a1c12, 0x523824, 0x684a30, 0x7e5c3c, 0x94704a, 0xaa865c],
  ash: [0x463220, 0x86643e, 0xa07a4a, 0xb88e56, 0xcca466, 0xdcba7e],
  iron: [0x1c1d22, 0x383b44, 0x4c505a, 0x60646f, 0x7c808b, 0xa4a8b2],
  block: [0x28282e, 0x55555c, 0x6a6a71, 0x7e7e85, 0x939399, 0xa9a9ae],
  slate: [0x262831, 0x4b4f5c, 0x5d616d, 0x6e727d, 0x818591, 0x999da7],
  bone: [0x4a3e2c, 0x8e7e60, 0xa8987a, 0xbdae90, 0xd1c4a6, 0xe4d9bf],
  cloth: [0x2a0a10, 0x5a1520, 0x761d27, 0x922832, 0xac383b, 0xc4524a],
  gold: [0x3a2408, 0x7a5214, 0x9e6e1e, 0xc08e2c, 0xdcae44, 0xf4d472],
  leaf: [0x1c3412, 0x2f561b, 0x467a24, 0x5f9a2e, 0x86b842, 0xb8d66a],
  bark: [0x1c130d, 0x38281c, 0x4a3626, 0x5c4430, 0x70563c, 0x846848],
  linen: [0x3a2e1e, 0x6e5a3e, 0x86704e, 0x9c855e, 0xb29a70, 0xc8b084],
  grass: [0x1a2e11, 0x33581f, 0x447229, 0x588a33, 0x70a43f, 0x8ebe55],
  void: [0x0a080b, 0x130e14, 0x1a141a, 0x211a20, 0x292126, 0x31282c],
  marble: [0x6e6a64, 0xa6a096, 0xbab4a8, 0xcac4b8, 0xd9d3c8, 0xe6e1d6],
  leather: [0x24160e, 0x4a3020, 0x5e3e2a, 0x724e34, 0x8a6040, 0xa2744e],
  glass: [0x506068, 0x8ea6ae, 0xa6bec6, 0xbad2d8, 0xd2e6ea, 0xeef9fa],
  ember: [0x3a0e06, 0x7a2208, 0xb8400e, 0xe06a18, 0xf89a30, 0xffd070],
  needles: [0x0c1d14, 0x1a3824, 0x264c30, 0x32603a, 0x447648, 0x5c9058],
  rock: [0x2c2c2e, 0x585858, 0x6c6c6c, 0x808080, 0x969694, 0xaeaeaa],
  drift: [0x2c2218, 0x584834, 0x6c5a42, 0x806e52, 0x968466, 0xac9a7c],
  page: [0x6a5a44, 0xb0a07e, 0xc6b692, 0xd6c8a6, 0xe4d8ba, 0xf0e6ce],
  dirt: [0x21170e, 0x45331e, 0x584327, 0x6a5232, 0x7e643e, 0x94774b],
  clay: [0x381a10, 0x6c3420, 0x884428, 0xa25634, 0xba6c42, 0xd08858],
};

/** Material id -> atlas cell. Names are what pieces ask for; the order is the atlas layout. */
export const MAT = {
  oak: 0, dark: 1, ash: 2, iron: 3, block: 4, slate: 5, bone: 6, cloth: 7,
  gold: 8, staves: 9, leaf: 10, bark: 11, linen: 12, grass: 13, void: 14, marble: 15,
  leather: 16, glass: 17, ember: 18, needles: 19, rock: 20, drift: 21, page: 22, dirt: 23,
  clay: 24, mossblock: 25, endgrain: 26, coins: 27, books: 28, flagstone: 29, plain: 30, straw: 31,
};
/** Cells whose geometry is drawn unlit (fire, coals): they go in the glow group. */
const GLOW_CELLS = new Set([MAT.ember]);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Tileable value noise over one cell, lattice `g` texels. */
function vnoise(x, y, s, g) {
  const n = CELL / g, gx = Math.floor(x / g), gy = Math.floor(y / g), fx = x / g - gx, fy = y / g - gy;
  const H = (i, j) => hash2(((i % n) + n) % n, ((j % n) + n) % n, s);
  const a = H(gx, gy), b = H(gx + 1, gy), c = H(gx, gy + 1), d = H(gx + 1, gy + 1);
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

let atlasBuf = null;
function cellPainter(idx) {
  const col = idx % COLS, row = Math.floor(idx / COLS);
  const wrap = (v) => ((v % CELL) + CELL) % CELL;
  const P = {
    set(x, y, c) {
      x = wrap(Math.round(x)); y = wrap(Math.round(y));
      const o = ((AH - 1 - (row * CELL + y)) * AW + col * CELL + x) * 4;
      atlasBuf[o] = (c >> 16) & 255; atlasBuf[o + 1] = (c >> 8) & 255; atlasBuf[o + 2] = c & 255; atlasBuf[o + 3] = 255;
    },
    get(x, y) {
      x = wrap(Math.round(x)); y = wrap(Math.round(y));
      const o = ((AH - 1 - (row * CELL + y)) * AW + col * CELL + x) * 4;
      return (atlasBuf[o] << 16) | (atlasBuf[o + 1] << 8) | atlasBuf[o + 2];
    },
    fill(fn) { for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) P.set(x, y, fn(x, y)); },
  };
  return P;
}
const pk = (pal, i) => pal[clamp(Math.round(i), 0, pal.length - 1)];

/** Planks: courses `h` texels deep with a dark joint, staggered butt joints, grain runs and knots. */
function paintPlanks(P, pal, seed, { h = 8, vertical = false, wear = 0 } = {}) {
  const r = createRng(`kit:planks:${seed}`);
  const put = (a, b, c) => (vertical ? P.set(b, a, c) : P.set(a, b, c));
  for (let c = 0; c < CELL; c += h) {
    const tone = r.int(-1, 1) * 0.5 + 2.6;
    const joints = [r.int(0, 63), r.int(0, 63)];
    for (let j = 0; j < h; j++) for (let a = 0; a < CELL; a++) {
      let k = tone + (vnoise(a, c + j, seed + 7, 8) - 0.5) * 0.9;
      if (j === 0) k += 1.1;
      else if (j === h - 2) k -= 0.8;
      if (j === h - 1 || joints.includes(a)) k = 0.2;
      else if (joints.includes(a - 1)) k += 0.8;
      put(a, c + j, pk(pal, k));
    }
    for (let s = 0; s < 6; s++) {                                   // grain runs
      const b = c + r.int(1, h - 3), a0 = r.int(0, 63), len = r.int(5, 18);
      for (let i = 0; i < len; i++) if (!joints.includes((a0 + i) % CELL)) put(a0 + i, b, pk(pal, tone - 1));
    }
    if (r.chance(0.45)) {                                           // a knot
      const a = r.int(2, 61), b = c + r.int(2, Math.max(2, h - 3));
      put(a, b, pal[0]); put(a + 1, b, pal[1]); put(a - 1, b, pal[2]);
    }
    for (let s = 0; s < wear * 10; s++) put(r.int(0, 63), c + r.int(0, h - 2), pk(pal, tone - 1.5));
  }
}

function paintIron(P, pal, seed) {
  const r = createRng(`kit:iron:${seed}`);
  P.fill((x, y) => pk(pal, 2.4 + (vnoise(x, y, seed, 4) - 0.5) * 1.6 + (hash2(x, y, seed) < 0.06 ? -1 : 0)));
  for (let y = 5; y < CELL; y += 16) for (let x = 6; x < CELL; x += 16) {   // rivets
    const x0 = x + r.int(-1, 1);
    P.set(x0, y, pal[5]); P.set(x0 + 1, y, pal[4]); P.set(x0, y + 1, pal[4]); P.set(x0 + 1, y + 1, pal[1]);
  }
}

/** Cut blocks in courses, mortar joints, lit top-left arrises, speckle; `moss` creeps over some. */
function paintBlocks(P, pal, seed, { course = 16, moss = null, flags = false } = {}) {
  const r = createRng(`kit:blocks:${seed}`);
  for (let cy = 0; cy < CELL; cy += course) {
    // EXACTLY ONE PERIOD PER COURSE. The cuts used to start at a random 0-10 and stop anywhere past 64,
    // so when the wrap fell short of the start a strip of the course was never painted and stayed
    // transparent black — the "black texel holes" the reviewer found in every ruin (round 1, T2), and in
    // everything else cut from this cell. The last cut is now always the first one plus a full cell.
    const start = r.int(0, 10);
    let x = start;
    const cuts = [];
    while (x < start + CELL - 8) { cuts.push(x); x += flags ? r.int(14, 30) : r.int(18, 30); }
    cuts.push(start + CELL);
    for (let i = 0; i < cuts.length - 1; i++) {
      const x0 = cuts[i], x1 = cuts[i + 1] - 1, tone = 2.5 + r.float(-0.7, 0.7);
      for (let y = cy; y < cy + course; y++) for (let xx = x0; xx <= x1; xx++) {
        let k = tone + (vnoise(xx, y, seed, 4) - 0.5) * 0.8;
        if (y === cy + course - 1 || xx === x1) k = 0.3;                  // mortar
        else if (y === cy || xx === x0) k += 1.1;                          // lit arris
        else if (y === cy + course - 2 || xx === x1 - 1) k -= 0.9;         // shadow arris
        if (hash2(xx, y, seed + 3) < 0.05) k -= 0.8;
        P.set(xx, y, pk(pal, k));
      }
      if (r.chance(0.25)) {                                                 // a crack
        let cx = r.int(x0 + 2, Math.max(x0 + 2, x1 - 2)), yy = cy + 1;
        while (yy < cy + course - 2) { P.set(cx, yy, pal[1]); cx += r.int(-1, 1); yy++; }
      }
    }
  }
  if (moss) {
    P.fill((x, y) => {
      const m = vnoise(x, y, seed + 11, 16) * 0.7 + vnoise(x, y, seed + 12, 4) * 0.3;
      const c = P.get(x, y);
      if (m < 0.6) return c;
      return pk(moss, 1.5 + (m - 0.6) * 9 + (hash2(x, y, seed + 5) < 0.2 ? 1 : 0));
    });
  }
}

function paintSmooth(P, pal, seed, { base = 3, spread = 1.2, g = 8, speck = 0.04, veins = false } = {}) {
  P.fill((x, y) => {
    let k = base + (vnoise(x, y, seed, g) - 0.5) * spread * 2 + (vnoise(x, y, seed + 1, 4) - 0.5) * 0.6;
    if (hash2(x, y, seed + 2) < speck) k -= 1;
    if (veins) { const v = Math.abs(vnoise(x, y, seed + 9, 16) - 0.5); if (v < 0.03) k -= 1.4; }
    return pk(pal, k);
  });
}

function paintCloth(P, pal, seed) {
  P.fill((x, y) => {
    let k = 2.8 + (vnoise(x, y, seed, 16) - 0.5) * 1.4;
    if (((x + y) & 3) === 0) k -= 0.5;
    const fold = Math.sin((x + vnoise(x, y, seed + 4, 16) * 8) * 0.4);
    k += fold > 0.75 ? 0.9 : fold < -0.8 ? -0.9 : 0;
    return pk(pal, k);
  });
  for (let x = 0; x < CELL; x++) { P.set(x, 2, pal[4]); P.set(x, 3, PAL.gold[3]); P.set(x, 4, pal[1]); }   // a gilt hem
}

/** Foliage clumps: each a lit top-left crescent over a shaded bottom-right, dark between. */
function paintLeaves(P, pal, seed, { needles = false } = {}) {
  const r = createRng(`kit:leaves:${seed}`);
  if (!needles) {
    // LEAF DABS, LOW CONTRAST (reviewer round 2, T1b). The light and dark of a crown are the vertex
    // colour's job now (a three-tone ramp per lobe), so the texture only has to say "leaves": a mid
    // ground with 120 small dabs of 2-4 texels a step either side of it, each with one lit texel up and
    // to the left. No dark ground (round 0's speckle) and no big crescents (round 2's one CG highlight
    // printed on every lobe).
    P.fill((x, y) => pk(pal, 2.8 + (vnoise(x, y, seed, 16) - 0.5) * 0.6));
    for (let i = 0; i < 120; i++) {
      const cx = r.int(0, 63), cy = r.int(0, 63), rad = r.int(2, 4), tone = r.chance(0.5) ? 3.6 : 2.2;
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy > rad * rad) continue;
        P.set(cx + dx, cy + dy, pk(pal, tone + (dx + dy > 1 ? -0.6 : 0)));
      }
      P.set(cx - 1, cy - 1, pk(pal, tone + 1));
    }
    return;
  }
  P.fill((x, y) => pk(pal, 1.2 + vnoise(x, y, seed, 8) * 0.9));
  for (let i = 0; i < 90; i++) {
    const cx = r.int(0, 63), cy = r.int(0, 63), rad = r.int(2, 3);
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const d = (dx * dx + dy * dy) / (rad * rad);
      if (d > 1) continue;
      let k = 3;
      if (d > 0.55 && dx + dy > 0) k = 2;
      if (d > 0.8 && dx + dy > 1) k = 1.4;
      if (d < 0.5 && dx + dy < -1) k = 4;
      if (Math.abs(dx - dy) > 1 && d > 0.3) continue;
      P.set(cx + dx, cy + dy, pk(pal, k));
    }
    P.set(cx - Math.ceil(rad / 2), cy - Math.ceil(rad / 2), pal[5]);
  }
}

function paintBark(P, pal, seed) {
  P.fill((x, y) => {
    const s = vnoise(x * 3, y * 0.4, seed, 8);
    let k = 2.5 + (s - 0.5) * 2.4;
    if (hash2(x, Math.floor(y / 6), seed) < 0.12) k -= 1.2;
    return pk(pal, k);
  });
}

function paintWeave(P, pal, seed) {
  P.fill((x, y) => pk(pal, 2.8 + (vnoise(x, y, seed, 8) - 0.5) * 1.2 + (((x >> 1) + (y >> 1)) & 1 ? 0.5 : -0.4)));
}

function paintGrass(P, pal, seed) {
  const r = createRng(`kit:grass:${seed}`);
  P.fill((x, y) => pk(pal, 2.4 + (vnoise(x, y, seed, 8) - 0.5) * 1.4));
  for (let i = 0; i < 70; i++) {
    const x = r.int(0, 63), y = r.int(0, 63);
    P.set(x, y, pal[4]); P.set(x, y + 1, pal[3]); P.set(x + 1, y + 1, pal[2]); if (r.chance(0.3)) P.set(x - 1, y - 1, pal[5]);
  }
}

function paintEmber(P, pal, seed) {
  P.fill((x, y) => {
    const n = vnoise(x, y, seed, 8) * 0.6 + vnoise(x, y, seed + 1, 4) * 0.4;
    return pk(pal, n * 6.2 - 0.6);
  });
}

function paintRock(P, pal, seed) {
  // soft, low-contrast stone with no single-texel speckle (projected onto a steep face, a lone dark
  // texel is a streak) and a few meandering crack strokes, which read as cracks on any face
  P.fill((x, y) => pk(pal, 2.9 + (vnoise(x, y, seed, 16) - 0.5) * 1.3 + (vnoise(x, y, seed + 1, 8) - 0.5) * 0.5));
  const r = createRng(`kit:rock:${seed}`);
  for (let i = 0; i < 9; i++) {                                           // cracks: enough that any boulder face crosses 2-3
    let x = r.int(0, 63), y = r.int(0, 63);
    const dx = r.pick([-1, 1]), len = r.int(10, 16);
    for (let j = 0; j < len; j++) {
      P.set(x, y, pal[0]); P.set(x, y + 1, pal[1]); P.set(x + 1, y, pal[1]);   // two texels wide: one reads as a projection streak
      x += dx; if (r.chance(0.45)) y += r.pick([-1, 1]);
    }
  }
  for (let i = 0; i < 8; i++) {                                           // lichen
    const cx = r.int(0, 63), cy = r.int(0, 63);
    for (let k = 0; k < 5; k++) P.set(cx + r.int(-2, 2), cy + r.int(-1, 1), pk(PAL.grass, r.int(3, 4)));
  }
}

function paintPage(P, pal, seed) {
  P.fill((x, y) => pk(pal, 3.6 + (vnoise(x, y, seed, 8) - 0.5)));
  const r = createRng(`kit:page:${seed}`);
  for (let y = 3; y < CELL; y += 3) { let x = r.int(1, 4); while (x < CELL - 3) { const w = r.int(2, 6); for (let i = 0; i < w; i++) P.set(x + i, y, pal[1]); x += w + r.int(1, 2); } }
}

function paintEndgrain(P, pal, seed) {
  P.fill((x, y) => {
    const dx = x - 31.5, dy = y - 31.5, d = Math.sqrt(dx * dx + dy * dy) + vnoise(x, y, seed, 8) * 3;
    let k = 3.4 - (d % 5 < 1 ? 1 : 0);
    if (d > 26) k = 1.2;
    if (d > 29) k = 0.5;
    return pk(pal, k);
  });
}

function paintCoins(P, pal, seed) {
  const r = createRng(`kit:coins:${seed}`);
  P.fill((x, y) => pk(pal, 1.4 + vnoise(x, y, seed, 4)));
  for (let i = 0; i < 70; i++) {
    const cx = r.int(0, 63), cy = r.int(0, 63);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx * dx + dy * dy <= 4) P.set(cx + dx, cy + dy, pk(pal, dx + dy < 0 ? 4.4 : dx + dy > 1 ? 2.2 : 3.3));
    P.set(cx - 1, cy - 1, pal[5]);
  }
}

/** Book spines on shelves, 16 texels a shelf: spines of varied height and colour, void above. */
function paintBooks(P, seed) {
  const r = createRng(`kit:books:${seed}`);
  const cols = [PAL.cloth, PAL.leaf, PAL.leather, PAL.slate, PAL.linen, PAL.dark];
  for (let sy = 0; sy < CELL; sy += 16) {
    for (let y = sy; y < sy + 16; y++) for (let x = 0; x < CELL; x++) P.set(x, y, PAL.void[1 + ((x + y) & 1)]);
    let x = 0;
    while (x < CELL) {
      const w = r.int(2, 4), h = r.int(9, 13), pal = r.pick(cols);
      if (r.chance(0.08)) { x += w; continue; }
      for (let yy = sy + 14 - h; yy < sy + 14; yy++) for (let i = 0; i < w; i++) {
        let k = 3 + (i === 0 ? 1 : i === w - 1 ? -1 : 0);
        if (yy === sy + 14 - h) k = 4.5;
        if (yy === sy + 14 - h + 3 && w > 2) k = 5;                      // a gilt band reads as a glint
        P.set(x + i, yy, i === w - 1 && w > 2 ? pal[1] : pk(pal, k));
      }
      x += w;
    }
    for (let x2 = 0; x2 < CELL; x2++) { P.set(x2, sy + 14, PAL.oak[4]); P.set(x2, sy + 15, PAL.oak[1]); }
  }
}

function paintAtlas() {
  atlasBuf = new Uint8Array(AW * AH * 4);
  const C = (name) => cellPainter(MAT[name]);
  paintPlanks(C('oak'), PAL.oak, 1);
  paintPlanks(C('dark'), PAL.dark, 2, { wear: 1 });
  paintPlanks(C('ash'), PAL.ash, 3, { h: 7 });
  paintIron(C('iron'), PAL.iron, 4);
  paintBlocks(C('block'), PAL.block, 5);
  paintSmooth(C('slate'), PAL.slate, 6, { base: 2.8, spread: 0.9, g: 16, speck: 0.05 });
  paintSmooth(C('bone'), PAL.bone, 7, { base: 3.2, spread: 0.8, speck: 0.03 });
  paintCloth(C('cloth'), PAL.cloth, 8);
  paintSmooth(C('gold'), PAL.gold, 9, { base: 3.2, spread: 1.4, g: 4, speck: 0.08 });
  paintPlanks(C('staves'), PAL.oak, 10, { h: 7, vertical: true });
  paintLeaves(C('leaf'), PAL.leaf, 11);
  paintBark(C('bark'), PAL.bark, 12);
  paintWeave(C('linen'), PAL.linen, 13);
  paintGrass(C('grass'), PAL.grass, 14);
  paintSmooth(C('void'), PAL.void, 15, { base: 2, spread: 1 });
  paintSmooth(C('marble'), PAL.marble, 16, { base: 3.2, spread: 0.7, g: 16, speck: 0.01, veins: true });
  paintSmooth(C('leather'), PAL.leather, 17, { base: 3, spread: 1, g: 4, speck: 0.05 });
  paintSmooth(C('glass'), PAL.glass, 18, { base: 3.4, spread: 0.8, g: 16, speck: 0 });
  paintEmber(C('ember'), PAL.ember, 19);
  paintLeaves(C('needles'), PAL.needles, 20, { needles: true });
  paintRock(C('rock'), PAL.rock, 21);
  paintPlanks(C('drift'), PAL.drift, 22, { h: 10, wear: 2 });
  paintPage(C('page'), PAL.page, 23);
  paintSmooth(C('dirt'), PAL.dirt, 24, { base: 2.6, spread: 1.4, g: 4, speck: 0.12 });
  paintSmooth(C('clay'), PAL.clay, 25, { base: 3, spread: 0.8, g: 8, speck: 0.03 });
  paintBlocks(C('mossblock'), PAL.block, 26, { moss: PAL.grass });
  paintEndgrain(C('endgrain'), PAL.oak, 27);
  paintCoins(C('coins'), PAL.gold, 28);
  paintBooks(C('books'), 29);
  paintBlocks(C('flagstone'), PAL.block, 30, { course: 32, flags: true });
  paintSmooth(C('plain'), [0x404040, 0x808080, 0xa0a0a0, 0xc0c0c0, 0xd8d8d8, 0xf0f0f0], 31, { base: 3.5, spread: 0.3 });
  paintWeave(C('straw'), [0x3e3016, 0x7a6230, 0x94793c, 0xae9048, 0xc4a658, 0xd8bc6c], 32);
  return atlasBuf;
}

let atlasTex = null;
/** The prop atlas as a texture (painted once). */
export function kitAtlas() {
  if (atlasTex) return atlasTex;
  const buf = paintAtlas();
  atlasTex = new THREE.DataTexture(buf, AW, AH, THREE.RGBAFormat);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.magFilter = THREE.NearestFilter;
  atlasTex.minFilter = THREE.NearestMipmapNearestFilter;
  atlasTex.generateMipmaps = true;
  atlasTex.flipY = false;
  atlasTex.needsUpdate = true;
  return atlasTex;
}

let mats = null;
/**
 * [lit, glow]: one draw call per prop for the solid part, a second only if something in it burns.
 * Lit goes through `patchSurface` with `quant` (the world texel grid and the pixel-art alpha mask);
 * the glow half is unlit and fogged, so a brazier's coals never glow through the fog of war.
 */
export function kitMaterials() {
  if (mats) return mats;
  const fog = getFog();
  const map = kitAtlas();
  const lit = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.92, metalness: 0 });
  const glow = new THREE.MeshBasicMaterial({ map, vertexColors: true });
  if (fog) {
    patchSurface(lit, fog, { quant: [TPU / AW, TPU / AH] });
    patchFog(glow, fog);
    const prev = glow.customProgramCacheKey;
    glow.customProgramCacheKey = () => `${prev ? prev() : ''}|kitglow`;
  }
  mats = [lit, glow];
  return mats;
}

// -------------------------------------------------------------------------------- the builder
/** The house key light in world space: from the north-west and above (style.js LIT is top-left). */
const KEY = new THREE.Vector3(-0.45, 0.8, -0.4).normalize();
/** What every lit normal is leaned toward (see `vert`): straight up, a touch toward the camera. */
const BEND = new THREE.Vector3(0, 1.5, 0.3);
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
/** Unit icosahedron vertex buffers by detail level, shared by every blob (a wood builds thousands). */
const ICO = new Map();

export class KitBuilder {
  constructor({ shear = SHEAR, bend = true } = {}) {
    this.pos = []; this.nor = []; this.uv = []; this.col = [];
    this.idx = [[], []];
    this.shear = shear;
    this.bend = bend;
    this.stack = [new THREE.Matrix4()];
    this.seed = 1;
  }

  get M() { return this.stack[this.stack.length - 1]; }
  /** Run `fn` with `m` composed onto the current transform. */
  with(m, fn) { this.stack.push(this.M.clone().multiply(m)); try { fn(); } finally { this.stack.pop(); } return this; }
  at(x, y, z, ry = 0, fn) { return this.with(new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z), fn); }

  uvOf(cell, s, t) {
    const col = cell % COLS, row = Math.floor(cell / COLS);
    const ss = clamp(s, 0.02, CELL - 0.02), tt = clamp(t, 0.02, CELL - 0.02);
    return [(col * CELL + ss) / AW, (AH - (row + 1) * CELL + tt) / AH];
  }

  /**
   * One vertex. `p`/`n` in the builder's local frame; colour is linear [r,g,b].
   *
   * THE NORMAL IS BENT UP. The room is lit from above — the lantern, the moon key, the torch spots
   * all sit over the floor — so an honest upright normal takes almost none of it and every front face
   * came back black in 'furnished-guardroom' (the hearth's piers, the cupboard, the rack). But the
   * shear has already turned those faces into the cast's billboards, and a billboard is lit as a
   * thing facing up into the room. So the normal leans most of the way to vertical: the room's light
   * lands on the whole piece, and the difference between its faces is the baked key light's job.
   */
  vert(p, n, uv, c) {
    _v.set(p[0], p[1], p[2]).applyMatrix4(this.M);
    _n.set(n[0], n[1], n[2]).transformDirection(this.M);
    if (this.bend) _n.multiplyScalar(0.62).add(BEND).normalize();
    this.pos.push(_v.x, _v.y, _v.z); this.nor.push(_n.x, _n.y, _n.z);
    this.uv.push(uv[0], uv[1]); this.col.push(c[0], c[1], c[2]);
    return this.pos.length / 3 - 1;
  }

  /** A polygon (3 or 4 corners), wound to face `n` whatever order the corners were given in. */
  poly(P, n, UV, C, cell) {
    _a.set(P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]);
    _b.set(P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]);
    const flip = _a.cross(_b).dot(_n.set(n[0], n[1], n[2])) < 0;
    const ids = P.map((p, i) => this.vert(p, n, this.uvOf(cell, UV[i][0], UV[i][1]), C[i]));
    const g = this.idx[GLOW_CELLS.has(cell) ? 1 : 0];
    const tri = (i, j, k) => (flip ? g.push(ids[i], ids[k], ids[j]) : g.push(ids[i], ids[j], ids[k]));
    tri(0, 1, 2);
    if (ids.length === 4) tri(0, 2, 3);
  }

  /** Texel offset inside a cell for a face `w` x `h` texels, hashed so neighbouring faces differ. */
  off(w, h, salt) {
    const s = this.seed++ * 7919 + salt;
    return [Math.floor(hash2(s, 1, 17) * Math.max(0, CELL - w)), Math.floor(hash2(s, 2, 17) * Math.max(0, CELL - h))];
  }

  /**
   * Axis-aligned box in the current frame, from (x0,y0,z0) to (x1,y1,z1).
   * @param {object} o
   *  mat/top/front/side/back: atlas cells (top/front/side/back default to mat)
   *  tint: number | [r,g,b] multiplier; bevel: world size of the chamfer round the top face
   *  grain: 'x' | 'z' — which way the top face's texture runs (planks along the long side by default)
   *  bottom: draw the underside; shade: false to skip the baked key light (glow parts)
   *  sides: {n,s,e,w} set false to skip a face (hidden against something)
   */
  box(x0, y0, z0, x1, y1, z1, o = {}) {
    const mat = o.mat ?? MAT.plain, top = o.top ?? mat, side = o.side ?? mat, front = o.front ?? side, back = o.back ?? side;
    const T = Array.isArray(o.tint) ? o.tint : [o.tint ?? 1, o.tint ?? 1, o.tint ?? 1];
    const sh = o.shade === false ? () => 1 : (k) => k;
    const c = (k) => [T[0] * sh(k), T[1] * sh(k), T[2] * sh(k)];
    const b = Math.min(o.bevel || 0, (x1 - x0) / 3, (z1 - z0) / 3, (y1 - y0) / 2);
    const yt = y1 - b;
    const grainZ = o.grain ? o.grain === 'z' : (z1 - z0) > (x1 - x0) * 1.15;
    const sides = o.sides || {};
    const tw = (x1 - x0) * TPU, td = (z1 - z0) * TPU, th = (y1 - y0) * TPU;
    // top (+ bevel ring)
    {
      const [os, ot] = grainZ ? this.off(td, tw, 1) : this.off(tw, td, 1);
      const UVt = (x, z) => (grainZ ? [os + (z1 - z) * TPU, ot + (x - x0) * TPU] : [os + (x - x0) * TPU, ot + (z1 - z) * TPU]);
      const ix0 = x0 + b, ix1 = x1 - b, iz0 = z0 + b, iz1 = z1 - b;
      const corners = [[ix0, y1, iz0], [ix1, y1, iz0], [ix1, y1, iz1], [ix0, y1, iz1]];
      this.poly(corners, [0, 1, 0], corners.map((p) => UVt(p[0], p[2])), [c(1), c(0.97), c(0.92), c(0.95)], top);
      if (b > 0) {
        const ring = [
          [[x0, yt, z0], [x1, yt, z0], [ix1, y1, iz0], [ix0, y1, iz0], [0, 0.7, -0.7], 1.16], // north: lit lip (P3: a prop must not read as a hole on a bright floor)
          [[x0, yt, z0], [ix0, y1, iz0], [ix0, y1, iz1], [x0, yt, z1], [-0.7, 0.7, 0], 1.1],   // west: lit
          [[x1, yt, z1], [ix1, y1, iz1], [ix1, y1, iz0], [x1, yt, z0], [0.7, 0.7, 0], 0.8],   // east: shade
          [[x0, yt, z1], [ix0, y1, iz1], [ix1, y1, iz1], [x1, yt, z1], [0, 0.7, 0.7], 0.82],  // south: shade
        ];
        for (const [p, q, r, s, n, k] of ring) this.poly([p, q, r, s], n, [p, q, r, s].map((v) => UVt(v[0], v[2])), [c(k), c(k), c(k), c(k)], top);
      }
    }
    // `frontK` darkens every upright face of the box together (reviewer round 2, P10): a stone piece on
    // a pale floor separated from it by its outline alone, and which face is the camera's depends on facing
    const fk = o.frontK ?? 1;
    const upright = (P, n, sAxis, cell, kTop, kBot, salt, flipS) => {
      const len = sAxis === 'x' ? tw : td;
      const [os, ot] = this.off(len, th, salt);
      const UV = P.map((p) => {
        const along = sAxis === 'x' ? (p[0] - x0) * TPU : (p[2] - z0) * TPU;
        return [os + (flipS ? len - along : along), ot + (p[1] - y0) * TPU];
      });
      this.poly(P, n, UV, P.map((p) => c(p[1] > y0 + 1e-6 ? kTop : kBot)), cell);
    };
    if (sides.s !== false) upright([[x0, y0, z1], [x1, y0, z1], [x1, yt, z1], [x0, yt, z1]], [0, 0, 1], 'x', front, 0.88 * fk, 0.66 * fk, 2);
    if (sides.w !== false) upright([[x0, y0, z0], [x0, y0, z1], [x0, yt, z1], [x0, yt, z0]], [-1, 0, 0], 'z', side, 0.9 * fk, 0.68 * fk, 3);
    if (sides.e !== false) upright([[x1, y0, z1], [x1, y0, z0], [x1, yt, z0], [x1, yt, z1]], [1, 0, 0], 'z', side, 0.74 * fk, 0.54 * fk, 4, true);
    if (sides.n !== false) upright([[x1, y0, z0], [x0, y0, z0], [x0, yt, z0], [x1, yt, z0]], [0, 0, -1], 'x', back, 0.62 * fk, 0.46 * fk, 5, true);
    if (o.bottom) {
      const P = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
      this.poly(P, [0, -1, 0], P.map((p) => [(p[0] - x0) * TPU, (p[2] - z0) * TPU]), P.map(() => c(0.3)), mat);
    }
    return this;
  }

  /** Box centred on (cx, cz), standing from y0 to y1. */
  cbox(cx, cz, w, d, y0, y1, o) { return this.box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y1, cz + d / 2, o); }

  /**
   * Surface of revolution about the local y axis through (cx, cz).
   * @param {Array<[number, number]>} profile [radius, y] from bottom to top
   * @param {object} o mat, tint, seg, capTop (cell), capBottom, jag (per-segment radius wobble)
   */
  lathe(cx, cz, profile, o = {}) {
    const seg = o.seg ?? 10, mat = o.mat ?? MAT.plain;
    const T = Array.isArray(o.tint) ? o.tint : [o.tint ?? 1, o.tint ?? 1, o.tint ?? 1];
    const phase = o.phase ?? 0;
    const rad = (j, i) => profile[j][0] * (o.jag ? 1 + (i % 2 ? -o.jag : o.jag) : 1);
    const ang = (i) => phase + (i / seg) * Math.PI * 2;
    let vAcc = 0;
    const shadeN = (nx, ny, nz, y) => {
      const d = Math.max(0, nx * KEY.x + ny * KEY.y + nz * KEY.z);
      const ao = o.ao === false ? 1 : 0.74 + 0.26 * clamp((y - profile[0][1]) / Math.max(0.05, (profile[profile.length - 1][1] - profile[0][1]) * 0.6), 0, 1);
      const k = o.shade === false ? 1 : (0.64 + 0.36 * d) * ao;
      return [T[0] * k, T[1] * k, T[2] * k];
    };
    for (let j = 0; j < profile.length - 1; j++) {
      const [r0, y0] = profile[j], [r1, y1] = profile[j + 1];
      const slant = Math.hypot(r1 - r0, y1 - y0);
      const ny = -(r1 - r0) / Math.max(1e-6, slant), nr = (y1 - y0) / Math.max(1e-6, slant);
      const band = slant * TPU;
      const cell = Array.isArray(mat) ? mat[j % mat.length] : mat;
      for (let i = 0; i < seg; i++) {
        const a0 = ang(i), a1 = ang(i + 1), am = (a0 + a1) / 2;
        const ra0 = rad(j, i), ra1 = rad(j, i + 1), rb0 = rad(j + 1, i), rb1 = rad(j + 1, i + 1);
        const P = [
          [cx + Math.sin(a0) * ra0, y0, cz + Math.cos(a0) * ra0], [cx + Math.sin(a1) * ra1, y0, cz + Math.cos(a1) * ra1],
          [cx + Math.sin(a1) * rb1, y1, cz + Math.cos(a1) * rb1], [cx + Math.sin(a0) * rb0, y1, cz + Math.cos(a0) * rb0],
        ];
        if (r0 < 1e-5) P.splice(1, 1);
        else if (r1 < 1e-5) P.splice(3, 1);
        const nx = Math.sin(am) * nr, nz = Math.cos(am) * nr;
        const segW = ((r0 + r1) / 2) * (Math.PI * 2 / seg) * TPU;
        const s0 = (i * Math.max(1, Math.round(segW))) % Math.max(1, CELL - Math.ceil(segW) - 1);
        const UV = P.map((p) => {
          const a = Math.atan2(p[0] - cx, p[2] - cz);
          let f = ((a - a0) % (Math.PI * 2) + Math.PI * 4) % (Math.PI * 2);
          if (f > Math.PI) f = 0;
          return [s0 + (f / (a1 - a0)) * segW, (vAcc % 32) + ((p[1] - y0) / Math.max(1e-6, y1 - y0)) * band];
        });
        this.poly(P, [nx, ny, nz], UV, P.map((p) => shadeN(nx, ny, nz, p[1])), cell);
      }
      vAcc += band;
    }
    const cap = (j, up, cell) => {
      const [r, y] = profile[j];
      if (r < 1e-5) return;
      const k = o.shade === false ? 1 : up ? 0.94 : 0.3;
      const cc = [T[0] * k, T[1] * k, T[2] * k];
      const cu = CELL / 2;
      for (let i = 0; i < seg; i++) {
        const a0 = ang(i), a1 = ang(i + 1);
        const P = [[cx, y, cz], [cx + Math.sin(a0) * rad(j, i), y, cz + Math.cos(a0) * rad(j, i)], [cx + Math.sin(a1) * rad(j, i + 1), y, cz + Math.cos(a1) * rad(j, i + 1)]];
        this.poly(P, [0, up ? 1 : -1, 0], P.map((p) => [cu + (p[0] - cx) * TPU, cu - (p[2] - cz) * TPU]), [cc, cc, cc], cell);
      }
    };
    if (o.capTop !== undefined && o.capTop !== false) cap(profile.length - 1, true, o.capTop === true ? mat : o.capTop);
    if (o.capBottom) cap(0, false, mat);
    return this;
  }

  /**
   * A lumpy ellipsoid: crowns, bushes, boulders, heaped earth. Each triangle is projected on its
   * dominant axis, so a crown's top carries the clump pattern at true size and a rock's flanks do not
   * smear. `flat` cuts it off at the ground; `under` is how dark its underside falls.
   */
  blob(cx, cy, cz, rx, ry, rz, o = {}) {
    const mat = o.mat ?? MAT.rock, detail = o.detail ?? 1, lump = o.lump ?? 0.16, seed = o.seed ?? 1;
    const T = Array.isArray(o.tint) ? o.tint : [o.tint ?? 1, o.tint ?? 1, o.tint ?? 1];
    let p = ICO.get(detail);
    if (!p) { const ig = new THREE.IcosahedronGeometry(1, detail); p = ig.getAttribute('position'); ICO.set(detail, p); }
    const disp = (x, y, z) => {
      const kx = Math.round(x * 997), ky = Math.round(y * 997), kz = Math.round(z * 997);
      return 1 + (hash2(kx * 31 + kz, ky, seed) - 0.5) * 2 * lump;
    };
    const floorY = o.flat !== undefined ? o.flat : -Infinity;
    for (let t = 0; t < p.count; t += 3) {
      const P = [], N = [];
      for (let k = 0; k < 3; k++) {
        const x = p.getX(t + k), y = p.getY(t + k), z = p.getZ(t + k);
        const d = disp(x, y, z);
        const py = Math.max(cy + y * ry * d, floorY);
        P.push([cx + x * rx * d, py, cz + z * rz * d]);
        _n.set(x / rx, y / ry, z / rz).normalize();
        N.push([_n.x, _n.y, _n.z]);
      }
      _a.set(P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]);
      _b.set(P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]);
      const fn = _a.clone().cross(_b).normalize();
      const nAvg = [(N[0][0] + N[1][0] + N[2][0]) / 3, (N[0][1] + N[1][1] + N[2][1]) / 3, (N[0][2] + N[1][2] + N[2][2]) / 3];
      if (fn.x * nAvg[0] + fn.y * nAvg[1] + fn.z * nAvg[2] < 0) fn.negate();
      const ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
      // ONE projection per blob when `planar` (and one offset for the whole blob either way when it is):
      // a fresh offset per triangle was a patchwork of mismatched texture tiles, which is what faceted
      // the boulders and speckled the crowns
      // `triplanar` keeps that one offset but still projects each face along its own dominant axis: a
      // steep rock face projected from above smears one texel row down its whole height, which is what
      // the vertical streaks on the boulders were (reviewer round 2, T8)
      const o2 = o.planar || o.triplanar ? ((hash2(seed, 7, 5) * 24) | 0) : ((hash2(t, seed, 5) * 24) | 0);
      const topProj = o.planar && !o.triplanar;
      const UV = P.map((q) => (topProj || (ay >= ax && ay >= az) ? [o2 + (q[0] - cx + rx) * TPU, o2 + (cz + rz - q[2]) * TPU]
        : ax >= az ? [o2 + (q[2] - cz + rz) * TPU, o2 + (q[1] - cy + ry) * TPU] : [o2 + (q[0] - cx + rx) * TPU, o2 + (q[1] - cy + ry) * TPU]));
      const C = N.map((n, k) => {
        const lit = Math.max(0, n[0] * KEY.x + n[1] * KEY.y + n[2] * KEY.z);
        const under = o.under ?? 0.4;
        let kk;
        if (o.shade === false) kk = 1;
        else if (o.soft) {
          // SOFT: a flat mid tone over everything that faces the sky or the side, lifting toward the key,
          // and dark ONLY where the surface turns under (the target's canopies and boulders)
          kk = n[1] < -0.2 ? under + (0.84 - under) * clamp((n[1] + 0.75) / 0.55, 0, 1) : 0.84 + 0.26 * lit;
        } else {
          const up = clamp((n[1] + 0.55) / 1.25, 0, 1);
          kk = (under + (1 - under) * up) * (0.72 + 0.28 * lit);
        }
        const yy = P[k][1] <= floorY + 1e-4 ? 0.55 : 1;
        if (o.bands) {
          // A PAINTED RAMP, NOT A LIT BALL (reviewer round 2, T1b: "flat lime clay balls with one CG
          // highlight"). Three tints — dark olive under, mid, light yellow-green on top — chosen by how
          // much a vertex faces the sky and the key light, with a position hash wiggling the boundary so
          // the bands break up like dabs of paint instead of running round the lobe as clean rings.
          const qx = Math.round(P[k][0] * 64), qy = Math.round(P[k][1] * 64), qz = Math.round(P[k][2] * 64);
          const jit = (hash2(qx * 131 + qz, qy, seed + 17) - 0.5) * 0.34;
          // weighted toward the KEY light rather than toward the sky, so only the top-left of a lobe
          // takes the light tone: at the first weights nearly every vertex a top-down camera sees
          // came out light, and a crown read as one lime ball again (round 3 check, 'forest-overview')
          const sc = n[1] * 0.35 + lit * 0.9 + jit;
          const B = o.bands, band = sc < 0.22 ? B[0] : sc < 0.9 ? B[1] : B[2];
          const cb = [T[0] * band[0] * yy, T[1] * band[1] * yy, T[2] * band[2] * yy];
          if (o.moss && n[1] > 0.55 && band !== B[0]) {
            const m = clamp((n[1] - 0.55) / 0.4, 0, 1) * o.moss;
            return [cb[0] * (1 - m * 0.45), cb[1] * (1 + m * 0.05), cb[2] * (1 - m * 0.6)];
          }
          return cb;
        }
        let c = [T[0] * kk * yy, T[1] * kk * yy, T[2] * kk * yy];
        if (o.moss && n[1] > 0.4) {
          const m = clamp((n[1] - 0.4) / 0.45, 0, 1) * o.moss;
          c = [c[0] * (1 - m * 0.4), c[1] * (1 + m * 0.02), c[2] * (1 - m * 0.55)];
        }
        if (o.hi) {
          const h = Math.pow(lit, 3) * o.hi, ht = o.hiTint || [1.18, 1.14, 0.7];
          c = [c[0] * (1 - h) + ht[0] * h, c[1] * (1 - h) + ht[1] * h, c[2] * (1 - h) + ht[2] * h];
        }
        return c;
      });
      // the flat face under a cut blob is never seen; skip it
      if (P.every((q) => q[1] <= floorY + 1e-4)) continue;
      const ids = P.map((q, k) => this.vert(q, N[k], this.uvOf(mat, UV[k][0], UV[k][1]), C[k]));
      _a.set(P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]);
      _b.set(P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]);
      const want = _v.set(nAvg[0], nAvg[1], nAvg[2]).transformDirection(this.M);
      const got = _a.cross(_b).transformDirection(this.M);
      const gi = this.idx[GLOW_CELLS.has(mat) ? 1 : 0];
      if (got.dot(want) < 0) gi.push(ids[0], ids[2], ids[1]); else gi.push(ids[0], ids[1], ids[2]);
    }
    return this;
  }

  /** The finished geometry, sheared into the cast's projection, with a group per material. */
  build() {
    const n = this.pos.length / 3;
    const pos = new Float32Array(this.pos);
    if (this.shear) for (let i = 0; i < n; i++) pos[i * 3 + 2] -= this.shear * pos[i * 3 + 1];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    const all = this.idx[0].concat(this.idx[1]);
    geo.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array(all), 1) : new THREE.BufferAttribute(new Uint16Array(all), 1));
    geo.addGroup(0, this.idx[0].length, 0);
    if (this.idx[1].length) geo.addGroup(this.idx[0].length, this.idx[1].length, 1);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }

  /** Where a point at local (x, y, z) lands after the frame and the shear (for flames and glows). */
  place(x, y, z) {
    _v.set(x, y, z).applyMatrix4(this.M);
    return [_v.x, _v.y, _v.z - this.shear * _v.y];
  }
}

/** Test hook: the painted atlas bytes (RGBA, bottom row first) and its size. */
export function kitAtlasData() { if (!atlasBuf) paintAtlas(); return { data: atlasBuf, w: AW, h: AH, cell: CELL }; }

// forest: everything that stands in the outdoor level — trees, bushes, boulders, stumps, flowers, the
// pale ruins, the plank bridges where a trail crosses the stream, the standing stones round the temple
// and the ruined stairheads. All of it cut from the solid kit (render/props/kit.js), so the woods are
// painted texels on the one grid like the dungeon's furniture, not flat-shaded gems.
//
// HOW IT IS LAID OUT. `world/forest.js` says which tiles are wood (WALL), glade (FLOOR), trail
// (CORRIDOR) and stream (WATER); nothing here changes that or adds level data. What stands on a tile
// is a hash of the tile's position and two smooth noise fields — a CLUMP field that gathers trees into
// stands with grass between them, and a RUIN field that gathers masonry into a few old sites — so a
// seed builds the same wood every time and nothing is drawn from the shared RNG.
//
//  · A WOOD tile touching the open (EDGE) gets something solid — tree, bush, boulder or ruin — so the
//    boundary of the walkable ground still reads as a boundary.
//  · A DEEP wood tile gets a tree where the clump field is high and undergrowth or bare grass where it
//    is low: the canopy becomes stands, and the ground shows through.
//  · A GLADE tile may carry a few flowers.
//  · A CROSSING (see `findCrossings`) carries a plank bridge laid along the trail.
//  · Nothing stands within one tile of the way in: the hero arrives on that tile.
//
// PROJECTION. Solid pieces take the kit's full cabinet shear. Trees take less (`TREE_SHEAR`): a
// crown at head height sheared fully would lean most of a tile into the glade north of it and hide
// whoever stands there. At 0.4 the crown sits a third of a tile north of its trunk, which is where the
// trunk stub shows — the only part of a trunk this camera can see.
//
// Every chunk of the map is one merged mesh per shear (the kit's lit/glow groups), and every shadow
// on the map is one more, so a whole wood is a few dozen draw calls.
import * as THREE from 'three';
import { TILE } from '../../core/constants.js';
import { KitBuilder, MAT as M } from './kit.js';
import { kitPropMaterials } from './kitProps.js';
import { patchFog } from '../lighting.js';
import { getFog, flame, billboard, glowTexture, groundGlow } from '../propFx.js';

const TREE_SHEAR = 0.4;
const CHUNK = 12;
const T32 = 1 / 32;

function hash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise over tiles, lattice `cell` tiles. */
function field(x, y, cell, s) {
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell), fx = x / cell - gx, fy = y / cell - gy;
  const a = hash(gx, gy, s), b = hash(gx + 1, gy, s), c = hash(gx, gy + 1, s), d = hash(gx + 1, gy + 1, s);
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const rotY = (a) => new THREE.Matrix4().makeRotationY(a);
const rotZ = (a) => new THREE.Matrix4().makeRotationZ(a);
const rotX = (a) => new THREE.Matrix4().makeRotationX(a);
const at = (m, x, y, z) => m.setPosition(x, y, z);

// lush greens only: a mid, a yellow-lime, a cool blue-green — no dead olive
// (reviewer round 3, T1c) the wood must separate from the glades: every tint leans BLUE of the grass and
// the conifers sit under 1, darker than the broadleaf
const LEAF = [[1, 1, 1], [0.92, 1.0, 0.96], [1.0, 1.02, 0.9], [0.86, 0.96, 1.02]];
const PINE = [[0.8, 0.86, 0.92], [0.74, 0.86, 0.9], [0.84, 0.88, 0.86]];
const PETALS = [[1.15, 1.15, 1.15], [1.2, 0.72, 0.95], [1.2, 1.05, 0.35], [0.7, 0.85, 1.25], [1.2, 0.55, 0.45]];
const PALE = [1.36, 1.33, 1.25];   // the target's ruins are pale, bevelled blocks: well above the rock grey

/**
 * SOFT FOLIAGE (reviewer round 1, T1: "canopies are dark high-frequency noise, like crumpled paper").
 * One texture projection per blob instead of one per triangle (the per-triangle patchwork was most
 * of the noise), vertex light that stays mid all the way round and only falls dark on the underside,
 * and a pale yellow-green highlight toward the key light. The atlas cell itself is big soft lobes.
 */
// dark blue-olive, mid, a light that is green rather than lime: about 20% under the grass and bluer than it
const CANOPY_BANDS = [[0.5, 0.56, 0.54], [0.86, 0.92, 0.92], [1.14, 1.16, 0.88]];
// a boulder's crown, flank and base rim (reviewer round 3, T11)
const ROCK_BANDS = [[0.5, 0.51, 0.54], [0.92, 0.92, 0.9], [1.3, 1.29, 1.22]];
const LEAVES = { mat: M.leaf, detail: 1, lump: 0.06, planar: true, bands: CANOPY_BANDS };
/** ±10% value and a hue lean toward yellow or blue, per tree, from its seed (reviewer round 2, T1b). */
function vary(tint, seed) {
  const v = 0.9 + hash(seed, 3, 211) * 0.2, h = (hash(seed, 4, 211) - 0.5) * 2;
  return [tint[0] * v * (1 + h * 0.1), tint[1] * v, tint[2] * v * (1 - h * 0.12)];
}
/** A lobe with two or three small leaf clusters standing out of its upper rim: a notched silhouette. */
function lobe(k, x, y, z, rx, ry, rz, tint, seed) {
  k.blob(x, y, z, rx, ry, rz, { ...LEAVES, seed, tint });
  const n = 2 + (hash(seed, 1, 57) < 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = hash(seed, i + 2, 57) * Math.PI * 2, e = 0.35 + hash(seed, i + 9, 57) * 0.3;
    const cr = Math.min(rx, rz) * (0.34 + hash(seed, i + 5, 57) * 0.12);
    k.blob(x + Math.cos(a) * rx * 0.86, y + ry * e, z + Math.sin(a) * rz * 0.86, cr, cr * 0.8, cr, { ...LEAVES, detail: 0, seed: seed * 7 + i, tint });
  }
}

// ------------------------------------------------------------------------------------ pieces
/** A broadleaf: a trunk stub and a crown of FOUR notched lobes — one central, three round it. */
function broadleaf(k, x, z, s, tint, seed) {
  k.lathe(x, z, [[0.12 * s, 0], [0.085 * s, 0.14 * s], [0.075 * s, 0.5 * s]], { mat: M.bark, seg: 6, tint: 1.1, phase: seed });
  const cy = 0.7 * s, t = vary(tint, seed);
  lobe(k, x, cy, z, 0.4 * s, 0.29 * s, 0.38 * s, t, seed);
  for (let i = 0; i < 3; i++) {
    const a = seed * 0.7 + i * 2.094, r = 0.27 * s;
    lobe(k, x + Math.cos(a) * r, cy - 0.06 * s, z + Math.sin(a) * r * 0.85, 0.28 * s, 0.22 * s, 0.26 * s, t, seed + i + 1);
  }
}

function conifer(k, x, z, s, tint, seed) {
  tint = vary(tint, seed);
  k.lathe(x, z, [[0.09 * s, 0], [0.065 * s, 0.32 * s]], { mat: M.bark, seg: 5, tint: 1.05 });
  for (let i = 0; i < 3; i++) {
    const r = 0.46 * s * (1 - i * 0.24), y0 = 0.16 * s + i * 0.27 * s, h = 0.5 * s * (1 - i * 0.1);
    k.lathe(x, z, [[r, y0], [r * 0.56, y0 + h * 0.42], [0.02, y0 + h]], { mat: M.needles, seg: 10, jag: 0.17, capBottom: true, tint, phase: seed + i });
  }
}

function bush(k, x, z, s, tint, seed, flowers) {
  const n = 2 + ((seed * 7) | 0) % 2;
  for (let i = 0; i < n; i++) {
    const a = seed * 3 + i * 2.1, r = i ? 0.15 * s : 0;
    k.blob(x + Math.cos(a) * r, 0.1 * s, z + Math.sin(a) * r * 0.8, 0.26 * s, 0.22 * s, 0.24 * s,
      { ...LEAVES, flat: 0, seed: seed + i, tint: vary([tint[0] * 0.92, tint[1] * 0.97, tint[2] * 0.9], seed) });
  }
  if (flowers) {
    const col = PETALS[(seed * 13 | 0) % PETALS.length];
    for (let i = 0; i < 6; i++) {
      const a = seed * 5 + i * 1.05, r = 0.1 * s + (i % 2) * 0.08 * s;
      k.cbox(x + Math.cos(a) * r, z + Math.sin(a) * r * 0.8, 0.06, 0.06, 0.26 * s, 0.3 * s, { mat: M.plain, tint: col });
    }
  }
}

/**
 * A boulder (reviewer round 1, T4: "faceted low-poly with a flat grey face"): twice the subdivision,
 * a quarter of the displacement, one texture projection for the whole rock, round top-lit shading with
 * a highlight toward the key, and moss on whatever faces the sky.
 */
function boulder(k, x, z, s, seed) {
  // not `soft`: a boulder cut off at the ground has no underside to go dark, and soft light left it a
  // pale featureless balloon
  const R = { mat: M.rock, detail: 2, lump: 0.07, triplanar: true, bands: ROCK_BANDS, moss: 0.8, flat: 0 };
  k.blob(x, 0.08 * s, z, 0.36 * s, 0.3 * s, 0.32 * s, { ...R, seed, tint: 1.0 });
  // FORM THAT SURVIVES A SMALL ROCK (reviewer round 3, T11: "featureless blobs"). Per-vertex bands blur
  // into a gradient across a rock this size, so the three reads are geometry: a dark skirt where the rock
  // meets the grass, a flattened pale crown up and to the key light, and crack strokes cut into the crown.
  k.blob(x + 0.01 * s, 0.02 * s, z + 0.02 * s, 0.38 * s, 0.07 * s, 0.34 * s, { mat: M.rock, detail: 1, lump: 0.08, flat: 0, seed: seed + 11, shade: false, tint: [0.34, 0.35, 0.36] });
  const cy = 0.08 * s + 0.3 * s * 0.78;
  k.blob(x - 0.07 * s, cy, z - 0.06 * s, 0.2 * s, 0.07 * s, 0.17 * s, { mat: M.rock, detail: 1, lump: 0.05, flat: cy - 0.02 * s, seed: seed + 13, shade: false, tint: [1.3, 1.3, 1.24] });
  for (let i = 0; i < 2 + (hash(seed, 7, 5) < 0.5 ? 1 : 0); i++) {
    const a = hash(seed, i, 19) * Math.PI, ox = (hash(seed, i, 23) - 0.5) * 0.18 * s, oz = (hash(seed, i, 29) - 0.5) * 0.14 * s;
    k.with(at(rotY(a), x - 0.06 * s + ox, cy + 0.045 * s, z - 0.05 * s + oz), () => k.box(-0.07 * s, 0, -1 / 64, 0.07 * s, 0.01, 1 / 64, { mat: M.void, shade: false, tint: 1.6 }));
  }
  if (hash(seed * 1000, 1, 5) < 0.6) k.blob(x + 0.3 * s, 0.03 * s, z + 0.2 * s, 0.15 * s, 0.13 * s, 0.14 * s, { ...R, detail: 1, seed: seed + 3, tint: 0.95 });
}

function stump(k, x, z, s, seed) {
  k.lathe(x, z, [[0.19 * s, 0], [0.15 * s, 0.07 * s], [0.14 * s, 0.17 * s]], { mat: M.bark, seg: 8, capTop: M.endgrain, tint: 1.08, phase: seed });
  k.blob(x + 0.22 * s, 0.02, z + 0.1 * s, 0.14, 0.1, 0.12, { ...LEAVES, flat: 0, seed, tint: [0.88, 0.97, 0.84] });
}

/**
 * A stretch of fallen wall along one side of the open (reviewer round 1, T2: "thin 1-block
 * crenellations with black texel holes"). Now TWO BLOCKS THICK — every block is the wall's full
 * 0.46 depth — in a proper bond that never overlaps: two blocks on the ground course, one over the
 * joint above, broken off at random. The old courses overlapped by a sixth of a block where the offset
 * row met the clamped end, and two coplanar lids fighting over one pixel is what the black texels were.
 * Every gap is a whole texel, so nothing is left sub-texel to shimmer.
 */
function ruinWall(k, x, z, alongX, seed) {
  k.with(at(rotY(alongX ? 0 : Math.PI / 2), x, 0, z), () => {
    const bh = 0.25, G = T32 / 2, Z0 = -0.23, Z1 = 0.23;
    const courses = [[[-0.5, 0], [0, 0.5]], [[-0.25, 0.25]]];
    courses.forEach((row, c) => row.forEach(([a0, a1], b) => {
      if (c === 1 && hash(seed, b, 31) < 0.4) return;
      const moss = c === row.length - 1 ? hash(seed * 31 + c, b, 7) < 0.55 : hash(seed * 31 + c, b, 7) < 0.25;
      const j = 0.93 + hash(seed + c, b, 3) * 0.12;
      k.box(a0 + G, c * bh, Z0, a1 - G, (c + 1) * bh - G, Z1, { mat: moss ? M.mossblock : M.block, bevel: T32, tint: [PALE[0] * j, PALE[1] * j, PALE[2] * j] });
    }));
    // what came off it, now and then, lying at its foot on the open side
    if (hash(seed, 9, 71) < 0.45) {
      const fx = (hash(seed, 1, 71) - 0.5) * 0.5;
      k.with(at(rotY(hash(seed, 1, 73) * 1.2).multiply(rotZ(0.1)), fx, 0, 0.42), () => k.box(-0.16, 0, -0.12, 0.16, 0.2, 0.12, { mat: M.block, bevel: T32, tint: PALE }));
    }
  });
}

/** A square pillar of stacked drums on a plinth; intact ones keep their capital. Chunkier than it was. */
function ruinPillar(k, x, z, seed, sc = 1) {
  const drums = Math.max(1, Math.round((1 + ((hash(seed, 1, 9) * 3) | 0)) * sc));
  const intact = sc === 1 && hash(seed, 2, 9) < 0.4;
  k.box(x - 0.3, 0, z - 0.3, x + 0.3, 0.12, z + 0.3, { mat: M.block, bevel: 2 * T32, tint: PALE });
  let y = 0.12;
  for (let i = 0; i < drums; i++) {
    const jx = (hash(seed, i, 11) - 0.5) * 0.04, jz = (hash(seed, i, 12) - 0.5) * 0.04;
    const last = i === drums - 1 && !intact;
    const moss = hash(seed, i, 13) < 0.35 || (last && hash(seed, i, 16) < 0.6);
    k.with(at(rotY((hash(seed, i, 14) - 0.5) * 0.2).multiply(rotZ(last ? 0.1 : 0)), x + jx, y, z + jz), () =>
      k.box(-0.21, 0, -0.21, 0.21, 0.26, 0.21, { mat: moss ? M.mossblock : M.block, bevel: T32, tint: PALE }));
    y += 0.26 + T32 / 2;
  }
  if (intact) k.box(x - 0.27, y, z - 0.27, x + 0.27, y + 0.1, z + 0.27, { mat: M.block, bevel: 2 * T32, tint: PALE });
}

function flowerPatch(k, x, z, seed) {
  const n = 2 + ((hash(seed, 0, 41) * 3) | 0);
  const col = PETALS[(hash(seed, 1, 41) * PETALS.length) | 0];
  for (let i = 0; i < n; i++) {
    const fx = x + (hash(seed, i, 42) - 0.5) * 0.7, fz = z + (hash(seed, i, 43) - 0.5) * 0.7;
    k.cbox(fx - 0.03, fz + 0.02, 0.06, 0.03, 0, 0.03, { mat: M.leaf, tint: [0.9, 1.1, 0.8] });
    k.cbox(fx + 0.035, fz - 0.01, 0.06, 0.03, 0, 0.025, { mat: M.leaf, tint: [0.9, 1.1, 0.8] });
    for (const [px, pz] of [[-0.04, 0], [0.04, 0], [0, -0.04], [0, 0.04]]) k.cbox(fx + px, fz + pz, 0.045, 0.045, 0.05, 0.075, { mat: M.plain, tint: col });
    k.cbox(fx, fz, 0.04, 0.04, 0.06, 0.085, { mat: M.gold, tint: 1.1 });
  }
}

/**
 * A plank bridge (reviewer round 2, T7: "the deck reads as a picket fence"). The deck runs along the
 * TRAIL, `len` tiles end to end and centred on (cx, cz). Planks lie flat ACROSS the direction of travel,
 * four texels wide with a one-texel dark gap, all level and all the same length: the old planks were
 * jittered in length and height, so their ragged ends and sheared front faces stood up like staves.
 * The rails are low two-texel beams along both long edges (a tall rail and posts, sheared, were the
 * fence), with stub posts only at the four corners. The water shadow is the caller's.
 */
function bridge(k, cx, cz, alongX, len) {
  const h = len / 2, Wd = 0.4, P = 4 / 32, G = 1 / 32, top = 0.16;
  k.with(at(rotY(alongX ? 0 : Math.PI / 2), cx, 0, cz), () => {
    for (const sz of [-0.27, 0.27]) k.box(-h, 0.04, sz - 0.05, h, top - 0.04, sz + 0.05, { mat: M.dark, tint: 0.95 });  // stringers (seen through the gaps: not black)
    let i = 0;
    for (let a = -h; a + P <= h + 1e-6; a += P + G, i++) {
      const j = hash(Math.round(cx * 7) + i, Math.round(cz * 7), 61);
      k.box(a, top - 0.04, -Wd, a + P, top, Wd, { mat: M.drift, tint: 0.98 + j * 0.1, grain: 'z' });
    }
    for (const sz of [-Wd - 0.03, Wd + 0.03]) {
      k.box(-h, top, sz - 1 / 32, h, top + 0.06, sz + 1 / 32, { mat: M.dark, tint: 0.85 });                           // rail
      for (const px of [-h + 0.04, h - 0.04]) k.cbox(px, sz, 0.08, 0.08, 0, top + 0.1, { mat: M.dark, tint: 0.95, bevel: T32 });
    }
  });
}

function menhir(k, x, z, ry, h, seed) {
  k.with(at(rotY(ry).multiply(rotZ((hash(seed, 1, 81) - 0.5) * 0.16)), x, 0, z), () => {
    k.box(-0.15, 0, -0.1, 0.15, h, 0.1, { mat: hash(seed, 2, 81) < 0.5 ? M.mossblock : M.rock, bevel: 2 * T32, tint: PALE });
    k.box(-0.12, h, -0.08, 0.1, h + 0.05, 0.08, { mat: M.rock, bevel: T32, tint: PALE });
  });
}

// ------------------------------------------------------------------------------------ crossings
/**
 * WHERE A TRAIL CROSSES THE STREAM, read off the real tiles: the stream meanders, runs one or two tiles
 * wide and cuts diagonally, so no width or direction is assumed. Candidates are scanned along both axes:
 *
 *  · A DRY FORD: trail tiles with water on both sides across the axis. `world/forest.js` keeps a trail
 *    dry where the stream crosses it, so this is certain wherever it occurs.
 *  · A WET CROSSING: a run of one to three water tiles along the axis, with walkable ground at both
 *    ends and the trail within five tiles of each end on that same line. Where the stream runs through
 *    a glade the trail meets it across open grass rather than at the water's edge.
 *
 * A candidate must carry water ACROSS its axis on at least one tile — the stream continuing past the
 * deck — which is what keeps a deck from ever lying along the stream (reviewer round 1, T6). Candidates
 * nearer than 2.5 tiles collapse into the best one (fords first, then the one closest to the trail).
 * Every deck runs along its axis and spans the run plus half a tile of bank at each end.
 * @returns {Array<{cx:number, cz:number, alongX:boolean, len:number}>}
 */
export function findCrossings(level, T) {
  const W = level.width, H = level.height;
  const is = (x, y, t) => level.inBounds(x, y) && T(x, y) === t;
  const walk = (x, y) => level.inBounds(x, y) && T(x, y) !== TILE.WALL && T(x, y) !== TILE.WATER;
  const cands = [];
  for (const alongX of [true, false]) {
    const [du, dv] = alongX ? [1, 0] : [0, 1];
    const [pu, pv] = alongX ? [0, 1] : [1, 0];
    const ford = (x, y) => is(x, y, TILE.CORRIDOR) && is(x + pu, y + pv, TILE.WATER) && is(x - pu, y - pv, TILE.WATER);
    // steps from (x, y) along (sx, sy) to the first trail tile over unbroken walkable ground, or Infinity
    const reach = (x, y, sx, sy) => {
      for (let i = 0; i < 5; i++) {
        const a = x + sx * i, b = y + sy * i;
        if (!walk(a, b)) return Infinity;
        if (is(a, b, TILE.CORRIDOR) && !ford(a, b)) return i;
      }
      return Infinity;
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (const kind of ['ford', 'wet']) {
      const mid = kind === 'ford' ? ford : (a, b) => is(a, b, TILE.WATER);
      if (!mid(x, y) || mid(x - du, y - dv)) continue;
      let n = 0;
      while (n < 4 && mid(x + du * n, y + dv * n)) n++;
      if (n > 3) continue;
      let across = false;
      for (let i = 0; i < n; i++) if (is(x + du * i + pu, y + dv * i + pv, TILE.WATER) || is(x + du * i - pu, y + dv * i - pv, TILE.WATER)) across = true;
      if (!across) continue;
      const bx = x - du, by = y - dv, ex = x + du * n, ey = y + dv * n;
      let score;
      if (kind === 'ford') score = -1;
      else {
        const r0 = reach(bx, by, -du, -dv), r1 = reach(ex, ey, du, dv);
        if (!Number.isFinite(r0) || !Number.isFinite(r1)) continue;
        score = r0 + r1;
      }
      cands.push({ cx: x + du * (n - 1) / 2, cz: y + dv * (n - 1) / 2, alongX, len: n + 1, score });
    }
  }
  cands.sort((a, b) => a.score - b.score || a.cz - b.cz || a.cx - b.cx);
  const out = [];
  for (const c of cands) {
    if (out.some((o) => Math.abs(o.cx - c.cx) <= 2.5 && Math.abs(o.cz - c.cz) <= 2.5)) continue;
    out.push({ cx: c.cx, cz: c.cz, alongX: c.alongX, len: c.len });
  }
  return out;
}

// ------------------------------------------------------------------------------------ assembly
const shadowMats = new Map();
/**
 * `soft` is the cast shadow: a 16-texel disc in four hard steps, so it steps with the grain instead of
 * airbrushing it. `contact` is the same disc, darker and nearly solid. `rect` is a plain hard-edged band
 * for the bridge deck's shadow on the water.
 */
function forestShadowMaterial(kind = 'soft') {
  let m = shadowMats.get(kind);
  if (m) return m;
  const S = 16, data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1, d = Math.sqrt(dx * dx + dy * dy);
    const a = kind === 'rect' ? 1 : kind === 'contact' ? (d > 1 ? 0 : d > 0.8 ? 0.55 : 1) : (d > 1 ? 0 : d > 0.85 ? 0.35 : d > 0.65 ? 0.7 : 1);
    const o = (y * S + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = 255; data[o + 3] = Math.round(a * 255);
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true;
  const opacity = kind === 'contact' ? 0.72 : kind === 'rect' ? 0.4 : 0.5;
  m = new THREE.MeshBasicMaterial({ color: kind === 'soft' ? 0x0b160c : 0x08100a, map: tex, transparent: true, opacity, depthWrite: false });
  const fog = getFog();
  if (fog) { patchFog(m, fog); m.customProgramCacheKey = () => `fogofwar-v2|forestshadow-${kind}`; }
  shadowMats.set(kind, m);
  return m;
}

/**
 * Build everything that stands in a forest level.
 * @param {import('../../world/level.js').Level} level
 * @param {(x:number, y:number) => number} tileAt the view's tile lookup (WALL outside the map)
 * @returns {THREE.Group}
 */
export function buildForestProps(level, tileAt) {
  const W = level.width, H = level.height;
  const group = new THREE.Group();
  group.name = 'forest-props';
  const T = tileAt;
  const open = (x, y) => level.inBounds(x, y) && T(x, y) !== TILE.WALL;
  const shadows = [];
  const chunks = new Map();
  const chunkOf = (x, y) => {
    const key = `${Math.floor((x + 2) / CHUNK)},${Math.floor((y + 2) / CHUNK)}`;
    let c = chunks.get(key);
    if (!c) { c = { tree: new KitBuilder({ shear: TREE_SHEAR }), solid: new KitBuilder() }; chunks.set(key, c); }
    return c;
  };
  const shadow = (x, z, rx, rz, a = 1) => shadows.push([x, z, rx, rz, a]);
  // CONTACT (reviewer round 2, T9): the soft shadow above is the cast one, offset away from the key light;
  // stone standing on grass also needs the tight dark bite right under its base that the dungeon kit has
  const contacts = [];
  // centred a little SOUTH of the base and a little wider than it: the plinth's own top covers the
  // part of the bite directly under it, and only what shows past its front edge reads as contact
  const contact = (x, z, rx, rz) => contacts.push([x + 0.02, z + 0.1, rx * 1.18, rz * 1.2]);
  const rects = [];
  const special = new Set([TILE.STAIRS_UP, TILE.STAIRS_DOWN, TILE.TEMPLE]);
  const nearSpecial = (x, y) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (level.inBounds(x + dx, y + dy) && special.has(T(x + dx, y + dy))) return true;
    return false;
  };
  // THE ARRIVAL RING (reviewer round 1, T3): the hero starts on the way in, so nothing stands on it or
  // on any of the eight tiles round it.
  const ups = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (T(x, y) === TILE.STAIRS_UP) ups.push([x, y]);
  const nearUp = (x, y) => ups.some(([ux, uy]) => Math.abs(x - ux) <= 1 && Math.abs(y - uy) <= 1);

  for (let y = -2; y < H + 2; y++) for (let x = -2; x < W + 2; x++) {
    const t = T(x, y);
    if (nearUp(x, y)) continue;
    const h1 = hash(x, y, 911), h2 = hash(x, y, 377), h3 = hash(x, y, 53);
    const c = chunkOf(x, y);
    if (t === TILE.WALL) {
      let edge = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && open(x + dx, y + dy)) edge = true;
      const openN = open(x, y - 1), openS = open(x, y + 1), openE = open(x + 1, y), openW = open(x - 1, y);
      const jx = (h2 - 0.5) * 0.3, jz = (h3 - 0.5) * 0.3;
      const clump = field(x, y, 4, 17) * 0.75 + field(x, y, 2, 19) * 0.25;
      const ruin = field(x, y, 7, 23);
      const seed = (x * 131 + y * 71) & 1023;
      if (edge) {
        // a ruin site, thinned: about three in five of its edge tiles carry masonry, the rest undergrowth
        if (ruin > 0.68 && !nearSpecial(x, y) && (openN || openS || openE || openW)) {
          const piece = hash(x, y, 1301);
          if (piece < 0.22) { ruinPillar(c.solid, x + jx * 0.5, y + jz * 0.5, seed); shadow(x + 0.1, y + 0.16, 0.4, 0.34); contact(x + jx * 0.5 + 0.02, y + jz * 0.5 + 0.04, 0.33, 0.3); continue; }
          if (piece < 0.6) { ruinWall(c.solid, x, y, openN || openS, seed); shadow(x + 0.08, y + 0.14, 0.58, 0.36); if (openN || openS) contact(x + 0.02, y + 0.04, 0.55, 0.28); else contact(x + 0.02, y + 0.04, 0.28, 0.55); continue; }
          bush(c.tree, x + jx, y + jz, 0.9 + h2 * 0.3, LEAF[(h3 * 4) | 0], seed, h2 < 0.3);
          shadow(x + jx + 0.08, y + jz + 0.12, 0.34, 0.26, 0.8);
          continue;
        }
        if (h1 < 0.5) {
          const s = 0.95 + h2 * 0.3;
          if (h3 < 0.28) conifer(c.tree, x + jx, y + jz, s * 1.05, PINE[(h2 * 3) | 0], seed);
          else broadleaf(c.tree, x + jx, y + jz, s, LEAF[(h3 * 4) | 0], seed);
          shadow(x + jx + 0.14, y + jz + 0.2, 0.5 * s, 0.38 * s);
        } else if (h1 < 0.78) {
          bush(c.tree, x + jx, y + jz, 1 + h2 * 0.3, LEAF[(h3 * 4) | 0], seed, h2 < 0.3);
          shadow(x + jx + 0.08, y + jz + 0.12, 0.34, 0.26, 0.8);
        } else if (h1 < 0.93) {
          boulder(c.solid, x + jx, y + jz, 0.9 + h2 * 0.5, seed); contact(x + jx + 0.02, y + jz + 0.04, 0.34 * (0.9 + h2 * 0.5), 0.28 * (0.9 + h2 * 0.5));
          shadow(x + jx + 0.1, y + jz + 0.14, 0.38, 0.28, 0.8);
        } else {
          stump(c.solid, x + jx, y + jz, 1, seed); contact(x + jx + 0.02, y + jz + 0.03, 0.2, 0.16);
          bush(c.tree, x - jx, y - jz - 0.2, 0.75, LEAF[(h3 * 4) | 0], seed + 5, false);
          shadow(x + jx + 0.06, y + jz + 0.1, 0.26, 0.2, 0.7);
        }
      } else if (clump > 0.44 || x < 0 || y < 0 || x >= W || y >= H) {
        const s = 1.0 + h2 * 0.35;
        if (h3 < 0.3) conifer(c.tree, x + jx, y + jz, s * 1.05, PINE[(h2 * 3) | 0], seed);
        else broadleaf(c.tree, x + jx, y + jz, s * 1.05, LEAF[(h3 * 4) | 0], seed);
        shadow(x + jx + 0.14, y + jz + 0.2, 0.52 * s, 0.4 * s);
      } else if (h1 < 0.55) {
        bush(c.tree, x + jx, y + jz, 0.9 + h2 * 0.4, LEAF[(h3 * 4) | 0], seed, h2 < 0.2);
        shadow(x + jx + 0.08, y + jz + 0.12, 0.32, 0.24, 0.7);
      } else if (h1 < 0.68) {
        boulder(c.solid, x + jx, y + jz, 0.8 + h2 * 0.4, seed); contact(x + jx + 0.02, y + jz + 0.04, 0.34 * (0.8 + h2 * 0.4), 0.28 * (0.8 + h2 * 0.4));
        shadow(x + jx + 0.1, y + jz + 0.14, 0.34, 0.26, 0.7);
      }
    } else if (t === TILE.FLOOR) {
      if (h1 < 0.28 && !nearSpecial(x, y)) flowerPatch(c.solid, x + (h2 - 0.5) * 0.3, y + (h3 - 0.5) * 0.3, (x * 17 + y * 29) & 4095);
    }
  }

  for (const b of findCrossings(level, T)) {
    const c = chunkOf(Math.round(b.cx), Math.round(b.cz));
    bridge(c.solid, b.cx, b.cz, b.alongX, b.len);
    // the deck's shadow on the water: a hard-edged band just south and east of the deck
    // CLIPPED TO THE WATER (reviewer round 3, T10): one band per water tile under the deck, held inside
    // its own tile, so no edge of the shadow lands on the bank grass
    const nW = b.len - 1, du = b.alongX ? 1 : 0, dv = b.alongX ? 0 : 1;
    for (let i = 0; i < nW; i++) {
      const tx = b.cx + du * (i - (nW - 1) / 2), tz = b.cz + dv * (i - (nW - 1) / 2);
      if (T(Math.round(tx), Math.round(tz)) !== TILE.WATER) continue;
      rects.push(b.alongX ? [tx, tz + 0.06, 0.5, 0.44] : [tx + 0.06, tz, 0.44, 0.5]);
    }
  }

  // the stairheads and the stone circle
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = T(x, y), c = chunkOf(x, y), seed = (x * 53 + y * 97) & 1023;
    if (t === TILE.STAIRS_DOWN) {
      // a broken stone kerb round the hole on three sides; the flight shows through the open fourth
      for (const [dx, dz, along] of [[0, -0.52, true], [-0.52, 0, false], [0.52, 0, false]]) {
        c.solid.with(at(rotY(along ? 0 : Math.PI / 2), x + dx, 0, y + dz), () => {
          for (let b = 0; b < 3; b++) {
            if (hash(seed + b, dx * 10 | 0, 91) < 0.2) continue;
            const hgt = 0.14 + hash(seed, b, 92) * 0.14;
            c.solid.box(-0.5 + b * 0.34, 0, -0.1, -0.5 + b * 0.34 + 0.31, hgt, 0.1, { mat: hash(seed, b, 93) < 0.4 ? M.mossblock : M.block, bevel: T32, tint: PALE });
          }
        });
      }
      shadow(x + 0.05, y + 0.08, 0.6, 0.5, 0.5);
      contact(x + 0.02, y - 0.48, 0.52, 0.14); contact(x - 0.5, y + 0.02, 0.14, 0.5); contact(x + 0.54, y + 0.02, 0.14, 0.5);
    } else if (t === TILE.STAIRS_UP) {
      // the way in: two short ruined gateposts OUTSIDE the arrival ring, on open ground only (so a post
      // never stands in a tree), set behind the flight so the hero walks out between them
      for (const sx of [-1.7, 1.7]) {
        const px = x + sx, pz = y - 1.6, tx = Math.round(px), ty = Math.round(pz);
        if (!open(tx, ty) || special.has(T(tx, ty))) continue;
        ruinPillar(c.solid, px, pz, seed + (sx > 0 ? 7 : 0), 0.75);
        shadow(px + 0.08, pz + 0.14, 0.34, 0.28, 0.6);
        contact(px + 0.02, pz + 0.04, 0.33, 0.3);
      }
    } else if (t === TILE.TEMPLE) {
      const N = 8;
      for (let i = 0; i < N; i++) {
        const a = i * Math.PI * 2 / N + 0.2;
        const px = x + Math.cos(a) * 1.5, pz = y + Math.sin(a) * 1.35;
        const tx = Math.round(px), ty = Math.round(pz);
        if (!level.inBounds(tx, ty) || T(tx, ty) === TILE.WALL || special.has(T(tx, ty)) || nearUp(tx, ty)) continue;
        if (hash(seed, i, 83) < 0.2) {
          c.solid.with(at(rotY(a).multiply(rotX(Math.PI / 2)), px, 0.1, pz), () => c.solid.box(-0.15, -0.1, 0, 0.15, 0.1, 0.7, { mat: M.mossblock, bevel: 2 * T32, tint: PALE }));
        } else menhir(c.solid, px, pz, -a, 0.7 + hash(seed, i, 84) * 0.35, seed + i);
        shadow(px + 0.1, pz + 0.14, 0.26, 0.2, 0.7);
        contact(px + 0.02, pz + 0.03, 0.2, 0.15);
      }
    }
  }

  const mats = kitPropMaterials();
  for (const c of chunks.values()) {
    for (const b of [c.tree, c.solid]) {
      if (!b.pos.length) continue;
      const mesh = new THREE.Mesh(b.build(), mats);
      mesh.castShadow = true; mesh.receiveShadow = false;
      group.add(mesh);
    }
  }
  // three flat layers on the grass: the soft cast shadows, the tight contact bites, the bridge shadows
  const layer = (list, mat, y, order) => {
    if (!list.length) return;
    const pos = new Float32Array(list.length * 12), uv = new Float32Array(list.length * 8), idx = new Uint32Array(list.length * 6);
    list.forEach(([x, z, rx, rz], i) => {
      [[x - rx, z - rz], [x + rx, z - rz], [x + rx, z + rz], [x - rx, z + rz]].forEach(([px, pz], j) => pos.set([px, y, pz], i * 12 + j * 3));
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      const o = i * 4;
      idx.set([o, o + 2, o + 1, o, o + 3, o + 2], i * 6);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = order; m.castShadow = false; m.receiveShadow = false;
    group.add(m);
  };
  layer(shadows, forestShadowMaterial(), 0.018, 4);
  layer(contacts, forestShadowMaterial('contact'), 0.02, 5);
  layer(rects, forestShadowMaterial('rect'), 0.025, 5);
  return group;
}

/**
 * The forest temple's altar: a dolmen — two mossy uprights and a capstone — with two candles and the
 * same holy haze the dungeon altar carries (DungeonView animates any child with `userData.glow`).
 * @param {THREE.Material} holyGlow the dungeon's shared haze material
 * @returns {THREE.Group}
 */
export function buildForestAltar(holyGlow) {
  const k = new KitBuilder();
  k.seed = 4242;
  k.box(-0.46, 0, -0.4, 0.46, 0.06, 0.4, { mat: M.block, bevel: T32, tint: [0.95, 0.95, 0.9] });
  for (const sx of [-1, 1]) k.box(sx * 0.3 - 0.1, 0.06, -0.16, sx * 0.3 + 0.1, 0.42, 0.14, { mat: M.mossblock, bevel: T32, tint: PALE });
  k.with(at(rotZ(0.05), 0, 0.42, 0), () => k.box(-0.44, 0, -0.22, 0.44, 0.12, 0.2, { mat: M.rock, bevel: 2 * T32, tint: PALE }));
  k.box(-0.12, 0.54, -0.18, 0.12, 0.555, 0.18, { mat: M.leaf, tint: [0.8, 1.05, 0.75] });
  const flames = [];
  for (const sx of [-0.3, 0.3]) {
    k.lathe(sx, 0.02, [[0.05, 0.54], [0.045, 0.66]], { mat: M.bone, seg: 6, capTop: true, tint: 1.08 });
    flames.push(k.place(sx, 0.66, 0.02));
  }
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(k.build(), kitPropMaterials());
  mesh.castShadow = true; mesh.receiveShadow = false;
  g.add(mesh);
  for (const p of flames) { const f = flame(0.12, 1.7, { spherical: true }); f.position.set(p[0], p[1] - 0.015, p[2]); g.add(f); }
  const halo = billboard(glowTexture(), 0xbfe6ff, 0.9, { intensity: 0.55 });
  const hp = k.place(0, 0.6, 0);
  halo.position.set(hp[0], hp[1], hp[2]);
  g.add(halo);
  if (holyGlow) {
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.4, 16, 1, true), holyGlow);
    glow.position.y = 0.8; glow.userData.glow = true;
    g.add(glow);
  }
  g.add(groundGlow(0xbfe6ff, 0.7, { opacity: 0.22, y: 0.03 }));
  return g;
}

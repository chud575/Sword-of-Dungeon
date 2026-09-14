// tiles: the floor and wall-top vocabulary, taken from the HeroQuest board.
//
// THE REFERENCE
// On the board every room is a single flat colour-and-pattern field — basketweave planks, a cracked
// polygon field, a square grid, running-bond brick, harlequin diamonds, a checkerboard — and it is
// the CHANGE of field at the doorway that tells you you have entered somewhere new. Corridors are
// one continuous pale cobble, and the wall band is chunky rounded near-white blocks. That contrast
// is what makes the board readable from directly above, which is the camera we now use.
//
// So a room does not get "stone with random wear" any more: it gets a STYLE, and every tile in that
// room is painted from it. Variants exist only so a field does not read as one tile stamped in a
// grid; they never change the room's identity.
//
// EVERYTHING IS PAINTED AT `TEXELS_PER_TILE` texels per world unit, the sprite grid, so the floor
// stays on the one pixel grid the cast and the props are on.
import { TEXELS_PER_TILE } from './materials.js';

/** How many variant cells each style gets. Four is enough to break the stamp without bloating. */
export const VARIANTS = 4;

/**
 * The board's fields. `base`/`alt` are the two tones of the field, `grout` the line between units,
 * `edge` the lit chip along a unit's top-left. `pattern` names the geometry; `wear` how beaten up.
 * Colours are read off the reference board and then held to a single value range so no room glows.
 */
export const TILE_STYLES = {
  // --- warm woods and earths
  plank:      { name: 'Plank',        pattern: 'basketweave', base: 0x7a5c3e, alt: 0x684d33, grout: 0x231910, edge: 0x98795a, wear: 0.5 },
  tanBrick:   { name: 'Tan brick',    pattern: 'brick',       base: 0x9c8e7a, alt: 0x8a7e6c, grout: 0x322b22, edge: 0xb9ab96, wear: 0.5 },
  goldBrick:  { name: 'Gold brick',   pattern: 'brick',       base: 0xa09482, alt: 0x8d8272, grout: 0x332c22, edge: 0xbcb09c, wear: 0.4 },
  goldBar:    { name: 'Gold bar',     pattern: 'bars',        base: 0x9d9180, alt: 0x8a7f70, grout: 0x322b21, edge: 0xb8ac99, wear: 0.35 },
  goldCross:  { name: 'Gold cross',   pattern: 'xcross',      base: 0x9f9483, alt: 0x8c8373, grout: 0x332d23, edge: 0xbbb09e, wear: 0.4 },
  oliveBlock: { name: 'Olive block',  pattern: 'grid',        base: 0x979274, alt: 0x827d62, grout: 0x2d2b1e, edge: 0xb4af90, wear: 0.45 },
  // --- reds
  redCrack:   { name: 'Red crack',    pattern: 'crackedPoly', base: 0xa2604c, alt: 0x8c5242, grout: 0x341812, edge: 0xbd7a64, wear: 0.8 },
  emberCrack: { name: 'Ember crack',  pattern: 'crackedPoly', base: 0x9e6a52, alt: 0x885a45, grout: 0x351c12, edge: 0xba846a, wear: 0.75 },
  redCheck:   { name: 'Red check',    pattern: 'checker',     base: 0xa37868, alt: 0x8a6053, grout: 0x351e17, edge: 0xbf9282, wear: 0.4 },
  rustSpeck:  { name: 'Rust speckle', pattern: 'speckle',     base: 0x947a6e, alt: 0x80685d, grout: 0x30211b, edge: 0xb09486, wear: 0.55 },
  // --- greens and olives
  greenCrack: { name: 'Green crack',  pattern: 'crackedPoly', base: 0x71866a, alt: 0x60755a, grout: 0x1f2a1c, edge: 0x8ea286, wear: 0.75 },
  oliveCrack: { name: 'Olive crack',  pattern: 'crackedPoly', base: 0x8a8d6e, alt: 0x77795d, grout: 0x2a2b1d, edge: 0xa6a988, wear: 0.7 },
  limeCrack:  { name: 'Lime crack',   pattern: 'crackedPoly', base: 0x959a72, alt: 0x80855f, grout: 0x2c2e1d, edge: 0xb0b48c, wear: 0.65 },
  // --- teals
  tealTile:   { name: 'Teal tile',    pattern: 'grid',        base: 0x6f8a88, alt: 0x5e7775, grout: 0x1c2828, edge: 0x8fa8a6, wear: 0.45 },
  tealDiamond:{ name: 'Teal diamond', pattern: 'diamond',     base: 0x7d9594, alt: 0x6a8180, grout: 0x1d2a2a, edge: 0x9bb1b0, wear: 0.4 },
  // --- greys and whites
  greyStone:  { name: 'Grey stone',   pattern: 'grid',        base: 0x8a8d92, alt: 0x777a80, grout: 0x232428, edge: 0xa9acb2, wear: 0.55 },
  greyBrick:  { name: 'Grey brick',   pattern: 'brick',       base: 0x96938c, alt: 0x827f79, grout: 0x2a2926, edge: 0xb3b0a9, wear: 0.5 },
  paleSpeck:  { name: 'Pale speckle', pattern: 'speckle',     base: 0xb2afa7, alt: 0x9d9a93, grout: 0x33322e, edge: 0xcdcac2, wear: 0.4 },
  paleCheck:  { name: 'Pale check',   pattern: 'checker',     base: 0xb5b2aa, alt: 0x86837c, grout: 0x31302c, edge: 0xcfccc4, wear: 0.35 },
  slabGrey:   { name: 'Grey slab',    pattern: 'bigSlab',     base: 0x857f78, alt: 0x726c66, grout: 0x25221f, edge: 0xa39d95, wear: 0.6 },
  // --- the two the board uses everywhere else
  corridor:   { name: 'Corridor',     pattern: 'cobble',      base: 0xa09a90, alt: 0x908a81, grout: 0x2a2825, edge: 0xc4beb2, wear: 0.5 },
  wallTop:    { name: 'Wall top',     pattern: 'wallBlock',   base: 0x8c877f, alt: 0x7f7a73, grout: 0x24232a, edge: 0xc9c1b2, wear: 0.4 },
};

/**
 * THE FOREST'S GROUND (world/forest.js). Painted by floorField.js `paintForest`, not four more
 * rooms in TILE_STYLES: a glade is never a keep's room, so these must never be dealt to one, never be
 * cast by a tile skin, and never crowd the flagstone atlas. Same painter, same 32 texels a tile, so the
 * ground sits on the one pixel grid with everything else.
 *
 * Ground has NO JOINTS. The four patterns below skip the grout and the bevel the stone fields are read
 * by; their tone is a soft mottle and their detail — grass tufts, moss, fallen leaves, trail grit — is
 * drawn on 8-texel lattices that divide the tile, so a tile meets its neighbour without a seam.
 */
export const FOREST_STYLES = {
  meadow: { name: 'Meadow grass', pattern: 'grass',  base: 0x6e9a45, alt: 0x5a8639, grout: 0x2a3d1c, edge: 0xa6c963, wear: 0.3 },
  moss:   { name: 'Moss bank',    pattern: 'moss',   base: 0x5c8a4c, alt: 0x4a7440, grout: 0x213421, edge: 0x8fb86a, wear: 0.25 },
  litter: { name: 'Leaf litter',  pattern: 'litter', base: 0x86703f, alt: 0x6f5b33, grout: 0x382b17, edge: 0xd2a24c, wear: 0.4 },
  trail:  { name: 'Forest trail', pattern: 'trail',  base: 0xb0936a, alt: 0x977c56, grout: 0x4a3a26, edge: 0xd4b88c, wear: 0.5 },
};

/**
 * HOW MANY QUARTER TURNS A FIELD SURVIVES — a fact about the PATTERN, not a change to any of them.
 *
 * Turning a tile is the cheapest way to stop a room reading as one cell stamped across a grid, but
 * it is only free when the pattern has the symmetry for it. `dungeon.js` used to settle this with a
 * blanket rule ("a field must not be turned; only corridor cobble and rubble keep their random
 * turn") and the reason it gave is right for exactly three of the twelve patterns: a brick course,
 * a plank run and a bar field have a DIRECTION, and a quarter turn per tile shreds the room into
 * confetti. The other nine do not — a cracked polygon field, a speckle, a cobble, a square grid, a
 * checker, a diamond have no course to break — and they were being held still for no reason.
 *
 * So the fact is stored per pattern, and every field takes the largest turn it can survive:
 *   4 — any quarter turn. The pattern is four-fold symmetric or has no direction at all.
 *   2 — half turns only. A course runs one way; 180 degrees keeps it running that way, 90 does not.
 *
 * A skin (render/tileSkins.js) inherits this through the style it is cast onto, which is why a skin
 * is required to put plank-like art on `plank` and cobble-like art on a cobble field: the rotation
 * it will be given is decided by the FIELD, not by the picture.
 */
export const PATTERN_TURNS = {
  basketweave: 2, brick: 2, bars: 2,
  cobble: 4, crackedPoly: 4, speckle: 4, grid: 4, checker: 4, diamond: 4, xcross: 4,
  bigSlab: 4, wallBlock: 4,
  // the forest's ground (FOREST_STYLES): no course and no joints, so any turn
  grass: 4, moss: 4, litter: 4, trail: 4,
};

/** Quarter turns a style's field survives (see PATTERN_TURNS). Unknown styles are held still. */
export function styleTurns(id) {
  const st = TILE_STYLES[id] || FOREST_STYLES[id];
  return (st && PATTERN_TURNS[st.pattern]) || 1;
}

/** Room styles only — corridor and wallTop are placed by the map, not chosen per room. */
export const ROOM_STYLE_IDS = Object.keys(TILE_STYLES).filter((k) => k !== 'corridor' && k !== 'wallTop');

const hexRgb = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Deterministic hash noise: the atlas must be identical for a given seed. */
function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash2(xi, yi, s), hash2(xi + 1, yi, s), u),
    lerp(hash2(xi, yi + 1, s), hash2(xi + 1, yi + 1, s), u), v);
}

/**
 * Which "unit" of the pattern a texel belongs to, and how far it is from that unit's edge.
 * Returning both lets every pattern share one shading pass: units are tinted by their id and
 * darkened toward their grout line, which is what gives the board its crisp tiled read.
 * @returns {{id:number, edge:number, grout:boolean}} edge: 0 at the grout line, 1 deep inside
 */
function unitAt(pattern, px, py, S, seed) {
  const g = 1; // grout width in texels
  const cell = (w, h, ox = 0, oy = 0) => {
    const u = Math.floor((px + ox) / w), v = Math.floor((py + oy) / h);
    const lx = (px + ox) % w, ly = (py + oy) % h;
    const d = Math.min(lx, w - 1 - lx, ly, h - 1 - ly);
    return { id: hash2(u, v, seed) * 1000 | 0, edge: Math.min(1, d / g), grout: d < g };
  };
  switch (pattern) {
    case 'grid': return cell(S / 2, S / 2);
    case 'bigSlab': return cell(S, S);
    case 'brick': {
      const h = S / 4, row = Math.floor(py / h);
      return cell(S / 2, h, (row & 1) ? S / 4 : 0);
    }
    case 'bars': return cell(S / 4, S);
    case 'basketweave': {
      // alternating 16x8 blocks laid across and along, the board's woven plank field
      const bu = Math.floor(px / (S / 2)), bv = Math.floor(py / (S / 2));
      return ((bu + bv) & 1) ? cell(S / 2, S / 4) : cell(S / 4, S / 2);
    }
    case 'checker': {
      // a checkerboard is two TONES, not just a grid: force the unit id to alternate so the shading
      // pass below lands on opposite ends of base..alt on neighbouring squares
      const n = S / 2, u = Math.floor(px / n), v = Math.floor(py / n);
      const lx = px % n, ly = py % n;
      const d = Math.min(lx, n - 1 - lx, ly, n - 1 - ly);
      return { id: ((u + v) & 1) ? 5 : 95, edge: Math.min(1, d / g), grout: d < g };
    }
    case 'xcross': {
      const c = cell(S / 2, S / 2);
      const lx = px % (S / 2), ly = py % (S / 2), n = S / 2;
      // the diagonal scores that make the board's X squares
      const onX = Math.abs(lx - ly) < 1.2 || Math.abs(lx - (n - 1 - ly)) < 1.2;
      return { id: c.id, edge: onX ? 0.15 : c.edge, grout: c.grout };
    }
    case 'diamond': {
      // harlequin: rotate into a 45-degree lattice
      const u = (px + py) / (S / 2), v = (px - py + S) / (S / 2);
      const ui = Math.floor(u), vi = Math.floor(v);
      const du = Math.min(u - ui, ui + 1 - u), dv = Math.min(v - vi, vi + 1 - v);
      const d = Math.min(du, dv) * (S / 2);
      return { id: ((ui + vi) & 1) ? 12 : 88, edge: Math.min(1, d / g), grout: d < g };
    }
    case 'cobble': {
      // The board's corridor is a neat lattice of rounded square stones with a thin dark joint —
      // not an irregular Voronoi field, which reads as gravel from above. Rounded corners come from
      // measuring the corner radius separately from the straight edges.
      const n = S / 2, r = n * 0.26;   // two stones across a tile: the board's chunky corridor
      const u = Math.floor(px / n), v = Math.floor(py / n);
      const lx = px % n, ly = py % n;
      const ex = Math.min(lx, n - 1 - lx), ey = Math.min(ly, n - 1 - ly);
      let d;
      if (ex < r && ey < r) d = r - Math.hypot(r - ex, r - ey); // inside a rounded corner
      else d = Math.min(ex, ey);
      return { id: hash2(u, v, seed) * 1000 | 0, edge: Math.min(1, Math.max(0, d / 3)), grout: d < 1.1 };
    }
    case 'wallBlock': {
      // the border's chunky rounded blocks: one big stone per tile, heavily bevelled
      const d = Math.min(px, S - 1 - px, py, S - 1 - py);
      return { id: hash2(0, 0, seed) * 1000 | 0, edge: Math.min(1, d / 3), grout: d < 1.5 };
    }
    case 'speckle': {
      // big plain slabs; the mottling comes from the noise in the shading pass, not from units
      return cell(S / 2, S / 2);
    }
    case 'crackedPoly':
    default: {
      // irregular shards: nearest of a strongly jittered lattice, so units are polygons not squares
      const n = S / 3;
      let best = 9e9, second = 9e9, bid = 0;
      const cu = Math.floor(px / n), cv = Math.floor(py / n);
      for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) {
        const u = cu + du, v = cv + dv;
        const jx = (u + 0.5 + (hash2(u, v, seed) - 0.5) * 0.95) * n;
        const jy = (v + 0.5 + (hash2(u, v, seed + 31) - 0.5) * 0.95) * n;
        const d = Math.hypot(px + 0.5 - jx, py + 0.5 - jy);
        if (d < best) { second = best; best = d; bid = hash2(u, v, seed) * 1000 | 0; }
        else if (d < second) second = d;
      }
      const rim = second - best; // 0 on the ridge between two shards
      return { id: bid, edge: Math.min(1, rim / 1.6), grout: rim < 1.1 };
    }
  }
}

export function paintTile({ alb, hgt, W, x0, y0, S = TEXELS_PER_TILE, style, seed = 0 }) {
  const base = hexRgb(style.base), alt = hexRgb(style.alt), grout = hexRgb(style.grout), edge = hexRgb(style.edge);
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const u = unitAt(style.pattern, px, py, S, seed);
    // each unit takes its own step between the field's two tones, so the field has life
    const t = (u.id % 100) / 100;
    // A checkerboard and a harlequin field are TWO TONES with real contrast between them; the
    // base..alt ramp is far too narrow for that, so those patterns get an explicit dark square.
    const duo = style.pattern === 'checker' || style.pattern === 'diamond';
    let col = duo ? (t < 0.5 ? mix3(base, grout, 0.42) : base) : mix3(base, alt, t * 0.85);
    let h = 0.55 + (duo ? (t < 0.5 ? 0 : 0.1) : t * 0.1);
    if (u.grout) { col = mix3(col, grout, 0.85); h = 0.18; }
    else {
      // lit chip along the top-left of every unit, shadow along the bottom-right: the bevel that
      // makes a flat field read as laid stones from directly overhead
      const lit = Math.max(0, 1 - u.edge * 3);
      col = mix3(col, edge, lit * 0.5);
      h += lit * 0.22;
      if (u.edge > 0.75) { col = mix3(col, grout, 0.12); h -= 0.05; }
    }
    // grain and wear: fine noise, plus scattered darker pitting proportional to the style's wear
    let gr = vnoise(px * 0.9 + seed * 13, py * 0.9 + seed * 7, seed) - 0.5;
    if (style.pattern === 'speckle') {
      // clouded stone: a second, coarser band of noise so the slab reads as mottled rather than flat
      gr = gr * 0.6 + (vnoise(px * 0.22 + seed * 5, py * 0.22 + seed * 11, seed + 41) - 0.5) * 1.5;
    }
    col = mix3(col, [col[0] + gr * 0.16, col[1] + gr * 0.16, col[2] + gr * 0.16], 1);
    const pit = vnoise(px * 0.28 + seed * 3, py * 0.28 - seed * 5, seed + 99);
    if (pit > 1 - style.wear * 0.22) { col = mix3(col, grout, 0.4); h -= 0.12; }
    const i = (y0 + py) * W + x0 + px, j = i * 3;
    alb[j] = Math.max(0, Math.min(1, col[0]));
    alb[j + 1] = Math.max(0, Math.min(1, col[1]));
    alb[j + 2] = Math.max(0, Math.min(1, col[2]));
    hgt[i] = h;
  }
}

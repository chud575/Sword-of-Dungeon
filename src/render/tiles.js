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
  plank:      { name: 'Plank',        pattern: 'basketweave', base: 0x7d5a34, alt: 0x6a4a2a, grout: 0x2a1d11, edge: 0x9a744a, wear: 0.5 },
  tanBrick:   { name: 'Tan brick',    pattern: 'brick',       base: 0xb8894e, alt: 0xa2763f, grout: 0x3a2915, edge: 0xd0a068, wear: 0.5 },
  goldBrick:  { name: 'Gold brick',   pattern: 'brick',       base: 0xc39a4e, alt: 0xab8340, grout: 0x3d2f14, edge: 0xdcb266, wear: 0.4 },
  goldBar:    { name: 'Gold bar',     pattern: 'bars',        base: 0xc9a63f, alt: 0xab8b30, grout: 0x3b2d10, edge: 0xe0bd58, wear: 0.35 },
  goldCross:  { name: 'Gold cross',   pattern: 'xcross',      base: 0xc6a541, alt: 0xa88a33, grout: 0x3a2c11, edge: 0xdfbc5a, wear: 0.4 },
  oliveBlock: { name: 'Olive block',  pattern: 'grid',        base: 0xb09a3a, alt: 0x97832f, grout: 0x332c0f, edge: 0xc9b452, wear: 0.45 },
  // --- reds
  redCrack:   { name: 'Red crack',    pattern: 'crackedPoly', base: 0xb04a33, alt: 0x933c28, grout: 0x38150e, edge: 0xc86147, wear: 0.8 },
  emberCrack: { name: 'Ember crack',  pattern: 'crackedPoly', base: 0xbf5334, alt: 0xa04328, grout: 0x3c1810, edge: 0xd76a45, wear: 0.75 },
  redCheck:   { name: 'Red check',    pattern: 'checker',     base: 0xbd6a54, alt: 0x9e5442, grout: 0x3a1c14, edge: 0xd4826a, wear: 0.4 },
  rustSpeck:  { name: 'Rust speckle', pattern: 'speckle',     base: 0xa5705c, alt: 0x8d5c4a, grout: 0x33201a, edge: 0xbb8a74, wear: 0.55 },
  // --- greens and olives
  greenCrack: { name: 'Green crack',  pattern: 'crackedPoly', base: 0x6f9a4a, alt: 0x5c8340, grout: 0x1e2c14, edge: 0x88b25f, wear: 0.75 },
  oliveCrack: { name: 'Olive crack',  pattern: 'crackedPoly', base: 0x93a044, alt: 0x7c8838, grout: 0x2b2f13, edge: 0xaab75c, wear: 0.7 },
  limeCrack:  { name: 'Lime crack',   pattern: 'crackedPoly', base: 0xa9b34c, alt: 0x8f9a3e, grout: 0x2f3315, edge: 0xc0c964, wear: 0.65 },
  // --- teals
  tealTile:   { name: 'Teal tile',    pattern: 'grid',        base: 0x5f9a94, alt: 0x4e837e, grout: 0x172e2c, edge: 0x79b3ad, wear: 0.45 },
  tealDiamond:{ name: 'Teal diamond', pattern: 'diamond',     base: 0x6fa39d, alt: 0x5b8b86, grout: 0x1a3230, edge: 0x8bbcb6, wear: 0.4 },
  // --- greys and whites
  greyStone:  { name: 'Grey stone',   pattern: 'grid',        base: 0x8f8d86, alt: 0x7a7871, grout: 0x2a2926, edge: 0xa8a69e, wear: 0.55 },
  greyBrick:  { name: 'Grey brick',   pattern: 'brick',       base: 0xa9a69c, alt: 0x918e85, grout: 0x2f2e2a, edge: 0xc0bdb2, wear: 0.5 },
  paleSpeck:  { name: 'Pale speckle', pattern: 'speckle',     base: 0xd9d6cd, alt: 0xc3bfb4, grout: 0x3c3a34, edge: 0xefece3, wear: 0.4 },
  paleCheck:  { name: 'Pale check',   pattern: 'checker',     base: 0xd2d0c8, alt: 0xa5a29a, grout: 0x383631, edge: 0xe8e6dd, wear: 0.35 },
  slabGrey:   { name: 'Grey slab',    pattern: 'bigSlab',     base: 0x8a8378, alt: 0x756f66, grout: 0x282521, edge: 0xa39c8f, wear: 0.6 },
  // --- the two the board uses everywhere else
  corridor:   { name: 'Corridor',     pattern: 'cobble',      base: 0xd8d1c2, alt: 0xb9b1a1, grout: 0x3a362e, edge: 0xefe8d8, wear: 0.5 },
  wallTop:    { name: 'Wall top',     pattern: 'wallBlock',   base: 0xe0d9c9, alt: 0xc2bbab, grout: 0x33302a, edge: 0xf5eedd, wear: 0.4 },
};

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

/**
 * Paint one 32x32 tile of a style into albedo/height buffers at (x0,y0) of a W-wide field.
 * @param {object} o buffers and placement
 */
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

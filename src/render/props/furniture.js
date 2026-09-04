// FURNITURE — the big silhouettes that say what a room is FOR.
//
// HeroQuest's dungeon is bare cardboard until you stand furniture on it: a bookcase and a lectern
// make a study, a rack and a cage make a torture chamber, a sarcophagus makes a crypt. Twelve
// pieces carried a whole game. docs/AMBIENCE.md turns that into our contract — §5.1 fixes every
// type's art box in texels, §5.5 the ship order, §9 the things decor may never do — and this file
// paints them.
//
// EVERYTHING HERE IS DRAWN WITH THE PICKUPS' OWN TOOLKIT (render/props.js: `topFace`, `frontFace`,
// `span`, `box`, `ell`, `model`, `itemPalette`, `pixelSprite`, `contactShadow`) AND NO OTHER. Not
// out of tidiness: a bookcase drawn in its own projection, on its own ramp, at its own texel size
// is a sticker from a different game standing next to the chest — which is the exact fault the
// pickups were rebuilt to fix (see props.js "ONE PROJECTION FOR EVERY PICKUP" and "ONE PIXEL GRID
// FOR THE WHOLE SCREEN"). So every piece in this file is:
//
//   · ONE SOLID OBJECT SEEN FROM ABOVE AND IN FRONT, at the same `SQUASH` the flagstones are drawn
//     at: a TOP face that carries the read (this camera is 17 degrees off vertical — you are
//     looking at the tabletop, the coffin lid, the shelf caps, the anvil's face), a FRONT face that
//     gives it height and identity, and a BASE that meets the floor with a contact shadow under it;
//   · lit by the house key light (style.js `LIT`, top-left) on every face, coloured only by
//     `ramp()`, contoured in `INK`, with no pillow shading anywhere;
//   · on the CAST'S TEXEL GRID — `pixelSprite` sizes the quad from `frameTexelSize()`, so one texel
//     of the throne is one texel of the hero standing beside it, always. Nothing in this file does
//     texel arithmetic of its own, which is precisely the drift `tests/screenTruth.test.js` fails.
//
// TWO RULES THAT ARE EASY TO BREAK AND MATTER MORE THAN THE ART:
//
//   1. FURNITURE IS NOT A PICKUP (AMBIENCE §9). It is dull, matte and still: no bob, no glints, no
//      sparkle, and only the pieces that are literally on fire carry any emission. A player who
//      walks onto a strongbox expecting loot learns to distrust every object on the screen — so the
//      decor strongbox is grey iron with no gold lock, and it is broken open from variant 1.
//   2. LOWER VARIANT = MORE INTACT (AMBIENCE §2.1). `room.decay` indexes straight into `variant`,
//      so an inverted piece makes a pristine hall out of the deepest crypt. `age()` below is the
//      single place wear is added, and it only ever takes away.
//
// FACING. A standing prop is a SCREEN-ALIGNED billboard under a camera that never rotates, so a
// table against the north wall and a table against the south wall present the same pixels — exactly
// as a cardboard HeroQuest table does, and for the same reason. `facing` is therefore recorded on
// the group (the dungeon view and the run pieces use it) but does not mirror the art: mirroring
// would put the key light on the right for half the dungeon's furniture, which is the one thing
// style.js does not allow. Variety comes from `variant`, and runs (`tableLong`) draw their two ends
// by hand rather than by flipping one of them.
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { makePix, setPx, getPx, bounds } from '../sprites/pixelPainter.js';
import { INK_DEEP } from '../sprites/style.js';
import { groundGlow } from '../propFx.js';
import {
  itemPalette, pixelSprite, contactShadow, span, box, ell, topFace, frontFace, model, step,
  shift as tone,
} from '../props.js';

// ------------------------------------------------------------------------------- the materials
// One base colour per material in the dungeon, shared by every piece that is made of it, so the
// oak of the table and the oak of the bookcase are the same oak. `ramp()` does the rest.
const RAMP = {
  oak: '#7a5230',        // furniture timber
  ash: '#8a6b45',        // pale, newer wood: bunks, crates, hafts
  bog: '#54402e',        // old dark wood, soaked and rotted
  iron: '#65605c',       // black iron: bands, bars, chains, braziers
  steel: '#94a6b4',      // blades and mail
  brass: '#c8912c',      // brass, gilt, coin
  stone: '#8b8274',      // the dungeon's own masonry
  slate: '#6e6d78',      // cold tomb stone
  cloth: '#8a2331',      // banner red
  // `ramp()` cools a shadow the SHORT way round the wheel only from BELOW style.LIGHT_HUE (0.115),
  // and the long way — up through green — from above it, exactly as the gold ramp in props.js
  // documents. Sacking at '#9a9382' is hue 0.118 and came out bottle-green in the darks and white
  // at the top: a heap of laundry, measured in the plate. Both now sit under the line.
  linen: '#9b8358',      // sacking, mattress ticking
  bone: '#c2b499',       // bone, parchment, candle wax
  glass: '#7ea6b6',      // alchemical glass
  fire: '#d2652c',       // flame and coal
  moss: '#5d7a48',       // lichen, rot, fungus
};

// The key alphabets, exactly the pickups' convention (props.js): 'abcdefg' is the object's own
// body, 'hijkl' its second material, 'mnopq' gold/brass, 'rstuv' a third, and this file adds
// 'ABCDE' (cloth/fire) and 'FGHIJ' (bone/parchment) for the two materials the pickups never needed.
const GROUPS = { a: 'abcdefg', h: 'hijkl', m: 'mnopq', r: 'rstuv', A: 'ABCDE', F: 'FGHIJ' };
const palCache = new Map();
/** Palette for a piece from its material spec, e.g. `{a: RAMP.oak, h: RAMP.iron}`. */
function palOf(key, spec) {
  let p = palCache.get(key);
  if (p) return p;
  const ramps = {};
  for (const g in GROUPS) if (spec[g]) ramps[GROUPS[g]] = spec[g];
  p = itemPalette(ramps, { '%': INK_DEEP, '*': '#f6efff', ...(spec.extra || {}) });
  palCache.set(key, p);
  return p;
}

// -------------------------------------------------------------------------------- the toolkit
// Six shapes cover every piece below. They are all built out of props.js's `span`/`topFace`/
// `frontFace`, so the light on a shelf edge and the light on a chest lid come from the same code.

/** A vertical post/leg `w` texels wide, lit down its left column and grounded darker. */
function post(p, x, y0, y1, keys, base = 3, w = 2) {
  for (let y = y0; y <= y1; y++) span(p, x, x + w - 1, y, keys, base + (y === y0 ? 1 : y >= y1 ? -1 : 0), 1);
}

/**
 * A solid rectangular body seen from above and in front: top face (foreshortened, narrowing to the
 * back), the lit nose of its front edge, the shade the nose throws, and an upright front panel.
 * Returns the rows it used so the caller can hang legs, doors and shelves off them.
 */
function boxForm(p, cx, yBack, w, d, h, keys, o = {}) {
  const lip = topFace(p, cx, yBack, w, d, keys, { base: o.topBase ?? 5, taper: o.taper ?? 0.86, grad: o.grad ?? 1 });
  const x0 = Math.round(cx - w / 2), x1 = Math.round(cx + w / 2);
  span(p, x0, x1, lip + 1, keys, 6, 1);                       // the front edge, catching the key light
  const y0 = lip + 2, y1 = lip + 1 + Math.max(1, h);
  frontFace(p, cx, y0, y1, w, keys, { base: o.frontBase ?? 4, fall: o.fall ?? 2 });
  return { lip, x0, x1, y0, y1 };
}

/** A disc lying flat (a barrel head, a well mouth, a stool seat), keyed top-left. */
function disc(p, cx, cy, rx, ry, keys, base = 5) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, d2 = dx * dx + dy * dy;
      if (d2 > 1.04) continue;
      const n = Math.round((-dx - dy) * 1.15) + (d2 > 0.72 && dx + dy > 0 ? -1 : 0);
      setPx(p, x, y, step(keys, base + n));
    }
  }
}

/** A flame: a guttering tongue narrowing upward, hottest at its heart. `keys` is the fire ramp. */
function fire(p, cx, yBase, h, keys, w = 3) {
  for (let i = 0; i < h; i++) {
    const t = i / Math.max(1, h - 1);
    const hw = Math.max(0, Math.round(w * (1 - t * t) - (i & 1 ? 0.4 : 0)));
    const y = yBase - i;
    for (let x = cx - hw; x <= cx + hw; x++) setPx(p, x, y, step(keys, 4 - Math.round(Math.abs(x - cx) * 0.9) - (t > 0.7 ? 1 : 0)));
  }
  setPx(p, cx, yBase - Math.max(1, (h * 0.35) | 0), '*');
}

/** A book spine standing on a shelf: one or two texels wide, capped with a lit top. */
function spine(p, x, y0, y1, keys, base, w = 1) {
  for (let y = y0; y <= y1; y++) span(p, x, x + w - 1, y, keys, base + (y === y0 ? 1 : 0), w > 1 ? 1 : 0);
}

/** Chain links hanging from `y0` to `y1`. */
function chain(p, x, y0, y1, keys) {
  for (let y = y0; y <= y1; y++) setPx(p, x, y, step(keys, y % 2 ? 3 : 1));
}

/**
 * WEAR, AND ONLY WEAR. The one place a variant gets older, so "higher variant = more ruined" is a
 * property of this function rather than of thirty-seven painters remembering the same rule. It
 * scuffs tones down the ramp, then bites chips out of the silhouette's edges, then (at the top
 * variant) drops the spoil on the floor beneath. It never adds, never brightens, never moves a
 * piece off its baseline, and it is seeded by type+variant so a seed reproduces the dungeon.
 */
function age(p, v, keys, seed) {
  if (v <= 0) return p;
  const b = bounds(p);
  if (!b) return p;
  const r = createRng(`furniture:${seed}:${v}`);
  for (let i = 0; i < v * 7; i++) {                       // scuffs, grime and split grain
    const x = r.int(b.x0, b.x0 + b.w - 1), y = r.int(b.y0, b.y0 + b.h - 1);
    if (getPx(p, x, y)) tone(p, x, y, keys, -1);
  }
  if (v >= 2) {                                           // chips out of the contour, never the middle
    for (let i = 0; i < v * 4; i++) {
      const x = r.int(b.x0, b.x0 + b.w - 1), y = r.int(b.y0, b.y0 + b.h - 2);
      if (!getPx(p, x, y)) continue;
      const edge = !getPx(p, x - 1, y) || !getPx(p, x + 1, y) || !getPx(p, x, y - 1);
      if (edge) setPx(p, x, y, 0);
    }
  }
  if (v >= 3) {                                           // and what fell off, lying at its foot
    const fy = b.y0 + b.h - 1;
    for (let i = 0; i < 5; i++) setPx(p, r.int(b.x0, b.x0 + b.w - 1), fy - r.int(0, 1), step(keys, r.int(0, 1)));
  }
  return p;
}

// ================================================================================== the pieces
// Art boxes are AMBIENCE §5.1, in texels, 32 to a tile. Nothing here is taller than 46 (the hero's
// own figure height): a piece that wants to look bigger asks for more texels, never for fatter ones,
// and never for a silhouette that hides the cast.

// --------------------------------------------------------------------------------- tables & seats
/** Plank table, seen from above: a big top face, an apron and four legs. The guardroom's signature. */
function artTable(v) {
  const p = makePix(32, 24), cx = 15, W = 'abcdefg';
  const lip = topFace(p, cx, 1, 27, 15, W, { base: 5, taper: 0.9 });
  for (let x = 7; x <= 24; x += 6) for (let y = 2; y <= lip; y++) tone(p, x, y, W, -1);   // plank seams
  span(p, 2, 29, lip + 1, W, 6, 1);
  span(p, 2, 29, lip + 2, W, 2, 0);
  for (let y = lip + 3; y <= lip + 4; y++) span(p, 3, 28, y, W, 3, 1);                    // the apron
  for (const x of [4, 25]) post(p, x, lip + 5, lip + 11, W, 3, 3);
  if (v >= 1) { for (const [x, y] of [[9, 4], [19, 6], [13, 3]]) tone(p, x, y, W, -2); }  // knots
  if (v >= 2) { box(p, 24, 2, 29, 4, 0); setPx(p, 23, 5, step(W, 1)); }                   // corner gone
  if (v >= 3) { box(p, 25, lip + 5, 27, lip + 11, 0); span(p, 22, 29, lip + 4, W, 1, 0); } // leg broken
  return age(p, v, W, 'table');
}

/** The refectory's long table, as a RUN: v0 the left end, v1 the middle, v2 the right end. */
function artTableLong(v) {
  const p = makePix(32, 24), W = 'abcdefg';
  const end0 = v === 0, end1 = v === 2;
  const x0 = end0 ? 2 : 0, x1 = end1 ? 29 : 31;
  const lip = 8;
  for (let i = 0; i <= lip - 1; i++) {                                                   // the top, unbroken
    const inset = Math.round((1 - i / (lip - 1)) * 1.6);
    span(p, x0 + (end0 ? inset : 0), x1 - (end1 ? inset : 0), 1 + i, W, 5 - (i === lip - 1 ? 1 : 0), 1);
  }
  for (let x = x0 + 4; x <= x1 - 3; x += 6) for (let y = 2; y <= lip; y++) tone(p, x, y, W, -1);
  span(p, x0, x1, lip + 1, W, 6, 1);
  span(p, x0, x1, lip + 2, W, 2, 0);
  for (let y = lip + 3; y <= lip + 4; y++) span(p, x0 + 1, x1 - 1, y, W, 3, 1);
  if (end0) post(p, x0 + 2, lip + 5, lip + 11, W, 3, 3);
  if (end1) post(p, x1 - 4, lip + 5, lip + 11, W, 3, 3);
  if (!end0 && !end1) post(p, 14, lip + 5, lip + 11, W, 3, 3);
  return age(p, Math.min(2, v), W, 'tableLong');
}

/** Plank bench: a seat and two trestle feet. */
function artBench(v) {
  const p = makePix(28, 14), cx = 13, W = 'abcdefg';
  const f = boxForm(p, cx, 1, 24, 8, 1, W, { taper: 0.92 });
  for (const x of [f.x0 + 2, f.x1 - 4]) post(p, x, f.y1 + 1, f.y1 + 5, W, 3, 3);
  if (v >= 1) span(p, f.x0 + 5, f.x1 - 5, f.lip - 1, W, 3, 0);
  return age(p, v, W, 'bench');
}

/** Three-legged stool: a small round seat and three legs you can actually count. */
function artStool(v) {
  const p = makePix(14, 18), cx = 6, W = 'abcdefg';
  disc(p, cx, 4, 5.4, 2.8, W, 5);
  span(p, 1, 11, 6, W, 3, 1); span(p, 1, 11, 7, W, 1, 0);                                         // the seat's edge
  for (const [x, d] of [[1, -1], [10, 1], [5, 0]]) {
    for (let y = 8; y <= 15; y++) span(p, x + Math.round((y - 8) * 0.22) * d, x + 1 + Math.round((y - 8) * 0.22) * d, y, W, y > 13 ? 1 : 3, 1);
  }
  span(p, 1, 3, 16, W, 0, 0); span(p, 10, 12, 16, W, 0, 0);
  return age(p, v, W, 'stool');
}

/** The lectern: a slanted desk on a turned post, an open book laid on the slope. */
function artLectern(v) {
  const p = makePix(18, 32), cx = 8, W = 'abcdefg', B = 'FGHIJ';
  for (let i = 0; i < 7; i++) span(p, 1 + i, 16 - i, 2 + i, W, 5 - (i > 4 ? 1 : 0), 1);   // the slope
  span(p, 1, 16, 9, W, 6, 1); span(p, 2, 15, 10, W, 2, 0);
  if (v < 2) {                                                                            // the open book
    for (let i = 0; i < 5; i++) span(p, 3 + i, 14 - i, 3 + i, B, 4 - (i > 2 ? 1 : 0), 1);
    for (let y = 4; y <= 7; y++) setPx(p, 8, y, step(B, 1));
    for (const [x, y] of [[5, 5], [11, 5], [5, 7], [11, 7]]) setPx(p, x, y, step(B, 2));
  }
  post(p, 7, 11, 25, W, 3, 3);
  disc(p, cx, 27, 6, 3, W, 3);
  span(p, 2, 14, 29, W, 1, 0);
  return age(p, v, W, 'lectern');
}

// ------------------------------------------------------------------------------ shelves & presses
/** Bookcase: a top cap, three loaded shelves, spines and gaps. The scriptorium's signature. */
function artBookcase(v) {
  const p = makePix(28, 48), cx = 13, W = 'abcdefg', B = 'FGHIJ', C = 'ABCDE', G = 'mnopq';
  const cap = topFace(p, cx, 1, 24, 8, W, { base: 5, taper: 0.9 });
  span(p, 1, 25, cap + 1, W, 6, 1);
  for (let y = cap + 2; y <= 45; y++) span(p, 1, 25, y, W, 3 - (y > 43 ? 1 : 0), 1);      // the carcass
  const r = createRng('furniture:bookcase');
  const shelves = [cap + 11, cap + 22, cap + 33];
  for (const sy of shelves) {
    box(p, 3, sy - 9, 23, sy, '%');                                                       // the shelf void
    if (v >= 3) continue;
    let x = 3;
    while (x <= 22) {
      const w = r.int(1, 2), h = r.int(6, 9);
      if (r.chance(0.18 + v * 0.22)) { x += w + 1; continue; }                             // a gap on the shelf
      const kind = r.int(0, 2);
      spine(p, x, sy - h, sy - 1, kind === 0 ? C : kind === 1 ? B : W, kind === 2 ? 4 : 3, w);
      if (w > 1 && r.chance(0.35)) setPx(p, x, sy - h + 2, step(G, 3));                    // a gilt band
      x += w + 1;
    }
    span(p, 3, 23, sy, W, 5, 1);                                                          // the shelf board
    span(p, 3, 23, sy + 1, W, 1, 0);
  }
  if (v >= 2) { box(p, 3, shelves[2] - 9, 23, shelves[2], '%'); span(p, 2, 24, shelves[2], W, 1, 0); }
  return age(p, v, W, 'bookcase');
}

/** Cupboard: a closed press with a cornice, a plinth, black iron hinges and a pair of handles. */
function artCupboard(v) {
  const p = makePix(24, 42), cx = 11, W = 'abcdefg', I = 'hijkl';
  const cap = topFace(p, cx, 1, 21, 8, W, { base: 5, taper: 0.9 });
  span(p, 0, 23, cap + 1, W, 6, 1); span(p, 0, 23, cap + 2, W, 2, 0);                             // the cornice
  for (let y = cap + 3; y <= 36; y++) span(p, 1, 22, y, W, 4 - (y > 34 ? 2 : 0), 1);
  for (let y = cap + 4; y <= 35; y++) setPx(p, 11, y, step(W, 1));                                // the meeting stile
  for (const [x0, x1] of [[3, 9], [13, 20]]) {                                                    // the door panels
    for (let y = cap + 6; y <= 32; y++) { setPx(p, x0, y, step(W, 5)); setPx(p, x1, y, step(W, 2)); }
    span(p, x0, x1, cap + 6, W, 5, 0); span(p, x0, x1, 32, W, 2, 0);
  }
  for (const y of [cap + 5, 34]) { span(p, 1, 5, y, I, 3, 1); span(p, 17, 22, y, I, 3, 1); }       // strap hinges
  for (const y of [cap + 5, 34]) { setPx(p, 1, y + 1, step(I, 1)); setPx(p, 22, y + 1, step(I, 1)); }
  for (let y = 21; y <= 24; y++) { setPx(p, 10, y, step(I, 3)); setPx(p, 12, y, step(I, 2)); }     // the handles
  const pl = topFace(p, cx, 37, 23, 4, W, { base: 4, taper: 0.96 });                              // the plinth
  span(p, 0, 23, pl + 1, W, 1, 0);
  if (v >= 1) {                                                                                    // the left door, ajar
    box(p, 2, cap + 3, 10, 35, '%');
    for (let y = cap + 3; y <= 35; y++) span(p, 2, 4, y, W, 5, 1);
    for (const [x, y] of [[6, 18], [8, 25], [7, 30]]) { span(p, x - 2, x + 1, y, 'FGHIJ', 3, 1); setPx(p, x - 2, y + 1, step('FGHIJ', 1)); }
  }
  if (v >= 2) box(p, 13, cap + 3, 20, 20, '%');
  return age(p, v, W, 'cupboard');
}

/** Weapon rack: a base beam, uprights and a rail with spears and blades standing in it. */
function artWeaponRack(v) {
  const p = makePix(28, 44), W = 'abcdefg', S = 'hijkl', H = 'rstuv';
  const r = createRng('furniture:weaponRack');
  const kept = [true, true, true, true, true].map((_, i) => v < 1 || !((i + v) % (5 - v) === 0));
  for (let i = 0; i < 5; i++) {
    if (!kept[i]) continue;
    const x = 4 + i * 5, top = 6 + ((i * 7) % 5);
    for (let y = top + 4; y <= 34; y++) span(p, x, x + 1, y, H, 3, 1);                    // the haft
    if (i % 2 === 0) {                                                                     // a spear head
      for (let k = 0; k < 5; k++) span(p, x - Math.min(1, k), x + 1 + Math.min(1, k), top + k, S, 4 - (k > 2 ? 1 : 0), 1);
    } else {                                                                               // a blade, edge up
      for (let y = top; y <= top + 8; y++) span(p, x - 1, x + 2, y, S, 4, 2);
      span(p, x - 2, x + 3, top + 9, S, 2, 0);
    }
    if (r.chance(0.4)) setPx(p, x, top + 10, step('mnopq', 3));
  }
  span(p, 1, 26, 12, W, 5, 1); span(p, 1, 26, 13, W, 2, 0);                                // the upper rail
  post(p, 1, 12, 38, W, 3, 3); post(p, 24, 12, 38, W, 2, 3);
  boxForm(p, 13, 34, 26, 8, 2, W, { taper: 0.92 });                                        // the base beam
  return age(p, v, W, 'weaponRack');
}

/** Shield stand: an A-frame with two shields hung on it, boss out. */
function artShieldStand(v) {
  const p = makePix(24, 34), W = 'abcdefg', C = 'ABCDE', S = 'hijkl', G = 'mnopq';
  post(p, 2, 4, 30, W, 3, 2); post(p, 19, 4, 30, W, 2, 2);
  span(p, 2, 20, 5, W, 5, 1); span(p, 2, 20, 22, W, 4, 1);
  const shields = v >= 2 ? [[7, 12]] : [[7, 12], [15, 20]];
  for (const [cx, cy] of shields) {
    ell(p, cx, cy, 6, 7, step(C, 3));
    for (let y = cy - 7; y <= cy + 7; y++) for (let x = cx - 6; x <= cx + 6; x++) {
      const dx = (x - cx) / 6, dy = (y - cy) / 7, d2 = dx * dx + dy * dy;
      if (d2 > 1.04) continue;
      setPx(p, x, y, step(C, 3 + Math.round((-dx - dy) * 1.2) - (d2 > 0.8 ? 1 : 0)));
    }
    ell(p, cx, cy, 2, 2.2, step(S, 3)); setPx(p, cx - 1, cy - 1, step(S, 4));              // the boss
    for (let k = -6; k <= 6; k += 3) setPx(p, cx + k, cy - Math.round(Math.abs(k) * 0.4) - 6, step(G, 2));
  }
  span(p, 1, 21, 31, W, 1, 0);
  return age(p, v, W, 'shieldStand');
}

/**
 * Armour stand: a hauberk and a helm hung on a wooden cross frame. The cross bar is drawn PROUD of
 * the mail on both sides on purpose — a mail body on a pole with no visible frame reads as a figure
 * standing in the room, and nothing in the decor may be mistaken for the cast (AMBIENCE §9).
 */
function artArmourStand(v) {
  const p = makePix(22, 42), cx = 10, W = 'abcdefg', S = 'hijkl';
  post(p, 9, 6, 34, W, 3, 3);
  span(p, 0, 20, 12, W, 5, 1); span(p, 0, 20, 13, W, 2, 0);                                       // the cross bar, proud
  setPx(p, 0, 11, step(W, 4)); setPx(p, 20, 14, step(W, 1));
  if (v < 2) {
    disc(p, cx, 4, 4.4, 3.6, S, 3);                                                               // the helm
    span(p, cx - 3, cx + 3, 5, S, 0, 0); setPx(p, cx - 3, 3, step(S, 4));
    for (let y = 14; y <= 29; y++) {                                                              // the hauberk
      const hw = y < 17 ? 6 : y < 25 ? 5 : 4;
      for (let x = cx - hw; x <= cx + hw; x++) setPx(p, x, y, step(S, 3 + ((x + y) & 1 ? 0 : -1) + (x < cx - 2 ? 1 : x > cx + 2 ? -1 : 0)));
    }
    span(p, cx - 4, cx + 4, 30, S, 0, 0);
  }
  disc(p, cx, 36, 7, 3.2, W, 3);
  span(p, 3, 17, 38, W, 1, 0);
  return age(p, v, W, 'armourStand');
}

// -------------------------------------------------------------------------------- the great seat
/** The throne: a high carved back, arms, a cushion and a step. One per level, and it must look it. */
function artThrone(v) {
  const p = makePix(26, 46), cx = 12, W = 'rstuv', C = 'ABCDE', G = 'mnopq';
  for (let y = 6; y <= 30; y++) span(p, 3, 21, y, W, 4 - (y > 27 ? 1 : 0), 1);             // the back slab
  for (let i = 0; i < 5; i++) span(p, 4 + i, 20 - i, 2 + i, W, 5, 1);                      // its gable
  box(p, 6, 9, 18, 25, step(C, 3));                                                        // the cloth panel
  for (let y = 9; y <= 25; y++) span(p, 6, 18, y, C, 3 + (y < 12 ? 1 : y > 22 ? -1 : 0), 1);
  for (const [x, y] of [[12, 13], [12, 14], [12, 15], [10, 15], [14, 15], [11, 17], [13, 17], [12, 18]]) setPx(p, x, y, step(G, 3));
  for (const y of [9, 25]) span(p, 6, 18, y, G, 2, 0);                                     // gilt bands
  post(p, 1, 22, 38, W, 4, 3); post(p, 21, 22, 38, W, 2, 3);                               // the arms
  span(p, 1, 23, 22, W, 5, 1);
  const seat = topFace(p, cx, 30, 18, 10, C, { base: 4, taper: 0.86 });                    // the cushion
  span(p, 3, 21, seat + 1, C, 5, 1); span(p, 3, 21, seat + 2, C, 1, 0);
  for (let y = seat + 3; y <= 40; y++) span(p, 3, 21, y, W, 3 - (y > 38 ? 1 : 0), 1);
  const st = topFace(p, cx, 41, 24, 5, W, { base: 4, taper: 0.94 });                        // the step
  span(p, 0, 24, st + 1, W, 1, 0);
  return age(p, v, W, 'throne');
}

// ------------------------------------------------------------------------------------ the crypt
/** Sarcophagus: a tapered stone coffin, a carved lid — slid further off at every variant. */
function artSarcophagus(v) {
  const p = makePix(36, 22), cx = 15, S = 'rstuv', B = 'FGHIJ';
  const off = v === 0 ? 0 : v === 1 ? 0 : v === 2 ? 3 : 5;
  if (v >= 2) {                                                                            // the open box under it
    box(p, 3, 3, 28, 12, '%');
    span(p, 2, 29, 2, S, 3, 1);
    for (const [x, y] of [[10, 7], [13, 6], [16, 8], [19, 7], [12, 9]]) setPx(p, x, y, step(B, 2 + (x % 2)));
    if (v >= 3) { ell(p, 9, 7, 2.4, 1.6, step(B, 3)); setPx(p, 8, 6, step(B, 4)); setPx(p, 10, 8, '%'); }
  }
  const lid = topFace(p, cx + off, 1, 26, 13, S, { base: 5, taper: 0.78 });                 // the lid
  if (v < 3) {
    for (let i = 0; i < 4; i++) setPx(p, cx + off, 3 + i, step(S, 3));                      // the carved figure
    for (const dx of [-2, 2]) for (let i = 0; i < 3; i++) setPx(p, cx + off + dx, 4 + i, step(S, 3));
    setPx(p, cx + off - 1, 3, step(S, 6));
  }
  span(p, 2 + off, 28 + off, lid + 1, S, 6, 1);
  span(p, 2 + off, 28 + off, lid + 2, S, 2, 0);
  for (let y = lid + 3; y <= 18; y++) span(p, 3 + off, 27 + off, y, S, 4 - (y > 16 ? 2 : 0), 1);
  for (const x of [8, 22]) for (let y = lid + 3; y <= 17; y++) setPx(p, x + off, y, step(S, 2)); // panel cuts
  span(p, 2 + off, 28 + off, 19, S, 1, 0);
  return age(p, v, S, 'sarcophagus');
}

/** Tomb slab: a low grave stone laid in the floor, its inscription worn away. */
function artTombSlab(v) {
  const p = makePix(32, 16), cx = 15, S = 'rstuv';
  const lid = topFace(p, cx, 1, 28, 14, S, { base: 5, taper: 0.84 });
  const r = createRng('furniture:tombSlab');
  for (let y = 3; y <= lid - 1; y += 2) for (let x = 5; x <= 25; x++) if (r.chance(0.55 - v * 0.14)) setPx(p, x, y, step(S, 2));
  span(p, 2, 29, lid + 1, S, 6, 1);
  span(p, 2, 29, lid + 2, S, 3, 1);
  span(p, 3, 28, lid + 3, S, 1, 0);
  if (v >= 2) { for (let y = 2; y <= lid + 2; y++) setPx(p, 18 + ((y * 3) % 3), y, '%'); }  // split in two
  return age(p, v, S, 'tombSlab');
}

/** Ash urn: a bellied jar with a lid. v2 is cracked and spilling. */
function artUrn(v) {
  const p = makePix(16, 22), cx = 7, S = 'rstuv';
  ell(p, cx, 13, 6, 6, step(S, 3));
  box(p, 5, 5, 9, 9, step(S, 3));
  let q = model(p, S, { dome: 0.16 });
  disc(q, cx, 4, 5, 2.2, S, 5);                                                             // the lid
  span(q, 3, 11, 6, S, 2, 0);
  if (v >= 2) { for (const [x, y] of [[10, 11], [11, 13], [10, 15], [11, 16]]) setPx(q, x, y, '%'); }
  span(q, 3, 11, 19, S, 1, 0);
  return age(q, v, S, 'urn');
}

/** Bone pile: a ribcage, long bones and a skull, heaped where something was eaten. */
function artBonePile(v) {
  const p = makePix(24, 14), B = 'FGHIJ';
  const r = createRng('furniture:bonePile');
  for (let i = 0; i < 5 + v; i++) {                                                               // long bones, two texels thick
    const x = r.int(3, 15), y = r.int(5, 10), len = r.int(5, 8), horiz = r.chance(0.72);
    for (let k = 0; k < len; k++) {
      const bx = x + (horiz ? k : 0), by = y + (horiz ? 0 : k);
      setPx(p, bx, by, step(B, 3));
      setPx(p, bx + (horiz ? 0 : 1), by + (horiz ? 1 : 0), step(B, 1));
    }
    for (const [ex, ey] of [[x, y], [x + (horiz ? len - 1 : 0), y + (horiz ? 0 : len - 1)]]) {     // the knuckle ends
      ell(p, ex, ey, 1.4, 1.4, step(B, 4));
      setPx(p, ex + 1, ey + 1, step(B, 1));
    }
  }
  for (let i = 0; i < 4; i++) { const y = 6 + i; span(p, 15, 21, y, B, 3, 1); setPx(p, 18, y, step(B, 1)); }  // the ribs
  ell(p, 6, 8, 3.2, 2.6, step(B, 3));                                                             // the skull
  span(p, 4, 8, 6, B, 4, 1);
  setPx(p, 5, 8, '%'); setPx(p, 7, 8, '%'); setPx(p, 6, 10, step(B, 1));
  span(p, 3, 20, 12, B, 1, 0);
  return age(p, Math.min(1, v), B, 'bonePile');
}

// ---------------------------------------------------------------------------------- the workshop
/** Alchemist's bench: a bench of glass and copper — retort, flasks, a burner and a ledger. */
function artAlchemyBench(v) {
  const p = makePix(32, 28), cx = 15, W = 'abcdefg', G = 'ABCDE', S = 'hijkl', F = 'FGHIJ';
  if (v < 2) {                                                                              // the glassware
    ell(p, 8, 6, 3.4, 3, step(G, 3)); setPx(p, 7, 5, step(G, 4)); setPx(p, 6, 5, '*');
    box(p, 7, 1, 9, 4, step(G, 2)); setPx(p, 7, 1, step(G, 4));
    ell(p, 8, 7, 2.2, 1.6, step(G, 1));
    box(p, 18, 2, 20, 8, step(G, 3)); setPx(p, 18, 2, step(G, 4));                          // a phial
    box(p, 18, 5, 20, 8, step(G, 1));
    ell(p, 24, 6, 2.6, 3, step(G, 2)); setPx(p, 23, 4, step(G, 4));
  }
  if (v < 1) { for (let y = 8; y <= 9; y++) span(p, 6, 10, y, S, 2, 1); fire(p, 8, 9, 3, 'ABCDE', 2); }
  const f = boxForm(p, cx, 10, 28, 12, 5, W, { taper: 0.9 });
  for (let x = 5; x <= 26; x += 7) for (let y = 11; y <= f.lip; y++) tone(p, x, y, W, -1);
  for (const x of [8, 22]) { span(p, x - 3, x + 3, f.y0 + 1, W, 5, 1); setPx(p, x, f.y0 + 2, step(S, 3)); } // drawers
  for (const x of [3, 25]) post(p, x, f.y1 + 1, f.y1 + 4, W, 3, 3);
  if (v < 2) { box(p, 12, f.lip - 3, 18, f.lip, step(F, 3)); span(p, 12, 18, f.lip - 3, F, 4, 1); } // the ledger
  return age(p, v, W, 'alchemyBench');
}

/** Retort stand: a glass retort on an iron ring over a burner. */
function artRetortStand(v) {
  const p = makePix(18, 30), S = 'hijkl', G = 'ABCDE';
  post(p, 2, 4, 24, S, 3, 2);
  span(p, 2, 14, 12, S, 3, 1);
  if (v < 1) {
    ell(p, 9, 9, 4, 3.6, step(G, 3));
    for (let y = 6; y <= 12; y++) for (let x = 5; x <= 13; x++) {
      const dx = (x - 9) / 4, dy = (y - 9) / 3.6;
      if (dx * dx + dy * dy > 1.04) continue;
      setPx(p, x, y, step(G, 3 + Math.round((-dx - dy) * 1.1)));
    }
    setPx(p, 7, 7, '*');
    for (let x = 12; x <= 16; x++) setPx(p, x, 6 - (x - 12), step(G, 2));                    // the neck
    ell(p, 9, 11, 3, 1.4, step(G, 1));
  }
  span(p, 4, 14, 18, S, 2, 1); fire(p, 9, 17, v < 2 ? 3 : 1, 'ABCDE', 2);
  disc(p, 8, 25, 7, 3, S, 3);
  span(p, 2, 14, 26, S, 1, 0);
  return age(p, v, S, 'retortStand');
}

/** Brass balance: a beam on a pillar with two pans. */
function artScales(v) {
  const p = makePix(16, 20), G = 'mnopq', S = 'hijkl';
  post(p, 7, 4, 15, G, 3, 2);
  span(p, 1, 14, 5 + (v >= 1 ? 1 : 0), G, 4, 1);
  for (const [x, dy] of [[2, v >= 1 ? 2 : 0], [12, 0]]) {
    for (let y = 6 + dy; y <= 8 + dy; y++) setPx(p, x, y, step(S, 2));
    disc(p, x, 10 + dy, 3, 1.5, G, 3);
  }
  disc(p, 7, 17, 6, 2.6, G, 3);
  span(p, 2, 12, 18, G, 1, 0);
  return age(p, v, G, 'scales');
}

/** Iron cauldron on a tripod, its brew catching the light. */
function artCauldron(v) {
  const p = makePix(22, 24), cx = 10, I = 'hijkl';
  ell(p, cx, 11, 9, 7, step(I, 3));
  let q = model(p, I, { dome: 0.16, up: 0.75 });
  disc(q, cx, 6, 8, 3.4, I, 2);
  ell(q, cx, 6, 6.4, 2.4, '%');
  if (v < 1) { ell(q, cx, 6, 5.4, 2, step('ABCDE', 2)); setPx(q, cx - 2, 5, step('ABCDE', 3)); }
  for (const x of [2, 17]) { setPx(q, x, 8, step(I, 4)); setPx(q, x, 9, step(I, 2)); }        // the lugs
  for (const [x, d] of [[3, -1], [10, 0], [16, 1]]) for (let y = 17; y <= 21; y++) setPx(q, x + Math.round((y - 17) * 0.4) * d, y, step(I, y > 19 ? 1 : 3));
  span(q, 2, 18, 22, I, 1, 0);
  return age(q, v, I, 'cauldron');
}

/**
 * Blacksmith's forge: a stone hearth block with an IRON HOOD over it and a bed of live coals. The
 * first pass drew the hood as four dark rows and the plate came back with a pale table on fire; a
 * forge is read by its chimney, so the hood is now the tallest thing in the silhouette.
 */
function artForge(v) {
  const p = makePix(32, 38), cx = 15, S = 'rstuv', I = 'hijkl';
  for (let y = 0; y <= 9; y++) {                                                                  // the hood, flaring down
    const hw = Math.round(4 + y * 1.05);
    span(p, cx - hw, cx + hw, y, I, 3 - (y > 6 ? 1 : 0), 1);
  }
  span(p, 1, 29, 10, I, 4, 1); span(p, 1, 29, 11, I, 1, 0);                                       // its lip
  for (const x of [2, 28]) post(p, x, 12, 17, I, 2, 2);                                           // the hood's legs
  const bed = topFace(p, cx, 14, 28, 11, S, { base: 3, taper: 0.9 });
  box(p, 6, 15, 24, bed, '%');
  const r = createRng('furniture:forge');
  for (let y = 15; y <= bed; y++) for (let x = 6; x <= 24; x++) if (r.chance(0.6)) setPx(p, x, y, step('ABCDE', v >= 1 ? r.int(0, 1) : r.int(1, 4)));
  if (v < 1) { fire(p, 15, 16, 4, 'ABCDE', 3); setPx(p, 12, 16, '*'); }
  span(p, 2, 29, bed + 1, S, 6, 1); span(p, 2, 29, bed + 2, S, 2, 0);
  for (let y = bed + 3; y <= 34; y++) span(p, 3, 28, y, S, 3 - (y > 32 ? 1 : 0), 1);
  for (let y = bed + 4; y <= 33; y += 4) for (let x = 5 + ((y & 3) ? 0 : 4); x <= 26; x += 8) setPx(p, x, y, step(S, 1));
  span(p, 2, 29, 35, S, 1, 0);
  return age(p, v, S, 'forge');
}

/** Anvil on its stump: the one silhouette in the dungeon nobody can mistake. */
function artAnvil(v) {
  const p = makePix(20, 20), I = 'hijkl', W = 'abcdefg';
  span(p, 2, 16, 2, I, 4, 1);                                                                // the face
  span(p, 1, 17, 3, I, 3, 1);
  span(p, 2, 15, 4, I, 2, 1);
  for (let k = 0; k < 3; k++) setPx(p, 17 + k, 3 - (k > 1 ? 1 : 0), step(I, 3));              // the horn
  for (let y = 5; y <= 8; y++) span(p, 6, 12, y, I, 2, 1);                                    // the waist
  span(p, 3, 15, 9, I, 3, 1); span(p, 3, 15, 10, I, 1, 0);
  disc(p, 9, 13, 8, 3, W, 4);                                                                 // the stump
  for (let y = 14; y <= 17; y++) span(p, 2, 16, y, W, 3 - (y > 16 ? 1 : 0), 1);
  span(p, 2, 16, 18, W, 1, 0);
  return age(p, v, I, 'anvil');
}

// --------------------------------------------------------------------------------- fire and water
/** Brazier: an iron bowl on three legs. v0 burns, v3 is cold and tipped over. */
function artBrazier(v) {
  const p = makePix(20, 32), cx = 9, I = 'hijkl', F = 'ABCDE';
  const tip = v >= 3 ? 3 : 0;
  disc(p, cx - tip, 9, 8, 3.6, I, 3);
  ell(p, cx - tip, 9, 6.6, 2.6, '%');
  const r = createRng('furniture:brazier');
  for (let y = 7; y <= 11; y++) for (let x = cx - tip - 6; x <= cx - tip + 6; x++) {
    const dx = (x - cx + tip) / 6.6, dy = (y - 9) / 2.6;
    if (dx * dx + dy * dy > 1) continue;
    if (r.chance(0.7)) setPx(p, x, y, step(F, v >= 2 ? r.int(0, 1) : r.int(2, 4)));
  }
  if (v === 0) fire(p, cx, 8, 7, F, 4);
  else if (v === 1) fire(p, cx, 8, 3, F, 2);
  for (let y = 10; y <= 13; y++) span(p, cx - tip - 8, cx - tip + 8, y, I, 3 - (y > 12 ? 1 : 0), 1);
  if (v < 3) {
    for (const [x, d] of [[2, -1], [9, 0], [15, 1]]) for (let y = 14; y <= 27; y++) setPx(p, x + Math.round((y - 14) * 0.28) * d, y, step(I, y > 24 ? 1 : 3));
    span(p, 1, 17, 28, I, 1, 0);
  } else {
    for (let k = 0; k < 12; k++) setPx(p, 8 + k, 14 + (k >> 2), step(I, 2));
    span(p, 2, 19, 17, I, 1, 0);
  }
  return age(p, v, I, 'brazier');
}

/** Hearth: a stone fireplace with a mantel, standing against a wall and looking into the room. */
function artHearth(v) {
  const p = makePix(34, 42), cx = 16, S = 'rstuv', F = 'ABCDE';
  const man = topFace(p, cx, 1, 30, 10, S, { base: 5, taper: 0.94 });                          // the mantel
  span(p, 1, 31, man + 1, S, 6, 1); span(p, 1, 31, man + 2, S, 2, 0);
  for (let y = man + 3; y <= 38; y++) span(p, 1, 31, y, S, 4 - (y > 36 ? 2 : 0), 1);
  const mouthTop = man + 8;
  box(p, 7, mouthTop, 25, 36, '%');                                                            // the fire mouth
  for (let i = 0; i < 4; i++) { setPx(p, 7 + i, mouthTop - 1 - (3 - i), '%'); setPx(p, 25 - i, mouthTop - 1 - (3 - i), '%'); }
  const r = createRng('furniture:hearth');
  for (let y = 31; y <= 36; y++) for (let x = 8; x <= 24; x++) if (r.chance(0.6)) setPx(p, x, y, step(F, v >= 2 ? r.int(0, 1) : r.int(1, 3)));
  if (v === 0) { fire(p, 16, 34, 9, F, 5); fire(p, 12, 34, 5, F, 2); fire(p, 20, 34, 5, F, 2); }
  else if (v === 1) fire(p, 16, 34, 4, F, 3);
  for (let y = man + 4; y <= 37; y += 5) for (let x = 2 + ((y & 1) ? 0 : 4); x <= 30; x += 8) setPx(p, x, y, step(S, 2)); // coursing
  span(p, 1, 31, 39, S, 1, 0);
  return age(p, v, S, 'hearth');
}

/** Candelabra: a standing branch of three candles, tall enough that the wax reads before the brass. */
function artCandelabra(v) {
  const p = makePix(16, 32), cx = 7, G = 'mnopq', B = 'FGHIJ', F = 'ABCDE';
  post(p, 6, 16, 25, G, 3, 3);
  span(p, 1, 14, 15, G, 4, 1); span(p, 1, 14, 16, G, 1, 0);                                       // the cross branch
  for (const [x, h] of [[1, 6], [7, 9], [13, 6]]) {
    const top = 15 - h;
    for (let y = top; y <= 15; y++) span(p, x, x + 1, y, B, 4 - (y > 13 ? 2 : 0), 1);              // the candle
    for (const dy of [3, 6]) if (top + dy < 15) setPx(p, x + 1, top + dy, step(B, 1));             // guttered wax
    if (v < 2) { setPx(p, x, top - 1, step(B, 3)); fire(p, x, top - 2, v < 1 ? 4 : 2, F, 1); }
  }
  disc(p, cx, 27, 7, 3, G, 3);
  span(p, 1, 13, 29, G, 1, 0);
  return age(p, v, G, 'candelabra');
}

/** Wellhead: a round stone kerb over a black shaft, with a windlass and a bucket rope. */
function artWellHead(v) {
  const p = makePix(30, 28), cx = 14, S = 'rstuv', W = 'abcdefg', I = 'hijkl';
  disc(p, cx, 14, 13, 6.4, S, 4);
  ell(p, cx, 14, 9.4, 4.2, '%');
  for (let y = 10; y <= 18; y++) for (let x = 5; x <= 23; x++) {                               // the shaft, and its lip
    const dx = (x - cx) / 9.4, dy = (y - 14) / 4.2, d2 = dx * dx + dy * dy;
    if (d2 > 1 || d2 < 0.66) continue;
    if (dx + dy < 0) setPx(p, x, y, step(S, 1));
  }
  for (let y = 18; y <= 23; y++) span(p, 3, 25, y, S, 3 - (y > 21 ? 1 : 0), 1);
  for (let y = 19; y <= 22; y += 3) for (let x = 5 + ((y & 1) ? 0 : 4); x <= 23; x += 7) setPx(p, x, y, step(S, 1));
  if (v < 1) {
    post(p, 3, 1, 12, W, 3, 2); post(p, 24, 1, 12, W, 2, 2);
    span(p, 2, 26, 2, W, 5, 1);                                                                // the crossbeam
    for (let x = 6; x <= 22; x++) setPx(p, x, 5, step(W, (x % 3) ? 3 : 1));                     // the windlass
    span(p, 6, 22, 4, W, 4, 1);
    for (let y = 6; y <= 11; y++) setPx(p, 14, y, step(I, 2));                                  // the rope
    span(p, 12, 16, 12, I, 3, 1);
  }
  span(p, 2, 26, 24, S, 1, 0);
  return age(p, v, S, 'wellHead');
}

// -------------------------------------------------------------------------------- the barrack room
/**
 * Bunk: a two-tier cot. The first pass drew a mattress and two rails and came out of the plate as a
 * flat card with a red stripe — nothing said BED. What says bed from overhead is four posts standing
 * proud of the frame, a pillow at one end and a blanket folded across the foot, so that is what this
 * draws, with the lower berth as a black slot under the upper one.
 */
function artBunk(v) {
  const p = makePix(32, 26), cx = 15, W = 'abcdefg', L = 'FGHIJ', C = 'ABCDE';
  for (const x of [1, 26]) post(p, x, 0, 22, W, 4, 4);                                          // the four posts
  const top = topFace(p, cx, 4, 24, 12, L, { base: 4, taper: 0.92 });                            // the upper mattress
  if (v < 2) {
    for (let y = 5; y <= top - 4; y++) span(p, 4, 11, y, L, 5, 1);                               // the pillow
    setPx(p, 4, 5, step(L, 3));
    for (let y = top - 3; y <= top; y++) span(p, 14, 25, y, C, 3 + (y === top - 3 ? 1 : 0), 1);  // the blanket
  }
  span(p, 1, 29, top + 1, L, 5, 1);
  span(p, 1, 29, top + 2, W, 4, 1);
  span(p, 1, 29, top + 3, W, 2, 0);                                                              // the upper rail
  box(p, 3, top + 4, 27, top + 9, '%');                                                          // the lower berth
  if (v < 1) { for (let y = top + 5; y <= top + 7; y++) span(p, 5, 25, y, L, 2, 1); span(p, 5, 12, top + 5, L, 4, 1); }
  span(p, 1, 29, top + 10, W, 4, 1);
  span(p, 1, 29, top + 11, W, 2, 0);
  span(p, 1, 29, top + 12, W, 1, 0);
  return age(p, v, W, 'bunk');
}

/** Footlocker: a soldier's chest at the foot of a bunk, iron-strapped, no gold. */
function artFootlocker(v) {
  const p = makePix(20, 14), cx = 9, W = 'abcdefg', I = 'hijkl';
  const f = boxForm(p, cx, 1, 17, 9, 4, W, { taper: 0.86 });
  for (const x of [4, 14]) for (let y = 2; y <= f.y1; y++) setPx(p, x, y, step(I, y < f.lip ? 3 : 2));
  setPx(p, 9, f.y0 + 1, step(I, 3)); setPx(p, 9, f.y0 + 2, step(I, 1));
  if (v >= 1) { box(p, 5, 2, 13, f.lip - 1, '%'); span(p, 4, 14, 1, W, 4, 1); }
  return age(p, v, W, 'footlocker');
}

/**
 * Grain sacks, slumped against each other: three bellies, three gathered necks, and a texel of ink
 * between them so the heap does not fuse into one pale blob (which is exactly what the first pass
 * did — three ellipses in one ramp read as a rock).
 */
function artSackPile(v) {
  const p = makePix(24, 18), L = 'FGHIJ';
  const sacks = [[6, 12, 5.6, 4.8], [17, 13, 5, 4.2], [11, 7, 4.8, 4]];
  for (const [x, y, rx, ry] of sacks) {
    ell(p, x, y, rx + 1, ry + 1, '%');                                                            // its own dark edge
    ell(p, x, y, rx, ry, step(L, 3));
  }
  for (const [x, y, , ry] of sacks) {                                                             // belly, then neck
    for (let yy = Math.round(y - ry); yy <= Math.round(y + ry); yy++) {
      for (let xx = x - 7; xx <= x + 7; xx++) {
        if (getPx(p, xx, yy) !== step(L, 3).charCodeAt(0)) continue;
        const dx = (xx - x) / 6, dy = (yy - y) / 5;
        setPx(p, xx, yy, step(L, 3 + Math.round((-dx - dy) * 1.4) - (dy > 0.55 ? 1 : 0)));
      }
    }
    const ny = Math.round(y - ry) - 1;
    span(p, x - 2, x + 2, ny, L, 2, 0);                                                           // the cord
    span(p, x - 2, x + 2, ny - 1, L, 4, 1);                                                       // the gathered mouth
    setPx(p, x, ny - 2, step(L, 3));
  }
  if (v >= 2) for (const [x, y] of [[2, 15], [21, 16]]) for (let k = 0; k < 3; k++) setPx(p, x + k, y, step('mnopq', 2 + (k & 1)));
  span(p, 3, 20, 16, L, 1, 0);
  return age(p, v, L, 'sackPile');
}

/** Barrel: staves and two hoops, its head read from above. */
function artBarrel(v) {
  const p = makePix(16, 22), cx = 7, W = 'abcdefg', I = 'hijkl';
  disc(p, cx, 4, 7, 3.2, W, 5);
  for (let y = 5; y <= 18; y++) {
    const bulge = y > 8 && y < 15 ? 1 : 0;
    span(p, 1 - bulge, 13 + bulge, y, W, 4 - (y > 16 ? 2 : 0), 1);
  }
  for (let x = 2; x <= 12; x += 3) for (let y = 6; y <= 18; y++) setPx(p, x, y, step(W, y > 16 ? 0 : 2));
  for (const y of [8, 15]) span(p, 0, 14, y, I, 3, 1);
  if (v >= 2) { box(p, 8, 10, 13, 17, '%'); for (let k = 0; k < 4; k++) setPx(p, 8 + k, 10 + k, step(W, 4)); }
  span(p, 2, 12, 19, W, 1, 0);
  return age(p, v, W, 'barrel');
}

/** Crate: a nailed box with a diagonal batten. */
function artCrate(v) {
  const p = makePix(20, 20), cx = 9, W = 'abcdefg';
  const f = boxForm(p, cx, 1, 17, 10, 6, W, { taper: 0.9 });
  for (let k = 0; k <= 8; k++) setPx(p, f.x0 + 1 + k, f.y1 - k, step(W, 5));                     // the batten
  for (const [x, y] of [[f.x0 + 1, f.y0], [f.x1 - 1, f.y0], [f.x0 + 1, f.y1], [f.x1 - 1, f.y1]]) setPx(p, x, y, step(W, 1));
  span(p, f.x0, f.x1, f.lip - 1, W, 3, 0);
  if (v >= 2) { box(p, f.x0 + 3, 2, f.x0 + 8, f.lip, '%'); }
  return age(p, v, W, 'crate');
}

/** Strongbox: a banded iron coffer. DULL AND GREY, and broken open from v1 — it is not the pickup. */
function artStrongbox(v) {
  const p = makePix(22, 22), cx = 10, I = 'hijkl', W = 'abcdefg';
  if (v >= 1) {
    box(p, 3, 2, 17, 8, '%');
    span(p, 2, 18, 1, W, 3, 1);
    for (const [x, y] of [[6, 5], [12, 4], [9, 6]]) setPx(p, x, y, step('rstuv', 2));
  }
  const f = boxForm(p, cx, v >= 1 ? 8 : 1, 18, 9, 5, W, { taper: 0.84 });
  for (const x of [5, 15]) for (let y = f.lip - 4; y <= f.y1; y++) setPx(p, x, y, step(I, y < f.lip ? 3 : 2));
  span(p, f.x0 + 3, f.x1 - 3, f.y0, I, 2, 0);
  setPx(p, cx, f.y0 + 1, step(I, 4)); setPx(p, cx, f.y0 + 2, step(I, 1));                        // the lock plate
  if (v >= 2) { setPx(p, cx - 1, f.y0 + 1, 0); setPx(p, cx, f.y0 + 1, 0); }
  return age(p, v, W, 'strongbox');
}

// ---------------------------------------------------------------------------------- the dark rooms
/** The torture rack: a low frame, two rollers, ratchets and slack rope. */
function artRack(v) {
  const p = makePix(32, 28), cx = 15, W = 'abcdefg', I = 'hijkl', R = 'FGHIJ';
  const bed = topFace(p, cx, 5, 26, 12, W, { base: 4, taper: 0.92 });
  for (let x = 4; x <= 26; x += 4) for (let y = 6; y <= bed; y++) setPx(p, x, y, step(W, 1));     // the slats
  for (const [cy, r0] of [[3, 3.2], [bed + 3, 3.4]]) {                                            // the rollers
    for (let y = Math.round(cy - r0); y <= Math.round(cy + r0); y++) {
      const t = (y - cy) / r0;
      span(p, 1, 29, y, W, 4 - Math.round(Math.abs(t) * 2.2), 0);
    }
    for (let x = 3; x <= 27; x += 4) setPx(p, x, Math.round(cy), step(W, 1));
    for (const x of [0, 29]) { disc(p, x, cy, 2.6, 3.2, I, 3); setPx(p, x - 1, Math.round(cy) - 1, step(I, 4)); }
  }
  for (const [x, y] of [[2, 1], [29, 1], [2, bed + 6], [29, bed + 6]]) { setPx(p, x, y, step(I, 3)); setPx(p, x, y + 1, step(I, 2)); }
  if (v < 1) { for (const x of [8, 22]) { for (let y = 1; y <= 5; y++) setPx(p, x, y, step(R, 3)); for (let y = bed + 1; y <= bed + 5; y++) setPx(p, x, y, step(R, 3)); } }
  span(p, 1, 29, bed + 8, W, 2, 1);
  for (const x of [2, 26]) post(p, x, bed + 9, bed + 12, W, 3, 3);
  return age(p, v, W, 'rack');
}

/** Cage: iron bars over a black interior, hooped at the top. v2 hangs open. */
function artCage(v) {
  const p = makePix(28, 42), cx = 13, I = 'hijkl';
  disc(p, cx, 5, 12, 4.6, I, 3);
  ell(p, cx, 5, 9.6, 3.2, '%');
  box(p, 3, 6, 23, 36, '%');
  for (let x = 3; x <= 23; x += 4) for (let y = 6; y <= 36; y++) setPx(p, x, y, step(I, x < cx ? 3 : 2));
  for (const y of [10, 22, 34]) span(p, 2, 24, y, I, 3, 1);
  if (v >= 2) { box(p, 11, 6, 23, 36, 0); for (let y = 6; y <= 30; y++) setPx(p, 24 + ((y - 6) >> 3), y, step(I, 3)); }
  else if (v >= 1) { for (const [x, y] of [[8, 30], [14, 28], [11, 33]]) setPx(p, x, y, step('FGHIJ', 3)); }
  span(p, 2, 24, 37, I, 4, 1);
  span(p, 2, 24, 38, I, 1, 0);
  return age(p, v, I, 'cage');
}

/** Chain post: a squared post, an iron collar, and two sets of manacles hanging off it. */
function artChainPost(v) {
  const p = makePix(14, 36), W = 'abcdefg', I = 'hijkl';
  post(p, 4, 2, 30, W, 4, 5);
  span(p, 3, 10, 2, W, 6, 1);                                                                     // the lit cap
  for (const y of [7, 20]) { span(p, 3, 10, y, I, 3, 1); span(p, 3, 10, y + 1, I, 1, 0); }         // iron collars
  for (const [x, y0, side] of [[1, 9, -1], [12, 12, 1]]) {
    setPx(p, x - side, y0 - 1, step(I, 4));
    chain(p, x, y0, y0 + (v >= 2 ? 5 : 10), I);
    if (v < 2) {                                                                                   // the manacle itself
      const my = y0 + 12;
      for (let k = -2; k <= 2; k++) setPx(p, x + k, my - 2, step(I, 3));
      setPx(p, x - 2, my - 1, step(I, 2)); setPx(p, x + 2, my - 1, step(I, 2));
      for (let k = -2; k <= 2; k++) setPx(p, x + k, my, step(I, 1));
      setPx(p, x - 2, my - 2, step(I, 4));
    }
  }
  disc(p, 6, 32, 6, 2.6, W, 3);
  span(p, 2, 10, 33, W, 1, 0);
  return age(p, v, W, 'chainPost');
}

// ------------------------------------------------------------------------------------ the ruin
/** A column snapped off: the broken cross-section is the top face. */
function artPillarBroken(v) {
  const p = makePix(22, 32), cx = 10, S = 'rstuv';
  const h = 24 - v * 5;
  disc(p, cx, 4, 9, 4, S, 4);
  const r = createRng('furniture:pillarBroken');
  for (let x = 2; x <= 18; x++) if (r.chance(0.5)) setPx(p, x, 1 + r.int(0, 1), step(S, 2));      // the ragged break
  for (let y = 6; y <= h; y++) span(p, 2, 18, y, S, 4 - (y > h - 2 ? 2 : 0), 1);
  for (let x = 4; x <= 17; x += 4) for (let y = 6; y <= h; y++) setPx(p, x, y, step(S, 2));       // flutes
  const base = topFace(p, cx, h + 1, 20, 5, S, { base: 4, taper: 0.94 });
  span(p, 0, 20, base + 1, S, 1, 0);
  return age(p, v, S, 'pillarBroken');
}

/** A column lying where it fell, its drums parted. */
function artFallenColumn(v) {
  const p = makePix(32, 16), S = 'rstuv';
  for (let y = 2; y <= 12; y++) {
    const t = (y - 7) / 5;
    span(p, 1, 30, y, S, 4 - Math.round(Math.abs(t) * 2.4) + (t < -0.5 ? 1 : 0), 0);
  }
  for (const x of [10, 20]) for (let y = 2; y <= 12; y++) setPx(p, x, y, step(S, 1));             // the joints
  for (let x = 2; x <= 29; x += 5) for (let y = 3; y <= 11; y += 3) setPx(p, x, y, step(S, 2));
  disc(p, 1, 7, 2.4, 5.2, S, 3);
  span(p, 2, 29, 13, S, 1, 0);
  if (v >= 1) { for (let y = 2; y <= 12; y++) setPx(p, 20 + ((y * 5) % 2), y, 0); }
  if (v >= 2) { box(p, 21, 2, 30, 6, 0); for (let x = 22; x <= 29; x++) setPx(p, x, 8 + ((x * 3) % 3), step(S, 2)); }
  return age(p, v, S, 'fallenColumn');
}

/** A heap of collapse: the blocked square. */
function artRubbleMound(v) {
  const p = makePix(26, 16), S = 'rstuv';
  const r = createRng('furniture:rubbleMound');
  for (let i = 0; i < 16 + v * 3; i++) {
    const x = r.int(2, 21), y = r.int(4, 12), w = r.int(2, 4), h = r.int(1, 3);
    const k = step(S, r.int(2, 4) - (y > 9 ? 1 : 0));
    box(p, x, y, x + w, y + h, k);
    span(p, x, x + w, y, S, 5, 1);
  }
  span(p, 2, 22, 13, S, 1, 0);
  return age(p, Math.min(1, v), S, 'rubbleMound');
}

// ================================================================================== the registry
/**
 * `type` -> everything the renderer needs to stand one on a tile.
 *  · `art`   painter (variant) -> Pix, drawn on the 32-texel grid
 *  · `pal`   the material spec (see `RAMP`/`GROUPS`)
 *  · `v`     how many variants exist (AMBIENCE §5.1's V column); lower = intact
 *  · `foot`  the footprint in TILES that touches the floor, for the contact shadow
 *  · `glow`  emissive floor: 0 for everything that is not on fire (decor is matte, §9)
 *  · `blk`   may ever be placed `blocking:true` (AMBIENCE §4.3's list of nine)
 */
const FURNITURE = {
  // tables and seats
  table: { art: artTable, pal: { a: RAMP.oak }, v: 4, foot: 0.85 },
  tableLong: { art: artTableLong, pal: { a: RAMP.oak }, v: 3, foot: 1.0, run: true },
  bench: { art: artBench, pal: { a: RAMP.ash }, v: 2, foot: 0.78 },
  stool: { art: artStool, pal: { a: RAMP.ash }, v: 2, foot: 0.38 },
  lectern: { art: artLectern, pal: { a: RAMP.oak, F: RAMP.bone }, v: 3, foot: 0.42 },
  // shelves and presses
  bookcase: { art: artBookcase, pal: { a: RAMP.oak, m: RAMP.brass, A: RAMP.cloth, F: RAMP.bone }, v: 4, foot: 0.72 },
  cupboard: { art: artCupboard, pal: { a: RAMP.oak, h: RAMP.iron, F: RAMP.bone }, v: 3, foot: 0.66 },
  weaponRack: { art: artWeaponRack, pal: { a: RAMP.oak, h: RAMP.steel, r: RAMP.bog, m: RAMP.brass }, v: 4, foot: 0.78 },
  shieldStand: { art: artShieldStand, pal: { a: RAMP.oak, h: RAMP.iron, m: RAMP.brass, A: RAMP.cloth }, v: 3, foot: 0.66 },
  armourStand: { art: artArmourStand, pal: { a: RAMP.oak, h: RAMP.steel }, v: 3, foot: 0.52 },
  throne: { art: artThrone, pal: { r: RAMP.slate, m: RAMP.brass, A: RAMP.cloth }, v: 2, foot: 0.72 },
  // the crypt
  sarcophagus: { art: artSarcophagus, pal: { r: RAMP.slate, F: RAMP.bone }, v: 4, foot: 0.92, blk: true },
  tombSlab: { art: artTombSlab, pal: { r: RAMP.slate }, v: 3, foot: 0.9 },
  urn: { art: artUrn, pal: { r: RAMP.slate }, v: 3, foot: 0.42 },
  bonePile: { art: artBonePile, pal: { F: RAMP.bone }, v: 3, foot: 0.6 },
  // the workshop
  alchemyBench: { art: artAlchemyBench, pal: { a: RAMP.oak, h: RAMP.iron, A: RAMP.glass, F: RAMP.bone }, v: 3, foot: 0.9, glow: 0.1, emissive: 0xffb070 },
  retortStand: { art: artRetortStand, pal: { h: RAMP.iron, A: RAMP.glass }, v: 2, foot: 0.46, glow: 0.1, emissive: 0xffb070 },
  scales: { art: artScales, pal: { m: RAMP.brass, h: RAMP.iron }, v: 2, foot: 0.4 },
  cauldron: { art: artCauldron, pal: { h: RAMP.iron, A: RAMP.moss }, v: 3, foot: 0.56 },
  forge: { art: artForge, pal: { r: RAMP.stone, h: RAMP.iron, A: RAMP.fire }, v: 2, foot: 0.9, blk: true, glow: 0.24, emissive: 0xff8a3a, pool: [0xff6a20, 0.7, 0.14] },
  anvil: { art: artAnvil, pal: { h: RAMP.iron, a: RAMP.bog }, v: 2, foot: 0.56, blk: true },
  // fire and water
  brazier: { art: artBrazier, pal: { h: RAMP.iron, A: RAMP.fire }, v: 4, foot: 0.5, glow: 0.22, emissive: 0xff9a4a, pool: [0xff7a2a, 0.62, 0.11] },
  hearth: { art: artHearth, pal: { r: RAMP.stone, A: RAMP.fire }, v: 3, foot: 1.0, glow: 0.22, emissive: 0xff8a3a, pool: [0xff8a3a, 0.8, 0.13] },
  candelabra: { art: artCandelabra, pal: { m: RAMP.brass, F: RAMP.bone, A: RAMP.fire }, v: 3, foot: 0.42, glow: 0.16, emissive: 0xffe6b0, pool: [0xffe0a0, 0.42, 0.07] },
  wellHead: { art: artWellHead, pal: { r: RAMP.stone, a: RAMP.bog, h: RAMP.iron }, v: 2, foot: 0.9, blk: true },
  // the barrack room
  bunk: { art: artBunk, pal: { a: RAMP.ash, A: RAMP.cloth, F: RAMP.linen }, v: 3, foot: 0.9, run: true },
  footlocker: { art: artFootlocker, pal: { a: RAMP.ash, h: RAMP.iron }, v: 2, foot: 0.56 },
  sackPile: { art: artSackPile, pal: { F: RAMP.linen, m: RAMP.brass }, v: 3, foot: 0.62 },
  barrel: { art: artBarrel, pal: { a: RAMP.oak, h: RAMP.iron }, v: 3, foot: 0.44 },
  crate: { art: artCrate, pal: { a: RAMP.ash }, v: 3, foot: 0.56 },
  strongbox: { art: artStrongbox, pal: { a: RAMP.bog, h: RAMP.iron, r: RAMP.slate }, v: 3, foot: 0.6 },
  // the dark rooms
  rack: { art: artRack, pal: { a: RAMP.bog, h: RAMP.iron, F: RAMP.linen }, v: 2, foot: 0.9 },
  cage: { art: artCage, pal: { h: RAMP.iron, F: RAMP.bone }, v: 3, foot: 0.78, blk: true },
  chainPost: { art: artChainPost, pal: { a: RAMP.bog, h: RAMP.iron }, v: 3, foot: 0.34 },
  // the ruin
  pillarBroken: { art: artPillarBroken, pal: { r: RAMP.stone }, v: 3, foot: 0.62, blk: true },
  fallenColumn: { art: artFallenColumn, pal: { r: RAMP.stone }, v: 3, foot: 1.0, blk: true },
  rubbleMound: { art: artRubbleMound, pal: { r: RAMP.stone }, v: 4, foot: 0.74, blk: true },
};

/** Every furniture id this module can build (AMBIENCE §5.1 standing props, the furniture half). */
export const FURNITURE_TYPES = Object.keys(FURNITURE);
/** Is `type` a piece of furniture this module paints? */
export function isFurniture(type) { return Object.prototype.hasOwnProperty.call(FURNITURE, type); }
/** How many variants `type` has (0 for an unknown type). Lower variant = more intact. */
export function furnitureVariants(type) { return FURNITURE[type] ? FURNITURE[type].v : 0; }
/** May `type` ever be placed with `blocking:true` (AMBIENCE §4.3)? */
export function furnitureBlockable(type) { return !!(FURNITURE[type] && FURNITURE[type].blk); }
/**
 * Is `type` a RUN piece (AMBIENCE §5.4) — several one-tile entries laid in a line, with `variant`
 * encoding the segment: 0 = end, 1 = middle, 2 = the other end? There is no multi-tile entry in the
 * contract, so the generator lays the run and this only says which types accept one.
 */
export function furnitureIsRun(type) { return !!(FURNITURE[type] && FURNITURE[type].run); }
/** The painted art for a piece, for tests and the debug plate. @returns {object|null} a Pix */
export function furnitureArt(type, variant = 0) {
  const f = FURNITURE[type];
  return f ? f.art(Math.max(0, Math.min(f.v - 1, variant | 0))) : null;
}

/**
 * Build one piece of furniture, ready to be dropped on a tile by DungeonView (`addAt`).
 *
 * The group is the pickups' own arrangement minus everything that says "pick me up": a
 * `pixelSprite` pivoted on its floor row, the two-lobe `contactShadow` welded to the tile under it,
 * and — only for the pieces that are literally alight — a small ground glow. No bob, no glints, no
 * sigils, no sparkle (AMBIENCE §9).
 *
 * @param {string} type one of `FURNITURE_TYPES`
 * @param {{variant?:number, facing?:'n'|'e'|'s'|'w', blocking?:boolean}} [o]
 * @returns {THREE.Group|null} null for a type this module does not paint (the caller warns once)
 */
export function buildFurniture(type, o = {}) {
  const f = FURNITURE[type];
  if (!f) return null;
  const v = Math.max(0, Math.min(f.v - 1, o.variant | 0));
  const key = `furn:${type}:${v}`;
  const pal = palOf(type, f.pal);
  const g = new THREE.Group();
  const s = pixelSprite(key, () => f.art(v), pal, { glow: f.glow ?? 0.05, emissive: f.emissive ?? 0xffffff });
  g.add(s);
  if (f.pool && v === 0) {
    const [colour, radius, opacity] = f.pool;
    g.add(groundGlow(colour, radius, { opacity }));
  }
  // HALF A PICKUP'S SHADOW. A potion's is a nine-texel bite of dark and reads as contact; the same
  // shadow under a table's one-tile footprint is a navy pool the size of the flagstone, and every
  // piece of furniture ends up standing in one. Judged at 4x in the 'furniture' plate.
  g.add(contactShadow(f.foot, { strength: 0.5, spread: 1.1 }));
  g.userData.decor = { type, variant: v, facing: o.facing || 's' };
  g.userData.blocking = !!o.blocking && !!f.blk;
  return g;
}

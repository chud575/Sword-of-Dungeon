// flatArt: props drawn as BOARD PIECES — the 2D set for `?props=flat` (props/mode.js).
//
// THE BRIEF (owner, 2026-09-20): "we're going for less realism and more pragmatism so that the user can
// identify what they are looking at", with a sprite sheet of dungeon props as the reference. The camera
// that goes with it is the owner's own find — perspective at tilt 0, straight down — under which the
// solid props collapse: measured in `room-guardroom` at that camera, the Freeport table is a beige slab
// and the brazier a blob, because at 0 degrees you see nothing but their lids.
//
// SO THESE ARE ICONS, NOT MODELS, and they follow the reference sheet rather than the kit:
//
//  1. FRONT-ON. Every piece is drawn in elevation, as the sheet draws them — you see the chest's lid and
//     its face, the table's top and its legs. A screen-aligned quad under a straight-down camera shows
//     that art whole, which is the entire trick: the board is seen from above, the pieces are drawn
//     face-on, exactly like a printed counter standing on a map.
//  2. ONE SILHOUETTE, READ IN A GLANCE. Big simple shapes, no detail under two texels, nothing that
//     needs a second look to name. A barrel is a barrel at a tenth of a second.
//  3. THREE TONES AND AN INK LINE. A light, a mid and a dark per material, hard-edged, plus a one-texel
//     near-black contour round the whole piece (`outline`). No gradients, no baked ambient occlusion,
//     no pillow shading — the flat blocks of colour are what make it legible against a painted floor.
//  4. SATURATED, AND WARM AGAINST THE STONE. The floor is grey-brown; wood goes orange, iron goes blue,
//     cloth and fire carry the accents. The reference sheet is louder than this game has been and that
//     is the point of the test.
//  5. SIZED IN TEXELS, ON THE ONE GRID. The art box IS the size on screen: `pixelSprite` builds the quad
//     from the art's own texel size at `TEXELS_PER_TILE` = 32, so a 40-wide piece covers 1.25 tiles. A
//     table reads big; a skull reads small. Nothing here does texel arithmetic of its own.
//
// Everything is procedural (CLAUDE.md rule 1: no `Math.random`) and returns a Pix plus its Palette, so a
// piece can be inspected in node — `node tools/flatsheet.mjs` draws the set.
import { makePix, setPx, getPx, outline, Palette } from '../sprites/pixelPainter.js';

// ------------------------------------------------------------------------------------ the palette
// Three tones a material: CAPITAL = light, lower = mid, the third key = dark. '#' is the ink.
const PAL = new Palette()
  .set('#', 0x17131a)                                     // ink: near-black, a touch violet
  .set('W', 0xd79a52).set('w', 0xa8682e).set('v', 0x6d3d1c)   // wood
  .set('S', 0xb9b6ae).set('s', 0x8a877f).set('t', 0x5a5852)   // stone
  .set('I', 0x9fb0c4).set('i', 0x6b7d92).set('h', 0x435063)   // iron
  .set('G', 0xffd45e).set('g', 0xd39a1e)                      // gold / brass
  .set('C', 0xc8433a).set('c', 0x8e2b25)                      // cloth, red
  .set('U', 0x5b8fd4).set('u', 0x3a5f97)                      // cloth, blue
  .set('M', 0x7cc06a).set('m', 0x3f7a3c)                      // green: moss, bottles
  .set('B', 0xf0e6cf).set('b', 0xbfae8e)                      // bone
  .set('F', 0xffe98a).set('f', 0xff9b2f).set('e', 0xd4481c)   // fire
  .set('K', 0x2a2530);                                        // a dark hole (open chest, alcove)

// ------------------------------------------------------------------------------------ drawing
const rect = (p, x0, y0, x1, y1, k) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setPx(p, x, y, k); };
const hline = (p, x0, x1, y, k) => rect(p, x0, y, x1, y, k);
const vline = (p, x, y0, y1, k) => rect(p, x, y0, x, y1, k);
/** Filled ellipse, centre (cx,cy), radii rx/ry. */
function ellipse(p, cx, cy, rx, ry, k) {
  for (let y = Math.ceil(cy - ry); y <= cy + ry; y++) for (let x = Math.ceil(cx - rx); x <= cx + rx; x++) {
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    if (dx * dx + dy * dy <= 1.02) setPx(p, x, y, k);
  }
}
/** A barrel/urn body: a rectangle whose sides bow out by `bulge` texels at its waist. */
function belly(p, x0, y0, x1, y1, bulge, k) {
  const h = y1 - y0;
  for (let y = y0; y <= y1; y++) {
    const t = h ? (y - y0) / h : 0;
    const out = Math.round(Math.sin(t * Math.PI) * bulge);
    rect(p, x0 - out, y, x1 + out, y, k);
  }
}
/** Shade the left `n` columns of whatever is already drawn, and the right `n`, into light and dark. */
function roundOff(p, lightKey, darkKey, n = 2) {
  for (let y = 0; y < p.h; y++) {
    let first = -1, last = -1;
    for (let x = 0; x < p.w; x++) if (getPx(p, x, y)) { if (first < 0) first = x; last = x; }
    if (first < 0) continue;
    for (let i = 0; i < n; i++) {
      if (lightKey) setPx(p, first + i, y, lightKey);
      if (darkKey) setPx(p, last - i, y, darkKey);
    }
  }
}
/** The finished piece: ink it and hand back the palette. */
const done = (p) => ({ pix: outline(p, '#'), pal: PAL });

// ------------------------------------------------------------------------------------ the pieces
// Each takes the decor variant and returns {pix, pal}. Variant 0 is intact; higher is more worn
// (AMBIENCE §2.1 — `room.decay` indexes straight into it, so a higher variant may only ever take away).

function table(v) {
  const p = makePix(40, 30);
  rect(p, 1, 8, 38, 10, 'W');                     // the top, seen edge-on
  rect(p, 1, 11, 38, 14, 'w');
  hline(p, 1, 38, 15, 'v');
  for (let x = 6; x < 38; x += 8) vline(p, x, 8, 14, 'v');   // plank seams
  rect(p, 4, 16, 8, 28, 'w'); rect(p, 31, 16, 35, 28, 'w');  // legs
  vline(p, 4, 16, 28, 'W'); vline(p, 35, 16, 28, 'v');
  if (v >= 2) rect(p, 31, 22, 35, 28, 0);                    // a leg broken away
  if (v >= 1) { rect(p, 20, 8, 25, 10, 'v'); }               // a gouge in the top
  return done(p);
}

function stool(v) {
  const p = makePix(22, 22);
  rect(p, 1, 6, 20, 8, 'W'); rect(p, 1, 9, 20, 11, 'w');
  rect(p, 4, 12, 7, 20, 'w'); rect(p, 14, 12, 17, 20, 'v');
  if (v >= 1) rect(p, 14, 17, 17, 20, 0);
  return done(p);
}

function bench(v) {
  const p = makePix(38, 22);
  rect(p, 1, 7, 36, 9, 'W'); rect(p, 1, 10, 36, 12, 'w');
  rect(p, 4, 13, 8, 20, 'w'); rect(p, 29, 13, 33, 20, 'v');
  if (v >= 1) hline(p, 12, 22, 7, 'v');
  return done(p);
}

function chest(v) {
  const p = makePix(30, 26);
  const open = v >= 1;
  if (open) {
    rect(p, 2, 2, 27, 7, 'v'); hline(p, 2, 27, 2, 'w');      // the lid, thrown back
    rect(p, 4, 9, 25, 12, 'K');                              // the dark inside
    ellipse(p, 15, 12, 8, 3, 'G'); ellipse(p, 15, 13, 5, 2, 'F');
  } else {
    rect(p, 2, 4, 27, 10, 'w'); hline(p, 2, 27, 4, 'W');     // domed lid
    rect(p, 4, 3, 25, 3, 'w');
  }
  rect(p, 2, open ? 13 : 11, 27, 23, 'w');                   // the body
  hline(p, 2, 27, open ? 13 : 11, 'W');
  vline(p, 2, open ? 13 : 11, 23, 'W'); vline(p, 27, open ? 13 : 11, 23, 'v');
  for (const x of [7, 22]) rect(p, x, open ? 13 : 4, x + 1, 23, 'g');   // iron straps
  if (!open) { rect(p, 13, 12, 16, 16, 'G'); setPx(p, 14, 14, '#'); setPx(p, 15, 14, '#'); }  // the lock
  return done(p);
}

function barrel(v) {
  const p = makePix(24, 28);
  belly(p, 4, 3, 19, 25, 3, 'w');
  roundOff(p, 'W', 'v', 3);
  for (const y of [7, 15, 22]) { const out = Math.round(Math.sin(((y - 3) / 22) * Math.PI) * 3); rect(p, 4 - out, y, 19 + out, y + 1, 'g'); }
  hline(p, 5, 18, 3, 'W'); hline(p, 5, 18, 25, 'v');
  if (v >= 2) { rect(p, 12, 10, 19, 20, 0); }                // staved in
  return done(p);
}

function crate(v) {
  const p = makePix(26, 26);
  rect(p, 2, 3, 23, 23, 'w');
  vline(p, 2, 3, 23, 'W'); vline(p, 23, 3, 23, 'v'); hline(p, 2, 23, 3, 'W'); hline(p, 2, 23, 23, 'v');
  rect(p, 2, 11, 23, 13, 'v');                               // the middle band
  for (let i = 0; i < 20; i++) { setPx(p, 3 + i, 4 + i, 'W'); setPx(p, 22 - i, 4 + i, 'W'); }   // the cross
  if (v >= 2) rect(p, 14, 14, 23, 23, 0);
  return done(p);
}

function bookcase(v) {
  const p = makePix(34, 40);
  rect(p, 1, 1, 32, 38, 'v');                                // the carcass
  rect(p, 4, 4, 29, 35, 'K');
  for (const y of [12, 22, 32]) rect(p, 3, y, 30, y + 1, 'w');  // shelves
  const books = ['C', 'U', 'M', 'G', 'B', 'c', 'u', 'm'];
  let n = 0;
  for (const top of [5, 15, 25]) {
    for (let x = 5; x < 29; x += 3) {
      if (v >= 2 && ((x + top) % 7 === 0)) { n++; continue; }     // gaps where books are gone
      const k = books[n++ % books.length];
      rect(p, x, top + (n % 3), x + 1, top + 6, k);
    }
  }
  vline(p, 1, 1, 38, 'w'); vline(p, 32, 1, 38, '#');
  if (v >= 3) rect(p, 20, 1, 32, 16, 0);                     // smashed corner
  return done(p);
}

function brazier(v) {
  const p = makePix(28, 34);
  const lit = v <= 1;
  rect(p, 6, 22, 21, 24, 'i');                               // foot
  rect(p, 12, 14, 15, 22, 'i'); vline(p, 12, 14, 22, 'I');   // stem
  rect(p, 3, 8, 24, 10, 'I'); rect(p, 4, 11, 23, 13, 'i'); rect(p, 6, 14, 21, 15, 'h');  // the bowl
  if (lit) {
    ellipse(p, 13, 9, 8, 2, 'e');
    ellipse(p, 13, 6, 6, 4, 'f'); ellipse(p, 13, 5, 3, 3, 'F');
    ellipse(p, 20, 6, 2, 2, 'f'); ellipse(p, 7, 7, 2, 2, 'f');
  } else { ellipse(p, 13, 9, 7, 2, 'h'); ellipse(p, 13, 9, 4, 1, 't'); }
  if (v >= 3) { rect(p, 3, 8, 24, 15, 0); rect(p, 3, 16, 12, 20, 'h'); }   // tipped over
  return done(p);
}

function candlestick(v) {
  const p = makePix(14, 26);
  rect(p, 3, 21, 10, 23, 'g'); rect(p, 5, 12, 8, 21, 'G');
  rect(p, 5, 6, 8, 12, 'B');                                  // the candle
  if (v < 2) { ellipse(p, 6, 4, 2, 3, 'f'); setPx(p, 6, 3, 'F'); setPx(p, 6, 2, 'F'); }
  if (v >= 1) rect(p, 5, 6, 8, 8, 0);                         // burnt down
  return done(p);
}

function urn(v) {
  const p = makePix(20, 26);
  belly(p, 5, 6, 14, 22, 4, 's');
  roundOff(p, 'S', 't', 2);
  rect(p, 6, 3, 13, 5, 'S'); hline(p, 5, 14, 6, 't');         // the neck
  if (v >= 1) { rect(p, 13, 8, 18, 14, 0); }                  // a bite out of it
  if (v >= 2) { rect(p, 5, 6, 14, 10, 0); }
  return done(p);
}

function sarcophagus(v) {
  const p = makePix(40, 30);
  rect(p, 2, 4, 37, 26, 's');
  hline(p, 2, 37, 4, 'S'); hline(p, 2, 37, 26, 't'); vline(p, 2, 4, 26, 'S'); vline(p, 37, 4, 26, 't');
  rect(p, 5, 7, 34, 9, 't');                                  // the lid's shoulder
  ellipse(p, 20, 16, 6, 7, 'S'); ellipse(p, 20, 16, 4, 5, 't');   // the carved face
  ellipse(p, 20, 14, 1, 1, '#'); ellipse(p, 17, 15, 1, 1, '#'); ellipse(p, 23, 15, 1, 1, '#');
  if (v >= 2) { rect(p, 24, 4, 37, 16, 0); rect(p, 24, 17, 30, 20, 'K'); }   // lid pushed off
  return done(p);
}

function bonePile(v) {
  const p = makePix(28, 20);
  ellipse(p, 13, 15, 12, 4, 'b');
  for (const [x, y, r] of [[6, 12, 3], [19, 13, 3], [13, 11, 4]]) ellipse(p, x, y, r, r - 1, 'B');
  ellipse(p, 13, 10, 4, 4, 'B'); setPx(p, 11, 10, '#'); setPx(p, 15, 10, '#'); rect(p, 12, 13, 14, 13, '#');
  if (v >= 1) rect(p, 19, 8, 27, 14, 0);
  return done(p);
}

function skull(v) {
  const p = makePix(16, 15);
  ellipse(p, 7, 6, 6, 5, 'B'); rect(p, 4, 10, 10, 13, 'B');
  ellipse(p, 5, 6, 2, 2, '#'); ellipse(p, 10, 6, 2, 2, '#');
  vline(p, 7, 9, 10, 'b'); hline(p, 5, 9, 12, '#');
  if (v >= 2) rect(p, 11, 2, 15, 7, 0);
  return done(p);
}

function bunk(v) {
  const p = makePix(40, 28);
  rect(p, 2, 6, 37, 8, 'v'); rect(p, 2, 9, 37, 12, 'C'); hline(p, 2, 37, 9, 'c');   // upper bunk + blanket
  rect(p, 4, 9, 12, 12, 'B');                                                       // pillow
  rect(p, 2, 16, 37, 18, 'v'); rect(p, 2, 19, 37, 22, 'U'); hline(p, 2, 37, 19, 'u');
  rect(p, 4, 19, 12, 22, 'B');
  vline(p, 2, 4, 26, 'w'); vline(p, 37, 4, 26, 'v');
  if (v >= 2) { rect(p, 2, 9, 37, 12, 0); rect(p, 2, 6, 37, 8, 'v'); }
  return done(p);
}

function weaponRack(v) {
  const p = makePix(32, 36);
  rect(p, 2, 30, 29, 33, 'w'); rect(p, 2, 4, 29, 6, 'w');
  for (let i = 0; i < 4; i++) {
    const x = 5 + i * 7;
    if (v >= 2 && i % 2) continue;
    vline(p, x, 6, 30, 'I'); vline(p, x + 1, 6, 30, 'i');
    if (i % 2) { rect(p, x - 2, 10, x + 3, 12, 'g'); } else { ellipse(p, x + 0.5, 8, 3, 3, 'I'); }
  }
  return done(p);
}

function cauldron(v) {
  const p = makePix(26, 24);
  ellipse(p, 12, 13, 11, 8, 'h'); rect(p, 1, 4, 23, 13, 0);
  ellipse(p, 12, 11, 11, 3, 'i'); ellipse(p, 12, 11, 9, 2, v >= 1 ? 't' : 'M');
  rect(p, 5, 19, 19, 21, 'h');
  return done(p);
}

function tapestry(v) {
  const p = makePix(26, 34);
  rect(p, 1, 1, 24, 3, 'w');
  rect(p, 3, 4, 22, 30, v >= 2 ? 'u' : 'C'); rect(p, 5, 6, 20, 28, v >= 2 ? 'U' : 'c');
  ellipse(p, 12, 16, 5, 7, 'G'); ellipse(p, 12, 16, 3, 5, v >= 2 ? 'U' : 'C');
  for (let x = 3; x <= 22; x += 3) rect(p, x, 31, x + 1, 32, v >= 2 ? 'u' : 'c');   // the fringe
  if (v >= 1) rect(p, 16, 18, 22, 30, 0);                                           // torn
  return done(p);
}

/** Every type this set draws, and the variant art for it. */
const ART = {
  table, tableLong: table, stool, bench, strongbox: chest, footlocker: chest, barrel, crate,
  bookcase, cupboard: bookcase, brazier, hearth: brazier, candlestick, candelabra: candlestick,
  urn, sarcophagus, tombSlab: sarcophagus, bonePile, skullPile: bonePile, skull, bunk,
  weaponRack, rack: weaponRack, cauldron, tapestry, banner: tapestry,
};

/** Types drawn by this set (for the sheet tool and the palette badges). */
export const FLAT_TYPES = Object.keys(ART);

/**
 * The board piece for one decor type, or null for a type this set does not draw yet (the caller keeps
 * the old painted billboard).
 * @param {string} type @param {number} variant
 * @returns {{pix:{w:number,h:number,d:Uint16Array}, pal:Palette}|null}
 */
export function flatProp(type, variant = 0) {
  const f = ART[type];
  return f ? f(Math.max(0, variant | 0)) : null;
}

// DRESSING — the cheap detail that makes a dungeon INHABITED.
//
// `props/furniture.js` paints the big silhouettes that say what a room is FOR. This file paints
// everything else in docs/AMBIENCE.md's catalogue: the SCATTER that says somebody was here (skulls,
// rats, candlesticks, bottles, dice), the FLOOR DECALS that say what happened here (bones, blood,
// scorch, puddles, spilled coin, a rug that has not been beaten in a century) and the WALL DRESSING
// that gives a bare masonry face something to carry (sconces, banners, chains, cobwebs, cracks,
// carvings). HeroQuest's manifest is twelve pieces of furniture AND ten skulls, four rats, two
// candlesticks and a handful of bottles — the second half is what makes the first half read as a
// place rather than a showroom.
//
// THREE CLASSES, THREE GEOMETRIES, ONE GRID (AMBIENCE §1):
//
//   · STANDING PROP — `pixelSprite` on the cast's own texel grid, pivoted on its floor row, with a
//     contact shadow welded to the tile. Identical in every respect to a pickup or a bookcase, so a
//     skull beside the hero's boot is drawn at the same texel size as the boot.
//
//   · FLOOR DECAL — one quad lying IN the floor plane, painted at `PX_PER_TILE` (the flagstones'
//     own resolution). THE DECAL IS DRAWN IN PLAN, NOT IN THE SPRITES' PROJECTION. The camera is
//     17 degrees off vertical, so the floor is foreshortened by sin(73°) = 0.96 — near enough to a
//     true plan view — while an upright billboard is drawn with the house `SQUASH` of 0.55. An
//     earlier pass shipped a trap decal that ignored this and read as a sticker; every mark here is
//     therefore drawn as if seen from straight above, and takes its perspective, its wear, its
//     lighting and its texel grid from the slab it lies on, because it IS in the slab's plane.
//     Nothing here is a closed rectangle: every edge is broken and stippled, because a hard alpha
//     edge on a floor is the other way a decal reads as a sticker.
//
//   · WALL-MOUNTED — a quad IN THE WALL'S OWN PLANE, bottom art row at the type's `mountY`, placed
//     by the caller at `(x + dx*0.5, y + dy*0.5)` exactly as `lighting.js` places its torch spots,
//     and STRETCHED VERTICALLY BY 1/sin(camera tilt) so its art lands on the shared texel grid at
//     true size. Without that stretch the whole visible face of a 0.82-unit wall is seven and a
//     half texels of screen and every hung piece is a smudge; with it a shield is twenty-four
//     texels of shield. See `wallPlate()` — it is the argument of this whole class.
//
// THE RULES THAT ARE EASY TO BREAK HERE (and the reason each one exists):
//
//   1. NOTHING IN THIS FILE MAY LOOK LIKE A PICKUP (AMBIENCE §9). `coins` is the dangerous one: it
//      is a DECAL, it is dull brass with no glint, no bob and no glow pool, and it is never more
//      than four coins. A player who tries to pick up the floor learns to distrust the screen.
//   2. LOWER VARIANT = MORE INTACT (§2.1). `room.decay` indexes straight into `variant`.
//   3. Every colour comes from `ramp()` through `itemPalette`, the key light is top-left on every
//      piece and every facing, and no piece invents a texel size of its own.
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { makePix, setPx, getPx, line } from '../sprites/pixelPainter.js';
import { INK_DEEP } from '../sprites/style.js';
import { groundGlow, litMaterial } from '../propFx.js';
import { PX_PER_TILE, texelGrid, frameTexelSize } from '../sprites/spriteBillboard.js';
import {
  itemPalette, pixelSprite, pixelTexture, pixelSnap, floorDecal, contactShadow, span, box, ell,
  topFace, frontFace, model, step, animate,
} from '../props.js';

// ------------------------------------------------------------------------------- the materials
// The same convention as furniture.js: one base colour per material, shared by every piece made of
// it, so the bone of a skull and the bone of an ossuary shelf are the same bone.
const RAMP = {
  // NEAR-WHITE BONE, AND ITS HUE HELD UNDER `LIGHT_HUE` ON PURPOSE. `ramp()` cools a shadow UP the
  // wheel for any hue between amber and violet and the SHORT way round for anything below it, so a
  // bone one point too yellow (hue 0.120) drops its two dark steps into GRASS GREEN — measured, and
  // it painted the ossuary's floor line lime. Held at hue 0.110 the shadows fall through warm red
  // instead, which is what old bone actually does.
  bone: '#dccdb0',       // bone, teeth, parchment: reads WHITE against the flagstone's mid tan
  stone: '#8b8274',      // the dungeon's own masonry — matches the flagstone atlas
  slate: '#6e6d78',      // cold tomb stone
  grit: '#7c7266',       // chips, scree, dust
  // PALE IRON, on purpose. A wall piece is compressed to a third of its height by the plan view
  // (see `wallPlate`), so it can only read by SILHOUETTE WIDTH and VALUE CONTRAST — black iron on
  // dark stone at four device pixels tall is nothing at all. The hardware that hangs on a wall is
  // therefore a lighter, cooler iron than the iron a brazier is made of.
  iron: '#65605c',       // brackets, bars, grates standing on the floor
  ironPale: '#8e8a84',   // the same metal, on a wall
  steel: '#94a6b4',      // blades on a trophy
  brass: '#c8912c',      // coin, rings, fittings
  cloth: '#8a2331',      // banner red
  weave: '#4a5f86',      // tapestry blue-grey
  wax: '#d8caa4',        // candle wax
  fire: '#d2652c',       // flame
  wood: '#7a5230',       // hafts, shelves, rods
  blood: '#6b2620',      // old blood
  soot: '#54505c',       // scorch, smoke stain (painted at steps 1-2, see the note above)
  // THE DARKEST STEP OF A HOUSE RAMP IS NOT A NEUTRAL DARK. `ramp()` cools shadows toward
  // SHADOW_HUE and GAINS saturation doing it, so step 0 of any of these is a saturated violet (or,
  // for anything hued below LIGHT_HUE like brass, a saturated RED). On a sprite that step is one
  // texel of contour and nobody notices; on a 32-texel floor decal it is the whole mark, and the
  // puddle came out of the plate as a navy hole and the coins as red sparks. So every decal below
  // paints in the MIDDLE of its ramp (steps 1-3) and gets "darker than the stone" from a darker
  // BASE COLOUR instead.
  water: '#4a6274',      // standing water: darker than the stone it sits on
  moss: '#5d7a48',       // lichen, rot
  fungus: '#93ad6e',     // fungal mat, bracket fungus
  cap: '#b8a6c8',        // pale mushroom caps
  web: '#a9a6b6',        // cobweb, chalk, rime
  // RAT FUR, DESATURATED ON PURPOSE. `ramp()` GAINS saturation on the way down for any base over
  // 8% saturation, so a warm brown fur came out of the plate with a maroon belly and a white back —
  // a rat painted in raw liver. Held under that threshold the ramp is a clean warm grey and the
  // whole animal can sit in its middle, dark against the flagstone, with the key only on its spine.
  hide: '#544f49',       // rat fur: a shade off the flagstone, or the rat is a bread roll
  glass: '#7ea6b6',      // bottles
};

const GROUPS = { a: 'abcdefg', h: 'hijkl', m: 'mnopq', r: 'rstuv', A: 'ABCDE', F: 'FGHIJ' };
const palCache = new Map();
/** Palette for a piece from its material spec, e.g. `{a: RAMP.iron, F: RAMP.bone}`. */
function palOf(key, spec) {
  let p = palCache.get(key);
  if (p) return p;
  const ramps = {};
  for (const g in GROUPS) if (spec[g]) ramps[GROUPS[g]] = spec[g];
  p = itemPalette(ramps, { '%': INK_DEEP, '*': '#f6efff', ...(spec.extra || {}) });
  palCache.set(key, p);
  return p;
}

const DECAL_PX = PX_PER_TILE;   // 32: the flagstones' own resolution, and the cast's

// ---------------------------------------------------------------------------------- the toolkit

/** Take `n` pixels out of a silhouette's edge and drop the rest a step: the piece has been used. */
function wear(p, v, keys, seed, rate = 0.5) {
  if (v <= 0) return p;
  const r = createRng(`dressing:wear:${seed}`);
  const edge = [];
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (!p.d[y * p.w + x]) continue;
    if (!getPx(p, x, y - 1) || !getPx(p, x + 1, y) || !getPx(p, x - 1, y)) edge.push([x, y]);
  }
  const bite = Math.round(edge.length * rate * 0.09 * v);
  for (let i = 0; i < bite; i++) { const e = edge[r.int(0, edge.length - 1)]; setPx(p, e[0], e[1], 0); }
  if (v >= 2) for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const k = String.fromCharCode(p.d[y * p.w + x] || 0), i = keys.indexOf(k);
    if (i > 0 && r.chance(0.22)) setPx(p, x, y, step(keys, i - 1));
  }
  return p;
}

/**
 * A single long bone lying in the floor plane: TWO TEXELS THICK, lit along its top-left edge, with
 * the shade it throws down-right and a knuckle at each end. One texel of bone at 32 texels to the
 * tile is two device pixels at the play camera and disappears into the flagstone's own wear —
 * measured in the 'dressed-crypt' shot, where the first version read as scratches on the floor.
 */
function boneStroke(p, x0, y0, x1, y1, keys, shade) {
  line(p, x0 + 1, y0 + 2, x1 + 1, y1 + 2, shade);           // the shade, down-right
  line(p, x0, y0 + 1, x1, y1 + 1, step(keys, 2));           // the shaft's own dark side
  line(p, x0, y0, x1, y1, step(keys, 4));                   // and its lit top-left edge
  for (const [x, y] of [[x0, y0], [x1, y1]]) {              // the knuckles
    setPx(p, x, y, step(keys, 4)); setPx(p, x, y + 1, step(keys, 3));
    setPx(p, x + (x === x0 ? -1 : 1), y, step(keys, 3));
    setPx(p, x + (x === x0 ? -1 : 1), y + 1, step(keys, 2));
  }
}

/** Stipple a blob: dense at the centre, fraying to single texels at the rim (never a hard edge). */
function blot(p, cx, cy, rx, ry, keys, rng, { base = 2, grad = 1, edge = 0.55 } = {}) {
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++) {
    for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1.25) continue;
      const keep = d < 0.7 ? 1 : 1 - (d - 0.7) / (1.25 - 0.7) * (1 / Math.max(0.001, edge)) * 0.6;
      if (!rng.chance(Math.max(0, Math.min(1, keep)))) continue;
      // top-left of the blot catches the light, the far side sinks a step
      const k = base + (grad ? (dx + dy < -0.5 ? 1 : dx + dy > 0.6 ? -1 : 0) : 0);
      setPx(p, x, y, step(keys, k));
    }
  }
}

/** A hanging chain: alternating link pairs down a column. */
function chainRun(p, x, y0, y1, keys) {
  for (let y = y0; y <= y1; y++) {
    const o = (y - y0) % 4;
    if (o === 0 || o === 1) { setPx(p, x, y, step(keys, 4)); setPx(p, x + 1, y, step(keys, 2)); setPx(p, x + 2, y, step(keys, 1)); }
    else if (o === 2) { setPx(p, x, y, step(keys, 3)); setPx(p, x + 2, y, step(keys, 1)); }
    else { setPx(p, x + 1, y, step(keys, 3)); }
  }
}

/** A candle flame: a teardrop of fire with a pale core. */
function flameTip(p, cx, yBase, h, keys) {
  for (let i = 0; i < h; i++) {
    const y = yBase - i, w = i < h - 1 ? (i === 0 ? 1 : 0) : 0;
    for (let x = cx - w; x <= cx + w; x++) setPx(p, x, y, step(keys, i >= h - 2 ? 4 : 2 + (i % 2)));
  }
  setPx(p, cx, yBase - 1, '*');
}

// ============================================================================== STANDING SCATTER

/**
 * One skull. The cheapest storytelling in the catalogue, and the piece that carries the crypt.
 *
 * FOURTEEN TEXELS ACROSS — nearly half a tile, and twice what shipped. HeroQuest puts TEN of these
 * on a board that has twelve pieces of furniture, and it can do that because each one is a chunky,
 * instantly-named shape you read from a metre away. The first pass drew it ten texels wide with
 * two-texel sockets and it measured, in the 'dressing' plate at 6x, as floor grit.
 *
 * THE SHADING IS DELIBERATELY SHALLOW (`mid` high, `gain` low), and the bone base is near-white:
 * the skull has to sit ABOVE the flagstone's mid value or it is a pebble, and bone's ramp saturates
 * hard on the way down, so a skull shaded at the cast's usual contrast puts a third of itself into
 * a coloured dark. The sockets and the gaps between the teeth carry the contrast instead, in ink.
 */
function skullPix(v, keys = 'FGHIJ') {
  const p = makePix(16, 15);
  ell(p, 7.5, 5.8, 6.6, 5.4, 'H');                          // the cranium
  box(p, 4, 9, 11, 12, 'H');                                // the muzzle
  box(p, 5, 13, 10, 13, 'H');                               // the jaw
  const q = model(p, keys, { up: 0.75, gain: 0.4, mid: 0.7, dome: 0.14, local: 0.3 });
  for (const ox of [2, 9]) {                                // the sockets: FIVE texels of hole each
    box(q, ox, 5, ox + 4, 7, '%');
    span(q, ox, ox + 4, 4, keys, 4, 0);                     // the brow over each, taking the key light
    setPx(q, ox + 1, 8, '%'); setPx(q, ox + 3, 8, '%');     // the cheekbone's shadow under it
  }
  box(q, 7, 9, 8, 10, '%');                                 // the nose
  span(q, 5, 10, 11, keys, 4, 0);                           // the lit ridge over the teeth
  for (const x of [4, 6, 8, 10]) { setPx(q, x, 12, '%'); setPx(q, x, 13, '%'); }   // between the teeth
  if (v >= 1) for (const [x, y] of [[10, 1], [11, 2], [12, 3], [12, 4]]) setPx(q, x, y, '%');   // a crack
  if (v >= 2) {                                             // the jaw is gone and the crown is stove in
    for (let x = 4; x <= 11; x++) { setPx(q, x, 12, 0); setPx(q, x, 13, 0); }
    span(q, 5, 10, 11, keys, 2, 0);
    for (const [x, y] of [[3, 1], [4, 0], [5, 1], [11, 0]]) setPx(q, x, y, 0);
  }
  return q;
}
function artSkull(v) { return wear(skullPix(v), v, 'FGHIJ', `skull${v}`, 0.4); }

/**
 * A heap of skulls. EACH SKULL IS SHADED ON ITS OWN and then stacked, rather than the heap being
 * modelled as one lump: a lump gets one lit side and one dark side and reads as a boulder, while
 * four separately-lit skulls read as four skulls. The ones behind are dropped a step so the pile
 * has depth.
 */
function artSkullPile(v) {
  const p = makePix(30, 24), F = 'FGHIJ';
  const one = skullPix(Math.min(2, v));
  const stack = [[0, 9, 0], [13, 9, 0], [6, 0, 1], [8, 12, -1]];
  const n = v >= 2 ? 3 : 4;
  for (let i = 0; i < n; i++) {
    const [ox, oy, lift] = stack[i];
    for (let y = 0; y < one.h; y++) for (let x = 0; x < one.w; x++) {
      const k = String.fromCharCode(one.d[y * one.w + x] || 0);
      if (!one.d[y * one.w + x]) continue;
      const idx = F.indexOf(k);
      setPx(p, x + ox, y + oy, idx >= 0 ? step(F, idx + lift) : k);
    }
  }
  span(p, 1, 28, 23, F, 2, 0);                              // the heap meets the floor
  return wear(p, v, F, `skullPile${v}`, 0.5);
}

/**
 * A rat. Scatter, never an entity, never fought — a shape that moves in the corner of the eye.
 *
 * TWENTY-FOUR TEXELS LONG, three quarters of a tile, and drawn twice over. The version before this
 * one was measured at the play camera and named, exactly, "an unidentifiable beige lozenge": it was
 * a shaded ellipse in the floor's own tan with the details too small and too pale to survive. See
 * the four things inside that fix that, and the note on which way it faces.
 */
function artRat(v) {
  const p = makePix(24, 16), H = 'abcdefg';
  // FOUR THINGS MAKE A RAT AND NOT A BREAD ROLL, and the first pass had none of them: a HUNCHED BACK
  // drawn as a curve rather than an ellipse, a HEAD slung below the shoulder with a tapering snout,
  // one ROUND EAR on the crown, and a long bare TAIL trailing off the rump.
  //
  // IT FACES LEFT, WHICH IS NOT AN ARBITRARY CHOICE. The house key light is top-LEFT on every piece
  // (style.js `LIT`), so a rat drawn nose-right puts its whole head in the shade and comes out of
  // the plate as a dark smear with a lit rump — measured. Nose-left, the muzzle, the brow and the
  // ear take the key and the tail end is the part that falls away.
  const back = [7, 6, 5, 5, 5, 5, 6, 6, 7, 7, 8, 8];        // the back's top row at x = 8..19
  for (let i = 0; i < back.length; i++) for (let y = back[i]; y <= 12; y++) setPx(p, 8 + i, y, 'd');
  ell(p, 18, 10, 2.8, 2.6, 'd');                            // the rump
  ell(p, 5.5, 9.5, 3.8, 2.8, 'd');                          // the head
  for (let x = 0; x <= 2; x++) for (let y = 9 + (2 - x) * 0; y <= 11 - (2 - x); y++) setPx(p, x, y, 'd');  // the snout
  ell(p, 7.5, 5.6, 2.1, 2.1, 'd');                          // the ear on the crown
  // SHADED DOWN, not up: at twenty-four texels on a lit tan flagstone the rat has to be the DARK
  // shape and its spine the light one, or it is a beige lozenge again whatever else is drawn on it.
  const q = model(p, H, { up: 0.7, gain: 0.5, mid: 0.26, dome: 0.1, local: 0.24 });
  for (let i = 0; i < back.length; i++) {                   // the lit ridge that draws the hunch
    setPx(q, 8 + i, back[i], step(H, 6)); setPx(q, 8 + i, back[i] + 1, step(H, 4));
  }
  for (let x = 1; x <= 19; x++) setPx(q, x, 12, step(H, 0));   // the belly, in shadow under it
  for (let x = 1; x <= 5; x++) setPx(q, x, 8, step(H, 6));     // the lit top of the muzzle
  setPx(q, 6, 8, step(H, 5)); setPx(q, 2, 9, step(H, 5));
  ell(q, 7.5, 5.6, 1.0, 1.0, step(H, 0));                     // the ear's hollow
  setPx(q, 6, 4, step(H, 6)); setPx(q, 7, 3, step(H, 6)); setPx(q, 8, 4, step(H, 5));   // its lit rim
  setPx(q, 4, 9, '%'); setPx(q, 3, 9, step(H, 6));            // the eye, and the glint before it
  setPx(q, 0, 10, '%');                                       // the nose
  for (const x of [7, 13]) { setPx(q, x, 13, step(H, 1)); setPx(q, x, 14, '%'); setPx(q, x + 1, 14, '%'); }
  // THE TAIL: a bare rope trailing off the rump and lifting at its tip. Drawn after the modelling so
  // it holds one clean value, and STEPPED rather than ruled — a one-texel diagonal comes out of the
  // outline pass as a checkerboard.
  for (const [x, y] of [[20, 11], [21, 11], [22, 11], [23, 10], [23, 9], [23, 8]]) setPx(q, x, y, step(H, 3));
  for (const [x, y] of [[21, 10], [22, 10]]) setPx(q, x, y, step(H, 4));
  if (v >= 1) { setPx(q, 13, 5, 0); setPx(q, 14, 5, 0); setPx(q, 15, 6, step(H, 2)); }   // a mangier back
  return q;
}

/** A candlestick, guttering. v0 tall and lit, v1 burnt down, v2 a cold stub in a pool of wax. */
function artCandlestick(v) {
  const p = makePix(12, 30), M = 'mnopq', W = 'FGHIJ', A = 'ABCDE';
  const h = v === 0 ? 9 : v === 1 ? 15 : 22;                 // the wax burns DOWN as v rises
  ell(p, 5.5, 27, 4.6, 2.2, 'o');                            // the foot
  span(p, 1, 10, 26, M, 4, 1); span(p, 2, 9, 25, M, 5, 1);
  for (let y = 20; y <= 25; y++) span(p, 4, 7, y, M, 3, 1);   // the stem
  span(p, 2, 9, 19, M, 5, 1); span(p, 3, 8, 20, M, 3, 1);     // the drip pan
  for (let y = h; y <= 18; y++) span(p, 4, 7, y, W, 3, 1);    // the candle
  span(p, 4, 7, h, W, 4, 1);
  for (const [x, y] of [[3, h + 4], [8, h + 7], [3, h + 9], [8, h + 2]]) {   // the runs of spilt wax
    setPx(p, x, y, step(W, 4)); setPx(p, x, y + 1, step(W, 3)); setPx(p, x, y + 2, step(W, 2));
  }
  if (v < 2) flameTip(p, 5, h - 1, 6, A);
  return wear(p, v, W, `candlestick${v}`, 0.3);
}

/** Bottles: the guardroom's real furniture. v2 is one tipped over and two empty. */
function artBottles(v) {
  const p = makePix(22, 20), G = 'ABCDE', K = 'FGHIJ';
  const bottle = (cx, top) => {
    for (let y = top + 6; y <= 18; y++) span(p, cx - 3, cx + 3, y, G, 2, 1);        // the body
    span(p, cx - 3, cx + 3, top + 5, G, 3, 1);                                      // the shoulder
    for (let y = top + 2; y <= top + 4; y++) span(p, cx - 1, cx + 1, y, G, 3, 1);   // the neck
    span(p, cx - 2, cx + 2, top, K, 3, 1); span(p, cx - 2, cx + 2, top + 1, K, 2, 1);  // a wax stopper
    for (let y = top + 7; y <= 16; y++) setPx(p, cx - 3, y, step(G, 4));            // the catch-light
    setPx(p, cx - 2, top + 6, step(G, 4));
  };
  bottle(5, 3);
  bottle(16, 6);
  if (v <= 1) bottle(10, 0);
  if (v >= 2) {                                                                     // the tipped one
    for (let x = 11; x <= 20; x++) { span(p, x, x, 15, G, 2, 0); span(p, x, x, 16, G, 3, 0); span(p, x, x, 17, G, 1, 0); }
    span(p, 11, 13, 14, K, 3, 0);
  }
  span(p, 1, 20, 19, G, 1, 0);
  return wear(p, v, G, `bottles${v}`, 0.35);
}

/** Two tankards, one on its side, with the ale still in one of them. */
function artTankards(v) {
  const p = makePix(22, 20), I = 'hijkl', A = 'ABCDE';
  const mug = (cx, y0) => {
    for (let y = y0 + 2; y <= y0 + 13; y++) span(p, cx - 5, cx + 5, y, I, 3, 1);     // the barrel of it
    ell(p, cx, y0 + 13, 5.4, 2.0, step(I, 1));                                       // the foot
    ell(p, cx, y0 + 2, 5.4, 2.4, step(I, 5));                                        // the rim, seen from above
    ell(p, cx, y0 + 2, 3.6, 1.4, step(A, 1));                                        // and the dark ale in it
    for (const y of [y0 + 5, y0 + 10]) span(p, cx - 5, cx + 5, y, I, 5, 1);          // two iron bands
    for (const [dx, dy] of [[6, 0], [7, 1], [7, 2], [7, 3], [6, 4]]) {               // a C HANDLE, standing off it
      setPx(p, cx + dx, y0 + 5 + dy, step(I, 5)); setPx(p, cx + dx - 1, y0 + 5 + dy, step(I, 2));
    }
  };
  mug(6, 1);
  if (v === 0) mug(14, 6);
  else {                                                                             // the second one, on its side
    for (let x = 12; x <= 21; x++) { span(p, x, x, 14, I, 3, 0); span(p, x, x, 15, I, 5, 0); span(p, x, x, 16, I, 2, 0); }
    ell(p, 12, 15, 1.6, 2.4, step(I, 4));
  }
  return wear(p, v, I, `tankards${v}`, 0.3);
}

/** Bone dice and the cup they were thrown from: fifteen texels of somebody's evening. */
function artDice(v) {
  const p = makePix(15, 11), F = 'FGHIJ', I = 'hijkl';
  const die = (x, y) => {
    topFace(p, x, y, 5, 5, F, { base: 5, taper: 0.88 });
    frontFace(p, x, y + 3, y + 5, 5, F, { base: 3, fall: 1 });
    setPx(p, x, y + 1, '%');                                  // one pip on the top face
    setPx(p, x - 1, y + 4, '%'); setPx(p, x + 1, y + 5, '%'); // two on the face toward us
  };
  die(3, 0); die(9, 3);
  if (v >= 1) {                                               // the cup they were thrown from, spilled
    for (let x = 9; x <= 14; x++) { span(p, x, x, 9, I, 3, 0); span(p, x, x, 10, I, 1, 0); }
    span(p, 9, 11, 8, I, 5, 0);
  }
  return p;
}

/** A stalagmite: wet cave stone, rising in uneven steps. */
function artStalagmite(v) {
  const p = makePix(16, 30), S = 'rstuv';
  const r = createRng(`dressing:stalagmite:${v}`);
  const top = 4 + v * 3;                                    // deeper wear = a stubbier stone
  for (let y = top; y < 28; y++) {
    const t = (y - top) / (28 - top);
    const w = 1 + Math.round(t * 5.5) + (r.chance(0.2) ? 1 : 0);
    span(p, 7 - w, 8 + w, y, S, 3, 1);
  }
  const q = model(p, S, { up: 0.4, dome: 0.12, local: 0.5 });
  for (let i = 0; i < 5 + v; i++) {                         // the wet flowstone banding
    const y = r.int(top + 2, 26);
    span(q, 7 - r.int(1, 3), 8 + r.int(1, 3), y, S, 4, 0);
  }
  span(q, 1, 14, 28, S, 1, 0);
  return wear(q, v, S, `stalagmite${v}`, 0.3);
}

/** Flowstone from ceiling to floor: the piece that says this room is older than the keep. */
function artDripstone(v) {
  const p = makePix(18, 46), S = 'rstuv';
  const r = createRng(`dressing:dripstone:${v}`);
  for (let y = 0; y < 45; y++) {
    const waist = Math.abs(y - 22) / 22;                    // pinched in the middle
    const w = 1 + Math.round(waist * 4.2) + (r.chance(0.16) ? 1 : 0);
    span(p, 8 - w, 9 + w, y, S, 3, 1);
  }
  const q = model(p, S, { up: 0.32, dome: 0.1, local: 0.55 });
  for (let i = 0; i < 10; i++) {                            // vertical flutes
    const x = r.int(5, 12);
    for (let y = r.int(2, 20), n = r.int(6, 16); n > 0 && y < 44; n--, y++) if (getPx(q, x, y)) setPx(q, x, y, step(S, 4));
  }
  span(q, 3, 14, 45, S, 1, 0);
  return wear(q, v, S, `dripstone${v}`, 0.25);
}

/**
 * Pale caps on a cave floor. From v2 they carry their own faint light (AMBIENCE §7 `fungal`).
 * Each cap is a DOME with a dark gill line under it and a stalk you can see: three caps at three
 * heights read as a cluster, four identical discs read as a stain.
 */
function artMushroomCluster(v) {
  const p = makePix(22, 18), C = 'ABCDE', T = 'FGHIJ';
  const caps = [[12, 5, 6], [5, 9, 4.5], [17, 11, 3.5], [9, 12, 3]];
  const n = v >= 3 ? 2 : v === 2 ? 3 : 4;
  for (let i = 0; i < n; i++) {
    const [cx, cy, rr] = caps[i];
    for (let y = cy + 1; y <= 16; y++) span(p, cx - 1, cx, y, T, 3, 1);        // the stalk
  }
  for (let i = 0; i < n; i++) {
    const [cx, cy, rr] = caps[i];
    for (let y = Math.round(cy - rr * 0.72); y <= cy; y++) {                    // the dome
      const t = (cy - y) / (rr * 0.72);
      const w = Math.round(rr * Math.sqrt(Math.max(0, 1 - t * t)));
      span(p, cx - w, cx + w, y, C, 3 + (y < cy - rr * 0.4 ? 1 : 0), 1);
    }
    span(p, cx - Math.round(rr), cx + Math.round(rr), cy + 1, C, 0, 0);         // the gills, in shade
    setPx(p, cx - Math.round(rr * 0.6), Math.round(cy - rr * 0.5), step(C, 4)); // the light on the cap
    if (v >= 2) setPx(p, cx - Math.round(rr * 0.6) + 1, Math.round(cy - rr * 0.5), '*');
  }
  span(p, 2, 19, 17, T, 1, 0);
  return wear(p, Math.max(0, v - 1), C, `mushroom${v}`, 0.3);
}

// ================================================================================= FLOOR DECALS
// Every one of these is drawn IN PLAN on a 32-texel tile, mostly transparent, with broken edges.

/** Scattered bone: a ribcage that came apart and the long bones somebody kicked aside. */
function artBones(v) {
  const p = makePix(DECAL_PX, DECAL_PX), F = 'FGHIJ', S = 'rstuv';
  const r = createRng(`dressing:bones:${v}`);
  const shade = step(S, 0);
  for (let i = 0; i < 3 + v; i++) {
    const x0 = r.int(4, 24), y0 = r.int(5, 25), a = r.float(0, Math.PI * 2), len = r.int(5, 11);
    boneStroke(p, x0, y0, Math.round(x0 + Math.cos(a) * len), Math.round(y0 + Math.sin(a) * len), F, shade);
  }
  if (v <= 1) {                                             // the ribcage, still hooped
    const cx = 12, cy = 17;
    for (let i = 0; i < 5; i++) {
      const y = cy - 6 + i * 3;
      for (let t = -1; t <= 1; t += 0.14) {
        const x = Math.round(cx + t * 7), yy = Math.round(y + Math.abs(t) * 1.6);
        setPx(p, x + 1, yy + 1, shade); setPx(p, x, yy, step(F, 3));
      }
    }
    for (let y = cy - 7; y <= cy + 7; y++) setPx(p, cx, y, step(F, 2));       // the spine
  }
  return p;
}

/** Grit and chips spilling from one corner of the tile. */
function artScree(v) {
  const p = makePix(DECAL_PX, DECAL_PX), S = 'rstuv';
  const r = createRng(`dressing:scree:${v}`);
  const cx = r.int(9, 22), cy = r.int(9, 22);
  for (let i = 0; i < 60 + v * 34; i++) {
    const a = r.float(0, Math.PI * 2), d = Math.sqrt(r.next()) * (11 + v * 3.5);
    const x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d * 0.95);
    const w = r.chance(0.24) ? 1 : 0;
    setPx(p, x + 1, y + 1, step(S, 0));                     // the chip's own shade
    for (let k = 0; k <= w; k++) setPx(p, x + k, y, step(S, r.int(2, 4)));
  }
  return p;
}

/**
 * Standing water.
 *
 * A PUDDLE IS DARK AND THE LIGHT IN IT IS A SLIVER. The first version filled its blot with the
 * middle of a blue ramp and came out of the 'dressing' plate as a saturated blue disc — a puddle of
 * slime. Water on stone is DARKER than the stone (it swallows the light) except for the two or
 * three texels where it hands the ceiling back, so the body sits in the bottom of its ramp, the
 * flagstone around it goes one step down where the damp has crept in, and the reflection is a
 * broken streak in the top-left third and nothing else.
 */
function artPuddle(v) {
  const p = makePix(DECAL_PX, DECAL_PX), W = 'ABCDE', S = 'rstuv';
  const r = createRng(`dressing:puddle:${v}`);
  const rx = 13 - v * 3, ry = 10 - v * 2.4;
  blot(p, 15, 17, rx, ry, W, r, { base: 1, grad: 0, edge: 0.45 });
  for (let i = 0; i < 40; i++) {                            // the body is not one flat tone
    const a = r.float(0, Math.PI * 2), d = Math.sqrt(r.next());
    const x = Math.round(15 + Math.cos(a) * d * rx * 0.85), y = Math.round(17 + Math.sin(a) * d * ry * 0.85);
    if (getPx(p, x, y)) setPx(p, x, y, step(W, 2));
  }
  // the damp rim: the flagstone one step darker where the water has crept into it
  for (let y = 0; y < DECAL_PX; y++) for (let x = 0; x < DECAL_PX; x++) {
    if (getPx(p, x, y)) continue;
    let near = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (getPx(p, x + dx, y + dy)) near++;
    if (near && r.chance(0.55)) setPx(p, x, y, step(S, 1));
  }
  if (v < 2) {                                              // the reflection: a broken bright streak
    for (let i = 0; i < 7; i++) if (r.chance(0.75)) setPx(p, 9 + i, 13 + (i % 2), step(W, 4));
    for (let i = 0; i < 4; i++) if (r.chance(0.6)) setPx(p, 12 + i, 16, step(W, 3));
    setPx(p, 11, 13, '*');
  }
  return p;
}

/** Old blood: a spatter with a dragged edge. Brown by v2, and never bright. */
function artBloodstain(v) {
  const p = makePix(DECAL_PX, DECAL_PX), B = 'ABCDE';
  const r = createRng(`dressing:bloodstain:${v}`);
  blot(p, 15, 16, 11 - v, 9 - v * 0.8, B, r, { base: 1 + (v >= 2 ? 1 : 0), grad: 0, edge: 0.42 });
  for (let i = 0; i < 16 + v * 5; i++) {                    // the thrown drops
    const a = r.float(0, Math.PI * 2), d = r.float(11, 15.5);
    setPx(p, Math.round(15 + Math.cos(a) * d), Math.round(16 + Math.sin(a) * d * 0.9), step(B, 1));
  }
  if (v === 0) for (let i = 0; i < 9; i++) setPx(p, 22 + (i >> 1), 18 + i, step(B, 2));   // the drag
  return p;
}

/** A soot star: something burned here and the smoke went straight up. */
function artScorch(v) {
  const p = makePix(DECAL_PX, DECAL_PX), K = 'ABCDE';
  const r = createRng(`dressing:scorch:${v}`);
  blot(p, 16, 16, 8.5, 7.2, K, r, { base: 1, grad: 0, edge: 0.3 });
  for (let i = 0; i < 20; i++) {                            // the licks that ran outward
    const a = r.float(0, Math.PI * 2), len = r.int(8, 16 - v * 2);
    for (let d = 6; d < len; d++) {
      if (!r.chance(1 - d / (len + 4))) continue;
      setPx(p, Math.round(16 + Math.cos(a) * d), Math.round(16 + Math.sin(a) * d * 0.92), step(K, d < 10 ? 2 : 3));
    }
  }
  if (v === 0) for (let i = 0; i < 8; i++) setPx(p, 13 + r.int(0, 6), 13 + r.int(0, 6), step(K, 4));  // hot ash
  return p;
}

/** Split flagstones: the mason's own vocabulary — a cut, a lit lip, and the grit that came up. */
function artCrackedFlags(v) {
  const p = makePix(DECAL_PX, DECAL_PX), S = 'rstuv';
  const r = createRng(`dressing:crackedFlags:${v}`);
  let x = r.int(2, 8), y = 0;
  const walk = () => {
    while (y < DECAL_PX) {
      setPx(p, x - 1, y, step(S, 4));                       // the top-left lip catches the light
      setPx(p, x + 1, y, step(S, 1));                       // and the far side falls away
      setPx(p, x, y, step(S, 0));                           // the cut itself
      y += 1;
      x += r.int(-1, 1);
      if (r.chance(0.18)) { setPx(p, x, y, step(S, 0)); x += r.int(0, 1); }
      x = Math.max(1, Math.min(DECAL_PX - 3, x));
    }
  };
  walk();
  if (v >= 1) { x = r.int(16, 26); y = 0; walk(); }
  for (let i = 0; i < 8 + v * 10; i++) {                    // chips along the crack
    const yy = r.int(1, 30);
    setPx(p, Math.max(1, Math.min(30, x + r.int(-6, 6))), yy, step(S, r.int(1, 3)));
  }
  return p;
}

/**
 * Laid tesserae, losing tiles.
 *
 * THE FIRST VERSION OF THIS WAS A BEAD CURTAIN: two-texel tesserae on a three-texel pitch in
 * saturated brass, blue and red, which at the play camera came out as a regular grid of coloured
 * dots — the one thing on the whole floor that looked printed on. Measured in the 'default' shot at
 * 4x. So: THREE-texel tesserae on a four-texel pitch (chunky enough to be stone, not beads), the
 * field in the flagstones' own grey, a dull ochre border and a slate rosette, and every tone taken
 * from the middle of its ramp so nothing on the floor out-shouts the furniture standing on it.
 */
function artMosaic(v) {
  const p = makePix(DECAL_PX, DECAL_PX), A = 'ABCDE', M = 'mnopq', S = 'rstuv';
  const r = createRng(`dressing:mosaic:${v}`);
  const keep = 1 - v * 0.22;
  for (let ty = 1; ty < 30; ty += 4) for (let tx = 1; tx < 30; tx += 4) {
    const dx = tx + 1.5 - 16, dy = ty + 1.5 - 16, d = Math.hypot(dx, dy);
    if (d > 14.5 || !r.chance(keep)) continue;
    const keys = d < 4.6 ? A : d < 11 ? S : M;              // rosette · field · border
    const base = d < 4.6 ? 2 : 3;
    const k = step(keys, base + (r.chance(0.28) ? 1 : 0));
    box(p, tx, ty, tx + 2, ty + 2, k);
    setPx(p, tx, ty, step(keys, base + 1));                 // each tessera's own lit corner
    setPx(p, tx + 2, ty + 2, step(keys, base - 1));         // and the grout shadow under it
  }
  return p;
}

/**
 * A woven square, fringed on two edges.
 *
 * THE FIRST ONE WAS A RED POSTAGE STAMP: cloth painted at the top of its ramp with a gold motif,
 * which at the play camera was the brightest thing in the room including the fire. A rug on a
 * dungeon floor is a DARK, DUSTY textile — it is the thing light falls on, not a thing that emits.
 * So: a dark madder base painted in the bottom half of its ramp, the weave carried by alternating
 * two adjacent steps texel by texel (which is what makes it read as cloth rather than as paper),
 * a dull ochre border, and a frayed edge that lets the flagstone show through.
 */
function artRug(v) {
  const p = makePix(DECAL_PX, DECAL_PX), C = 'ABCDE', M = 'mnopq';
  const r = createRng(`dressing:rug:${v}`);
  const L = 3, R = 28, T = 4, B = 27;
  for (let y = T; y <= B; y++) for (let x = L; x <= R; x++) {
    const frayed = x <= L + 1 || x >= R - 1 || y <= T + 1 || y >= B - 1;
    if (frayed && r.chance(0.35)) continue;                  // the edge has gone
    if (v >= 1 && !r.chance(1 - v * 0.18)) continue;         // and so, later, has the middle
    const weave = (x + y) & 1;                               // over, under, over
    const border = x <= L + 3 || x >= R - 3 || y <= T + 3 || y >= B - 3;
    setPx(p, x, y, border ? step(M, 1 + weave) : step(C, 1 + weave));
  }
  for (let i = 0; i <= 5; i++) {                             // a lozenge, one step up and no more
    for (let j = -4 + i; j <= 4 - i; j++) {
      if (getPx(p, 15 + j, 11 + i)) setPx(p, 15 + j, 11 + i, step(C, 3));
      if (getPx(p, 15 + j, 20 - i)) setPx(p, 15 + j, 20 - i, step(C, 3));
    }
  }
  for (let x = L; x <= R; x++) {                             // fringe, top and bottom
    if (!r.chance(0.6)) continue;
    setPx(p, x, T - 1, step(C, 2)); if (r.chance(0.5)) setPx(p, x, T - 2, step(C, 1));
    setPx(p, x, B + 1, step(C, 2)); if (r.chance(0.5)) setPx(p, x, B + 2, step(C, 1));
  }
  for (let x = L + 2; x <= R - 2; x++) if (getPx(p, x, T + 2)) setPx(p, x, T + 2, step(M, 2));  // the lit top edge of the pile
  return p;
}

/** One segment of a long carpet: it runs off both ends of the tile (AMBIENCE §5.4 run piece). */
function artRunner(v) {
  const p = makePix(DECAL_PX, DECAL_PX), C = 'ABCDE', M = 'mnopq';
  const r = createRng(`dressing:runner:${v}`);
  const T = 7, B = 24;
  for (let y = T; y <= B; y++) for (let x = 0; x < DECAL_PX; x++) {
    if ((y <= T + 1 || y >= B - 1) && r.chance(0.3)) continue;
    const weave = (x + y) & 1;
    const border = y <= T + 2 || y >= B - 2;
    setPx(p, x, y, border ? step(M, 1 + weave) : step(C, 1 + weave));
  }
  for (let x = (v === 0 ? 3 : 7); x < DECAL_PX; x += 8) {    // the woven motif, offset per segment
    for (let j = -3; j <= 3; j++) {
      const y0 = 15 - Math.abs(j), y1 = 16 + Math.abs(j);
      if (getPx(p, x + j, y0)) setPx(p, x + j, y0, step(C, 3));
      if (getPx(p, x + j, y1)) setPx(p, x + j, y1, step(C, 3));
    }
  }
  for (let x = 0; x < DECAL_PX; x++) if (getPx(p, x, T + 2)) setPx(p, x, T + 2, step(M, 2));
  return p;
}

/** Chalk: a drawn circle and the marks inside it. Dashed, because chalk on stone always is. */
function artChalkSigil(v) {
  const p = makePix(DECAL_PX, DECAL_PX), W = 'ABCDE';
  const r = createRng(`dressing:chalkSigil:${v}`);
  const keep = 0.8 - v * 0.2;
  for (const rad of [12, 10]) {
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      if (!r.chance(keep)) continue;
      setPx(p, Math.round(16 + Math.cos(a) * rad), Math.round(16 + Math.sin(a) * rad), step(W, r.int(2, 4)));
    }
  }
  for (let i = 0; i < 5; i++) {                             // the star inside
    const a0 = (i / 5) * Math.PI * 2 - 1.57, a1 = ((i + 2) / 5) * Math.PI * 2 - 1.57;
    const x0 = Math.round(16 + Math.cos(a0) * 9), y0 = Math.round(16 + Math.sin(a0) * 9);
    const x1 = Math.round(16 + Math.cos(a1) * 9), y1 = Math.round(16 + Math.sin(a1) * 9);
    const q = makePix(DECAL_PX, DECAL_PX);
    line(q, x0, y0, x1, y1, step(W, 3));
    for (let y = 0; y < DECAL_PX; y++) for (let x = 0; x < DECAL_PX; x++) if (q.d[y * DECAL_PX + x] && r.chance(keep)) setPx(p, x, y, q.d[y * DECAL_PX + x]);
  }
  return p;
}

/** An alchemical spill: it ate into the stone, and at v0 it is still faintly alight. */
function artSpill(v) {
  const p = makePix(DECAL_PX, DECAL_PX), G = 'ABCDE';
  const r = createRng(`dressing:spill:${v}`);
  blot(p, 15, 17, 10.5 - v, 8 - v * 0.8, G, r, { base: 1, grad: 0, edge: 0.36 });
  for (let i = 0; i < 7; i++) {                             // the runs it made down the slope
    const x = 9 + i * 2 + r.int(-1, 1);
    for (let y = 21; y < 21 + r.int(2, 6); y++) setPx(p, x, y, step(G, 1));
  }
  if (v === 0) { blot(p, 15, 17, 3.4, 2.4, G, r, { base: 4, grad: 0, edge: 0.9 }); setPx(p, 14, 16, '*'); }
  return p;
}

/** Hearth ash: soft grey powder with the black bits that would not burn. */
function artAshBed(v) {
  const p = makePix(DECAL_PX, DECAL_PX), K = 'ABCDE';
  const r = createRng(`dressing:ashBed:${v}`);
  blot(p, 16, 17, 13, 10, K, r, { base: 3, grad: 1, edge: 0.28 });
  for (let i = 0; i < 26; i++) {                            // charcoal
    const a = r.float(0, Math.PI * 2), d = Math.sqrt(r.next()) * 9;
    const x = Math.round(16 + Math.cos(a) * d), y = Math.round(17 + Math.sin(a) * d * 0.8);
    setPx(p, x, y, step(K, 0)); if (r.chance(0.4)) setPx(p, x + 1, y, step(K, 1));
  }
  return p;
}

/** A FEW DROPPED COINS. Decoration, not loot: dull brass, no glint, no bob, no glow (AMBIENCE §9). */
function artCoins(v) {
  const p = makePix(DECAL_PX, DECAL_PX), M = 'mnopq', S = 'rstuv';
  const r = createRng(`dressing:coins:${v}`);
  const n = 5 - v;
  const cx0 = r.int(12, 19), cy0 = r.int(13, 20);
  for (let i = 0; i < n; i++) {
    const cx = cx0 + r.int(-6, 6), cy = cy0 + r.int(-6, 6);
    ell(p, cx + 1, cy + 1, 2.8, 2.4, step(S, 0));           // the coin's own little shadow
    ell(p, cx, cy, 2.8, 2.4, step(M, 2));                   // DULL: a coin on the floor is not loot
    setPx(p, cx - 1, cy - 1, step(M, 3));                   // one lit texel, top-left, and no more
    setPx(p, cx, cy - 2, step(M, 3));
    setPx(p, cx + 1, cy + 1, step(M, 1));
  }
  return p;
}

/** A fungal mat: mottled, with the little dots that are the fruiting bodies. */
function artSporePatch(v) {
  const p = makePix(DECAL_PX, DECAL_PX), G = 'ABCDE';
  const r = createRng(`dressing:sporePatch:${v}`);
  blot(p, 16, 16, 11 - v, 9 - v, G, r, { base: 1, grad: 1, edge: 0.3 });
  for (let i = 0; i < 30; i++) {
    const a = r.float(0, Math.PI * 2), d = Math.sqrt(r.next()) * (10 - v);
    setPx(p, Math.round(16 + Math.cos(a) * d), Math.round(16 + Math.sin(a) * d * 0.9), step(G, r.chance(0.3) ? 4 : 3));
  }
  return p;
}

/** Lichen: pale rings that grew outward and died in the middle. */
function artLichen(v) {
  const p = makePix(DECAL_PX, DECAL_PX), G = 'ABCDE';
  const r = createRng(`dressing:lichen:${v}`);
  for (let i = 0; i < 3 + v; i++) {
    const cx = r.int(7, 24), cy = r.int(7, 24), rad = r.float(3.5, 7);
    for (let a = 0; a < Math.PI * 2; a += 0.08) {
      const rr = rad * r.float(0.86, 1.06);
      if (r.chance(0.7)) setPx(p, Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr * 0.92), step(G, 3));
      if (r.chance(0.35)) setPx(p, Math.round(cx + Math.cos(a) * rr * 0.7), Math.round(cy + Math.sin(a) * rr * 0.65), step(G, 1));
    }
  }
  return p;
}

/**
 * Frost bloom: FEATHERS of rime creeping in from the edges of the slab — a spine with barbs off it,
 * not a random walk. The random walk read as somebody had scratched the floor with a nail.
 */
function artRime(v) {
  const p = makePix(DECAL_PX, DECAL_PX), W = 'ABCDE';
  const r = createRng(`dressing:rime:${v}`);
  for (let i = 0; i < 10 - v * 3; i++) {
    const side = r.int(0, 3);
    let x = side === 0 ? r.int(0, 3) : side === 1 ? r.int(28, 31) : r.int(3, 28);
    let y = side === 2 ? r.int(0, 3) : side === 3 ? r.int(28, 31) : r.int(3, 28);
    const a = Math.atan2(15.5 - y, 15.5 - x) + r.float(-0.5, 0.5);
    const len = r.int(7, 14);
    for (let n = 0; n < len; n++) {
      const px = Math.round(x + Math.cos(a) * n), py = Math.round(y + Math.sin(a) * n);
      setPx(p, px, py, step(W, n < len * 0.5 ? 4 : 2));      // the spine, thinning inward
      if (n % 2 || n > len - 2) continue;
      const b = 2 + Math.round((1 - n / len) * 3);            // the barbs, longest at the root
      for (let k = 1; k <= b; k++) {                          // one each side, at 60 degrees
        for (const s of [-1, 1]) {
          const bx = Math.round(px + Math.cos(a + s * 1.05) * k), by = Math.round(py + Math.sin(a + s * 1.05) * k);
          if (r.chance(0.85)) setPx(p, bx, by, step(W, k === 1 ? 4 : 3));
        }
      }
    }
  }
  return p;
}

/** An iron grate over a hole: bars, a rebate, and the dark under it. */
function artDrainGrate(v) {
  const p = makePix(DECAL_PX, DECAL_PX), I = 'hijkl', S = 'rstuv';
  const r = createRng(`dressing:drainGrate:${v}`);
  box(p, 8, 9, 24, 23, '%');                                // the hole
  for (let y = 9; y <= 23; y += 3) span(p, 8, 24, y, I, 3, 1);   // the bars
  for (const [x0, y0, x1, y1] of [[7, 8, 25, 8], [7, 24, 25, 24]]) for (let x = x0; x <= x1; x++) { setPx(p, x, y0, step(S, 4)); setPx(p, x, y1, step(S, 1)); }
  for (let y = 8; y <= 24; y++) { setPx(p, 7, y, step(S, 4)); setPx(p, 25, y, step(S, 1)); }
  if (v >= 1) for (let i = 0; i < 10; i++) setPx(p, r.int(9, 23), r.int(10, 22), step(S, 1));  // silted up
  return p;
}

// =============================================================================== WALL DRESSING
// Upright, in the wall's own plane, bottom art row at the type's `mountY` — and painted to FILL the
// band `wallPlate()` wins back for it (see the essay there). Two rules hold this whole section
// together, and the previous pass broke both:
//
//   1. PAINT BIG. A hung piece is drawn on the same texel grid as the hero, so an 8x8 ring is eight
//      texels of a forty-six-texel figure: a smudge. Nothing here is under fourteen texels in its
//      long direction, and most fill twenty-plus.
//   2. LIGHT IT OFF THE ROOM'S KEY. Stone is a mid value and iron is a dark one, so a bracket
//      painted honestly is a dark shape on a dark shape. Every fixture below ends with `rimLit()`,
//      which sets its top-left border to the top of its own ramp — the one mark that carries a
//      shield or a skull niche off the masonry at any zoom.

/**
 * THE KEY LIGHT, WELDED TO THE SILHOUETTE. Walks the drawing and sets every texel whose up or left
 * neighbour is empty to the brightest step of the piece's ramp. Ink is never bleached (a socket
 * stays a hole); the outline pass then lays the house contour outside that.
 */
function rimLit(p, keys) {
  const src = p.d.slice();
  const at = (x, y) => (x < 0 || y < 0 || x >= p.w || y >= p.h ? 0 : src[y * p.w + x]);
  const top = step(keys, keys.length - 1), ink = '%'.charCodeAt(0), star = '*'.charCodeAt(0);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const k = at(x, y);
    if (!k || k === ink || k === star) continue;
    if (!at(x - 1, y) || !at(x, y - 1)) setPx(p, x, y, top);
  }
  return p;
}

/** An UNLIT iron bracket. The lit torches belong to lighting.js; this is what is left when it dies. */
function artSconce(v) {
  const p = makePix(16, 26), I = 'hijkl';
  for (let y = 13; y <= 24; y++) span(p, 4, 11, y, I, 3, 1);        // the back plate, run down the wall
  span(p, 3, 12, 13, I, 5, 1); span(p, 3, 12, 14, I, 4, 1);         // its flared head
  span(p, 3, 12, 23, I, 2, 1); span(p, 3, 12, 24, I, 1, 1);         // and its foot
  setPx(p, 6, 17, '%'); setPx(p, 9, 20, '%');                       // the two spikes that hold it
  for (let y = 8; y <= 13; y++) span(p, 6, 9, y, I, 2, 1);          // the stem
  for (let j = 0; j < 7; j++) {                                     // the cup: a basket of iron staves
    const w = Math.round(6 - j * 0.55);
    span(p, 7 - w, 8 + w, 1 + j, I, j < 2 ? 5 : 3, 1);
  }
  for (const x of [2, 5, 10, 13]) for (let y = 2; y <= 6; y++) setPx(p, x, y, step(I, 1));   // the staves' gaps
  span(p, 1, 14, 1, I, 5, 1);                                       // the rim
  if (v >= 1) { for (let y = 1; y <= 5; y++) { setPx(p, 14, y, 0); setPx(p, 13, y, 0); } }   // bent
  if (v >= 2) { for (let y = 0; y <= 7; y++) for (let x = 0; x <= 15; x++) setPx(p, x, y, 0); }  // cup gone
  return rimLit(wear(p, v, I, `sconce${v}`, 0.3), I);
}

/** Hanging cloth with a device on it. v3 is three rags on a rod. */
function artBanner(v) {
  const p = makePix(24, 34), C = 'ABCDE', M = 'mnopq';
  for (let x = 1; x <= 22; x++) { setPx(p, x, 0, step(M, 4)); setPx(p, x, 1, step(M, 2)); }   // the rod
  for (const x of [0, 23]) { setPx(p, x, 0, step(M, 3)); setPx(p, x, 1, step(M, 1)); }        // its finials
  for (let y = 2; y <= 28; y++) {
    const w = y > 25 ? 22 - (y - 25) * 5 : 22;
    span(p, 1 + ((22 - w) / 2 | 0), ((22 - w) / 2 | 0) + w, y, C, 2, 1);
  }
  for (let y = 4; y <= 27; y += 5) span(p, 3, 20, y, C, 3, 0);      // the folds catch the light
  for (let j = 0; j <= 7; j++) {                                    // a chevron device, big enough to see
    for (const d of [0, 1]) {
      setPx(p, 11 - j, 11 + j + d, step(M, 4 - d)); setPx(p, 12 + j, 11 + j + d, step(M, 4 - d));
    }
  }
  for (let i = 0; i < 5; i++) { setPx(p, 6 + i * 3, 29 + (i % 2), step(M, 3)); setPx(p, 6 + i * 3, 30 + (i % 2), step(M, 1)); }
  return rimLit(wear(p, v, C, `banner${v}`, 0.8), C);
}

/** A woven scene: border, a tree, and a figure under it, all at five texels of resolution. */
function artTapestry(v) {
  const p = makePix(30, 34), C = 'ABCDE', M = 'mnopq', F = 'FGHIJ';
  for (let x = 1; x <= 28; x++) { setPx(p, x, 0, step(F, 3)); setPx(p, x, 1, step(F, 1)); }   // the pole
  for (let y = 2; y <= 32; y++) span(p, 1, 28, y, C, 2, 1);
  for (let y = 3; y <= 31; y++) { setPx(p, 2, y, step(M, 4)); setPx(p, 27, y, step(M, 2)); }  // the border
  span(p, 2, 27, 3, M, 4, 0); span(p, 2, 27, 31, M, 1, 0);
  for (let y = 12; y <= 26; y++) span(p, 14, 16, y, F, 2, 1);                                 // the tree's trunk
  for (let i = 0; i < 5; i++) ell(p, 15 + (i % 2 ? 5 : -5), 12 + i * 2.6, 6 - i * 0.6, 2.8, step(C, 3));
  ell(p, 15, 28, 3.0, 3.6, step(M, 2));                                                       // a figure beneath it
  ell(p, 15, 24.5, 1.8, 1.8, step(F, 4));
  for (let i = 0; i < 6; i++) { setPx(p, 4 + i * 4, 33, step(C, 3)); setPx(p, 5 + i * 4, 33, step(C, 1)); }
  return rimLit(wear(p, v, C, `tapestry${v}`, 0.7), C);
}

/** A shield hung flat on the wall: boss, rim, and somebody's device. */
function artHungShield(v) {
  const p = makePix(24, 24), I = 'hijkl', M = 'mnopq', C = 'ABCDE';
  ell(p, 11.5, 11.5, 10.6, 10.6, 'j');
  const q = model(p, I, { up: 0.65, dome: 0.16, local: 0.2 });
  for (let a = 0; a < Math.PI * 2; a += 0.04) {                     // the rim, two texels of iron
    const c = Math.cos(a), sn = Math.sin(a), k = step(I, Math.cos(a + 2.4) > 0 ? 1 : 4);
    for (const r of [10.4, 9.4]) setPx(q, Math.round(11.5 + c * r), Math.round(11.5 + sn * r), k);
  }
  for (let j = -6; j <= 6; j++) for (const d of [0, 1]) {           // a chevron device across the face
    setPx(q, 11 + j, 12 - Math.abs(j) + 4 + d, step(C, 3 - d));
  }
  ell(q, 11.5, 11.5, 3.2, 3.2, step(M, 3));                        // the boss
  ell(q, 11.5, 11.5, 1.4, 1.4, step(M, 4));
  setPx(q, 9, 9, step(M, 4)); setPx(q, 14, 14, step(M, 1));
  if (v >= 2) for (let i = 0; i < 10; i++) setPx(q, 6 + i, 4 + i, '%');   // a blow that split it
  return rimLit(wear(q, v, I, `hungShield${v}`, 0.5), I);
}

/** Crossed arms over a plate: the armoury's signature on a bare wall. */
function artTrophyArms(v) {
  const p = makePix(28, 26), W = 'abcdefg', S = 'hijkl';
  for (const bx of [1, 21]) {                                       // two leaf blades, one per top corner
    for (let j = 0; j < 11; j++) {
      const w = Math.max(0, Math.round(3.2 * Math.sin(((j + 0.6) / 11) * Math.PI)));
      span(p, bx + 3 - w, bx + 3 + w, j, S, 3 + (j < 4 ? 1 : -1), 1);
    }
  }
  for (let i = 0; i < 20; i++) {                                    // and the two hafts, crossed under them
    const y = 9 + Math.round(i * 0.85);
    for (const d of [0, 1]) {
      setPx(p, 4 + i, y + d, step(W, d ? 1 : 4)); setPx(p, 23 - i, y + d, step(W, d ? 1 : 4));
    }
  }
  ell(p, 13.5, 17, 6.2, 6.2, step(S, 2));                           // the boss plate they cross over
  for (let a = 0; a < Math.PI * 2; a += 0.08) {                      // its rim
    setPx(p, Math.round(13.5 + Math.cos(a) * 6.0), Math.round(17 + Math.sin(a) * 6.0), step(S, Math.cos(a + 2.4) > 0 ? 1 : 4));
  }
  ell(p, 13.5, 17, 2.4, 2.4, step(S, 4));
  setPx(p, 11, 14, step(S, 4)); setPx(p, 16, 20, step(S, 1));
  return rimLit(wear(p, v, W, `trophyArms${v}`, 0.5), W);
}

/** Chain hanging from a ring: three links wide, thirty texels of hopelessness. */
function artChains(v) {
  const p = makePix(12, 32), I = 'hijkl';
  for (let a = 0; a < Math.PI * 2; a += 0.16) {                     // the ring it hangs from
    for (const r of [3.0, 2.2]) setPx(p, Math.round(5 + Math.cos(a) * r), Math.round(3 + Math.sin(a) * r * 0.9), step(I, 3));
  }
  chainRun(p, 3, 6, 30 - v * 7, I);
  chainRun(p, 7, 8, 27 - v * 7, I);                                 // a second fall beside it
  if (v >= 1) { setPx(p, 3, 31 - v * 7, step(I, 1)); setPx(p, 5, 32 - v * 7, step(I, 2)); }   // the broken end
  return rimLit(p, I);
}

/** Two cuffs on short chains. Nothing else says what a room is for so quickly. */
function artManacles(v) {
  const p = makePix(20, 22), I = 'hijkl';
  for (let a = 0; a < Math.PI * 2; a += 0.2) {                      // the pin they both hang from
    setPx(p, Math.round(9.5 + Math.cos(a) * 2.6), Math.round(2.5 + Math.sin(a) * 2.2), step(I, 3));
  }
  chainRun(p, 4, 4, 12, I); chainRun(p, 13, 4, 12, I);
  for (const cx of [5, 14]) {                                       // the cuffs, four texels of iron thick
    for (let a = 0.4; a < Math.PI * 2 - 0.4; a += 0.14) {
      const k = step(I, Math.cos(a + 2.4) > 0 ? 1 : 4);
      for (const r of [4.2, 3.2]) setPx(p, Math.round(cx + Math.cos(a) * r), Math.round(17 + Math.sin(a) * r * 0.95), k);
    }
  }
  if (v >= 1) { for (let y = 13; y <= 20; y++) { setPx(p, 14, y, 0); setPx(p, 15, y, 0); } }
  return rimLit(p, I);
}

/** A corner web: radial threads to the corner, and the spiral hung between them. */
function artCobweb(v) {
  const p = makePix(26, 26), W = 'ABCDE';
  const r = createRng(`dressing:cobweb:${v}`);
  const rad = 25 - v * 3, spokes = 8;
  for (let i = 0; i <= spokes; i++) {                               // the radials, from the corner
    const a = (i / spokes) * (Math.PI / 2);
    for (let d = 2; d < rad; d++) {
      if (!r.chance(0.9)) continue;
      setPx(p, Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d), step(W, d < rad * 0.5 ? 4 : 3));
    }
  }
  for (let ring = 5; ring < rad; ring += 3 + v) {                   // the spiral
    for (let a = 0; a <= Math.PI / 2; a += 0.05) {
      if (!r.chance(0.78 - v * 0.1)) continue;
      const rr = ring + a * 1.1;
      setPx(p, Math.round(Math.cos(a) * rr), Math.round(Math.sin(a) * rr), step(W, 3));
    }
  }
  if (v >= 2) for (let i = 0; i < 26; i++) setPx(p, r.int(0, 25), r.int(0, 25), 0);  // torn through
  return p;
}

/** A skull in a carved recess. The recess is the point: it is cut INTO the wall, not stuck on it. */
function artSkullNiche(v) {
  const p = makePix(22, 26), S = 'rstuv';
  for (let y = 5; y <= 23; y++) span(p, 3, 18, y, S, 0, 0);          // the dark of the recess
  for (let a = 0; a <= Math.PI; a += 0.06) {                         // the arch over it
    const x = Math.round(10.5 + Math.cos(a) * 9), y = Math.round(6 - Math.sin(a) * 5.2);
    for (const d of [0, 1, 2]) setPx(p, x, y - d, step(S, a > 1.9 ? 4 : 1));
  }
  for (let y = 6; y <= 23; y++) for (const [x, k] of [[1, 4], [2, 3], [19, 2], [20, 1]]) setPx(p, x, y, step(S, k));
  span(p, 1, 20, 24, S, 4, 1); span(p, 1, 20, 25, S, 2, 1);          // the sill
  const sk = artSkull(Math.min(2, v));
  for (let y = 0; y < sk.h; y++) for (let x = 0; x < sk.w; x++) { const k = sk.d[y * sk.w + x]; if (k) setPx(p, x + 3, y + 8, k); }
  return rimLit(p, S);
}

/** Stacked bone on a stone shelf: long bones end-on, and one skull looking out. */
function artOssuaryShelf(v) {
  const p = makePix(32, 26), S = 'rstuv', F = 'FGHIJ';
  for (const [y, k] of [[20, 5], [21, 4], [22, 2], [23, 1]]) span(p, 0, 31, y, S, k, 0);   // the shelf
  const r = createRng(`dressing:ossuaryShelf:${v}`);
  for (let i = 0; i < 11 - v; i++) {                                 // the bone ends, stacked on it
    const x = 1 + i * 3 + r.int(0, 1), y = 8 + r.int(0, 5);
    for (let yy = y; yy <= 19; yy++) span(p, x, x + 2, yy, F, 3, 1);
    span(p, x, x + 2, y, F, 4, 1);
  }
  const sk = artSkull(Math.min(2, v));
  for (let y = 0; y < sk.h; y++) for (let x = 0; x < sk.w; x++) { const k = sk.d[y * sk.w + x]; if (k) setPx(p, x + 15, y + 4, k); }
  return rimLit(wear(p, v, F, `ossuaryShelf${v}`, 0.4), F);
}

/** A tether ring on a plate. Sixteen texels, and the room is suddenly about restraint. */
function artIronRing(v) {
  const p = makePix(16, 16), I = 'hijkl';
  for (let y = 1; y <= 5; y++) span(p, 4, 11, y, I, 3, 1);           // the plate it is bolted through
  span(p, 4, 11, 1, I, 5, 1); span(p, 4, 11, 5, I, 1, 1);
  setPx(p, 6, 3, '%'); setPx(p, 9, 3, '%');                          // its two bolts
  for (let a = 0; a < Math.PI * 2; a += 0.1) {                       // the ring, three texels of iron
    const k = step(I, Math.cos(a + 2.4) > 0 ? 1 : 4);
    for (const r of [6.0, 5.0]) setPx(p, Math.round(7.5 + Math.cos(a) * r), Math.round(9.5 + Math.sin(a) * r * 0.95), k);
  }
  if (v >= 1) { for (let y = 12; y <= 15; y++) setPx(p, 12, y, 0); }
  return rimLit(p, I);
}

/** A carved head with its mouth open, and the stain the water made below it. */
function artGargoyleSpout(v) {
  const p = makePix(24, 22), S = 'rstuv', W = 'ABCDE';
  ell(p, 11.5, 8, 8.6, 6.6, 't');
  box(p, 6, 9, 17, 16, 't');
  for (const x of [3, 20]) for (let y = 4; y <= 9; y++) setPx(p, x, y, 't');   // the two horns
  const q = model(p, S, { up: 0.7, dome: 0.16, local: 0.35 });
  for (const x of [7, 15]) {                                          // the brows and the eyes under them
    box(q, x, 5, x + 2, 6, '%'); span(q, x - 1, x + 3, 4, S, 4, 0);
  }
  box(q, 8, 12, 15, 15, '%');                                         // the mouth, open
  for (const x of [8, 10, 12, 14]) { setPx(q, x, 12, step(S, 4)); setPx(q, x, 15, step(S, 3)); }   // teeth
  for (let i = 0; i < 6 - v; i++) { setPx(q, 11 + (i % 2), 17 + i, step(W, 3)); }                 // the drip
  return rimLit(wear(q, v, S, `gargoyle${v}`, 0.4), S);
}

/** A plank on two pegs, with the jars and boxes somebody left on it. */
function artWallShelf(v) {
  const p = makePix(28, 22), W = 'abcdefg', G = 'ABCDE', F = 'FGHIJ';
  for (const [y, k] of [[14, 5], [15, 4], [16, 2], [17, 1]]) span(p, 0, 27, y, W, k, 0);   // the plank
  for (const x of [3, 22]) for (let y = 18; y <= 21; y++) span(p, x, x + 2, y, W, 2, 1);   // the pegs
  if (v <= 1) { for (let y = 4; y <= 13; y++) span(p, 3, 8, y, G, 2, 1); span(p, 3, 8, 4, F, 3, 1); span(p, 4, 7, 3, F, 4, 1); }
  for (let y = 7; y <= 13; y++) span(p, 11, 18, y, F, 3, 1);                                // a box
  span(p, 11, 18, 6, F, 4, 1); span(p, 11, 18, 7, F, 5, 1);
  if (v === 0) { for (let y = 6; y <= 13; y++) span(p, 21, 25, y, G, 3, 1); setPx(p, 21, 5, step(G, 4)); span(p, 22, 24, 5, G, 4, 1); }
  return rimLit(wear(p, v, W, `wallShelf${v}`, 0.5), W);
}

/** A carved tablet whose name nobody can read any more. */
function artPlaque(v) {
  const p = makePix(24, 18), S = 'rstuv';
  for (let y = 1; y <= 16; y++) span(p, 1, 22, y, S, 3, 1);
  span(p, 1, 22, 1, S, 5, 1); span(p, 1, 22, 2, S, 4, 1);
  span(p, 1, 22, 15, S, 2, 1); span(p, 1, 22, 16, S, 1, 1);
  const r = createRng(`dressing:plaque:${v}`);
  for (let row = 0; row < 3; row++) {                                 // three lines of chiselled text
    let x = 4;
    while (x < 20) {
      const w = r.int(2, 4);
      if (r.chance(0.85 - v * 0.2)) for (let i = 0; i < w && x + i < 20; i++) {
        setPx(p, x + i, 5 + row * 3, '%'); setPx(p, x + i, 6 + row * 3, '%'); setPx(p, x + i, 4 + row * 3, step(S, 4));
      }
      x += w + r.int(1, 2);
    }
  }
  return rimLit(wear(p, v, S, `plaque${v}`, 0.4), S);
}

/** A crack running up the masonry, with the lit lip on the light side and the grit it shed. */
function artWallCrack(v) {
  const p = makePix(28, 32), S = 'rstuv';
  const r = createRng(`dressing:wallCrack:${v}`);
  let x = 13;
  for (let y = 31; y >= 0; y--) {
    setPx(p, x, y, '%'); setPx(p, x + 1, y, '%');
    setPx(p, x - 1, y, step(S, 5));                                   // the top-left lip, taking the key
    setPx(p, x - 2, y, step(S, 3));
    setPx(p, x + 2, y, step(S, 1));
    if (r.chance(0.3)) { setPx(p, x + 2, y, '%'); setPx(p, x + 3, y, step(S, 1)); }
    x += r.int(-1, 1); x = Math.max(3, Math.min(23, x));
    if (v >= 1 && y === 19) {
      let bx = x;
      for (let by = 19; by < 28; by++) { setPx(p, bx, by, '%'); setPx(p, bx + 1, by, '%'); setPx(p, bx - 1, by, step(S, 5)); bx += r.int(0, 1); }
    }
  }
  for (let i = 0; i < 10 + v * 8; i++) setPx(p, r.int(4, 23), r.int(25, 31), step(S, r.int(2, 4)));
  return p;
}

/** Damp bloom: no edge anywhere, because damp does not have one. */
function artMould(v) {
  const p = makePix(28, 28), G = 'ABCDE';
  const r = createRng(`dressing:mould:${v}`);
  for (let i = 0; i < 4 + v; i++) blot(p, r.int(6, 21), r.int(6, 21), r.float(6, 10), r.float(6, 10), G, r, { base: 2, grad: 1, edge: 0.28 });
  for (let i = 0; i < 60; i++) setPx(p, r.int(0, 27), r.int(0, 27), step(G, r.chance(0.4) ? 4 : 1));
  return p;
}

/** Bracket fungus: half-discs stepping out of the wall, each with a lit upper edge. */
function artFungusShelf(v) {
  const p = makePix(26, 20), G = 'ABCDE';
  const shelves = [[9, 15, 8.5], [17, 10, 6.5], [6, 6, 5.5]];
  for (let i = 0; i < 3 - Math.max(0, v - 1); i++) {
    const [cx, cy, rr] = shelves[i];
    for (let a = Math.PI; a <= Math.PI * 2; a += 0.04) {
      for (let d = 0; d <= rr; d += 0.5) {
        setPx(p, Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.62), step(G, d > rr - 1.6 ? 1 : 2));
      }
    }
    for (let x = Math.round(cx - rr); x <= Math.round(cx + rr); x++) {
      const y = Math.round(cy - Math.sqrt(Math.max(0, 1 - ((x - cx) / rr) ** 2)) * rr * 0.62);
      setPx(p, x, y, step(G, 4)); setPx(p, x, y + 1, step(G, 3));
    }
  }
  return rimLit(wear(p, v, G, `fungusShelf${v}`, 0.4), G);
}

// ================================================================================== the registry
/**
 * `type` -> everything the renderer needs to put one in the world.
 *  · `cls`   'prop' (billboard on the floor) | 'decal' (quad in the floor) | 'wall' (on a wall face)
 *  · `art`   painter (variant) -> Pix
 *  · `pal`   the material spec (see `RAMP`/`GROUPS`)
 *  · `v`     how many variants exist; LOWER = MORE INTACT (AMBIENCE §2.1)
 *  · `foot`  standing props: the footprint in tiles, for the contact shadow
 *  · `mount` wall pieces: the world y of the art's BOTTOM ROW (AMBIENCE §5.3)
 *  · `turn`  decals: true if the piece has no direction and may be turned with the slab
 *  · `glow`/`emissive`/`pool`: the pieces that are literally alight, and nothing else
 */
const DRESSING = {
  // --- standing scatter
  skull: { cls: 'prop', art: artSkull, pal: { F: RAMP.bone }, v: 3, foot: 0.28 },
  skullPile: { cls: 'prop', art: artSkullPile, pal: { F: RAMP.bone }, v: 3, foot: 0.56 },
  rat: { cls: 'prop', art: artRat, pal: { a: RAMP.hide }, v: 2, foot: 0.34, idle: 'rat' },
  candlestick: { cls: 'prop', art: artCandlestick, pal: { m: RAMP.brass, F: RAMP.wax, A: RAMP.fire }, v: 3, foot: 0.26, glow: 0.16, emissive: 0xffe6b0, pool: [0xffe0a0, 0.36, 0.06] },
  bottles: { cls: 'prop', art: artBottles, pal: { A: RAMP.glass, F: RAMP.cloth }, v: 3, foot: 0.4 },
  tankards: { cls: 'prop', art: artTankards, pal: { h: RAMP.iron, A: '#4a3520' }, v: 2, foot: 0.34 },
  dice: { cls: 'prop', art: artDice, pal: { F: RAMP.bone, h: RAMP.wood }, v: 2, foot: 0.24 },
  stalagmite: { cls: 'prop', art: artStalagmite, pal: { r: RAMP.stone }, v: 4, foot: 0.5, blk: true },
  dripstone: { cls: 'prop', art: artDripstone, pal: { r: RAMP.stone }, v: 3, foot: 0.5 },
  mushroomCluster: { cls: 'prop', art: artMushroomCluster, pal: { A: RAMP.cap, F: RAMP.bone }, v: 4, foot: 0.46 },
  // --- floor decals
  bones: { cls: 'decal', art: artBones, pal: { F: RAMP.bone, r: RAMP.grit }, v: 4, turn: true },
  scree: { cls: 'decal', art: artScree, pal: { r: RAMP.grit }, v: 4, turn: true },
  puddle: { cls: 'decal', art: artPuddle, pal: { A: RAMP.water, r: RAMP.stone }, v: 3, turn: true },
  bloodstain: { cls: 'decal', art: artBloodstain, pal: { A: RAMP.blood }, v: 3, turn: true },
  scorch: { cls: 'decal', art: artScorch, pal: { A: RAMP.soot }, v: 3, turn: true },
  crackedFlags: { cls: 'decal', art: artCrackedFlags, pal: { r: RAMP.stone }, v: 3, turn: true },
  mosaic: { cls: 'decal', art: artMosaic, pal: { A: RAMP.slate, m: '#8a7240', r: RAMP.stone }, v: 4 },
  rug: { cls: 'decal', art: artRug, pal: { A: '#6b2b30', m: '#8a7240' }, v: 3 },
  runner: { cls: 'decal', art: artRunner, pal: { A: '#6b2b30', m: '#8a7240' }, v: 2 },
  chalkSigil: { cls: 'decal', art: artChalkSigil, pal: { A: RAMP.web }, v: 3, turn: true },
  spill: { cls: 'decal', art: artSpill, pal: { A: RAMP.moss }, v: 3, turn: true, glow: 0.1, emissive: 0x7fe3a8 },
  ashBed: { cls: 'decal', art: artAshBed, pal: { A: RAMP.soot }, v: 2, turn: true },
  coins: { cls: 'decal', art: artCoins, pal: { m: RAMP.brass, r: RAMP.grit }, v: 3, turn: true },
  sporePatch: { cls: 'decal', art: artSporePatch, pal: { A: RAMP.fungus }, v: 3, turn: true },
  lichen: { cls: 'decal', art: artLichen, pal: { A: RAMP.moss }, v: 3, turn: true },
  rime: { cls: 'decal', art: artRime, pal: { A: '#cfe4ef' }, v: 2, turn: true },
  drainGrate: { cls: 'decal', art: artDrainGrate, pal: { h: RAMP.iron, r: RAMP.stone }, v: 2 },
  // --- wall dressing
  sconce: { cls: 'wall', art: artSconce, pal: { h: RAMP.ironPale }, v: 3, mount: 0.62 },
  banner: { cls: 'wall', art: artBanner, pal: { A: RAMP.cloth, m: RAMP.brass }, v: 4, mount: 0.10 },
  tapestry: { cls: 'wall', art: artTapestry, pal: { A: RAMP.weave, m: RAMP.brass, F: RAMP.wood }, v: 3, mount: 0.08 },
  hungShield: { cls: 'wall', art: artHungShield, pal: { h: RAMP.steel, m: RAMP.brass, A: RAMP.cloth }, v: 4, mount: 0.66 },
  trophyArms: { cls: 'wall', art: artTrophyArms, pal: { a: RAMP.wood, h: RAMP.steel }, v: 3, mount: 0.62 },
  chains: { cls: 'wall', art: artChains, pal: { h: RAMP.ironPale }, v: 3, mount: 0.30 },
  manacles: { cls: 'wall', art: artManacles, pal: { h: RAMP.ironPale }, v: 2, mount: 0.44 },
  cobweb: { cls: 'wall', art: artCobweb, pal: { A: RAMP.web }, v: 4, mount: 0.80 },
  skullNiche: { cls: 'wall', art: artSkullNiche, pal: { r: RAMP.slate, F: RAMP.bone }, v: 3, mount: 0.60 },
  ossuaryShelf: { cls: 'wall', art: artOssuaryShelf, pal: { r: RAMP.slate, F: RAMP.bone }, v: 3, mount: 0.40 },
  ironRing: { cls: 'wall', art: artIronRing, pal: { h: RAMP.ironPale }, v: 2, mount: 0.50 },
  gargoyleSpout: { cls: 'wall', art: artGargoyleSpout, pal: { r: RAMP.stone, A: RAMP.water }, v: 3, mount: 0.85 },
  wallShelf: { cls: 'wall', art: artWallShelf, pal: { a: RAMP.wood, A: RAMP.glass, F: RAMP.bone }, v: 3, mount: 0.55 },
  plaque: { cls: 'wall', art: artPlaque, pal: { r: RAMP.slate }, v: 3, mount: 0.70 },
  wallCrack: { cls: 'wall', art: artWallCrack, pal: { r: RAMP.stone }, v: 3, mount: 0.00 },
  mould: { cls: 'wall', art: artMould, pal: { A: RAMP.moss }, v: 3, mount: 0.00 },
  fungusShelf: { cls: 'wall', art: artFungusShelf, pal: { A: RAMP.fungus }, v: 3, mount: 0.35 },
};

/** Every dressing id this module can build. */
export const DRESSING_TYPES = Object.keys(DRESSING);
/** Is `type` a piece of dressing this module paints? */
export function isDressing(type) { return Object.prototype.hasOwnProperty.call(DRESSING, type); }
/** 'prop' | 'decal' | 'wall' for a dressing type, or null. */
export function dressingClass(type) { return DRESSING[type] ? DRESSING[type].cls : null; }
/** How many variants `type` has (0 for an unknown type). Lower variant = more intact. */
export function dressingVariants(type) { return DRESSING[type] ? DRESSING[type].v : 0; }
/** The world y a wall piece's bottom art row hangs at (0 for anything else). */
export function dressingMountY(type) { return (DRESSING[type] && DRESSING[type].mount) || 0; }
/** The palette a piece is painted with, for tests and the debug plates. @returns {object|null} */
export function dressingPalette(type, variant = 0) {
  const d = DRESSING[type];
  if (!d) return null;
  const v = Math.max(0, Math.min(d.v - 1, variant | 0));
  return palOf(`${type}:${v}`, d.pal);
}
/** The painted art for a piece, for tests and the debug plates. @returns {object|null} a Pix */
export function dressingArt(type, variant = 0) {
  const d = DRESSING[type];
  return d ? d.art(Math.max(0, Math.min(d.v - 1, variant | 0))) : null;
}

const FACE = { n: { dx: 0, dy: -1 }, e: { dx: 1, dy: 0 }, s: { dx: 0, dy: 1 }, w: { dx: -1, dy: 0 } };
const TURN = { n: 0, e: 1, s: 2, w: 3 };
/**
 * THE WALL BAND IS SEVEN TEXELS TALL, AND THAT IS THE WHOLE PROBLEM.
 *
 * Measured, not reasoned: the dungeon's walls are `WALL_H = 0.82` units of stone (dungeon.js) and
 * the play camera is 17 degrees off vertical, so a world-upright surface keeps only `sin(17°) = 0.29`
 * of its height on screen. A wall's whole visible FACE is therefore `0.82 * 0.29 = 0.24` of a tile
 * — SEVEN AND A HALF TEXELS. A quad drawn honestly in that plane at `artH/32` units tall gives a
 * 20-texel sconce five texels of screen and an 8-texel ring two, which is exactly the smudge the
 * art director measured: sixteen of the seventeen wall types rendered as nothing at all.
 *
 * The two failed answers, for the record:
 *   · A SCREEN-ALIGNED BILLBOARD (the first attempt) grows along the camera's up vector, which here
 *     is `(0, 0.29, -0.96)` — almost due NORTH, into the masonry. The wall swallowed every one.
 *   · AN HONEST IN-PLANE QUAD (the second attempt, and what shipped) is depth-correct and legible
 *     at seven texels, which is to say not legible.
 *
 * What actually works is the third thing, and it is the floor decal's own bargain read one surface
 * up: KEEP THE QUAD IN THE WALL'S PLANE, AND STRETCH IT VERTICALLY BY `1 / sin(tilt)` SO THAT ITS
 * ART LANDS ON THE SHARED TEXEL GRID AT TRUE SIZE. A 24-row sconce is drawn on a plate 2.57 units
 * tall; the camera foreshortens it back to 24 texels of screen. The horizontal is snapped to the
 * same grid, so every wall piece is finally painted at exactly the resolution the hero is.
 *
 * The stretched plate is taller than the wall it hangs on, and that is not a bug — it is the only
 * geometry that reads. Work the depth through: a plate at `z = wallFace + 0.04` and the wall's top
 * face are equal in view depth exactly at `y = WALL_H`, so the plate is OCCLUDED BY ITS OWN WALL
 * below the wall's top edge and VISIBLE ABOVE IT, painting over the wall's top surface — the same
 * band of screen the torch brackets already reach into. It therefore steals nothing: a prop
 * standing on the floor in front is clipped by the wall face long before it gets that high, so the
 * piece cannot draw over the cast, and nothing that stands behind the wall is on screen at all.
 *
 * The foreshortening is read off the LIVE camera (the tilt is a settings slider, 0–45 degrees), so
 * a player who flattens the view gets shorter plates and the same square texels.
 *
 * WHAT THE CAMERA STILL COSTS US, honestly: this view looks from the south, so a piece on a room's
 * NORTH wall reads fully, one on an east or west wall is edge-on, and one on a south wall is behind
 * its own stone (AMBIENCE §5.3 — `wallReads()` only ever hangs them facing 's').
 */
/** How far above the wall base a hung piece may reach, in tiles of SCREEN height. A one-tile-thick
 *  wall shows 1.21 tiles of itself (face band + top face); stay inside it and a plate never spills
 *  past its own masonry onto whatever lies beyond. 34 art rows is the practical ceiling. */
const WALL_SCREEN_TILES = 1.15;
/** sin(17°): what a world-upright surface keeps of its height at the DEFAULT play tilt. Only a seed
 *  for the first frame's bounds — the live value is read off the camera every frame below. */
const PLAN_FORESHORTEN = 0.2924;
/** A world-upright surface keeps this much of its height on screen at the tilt the camera is at. */
const _wpUp = new THREE.Vector3(), _wpBuf = new THREE.Vector2(), _wpPos = new THREE.Vector3(), _wpFwd = new THREE.Vector3();
function wallForeshorten(camera) {
  _wpUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  return Math.min(1, Math.max(0.14, Math.abs(_wpUp.y)));
}
let _wallGeo = null;

function wallPlate(key, art, pal, mount, o = {}) {
  const tex = pixelTexture(key, art, pal);
  const size = tex.userData.size;
  const mat = pixelSnap(litMaterial(`wallplate:${key}`, {
    map: tex, alphaTest: 0.5, transparent: false, side: THREE.DoubleSide, roughness: 1, metalness: 0,
    emissiveMap: tex, emissive: new THREE.Color(o.emissive ?? 0xffffff), emissiveIntensity: (o.glow ?? 0.06) * 0.5,
  }));
  if (!_wallGeo) _wallGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const m = new THREE.Mesh(_wallGeo, mat);
  // Seeded at the stretch the PLAY camera asks for, not at the art's own world size: `onBeforeRender`
  // does not run on a culled object, so a plate that starts too small to pass the frustum test would
  // never get the chance to grow. Three culls on the PREVIOUS frame's scale, which after frame one
  // is the right one, so the piece can keep its culling and the level keeps its draw-call budget.
  m.scale.set(size.w / PX_PER_TILE, size.h / PX_PER_TILE / PLAN_FORESHORTEN, 1);
  m.castShadow = false; m.receiveShadow = true;
  m.onBeforeRender = (renderer, scene, camera) => {
    const vp = renderer.getDrawingBufferSize(_wpBuf);
    m.getWorldPosition(_wpPos);
    _wpFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const d = Math.max(0.5, (_wpPos.x - camera.position.x) * _wpFwd.x + (_wpPos.y - camera.position.y) * _wpFwd.y
      + (_wpPos.z - camera.position.z) * _wpFwd.z);
    const pxPerWorld = camera.isOrthographicCamera
      ? vp.y / Math.max(1e-6, (camera.top - camera.bottom) / (camera.zoom || 1))
      : (vp.y * 0.5 * (camera.zoom || 1)) / (Math.tan((camera.fov || 45) * Math.PI / 360) * d);
    const w = frameTexelSize(renderer, camera, PX_PER_TILE) / pxPerWorld;   // world units per texel
    const f = wallForeshorten(camera);
    // world height that lands `size.h` TEXELS on screen, capped so the plate stays on its own wall
    const h = Math.min(size.h * w / f, Math.max(0.1, WALL_SCREEN_TILES / f - mount));
    m.scale.set(size.w * w, h, 1);
    m.updateMatrix();
    if (m.parent) m.matrixWorld.multiplyMatrices(m.parent.matrixWorld, m.matrix);
    else m.matrixWorld.copy(m.matrix);
  };
  return m;
}

/**
 * A rat's idle: it is either perfectly still or it has moved, and it moves in WHOLE TEXELS.
 * A sine bob at 0.37 of a texel is a blur, not a rat (see `props.js` `bob`).
 */
function ratIdle(g, sprite, phase) {
  const x0 = sprite.position.x, y0 = sprite.position.y;
  animate(g, (dt, time) => {
    const grid = texelGrid();
    const texel = grid.pxPerWorld > 0 ? grid.S / grid.pxPerWorld : 1 / PX_PER_TILE;
    const c = (time * 0.42 + phase) % 1;
    // one short scurry, then a long freeze: three texels out, three back, and nothing for two seconds
    const run = c < 0.22 ? Math.round(Math.sin(c / 0.22 * Math.PI * 2) * 3) : 0;
    const hop = c < 0.22 && Math.sin(c / 0.22 * Math.PI * 8) > 0 ? 1 : 0;
    sprite.position.x = x0 + run * texel;
    sprite.position.y = y0 + hop * texel;
  });
}

/**
 * Build one piece of dressing, ready for DungeonView to drop on a tile.
 *
 * The returned group carries `userData.decor = {type, variant, facing, cls}` and, for a wall piece,
 * `userData.mountY` — the caller places the group at the wall FACE (`x + dx*0.5, 0, y + dy*0.5`),
 * exactly as `lighting.js` places a torch spot, and this function has already lifted the art to its
 * mount height and nudged it clear of the masonry.
 *
 * @param {string} type one of `DRESSING_TYPES`
 * @param {{variant?:number, facing?:'n'|'e'|'s'|'w', blocking?:boolean, x?:number, y?:number}} [o]
 * @returns {THREE.Group|null} null for a type this module does not paint (the caller warns once)
 */
export function buildDressing(type, o = {}) {
  const d = DRESSING[type];
  if (!d) return null;
  const v = Math.max(0, Math.min(d.v - 1, o.variant | 0));
  const facing = o.facing || 's';
  const key = `dress:${type}:${v}`;
  const pal = palOf(`${type}:${v}`, d.pal);
  const g = new THREE.Group();
  if (d.cls === 'decal') {
    const q = floorDecal(key, () => d.art(v), pal, { y: 0.021, glow: d.glow ?? 0, emissive: d.emissive ?? 0xffffff });
    // Directional pieces (a rug, a runner, a grate) keep the facing they were laid at; everything
    // else is marked `floorDecal` so DungeonView turns it with the slab and no two tiles match.
    if (d.turn) q.userData.floorDecal = true;
    else { q.userData.floorDecal = false; q.rotation.z = (Math.PI / 2) * TURN[facing]; }
    // A decal is a fixed 1x1 quad in the floor plane and a wall plate a fixed quad on its wall, so
    // unlike the billboards (whose scale is chosen at draw time) their bounding spheres are honest
    // and three can cull them. On a fully dressed level that is most of the decor most of the time.
    q.frustumCulled = true;
    g.add(q);
  } else {
    if (d.cls === 'wall') {
      const f = FACE[facing] || FACE.s;
      const m = wallPlate(key, () => d.art(v), pal, d.mount, { glow: d.glow, emissive: d.emissive });
      m.rotation.y = Math.atan2(f.dx, f.dy);               // the quad's normal looks into the room
      m.position.set(f.dx * 0.04, d.mount, f.dy * 0.04);   // and sits clear of the masonry
      g.add(m);
      g.userData.mountY = d.mount;
    } else {
      const s = pixelSprite(key, () => d.art(v), pal, { glow: d.glow ?? 0.05, emissive: d.emissive ?? 0xffffff });
      g.add(s);
      if (d.pool && v === 0) { const [c, r, op] = d.pool; g.add(groundGlow(c, r, { opacity: op })); }
      if (type === 'mushroomCluster' && v >= 2) g.add(groundGlow(0x7fe3a8, 0.4, { opacity: 0.09 }));
      g.add(contactShadow(d.foot, { strength: 0.45, spread: 1.1 }));
      if (d.idle === 'rat') ratIdle(g, s, ((o.x | 0) * 0.37 + (o.y | 0) * 0.71) % 1);
    }
  }
  g.userData.decor = { type, variant: v, facing, cls: d.cls };
  g.userData.blocking = !!o.blocking && !!d.blk;
  return g;
}

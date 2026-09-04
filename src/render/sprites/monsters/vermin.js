// vermin: the small fast fodder of the upper dungeon as HD-2D pixel sprites — giant rat, vampire
// bat, spider, green slime and kobold — drawn with the same toolkit, ramp discipline and key light
// as the hero (sprites/heroSprite.js).
//
// HOUSE STYLE (shared with the hero)
//  · One palette of hue-shifted ramps: shadows drift violet and gain saturation, highlights drift
//    amber and lose a little. Each creature uses 4-6 ramps, never more.
//  · Key light from the TOP-LEFT on every facing. Fills are hand-placed; the outline is applied
//    last by `outline()` so it is exactly one pixel, near-black violet ('#'), softened to the
//    lilac '@' on the edges that face the light. Nothing is pillow-shaded and nothing dithers.
//  · Facings south / east / north are each drawn deliberately; west is the mirrored east.
//  · Fills stop two rows above the pivot row so the outline lands on the contact row and
//    spriteSheet's foot metrics put the contact shadow under the actual feet.
//
// SILHOUETTES (no two can be confused at gameplay distance)
//  giant rat   long low loaf, ear disc breaking the back line, pointed snout with a buck tooth,
//              and the signature: a long naked scaly tail sweeping clear of the body.
//  vampire bat wide membrane wings caught mid-flap with visible finger bones; a tiny body, huge
//              ears and two fangs. It hovers — the fills never touch the contact row.
//  spider      eight articulated legs whose knees rise ABOVE the body; bulbous abdomen behind a
//              small cephalothorax, a crescent of amber eyes and a pale hourglass mark.
//  green slime a translucent dome: bright rim where the light passes through the skirt, a dark
//              inner nucleus that drifts as the body wobbles, and a drip on the crown.
//  kobold      small hunched dog-snouted humanoid, two backswept horns, a ragged hide kilt and a
//              crude bone-tipped spear held across the body.
import { Palette, paint, compose, mirrorLit, outline, houseOutline, seamInk, makePix, setPx, line } from '../pixelPainter.js';
import { INK, INK_LIT, INK_DEEP, LIT, ramp } from '../style.js';

/** @typedef {import('../pixelPainter.js').Pix} Pix */

// ---------------------------------------------------------------------------------- palette
// Keys are unique per creature so a mis-keyed pixel is obvious in the sheet.
// EVERY ramp below is a slice of ONE seven-step house curve (`ramp()` in style.js): the same ink,
// the same hue drift and the same value spread as the humanoids, the fighters and the beasts, so
// nothing in this file can quietly invent its own contrast. `pick` chooses which steps of that one
// curve a material occupies — bone and steel reach the top because they are polished, fur and hide
// sit in the middle, the ink-dark chitin starts at the bottom.
const RAMP_OPTS = { hueShift: 0.02, satShift: 0.06 };
/** Default steps of the seven-step curve for a 2-, 3- or 4-key ramp. */
const SPREAD = { 2: [2, 5], 3: [1, 3, 5], 4: [0, 2, 3, 5] };

/** A Palette whose `ramp()` IS the house ramp: one curve, one hue drift, one value spread. */
class HousePalette extends Palette {
  /**
   * @param {string} keys darkest first
   * @param {string} base the material's mid tone
   * @param {{pick?:number[]}} [o] which steps of the seven-step house curve the keys land on
   */
  ramp(keys, base, o = {}) {
    const cols = ramp(base, 7, RAMP_OPTS);
    const pick = o.pick || SPREAD[keys.length] || [...keys].map((_, i) => Math.round((i * 6) / (keys.length - 1)));
    for (let i = 0; i < keys.length; i++) this.set(keys[i], cols[pick[i]]);
    return this;
  }
}

export const VERMIN_PALETTE = new HousePalette()
  .set('#', INK)                                            // outline: the one house ink
  .set('@', INK_LIT)                                        // lit edge / inner line
  // giant rat
  .ramp('1234', '#8a7a68')                                  // dusty brown fur
  .ramp('567', '#c98d86', { pick: [2, 4, 6] })              // naked flesh: ears, tail, paws
  .ramp('89', '#d8ccae', { pick: [4, 6] })                  // bone: teeth, claws, spear tip
  // vampire bat
  .ramp('abc', '#8f4159')                                   // wing membrane (warm wine)
  .ramp('def', '#4b3550', { pick: [2, 4, 6] })              // bat fur / finger bones
  // spider
  .ramp('ghij', '#3f3c55', { pick: [1, 3, 5, 6] })          // chitin (cold blue-black)
  .set('Y', '#ffbe5c').set('y', '#8f5a1c')                  // amber eyes / joint marks
  // green slime
  .ramp('mnop', '#4fa83c')                                  // gel body
  .set('q', '#bdf07e')                                      // translucent skirt (light through it)
  .set('r', '#1d4a1b').set('s', '#dcffab')                  // nucleus core / nucleus glow
  // kobold
  .ramp('tuvw', '#a86a34')                                  // rusty hide
  .ramp('xyz', '#5b4130', { pick: [1, 3, 5] })              // leather straps and kilt
  .ramp('ST', '#98a0ae', { pick: [3, 6] })                  // lashings / steel
  // shared
  .set('E', INK_DEEP).set('W', '#fff7ea').set('R', '#ff6a4a')  // eye, catch-light, red iris
  .set('F', '#fff4f0');                                     // hurt flash

/**
 * THE SEAM VOCABULARY (pixelPainter `seamInk`): INK and INK_LIT are the outer contour, nothing else.
 * Fur, flesh, bone, wing membrane, chitin, gel, hide, leather, steel — every material of this
 * group, DARKEST FIRST. A crease in a wing or the line between two chitin plates is a step down
 * that material's own ramp, never the silhouette ink.
 */
const SEAM_RAMPS = ['1234', '567', '89', 'abc', 'def', 'ghij', 'mnop', 'tuvw', 'xyz', 'ST'];

const L = (p, x, y) => (p ? { p, x, y } : null);
/** Compose layers and lay the single selective outline on last (the house treatment). */
const ink = (w, h, layers) => outline(compose(w, h, layers.filter(Boolean)), '#', { lit: LIT, litKey: '@' });
/** Solid-key copy for the hurt flash (keeps the outline dark so the silhouette still reads). */
function flash(p) {
  const o = { w: p.w, h: p.h, d: new Uint16Array(p.d) };
  const F = 'F'.charCodeAt(0), H = '#'.charCodeAt(0);
  for (let i = 0; i < o.d.length; i++) if (o.d[i] && o.d[i] !== H) o.d[i] = F;
  return o;
}
/** Flatten a pix onto the floor: squash to `k` of its height, anchored at `baseY` (death heaps). */
function squashTo(p, k, baseY) {
  const o = makePix(p.w, p.h);
  for (let y = 0; y < p.h; y++) {
    const ty = Math.round(baseY - (baseY - y) * k);
    for (let x = 0; x < p.w; x++) { const c = p.d[y * p.w + x]; if (c) setPx(o, x, ty, c); }
  }
  return o;
}
/** Standard clip set assembled from per-facing frame makers. */
function clips(make) {
  const anims = {};
  // THE INK, LAST AND ONCE (see pixelPainter.houseOutline): frames arrive outlined part-by-part or
  // resampled by the death poses, so the coat can be doubled on a join and missing where one form
  // covered another's ring; the west facing is a mirror, which puts the lit-edge softening on the
  // wrong side. This peels every second coat, lays exactly one pixel of INK round anything bare and
  // re-keys the whole silhouette against the frame as it finally stands.
  // …and then THE SEAM PASS (pixelPainter.seamInk): with the contour right, ink left INSIDE the
  // figure is drawing, and INK is the wrong colour for drawing — it is the darkest tone the law
  // allows and the scene grade crushes it to a hole. Interior seams fall to a dark step of the
  // material they cut through.
  const inked = (fr) => fr.map((p) => seamInk(houseOutline(p, { key: '#', litKey: '@', lit: LIT }), { ramps: SEAM_RAMPS, keep: 'E' }));
  const put = (name, f, a) => { (anims[name] ||= {})[f] = { name, facing: f, ...a, frames: inked(a.frames) }; };
  for (const f of ['S', 'E', 'N']) for (const [name, a] of Object.entries(make(f))) put(name, f, a);
  for (const name of Object.keys(anims)) {
    const e = anims[name].E;
    if (e) anims[name].W = { ...e, facing: 'W', frames: inked(e.frames.map((p) => mirrorLit(p, ''))) };
  }
  return anims;
}

// ==========================================================================================
//                                        GIANT RAT
// ==========================================================================================
// Read: a long low loaf, the ear disc breaking the back line, a pointed snout with one buck tooth,
// and the naked scaly tail whipping clear of the body on every facing.
const RAT_W = 32, RAT_H = 22, RAT_PIVOT = { x: 16, y: 21 };

// east: torso, ear disc and a wedge head kept as separate parts so the neck reads and the tail has
// the whole left third of the canvas to sweep through
const RAT_TORSO_E = paint(`
..44444......
.44444444....
444444444444.
4444444444444
3444444444444
3333333333333
3333333333333
2222222222222
.222222222222
.11111111111.
..1111111111.
...111111111.`);
const RAT_EAR_E = paint(`
.444.
45554
46554
45554
.444.`);
const RAT_HEAD_E = paint(`
4444......
444444....
4444444...
444E44444.
34444444W5
33334444 5
.3333.9985
..333333..`);

const RAT_LEGS_E = {
  stand: paint(`
..333......333..
..222......222..
..655......655..`),
  a: paint(`
.333.........333
.222........2223
.655.......6555.`),
  b: paint(`
....333..333....
...2222..2223...
...655....655...`),
  crouch: paint(`
.3333......3333.
.6655......6655.`),
};

// the tail: an S-curve leaving the rump and flicking up behind the animal
const RAT_TAIL_E = [
  paint(`
66......
.66.....
..66....
...666..
.....666
.......6`),
  paint(`
........
66......
.666....
...666..
.....666
.......6`),
  paint(`
6.......
66......
.66.....
..6666..
.....666
.......6`),
];

const RAT_BODY_S = paint(`
..4444......4444..
.455554....455554.
.465554....465554.
.455554....455554.
..44444....44444..
...4444444444444..
..44444444444444..
.3444444444444443.
.334444444444443..
.33344444444443...
..3EW44444WE33....
..3ER444444RE3....
..3334444444333...
..33344444443 3...
.....3666663......
......56665.......
.......99.........`);

const RAT_LEGS_S = {
  stand: paint(`
..333....333..
..655....655..`),
  a: paint(`
.3333......333
.6655.....6655`),
  b: paint(`
..333.....3333
..655.....6655`),
  crouch: paint(`
.33333....33333
.66555....65566`),
};

// front on, the tail is mostly hidden by the body: it hooks out past the rump and hangs
const RAT_TAIL_S = [paint(`
666...
..666.
....66
.....6
.....6`), paint(`
666...
..6665
.....6
.....6
......`), paint(`
6666..
...666
.....6
.....6
.....6`)];

const RAT_BODY_N = paint(`
..4444......4444..
.444444....444444.
.465554....455564.
.444444....444444.
..44444....44444..
...44444444444....
..4444444444444...
.44444444444444...
.4444444444444443.
.3444444444444433.
.33444444444443333
.3333333333333333.
.333333333333333..
..3333222233333...
...33222222333....
....32222223......`);

const RAT_LEGS_N = {
  stand: paint(`
.333......333.
.655......655.`),
  a: paint(`
3333.......333
6655.......655`),
  b: paint(`
.333.......3333
.655.......6655`),
  crouch: paint(`
33333....33333
66555....65566`),
};

const RAT_TAIL_N = [paint(`
..66..
..66..
..66..
..665.
..666.`), paint(`
...66.
...66.
..66..
..665.
.666..`), paint(`
.66...
.66...
..66..
..665.
..666.`)];

/**
 * One giant-rat frame.
 * @param {'S'|'E'|'N'} f
 */
function ratFrame(f, { dy = 0, legs = 'stand', tail = 0, headDy = 0, dx = 0 } = {}) {
  if (f === 'E') {
    return ink(RAT_W, RAT_H, [
      L(RAT_TAIL_E[tail], 3 + dx, 10 + dy),
      L(RAT_EAR_E, 16 + dx, 4 + dy + headDy),
      L(RAT_TORSO_E, 8 + dx, 5 + dy),
      L(RAT_HEAD_E, 18 + dx, 8 + dy + headDy),
      L(RAT_LEGS_E[legs], 10 + dx, 17 + (legs === 'crouch' ? 1 : 0)),
    ]);
  }
  if (f === 'S') {
    return ink(RAT_W, RAT_H, [
      L(RAT_TAIL_S[tail], 17 + dx, 13 + dy),
      L(RAT_BODY_S, 7 + dx, 2 + dy),
      L(RAT_LEGS_S[legs], 9 + dx, 18 + (legs === 'crouch' ? 1 : 0)),
    ]);
  }
  return ink(RAT_W, RAT_H, [
    L(RAT_TAIL_N[tail], 13 + dx, 2 + dy),
    L(RAT_BODY_N, 7 + dx, 3 + dy),
    L(RAT_LEGS_N[legs], 9 + dx, 18 + (legs === 'crouch' ? 1 : 0)),
  ]);
}

function ratAnims(f) {
  const mk = (o) => ratFrame(f, o);
  const idle = {
    frames: [mk({ dy: 0, tail: 0 }), mk({ dy: 1, tail: 1 }), mk({ dy: 1, tail: 2 }), mk({ dy: 0, tail: 1 })],
    durations: [300, 220, 260, 220], loop: true,
  };
  // scurry: a fast four-beat with the body low and the tail whipping
  const walk = {
    frames: [mk({ legs: 'a', dy: 0, tail: 0 }), mk({ legs: 'b', dy: 1, tail: 1 }), mk({ legs: 'a', dy: 0, tail: 2 }), mk({ legs: 'b', dy: 1, tail: 1 })],
    durations: [80, 80, 80, 80], loop: true,
  };
  // bite: coil back, lunge with the head thrown forward, hold, settle
  const lunge = f === 'E' ? 3 : 0;
  const attack = {
    frames: [
      mk({ legs: 'crouch', dy: 2, headDy: 1, tail: 2, dx: f === 'E' ? -2 : 0 }),
      mk({ legs: 'a', dy: 0, headDy: -1, tail: 0, dx: lunge }),
      mk({ legs: 'a', dy: 0, tail: 0, dx: lunge }),
      mk({ legs: 'stand', dy: 1, tail: 1 }),
    ],
    durations: [110, 80, 110, 140], loop: false,
  };
  const recoil = mk({ legs: 'crouch', dy: 2, tail: 2, dx: f === 'E' ? -2 : 0 });
  const hurt = { frames: [flash(recoil), recoil], durations: [70, 170], loop: false };
  const d0 = mk({ legs: 'crouch', dy: 1, tail: 2 });
  const d1 = squashTo(mk({ legs: 'crouch', dy: 2, tail: 1 }), 0.82, RAT_H - 3);
  const death = {
    frames: [d0, d1, squashTo(d1, 0.7, RAT_H - 3), squashTo(d1, 0.45, RAT_H - 3), squashTo(d1, 0.38, RAT_H - 3)],
    durations: [110, 140, 170, 520, 700], loop: false,
  };
  return { idle, walk, attack, hurt, death };
}

/** Giant rat: 32x22, a low brown loaf with a naked whipping tail. */
export function buildGiantRat() {
  return { anims: clips(ratAnims), palette: VERMIN_PALETTE, w: RAT_W, h: RAT_H, pivot: RAT_PIVOT, emissive: '' };
}

// ==========================================================================================
//                                       VAMPIRE BAT
// ==========================================================================================
// The signature is the membrane caught mid-flap, so the wings are struck from the shoulder rather
// than drawn as slabs: a fan of five finger bones with the membrane scalloped between them. Marching
// the fan keeps every finger a clean one-pixel line at any flap angle (the same trick as the hero's
// blade). The bat hovers — its fills stop well above the contact row, which is what makes the
// billboard's blob shadow shrink away underneath it.
const BAT_W = 36, BAT_H = 24, BAT_PIVOT = { x: 18, y: 23 };

/** Flap phases: leading-edge angle, the fan's angular spread and the finger lengths. */
const BAT_FLAP = [
  { lead: -0.95, spread: 1.30, r: [11, 10.5, 9.5, 8, 6.5] },     // up-stroke
  { lead: -0.28, spread: 1.20, r: [14.5, 14, 12.5, 10.5, 8] },  // out flat: the read
  { lead: 0.42, spread: 1.10, r: [12.5, 12, 10.5, 9, 7] },      // down-stroke
];

/**
 * Strike one wing into `p`: membrane between the fingers, then the five bones over it.
 * @param {Pix} p @param {number} cx shoulder @param {number} cy shoulder
 * @param {{lead:number,spread:number,r:number[]}} ph @param {number} dir +1 = outward to the right
 * @param {string} keys trailing/mid/leading membrane tones + the bone tone
 * @param {number} [scale]
 */
function batWing(p, cx, cy, ph, dir, keys, scale = 1) {
  const { lead, spread } = ph, r = ph.r.map((v) => v * scale), n = r.length - 1;
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const dx = (x + 0.5 - cx) * dir, dy = y + 0.5 - cy;
    if (dx < 0.5) continue;
    const rr = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    if (a < lead || a > lead + spread) continue;
    const t = (a - lead) / spread * n;
    const i = Math.min(n - 1, Math.floor(t)), fr = t - i;
    if (rr > (r[i] * (1 - fr) + r[i + 1] * fr) - 1.4 * Math.sin(fr * Math.PI)) continue;   // scalloped hem
    const k = (a - lead) / spread;
    setPx(p, x, y, k < 0.3 ? keys[2] : k < 0.72 ? keys[1] : keys[0]);
  }
  for (let i = 0; i <= n; i++) {
    const a = lead + spread * i / n, len = r[i] - 1.2;
    line(p, Math.round(cx), Math.round(cy), Math.round(cx + Math.cos(a) * len * dir), Math.round(cy + Math.sin(a) * len), keys[3]);
  }
}

// tiny body: outsized notched ears, a fanged snout, a fold of fur across the chest
const BAT_BODY_S = paint(`
.df......fd.
.dfd....dfd.
.dffd..dffd.
.dffd..dffd.
..dfd..dfd..
..dffffffd..
.dffffffffd.
.dfEWWWEfed.
.dfERRREfed.
.dffffffeed.
..dff99feed.
..ddf88fdd..
...dffffd...
....dffd....
.....dd.....`);
const BAT_BODY_E = paint(`
.df......
.dfd.df..
.dffddfd.
..dffffd.
..dfffffd
..dffEWfd
..dffERf9
...dfffe8
....dffd.
....ddd..`);
const BAT_BODY_N = paint(`
.df......fd.
.dfd....dfd.
.ddfd..dfdd.
..dfd..dfd..
...dffffd...
..deeeeeed..
..deeeeeed..
..ddeeeedd..
...ddeedd...
....deed....
.....dd.....`);

const BAT_MEMBRANE_L = 'bccf';   // screen-left wing faces the key light
const BAT_MEMBRANE_R = 'aabe';
const BAT_BACK_L = 'deff';
const BAT_BACK_R = 'ddee';

function batFrame(f, { wing = 1, dy = 0, dx = 0, bodyDy = 0 } = {}) {
  const ph = BAT_FLAP[wing];
  const px = makePix(BAT_W, BAT_H);
  if (f === 'E') {
    // flying east: both wings sweep BACK over the shoulders, leaving the fanged head clear
    batWing(px, 20 + dx, 14 + dy, ph, -1, BAT_MEMBRANE_R, 0.6);
    batWing(px, 23 + dx, 11 + dy, ph, -1, BAT_MEMBRANE_L, 0.85);
    return ink(BAT_W, BAT_H, [L(px, 0, 0), L(BAT_BODY_E, 22 + dx, 6 + dy + bodyDy)]);
  }
  const back = f === 'N';
  // the whole bat rides ~4 texels off the floor in every facing, so its contact shadow stays the
  // small faint pool of something airborne rather than snapping to full strength when it turns
  batWing(px, 15 + dx, 10 + dy, ph, -1, back ? BAT_BACK_L : BAT_MEMBRANE_L);
  batWing(px, 21 + dx, 10 + dy, ph, 1, back ? BAT_BACK_R : BAT_MEMBRANE_R);
  return ink(BAT_W, BAT_H, [L(px, 0, 0), L(back ? BAT_BODY_N : BAT_BODY_S, 12 + dx, 4 + dy + bodyDy)]);
}

function batAnims(f) {
  const mk = (o) => batFrame(f, o);
  // hover: the flap never stops and the body bobs against it
  const idle = { frames: [mk({ wing: 0, dy: 1 }), mk({ wing: 1, dy: 0 }), mk({ wing: 2, dy: -1 }), mk({ wing: 1, dy: 0 })], durations: [120, 100, 120, 100], loop: true };
  const walk = { frames: [mk({ wing: 0, dy: 1 }), mk({ wing: 1, dy: 0 }), mk({ wing: 2, dy: -1 }), mk({ wing: 1, dy: 0 })], durations: [80, 70, 80, 70], loop: true };
  const push = f === 'E' ? 3 : 0;
  const attack = {
    frames: [
      mk({ wing: 0, dy: -1, dx: f === 'E' ? -2 : 0 }),
      mk({ wing: 2, dy: 2, dx: push, bodyDy: 1 }),
      mk({ wing: 2, dy: 1, dx: push }),
      mk({ wing: 1, dy: 0 }),
    ],
    durations: [110, 80, 110, 140], loop: false,
  };
  const recoil = mk({ wing: 0, dy: 2, dx: f === 'E' ? -2 : 0 });
  const hurt = { frames: [flash(recoil), recoil], durations: [70, 170], loop: false };
  const d0 = mk({ wing: 2, dy: 3 });
  const d1 = mk({ wing: 2, dy: 4 });
  const heap = squashTo(mk({ wing: 2, dy: 8 }), 0.4, BAT_H - 3);
  const death = { frames: [d0, d1, heap, squashTo(heap, 0.85, BAT_H - 3), squashTo(heap, 0.75, BAT_H - 3)], durations: [110, 130, 180, 520, 700], loop: false };
  return { idle, walk, attack, hurt, death };
}

/** Vampire bat: 36x24, all wing — it hovers, so its fills never reach the contact row. */
export function buildVampireBat() {
  return { anims: clips(batAnims), palette: VERMIN_PALETTE, w: BAT_W, h: BAT_H, pivot: BAT_PIVOT, emissive: '' };
}

// ==========================================================================================
//                                         SPIDER
// ==========================================================================================
// Eight articulated legs with the knees riding ABOVE the body — the shape nothing else in the
// dungeon has. In the 3/4 top-down view the bulbous abdomen sits away from the camera and the small
// eyed cephalothorax nearest it, so the south facing reads eyes-low, abdomen-high.
const SPI_W = 28, SPI_H = 20, SPI_PIVOT = { x: 14, y: 19 };

const SPI_LEGS_S = [
  paint(`
..gg..................gg..
.ghhg................ghhg.
.ghhhg..............ghhhg.
gh...hg....gggg....gh...hg
h.....hgg.ghhhhg.gghh....h
g......ghhgh..hgghhg.....g
g.......ghg....ghg.......g
g........g......g........g
g........g......g........g
h........h......h........h`),
  paint(`
....................gg....
...gg...............ghhg..
..ghhg.............ghhhg..
.ghhhhg...gggg....ghh..hg.
gh....hg.ghhhhg..ghh....hg
h......ghgh..hgghhg......h
g.......ghg....ghg.......g
g........g......g........g
h........h......h........h
.h.......h......h.......h.`),
  paint(`
..gg......................
.ghhg...............gg....
.ghhhg.............ghhg...
gh...hg....gggg...ghhhhg..
h.....hgg.ghhhhg.gh....hg.
g......ghhgh..hgghg......h
g.......ghg....ghg.......g
h........g......g........g
.h.......h......h........h
.h.......h......h.......h.`),
];
// abdomen (top, away) with its pale hourglass, then the cephalothorax and the eye crescent (bottom)
const SPI_BODY_S = paint(`
...iiii...
..ihhhhi..
.ihhhhhhi.
ihhhjjhhhi
ihhjyyjhhi
ihhhjjhhhi
.ihhhhhhi.
..ihhhhi..
.ihhiihhi.
.hhhhhhhh.
.hYhYYhYh.
.hhYhhYhh.
..ihhhhi..
...iiii...`);

const SPI_LEGS_E = [
  paint(`
.....gg.........gg....
....ghhg.......ghhg...
...ghhhhg.....ghhhhg..
..gh....hg...gh....hg.
.gh......hg.gh......hg
gh........hgh........h
g.........g.g........g
h.........h.h........h`),
  paint(`
...gg.............gg..
..ghhg...........ghhg.
.ghhhhg.........ghhhhg
gh....hg.......gh....h
h......hg.....gh.....g
g.......hg...gh......g
g........h...h.......h
h........h...h.......h`),
  paint(`
......gg.......gg.....
.....ghhg.....ghhg....
....ghhhhg...ghhhhg...
...gh....hg.gh....hg..
..gh......hgh......hg.
.gh........h........hg
.g.........g.......g.g
.h.........h.......h.h`),
];
const SPI_BODY_E = paint(`
..iiiii......
.ihhhhhhi....
ihhjjhhhi....
ihjyyjhhhij..
ihhjjhhhhijjh
ihhhhhhhhihYh
.ihhhhhhi.hYh
..ihhhhi..hhh
...iiii......`);

const SPI_BODY_N = paint(`
...iiii...
..ihhhhi..
.ihhhhhhi.
ihhhjjhhhi
ihhjyyjhhi
ihhjyyjhhi
ihhhjjhhhi
.ihhhhhhi.
..ihhhhi..
.ihhiihhi.
.hhhhhhhh.
..hhhhhh..
...hhhh...`);

function spiderFrame(f, { pose = 0, dy = 0, dx = 0, bodyDy = 0 } = {}) {
  if (f === 'E') {
    return ink(SPI_W, SPI_H, [
      L(SPI_LEGS_E[pose], 3 + dx, 7 + dy),
      L(SPI_BODY_E, 7 + dx, 6 + dy + bodyDy),
    ]);
  }
  if (f === 'N') {
    return ink(SPI_W, SPI_H, [
      L(SPI_LEGS_S[pose], 1 + dx, 6 + dy),
      L(SPI_BODY_N, 9 + dx, 4 + dy + bodyDy),
    ]);
  }
  return ink(SPI_W, SPI_H, [
    L(SPI_LEGS_S[pose], 1 + dx, 6 + dy),
    L(SPI_BODY_S, 9 + dx, 4 + dy + bodyDy),
  ]);
}

function spiderAnims(f) {
  const mk = (o) => spiderFrame(f, o);
  // the east lunge is kept to two texels: any further and the leading leg tips lose their outline
  const idle = { frames: [mk({ pose: 0 }), mk({ pose: 0, bodyDy: 1 }), mk({ pose: 0, bodyDy: 1 }), mk({ pose: 0 })], durations: [340, 240, 240, 300], loop: true };
  // skitter: the tripod gait alternates and the body barely rises
  const walk = { frames: [mk({ pose: 1 }), mk({ pose: 0, bodyDy: -1 }), mk({ pose: 2 }), mk({ pose: 0, bodyDy: -1 })], durations: [90, 80, 90, 80], loop: true };
  const push = f === 'E' ? 2 : 0;
  const attack = {
    frames: [
      mk({ pose: 1, dy: 1, bodyDy: -3, dx: f === 'E' ? -2 : 0 }),
      mk({ pose: 2, dy: -1, bodyDy: 1, dx: push }),
      mk({ pose: 2, dy: 0, bodyDy: 1, dx: push }),
      mk({ pose: 0, dy: 1 }),
    ],
    durations: [120, 80, 110, 140], loop: false,
  };
  const recoil = mk({ pose: 2, dy: 1, bodyDy: 0, dx: f === 'E' ? -2 : 0 });
  const hurt = { frames: [flash(recoil), recoil], durations: [70, 170], loop: false };
  // the legs curl under and it settles onto its back
  const d0 = mk({ pose: 2, dy: 1, bodyDy: 0 });
  const d1 = ink(SPI_W, SPI_H, [L(SPI_LEGS_S[0], 1, 9), L(f === 'E' ? SPI_BODY_E : SPI_BODY_S, 9, 4)]);
  const d2 = squashTo(d1, 0.55, SPI_H - 3);
  const death = { frames: [d0, d1, d2, squashTo(d1, 0.4, SPI_H - 3), squashTo(d1, 0.34, SPI_H - 3)], durations: [110, 140, 170, 520, 700], loop: false };
  return { idle, walk, attack, hurt, death };
}

/** Spider: 28x20, eight articulated legs with the knees riding above the body. */
export function buildSpider() {
  return { anims: clips(spiderAnims), palette: VERMIN_PALETTE, w: SPI_W, h: SPI_H, pivot: SPI_PIVOT, emissive: '' };
}

// ==========================================================================================
//                                       GREEN SLIME
// ==========================================================================================
// Translucency without alpha: the gel is darkest where it is thickest (the middle), and the thin
// skirt where the light passes right through is the palest tone on the sprite. A dark nucleus hangs
// inside it, a step brighter at its rim, and drifts a pixel or two as the body wobbles. The dome
// looks the same from every side, so the facings differ by where the nucleus rides and which way
// the crown drip runs — nothing is faked as a "back view" that could not exist.
const SLM_W = 24, SLM_H = 20, SLM_PIVOT = { x: 12, y: 19 };

const SLM_BODY = [
  paint(`
.....pppppp.....
...ppoooooopp...
..ppoonnnnoopp..
.ppoonnnnnnoopp.
ppoonnnnnnnnoopp
poonnnnnnnnnnoop
ponnnnnnnnnnnnop
ponnnnnnnnnnnnop
ponnnnnnnnnnnnop
poonnnnnnnnnnoop
ppoonnnnnnnnoopp
qppooonnnnoooppq
qqppppppppppppqq
.qqqqqqqqqqqqqq.`),
  paint(`
....pppppppp....
...ppoooooopp...
..ppoonnnnoopp..
.ppoonnnnnnoopp.
ppoonnnnnnnnoopp
poonnnnnnnnnnoop
ponnnnnnnnnnnnop
ponnnnnnnnnnnnop
poonnnnnnnnnnoop
ppoonnnnnnnnoopp
ppooonnnnnnooopp
qqpppppppppppppq
qqqpppppppppqqqq
.qqqqqqqqqqqqqq.`),
  paint(`
....pppppppp....
..ppoooooooopp..
.ppoonnnnnnoopp.
ppoonnnnnnnnoopp
poonnnnnnnnnnoop
ponnnnnnnnnnnnop
poonnnnnnnnnnoop
ppoonnnnnnnnoopp
qppooonnnnoooppq
qqppppppppppppqq
.qqqqqqqqqqqqqq.`),
  paint(`
................
...pppppppppp...
.ppoooooooooopp.
ppoonnnnnnnnoopp
poonnnnnnnnnnoop
poonnnnnnnnnnoop
ppoonnnnnnnnoopp
qppooooooooooppq
qqppppppppppppqq
qqqpppppppppqqqq
.qqqqqqqqqqqqqq.`),
];
// the key light glancing off the crown, and a drip about to run down the flank
const SLM_GLINT = paint(`
.sss.
sssq.
.ss..`);
const SLM_DRIP = [paint(`
.pp.
poop
poop
.pp.`), paint(`
.pp.
poop
poop
poop
.pp.`), paint(`
.pp.
poop
.pp.`)];
// nucleus: a dark core inside a brighter halo, suspended in the gel
const SLM_CORE = paint(`
.mmmm.
mmrrmm
mrrrrm
mrrrrm
mmrrmm
.mmmm.`);

function slimeFrame(f, { body = 0, coreDx = 0, coreDy = 0, drip = 0, dy = 0, dx = 0 } = {}) {
  const b = SLM_BODY[body];
  const top = SLM_H - 2 - b.h - dy;   // the bodies differ in height: keep the skirt on the floor
  const cx = f === 'E' ? 2 : f === 'N' ? -2 : 0;
  return ink(SLM_W, SLM_H, [
    L(b, 4 + dx, top),
    L(SLM_CORE, 9 + dx + cx + coreDx, top + b.h - 9 + coreDy),
    L(SLM_GLINT, 7 + dx + (f === 'E' ? -1 : f === 'N' ? 2 : 0), top + 2),
    drip ? L(SLM_DRIP[drip - 1], 5 + dx + (f === 'E' ? 11 : f === 'N' ? 3 : 8), top - 2) : null,   // a bead of ooze welling off the crown
  ]);
}

function slimeAnims(f) {
  const mk = (o) => slimeFrame(f, o);
  // the wobble is the whole personality: it never holds a shape
  const idle = {
    frames: [mk({ body: 0 }), mk({ body: 1, coreDx: 1, drip: 1 }), mk({ body: 2, coreDy: 1, drip: 2 }), mk({ body: 1, coreDx: -1, drip: 3 })],
    durations: [320, 280, 300, 280], loop: true,
  };
  const walk = {
    frames: [mk({ body: 2, coreDy: 1 }), mk({ body: 1, dy: 1, coreDx: 1 }), mk({ body: 0, dy: 2, coreDx: 1, coreDy: -1 }), mk({ body: 1, dy: 1 }), mk({ body: 2, coreDx: -1 }), mk({ body: 3, coreDy: 1 })],
    durations: [90, 90, 90, 90, 90, 90], loop: true,
  };
  const push = f === 'E' ? 3 : 0;
  // engulf: it draws up tall, then slams flat over its prey
  const attack = {
    frames: [mk({ body: 0, dy: 1, drip: 1 }), mk({ body: 3, dx: push, coreDy: 1 }), mk({ body: 3, dx: push, coreDx: 1, coreDy: 1 }), mk({ body: 2 })],
    durations: [130, 90, 110, 140], loop: false,
  };
  const recoil = mk({ body: 3, dx: f === 'E' ? -2 : 0, coreDy: 1 });
  const hurt = { frames: [flash(recoil), recoil], durations: [70, 170], loop: false };
  // it loses cohesion: it spreads, the nucleus dulls and it becomes a puddle
  const d0 = mk({ body: 3, coreDy: 1 });
  const d1 = squashTo(mk({ body: 3, coreDy: 1 }), 0.6, SLM_H - 3);
  const puddle = ink(SLM_W, SLM_H, [L(paint(`
..qqmmmmmmmmqq..
.qmmmmmmmmmmmmq.
qqmmmmmrrmmmmmqq
.qqqqqqqqqqqqqq.`), 4, SLM_H - 6)]);
  const puddle2 = ink(SLM_W, SLM_H, [L(paint(`
.qqmmmmmmmmmmqq.
qqmmmmmmmmmmmmqq
.qqqqqqqqqqqqqq.`), 4, SLM_H - 5)]);
  const death = { frames: [d0, d1, puddle, puddle2, puddle2], durations: [120, 150, 190, 520, 700], loop: false };
  return { idle, walk, attack, hurt, death };
}

/** Green slime: 24x20, a translucent wobbling dome with a dark inner nucleus. */
export function buildGreenSlime() {
  return { anims: clips(slimeAnims), palette: VERMIN_PALETTE, w: SLM_W, h: SLM_H, pivot: SLM_PIVOT, emissive: 's' };
}

// ==========================================================================================
//                                         KOBOLD
// ==========================================================================================
// A head-and-a-half of hunched dog-snouted lizard-dog: two backswept horns, a protruding muzzle with
// a black nose and bared teeth, a hide kilt and a crude bone-tipped spear held across the body. At
// 33 px it stands two thirds the hero's height, which is the point — it is fodder that looks it.
const KOB_W = 30, KOB_H = 36, KOB_PIVOT = { x: 15, y: 35 };

const KOB_HEAD_S = paint(`
.w..........w.
.wv........vw.
..wv......vw..
..vvwwwwwwvv..
.vwwwwwwwwwwv.
vwwwwwwwwwwwwv
vwREwwwwwwERwv
vwwEwwwwwwEwwv
.vwwwwwwwwwwv.
.vvwwwwwwwwvv.
..vwwwwwwwwv..
..vwwuuuuwwv..
...vuwxxwuv...
....v9999v....
.....vuuv.....`);
const KOB_HEAD_E = paint(`
.w..........
.wv...w.....
..wv..wv....
..vvwwwv....
.vwwwwwwv...
vwwwwwwwwv..
vwREwwwwwv..
vwwEwwwwwww.
.vwwwwwwwwww
.vvwwwwwwwwx
..vwwwwwww99
..vwwwwwwww8
...vwwwwwv..
....vvvv....`);
const KOB_HEAD_N = paint(`
.w..........w.
.wv........vw.
..wv......vw..
..vvwwwwwwvv..
.vwwwwwwwwwwv.
vwwvvvvvvvvwwv
vwvvvvvvvvvvwv
vwvvvvvvvvvvwv
.vvvvvvvvvvvv.
.vvvvvvvvvvvv.
..vvvvvvvvvv..
...vvvvvvvv...
....vvvvvv....`);

const KOB_TORSO_S = paint(`
..vvwwwwvu..
.vwwwwwwwuv.
vwwwwwwwwuuv
vwxwwwwwwuuv
vwwxwwwwuuuv
.vwwxwwwuuv.
.vwwwxwwuuv.
..vwwwxwuv..
..xyzzzzyx..
.xyzzzzzzyx.
.xyzzzzzzyx.
..xyzzzzyx..`);
const KOB_TORSO_E = paint(`
.vvwwwwu.
vwwwwwwuv
vwxwwwwuv
vwwxwwwuv
vwwwxwwuv
.vwwxwwu.
.vwwwxwu.
..vwwwwu.
..xyzzzy.
.xyzzzzyx
.xyzzzzyx
..xyzzzy.`);
const KOB_TORSO_N = paint(`
..vvvvvvuu..
.vvvvvvvvuv.
vvvvvvvvvuuv
vvvvvvvvvuuv
vvvvvvvvuuuv
.vvvvvvvuuv.
.vvvvvvvuuv.
..vvvvvvuv..
..xyzzzzyx..
.xyzzzzzzyx.
.xyzzzzzzyx.
..xyzzzzyx..`);

// arms: a hanging pair and the spear arm driven forward for the thrust
const KOB_ARM = paint(`
vww
vww
vwu
vwu
vuu
vuu
xyu
xyx
.x.`);
const KOB_ARM_UP = paint(`
vww
vww
vwu
vwu
xyu
xyx
.x.`);
const KOB_ARM_FWD = paint(`
vwwwu
xywwu
.xyx.`);

const KOB_LEGS = {
  stand: paint(`
.vwwv..vwwv.
.vwwv..vwwv.
.vwwu..vwwu.
.vwwu..vwwu.
xyyyx..xyyyx`),
  lfwd: paint(`
.vwwv...vwwv
.vwwv...vwwv
.vwwu..vwwu.
vwwu...vwwu.
xyyx...xyyyx`),
  rfwd: paint(`
vwwv...vwwv.
vwwv...vwwv.
.vwwu..vwwu.
.vwwu...vwwu
xyyyx...xyyx`),
  crouch: paint(`
vwwwv..vwwwv
vwwwu..vwwwu
xyyyyx.xyyyx`),
};

// the crude spear: a lashed shaft with a chipped bone head
const SPEAR = {
  rest: paint(`
..8..
.898.
.898.
.898.
.898.
..9..
..T..
.zy..
.zy..
.zy..
.zT..
.zy..
.zy..
.zy..
.zT..
.zy..
.zy..
.zy..
.zy..
.zy..
.zy..
..y..`),
  raise: paint(`
...8.
..898
..898
..898
..898
...9.
...T.
..zy.
..zy.
..zy.
..zT.
..zy.
..zy.
..zy.
..zT.
..zy.
..zy.
..zy.`),
  thrust: paint(`
.........889
zyzyzTzyzy98
.........889`),
  low: paint(`
...........8
zyzyzTzyzy98
..........89`),
};

function kobFrame(f, { legs = 'stand', dy = 0, dx = 0, headDy = 0, spear = 'rest', spearAt = null } = {}) {
  const head = f === 'S' ? KOB_HEAD_S : f === 'E' ? KOB_HEAD_E : KOB_HEAD_N;
  const torso = f === 'S' ? KOB_TORSO_S : f === 'E' ? KOB_TORSO_E : KOB_TORSO_N;
  const hx = f === 'S' ? 8 : f === 'E' ? 10 : 8;
  const tx = f === 'S' ? 9 : f === 'E' ? 10 : 9;
  const sp = SPEAR[spear];
  const thrusting = spear === 'thrust' || spear === 'low';
  const at = spearAt || (f === 'E' ? { x: 24, y: 6 } : f === 'N' ? { x: 4, y: 5 } : { x: 22, y: 6 });
  // the weapon arm is on the screen-right for south/east and screen-left from behind
  const armR = { x: (f === 'E' ? 18 : f === 'N' ? 6 : 20) + dx, y: 19 + dy };
  const armL = { x: (f === 'E' ? 8 : f === 'N' ? 20 : 8) + dx, y: 19 + dy };
  const weaponArm = thrusting
    ? L(KOB_ARM_FWD, armR.x - (f === 'N' ? 3 : 0), armR.y + 1)
    : L(spear === 'raise' ? KOB_ARM_UP : KOB_ARM, armR.x, armR.y);
  return ink(KOB_W, KOB_H, [
    f === 'N' ? L(sp, at.x + dx, at.y + dy) : null,
    f === 'N' ? weaponArm : null,
    L(KOB_LEGS[legs], 9 + dx, legs === 'crouch' ? 31 : 29),
    L(KOB_ARM, armL.x, armL.y),
    L(torso, tx + dx, 17 + dy),
    L(head, hx + dx, 2 + dy + headDy),
    f === 'N' ? null : weaponArm,
    f === 'N' ? null : L(sp, at.x + dx, at.y + dy),
  ]);
}

function kobAnims(f) {
  const mk = (o) => kobFrame(f, o);
  const idle = {
    frames: [mk({ dy: 0 }), mk({ dy: 1 }), mk({ dy: 1, headDy: 1 }), mk({ dy: 0 })],
    durations: [340, 260, 220, 300], loop: true,
  };
  const walk = {
    frames: [mk({ legs: 'lfwd', dy: 0 }), mk({ legs: 'lfwd', dy: 1 }), mk({ legs: 'stand', dy: -1 }), mk({ legs: 'rfwd', dy: 0 }), mk({ legs: 'rfwd', dy: 1 }), mk({ legs: 'stand', dy: -1 })],
    durations: [95, 95, 95, 95, 95, 95], loop: true,
  };
  const push = f === 'E' ? 3 : 0;
  const thrustAt = f === 'E' ? { x: 13, y: 18 } : f === 'N' ? { x: 4, y: 17 } : { x: 8, y: 20 };
  const attack = {
    frames: [
      mk({ legs: 'crouch', dy: 2, spear: 'raise', spearAt: f === 'E' ? { x: 22, y: 4 } : f === 'N' ? { x: 5, y: 3 } : { x: 20, y: 3 }, dx: f === 'E' ? -2 : 0 }),
      mk({ legs: 'lfwd', dy: -1, spear: 'thrust', spearAt: thrustAt, dx: push }),
      mk({ legs: 'lfwd', dy: 0, spear: 'low', spearAt: { x: thrustAt.x, y: thrustAt.y + 2 }, dx: push }),
      mk({ dy: 1, spear: 'rest' }),
    ],
    durations: [120, 80, 110, 150], loop: false,
  };
  const recoil = mk({ legs: 'crouch', dy: 2, dx: f === 'E' ? -2 : 0, headDy: 1 });
  const hurt = { frames: [flash(recoil), recoil], durations: [70, 170], loop: false };
  const d0 = mk({ legs: 'crouch', dy: 3, headDy: 2 });
  const d1 = mk({ legs: 'crouch', dy: 6, headDy: 4 });
  const heap = squashTo(d1, 0.4, KOB_H - 3);
  const death = { frames: [d0, d1, heap, squashTo(d1, 0.3, KOB_H - 3), squashTo(d1, 0.26, KOB_H - 3)], durations: [130, 160, 200, 560, 720], loop: false };
  return { idle, walk, attack, hurt, death };
}

/** Kobold: 30x36, a small hunched dog-snouted humanoid with a bone-tipped spear. */
export function buildKobold() {
  return { anims: clips(kobAnims), palette: VERMIN_PALETTE, w: KOB_W, h: KOB_H, pivot: KOB_PIVOT, emissive: '' };
}

// ---------------------------------------------------------------------------------- registry
/**
 * The vermin group: monster type -> builder. `spider` also stands in for the game's only spider,
 * the Dimension Spider (its blink VFX is drawn by the renderer, not the sprite).
 * @type {Object<string, () => {anims:object, palette:import('../pixelPainter.js').Palette, w:number, h:number, pivot:{x:number,y:number}, emissive:string}>}
 */
export const VERMIN_SPRITES = {
  'giant-rat': buildGiantRat,
  'vampire-bat': buildVampireBat,
  'spider': buildSpider,
  // 'dimension-spider' is NOT this spider: it is a real MONSTER_TABLE type with eight jointed
  // legs and an out-of-register echo, drawn in monsters/drakes.js. `spider` below stays as the
  // generic six-legger for anything that asks for one by name.
  'green-slime': buildGreenSlime,
  'slime': buildGreenSlime,
  'kobold': buildKobold,
};

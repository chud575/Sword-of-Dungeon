// beasts: the four monsters of the dungeon that are neither people nor apex horrors — the DIRE
// WOLF, the WEREBEAR, the GARGOYLE and the TROLL — drawn as HD-2D pixel sprites under the one
// house style law (sprites/style.js): its ink, its top-left key light, its hue-shifted ramps and
// its size table. Every type here is a real `MONSTER_TABLE` entry (game/monsters.js); nothing in
// this file is a creature the game cannot spawn.
//
// HOUSE STYLE (style.js is the law; this is how it is applied here)
//  · Colour is `ramp()` from style.js and nothing else: hue-shifted steps, shadows drifting violet
//    and gaining saturation, highlights drifting amber and losing a little.
//  · The key light is `LIT` — top-left — on every facing. The big organic masses (barrel, haunch,
//    hump, shoulder, skull) are struck with `tone()`, a real lambert term quantised onto the ramp,
//    so a limb TURNS instead of pillowing concentric to its own outline. Faces, fangs, claws,
//    hackles and cracks are hand-placed on top.
//  · Anything that crosses the body — an arm, a folded leg, a skull, a wing — is drawn through
//    `part()`, which rings it in the darkest step of its own ramp. Without that contact edge two
//    forms of the same material melt into one blob at gameplay distance, which is the single most
//    common way a big sprite dies.
//  · `ink()` lays the single one-pixel `INK` outline last, softened to `INK_LIT` on the edges that
//    face the light. Nothing dithers, nothing bands.
//  · South / east / north are posed deliberately; west is the mirrored east.
//  · Fills stop two rows above the pivot row so the outline lands on the contact row and
//    spriteSheet's foot metrics drop the contact shadow under the real feet.
//
// SILHOUETTES (none of the four can be confused with each other or with any other group)
//  dire wolf  the only LOW QUADRUPED in the cast: a long lean chassis on tall thin legs, the back
//             line broken by a standing ridge of hackles, the head carried level with the spine on
//             a neck as thick as the skull, a brush tail streaming clear behind — and two amber
//             eyes that catch the torchlight when nothing else about it does.
//  werebear   a wall of fur, twice as wide as the troll at the shoulder: the SHOULDER MASS is the
//             highest point and the small skull hangs BELOW and in front of it, so the creature
//             reads as bulk with a head as an afterthought. Forearms as thick as its thighs reach
//             the knee and end in four hooked claws; the whole outline is ragged with shag, which
//             is what tells it from the ogre's smooth boulder at a glance.
//  gargoyle   perched, not standing: haunches folded up beside the ribs with the KNEES ABOVE THE
//             SHOULDERS and clawed hands planted on the stone in front, crouching on a ledge that
//             is not there. The read is the pair of folded wings, each peaking in a spur well
//             above the horns. Cold slate against the dungeon's warm sandstone walls, cracked at
//             the joints and lichened in the cracks.
//  troll      all vertical, and the thinnest thing in the game for its height: narrow sloped
//             shoulders, a small head thrust forward on no neck at all, a pot belly slung under a
//             narrow ribcage, and the ARMS HANGING PAST THE KNEES with the knuckles nearly
//             grazing the floor. The signature is the raw wound on its shoulder knitting shut with
//             pale new flesh while it stands there.
import { Palette, outline, houseOutline, seamInk, makePix, setPx as putPx, getPx, mirrorLit, smearArc as rawSmear } from '../pixelPainter.js';
import { INK, INK_LIT, INK_DEEP, LIT, ramp } from '../style.js';

/** @typedef {import('../pixelPainter.js').Pix} Pix */

// ---------------------------------------------------------------------------------- palette
// One palette for the group; keys are unique per creature so a mis-keyed pixel screams in the sheet.
export const BEAST_PALETTE = new Palette().set('#', INK).set('@', INK_LIT);

/**
 * Register `keys` (darkest first) from ONE house ramp — `ramp()` in style.js and nothing else.
 * `pick` selects which steps of a longer ramp the keys land on, so a 2-key accent keeps the same
 * hue drift as its 5-key neighbours instead of inventing a second, flatter ramp.
 * @param {string} keys @param {string} base @param {{steps?:number, pick?:number[]}} [o]
 * @returns {string} the keys, so a builder can write `const FUR = band('12345', ...)`
 */
function band(keys, base, { steps = Math.max(5, keys.length), pick = null } = {}) {
  // a gentler drift than the ramp default: at satShift 0.10 the top step of a low-chroma hide goes
  // fully achromatic, which is how a brown bear ends up highlighted in dead grey.
  const cols = ramp(base, steps, { satShift: 0.045, hueShift: 0.032 });
  const idx = pick || [...keys].map((_, i) => Math.round((i * (steps - 1)) / (keys.length - 1)));
  [...keys].forEach((k, i) => BEAST_PALETTE.set(k, cols[idx[i]]));
  return keys;
}

const FUR = band('12345', '#6f6152', { steps: 6, pick: [1, 2, 3, 4, 5] });   // dire wolf: ash-brown wolf pelt
const PELT = band('abcde', '#54402e');                            // werebear: dark umber shag
const MUZZLE = band('fg', '#8a6f52', { steps: 5, pick: [1, 3] }); // wolf / bear snout leather
const STONE = band('hijkl', '#5f6d80', { steps: 6, pick: [1, 2, 3, 4, 5] }); // gargoyle: cold slate vs warm walls
const HIDE = band('nopqr', '#6d7550', { steps: 6, pick: [1, 2, 3, 4, 5] });  // troll: sickly bog green
const MATTED = band('tu', '#553a2a', { steps: 5, pick: [1, 3] }); // troll's matted hair
const BONE = band('BCD', '#cfc4a6', { steps: 5, pick: [2, 3, 4] }); // fangs, claws, horn tips
BEAST_PALETTE
  .set('K', '#7c6f52')                                            // keratin: the shaft of a claw
  .set('6', '#2f2836')                                            // wet nose / paw pads
  .set('7', '#8e4d59')                                            // tongue / gum
  .set('m', '#61724a')                                            // lichen in the gargoyle's crevices
  .set('s', '#b58a82')                                            // troll: pale new flesh over a closing wound
  .set('E', INK_DEEP).set('W', '#fff3e2')                         // eye socket / catch-light
  .set('Y', '#e8a33a').set('R', '#c9503c')                        // ember iris / blood iris
  .set('F', '#fff4f0');                                           // hurt flash

// THE THREE PICKS ABOVE ARE THE ONLY EDIT THIS FILE TOOK from the repaint-dark pass, and they are
// one idea: a `band()` whose default pick starts at step 0 puts its darkest key on the tone
// `ramp()` pins at luminance 0.15 whatever the base colour, so the wolf, the gargoyle and the troll
// each had a quarter of their coat nailed to the floor of their own ramp and needed the renderer's
// read-lift to be visible at all. Six steps picked 1-5 starts the shadow one step above that floor
// and hands the coat a light step at the top; nothing else about these hides changes.

/**
 * THE SEAM VOCABULARY (pixelPainter `seamInk`): every material of this group, DARKEST FIRST.
 * Reserve INK/INK_LIT for the OUTER CONTOUR: a fold in the werebear's shag or the joint between
 * two blocks of gargoyle is a step down that material's own ramp, not a hole punched in it.
 */
const SEAM_RAMPS = [PELT, FUR, STONE, HIDE, BONE, MUZZLE, MATTED];

// ------------------------------------------------------------------------------- the toolkit
/** Compose is not used here: each creature draws straight into one Pix, then takes the outline. */
const ink = (p) => outline(p, '#', { lit: LIT, litKey: '@' });
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------- THE DRAW SCALE (the size law)
/**
 * WHY THIS EXISTS. style.js `SCALE` is the game's size hierarchy, and for a long time it never
 * reached the screen: `spriteBillboard` sizes a creature purely by HOW MANY TEXELS ITS ART OCCUPIES
 * times one shared texel size, so a troll asking for 1.72x the hero while its sheet was 54 texels
 * tall (the hero is 46) walked on screen at 1.17x — smaller than a war lord. The ladder was dead
 * code and the art was carrying a different, flatter hierarchy of its own.
 *
 * THE FIX IS NOT A MULTIPLIER. Blowing a 54-texel troll up to 79 breaks the shared texel grid: the
 * creature's pixels stop being the hero's pixels and it reads as a zoomed sprite standing next to
 * hand-pixelled ones. Instead every creature in this file is AUTHORED in its own comfortable
 * coordinate space and RASTERISED at `DS` times that space. `mass`, `limb`, `curve`, `crest`,
 * `shag`, `seam`, `panel` and `claws` are analytic: at DS = 1.46 a haunch is not four pixels
 * stretched to six, it is the same solid re-solved on a grid half again as fine, with its own
 * terminator, its own rim and half again as many steps of the ramp showing across it. The room that
 * buys is then spent on detail the small canvas could not hold (see `ribs`, `knuckles`, `scaleRows`
 * below and the per-creature notes).
 *
 * Every hand-placed pixel in a creature body is likewise written in authored space: the local
 * `setPx` below dabs a `ceil(DS)`-sized mark at the scaled position, so a three-pixel brow ridge
 * stays a continuous brow ridge instead of falling apart into three dots with gaps between them.
 */
let DS = 1;
/** Authored length -> texels on the real canvas. */
const S = (v) => v * DS;
/** Round an authored canvas measurement (width, pivot, floor row) to the real grid. */
const R = (v, s) => Math.round(v * s);

/**
 * Set one AUTHORED-space pixel: it covers EXACTLY the texels that authored pixel owns on the real
 * grid (`round(x·DS) .. round((x+1)·DS) - 1`), so at DS = 1 this is `setPx`, and above it a mark is
 * one or two texels wide with no gaps and no overdraw — a hand-drawn brow, fang, seam or eye stays
 * a line at the new resolution instead of falling apart into dots.
 */
function setPx(p, x, y, key) {
  const x0 = Math.round(x * DS), x1 = Math.max(x0, Math.round((x + 1) * DS) - 1);
  const y0 = Math.round(y * DS), y1 = Math.max(y0, Math.round((y + 1) * DS) - 1);
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) putPx(p, xx, yy, key);
}
/** Read one authored-space pixel (the mark's top-left texel). */
const atPx = (p, x, y) => getPx(p, Math.round(x * DS), Math.round(y * DS));
/** `smearArc` in authored space. */
const smearArc = (p, cx, cy, r0, r1, a0, a1, keys) => rawSmear(p, S(cx), S(cy), S(r0), S(r1), a0, a1, keys);

/** Solid-key copy for the hurt flash (the outline stays dark so the silhouette still reads). */
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
    for (let x = 0; x < p.w; x++) { const c = p.d[y * p.w + x]; if (c) putPx(o, x, ty, c); }
  }
  return o;
}

/** Rotate about (cx,cy) by `a` radians, nearest-neighbour (the toppling deaths). */
function tilt(p, a, cx, cy) {
  const o = makePix(p.w, p.h), ca = Math.cos(-a), sa = Math.sin(-a);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const dx = x - cx, dy = y - cy;
    const c = getPx(p, Math.round(cx + dx * ca - dy * sa), Math.round(cy + dx * sa + dy * ca));
    if (c) putPx(o, x, y, c);
  }
  return o;
}

/** Standard clip set assembled from per-facing frame makers; west is the mirrored east. */
function clips(make) {
  const anims = {};
  // THE INK, LAST AND ONCE (see pixelPainter.houseOutline): frames arrive outlined part-by-part or
  // resampled by the death poses, so the coat can be doubled on a join and missing where one form
  // covered another's ring; the west facing is a mirror, which puts the lit-edge softening on the
  // wrong side. This peels every second coat, lays exactly one pixel of INK round anything bare and
  // re-keys the whole silhouette against the frame as it finally stands.
  // …and then THE SEAM PASS (pixelPainter.seamInk): ink that holds no part of the outer contour is
  // not outline, it is a crease in a pelt or a joint in stone, and it is drawn a step down that
  // material's OWN ramp. INK inside a lit body is the one tone the grade crushes to pure black.
  const inked = (fr) => fr.map((p) => seamInk(houseOutline(p, { key: '#', litKey: '@', lit: LIT }), { ramps: SEAM_RAMPS, keep: 'E' }));
  const put = (name, f, a) => { (anims[name] ||= {})[f] = { name, facing: f, ...a, frames: inked(a.frames) }; };
  for (const f of ['S', 'E', 'N']) for (const [name, a] of Object.entries(make(f))) put(name, f, a);
  for (const name of Object.keys(anims)) {
    const e = anims[name].E;
    if (e) anims[name].W = { ...e, facing: 'W', frames: inked(e.frames.map((p) => mirrorLit(p, ''))) };
  }
  return anims;
}

// The one key light as a unit vector in sprite space (x right, y down, z out of the screen).
// LZ USED TO BE 0.48 AND THAT IS WHAT PILLOWED THE TROLL. With that much light coming straight out
// of the screen, the lambert on a limb peaks about a pixel INSIDE the silhouette and then falls
// back at the very rim — which quantises into a dark line down the LIT side of every arm and
// haunch. A dark line on both sides of a form with the light between them is shadow ringing the
// outside: pillow shading, banned by style.js, and it was on every arm in this file. Pulling the
// light almost into the sprite plane makes the term MONOTONIC across a form, so the brightest
// pixel is the top-left rim itself and the darkest is the bottom-right rim, with one clean
// terminator in between and no bright core.
const LX = -0.66, LY = -0.70, LZ = 0.18;

/**
 * The ramp key for a surface whose normal is (nx, ny, nz = sqrt(1 - nx² - ny²)) — a directional
 * terminator quantised onto `keys` (darkest first). The two constants are solved from two
 * anchors: a surface facing the CAMERA lands just under the ramp's middle step, and a surface
 * facing the LIGHT lands on its top step. Get that wrong in either direction and the whole
 * creature paints itself in two adjacent tones — washed out at one end, a hole at the other.
 * `bias` pushes a form up or down the ramp (a far limb sits a tone back, a lit belly a tone
 * forward).
 */
function tone(nx, ny, keys, bias = 0) {
  const r2 = Math.min(1, nx * nx + ny * ny);
  const lam = nx * LX + ny * LY + Math.sqrt(1 - r2) * LZ;
  let t = lam * 0.639 + 0.325 + bias;
  t = t < 0 ? 0 : t > 0.999 ? 0.999 : t;
  return keys[(t * keys.length) | 0];
}

/** A shaded mass: |nx|^n + |ny|^n <= 1 around (cx,cy). n=2 is an ellipse, 2.6 a barrel, 3.4 a slab. */
function mass(p, cx, cy, rx, ry, keys, { n = 2, bias = 0 } = {}) {
  cx = S(cx); cy = S(cy); rx = S(rx); ry = S(ry);
  const x0 = Math.max(0, Math.floor(cx - rx) - 1), x1 = Math.min(p.w - 1, Math.ceil(cx + rx) + 1);
  const y0 = Math.max(0, Math.floor(cy - ry) - 1), y1 = Math.min(p.h - 1, Math.ceil(cy + ry) + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
    if (Math.pow(Math.abs(nx), n) + Math.pow(Math.abs(ny), n) > 1) continue;
    putPx(p, x, y, tone(nx, ny, keys, bias));
  }
  return p;
}

/** A shaded capsule from (x0,y0) to (x1,y1), radius r0 -> r1: arms, legs, necks, tails, horns. */
function limb(p, x0, y0, x1, y1, r0, r1, keys, bias = 0) {
  x0 = S(x0); y0 = S(y0); x1 = S(x1); y1 = S(y1); r0 = S(r0); r1 = S(r1);
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1e-6, rmax = Math.max(r0, r1);
  const bx0 = Math.max(0, Math.floor(Math.min(x0, x1) - rmax) - 1), bx1 = Math.min(p.w - 1, Math.ceil(Math.max(x0, x1) + rmax) + 1);
  const by0 = Math.max(0, Math.floor(Math.min(y0, y1) - rmax) - 1), by1 = Math.min(p.h - 1, Math.ceil(Math.max(y0, y1) + rmax) + 1);
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    const px = x + 0.5 - x0, py = y + 0.5 - y0;
    let t = (px * dx + py * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ox = px - dx * t, oy = py - dy * t, r = r0 + (r1 - r0) * t;
    if (ox * ox + oy * oy > r * r) continue;
    putPx(p, x, y, tone(ox / r, oy / r, keys, bias));
  }
  return p;
}

/** A capsule chain through `pts` with the radius easing r0 -> r1 (tails, horns, necks, arms). */
function curve(p, pts, r0, r1, keys, bias = 0) {
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    limb(p, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1],
      r0 + (r1 - r0) * (i / n), r0 + (r1 - r0) * ((i + 1) / n), keys, bias);
  }
  return p;
}

/**
 * Draw a sub-form into its own scratch canvas, ring it in the DARKEST step of its own ramp, and
 * stamp the result down — but keep the ring only where it bites into something already drawn, so
 * a limb at the outer edge does not end up double-outlined once `ink()` runs. That contact edge is
 * the whole reason a werebear's arm reads as an arm and not as more werebear.
 * @param {Pix} p @param {string} keys the sub-form's ramp @param {(q:Pix) => void} draw
 */
function part(p, keys, draw) {
  const q = makePix(p.w, p.h);
  draw(q);
  const r = outline(q, keys[0]), K = keys.charCodeAt(0);
  for (let i = 0; i < r.d.length; i++) {
    const c = r.d[i];
    if (!c) continue;
    if (c === K && !q.d[i] && !p.d[i]) continue;
    p.d[i] = c;
  }
  return p;
}

/**
 * A saw of triangular spines standing off a polyline, each along the outward normal, tallest in
 * the middle of the run. `flip` puts them on the other side. The wolf's hackles, the troll's
 * knuckled spine, the gargoyle's ridge.
 */
function crest(p, pts, height, keys, { flip = false, tip = null } = {}) {
  pts = pts.map(([x, y]) => [S(x), S(y)]); height = S(height);
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    const nx = (flip ? dy : -dy) / L, ny = (flip ? -dx : dx) / L;
    const h = height * (Math.sin(((i + 0.5) / n) * Math.PI) * 0.5 + 0.5);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    for (let k = 0; k <= Math.ceil(h); k++) {
      const t = k / Math.max(1, h), half = (1 - t) * (L / 2);
      const cx = mx + nx * k, cy = my + ny * k;
      for (let j = -Math.ceil(half); j <= Math.ceil(half); j++) {
        putPx(p, Math.round(cx + (dx / L) * j), Math.round(cy + (dy / L) * j),
          tip && t > 0.7 ? tip : keys[Math.min(keys.length - 1, 1 + ((t * (keys.length - 1)) | 0))]);
      }
    }
  }
  return p;
}

/** Deterministic tuft lengths — no Math.random anywhere in this project (core/rng.js is the law). */
const TUFT = [2, 3, 1, 3, 2, 1, 2, 3, 1, 2, 3, 2];

/**
 * A ragged fur fringe along a polyline: uneven 1-3 texel tufts pointing along the outward normal,
 * tip on the lighter key. This is what breaks the werebear's outline into shag instead of the
 * ogre's smooth boulder; it is drawn BEFORE `ink()` so the outline wraps every tuft.
 * @param {Pix} p @param {number[][]} pts @param {string} keys @param {{flip?:boolean, seed?:number, lit?:boolean, gain?:number}} [o]
 */
function shag(p, pts, keys, { flip = false, seed = 0, lit = true, gain = 1 } = {}) {
  pts = pts.map(([x, y]) => [S(x), S(y)]); gain *= DS;   // longer tufts on a bigger pelt, not finer ones
  const hi = keys.length - 1;
  const tip = lit ? keys[hi] : keys[Math.max(0, hi - 3)];
  const root = lit ? keys[Math.max(0, hi - 1)] : keys[Math.max(0, hi - 2)];
  let n = seed;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, steps = Math.max(1, Math.round(L));
    const nx = (flip ? dy : -dy) / L, ny = (flip ? -dx : dx) / L;
    for (let s = 0; s < steps; s++, n++) {
      const t = s / steps, x = ax + dx * t, y = ay + dy * t;
      const h = Math.max(1, Math.round(TUFT[n % TUFT.length] * gain));
      for (let k = 0; k < h; k++) putPx(p, Math.round(x + nx * k), Math.round(y + ny * k), k === h - 1 ? tip : root);
    }
  }
  return p;
}

/** A hairline crack / scar / seam that only marks where there is already body under it. */
function seam(p, pts, key, { every = 1 } = {}) {
  pts = pts.map(([x, y]) => [S(x), S(y)]); every = Math.round((every + 1) * DS) - 1;
  let n = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const steps = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay)));
    for (let s = 0; s <= steps; s++, n++) {
      const x = Math.round(lerp(ax, bx, s / steps)), y = Math.round(lerp(ay, by, s / steps));
      if (n % (every + 1) === 0 && getPx(p, x, y)) putPx(p, x, y, key);
    }
  }
  return p;
}

/**
 * A convex quad of membrane / hide, shaded as one soft form around its own centroid so it turns
 * with the same key light as everything else. The gargoyle's folded wings.
 */
function panel(p, pts, keys, bias = 0) {
  pts = pts.map(([x, y]) => [S(x), S(y)]);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const cx = xs.reduce((a, b) => a + b, 0) / pts.length, cy = ys.reduce((a, b) => a + b, 0) / pts.length;
  const rx = Math.max(...xs.map((x) => Math.abs(x - cx))) || 1, ry = Math.max(...ys.map((y) => Math.abs(y - cy))) || 1;
  const inside = (x, y) => {
    let sign = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      if (cross === 0) continue;
      const s = cross > 0 ? 1 : -1;
      if (!sign) sign = s; else if (s !== sign) return false;
    }
    return true;
  };
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(p.h - 1, Math.ceil(Math.max(...ys))); y++) {
    for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(p.w - 1, Math.ceil(Math.max(...xs))); x++) {
      if (!inside(x + 0.5, y + 0.5)) continue;
      putPx(p, x, y, tone((x + 0.5 - cx) / rx * 0.9, (y + 0.5 - cy) / ry * 0.9, keys, bias));
    }
  }
  return p;
}

/**
 * Two to four hooked claws off a paw, leaving along (dx,dy) and CURLING outward as they go, dark
 * keratin shaft with one bright pixel at the point. Drawn as straight bright bars they read as a
 * row of piano keys under every foot in the game, which is exactly what they did in the first pass.
 */
function claws(p, x, y, dx, dy, n = 3, len = 4, spread = 2) {
  x = S(x); y = S(y); len = Math.round(S(len)); spread = S(spread);
  const L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, th = Math.ceil(DS - 1e-6);
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * spread, side = off < 0 ? -1 : 1;
    const ox = x + -uy * off, oy = y + ux * off;
    for (let k = 0; k < len; k++) {
      const t = k / Math.max(1, len - 1), curl = t * t * S(1.5) * side;
      const key = k >= len - 1 ? BONE[1] : k >= len - 2 ? BONE[0] : 'K';
      const px = ox + ux * k * (1 - 0.2 * t) - uy * curl, py = oy + uy * k * (1 - 0.2 * t) + ux * curl;
      for (let w = 0; w < th; w++) putPx(p, Math.round(px - uy * w), Math.round(py + ux * w), key);
    }
  }
  return p;
}

// ==========================================================================================
//                                       DIRE WOLF
// ==========================================================================================
// Read: the only low quadruped in the cast. Long and lean on tall thin legs, back line broken by
// a standing ridge of hackles, head carried LEVEL with the spine on a neck as thick as the skull,
// brush tail streaming behind, amber eyes catching the torch.
/**
 * Authored 42x32 and painted at 1.20x it. The dire wolf wants 0.70 of the hero (32 texels) and its
 * old sheet stood 27 — 0.59, a dog. The extra fifth is spent on the leg joints: at DS the pastern
 * is three texels instead of two, so the hock reads as a real backward bend.
 */
const WF_S = 1.20;
const WF_AW = 42, WF_AH = 32, WF_APIV = { x: 21, y: 31 }, WF_AFLOOR = 29;
const WF_W = R(WF_AW, WF_S), WF_H = R(WF_AH, WF_S);
const WF_PIV = { x: R(WF_APIV.x, WF_S), y: R(WF_APIV.y, WF_S) }, WF_FLOOR = R(WF_AFLOOR, WF_S);

/** A wolf leg: shoulder, a real bend at the elbow/hock, a narrow pastern and a paw on the floor. */
function wolfLeg(p, hx, hy, fx, fy, back, bias) {
  part(p, FUR, (q) => {
    const mx = back ? hx - 2 : hx + 1, my = (hy + fy) / 2;
    curve(q, [[hx, hy], [mx, my], [fx, fy - 1]], 2.5, 1.5, FUR, bias);
    mass(q, fx, fy, 2.6, 1.4, FUR, { n: 2.6, bias: bias - 0.06 });
  });
  setPx(p, fx + 2, fy + 1, 'K');
}

/**
 * One dire-wolf frame.
 * @param {'S'|'E'|'N'} f
 * @param {{bob?:number, gait?:number, headDy?:number, headDx?:number, tail?:number, snarl?:boolean, crouch?:number}} o
 */
function wolfFrame(f, o = {}) {
  DS = WF_S;
  const p = makePix(WF_W, WF_H);
  const b = o.bob || 0, g = o.gait || 0, c = o.crouch || 0;
  const hd = (o.headDy || 0) + c, hx = o.headDx || 0, tl = o.tail || 0;
  const lift = (k) => Math.max(0, k) * 3;

  if (f === 'E') {
    // brush tail: thick at the root, whipped to a point, streaming back and up clear of the rump
    curve(p, [[12, 17 + b + c], [6, 15 + b + c - tl], [1, 9 + b + c - tl * 2]], 4.0, 1.1, FUR, -0.04);
    shag(p, [[11, 14 + b + c], [6, 12 + b + c - tl], [2, 7 + b + c - tl * 2]], FUR, { flip: true, seed: 3, gain: 0.7 });
    // far pair, a full two tones back
    wolfLeg(p, 15, 19 + b + c, 12 - g, WF_AFLOOR - lift(-g), true, -0.22);
    wolfLeg(p, 27, 19 + b + c, 30 + g, WF_AFLOOR - lift(g), false, -0.22);
    // chassis: tucked loin behind, deep chest forward, one barrel linking them
    mass(p, 15, 16.5 + b + c, 6.4, 4.4, FUR, { n: 2.5 });
    mass(p, 20, 16 + b + c, 6.6, 5.0, FUR, { n: 2.6 });
    mass(p, 26, 15.5 + b + c, 6.6, 5.6, FUR, { n: 2.4 });
    seam(p, [[13, 20 + b + c], [24, 20.5 + b + c]], FUR[1], { every: 2 });      // the tucked belly line
    // standing hackles: the back line of a dire wolf is never a smooth arc
    crest(p, [[13, 12 + b + c], [19, 10.5 + b + c], [25, 10.5 + b + c], [29, 12 + b + c]], o.snarl ? 5 : 3.4, FUR, { flip: true });
    // neck, skull and the long muzzle as one part, so the neck reads against the chest
    part(p, FUR, (q) => {
      limb(q, 27, 13.5 + b + c, 32 + hx, 13 + b + hd, 4.6, 3.4, FUR, 0.06);
      mass(q, 33 + hx, 13 + b + hd, 3.7, 3.3, FUR, { n: 2.2, bias: 0.02 });
      limb(q, 34 + hx, 14.5 + b + hd, 41 + hx, 15.5 + b + hd, 2.5, 1.3, FUR, 0.04);
      // pricked ears, pinned back into the snarl
      for (const d of [0, 1]) {
        const ex = 29 + hx + d * 2.6, ey = 9 + b + hd;
        limb(q, ex + (o.snarl ? -1.4 : 0), ey + 3, ex - (o.snarl ? 2 : 0), ey - 1, 1.6, 0.7, FUR, d ? -0.06 : 0.06);
      }
    });
    // face: the brow, one amber eye, the wet nose, the lip curled off a fang
    const fy = 13 + b + hd, fx = 33 + hx;
    setPx(p, fx - 1, fy - 2, FUR[0]); setPx(p, fx, fy - 2, FUR[0]); setPx(p, fx + 1, fy - 1, FUR[0]);
    setPx(p, fx, fy - 1, 'E'); setPx(p, fx + 1, fy - 1, 'Y'); setPx(p, fx + 1, fy - 2, 'W');
    seam(p, [[fx + 2, fy + 3], [fx + 6, fy + 3]], FUR[0], { every: 0 });
    setPx(p, fx + 8, fy + 2, '6'); setPx(p, fx + 7, fy + 2, '6');
    if (o.snarl) { setPx(p, fx + 5, fy + 4, 'D'); setPx(p, fx + 3, fy + 4, 'C'); setPx(p, fx + 4, fy + 3, '7'); }
    // near pair
    wolfLeg(p, 17, 19 + b + c, 15 + g, WF_AFLOOR - lift(g), true, 0.02);
    wolfLeg(p, 25, 19 + b + c, 27 - g, WF_AFLOOR - lift(-g), false, 0.04);
    return ink(p);
  }

  if (f === 'S') {
    // tail hooking out past the near flank
    curve(p, [[27, 19 + b], [33, 17 + b - tl], [36, 12 + b - tl]], 2.6, 1.1, FUR, -0.08);
    // hind pair planted wide behind; the chest is NARROW seen end-on — a wolf is a blade, not a barrel
    wolfLeg(p, 13, 19 + b + c, 11, WF_AFLOOR, true, -0.14);
    wolfLeg(p, 29, 19 + b + c, 31, WF_AFLOOR, false, -0.18);
    mass(p, 21, 16.5 + b + c, 7.2, 5.6, FUR, { n: 2.5 });
    crest(p, [[15, 12 + b + c], [21, 11 + b + c], [27, 12 + b + c]], o.snarl ? 5 : 3.2, FUR, { flip: true });
    wolfLeg(p, 18, 19 + b + c, 17 - g, WF_AFLOOR, true, 0.02);
    wolfLeg(p, 24, 19 + b + c, 25 + g, WF_AFLOOR, false, 0);
    // head slung low between the shoulders, muzzle pointing straight at you
    part(p, FUR, (q) => {
      limb(q, 21 + hx, 15 + b + c, 21 + hx, 14 + b + hd, 4.4, 4.0, FUR, 0.04);
      mass(q, 21 + hx, 13 + b + hd, 5.2, 4.4, FUR, { n: 2.3, bias: 0.02 });
      for (const d of [-1, 1]) limb(q, 21 + hx + d * 4.4, 11 + b + hd, 21 + hx + d * (o.snarl ? 6.5 : 5.4), 7 + b + hd, 1.7, 0.8, FUR, d < 0 ? 0.06 : -0.06);
      mass(q, 21 + hx, 17 + b + hd, 3.2, 2.8, MUZZLE, { n: 2.4, bias: 0.04 });
    });
    {
      const fy = 13 + b + hd, fx = 21 + hx;
      for (const d of [-1, 1]) {
        setPx(p, fx + d * 3, fy - 2, FUR[0]); setPx(p, fx + d * 2, fy - 2, FUR[0]);
        setPx(p, fx + d * 3, fy - 1, d < 0 ? 'E' : 'Y'); setPx(p, fx + d * 2, fy - 1, d < 0 ? 'Y' : 'E');
      }
      setPx(p, fx - 2, fy - 2, 'W');
      setPx(p, fx - 1, fy + 2, '6'); setPx(p, fx, fy + 2, '6'); setPx(p, fx + 1, fy + 2, '6');
      seam(p, [[fx - 3, fy + 5], [fx + 3, fy + 5]], FUR[0], { every: 0 });
      if (o.snarl) { setPx(p, fx - 2, fy + 6, 'D'); setPx(p, fx + 2, fy + 6, 'D'); setPx(p, fx, fy + 6, '7'); }
    }
    return ink(p);
  }

  // NORTH — going away: the rump, the hackle ridge running down the spine, the tail up
  curve(p, [[21, 16 + b], [24, 11 + b - tl], [26, 5 + b - tl]], 2.6, 1.2, FUR, 0.02);
  wolfLeg(p, 13, 19 + b + c, 11, WF_AFLOOR, true, -0.12);
  wolfLeg(p, 29, 19 + b + c, 31, WF_AFLOOR, false, -0.18);
  wolfLeg(p, 18, 19 + b + c, 17 - g, WF_AFLOOR, true, -0.08);
  wolfLeg(p, 24, 19 + b + c, 25 + g, WF_AFLOOR, false, -0.10);
  mass(p, 21, 16.5 + b + c, 7.6, 5.8, FUR, { n: 2.5 });
  seam(p, [[21, 12 + b + c], [21, 21 + b + c]], FUR[1], { every: 1 });
  crest(p, [[15, 12 + b + c], [21, 11 + b + c], [27, 12 + b + c]], 3.4, FUR, { flip: true });
  part(p, FUR, (q) => {
    limb(q, 21, 15 + b + c, 21, 13 + b + hd, 4.4, 4.0, FUR, -0.02);
    mass(q, 21, 12 + b + hd, 4.8, 3.9, FUR, { n: 2.3, bias: -0.03 });
    for (const d of [-1, 1]) limb(q, 21 + d * 4.2, 10 + b + hd, 21 + d * 5.2, 6 + b + hd, 1.7, 0.8, FUR, d < 0 ? 0.04 : -0.08);
  });
  return ink(p);
}

function wolfAnims(f) {
  const mk = (o) => wolfFrame(f, o);
  const idle = {
    frames: [mk({ bob: 0, tail: 0 }), mk({ bob: 0, tail: 1 }), mk({ bob: 1, tail: 1, headDy: 1 }), mk({ bob: 0, tail: 0 })],
    durations: [340, 260, 300, 260], loop: true,
  };
  // a loping trot: two beats, the whole chassis rising and falling with the diagonals
  const walk = {
    frames: [mk({ gait: 1, bob: 0, tail: 1 }), mk({ gait: 0.4, bob: -1, tail: 2, headDy: -1 }), mk({ gait: -1, bob: 0, tail: 1 }), mk({ gait: -0.4, bob: 1, tail: 0, crouch: 1 })],
    durations: [110, 100, 110, 100], loop: true,
  };
  // the lunge: coil low with the hackles up, then throw the whole body at the throat
  const attack = {
    frames: [
      mk({ crouch: 3, bob: 1, tail: 2, headDy: 2, snarl: true, gait: 0.5 }),
      mk({ crouch: -1, bob: -2, headDy: -3, headDx: f === 'E' ? 2 : 0, snarl: true, tail: 2, gait: -1 }),
      mk({ crouch: -1, bob: -1, headDy: -2, headDx: f === 'E' ? 2 : 0, snarl: true, tail: 1, gait: -1 }),
      mk({ crouch: 1, bob: 1, tail: 0, headDy: 1, snarl: true }),
    ],
    durations: [150, 90, 110, 160], loop: false,
  };
  const recoil = mk({ crouch: 3, bob: 2, headDy: 2, tail: 2 });
  const hurt = { frames: [flash(recoil), recoil], durations: [70, 170], loop: false };
  const d0 = mk({ crouch: 4, bob: 2, headDy: 3, tail: 2 });
  const d1 = tilt(mk({ crouch: 5, bob: 3, headDy: 4, tail: 2 }), 0.3, WF_PIV.x, WF_FLOOR);
  const d2 = squashTo(d1, 0.66, WF_H - 3);
  const death = {
    frames: [d0, d1, d2, squashTo(d2, 0.6, WF_H - 3), squashTo(d2, 0.5, WF_H - 3)],
    durations: [110, 150, 190, 480, 760], loop: false,
  };
  return { idle, walk, attack, hurt, death };
}

/** Dire wolf: 42x32, a lean amber-eyed quadruped with standing hackles and a brush tail. */
export function buildDireWolf() {
  return { anims: clips(wolfAnims), palette: BEAST_PALETTE, w: WF_W, h: WF_H, pivot: WF_PIV, emissive: 'Y', scale: 1 };
}

// ==========================================================================================
//                                        WEREBEAR
// ==========================================================================================
// Read: a wall of fur, twice as wide at the shoulder as the troll is anywhere. The shoulder mass
// is the highest point; the skull hangs BELOW and in front of it. Forearms as thick as the thighs
// reach the knee and end in four hooked claws. The whole outline is ragged with shag.
/**
 * Authored 48x56 and painted at 1.42x it (68x80). The werebear is a 1.48 loomer that stood 1.04 —
 * level with a swordsman. Re-rasterised, the shoulder mass alone is now as wide as a man is tall,
 * the shag gets tufts a third longer (see `shag`, which scales its gain with DS) and the forearm
 * carries a second band of fur direction the small canvas had no room for.
 */
const WB_S = 1.42;
const WB_AW = 48, WB_AH = 56, WB_APIV = { x: 24, y: 54 }, WB_AFLOOR = 51;
const WB_W = R(WB_AW, WB_S), WB_H = R(WB_AH, WB_S);
const WB_PIV = { x: R(WB_APIV.x, WB_S), y: R(WB_APIV.y, WB_S) }, WB_FLOOR = R(WB_AFLOOR, WB_S);

/**
 * One werebear frame.
 * @param {'S'|'E'|'N'} f
 * @param {{bob?:number, stride?:number, arm?:number, headDy?:number, crouch?:number, roar?:boolean, smear?:boolean, lean?:number}} o
 */
function bearFrame(f, o = {}) {
  DS = WB_S;
  const p = makePix(WB_W, WB_H);
  const b = o.bob || 0, s = o.stride || 0, c = o.crouch || 0, lean = o.lean || 0;
  const hd = (o.headDy || 0) + c, arm = o.arm ?? 0;    // 0 hanging · 1 reared back · 2 swiped down
  const lLift = Math.max(0, s) * 3, rLift = Math.max(0, -s) * 3;

  /** The short broad snout, tiny deep-set eyes, and the jaw that drops open on the roar. */
  const bearFace = (fx, fy, prof) => {
    // two small red eyes under a hard brow: on a dark umber skull a black eye is no eye at all,
    // and at gameplay distance these two warm pixels are the only thing that says the bulk is alive
    for (const d of prof ? [-1] : [-1, 1]) {
      for (let i = 1; i <= 4; i++) setPx(p, fx + d * i, fy - 3, PELT[0]);
      setPx(p, fx + d * 3, fy - 2, PELT[0]);
      setPx(p, fx + d * 3, fy - 1, 'E'); setPx(p, fx + d * 2, fy - 1, 'R');
      setPx(p, fx + d * 2, fy - 2, PELT[1]);
    }
    setPx(p, fx - 2, fy - 2, 'W');
    if (o.roar) {
      for (let i = -3; i <= 3; i++) { setPx(p, fx + i, fy + 4, BONE[1]); setPx(p, fx + i, fy + 6, BONE[1]); setPx(p, fx + i, fy + 5, '7'); }
      setPx(p, fx - 3, fy + 5, 'D'); setPx(p, fx + 3, fy + 5, 'D');
    } else {
      seam(p, [[fx - 3, fy + 5], [fx + 3, fy + 5]], PELT[0], { every: 0 });
    }
    setPx(p, fx - 1, fy + 2, '6'); setPx(p, fx, fy + 2, '6'); setPx(p, fx + 1, fy + 2, '6');
  };

  if (f === 'S') {
    // short thick legs planted wide, the feet turned out
    for (const [d, lift] of [[-1, lLift], [1, rLift]]) {
      part(p, PELT, (q) => {
        limb(q, 24 + d * 7, 38 + b + c, 24 + d * 10, WB_AFLOOR - lift, 6.0, 4.8, PELT, d < 0 ? -0.04 : -0.10);
        mass(q, 24 + d * 11, WB_AFLOOR - lift, 5.6, 2.4, PELT, { n: 2.8, bias: d < 0 ? -0.10 : -0.16 });
      });
      claws(p, 24 + d * 14, WB_AFLOOR - lift + 1, 0, 1, 3, 3, 2);
    }
    // gut, shoulder slab, and the HUMP over the top of it: a wedge, widest at the shoulder, so the
    // eye reads mass falling away toward the short legs instead of one egg
    mass(p, 24 + lean, 35 + b, 9.8, 8.4, PELT, { n: 2.5 });
    mass(p, 24 + lean, 21 + b, 13.6, 7.4, PELT, { n: 3.0, bias: 0.02 });
    mass(p, 24 + lean, 14 + b, 8.6, 4.4, PELT, { n: 2.4, bias: 0.04 });
    shag(p, [[11 + lean, 24 + b], [16 + lean, 15 + b], [24 + lean, 9 + b], [32 + lean, 15 + b], [37 + lean, 24 + b]], PELT, { flip: true, seed: 1 });
    shag(p, [[14 + lean, 30 + b], [15 + lean, 38 + b], [18 + lean, 44 + b]], PELT, { seed: 4, gain: 0.8 });
    shag(p, [[34 + lean, 30 + b], [33 + lean, 38 + b], [30 + lean, 44 + b]], PELT, { flip: true, seed: 7, lit: false, gain: 0.8 });
    // the pale chest blaze: the crescent that says BEAR from across a room, before the face does
    mass(p, 24 + lean, 37 + b, 4.6, 3.6, MUZZLE, { n: 2.2, bias: 0.04 });
    seam(p, [[19 + lean, 33 + b], [24 + lean, 41 + b], [29 + lean, 33 + b]], PELT[1], { every: 1 });
    // the skull hangs BELOW the shoulder line and in front of the chest, round ears clear of it
    const hy = 27 + b + hd;
    part(p, PELT, (q) => {
      for (const d of [-1, 1]) mass(q, 24 + lean + d * 7, hy - 6, 2.9, 2.7, PELT, { n: 2.2, bias: d < 0 ? 0.06 : -0.06 });
      mass(q, 24 + lean, hy, 6.6, 5.4, PELT, { n: 2.3, bias: 0.03 });
      mass(q, 24 + lean, hy + (o.roar ? 5.2 : 4.4), 4.4, o.roar ? 3.8 : 3.2, MUZZLE, { n: 2.4, bias: 0.12 });
    });
    bearFace(24 + lean, hy);
    // arms: hanging past the knee, hauled back overhead, or swiped down across the body
    for (const d of [-1, 1]) {
      const sx = 24 + d * 13 + lean, sy = 24 + b;
      if (arm === 2) {
        if (d > 0 && o.smear) smearArc(p, 24, 30 + b, 15, 25, -2.5, -0.3, ['@', 'c', 'd', 'e']);
        const path = d < 0 ? [[sx, sy], [sx - 4, sy + 9], [sx + 2, sy + 16]] : [[sx, sy], [sx + 4, sy - 6], [sx - 2, sy - 12]];
        part(p, PELT, (q) => {
          curve(q, path, 5.4, 3.8, PELT, d < 0 ? -0.02 : 0.05);
          mass(q, path[2][0], path[2][1] + d * 2, 4.0, 3.6, PELT, { n: 2.2, bias: d < 0 ? -0.04 : 0.05 });
        });
        claws(p, path[2][0] + d * 3, path[2][1] + d * 4, d, d < 0 ? 1 : -1, 4, 5, 2);
      } else if (arm === 1) {
        part(p, PELT, (q) => {
          curve(q, [[sx, sy], [sx + d * 6, sy + 3], [sx + d * 8, sy - 7]], 5.4, 3.8, PELT, d < 0 ? 0 : 0.04);
          mass(q, sx + d * 8, sy - 9, 4.0, 3.6, PELT, { n: 2.2, bias: 0.04 });
        });
        claws(p, sx + d * 8, sy - 13, 0, -1, 4, 5, 2);
      } else {
        part(p, PELT, (q) => {
          curve(q, [[sx, sy], [sx + d * 5, sy + 9], [sx + d * 3, sy + 17]], 5.4, 3.8, PELT, d < 0 ? 0.02 : -0.04);
          mass(q, sx + d * 3, sy + 19, 4.0, 3.6, PELT, { n: 2.2, bias: d < 0 ? -0.04 : -0.08 });
        });
        claws(p, sx + d * 3, sy + 22, 0, 1, 4, 4, 2);
      }
    }
    return ink(p);
  }

  if (f === 'E') {
    // far leg and far arm first, two tones back
    part(p, PELT, (q) => {
      limb(q, 22, 40 + b + c, 19 + Math.max(0, -s) * 4, WB_AFLOOR - rLift, 5.6, 4.6, PELT, -0.22);
      mass(q, 18 + Math.max(0, -s) * 4, WB_AFLOOR - rLift, 5.4, 2.4, PELT, { n: 2.8, bias: -0.26 });
      curve(q, [[24, 25 + b], [20, 34 + b], [22, 43 + b]], 5.0, 3.6, PELT, -0.20);
      mass(q, 22, 45 + b, 3.8, 3.4, PELT, { n: 2.2, bias: -0.24 });
    });
    // rump, shoulder, then the HUMP riding over it: the peak of the whole animal, behind the head
    mass(p, 16 + lean, 35 + b, 10.0, 9.2, PELT, { n: 2.5 });
    mass(p, 26 + lean, 25 + b, 10.4, 8.4, PELT, { n: 2.6, bias: 0.02 });
    mass(p, 24 + lean, 16 + b, 8.8, 5.4, PELT, { n: 2.4, bias: 0.04 });
    shag(p, [[7 + lean, 31 + b], [12 + lean, 20 + b], [21 + lean, 11 + b], [30 + lean, 14 + b], [35 + lean, 23 + b]], PELT, { flip: true, seed: 2 });
    shag(p, [[6 + lean, 33 + b], [8 + lean, 42 + b], [13 + lean, 47 + b]], PELT, { seed: 5, gain: 0.8 });
    // the head pushed forward and DOWN off the hump: a bear never carries its skull high
    const hy = 29 + b + hd;
    mass(p, 30 + lean, 36 + b, 4.0, 3.4, MUZZLE, { n: 2.2, bias: 0.04 });          // the blaze, in profile
    part(p, PELT, (q) => {
      mass(q, 31 + lean, hy - 6, 2.9, 2.7, PELT, { n: 2.2, bias: 0.06 });          // the near ear, clear of the skull
      mass(q, 35 + lean, hy, 6.0, 5.0, PELT, { n: 2.3, bias: 0.03 });
      limb(q, 37 + lean, hy + 1, 43 + lean, hy + 3, 3.6, 2.6, MUZZLE, 0.12);
    });
    bearFace(35 + lean, hy, true);
    setPx(p, 44 + lean, hy + 2, '6'); setPx(p, 44 + lean, hy + 3, '6');
    if (o.roar) { for (let i = 0; i < 5; i++) { setPx(p, 39 + lean + i, hy + 5, BONE[1]); setPx(p, 39 + lean + i, hy + 7, BONE[1]); setPx(p, 39 + lean + i, hy + 6, '7'); } }
    // near leg
    part(p, PELT, (q) => {
      limb(q, 27, 40 + b + c, 29 + Math.max(0, s) * 4, WB_AFLOOR - lLift, 5.8, 4.8, PELT, -0.02);
      mass(q, 31 + Math.max(0, s) * 4, WB_AFLOOR - lLift, 5.4, 2.4, PELT, { n: 2.8, bias: -0.10 });
    });
    claws(p, 34 + Math.max(0, s) * 4, WB_AFLOOR - lLift + 1, 0, 1, 3, 3, 2);
    // near arm
    if (arm === 2) {
      if (o.smear) smearArc(p, 32, 27 + b, 14, 24, -2.0, 0.2, ['@', 'c', 'd', 'e']);
      part(p, PELT, (q) => {
        curve(q, [[30 + lean, 25 + b], [38, 31 + b], [42, 38 + b]], 5.2, 3.6, PELT, 0.05);
        mass(q, 43, 40 + b, 3.8, 3.4, PELT, { n: 2.2, bias: 0.03 });
      });
      claws(p, 44, 43 + b, 1, 1, 4, 5, 2);
    } else if (arm === 1) {
      part(p, PELT, (q) => {
        curve(q, [[30 + lean, 25 + b], [31, 16 + b], [26, 9 + b]], 5.2, 3.6, PELT, 0.05);
        mass(q, 25, 8 + b, 3.8, 3.4, PELT, { n: 2.2, bias: 0.06 });
      });
      claws(p, 22, 5 + b, -1, -1, 4, 5, 2);
    } else {
      part(p, PELT, (q) => {
        curve(q, [[30 + lean, 25 + b], [33, 34 + b], [31, 44 + b]], 5.2, 3.6, PELT, 0.04);
        mass(q, 31, 46 + b, 3.8, 3.4, PELT, { n: 2.2, bias: -0.04 });
      });
      claws(p, 31, 49 + b, 0, 1, 4, 4, 2);
    }
    return ink(p);
  }

  // NORTH — the back: the shoulder mass fills the frame, the skull barely shows over it
  for (const [d, lift] of [[-1, lLift], [1, rLift]]) {
    part(p, PELT, (q) => {
      limb(q, 24 + d * 7, 40 + b + c, 24 + d * 10, WB_AFLOOR - lift, 6.2, 5.0, PELT, d < 0 ? -0.12 : -0.18);
      mass(q, 24 + d * 11, WB_AFLOOR - lift, 5.6, 2.4, PELT, { n: 2.8, bias: d < 0 ? -0.18 : -0.22 });
    });
  }
  mass(p, 24, 35 + b, 9.8, 8.4, PELT, { n: 2.5, bias: -0.05 });
  mass(p, 24, 21 + b, 13.6, 7.6, PELT, { n: 3.0, bias: -0.02 });
  mass(p, 24, 14 + b, 9.0, 4.6, PELT, { n: 2.4, bias: 0.02 });
  shag(p, [[11, 24 + b], [16, 15 + b], [24, 8 + b], [32, 15 + b], [37, 24 + b]], PELT, { flip: true, seed: 3 });
  shag(p, [[14, 30 + b], [15, 38 + b], [18, 44 + b]], PELT, { seed: 6, gain: 0.8 });
  seam(p, [[24, 18 + b], [24, 42 + b]], PELT[0], { every: 1 });
  const hy = 26 + b + hd;
  part(p, PELT, (q) => {
    for (const d of [-1, 1]) mass(q, 24 + d * 6.6, hy - 5, 2.9, 2.7, PELT, { n: 2.2, bias: d < 0 ? -0.02 : -0.10 });
    mass(q, 24, hy, 6.0, 4.4, PELT, { n: 2.3, bias: -0.05 });
  });
  for (const d of [-1, 1]) {
    part(p, PELT, (q) => {
      curve(q, [[24 + d * 13, 24 + b], [24 + d * 18, 33 + b], [24 + d * 16, 41 + b]], 5.4, 3.8, PELT, d < 0 ? -0.06 : -0.12);
      mass(q, 24 + d * 16, 43 + b, 4.0, 3.6, PELT, { n: 2.2, bias: d < 0 ? -0.10 : -0.16 });
    });
  }
  return ink(p);
}

function bearAnims(f) {
  const mk = (o) => bearFrame(f, o);
  const idle = {
    frames: [mk({ bob: 0 }), mk({ bob: 1, headDy: 1 }), mk({ bob: 1, headDy: 1, lean: 1 }), mk({ bob: 0, lean: 1 })],
    durations: [420, 340, 380, 340], loop: true,
  };
  // a rolling plod: he sinks onto each foot, the shoulder mass swaying across the top of the frame
  const walk = {
    frames: [mk({ stride: 1, bob: 0, lean: -1 }), mk({ stride: 0.4, bob: 1, crouch: 1 }), mk({ stride: -1, bob: 0, lean: 1 }), mk({ stride: -0.4, bob: 1, crouch: 1 })],
    durations: [190, 170, 190, 170], loop: true,
  };
  // rear up, roar, then bring both paws down across the front
  const attack = {
    frames: [
      mk({ arm: 0, bob: 2, crouch: 2, headDy: 1 }),
      mk({ arm: 1, bob: -2, headDy: -2, roar: true, lean: -1 }),
      mk({ arm: 2, bob: 1, crouch: 1, roar: true, smear: true }),
      mk({ arm: 2, bob: 2, crouch: 2, headDy: 1 }),
    ],
    durations: [180, 140, 90, 190], loop: false,
  };
  const recoil = mk({ bob: 2, crouch: 2, headDy: 2, lean: -2 });
  const hurt = { frames: [flash(recoil), recoil], durations: [80, 190], loop: false };
  const d0 = mk({ bob: 2, crouch: 2, headDy: 2 });
  const d1 = tilt(mk({ bob: 3, crouch: 3, headDy: 3 }), 0.3, WB_PIV.x, WB_FLOOR);
  const d2 = squashTo(tilt(mk({ bob: 4, crouch: 4 }), 0.62, WB_PIV.x, WB_FLOOR), 0.68, WB_H - 3);
  const death = {
    frames: [d0, d1, d2, squashTo(d2, 0.6, WB_H - 3), squashTo(d2, 0.48, WB_H - 3)],
    durations: [140, 170, 200, 460, 880], loop: false,
  };
  return { idle, walk, attack, hurt, death };
}

/** Werebear: 48x56, a hunched wall of shag whose shoulders stand above its own skull. */
export function buildWerebear() {
  return { anims: clips(bearAnims), palette: BEAST_PALETTE, w: WB_W, h: WB_H, pivot: WB_PIV, emissive: '', scale: 1 };
}

// ==========================================================================================
//                                        GARGOYLE
// ==========================================================================================
// Read: perched, not standing. The haunches fold up beside the ribs with the knees ABOVE the
// shoulders and clawed hands planted on the stone in front. The read is the pair of folded wings,
// each peaking in a spur well above the horns. Cold slate against warm sandstone walls.
/**
 * Authored 48x48 and painted at 1.20x it. The gargoyle is carved out of a block of stone (1.20) and
 * was standing at 1.00, exactly the hero's height — which made the stone brute a man in a costume.
 * The fifth it gains goes into the crack network across the wing membranes and the haunches.
 */
const GG_S = 1.20;
const GG_AW = 48, GG_AH = 48, GG_APIV = { x: 24, y: 46 }, GG_AFLOOR = 43;
const GG_W = R(GG_AW, GG_S), GG_H = R(GG_AH, GG_S);
const GG_PIV = { x: R(GG_APIV.x, GG_S), y: R(GG_APIV.y, GG_S) }, GG_FLOOR = R(GG_AFLOOR, GG_S);

/**
 * One folded wing: a quad of membrane hanging between the shoulder, an elbow spur that stands
 * above the head, the folded hand tip and the hem down at the hip — then the spar laid over it and
 * two ribs fanning to the hem. `open` swings the whole thing outward for the strike.
 * @param {Pix} p @param {number} sx @param {number} sy shoulder @param {number} dir +1 to the right
 */
function foldedWing(p, sx, sy, dir, open = 0, bias = 0) {
  const B = [sx + dir * (3 + open * 9), sy - 19 - open * 1];         // the elbow spur, above the horns
  const C = [sx + dir * (11 + open * 14), sy - 9 + open * 3];        // the folded hand tip
  const D = [sx + dir * (8 + open * 8), sy + 9 + open * 2];          // the hem, down by the hip
  const A = [sx, sy];
  part(p, STONE, (q) => {
    panel(q, [A, B, C, D], STONE, bias - 0.04);
    curve(q, [A, B], 2.8, 1.4, STONE, bias + 0.10);                  // the leading spar
    curve(q, [B, C], 1.9, 1.0, STONE, bias + 0.08);                  // the folded hand
  });
  for (const t of [0.35, 0.7]) {
    seam(p, [B, [lerp(C[0], D[0], t), lerp(C[1], D[1], t)]], STONE[1], { every: 1 });
  }
  setPx(p, Math.round(B[0]), Math.round(B[1] - 1), BONE[0]);
  setPx(p, Math.round(C[0]), Math.round(C[1]), BONE[0]);
  return p;
}

/** Two swept horns off the temples — the stone crown that reads before anything else. */
function gargHorns(p, cx, cy, spread = 1) {
  part(p, STONE, (q) => {
    for (const d of [-1, 1]) {
      curve(q, [[cx + d * 3.5 * spread, cy], [cx + d * 7 * spread, cy - 3], [cx + d * 8 * spread, cy - 8]],
        2.3, 0.9, STONE, d < 0 ? 0.08 : -0.06);
    }
  });
  for (const d of [-1, 1]) setPx(p, Math.round(cx + d * 8 * spread), Math.round(cy - 9), BONE[0]);
  return p;
}

/**
 * One gargoyle frame.
 * @param {'S'|'E'|'N'} f
 * @param {{bob?:number, wing?:number, headDy?:number, rear?:number, claw?:number, smear?:boolean, lean?:number}} o
 */
function gargFrame(f, o = {}) {
  DS = GG_S;
  const p = makePix(GG_W, GG_H);
  const b = o.bob || 0, wing = o.wing || 0, lean = o.lean || 0;
  const rear = o.rear || 0, hd = o.headDy || 0, claw = o.claw || 0;
  const hipY = 35 + b - rear * 5, chestY = 25 + b - rear * 6;
  // the whole read of the pose: when perched the knee stands ABOVE the shoulder line, and the shin
  // runs back DOWN and inward to a foot planted in front — a folded haunch, not a column
  const kneeY = chestY - 9 + rear * 12;

  /** Heavy carved brow, hollow eyes lit from inside, a slot mouth of square stone teeth. */
  const gargFace = (fx, fy, prof) => {
    for (const d of prof ? [-1] : [-1, 1]) {
      for (let i = 1; i <= 4; i++) setPx(p, fx + d * i, fy - 3, STONE[0]);
      setPx(p, fx + d * 3, fy - 1, 'E'); setPx(p, fx + d * 2, fy - 1, 'Y');
      setPx(p, fx + d * 3, fy - 2, STONE[0]);
    }
    for (let i = -3; i <= 3; i++) setPx(p, fx + i, fy + 3, i % 2 ? BONE[0] : STONE[0]);
    seam(p, [[fx - 3, fy + 4], [fx + 3, fy + 4]], STONE[0], { every: 0 });
  };

  if (f === 'S') {
    // both wings first: they live behind the body, and their spurs are the tallest thing here
    foldedWing(p, 14 + lean, chestY - 2, -1, wing, 0.04);
    foldedWing(p, 34 + lean, chestY - 2, 1, wing, -0.08);
    // haunches folded up beside the ribs — knees ABOVE the shoulders when perched
    for (const d of [-1, 1]) {
      const kx = 24 + d * 15;
      part(p, STONE, (q) => {
        limb(q, 24 + d * 6, hipY, kx, kneeY, 5.4, 3.8, STONE, d < 0 ? 0.02 : -0.08);
        limb(q, kx, kneeY, 24 + d * 12, GG_AFLOOR - 2, 3.8, 3.0, STONE, d < 0 ? 0 : -0.10);
        mass(q, 24 + d * 12, GG_AFLOOR, 4.6, 2.2, STONE, { n: 2.8, bias: -0.10 });
      });
      claws(p, 24 + d * 12, GG_AFLOOR + 2, 0, 1, 3, 3, 3);
    }
    // torso: narrow waist under a broad carved chest
    mass(p, 24 + lean, hipY - 2, 8.0, 6.4, STONE, { n: 2.5 });
    mass(p, 24 + lean, chestY, 10.6, 7.6, STONE, { n: 2.6, bias: 0.02 });
    seam(p, [[18 + lean, chestY - 6], [21 + lean, chestY + 4], [19 + lean, hipY + 3]], STONE[0], { every: 2 });
    seam(p, [[30 + lean, chestY - 4], [28 + lean, chestY + 6]], STONE[0], { every: 2 });
    for (const [lx, ly] of [[16, chestY + 5], [32, hipY - 3], [24, chestY - 7]]) setPx(p, lx + lean, ly, 'm');
    // arms: knuckles planted on the stone between the feet (the perch), or one raked forward
    for (const d of [-1, 1]) {
      const sx = 24 + d * 9 + lean, sy = chestY - 1;
      if (claw && d > 0) {
        if (o.smear) smearArc(p, 30, chestY + 2, 10, 19, -1.5, 0.5, ['@', 'i', 'k', 'l']);
        part(p, STONE, (q) => {
          curve(q, [[sx, sy], [sx + 9, sy + 3], [sx + 13, sy - 3]], 4.2, 2.8, STONE, 0.04);
          mass(q, sx + 14, sy - 5, 3.2, 2.8, STONE, { n: 2.2, bias: 0.04 });
        });
        claws(p, sx + 16, sy - 7, 1, -1, 3, 5, 2);
      } else {
        part(p, STONE, (q) => {
          curve(q, [[sx, sy], [sx + d * 1, sy + 9], [sx - d * 2, GG_AFLOOR - 3]], 4.0, 2.7, STONE, d < 0 ? 0.02 : -0.08);
          mass(q, sx - d * 2, GG_AFLOOR - 1, 3.4, 2.3, STONE, { n: 2.8, bias: d < 0 ? -0.02 : -0.10 });
        });
        claws(p, sx - d * 2, GG_AFLOOR + 1, 0, 1, 3, 3, 2);
      }
    }
    // head thrust forward off a short thick neck, horns swept back off the temples
    const hy = chestY - 12 + hd;
    part(p, STONE, (q) => {
      limb(q, 24 + lean, chestY - 6, 24 + lean, hy + 2, 4.2, 3.6, STONE, 0);
      mass(q, 24 + lean, hy, 6.0, 5.0, STONE, { n: 2.4, bias: 0.02 });
      mass(q, 24 + lean, hy + 3, 4.0, 3.0, STONE, { n: 2.4, bias: 0.04 });
    });
    gargHorns(p, 24 + lean, hy - 2);
    gargFace(24 + lean, hy);
    return ink(p);
  }

  if (f === 'E') {
    foldedWing(p, 19 + lean, chestY - 2, -1, wing * 0.4, -0.18);       // far wing, two tones back
    // far leg, folded
    part(p, STONE, (q) => {
      limb(q, 20, hipY, 12, kneeY, 4.6, 3.4, STONE, -0.20);
      limb(q, 12, kneeY, 16, GG_AFLOOR - 2, 3.4, 2.7, STONE, -0.22);
      mass(q, 16, GG_AFLOOR, 4.2, 2.2, STONE, { n: 2.8, bias: -0.24 });
    });
    // torso in profile: hunched, the spine arching over the shoulders
    mass(p, 21 + lean, hipY - 2, 7.6, 6.2, STONE, { n: 2.5 });
    mass(p, 25 + lean, chestY, 8.8, 7.6, STONE, { n: 2.6, bias: 0.02 });
    crest(p, [[18 + lean, chestY - 4], [23 + lean, chestY - 7], [28 + lean, chestY - 5]], 3.0, STONE, { flip: true });
    seam(p, [[22 + lean, chestY - 5], [24 + lean, chestY + 5], [22 + lean, hipY + 3]], STONE[0], { every: 2 });
    setPx(p, 18 + lean, chestY + 4, 'm'); setPx(p, 27 + lean, hipY - 2, 'm');
    // near wing over the shoulder
    foldedWing(p, 24 + lean, chestY - 2, 1, wing, 0.02);
    // near leg, folded up under the ribs
    part(p, STONE, (q) => {
      limb(q, 24, hipY, 34, kneeY + 1, 5.0, 3.6, STONE, -0.02);
      limb(q, 34, kneeY + 1, 29, GG_AFLOOR - 2, 3.6, 2.8, STONE, -0.04);
      mass(q, 29, GG_AFLOOR, 4.4, 2.2, STONE, { n: 2.8, bias: -0.08 });
    });
    claws(p, 30, GG_AFLOOR + 2, 0, 1, 3, 3, 3);
    // arm: knuckles down in front, or raked out
    if (claw) {
      if (o.smear) smearArc(p, 32, chestY + 2, 10, 18, -1.5, 0.4, ['@', 'i', 'k', 'l']);
      part(p, STONE, (q) => {
        curve(q, [[29 + lean, chestY - 1], [37, chestY + 3], [41, chestY - 3]], 4.0, 2.7, STONE, 0.05);
        mass(q, 42, chestY - 5, 3.2, 2.6, STONE, { n: 2.2, bias: 0.05 });
      });
      claws(p, 44, chestY - 7, 1, -1, 3, 5, 2);
    } else {
      part(p, STONE, (q) => {
        curve(q, [[29 + lean, chestY - 1], [35, chestY + 8], [34, GG_AFLOOR - 3]], 4.0, 2.7, STONE, 0.03);
        mass(q, 34, GG_AFLOOR - 1, 3.4, 2.3, STONE, { n: 2.8, bias: -0.06 });
      });
      claws(p, 34, GG_AFLOOR + 1, 0, 1, 3, 3, 2);
    }
    // head jutting forward, horns swept back over the wing roots
    const hy = chestY - 11 + hd;
    part(p, STONE, (q) => {
      limb(q, 27 + lean, chestY - 5, 32 + lean, hy + 2, 4.0, 3.4, STONE, 0.02);
      mass(q, 32 + lean, hy, 5.4, 4.6, STONE, { n: 2.4, bias: 0.02 });
      limb(q, 34 + lean, hy + 1, 39 + lean, hy + 3, 3.0, 2.2, STONE, 0.05);
    });
    gargHorns(p, 32 + lean, hy - 2, 0.85);
    gargFace(33 + lean, hy, true);
    return ink(p);
  }

  // NORTH — the back: two folded wings filling the frame over a ridged spine
  for (const d of [-1, 1]) {
    const kx = 24 + d * 15;
    part(p, STONE, (q) => {
      limb(q, 24 + d * 6, hipY, kx, kneeY, 5.4, 3.8, STONE, d < 0 ? -0.02 : -0.10);
      limb(q, kx, kneeY, 24 + d * 12, GG_AFLOOR - 2, 3.8, 3.0, STONE, d < 0 ? -0.04 : -0.12);
      mass(q, 24 + d * 12, GG_AFLOOR, 4.6, 2.2, STONE, { n: 2.8, bias: -0.14 });
    });
  }
  mass(p, 24, hipY - 2, 8.0, 6.4, STONE, { n: 2.5, bias: -0.05 });
  mass(p, 24, chestY, 10.6, 7.6, STONE, { n: 2.6, bias: -0.02 });
  foldedWing(p, 15, chestY - 2, -1, wing * 0.8, 0.02);
  foldedWing(p, 33, chestY - 2, 1, wing * 0.8, -0.10);
  crest(p, [[24, chestY - 5], [24, hipY + 3]], 2.6, STONE, { flip: true });
  seam(p, [[24, chestY - 6], [24, hipY + 4]], STONE[0], { every: 1 });
  const hy = chestY - 12 + hd;
  part(p, STONE, (q) => {
    limb(q, 24, chestY - 6, 24, hy + 2, 4.2, 3.6, STONE, -0.04);
    mass(q, 24, hy, 5.8, 4.8, STONE, { n: 2.4, bias: -0.04 });
  });
  gargHorns(p, 24, hy - 2);
  setPx(p, 21, hy - 1, STONE[0]); setPx(p, 27, hy - 1, STONE[0]);
  return ink(p);
}

function gargAnims(f) {
  const mk = (o) => gargFrame(f, o);
  // perched and still: a statue that breathes. Only the membrane and the head move at all.
  const idle = {
    frames: [mk({ bob: 0 }), mk({ bob: 0, wing: 0.05, headDy: 1 }), mk({ bob: 1, wing: 0.09 }), mk({ bob: 0, wing: 0.03 })],
    durations: [520, 420, 460, 420], loop: true,
  };
  // it does not walk so much as hop off the haunches, wings half open for balance
  const walk = {
    frames: [mk({ rear: 1, wing: 0.3, bob: -1 }), mk({ rear: 1, wing: 0.45, bob: -2, lean: 1 }), mk({ rear: 0, wing: 0.18, bob: 0 }), mk({ rear: 0, wing: 0.06, bob: 1, lean: -1 })],
    durations: [150, 130, 150, 150], loop: true,
  };
  // rise off the perch, wings flaring, then rake down with one hand
  const attack = {
    frames: [
      mk({ bob: 1, wing: 0.08 }),
      mk({ rear: 1, wing: 0.8, bob: -2, headDy: -1 }),
      mk({ rear: 1, wing: 0.55, claw: 1, smear: true, lean: 1 }),
      mk({ rear: 0, wing: 0.18, claw: 1, bob: 1 }),
    ],
    durations: [160, 130, 90, 190], loop: false,
  };
  const recoil = mk({ bob: 2, headDy: 2, wing: 0.12, lean: -2 });
  const hurt = { frames: [flash(recoil), recoil], durations: [80, 190], loop: false };
  // a gargoyle does not bleed out; it topples and breaks
  const d0 = mk({ bob: 2, headDy: 2, wing: 0.18 });
  const d1 = tilt(mk({ bob: 3, headDy: 3, wing: 0.28 }), 0.34, GG_PIV.x, GG_FLOOR);
  const d2 = squashTo(tilt(mk({ bob: 4, wing: 0.32 }), 0.66, GG_PIV.x, GG_FLOOR), 0.66, GG_H - 3);
  const death = {
    frames: [d0, d1, d2, squashTo(d2, 0.58, GG_H - 3), squashTo(d2, 0.46, GG_H - 3)],
    durations: [130, 160, 200, 470, 860], loop: false,
  };
  return { idle, walk, attack, hurt, death };
}

/** Gargoyle: 48x48, cold slate crouched on a perch that is not there, folded wings over its horns. */
export function buildGargoyle() {
  return { anims: clips(gargAnims), palette: BEAST_PALETTE, w: GG_W, h: GG_H, pivot: GG_PIV, emissive: 'Y', scale: 1 };
}

// ==========================================================================================
//                                          TROLL
// ==========================================================================================
// Read: all vertical, and the thinnest thing in the game for its height. Narrow sloped shoulders,
// a small head thrust forward on no neck at all, a pot belly slung under a narrow ribcage, and the
// arms hanging past the knees with the knuckles nearly grazing the floor.
/**
 * THE TROLL IS AUTHORED 46x60 AND PAINTED AT 1.46x IT (67x88). style.js puts him at 1.72 of the
 * hero — the tallest thing that walks on two legs short of the Demon — and the old sheet stood 54
 * texels to the hero's 46, i.e. 1.17: shorter, on screen, than a War Lord. Re-rasterised at DS the
 * same authored pose stands 79 texels, and the room it buys goes into the things a 46-wide troll
 * could not hold: a real ribcage under the hide, knuckles on the dragging hands, a proper
 * three-knuckle spine and a wound with two rows of knitting flesh instead of one.
 */
const TR_S = 1.46;
const TR_AW = 46, TR_AH = 60, TR_APIV = { x: 23, y: 58 }, TR_AFLOOR = 55;
const TR_W = R(TR_AW, TR_S), TR_H = R(TR_AH, TR_S);
const TR_PIV = { x: R(TR_APIV.x, TR_S), y: R(TR_APIV.y, TR_S) }, TR_FLOOR = R(TR_AFLOOR, TR_S);

/**
 * The closing wound: a dark split with pale new flesh knitting across it. `t` = 0 raw .. 1 healed.
 * Authored in half-texel steps because at the troll's draw scale the split is nine real texels
 * wide, wide enough to carry the knit as a row of stitches rather than one dotted line.
 */
function wound(p, x, y, t) {
  const h = (1 - t) * 2.4 + 0.4, st = 1 / Math.ceil(DS - 1e-6);
  for (let i = -3; i <= 3; i += st) {
    const hi = Math.max(0, h - Math.abs(i) * 0.45);
    for (let k = -hi; k <= hi; k += st) {
      if (!atPx(p, x + i, y + k)) continue;
      const knit = t > 0.62 || (t > 0.28 && (Math.round(i) + 6) % 2 === 0);
      setPx(p, x + i, y + k, knit ? 's' : 'E');
    }
  }
  return p;
}

/**
 * One troll frame.
 * @param {'S'|'E'|'N'} f
 * @param {{bob?:number, stride?:number, arm?:number, headDy?:number, crouch?:number, heal?:number, smear?:boolean, lean?:number}} o
 */
function trollFrame(f, o = {}) {
  DS = TR_S;
  const p = makePix(TR_W, TR_H);
  const b = o.bob || 0, s = o.stride || 0, c = o.crouch || 0, lean = o.lean || 0;
  const hd = (o.headDy || 0) + c, arm = o.arm ?? 0, heal = o.heal ?? 0;
  const lLift = Math.max(0, s) * 3, rLift = Math.max(0, -s) * 3;

  /** Heavy brow, red eyes, a hooked nose overhanging an underbite of two tusks. */
  const trollFace = (fx, fy, prof) => {
    for (const d of prof ? [-1] : [-1, 1]) {
      for (let i = 1; i <= 3; i++) setPx(p, fx + d * i, fy - 3, HIDE[0]);
      setPx(p, fx + d * 3, fy - 2, 'E'); setPx(p, fx + d * 2, fy - 2, 'R');
    }
    setPx(p, fx - 2, fy - 3, 'W');
    // the hooked nose: in profile it is a beak hanging a full three texels past the lip line, and
    // it is the single feature that tells a troll from every other green-hided thing in fiction
    if (prof) {
      limb(p, fx + 1, fy - 1, fx + 5, fy + 2, 1.9, 1.1, HIDE, 0.06);
      setPx(p, fx + 5, fy + 3, HIDE[1]); setPx(p, fx + 4, fy + 3, HIDE[1]);
      seam(p, [[fx + 1, fy + 5], [fx + 4, fy + 5]], HIDE[0], { every: 0 });
      setPx(p, fx + 3, fy + 4, 'D');
    } else {
      limb(p, fx, fy - 1, fx, fy + 3, 1.8, 1.2, HIDE, 0.05);
      setPx(p, fx - 1, fy + 3, HIDE[1]); setPx(p, fx + 1, fy + 3, HIDE[1]);
      seam(p, [[fx - 3, fy + 5], [fx + 3, fy + 5]], HIDE[0], { every: 0 });
      setPx(p, fx - 2, fy + 4, 'D'); setPx(p, fx + 2, fy + 4, 'D');   // the underbite
    }
  };

  if (f === 'S') {
    // long shanks, knees turned out, splayed flat feet
    for (const [d, lift] of [[-1, lLift], [1, rLift]]) {
      part(p, HIDE, (q) => {
        curve(q, [[23 + d * 4, 38 + b + c], [23 + d * 8, 46 + b], [23 + d * 8, TR_AFLOOR - lift - 1]], 4.2, 3.0, HIDE, d < 0 ? -0.02 : -0.10);
        mass(q, 23 + d * 9, TR_AFLOOR - lift, 5.4, 2.0, HIDE, { n: 2.9, bias: d < 0 ? -0.08 : -0.14 });
      });
      for (let i = 0; i < 3; i++) setPx(p, 23 + d * 9 - 3 + i * 3, TR_AFLOOR - lift + 2, 'K');
    }
    // pot belly slung under a narrow ribcage: a barrel on stilts
    mass(p, 23 + lean, 36 + b, 7.6, 7.0, HIDE, { n: 2.4, bias: 0.03 });
    mass(p, 23 + lean, 25 + b, 6.2, 7.2, HIDE, { n: 2.6 });
    // DETAIL THE 46-WIDE CANVAS COULD NOT HOLD: at this draw scale the ribcage is twenty texels
    // across, so it carries a real set of ribs — four on the lit side, three shorter ones dropping
    // into the shadow side — and the fold where the pot belly hangs over the bottom of them.
    for (let i = 0; i < 4; i++) seam(p, [[17.4 + lean, 21 + i * 2.6 + b], [21.4 + lean, 22.4 + i * 2.6 + b]], HIDE[1], { every: 1 });
    for (let i = 0; i < 3; i++) seam(p, [[28.6 + lean, 22.4 + i * 2.6 + b], [25.6 + lean, 23.6 + i * 2.6 + b]], HIDE[0], { every: 1 });
    seam(p, [[18 + lean, 32.4 + b], [23 + lean, 34 + b], [28 + lean, 32.4 + b]], HIDE[1], { every: 0 });
    // sloped shoulders — no trapezius line at all, the arms just hang off the ribcage
    mass(p, 23 + lean, 19 + b, 9.2, 4.2, HIDE, { n: 2.7, bias: 0.02 });
    for (const d of [-1, 1]) mass(p, 23 + lean + d * 7.5, 20 + b, 3.4, 3.4, HIDE, { n: 2.3, bias: d < 0 ? 0.04 : -0.06 });
    wound(p, 29 + lean, 19 + b, heal);
    // the arms: hanging past the knees, hauled overhead, or swung down
    for (const d of [-1, 1]) {
      const sx = 23 + d * 10 + lean, sy = 20 + b;
      if (arm === 2) {
        if (d > 0 && o.smear) smearArc(p, 23, 28 + b, 16, 26, -2.5, -0.2, ['@', 'p', 'q', 'r']);
        const path = d < 0 ? [[sx, sy], [sx - 4, sy + 10], [sx + 2, sy + 19]] : [[sx, sy], [sx + 6, sy - 4], [sx - 1, sy - 12]];
        part(p, HIDE, (q) => {
          curve(q, path, 4.0, 2.7, HIDE, d < 0 ? 0.02 : 0.05);
          mass(q, path[2][0], path[2][1] + d * 2, 3.6, 3.2, HIDE, { n: 2.2, bias: d < 0 ? -0.02 : 0.05 });
        });
        claws(p, path[2][0] + d * 2, path[2][1] + d * 5, d * 0.6, d < 0 ? 1 : -1, 3, 4, 2);
      } else if (arm === 1) {
        part(p, HIDE, (q) => {
          curve(q, [[sx, sy], [sx + d * 7, sy + 3], [sx + d * 9, sy - 8]], 4.0, 2.7, HIDE, d < 0 ? 0.02 : 0.04);
          mass(q, sx + d * 9, sy - 10, 3.6, 3.2, HIDE, { n: 2.2, bias: 0.05 });
        });
        claws(p, sx + d * 9, sy - 14, 0, -1, 3, 4, 2);
      } else {
        part(p, HIDE, (q) => {
          curve(q, [[sx, sy], [sx + d * 5, sy + 12], [sx + d * 3, sy + 26]], 4.0, 2.8, HIDE, d < 0 ? 0.03 : -0.04);
          mass(q, sx + d * 3, sy + 28, 3.6, 3.2, HIDE, { n: 2.2, bias: d < 0 ? -0.04 : -0.09 });
        });
        for (let i = -1; i <= 1; i++) setPx(p, sx + d * 3 + i * 2, sy + 26.4, HIDE[0]);   // knuckles
        claws(p, sx + d * 3, sy + 31, 0, 1, 3, 3, 2);
      }
    }
    // the head sits ON the shoulders and leans forward: there is no neck to speak of
    const hy = 11 + b + hd;
    part(p, HIDE, (q) => {
      limb(q, 23 + lean, 17 + b, 23 + lean, hy + 2, 3.4, 3.0, HIDE, 0.02);
      mass(q, 23 + lean, hy, 5.2, 4.6, HIDE, { n: 2.3, bias: 0.03 });
      for (const d of [-1, 1]) mass(q, 23 + lean + d * 5.0, hy, 1.9, 2.4, HIDE, { n: 2.2, bias: d < 0 ? 0.05 : -0.06 });
    });
    trollFace(23 + lean, hy);
    shag(p, [[18 + lean, hy - 2], [23 + lean, hy - 5], [28 + lean, hy - 2]], MATTED, { flip: true, seed: 2, gain: 0.7 });
    return ink(p);
  }

  if (f === 'E') {
    part(p, HIDE, (q) => {
      curve(q, [[21, 38 + b + c], [19, 46 + b], [19 + Math.max(0, -s) * 4, TR_AFLOOR - rLift - 1]], 4.0, 2.9, HIDE, -0.20);
      mass(q, 18 + Math.max(0, -s) * 4, TR_AFLOOR - rLift, 5.2, 2.0, HIDE, { n: 2.9, bias: -0.24 });
      curve(q, [[19, 20 + b], [14, 32 + b], [17, 47 + b]], 3.6, 2.5, HIDE, -0.20);      // far arm
      mass(q, 17, 49 + b, 3.4, 3.0, HIDE, { n: 2.2, bias: -0.24 });
    });
    mass(p, 22 + lean, 36 + b, 7.4, 7.0, HIDE, { n: 2.4, bias: 0.03 });
    mass(p, 22 + lean, 25 + b, 6.0, 7.2, HIDE, { n: 2.6 });
    crest(p, [[18 + lean, 21 + b], [22 + lean, 18 + b], [27 + lean, 20 + b]], 2.6, HIDE, { flip: true });
    mass(p, 24 + lean, 20 + b, 4.8, 4.0, HIDE, { n: 2.3, bias: -0.02 });
    wound(p, 25 + lean, 19 + b, heal);
    part(p, HIDE, (q) => {
      curve(q, [[25, 38 + b + c], [27, 46 + b], [27 + Math.max(0, s) * 4, TR_AFLOOR - lLift - 1]], 4.2, 3.0, HIDE, -0.02);
      mass(q, 28 + Math.max(0, s) * 4, TR_AFLOOR - lLift, 5.4, 2.0, HIDE, { n: 2.9, bias: -0.08 });
    });
    for (let i = 0; i < 3; i++) setPx(p, 26 + Math.max(0, s) * 4 + i * 3, TR_AFLOOR - lLift + 2, 'K');
    if (arm === 2) {
      if (o.smear) smearArc(p, 27, 27 + b, 15, 25, -1.9, 0.3, ['@', 'p', 'q', 'r']);
      part(p, HIDE, (q) => {
        curve(q, [[26 + lean, 21 + b], [35, 28 + b], [40, 35 + b]], 3.8, 2.7, HIDE, 0.05);
        mass(q, 41, 37 + b, 3.4, 3.0, HIDE, { n: 2.2, bias: 0.03 });
      });
      claws(p, 43, 39 + b, 1, 1, 3, 4, 2);
    } else if (arm === 1) {
      part(p, HIDE, (q) => {
        curve(q, [[26 + lean, 21 + b], [30, 13 + b], [25, 6 + b]], 3.8, 2.7, HIDE, 0.06);
        mass(q, 24, 5 + b, 3.4, 3.0, HIDE, { n: 2.2, bias: 0.06 });
      });
      claws(p, 22, 2 + b, -1, -1, 3, 4, 2);
    } else {
      part(p, HIDE, (q) => {
        curve(q, [[26 + lean, 20 + b], [31, 32 + b], [29, 47 + b]], 3.8, 2.7, HIDE, 0.04);
        mass(q, 29, 49 + b, 3.4, 3.0, HIDE, { n: 2.2, bias: -0.03 });
      });
      claws(p, 29, 52 + b, 0, 1, 3, 3, 2);
    }
    const hy = 11 + b + hd;
    part(p, HIDE, (q) => {
      limb(q, 24 + lean, 17 + b, 26 + lean, hy + 2, 3.4, 3.0, HIDE, 0.02);
      mass(q, 26 + lean, hy, 5.0, 4.6, HIDE, { n: 2.3, bias: 0.03 });
      mass(q, 21 + lean, hy, 1.9, 2.4, HIDE, { n: 2.2, bias: 0.05 });
    });
    trollFace(26 + lean, hy, true);
    shag(p, [[20 + lean, hy], [23 + lean, hy - 5], [29 + lean, hy - 3]], MATTED, { flip: true, seed: 5, gain: 0.7 });
    return ink(p);
  }

  // NORTH — the back: a knobbled spine down a narrow back, the long arms hanging either side
  for (const [d, lift] of [[-1, lLift], [1, rLift]]) {
    part(p, HIDE, (q) => {
      curve(q, [[23 + d * 4, 38 + b + c], [23 + d * 8, 46 + b], [23 + d * 8, TR_AFLOOR - lift - 1]], 4.2, 3.0, HIDE, d < 0 ? -0.10 : -0.16);
      mass(q, 23 + d * 9, TR_AFLOOR - lift, 5.4, 2.0, HIDE, { n: 2.9, bias: d < 0 ? -0.16 : -0.20 });
    });
  }
  mass(p, 23, 36 + b, 7.6, 7.0, HIDE, { n: 2.4, bias: -0.04 });
  mass(p, 23, 25 + b, 6.4, 7.2, HIDE, { n: 2.6, bias: -0.02 });
  mass(p, 23, 19 + b, 9.2, 4.2, HIDE, { n: 2.7, bias: -0.02 });
  for (const d of [-1, 1]) mass(p, 23 + d * 7.5, 20 + b, 3.4, 3.4, HIDE, { n: 2.3, bias: d < 0 ? 0 : -0.09 });
  crest(p, [[23, 20 + b], [23, 31 + b], [23, 41 + b]], 2.4, HIDE, { flip: true });
  seam(p, [[23, 20 + b], [23, 42 + b]], HIDE[0], { every: 1 });
  for (const d of [-1, 1]) {
    part(p, HIDE, (q) => {
      curve(q, [[23 + d * 10, 20 + b], [23 + d * 15, 32 + b], [23 + d * 13, 46 + b]], 4.0, 2.8, HIDE, d < 0 ? -0.05 : -0.11);
      mass(q, 23 + d * 13, 48 + b, 3.6, 3.2, HIDE, { n: 2.2, bias: d < 0 ? -0.10 : -0.15 });
    });
  }
  const hy = 11 + b + hd;
  part(p, HIDE, (q) => {
    limb(q, 23, 17 + b, 23, hy + 2, 3.4, 3.0, HIDE, -0.02);
    mass(q, 23, hy, 5.2, 4.6, HIDE, { n: 2.3, bias: -0.04 });
    for (const d of [-1, 1]) mass(q, 23 + d * 4.9, hy, 1.9, 2.4, HIDE, { n: 2.2, bias: d < 0 ? -0.02 : -0.10 });
  });
  shag(p, [[18, hy + 2], [20, hy - 5], [26, hy - 5], [28, hy + 2]], MATTED, { flip: true, seed: 8, gain: 0.85 });
  return ink(p);
}

function trollAnims(f) {
  const mk = (o) => trollFrame(f, o);
  // the wound knits shut across the idle: raw at the top of the breath, pale flesh by the bottom
  const idle = {
    frames: [mk({ bob: 0, heal: 0 }), mk({ bob: 1, headDy: 1, heal: 0.35 }), mk({ bob: 1, headDy: 1, lean: 1, heal: 0.7 }), mk({ bob: 0, lean: 1, heal: 1 })],
    durations: [400, 330, 360, 380], loop: true,
  };
  // a long loose stride: the arms swing well behind the legs, the head rolls forward
  const walk = {
    frames: [mk({ stride: 1, bob: 0, heal: 0.2 }), mk({ stride: 0.4, bob: 1, crouch: 1, heal: 0.5 }), mk({ stride: -1, bob: 0, heal: 0.8 }), mk({ stride: -0.4, bob: 1, crouch: 1, heal: 1 })],
    durations: [190, 170, 190, 170], loop: true,
  };
  // haul both arms up over the head and bring them down: the troll has no weapon but its reach
  const attack = {
    frames: [
      mk({ arm: 0, bob: 2, crouch: 2, headDy: 1, heal: 1 }),
      mk({ arm: 1, bob: -2, headDy: -2, lean: -1, heal: 1 }),
      mk({ arm: 2, bob: 1, crouch: 1, smear: true, heal: 0.8 }),
      mk({ arm: 2, bob: 2, crouch: 2, headDy: 1, heal: 0.8 }),
    ],
    durations: [180, 130, 90, 200], loop: false,
  };
  const recoil = mk({ bob: 2, crouch: 2, headDy: 2, lean: -2, heal: 0 });
  const hurt = { frames: [flash(recoil), recoil], durations: [80, 190], loop: false };
  const d0 = mk({ bob: 2, crouch: 2, headDy: 2, heal: 0 });
  const d1 = tilt(mk({ bob: 4, crouch: 4, headDy: 3, heal: 0 }), 0.3, TR_PIV.x, TR_FLOOR);
  const d2 = squashTo(tilt(mk({ bob: 5, crouch: 5, heal: 0 }), 0.62, TR_PIV.x, TR_FLOOR), 0.66, TR_H - 3);
  const death = {
    frames: [d0, d1, d2, squashTo(d2, 0.58, TR_H - 3), squashTo(d2, 0.46, TR_H - 3)],
    durations: [140, 170, 200, 470, 900], loop: false,
  };
  return { idle, walk, attack, hurt, death };
}

/** Troll: 46x60, a rangy hunched giant whose knuckles nearly reach the floor, wounds knitting shut. */
export function buildTroll() {
  return { anims: clips(trollAnims), palette: BEAST_PALETTE, w: TR_W, h: TR_H, pivot: TR_PIV, emissive: '', scale: 1 };
}

// ------------------------------------------------------------------------------------ registry
const cache = new Map();
const build = (key, make) => () => {
  let b = cache.get(key);
  if (!b) { b = make(); cache.set(key, b); }
  return b;
};

/**
 * The beast group: monster type -> builder. Every key here is a REAL `MONSTER_TABLE` type
 * (game/monsters.js) — `dire-wolf`, `werebear`, `gargoyle` and `troll` — and there are no others,
 * because a sprite the game can never spawn is not art, it is a rumour.
 * @type {Object<string, () => {anims:object, palette:import('../pixelPainter.js').Palette, w:number, h:number, pivot:{x:number,y:number}, emissive:string, scale:number}>}
 */
export const BEAST_SPRITES = {
  'dire-wolf': build('dire-wolf', buildDireWolf),
  'werebear': build('werebear', buildWerebear),
  'gargoyle': build('gargoyle', buildGargoyle),
  'troll': build('troll', buildTroll),
};

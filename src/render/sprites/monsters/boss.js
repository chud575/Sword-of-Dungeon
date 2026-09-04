// boss: the heavies of the deep as HD-2D pixel sprites — ogre, salamander (fyre drake), shadow
// dragon and the Demon that guards the Sword — drawn with the same toolkit, ramp discipline and key
// light as the hero (sprites/heroSprite.js) and the other monster groups.
//
// HOUSE STYLE (shared with the hero and the other groups)
//  · One palette of hue-shifted ramps: shadows drift violet and gain saturation, highlights drift
//    amber and lose a little. Each creature uses 4-6 ramps, never more.
//  · Key light from the TOP-LEFT on every facing. The big organic masses (gut, haunch, neck, tail)
//    are struck with a directional terminator — `tone()` quantises a real lambert term onto the
//    ramp — so a limb turns like a form instead of pillowing concentric to its own outline. The
//    read-defining details (faces, tusks, horns, teeth, claws, cracks) are hand-pixelled on top.
//  · The outline is applied last by `outline()` so it is exactly one pixel, near-black violet ('#'),
//    softened to the lilac '@' on the edges that face the light. Nothing dithers.
//  · Facings south / east / north are each posed deliberately; west is the mirrored east.
//  · Fills stop two rows above the pivot row so the outline lands on the contact row and
//    spriteSheet's foot metrics put the contact shadow under the real feet.
//  · 1 texel = 1/32 tile (spriteBillboard.PX_PER_TILE), exactly the hero's pixel density: these
//    creatures read as huge because their canvases are, not because anything is scaled up.
//
// SILHOUETTES (no two of these can be confused, with each other or with any other group)
//  ogre        a boulder on legs: the bald head sunk BETWEEN two shoulder humps so the skull line
//              never breaks the shoulders, an enormous overhanging gut, a hide kilt, and the
//              signature — a knotted bone club as long as he is tall, carried over one shoulder.
//  salamander  low and horizontal, belly a hand above the floor, four sprawling splayed legs with
//              the knees ABOVE the spine, a whip tail longer than the body, and the signature —
//              a saw of dorsal fins over molten cracks that glow through the hide.
//  dragon      the tallest thing in the game: a rearing drake under a WING ARCH that peaks well
//              above its own head, a long S neck and the signature — two swept horns making a
//              lyre over the skull, with cold blue fire in the eyes and throat.
//  demon       broad-shouldered and still: two curling RAM HORNS with daylight inside the curl and
//              a hard ink gap where they leave the skull, wings folded down the back into two
//              hanging blades, cloven hooves, one furnace split down the breastbone, and the
//              signature — the ring of stolen soul-light hanging above its open palm.
import { Palette, paint, outline, houseOutline, keyShade, makePix, setPx, getPx, shift, smearArc, mirrorLit, blit } from '../pixelPainter.js';
import { INK, INK_LIT, LIT, ramp } from '../style.js';

/** @typedef {import('../pixelPainter.js').Pix} Pix */

// ---------------------------------------------------------------------------------- palette
// Keys are unique per creature so a mis-keyed pixel is obvious in the sheet.
// EVERY ramp below is a slice of ONE seven-step house curve (`ramp()` in style.js): the same ink,
// the same hue drift and the same value spread as every other group, so the ogre and the swordsman
// he is about to eat are lit by one law. `pick` chooses which steps of that curve a material takes
// — bone and keratin reach the top because they are polished, hide sits in the middle, the
// shadow dragon's scale starts at the bottom because it is a hole in the light.
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

  /**
   * A material band with its OWN house curve rather than a slice of the shared seven-step one: the
   * demon needs six steps of one hide and four of a black keratin that must never reach the top of
   * a ramp, and `ramp()` above can only ever hand out seven fixed steps. `steps` is how long the
   * underlying curve is, `pick` which of its steps the keys take, and any other option goes
   * straight to `ramp()` (a low `satShift` keeps a highlight inside the species colour).
   * @param {string} keys darkest first
   * @param {string} base
   * @param {{steps?:number, pick?:number[], hueShift?:number, satShift?:number, range?:number}} [o]
   */
  band(keys, base, { steps = Math.max(5, keys.length), pick = null, ...o } = {}) {
    const cols = ramp(base, steps, o);
    const idx = pick || [...keys].map((_, i) => Math.round((i * (steps - 1)) / (keys.length - 1)));
    [...keys].forEach((k, i) => this.set(k, cols[idx[i]]));
    return this;
  }
}

export const BOSS_PALETTE = new HousePalette()
  .set('#', INK)                                              // outline: the one house ink
  .set('@', INK_LIT)                                          // lit edge / inner line
  // ogre — sour olive hide over a pale gut, bone club, cured leather
  .ramp('1234', '#7c8752')
  .ramp('567', '#b3b184', { pick: [1, 3, 5] })
  .ramp('89z', '#a08e69', { pick: [1, 3, 5] })   // old greased bone: never brighter than his own face
  .ramp('ab', '#6d4a2e', { pick: [1, 4] })
  .set('c', '#8d94a2')                                        // iron band on the club
  // salamander — charred scale, hot ochre belly plates, molten cracks
  .ramp('defg', '#5e3330')
  .ramp('hij', '#c08540')
  .set('k', '#a83318').set('l', '#ff8a2b').set('m', '#ffe9a8')  // crack core / crack / white-hot
  .set('n', '#f2e6c8')                                        // teeth and claws
  // shadow dragon — cold violet scale, plum membrane, bone horn, blue fire
  .ramp('opqr', '#40355e')
  .ramp('stu', '#5a3550')
  .ramp('vw', '#a99f8a', { pick: [3, 6] })
  .set('x', '#8fe6ff').set('y', '#2a2140')                    // cold fire / spine ridge
  // demon — BLACKENED WINE hide that goes to warm ash where the light strikes it, black horn and
  // black hoof, a plum-black wing, and one furnace in the chest. Three things this palette exists
  // to stop, all of which had the guardian of the Sword reading as a pink man in a wig:
  //   · the hide WAS '#7c2434', a mid crimson two steps from the warm brick floor it stands on —
  //     from across a room the demon and the flagstones were the same colour. '#5a2842' is a
  //     colder, darker wine: it separates from the floor by hue AND by value, at any depth grade.
  //   · six steps, not four, and the body is painted in the BOTTOM half of them. The top two
  //     desaturate to warm ash (#b08d90, #c2b8b6), so the lit plane reads as LIGHT on black hide
  //     rather than as more pink.
  //   · the keratin WAS '#a99a86' picked at steps 2/4/6 — chalk-white horns, which is exactly what
  //     a wig looks like at gameplay distance. It is now a black horn that never reaches past the
  //     middle of its own curve; only its top-left ridge and the tooth tips ('V') catch anything.
  .band('ABCDOP', '#5a2842')                                  // hide: wine · wine · plum · dusty rose · ash · light ash
  .band('GHIQV', '#4e4038', { steps: 6, pick: [0, 1, 2, 3, 4] })  // horn, hoof, tooth — dark keratin
  .band('JKL', '#2f2038', { steps: 6, pick: [0, 1, 2] })      // wing membrane: plum-black
  .set('M', '#ffb347').set('S', '#d8571c').set('N', '#2a0f18')  // furnace core / furnace bleed / char
  // shared
  .set('E', '#1b1424').set('W', '#fff7ea').set('R', '#ff6a4a')  // eye, catch-light, red iris
  .set('F', '#fff4f0');                                        // hurt flash

/** Compose is not used here: every creature draws straight into one Pix, then takes the outline. */
const ink = (p) => outline(p, '#', { lit: LIT, litKey: '@' });

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
    for (let x = 0; x < p.w; x++) { const c = p.d[y * p.w + x]; if (c) setPx(o, x, ty, c); }
  }
  return o;
}

/** Rotate a pix about (cx,cy) by `a` radians, nearest-neighbour (used for the toppling deaths). */
function tilt(p, a, cx, cy) {
  const o = makePix(p.w, p.h), ca = Math.cos(-a), sa = Math.sin(-a);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const dx = x - cx, dy = y - cy;
    const sx = Math.round(cx + dx * ca - dy * sa), sy = Math.round(cy + dx * sa + dy * ca);
    const c = getPx(p, sx, sy);
    if (c) setPx(o, x, y, c);
  }
  return o;
}

/** Standard clip set assembled from per-facing frame makers; west is the mirrored east. */
function clips(make) {
  const anims = {};
  // THE INK, LAST AND ONCE. Frames reach here already outlined, but the death clips run `tilt()`
  // and `squashTo()` AFTERWARDS — resampling a 1-px ring into gaps and doubles — and the west
  // facing is a mirror, which puts the lit-edge softening on the wrong side of the creature.
  // `houseOutline` peels every second coat, re-lays exactly one pixel of INK round anything bare
  // and re-keys the coat against the frame as it finally stands.
  const inked = (a) => ({ ...a, frames: a.frames.map((p) => houseOutline(p, { key: '#', litKey: '@', lit: LIT })) });
  const put = (name, f, a) => { (anims[name] ||= {})[f] = { name, facing: f, ...inked(a) }; };
  for (const f of ['S', 'E', 'N']) for (const [name, a] of Object.entries(make(f))) put(name, f, a);
  for (const name of Object.keys(anims)) {
    const e = anims[name].E;
    if (e) anims[name].W = { ...e, facing: 'W', frames: inked({ frames: e.frames.map((p) => mirrorLit(p, '')) }).frames };
  }
  return anims;
}

// ------------------------------------------------------------------------------- form shading
// The one key light, as a unit vector in sprite space (x right, y down, z out of the screen).
// LZ WAS 0.48, AND THAT IS THE PILLOW. With that much light coming straight out of the screen the
// lambert on a limb peaks a pixel INSIDE the silhouette and falls back at the rim, which quantises
// into a dark line down the LIT side of every arm, haunch and gut — a form with shadow on both
// edges and light between them, which style.js bans by name. Pulling the light almost into the
// sprite plane makes the term MONOTONIC across a form: brightest at the top-left rim, darkest at
// the bottom-right rim, one clean terminator between them and no bright core.
const LX = -0.66, LY = -0.70, LZ = 0.18;

/**
 * The ramp key for a surface whose normal is (nx, ny, nz=sqrt(1-nx²-ny²)) — a real directional
 * terminator quantised onto `keys` (darkest first). `bias` pushes a whole form up or down the ramp
 * (far limbs sit a tone back; a lit belly sits a tone forward). The constants are solved to land
 * the two RIMS of a vertical limb where the old ones did, so every hand-tuned `bias` in this file
 * and in monsters/drakes.js still means what it meant; what changes is the middle, which now falls
 * to the terminator instead of sitting up near the highlight.
 */
function tone(nx, ny, keys, bias = 0) {
  const r2 = Math.min(1, nx * nx + ny * ny);
  const lam = nx * LX + ny * LY + Math.sqrt(1 - r2) * LZ;
  let t = lam * 0.66 + 0.46 + bias;
  t = t < 0 ? 0 : t > 0.999 ? 0.999 : t;
  return keys[(t * keys.length) | 0];
}

/**
 * A shaded mass: the superellipse |nx|^n + |ny|^n <= 1 around (cx, cy), lit from the top-left.
 * `n` = 2 is an ellipse, 2.6 a barrel, 3.4 nearly a slab.
 */
function mass(p, cx, cy, rx, ry, keys, { n = 2, bias = 0 } = {}) {
  const x0 = Math.max(0, Math.floor(cx - rx) - 1), x1 = Math.min(p.w - 1, Math.ceil(cx + rx) + 1);
  const y0 = Math.max(0, Math.floor(cy - ry) - 1), y1 = Math.min(p.h - 1, Math.ceil(cy + ry) + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
    if (Math.pow(Math.abs(nx), n) + Math.pow(Math.abs(ny), n) > 1) continue;
    setPx(p, x, y, tone(nx, ny, keys, bias));
  }
  return p;
}

/** A shaded capsule from (x0,y0) to (x1,y1), radius r0 -> r1: arms, legs, necks, tails, horns. */
function limb(p, x0, y0, x1, y1, r0, r1, keys, bias = 0) {
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1e-6;
  const rmax = Math.max(r0, r1);
  const bx0 = Math.max(0, Math.floor(Math.min(x0, x1) - rmax) - 1), bx1 = Math.min(p.w - 1, Math.ceil(Math.max(x0, x1) + rmax) + 1);
  const by0 = Math.max(0, Math.floor(Math.min(y0, y1) - rmax) - 1), by1 = Math.min(p.h - 1, Math.ceil(Math.max(y0, y1) + rmax) + 1);
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    const px = x + 0.5 - x0, py = y + 0.5 - y0;
    let t = (px * dx + py * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ox = px - dx * t, oy = py - dy * t, r = r0 + (r1 - r0) * t;
    if (ox * ox + oy * oy > r * r) continue;
    setPx(p, x, y, tone(ox / r, oy / r, keys, bias));
  }
  return p;
}

/** A capsule chain through `pts` with the radius easing r0 -> r1 (tails, horns, necks, arms). */
function curve(p, pts, r0, r1, keys, bias = 0) {
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = r0 + (r1 - r0) * (i / n), b = r0 + (r1 - r0) * ((i + 1) / n);
    limb(p, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], a, b, keys, bias);
  }
  return p;
}

/**
 * A saw of triangular fins/spines standing off a polyline: each fin points along the outward
 * normal, tallest in the middle of the run. Used for the salamander's crest and the dragon's ridge.
 */
function crest(p, pts, height, keys, { flip = false, tip = null } = {}) {
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    const nx = (flip ? dy : -dy) / L, ny = (flip ? -dx : dx) / L;
    const s = Math.sin(((i + 0.5) / n) * Math.PI) * 0.55 + 0.45;
    const h = height * s;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    for (let k = 0; k <= Math.ceil(h); k++) {
      const t = k / Math.max(1, h);
      const half = (1 - t) * (L / 2);
      const cx = mx + nx * k, cy = my + ny * k;
      for (let j = -Math.ceil(half); j <= Math.ceil(half); j++) {
        const x = Math.round(cx + (dx / L) * j), y = Math.round(cy + (dy / L) * j);
        setPx(p, x, y, tip && t > 0.72 ? tip : keys[Math.min(keys.length - 1, 1 + ((t * keys.length) | 0))]);
      }
    }
  }
  return p;
}

/**
 * A membrane wing struck from the shoulder: the membrane is scalloped between the finger bones and
 * the bones are laid over it as one-pixel lines, so the wing reads at any spread.
 * @param {Pix} p @param {number} cx @param {number} cy shoulder
 * @param {{a:number, r:number}[]} fingers leading edge first, angles in screen space (y down)
 * @param {number} dir +1 = the wing reaches to the right
 * @param {string} keys trailing / mid / leading membrane tones + the bone tone
 * @param {{tatter?:number, scallop?:number}} [o] tatter = bites taken out of the hem
 */
function wingFan(p, cx, cy, fingers, dir, keys, o = {}) {
  const n = fingers.length - 1;
  const scallop = o.scallop ?? 3.1, tatter = o.tatter ?? 0;
  const rmax = Math.max(...fingers.map((f) => f.r));
  const bx0 = Math.max(0, Math.floor(cx - rmax) - 1), bx1 = Math.min(p.w - 1, Math.ceil(cx + rmax) + 1);
  const by0 = Math.max(0, Math.floor(cy - rmax) - 1), by1 = Math.min(p.h - 1, Math.ceil(cy + rmax) + 1);
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    const dx = (x + 0.5 - cx) * dir, dy = y + 0.5 - cy;
    if (dx < -0.5) continue;
    const rr = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    if (a < fingers[0].a || a > fingers[n].a) continue;
    let i = 0;
    while (i < n - 1 && a > fingers[i + 1].a) i++;
    const span = fingers[i + 1].a - fingers[i].a || 1e-6;
    const fr = (a - fingers[i].a) / span;
    let reach = fingers[i].r * (1 - fr) + fingers[i + 1].r * fr - scallop * Math.sin(fr * Math.PI);
    if (tatter && (i * 3 + ((fr * 7) | 0)) % 4 === 1) reach -= tatter;   // bites out of the hem
    if (rr > reach) continue;
    // the membrane is shaded twice: across the fan (which panel) and along it (root light, hem dark)
    const k = (a - fingers[0].a) / (fingers[n].a - fingers[0].a), rad = rr / Math.max(1, reach);
    let ki = k < 0.30 ? 2 : k < 0.68 ? 1 : 0;
    if (rad > 0.80) ki = Math.max(0, ki - 1);
    else if (rad < 0.34) ki = Math.min(2, ki + 1);
    setPx(p, x, y, keys[ki]);
  }
  for (let i = 0; i <= n; i++) {
    const { a, r } = fingers[i];
    const len = Math.max(0, r - 1.6), steps = Math.max(1, Math.ceil(len));
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * len;
      const x = Math.round(cx + Math.cos(a) * t * dir), y = Math.round(cy + Math.sin(a) * t);
      if (!getPx(p, x, y)) continue;                       // a bone only shows where membrane is
      setPx(p, x, y, keys[3]);
    }
  }
  // the wing's own arm: root to the leading finger, two pixels thick
  limb(p, cx, cy, cx + Math.cos(fingers[0].a) * fingers[0].r * 0.55 * dir, cy + Math.sin(fingers[0].a) * fingers[0].r * 0.55, 2.2, 1.4, keys[3] + keys[3] + keys[3]);
  return p;
}

/** Stamp a hand-painted detail sheet at (x,y) (transparent source pixels are skipped). */
const stamp = (p, art, x, y, mir = false) => blit(p, art, Math.round(x), Math.round(y), { mirror: mir });

const lerp = (a, b, t) => a + (b - a) * t;

// ==========================================================================================
//                                          OGRE
// ==========================================================================================
// Read: a boulder on legs. The skull is sunk between two shoulder humps so nothing breaks the
// shoulder line, the gut overhangs the kilt, and the bone club is as long as he is tall.
// drawn in a 48-wide frame and shifted right by OG_PAD, so the club never clips the canvas edge
const OG_W = 56, OG_H = 56, OG_PAD = 4, OG_PIV = { x: 28, y: 54 };
const HIDE = '1234', BELLY = '567', BONE = '89z', LEATHER = 'ab';

// a lit brow ridge, two small deep-set eyes under it, and the under-bite: tusks past the upper lip
const OG_FACE_S = paint(`
.4444444444.
.#EW#..#WE#.
..#......#..
..9.......9.
..9#8888#9..
...######...`);
const OG_FACE_E = paint(`
.4444...
.#EW#...
..#...9.
..9#889.
...###..`);

/** The club: a knotted bone shaft with an iron band and a heavy knobbed head. */
function ogreClub(p, hx, hy, tx, ty, { far = false } = {}) {
  const b = far ? -0.14 : 0;
  const ux = (tx - hx), uy = (ty - hy), L = Math.hypot(ux, uy) || 1;
  const ax = ux / L, ay = uy / L;                       // along the shaft
  const nx = -ay, ny = ax;                              // across it
  const at = (t, k = 0) => [hx + ax * L * t + nx * k, hy + ay * L * t + ny * k];
  // the shaft TAPERS: a hand-thick grip swelling into the head, not one fat capsule
  limb(p, hx, hy, ...at(0.55), 1.9, 3.0, BONE, b - 0.04);
  limb(p, ...at(0.55), tx, ty, 3.0, 3.6, BONE, b - 0.02);
  mass(p, tx, ty, 5.4, 5.0, BONE, { n: 2.4, bias: b });
  // GRAIN: split lines running the length of old bone, on the shadow side only so they read as
  // texture and never as a highlight (they used to be nothing at all — a bare cream capsule)
  for (let i = 0; i < 3; i++) {
    const off = [1.4, 2.2, -1.7][i], t0 = [0.26, 0.30, 0.24][i], t1 = [0.66, 0.70, 0.60][i];
    for (let t = t0; t <= t1; t += 0.04) {
      const [gx, gy] = at(t, off);
      if (getPx(p, Math.round(gx), Math.round(gy))) setPx(p, Math.round(gx), Math.round(gy), off > 0 ? '8' : '9');
    }
  }
  // KNUCKLES on the head: three lumps, lit up-left, shadowed down-right
  setPx(p, Math.round(tx - nx * 3.4), Math.round(ty - ny * 3.4), 'z');
  setPx(p, Math.round(tx - nx * 3.4 - ax * 2), Math.round(ty - ny * 3.4 - ay * 2), '9');
  setPx(p, Math.round(tx + nx * 3.6), Math.round(ty + ny * 3.6), '8');
  setPx(p, Math.round(tx + ax * 2.2), Math.round(ty + ay * 2.2), '8');
  // BINDING: cured hide lashed round the grip, and a second turn where the shaft meets the head
  for (const [t, half] of [[0.08, 2.2], [0.17, 2.5], [0.74, 3.2]]) {
    for (let k = -half; k <= half; k += 0.5) {
      const [bxp, byp] = at(t, k);
      if (getPx(p, Math.round(bxp), Math.round(byp))) setPx(p, Math.round(bxp), Math.round(byp), k < -half * 0.25 ? 'b' : 'a');
    }
  }
  // the iron ferrule at the very butt of the grip
  for (let k = -2; k <= 2; k++) { const [cxp, cyp] = at(0.36, k * 0.9); setPx(p, Math.round(cxp), Math.round(cyp), 'c'); }
}

/**
 * The crease where the gut folds over: one dark arc along the lower-right of the belly mass, so the
 * pale skin ends on a terminator instead of fading concentrically into its own outline.
 */
function ogreFold(p, cx, cy, rx, ry) {
  for (let a = -0.45; a < 1.9; a += 0.06) {
    const x = Math.round(cx + Math.cos(a) * rx * 0.99), y = Math.round(cy + Math.sin(a) * ry * 0.99);
    if (getPx(p, x, y)) setPx(p, x, y, '5');
  }
}

/**
 * One ogre frame.
 * @param {'S'|'E'|'N'} f
 * @param {{bob?:number, stride?:number, club?:number, headDy?:number, lean?:number, smear?:boolean, crouch?:number}} o
 */
/**
 * A BROAD BARE FOOT, PLANTED. The ogre's was an ellipse two pixels tall: flat-bottomed, toeless,
 * the same shape as the shadow under it, which is why he read as standing in a puddle. Now the
 * ankle pinches into an INSTEP that spreads forward and takes the key light down its top-left, and
 * FOUR toes hang off it on the contact row, each two pixels wide and separated by a column the
 * outline pass fills with ink, each finished with a horn nail. `y` is the contact row: the weight
 * shadow goes under it.
 * @param {Pix} p @param {number} cx @param {number} y @param {string} keys the hide ramp, darkest
 *   first @param {string} nail the horn key @param {number} [bias]
 */
function foot(p, cx, y, keys, nail, bias = 0) {
  const K = [...keys];
  const hi = K[K.length - 1], mid = K[K.length - 2], dk = K[Math.max(0, K.length - 3)];
  mass(p, cx, y - 5, 4.0, 3.2, keys, { n: 2.4, bias: bias - 0.02 });        // the ankle
  for (let r = 0; r < 3; r++) {                                             // the instep, spreading
    const w = 4 + r;
    for (let x = -w; x <= w; x++) setPx(p, cx + x, y - 4 + r, x < 2 - w ? hi : x < 1 ? mid : dk);
  }
  for (const [off, deep] of [[-5, 1], [-2, 1], [1, 1], [4, 0]]) {           // four toes, ink between
    if (deep) { setPx(p, cx + off, y - 1, mid); setPx(p, cx + off + 1, y - 1, dk); }
    setPx(p, cx + off, y, nail); setPx(p, cx + off + 1, y, dk);
  }
}

function ogreFrame(f, o = {}) {
  const p = makePix(OG_W, OG_H);
  const done = (q) => ink(shift(q, OG_PAD, 0));
  const b = o.bob || 0, s = o.stride || 0, c = o.crouch || 0, lean = o.lean || 0;
  const lLift = Math.max(0, s) * 3, rLift = Math.max(0, -s) * 3;
  const club = o.club ?? 0;   // 0 shouldered · 1 raised behind · 2 smashed down-forward

  if (f === 'S') {
    // legs: short, bowed, planted wide
    limb(p, 18, 38 + b + c, 17 - Math.max(0, s) * 1.5, 46 - lLift, 5.6, 3.6, HIDE, -0.05);
    limb(p, 30, 38 + b + c, 32 + Math.max(0, -s) * 1.5, 46 - rLift, 5.6, 3.6, HIDE, -0.05);
    foot(p, 16, 52 - lLift, HIDE, '9', -0.10);
    foot(p, 33, 52 - rLift, HIDE, '9', -0.16);
    // hide kilt over the hips
    mass(p, 24, 40 + b + c, 13.5, 6.4, LEATHER, { n: 2.8 });
    for (let i = 0; i < 5; i++) setPx(p, 13 + i * 6, 45 + b + c, 'a');
    // gut, and the pale belly turning under it: the belly sits UP-LEFT of the gut's centre so the
    // hide rolls under it into shadow on the lower right — a concentric belly is a pillow, not a form
    mass(p, 24 + lean, 32 + b, 13.8, 10.6, HIDE, { n: 2.4 });
    mass(p, 22 + lean, 32 + b, 11.6, 8.8, BELLY, { n: 2.5, bias: -0.06 });
    ogreFold(p, 22 + lean, 32 + b, 11.6, 8.8);
    // chest slab with a shoulder hump at each end; the skull drops into the notch between them
    mass(p, 24 + lean, 22 + b, 15.2, 7.6, HIDE, { n: 2.8 });
    mass(p, 10 + lean, 20 + b, 6.8, 5.8, HIDE, { n: 2.2, bias: 0.03 });
    mass(p, 38 + lean, 20 + b, 6.8, 5.8, HIDE, { n: 2.2, bias: -0.03 });
    // head
    const hy = 14 + b + (o.headDy || 0);
    mass(p, 24 + lean, hy, 6.2, 5.6, HIDE, { n: 2.2 });
    mass(p, 24 + lean, hy + 4, 5.2, 3.4, HIDE, { n: 2.4, bias: -0.05 });
    stamp(p, OG_FACE_S, 18 + lean, hy - 3);
    // free arm (screen left)
    curve(p, [[11 + lean, 22 + b], [6 + lean, 30 + b], [8 + lean, 38 + b]], 4.6, 3.2, HIDE, -0.02);
    mass(p, 8 + lean, 40 + b, 3.8, 3.6, HIDE, { n: 2.2, bias: -0.08 });
    setPx(p, 5 + lean, 41 + b, '9'); setPx(p, 6 + lean, 43 + b, '9');
    // club arm (screen right)
    if (club === 2) {
      if (o.smear) smearArc(p, 30, 26 + b, 15, 23, -1.5, 0.5, ['@', '8', '9', '9']);
      curve(p, [[37 + lean, 22 + b], [30, 30 + b], [21, 34 + b]], 4.6, 3.2, HIDE, 0.02);
      ogreClub(p, 20, 35 + b, 8, 41 + b);
    } else if (club === 1) {
      curve(p, [[37 + lean, 22 + b], [43, 20 + b], [41, 14 + b]], 4.6, 3.2, HIDE, 0.02);
      ogreClub(p, 41, 13 + b, 40, 5 + b);
    } else {
      curve(p, [[37 + lean, 22 + b], [42, 30 + b], [40, 36 + b]], 4.6, 3.2, HIDE, 0.02);
      ogreClub(p, 40, 34 + b, 43, 10 + b);
    }
    return done(p);
  }

  if (f === 'E') {
    // far leg first, a tone back
    limb(p, 20, 38 + b + c, 18 + Math.max(0, -s) * 4, 46 - rLift, 5.2, 3.4, HIDE, -0.16);
    foot(p, 18 + Math.max(0, -s) * 4, 52 - rLift, HIDE, '9', -0.20);
    // a shouldered or raised club rides BEHIND him, so it never crosses the face
    if (club === 1) { curve(p, [[30 + lean, 23 + b], [30, 17 + b], [25, 13 + b]], 4.4, 3, HIDE, -0.08); ogreClub(p, 24, 12 + b, 15, 6 + b, { far: true }); }
    else if (club === 0) { curve(p, [[30 + lean, 23 + b], [26, 28 + b], [24, 33 + b]], 4.4, 3, HIDE, -0.08); ogreClub(p, 24, 32 + b, 15, 10 + b, { far: true }); }
    // tail of the kilt hanging behind
    mass(p, 20, 41 + b + c, 11.5, 6.2, LEATHER, { n: 2.8 });
    // body: the gut swings out to the right, the back humps over the shoulder
    mass(p, 27 + lean, 32 + b, 12.4, 10.4, HIDE, { n: 2.4 });
    mass(p, 30 + lean, 33 + b, 7, 6.4, BELLY, { n: 2.2, bias: 0.02 });
    mass(p, 24 + lean, 22 + b, 11.4, 8, HIDE, { n: 2.6 });
    mass(p, 19 + lean, 19 + b, 7.4, 6, HIDE, { n: 2.2, bias: 0.02 });   // shoulder hump, seen from behind
    // head, pushed forward off the shoulders
    const hy = 15 + b + (o.headDy || 0);
    mass(p, 31 + lean, hy, 6, 5.4, HIDE, { n: 2.2 });
    mass(p, 34 + lean, hy + 3, 4.4, 3.2, HIDE, { n: 2.4, bias: -0.02 });
    stamp(p, OG_FACE_E, 28 + lean, hy - 3);
    // near leg
    limb(p, 27, 38 + b + c, 29 + Math.max(0, s) * 4, 46 - lLift, 5.4, 3.6, HIDE, 0);
    foot(p, 30 + Math.max(0, s) * 4, 52 - lLift, HIDE, '9', -0.08);
    // the near arm: only the smashing club comes round the front
    if (club === 2) {
      if (o.smear) smearArc(p, 34, 24 + b, 14, 22, -1.7, 0.35, ['@', '8', '9', '9']);
      curve(p, [[30 + lean, 23 + b], [37, 29 + b], [41, 34 + b]], 4.4, 3, HIDE, 0.03);
      ogreClub(p, 42, 35 + b, 44, 45 + b);
    } else {
      curve(p, [[28 + lean, 24 + b], [33, 31 + b], [32, 37 + b]], 4.4, 3, HIDE, 0.05);
      mass(p, 32, 39 + b, 3.6, 3.4, HIDE, { n: 2.2, bias: -0.02 });
      setPx(p, 34, 40 + b, '9'); setPx(p, 33, 42 + b, '9');
    }
    return done(p);
  }

  // NORTH — the back: two shoulder humps, a bald skull between them, the club head over one of them
  limb(p, 18, 38 + b + c, 17 - Math.max(0, s) * 1.5, 46 - lLift, 5.6, 3.6, HIDE, -0.08);
  limb(p, 30, 38 + b + c, 32 + Math.max(0, -s) * 1.5, 46 - rLift, 5.6, 3.6, HIDE, -0.08);
  foot(p, 16, 52 - lLift, HIDE, '9', -0.14);
  foot(p, 33, 52 - rLift, HIDE, '9', -0.18);
  mass(p, 24, 40 + b + c, 13.5, 6.4, LEATHER, { n: 2.8 });
  mass(p, 24, 31 + b, 13.2, 10.4, HIDE, { n: 2.5, bias: -0.04 });
  mass(p, 24, 21 + b, 15.2, 8, HIDE, { n: 2.8, bias: -0.02 });
  mass(p, 10, 19 + b, 6.8, 5.8, HIDE, { n: 2.2, bias: 0.02 });
  mass(p, 38, 19 + b, 6.8, 5.8, HIDE, { n: 2.2, bias: -0.05 });
  // spine crease and old scars across the back
  for (let y = 18; y < 38; y += 1) setPx(p, 24, y + b, y % 3 === 0 ? '2' : '1');
  for (let i = 0; i < 4; i++) setPx(p, 16 + i, 26 + i + b, '3');
  const hy = 14 + b + (o.headDy || 0);
  mass(p, 24, hy, 6.2, 5.6, HIDE, { n: 2.2, bias: -0.02 });
  setPx(p, 19, hy + 1, '@'); setPx(p, 29, hy + 1, '#');
  curve(p, [[11, 22 + b], [7, 30 + b], [9, 38 + b]], 4.6, 3.2, HIDE, -0.04);
  if (club === 2) {
    if (o.smear) smearArc(p, 26, 24 + b, 14, 22, -2.0, -0.1, ['@', '8', '9', '9']);
    curve(p, [[37, 22 + b], [40, 16 + b], [38, 10 + b]], 4.6, 3.2, HIDE, 0);
    ogreClub(p, 38, 9 + b, 33, 3 + b, { far: true });
  } else {
    curve(p, [[37, 22 + b], [42, 29 + b], [40, 35 + b]], 4.6, 3.2, HIDE, 0);
    ogreClub(p, 40, 34 + b, 42, 11 + b, { far: true });
  }
  return done(p);
}

function ogreAnims(f) {
  const mk = (o) => ogreFrame(f, o);
  const idle = {
    frames: [mk({ bob: 0 }), mk({ bob: 1, headDy: 1 }), mk({ bob: 1, headDy: 1, lean: 1 }), mk({ bob: 0, lean: 1 })],
    durations: [420, 340, 380, 340], loop: true,
  };
  // a heavy two-beat plod: he sinks onto each foot rather than springing off it
  const walk = {
    frames: [mk({ stride: 1, bob: 0 }), mk({ stride: 0.4, bob: 1, crouch: 1 }), mk({ stride: -1, bob: 0 }), mk({ stride: -0.4, bob: 1, crouch: 1 })],
    durations: [200, 180, 200, 180], loop: true,
  };
  // overhead smash: coil, haul the club up behind, drop it with a smear, settle
  const attack = {
    frames: [mk({ club: 0, bob: 2, crouch: 2, headDy: 1 }), mk({ club: 1, bob: -1, lean: -1 }), mk({ club: 2, bob: 1, crouch: 1, smear: true }), mk({ club: 2, bob: 2, crouch: 2 })],
    durations: [180, 130, 90, 200], loop: false,
  };
  const recoil = mk({ bob: 2, crouch: 2, headDy: 2, lean: -2 });
  const hurt = { frames: [flash(recoil), recoil], durations: [80, 190], loop: false };
  const d0 = mk({ bob: 2, crouch: 2, headDy: 2 });
  const d1 = tilt(mk({ bob: 3, crouch: 3, headDy: 3 }), 0.28, 28, 52);
  const d2 = squashTo(tilt(mk({ bob: 4, crouch: 4 }), 0.6, 28, 52), 0.7, OG_H - 3);
  const death = {
    frames: [d0, d1, d2, squashTo(d2, 0.62, OG_H - 3), squashTo(d2, 0.5, OG_H - 3)],
    durations: [140, 170, 200, 460, 900], loop: false,
  };
  return { idle, walk, attack, hurt, death };
}

/** Ogre: 48x56, a boulder on legs with a bone club over one shoulder. */
export function buildOgre() {
  return { anims: clips(ogreAnims), palette: BOSS_PALETTE, w: OG_W, h: OG_H, pivot: OG_PIV, emissive: '', scale: 1 };
}

// ==========================================================================================
//                                SALAMANDER  (fyre drake)
// ==========================================================================================
// Read: low and horizontal where everything else is upright. Sprawling legs with the knees above
// the spine, a whip tail longer than the body, a saw of dorsal fins, and molten cracks that glow
// through the hide — the only warm light in the group.
const SA_W = 56, SA_H = 40, SA_PIV = { x: 28, y: 38 };
const SCALE = 'defg', PLATE = 'hij';

/** Molten cracks: a broken seam that follows the spine, brightest where the hide splits widest. */
function cracks(p, pts, heat) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay)));
    for (let s = 0; s <= n; s++) {
      const t = s / n, x = Math.round(lerp(ax, bx, t)), y = Math.round(lerp(ay, by, t));
      if (!getPx(p, x, y)) continue;
      const hot = (i + s) % 4 === 0 && heat > 0.55;
      setPx(p, x, y, hot ? 'm' : (i + s) % 2 ? 'l' : 'k');
      if (hot) setPx(p, x, y - 1, 'l');
    }
  }
}

/** A gout of fire from the jaws (attack frames only). */
function flame(p, x, y, dir, len) {
  for (let i = 0; i < len; i++) {
    const t = i / len, r = 1 + t * 3.2;
    for (let k = -Math.round(r); k <= Math.round(r); k++) {
      const yy = Math.round(y + k * 0.9 + Math.sin(t * 4) * 1.2);
      const key = Math.abs(k) < r * 0.4 ? 'm' : Math.abs(k) < r * 0.75 ? 'l' : 'k';
      setPx(p, Math.round(x + dir * i), yy, key);
    }
  }
}

// the head: a flat wedge skull with a heavy brow and a jaw of small even fangs
const SA_HEAD_E = paint(`
..ffggf.....
.fggggggff..
fgggggggggf.
fgEWggggggg.
fgggggggggg.
.fennnnnnnn.
..feennnhh..
...ffhhh....`);
const SA_HEAD_S = paint(`
..fffggfff...
.fgggggggf...
fggEWgggWEgf.
fgggggggggggf
fgggggggggggf
.fgennnnnegf.
..fnnnnnnnf..
..fennnnnef..
...ffhhhff...`);

/**
 * One salamander frame.
 * @param {'S'|'E'|'N'} f
 * @param {{bob?:number, gait?:number, tail?:number, heat?:number, rear?:number, breath?:number, dy?:number}} o
 */
function salaFrame(f, o = {}) {
  const p = makePix(SA_W, SA_H);
  const b = (o.bob || 0) + (o.dy || 0), g = o.gait || 0, heat = o.heat ?? 0.5;
  const tp = o.tail || 0, rear = o.rear || 0;

  if (f === 'E') {
    // tail: a whip longer than the body, leaving the hips and lashing behind
    const sw = [0, -4, 4][tp % 3];
    curve(p, [[19, 26 + b], [12, 27 + b + sw * 0.3], [6, 25 + b + sw * 0.7], [2, 19 + b + sw]], 5.2, 0.8, SCALE, -0.04);
    // far pair of legs (a tone back): the sprawl puts the knees level with the spine
    curve(p, [[21, 28 + b], [18, 21 + b], [17, 33 + b - g * 2]], 2.6, 1.7, SCALE, -0.2);
    curve(p, [[35, 28 + b], [38, 21 + b], [39, 33 + b + g * 2]], 2.6, 1.7, SCALE, -0.2);
    // body: long, flat and barely off the floor
    mass(p, 27, 24 + b - rear, 14, 5.8, SCALE, { n: 2.5 });
    mass(p, 27, 27.5 + b - rear * 0.5, 11.5, 2.9, PLATE, { n: 2.6, bias: 0.02 });
    for (let x = 18; x < 37; x += 3) setPx(p, x, 29 + b, 'h');  // belly plate seams
    // neck and skull, held low and forward
    curve(p, [[39, 24 + b - rear], [44, 23 + b - rear * 1.4]], 4.8, 4, SCALE);
    stamp(p, SA_HEAD_E, 43, 19 + b - rear * 1.6);
    // dorsal saw
    crest(p, [[19, 20 + b - rear * 0.4], [26, 18 + b - rear * 0.7], [33, 19 + b - rear], [38, 21 + b - rear]], 5, SCALE, { tip: 'l' });
    cracks(p, [[20, 22 + b], [27, 21 + b], [34, 22 + b]], heat);
    cracks(p, [[23, 27 + b], [30, 28 + b]], heat * 0.8);
    // near pair of legs
    curve(p, [[22, 28 + b], [19, 20 + b], [18, 36 + b + g * 2]], 3, 2, SCALE, -0.02);
    curve(p, [[34, 28 + b], [37, 20 + b], [38, 36 + b - g * 2]], 3, 2, SCALE, -0.02);
    for (const [fx, fy] of [[18, 36 + b + g * 2], [38, 36 + b - g * 2]]) { setPx(p, fx - 2, fy, 'n'); setPx(p, fx, fy, 'n'); setPx(p, fx + 2, fy, 'n'); }
    if (o.breath) flame(p, 54, 23 + b - rear * 1.6, 1, o.breath);
    return ink(p);
  }

  if (f === 'S') {
    // head-on: the flat skull fills the front, the body and the whipping tail recede behind it
    const sw = [0, -6, 6][tp % 3];
    curve(p, [[28, 20 + b], [21 + sw * 0.5, 16 + b], [13 + sw, 13 + b], [7 + sw * 1.4, 15 + b]], 4.2, 0.8, SCALE, -0.14);
    mass(p, 28, 19 + b - rear, 12.5, 6.4, SCALE, { n: 2.6, bias: -0.05 });
    crest(p, [[21, 15 + b - rear], [25, 13 + b - rear], [31, 13 + b - rear], [35, 15 + b - rear]], 3, SCALE, { tip: 'l' });
    // sprawled legs: elbows out well past the body, feet planted wide
    curve(p, [[20, 20 + b], [11, 23 + b], [9, 31 + b - g * 2]], 3, 2, SCALE, -0.12);
    curve(p, [[36, 20 + b], [45, 23 + b], [47, 31 + b + g * 2]], 3, 2, SCALE, -0.12);
    curve(p, [[22, 25 + b], [14, 28 + b], [13, 36 + b + g * 2]], 3.2, 2.1, SCALE, -0.02);
    curve(p, [[34, 25 + b], [42, 28 + b], [43, 36 + b - g * 2]], 3.2, 2.1, SCALE, -0.02);
    for (const [fx, fy] of [[9, 32 + b - g * 2], [47, 32 + b + g * 2], [13, 36 + b + g * 2], [43, 36 + b - g * 2]]) {
      setPx(p, fx - 2, fy, 'n'); setPx(p, fx, fy, 'n'); setPx(p, fx + 2, fy, 'n');
    }
    mass(p, 28, 25 + b, 9.5, 4.4, SCALE, { n: 2.4 });
    stamp(p, SA_HEAD_S, 22, 26 + b + rear);
    cracks(p, [[21, 20 + b], [28, 17 + b], [35, 20 + b]], heat);
    if (o.breath) flame(p, 28, 34 + b, 0.0001, o.breath);
    return ink(p);
  }

  // NORTH — walking away: the tail sweeps toward the camera, the saw runs up the spine to the skull
  const sw = [0, -5, 5][tp % 3];
  curve(p, [[28, 24 + b], [27 + sw * 0.4, 30 + b], [25 + sw, 36 + b]], 4.4, 1, SCALE, 0.02);
  curve(p, [[20, 19 + b], [11, 22 + b], [9, 30 + b - g * 2]], 3, 2, SCALE, -0.14);
  curve(p, [[36, 19 + b], [45, 22 + b], [47, 30 + b + g * 2]], 3, 2, SCALE, -0.14);
  curve(p, [[22, 24 + b], [14, 27 + b], [13, 35 + b + g * 2]], 3.2, 2.1, SCALE, -0.06);
  curve(p, [[34, 24 + b], [42, 27 + b], [43, 35 + b - g * 2]], 3.2, 2.1, SCALE, -0.06);
  for (const [fx, fy] of [[9, 31 + b - g * 2], [47, 31 + b + g * 2], [13, 35 + b + g * 2], [43, 35 + b - g * 2]]) {
    setPx(p, fx - 2, fy, 'n'); setPx(p, fx, fy, 'n'); setPx(p, fx + 2, fy, 'n');
  }
  mass(p, 28, 22 + b, 13, 7.4, SCALE, { n: 2.6, bias: -0.06 });
  mass(p, 28, 14 + b, 8, 4.6, SCALE, { n: 2.4, bias: -0.02 });
  mass(p, 28, 10 + b, 6, 3.6, SCALE, { n: 2.2, bias: -0.04 });   // the flat back of the skull
  setPx(p, 24, 9 + b, '@'); setPx(p, 32, 9 + b, '#');
  crest(p, [[28, 12 + b], [28, 17 + b], [28, 22 + b], [28, 27 + b]], 3, SCALE, { tip: 'l' });
  cracks(p, [[22, 19 + b], [25, 25 + b]], heat);
  cracks(p, [[34, 19 + b], [31, 25 + b]], heat);
  return ink(p);
}

function salaAnims(f) {
  const mk = (o) => salaFrame(f, o);
  // idle: the flanks swell as the fire inside brightens and dies back
  const idle = {
    frames: [mk({ heat: 0.35, tail: 0 }), mk({ bob: -1, heat: 0.8, tail: 1 }), mk({ heat: 1, tail: 2 }), mk({ bob: -1, heat: 0.5, tail: 1 })],
    durations: [320, 260, 300, 280], loop: true,
  };
  // a scuttling four-beat: the sprawl means the whole body rocks side to side
  const walk = {
    frames: [mk({ gait: 1, tail: 1, heat: 0.6 }), mk({ gait: 0.3, bob: -1, tail: 2, heat: 0.4 }), mk({ gait: -1, tail: 1, heat: 0.7 }), mk({ gait: -0.3, bob: -1, tail: 0, heat: 0.5 })],
    durations: [110, 110, 110, 110], loop: true,
  };
  // rear back, then spit fire
  const attack = {
    frames: [mk({ rear: 3, tail: 2, heat: 1, bob: -1 }), mk({ rear: 2, tail: 2, heat: 1, breath: 4 }), mk({ rear: 0, tail: 0, heat: 1, breath: 9 }), mk({ rear: 0, tail: 1, heat: 0.6 })],
    durations: [160, 90, 130, 170], loop: false,
  };
  const recoil = mk({ bob: 2, tail: 2, heat: 0.2 });
  const hurt = { frames: [flash(recoil), recoil], durations: [70, 180], loop: false };
  const d0 = mk({ bob: 1, tail: 2, heat: 0.9 });
  const d1 = mk({ bob: 3, tail: 1, heat: 0.5 });
  const d2 = squashTo(mk({ bob: 4, tail: 0, heat: 0.2 }), 0.7, SA_H - 3);
  const death = {
    frames: [d0, d1, d2, squashTo(d2, 0.62, SA_H - 3), squashTo(d2, 0.5, SA_H - 3)],
    durations: [120, 150, 190, 480, 820], loop: false,
  };
  return { idle, walk, attack, hurt, death };
}

/** Salamander / fyre drake: 56x40, a low sprawling fire lizard with a molten spine. */
export function buildSalamander() {
  return { anims: clips(salaAnims), palette: BOSS_PALETTE, w: SA_W, h: SA_H, pivot: SA_PIV, emissive: 'lm', scale: 1 };
}

// ==========================================================================================
//                                     SHADOW DRAGON
// ==========================================================================================
// Read: the tallest thing in the game. A wing arch peaking above its own skull, a long S neck, two
// swept horns making a lyre, cold blue fire in the eyes and throat.
const DR_W = 64, DR_H = 60, DR_PIV = { x: 32, y: 58 };
const SCL = 'opqr', MEM = 'stu', HORN = 'vw';

/**
 * The wing at spread `k` (0 = furled against the back, 1 = the full arch). The leading finger
 * stands nearly straight up so the arch always peaks well above the skull — that is the read.
 */
function dragonWing(p, cx, cy, k, dir, droop = 0) {
  const fingers = [
    { a: lerp(-1.30, -1.74, k), r: lerp(14, 27, k) },
    { a: lerp(-0.95, -1.16, k) + droop, r: lerp(15, 28, k) },
    { a: lerp(-0.52, -0.62, k) + droop, r: lerp(13, 22, k) },
    { a: lerp(-0.08, -0.10, k) + droop, r: lerp(10, 15, k) },
    { a: lerp(0.34, 0.34, k) + droop, r: lerp(7, 9, k) },
  ];
  wingFan(p, cx, cy, fingers, dir, MEM + 'w', { scallop: 3.4 });
  // the thumb claw at the crown of the arch
  const t = fingers[0];
  const tx = Math.round(cx + Math.cos(t.a) * t.r * dir), ty = Math.round(cy + Math.sin(t.a) * t.r);
  setPx(p, tx, ty, 'w'); setPx(p, tx, ty - 1, 'v');
}

// the skull: a narrow wedge, deep brow, teeth showing along the jaw line
const DR_HEAD_E = paint(`
..rrrr......
.rqqqqrr....
rqxxqqqqrr..
rqqqqqqqqqr.
.qqppppppqq.
..pnnnnnnnp.
...pnnnnnpp.
....ppppp...`);
const DR_HEAD_S = paint(`
..rrrrrrrr..
.rqqqqqqqqr.
rqxxqqqqxxqr
rqqqqqqqqqqr
.qppppppppq.
.pnnnnnnnnp.
..pnnnnnnp..
...pppppp...
....pppp....`);

/**
 * One dragon frame.
 * @param {'S'|'E'|'N'} f
 * @param {{bob?:number, wing?:number, stride?:number, neck?:number, lunge?:number, breath?:number, droop?:number, crouch?:number}} o
 */
function dragonFrame(f, o = {}) {
  const p = makePix(DR_W, DR_H);
  const b = o.bob || 0, k = o.wing ?? 0.62, s = o.stride || 0, c = o.crouch || 0;
  const neck = o.neck || 0, lunge = o.lunge || 0, droop = o.droop || 0;

  if (f === 'S') {
    // wings behind everything
    dragonWing(p, 21, 26 + b, k, -1, droop);
    dragonWing(p, 43, 26 + b, k, 1, droop);
    // tail curling out to the left behind the legs
    curve(p, [[32, 44 + b], [22, 50 + b], [12, 52 + b], [6, 47 + b]], 5, 1, SCL, -0.14);
    // hind legs: digitigrade, heavy thighs
    curve(p, [[25, 38 + b + c], [21, 45 + b + c], [24 - Math.max(0, s) * 2, 51]], 6, 3.6, SCL, -0.04);
    curve(p, [[39, 38 + b + c], [43, 45 + b + c], [40 + Math.max(0, -s) * 2, 51]], 6, 3.6, SCL, -0.04);
    for (const fx of [24 - Math.max(0, s) * 2, 40 + Math.max(0, -s) * 2]) {
      mass(p, fx, 51, 5, 2, SCL, { n: 2.6, bias: -0.12 });
      setPx(p, fx - 4, 52, 'v'); setPx(p, fx, 52, 'v'); setPx(p, fx + 4, 52, 'v');
    }
    // body and chest
    mass(p, 32, 37 + b, 12, 9.4, SCL, { n: 2.5 });
    mass(p, 32, 28 + b, 10.4, 8.4, SCL, { n: 2.4 });
    mass(p, 32, 32 + b, 6.4, 7.4, MEM, { n: 2.4, bias: 0.06 });   // pale chest plates
    for (let i = 0; i < 4; i++) for (let x = 27; x <= 37; x++) setPx(p, x, 28 + i * 3 + b, 't');
    // neck
    curve(p, [[32, 26 + b], [32, 20 + b - neck], [32 + lunge, 15 + b - neck]], 6.4, 4.6, SCL);
    // head and horns
    const hx = 32 + lunge, hy = 11 + b - neck;
    stamp(p, DR_HEAD_S, hx - 6, hy - 4);
    curve(p, [[hx - 4, hy - 3], [hx - 8, hy - 8], [hx - 12, hy - 14]], 2.4, 0.7, HORN);
    curve(p, [[hx + 4, hy - 3], [hx + 8, hy - 8], [hx + 12, hy - 14]], 2.4, 0.7, HORN, -0.08);
    curve(p, [[hx - 3, hy + 1], [hx - 6, hy + 4]], 1.6, 0.6, HORN, -0.05);
    curve(p, [[hx + 3, hy + 1], [hx + 6, hy + 4]], 1.6, 0.6, HORN, -0.1);
    setPx(p, hx - 3, hy - 1, 'x'); setPx(p, hx + 3, hy - 1, 'x');
    if (o.breath) { for (let i = 0; i < o.breath; i++) { const r = 1 + i * 0.6; for (let j = -r; j <= r; j++) setPx(p, Math.round(hx + j), hy + 5 + i, Math.abs(j) < r * 0.5 ? 'x' : 's'); } }
    // fore-claws tucked at the chest
    curve(p, [[25, 30 + b], [21, 35 + b], [24, 39 + b]], 3.4, 2.2, SCL, -0.02);
    curve(p, [[39, 30 + b], [43, 35 + b], [40, 39 + b]], 3.4, 2.2, SCL, -0.06);
    setPx(p, 23, 41 + b, 'v'); setPx(p, 25, 41 + b, 'v'); setPx(p, 39, 41 + b, 'v'); setPx(p, 41, 41 + b, 'v');
    return ink(p);
  }

  if (f === 'E') {
    dragonWing(p, 26, 25 + b, k * 0.9, -1, droop);          // far wing, behind
    curve(p, [[20, 40 + b], [10, 44 + b], [3, 38 + b]], 5, 1, SCL, -0.12);
    curve(p, [[24, 36 + b + c], [19, 44 + b + c], [22 + Math.max(0, -s) * 3, 51]], 5.6, 3.4, SCL, -0.18);
    mass(p, 28, 34 + b, 12.4, 9.4, SCL, { n: 2.5 });
    mass(p, 30, 27 + b, 10, 7.4, SCL, { n: 2.4 });
    mass(p, 32, 34 + b, 6.4, 6.4, MEM, { n: 2.4, bias: 0.05 });
    // spine ridge along the back
    for (let x = 20; x < 38; x += 2) { setPx(p, x, 26 + b - Math.round(Math.sin((x - 20) / 18 * Math.PI) * 2), 'y'); }
    curve(p, [[34, 25 + b], [40, 19 + b - neck], [45 + lunge, 15 + b - neck]], 6, 4.4, SCL);
    const hx = 47 + lunge, hy = 13 + b - neck;
    stamp(p, DR_HEAD_E, hx - 6, hy - 4);
    curve(p, [[hx - 3, hy - 3], [hx - 8, hy - 7], [hx - 13, hy - 11]], 2.3, 0.7, HORN);
    curve(p, [[hx - 2, hy + 1], [hx - 6, hy + 4]], 1.5, 0.6, HORN, -0.08);
    setPx(p, hx - 1, hy - 1, 'x');
    if (o.breath) { for (let i = 0; i < o.breath; i++) { const r = 1 + i * 0.6; for (let j = -r; j <= r; j++) setPx(p, hx + 5 + i, Math.round(hy + 3 + j), Math.abs(j) < r * 0.5 ? 'x' : 's'); } }
    curve(p, [[33, 38 + b + c], [29, 45 + b + c], [33 + Math.max(0, s) * 3, 51]], 5.8, 3.6, SCL, -0.02);
    for (const fx of [22 + Math.max(0, -s) * 3, 33 + Math.max(0, s) * 3]) { mass(p, fx, 51, 5, 2, SCL, { n: 2.6, bias: -0.12 }); setPx(p, fx + 4, 52, 'v'); setPx(p, fx, 52, 'v'); }
    curve(p, [[36, 30 + b], [41, 34 + b], [38, 39 + b]], 3.2, 2.1, SCL, 0.02);
    setPx(p, 37, 41 + b, 'v'); setPx(p, 39, 41 + b, 'v');
    dragonWing(p, 30, 24 + b, k, 1, droop);                 // near wing, over the body
    return ink(p);
  }

  // NORTH — the arch from behind: the two wings meet over a ridged spine, the tail runs at the camera
  dragonWing(p, 21, 26 + b, k, -1, droop);
  dragonWing(p, 43, 26 + b, k, 1, droop);
  curve(p, [[32, 40 + b], [31, 47 + b], [29, 53 + b]], 5, 1.4, SCL, 0.02);
  curve(p, [[25, 38 + b + c], [20, 45 + b + c], [23 - Math.max(0, s) * 2, 51]], 6, 3.6, SCL, -0.1);
  curve(p, [[39, 38 + b + c], [44, 45 + b + c], [41 + Math.max(0, -s) * 2, 51]], 6, 3.6, SCL, -0.1);
  mass(p, 32, 36 + b, 12.4, 10, SCL, { n: 2.5, bias: -0.06 });
  mass(p, 32, 27 + b, 11, 8.4, SCL, { n: 2.4, bias: -0.04 });
  for (let y = 20; y < 44; y += 3) crest(p, [[32, y + b], [32, y + 2 + b]], 3, SCL, { tip: 'y' });
  curve(p, [[32, 25 + b], [32, 19 + b - neck], [32, 14 + b - neck]], 6, 4.6, SCL, -0.04);
  mass(p, 32, 11 + b - neck, 5.6, 4.4, SCL, { n: 2.2, bias: -0.04 });
  curve(p, [[28, 9 + b - neck], [24, 4 + b - neck], [20, -1 + b - neck]], 2.4, 0.7, HORN, -0.04);
  curve(p, [[36, 9 + b - neck], [40, 4 + b - neck], [44, -1 + b - neck]], 2.4, 0.7, HORN, -0.1);
  return ink(p);
}

function dragonAnims(f) {
  const mk = (o) => dragonFrame(f, o);
  // idle: the arch breathes open and shut, the neck rides on it
  const idle = {
    frames: [mk({ wing: 0.58, bob: 0 }), mk({ wing: 0.70, bob: -1, neck: 1 }), mk({ wing: 0.78, bob: -1, neck: 1, droop: -0.06 }), mk({ wing: 0.64, bob: 0 })],
    durations: [420, 340, 380, 340], loop: true,
  };
  // a stalking prowl with a half-beat wing pump every other step
  const walk = {
    frames: [mk({ stride: 1, wing: 0.60, bob: 0 }), mk({ stride: 0.4, wing: 0.80, bob: -1, crouch: 1 }), mk({ stride: -1, wing: 0.62, bob: 0 }), mk({ stride: -0.4, wing: 0.82, bob: -1, crouch: 1 })],
    durations: [190, 170, 190, 170], loop: true,
  };
  // rear up behind the arch, then throw the neck forward and breathe
  const attack = {
    frames: [mk({ wing: 1, neck: 3, bob: -2 }), mk({ wing: 0.95, neck: 2, lunge: 2, breath: 3 }), mk({ wing: 0.5, neck: -2, lunge: 4, crouch: 1, breath: 8 }), mk({ wing: 0.6, neck: 0, crouch: 1, bob: 1 })],
    durations: [190, 100, 140, 190], loop: false,
  };
  const recoil = mk({ wing: 0.4, neck: -2, crouch: 2, bob: 2, droop: 0.2 });
  const hurt = { frames: [flash(recoil), recoil], durations: [80, 190], loop: false };
  const d0 = mk({ wing: 0.9, neck: 2, bob: -1 });
  const d1 = mk({ wing: 0.35, neck: -3, crouch: 3, bob: 2, droop: 0.35 });
  const d2 = squashTo(tilt(mk({ wing: 0.2, neck: -4, crouch: 4, bob: 3, droop: 0.5 }), 0.32, 32, 56), 0.72, DR_H - 3);
  const death = {
    frames: [d0, d1, d2, squashTo(d2, 0.6, DR_H - 3), squashTo(d2, 0.46, DR_H - 3)],
    durations: [150, 190, 220, 480, 950], loop: false,
  };
  return { idle, walk, attack, hurt, death };
}

/** Shadow dragon: 64x60, a rearing drake under a wing arch, horns making a lyre over the skull. */
export function buildDragon() {
  return { anims: clips(dragonAnims), palette: BOSS_PALETTE, w: DR_W, h: DR_H, pivot: DR_PIV, emissive: 'x', scale: 1 };
}

// ==========================================================================================
//                              DEMON  —  guardian of the Sword
// ==========================================================================================
// It is not fought: it walks up, takes something that cannot be bought back, and is gone. So it is
// drawn STILL — broad, symmetrical, almost heraldic — and only the ring of stolen soul-light above
// its open palm and the furnace in its chest ever move quickly.
//
// WHAT WAS WRONG WITH THE OLD ONE, and what each fix is:
//  · IT READ AS A PINK MAN IN A WIG. The hide was a mid crimson ('#7c2434') on a four-step ramp,
//    which is two steps from the warm brick it stands on; the torso came out as two or three flat
//    rose patches. It is now SIX steps of a colder, darker wine, and the body is painted in the
//    bottom half of them so the lit plane has somewhere to go.
//  · THE KEY LIGHT RAN BACKWARDS. Each mass was shaded against its own centre, so the ball of the
//    top-LEFT shoulder turned away from the light and became the darkest thing on the creature.
//    Every form here is now biased by `gl()` — ONE plane across the whole figure, brighter up and
//    to the left — on top of its own terminator, so the lit shoulder is the lit shoulder.
//  · THE HORNS WERE HAIR. Chalk-white keratin ('#a99a86' at the top of its ramp) arching over the
//    skull with nothing between the two. They are now BLACK horn, ridged with growth rings, and
//    `gapBlit` eats a one-pixel hole out of the head where they cross it so the outline pass lays
//    real ink between horn and skull.
//  · THE CHEST HAD MEASLES. Isolated amber pixels ringed in black, scattered over the sternum. All
//    of it is now ONE furnace: a single fissure down the breastbone opening into a cavity, with
//    continuous char cracks running off it along the ribs and the light spilling DOWN the belly.
const DE_SW = 60, DE_SH = 72;                       // the scratch the BODY is written in
const DE_DX = 13, DE_DY = 3, DE_W = DE_SW + 26, DE_H = DE_SH + 5;
const DE_PIV = { x: 30 + DE_DX, y: 72 + DE_DY };
const SKIN = 'ABCDOP', KERA = 'GHIQ', WING = 'JKL';
const TOOTH = 'V';
/** The sole row: fills stop here so the ink lands on DE_SH - 1 and the contact shadow under it. */
const DE_SOLE = 70;

/**
 * Seat a pose in its cell. THE WINGS ARE DRAWN IN CELL SPACE, not in the body's scratch: a wing
 * snapped fully open reaches thirty pixels out from the shoulder, which is off the side of any
 * canvas the body needs, and a membrane cut flat by the edge of its own atlas cell is the one thing
 * `outline()` can never fix. So the body is painted in a tight 60-wide scratch, the wings on the
 * full 86-wide cell behind (and, in profile, one in front), and the three are composited here.
 * @param {Pix|null} back the wings behind @param {Pix} body @param {Pix|null} front
 */
function deSeat(back, body, front) {
  const cell = makePix(DE_W, DE_H);
  if (back) blit(cell, back, 0, 0);
  blit(cell, body, DE_DX, DE_DY);
  if (front) blit(cell, front, 0, 0);
  rimLight(cell, SKIN);
  return ink(cell);
}

/**
 * THE LIGHT PLANE, as one number. `tone()` gives each mass its own terminator, which is right for
 * a form and useless for a figure: fifteen masses each lit about their own centre is fifteen little
 * lights. `gl(x, y)` is how far UP THE RAMP a form sitting at (x, y) starts — brighter toward the
 * top-left corner of the figure, darker toward the bottom-right — and every mass, limb and curve in
 * this section is offset by it. That is the whole difference between a lit figure and a sticker.
 */
const DE_TB = -0.20;
const gl = (x, y) => DE_TB + 0.09 * ((30 - x) / 26) + 0.15 * ((38 - y) / 38);
const DM = (p, cx, cy, rx, ry, keys, o = {}) => mass(p, cx, cy, rx, ry, keys, { ...o, bias: (o.bias || 0) + gl(cx, cy) });
const DC = (p, pts, r0, r1, keys, bias = 0) => {
  let sx = 0, sy = 0;
  for (const q of pts) { sx += q[0]; sy += q[1]; }
  return curve(p, pts, r0, r1, keys, bias + gl(sx / pts.length, sy / pts.length));
};
const DL = (p, x0, y0, x1, y1, r0, r1, keys, bias = 0) =>
  limb(p, x0, y0, x1, y1, r0, r1, keys, bias + gl((x0 + x1) / 2, (y0 + y1) / 2));

/**
 * Lay `q` over `p` with a one-pixel NEGATIVE GAP bitten out of whatever it lands on, so the ink
 * pass puts a real black line between the two forms instead of letting them fuse into one blob.
 * This is what separates a horn from a skull, and a skull from the shoulder behind it.
 */
function gapBlit(p, q, r = 1) {
  for (let y = 0; y < q.h; y++) for (let x = 0; x < q.w; x++) {
    if (!q.d[y * q.w + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) setPx(p, x + dx, y + dy, 0);
  }
  return blit(p, q, 0, 0);
}

/** Growth rings across a horn: short dark bands square to the horn's run, every `every` pixels. */
function ridges(p, pts, key, every = 3) {
  let n = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const len = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay)));
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    for (let s = 0; s < len; s++, n++) {
      if (n % every) continue;
      const cx = ax + ux * s, cy = ay + uy * s;
      const h = 3.4 * (1 - 0.62 * (i / Math.max(1, pts.length - 1)));
      for (let k = -h; k <= h; k += 0.5) {
        const px = Math.round(cx - uy * k), py = Math.round(cy + ux * k);
        if (getPx(p, px, py)) setPx(p, px, py, key);
      }
    }
  }
}

/**
 * THE KEY-LIGHT RIM. `tone()` lights each form against its own terminator, which gets the modelling
 * right and still leaves the FIGURE without a single edge that says where the light is. This lays
 * the top two steps of the hide along the outer silhouette that faces `LIT`: the brightest step on
 * the corners open both up AND left, one step of lift on the edges open one way. The two-deep test
 * is what keeps it on the outside of the creature — a one-pixel ink gap between a horn and a skull
 * is open on one side only, so it never picks up a rim and never turns into piping.
 * @param {Pix} p @param {string} keys the hide ramp, darkest first
 */
function rimLight(p, keys) {
  const idx = new Map([...keys].map((c, i) => [c.charCodeAt(0), i]));
  const snap = new Uint16Array(p.d);
  const at = (x, y) => (x < 0 || y < 0 || x >= p.w || y >= p.h ? 0 : snap[y * p.w + x]);
  const top = keys[keys.length - 1], second = keys[keys.length - 2];
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const i = idx.get(snap[y * p.w + x]);
    if (i === undefined) continue;
    const up = !at(x, y - 1) && !at(x, y - 2), lf = !at(x - 1, y) && !at(x - 2, y);
    if ((up && lf) || ((up || lf) && i >= 1)) setPx(p, x, y, top);
    else if (up || lf) setPx(p, x, y, second);
  }
  return p;
}

/** One pixel of light down the up-left face of whatever `keys` covers (the horn's polished ridge). */
function litRidge(p, keys, key) {
  const set = new Set([...keys].map((c) => c.charCodeAt(0)));
  const snap = new Uint16Array(p.d);
  const at = (x, y) => (x < 0 || y < 0 || x >= p.w || y >= p.h ? 0 : snap[y * p.w + x]);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (!set.has(snap[y * p.w + x])) continue;
    if (!at(x - 1, y) || !at(x, y - 1)) setPx(p, x, y, key);
  }
}

/**
 * A RAM HORN. Out of the temple, out and up, then curling forward and down past the cheek — with
 * daylight inside the curl, growth rings across it and a lit ridge along its top-left. It is drawn
 * into its own scratch and laid down with `gapBlit`, so there is always ink between it and the head.
 * @param {Pix} p @param {number} x @param {number} y the temple @param {number} dir
 * @param {number} k 0 = swept back along the skull, 1 = full curl
 * @param {number} [arc] how much of the curl to draw — 6 is the full ram spiral (right from the
 *   front, a loop with daylight in it); 5 stops before the spiral closes, which is what a horn in
 *   PROFILE needs, since a closed curl there comes back over the creature's own jaw.
 */
function demonHorn(p, x, y, dir, k = 1, arc = 6) {
  const q = makePix(p.w, p.h);
  const pts = [
    [x, y],
    [x + dir * (4 + 1.5 * k), y - 3.5 - k],
    [x + dir * (8.5 + 2 * k), y - 3],
    [x + dir * (10.5 + 2.5 * k), y + 2],
    [x + dir * (8 + 2 * k), y + 7],
    [x + dir * (4 + 1.5 * k), y + 9],
  ];
  const use = pts.slice(0, arc);
  curve(q, use, 3.1, 0.9, KERA, gl(x, y) - 0.34);
  ridges(q, use, KERA[0], 3);
  litRidge(q, KERA, KERA[3]);
  return gapBlit(p, q);
}

/**
 * THE FURNACE. One fissure down the breastbone opening into a cavity, char cracks running off it
 * along the ribs, and the light spilling down the belly — instead of the old scatter of isolated
 * amber studs ringed in black, which at gameplay distance read as measles.
 */
function furnace(p, cx, cy, glow) {
  const crack = (x0, y0, x1, y1) => {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = Math.round(lerp(x0, x1, t)), y = Math.round(lerp(y0, y1, t));
      // a crack is hot where it is nearest the furnace and char where it has cooled — which is
      // what makes it read as a SPLIT IN A SHELL rather than as a scratch drawn on top of one
      if (getPx(p, x, y)) setPx(p, x, y, t < 0.42 && glow > 0.45 ? 'S' : 'N');
    }
  };
  crack(cx, cy - 9, cx, cy + 9);                                  // the breastbone fissure
  for (const [dx, dy] of [[-8, -5], [8, -5], [-9, 1], [9, 1], [-7, 7], [7, 7]]) crack(cx, cy + dy * 0.35, cx + dx, cy + dy);
  // the cavity: one contiguous glow, hottest up-left of centre because the light plane says so
  // the cavity is a FISSURE — widest at the sternum, ragged down both edges, one hot column at its
  // centre. A clean ellipse of amber here reads as a lantern hung on the creature's chest.
  for (let dy = -7; dy <= 7; dy++) {
    const hw = 3.4 - Math.abs(dy) * 0.44 + ((dy + 9) % 3) * 0.35;
    if (hw <= 0.4) continue;
    for (let dx = -Math.round(hw); dx <= Math.round(hw); dx++) {
      if (!getPx(p, cx + dx, cy + dy)) continue;
      const t = Math.abs(dx) / hw;
      setPx(p, cx + dx, cy + dy, t < 0.36 && glow > 0.25 ? 'M' : t < 0.78 ? 'S' : 'N');
    }
  }
  // the spill: firelight running DOWN the belly out of the open chest, dimming as it goes
  const drop = Math.round(3 + glow * 4);
  for (let y = cy + 7; y < cy + 7 + drop; y++) for (let x = cx - 2; x <= cx + 2; x++) {
    if (!getPx(p, x, y)) continue;
    const t = (y - cy - 7) / drop;
    if (Math.abs(x - cx) <= 1.6 - t) setPx(p, x, y, t < 0.4 && glow > 0.5 ? 'S' : 'N');
  }
}

/** The ring of stolen soul-light: a hot rim round a hole, hovering over an upturned palm. */
function soulRing(p, cx, cy, r, phase) {
  const ry = Math.max(2.4, r * 0.86);
  for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) for (let x = -Math.ceil(r); x <= Math.ceil(r); x++) {
    const q = (x * x) / (r * r) + (y * y) / (ry * ry);
    if (q > 1) continue;
    setPx(p, Math.round(cx + x), Math.round(cy + y), q > 0.40 ? (y < 0.5 ? 'M' : 'S') : 'N');
  }
  const sa = phase * 2.4;
  setPx(p, Math.round(cx + Math.cos(sa) * r), Math.round(cy + Math.sin(sa) * ry), 'W');
}

/**
 * The demon's wing. At rest (k ~ 0.1) it is FOLDED: a narrow tattered blade hanging down the back
 * with the wrist spur hooked above the shoulder — nothing like the dragon's arch. Snapping it open
 * (k -> 1) throws the same membrane up and out. It is plum-BLACK, darker than the hide it hangs
 * behind, so the figure reads in front of its own wings instead of inside a pair of pale epaulets.
 */
function demonWing(p, cx, cy, k, dir) {
  const fingers = [
    { a: lerp(0.80, -1.52, k), r: lerp(34, 36, k) },
    { a: lerp(1.02, -1.00, k), r: lerp(31, 39, k) },
    { a: lerp(1.24, -0.34, k), r: lerp(26, 34, k) },
    { a: lerp(1.42, 0.24, k), r: lerp(19, 26, k) },
    { a: lerp(1.57, 0.78, k), r: lerp(12, 17, k) },
  ];
  wingFan(p, cx, cy, fingers, dir, WING + 'H', { scallop: 2.4, tatter: 1.8 });
  const sx = cx + (4 + 2.5 * (1 - k)) * dir, sy = cy - (5 + 3 * (1 - k));
  limb(p, cx, cy, sx, sy, 2.2, 1, WING, -0.02);
  setPx(p, Math.round(sx), Math.round(sy), 'I'); setPx(p, Math.round(sx + dir), Math.round(sy - 1), 'Q');
}

/**
 * A CLOVEN HOOF, PLANTED — black keratin, not the cream ellipse the demon used to stand on. The
 * leg pinches into a pastern, the wall flares out under it, an ink cleft splits it into two toes
 * all the way to the floor, the last row is the sole, and a dew-claw hooks off the back.
 * @param {number} y THE SOLE ROW (the ink pass lays the weight shadow on y + 1)
 */
function hoof(p, cx, y, bias = 0) {
  const [d, m, l, r] = [...KERA];
  DM(p, cx, y - 9, 3.0, 3.4, SKIN, { n: 2.4, bias: bias - 0.14 });               // the pastern
  for (let i = 0; i < 6; i++) {
    const w = 2.4 + i * 0.44;
    for (let x = -Math.round(w); x <= Math.round(w); x++) setPx(p, cx + x, y - 5 + i, x <= -w + 1 ? l : x <= 0 ? m : d);
  }
  for (let i = 0; i < 5; i++) setPx(p, cx + 1, y - 4 + i, '#');                  // THE CLEFT
  for (let x = -4; x <= 4; x++) if (x !== 1) setPx(p, cx + x, y, d);             // the sole
  setPx(p, cx - 5, y - 3, m); setPx(p, cx - 5, y - 2, d);                        // the dew-claw
  setPx(p, cx - 3, y - 5, r); setPx(p, cx - 2, y - 5, r);                        // the polished ridge
}

/**
 * A digitigrade leg, drawn into its own scratch so the caller can `gapBlit` it and get real ink
 * between the two of them: haunch, the hock standing BEHIND it, a long cannon, pastern, hoof.
 * The old demon's legs were two 5-px capsules hidden under an overhanging gut — from the waist
 * down it was one blob with hooves at the bottom. These are 28 of the figure's 68 rows.
 */
function demonLeg(p, hx, hy, dir, lift, bias = 0) {
  const q = makePix(p.w, p.h);
  const sole = DE_SOLE - lift;
  DM(q, hx, hy, 5.0, 7.8, SKIN, { n: 2.5, bias: bias + 0.02 });                  // the haunch
  DM(q, hx - dir * 3.2, hy + 9, 2.8, 3.2, SKIN, { n: 2.2, bias: bias - 0.24 });  // the hock, behind
  DL(q, hx, hy + 5, hx + dir * 0.6, hy + 12, 4.0, 2.7, SKIN, bias - 0.06);       // the shank
  DL(q, hx + dir * 0.6, hy + 11, hx + dir * 1, sole - 8, 2.5, 2.1, SKIN, bias - 0.10);   // the cannon
  hoof(q, hx + dir * 1, sole, bias);
  return gapBlit(p, q);
}

/** Three claws and a thumb: a hand that could take something off you. */
function demonHand(p, x, y, dir, open = false) {
  DM(p, x, y, 3.2, 2.6, SKIN, { n: 2.4, bias: open ? 0.04 : -0.06 });
  for (let i = -1; i <= 1; i++) {
    const fx = x + i * 2, fy = y + (open ? -2 : 3);
    setPx(p, fx, fy, 'B'); setPx(p, fx, fy + (open ? -1 : 1), 'H'); setPx(p, fx, fy + (open ? -2 : 2), 'Q');
  }
  setPx(p, x - dir * 4, y, 'H'); setPx(p, x - dir * 4, y + 1, 'Q');
}

/**
 * The face: a jutting brow with the eye pits in its shadow, no nose, and a lipless grin that runs
 * the full width of the skull. The embers are the only warm thing above the chest.
 */
function demonFace(p, cx, hy, glow, { half = false, dir = 1, w = 6 } = {}) {
  const eyes = half ? [cx - dir * 2] : [cx - 5, cx + 2];
  // TWO ROWS of brow shadow, not one: an eye only looks sunk when something overhangs it
  for (let x = cx - 8; x <= cx + 8; x++) for (let y = -2; y <= -1; y++) {
    if (getPx(p, x, hy + y)) setPx(p, x, hy + y, y === -2 ? 'A' : 'N');
  }
  // the eyes are 2x2 EMBERS in a 4x4 pit, because one lit pixel is not a face at any distance
  for (const ex of eyes) {
    for (let x = -1; x <= 2; x++) for (let y = -1; y <= 2; y++) if (getPx(p, ex + x, hy + y)) setPx(p, ex + x, hy + y, 'N');
    for (let x = 0; x <= 1; x++) for (let y = 0; y <= 1; y++) {
      if (getPx(p, ex + x, hy + y)) setPx(p, ex + x, hy + y, glow > 0.3 && y === 0 ? 'M' : 'S');
    }
  }
  // the nasal ridge between them, and the cheek hollows that narrow the skull toward the jaw
  if (!half) for (let y = -1; y <= 2; y++) if (getPx(p, cx - 1, hy + y)) setPx(p, cx - 1, hy + y, 'C');
  for (const sx of [cx - 7, cx + 6]) for (let y = 2; y <= 3; y++) if (getPx(p, sx, hy + y)) setPx(p, sx, hy + y, 'A');
  // THE MAW: a two-row ink slot the width of the skull with fangs standing in it. A full grid of
  // even teeth at this size reads as a zip fastener; four interlocking fangs read as a mouth.
  const my = hy + 5;
  for (let x = cx - w; x <= cx + w; x++) for (let y = 0; y <= 1; y++) if (getPx(p, x, my + y)) setPx(p, x, my + y, '#');
  for (let fx = cx - w + 1; fx <= cx + w - 1; fx += 3) if (getPx(p, fx, my)) setPx(p, fx, my, TOOTH);
  for (let fx = cx - w + 2; fx <= cx + w - 1; fx += 3) if (getPx(p, fx, my + 1)) setPx(p, fx, my + 1, 'Q');
}

/**
 * One demon frame.
 * @param {'S'|'E'|'N'} f
 * @param {{bob?:number, wing?:number, stride?:number, ring?:number, glow?:number, crouch?:number, reach?:number}} o
 */
function demonFrame(f, o = {}) {
  const p = makePix(DE_SW, DE_SH);                       // the BODY, in its own tight scratch
  const back = makePix(DE_W, DE_H), front = makePix(DE_W, DE_H);   // the WINGS, in cell space
  const WX = DE_DX, WY = DE_DY;                          // body coords -> cell coords
  const b = o.bob || 0, k = o.wing ?? 0.12, s = o.stride || 0, c = o.crouch || 0;
  const glow = o.glow ?? 0.5, reach = o.reach || 0;
  const lLift = Math.max(0, s) * 3, rLift = Math.max(0, -s) * 3;

  if (f === 'S') {
    const hy = 12 + b;                                                            // the head centre
    demonWing(back, 15 + WX, 28 + b + WY, k, -1);
    demonWing(back, 45 + WX, 28 + b + WY, k, 1);
    // the torso is ONE TAPER, shoulder to waist — the old two stacked ellipses made a pear
    DL(p, 30, 26 + b, 30, 43 + b, 12.6, 6.4, SKIN, 0.02);
    DM(p, 23, 31 + b, 6.2, 4.6, SKIN, { n: 2.4, bias: 0.05 });                    // pectoral, lit
    DM(p, 37, 31 + b, 6.2, 4.6, SKIN, { n: 2.4, bias: -0.10 });                   // pectoral, shadow
    DM(p, 30, 44 + b, 6.4, 5.0, SKIN, { n: 2.6, bias: -0.08 });                   // the hard belly
    DM(p, 30, 48 + b + c, 7.6, 4.2, SKIN, { n: 2.8, bias: -0.14 });               // the pelvis
    DM(p, 16, 27 + b, 5.6, 4.8, SKIN, { n: 2.4, bias: 0.02 });                    // deltoid, lit
    DM(p, 44, 27 + b, 5.6, 4.8, SKIN, { n: 2.2, bias: -0.12 });                   // deltoid, shadow
    furnace(p, 30, 33 + b, glow);
    // THE LEGS COME DOWN THROUGH THE PELVIS, not out from under it: drawn over it and gap-bitten,
    // so the hip joint is an ink line and the player can count two legs from across the room
    demonLeg(p, 24, 50 + b + c, -1, lLift, -0.02);
    demonLeg(p, 36, 50 + b + c, 1, rLift, -0.14);
    { const q = makePix(DE_SW, DE_SH);                                            // the loin drape
      DC(q, [[30, 45 + b + c], [30, 52 + b + c], [30, 58 + b + c]], 4.6, 0.9, WING, -0.10);
      gapBlit(p, q); }
    // the arms hang past the hip: nothing about this build is a man's
    { const q = makePix(DE_SW, DE_SH);
      DC(q, [[16, 29 + b], [10, 40 + b], [13, 50 + b]], 3.3, 2.1, SKIN, -0.02);
      demonHand(q, 13, 53 + b, -1);
      gapBlit(p, q); }
    { const q = makePix(DE_SW, DE_SH);
      DC(q, [[44, 29 + b], [50, 38 + b - reach], [46, 45 + b - reach]], 3.3, 2.1, SKIN, -0.12);
      demonHand(q, 46, 47 + b - reach, 1, true);
      gapBlit(p, q); }
    // the neck, then the head laid down with ink between it and the shoulders behind it
    DL(p, 30, 17 + b, 30, 26 + b, 3.6, 5.4, SKIN, -0.18);
    { const q = makePix(DE_SW, DE_SH);
      DM(q, 30, hy, 7.8, 7.0, SKIN, { n: 2.9, bias: -0.02 });                     // the skull
      DM(q, 30, hy + 6, 5.6, 4.0, SKIN, { n: 2.6, bias: -0.12 });                 // the jaw
      DM(q, 30, hy - 5, 7.4, 2.0, SKIN, { n: 3.4, bias: 0.03 });                  // the brow shelf
      demonFace(q, 30, hy, glow, { w: 7 });
      gapBlit(p, q); }
    demonHorn(p, 23, hy - 3, -1);
    demonHorn(p, 37, hy - 3, 1);
    if (glow > 0.15) soulRing(p, 49, 37 + b - reach, 2.8 + glow * 1.1, o.ring || 0);
    return deSeat(back, p, front);
  }

  if (f === 'E') {
    // PROFILE, facing right. Both wings hang off the BACK, one behind the body and one across it.
    const hy = 12 + b;
    demonWing(back, 26 + WX, 28 + b + WY, k, -1);
    demonWing(back, 23 + WX, 31 + b + WY, k * 0.75, -1);
    demonLeg(p, 27, 50 + b + c, -1, rLift, -0.24);                                // the far leg
    DL(p, 28, 26 + b, 31, 43 + b, 10.6, 6.4, SKIN, 0.0);                          // the torso, in profile
    DM(p, 35, 31 + b, 6.0, 5.4, SKIN, { n: 2.4, bias: -0.06 });                   // the chest, forward
    DM(p, 25, 29 + b, 5.8, 5.4, SKIN, { n: 2.4, bias: -0.06 });                   // the back
    DM(p, 32, 44 + b, 5.8, 4.8, SKIN, { n: 2.6, bias: -0.08 });                   // the belly
    DM(p, 30, 48 + b + c, 6.8, 4.2, SKIN, { n: 2.8, bias: -0.12 });               // the pelvis
    furnace(p, 36, 32 + b, glow);
    demonLeg(p, 33, 50 + b + c, 1, lLift, -0.04);                                 // the near leg
    { const q = makePix(DE_SW, DE_SH);
      DC(q, [[30, 45 + b + c], [30, 52 + b + c], [30, 58 + b + c]], 4.4, 0.9, WING, -0.12);
      gapBlit(p, q); }
    { const q = makePix(DE_SW, DE_SH);                                            // the far arm
      DC(q, [[27, 29 + b], [22, 40 + b], [25, 50 + b]], 3.0, 1.9, SKIN, -0.16);
      demonHand(q, 25, 53 + b, -1);
      gapBlit(p, q); }
    DL(p, 33, 17 + b, 30, 26 + b, 3.8, 5.4, SKIN, -0.16);                         // the neck
    demonHorn(p, 31, hy - 4, -1, 0.6, 5);                                         // the far horn
    { const q = makePix(DE_SW, DE_SH);
      DM(q, 33, hy, 7.0, 6.8, SKIN, { n: 2.9, bias: -0.02 });                     // the skull
      DM(q, 39, hy + 3, 4.8, 3.4, SKIN, { n: 2.6, bias: -0.10 });                 // the muzzle, forward
      DM(q, 33, hy - 5, 6.6, 2.0, SKIN, { n: 3.4, bias: 0.03 });                  // the brow shelf
      demonFace(q, 36, hy, glow, { half: true, dir: 1, w: 4 });
      gapBlit(p, q); }
    demonHorn(p, 33, hy - 3, -1, 1, 5);                                           // the near horn
    { const q = makePix(DE_SW, DE_SH);                                            // the near arm
      DC(q, [[35, 29 + b], [41, 38 + b - reach], [37, 45 + b - reach]], 3.2, 2.0, SKIN, -0.02);
      demonHand(q, 37, 47 + b - reach, 1, true);
      gapBlit(p, q); }
    if (glow > 0.15) soulRing(p, 40, 37 + b - reach, 2.8 + glow * 1.0, o.ring || 0);
    return deSeat(back, p, front);
  }

  // NORTH — the back: the furled wings hang like a cloak over a ridged spine, and the horns show
  // as two curls standing out past a skull that has no face on this side at all.
  const hy = 12 + b;
  demonWing(back, 15 + WX, 28 + b + WY, Math.max(0.2, k), -1);
  demonWing(back, 45 + WX, 28 + b + WY, Math.max(0.2, k), 1);
  DL(p, 30, 26 + b, 30, 43 + b, 12.6, 6.4, SKIN, -0.04);
  DM(p, 30, 44 + b, 6.4, 5.0, SKIN, { n: 2.6, bias: -0.12 });
  DM(p, 30, 48 + b + c, 7.6, 4.2, SKIN, { n: 2.8, bias: -0.16 });
  DM(p, 16, 27 + b, 5.6, 4.8, SKIN, { n: 2.4, bias: -0.02 });
  DM(p, 44, 27 + b, 5.6, 4.8, SKIN, { n: 2.2, bias: -0.16 });
  // the spine: a run of short ridges, each lit on its own top-left, down the middle of the back
  for (let y = 24; y < 48; y += 3) {
    if (!getPx(p, 30, y + b)) continue;
    setPx(p, 29, y + b, 'N'); setPx(p, 30, y + b, 'D'); setPx(p, 31, y + b, 'B');
    setPx(p, 30, y + 1 + b, 'N');
  }
  demonLeg(p, 24, 50 + b + c, -1, lLift, -0.10);
  demonLeg(p, 36, 50 + b + c, 1, rLift, -0.20);
  { const q = makePix(DE_SW, DE_SH);
    DC(q, [[30, 45 + b + c], [30, 52 + b + c], [30, 58 + b + c]], 4.6, 0.9, WING, -0.14);
    gapBlit(p, q); }
  { const q = makePix(DE_SW, DE_SH);
    DC(q, [[16, 29 + b], [10, 40 + b], [13, 50 + b]], 3.3, 2.1, SKIN, -0.08);
    demonHand(q, 13, 53 + b, -1);
    gapBlit(p, q); }
  { const q = makePix(DE_SW, DE_SH);
    DC(q, [[44, 29 + b], [50, 40 + b], [47, 50 + b]], 3.3, 2.1, SKIN, -0.18);
    demonHand(q, 47, 53 + b, 1);
    gapBlit(p, q); }
  DL(p, 30, 17 + b, 30, 26 + b, 3.8, 5.4, SKIN, -0.20);
  { const q = makePix(DE_SW, DE_SH);
    DM(q, 30, hy + 1, 7.6, 6.8, SKIN, { n: 2.9, bias: -0.10 });
    gapBlit(p, q); }
  demonHorn(p, 24, hy - 2, -1);
  demonHorn(p, 36, hy - 2, 1);
  return deSeat(back, p, front);
}

function demonAnims(f) {
  const mk = (o) => demonFrame(f, o);
  // idle: it does not fidget. The wings settle a pixel, the ring turns, the furnace breathes.
  const idle = {
    frames: [mk({ glow: 0.45, ring: 0, wing: 0.22 }), mk({ bob: -1, glow: 0.8, ring: 0.4, wing: 0.3 }), mk({ bob: -1, glow: 1, ring: 0.8, wing: 0.34 }), mk({ glow: 0.6, ring: 1.2, wing: 0.26 })],
    durations: [420, 360, 400, 360], loop: true,
  };
  const walk = {
    frames: [mk({ stride: 1, glow: 0.5, ring: 0, wing: 0.2 }), mk({ stride: 0.4, bob: -1, crouch: 1, glow: 0.7, ring: 0.5, wing: 0.3 }), mk({ stride: -1, glow: 0.5, ring: 1, wing: 0.2 }), mk({ stride: -0.4, bob: -1, crouch: 1, glow: 0.7, ring: 1.5, wing: 0.3 })],
    durations: [200, 180, 200, 180], loop: true,
  };
  // the drain: wings snap open, the palm comes up, the ring flares and goes out
  const attack = {
    frames: [mk({ wing: 0.45, glow: 0.7, ring: 0, reach: 1 }), mk({ wing: 0.95, glow: 1, ring: 0.6, reach: 4, bob: -1 }), mk({ wing: 1, glow: 1, ring: 1.1, reach: 5, bob: -1 }), mk({ wing: 0.5, glow: 0.2, ring: 1.6, reach: 1 })],
    durations: [200, 130, 150, 210], loop: false,
  };
  const recoil = mk({ wing: 0.3, crouch: 2, bob: 2, glow: 0.2 });
  const hurt = { frames: [flash(recoil), recoil], durations: [80, 190], loop: false };
  const d0 = mk({ wing: 0.6, glow: 0.9, bob: -1 });
  const d1 = mk({ wing: 0.15, glow: 0.35, crouch: 3, bob: 2 });
  const d2 = squashTo(tilt(mk({ wing: 0.05, glow: 0.15, crouch: 4, bob: 3 }), 0.3, 30, DE_SOLE), 0.72, DE_H - 4);
  const death = {
    frames: [d0, d1, d2, squashTo(d2, 0.58, DE_H - 4), squashTo(d2, 0.42, DE_H - 4)],
    durations: [140, 180, 210, 460, 900], loop: false,
  };
  return { idle, walk, attack, hurt, death };
}

/** Demon: a 70x77 cell around a 60x72 pose — the still, horned guardian with the ring of stolen light. */
export function buildDemon() {
  return { anims: clips(demonAnims), palette: BOSS_PALETTE, w: DE_W, h: DE_H, pivot: DE_PIV, emissive: 'MSx', scale: 1 };
}

// ------------------------------------------------------------------------------------ registry
const cache = new Map();
const build = (key, make) => () => {
  let b = cache.get(key);
  if (!b) { b = make(); cache.set(key, b); }
  return b;
};

/**
 * The heavies of the deep: monster type -> builder. `ogre`, `fyre-drake`, `shadow-dragon`, `wyvern`
 * and `demon` are the types the game actually rolls (game/monsters.js); the rest are aliases so any
 * bestiary that names them picks up the sprite instead of a mesh.
 * @type {Object<string, () => {anims:object, palette:import('../pixelPainter.js').Palette, w:number, h:number, pivot:{x:number,y:number}, emissive:string, scale:number}>}
 */
export const BOSS_SPRITES = {
  'ogre': build('ogre', buildOgre),
  'demon': build('demon', buildDemon),
  'demon-guardian': build('demon', buildDemon),
  // `wyvern`, `shadow-dragon` and `fyre-drake` USED to live here, and between the three of them they
  // had two drawings: buildDragon twice and one salamander. They are now three separate creatures in
  // monsters/drakes.js. buildSalamander and buildDragon stay as the aliases below — nothing the
  // generator rolls reaches them, so no MONSTER_TABLE type shares a silhouette with another.
  'salamander': build('salamander', buildSalamander),
  'fire-lizard': build('salamander', buildSalamander),
  'dragon': build('dragon', buildDragon),
};

export { mass, limb, curve, crest, wingFan, tone, clips, flash, squashTo, tilt };

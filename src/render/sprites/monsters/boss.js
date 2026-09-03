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
//  demon       broad-shouldered and still: a crown of curling ram horns, wings folded down the
//              back into two hanging blades, cloven hooves, char cracks over an ember heart, and
//              the signature — the ring of stolen soul-light hanging above its open palm.
import { Palette, paint, outline, makePix, setPx, getPx, shift, smearArc, mirrorLit, blit } from '../pixelPainter.js';
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
  // demon — deep crimson hide, ash keratin, black-plum wing, ember
  .ramp('ABCD', '#7c2434')
  .ramp('GHI', '#a99a86', { pick: [2, 4, 6] })
  .ramp('JKL', '#452b4d')
  .set('M', '#ffbf4d').set('N', '#2a0f18')                    // ember light / char crack
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
  const put = (name, f, a) => { (anims[name] ||= {})[f] = { name, facing: f, ...a }; };
  for (const f of ['S', 'E', 'N']) for (const [name, a] of Object.entries(make(f))) put(name, f, a);
  for (const name of Object.keys(anims)) {
    const e = anims[name].E;
    if (e) anims[name].W = { ...e, facing: 'W', frames: e.frames.map((p) => mirrorLit(p, '')) };
  }
  return anims;
}

// ------------------------------------------------------------------------------- form shading
// The one key light, as a unit vector in sprite space (x right, y down, z out of the screen).
const LX = -0.60, LY = -0.64, LZ = 0.48;

/**
 * The ramp key for a surface whose normal is (nx, ny, nz=sqrt(1-nx²-ny²)) — a real directional
 * terminator quantised onto `keys` (darkest first). `bias` pushes a whole form up or down the ramp
 * (far limbs sit a tone back; a lit belly sits a tone forward).
 */
function tone(nx, ny, keys, bias = 0) {
  const r2 = Math.min(1, nx * nx + ny * ny);
  const lam = nx * LX + ny * LY + Math.sqrt(1 - r2) * LZ;
  let t = lam * 0.78 + 0.34 + bias;
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
function ogreFrame(f, o = {}) {
  const p = makePix(OG_W, OG_H);
  const done = (q) => ink(shift(q, OG_PAD, 0));
  const b = o.bob || 0, s = o.stride || 0, c = o.crouch || 0, lean = o.lean || 0;
  const lLift = Math.max(0, s) * 3, rLift = Math.max(0, -s) * 3;
  const club = o.club ?? 0;   // 0 shouldered · 1 raised behind · 2 smashed down-forward

  if (f === 'S') {
    // legs: short, bowed, planted wide
    limb(p, 18, 38 + b + c, 17 - Math.max(0, s) * 1.5, 51 - lLift, 5.6, 4.6, HIDE, -0.05);
    limb(p, 30, 38 + b + c, 32 + Math.max(0, -s) * 1.5, 51 - rLift, 5.6, 4.6, HIDE, -0.05);
    mass(p, 16, 51 - lLift, 5, 2.2, HIDE, { n: 2.6, bias: -0.12 });
    mass(p, 33, 51 - rLift, 5, 2.2, HIDE, { n: 2.6, bias: -0.12 });
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
    limb(p, 20, 38 + b + c, 18 + Math.max(0, -s) * 4, 51 - rLift, 5.2, 4.2, HIDE, -0.16);
    mass(p, 18 + Math.max(0, -s) * 4, 51 - rLift, 5, 2.2, HIDE, { n: 2.6, bias: -0.2 });
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
    limb(p, 27, 38 + b + c, 29 + Math.max(0, s) * 4, 51 - lLift, 5.4, 4.4, HIDE, 0);
    mass(p, 30 + Math.max(0, s) * 4, 51 - lLift, 5, 2.2, HIDE, { n: 2.6, bias: -0.1 });
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
  limb(p, 18, 38 + b + c, 17 - Math.max(0, s) * 1.5, 51 - lLift, 5.6, 4.6, HIDE, -0.08);
  limb(p, 30, 38 + b + c, 32 + Math.max(0, -s) * 1.5, 51 - rLift, 5.6, 4.6, HIDE, -0.08);
  mass(p, 16, 51 - lLift, 5, 2.2, HIDE, { n: 2.6, bias: -0.14 });
  mass(p, 33, 51 - rLift, 5, 2.2, HIDE, { n: 2.6, bias: -0.14 });
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
// its open palm and the embers in its chest ever move quickly.
// drawn in a 48-wide frame and shifted right by DE_PAD, so the wings never clip the canvas edge
const DE_W = 56, DE_H = 56, DE_PAD = 4, DE_PIV = { x: 28, y: 54 };
const SKIN = 'ABCD', KERA = 'GHI', WING = 'JKL';

// a long narrow face: no nose, a slot mouth of even teeth, embers where the eyes should be
const DE_FACE_S = paint(`
..DDDDDD..
.NMM##MMN.
..N#..#N..
...N..N...
..GGGGGG..
..NGGGGN..
...NNNN...`);

/** The ring of stolen soul-light hovering over an open palm. */
function soulRing(p, cx, cy, r, phase) {
  for (let a = 0; a < Math.PI * 2; a += 0.12) {
    setPx(p, Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.5), 'M');
  }
  for (let a = 0; a < Math.PI * 2; a += 0.2) {
    setPx(p, Math.round(cx + Math.cos(a) * (r - 2)), Math.round(cy + Math.sin(a) * (r - 2) * 0.5), 'N');
  }
  const sa = phase * 2.4;                       // one spark running round the rim
  setPx(p, Math.round(cx + Math.cos(sa) * r), Math.round(cy + Math.sin(sa) * r * 0.5), 'W');
  setPx(p, Math.round(cx), Math.round(cy), 'M');
}

/**
 * The demon's wing. At rest (k≈0.1) it is FOLDED: a narrow tattered blade hanging straight down
 * the back with the wrist spur hooked up above the shoulder — nothing like the dragon's arch.
 * Snapping it open (k→1) throws the same membrane up and out.
 */
function demonWing(p, cx, cy, k, dir) {
  const fingers = [
    { a: lerp(0.58, -1.52, k), r: lerp(10, 25, k) },
    { a: lerp(0.88, -1.00, k), r: lerp(21, 28, k) },
    { a: lerp(1.10, -0.34, k), r: lerp(19, 24, k) },
    { a: lerp(1.30, 0.24, k), r: lerp(15, 18, k) },
    { a: lerp(1.50, 0.78, k), r: lerp(10, 12, k) },
  ];
  wingFan(p, cx, cy, fingers, dir, WING + 'I', { scallop: 2.6, tatter: 2.4 });
  // the wrist spur: the hooked claw that stands above the shoulder of a furled wing
  const sx = cx + (3 + 4 * (1 - k)) * dir, sy = cy - (7 + 4 * (1 - k));
  limb(p, cx, cy, sx, sy, 2, 1, WING, -0.04);
  setPx(p, Math.round(sx), Math.round(sy), 'I'); setPx(p, Math.round(sx + dir), Math.round(sy - 1), 'H');
}

/**
 * One demon frame.
 * @param {'S'|'E'|'N'} f
 * @param {{bob?:number, wing?:number, stride?:number, arm?:number, ring?:number, glow?:number, crouch?:number, reach?:number}} o
 */
function demonFrame(f, o = {}) {
  const p = makePix(DE_W, DE_H);
  const done = (q) => ink(shift(q, DE_PAD, 0));
  const b = o.bob || 0, k = o.wing ?? 0.12, s = o.stride || 0, c = o.crouch || 0;
  const glow = o.glow ?? 0.5, reach = o.reach || 0;
  const lLift = Math.max(0, s) * 3, rLift = Math.max(0, -s) * 3;

  if (f === 'S') {
    demonWing(p, 15, 24 + b, k, -1);
    demonWing(p, 33, 24 + b, k, 1);
    // digitigrade legs ending in cloven hooves
    curve(p, [[19, 36 + b + c], [17, 43 + b + c], [20, 48 + b - lLift]], 5, 3, SKIN, -0.04);
    curve(p, [[29, 36 + b + c], [31, 43 + b + c], [28, 48 + b - rLift]], 5, 3, SKIN, -0.04);
    mass(p, 20, 51 - lLift, 3.6, 2.4, KERA, { n: 2.6, bias: -0.14 });
    mass(p, 28, 51 - rLift, 3.6, 2.4, KERA, { n: 2.6, bias: -0.14 });
    setPx(p, 20, 52 - lLift, '#'); setPx(p, 28, 52 - rLift, '#');   // the cleft in each hoof
    // a hanging loin drape of the same membrane as the wings
    mass(p, 24, 38 + b + c, 7.4, 6.4, WING, { n: 2.8, bias: -0.04 });
    // torso: a broad chest tapering hard into the waist
    mass(p, 24, 33 + b, 7.4, 6.4, SKIN, { n: 2.4 });
    mass(p, 24, 25 + b, 12.4, 8, SKIN, { n: 2.6 });
    mass(p, 12, 23 + b, 5.4, 4.6, SKIN, { n: 2.2, bias: 0.03 });
    mass(p, 36, 23 + b, 5.4, 4.6, SKIN, { n: 2.2, bias: -0.04 });
    // char cracks over the ember heart
    for (const [cx0, cy0, cx1, cy1] of [[20, 22, 24, 27], [24, 27, 29, 23], [22, 29, 26, 32]]) {
      const n = 6;
      for (let i = 0; i <= n; i++) setPx(p, Math.round(lerp(cx0, cx1, i / n)), Math.round(lerp(cy0, cy1, i / n)) + b, i % 3 === 1 && glow > 0.6 ? 'M' : 'N');
    }
    // head and the crown of curling ram horns
    const hy = 14 + b;
    mass(p, 24, hy, 5.4, 5.4, SKIN, { n: 2.2 });
    stamp(p, DE_FACE_S, 19, hy - 4);
    curve(p, [[19, hy - 3], [13, hy - 5], [9, hy - 1], [11, hy + 4]], 2.6, 1.1, KERA);
    curve(p, [[29, hy - 3], [35, hy - 5], [39, hy - 1], [37, hy + 4]], 2.6, 1.1, KERA, -0.09);
    for (let i = 0; i < 3; i++) { setPx(p, 12 - i, hy - 3 + i * 2, 'G'); setPx(p, 36 + i, hy - 3 + i * 2, 'G'); }
    // arms: one hangs, the other is open with the ring above the palm
    curve(p, [[13, 25 + b], [8, 33 + b], [11, 40 + b]], 4, 2.4, SKIN, -0.02);
    setPx(p, 9, 42 + b, 'I'); setPx(p, 11, 42 + b, 'I'); setPx(p, 13, 42 + b, 'I');
    curve(p, [[35, 25 + b], [42, 31 + b - reach], [38, 35 + b - reach]], 4, 2.4, SKIN, -0.02);
    mass(p, 38, 36 + b - reach, 3.4, 2.2, SKIN, { n: 2.4, bias: 0.06 });
    if (glow > 0.15) soulRing(p, 38, 30 + b - reach, 5 + glow * 2, o.ring || 0);
    return done(p);
  }

  if (f === 'E') {
    demonWing(p, 21, 23 + b, k * 0.8, -1);
    curve(p, [[19, 36 + b + c], [16, 43 + b + c], [19, 48 + b - rLift]], 4.6, 2.8, SKIN, -0.18);
    mass(p, 19, 51 - rLift, 3.6, 2.4, KERA, { n: 2.6, bias: -0.22 });
    mass(p, 23, 38 + b + c, 6.4, 6.4, WING, { n: 2.8, bias: -0.06 });
    mass(p, 24, 33 + b, 6, 6.4, SKIN, { n: 2.4 });
    mass(p, 24, 25 + b, 8.4, 8, SKIN, { n: 2.6 });
    mass(p, 20, 22 + b, 5, 4.6, SKIN, { n: 2.2, bias: 0.02 });
    for (let i = 0; i < 5; i++) setPx(p, 27 + (i % 2), 21 + i * 2 + b, glow > 0.6 && i % 2 ? 'M' : 'N');
    const hy = 14 + b;
    mass(p, 26, hy, 5, 5.2, SKIN, { n: 2.2 });
    mass(p, 29, hy + 2, 3.4, 2.6, SKIN, { n: 2.4, bias: -0.04 });
    setPx(p, 28, hy - 1, 'M'); setPx(p, 29, hy - 1, 'M');
    for (let i = 0; i < 4; i++) setPx(p, 28 + i * 0.6 | 0, hy + 4, 'G');
    curve(p, [[22, hy - 3], [16, hy - 5], [12, hy - 1], [14, hy + 4]], 2.5, 1.1, KERA);
    curve(p, [[27, hy - 4], [31, hy - 7], [35, hy - 3]], 2.2, 0.9, KERA, -0.08);
    curve(p, [[26, 36 + b + c], [29, 43 + b + c], [27 + Math.max(0, s) * 3, 48 + b - lLift]], 4.8, 3, SKIN, -0.02);
    mass(p, 28 + Math.max(0, s) * 3, 51 - lLift, 3.6, 2.4, KERA, { n: 2.6, bias: -0.14 });
    curve(p, [[27, 25 + b], [32, 31 + b - reach], [29, 36 + b - reach]], 3.8, 2.3, SKIN, 0.02);
    if (glow > 0.15) soulRing(p, 33, 31 + b - reach, 4.4 + glow * 1.6, o.ring || 0);
    demonWing(p, 25, 22 + b, k, 1);
    return done(p);
  }

  // NORTH — the back: the two folded wings hang like a cloak, the horns curl out past the skull
  curve(p, [[19, 36 + b + c], [17, 43 + b + c], [20, 48 + b - lLift]], 5, 3, SKIN, -0.1);
  curve(p, [[29, 36 + b + c], [31, 43 + b + c], [28, 48 + b - rLift]], 5, 3, SKIN, -0.1);
  mass(p, 20, 51 - lLift, 3.6, 2.4, KERA, { n: 2.6, bias: -0.18 });
  mass(p, 28, 51 - rLift, 3.6, 2.4, KERA, { n: 2.6, bias: -0.18 });
  mass(p, 24, 38 + b + c, 7.4, 6.4, WING, { n: 2.8, bias: -0.08 });
  mass(p, 24, 32 + b, 7.4, 6.4, SKIN, { n: 2.4, bias: -0.06 });
  mass(p, 24, 25 + b, 12.4, 8, SKIN, { n: 2.6, bias: -0.04 });
  demonWing(p, 15, 24 + b, Math.max(0.2, k), -1);   // from behind the furled wings hang like a cloak
  demonWing(p, 33, 24 + b, Math.max(0.2, k), 1);
  for (let y = 20; y < 36; y++) setPx(p, 24, y + b, y % 3 ? 'B' : 'N');
  const hy = 14 + b;
  mass(p, 24, hy, 5.4, 5.4, SKIN, { n: 2.2, bias: -0.04 });
  curve(p, [[19, hy - 3], [13, hy - 5], [9, hy - 1], [11, hy + 4]], 2.6, 1.1, KERA, -0.04);
  curve(p, [[29, hy - 3], [35, hy - 5], [39, hy - 1], [37, hy + 4]], 2.6, 1.1, KERA, -0.12);
  curve(p, [[13, 25 + b], [8, 33 + b], [11, 40 + b]], 4, 2.4, SKIN, -0.06);
  curve(p, [[35, 25 + b], [40, 33 + b], [37, 40 + b]], 4, 2.4, SKIN, -0.1);
  return done(p);
}

function demonAnims(f) {
  const mk = (o) => demonFrame(f, o);
  // idle: it does not fidget. The wings settle a pixel, the ring turns, the embers pulse.
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
  const d2 = squashTo(tilt(mk({ wing: 0.05, glow: 0.15, crouch: 4, bob: 3 }), 0.3, 28, 52), 0.72, DE_H - 3);
  const death = {
    frames: [d0, d1, d2, squashTo(d2, 0.58, DE_H - 3), squashTo(d2, 0.42, DE_H - 3)],
    durations: [140, 180, 210, 460, 900], loop: false,
  };
  return { idle, walk, attack, hurt, death };
}

/** Demon: 48x56, the still, horned guardian of the Sword with the ring of stolen light. */
export function buildDemon() {
  return { anims: clips(demonAnims), palette: BOSS_PALETTE, w: DE_W, h: DE_H, pivot: DE_PIV, emissive: 'Mx', scale: 1.04 };
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

// drakes: the three winged/scaled things of MONSTER_TABLE that used to SHARE ONE DRAWING, plus the
// spider that comes through the wall. Before this file `wyvern`, `shadow-dragon` and `fyre-drake`
// were all served by two builders (`buildDragon` twice, `buildSalamander` once) and
// `dimension-spider` was the generic six-legged `buildSpider` — four MONSTER_TABLE entries, two
// silhouettes. A bestiary in which the thing that kills you at depth 8 and the thing that kills you
// at depth 20 are the same picture is not a bestiary.
//
// Everything here obeys sprites/style.js: the one INK, the one LIT (top-left) key light, house
// `ramp()`s only, and `lint()` clean. The mass/limb/curve/crest/wingFan form-shading toolkit is
// shared with the boss group (monsters/boss.js) so a drake turns like a form instead of pillowing.
//
// FOUR SILHOUETTES THAT CANNOT BE CONFUSED, at gameplay distance, before any colour:
//   wyvern            TWO legs and nothing else: the wings ARE its arms, hooked up over the
//                     shoulders like folded elbows, and a whip tail longer than the body ending in
//                     a barbed spade. Dry olive-tan leather, rust membrane — the dusty one.
//   shadow-dragon     FOUR legs planted under a wing span twice its own width, a long S-neck and a
//                     lyre of horns. Violet-black scale with an inner glow: the light lives INSIDE
//                     it and leaks out along the throat, the chest seams and the wing veins.
//   fyre-drake        squat and four-square: a barrel of a body slung low between four thick legs,
//                     a heavy wedge skull carried UP on a short thick neck, and small wings furled
//                     tight along the spine — the wing LINE, never a span. Molten veins split its
//                     basalt hide and the fire in them throws light UP onto the jaw and the belly.
//   dimension-spider  EIGHT jointed legs, each one three tapering segments — knees above the body,
//                     feet planted wide — and a violet echo of itself standing a pixel out of
//                     register, because half of it is somewhere else.
import { Palette, outline, makePix, setPx as putPx, getPx, blit } from '../pixelPainter.js';
import { INK, INK_LIT, LIT, ramp } from '../style.js';
import { mass, limb, curve, crest, wingFan, clips, flash, squashTo, tilt, setDrawScale, R } from './boss.js';

/** @typedef {import('../pixelPainter.js').Pix} Pix */

const lerp = (a, b, t) => a + (b - a) * t;
/** The one house outline: exactly one pixel of INK, softened to INK_LIT on the lit edges. */
const ink = (p) => outline(p, '#', { lit: LIT, litKey: '@' });

// ------------------------------------------------------------------- THE DRAW SCALE (the size law)
/**
 * THE DRAKES ARE AUTHORED SMALL AND PAINTED BIG. See monsters/boss.js `setDrawScale` for the full
 * note; the short version is that `spriteBillboard` decides a creature's on-screen size purely from
 * HOW MANY TEXELS ITS ART OCCUPIES, so style.js `SCALE` — the game's whole size hierarchy — only
 * reaches the screen if the art is drawn at the height its slot asks for. It was not: the Shadow
 * Dragon wants 2.30 of the hero and its sheet was 72 texels tall against the hero's 46 (1.57), so
 * the tallest silhouette in the game came on screen SHORTER than the Demon.
 *
 * The toolkit imported from boss.js (`mass`, `limb`, `curve`, `crest`, `wingFan`) is analytic, so
 * setting the draw scale re-solves every solid on the finer grid rather than stretching pixels: at
 * DS = 1.47 the dragon's neck is a new capsule with its own terminator and half again as many ramp
 * steps across it, not four pixels blown up to six. `DSC` below is this file's copy of that scale, and
 * `drawAt()` hands it to boss.js as well, because the primitives live there.
 *
 * The hand-placed marks (talons, fangs, veins, eyes, the spider's knee plates) are written in
 * AUTHORED space and land through the local `setPx`, which covers exactly the texels an authored
 * pixel owns on the real grid — one or two, never a gap, never a doubled blob.
 */
let DSC = 1;
/** Authored length -> texels on the real canvas. */
const SC = (v) => v * DSC;
/** Set the draw scale for this file AND for the shared boss.js toolkit. */
function drawAt(s) { DSC = s; setDrawScale(s); }
/**
 * Set one AUTHORED-space pixel: it covers exactly the texels that authored pixel owns on the real
 * grid (`round(x·DS) .. round((x+1)·DS) - 1`). At DS = 1 this is `setPx`.
 */
function setPx(p, x, y, key) {
  const x0 = Math.round(x * DSC), x1 = Math.max(x0, Math.round((x + 1) * DSC) - 1);
  const y0 = Math.round(y * DSC), y1 = Math.max(y0, Math.round((y + 1) * DSC) - 1);
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) putPx(p, xx, yy, key);
}
/** Read one authored-space pixel (the mark's top-left texel). */
const atPx = (p, x, y) => getPx(p, Math.round(x * DSC), Math.round(y * DSC));

/**
 * THE ATLAS CELL IS PART OF THE DRAWING. A wing tip, a tail barb or a horn that reaches the edge of
 * its cell comes back with a flat un-inked cut across it, because `outline()` has nowhere to put the
 * pixel. Every drake is therefore posed in a SCRATCH pix sized to the pose and then seated in a
 * larger cell with a margin all round: `pad(w, h, dx, dy)` returns that seating function, and the
 * frame's pivot moves with it.
 * @param {number} w @param {number} h the real cell @param {number} dx @param {number} dy the margin
 */
const pad = (w, h, dx, dy) => (q) => ink(blit(makePix(w, h), q, dx, dy));

/**
 * WHERE A FORM SITS ON ITS RAMP.
 * `tone()` (monsters/boss.js) quantises a lambert term onto a ramp, and it was tuned against the
 * boss group's NARROW hand-rolled ramps. A style.js `ramp()` is deliberately much wider — its ends
 * are `VALUE_RANGE_TARGET` apart — so the same lambert lands a form near the TOP of it and every
 * creature comes out chalk. `TB` is the species' offset down its own ramp, set once at the top of
 * each frame function; `M`/`C`/`LB` are mass/curve/limb with `TB` folded into the bias, so a drake
 * is painted in the middle of its ramp with room to go lighter AND darker.
 */
let TB = 0;
const M = (p, cx, cy, rx, ry, keys, o = {}) => mass(p, cx, cy, rx, ry, keys, { ...o, bias: (o.bias || 0) + TB });
const C = (p, pts, r0, r1, keys, bias = 0) => curve(p, pts, r0, r1, keys, bias + TB);
const LB = (p, x0, y0, x1, y1, r0, r1, keys, bias = 0) => limb(p, x0, y0, x1, y1, r0, r1, keys, bias + TB);

/**
 * A palette holding only house ramps: `set('keys', base)` registers one `ramp()` (5-7 steps,
 * darkest first) against those keys, so no drake can invent its own shading law.
 */
/** Ramp options: keep a highlight IN the species colour (the default satShift greys the top step). */
const HUE = { satShift: 0.03 }, BONE = { satShift: 0.015, hueShift: 0.035 };

function drakePalette() {
  const p = new Palette().set('#', INK).set('@', INK_LIT).set('F', '#fff4f0');
  /** @param {string} keys @param {string} base @param {object} [o] */
  p.band = (keys, base, o) => { const r = ramp(base, keys.length, o); [...keys].forEach((k, i) => p.set(k, r[i])); return p; };
  return p;
}

/**
 * A FOOT THAT GRIPS THE FLOOR. Three toes forward and a dew-claw behind, each toe TWO pixels wide
 * and separated from its neighbour by a column the outline pass fills with ink — which is the whole
 * difference between a foot and a mitten at this size. `y` is the contact row: the fills stop there
 * and `houseOutline` lays the one-pixel weight shadow underneath.
 * (Before this the three toes were single pixels two apart, drawn INSIDE an ankle blob that filled
 * the gaps back in, so every drake in the file stood on rounded stumps.)
 */
function talons(p, x, y, dir, key, toe = null) {
  const cx = Math.round(x), t = toe || key;
  for (let i = -3; i <= 4; i++) setPx(p, cx + i * dir, y - 3, t);       // the arch the ankle sits on
  for (const off of [-3, 0, 3]) {
    const tx = cx + off * dir;
    setPx(p, tx, y - 2, t); setPx(p, tx + dir, y - 2, t);
    setPx(p, tx, y - 1, t); setPx(p, tx + dir, y - 1, t);
    setPx(p, tx, y, key); setPx(p, tx + dir, y, key);                   // the claw, on the floor
  }
  setPx(p, cx - 5 * dir, y - 2, t);                                     // the dew-claw, behind
  setPx(p, cx - 5 * dir, y - 1, t); setPx(p, cx - 5 * dir, y, key);
}

/** A row of small even fangs along a jaw. */
function fangs(p, x0, x1, y, key) { for (let x = x0; x <= x1; x += 2) setPx(p, x, y, key); }

// ==========================================================================================
//                                        WYVERN
// ==========================================================================================
// Read: a two-legged drake. It has no forelegs at all — the wings hang off the chest like arms,
// elbows hooked ABOVE the shoulders, membrane falling to the hocks — and it balances that front end
// on a tail as long as it is tall, finished with a flat barbed spade.
// AUTHORED 60x68 IN A 70x71 CELL, PAINTED AT 1.35x IT. The wyvern's slot is 1.90 of the hero and
// its sheet stood 65 texels to the hero's 46 — 1.41, barely over the War Lord's art. Re-rasterised
// it stands 88, and the hock, the wrist claw and the spade barb each gain a texel of definition.
const WY_S = 1.35;
const WY_ASW = 60, WY_ASH = 68, WY_ADX = 5, WY_ADY = 2;
const WY_SW = R(WY_ASW, WY_S), WY_SH = R(WY_ASH, WY_S);
const WY_DX = R(WY_ADX, WY_S), WY_DY = R(WY_ADY, WY_S);
const WY_W = WY_SW + R(10, WY_S), WY_H = WY_SH + R(3, WY_S);
const WY_PIV = { x: R(30, WY_S) + WY_DX, y: R(66, WY_S) + WY_DY };
const wyvDone = pad(WY_W, WY_H, WY_DX, WY_DY);
const WY = drakePalette()
  .band('123456', '#7a6d3e', HUE)   // dry olive-tan hide
  .band('qrstu', '#93553a', HUE)    // rust wing membrane
  .band('vwxyz', '#a09684', BONE)   // horn, beak plate, talon
  .set('E', '#1d1526').set('Y', '#ffc45a');   // eye socket, the amber eye (emissive)
const WY_HIDE = '123456', WY_MEM = 'qrstu', WY_HORN = 'vwxy';
/** Sun-dried leather sits low on its ramp: this is the dusty drake, not a chalk one. */
const WY_TB = -0.09;

/** One wing, held as an ARM: `k` 0 = folded hook at the shoulder, 1 = full reach. */
function wyvWing(p, cx, cy, k, dir, droop = 0) {
  const fingers = [
    { a: lerp(-1.86, -1.62, k), r: lerp(14, 27, k) },
    { a: lerp(-1.18, -1.02, k) + droop, r: lerp(16, 29, k) },
    { a: lerp(-0.42, -0.34, k) + droop, r: lerp(15, 24, k) },
    { a: lerp(0.30, 0.24, k) + droop, r: lerp(12, 17, k) },
    { a: lerp(0.92, 0.78, k) + droop, r: lerp(9, 12, k) },
  ];
  wingFan(p, cx, cy, fingers, dir, 'qrs' + 'w', { scallop: 2.6, tatter: 1 });
  // the wrist claw at the crown of the hook — the wyvern's hand
  const t = fingers[0];
  const tx = Math.round(cx + Math.cos(t.a) * t.r * dir), ty = Math.round(cy + Math.sin(t.a) * t.r);
  setPx(p, tx, ty, 'x'); setPx(p, tx, ty - 1, 'y'); setPx(p, tx + dir, ty - 1, 'w');
}

/**
 * A BIRD-OF-PREY HIND LEG, in four pieces, because the wyvern's whole lower half is these two legs
 * and it used to be one tapering curve finished with a rounded blob a pixel above the floor.
 *
 *   HAUNCH   a deep drumstick carrying the mass, wider than the body it hangs off
 *   HOCK     the point of the reversed ankle, standing BEHIND the leg — the raptor read
 *   SHANK    sweeping forward off the hock
 *   FOOT     the metatarsus dropping onto three splayed toes and a dew-claw (`talons`)
 */
function wyvLeg(p, hx, hy, dir, lift, bias) {
  const foot = 64 - lift;                                       // the contact row
  M(p, hx + dir * 0.5, hy + 4, 6.6, 8.2, WY_HIDE, { n: 2.4, bias: bias + 0.03 });
  M(p, hx - dir * 3.2, hy + 12, 3.0, 3.6, WY_HIDE, { n: 2.2, bias: bias - 0.22 });
  C(p, [[hx + dir * 2, hy + 8], [hx - dir, hy + 13], [hx + dir * 2.5, foot - 6]], 3.6, 2.0, WY_HIDE, bias - 0.10);
  LB(p, hx + dir * 2.5, foot - 7, hx + dir * 2.5, foot - 3, 2.4, 2.6, WY_HIDE, bias - 0.04);
  talons(p, hx + dir * 2.5, foot, dir, 'x', '3');
}

/** The barbed spade at the end of the tail — the wyvern's other weapon. */
function wyvBarb(p, x, y, ax, ay) {
  const ux = x - ax, uy = y - ay, L = Math.hypot(ux, uy) || 1;
  LB(p, x, y, x + ux / L * 4, y + uy / L * 4, 2.6, 0.6, WY_HORN, 0.02);
  setPx(p, Math.round(x - uy / L * 3), Math.round(y + ux / L * 3), 'x');
  setPx(p, Math.round(x + uy / L * 3), Math.round(y - ux / L * 3), 'w');
}

/** The narrow raptor skull: a beaked wedge under a pair of short swept horns, one hot eye. */
function wyvHead(p, hx, hy, dir, both = false) {
  M(p, hx, hy, 5.0, 4.2, WY_HIDE, { n: 2.3 });
  LB(p, hx, hy + 1, hx + dir * 7, hy + 3, 3.6, 1.8, WY_HIDE, 0.02);       // the muzzle
  LB(p, hx + dir * 2, hy + 4, hx + dir * 6, hy + 5, 2.2, 1.2, WY_HORN, -0.04); // the beak plate
  C(p, [[hx - dir * 2, hy - 3], [hx - dir * 5, hy - 6], [hx - dir * 7, hy - 9]], 2.0, 0.5, WY_HORN, -0.16);
  if (both) C(p, [[hx + dir * 2, hy - 3], [hx + dir * 5, hy - 6], [hx + dir * 7, hy - 9]], 2.0, 0.5, WY_HORN, -0.24);
  fangs(p, Math.min(hx + dir * 2, hx + dir * 6), Math.max(hx + dir * 2, hx + dir * 6), hy + 6, 'y');
  setPx(p, hx + dir * 2, hy - 1, 'E'); setPx(p, hx + dir * 2, hy, 'Y');
}

/**
 * One wyvern frame.
 * @param {'S'|'E'|'N'} f
 * @param {{bob?:number, stride?:number, wing?:number, neck?:number, tail?:number, crouch?:number,
 *   lunge?:number, droop?:number}} o
 */
function wyvFrame(f, o = {}) {
  drawAt(WY_S);
  const p = makePix(WY_SW, WY_SH);
  TB = WY_TB;
  const b = o.bob || 0, s = o.stride || 0, c = o.crouch || 0, k = o.wing ?? 0.24;
  const neck = o.neck || 0, lunge = o.lunge || 0, droop = o.droop || 0;
  const sw = [0, -4, 4][(o.tail || 0) % 3];
  const lLift = Math.max(0, s) * 3, rLift = Math.max(0, -s) * 3;

  if (f === 'S') {
    // the tail sweeps out behind and to the screen left, the spade lifted clear of the floor
    C(p, [[31, 47 + b], [22, 57 + b + sw * 0.3], [10, 56 + b + sw * 0.7], [3, 45 + b + sw], [5, 34 + b + sw * 1.3]], 5.2, 1.2, WY_HIDE, -0.16);
    wyvBarb(p, 5, 31 + b + sw, 4, 39 + b + sw);
    wyvWing(p, 19, 34 + b, k, -1, droop);
    wyvWing(p, 41, 34 + b, k, 1, droop);
    wyvLeg(p, 24, 44 + b + c, -1, lLift, -0.02);
    wyvLeg(p, 36, 44 + b + c, 1, rLift, -0.10);
    // the barrel: deep chest over a keeled belly, no forelegs anywhere
    M(p, 30, 40 + b, 11.4, 9.6, WY_HIDE, { n: 2.5 });
    M(p, 30, 31 + b, 10.4, 7.8, WY_HIDE, { n: 2.4 });
    M(p, 30, 37 + b, 5.6, 7.2, WY_MEM, { n: 2.3, bias: 0.10 });          // pale keel plates
    for (let i = 0; i < 4; i++) for (let x = 26; x <= 34; x++) setPx(p, x, 32 + i * 3 + b, 's');
    C(p, [[30, 28 + b], [30, 22 + b - neck], [30 + lunge, 18 + b - neck]], 5.6, 4.0, WY_HIDE);
    crest(p, [[30, 27 + b], [30, 33 + b], [30, 40 + b]], 2, WY_HIDE, { tip: 'w' });
    wyvHead(p, 30 + lunge, 14 + b - neck, 1, true);
    // the second (far) eye, seen head-on
    setPx(p, 27 + lunge, 13 + b - neck, 'E'); setPx(p, 27 + lunge, 14 + b - neck, 'Y');
    return wyvDone(p);
  }

  if (f === 'E') {
    wyvWing(p, 26, 33 + b, k * 0.85, -1, droop);                            // far wing, behind
    C(p, [[22, 45 + b], [12, 51 + b + sw * 0.4], [4, 46 + b + sw]], 5.0, 1.2, WY_HIDE, -0.14);
    wyvBarb(p, 3, 43 + b + sw, 8, 49 + b + sw);
    wyvLeg(p, 25, 43 + b + c, -1, rLift, -0.18);
    M(p, 30, 39 + b, 12.0, 9.2, WY_HIDE, { n: 2.5 });
    M(p, 33, 32 + b, 9.6, 7.2, WY_HIDE, { n: 2.4 });
    M(p, 34, 39 + b, 5.6, 6.0, WY_MEM, { n: 2.3, bias: 0.08 });
    crest(p, [[24, 32 + b], [30, 30 + b], [36, 31 + b]], 2, WY_HIDE, { tip: 'w' });
    C(p, [[36, 30 + b], [42, 25 + b - neck], [46 + lunge, 20 + b - neck]], 5.2, 3.8, WY_HIDE);
    wyvHead(p, 48 + lunge, 17 + b - neck, 1);
    wyvLeg(p, 33, 44 + b + c, 1, lLift, 0);
    wyvWing(p, 31, 32 + b, k, 1, droop);                                    // near wing, over the body
    return wyvDone(p);
  }

  // NORTH — walking away: the tail runs at the camera, the two wing hooks stand off the shoulders
  C(p, [[30, 46 + b], [29 + sw * 0.4, 54 + b], [27 + sw, 61 + b]], 4.8, 1.4, WY_HIDE, 0.02);
  wyvWing(p, 19, 34 + b, k, -1, droop);
  wyvWing(p, 41, 34 + b, k, 1, droop);
  wyvLeg(p, 24, 44 + b + c, -1, lLift, -0.08);
  wyvLeg(p, 36, 44 + b + c, 1, rLift, -0.14);
  M(p, 30, 39 + b, 11.6, 9.8, WY_HIDE, { n: 2.5, bias: -0.06 });
  M(p, 30, 30 + b, 10.6, 7.6, WY_HIDE, { n: 2.4, bias: -0.03 });
  crest(p, [[30, 24 + b], [30, 32 + b], [30, 42 + b]], 2, WY_HIDE, { tip: 'w' });
  C(p, [[30, 27 + b], [30, 21 + b - neck], [30, 17 + b - neck]], 5.4, 4.2, WY_HIDE, -0.04);
  M(p, 30, 14 + b - neck, 5.0, 4.2, WY_HIDE, { n: 2.3, bias: -0.04 });
  C(p, [[27, 12 + b - neck], [22, 9 + b - neck], [18, 9 + b - neck]], 2.2, 0.6, WY_HORN, -0.02);
  C(p, [[33, 12 + b - neck], [38, 9 + b - neck], [42, 9 + b - neck]], 2.2, 0.6, WY_HORN, -0.10);
  return wyvDone(p);
}

function wyvAnims(f) {
  const mk = (o) => wyvFrame(f, o);
  const idle = {
    frames: [mk({ wing: 0.22, tail: 0 }), mk({ wing: 0.30, bob: -1, neck: 1, tail: 1 }), mk({ wing: 0.34, bob: -1, neck: 1, tail: 2, droop: -0.05 }), mk({ wing: 0.26, tail: 1 })],
    durations: [400, 320, 360, 320], loop: true,
  };
  // a two-legged strut: the wings beat a half-count to keep the front end up
  const walk = {
    frames: [mk({ stride: 1, wing: 0.28, tail: 1 }), mk({ stride: 0.4, wing: 0.5, bob: -1, crouch: 1, tail: 2 }), mk({ stride: -1, wing: 0.30, tail: 0 }), mk({ stride: -0.4, wing: 0.52, bob: -1, crouch: 1, tail: 1 })],
    durations: [170, 150, 170, 150], loop: true,
  };
  // wings thrown wide, then the whole neck snaps forward into a bite
  const attack = {
    frames: [mk({ wing: 0.95, neck: 3, bob: -2, tail: 2 }), mk({ wing: 1, neck: 1, lunge: 2, tail: 1 }), mk({ wing: 0.55, neck: -3, lunge: 5, crouch: 1, tail: 0 }), mk({ wing: 0.42, neck: -1, crouch: 1, bob: 1 })],
    durations: [180, 110, 130, 180], loop: false,
  };
  const recoil = mk({ wing: 0.18, neck: -2, crouch: 2, bob: 2, droop: 0.22, tail: 2 });
  const hurt = { frames: [flash(recoil), recoil], durations: [80, 190], loop: false };
  const d0 = mk({ wing: 0.8, neck: 2, bob: -1, tail: 2 });
  const d1 = mk({ wing: 0.3, neck: -3, crouch: 3, bob: 2, droop: 0.4 });
  const d2 = squashTo(tilt(mk({ wing: 0.16, neck: -4, crouch: 4, bob: 3, droop: 0.55 }), 0.3, R(30, WY_S) + WY_DX, R(64, WY_S) + WY_DY), 0.72, WY_H - 3);
  const death = { frames: [d0, d1, d2, squashTo(d2, 0.6, WY_H - 3), squashTo(d2, 0.48, WY_H - 3)], durations: [150, 180, 210, 470, 900], loop: false };
  return { idle, walk, attack, hurt, death };
}

/** Wyvern: a 70x71 cell around a 60x68 pose — two-legged, wings for arms, a barbed whip tail. */
export function buildWyvern() {
  return { anims: clips(wyvAnims), palette: WY, w: WY_W, h: WY_H, pivot: WY_PIV, emissive: 'Y', scale: 1 };
}

// ==========================================================================================
//                                     SHADOW DRAGON
// ==========================================================================================
// Read: four legs planted under a span twice its own width, and a light that is INSIDE it. The
// scale is a violet so dark it is nearly the floor; what separates it from the floor is the glow
// leaking out of the throat, along the chest seams and down the veins of the membrane.
// AUTHORED 76x72 IN A 90x80 CELL, PAINTED AT 1.47x IT. This is the tallest silhouette in the game
// (style.js: 2.30) and it was standing at 1.57 — SHORTER on screen than the Demon at 1.61, which is
// the exact inversion the ladder exists to kill. Re-rasterised the S-neck alone is 24 texels of
// modelled form instead of 16, and the lyre of horns finally reads as separate horns.
const SD_S = 1.47;
const SD_ASW = 76, SD_ASH = 72, SD_ADX = 7, SD_ADY = 5;
const SD_SW = R(SD_ASW, SD_S), SD_SH = R(SD_ASH, SD_S);
const SD_DX = R(SD_ADX, SD_S), SD_DY = R(SD_ADY, SD_S);
const SD_W = SD_SW + R(14, SD_S), SD_H = SD_SH + R(8, SD_S);
const SD_PIV = { x: R(38, SD_S) + SD_DX, y: R(70, SD_S) + SD_DY };
const sdDone = pad(SD_W, SD_H, SD_DX, SD_DY);
const SD = drakePalette()
  .band('123456', '#3a3157', HUE)   // violet-black scale
  .band('qrstu', '#4e3568', HUE)    // plum membrane: thin enough that the light behind it comes through
  .band('vwxyz', '#8f8a80', BONE)   // bone horn and claw
  .set('G', '#7fd8ff').set('H', '#c9f0ff').set('I', '#4a86b8')  // the inner glow: core, flare, bleed
  .set('E', '#1a1425');
const SD_SCL = '123456', SD_MEM = 'qrstu', SD_HORN = 'vwxy';
/** The darkest body in the game: it is read by the light LEAKING OUT of it, not falling on it. */
const SD_TB = -0.26;

/** A wing at spread `k`: the span is the read, so even furled it reaches past the shoulder. */
function sdWing(p, cx, cy, k, dir, droop = 0) {
  const fingers = [
    { a: lerp(-1.42, -1.30, k), r: lerp(17, 33, k) },
    { a: lerp(-0.82, -0.62, k) + droop, r: lerp(18, 35, k) },
    { a: lerp(-0.22, -0.06, k) + droop, r: lerp(16, 30, k) },
    { a: lerp(0.36, 0.42, k) + droop, r: lerp(13, 21, k) },
    { a: lerp(0.92, 0.86, k) + droop, r: lerp(9, 13, k) },
  ];
  wingFan(p, cx, cy, fingers, dir, 'stu' + 'x', { scallop: 3.6 });
  // the glow runs down the veins between the fingers, brightest at the root
  for (let i = 1; i < fingers.length; i++) {
    const a = (fingers[i - 1].a + fingers[i].a) / 2, r = (fingers[i - 1].r + fingers[i].r) / 2;
    for (let t = 3; t < r * 0.7; t += 2) {
      const x = Math.round(cx + Math.cos(a) * t * dir), y = Math.round(cy + Math.sin(a) * t);
      if (atPx(p, x, y)) setPx(p, x, y, t < r * 0.34 ? 'G' : 'I');
    }
  }
  const t0 = fingers[0];
  const tx = Math.round(cx + Math.cos(t0.a) * t0.r * dir), ty = Math.round(cy + Math.sin(t0.a) * t0.r);
  setPx(p, tx, ty, 'x'); setPx(p, tx, ty - 1, 'w');
}

/** The long skull: a narrow wedge with the lyre of horns and a throat full of cold fire. */
function sdHead(p, hx, hy, dir, glow) {
  M(p, hx, hy, 5.4, 4.2, SD_SCL, { n: 2.3 });
  LB(p, hx, hy + 1, hx + dir * 8, hy + 3, 3.8, 2.0, SD_SCL, 0.02);
  C(p, [[hx - dir * 3, hy - 3], [hx - dir * 7, hy - 8], [hx - dir * 10, hy - 13]], 2.4, 0.6, SD_HORN, -0.20);
  C(p, [[hx - dir * 4, hy - 1], [hx - dir * 8, hy - 3], [hx - dir * 11, hy - 2]], 1.7, 0.5, SD_HORN, -0.28);
  fangs(p, Math.min(hx + dir * 2, hx + dir * 7), Math.max(hx + dir * 2, hx + dir * 7), hy + 5, 'y');
  setPx(p, hx + dir * 2, hy - 1, 'E'); setPx(p, hx + dir * 2, hy, 'G');
  if (glow) for (let i = 0; i < 3; i++) setPx(p, hx + dir * (4 + i), hy + 4, i < 2 ? 'H' : 'G');
}

/**
 * One shadow-dragon frame.
 * @param {'S'|'E'|'N'} f
 * @param {{bob?:number, wing?:number, stride?:number, neck?:number, lunge?:number, breath?:number,
 *   droop?:number, crouch?:number, heat?:number}} o
 */
function sdFrame(f, o = {}) {
  drawAt(SD_S);
  const p = makePix(SD_SW, SD_SH);
  TB = SD_TB;
  const b = o.bob || 0, k = o.wing ?? 0.66, s = o.stride || 0, c = o.crouch || 0;
  const neck = o.neck || 0, lunge = o.lunge || 0, droop = o.droop || 0, heat = o.heat ?? 0.6;
  const ground = 67;

  /** The chest seams the inner light leaks through. */
  const seams = (cx, cy, wide) => {
    for (let i = 0; i < 4; i++) {
      const y = cy + i * 3;
      for (let x = cx - wide + (i & 1); x <= cx + wide - (i & 1); x += 2) {
        if (!atPx(p, x, y)) continue;
        setPx(p, x, y, heat > 0.7 && i < 2 ? 'H' : heat > 0.35 ? 'G' : 'I');
      }
    }
  };

  if (f === 'S') {
    sdWing(p, 24, 30 + b, k, -1, droop);
    sdWing(p, 52, 30 + b, k, 1, droop);
    C(p, [[38, 52 + b], [26, 60 + b], [13, 62 + b], [5, 55 + b]], 5.4, 1.2, SD_SCL, -0.16);
    // hind legs, then the body, then the two FORELEGS planted in front — the four-legged read
    C(p, [[30, 46 + b + c], [25, 54 + b + c], [28 - Math.max(0, s) * 2, ground]], 6.2, 3.6, SD_SCL, -0.06);
    C(p, [[46, 46 + b + c], [51, 54 + b + c], [48 + Math.max(0, -s) * 2, ground]], 6.2, 3.6, SD_SCL, -0.06);
    for (const fx of [28 - Math.max(0, s) * 2, 48 + Math.max(0, -s) * 2]) {
      M(p, fx, ground, 5.0, 2.0, SD_SCL, { n: 2.6, bias: -0.12 });
      talons(p, fx, ground + 1, 1, 'w', '2');
    }
    M(p, 38, 44 + b, 12.6, 9.6, SD_SCL, { n: 2.5 });
    M(p, 38, 34 + b, 11.0, 8.4, SD_SCL, { n: 2.4 });
    M(p, 38, 39 + b, 6.4, 7.4, SD_MEM, { n: 2.4, bias: 0.08 });
    seams(38, 32 + b, 5);
    C(p, [[38, 31 + b], [38, 24 + b - neck], [38 + lunge, 19 + b - neck]], 6.6, 4.6, SD_SCL);
    sdHead(p, 38 + lunge, 15 + b - neck, 1, o.breath);
    setPx(p, 35 + lunge, 14 + b - neck, 'E'); setPx(p, 35 + lunge, 15 + b - neck, 'G');
    if (o.breath) for (let i = 0; i < o.breath; i++) { const r = 1 + i * 0.6; for (let j = -r; j <= r; j++) setPx(p, Math.round(38 + lunge + j), 21 + b - neck + i, Math.abs(j) < r * 0.5 ? 'H' : 'G'); }
    C(p, [[28, 38 + b], [22, 46 + b], [26, 55 + b]], 3.8, 2.4, SD_SCL, -0.02);
    C(p, [[48, 38 + b], [54, 46 + b], [50, 55 + b]], 3.8, 2.4, SD_SCL, -0.08);
    for (const fx of [26, 50]) talons(p, fx, 57 + b, 1, 'w', '2');
    crest(p, [[38, 26 + b], [38, 34 + b], [38, 44 + b], [38, 52 + b]], 3, SD_SCL, { tip: 'y' });
    return sdDone(p);
  }

  if (f === 'E') {
    sdWing(p, 30, 30 + b, k * 0.9, -1, droop);
    C(p, [[24, 48 + b], [11, 54 + b], [3, 46 + b]], 5.4, 1.2, SD_SCL, -0.14);
    C(p, [[28, 44 + b + c], [22, 54 + b + c], [26 + Math.max(0, -s) * 3, ground]], 5.8, 3.4, SD_SCL, -0.18);
    C(p, [[34, 40 + b], [28, 50 + b], [32 + Math.max(0, s) * 2, ground]], 3.8, 2.4, SD_SCL, -0.16);
    M(p, 34, 42 + b, 12.8, 9.4, SD_SCL, { n: 2.5 });
    M(p, 37, 34 + b, 10.4, 7.6, SD_SCL, { n: 2.4 });
    M(p, 39, 42 + b, 6.4, 6.4, SD_MEM, { n: 2.4, bias: 0.07 });
    seams(39, 34 + b, 4);
    crest(p, [[24, 34 + b], [32, 31 + b], [40, 32 + b]], 3, SD_SCL, { tip: 'y' });
    C(p, [[42, 32 + b], [49, 25 + b - neck], [55 + lunge, 20 + b - neck]], 6.2, 4.4, SD_SCL);
    sdHead(p, 58 + lunge, 17 + b - neck, 1, o.breath);
    if (o.breath) for (let i = 0; i < o.breath; i++) { const r = 1 + i * 0.6; for (let j = -r; j <= r; j++) setPx(p, 58 + lunge + 6 + i, Math.round(20 + b - neck + j), Math.abs(j) < r * 0.5 ? 'H' : 'G'); }
    C(p, [[40, 46 + b + c], [35, 55 + b + c], [39 + Math.max(0, s) * 3, ground]], 6.0, 3.6, SD_SCL, -0.02);
    C(p, [[44, 38 + b], [50, 48 + b], [46, 57 + b]], 3.6, 2.3, SD_SCL, 0.02);
    for (const fx of [26 + Math.max(0, -s) * 3, 39 + Math.max(0, s) * 3]) { M(p, fx, ground, 5.0, 2.0, SD_SCL, { n: 2.6, bias: -0.12 }); talons(p, fx, ground + 1, 1, 'w', '2'); }
    talons(p, 46, 59 + b, 1, 'w', '2'); talons(p, 32 + Math.max(0, s) * 2, ground + 1, 1, 'w', '2');
    sdWing(p, 36, 29 + b, k, 1, droop);
    return sdDone(p);
  }

  // NORTH — the span from behind: two wings over a ridged spine, the tail running at the camera
  sdWing(p, 24, 30 + b, k, -1, droop);
  sdWing(p, 52, 30 + b, k, 1, droop);
  C(p, [[38, 48 + b], [37, 56 + b], [35, 64 + b]], 5.2, 1.5, SD_SCL, 0.02);
  C(p, [[30, 46 + b + c], [24, 54 + b + c], [27 - Math.max(0, s) * 2, ground]], 6.2, 3.6, SD_SCL, -0.12);
  C(p, [[46, 46 + b + c], [52, 54 + b + c], [49 + Math.max(0, -s) * 2, ground]], 6.2, 3.6, SD_SCL, -0.12);
  for (const fx of [27 - Math.max(0, s) * 2, 49 + Math.max(0, -s) * 2]) { M(p, fx, ground, 5.0, 2.0, SD_SCL, { n: 2.6, bias: -0.16 }); talons(p, fx, ground + 1, 1, 'w', '2'); }
  M(p, 38, 43 + b, 12.8, 10.0, SD_SCL, { n: 2.5, bias: -0.06 });
  M(p, 38, 33 + b, 11.4, 8.4, SD_SCL, { n: 2.4, bias: -0.04 });
  crest(p, [[38, 24 + b], [38, 34 + b], [38, 44 + b], [38, 54 + b]], 3.4, SD_SCL, { tip: 'y' });
  for (let i = 0; i < 4; i++) setPx(p, 38, 30 + i * 4 + b, heat > 0.55 ? 'G' : 'I');
  C(p, [[38, 30 + b], [38, 23 + b - neck], [38, 18 + b - neck]], 6.2, 4.6, SD_SCL, -0.04);
  M(p, 38, 15 + b - neck, 5.6, 4.4, SD_SCL, { n: 2.2, bias: -0.04 });
  C(p, [[34, 13 + b - neck], [30, 8 + b - neck], [27, 3 + b - neck]], 2.4, 0.6, SD_HORN, -0.20);
  C(p, [[42, 13 + b - neck], [46, 8 + b - neck], [49, 3 + b - neck]], 2.4, 0.6, SD_HORN, -0.28);
  return sdDone(p);
}

function sdAnims(f) {
  const mk = (o) => sdFrame(f, o);
  const idle = {
    frames: [mk({ wing: 0.62, heat: 0.35 }), mk({ wing: 0.74, bob: -1, neck: 1, heat: 0.75 }), mk({ wing: 0.82, bob: -1, neck: 1, droop: -0.06, heat: 1 }), mk({ wing: 0.68, heat: 0.5 })],
    durations: [430, 340, 380, 340], loop: true,
  };
  const walk = {
    frames: [mk({ stride: 1, wing: 0.64, heat: 0.5 }), mk({ stride: 0.4, wing: 0.84, bob: -1, crouch: 1, heat: 0.7 }), mk({ stride: -1, wing: 0.66, heat: 0.5 }), mk({ stride: -0.4, wing: 0.86, bob: -1, crouch: 1, heat: 0.7 })],
    durations: [195, 175, 195, 175], loop: true,
  };
  const attack = {
    frames: [mk({ wing: 1, neck: 3, bob: -2, heat: 1 }), mk({ wing: 0.96, neck: 2, lunge: 2, breath: 3, heat: 1 }), mk({ wing: 0.54, neck: -2, lunge: 5, crouch: 1, breath: 8, heat: 1 }), mk({ wing: 0.64, neck: 0, crouch: 1, bob: 1, heat: 0.5 })],
    durations: [190, 100, 140, 190], loop: false,
  };
  const recoil = mk({ wing: 0.42, neck: -2, crouch: 2, bob: 2, droop: 0.22, heat: 0.2 });
  const hurt = { frames: [flash(recoil), recoil], durations: [80, 190], loop: false };
  const d0 = mk({ wing: 0.9, neck: 2, bob: -1, heat: 0.9 });
  const d1 = mk({ wing: 0.34, neck: -3, crouch: 3, bob: 2, droop: 0.36, heat: 0.4 });
  const d2 = squashTo(tilt(mk({ wing: 0.2, neck: -4, crouch: 4, bob: 3, droop: 0.5, heat: 0.15 }), 0.32, R(38, SD_S) + SD_DX, R(68, SD_S) + SD_DY), 0.72, SD_H - 3);
  const death = { frames: [d0, d1, d2, squashTo(d2, 0.6, SD_H - 3), squashTo(d2, 0.46, SD_H - 3)], durations: [150, 190, 220, 480, 950], loop: false };
  return { idle, walk, attack, hurt, death };
}

/** Shadow dragon: a 90x80 cell around a 76x72 pose — four legs under a full span, lit from inside. */
export function buildShadowDragon() {
  return { anims: clips(sdAnims), palette: SD, w: SD_W, h: SD_H, pivot: SD_PIV, emissive: 'GH', scale: 1 };
}

// ==========================================================================================
//                                       FYRE DRAKE
// ==========================================================================================
// Read: a SQUAT DRAKE — a barrel of a body slung low between four thick legs, a heavy wedge skull
// carried on a short thick neck, small wings furled tight along the spine, and a club of a tail.
// Molten veins split the basalt hide down both flanks and the fire in them throws light UP onto the
// jaw, the dewlap and the underside of the belly.
//
// WHAT IT USED TO BE, and what each fix is. The old drake had NO DISCERNIBLE HEAD, NECK OR LEGS: it
// was three overlapping ellipses on a 76x60 canvas — one slab of body, one lump at the front that
// was supposed to be a skull, and four capsules that started and finished inside the slab. With an
// orange dotted seam across the middle it read as a lumpy pastry.
//   HEAD  a real skull now: a long wedge with a brow ridge, a jaw hung UNDER it (with the ink of
//         the mouth line between the two), swept horns, a nostril and an ember eye — and it is
//         `gapBlit` inked away from the neck behind it so it never fuses back into the body.
//   NECK  the head is carried on a short thick neck that RISES out of the shoulders. That is also
//         where the extra height in style.js SCALE comes from: the ladder wants a 1.92 creature and
//         the old sprite bought it with a 2.05 density multiplier — a stopgap the file's own
//         comment calls out. Raising the head puts the figure at 66 texels and the multiplier at
//         1.34, in line with the rest of the cast.
//   LEGS  four of them, each with a shoulder/haunch mass, a shank angled out to the elbow or hock,
//         a vertical cannon and `talons` planted on the floor — and the near pair is gap-bitten off
//         the body so the join is an ink line rather than a merge.
//   WING  a folded wing on the FLANK with its wrist knuckle standing clear above the spine: the
//         wing LINE a drake needs to stop reading as a lizard, without the span that would make it
//         another wyvern. (Its first pass was a five-finger `wingFan` at radius 5-14 sitting on the
//         back, which at that size resolves into three ragged spurs — and on the head-on and back
//         facings the pair of them read as two extra little HEADS growing out of the shoulders.)
//
// THE SECOND PASS, once it had a head and legs and still read as a brown farm animal:
//   VALUE   a barrel twenty texels across presents a long shallow arc to the key light, so `tone()`
//           quantised five or six pixels' depth of it into the top hide step and the drake wore a
//           cream saddle that outshone its own skull. `capRim` puts the top of the ramp back on the
//           rim where it belongs, and the belly and jaw plates — undersides, all of them — were
//           moved off the top of THEIR ramp and onto a darker ochre.
//   VEINS   the molten seams ran ALONG the flank: three horizontal bars strapped round a barrel,
//           i.e. a harness, and a 1-px diagonal seam broke into the dotted line this creature was
//           named for. They now fall ACROSS the ribs the way split crust actually opens, and
//           `veins()` fills the elbow of every diagonal step so a seam is 4-connected.
//   HORNS   painted out of the polished-bone ramp and swept back flat, one horn read as a pale
//           hadrosaur crest and a pair of them, head-on, read as rabbit ears. They are dark keratin
//           now, ringed, and head-on they are drawn FORESHORTENED — thick splayed nubs, not the
//           full blade stood on end.
//   TEETH   a fang every second pixel along the jaw is a zip fastener: three, interlocking.
//   FEET    `talons()` puts two pixels of bone on the floor per toe, which under a creature this
//           wide is a row of six white blocks; `fdFoot` keeps the toes hide-coloured and lights
//           one claw pixel each.
// AUTHORED 78x74 IN AN 88x79 CELL, PAINTED AT 1.34x IT — AND THE HEAD IS RAISED FOUR AUTHORED ROWS
// ON TOP OF THAT (`FD_LIFT`). style.js is explicit about this one: the fyre drake is a low sprawling
// salamander whose bulk runs ALONG the floor, so the height its 1.92 slot asks for has to be bought
// by carrying the skull higher on the neck, not by inflating the footprint. A straight 1.42x would
// have made it 125 texels wide; lifting the head lets 1.34 do the job at 118, and the longer neck
// is a better drawing besides — a heavy wedge skull held UP over a barrel slung between four legs.
const FD_S = 1.34;
/** Authored rows the skull is carried higher than it used to be. See the note above. */
const FD_LIFT = 4;
const FD_ASW = 78, FD_ASH = 74, FD_ADX = 5, FD_ADY = 3;
const FD_SW = R(FD_ASW, FD_S), FD_SH = R(FD_ASH, FD_S);
const FD_DX = R(FD_ADX, FD_S), FD_DY = R(FD_ADY, FD_S);
const FD_W = FD_SW + R(10, FD_S), FD_H = FD_SH + R(5, FD_S);
const FD_PIV = { x: R(40, FD_S) + FD_DX, y: R(74, FD_S) + FD_DY };
const FD_SOLE = 72;                                  // the contact row: fills stop here
/**
 * PULL THE LIT PLANE BACK ONTO THE RIM.
 *
 * A barrel twenty texels across presents a long shallow arc to the key light, so `tone()` quantises
 * five or six pixels' DEPTH of that arc into the top step of the hide — and the drake comes back
 * wearing a cream saddle over its shoulders that outshines its own head. Value belongs where the
 * form turns: the top step is allowed within one pixel of air, the step below it within three, and
 * anything further inside the silhouette drops to the body tone. The terminator and the shadow side
 * are untouched, so the form still turns; what goes is the flat blob of highlight in the middle.
 * @param {Pix} p @param {string} keys the material ramp, darkest first
 */
function capRim(p, keys) {
  const ks = [...keys];
  // THE BAND SCALES WITH THE DRAKE. `keep` is a distance in TEXELS from the silhouette, so on a
  // sheet repainted half again as big it kept the same one- and three-texel ribbon and pushed
  // everything else down a step — which took the fyre drake's median value from 0.25 to 0.15 and
  // collapsed the whole animal into the bottom of its own ramp (style.js VALUE_FLOOR).
  for (const [i, keep] of [[ks.length - 1, Math.round(SC(1))], [ks.length - 2, Math.round(SC(3))]]) {
    const step = ks[i].charCodeAt(0), down = ks[i - 1];
    const snap = new Uint16Array(p.d);
    const solid = (x, y) => (x < 0 || y < 0 || x >= p.w || y >= p.h ? 0 : snap[y * p.w + x]);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      if (snap[y * p.w + x] !== step) continue;
      let near = false;
      for (let dy = -keep; dy <= keep && !near; dy++) for (let dx = -keep; dx <= keep; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > keep) continue;
        if (!solid(x + dx, y + dy)) { near = true; break; }
      }
      if (!near) putPx(p, x, y, down);
    }
  }
  return p;
}

/** Seat the pose, plus a cell-space layer for the breath (which reaches past the body's scratch). */
function fdSeat(body, front) {
  const cell = makePix(FD_W, FD_H);
  blit(cell, body, FD_DX, FD_DY);
  if (front) blit(cell, front, 0, 0);
  capRim(cell, FD_HIDE);
  capRim(cell, FD_PLATE);
  return ink(cell);
}
const FD = drakePalette()
  // basalt, not brick: the old '#5e3128' hide was the colour of the floor the drake stands on, so
  // at gameplay distance a three-tile creature vanished into the flagstones. This is cooler and
  // darker, and it makes the veins in it the only warm thing on the animal.
  .band('123456', '#4a332f', HUE)   // cooled basalt hide
  .band('qrstu', '#66452c', HUE)    // dark ochre belly and jaw plate: the fire under it is what glows, not the plate
  .band('vwxyz', '#9b9082', BONE)   // tooth, claw, horn
  .band('ABCDG', '#3d3243', { satShift: 0.02 })   // the folded wing: cold slate, darker than the hide
  .band('HIJKL', '#4a3f36', BONE)   // HORN — dark keratin. 'vwxyz' is polished bone, and a horn
                                    // painted out of it swept back over the neck like a pale
                                    // hadrosaur crest: the brightest shape on a creature whose
                                    // brightest thing is supposed to be the fire inside it.
  .set('k', '#b8401a').set('l', '#ff8f30').set('m', '#ffe6a4')  // vein core / vein / white-hot
  .set('E', '#150e18');   // eye socket, nostril, mouth hollow — the one tone below the whole hide
const FD_HIDE = '123456', FD_PLATE = 'qrstu', FD_HORN = 'HIJK', FD_MEM = 'ABC';
/**
 * Cooled basalt: dark enough that the molten veins in it are the brightest thing on the creature.
 * IT HAD TO COME UP WHEN THE DRAKE GREW. Every form here is a solid whose RIM catches the light and
 * whose interior sits low on the ramp; repainted at 1.34x the interior grows with the square while
 * the rim grows with the side, so the old -0.34 took the sheet's median value from 0.25 down to
 * 0.15 — under style.js VALUE_FLOOR, which is a creature collapsed into the bottom of its own ramp.
 * -0.26 puts the basalt back where it read at the size the ladder now asks for.
 */
const FD_TB = -0.26;

/**
 * THE LIGHT PLANE for the drake, the same device the demon uses (monsters/boss.js): `tone()` lights
 * every mass about its own centre, which models a form and leaves the ANIMAL unlit. This is how far
 * up its ramp a form sitting at (x, y) starts — brighter toward the top-left of the figure.
 */
const fgl = (x, y) => FD_TB + 0.08 * ((40 - x) / 38) + 0.15 * ((44 - y) / 36);
const FM = (p, cx, cy, rx, ry, keys, o = {}) => mass(p, cx, cy, rx, ry, keys, { ...o, bias: (o.bias || 0) + fgl(cx, cy) - TB });
const FC = (p, pts, r0, r1, keys, bias = 0) => {
  let sx = 0, sy = 0;
  for (const q of pts) { sx += q[0]; sy += q[1]; }
  return C(p, pts, r0, r1, keys, bias + fgl(sx / pts.length, sy / pts.length) - TB);
};
const FL = (p, x0, y0, x1, y1, r0, r1, keys, bias = 0) =>
  LB(p, x0, y0, x1, y1, r0, r1, keys, bias + fgl((x0 + x1) / 2, (y0 + y1) / 2) - TB);

/** Lay `q` over `p` with a one-pixel gap bitten out of it, so the ink pass separates the two. */
function fdGap(p, q, r = 1) {
  for (let y = 0; y < q.h; y++) for (let x = 0; x < q.w; x++) {
    if (!q.d[y * q.w + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) putPx(p, x + dx, y + dy, 0);
  }
  return blit(p, q, 0, 0);
}

/** A molten vein: a broken seam that brightens where the hide has split widest. */
function veins(p, pts, heat) {
  let n0 = 0, lx = -9, ly = -9;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay)));
    for (let s = 0; s <= n; s++, n0++) {
      const t = s / n, x = Math.round(lerp(ax, bx, t)), y = Math.round(lerp(ay, by, t));
      // a 1-px DIAGONAL run touches only at its corners, which at gameplay distance is exactly the
      // dotted seam this drake was named after: fill the elbow so the seam is 4-connected
      if (s > 0 && x !== lx && y !== ly && atPx(p, lx, y)) setPx(p, lx, y, 'l');
      lx = x; ly = y;
      if (!atPx(p, x, y)) continue;
      // CONTINUOUS, and lipped: the seam itself never breaks, a char lip runs under it and the
      // hide above it is pulled back to its darkest step. A vein drawn as alternating hot and dark
      // pixels (which is what this used to be) reads at gameplay distance as a dotted line.
      setPx(p, x, y, n0 % 5 === 0 && heat > 0.45 ? 'm' : 'l');
      if (atPx(p, x, y + 1)) setPx(p, x, y + 1, 'k');
      if (atPx(p, x, y - 1)) setPx(p, x, y - 1, 'q');
    }
  }
}

/**
 * The fire under it, painted as an interior under-light: one row in from the silhouette so the
 * bottom rim stays dark and the KEY LIGHT still reads top-left (style.js KEY_LIGHT_MIN).
 */
function underLight(p, x0, x1, y, key) {
  for (let x = x0; x <= x1; x++) {
    if (!atPx(p, x, y) || !atPx(p, x, y + 1)) continue;
    setPx(p, x, y, key);
  }
}

/** A gout of fire from the jaws. */
function gout(p, x, y, dx, dy, len) {
  for (let i = 0; i < len; i++) {
    const t = i / len, r = 1 + t * 3.4;
    for (let j = -Math.round(r); j <= Math.round(r); j++) {
      const px = Math.round(x + dx * i - dy * j), py = Math.round(y + dy * i + dx * j);
      setPx(p, px, py, Math.abs(j) < r * 0.4 ? 'm' : Math.abs(j) < r * 0.75 ? 'l' : 'k');
    }
  }
}

/**
 * THE DRAKE'S FOOT. `talons()` puts two pixels of bone on the floor per toe, which on a creature
 * this wide came back as a row of six white blocks under each leg — a zip fastener lying on the
 * flagstones. Here the toes are hide and only the leading pixel of each claw catches light.
 */
function fdFoot(p, cx, y, dir) {
  const c = Math.round(cx);
  for (let i = -3; i <= 4; i++) setPx(p, c + i * dir, y - 3, '2');          // the arch
  for (const off of [-3, 0, 3]) {
    const tx = c + off * dir;
    for (let r = 2; r >= 1; r--) { setPx(p, tx, y - r, '3'); setPx(p, tx + dir, y - r, '2'); }
    setPx(p, tx, y, '2'); setPx(p, tx + dir, y, 'w');                       // one lit claw each
  }
  setPx(p, c - 5 * dir, y - 2, '2'); setPx(p, c - 5 * dir, y - 1, '2'); setPx(p, c - 5 * dir, y, 'w');
  return p;
}

/**
 * ONE LEG, in four pieces and drawn into its own scratch so the caller can bite an ink gap between
 * it and the barrel it hangs off. `dir` points the knee/hock away from the body; `sweep` is how far
 * forward or back the foot is planted.
 */
function fdLeg(p, hx, hy, dir, sweep, lift, bias, gap = true) {
  const q = gap ? makePix(p.w, p.h) : p;
  const sole = FD_SOLE - lift;
  FM(q, hx, hy, 5.2, 6.4, FD_HIDE, { n: 2.5, bias: bias - 0.30 });                    // shoulder / haunch
  FC(q, [[hx, hy + 3], [hx + dir * 3.4, hy + 8], [hx + dir * 2 + sweep, hy + 13]], 3.8, 2.6, FD_HIDE, bias - 0.22);
  FL(q, hx + dir * 2 + sweep, hy + 12, hx + dir * 1.4 + sweep, sole - 4, 2.6, 2.2, FD_HIDE, bias - 0.30);
  // THE HOCK CREASE: one dark row where the shank meets the cannon. Without it the two capsules
  // fuse into a single rounded slab and the leg has no joint anywhere along its length.
  for (let x = -4; x <= 4; x++) {
    const px = Math.round(hx + dir * 2 + sweep) + x, py = Math.round(hy + 12);
    if (atPx(q, px, py)) setPx(q, px, py, x < -1 ? '2' : '1');
  }
  fdFoot(q, hx + dir * 1.4 + sweep, sole, dir >= 0 ? 1 : -1);
  return gap ? fdGap(p, q) : p;
}

/**
 * THE SKULL. A long wedge with a brow ridge over the eye, a slab jaw slung under it with the ink of
 * the mouth line between, two horns swept back off the crown, a nostril and one ember eye.
 * @param {number} dir +1 = facing right @param {boolean} both draw the far horn as well
 */
function fdHead(p, hx, hy, dir, heat, both = false) {
  const q = makePix(p.w, p.h);
  FM(q, hx, hy, 7.4, 5.0, FD_HIDE, { n: 2.7, bias: -0.12 });                          // the cranium
  FL(q, hx + dir * 3, hy + 1, hx + dir * 9, hy + 2, 4.4, 2.5, FD_HIDE, -0.22);        // the muzzle
  FM(q, hx - dir * 1, hy - 4, 6.2, 1.8, FD_HIDE, { n: 3.2, bias: 0.0 });              // the brow ridge
  FL(q, hx + dir * 1, hy + 5, hx + dir * 9, hy + 4, 2.8, 1.6, FD_PLATE, -0.14);       // the jaw, slung under
  for (let x = 1; x <= 9; x++) {                                                      // THE MOUTH LINE
    const mx = hx + dir * x, my = hy + 3;
    if (atPx(q, mx, my)) setPx(q, mx, my, '#');
  }
  // THREE fangs, interlocking, not a comb of them every second pixel: at this scale an even row
  // reads as a zip fastener sewn along the jaw.
  for (const t of [2, 5, 8]) if (atPx(q, hx + dir * t, hy + 2)) setPx(q, hx + dir * t, hy + 2, 'y');
  for (const t of [3, 6]) if (atPx(q, hx + dir * t, hy + 4)) setPx(q, hx + dir * t, hy + 4, 'x');
  // A PAIR of short thick horns off the crown, swept back over the neck — the near one over the
  // far one, so a profile still reads two. A single long blade here is a duck-billed crest.
  C(q, [[hx - dir * 5, hy - 4], [hx - dir * 8, hy - 9], [hx - dir * 10, hy - 13]], 1.6, 0.5, FD_HORN, TB - 0.46);
  // the NEAR horn is bitten in over the far one, so the ink pass lays a line between the two and a
  // profile still reads a pair instead of one dark clump on the crown
  { const h = makePix(q.w, q.h);
    C(h, [[hx - dir * 1, hy - 5], [hx - dir * 3, hy - 10], [hx - dir * 4, hy - 15]], 2.2, 0.6, FD_HORN, TB - 0.18);
    fdGap(q, h); }
  if (both) C(q, [[hx + dir * 3, hy - 5], [hx + dir * 6, hy - 10], [hx + dir * 8, hy - 14]], 2.2, 0.6, FD_HORN, TB - 0.46);
  setPx(q, hx + dir * 9, hy + 1, 'E');                                                // the nostril
  // the eye: a SLIT under the brow, not a lit panel. Four dark pixels and two of ember.
  for (let x = 1; x <= 3; x++) for (let y = -1; y <= 0; y++) if (atPx(q, hx + dir * x, hy + y)) setPx(q, hx + dir * x, hy + y, 'E');
  setPx(q, hx + dir * 2, hy, heat > 0.4 ? 'm' : 'l');
  if (heat > 0.6) underLight(q, Math.min(hx + dir * 2, hx + dir * 9), Math.max(hx + dir * 2, hx + dir * 9), hy + 6, 'k');
  return fdGap(p, q);
}

/**
 * THE FOLDED WING, ON THE FLANK — the wing LINE a drake needs so it does not read as a lizard,
 * without the span that would make it a second wyvern.
 *
 * WHAT THIS REPLACES. The old furled wing was a five-finger `wingFan` at radius 5-14 sitting on the
 * spine: at that size the fan resolves into three or four ragged spurs, and on the head-on and
 * back facings the pair of them read as two extra little HEADS poking out of the shoulders. This
 * draws the thing a folded wing actually is — a wrist knuckle standing above the shoulder and a
 * tapered leather blade folded back down the ribs from it, with the finger bones showing through —
 * in the one colour on the animal that is neither basalt nor fire, so it separates by hue as well
 * as by value.
 * @param {Pix} p @param {number} sx @param {number} sy the shoulder
 * @param {number} dir +1 = the animal faces screen right, so the wing folds back to the left
 */
function fdWingSide(p, sx, sy, dir) {
  const q = makePix(p.w, p.h);
  // the knuckle stands ABOVE the spine: a folded wing that never breaks the back's silhouette is
  // just a dark patch on the ribs, and the whole point of it is the wing LINE
  const wx = sx - dir * 4, wy = sy - 13;
  FC(q, [[wx, wy + 1], [wx - dir * 7, wy + 7], [wx - dir * 15, wy + 15]], 4.2, 1.1, FD_MEM, -0.36);
  FL(q, sx, sy, wx, wy + 1, 2.8, 1.9, FD_MEM, -0.42);
  // one pixel of light down the leading edge, so the fold reads as leather and not as shadow
  for (let i = 0; i <= 14; i++) {
    const x = Math.round(wx - dir * i), y = Math.round(wy + 1 + i * 0.55);
    if ('AB'.includes(String.fromCharCode(atPx(q, x, y - 1)))) setPx(q, x, y - 1, 'C');
  }
  // the finger bones lying across the fold, drawn only where the membrane already is
  for (let i = 1; i <= 3; i++) {
    const t = i / 4, ex = wx - dir * 15 * t, ey = wy + 15 * t;
    const n = Math.max(2, Math.round(Math.hypot(ex - wx, ey - wy)));
    for (let j = 0; j <= n; j++) {
      const x = Math.round(lerp(wx, ex, j / n)), y = Math.round(lerp(wy, ey, j / n));
      if ('AB'.includes(String.fromCharCode(atPx(q, x, y)))) setPx(q, x, y, 'C');
    }
  }
  setPx(q, Math.round(wx + dir), Math.round(wy - 2), 'x');                // the wrist claw
  setPx(q, Math.round(wx + dir), Math.round(wy - 1), 'w');
  return fdGap(p, q);
}

/**
 * The same wing seen from the front or the back: a short leather blade standing up and out off the
 * shoulder with the wrist claw at its crown — enough to break the shoulder line, never enough to
 * be mistaken for a span.
 */
function fdWingBack(p, cx, cy, dir) {
  const q = makePix(p.w, p.h);
  const wx = cx + dir * 5, wy = cy - 9;
  FC(q, [[cx, cy + 3], [cx + dir * 3, cy - 3], [wx, wy]], 3.2, 1.3, FD_MEM, -0.42);
  setPx(q, Math.round(wx + dir), Math.round(wy), 'x');
  setPx(q, Math.round(wx), Math.round(wy - 1), 'w');
  return fdGap(p, q);
}

/**
 * THE SKULL, HEAD-ON. The profile head (`fdHead`) drawn straight at the camera gives a muzzle
 * pointing off to one side and one horn where there should be two — which is how the front facing
 * ended up with a pair of swept horns sitting either side of the mouth like a handlebar moustache.
 * This is its own drawing: a broad brow wider than the cranium, the snout coming AT the viewer, a
 * jaw slung under an ink mouth line with three interlocking fangs, two ember eyes in dark sockets,
 * and both horns leaving the CROWN and sweeping back and out.
 */
function fdHeadFront(p, hx, hy, heat) {
  const q = makePix(p.w, p.h);
  FM(q, hx, hy, 7.8, 4.8, FD_HIDE, { n: 2.7, bias: -0.10 });                          // the cranium
  FM(q, hx, hy - 3, 9.0, 2.4, FD_HIDE, { n: 3.4, bias: -0.06 });                      // the brow shelf
  FM(q, hx, hy + 5, 5.4, 3.4, FD_HIDE, { n: 2.6, bias: -0.14 });                      // the snout
  FM(q, hx, hy + 8, 5.0, 2.0, FD_PLATE, { n: 3.0, bias: -0.40 });                     // the jaw
  for (let x = hx - 6; x <= hx + 6; x++) for (let y = 6; y <= 7; y++) {                // THE MOUTH LINE
    if (atPx(q, x, hy + y)) setPx(q, x, hy + y, '#');
  }
  for (const fx of [hx - 5, hx, hx + 5]) if (atPx(q, fx, hy + 6)) setPx(q, fx, hy + 6, 'y');
  for (const fx of [hx - 3, hx + 3]) if (atPx(q, fx, hy + 7)) setPx(q, fx, hy + 7, 'x');
  for (const ex of [hx - 5, hx + 3]) {                                                 // the eye pits
    for (let x = 0; x <= 2; x++) for (let y = -1; y <= 1; y++) if (atPx(q, ex + x, hy + y)) setPx(q, ex + x, hy + y, 'E');
    for (let x = 0; x <= 1; x++) if (atPx(q, ex + x, hy)) setPx(q, ex + x, hy, heat > 0.4 ? 'm' : 'l');
  }
  setPx(q, hx - 2, hy + 4, 'E'); setPx(q, hx + 2, hy + 4, 'E');                         // the nostrils
  for (let x = hx - 7; x <= hx + 7; x++) if (atPx(q, x, hy - 2)) setPx(q, x, hy - 2, '1');  // under the brow
  // HEAD-ON, A BACK-SWEPT HORN IS A STUB. Drawn at its true length it stands straight up off the
  // skull as a long tapering blade — which, in a pair, either side of a rounded cranium, is a
  // rabbit. Foreshortened it is what it should be: a thick splayed nub at each top corner.
  for (const d of [-1, 1]) {
    C(q, [[hx + d * 4, hy - 3], [hx + d * 9, hy - 5], [hx + d * 14, hy - 7]], 2.8, 0.7, FD_HORN, TB - (d < 0 ? 0.22 : 0.42));
    // growth rings: three dark bands across the horn. Without them a tapered cone at this size is
    // an ear, whatever angle it leaves the skull at.
    for (const t of [4, 7, 10]) for (let k = -3; k <= 3; k++) {
      const x = Math.round(hx + d * (4 + t)), y = Math.round(hy - 3 - t * 0.28) + k;
      if ('IJK'.includes(String.fromCharCode(atPx(q, x, y)))) setPx(q, x, y, 'H');
    }
  }
  return fdGap(p, q);
}

/**
 * One fyre-drake frame.
 * @param {'S'|'E'|'N'} f
 * @param {{bob?:number, gait?:number, tail?:number, heat?:number, rear?:number, breath?:number, crouch?:number}} o
 */
function fdFrame(f, o = {}) {
  drawAt(FD_S);
  const p = makePix(FD_SW, FD_SH);
  const fx = o.breath ? makePix(FD_W, FD_H) : null;
  TB = FD_TB;
  const b = (o.bob || 0) + (o.crouch || 0), g = o.gait || 0, heat = o.heat ?? 0.5;
  const rear = o.rear || 0, sw = [0, -4, 4][(o.tail || 0) % 3];

  if (f === 'E') {
    // PROFILE, facing right. Tail, far pair of legs, barrel, wing, neck, skull, near pair of legs.
    const bodyY = 44 + b - rear;
    FC(p, [[24, bodyY + 2], [14, bodyY + 6 + sw * 0.3], [6, bodyY + 2 + sw * 0.7], [2, bodyY - 6 + sw]], 6.6, 1.6, FD_HIDE, -0.10);
    fdLeg(p, 30, 50 + b, -1, -2, Math.max(0, g) * 2, -0.24, false);                    // far hind
    fdLeg(p, 52, 50 + b, 1, 1, Math.max(0, -g) * 2, -0.22, false);                     // far fore
    // the barrel: deep, slung low, deeper at the chest than at the hip
    FM(p, 40, bodyY, 20.0, 10.4, FD_HIDE, { n: 2.7, bias: -0.18 });
    FM(p, 50, bodyY + 1, 12.0, 9.4, FD_HIDE, { n: 2.6, bias: -0.14 });                 // the chest
    // the belly plates sit in the animal's OWN shadow — an underside lit from the top left is the
    // darkest plane on it, and this band came back the palest thing in the frame
    FM(p, 42, bodyY + 8, 15.0, 4.4, FD_PLATE, { n: 2.9, bias: -0.46 });                // the belly plates
    crest(p, [[22, bodyY - 6], [32, bodyY - 9], [44, bodyY - 10], [54, bodyY - 8]], 5, '1223', { tip: 'v' });
    fdWingSide(p, 50, bodyY - 4, 1);
    // THE NECK: short, thick, and it RISES — this is where the drake's height comes from
    FC(p, [[53, bodyY - 6], [60, 32 - FD_LIFT * 0.5 + b - rear], [64, 27 - FD_LIFT + b - rear * 1.4]], 8.4, 6.2, FD_HIDE, -0.04);
    fdHead(p, 66, 21 - FD_LIFT + b - rear * 1.6, 1, heat);
    // THE VEINS GO ON THE BODY, BEFORE THE NEAR LEGS. Painted afterwards they run straight across
    // the leg in front of it, and a molten seam crossing a limb reads as a harness strap.
    // THE VEINS RUN WITH THE RIBS, DOWN. Drawn along the flank they came back as three horizontal
    // bars strapped round the barrel — a harness, or the "orange dotted seam" this drake is named
    // for. Split crust opens ACROSS the direction the hide is stretched, so the seams fall.
    veins(p, [[33, bodyY - 9], [32, bodyY - 2], [34, bodyY + 5]], heat);
    veins(p, [[43, bodyY - 10], [42, bodyY - 3], [44, bodyY + 4]], heat * 0.85);
    veins(p, [[25, bodyY - 6], [24, bodyY + 1]], heat * 0.7);
    veins(p, [[58, 32 - FD_LIFT * 0.5 + b - rear], [63, 26 - FD_LIFT + b - rear * 1.3]], heat);
    fdLeg(p, 34, 50 + b, -1, 2, Math.max(0, -g) * 2, -0.04);                           // near hind
    fdLeg(p, 55, 51 + b, 1, -1, Math.max(0, g) * 2, 0.0);                              // near fore
    underLight(p, 32, 52, bodyY + 11, 'k');
    if (fx) gout(fx, 76 + FD_ADX, 22 - FD_LIFT + b - rear * 1.6 + FD_ADY, 1, 0, o.breath);
    return fdSeat(p, fx);
  }

  if (f === 'S') {
    // HEAD-ON: the skull is raised over a deep chest, the barrel recedes behind it, the four legs
    // splay wide and the tail lashes out to the screen left.
    const bodyY = 48 + b - rear;
    FC(p, [[34, bodyY], [24 + sw * 0.4, bodyY - 5], [13 + sw, bodyY - 8], [5 + sw * 1.4, bodyY - 3]], 5.6, 1.4, FD_HIDE, -0.18);
    fdLeg(p, 22, 48 + b, -1, -1, Math.max(0, g) * 2, -0.20, false);                    // far hind
    fdLeg(p, 58, 48 + b, 1, 1, Math.max(0, -g) * 2, -0.24, false);                     // far hind
    FM(p, 40, bodyY, 19.0, 9.6, FD_HIDE, { n: 2.7, bias: -0.18 });                     // the barrel behind
    crest(p, [[28, bodyY - 7], [40, bodyY - 9], [52, bodyY - 7]], 4, '1223', { tip: 'v' });
    fdWingBack(p, 26, bodyY - 6, -1);
    fdWingBack(p, 54, bodyY - 6, 1);
    FM(p, 40, 40 + b, 13.4, 8.6, FD_HIDE, { n: 2.6, bias: -0.12 });                    // the chest
    FM(p, 40, 45 + b, 10.0, 4.4, FD_PLATE, { n: 2.9, bias: -0.42 });                   // the breast plates
    // head-on the veins run DOWN the chest, not across it: three parallel bars stacked on a
    // barrel read as a radiator grille, which is how the old drake got its "orange seam" — and
    // they go on before the near legs, so no seam ever crosses a limb like a harness strap
    veins(p, [[37, 34 + b], [35, 40 + b], [37, 46 + b]], heat);
    veins(p, [[44, 34 + b], [46, 40 + b], [44, 46 + b]], heat * 0.85);
    veins(p, [[40, 33 + b], [40, 43 + b]], heat * 0.7);
    fdLeg(p, 28, 44 + b, -1, -2, Math.max(0, -g) * 2, -0.02);                          // near fore
    fdLeg(p, 52, 44 + b, 1, 2, Math.max(0, g) * 2, -0.10);                             // near fore
    FC(p, [[40, 38 + b], [40, 33 - FD_LIFT * 0.5 + b - rear], [40, 29 - FD_LIFT + b - rear]], 7.6, 6.2, FD_HIDE, -0.02);
    fdHeadFront(p, 40, 23 - FD_LIFT + b - rear, heat);

    if (fx) gout(fx, 40 + FD_ADX, 30 - FD_LIFT + b - rear + FD_ADY, 0, 1, o.breath);
    return fdSeat(p, fx);
  }

  // NORTH — walking away: the tail runs at the camera, the crest runs up the spine and the back of
  // the skull sits over the shoulders with the two horns standing out past it.
  const bodyY = 44 + b;
  FC(p, [[40, bodyY + 4], [39 + sw * 0.4, 56 + b], [37 + sw, 66 + b]], 6.0, 1.6, FD_HIDE, 0.04);
  fdLeg(p, 22, 46 + b, -1, -1, Math.max(0, g) * 2, -0.18, false);
  fdLeg(p, 58, 46 + b, 1, 1, Math.max(0, -g) * 2, -0.22, false);
  fdLeg(p, 26, 42 + b, -1, -2, Math.max(0, -g) * 2, -0.06);
  fdLeg(p, 54, 42 + b, 1, 2, Math.max(0, g) * 2, -0.12);
  FM(p, 40, bodyY, 19.0, 10.0, FD_HIDE, { n: 2.7, bias: -0.18 });
  fdWingBack(p, 27, bodyY - 6, -1);
  fdWingBack(p, 53, bodyY - 6, 1);
  crest(p, [[40, bodyY - 9], [40, bodyY - 1], [40, bodyY + 6]], 4, '1223', { tip: 'v' });
  FC(p, [[40, 36 + b], [40, 31 - FD_LIFT * 0.5 + b], [40, 28 - FD_LIFT + b]], 7.6, 6.2, FD_HIDE, -0.06);
  { const q = makePix(FD_SW, FD_SH);
    FM(q, 40, 23 - FD_LIFT + b, 7.4, 5.2, FD_HIDE, { n: 2.7, bias: -0.26 });
    C(q, [[36, 19 - FD_LIFT + b], [31, 16 - FD_LIFT + b], [26, 14 - FD_LIFT + b]], 2.1, 0.6, FD_HORN, TB - 0.26);
    C(q, [[44, 19 - FD_LIFT + b], [49, 16 - FD_LIFT + b], [54, 14 - FD_LIFT + b]], 2.1, 0.6, FD_HORN, TB - 0.40);
    fdGap(p, q); }
  veins(p, [[28, bodyY - 4], [32, bodyY + 6]], heat);
  veins(p, [[52, bodyY - 4], [48, bodyY + 6]], heat);
  return fdSeat(p, fx);
}

function fdAnims(f) {
  const mk = (o) => fdFrame(f, o);
  const idle = {
    frames: [mk({ heat: 0.3, tail: 0 }), mk({ bob: -1, heat: 0.75, tail: 1 }), mk({ heat: 1, tail: 2 }), mk({ bob: -1, heat: 0.5, tail: 1 })],
    durations: [330, 270, 310, 280], loop: true,
  };
  // a heavy sprawling waddle: the whole barrel rocks, it never leaves the floor
  const walk = {
    frames: [mk({ gait: 1, tail: 1, heat: 0.6 }), mk({ gait: 0.3, bob: -1, tail: 2, heat: 0.45 }), mk({ gait: -1, tail: 1, heat: 0.7 }), mk({ gait: -0.3, bob: -1, tail: 0, heat: 0.5 })],
    durations: [130, 130, 130, 130], loop: true,
  };
  const attack = {
    frames: [mk({ rear: 3, tail: 2, heat: 1, bob: -1 }), mk({ rear: 2, tail: 2, heat: 1, breath: 3 }), mk({ rear: 0, tail: 0, heat: 1, breath: 6 }), mk({ rear: 0, tail: 1, heat: 0.6 })],
    durations: [170, 90, 140, 180], loop: false,
  };
  const recoil = mk({ bob: 2, tail: 2, heat: 0.15 });
  const hurt = { frames: [flash(recoil), recoil], durations: [70, 180], loop: false };
  const d0 = mk({ bob: 1, tail: 2, heat: 0.9 });
  const d1 = mk({ bob: 3, tail: 1, heat: 0.45 });
  const d2 = squashTo(mk({ bob: 4, tail: 0, heat: 0.15 }), 0.7, FD_H - 3);
  const death = { frames: [d0, d1, d2, squashTo(d2, 0.62, FD_H - 3), squashTo(d2, 0.5, FD_H - 3)], durations: [130, 160, 200, 480, 860], loop: false };
  return { idle, walk, attack, hurt, death };
}

/** Fyre drake: an 88x79 cell around a 78x74 pose — a squat molten drake with its head up. */
export function buildFyreDrake() {
  return { anims: clips(fdAnims), palette: FD, w: FD_W, h: FD_H, pivot: FD_PIV, emissive: 'lm', scale: 1 };
}

// ==========================================================================================
//                                    DIMENSION SPIDER
// ==========================================================================================
// Read: EIGHT legs, and only half of it is here. Each leg is three tapering segments — femur out
// and UP so the knees stand above the body, tibia down and out, a one-pixel foot on the floor —
// which is what a spider's legs actually do and what the old six untapered sticks never did. A
// violet echo of the whole animal stands a pixel out of register behind it, and a cold shimmer
// crawls the carapace: it is not walking across the room, it is arriving in it.
// AUTHORED 52x46 IN A 60x51 CELL, PAINTED AT 1.39x IT. A depth-8 horror (style.js: 1.15) whose art
// stood 38 texels — 0.83 of the hero, i.e. SMALLER THAN THE MAN IT AMBUSHES, and smaller than a
// depth-1 hobgoblin. Re-rasterised it stands 53: still crouched and wide, but never a mook. Each
// leg segment gains a texel, which is what lets the three joints read as three joints.
const DSP_S = 1.39;
const DS_ASW = 52, DS_ASH = 46, DS_ADX = 4, DS_ADY = 2;
const DS_SW = R(DS_ASW, DSP_S), DS_SH = R(DS_ASH, DSP_S);
const DS_DX = R(DS_ADX, DSP_S), DS_DY = R(DS_ADY, DSP_S);
const DS_W = DS_SW + R(8, DSP_S), DS_H = DS_SH + R(5, DSP_S);
const DS_PIV = { x: R(26, DSP_S) + DS_DX, y: R(44, DSP_S) + DS_DY };
const dsDone = pad(DS_W, DS_H, DS_DX, DS_DY);
const DS = drakePalette()
  .band('123456', '#3c4a68', HUE)   // cold slate carapace: violet-navy in shadow, teal in the light
  .band('qrstu', '#5d5078', HUE)    // violet underside and joints
  .set('v', '#5b4a80')              // the echo: the half of it that is elsewhere
  .set('x', '#a8ecff').set('y', '#e8f8ff')                      // shimmer, glint (emissive)
  .set('E', '#1b1526').set('Y', '#c8f0ff');                     // eye socket, eye (emissive)
const DS_SHELL = '123456', DS_JOINT = 'qrstu';
/** Cold chitin: the shell sits below its own highlights so the shimmer and the eyes stay the bright notes. */
const DS_TB = -0.13;

/**
 * One jointed leg: femur up-and-out to a knee ABOVE the body, tibia down-and-out, tarsus to the
 * floor. The radius tapers 3.0 -> 0.6 along the whole run, so it reads as a leg and not a stick.
 * @param {Pix} p @param {number} bx @param {number} by body attachment
 * @param {number} dir +1 = to the screen right
 * @param {{reach:number, knee:number, foot:number, lift?:number, bias?:number}} o
 */
function spiderLeg(p, bx, by, dir, o) {
  const kx = bx + dir * o.reach * 0.44, ky = by - o.knee;
  const ax = bx + dir * o.reach * 0.88, ay = by + o.reach * 0.16;
  const fx = bx + dir * o.reach, fy = o.foot - (o.lift || 0);
  const bias = o.bias || 0;
  C(p, [[bx, by], [kx, ky]], 3.0, 2.1, DS_SHELL, bias);
  C(p, [[kx, ky], [ax, ay]], 2.1, 1.3, DS_SHELL, bias - 0.04);
  C(p, [[ax, ay], [fx, fy]], 1.3, 0.6, DS_SHELL, bias - 0.08);
  setPx(p, Math.round(kx), Math.round(ky) - 1, 't');     // a pale knee-joint plate catches the key light
  setPx(p, Math.round(fx), Math.round(fy) + 1, '#');
}

/** The violet echo: the same silhouette, one pixel out of register, painted only where nothing else is. */
function echo(p, dx, dy) {
  const src = { w: p.w, h: p.h, d: new Uint16Array(p.d) };
  const V = 'v'.charCodeAt(0);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (!src.d[y * src.w + x]) continue;
    const tx = x + dx, ty = y + dy;
    if (tx < 0 || ty < 0 || tx >= p.w || ty >= p.h) continue;
    if (p.d[ty * p.w + tx]) continue;
    p.d[ty * p.w + tx] = V;
  }
  return p;
}

/** Four sparks of shimmer that crawl the carapace on a fixed four-beat (no RNG anywhere in art). */
const DS_SHIMMER = [[-4, -3], [3, -4], [5, 1], [-5, 2], [0, -5], [-2, 3], [4, -1], [2, 4]];
function shimmer(p, cx, cy, phase) {
  for (let i = 0; i < 4; i++) {
    const [dx, dy] = DS_SHIMMER[(phase * 2 + i) % DS_SHIMMER.length];
    const x = Math.round(cx + dx), y = Math.round(cy + dy);
    if (!atPx(p, x, y)) continue;
    setPx(p, x, y, i & 1 ? 'x' : 'y');
  }
}

/**
 * One dimension-spider frame.
 * @param {'S'|'E'|'N'} f
 * @param {{bob?:number, gait?:number, phase?:number, rear?:number, blink?:number, drop?:number}} o
 */
function dsFrame(f, o = {}) {
  drawAt(DSP_S);
  const p = makePix(DS_SW, DS_SH);
  TB = DS_TB;
  const b = (o.bob || 0) + (o.drop || 0), g = o.gait || 0, rear = o.rear || 0;
  const floor = 42;
  const cx = 26, cy = 28 + b - rear;

  // the eight legs: alternating pairs lift on the walk beat, and each pair reaches further back
  const REACH = [[11, 13, -1.6], [16, 16, -0.4], [18, 15, 0.9], [14, 11, 2.2]];
  for (let i = 0; i < 4; i++) {
    const [reach, knee, back] = REACH[i];
    const lift = (i % 2 === 0 ? Math.max(0, g) : Math.max(0, -g)) * 3;
    if (f === 'N') {
      spiderLeg(p, cx - 4, cy + back * 0.6, -1, { reach, knee: knee - 1, foot: floor - i, lift, bias: -0.12 });
      spiderLeg(p, cx + 4, cy + back * 0.6, 1, { reach, knee: knee - 1, foot: floor - i, lift: (i % 2 ? Math.max(0, g) : Math.max(0, -g)) * 3, bias: -0.18 });
    } else if (f === 'E') {
      // side on: the far four sit a tone back and a row higher
      spiderLeg(p, cx - 6 + i * 4, cy - 1, i < 2 ? -1 : 1, { reach: reach - 2, knee: knee - 2, foot: floor - 2, lift, bias: -0.22 });
    } else {
      spiderLeg(p, cx - 5, cy + back, -1, { reach, knee, foot: floor - i, lift, bias: -0.04 });
      spiderLeg(p, cx + 5, cy + back, 1, { reach, knee, foot: floor - i, lift: (i % 2 ? Math.max(0, g) : Math.max(0, -g)) * 3, bias: -0.10 });
    }
  }
  if (f === 'E') {
    for (let i = 0; i < 4; i++) {
      const [reach, knee] = REACH[i];
      const lift = (i % 2 ? Math.max(0, g) : Math.max(0, -g)) * 3;
      spiderLeg(p, cx - 6 + i * 4, cy + 2, i < 2 ? -1 : 1, { reach, knee, foot: floor, lift, bias: 0 });
    }
    // abdomen behind, cephalothorax in front, the head end carried low
    M(p, cx - 10, cy, 9.0, 7.0, DS_SHELL, { n: 2.4 });
    LB(p, cx - 3, cy + 1, cx + 1, cy + 2, 2.2, 2.4, DS_JOINT, -0.22);     // the pedicel
    M(p, cx + 6, cy + 2, 6.4, 5.0, DS_SHELL, { n: 2.3, bias: 0.05 });
    M(p, cx + 4, cy + 4, 4.4, 2.6, DS_JOINT, { n: 2.6, bias: 0.04 });
    for (const [ex, ey] of [[cx + 8, cy], [cx + 10, cy + 1]]) { setPx(p, ex, ey, 'E'); setPx(p, ex + 1, ey, 'Y'); }
    LB(p, cx + 10, cy + 4, cx + 13, cy + 6, 1.6, 0.8, DS_JOINT, 0.02);    // a chelicera
  } else if (f === 'N') {
    M(p, cx, cy + 6, 9.4, 7.4, DS_SHELL, { n: 2.4, bias: -0.06 });        // the abdomen, seen from behind
    LB(p, cx, cy, cx, cy + 3, 2.0, 2.6, DS_JOINT, -0.24);                 // the pedicel
    M(p, cx, cy - 5, 6.6, 4.4, DS_SHELL, { n: 2.3, bias: -0.02 });
    for (let i = 0; i < 3; i++) { setPx(p, cx - 3 + i * 3, cy + 4, 'q'); setPx(p, cx - 3 + i * 3, cy + 8, 'q'); }
    LB(p, cx - 2, cy + 12, cx - 3, cy + 15, 1.6, 0.8, DS_JOINT, -0.1);     // spinnerets
    LB(p, cx + 2, cy + 12, cx + 3, cy + 15, 1.6, 0.8, DS_JOINT, -0.14);
  } else {
    M(p, cx, cy + 7, 9.4, 6.8, DS_SHELL, { n: 2.4 });                     // abdomen, well behind
    LB(p, cx, cy + 1, cx, cy + 4, 2.0, 2.6, DS_JOINT, -0.22);             // the pedicel: the pinch
    M(p, cx, cy - 3, 7.4, 5.2, DS_SHELL, { n: 2.3, bias: 0.05 });         // cephalothorax
    M(p, cx, cy + 8, 4.6, 3.2, DS_JOINT, { n: 2.4, bias: 0.04 });         // pale underside
    // eight eyes: a big forward pair over a row of six small ones
    setPx(p, cx - 3, cy - 4, 'E'); setPx(p, cx - 2, cy - 4, 'Y');
    setPx(p, cx + 2, cy - 4, 'E'); setPx(p, cx + 3, cy - 4, 'Y');
    for (let i = 0; i < 3; i++) { setPx(p, cx - 4 + i * 2, cy - 1, 'Y'); setPx(p, cx + 1 + i * 2, cy - 1, 'E'); }
    LB(p, cx - 3, cy + 1, cx - 4, cy + 4, 1.8, 0.9, DS_JOINT, 0.04);       // chelicerae
    LB(p, cx + 3, cy + 1, cx + 4, cy + 4, 1.8, 0.9, DS_JOINT, -0.04);
  }
  shimmer(p, cx, cy, o.phase || 0);
  echo(p, o.blink ? 3 : 1, o.blink ? -2 : -1);
  return dsDone(p);
}

function dsAnims(f) {
  const mk = (o) => dsFrame(f, o);
  const idle = {
    frames: [mk({ phase: 0 }), mk({ bob: -1, phase: 1 }), mk({ phase: 2 }), mk({ bob: -1, phase: 3 })],
    durations: [300, 260, 300, 260], loop: true,
  };
  // a scuttle: alternate sets of four, the body barely moving between beats
  const walk = {
    frames: [mk({ gait: 1, phase: 0 }), mk({ gait: 0.3, bob: -1, phase: 1 }), mk({ gait: -1, phase: 2 }), mk({ gait: -0.3, bob: -1, phase: 3 })],
    durations: [95, 95, 95, 95], loop: true,
  };
  // it rears, half-vanishes, and lands on top of you
  const attack = {
    frames: [mk({ rear: 4, phase: 1 }), mk({ rear: 6, blink: 1, phase: 2 }), mk({ rear: -1, drop: 1, phase: 3 }), mk({ rear: 1, phase: 0 })],
    durations: [160, 90, 120, 170], loop: false,
  };
  const recoil = mk({ drop: 2, phase: 2 });
  const hurt = { frames: [flash(recoil), recoil], durations: [70, 170], loop: false };
  const d0 = mk({ drop: 1, phase: 1 });
  const d1 = mk({ drop: 3, phase: 3, blink: 1 });
  const d2 = squashTo(mk({ drop: 4, phase: 2 }), 0.62, DS_H - 3);
  const death = { frames: [d0, d1, d2, squashTo(d2, 0.5, DS_H - 3), squashTo(d2, 0.4, DS_H - 3)], durations: [110, 150, 190, 440, 800], loop: false };
  return { idle, walk, attack, hurt, death };
}

/** Dimension spider: a 60x51 cell around a 52x46 pose — eight jointed legs and an echo out of register. */
export function buildDimensionSpider() {
  return { anims: clips(dsAnims), palette: DS, w: DS_W, h: DS_H, pivot: DS_PIV, emissive: 'xyY', scale: 1 };
}

// ---------------------------------------------------------------------------------- registry
const cache = new Map();
const build = (key, make) => () => {
  let b = cache.get(key);
  if (!b) { b = make(); cache.set(key, b); }
  return b;
};

/**
 * The four MONSTER_TABLE types that used to share two drawings. Every key here is a real type the
 * generator rolls (game/monsters.js) — no fictional creatures.
 * @type {Object<string, () => {anims:object, palette:import('../pixelPainter.js').Palette, w:number, h:number, pivot:{x:number,y:number}, emissive:string, scale:number}>}
 */
export const DRAKE_SPRITES = {
  'wyvern': build('wyvern', buildWyvern),
  'shadow-dragon': build('shadow-dragon', buildShadowDragon),
  'fyre-drake': build('fyre-drake', buildFyreDrake),
  'dimension-spider': build('dimension-spider', buildDimensionSpider),
};

// undead: the dungeon's undead and horrors as HD-2D pixel sprites — ghoul, wraith, vampire and
// werewolf — hand-pixelled part by part with the same toolkit, ramp discipline and key light as the
// hero (sprites/pixelPainter.js, sprites/heroSprite.js) and the other monster groups.
//
// HOUSE STYLE (shared with the hero and the other groups)
//  · One palette of hue-shifted ramps: shadows drift violet and gain saturation, highlights drift
//    amber and lose a little. Each creature uses 4-6 ramps, never more.
//  · Key light from the TOP-LEFT on every facing. Fills are hand-placed; the single outline is laid
//    on last by `outline()` so it is exactly one pixel of near-black violet ('#'), softened to the
//    lilac '@' only on the edges that face the light. No pillow shading, no banding, no dithering
//    except where a form is deliberately dissolving (the wraith's hem).
//  · Facings south / east / north are each drawn deliberately; west is the mirrored east.
//  · Fills stop one row above the pivot row so the outline lands on the contact row and
//    spriteSheet's foot metrics put the contact shadow under the actual feet. The wraith is the
//    exception: it hovers, its fills stop SIX rows up, and spriteBillboard's foot-lift term thins
//    its contact shadow accordingly.
//
// SILHOUETTES (the read at gameplay distance, before any colour)
//  ghoul     hunched, emaciated corpse-eater; a bald skull thrust forward of the shoulders with a
//            distended hanging jaw, ribs showing through taut skin, and — the signature — arms far
//            too long, hanging past the knees and ending in three raking bone claws.
//  wraith    the only figure with NO legs: a hollow peaked hood with two ember eyes floating over
//            a robe that frays into a tattered, translucent hem trailing wisps in mid-air, empty
//            sleeves hanging where arms should be.
//  vampire   the tallest and narrowest: a high standing collar arcing above the head like a pair of
//            bat wings with a crimson lining, a widow's-peaked skull, fangs, a long cape.
//  werewolf  by far the widest and heaviest: a long wolf muzzle, pricked ears, a bristling pale
//            ruff over a barrel chest, reverse-jointed (digitigrade) legs and a bushy tail.
//
// CLIPS idle(4) walk(6) attack(4) hurt(2) death(5) on every facing.
import { Palette, paint, compose, mirrorLit, outline, recolor, makePix, setPx } from '../pixelPainter.js';
import { INK, INK_LIT, LIT, ramp } from '../style.js';

/** @typedef {import('../pixelPainter.js').Pix} Pix */

// ---------------------------------------------------------------------------------- palette
// Keys are unique per creature so a mis-keyed pixel shows up as magenta in the sheet.
// EVERY ramp below is a slice of ONE seven-step house curve (`ramp()` in style.js): the same ink,
// the same hue drift and the same value spread as every other group. `pick` chooses which steps of
// that curve a material occupies — bone and gold reach the top, grave rags and cloak sit low, and
// the vampire's pallid skin takes a deliberately TIGHT slice high up the curve, because a face with
// a full seven-step range on it stops being pallid and starts being carved.
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

export const UNDEAD_PALETTE = new HousePalette()
  .set('#', INK)                                                              // outline: the one house ink
  .set('@', INK_LIT)                                                          // lit edge / inner line
  .set('V', '#0b0812')                                                        // void: inside a hood, an open maw
  // ghoul
  .ramp('1234', '#7d9159')                                                    // corpse flesh (grave green)
  .ramp('567', '#ded2b0', { pick: [2, 4, 6] })                                // bone: jaw, teeth, claws, feet
  .ramp('890', '#5d4a37')                                                     // grave rags
  // wraith
  .ramp('abcd', '#3c3757')                                                    // shroud (cold indigo)
  .set('e', '#6f6796').set('f', '#aba4d8')                                    // hem wisps: dim / bright
  // vampire
  .ramp('ghij', '#2c2438')                                                    // cloak & tailcoat
  .set('k', '#7d1b2b').set('l', '#b8303f')                                    // crimson lining
  .ramp('mno', '#c9c1d4', { pick: [3, 5, 6] })                                // pallid skin (a tight, high slice)
  .set('p', '#ece6ee').set('q', '#b0a6bb')                                    // linen shirt / cravat
  .set('r', '#221a2c').set('s', '#3f3253')                                    // slicked hair
  .ramp('tuv', '#d0a03c', { pick: [2, 4, 6] })                                // gold medallion
  // werewolf
  .ramp('wxyz', '#6b5443')                                                    // fur
  .set('A', '#d2bd9b').set('B', '#93816a')                                    // pale ruff / belly
  .set('C', '#241a20')                                                        // nose leather, paw pads
  // shared
  .set('E', '#150f1c')                                                        // eye socket / shadowed hollow
  .set('W', '#fff7ea')                                                        // catch-light
  .set('R', '#ff5a44')                                                        // burning iris (emissive)
  .set('Y', '#ffcf5c')                                                        // ember glow (emissive)
  .set('F', '#fff4f0');                                                       // hurt flash

/** Keys flagged emissive in the atlas alpha: they keep their glow under fog and torchlight. */
const EMISSIVE = 'YRf';

const L = (p, x, y, m) => (p ? { p, x, y, mirror: !!m } : null);
/** Compose layers and lay the single selective outline on last (the house treatment). */
const ink = (w, h, layers) => outline(compose(w, h, layers.filter(Boolean)), '#', { lit: LIT, litKey: '@' });
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
/**
 * Come apart: eat the pix away with a broken, non-repeating lattice weighted toward the bottom, so
 * the hem shreds before the hood does, and push whatever is left toward `key` (a colder, paler
 * wisp). The outline goes with the fill, so the survivors are ragged flecks rather than a mesh.
 * Used only for the wraith's death — the one place dissolving is allowed.
 */
function dissolve(p, t, key) {
  const o = makePix(p.w, p.h), k = key ? key.charCodeAt(0) : 0;
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const c = p.d[y * p.w + x];
    if (!c) continue;
    const bias = 0.3 + 0.9 * (y / p.h);                                  // the hem goes first
    const n = ((x * 7 + y * 13 + ((x * 5) ^ (y * 3)) % 11) % 19) / 19;   // broken, never a grid
    if (n < t * bias) continue;
    setPx(o, x, y, k || c);
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

// ==========================================================================================
//                                          GHOUL
// ==========================================================================================
// Read: a bald skull thrust ahead of hunched shoulders, jaw hanging open, ribs through taut skin,
// and arms so long the bone claws swing past the knees.
const GH_W = 34, GH_H = 40, GH_PIVOT = { x: 17, y: 38 };

const GH_HEAD_S = paint(`
....4443333...
..44444333322.
.4444433333322
.4444333333322
.44EEE333EEE22
.44EYE333EYE22
.444EE333EE222
.4443333333222
..4333EE333222
..43777777322.
..43EEEEEE322.
...46666552...
....466552....`);

const GH_HEAD_E = paint(`
..4443......
.444333.....
44443333....
444433333...
4444333332..
44EYE333332.
444EE3333322
4443333EE322
444337777772
4443EEEEEE22
.44366666652
..436666552.
...4666552..`);

const GH_HEAD_N = paint(`
....4443333...
..44444333322.
.4444433333322
.4444333333322
.4444333333322
.4444333333322
.4444333333322
.4444333333322
..443333333222
..443333332222
...4333332222.
....43332222..
.....4332.....`);

const GH_TORSO_S = paint(`
......4332......
..444443333322..
.44444433333322.
.44114433331122.
.44444333333322.
.44111443311122.
.44444333333322.
..44114331122...
...4443333322...
...4443333322...
..999998888888..
..999888888888..
...99888888888..
...9.88.888.88..`);

const GH_TORSO_E = paint(`
...43322....
..4443332...
.444433332..
.444133332..
.444433332..
.441133322..
..44433322..
..44133322..
..4443332...
..4443332...
.999988888..
.999888888..
..99888888..
..9.88.888..`);

const GH_TORSO_N = paint(`
......4332......
..444443333322..
.44444433333322.
.44114466331122.
.44444333333322.
.44444466333322.
.44444333333322.
..44446633322...
...4443333322...
...4446633322...
..999998888888..
..999888888888..
...99888888888..
...9.88.888.88..`);

// the signature: an arm long enough that the claws swing past the knee
const GH_ARM = paint(`
.444.
.433.
.433.
.433.
.4332
.4332
.4332
.4332
.4332
.4332
.4332
.4332
.4332
.777.
7.7.7
6.6.6`);
const GH_ARM_FAR = recolor(GH_ARM, { 4: '2', 3: '2', 2: '1', 7: '6', 6: '5' });
// in profile the near arm hangs against the ribs: a dark inner edge keeps it off the torso
const GH_ARM_SIDE = paint(`
14442.
14332.
14332.
14332.
143322
143322
143322
143322
143322
143322
143322
143322
143322
1.777.
.7.7.7
.6.6.6`);

// raised overhead, claws leading (attack wind-up)
const GH_ARM_UP = paint(`
..5.5.5
..5.5.5
..77777
..43332
.443332
.443332
4433322
4433322
4433222
433222.
433222.
43322..
4332...
432....`);
const GH_ARM_UP_FAR = recolor(GH_ARM_UP, { 4: '2', 3: '2', 2: '1', 7: '6', 5: '6' });

// swept forward and down, claws leading (the rake)
const GH_ARM_FWD = paint(`
4332......
43322.....
.43322....
..43322...
...43322..
....43322.
.....43322
......7777
.....7.7.7
.....6.6.6`);
const GH_ARM_FWD_FAR = recolor(GH_ARM_FWD, { 4: '2', 3: '2', 2: '1', 7: '6', 6: '5' });

const GH_LEGS_S = {
  stand: paint(`
..4332..2334..
..4332..2334..
..4332..2334..
...433..334...
...433..334...
..4332..2334..
..4332..2334..
..1332..2331..
.44433..33444.
.6663....3666.`),
  a: paint(`
.4332....2334.
.4332....2334.
.4332....2334.
..433....334..
..433....334..
.4332....2334.
.4332....2334.
.1332....2331.
44433....33444
6663......3666`),
  b: paint(`
...43322334...
...43322334...
...43322334...
...43322334...
...43322334...
...43322334...
...43322334...
...13322331...
..4443..3444..
..6663..3666..`),
  crouch: paint(`
..4332..2334..
..4332..2334..
...433..334...
..4332..2334..
..4332..2334..
..1332..2331..
.44433..33444.
.6663....3666.`),
};

const GH_LEGS_E = {
  stand: paint(`
..1222.4332.
..1222.4332.
..1222.4332.
..1222.4332.
..1222.4332.
..1222.4332.
..1222.4332.
..1222.4332.
..1222.4332.
..555..6666.`),
  a: paint(`
..1222.4332.
..1222.4332.
.1222...433.
.1222...433.
1222.....433
1222.....433
1222.....433
1222.....433
1222.....433
5556.....666`),
  b: paint(`
..1222.4332.
..1222.4332.
..122..4332.
..122..4332.
.1222...4332
.1222...4332
.1222...4332
.1222...4332
.1222...4332
.5556...6666`),
  crouch: paint(`
..1222.4332.
..1222.4332.
..1222.4332.
..1222.4332.
..1222.4332.
..1222.4332.
..1222.4332.
..555..6666.`),
};

/**
 * One ghoul frame.
 * @param {'S'|'E'|'N'} f
 * @param {{dy?:number, dx?:number, legs?:string, arms?:string, headDy?:number, headDx?:number}} [o]
 */
function ghoulFrame(f, { dy = 0, dx = 0, legs = 'stand', arms = 'hang', headDy = 0, headDx = 0 } = {}) {
  const legDrop = legs === 'crouch' ? 2 : 0;
  if (f === 'E') {
    const near = arms === 'up' ? L(GH_ARM_UP, 20 + dx, 4 + dy) : arms === 'fwd' ? L(GH_ARM_FWD, 19 + dx, 17 + dy) : L(GH_ARM_SIDE, 17 + dx, 15 + dy);
    const far = arms === 'up' ? L(GH_ARM_UP_FAR, 13 + dx, 7 + dy) : arms === 'fwd' ? L(GH_ARM_FWD_FAR, 15 + dx, 18 + dy) : L(GH_ARM_FAR, 12 + dx, 15 + dy);
    // a raised arm goes BEHIND the head in profile, so the skull and hanging jaw stay readable
    return ink(GH_W, GH_H, [
      far,
      arms === 'up' ? near : null,
      L(GH_LEGS_E[legs], 11, 27 + legDrop),
      L(GH_TORSO_E, 11 + dx, 13 + dy),
      L(GH_HEAD_E, 15 + dx + headDx, 2 + dy + headDy),
      arms === 'up' ? null : near,
    ]);
  }
  const armsL = arms === 'up'
    ? [L(GH_ARM_UP, 2 + dx, 6 + dy, true), L(GH_ARM_UP, 25 + dx, 6 + dy)]
    : arms === 'fwd'
      ? [L(GH_ARM_FWD, 2 + dx, 17 + dy, true), L(GH_ARM_FWD, 22 + dx, 17 + dy)]
      : [L(GH_ARM, 4 + dx, 14 + dy, true), L(GH_ARM, 25 + dx, 14 + dy)];
  if (f === 'N') {
    return ink(GH_W, GH_H, [
      ...armsL,
      L(GH_LEGS_S[legs], 10, 27 + legDrop),
      L(GH_TORSO_N, 9 + dx, 13 + dy),
      L(GH_HEAD_N, 10 + dx + headDx, 1 + dy + headDy),
    ]);
  }
  return ink(GH_W, GH_H, [
    L(GH_LEGS_S[legs], 10, 27 + legDrop),
    L(GH_TORSO_S, 9 + dx, 13 + dy),
    L(GH_HEAD_S, 10 + dx + headDx, 1 + dy + headDy),
    ...armsL,
  ]);
}

function ghoulAnims(f) {
  const mk = (o) => ghoulFrame(f, o);
  // idle: a slow, wet breath — the shoulders rise, the jaw lolls a beat behind them
  const idle = {
    frames: [mk({ dy: 0 }), mk({ dy: 1, headDy: 1 }), mk({ dy: 1 }), mk({ dy: 0, headDy: 1 })],
    durations: [420, 320, 380, 320], loop: true,
  };
  // shamble: a lurching six-beat, the head swinging out of time with the legs
  const walk = {
    frames: [
      mk({ legs: 'a', dy: 0, headDx: -1 }), mk({ legs: 'a', dy: 1, headDy: 1 }), mk({ legs: 'stand', dy: 0 }),
      mk({ legs: 'b', dy: 0, headDx: 1 }), mk({ legs: 'b', dy: 1, headDy: 1 }), mk({ legs: 'stand', dy: 0 }),
    ],
    durations: [130, 130, 120, 130, 130, 120], loop: true,
  };
  const push = f === 'E' ? 3 : 0;
  const attack = {
    frames: [
      mk({ legs: 'crouch', dy: 2, arms: 'up', headDy: 1, dx: f === 'E' ? -2 : 0 }),
      mk({ legs: 'a', dy: -1, arms: 'fwd', headDy: -1, dx: push }),
      mk({ legs: 'a', dy: 0, arms: 'fwd', dx: push }),
      mk({ legs: 'stand', dy: 1, headDy: 1 }),
    ],
    durations: [150, 80, 110, 160], loop: false,
  };
  const recoil = mk({ legs: 'crouch', dy: 2, headDy: 2, dx: f === 'E' ? -2 : 0 });
  const hurt = { frames: [flash(recoil), recoil], durations: [70, 170], loop: false };
  const d0 = mk({ legs: 'crouch', dy: 3, headDy: 3 });
  const d1 = mk({ legs: 'crouch', dy: 7, headDy: 5 });
  const heap = squashTo(d1, 0.4, GH_H - 3);
  const death = {
    frames: [d0, d1, heap, squashTo(d1, 0.3, GH_H - 3), squashTo(d1, 0.24, GH_H - 3)],
    durations: [130, 170, 210, 560, 760], loop: false,
  };
  return { idle, walk, attack, hurt, death };
}

/** Ghoul: 34x40, hunched corpse-eater with claws that swing past the knee. */
export function buildGhoul() {
  return { anims: clips(ghoulAnims), palette: UNDEAD_PALETTE, w: GH_W, h: GH_H, pivot: GH_PIVOT, emissive: EMISSIVE, scale: 1.0 };
}

// ==========================================================================================
//                                          WRAITH
// ==========================================================================================
// Read: a hollow peaked hood with two ember eyes, empty sleeves, and a robe that frays into a
// tattered translucent hem trailing wisps SIX rows clear of the floor. The only floater.
const WR_W = 34, WR_H = 42, WR_PIVOT = { x: 17, y: 40 };

const WR_HOOD_S = paint(`
.....dc.....
....dccb....
...ddccbb...
..ddccbbaa..
.ddcVVVVVaa.
.dccVYVVYVa.
.dccVyVVyVa.
.dccVVVVVVa.
.bccVVVVVVa.
.bccVVVVVaa.
..bcVVVVVa..
..bccVVVaa..
...bccVaa...
....bcaa....`);

const WR_HOOD_E = paint(`
..dc........
.dccb.......
.ddccbb.....
.ddccbbaa...
.ddcVVVVaa..
.dccVYVVVa..
.dccVyVVVa..
.dccVVVVaa..
.bccVVVVa...
.bccVVVaa...
..bcVVVaa...
..bccVaaa...
...bcaaa....
...bcaa.....`);

const WR_HOOD_N = paint(`
.....dc.....
....dccb....
...ddccbb...
..ddccbbaa..
.ddccbbbaaa.
.dccbbabbaa.
.dccbbabbaa.
.dccbbabbaa.
.bccbbabbaa.
.bccbbabbaa.
..bcbbabba..
..bccbabaa..
...bcbaaa...
....bcaa....`);

// The shroud itself is NARROW: everything wide about a wraith is sleeve or hem, never body.
const WR_BODY_S = paint(`
....ddccbbaa....
...ddcccbbaaa...
..ddccccbbaaaa..
.ddccacbbbaaaaa.
.ddccacbbbaaaaa.
ddcccacbbbaaaaaa
ddcccacbbbaaaaaa
ddccaacbbbaaaaaa
ddccaacbbbaaaaaa
ddcaaaccbbaaaaaa
ddcaaaccbbaaaaaa
ddcaaaccbbaaaaaa
ddcaaaccbbaaaaaa
ddcaaaccbbaaaaaa`);

const WR_BODY_E = paint(`
...ddcbba...
..ddccbbaa..
.ddccbbbaaa.
.ddcacbbaaa.
ddccacbbaaaa
ddccacbbaaaa
ddcaacbbaaaa
ddcaacbbaaaa
ddcaaccbaaaa
ddcaaccbaaaa
ddcaaccbaaaa
ddcaaccbaaaa
ddcaaccbaaaa
ddcaaccbaaaa`);

const WR_BODY_N = paint(`
....ddccbbaa....
...ddcccbbaaa...
..ddccccbbaaaa..
.ddcccabbbaaaaa.
.ddcccabbbaaaaa.
ddccccabbbaaaaaa
ddccccabbbaaaaaa
ddcccaabbbaaaaaa
ddcccaabbbaaaaaa
ddccaaabbbaaaaaa
ddccaaabbbaaaaaa
ddccaaabbbaaaaaa
ddccaaabbbaaaaaa
ddccaaabbbaaaaaa`);

// The signature: the hem does not end, it comes apart — the shroud tears into thin strips that
// taper into single wisps hanging in the air, six rows clear of the floor.
const WR_HEM_S = [
  paint(`
ddcaaaccbbaaaaaa
ddca.accbb.aaaaa
dc.a..cc.b..aa.a
dc.a..c..b..aa..
.c....c..e...a..
.c....e......a..
.e.........f....
..f.......e.....
....e.......e...
................
................
................`),
  paint(`
ddcaaaccbbaaaaaa
ddca.acc.b.aaaaa
dc.a..c..b..aa.a
.c.a..c..b..aa..
.c....e..e...a..
..e...f.......e.
...e........e...
.f........f.....
.....e.......f..
................
................
................`),
  paint(`
ddcaaaccbbaaaaaa
dd.a.accbb.aa.aa
dc.a..cc.b..aa.a
dc....c..b...a..
.c....c..e...a..
.c....e......f..
.e.........e....
...f......e.....
..e...........e.
................
................
................`),
];

const WR_HEM_E = [
  paint(`
ddcaaccbaaaa
ddca.cbaaa.a
dc.a..c.aa.a
dc.a..c..a..
.c....e..a..
.c....f.....
.e........e.
..f....e....
....e.......
............
............
............`),
  paint(`
ddcaaccbaaaa
dd.a.cbaa.aa
dc.a..c.aa..
.c.a..c..a..
.c....e..e..
..e...f.....
...e.....e..
.f........f.
.....e......
............
............
............`),
  paint(`
ddcaaccbaaaa
ddca.c.aaa.a
dc..a.cb.a.a
dc....c..a..
.c....e..a..
.c....e...f.
.f.......e..
...e....f...
..e.........
............
............
............`),
];

/** An empty sleeve, hung from the shoulder (its top inner corner) and flaring out and down. */
const WR_SLEEVE = paint(`
.......cb
......ccb
.....cccb
....ccccb
...ccccbb
..ccccbb.
.ccccbba.
ccccbbaa.
cccbbaa..
.ccbbaa..
.cbbaa...
.cbba....
..bba....
...e.....`);

/** The sleeve thrown up and open, a skeletal hand reaching out of the cuff (attack). */
const WR_SLEEVE_UP = paint(`
.777.....
.7.7.7...
.6.6.6...
.dddc....
.ddddc...
..ddddc..
..ddccb..
...ddcb..
...dccb..
....dcb..
....dcb..
.....cb..
.........
.........`);

/**
 * One wraith frame. Nothing touches the floor: `dy` is a drift, not a bob.
 * @param {'S'|'E'|'N'} f
 */
function wraithFrame(f, { dy = 0, dx = 0, hem = 0, sleeves = 'hang', hoodDy = 0, sway = 0 } = {}) {
  if (f === 'E') {
    return ink(WR_W, WR_H, [
      sleeves === 'up' ? L(WR_SLEEVE_UP, 4 + dx, 10 + dy) : L(WR_SLEEVE, 3 + dx, 13 + dy),
      L(WR_BODY_E, 11 + dx + sway, 12 + dy),
      L(WR_HEM_E[hem], 11 + dx + sway, 25 + dy),
      L(WR_HOOD_E, 12 + dx, 0 + dy + hoodDy),
      sleeves === 'up' ? L(WR_SLEEVE_UP, 20 + dx, 10 + dy, true) : L(WR_SLEEVE, 21 + dx, 13 + dy, true),
    ]);
  }
  const body = f === 'N' ? WR_BODY_N : WR_BODY_S;
  const hood = f === 'N' ? WR_HOOD_N : WR_HOOD_S;
  const sl = sleeves === 'up'
    ? [L(WR_SLEEVE_UP, 1 + dx, 10 + dy), L(WR_SLEEVE_UP, 24 + dx, 10 + dy, true)]
    : [L(WR_SLEEVE, 1 + dx, 13 + dy), L(WR_SLEEVE, 24 + dx, 13 + dy, true)];
  return ink(WR_W, WR_H, [
    ...sl,
    L(body, 9 + dx + sway, 12 + dy),
    L(WR_HEM_S[hem], 9 + dx + sway, 25 + dy),
    L(hood, 11 + dx, 0 + dy + hoodDy),
  ]);
}

function wraithAnims(f) {
  const mk = (o) => wraithFrame(f, o);
  // idle: it does not breathe — it drifts, and the hem never stops moving
  const idle = {
    frames: [mk({ dy: 0, hem: 0 }), mk({ dy: -1, hem: 1, sway: 1 }), mk({ dy: 0, hem: 2 }), mk({ dy: 1, hem: 1, sway: -1 })],
    durations: [440, 400, 440, 400], loop: true,
  };
  // drift: no footfalls at all, just a long lateral sway with the hem streaming behind
  const walk = {
    frames: [
      mk({ dy: 0, hem: 0, sway: 1 }), mk({ dy: -1, hem: 1, sway: 1 }), mk({ dy: -1, hem: 2 }),
      mk({ dy: 0, hem: 0, sway: -1 }), mk({ dy: 1, hem: 1, sway: -1 }), mk({ dy: 1, hem: 2 }),
    ],
    durations: [150, 150, 150, 150, 150, 150], loop: true,
  };
  const push = f === 'E' ? 3 : 0;
  const attack = {
    frames: [
      mk({ dy: -2, hem: 2, sleeves: 'up', hoodDy: -1, dx: f === 'E' ? -2 : 0 }),
      mk({ dy: 1, hem: 0, sleeves: 'up', dx: push }),
      mk({ dy: 1, hem: 1, sleeves: 'up', dx: push }),
      mk({ dy: 0, hem: 2 }),
    ],
    durations: [180, 90, 120, 190], loop: false,
  };
  const recoil = mk({ dy: 2, hem: 2, hoodDy: 1, dx: f === 'E' ? -2 : 0 });
  const hurt = { frames: [flash(recoil), recoil], durations: [70, 180], loop: false };
  // death: it does not fall over — it comes apart, the shroud fraying into wisps
  const d0 = mk({ dy: -1, hem: 0, sleeves: 'up' });
  const d1 = mk({ dy: 1, hem: 2 });
  const death = {
    frames: [d0, d1, dissolve(d1, 0.32, null), dissolve(d1, 0.62, 'e'), dissolve(d1, 0.86, 'f')],
    durations: [150, 180, 240, 380, 620], loop: false,
  };
  return { idle, walk, attack, hurt, death };
}

/** Wraith: 34x42, a hovering hooded shroud with a tattered translucent hem. */
export function buildWraith() {
  return { anims: clips(wraithAnims), palette: UNDEAD_PALETTE, w: WR_W, h: WR_H, pivot: WR_PIVOT, emissive: EMISSIVE, scale: 1.12 };
}

// ==========================================================================================
//                                         VAMPIRE
// ==========================================================================================
// Read: the tallest, narrowest figure in the dungeon — a high collar arcing above the head with a
// crimson lining, a widow's peak, fangs, and a cape that doubles the silhouette's width below.
const VA_W = 36, VA_H = 46, VA_PIVOT = { x: 18, y: 44 };

/** The signature: a standing collar that flares above the shoulders, crimson on the inside. */
const VA_COLLAR = paint(`
hi......................ih
hij....................jih
hijl..................ljih
ghijl................ljihg
ghijll..............lljihg
ghijkll............llkjihg
ghijkkll..........llkkjihg
ghijkkkll........llkkkjihg
ghijkkkkll......llkkkkjihg
ghijkkkkkll....llkkkkkjihg`);

/** From behind the collar shows its dark outer face, not the crimson lining. */
const VA_COLLAR_N = paint(`
hi......................ih
hij....................jih
hiji..................ijih
ghiji................ijihg
ghiji................ijihg
ghijhi..............ihjihg
ghijhhi............ihhjihg
ghijhhhi..........ihhhjihg
ghijhhhhi........ihhhhjihg
ghijhhhhhi......ihhhhhjihg`);

const VA_COLLAR_E = paint(`
.....hij....
....ghijl...
...ghijll...
...ghijkl...
..ghijkkl...
..ghijkkl...
.ghijkkkl...
.ghijkkkl...
ghijkkkkl...
ghijkkkkl...`);

const VA_HEAD_S = paint(`
....rrrrrr....
..rrsrrrrrrr..
.rrssrrrrrrrr.
.rssrrrrrrrrr.
.rssrrrrrrrrr.
.rrooorrnnnrr.
.roooonnnnnnr.
.roEEonnEEnnr.
.roRWonnWRnnr.
.rooooonnnnnr.
.rooonEnnnnnr.
.roooEEEEnnnr.
.rooo7EE7nnnr.
..roonnnnnr...`);

const VA_HEAD_E = paint(`
...rrrrrr....
..rrrrrrrrr..
.rrrrrrrrrrr.
.rssrrrrrrrr.
.rssrrrrrrrr.
rssrooonnnr..
rssroooonnn..
rssroEWoonn..
rssroREoonn..
rssroooonnno.
.rsrooonEnno.
.rsroooEEnn..
.rsroo77Enn..
..rrooonnn...`);

const VA_HEAD_N = paint(`
....rrrrrr....
..rrrrrrrrrr..
.rrsrrrrrrrrr.
.rssrrrrrrrrr.
.rssrrrrrrrrr.
.rssrrrrrrrrr.
.rssrrrrrrrrr.
.rssrrrrrrrrr.
.rssrrrrrrrrr.
..rsrrrrrrrr..
..rrrrrrrrrr..
...rrrrrrrr...
....rrrrrr....
....oonnnn....`);

const VA_TORSO_S = paint(`
..jjjiiiiihhhhhggg..
.jjjiiiiiihhhhhgggg.
.jjjiiippqqhhhhgggg.
.jjjiiippqqhhhhgggg.
.jjjiiipqqqhhhhgggg.
.jjjiiipvuqhhhhgggg.
.jjjiiipqqqhhhhgggg.
.jjjiiillkkhhhhgggg.
.jjjiiillkkhhhhgggg.
..jjjiiillkkhhhggg..
..jjjiiihhhhhhhggg..
..jjjiiihhhhhhhggg..
..jjjiiihhhhhhhggg..
..jjjiiih...hhhggg..
..jjjiih.....hhggg..
..jjiih.......hggg..`);

const VA_TORSO_E = paint(`
...jjiihhgg...
..jjiiihhhgg..
..jjiipphhgg..
..jjipqphhgg..
..jjipqqhhgg..
..jjivuqhhgg..
..jjipqqhhgg..
..jjillkhhgg..
..jjillkhhgg..
..jjiihhhhgg..
..jjiihhhhgg..
.jjiiihhhhgg..
.jjiiihhhhg...
jjiiihhhhg....
jjiihhhhg.....
jjihhhg.......`);

const VA_TORSO_N = paint(`
...iiihhhhhhgggg....
..iiiihhhhhhhgggg...
.iiiihhhhhhhhggggg..
.iiiihhhhhhhhggggg..
iiiihghhhhhhghggggg.
iiiihghhhhhhghggggg.
iiiihghhhhhhghggggg.
iiiihghhhhhhghggggg.
iiiihghhhhhhghggggg.
iiiihghhhhhhghggggg.
iiiihghhhhhhghggggg.
iiiihghhhhhhghggggg.
iiiihghhhhhhghggggg.
.iiiihhhhhhhhggggg..
.iiiihhhhhhhhggggg..
..iiihhhhhhhgggg....`);

const VA_CAPE_S = paint(`
.........hhhhhhhhhh.........
.........hhhhhhhhhh.........
........ihhhhhhhhhgg........
........ihhhhhhhhhgg........
......iihhhhhhhhhhgggg......
......iihhhhhhhhhhgggg......
......iihhhhhhhhhhgggg......
....iiiihhhhhhhhhhhggggg....
....iiiihhhhhhhhhhhggggg....
....iiiihhhhhhhhhhhggggg....
....iiiihhhhhhhhhhhggggg....
..iiiiihhhhhhhhhhhhggggggg..
..iiiiihhhhhhhhhhhhggggggg..
..iiiiihhhhhhhhhhhhggggggg..
..iiiiihhhhhhhhhhhhggggggg..
..iiiiihhhhhhhhhhhhggggggg..
..iiiiihhhhhhhhhhhhggggggg..
.iiiiiihhhhhhhhhhhhhggggggg.
.iiiiiihhhhhhhhhhhhhggggggg.
.iiiiiihhhhhhhhhhhhhggggggg.
.iiiiiihhhhhhhhhhhhhggggggg.
.iiiiiihhhhhhhhhhhhhggggggg.
.iiiiiihhhhhhhhhhhhhggggggg.
.iiiiiihhhhhhhhhhhhhggggggg.
.iiiii.hhhhh.hhhhhh.gggggg..
..iii...hhh...hhhh...gggg...`);

const VA_CAPE_E = paint(`
..........hhhhh...
.........ihhhhg...
........iihhhhg...
.......iihhhhhg...
......iiihhhhhg...
.....iiihhhhhhg...
....iiihhhhhhhg...
...iiiihhhhhhhg...
..iiiihhhhhhhhg...
..iiiihhhhhhhhg...
.iiiiihhhhhhhhg...
.iiiiihhhhhhhhg...
iiiiiihhhhhhhhg...
iiiiiihhhhhhhhg...
iiiiiihhhhhhhhg...
iiiiiihhhhhhhhg...
iiiiiihhhhhhhhg...
iiiiiihhhhhhhhg...
iiiiiihhhhhhhhg...
iiiiiihhhhhhhhg...
iiiiiihhhhhhhg....
iiiii.hhhhhhg.....
.iii..hhhhhg......
..i....hhhg.......
..................
..................`);

const VA_ARM = paint(`
.jjii.
.jjii.
.jjii.
.jjii.
.jjiig
.jjiig
.jjiig
.jjiig
.jjiig
.jjiig
.jjiig
.jjiig
.jjiig
..jiig
.ooonn
..oonn
...on.
......`);

/** The reach: a sleeve thrown forward and a pale hand with long fingers. */
const VA_ARM_REACH = paint(`
jjii......
jjjiig....
.jjiiig...
..jjiiig..
...jjiiig.
....ooonnn
....ooonnn
....o.o.o.
....o.o.o.
....n.n.n.`);

const VA_LEGS = {
  stand: paint(`
..hhg..ghh..
..hhg..ghh..
..hhg..ghh..
..hhg..ghh..
..hhg..ghh..
..hhg..ghh..
..hhg..ghh..
..hhg..ghh..
..hhg..ghh..
.ihhg..ghhi.
.ihhg..ghhi.
ihhgg..gghhi`),
  a: paint(`
.hhg....ghh.
.hhg....ghh.
.hhg....ghh.
.hhg....ghh.
.hhg....ghh.
.hhg....ghh.
.hhg....ghh.
.hhg....ghh.
.hhg....ghh.
ihhg....ghhi
ihhg....ghhi
hhgg....gghh`),
  b: paint(`
...hhgghh...
...hhgghh...
...hhgghh...
...hhgghh...
...hhgghh...
...hhgghh...
...hhgghh...
...hhgghh...
...hhgghh...
..ihhgghhi..
..ihhgghhi..
.ihhgg.gghhi`),
  crouch: paint(`
..hhg..ghh..
..hhg..ghh..
..hhg..ghh..
..hhg..ghh..
..hhg..ghh..
..hhg..ghh..
.ihhg..ghhi.
.ihhg..ghhi.
ihhgg..gghhi`),
};

/**
 * One vampire frame.
 * @param {'S'|'E'|'N'} f
 */
function vampFrame(f, { dy = 0, dx = 0, legs = 'stand', arms = 'rest', headDy = 0, capeDy = 0 } = {}) {
  const legDrop = legs === 'crouch' ? 3 : 0;
  if (f === 'E') {
    return ink(VA_W, VA_H, [
      L(VA_CAPE_E, 0 + dx, 12 + capeDy),
      L(VA_COLLAR_E, 9 + dx, 6 + dy + headDy),
      L(VA_LEGS[legs], 13, 31 + legDrop),
      L(VA_TORSO_E, 13 + dx, 15 + dy),
      L(VA_HEAD_E, 16 + dx, 2 + dy + headDy),
      arms === 'reach' ? L(VA_ARM_REACH, 21 + dx, 18 + dy) : L(VA_ARM, 19 + dx, 16 + dy),
    ]);
  }
  const torso = f === 'N' ? VA_TORSO_N : VA_TORSO_S;
  const head = f === 'N' ? VA_HEAD_N : VA_HEAD_S;
  const armL = arms === 'reach'
    ? [L(VA_ARM_REACH, 1 + dx, 18 + dy, true), L(VA_ARM_REACH, 25 + dx, 18 + dy)]
    : [L(VA_ARM, 5 + dx, 17 + dy, true), L(VA_ARM, 25 + dx, 17 + dy)];
  return ink(VA_W, VA_H, [
    L(VA_CAPE_S, 4 + dx, 12 + capeDy),
    L(f === 'N' ? VA_COLLAR_N : VA_COLLAR, 5 + dx, 6 + dy + headDy),
    L(VA_LEGS[legs], 12, 31 + legDrop),
    f === 'N' ? null : L(torso, 8 + dx, 15 + dy),
    ...(f === 'N' ? [] : armL),
    f === 'N' ? L(torso, 8 + dx, 15 + dy) : null,
    L(head, 11 + dx, 2 + dy + headDy),
    ...(f === 'N' ? armL : []),
  ]);
}

function vampAnims(f) {
  const mk = (o) => vampFrame(f, o);
  // idle: almost motionless — only the cape breathes. Stillness reads as menace at this size.
  const idle = {
    frames: [mk({ dy: 0 }), mk({ dy: 0, capeDy: 1 }), mk({ dy: 1, capeDy: 1, headDy: 0 }), mk({ dy: 0, capeDy: 1 })],
    durations: [520, 400, 460, 420], loop: true,
  };
  // a gliding stride: the legs barely part, the cape lags a frame behind the body
  const walk = {
    frames: [
      mk({ legs: 'a', dy: 0 }), mk({ legs: 'a', dy: -1, capeDy: 1 }), mk({ legs: 'stand', dy: 0, capeDy: 1 }),
      mk({ legs: 'b', dy: 0 }), mk({ legs: 'b', dy: -1, capeDy: 1 }), mk({ legs: 'stand', dy: 0, capeDy: 1 }),
    ],
    durations: [115, 115, 115, 115, 115, 115], loop: true,
  };
  const push = f === 'E' ? 3 : 0;
  const attack = {
    frames: [
      mk({ legs: 'crouch', dy: 2, headDy: 1, capeDy: -1, dx: f === 'E' ? -2 : 0 }),
      mk({ legs: 'a', dy: -1, arms: 'reach', headDy: -1, dx: push }),
      mk({ legs: 'a', dy: 0, arms: 'reach', dx: push }),
      mk({ legs: 'stand', dy: 1, capeDy: 1 }),
    ],
    durations: [140, 80, 120, 170], loop: false,
  };
  const recoil = mk({ legs: 'crouch', dy: 3, headDy: 2, capeDy: 2, dx: f === 'E' ? -2 : 0 });
  const hurt = { frames: [flash(recoil), recoil], durations: [70, 175], loop: false };
  const d0 = mk({ legs: 'crouch', dy: 3, headDy: 3, capeDy: 2 });
  const d1 = mk({ legs: 'crouch', dy: 8, headDy: 6, capeDy: 5 });
  const heap = squashTo(d1, 0.36, VA_H - 3);
  const death = {
    frames: [d0, d1, heap, squashTo(d1, 0.26, VA_H - 3), squashTo(d1, 0.2, VA_H - 3)],
    durations: [140, 180, 220, 560, 780], loop: false,
  };
  return { idle, walk, attack, hurt, death };
}

/** Vampire: 36x46, high crimson-lined collar, widow's peak, fangs, long cape. */
export function buildVampire() {
  return { anims: clips(vampAnims), palette: UNDEAD_PALETTE, w: VA_W, h: VA_H, pivot: VA_PIVOT, emissive: EMISSIVE, scale: 1.06 };
}

// ==========================================================================================
//                                         WEREWOLF
// ==========================================================================================
// Read: the widest, heaviest thing on the floor — a long muzzle and pricked ears over a bristling
// pale ruff, a barrel chest, reverse-jointed legs and a bushy tail.
const WW_W = 42, WW_H = 46, WW_PIVOT = { x: 21, y: 44 };

const WW_HEAD_S = paint(`
.zz..........zz.
.zyz........zyz.
.zyyz......zyyz.
.zyyyzzzzzzyyyz.
.zyyyyyyyyyyyyx.
.zyyEEyyyyEEyyx.
.zyyYEyyyyEYyyx.
.zyyyxxxxxxyyyxx
..zyyxAAAAxyyxx.
..zyxAAAAAAxyx..
...xAAAAAAAAx...
...xAACCCCAAx...
..xAA7EEEE7AAx..
...AA7EEEE7AA...`);

const WW_HEAD_E = paint(`
..zz............
..zyz...........
..zyyzzz........
.zyyyyyyyz......
.zyyyyyyyyyz....
.zyEYyyyyyyyz...
.zyEEyyyyyyyyz..
.zyyyyyxxAAAAAz.
.zyyyyxAAAAAAACC
.zyyyxAAAAAAAACC
.zyyxA7777777A..
..zyxA77777A....
..zzyxAAAAA.....
...zzyyxx.......`);

const WW_HEAD_N = paint(`
.zz..........zz.
.zyz........zyz.
.zyyz......zyyz.
.zyyyzzzzzzyyyz.
.zyyyyyyyyyyyyx.
.zyyyyyyyyyyyxx.
.zyyyyyyyyyyyxx.
.zyyyyyyyyyyyxx.
..zyyyyyyyyyxx..
..zyyyyyyyyyxx..
...zyyyyyyyxx...
....zyyyyyxx....
.....zyyyxx.....
......zyxx......`);

const WW_TORSO_S = paint(`
...zzyyyyyyyyyyyxxx...
..zzzyyyyyyyyyyyxxxx..
.zzzzyyyyyyyyyyyyxxxx.
.zzzzyyyAAAAAAAyyxxxx.
.zzzyyyAAAAAAAAAyyxxx.
.zzzyyBAAAAAAAAABxxxx.
.zzyyyBAAAAAAABBxxxxx.
..zzyyyBAAAAABBxxxxx..
..zzyyyBAAAAABBxxxxx..
...zzyyyBAAABBxxxxx...
...zzyyyBAAABBxxxxx...
....zzyyyBABBxxxx.....
....zzyyyBABBxxxx.....
....zzyyyyyyxxxx......
....zzyyyyyyxxxx......
....zzyyyyyyxxxx......`);

const WW_TORSO_E = paint(`
..zzyyyyyxxx....
.zzyyyyyyyxxx...
.zzyyyyyyyyxxx..
zzyyyyyyyyyyxxx.
zzyyyyyyyyyyAxx.
zzyyyyyyyyyAAxx.
zzyyyyyyyyAAAxx.
.zyyyyyyyAAABxx.
.zyyyyyyyAAABxx.
.zyyyyyyAAABBxx.
..zyyyyyAABBxx..
..zyyyyyAABBxx..
...zyyyyABBxx...
...zyyyyABBxx...
...zyyyyyBxxx...
....zyyyyxxx....`);

const WW_TORSO_N = paint(`
...zzyyyyyyyyyyxxx....
..zzyyyyyyyyyyyyxxx...
.zzyyyyyywwyyyyyyxxx..
.zzyyyyyywwyyyyyyxxxx.
.zzyyyyyywwyyyyyxxxxx.
.zzyyyyyywwyyyyyxxxxx.
..zyyyyyywwyyyyyxxxx..
..zyyyyyywwyyyyyxxxx..
...zyyyyywwyyyyxxxx...
...zyyyyywwyyyyxxxx...
....zyyyywwyyyxxxx....
....zyyyywwyyyxxxx....
....zyyyywwyyyxxxx....
.....zyyywwyyxxxx.....
.....zyyywwyyxxxx.....
.....zyyywwyyxxxx.....`);

const WW_ARM = paint(`
zzyyyx.
zzyyyx.
zzyyyx.
zzyyyx.
.zyyyx.
.zyyyx.
.zyyyx.
.zyyyx.
.zyyyx.
.zyyyx.
.zyyyx.
.zyyyx.
zzyyyxx
zyyyyxx
zyyyyxx
.5.5.5.
.5.5.5.`);

/** The swipe: forearm thrown forward, claws leading. */
const WW_ARM_SWIPE = paint(`
zzyyyx....
zzyyyxx...
.zyyyxx...
.zyyyyxx..
..zyyyyxx.
...zyyyyxx
....zyyyxx
.....55555
....5.5.5.
....5.5.5.`);

const WW_LEGS_S = {
  stand: paint(`
..zzyy......yyxx..
..zzyy......yyxx..
..zzyy......yyxx..
...zyy......yyx...
...zyy......yyx...
..zzyy......yyxx..
.zzyy........yyxx.
.zzyy........yyxx.
.zzyy........yyxx.
.zyyy........yyyx.
zzyyyy......yyyyxx
zzyyyy......yyyyxx
5.5.5........5.5.5`),
  a: paint(`
..zzyy......yyxx..
..zzyy......yyxx..
...zyy......yyx...
...zyy.......yyx..
..zzyy.......yyxx.
.zzyy.........yyxx
zzyy..........yyxx
zzyy..........yyxx
zzyy..........yyxx
zyyy..........yyyx
zyyyy........yyyyx
zyyyy........yyyyx
5.5.5.........5.5.`),
  b: paint(`
..zzyy......yyxx..
...zyy.....yyxx...
...zyy.....yyxx...
..zzyy....yyxx....
.zzyy.....yyxx....
.zzyy....yyxx.....
.zzyy....yyxx.....
.zzyy...yyxx......
.zyyy...yyyx......
zzyyyy..yyyyx.....
zzyyyy..yyyyx.....
zzyyyy..yyyyx.....
5.5.5....5.5.5....`),
  crouch: paint(`
..zzyy......yyxx..
...zyy......yyx...
...zyy......yyx...
..zzyy......yyxx..
.zzyy........yyxx.
.zzyy........yyxx.
.zyyy........yyyx.
zzyyyy......yyyyxx
zzyyyy......yyyyxx
5.5.5........5.5.5`),
};

const WW_LEGS_E = {
  stand: paint(`
..wwxx..zzyy....
..wwxx..zzyy....
..wwxx..zzyy....
...wxx...zyy....
...wxx...zyy....
..wwxx..zzyy....
.wwxx..zzyy.....
.wwxx..zzyy.....
.wwxx..zzyy.....
.wwxx..zzyy.....
.wwxxx.zzyyy....
wwxxxx.zzyyyy...
5.5.5..5.5.5....`),
  a: paint(`
..wwxx..zzyy....
..wwxx..zzyy....
...wxx...zyy....
..wwxx....zyy...
.wwxx.....zzyy..
wwxx.......zzyy.
wwxx.......zzyy.
wwxx.......zzyy.
wwxx.......zzyy.
wwxx.......zzyy.
wwxxx.....zzyyy.
wxxxx.....zzyyyy
5.5.5.....5.5.5.`),
  b: paint(`
..wwxx..zzyy....
..wwxx..zzyy....
...wxx..zzyy....
....wxx.zzyy....
....wwxxzyy.....
.....wwxzy......
....wwxx.zzyy...
...wwxx...zzyy..
..wwxx.....zzyy.
.wwxx.......zzyy
.wwxxx......zzyy
wwxxxx......zzyy
5.5.5.......5.5.`),
  crouch: paint(`
..wwxx..zzyy....
...wxx...zyy....
...wxx...zyy....
..wwxx..zzyy....
.wwxx..zzyy.....
.wwxx..zzyy.....
.wwxxx.zzyyy....
wwxxxx.zzyyyy...
5.5.5..5.5.5....`),
};

/** A bushy tail, three phases of a slow sweep. */
const WW_TAIL_E = [
  paint(`
..zzz.....
.zyyyz....
.zyyyyz...
..zyyyyz..
...zyyyyz.
....zyyyz.
.....zyyz.
......zyz.`),
  paint(`
.zzz......
zyyyz.....
zyyyyz....
.zyyyyz...
..zyyyyz..
...zyyyz..
....zyyz..
.....zyz..`),
  paint(`
..........
...zzz....
..zyyyz...
..zyyyyz..
...zyyyyz.
....zyyyz.
.....zyyz.
......zyz.`),
];

const WW_TAIL_N = [
  paint(`
..zz..
.zyyz.
.zyyz.
.zyyz.
zyyyyz
zyyyyz
.zyyz.
.zyyz.
..zz..`),
  paint(`
.zz...
.zyyz.
.zyyz.
zyyyz.
zyyyyz
zyyyyz
.zyyz.
.zyyz.
..zz..`),
  paint(`
...zz.
.zyyz.
.zyyz.
.zyyyz
zyyyyz
zyyyyz
.zyyz.
.zyyz.
..zz..`),
];

/**
 * One werewolf frame.
 * @param {'S'|'E'|'N'} f
 */
function wolfFrame(f, { dy = 0, dx = 0, legs = 'stand', arms = 'hang', headDy = 0, tail = 0 } = {}) {
  const legDrop = legs === 'crouch' ? 3 : 0;
  if (f === 'E') {
    return ink(WW_W, WW_H, [
      L(WW_TAIL_E[tail], 7 + dx, 17 + dy, true),
      arms === 'swipe' ? L(WW_ARM_SWIPE, 16 + dx, 18 + dy) : L(WW_ARM, 15 + dx, 16 + dy),
      L(WW_LEGS_E[legs], 13, 30 + legDrop),
      L(WW_TORSO_E, 13 + dx, 14 + dy),
      L(WW_HEAD_E, 19 + dx, 2 + dy + headDy),
      arms === 'swipe' ? L(WW_ARM_SWIPE, 24 + dx, 19 + dy) : L(WW_ARM, 24 + dx, 17 + dy),
    ]);
  }
  const torso = f === 'N' ? WW_TORSO_N : WW_TORSO_S;
  const head = f === 'N' ? WW_HEAD_N : WW_HEAD_S;
  const armL = arms === 'swipe'
    ? [L(WW_ARM_SWIPE, 1 + dx, 18 + dy, true), L(WW_ARM_SWIPE, 31 + dx, 18 + dy)]
    : [L(WW_ARM, 4 + dx, 16 + dy, true), L(WW_ARM, 31 + dx, 16 + dy)];
  return ink(WW_W, WW_H, [
    f === 'N' ? L(WW_TAIL_N[tail], 18 + dx, 30 + dy) : null,
    ...(f === 'N' ? armL : []),
    L(WW_LEGS_S[legs], 12, 30 + legDrop),
    L(torso, 10 + dx, 14 + dy),
    L(head, 13 + dx, 2 + dy + headDy),
    ...(f === 'N' ? [] : armL),
  ]);
}

function wolfAnims(f) {
  const mk = (o) => wolfFrame(f, o);
  // idle: a heavy chest working, the tail sweeping on its own slower beat
  const idle = {
    frames: [mk({ dy: 0, tail: 0 }), mk({ dy: 1, tail: 1 }), mk({ dy: 1, tail: 2, headDy: 1 }), mk({ dy: 0, tail: 1 })],
    durations: [330, 280, 300, 280], loop: true,
  };
  // lope: a fast, low six-beat with real weight transfer
  const walk = {
    frames: [
      mk({ legs: 'a', dy: 0, tail: 0 }), mk({ legs: 'a', dy: 1, tail: 1 }), mk({ legs: 'stand', dy: -1, tail: 2 }),
      mk({ legs: 'b', dy: 0, tail: 1 }), mk({ legs: 'b', dy: 1, tail: 0 }), mk({ legs: 'stand', dy: -1, tail: 1 }),
    ],
    durations: [90, 90, 90, 90, 90, 90], loop: true,
  };
  const push = f === 'E' ? 4 : 0;
  const attack = {
    frames: [
      mk({ legs: 'crouch', dy: 3, headDy: 1, tail: 2, dx: f === 'E' ? -3 : 0 }),
      mk({ legs: 'a', dy: -2, arms: 'swipe', headDy: -1, tail: 0, dx: push }),
      mk({ legs: 'a', dy: 0, arms: 'swipe', tail: 0, dx: push }),
      mk({ legs: 'stand', dy: 1, tail: 1 }),
    ],
    durations: [130, 70, 110, 150], loop: false,
  };
  const recoil = mk({ legs: 'crouch', dy: 3, headDy: 2, tail: 2, dx: f === 'E' ? -3 : 0 });
  const hurt = { frames: [flash(recoil), recoil], durations: [70, 170], loop: false };
  const d0 = mk({ legs: 'crouch', dy: 4, headDy: 3, tail: 2 });
  const d1 = mk({ legs: 'crouch', dy: 9, headDy: 6, tail: 1 });
  const heap = squashTo(d1, 0.4, WW_H - 3);
  const death = {
    frames: [d0, d1, heap, squashTo(d1, 0.3, WW_H - 3), squashTo(d1, 0.25, WW_H - 3)],
    durations: [130, 170, 210, 560, 760], loop: false,
  };
  return { idle, walk, attack, hurt, death };
}

/** Werewolf: 42x46, digitigrade wolf-man with a bristling ruff and a bushy tail. */
export function buildWerewolf() {
  return { anims: clips(wolfAnims), palette: UNDEAD_PALETTE, w: WW_W, h: WW_H, pivot: WW_PIVOT, emissive: EMISSIVE, scale: 1.1 };
}

// ---------------------------------------------------------------------------------- registry
const cache = new Map();
const once = (key, build) => () => {
  let b = cache.get(key);
  if (!b) { b = build(); cache.set(key, b); }
  return b;
};

/**
 * The undead-and-horrors group: monster type -> builder. The aliases are the names the extended
 * bestiary may roll for the same silhouette; only keys nobody else owns are claimed here, so this
 * map can be spread into the registry alongside the other groups in any order.
 * @type {Object<string, () => {anims:object, palette:import('../pixelPainter.js').Palette, w:number, h:number, pivot:{x:number,y:number}, emissive:string, scale:number}>}
 */
export const UNDEAD_SPRITES = {
  ghoul: once('ghoul', buildGhoul),
  zombie: once('ghoul', buildGhoul),
  wight: once('ghoul', buildGhoul),
  wraith: once('wraith', buildWraith),
  spectre: once('wraith', buildWraith),
  specter: once('wraith', buildWraith),
  shade: once('wraith', buildWraith),
  vampire: once('vampire', buildVampire),
  nosferatu: once('vampire', buildVampire),
  'vampire-lord': once('vampire', buildVampire),
  werewolf: once('werewolf', buildWerewolf),
  lycanthrope: once('werewolf', buildWerewolf),
  wolfman: once('werewolf', buildWerewolf),
};

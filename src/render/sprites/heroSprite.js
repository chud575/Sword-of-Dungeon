// heroSprite: the hero as an HD-2D pixel sprite (Octopath / Triangle Strategy style), hand-pixelled
// part by part and composed into animation sheets.
//
// DESIGN NOTE
//  Silhouette: chibi-heroic knight, ~2.8 heads tall on a 48×48 canvas (figure ≈ 30×45 px, feet on
//  row 45, pivot x=24). A big rounded sallet helm with a tall crimson plume is the read at any
//  distance; the plume leans back-left so the helm never looks like a ball. A straight longsword is
//  the one dominant weapon shape — held point-up beside the head (south), diagonal up-forward (east)
//  and rising above the shoulder (north) — with a white 1-px glint that winks in the idle. A round
//  crimson buckler with a gold boss sits on the off arm; a crimson cloak hangs from the pauldrons
//  and sways, streaming behind the hero when walking. Short legs, bulky boots, compact torso.
//  Palette (5 ramps + outline, hue shifted: shadows toward violet, lights toward amber):
//    steel 1234 (+5 glint)  · crimson abcd (plume, cloak, shield, hose)  · leather ijkl (belt, boots, grip)
//    skin mno  · gold uvw (crest, guard, buckle, boss)  · magic xyz (cast glow)  · # outline  @ inner line
//  Light: top-left. Outline: one dark violet-navy (never black); the top-left (lit) edge uses the
//  lighter inner-line tone so the form breathes. Steel takes the glint; cloth stays matte.
//  Facings: south (front, toward camera), east (side, mirrored for west), north (back — the cloak
//  and plume carry it). Every facing is drawn deliberately.
import { Palette, paint, compose, mirrorLit, outline, line, setPx, solid, recolor, smearArc, makePix, shift, rotate90 } from './pixelPainter.js';

export const HERO_W = 48, HERO_H = 48, HERO_PIVOT_X = 24, HERO_PIVOT_Y = 46;

export const HERO_PALETTE = new Palette()
  .set('#', '#221a30')          // outline: dark violet-navy
  .set('@', '#463a5c')          // lit-edge / inner line
  .ramp('1234', '#8f98b0', { step: 0.12 })  // steel
  .set('5', '#f6f9ff')          // steel highlight
  .set('G', '#ffffff')          // sword glint (emissive)
  .ramp('abcd', '#b32f3a', { step: 0.1 })   // crimson
  .ramp('ijkl', '#6d4026', { step: 0.1 })   // leather
  .ramp('mno', '#d99c72', { step: 0.1 })    // skin
  .ramp('uvw', '#d6a23a', { step: 0.12 })   // gold
  .set('E', '#1a1422')          // eye
  .set('W', '#fff7ea')          // eye catch-light
  .set('F', '#fff4f0')          // hurt flash
  .ramp('xyz', '#7fd4ff', { step: 0.13 })   // magic glow
  .set('S', '#221a30');         // shadow-blob key (unused in sprites)

// ------------------------------------------------------------------------------------------ SOUTH
// Head: helm + face + plume. 18 wide. Placed at (15, 0).
const HEAD_S = paint(`
.......#c#........
......#cdc#.......
.....#bcdc#.......
.....#bccd#.......
.....#abc##.......
.....##a#####.....
....#44uvvv33#....
...#4444uv4333#...
..#54444uv433322#.
..#44444uv433322#.
.#444443343332221#
.#443##########21#
.#43#nmmmmmmmm#21#
.#43#onEEnEEnm#21#
.#43#onEWnEWnm#21#
.#43#onnnmnnnm#21#
.#43##onnnnnm##21#
..##..#onnnm#..##.
.......#####......`);

// Torso: gorget, pauldrons, breastplate, belt, tassets. 20 wide. Placed at (14, 18).
const TORSO_S = paint(`
.......#34443#......
..###..#34443#..###.
.#544#44444433#322#.
#5444#44444433#3221#
#4443#44444333#2211#
.#33#.#5444333#.#11#
..##..#4444333#..##.
......#4443332#.....
......#3433322#.....
......#lkkvjji#.....
.....#334433221#....
.....#344332211#....
.....#3#43#22#1#....
.....##.##.##.##....`);

// Legs (south): stand + walk poses. 14 wide, placed at (17, 32); feet on row 45.
const LEGS_S = {
  stand: paint(`
..#aaa#..#aaa#
..#bba#..#baa#
..#443#..#332#
..#443#..#332#
..#343#..#322#
..#443#..#332#
..#343#..#322#
..#lkj#..#kji#
..#lkj#..#kji#
.#lkkj#..#kkji#
.#lkkj#..#kkji#
.#kkjj#..#jjii#
.#jjii#..#iiii#
.####..... ####`),
  // left (screen-left) leg forward: it reads lower and larger; the right leg trails, boot lifted
  lfwd: paint(`
..#aaa#..#aaa#
..#bba#..#baa#
..#443#..#332#
..#443#..#332#
..#343#..#322#
..#443#..#322#
..#343#.#kji#.
..#lkj#.#kji#.
..#lkj##kkji#.
.#lkkj#.#jjii#
.#lkkj#..####.
.#kkjj#.......
.#jjii#.......
.####.........`),
  // right leg forward
  rfwd: paint(`
..#aaa#..#aaa#
..#bba#..#baa#
..#443#..#332#
..#443#..#332#
..#343#..#322#
..#443#..#332#
.#lkj#..#322#.
.#lkj#..#kji#.
.#lkkj##kkji#.
.#kkjj#.#kkji#
..####.#kkji#.
.......#jjii#.
.......#iiii#.
.........####.`),
  // passing: legs together, one knee crossing, body high
  pass: paint(`
..#aaa#..#aaa#
..#bba#..#baa#
..#443#..#332#
..#443#..#332#
..#343#..#322#
..#443#..#332#
..#343#..#322#
..#lkj#..#kji#
..#lkj#..#kji#
.#lkkj#..#kkji#
.#kkjj#..#jjii#
.#jjii#..#iiii#
.####....####.
..............`),
  squat: paint(`
..............
..............
..............
..#aaa#..#aaa#
.#4443#..#3322#
#4443#....#3322#
#343#......#322#
#lkj#......#kji#
#lkkj#....#kkji#
#lkkj#....#kkji#
#kkjj#....#jjii#
#jjii#....#iiii#
####........####
..............`),
};

// Round buckler on the off arm (screen-right in front view). Placed at (30, 23).
const SHIELD_S = paint(`
..###..
.#4c3#.
#4ccb3#
#4cvb2#
#3cbb2#
.#3b2#.
..###..`);

// Cloak seen from the front: a sliver behind each shoulder and the hem between/behind the legs.
// Placed at (13, 19). Three sway variants shift the hem.
const CLOAK_S = paint(`
.###..............###.
#aba#............#aab#
#aba#............#aab#
#aab#............#aab#
#aab#............#aaa#
.#ab#............#aa#.
.#ab#............#aa#.
..#a#............#a#..
..#a#............#a#..
..#a###..#aaa#..##a#..
...#aaa##aaaaa##aaa#..
....#aaaaaaaaaaaaa#...
.....#aaaaaaaaaaa#....
......###########.....`);

// ------------------------------------------------------------------------------------------ EAST
// Head (side): dome, plume streaming back, one eye, nose in profile. Placed at (15, 0).
const HEAD_E = paint(`
..#cc#............
.#cddc#...........
#bccddc#..........
#abbccc#..........
.##abbc####.......
...#ab#uvv43##....
....##4uvv4433#...
...#444uv443333#..
..#54444v4433322#.
..#4444444333322#.
..#4444334333221#.
..#44433#######1#.
..#44433#nmmmm#...
..#44433#onEEn#...
..#44333#onEWnn#..
..#43333#onnnm#...
...#3333##nnnm#...
....####..#nnm#...
..........####....`);

// Torso (side): the near pauldron, breastplate front to the right. 20 wide, placed at (14, 18).
const TORSO_E = paint(`
........#3443#......
.......######.......
.....##54443##......
....#444444332#.....
....#4444433221#....
....#3#44433221#....
.....##4443322#.....
......#4433221#.....
......#3433221#.....
......#lkkjjvi#.....
.....#344332211#....
.....#344332211#....
.....#3#43#22#1#....
.....##.##.##.##....`);

// Legs (side). 14 wide, placed at (17, 32). Far leg is the darker column on the left.
const LEGS_E = {
  stand: paint(`
...#a#bba#....
...#a#bba#....
...#2#443#....
...#2#443#....
...#2#343#....
...#2#443#....
...#2#343#....
...#1#443#....
...#j#lkj#....
...#j#lkj#....
...#j#lkkj#...
..#jj#lkkjj#..
..#ji#kkjji#..
..###.######..`),
  // contact: near leg planted forward, far leg stretched back
  c1: paint(`
...#a#bba#....
...#a#bba#....
..#2#.#443#...
..#2#..#443#..
..#2#..#343#..
.#2#...#443#..
.#1#....#343#.
.#j#....#443#.
#jj#....#lkj#.
#j#.....#lkkj#
#j#.....#lkkjj#
##......#kkjji#
........#######
..............`),
  // recoil: weight on the near leg, far leg swinging under
  r1: paint(`
...#a#bba#....
...#a#bba#....
...#2#443#....
...#2#443#....
...#2#343#....
..#2#.#443#...
..#1#.#343#...
..#j#.#443#...
.#jj#.#lkj#...
.#jj#.#lkkj#..
.##..#lkkjj#..
....#lkkjji#..
....########..
..............`),
  // passing: far leg lifts forward, near leg under the body
  p1: paint(`
...#a#bba#....
...#a#bba#....
...#2#443#....
...#22#443#...
...#2#.#343#..
...#1#.#443#..
...#j#.#343#..
..#jj#.#lkj#..
..#jj#.#lkkj#.
.#jjj#.#lkkjj#
.#jj#..#kkjji#
.####..#######
..............
..............`),
  // contact 2: far leg forward (still darker), near leg back
  c2: paint(`
...#a#bba#....
...#a#bba#....
...#2#.#43#...
...#2#..#43#..
..#22#..#43#..
..#2#...#33#..
.#22#....#43#.
.#1#.....#4#..
#jj#.....#kj#.
#jj#.....#kj#.
#jjj#...#lkj#.
#jji#..#lkkjj#
#####..#######
..............`),
  r2: paint(`
...#a#bba#....
...#a#bba#....
...#2#443#....
...#2#443#....
..#2##343#....
..#2##443#....
..#1#.#33#....
..#j#.#43#....
.#jj#.#kj#....
.#jj#.#kj#....
.#jjj##kkj#...
.#jji#lkkjj#..
.##########...
..............`),
  p2: paint(`
...#a#bba#....
...#a#bba#....
...#2#443#....
...#2#443#....
...#2#343#....
...#2#443#....
...#1#343#....
...#j#443#....
...#j#lkj#....
...#j#lkj#....
..#jj#lkkj#...
..#ji#lkkjj#..
..###.######..
..............`),
  squat: paint(`
..............
..............
..............
...#a#bba#....
..#2##4433#...
.#2#..#3443#..
.#1#...#343#..
.#j#....#lkj#.
#jj#....#lkkj#
#jj#....#lkkjj#
#jj#....#kkjji#
#ji#....#######
####..........
..............`),
};

// Cloak (side): hangs from the back of the pauldron, a strip behind the body that flares at the hem
// and streams back when walking (cloakDx). Placed at (13, 21).
const CLOAK_E = paint(`
.......##.
......#ab#
.....#abb#
.....#abb#
....#abbb#
....#abbb#
....#abbb#
...#abbba#
...#abbba#
...#abbba#
..#abbbaa#
..#abbbaa#
..#abbbaa#
.#abbbaaa#
.#abbbaa##
.#aabaaa#.
#aaaaaa#..
#######...`);

// Off-arm buckler seen from behind the body (side view): a sliver on the far side. Placed at (16, 24).
const SHIELD_E = paint(`
.###.
#43#.
#4c3#
#4c3#
#3b2#
.##..`);

// ------------------------------------------------------------------------------------------ NORTH
// Head (back): the dome with its crest ridge, plume falling forward-left over it, neck guard. (15, 0)
const HEAD_N = paint(`
......#cc#........
.....#cddc#.......
....#bcddc#.......
....#bccdc#.......
....#abccc#.......
.....#abb#####....
....#4#a#vv433#...
...#444#uvv4333#..
..#54444uvv433322#
..#44444uvv433322#
.#4444444vv4333221#
.#4444433vv3332221#
.#4444433vv3332221#
.#4444433uv3322221#
.#444433@uv@322211#
.#44333###3##22211#
..#43333333322221#.
..##333333322221##.
....############..`);

// Torso from behind: pauldrons, the cloak covers the back. (14, 18)
const TORSO_N = paint(`
.......#34443#......
..###..#34443#..###.
.#544#########322#..
#5444#........#3221#
#4443#........#2211#
.#33#..........#11#.
..##............##..`);

// Cloak from behind: gathered at the shoulders, flaring to a scalloped hem, two long folds
// (a lit ridge and a shadow crease) running down the back. Placed at (12, 20).
const CLOAK_N = paint(`
.....##############..
....#ddccccbbbbaa#...
....#dcccccbbbbaaa#..
...#dccccbcbbbabaaa#.
...#ccccbccbbbabaaa#.
...#ccccbccbbbabbaa#.
..#cccccbccbbbabbaaa#
..#cccccbccbbabbbaaa#
..#ccccbbccbbabbbaaa#
..#ccccbbccbbabbbaaa#
..#ccccbbcccbabbbaaa#
.#ccccbbcccbabbbbaaa#
.#ccccbbcccbabbbbaaa#
.#cccbbbcccbabbbbaaa#
.#cccbbbccbbabbbbaaa#
.#cccbbbccbbabbbbaaa#
.#ccbbbbccbbaabbbaaa#
.#ccbbbbccbbaabbbaaa#
.#bbbbbbbbbbaabbaaaa#
.#aaaaaaaaaaaaaaaaaa#
..####.######.######.`);

// Shield seen from behind (its back strap side), off the hero's left = screen-left. (12, 23)
const SHIELD_N = paint(`
.###..
#43##.
#4jk3#
#4jj3#
#3jj2#
.#32#.
..##..`);

// Legs from behind (boots point away: heels). 14 wide at (17, 32). Reuse the front walk poses
// with the boots re-shaded (heel dark) — the cloak hides most of them.
const LEGS_N = Object.fromEntries(Object.entries(LEGS_S).map(([k, p]) => [k, recolor(p, { l: 'k', k: 'j', j: 'i' })]));

// ------------------------------------------------------------------------------------------ rig helpers
/** A 2-px steel arm from shoulder (sx,sy) to hand (hx,hy) with a gauntlet at the hand. */
function armPix(sx, sy, hx, hy, { key = '3', key2 = '2', gauntlet = true } = {}) {
  const p = makePix(HERO_W, HERO_H);
  line(p, sx, sy, hx, hy, key);
  line(p, sx + 1, sy, hx + 1, hy, key2);
  if (gauntlet) { for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) setPx(p, hx + x, hy + y, (x < 0 || y < 0) ? '3' : '2'); }
  return outline(p, '#', { lit: { x: -1, y: -1 }, litKey: '@' });
}

/**
 * The longsword: `len` px of blade at `angle` (degrees, 0 = up, clockwise), gold guard, leather grip,
 * gold pommel. Returns a full-canvas Pix drawn with the grip centre at (gx,gy). `glint` adds the
 * idle wink on the blade edge.
 */
function swordPix(gx, gy, angle, { len = 16, glint = 0 } = {}) {
  const p = makePix(HERO_W, HERO_H);
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);       // along the blade (toward the tip)
  const nx = -dy, ny = dx;                          // across the blade
  const r = (v) => Math.round(v);
  const gxs = gx + dx * 2, gys = gy + dy * 2;       // guard sits 2px above the grip centre
  // blade: two parallel lines (lit edge '4', shadow edge '3') + a tip
  const tipX = gxs + dx * len, tipY = gys + dy * len;
  line(p, r(gxs + dx), r(gys + dy), r(tipX - dx), r(tipY - dy), '3');
  line(p, r(gxs + dx - nx * 0.9), r(gys + dy - ny * 0.9), r(tipX - dx * 2 - nx * 0.9), r(tipY - dy * 2 - ny * 0.9), '4');
  setPx(p, r(tipX), r(tipY), '4');
  if (glint > 0) { const t = 0.35 + glint * 0.4; setPx(p, r(gxs + dx * len * t - nx * 0.9), r(gys + dy * len * t - ny * 0.9), 'G'); setPx(p, r(gxs + dx * len * t - nx * 0.9 + dx), r(gys + dy * len * t - ny * 0.9 + dy), 'G'); }
  // guard
  for (let k = -2; k <= 2; k++) setPx(p, r(gxs + nx * k), r(gys + ny * k), k === -2 ? 'w' : k === 2 ? 'u' : 'v');
  // grip + pommel
  setPx(p, r(gx), r(gy), 'j'); setPx(p, r(gx - dx), r(gy - dy), 'k');
  setPx(p, r(gx - dx * 2), r(gy - dy * 2), 'v');
  return outline(p, '#', { lit: { x: -1, y: -1 }, litKey: '@' });
}

/** Pale magic orb for the cast frames, radius r around (cx,cy). */
function orbPix(cx, cy, r) {
  const p = makePix(HERO_W, HERO_H);
  for (let y = -r - 1; y <= r + 1; y++) for (let x = -r - 1; x <= r + 1; x++) {
    const d = Math.hypot(x, y);
    if (d > r + 0.3) continue;
    setPx(p, cx + x, cy + y, d < r * 0.45 ? 'z' : d < r * 0.8 ? 'y' : 'x');
  }
  return p;
}

// Selective outline applied to hand-drawn parts already carrying '#': only their lit (top-left)
// outline pixels are softened to '@' where the neighbour inside is a light tone.
function softenLitEdges(p) {
  const o = { w: p.w, h: p.h, d: new Uint16Array(p.d) };
  const HASH = '#'.charCodeAt(0), AT = '@'.charCodeAt(0);
  const light = new Set(['4', '5', 'd', 'l', 'o', 'w', 'c'].map((c) => c.charCodeAt(0)));
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (p.d[y * p.w + x] !== HASH) continue;
    // lit edge: the pixel below-right (inside) is a light tone and the pixel above-left is empty
    const inR = x + 1 < p.w ? p.d[y * p.w + x + 1] : 0, inD = y + 1 < p.h ? p.d[(y + 1) * p.w + x] : 0;
    const outL = x > 0 ? p.d[y * p.w + x - 1] : 0, outU = y > 0 ? p.d[(y - 1) * p.w + x] : 0;
    if ((light.has(inR) && !outL) || (light.has(inD) && !outU)) o.d[y * p.w + x] = AT;
  }
  return o;
}

// ------------------------------------------------------------------------------------------ composer
const L = (p, x, y, mirror = false) => (p ? { p, x, y, mirror } : null);

/**
 * Compose one hero frame.
 * @param {'S'|'E'|'N'} f facing
 * @param {object} o pose: body/head offsets, legs pose key, cloak sway, sword {angle,len,glint,gx,gy} or null,
 *   arm {sx,sy,hx,hy} for the sword arm, shield bool, offArm {sx,sy,hx,hy}, orb {cx,cy,r}, extra layers
 */
function frame(f, o = {}) {
  const bx = o.dx || 0, by = o.dy || 0;                // whole-body offset (bob, lunge)
  const hdx = (o.hdx || 0) + bx, hdy = (o.hdy || 0) + by; // head extra offset
  const cloakDy = (o.cloakDy || 0), cloakDx = (o.cloakDx || 0);
  const layers = [];
  const legs = f === 'S' ? LEGS_S : f === 'E' ? LEGS_E : LEGS_N;
  const legPix = legs[o.legs || 'stand'];
  const legDy = o.legDy || 0;
  // the smear is a ghost of the blade's path: drawn behind the sword arm (and behind the whole
  // figure when the cut goes away from the camera), never over the body
  const smear = o.smear ? o.smear(makePix(HERO_W, HERO_H)) : null;
  if (f === 'S') {
    layers.push(L(o.cloak === false ? null : CLOAK_S, 13 + cloakDx + bx, 19 + cloakDy + by));
    if (o.swordBehind && o.sword) layers.push(L(o.sword, 0, 0));
    layers.push(L(legPix, 17, 32 + legDy));
    layers.push(L(TORSO_S, 14 + bx, 18 + by));
    if (o.offArm) layers.push(L(armPix(o.offArm.sx + bx, o.offArm.sy + by, o.offArm.hx + bx, o.offArm.hy + by), 0, 0));
    if (o.shield !== false) layers.push(L(SHIELD_S, 30 + bx + (o.shieldDx || 0), 23 + by + (o.shieldDy || 0)));
    layers.push(L(HEAD_S, 15 + hdx, 0 + hdy));
    if (smear) layers.push(L(smear, 0, 0));
    if (o.arm) layers.push(L(armPix(o.arm.sx + bx, o.arm.sy + by, o.arm.hx + bx, o.arm.hy + by), 0, 0));
    if (o.sword && !o.swordBehind) layers.push(L(o.sword, 0, 0));
  } else if (f === 'E') {
    layers.push(L(o.cloak === false ? null : CLOAK_E, 13 + cloakDx + bx, 21 + cloakDy + by));
    if (o.shield !== false) layers.push(L(SHIELD_E, 16 + bx, 24 + by));
    if (o.swordBehind && o.sword) layers.push(L(o.sword, 0, 0));
    layers.push(L(legPix, 17, 32 + legDy));
    layers.push(L(TORSO_E, 14 + bx, 18 + by));
    layers.push(L(HEAD_E, 15 + hdx, 0 + hdy));
    if (smear) layers.push(L(smear, 0, 0));
    if (o.arm) layers.push(L(armPix(o.arm.sx + bx, o.arm.sy + by, o.arm.hx + bx, o.arm.hy + by), 0, 0));
    if (o.sword && !o.swordBehind) layers.push(L(o.sword, 0, 0));
  } else {
    if (smear) layers.push(L(smear, 0, 0));
    if (o.sword) layers.push(L(o.sword, 0, 0));
    if (o.arm) layers.push(L(armPix(o.arm.sx + bx, o.arm.sy + by, o.arm.hx + bx, o.arm.hy + by), 0, 0));
    layers.push(L(legPix, 17, 32 + legDy));
    layers.push(L(TORSO_N, 14 + bx, 18 + by));
    if (o.shield !== false) layers.push(L(SHIELD_N, 12 + bx, 23 + by));
    layers.push(L(o.cloak === false ? null : CLOAK_N, 12 + cloakDx + bx, 20 + cloakDy + by));
    layers.push(L(HEAD_N, 15 + hdx, 0 + hdy));
  }
  if (o.orb) layers.push(L(orbPix(o.orb.cx + bx, o.orb.cy + by, o.orb.r), 0, 0));
  for (const e of o.extra || []) layers.push(e);
  const px = compose(HERO_W, HERO_H, layers);
  return softenLitEdges(px);
}

// Rest poses of the sword arm per facing: shoulder -> hand, and where the grip sits.
const ARM_S = { sx: 20, sy: 24, hx: 16, hy: 27 };  // hero's right arm = screen-left
const ARM_E = { sx: 25, sy: 24, hx: 29, hy: 28 };
const ARM_N = { sx: 29, sy: 23, hx: 32, hy: 26 };

const swordS = (g = 0, angle = -8, len = 16, dx = 0, dy = 0) => swordPix(ARM_S.hx + dx, ARM_S.hy + dy, angle, { len, glint: g });
const swordE = (g = 0, angle = 38, len = 15, dx = 0, dy = 0) => swordPix(ARM_E.hx + dx, ARM_E.hy + dy, angle, { len, glint: g });
const swordN = (g = 0, angle = 12, len = 15, dx = 0, dy = 0) => swordPix(ARM_N.hx + dx, ARM_N.hy + dy, angle, { len, glint: g });

const armAt = (a, dx, dy) => ({ sx: a.sx, sy: a.sy, hx: a.hx + dx, hy: a.hy + dy });

// ------------------------------------------------------------------------------------------ animations
/** @typedef {{name:string, facing:'S'|'E'|'N', frames:Pix[], durations:number[], loop:boolean, hold?:number}} HeroAnim */

function idle(f) {
  // breathe (body 1px), cloak sway (hem 1px), sword glint on the third frame
  const A = f === 'S' ? ARM_S : f === 'E' ? ARM_E : ARM_N;
  const sw = f === 'S' ? swordS : f === 'E' ? swordE : swordN;
  const mk = (dy, cloakDy, glint, cdx = 0) => frame(f, { dy, hdy: 0, cloakDy, cloakDx: cdx, legDy: 0, arm: armAt(A, 0, dy), sword: sw(glint, undefined, undefined, 0, dy) });
  return { frames: [mk(0, 0, 0), mk(1, 0, 0, 0), mk(1, 1, 1, f === 'E' ? -1 : 0), mk(0, 1, 0, 0)], durations: [340, 260, 200, 300], loop: true };
}

function walk(f) {
  const A = f === 'S' ? ARM_S : f === 'E' ? ARM_E : ARM_N;
  const sw = f === 'S' ? swordS : f === 'E' ? swordE : swordN;
  // legs pose, body bob (dy), cloak swing, sword arm swing (dx/dy of the hand)
  const seq = f === 'E'
    ? [['c1', 0, -1, 0, 0], ['r1', 1, -1, 1, 1], ['p1', -1, -2, 1, 0], ['c2', 0, -1, 0, 0], ['r2', 1, 0, -1, 1], ['p2', -1, -1, -1, 0]]
    : [['lfwd', 0, 0, 0, 0], ['lfwd', 1, 1, 1, 1], ['pass', -1, 0, 1, 0], ['rfwd', 0, 0, 0, 0], ['rfwd', 1, 1, -1, 1], ['pass', -1, 0, -1, 0]];
  const frames = seq.map(([legs, dy, cdy, hx, hy]) => frame(f, {
    legs, dy, legDy: 0, cloakDy: cdy, cloakDx: f === 'E' ? -1 - Math.max(0, -cdy) : 0,
    arm: armAt(A, hx, dy + hy), sword: sw(0, undefined, undefined, hx, dy + hy),
  }));
  return { frames, durations: [90, 90, 90, 90, 90, 90], loop: true };
}

function attack(f) {
  const frames = [];
  if (f === 'S') {
    // anticipation: sword drawn up and back over the right shoulder, body coils
    frames.push(frame('S', { dy: 1, hdx: 1, arm: { sx: 20, sy: 24, hx: 13, hy: 22 }, sword: swordPix(13, 22, -35, { len: 16 }), cloakDy: -1 }));
    // lunge: the cut sweeps across the front with a smear arc, body forward (down-screen)
    frames.push(frame('S', {
      dy: -1, legs: 'lfwd', arm: { sx: 20, sy: 24, hx: 28, hy: 31 }, sword: swordPix(28, 31, 118, { len: 15 }),
      smear: (px) => smearArc(px, 24, 30, 14, 18, -2.0, 0.85, ['2', '3', '4', '4', '4']),
    }));
    // follow-through: blade low and across, body forward
    frames.push(frame('S', { dy: 0, legs: 'lfwd', arm: { sx: 20, sy: 24, hx: 31, hy: 33 }, sword: swordPix(31, 33, 130, { len: 14 }), cloakDy: 1 }));
    // recover
    frames.push(frame('S', { dy: 0, arm: { sx: 20, sy: 24, hx: 18, hy: 29 }, sword: swordPix(18, 29, 20, { len: 16 }), cloakDy: 1 }));
  } else if (f === 'E') {
    frames.push(frame('E', { dx: -1, dy: 1, hdx: -1, arm: { sx: 25, sy: 24, hx: 21, hy: 18 }, sword: swordPix(21, 18, -40, { len: 15 }), cloakDx: -1, cloakDy: -1 }));
    frames.push(frame('E', {
      dx: 3, dy: -1, legs: 'c1', arm: { sx: 28, sy: 24, hx: 38, hy: 24 }, sword: swordPix(38, 24, 100, { len: 14 }),
      smear: (px) => smearArc(px, 29, 27, 12, 16, -2.05, 0.3, ['2', '3', '4', '4', '4']), cloakDx: -3, cloakDy: 0,
    }));
    frames.push(frame('E', { dx: 3, dy: 0, legs: 'c1', arm: { sx: 28, sy: 24, hx: 36, hy: 31 }, sword: swordPix(36, 31, 135, { len: 13 }), cloakDx: -3, cloakDy: 1 }));
    frames.push(frame('E', { dx: 1, arm: { sx: 26, sy: 24, hx: 31, hy: 29 }, sword: swordPix(31, 29, 60, { len: 15 }), cloakDx: -1, cloakDy: 1 }));
  } else {
    frames.push(frame('N', { dy: 1, arm: { sx: 29, sy: 23, hx: 34, hy: 26 }, sword: swordPix(34, 26, 30, { len: 15 }), cloakDy: -1 }));
    frames.push(frame('N', {
      dy: -2, legs: 'lfwd', arm: { sx: 29, sy: 23, hx: 24, hy: 14 }, sword: swordPix(24, 14, -70, { len: 14 }),
      smear: (px) => smearArc(px, 30, 24, 11, 15, -3.0, -1.35, ['2', '3', '4', '4', '4']), cloakDy: -1,
    }));
    frames.push(frame('N', { dy: -1, legs: 'lfwd', arm: { sx: 29, sy: 23, hx: 20, hy: 18 }, sword: swordPix(20, 18, -100, { len: 13 }), cloakDy: 0 }));
    frames.push(frame('N', { dy: 0, arm: armAt(ARM_N, 0, 1), sword: swordN(0, 12, 15, 0, 1), cloakDy: 1 }));
  }
  return { frames, durations: [110, 80, 110, 140], loop: false };
}

function hurt(f) {
  const A = f === 'S' ? ARM_S : f === 'E' ? ARM_E : ARM_N;
  const sw = f === 'S' ? swordS : f === 'E' ? swordE : swordN;
  const lean = f === 'E' ? -2 : 0;
  const recoil = frame(f, { dx: lean, dy: 1, hdx: lean, hdy: 1, cloakDy: -1, arm: armAt(A, 0, 2), sword: sw(0, f === 'E' ? 60 : f === 'S' ? -30 : 30, 15, 0, 2) });
  return { frames: [solid(recoil, 'F'), recoil], durations: [70, 160], loop: false };
}

function death() {
  // Facing-independent: stagger, buckle, topple onto the back, lie, lie (the material fades it).
  const f1 = frame('S', { dy: 1, hdx: -1, hdy: 1, cloakDy: -1, arm: { sx: 20, sy: 24, hx: 14, hy: 30 }, sword: swordPix(14, 30, -20, { len: 15 }) });
  const f2 = frame('S', { legs: 'squat', dy: 3, hdy: 4, hdx: -1, cloakDy: 2, arm: { sx: 20, sy: 27, hx: 12, hy: 34 }, sword: swordPix(12, 34, -35, { len: 14 }), shield: false, extra: [L(SHIELD_S, 31, 27)] });
  // lying: the side-view figure turned a lossless quarter turn onto its back (head left, plume
  // trailing), the cloak spread beneath it and the sword dropped in front.
  const side = frame('E', { legs: 'stand', shield: false, cloak: true, arm: { sx: 25, sy: 24, hx: 28, hy: 30 }, sword: null });
  const turned = rotate90(side, false);
  const lying = compose(HERO_W, HERO_H, [
    L(turned, 1, 9),
    L(swordPix(30, 44, 96, { len: 14 }), 0, 0),
  ]);
  const f3 = shift(lying, 0, -3);
  return { frames: [f1, f2, f3, lying, lying], durations: [140, 160, 160, 700, 600], loop: false };
}

function cast(f) {
  const A = f === 'S' ? ARM_S : f === 'E' ? ARM_E : ARM_N;
  const sw = f === 'S' ? swordS : f === 'E' ? swordE : swordN;
  // off hand rises with a growing orb; the sword arm lowers a touch
  const off = f === 'S' ? [{ sx: 30, sy: 24, hx: 34, hy: 20 }, { sx: 30, sy: 24, hx: 35, hy: 16 }, { sx: 30, sy: 24, hx: 35, hy: 15 }]
    : f === 'E' ? [{ sx: 24, sy: 24, hx: 30, hy: 20 }, { sx: 24, sy: 24, hx: 32, hy: 16 }, { sx: 24, sy: 24, hx: 32, hy: 15 }]
      : [{ sx: 19, sy: 24, hx: 15, hy: 20 }, { sx: 19, sy: 24, hx: 14, hy: 16 }, { sx: 19, sy: 24, hx: 14, hy: 15 }];
  const frames = off.map((oa, i) => frame(f, {
    dy: i === 0 ? 1 : 0, offArm: oa, shield: f === 'N', arm: armAt(A, 0, 1), sword: sw(0, undefined, undefined, 0, 1),
    orb: i === 0 ? { cx: oa.hx, cy: oa.hy - 3, r: 1 } : { cx: oa.hx, cy: oa.hy - 4, r: i === 1 ? 3 : 4 },
    extra: i === 2 ? [L(paint(`
.x...x.
..x.x..
x..z..x
..x.x..
.x...x.`), oa.hx - 3, oa.hy - 8)] : [],
  }));
  return { frames, durations: [140, 160, 420], loop: false };
}

function pickup(f) {
  const A = f === 'S' ? ARM_S : f === 'E' ? ARM_E : ARM_N;
  const sw = f === 'S' ? swordS : f === 'E' ? swordE : swordN;
  const crouch = frame(f, { legs: 'squat', dy: 3, hdy: 4, cloakDy: 2, arm: armAt(A, f === 'E' ? 3 : -2, 6), sword: sw(0, f === 'E' ? 70 : f === 'S' ? 25 : 30, 14, f === 'E' ? 3 : -2, 6) });
  // cheer: sword thrust straight up, glint
  const up = f === 'S' ? { sx: 20, sy: 24, hx: 14, hy: 17 } : f === 'E' ? { sx: 25, sy: 24, hx: 30, hy: 17 } : { sx: 29, sy: 23, hx: 33, hy: 17 };
  const cheer = frame(f, { dy: -1, hdy: -1, cloakDy: 1, arm: up, sword: swordPix(up.hx, up.hy, f === 'E' ? 8 : f === 'N' ? 4 : -4, { len: 16, glint: 1 }) });
  return { frames: [crouch, cheer], durations: [150, 320], loop: false };
}

/**
 * Build every hero animation: name -> facing -> HeroAnim. West is the mirrored east (lit tones
 * swapped so the light stays top-left).
 * @returns {{anims: Object<string, Object<string, HeroAnim>>, palette: Palette, w:number, h:number, pivot:{x:number,y:number}}}
 */
export function buildHero() {
  const anims = {};
  const put = (name, facing, a) => { (anims[name] ||= {})[facing] = { name, facing, ...a }; };
  for (const f of ['S', 'E', 'N']) {
    put('idle', f, idle(f));
    put('walk', f, walk(f));
    put('attack', f, attack(f));
    put('hurt', f, hurt(f));
    put('cast', f, cast(f));
    put('pickup', f, pickup(f));
  }
  const d = death();
  for (const f of ['S', 'E', 'N']) put('death', f, d);
  // west: mirror east, swapping the steel lit/shadow pair so the light keeps coming from top-left
  for (const name of Object.keys(anims)) {
    const e = anims[name].E;
    anims[name].W = { ...e, facing: 'W', frames: e.frames.map((p) => name === 'death' ? p : mirrorLit(p, '')) };
  }
  return { anims, palette: HERO_PALETTE, w: HERO_W, h: HERO_H, pivot: { x: HERO_PIVOT_X, y: HERO_PIVOT_Y }, emissive: 'Gxyz' };
}

export { frame as composeHeroFrame, swordPix, armPix };

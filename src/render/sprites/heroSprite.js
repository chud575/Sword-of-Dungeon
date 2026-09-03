// heroSprite: the hero as an HD-2D pixel sprite (Octopath / Triangle Strategy style), hand-pixelled
// part by part and composed into animation sheets.
//
// DESIGN NOTE
//  Silhouette: chibi-heroic knight, ~2.9 heads tall on a 48×48 canvas (figure ≈ 30×46 px, feet on
//  row 45, pivot x=24). A big rounded sallet helm with a gold comb and a crimson plume is the read
//  at any distance. A straight longsword is the one dominant weapon shape — held point-up beside the
//  head (south), diagonal up-forward (east) and rising past the shoulder (north); its blade is
//  marched, not line-drawn, so a diagonal never checkerboards. A round crimson buckler with a gold
//  boss sits on the off arm; a crimson mantle falls from the pauldrons and shears from the shoulders
//  down as the hero moves. Short legs, bulky boots, compact breastplate with a gold sternum boss.
//
//  THE BACK VIEW is drawn as a body wearing a cape, never as a cape wearing a helmet: the mantle is
//  hung from a gold clasp on a visible steel back plate, is NARROWER than the shoulders, and the
//  pauldrons, upper arms and gauntlets are composited ON TOP of it, with the boots below its hem.
//
//  Palette (6 ramps + outline, hue shifted: shadows toward violet, lights toward amber):
//    steel 1234 (+5 specular)  · crimson eabcd (plume, mantle, buckler, hose)  · leather hijkl
//    skin mno  · gold uvw (comb, guard, buckle, boss)  · tan pqr (cloth trim)  · magic xyz
//    # outline (near-black violet)  @ lit-edge / inner line
//  Ramp discipline: hue/sat shifts stay small on the warm ramps — a big shift turns dark gold into
//  burnt red and skin shadow into clown blush at this size.
//  Light: top-left. One dark outline, selectively softened to '@' on the lit (top-left) edge.
//  Facings: south (front), east (side; west = mirrored east), north (back). Every facing is drawn
//  deliberately; nothing is a rotation of anything else.
import { Palette, paint, compose, mirrorLit, outline, line, setPx, solid, recolor, smearArc, makePix, shift, rotate90 } from './pixelPainter.js';

export const HERO_W = 48, HERO_H = 48, HERO_PIVOT_X = 24, HERO_PIVOT_Y = 46;

export const HERO_PALETTE = new Palette()
  .set('#', '#1b1426')          // outline: near-black violet (never pure black)
  .set('@', '#544a63')          // lit-edge / inner line (kept off-blue: a violet edge reads as a lilac glow under torchlight)
  // steel: a near-neutral grey base so the plate still reads as steel under the dungeon's very blue
  // ambient; the ramp does the hue work (shadows to violet, highlights to amber). Seated low enough
  // that the armour keeps interior structure instead of blowing out to white near a torch.
  .ramp('1234', '#848c9a', { step: 0.138, satShift: 0.14 })
  .set('5', '#eaf0ff')          // steel specular (1-px edges only)
  .set('G', '#ffffff')          // sword glint (emissive)
  .ramp('eabcd', '#b02f3a', { step: 0.082, mid: 2, hueShift: 0.016, satShift: 0.04 })  // crimson cloth (+ 'e' deep crease; shadows stay red, never magenta)
  .ramp('pqr', '#b8925e', { step: 0.1 })    // cloak lining / cloth trim (warm tan)
  .ramp('hijkl', '#6d4026', { step: 0.09, mid: 2 })   // leather (+ 'h' deep)
  .ramp('mno', '#e2ab84', { step: 0.058, satShift: 0.0, hueShift: 0.015 })  // skin (gentle: a face this small must not blotch)
  .ramp('uvw', '#d6a23a', { step: 0.105, hueShift: 0.012, satShift: 0.04 })  // gold (a big hue shift turns the dark tone burnt red, not gold)
  .set('E', '#221a2e')          // eye
  .set('W', '#fff7ea')          // eye catch-light
  .set('F', '#fff4f0')          // hurt flash
  .ramp('xyz', '#7fd4ff', { step: 0.13 })   // magic glow
  .set('S', '#221a30');         // shadow-blob key (unused in sprites)

// ------------------------------------------------------------------------------------------ SOUTH
// Head: helm + face + plume. 18 wide. Placed at (15, 0).
const HEAD_S = paint(`
....#dc#..........
...#cddc#.........
...#bcddc#........
....#bccdc#.......
.....#abccb#......
.....#abb##.......
....#443uvw3#.....
...#4443uvw333#...
..#54443uvw33221#.
.#544443uvw33221#.
.#44443443332211#.
.#43#@@@@@@@@#21#.
.#43#mmnnnnmm#21#.
.#43#nWEnnWEn#21#.
.#43#nEEnnEEn#21#.
.#33#onnmnnno#21#.
.#43##onmmno##21#.
..##..#onno#....##
.......#####......`);

// Torso: gorget, pauldrons, breastplate, belt, tassets. 20 wide. Placed at (14, 18).
const TORSO_S = paint(`
.......#3223#.......
..###..#3223#..###..
.#544#54443332#322#.
#5444#54443322#3221#
#4443#44443322#2211#
.#33#.#4443222#.#11#
..##..#444u322#..##.
......#443uw22#.....
......#4433222#.....
......#hijuwji#.....
.....#334433221#....
.....#344332211#....
.....#3#43#22#1#....
.....##.##.##.##....`);

// Legs (south): stand + walk poses. 14 wide, placed at (17, 32); feet on row 45.
const LEGS_S_RAW = {
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
  // going down: one knee planted, the other folded under
  kneel: paint(`
..............
..............
..............
..#aaa#.#aaa#.
..#443#.#332#.
..#443#.#3322#
..#343#.#322#.
..#lkj#.#kj#..
.#lkkj#.#kj#..
.#lkkj##kkj#..
.#kkjj#kkjj#..
.#jjii#jjii#..
.###########..
..............`),
  // down: both knees folded, the legs read only as boots under the body
  down: paint(`
..............
..............
..............
..............
..............
.#aaa#..#aaa#.
.#443#..#332#.
.#kji#..#kji#.
#kkji#..#kkji#
#kkjii##jjii#.
#jjiii##iiii#.
##############
..............
..............`),
};

// The crimson hose under the tassets is in shadow: deepen it so it reads as cloth in the dark, not
// as bright red shorts. (Applied to every pose so the ramp stays consistent across facings.)
const shadeHose = (set) => Object.fromEntries(Object.entries(set).map(([k, p]) => [k, recolor(p, { b: 'a', a: 'e' })]));
const LEGS_S = shadeHose(LEGS_S_RAW);

// The cape pooled on the floor once the hero goes down: a low crimson ellipse, lit on the left,
// with the folds still reading. Placed under the death heap at (10, 36).
const CLOAK_POOL = paint(`
........############........
....#ccbbbaaaaaeeeeeeee#....
..#cccbbbbaaaaaeeeeeeeeee#..
.#cccbbbbaaaaaaeeeeeeeeeee#.
#ccccbbbbbaaaaaaeeeeeeeeeee#
.#cccbbbbaaaaaaeeeeeeeeeee#.
..#ccbbbbaaaaaaeeeeeeeeee#..
.....##################.....`);

// Round buckler on the off arm (screen-right in front view). Placed at (30, 23).
const SHIELD_S = paint(`
..###..
.#4c3#.
#4ccb3#
#4cvb2#
#3cbb2#
.#3b2#.
..###..`);

// Cloak seen from the front: crimson panels falling outside each pauldron with the warm tan lining
// ('q') showing where the cloth turns, and the hem running down between the legs. Placed at (11, 19).
// Cloth moves from the shoulders down, so the sway variants shear the lower rows progressively.
const CLOAK_S = paint(`
.....###..............###.....
.....#c#..............#a#.....
....#cc#..............#aa#....
....#cc#..............#aa#....
....#cbb#............#aae#....
....#cbb#............#aae#....
...#ccbb#............#aaee#...
...#ccbb#............#aaee#...
...#cbbb#............#aaee#...
...#cbbb#............#aaee#...
..#ccbbb#............#aaaee#..
..#ccbbb#............#aaaee#..
..#cbbbb#............#aaaee#..
..#cbbbb#............#aaaee#..
.#ccbbbb#............#aaaaee#.
.#ccbbbb#....#ab#....#aaaaee#.
.#cbbbbb#.....#ab#...#aaaaee#.
.#cbbbbb#.....#ab#...#aaaaee#.
.#bbbbbb#.....#ab#...#aaaeee#.
.#bbbbbb#.....#ab#...#aaaeee#.
..#bbbb#......#ab#....#aaee#..
..#bbb#.......#ab#.....#aee#..
...##.........#ab#......##....
..............#ab#............`);

/**
 * Cloth swings from the top: shear a hanging Pix so each row below `from` slides a little further,
 * which is how an animator draws a cape catching up with the body (never a rigid 1-px shove).
 */
function sway(p, dx, from = 6) {
  const o = makePix(p.w, p.h);
  const span = Math.max(1, p.h - from);
  for (let y = 0; y < p.h; y++) {
    const t = Math.max(0, (y - from) / span);
    const s = Math.round(dx * t * t);
    for (let x = 0; x < p.w; x++) { const k = p.d[y * p.w + x]; if (k) setPx(o, x + s, y, k); }
  }
  return o;
}

// idle drift / walk swing of the front cloak: 0 rest, 1 left, 2 right, 3 lifted (running)
const CLOAK_S_SWAY = [CLOAK_S, sway(CLOAK_S, -2), sway(CLOAK_S, 2), sway(CLOAK_S, -1, 4)];

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
..#44433#nmmmn#...
..#44333#nWEnno#..
..#44333#nEEnno#..
..#43333#onnmno#..
...#3333##onnm#...
....####..#nnm#...
..........####....`);

// Torso (side): the near pauldron, breastplate front to the right. 20 wide, placed at (14, 18).
const TORSO_E = paint(`
........#2112#......
.......########.....
.....##5444332##....
....#44443332221#...
....#444433322211#..
....#3#4433322211#..
.....##443332221#...
......#44u33221#....
......#443u3221#....
......#hijuwji#.....
.....#344332221#....
.....#344332211#....
.....#3#43#22#1#....
.....##.##.##.##....`);

// Legs (side). 14 wide, placed at (17, 32). Far leg is the darker column on the left.
const LEGS_E_RAW = {
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
const LEGS_E = shadeHose(LEGS_E_RAW);

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
// Head (back): the dome seen from behind — the gold comb runs up the centre, the plume roots on top
// and falls away from the camera, and a three-lame nape guard closes the neck. (15, 0)
const HEAD_N = paint(`
.....#dc#.........
....#cddc#........
....#bcddc#.......
.....#bccb#.......
.....#abb##.......
.....#ab#.........
....#443uvw3#.....
...#4443uvw333#...
..#444433uvw3321#.
.#544433uvw33221#.
.#544333uvw33221#.
.#444333uvw33221#.
.#443333uvw32211#.
.#443333uvw32211#.
.#44433333v322211#
.#4@@@@@@@@@@@21#.
..#443333322211#..
..#@@@@@@@@@@@#...
...############...`);

// Torso from behind: gorget, big pauldrons AND the hanging upper arms — drawn ON TOP of the mantle
// so the back reads as a body wearing a cape rather than a cape wearing a helmet. (14, 18)
const TORSO_N = paint(`
.......#2112#.......
..####.#3223#.####..
.#5444#443322#3222#.
#54444#443322#32221#
#54443#443322#32211#
#44433#4uvw32#22111#
.#443#........#221#.
.#43#..........#12#.
.#43#..........#12#.
.#33#..........#22#.
.#kj#..........#jk#.
.#kj#..........#jk#.
.#32#..........#23#.
.####..........####.`);

// The mantle from behind: hung from the gold clasp on the back plate, NARROWER than the shoulders so
// the pauldrons and arms flank it, falling to a scalloped knee-length hem. Four aligned folds — two
// deep creases ('e') and a lit centre ridge ('c') — give it cloth over a body, not a flat red blob.
// Placed at (12, 23).
const CLOAK_N = paint(`
.......#ebbcbbbe#.......
.....#baebbcbbbeaa#.....
.....#baebbcbbbeaa#.....
.....#baebbcbbbeaa#.....
.....#baebbcbbbeaa#.....
....#bbaebbcbbbeaaa#....
....#bbaebbcbbbeaaa#....
....#cbaebbcbbbeaaa#....
....#cbaebbcbbbeaae#....
....#cbaebbcbbbeaae#....
....#cbaebbcbbbeaae#....
..#ccbbaebbcbbbeaaaee#..
..#ccbbaebbcbbbeaaaee#..
..#ccbbaebbcbbbeaaaee#..
..#cbbbaebbcbbbeaaaee#..
..#cbbbaebbcbbbeaaaee#..
..#cbb#aebb#cbbb#aaee#..
...###..####..####..##..`);

// walk/idle sway: cloth trails the body, so the whole mantle shears from the shoulders down
const CLOAK_N_SWAY = [CLOAK_N, sway(CLOAK_N, -2), sway(CLOAK_N, 2), sway(CLOAK_N, -1, 3)];

// Shield seen from behind (the strap side), on the hero's left = screen-left from the back. (11, 24)
const SHIELD_N = paint(`
.###..
#432##
#4jk32
#4jj32
#3jj21
.#321#
..###.`);

// Legs from behind (boots point away: heels). 14 wide at (17, 32).
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
  // Blade: march densely along the axis stamping a 2-px cross-section — a lit edge and a darker
  // fuller. (Two Bresenham lines interleave into a checkerboard on diagonals; marching does not.)
  const bx = gxs + dx * 1.4, by = gys + dy * 1.4;
  const steps = Math.max(4, Math.round(len * 2.4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = bx + dx * len * t, cy = by + dy * len * t;
    setPx(p, r(cx - nx * 0.55), r(cy - ny * 0.55), '4');
    if (t < 0.86) setPx(p, r(cx + nx * 0.55), r(cy + ny * 0.55), '2');
  }
  setPx(p, r(bx + dx * len), r(by + dy * len), '5');   // the point catches the light
  if (glint > 0) {
    const t = 0.3 + glint * 0.35;
    for (let k = 0; k < 2; k++) setPx(p, r(bx + dx * len * t + dx * k - nx * 0.55), r(by + dy * len * t + dy * k - ny * 0.55), 'G');
  }
  // guard (gold, 5 across) — the light side reads warmest
  for (let k = -2; k <= 2; k++) setPx(p, r(gxs + nx * k), r(gys + ny * k), k <= -1 ? 'w' : k === 0 ? 'v' : 'u');
  // grip + pommel
  setPx(p, r(gx), r(gy), 'j'); setPx(p, r(gx - dx), r(gy - dy), 'i');
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
    layers.push(L(o.cloak === false ? null : (CLOAK_S_SWAY[o.cloakSway || 0] || CLOAK_S), 9 + cloakDx + bx, 19 + cloakDy + by));
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
    // From behind, the mantle is the back — but it must sit UNDER the shoulders, the shield and the
    // sword arm, or the hero is a cape with a helmet on top.
    if (smear) layers.push(L(smear, 0, 0));
    layers.push(L(legPix, 17, 32 + legDy));
    layers.push(L(o.cloak === false ? null : (CLOAK_N_SWAY[o.cloakSway || 0] || CLOAK_N), 12 + cloakDx + bx, 23 + cloakDy + by));
    layers.push(L(TORSO_N, 14 + bx, 18 + by));
    if (o.shield !== false) layers.push(L(SHIELD_N, 9 + bx + (o.shieldDx || 0), 25 + by + (o.shieldDy || 0)));
    if (o.offArm) layers.push(L(armPix(o.offArm.sx + bx, o.offArm.sy + by, o.offArm.hx + bx, o.offArm.hy + by), 0, 0));
    if (o.arm) layers.push(L(armPix(o.arm.sx + bx, o.arm.sy + by, o.arm.hx + bx, o.arm.hy + by), 0, 0));
    if (o.sword) layers.push(L(o.sword, 0, 0));
    layers.push(L(HEAD_N, 15 + hdx, 0 + hdy));
  }
  if (o.orb) layers.push(L(orbPix(o.orb.cx + bx, o.orb.cy + by, o.orb.r), 0, 0));
  for (const e of o.extra || []) layers.push(e);
  const px = compose(HERO_W, HERO_H, layers);
  return softenLitEdges(px);
}

// Rest poses of the sword arm per facing: shoulder -> hand, and where the grip sits.
const ARM_S = { sx: 20, sy: 24, hx: 15, hy: 27 };  // hero's right arm = screen-left
const ARM_E = { sx: 25, sy: 24, hx: 29, hy: 28 };
const ARM_N = { sx: 29, sy: 23, hx: 32, hy: 26 };

const swordS = (g = 0, angle = -13, len = 16, dx = 0, dy = 0) => swordPix(ARM_S.hx + dx, ARM_S.hy + dy, angle, { len, glint: g });
const swordE = (g = 0, angle = 38, len = 15, dx = 0, dy = 0) => swordPix(ARM_E.hx + dx, ARM_E.hy + dy, angle, { len, glint: g });
const swordN = (g = 0, angle = 12, len = 15, dx = 0, dy = 0) => swordPix(ARM_N.hx + dx, ARM_N.hy + dy, angle, { len, glint: g });

const armAt = (a, dx, dy) => ({ sx: a.sx, sy: a.sy, hx: a.hx + dx, hy: a.hy + dy });

// ------------------------------------------------------------------------------------------ animations
/** @typedef {{name:string, facing:'S'|'E'|'N', frames:Pix[], durations:number[], loop:boolean, hold?:number}} HeroAnim */

function idle(f) {
  // breathe (body 1px), cloak sway (hem 1px), sword glint on the third frame
  const A = f === 'S' ? ARM_S : f === 'E' ? ARM_E : ARM_N;
  const sw = f === 'S' ? swordS : f === 'E' ? swordE : swordN;
  const mk = (dy, cloakDy, glint, cdx = 0, sy = 0) => frame(f, { dy, hdy: 0, cloakDy, cloakDx: cdx, cloakSway: sy, legDy: 0, arm: armAt(A, 0, dy), sword: sw(glint, undefined, undefined, 0, dy) });
  return { frames: [mk(0, 0, 0, 0, 0), mk(1, 0, 0, 0, 1), mk(1, 1, 1, f === 'E' ? -1 : 0, 1), mk(0, 1, 0, 0, 0)], durations: [340, 260, 200, 300], loop: true };
}

function walk(f) {
  const A = f === 'S' ? ARM_S : f === 'E' ? ARM_E : ARM_N;
  const sw = f === 'S' ? swordS : f === 'E' ? swordE : swordN;
  // legs pose, body bob (dy), cloak swing, sword arm swing (dx/dy of the hand)
  const seq = f === 'E'
    ? [['c1', 0, -1, 0, 0], ['r1', 1, -1, 1, 1], ['p1', -1, -2, 1, 0], ['c2', 0, -1, 0, 0], ['r2', 1, 0, -1, 1], ['p2', -1, -1, -1, 0]]
    : [['lfwd', 0, 0, 0, 0], ['lfwd', 1, 1, 1, 1], ['pass', -1, 0, 1, 0], ['rfwd', 0, 0, 0, 0], ['rfwd', 1, 1, -1, 1], ['pass', -1, 0, -1, 0]];
  // the cape trails the stride: it lags a frame behind the legs and lifts on the passing poses
  const swayIdx = [2, 2, 0, 1, 1, 0];
  const frames = seq.map(([legs, dy, cdy, hx, hy], i) => frame(f, {
    legs, dy, legDy: 0, cloakDy: cdy, cloakSway: swayIdx[i], cloakDx: f === 'E' ? -1 - Math.max(0, -cdy) : 0,
    arm: armAt(A, hx, dy + hy), sword: sw(0, undefined, undefined, hx, dy + hy),
  }));
  return { frames, durations: [90, 90, 90, 90, 90, 90], loop: true };
}

function attack(f) {
  // Four beats: anticipation (coil + cock the blade), lunge (the cut, with a smear that TRAILS the
  // real blade angle), follow-through, recover. The smear is a thin crescent shaded from the trailing
  // edge ('1') to the leading edge ('4') and is kept clear of the helm — a fat bright arc over the
  // face reads as a second weapon, not as speed.
  const frames = [];
  if (f === 'S') {
    frames.push(frame('S', { dy: 1, hdx: 1, cloakSway: 2, arm: { sx: 20, sy: 24, hx: 16, hy: 22 }, sword: swordPix(16, 22, -32, { len: 14 }), cloakDy: -1 }));
    frames.push(frame('S', {
      dy: -1, legs: 'lfwd', cloakSway: 1, arm: { sx: 20, sy: 24, hx: 28, hy: 30 }, sword: swordPix(28, 30, 112, { len: 14 }),
      smear: (px) => smearArc(px, 22, 27, 14, 17, -0.55, 0.45, ['1', '2', '4', '5']),
    }));
    frames.push(frame('S', { dy: 0, legs: 'lfwd', cloakSway: 1, arm: { sx: 20, sy: 24, hx: 30, hy: 33 }, sword: swordPix(30, 33, 132, { len: 13 }), cloakDy: 1 }));
    frames.push(frame('S', { dy: 0, cloakSway: 2, arm: { sx: 20, sy: 24, hx: 18, hy: 29 }, sword: swordPix(16, 28, -14, { len: 15 }), cloakDy: 1 }));
  } else if (f === 'E') {
    frames.push(frame('E', { dx: -1, dy: 1, hdx: -1, cloakSway: 2, arm: { sx: 25, sy: 24, hx: 23, hy: 19 }, sword: swordPix(23, 19, -34, { len: 14 }), cloakDx: -1, cloakDy: -1 }));
    frames.push(frame('E', {
      dx: 3, dy: -1, legs: 'c1', arm: { sx: 28, sy: 24, hx: 32, hy: 25 }, sword: swordPix(32, 25, 96, { len: 13 }),
      smear: (px) => smearArc(px, 26, 24, 13, 16, -0.8, 0.1, ['1', '2', '4', '5']), cloakDx: -3, cloakDy: 0, cloakSway: 1,
    }));
    frames.push(frame('E', { dx: 3, dy: 0, legs: 'c1', arm: { sx: 28, sy: 24, hx: 33, hy: 30 }, sword: swordPix(33, 30, 128, { len: 13 }), cloakDx: -3, cloakDy: 1, cloakSway: 1 }));
    frames.push(frame('E', { dx: 1, cloakSway: 2, arm: { sx: 26, sy: 24, hx: 31, hy: 29 }, sword: swordPix(31, 29, 55, { len: 15 }), cloakDx: -1, cloakDy: 1 }));
  } else {
    // away from the camera: the chop rises over the shoulder, goes foreshortened above the helm, then
    // comes down across the far side
    frames.push(frame('N', { dy: 1, cloakSway: 2, arm: { sx: 29, sy: 23, hx: 34, hy: 21 }, sword: swordPix(34, 21, 22, { len: 14 }), cloakDy: -1 }));
    frames.push(frame('N', {
      dy: -2, legs: 'lfwd', cloakSway: 1, arm: { sx: 29, sy: 22, hx: 34, hy: 17 }, sword: swordPix(34, 17, 8, { len: 13 }),
      smear: (px) => smearArc(px, 26, 26, 12, 16, -2.1, -0.75, ['1', '2', '4', '5']), cloakDy: -1,
    }));
    frames.push(frame('N', { dy: -1, legs: 'lfwd', cloakSway: 1, arm: { sx: 29, sy: 23, hx: 22, hy: 19 }, sword: swordPix(22, 19, -74, { len: 13 }), cloakDy: 0 }));
    frames.push(frame('N', { dy: 0, cloakSway: 2, arm: armAt(ARM_N, 0, 1), sword: swordN(0, 12, 15, 0, 1), cloakDy: 1 }));
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
  // Stagger, the knees buckle, down onto both knees, then a slump — the cape pools on the floor and
  // the sword falls out of the hand and stands in the ground. Facing-independent; the material
  // fades the held frames out. (A rotated side view read as an unidentifiable blob; a collapse
  // toward the camera is what an animator draws for a 3/4 top-down diorama.)
  const sw = (x, y, a, len) => swordPix(x, y, a, { len });
  const f1 = frame('S', { dy: 1, hdx: -1, hdy: 1, cloakSway: 2, cloakDy: -1, arm: { sx: 20, sy: 24, hx: 13, hy: 29 }, sword: sw(13, 29, -22, 15) });
  const f2 = frame('S', {
    legs: 'squat', dy: 3, hdy: 4, hdx: -1, cloakDy: 2, cloakSway: 1, arm: { sx: 20, sy: 27, hx: 12, hy: 34 },
    sword: sw(12, 34, -55, 14), shield: false, extra: [L(SHIELD_S, 31, 27)],
  });
  const f3 = frame('S', {
    legs: 'kneel', legDy: 3, dy: 7, hdy: 9, hdx: -1, cloakDy: 6, cloakSway: 1, shield: false,
    arm: { sx: 20, sy: 31, hx: 13, hy: 38 }, sword: sw(11, 40, -100, 12),
  });
  const heap = compose(HERO_W, HERO_H, [
    L(CLOAK_POOL, 10, 36),
    L(frame('S', { legs: 'down', legDy: 5, dy: 11, hdy: 13, hdx: -1, cloak: false, shield: false, arm: { sx: 20, sy: 35, hx: 12, hy: 42 } }), 0, 0),
    L(sw(9, 43, -104, 12), 0, 0),
  ]);
  const settle = compose(HERO_W, HERO_H, [
    L(CLOAK_POOL, 10, 37),
    L(frame('S', { legs: 'down', legDy: 6, dy: 12, hdy: 14, hdx: -1, cloak: false, shield: false, arm: { sx: 20, sy: 36, hx: 12, hy: 43 } }), 0, 0),
    L(sw(9, 44, -104, 12), 0, 0),
  ]);
  return { frames: [f1, f2, f3, heap, settle], durations: [140, 170, 200, 620, 700], loop: false };
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

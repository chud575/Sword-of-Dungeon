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
//  Palette (7 ramps + outline). THE HOUSE STYLE OWNS ALL OF IT: the outline is style.js `INK`, the
//  softened lit edge is `INK_LIT`, the key light is `LIT`, and every ramp is built by the house
//  `ramp()` — the hero used to be the one figure in the game off the law, hard-coding '#1b1426' and
//  its own ramp maths while all 22 monsters were migrated onto style.js.
//    steel 12345 (5 = specular)  · crimson feabcdg (plume, mantle, buckler, hose; f = core shadow,
//      g = sheen — SEVEN steps, because the mantle is the largest mass on the figure)  · leather hijkl
//    skin mno  · gold uvw (comb, guard, buckle, boss)  · tan pqr (cloth trim)  · magic xyz
//    # INK outline  @ INK_LIT lit-edge / inner line
//  Ramp discipline: the house ramp takes `step`/`range` so a material can be narrow — hue and sat
//  shifts stay small on the warm ramps, because a big shift turns dark gold into burnt red and skin
//  shadow into clown blush at this size. A material that only needs three tones is drawn from the
//  MIDDLE THREE of a full house ramp (never a private 3-step gradient), so its shadow and highlight
//  are the same drift the rest of the cast uses.
//  Light: style.js LIT (top-left). One INK outline, selectively softened to INK_LIT on the lit edge.
//  Facings: south (front), east (side; west = mirrored east), north (back). Every facing is drawn
//  deliberately; nothing is a rotation of anything else.
import { Palette, paint, compose, mirrorLit, outline, seamInk, line, setPx, solid, recolor, smearArc, makePix, shift, rotate90 } from './pixelPainter.js';
import { INK, INK_LIT, INK_DEEP, LIT, ramp } from './style.js';

export const HERO_W = 48, HERO_H = 48, HERO_PIVOT_X = 24, HERO_PIVOT_Y = 46;

// The hero's materials, every one of them a house ramp (style.js `ramp()`: shadows drift toward
// violet and gain saturation, highlights drift toward amber and lose a little, and every step is
// clamped into the dungeon gamut). `mid` says which step the base colour sits on; `step`/`range`
// say how wide the material's band is, because a face and a breastplate are not the same width of
// ramp. The three-tone materials take the MIDDLE THREE steps of a real five-step ramp.
const mid3 = (r) => r.slice(1, 4);
/** plate: near-neutral so it still reads as steel under the dungeon's very blue ambient. '5' is the specular. */
const STEEL = ramp('#8f97a6', 5, { step: 0.10, range: 0.46, mid: 1, hueShift: 0.05, satShift: 0.08 });
/**
 * crimson cloth (plume, mantle, buckler, hose): narrow in hue, so the shadows stay red and never go
 * magenta — but SEVEN steps wide in value, because the mantle is the biggest single mass on the
 * hero and the two panels used to be ONE tone each with a one-pixel hem. Seven steps is what a
 * form needs: highlight, light, mid, terminator, shadow, core shadow and a step of reflected light
 * to put back at the shadow edge. `f` is the core and `g` the sheen; `eabcd` keep their old jobs.
 */
const CRIMSON = ramp('#b02f3a', 7, { step: 0.082, range: 0.36, mid: 3, hueShift: 0.016, satShift: 0.035 });
/** The mantle's ramp, darkest first, as `formShade` wants it. */
const CRIMSON_KEYS = 'feabcdg';
/** leather (belt, straps, boots): lifted off the old #300814 crease, which had sunk into the ink. */
const LEATHER = ramp('#7a4a2c', 5, { step: 0.09, range: 0.34, mid: 2, hueShift: 0.03, satShift: 0.06 });
/** cloak lining / cloth trim (warm tan). */
const TAN = mid3(ramp('#b8925e', 5, { step: 0.07, range: 0.20, hueShift: 0.02, satShift: 0.05 }));
/** skin: the gentlest band in the palette — a face 8 px across must not blotch. */
const SKIN = mid3(ramp('#e2ab84', 5, { step: 0.045, range: 0.12, hueShift: 0.012, satShift: 0.0 }));
/** gold (comb, guard, buckle, boss): a big hue shift would turn the dark tone burnt red, not gold. */
const GOLD = mid3(ramp('#d6a23a', 5, { step: 0.075, range: 0.22, hueShift: 0.012, satShift: 0.04 }));
/** magic glow (emissive, so it is exempt from the value ceiling — it is light, not paint). */
const MAGIC = mid3(ramp('#7fd4ff', 5, { step: 0.095, range: 0.32, hueShift: 0.03 }));

export const HERO_PALETTE = new Palette()
  .set('#', INK)                // THE house outline: near-black violet, never pure black
  .set('@', INK_LIT)            // the lit-edge / inner line the outline softens to (style.js)
  .set('G', '#ffffff')          // sword glint (emissive)
  .set('E', INK_DEEP)           // eye: a hollow, so it is style.js INK_DEEP — the one void tone
  .set('W', '#fff7ea')          // eye catch-light (a sparkle, well under the area threshold)
  .set('F', '#fff4f0')          // hurt flash (the 'hurt' clip is not colour-graded art)
  .set('S', INK);               // shadow-blob key (unused in sprites)
[...'12345'].forEach((k, i) => HERO_PALETTE.set(k, STEEL[i]));
[...CRIMSON_KEYS].forEach((k, i) => HERO_PALETTE.set(k, CRIMSON[i]));
[...'hijkl'].forEach((k, i) => HERO_PALETTE.set(k, LEATHER[i]));
[...'pqr'].forEach((k, i) => HERO_PALETTE.set(k, TAN[i]));
[...'mno'].forEach((k, i) => HERO_PALETTE.set(k, SKIN[i]));
[...'uvw'].forEach((k, i) => HERO_PALETTE.set(k, GOLD[i]));
[...'xyz'].forEach((k, i) => HERO_PALETTE.set(k, MAGIC[i]));

/**
 * THE SEAM VOCABULARY (pixelPainter `seamInk`): every hero material, DARKEST FIRST. A join
 * between two plates of the same armour, the shadow under a pauldron, the line down the leg
 * gap — all of them are a step down the material's own ramp. INK is reserved for the outer
 * contour, INK_LIT for the part of it that faces the light, and neither belongs inside the man.
 */
const HERO_SEAM_RAMPS = ['12345', CRIMSON_KEYS, 'hijkl', 'pqr', 'mno', 'uvw', 'xyz'];

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
.#43#oonnnnmm#21#.
.#43#oWEnnWEm#21#.
.#43#oEEnnEEm#21#.
.#33#onnnmmmm#21#.
.#43##onnmmm##21#.
..##..#onmm#....##
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
.....#314312211#....
.....#111111111#....`);

// Legs (south): stand + walk poses. 14 wide, placed at (17, 32); feet on row 45.
const LEGS_S_RAW = {
  stand: paint(`
..#aaa#aa#aaa#
..#bba#ba#baa#
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
..#aaa#aa#aaa#
..#bba#ba#baa#
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
..#aaa#aa#aaa#
..#bba#ba#baa#
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
..#aaa#aa#aaa#
..#bba#ba#baa#
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

/**
 * FORM SHADING — the law the hero's big cloth masses are painted by, and the reason they are typed
 * as SHAPE (one placeholder key) instead of hand-valued.
 *
 * A cape is not a silhouette with a dark hem. It is a form, and a form under one key light has
 * exactly four things on it, in this order along the light:
 *   1. a HIGHLIGHT, and only on the plane that faces the key — up and to the left, never a stripe
 *      down the middle of the shape;
 *   2. the light-to-mid body of the ramp;
 *   3. a TERMINATOR falling to the lower right, and a CORE SHADOW band just inside the far edge —
 *      the darkest tone on the form, darker than the silhouette edge itself;
 *   4. one step of REFLECTED LIGHT on that far edge, where the floor and the walls throw a little
 *      light back into the shadow.
 * Miss 3 and 4 and you get a plateau; put 1 in the middle and you get PILLOW SHADING, which is what
 * both of the hero's cape panels were: one crimson value across ~250 texels with a 1-px dark hem,
 * on the biggest area of the game's lead character. `style.js lint()` now fails a sheet for it.
 *
 * Each connected mass in `p` is shaded on its OWN axis (so the two front panels each get a whole
 * form) and then shifted by where it sits on the figure (`panel`), so the panel on the hero's shadow
 * side is a step or two down from the one catching the key. The reflected-light step is only put on
 * masses that sit on the shadow side (or where `bounce` says so): the inner edge of a panel that
 * lies against the body is occluded, not bounced, and gets the core shadow right on the edge.
 *
 * @param {import('./pixelPainter.js').Pix} p art whose form pixels all hold `from`
 * @param {string} from the placeholder key
 * @param {string} keys the material ramp, darkest first (7 steps for a mass this size)
 * @param {{tilt?:number, form?:number, panel?:number, base?:number, core?:number, rim?:number,
 *   span?:number, bounce?:number}} [o]
 *   tilt = how much of the key axis is horizontal (1 = across, 0 = down the form) ·
 *   form = how much of the ramp one mass spans · panel = how much its place on the figure shifts it ·
 *   base = the mid tone · span = the narrowest run that gets a core shadow · bounce = force the
 *   reflected-light step on (1) or off (0)
 * @returns {import('./pixelPainter.js').Pix}
 */
function formShade(p, from, keys, o = {}) {
  const ks = [...keys], N = ks.length, code = from.charCodeAt(0);
  const tilt = o.tilt ?? 0.55, form = o.form ?? 0.90, panel = o.panel ?? 0.55;
  const base = o.base ?? 0.52, core = o.core ?? 1, rim = o.rim ?? 1, span = o.span ?? 5;
  const out = { w: p.w, h: p.h, d: new Uint16Array(p.d) };
  const isF = (x, y) => x >= 0 && y >= 0 && x < p.w && y < p.h && p.d[y * p.w + x] === code;
  let X0 = p.w, X1 = -1, Y0 = p.h, Y1 = -1;                    // the whole art, for the panel shift
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (isF(x, y)) {
    if (x < X0) X0 = x; if (x > X1) X1 = x; if (y < Y0) Y0 = y; if (y > Y1) Y1 = y;
  }
  if (X1 < 0) return out;
  // 1 where the key lands (top-left), 0 where the form turns away from it (bottom-right)
  const axis = (x, y, x0, x1, y0, y1) =>
    1 - (tilt * (x1 > x0 ? (x - x0) / (x1 - x0) : 0.5) + (1 - tilt) * (y1 > y0 ? (y - y0) / (y1 - y0) : 0.5));
  const seen = new Uint8Array(p.w * p.h);
  for (let sy = 0; sy < p.h; sy++) for (let sx = 0; sx < p.w; sx++) {
    if (!isF(sx, sy) || seen[sy * p.w + sx]) continue;
    const cells = [], stack = [[sx, sy]];                      // one connected mass = one form
    seen[sy * p.w + sx] = 1;
    let x0 = sx, x1 = sx, y0 = sy, y1 = sy;
    while (stack.length) {
      const [x, y] = stack.pop();
      cells.push([x, y]);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (isF(nx, ny) && !seen[ny * p.w + nx]) { seen[ny * p.w + nx] = 1; stack.push([nx, ny]); }
      }
    }
    const gt = axis((x0 + x1) / 2, (y0 + y1) / 2, X0, X1, Y0, Y1);
    const reach = Math.min(1, Math.max(x1 - x0, y1 - y0) / 12);  // a 2-px strap is not a torso
    const bounce = o.bounce ?? (gt <= 0.5 ? 1 : 0);
    const runs = new Map();                                    // every pixel's horizontal run: [width, last x]
    for (const [x, y] of cells) {
      if (runs.has(y * p.w + x)) continue;
      let a = x; while (isF(a - 1, y)) a--;
      let b = x; while (isF(b + 1, y)) b++;
      for (let i = a; i <= b; i++) runs.set(y * p.w + i, [b - a + 1, b]);
    }
    for (const [x, y] of cells) {
      const t = axis(x, y, x0, x1, y0, y1);
      let i = Math.round((base + form * reach * (t - 0.5) + panel * (gt - 0.5)) * (N - 1));
      const [w, end] = runs.get(y * p.w + x);
      if (t < 0.55 && w >= span) {                             // the shadow half of the form
        if (bounce) { if (x === end) i += rim; else if (x === end - 1) i -= core; }
        else if (x === end) i -= core;
      }
      out.d[y * p.w + x] = ks[i < 0 ? 0 : i >= N ? N - 1 : i].charCodeAt(0);
    }
  }
  return out;
}

/** Shorthand: a crimson cloth mass, typed as shape in 'X' and lit by `formShade`. */
const cloth = (rows, o) => formShade(paint(rows), 'X', CRIMSON_KEYS, o);

// The cape pooled on the floor once the hero goes down: a low crimson ellipse whose form runs from
// the lit upper-left fold to a core shadow and a bounce rim on the far side. At (10, 36).
const CLOAK_POOL = cloth(`
........############........
....#XXXXXXXXXXXXXXXXXX#....
..#XXXXXXXXXXXXXXXXXXXXXX#..
.#XXXXXXXXXXXXXXXXXXXXXXXX#.
#XXXXXXXXXXXXXXXXXXXXXXXXXX#
.#XXXXXXXXXXXXXXXXXXXXXXXX#.
..#XXXXXXXXXXXXXXXXXXXXXX#..
.....##################.....`, { tilt: 0.78, form: 0.95, span: 8 });

// Round buckler on the off arm (screen-right in front view). Placed at (30, 23).
const SHIELD_S = paint(`
..###..
.#4c3#.
#4ccb3#
#4cvb2#
#3cbb2#
.#3b2#.
..###..`);

// Cloak seen from the front: crimson panels falling outside each pauldron, and the hem running down
// between the legs. Placed at (11, 19). Cloth moves from the shoulders down, so the sway variants
// shear the lower rows progressively.
//
// TYPED AS SHAPE, LIT BY `formShade`. Each panel is a separate mass, so each gets a whole form: the
// panel on the key side opens on its highlight and closes on a core shadow where it meets the body
// (an inner edge is occluded, so it takes no bounce — `bounce: 0` is the default for a mass on the
// lit half); the panel on the shadow side sits a step and a half lower and carries the reflected
// light on its outer edge. What was here before was two flat crimsons, 'c' and 'a', with a 1-px hem.
const CLOAK_S = cloth(`
.....###..............###.....
.....#X#..............#X#.....
....#XX#..............#XX#....
....#XX#..............#XX#....
....#XXX#............#XXX#....
....#XXX#............#XXX#....
...#XXXX#............#XXXX#...
...#XXXX#............#XXXX#...
...#XXXX#............#XXXX#...
...#XXXX#............#XXXX#...
..#XXXXX#............#XXXXX#..
..#XXXXX#............#XXXXX#..
..#XXXXX#............#XXXXX#..
..#XXXXX#............#XXXXX#..
.#XXXXXX#............#XXXXXX#.
.#XXXXXX#....#XX#....#XXXXXX#.
.#XXXXXX#.....#XX#...#XXXXXX#.
.#XXXXXX#.....#XX#...#XXXXXX#.
.#XXXXXX#.....#XX#...#XXXXXX#.
.#XXXXXX#.....#XX#...#XXXXXX#.
..#XXXX#......#XX#....#XXXX#..
..#XXX#.......#XX#.....#XXX#..
...##.........#XX#......##....
..............#XX#............`, { tilt: 0.50, form: 0.80, panel: 0.95 });

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
.....#314312211#....
.....#111111111#....`);

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
// It hangs BEHIND him and he faces the key, so its outer edge is the lit one and the edge that
// meets his back is the shadow: the old art had that exactly backwards (a dark column down the
// outside, a light one down the middle). No bounce on the inner edge — the body occludes it — so
// the core shadow lands on the edge itself.
const CLOAK_E = cloth(`
.......##.
......#XX#
.....#XXX#
.....#XXX#
....#XXXX#
....#XXXX#
....#XXXX#
...#XXXXX#
...#XXXXX#
...#XXXXX#
..#XXXXXX#
..#XXXXXX#
..#XXXXXX#
.#XXXXXXX#
.#XXXXXX##
.#XXXXXX#.
#XXXXXX#..
#######...`, { tilt: 0.68, form: 0.95, base: 0.58, bounce: 0 });

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
// the pauldrons and arms flank it, falling to a scalloped knee-length hem. Placed at (12, 23).
//
// THE BIGGEST SINGLE MASS ON THE HERO, and the one that was pillow-shaded hardest: a lit ridge
// ('c') straight down the CENTRE with a dark crease ('e') mirrored either side of it, which is a
// tube of light down the middle of a flat sheet — the textbook mistake, and one lit from nowhere.
// It is now one form: the highlight sits on the upper-left quarter only, the terminator falls
// across it to the lower right, a core-shadow band runs just inside the right edge and that edge
// carries one step of reflected light off the wall behind him.
const CLOAK_N = cloth(`
.......#XXXXXXXX#.......
.....#XXXXXXXXXXXX#.....
.....#XXXXXXXXXXXX#.....
.....#XXXXXXXXXXXX#.....
.....#XXXXXXXXXXXX#.....
....#XXXXXXXXXXXXXX#....
....#XXXXXXXXXXXXXX#....
....#XXXXXXXXXXXXXX#....
....#XXXXXXXXXXXXXX#....
....#XXXXXXXXXXXXXX#....
....#XXXXXXXXXXXXXX#....
..#XXXXXXXXXXXXXXXXXX#..
..#XXXXXXXXXXXXXXXXXX#..
..#XXXXXXXXXXXXXXXXXX#..
..#XXXXXXXXXXXXXXXXXX#..
..#XXXXXXXXXXXXXXXXXX#..
..#XXX#XXXX#XXXX#XXXX#..
...###..####..####..##..`, { tilt: 0.72, form: 0.98, base: 0.57, span: 6 });

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
  return outline(p, '#', { lit: LIT, litKey: '@' });
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
  return outline(p, '#', { lit: LIT, litKey: '@' });
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
  // THE INK IS THE OUTER CONTOUR AND NOTHING ELSE (pixelPainter.seamInk). Every part above was
  // hand-typed carrying its own '#' ring, and where two of them meet inside the figure that ring
  // became a seam drawn in the darkest tone the style law allows — which at the play camera is
  // not a line but a HOLE: the hero shipped 2-3 texels of pure black at the neck, three blocks
  // across the belt and a black column the length of the leg gap. Interior ink now falls to a
  // dark step of the garment it is cutting through; ink that touches air is left exactly alone.
  return seamInk(softenLitEdges(px), { ramps: HERO_SEAM_RAMPS });
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

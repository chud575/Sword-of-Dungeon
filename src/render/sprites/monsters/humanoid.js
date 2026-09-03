// humanoid: the dungeon's humanoid warriors as HD-2D pixel sprites (Octopath / Triangle Strategy
// look), hand-pixelled part by part with the same toolkit, ramp discipline and key light as the
// hero (sprites/pixelPainter.js, sprites/heroSprite.js).
//
// GROUP: hobgoblin (the goblinoid grunt — the game's orc/goblin), rogue (thief), barbarian,
// elvin ranger, assassin.
//
// SHARED CANVAS  40x40, pivot (20, 37): feet on row 36, three rows of slack for the death sag. The
// figure is ~24 px wide; the extra width either side is swing room, so a barbarian's axe head keeps
// its whole arc instead of being sliced off at the atlas edge.
// The hero is 48x48 with the figure 46 px tall; at PX_PER_TILE = 32 that is 1.44 world units. These
// figures are 37 px (≈1.16 units) and each type multiplies by its own `scale` so a barbarian towers
// over a rogue while every sprite keeps EXACTLY the hero's pixel density (1 texel = 1/32 tile).
//
// SHARED KEY VOCABULARY — every monster registers the same character keys against its own ramps,
// so the legs, arms and weapon helpers below are drawn once and recoloured per species:
//   # outline (near-black violet, never pure black)   @ lit-edge / inner line
//   1 2 3   skin        dark -> light
//   7 4 5 6 cloth       darkest crease -> light
//   8 9 0   leather     dark -> light
//   a b c d metal       dark -> light (+ d specular, 1-px edges only)
//   e f g   accent      dark -> light (hair, fur, sash, feathers, gold)
//   T tooth/bone   E eye socket   W eye catch-light   Y eye glow (emissive)
//   G weapon glint (emissive)   F hurt flash
// Six hue-shifted ramps per species: shadows drift violet and gain saturation, highlights drift
// amber and lose a little — never a flat darken/lighten. Light is TOP-LEFT on every facing; the
// outline is softened to '@' only where a light tone meets empty space on the top-left edge.
//
// SILHOUETTES (the read at gameplay distance, before any colour):
//   hobgoblin  squat and hunched, huge sideways ear-blades, underbite tusks, notched cleaver
//   rogue      small, crouched, sharp hood peak, reversed dagger, fat coin pouch swinging
//   barbarian  widest by far, mane spilling over bare shoulders, double-bit axe over the head
//   ranger     tall and thin, the only CURVED shape: a longbow arch, fletchings behind the ear
//   assassin   narrow and low, twin blades held reversed, a long scarf trailing off the shoulder
//
// FACINGS south / east / north are each drawn deliberately; west is the mirrored east.
// CLIPS idle(4) walk(6) attack(4) hurt(2) death(5).
import {
  Palette, paint, compose, mirrorLit, outline, line, setPx, solid, makePix, smearArc,
} from '../pixelPainter.js';
import { INK, INK_LIT, LIT, ramp } from '../style.js';

export const MON_W = 40, MON_H = 40, PIVOT_X = 20, PIVOT_Y = 37;

// ------------------------------------------------------------------------------- the key light
/**
 * RE-LIGHT a hand-drawn part to the canonical TOP-LEFT key (style.js `LIT`).
 *
 * Three of this group's species were hand-shaded with the light in two different places at once:
 * the shared legs are lit from the LEFT (`#655#..#554#`) while every head and torso block was
 * keyed light-on-the-RIGHT and, worse, BRIGHTEST DOWN THE MIDDLE (`#44455566555444#`) — a textbook
 * pillow. Measured by `style.js` that left the rogue at a rim delta of 0.03 and the assassin at
 * 0.05, against 0.15-0.20 for the rest of the cast: the figures read as flat stickers.
 *
 * Rather than re-typing every block by hand, this re-keys the pixels that already hold one of
 * `keys` (darkest first) from a real directional terminator: `nx` runs across THAT ROW's own span
 * of the region, so a tapering form still turns across its own width, and `ny` runs down the
 * region's bounding box. Anything not in `keys` — eyes, teeth, belts, weapons, hair — is untouched.
 *
 * @param {Pix} p @param {string} keys the material's ramp keys, DARKEST FIRST
 * @param {{gain?:number, mid?:number, up?:number, bias?:number}} [o]
 *   gain = terminator contrast · mid = where the unlit-normal sits on the ramp · up = how much of
 *   the light's vertical component the form takes (a column takes less than a sphere)
 * @returns {Pix} a new Pix
 */
function relight(p, keys, o = {}) {
  const ks = [...keys], set = new Set(ks.map((c) => c.charCodeAt(0)));
  const gain = o.gain ?? 0.62, mid = o.mid ?? 0.50, up = o.up ?? 0.62, bias = o.bias ?? 0;
  let y0 = p.h, y1 = -1;
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (set.has(p.d[y * p.w + x])) { if (y < y0) y0 = y; if (y > y1) y1 = y; break; }
  if (y1 < 0) return p;
  const out = { w: p.w, h: p.h, d: new Uint16Array(p.d) };
  const cy = (y0 + y1 + 1) / 2, ry = Math.max(1, (y1 - y0 + 1) / 2);
  for (let y = y0; y <= y1; y++) {
    let rx0 = p.w, rx1 = -1;
    for (let x = 0; x < p.w; x++) if (set.has(p.d[y * p.w + x])) { if (x < rx0) rx0 = x; if (x > rx1) rx1 = x; }
    if (rx1 < 0) continue;
    const cx = (rx0 + rx1 + 1) / 2, rx = Math.max(1, (rx1 - rx0 + 1) / 2);
    for (let x = rx0; x <= rx1; x++) {
      if (!set.has(p.d[y * p.w + x])) continue;
      const nx = (x + 0.5 - cx) / rx, ny = ((y + 0.5 - cy) / ry) * up;
      const r2 = Math.min(1, nx * nx + ny * ny);
      const lam = nx * LIT.x * 0.62 + ny * LIT.y * 0.52 + Math.sqrt(1 - r2) * 0.585;
      let t = lam * gain + mid + bias;
      t = t < 0 ? 0 : t > 0.999 ? 0.999 : t;
      out.d[y * p.w + x] = ks[(t * ks.length) | 0].charCodeAt(0);
    }
  }
  return out;
}

/** Where the shared parts are stamped on the canvas. */
const LEG_X = 12, LEG_Y = 25, TORSO_Y = 10, HEAD_Y = 0;

// ------------------------------------------------------------------------------------ palettes
// Every ramp in this file is a slice of ONE seven-step house curve (`ramp()` in style.js): same ink,
// same hue drift, same value spread as the fighters in humans.js and the beasts in beasts.js, so a
// hobgoblin and a swordsman standing in the same torchlight are lit by the same law. `RAMP_PICK`
// says which steps of that curve each material occupies — cloth and skin sit in the middle (dyed
// and pigmented, not polished), metal reaches the top because a specular highlight is the whole
// point of steel, leather sits between them. The old per-species `skinStep`/`accentStep` knobs are
// gone: five species each inventing their own contrast is exactly what made the cast look sampled
// from five different games.
const RAMP_OPTS = { hueShift: 0.02, satShift: 0.06 };
const RAMP_PICK = { skin: [1, 3, 5], cloth: [0, 2, 3, 4], leather: [1, 3, 4], metal: [1, 3, 5, 6], accent: [1, 3, 5] };

/**
 * One species palette over the shared key vocabulary.
 * @param {{skin:string, cloth:string, leather:string, metal:string, accent:string, eye:string,
 *   tooth?:string, picks?:Object<string, number[]>}} o
 */
function humanoidPalette(o) {
  const p = new Palette().set('#', INK).set('@', INK_LIT);
  const put = (keys, base, which) => {
    const r = ramp(base, 7, RAMP_OPTS);
    const pick = (o.picks && o.picks[which]) || RAMP_PICK[which];
    [...keys].forEach((k, i) => p.set(k, r[pick[i]]));
  };
  put('123', o.skin, 'skin');
  put('7456', o.cloth, 'cloth');   // 7 is the darkest crease, then 4 5 6 up to the lit fold
  put('890', o.leather, 'leather');
  put('abcd', o.metal, 'metal');   // d is a 1-px specular only
  put('efg', o.accent, 'accent');
  return p
    .set('T', o.tooth || '#ded2b8')
    .set('E', '#191322')
    .set('W', '#e6dcc8')
    .set('Y', o.eye)
    .set('G', '#efe9dd')
    .set('F', '#fff4f0');
}

// ------------------------------------------------------------------------------------ shared legs
// 16 wide, 12 tall, stamped at (8, 25): two 3-px legs with a 2-px gap, boots flaring outward.
// The screen-left leg carries the lit tones ('6','0'); the screen-right leg sits one step darker.
const LEGS_S = {
  stand: paint(`
...#655#..#554#.
...#655#..#554#.
...#665#..#554#.
...#655#..#544#.
...#665#..#554#.
...#655#..#544#.
...#900#..#899#.
...#900#..#899#.
..#9000#..#8990#
..#9800#..#8890#
..#8890#..#8888#
..######..######`),
  // screen-left leg planted forward, the trailing leg lifted and tucked in behind
  lfwd: paint(`
...#655#..#554#.
...#655#..#554#.
...#665#..#554#.
...#655#..#544#.
...#665#..#554#.
...#655#.#899#..
...#900#.#899#..
...#900#.#8990#.
..#9000#.#8890#.
..#9800#.######.
..#8890#........
..######........`),
  // screen-right leg planted forward
  rfwd: paint(`
...#655#..#554#.
...#655#..#554#.
...#665#..#554#.
...#655#..#544#.
...#665#..#554#.
....#900#.#554#.
....#900#.#899#.
...#9000#.#899#.
...#9800#.#8990#
...######.#8890#
..........#8888#
..........######`),
  // passing pose: legs together, body carried high (the composer lifts it a pixel)
  pass: paint(`
...#655#..#554#.
...#655#..#554#.
...#665#..#554#.
...#655#..#544#.
...#665#..#554#.
...#655#..#544#.
...#900#..#899#.
...#900#..#899#.
..#9000#..#8990#
..#9800#..#8890#
..######..######
................`),
  // death poses: knees buckle, then fold, then only the boots read under the heap
  squat: paint(`
................
................
................
..#655#..#554#..
.#655#....#554#.
.#900#....#899#.
#9000#....#8990#
#9800#....#8890#
#8890#....#8888#
######....######
................
................`),
  kneel: paint(`
................
................
................
..#655#.#554#...
..#655#.#554#...
..#900#.#899#...
.#9000#.#8990#..
.#9800#.#8890#..
.#88900#8888#...
.############...
................
................`),
  down: paint(`
................
................
................
................
................
..#655#..#554#..
..#900#..#899#..
.#9000#..#8990#.
.#98000##88990#.
.#888908888890#.
.#############..
................`),
};

// Side view: the far leg is the thin darker column on the left, the near leg the wide one.
const LEGS_E = {
  stand: paint(`
....#4#554#.....
....#4#554#.....
....#4#554#.....
....#4#554#.....
....#4#554#.....
....#4#554#.....
....#8#900#.....
....#8#900#.....
...#88#9000#....
...#88#9800#....
...#88#8890#....
...###.######...`),
  // near leg swings forward
  c1: paint(`
....#4#554#.....
....#4#554#.....
....#4#554#.....
....#4#.#54#....
....#4#..#554#..
....#4#..#554#..
....#8#..#900#..
....#8#..#900#..
...#88#..#9000#.
...#88#..#9800#.
...#88#..#8890#.
...###...######.`),
  // passing: the far leg lifts past the near one
  p1: paint(`
....#4#554#.....
....#4#554#.....
....#4#554#.....
....#4#554#.....
....#4#554#.....
....#8#554#.....
....#8#900#.....
...#88#900#.....
...#88#9000#....
...####9800#....
......#8890#....
......######....`),
  // far leg swings forward, the near leg trails back
  c2: paint(`
....#4#554#.....
....#4#554#.....
....#4#554#.....
....#4#554#.....
...#4#.#554#....
..#4#..#554#....
..#8#..#900#....
.#8#...#900#....
.#88#..#9000#...
.#880#.#9800#...
.#889#.#8890#...
.#####.######...`),
  // second passing pose: the far leg is higher still
  p2: paint(`
....#4#554#.....
....#4#554#.....
....#4#554#.....
....#4#554#.....
....#4#554#.....
....#8#554#.....
...#88#900#.....
...#88#900#.....
...####9000#....
......#9800#....
......#8890#....
......######....`),
};
// the death clip is drawn facing the camera, so the side view borrows the collapse poses
LEGS_E.squat = LEGS_S.squat; LEGS_E.kneel = LEGS_S.kneel; LEGS_E.down = LEGS_S.down;

// ------------------------------------------------------------------------------------ rig helpers
const LIGHT_KEYS = new Set(['3', '6', '0', 'c', 'd', 'g', 'T', 'W'].map((c) => c.charCodeAt(0)));

/** Soften the hand-drawn outline to '@' where a light tone meets empty space on the top-left edge. */
function softenLit(p) {
  const o = { w: p.w, h: p.h, d: new Uint16Array(p.d) };
  const HASH = 35, AT = 64;
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (p.d[y * p.w + x] !== HASH) continue;
    const inR = x + 1 < p.w ? p.d[y * p.w + x + 1] : 0, inD = y + 1 < p.h ? p.d[(y + 1) * p.w + x] : 0;
    const outL = x > 0 ? p.d[y * p.w + x - 1] : 0, outU = y > 0 ? p.d[(y - 1) * p.w + x] : 0;
    if ((LIGHT_KEYS.has(inR) && !outL) || (LIGHT_KEYS.has(inD) && !outU)) o.d[y * p.w + x] = AT;
  }
  return o;
}

/**
 * A 2-px limb from shoulder (sx,sy) to hand (hx,hy) with a fist at the hand.
 * @param {{lit?:string, dark?:string, fist?:string, fistLit?:string, r?:number}} k
 */
function limbPix(sx, sy, hx, hy, k = {}) {
  const p = makePix(MON_W, MON_H);
  const lit = k.lit || '2', dark = k.dark || '1', fist = k.fist || '2', fistLit = k.fistLit || '3';
  line(p, sx, sy, hx, hy, lit);
  line(p, sx + 1, sy, hx + 1, hy, dark);
  const r = k.r ?? 1;
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) setPx(p, hx + x, hy + y, (x < 0 || y < 0) ? fistLit : fist);
  return outline(p, '#', { lit: LIT, litKey: '@' });
}

/**
 * A blade marched along its axis, the cross-section FILLED at each step (two Bresenham lines
 * interleave into a checkerboard on diagonals, and a hollow cross-section combs into a fork).
 * `w0`/`w1` are the half-widths at the guard and at the tip, so the same helper draws a slim dagger
 * and a broad cleaver; `notch` bites a wedge out of the cutting edge of a crude one.
 */
function bladePix(gx, gy, angle, o = {}) {
  const { len = 10, w0 = 0.55, w1 = 0.55, notch = 0, glint = 0, grip = '9', pommel = 'e', guard = 0 } = o;
  const p = makePix(MON_W, MON_H);
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const nx = -dy, ny = dx;
  const r = Math.round;
  const bx = gx + dx * 2.2, by = gy + dy * 2.2;
  const steps = Math.max(6, Math.round(len * 2.6));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = bx + dx * len * t, cy = by + dy * len * t;
    const hw = w0 + (w1 - w0) * t;
    const bite = notch && t > 0.42 && t < 0.58 ? 1.3 : 0;   // the chipped edge of a scavenged blade
    for (let u = -hw + bite; u <= hw; u += 0.32) {
      const key = u < -hw + bite + 0.75 ? 'c' : u > hw - 0.75 ? 'a' : 'b';
      setPx(p, r(cx + nx * u), r(cy + ny * u), key);
    }
  }
  setPx(p, r(bx + dx * len), r(by + dy * len), 'd');
  setPx(p, r(bx + dx * len * 0.72 - nx * (w0 + (w1 - w0) * 0.72)), r(by + dy * len * 0.72 - ny * (w0 + (w1 - w0) * 0.72)), 'd');
  if (glint > 0) {
    const t = 0.34 + glint * 0.3;
    for (let k = 0; k < 2; k++) setPx(p, r(bx + dx * len * t + dx * k - nx * (w0 + (w1 - w0) * t)), r(by + dy * len * t + dy * k - ny * (w0 + (w1 - w0) * t)), 'G');
  }
  if (guard) for (let k = -guard; k <= guard; k++) setPx(p, r(bx - dx * 0.8 + nx * k), r(by - dy * 0.8 + ny * k), k <= -1 ? 'g' : k === 0 ? 'f' : 'e');
  for (let k = 0; k < 3; k++) setPx(p, r(gx - dx * k), r(gy - dy * k), k === 2 ? pommel : grip);
  return outline(p, '#', { lit: LIT, litKey: '@' });
}

/**
 * Haft plus a double-bit axe head at the far end: the one shape nobody mistakes for a sword. Each
 * bit is a trapezoid that FLARES from the haft out to a convex cutting edge — an ellipse reads as a
 * cloud at this size, a flare reads as an axe.
 */
function axePix(gx, gy, angle, o = {}) {
  const { len = 13, head = 5, glint = 0 } = o;
  const p = makePix(MON_W, MON_H);
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const nx = -dy, ny = dx;
  const r = Math.round;
  const steps = Math.max(8, Math.round(len * 2.6));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    setPx(p, r(gx + dx * len * t), r(gy + dy * len * t), '9');
    setPx(p, r(gx + dx * len * t + nx * 0.9), r(gy + dy * len * t + ny * 0.9), '8');
  }
  setPx(p, r(gx - dx * 1.6), r(gy - dy * 1.6), 'e');
  // the head sits a little short of the haft's end so the haft's tip pokes through the eye
  const hx = gx + dx * (len - 1.6), hy = gy + dy * (len - 1.6);
  const halfU = head * 0.72;
  for (const s of [-1, 1]) {
    const lit = s < 0;                       // the screen-left bit takes the key light
    for (let v = 0.7; v <= head; v += 0.3) {
      const t = v / head;
      let uh = halfU * (0.34 + 0.72 * t);    // narrow at the haft, wide at the edge
      if (t > 0.86) uh *= 0.82;              // and the outer corners are chamfered
      for (let u = -uh; u <= uh; u += 0.3) {
        const px = hx + nx * (v * s) + dx * u, py = hy + ny * (v * s) + dy * u;
        let key = lit ? 'c' : 'b';
        if (t > 0.84) key = lit ? 'd' : 'c';                 // the cutting edge catches the light
        else if (t < 0.4) key = lit ? 'b' : 'a';             // the cheek by the haft is in shadow
        if (Math.abs(u) > uh - 0.55) key = 'a';              // dark rim top and bottom
        setPx(p, r(px), r(py), key);
      }
    }
  }
  if (glint > 0) setPx(p, r(hx - nx * head * 0.92 - dx * halfU * 0.4), r(hy - ny * head * 0.92 - dy * halfU * 0.4), 'G');
  return outline(p, '#', { lit: LIT, litKey: '@' });
}

/**
 * A longbow: the limbs bulge toward the target, the string is the chord on the archer's side and
 * `pull` drags the nock (and the arrow) back through it.
 * @param {number} gx @param {number} gy grip, on the bow's belly
 * @param {number} aimDeg aim direction in degrees (0 = up, clockwise)
 */
function bowPix(gx, gy, aimDeg, o = {}) {
  const { r = 8, span = 1.34, pull = 0, arrow = true, loose = false } = o;
  const p = makePix(MON_W, MON_H);
  const a = (aimDeg * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const nx = -dy, ny = dx;
  const cx = gx - dx * r, cy = gy - dy * r;
  const R = Math.round;
  const at = (u, v) => [cx + dx * u + nx * v, cy + dy * u + ny * v];
  const steps = Math.round(r * 5);
  for (let i = 0; i <= steps; i++) {
    const t = -span + (2 * span) * (i / steps);
    const [x, y] = at(Math.cos(t) * r, Math.sin(t) * r);
    setPx(p, R(x), R(y), t < -0.25 ? '0' : t > 0.35 ? '8' : '9');
  }
  const [t0x, t0y] = at(Math.cos(-span) * r, Math.sin(-span) * r);
  const [t1x, t1y] = at(Math.cos(span) * r, Math.sin(span) * r);
  const [nkx, nky] = at(Math.cos(span) * r - pull, 0);
  line(p, R(t0x), R(t0y), R(nkx), R(nky), 'c');
  line(p, R(nkx), R(nky), R(t1x), R(t1y), 'c');
  if (arrow) {
    const [ax, ay] = at(r + (loose ? 7 : 3), 0);
    line(p, R(nkx), R(nky), R(ax), R(ay), '9');
    setPx(p, R(ax), R(ay), 'd');
    const [fx, fy] = at(Math.cos(span) * r - pull + 1.4, 0);
    setPx(p, R(fx), R(fy + 1), 'g'); setPx(p, R(fx), R(fy - 1), 'f');
  }
  return outline(p, '#', { lit: LIT, litKey: '@' });
}

/** A loosed arrow in flight, `d` px ahead of the bow. */
function arrowPix(x, y, aimDeg, len = 8) {
  const p = makePix(MON_W, MON_H);
  const a = (aimDeg * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const R = Math.round;
  line(p, R(x), R(y), R(x + dx * len), R(y + dy * len), '9');
  setPx(p, R(x + dx * len), R(y + dy * len), 'd');
  setPx(p, R(x), R(y), 'f');
  return outline(p, '#', { lit: LIT, litKey: '@' });
}

// ------------------------------------------------------------------------------------ composer
const L = (p, x, y, mirror = false) => (p ? { p, x, y, mirror } : null);

/**
 * Compose one frame of a species.
 * @param {object} S species spec
 * @param {'S'|'E'|'N'} f
 * @param {object} o pose {dx,dy,hdx,hdy,legs,legDy,arm,offArm,weapon,offWeapon,weaponBehind,smear,extra}
 */
function frame(S, f, o = {}) {
  const bx = o.dx || 0, by = o.dy || 0;
  const hdx = (o.hdx || 0) + bx, hdy = (o.hdy || 0) + by;
  const legsSet = f === 'E' ? LEGS_E : LEGS_S;
  const legPix = legsSet[o.legs || 'stand'] || legsSet.stand;
  const layers = [];
  const back = S.back && S.back[f];
  const bo = (S.backAt && S.backAt[f]) || [0, 0];
  if (back) layers.push(L(back, bo[0] + bx + (o.backDx || 0), bo[1] + by + (o.backDy || 0)));
  if (o.weaponBehind && o.weapon) layers.push(L(o.weapon, 0, 0));
  layers.push(L(legPix, LEG_X, LEG_Y + (o.legDy || 0)));
  layers.push(L(S.torso[f], S.torsoX[f] + bx, TORSO_Y + by));
  if (o.offArm) layers.push(L(limbPix(o.offArm.sx + bx, o.offArm.sy + by, o.offArm.hx + bx, o.offArm.hy + by, S.limb), 0, 0));
  if (o.offWeapon) layers.push(L(o.offWeapon, 0, 0));
  const headLayer = L(S.head[f], S.headX[f] + hdx, HEAD_Y + hdy);
  if (f === 'N') {
    if (o.arm) layers.push(L(limbPix(o.arm.sx + bx, o.arm.sy + by, o.arm.hx + bx, o.arm.hy + by, S.limb), 0, 0));
    if (o.smear) layers.push(L(o.smear, 0, 0));
    if (o.weapon && !o.weaponBehind) layers.push(L(o.weapon, 0, 0));
    layers.push(headLayer);
  } else {
    layers.push(headLayer);
    if (o.smear) layers.push(L(o.smear, 0, 0));
    if (o.arm) layers.push(L(limbPix(o.arm.sx + bx, o.arm.sy + by, o.arm.hx + bx, o.arm.hy + by, S.limb), 0, 0));
    if (o.weapon && !o.weaponBehind) layers.push(L(o.weapon, 0, 0));
  }
  for (const e of o.extra || []) layers.push(e);
  return softenLit(compose(MON_W, MON_H, layers));
}

// ------------------------------------------------------------------------------------ poses
// Canonical rig points on the 40x40 canvas, shared by every species (specs nudge them with `off`).
const RIG = {
  S: { sh: [16, 15], offSh: [24, 15], hand: [14, 22], offHand: [26, 22] },
  E: { sh: [21, 15], offSh: [18, 16], hand: [25, 21], offHand: [19, 22] },
  N: { sh: [24, 15], offSh: [16, 15], hand: [26, 22], offHand: [14, 22] },
};
const armTo = (f, hx, hy, o = {}) => ({ sx: RIG[f].sh[0] + (o.dsx || 0), sy: RIG[f].sh[1] + (o.dsy || 0), hx, hy });
const offArmTo = (f, hx, hy) => ({ sx: RIG[f].offSh[0], sy: RIG[f].offSh[1], hx, hy });

/** Weapon-arm swing path per facing: [handX, handY, weaponAngle] for anticipate/strike/follow/recover. */
const SWING = {
  S: [[16, 13, -62], [24, 23, 122], [25, 27, 143], [16, 23, -14]],
  E: [[21, 12, -56], [26, 22, 128], [27, 27, 147], [26, 22, 32]],
  N: [[25, 13, 54], [25, 11, 6], [17, 17, -82], [26, 22, 14]],
};
const STAB = {
  S: [[16, 19, -44], [21, 26, 26], [22, 27, 34], [15, 23, -16]],
  E: [[22, 19, 18], [29, 22, 88], [30, 22, 92], [26, 21, 50]],
  N: [[24, 20, -18], [26, 15, 8], [26, 14, 4], [26, 21, 16]],
};
/** The smear crescent's pivot per facing (elbow-ish), and the arc it sweeps. */
const SMEAR = {
  S: { cx: 20, cy: 21, r0: 9, r1: 12, a0: -0.6, a1: 0.5 },
  E: { cx: 21, cy: 20, r0: 9, r1: 12, a0: -0.85, a1: 0.15 },
  N: { cx: 22, cy: 21, r0: 9, r1: 12, a0: -2.15, a1: -0.7 },
};

/** Weapon pose at rest, per facing. */
function restWeapon(S, f, o = {}) {
  const r = S.rest[f];
  return S.weapon(f, {
    gx: r.gx + (o.dx || 0), gy: r.gy + (o.dy || 0), angle: r.a + (o.tilt || 0), len: r.len, glint: o.glint || 0,
  });
}
function restArm(S, f, dx = 0, dy = 0) {
  const r = S.rest[f];
  return armTo(f, r.gx + dx, r.gy + dy, S.off && S.off[f]);
}

// ------------------------------------------------------------------------------------ animations
/**
 * Breathing on the spot. THE RULE: an idle never moves the contact row. The boots, the shins and the
 * hips are the same pixels in all four frames — every bit of the motion lives above the belt, where
 * a lungful of air actually goes. On the exhale the head settles a pixel into the shoulders (the
 * neck compresses; the mane, cowl and ear-blades come with it), the hands sink and drift in toward
 * the body, the weapon tips a couple of degrees, and the cloth extras run their own four-phase
 * cycle. The old idle translated the whole figure — head, torso, arms and weapon together — down a
 * pixel and back four times a second, which reads as a man hopping, not breathing.
 */
const BREATH = [
  { head: 0, hand: 0, drift: 0, tilt: 0, glint: 0 },   // rest, lungs full
  { head: 1, hand: 1, drift: 0, tilt: -2, glint: 0 },  // exhale: the head settles, the arms sink
  { head: 1, hand: 1, drift: 1, tilt: -3, glint: 1 },  // the bottom of the breath, hands drawn in
  { head: 0, hand: 0, drift: 1, tilt: -1, glint: 0 },  // inhale: chest lifts, the weapon swings back
];

function idleClip(S, f) {
  const inward = f === 'N' ? 1 : -1;                   // "toward the body" flips with the facing
  const mk = (i) => {
    const b = BREATH[i], dx = inward * b.drift;
    const o = {
      hdy: b.head, legs: 'stand',
      arm: restArm(S, f, dx, b.hand),
      weapon: restWeapon(S, f, { dx, dy: b.hand, tilt: b.tilt, glint: b.glint }),
    };
    if (S.offRest && S.offRest[f]) {
      const r = S.offRest[f];
      o.offArm = offArmTo(f, r.gx - dx, r.gy + b.hand);
      if (S.offWeapon) o.offWeapon = S.offWeapon(f, { gx: r.gx - dx, gy: r.gy + b.hand, angle: r.a - b.tilt, len: r.len });
    }
    if (S.idleExtra) o.extra = S.idleExtra(f, i, b.head);
    return frame(S, f, o);
  };
  return { frames: [mk(0), mk(1), mk(2), mk(3)], durations: [340, 260, 220, 300], loop: true };
}

function walkClip(S, f) {
  const seq = f === 'E'
    ? [['c1', 0, 1, 0], ['c1', 1, 1, 1], ['p1', -1, 0, 0], ['c2', 0, -1, 0], ['c2', 1, -1, 1], ['p2', -1, 0, 0]]
    : [['lfwd', 0, 1, 0], ['lfwd', 1, 1, 1], ['pass', -1, 0, 0], ['rfwd', 0, -1, 0], ['rfwd', 1, -1, 1], ['pass', -1, 0, 0]];
  const frames = seq.map(([legs, dy, hx, hy], i) => {
    const o = {
      legs, dy, arm: restArm(S, f, hx, dy + hy),
      weapon: restWeapon(S, f, { dx: hx, dy: dy + hy }),
    };
    if (S.offRest && S.offRest[f]) {
      const r = S.offRest[f];
      o.offArm = offArmTo(f, r.gx - hx, r.gy + dy + hy);
      if (S.offWeapon) o.offWeapon = S.offWeapon(f, { gx: r.gx - hx, gy: r.gy + dy + hy, angle: r.a, len: r.len });
    }
    if (S.idleExtra) o.extra = S.idleExtra(f, i % 4, dy);
    return frame(S, f, o);
  });
  return { frames, durations: [95, 95, 95, 95, 95, 95], loop: true };
}

function attackClip(S, f) {
  if (S.style === 'shoot') return shootClip(S, f);
  const path = (S.style === 'stab' ? STAB : SWING)[f];
  const sm = SMEAR[f];
  const lift = [1, -1, 0, 0], lunge = f === 'E' ? [-1, 3, 3, 1] : [0, 0, 0, 0];
  const legs = ['stand', f === 'E' ? 'c1' : 'lfwd', f === 'E' ? 'c1' : 'lfwd', 'stand'];
  const frames = path.map(([hx, hy, a], i) => {
    const len = S.rest[f].len + (i === 1 ? 1 : 0);
    const o = {
      dy: lift[i], dx: lunge[i], legs: legs[i],
      arm: armTo(f, hx, hy, S.off && S.off[f]),
      weapon: S.weapon(f, { gx: hx, gy: hy, angle: a, len }),
      weaponBehind: f === 'N' && i < 2,
    };
    if (i === 1) o.smear = smearArc(makePix(MON_W, MON_H), sm.cx, sm.cy, sm.r0, sm.r1, sm.a0, sm.a1, ['a', 'b', 'c', 'd']);
    if (S.offRest && S.offRest[f]) {
      const r = S.offRest[f];
      const odx = i === 1 || i === 2 ? -2 : 0;
      o.offArm = offArmTo(f, r.gx + odx, r.gy - (i === 0 ? 1 : 0));
      if (S.offWeapon) o.offWeapon = S.offWeapon(f, { gx: r.gx + odx, gy: r.gy - (i === 0 ? 1 : 0), angle: r.a, len: r.len });
    }
    if (S.idleExtra) o.extra = S.idleExtra(f, i, lift[i]);
    return frame(S, f, o);
  });
  return { frames, durations: [115, 80, 110, 145], loop: false };
}

/** The ranger: raise, full draw (the string bends back past the ear), loose, recover. */
function shootClip(S, f) {
  const aim = { S: 62, E: 90, N: -104 }[f];
  const grip = { S: [25, 21], E: [29, 20], N: [15, 20] }[f];
  const nock = { S: [17, 17], E: [21, 18], N: [23, 17] }[f];
  const frames = [];
  const mk = (pull, loose, dy, extra) => {
    const g = grip;
    const o = {
      dy, legs: 'stand',
      arm: armTo(f, g[0], g[1]),
      offArm: offArmTo(f, nock[0] + (pull > 3 ? -1 : 1), nock[1] + dy),
      weapon: bowPix(g[0], g[1] + dy, aim, { r: 8, pull, arrow: !loose, loose: false }),
      extra: extra || [],
    };
    if (S.idleExtra) o.extra = [...(o.extra || []), ...S.idleExtra(f, 0, dy)];
    return frame(S, f, o);
  };
  frames.push(mk(1, false, 0));
  frames.push(mk(5, false, 0));
  const ax = { S: [27, 30], E: [31, 21], N: [12, 12] }[f];
  frames.push(mk(0, true, -1, [L(arrowPix(ax[0], ax[1], aim, 7), 0, 0)]));
  frames.push(mk(1, false, 0));
  return { frames, durations: [130, 190, 90, 150], loop: false };
}

function hurtClip(S, f) {
  const lean = f === 'E' ? -2 : f === 'W' ? 2 : 0;
  const o = {
    dx: lean, dy: 1, hdx: lean, hdy: 1, legs: 'stand',
    arm: restArm(S, f, lean, 2), weapon: restWeapon(S, f, { dx: lean, dy: 2 }),
  };
  if (S.offRest && S.offRest[f]) {
    const r = S.offRest[f];
    o.offArm = offArmTo(f, r.gx + lean + 1, r.gy + 2);
    if (S.offWeapon) o.offWeapon = S.offWeapon(f, { gx: r.gx + lean + 1, gy: r.gy + 2, angle: r.a + 20, len: r.len });
  }
  if (S.idleExtra) o.extra = S.idleExtra(f, 2, 1);
  const recoil = frame(S, f, o);
  return { frames: [solid(recoil, 'F'), recoil], durations: [70, 170], loop: false };
}

/** Facing-independent collapse toward the camera; the weapon falls out of the hand. */
function deathClip(S) {
  const r = S.rest.S;
  const drop = (gx, gy, a) => S.weapon('S', { gx, gy, angle: a, len: r.len });
  const mk = (o) => frame(S, 'S', { ...o, extra: [...(o.extra || []), ...(S.idleExtra ? S.idleExtra('S', 1, o.dy || 0) : [])] });
  const f1 = mk({ dy: 1, hdx: -1, hdy: 1, legs: 'stand', arm: armTo('S', 13, 24), weapon: drop(15, 24, -34) });
  const f2 = mk({ dy: 3, hdy: 4, hdx: -1, legs: 'squat', arm: armTo('S', 12, 28, { dsy: 3 }), weapon: drop(15, 29, -66) });
  const f3 = mk({ dy: 6, hdy: 8, hdx: -1, legs: 'kneel', legDy: 2, arm: armTo('S', 12, 32, { dsy: 6 }), weapon: drop(16, 33, -104) });
  const heap = compose(MON_W, MON_H, [
    L(mk({ dy: 10, hdy: 12, hdx: -2, legs: 'down', legDy: 3, arm: armTo('S', 12, 35, { dsy: 10 }) }), 0, 0),
    L(drop(16, 35, -108), 0, 0),
  ]);
  const settle = compose(MON_W, MON_H, [
    L(mk({ dy: 11, hdy: 13, hdx: -2, legs: 'down', legDy: 4, arm: armTo('S', 12, 36, { dsy: 11 }) }), 0, 0),
    L(drop(16, 36, -108), 0, 0),
  ]);
  return { frames: [f1, f2, f3, heap, settle], durations: [140, 170, 210, 620, 700], loop: false };
}

/**
 * Build every clip of one species: name -> facing -> clip. West mirrors east.
 * @param {object} S species spec
 */
function buildSpecies(S) {
  const anims = {};
  const put = (name, f, a) => { (anims[name] ||= {})[f] = { name, facing: f, ...a }; };
  for (const f of ['S', 'E', 'N']) {
    put('idle', f, idleClip(S, f));
    put('walk', f, walkClip(S, f));
    put('attack', f, attackClip(S, f));
    put('hurt', f, hurtClip(S, f));
  }
  const d = deathClip(S);
  for (const f of ['S', 'E', 'N']) put('death', f, d);
  for (const name of Object.keys(anims)) {
    const e = anims[name].E;
    anims[name].W = { ...e, facing: 'W', frames: name === 'death' ? e.frames : e.frames.map((p) => mirrorLit(p, '')) };
  }
  return {
    anims, palette: S.palette, w: MON_W, h: MON_H, pivot: { x: PIVOT_X, y: PIVOT_Y },
    emissive: 'YG', scale: S.scale || 1,
  };
}

// ============================================================================ HOBGOBLIN
// The goblinoid grunt. Ear-blades wider than the skull, a jutting underbite with two tusks, a
// hunched barrel chest over bandy legs, and a notched iron cleaver held low. Nothing else in the
// dungeon is this wide at the head and this narrow at the hip.
const HOB_HEAD_S = relight(paint(`
......................
...#....######....#...
..#3#..#333333#..#2#..
.#33#.#33333322#.#22#.
.#3333#31111112#2222#.
#33322#11111111#22322#
#33222#EYY22YYE#22222#
.#####.#22222221#####.
......#22111122#......
......#21TTTT12#......
......#T111111T#......
.......#111112#.......`), '123', { bias: 0.10 });
const HOB_HEAD_E = relight(paint(`
......................
...#....######........
..#3#..#3333332#......
.#33#.#333333322#.....
.#3333#3111111112#....
#33322#322EYY22212#...
#33222#32222222212#...
.#####.#3222221TT12#..
......#32211TT1112#...
......#3221111112#....
........#32211112#....
........##########....`), '123', { bias: 0.10 });
const HOB_HEAD_N = relight(paint(`
......................
...#....######....#...
..#3#..#333333#..#2#..
.#33#.#33333322#.#22#.
.#3333#33333322#2222#.
#33322#33322222#22322#
#33222#33222222#22222#
.#####.#32222221#####.
......#32222211#......
......#22222211#......
......#22222211#......
.......#222211#.......`), '123', { bias: 0.10 });
const HOB_TORSO_S = relight(paint(`
.....######.....
..############..
.#333222222333#.
#33322222222333#
#33222222222233#
#32221222212233#
#32222222222233#
.#322222222233#.
.#889999998888#.
.#880999908888#.
..#5566665544#..
..#5566665544#..
..#5566665544#..
...#55665544#...
....########....
................`), '123', { bias: -0.07 });
const HOB_TORSO_E = relight(paint(`
......####......
....########....
...#33322222#...
..#33322222222#.
..#33222222222#.
..#32222222222#.
..#32222222222#.
..#32222222222#.
..#3222222222#..
..#8899999998#..
..#8809999908#..
..#5566665544#..
..#5566665544#..
...#55665544#...
....########....
................`), '123', { bias: -0.07 });
const HOB_TORSO_N = relight(paint(`
.....######.....
..############..
.#333222222333#.
#33322212222333#
#33222212222233#
#32222212222223#
#32222212222223#
.#322221222233#.
.#889999998888#.
.#880999908888#.
..#5566665544#..
..#5566665544#..
..#5566665544#..
...#55665544#...
....########....
................`), '123', { bias: -0.07 });

const HOBGOBLIN = {
  scale: 1.08,
  palette: humanoidPalette({
    skin: '#6f8a3c', cloth: '#7a4526', leather: '#5c3a24', metal: '#8f9298',
    accent: '#b8873c', eye: '#ffd24a', tooth: '#efe6cd',
  }),
  head: { S: HOB_HEAD_S, E: HOB_HEAD_E, N: HOB_HEAD_N },
  headX: { S: 9, E: 9, N: 9 },
  torso: { S: HOB_TORSO_S, E: HOB_TORSO_E, N: HOB_TORSO_N },
  torsoX: { S: 12, E: 12, N: 12 },
  limb: { lit: '2', dark: '1', fist: '2', fistLit: '3' },
  style: 'swing',
  rest: { S: { gx: 14, gy: 23, a: -18, len: 10 }, E: { gx: 26, gy: 22, a: 32, len: 10 }, N: { gx: 26, gy: 23, a: 16, len: 10 } },
  weapon: (f, o) => bladePix(o.gx, o.gy, o.angle, { len: o.len, w0: 0.8, w1: 2.3, notch: 1, glint: o.glint || 0, grip: '9', pommel: '8' }),
};

// ============================================================================ ROGUE (thief)
// Small and coiled. The hood is a hard triangular peak with the face lost in shadow behind two cold
// eye-glints; a fat coin pouch swings at the belt (its gold is the one warm note) and the dagger is
// held REVERSED, blade back along the forearm — the thief's grip.
const ROG_HEAD_S = relight(paint(`
.......##.......
......#46#......
.....#4456#.....
....#445566#....
...#4455566#....
..#445####566#..
..#45#EWWE#56#..
..#45#1111#56#..
..#455#11#556#..
...#4455556#....
....######......
................`), '7456', { bias: 0.10 });
const ROG_HEAD_E = relight(paint(`
....##..........
...#46#.........
..#4456#........
.#445566#.......
.#4455566#......
.#445#####......
.#45#EW211#.....
.#45#111212#....
.#455#11111#....
..#4455566#.....
...#######......
................`), '7456', { bias: 0.10 });
const ROG_HEAD_N = relight(paint(`
.......##.......
......#46#......
.....#4456#.....
....#445566#....
...#44555566#...
..#4455556666#..
..#4455555566#..
..#4455555666#..
..#4455556666#..
...#44555566#...
....########....
................`), '7456', { bias: 0.10 });
const ROG_TORSO_S = relight(paint(`
.....######.....
..###444444###..
.#444555555444#.
#44455566555444#
#44555666555444#
#44555666555444#
#44555666555444#
.#445556655554#.
.#889999998888#.
.#88099gfe0888#.
..#4455554444#..
..#4455554444#..
...#44555444#...
...#44555444#...
....########....
................`), '7456', { bias: -0.07 });
const ROG_TORSO_E = relight(paint(`
......####......
....########....
...#44455555#...
..#44455555666#.
..#44555556666#.
..#44555556666#.
..#44555556666#.
..#4455555666#..
..#4455555666#..
..#8899999998#..
..#880gfe99908#.
..#4455554444#..
..#4455554444#..
...#44555444#...
....########....
................`), '7456', { bias: -0.07 });
const ROG_TORSO_N = relight(paint(`
.....######.....
..###444444###..
.#444555555444#.
#44455555554444#
#44555555554444#
#44555565554444#
#44555565554444#
.#445555655444#.
.#889999998888#.
.#880999908888#.
..#4455554444#..
..#4455554444#..
...#44555444#...
...#44555444#...
....########....
................`), '7456', { bias: -0.07 });

// The stolen purse: fat, gold-stuffed and swinging half a beat behind the hips. The thief's tell.
const PURSE = paint(`
..##..
.#gf#.
#gffe#
#gffe#
#ffee#
.####.`);

const ROGUE = {
  scale: 1.02,
  palette: humanoidPalette({
    skin: '#d8a982', cloth: '#4e4032', leather: '#8f5f2e', metal: '#9aa2ae',
    accent: '#d8a42e', eye: '#bff2ff',
    // his cloak IS his silhouette, so it takes the top of the curve as well as the bottom: on the
    // group default ([0,2,3,4]) the lit fold never got past mid grey and he read as one flat shape
    picks: { cloth: [0, 2, 3, 6] },
  }),
  head: { S: ROG_HEAD_S, E: ROG_HEAD_E, N: ROG_HEAD_N },
  headX: { S: 12, E: 12, N: 12 },
  torso: { S: ROG_TORSO_S, E: ROG_TORSO_E, N: ROG_TORSO_N },
  torsoX: { S: 12, E: 12, N: 12 },
  limb: { lit: '5', dark: '4', fist: '2', fistLit: '3' },
  style: 'stab',
  rest: { S: { gx: 14, gy: 23, a: 150, len: 6 }, E: { gx: 25, gy: 22, a: 190, len: 6 }, N: { gx: 26, gy: 23, a: 168, len: 6 } },
  weapon: (f, o) => bladePix(o.gx, o.gy, o.angle, { len: o.len, w0: 0.5, w1: 0.5, glint: o.glint || 0, guard: 1, grip: '8', pommel: 'e' }),
  idleExtra: (f, phase, dy) => {
    const at = { S: [23, 20], E: [15, 21], N: [12, 20] }[f];
    const sw = [0, 1, 1, 0][phase % 4];
    return [L(PURSE, at[0] + (f === 'E' ? -sw : sw), at[1] + dy)];
  },
};

// ============================================================================ BARBARIAN
// The widest silhouette in the group: a mane of hair spilling past bare shoulders, a headband, a
// jaw full of beard, and a double-bit axe whose head is nearly as wide as his chest.
const BAR_HEAD_S = paint(`
....#eeffee#....
...#effggeefe#..
..#efffggffe#...
..#eff#3333#fe#.
..#ef#311113#e#.
..#ef#1EE2EE1#e#
..#ef#3322233#e#
..#ef#3211123#e#
..#efe#31113#ee#
..#eeffe111effe#
...#eeeffeffee#.
.....########...`);
const BAR_HEAD_E = paint(`
...#eeffee#.....
..#effggffe#....
.#efffgg333#....
.#eff#3333333#..
.#ef#3111113#...
.#ef#31EE223#...
.#ef#3332223#...
.#ef#3311123#...
.#efe#311123#...
.#eeffe1111#....
..#eeffeffe#....
....#######.....`);
const BAR_HEAD_N = paint(`
....#effgge#....
...#ffggffee#...
..#ffgggffeee#..
..#efgggffeee#..
..#effgeffeee#..
..#effgeffeee#..
..#efefeffeee#..
..#eeeffeeeee#..
..#eeeffeeeee#..
..#eeefeeeeee#..
...#eefeeeee#...
....#eeeeee#....`);
const BAR_TORSO_S = paint(`
......######......
..###3333333###...
.#eef33222233fee#.
#eeff32222223ffee#
#eff#322222223#fe#
.##.#322112223#.##
....#32211223#....
....#32222223#....
...#3322222233#...
...#889999998888#.
...#88099990888#..
....#556666554#...
....#556666554#...
....#55666554#....
.....########.....
..................`);
const BAR_TORSO_E = paint(`
......#####.......
....#########.....
...#ee3322222#....
..#eeff32222223#..
..#eff#32222222#..
..#ef#32222222#...
...##32222222#....
....#32222222#....
....#33222222#....
...#8899999998#...
...#8809999908#...
....#5566665544#..
....#5566665544#..
.....#55665544#...
......########....
..................`);
const BAR_TORSO_N = paint(`
......######......
..###3333333###...
.#eef33222233fee#.
#eeff32221223ffee#
#eff#322212223#fe#
.##.#322212223#.##
....#32221222#....
....#32221222#....
...#3322122233#...
...#889999998888#.
...#88099990888#..
....#556666554#...
....#556666554#...
....#55666554#....
.....########.....
..................`);

const BARBARIAN = {
  scale: 1.2,
  palette: humanoidPalette({
    skin: '#c2926f', cloth: '#7a5c3c', leather: '#5f4126', metal: '#9ba3b0',
    accent: '#96562f', eye: '#ffe9c0',
    // Bare skin is nearly his whole body, so it takes a NARROWER slice of the house curve than a
    // clothed fighter's face does: a shadow two steps up from the bottom, not one. The mane takes
    // the BOTTOM of its curve for the opposite reason — at the middle it landed on the same value
    // as the lit chest and the two merged into one beige mass that read as a hooded tunic.
    picks: { skin: [2, 3, 5], accent: [0, 1, 3] },
  }),
  head: { S: BAR_HEAD_S, E: BAR_HEAD_E, N: BAR_HEAD_N },
  headX: { S: 12, E: 12, N: 12 },
  torso: { S: BAR_TORSO_S, E: BAR_TORSO_E, N: BAR_TORSO_N },
  torsoX: { S: 11, E: 11, N: 11 },
  limb: { lit: '3', dark: '2', fist: '2', fistLit: '3' },
  style: 'swing',
  rest: { S: { gx: 15, gy: 24, a: -24, len: 11 }, E: { gx: 25, gy: 23, a: 30, len: 11 }, N: { gx: 25, gy: 24, a: 22, len: 11 } },
  // The off hand: bare, hanging outside the hip clear of the mane. Without it the axe shoulder was
  // the only arm he had and the other one ended in a stump under the hair.
  // (no E entry: from the side the far arm is behind the body, and drawing it would stripe the chest)
  offRest: { S: { gx: 27, gy: 23, a: 0, len: 0 }, N: { gx: 13, gy: 23, a: 0, len: 0 } },
  weapon: (f, o) => axePix(o.gx, o.gy, o.angle, { len: o.len, head: 4.2, glint: o.glint || 0 }),
};

// ============================================================================ ELVIN RANGER
// Tall, thin and the only curved silhouette: a longbow arch reaching past the head. A pointed ear
// and a feather clear the cowl; the quiver's fletchings crest behind the far shoulder.
const RAN_HEAD_S = paint(`
.......###......
.....##566#.....
....#455666#....
...#4455666#..#.
..#445####6#.##.
..#45#2222#6#3#.
..#45#3W2W3#6#..
..#45#32223#6#..
..#455#222#56#..
...#44555566#...
....########....
................`);
const RAN_HEAD_E = paint(`
.....###........
...##5566#......
..#455566#......
.#4455566#....#.
.#445#####...##.
.#45#2W223#.#3#.
.#45#32222#3#...
.#45#322213#....
.#455#3222#.....
..#4455566#.....
...#######......
................`);
const RAN_HEAD_N = paint(`
.......###......
.....##566#.....
....#455666#....
...#4455666#.#..
..#44555666#.##.
..#445555666#3#.
..#445556666#...
..#445556666#...
..#445556666#...
...#44555666#...
....########....
................`);
const RAN_TORSO_S = paint(`
.....######.....
..###444455###..
.#444555555666#.
#44455566655566#
#44555666555566#
#44555666555566#
#44555666555566#
.#445556655556#.
.#889999998888#.
.#880999908888#.
..#4455554444#..
..#4455554444#..
...#44555444#...
...#44555444#...
....########....
................`);
const RAN_TORSO_E = paint(`
......####......
....########....
...#44455555#...
..#44455555666#.
..#44555556666#.
..#44555556666#.
..#44555556666#.
..#4455555666#..
..#4455555666#..
..#8899999998#..
..#8809999908#..
..#4455554444#..
..#4455554444#..
...#44555444#...
....########....
................`);
const RAN_TORSO_N = paint(`
.....######.....
..###444455###..
.#444555555666#.
#44455555556666#
#44555555556666#
#44555565556666#
#44555565556666#
.#445555655556#.
.#889999998888#.
.#880999908888#.
..#4455554444#..
..#4455554444#..
...#44555444#...
...#44555444#...
....########....
................`);
// The quiver: arrow shafts and fletchings crossing behind the shoulder (the ranger's tell).
const QUIVER = paint(`
.#g#.#f#..
.#f#.#g#..
.#9#.#9#..
.#9#.#9#..
#899##899#
#88999888#
#88899988#
.########.`);

// A single long feather swept back off the cowl: the elf's tell, and the one shape that separates
// this hood from the thief's at a glance.
const FEATHER = paint(`
....#
...#g
..#gf
.#gf#
#ff#.
#fe#.
.##..`);

const RANGER = {
  scale: 1.12,
  palette: humanoidPalette({
    skin: '#e0bb92', cloth: '#3f6b4a', leather: '#9c7442', metal: '#a8b0bc',
    accent: '#c8b46a', eye: '#dff5ff',
    // A figure dressed head to foot in forest green has almost nothing to be light or dark WITH:
    // his fletchings take the top of the curve and his belt and boots the very bottom, which is
    // what stops the whole silhouette flattening into the wall behind him.
    picks: { accent: [2, 4, 6], leather: [0, 3, 5] },
  }),
  head: { S: RAN_HEAD_S, E: RAN_HEAD_E, N: RAN_HEAD_N },
  headX: { S: 12, E: 12, N: 12 },
  torso: { S: RAN_TORSO_S, E: RAN_TORSO_E, N: RAN_TORSO_N },
  torsoX: { S: 12, E: 12, N: 12 },
  back: { S: QUIVER, E: QUIVER, N: QUIVER },
  backAt: { S: [23, 8], E: [15, 9], N: [11, 8] },
  limb: { lit: '5', dark: '4', fist: '2', fistLit: '3' },
  style: 'shoot',
  rest: { S: { gx: 25, gy: 21, a: 62, len: 8 }, E: { gx: 29, gy: 20, a: 90, len: 8 }, N: { gx: 15, gy: 20, a: -104, len: 8 } },
  weapon: (f, o) => bowPix(o.gx, o.gy, { S: 62, E: 90, N: -104 }[f], { r: 8, pull: 1 }),
  idleExtra: (f, phase, dy) => {
    const at = { S: [11, 2], E: [9, 2], N: [23, 2] }[f];
    return [L(FEATHER, at[0], at[1] + dy, f === 'N')];
  },
};

// ============================================================================ ASSASSIN
// Narrow, low and wrapped head to foot in indigo; the only face is a mask slit with a red ember
// behind it. Twin daggers held reversed, and a long scarf that keeps moving after he stops.
const ASS_HEAD_S = relight(paint(`
......####......
.....#4556#.....
....#445566#....
....#445566#....
...#44555666#...
...#4YY44YY6#...
...#44444466#...
...#44555566#...
....#445556#....
....#445566#....
.....######.....
................`), '7456', { bias: 0.10 });
const ASS_HEAD_E = relight(paint(`
.....####.......
....#45566#.....
...#4455666#....
...#4455666#....
..#445556666#...
..#44YY44446#...
..#4444444446#..
..#4455556666#..
...#445566666#..
...#44556666#...
....########....
................`), '7456', { bias: 0.10 });
const ASS_HEAD_N = relight(paint(`
......####......
.....#4556#.....
....#445566#....
....#445566#....
...#44555666#...
...#44555666#...
...#44555666#...
...#44555666#...
....#455566#....
....#445566#....
.....######.....
................`), '7456', { bias: 0.10 });
const ASS_TORSO_S = relight(paint(`
.....######.....
..###444455###..
.#444555555666#.
#44455566655566#
#44555666555566#
#44555666555566#
#44555666555566#
.#445556655556#.
.#889999998888#.
.#880999908888#.
..#4455554444#..
..#4455554444#..
...#44555444#...
...#44555444#...
....########....
................`), '7456', { bias: -0.07 });
const ASS_TORSO_E = relight(paint(`
......####......
....########....
...#44455555#...
..#44455555666#.
..#44555556666#.
..#44555556666#.
..#44555556666#.
..#4455555666#..
..#4455555666#..
..#8899999998#..
..#8809999908#..
..#4455554444#..
..#4455554444#..
...#44555444#...
....########....
................`), '7456', { bias: -0.07 });
const ASS_TORSO_N = relight(paint(`
.....######.....
..###444455###..
.#444555555666#.
#44455555556666#
#44555555556666#
#44555565556666#
#44555565556666#
.#445555655556#.
.#889999998888#.
.#880999908888#.
..#4455554444#..
..#4455554444#..
...#44555444#...
...#44555444#...
....########....
................`), '7456', { bias: -0.07 });
// The scarf: four drift poses, sheared further with each idle beat.
const SCARF = [
  paint(`
#eff#....
#eef#....
.#ef#....
.#ee#....
.#ef#....
..#e#....
..##.....`),
  paint(`
#eff#....
.#eef#...
.#eff#...
..#ee#...
..#ef#...
...#e#...
...##....`),
  paint(`
#eff#....
.#eef#...
..#eff#..
..#eee#..
...#ef#..
...#ee#..
....##...`),
  paint(`
#eff#....
.#eef#...
.#eff#...
..#ee#...
..#eff#..
...#ee#..
...##....`),
];

const ASSASSIN = {
  scale: 1.12,
  palette: humanoidPalette({
    skin: '#8f7c9a', cloth: '#4e4b80', leather: '#332f52', metal: '#aab2c2',
    accent: '#a8283c', eye: '#ff5a4a',
  }),
  head: { S: ASS_HEAD_S, E: ASS_HEAD_E, N: ASS_HEAD_N },
  headX: { S: 12, E: 12, N: 12 },
  torso: { S: ASS_TORSO_S, E: ASS_TORSO_E, N: ASS_TORSO_N },
  torsoX: { S: 12, E: 12, N: 12 },
  limb: { lit: '5', dark: '4', fist: '4', fistLit: '5' },
  style: 'stab',
  rest: { S: { gx: 14, gy: 23, a: 154, len: 6 }, E: { gx: 25, gy: 22, a: 190, len: 6 }, N: { gx: 26, gy: 23, a: 170, len: 6 } },
  offRest: { S: { gx: 26, gy: 23, a: 206, len: 6 }, E: { gx: 19, gy: 23, a: 170, len: 6 }, N: { gx: 14, gy: 23, a: 190, len: 6 } },
  weapon: (f, o) => bladePix(o.gx, o.gy, o.angle, { len: o.len, w0: 0.5, w1: 0.5, glint: o.glint || 0, guard: 1, grip: '8', pommel: 'a' }),
  offWeapon: (f, o) => bladePix(o.gx, o.gy, o.angle, { len: o.len, w0: 0.5, w1: 0.5, guard: 1, grip: '8', pommel: 'a' }),
  idleExtra: (f, phase, dy) => {
    const s = SCARF[phase % SCARF.length];
    const at = { S: [24, 15], E: [14, 16], N: [12, 15] }[f];
    return [L(s, at[0], at[1] + dy)];
  },
};

// ------------------------------------------------------------------------------------ registry
const cache = new Map();
const build = (key, spec) => () => {
  let b = cache.get(key);
  if (!b) { b = buildSpecies(spec); cache.set(key, b); }
  return b;
};

/**
 * Humanoid-warrior sprite builders, keyed by monster type. Aliases cover the goblinoid/thief names
 * other systems may use for the same silhouette.
 * @type {Object<string, () => object>}
 */
export const HUMANOID_BUILDERS = {
  hobgoblin: build('hobgoblin', HOBGOBLIN),
  orc: build('hobgoblin', HOBGOBLIN),
  goblin: build('hobgoblin', HOBGOBLIN),
  rogue: build('rogue', ROGUE),
  thief: build('rogue', ROGUE),
  barbarian: build('barbarian', BARBARIAN),
  'elvin-ranger': build('ranger', RANGER),
  ranger: build('ranger', RANGER),
  assassin: build('assassin', ASSASSIN),
};

export { buildSpecies, humanoidPalette, LEGS_S, LEGS_E, bladePix, axePix, bowPix, limbPix };

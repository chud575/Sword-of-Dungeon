// caster: the dungeon's spellcasters and tricksters as HD-2D pixel sprites (Octopath / Triangle
// Strategy look), drawn with the same toolkit, ramp discipline and key light as the hero
// (sprites/pixelPainter.js, sprites/heroSprite.js).
//
// GROUP: mage (the spell-thief of the original game), warlock (the battle-caster variant),
// sprite (an invisible shimmer — a pixie you only see as refracted light), wizard/illusionist
// (a masked caster who splits into three when he casts).
//
// SHARED CANVAS  40x44, pivot (20, 41): fills stop on row 40 so the single outline lands on the
// pivot row and spriteSheet's foot metrics drop the contact shadow under the actual hem. The
// figure is ~41 px tall (1.28 tiles at PX_PER_TILE = 32) and each type multiplies by its own
// `scale`, so every caster keeps EXACTLY the hero's pixel density (1 texel = 1/32 tile). The
// sprite (pixie) is the one exception: it gets its own 26x30 canvas because it is tiny and hovers.
//
// KEY VOCABULARY — one set for the whole group, so the procedural robe, sleeve, orb and staff
// helpers below are written once and only the palette changes per species:
//   #  outline (near-black violet, never pure black)     @  lit edge / inner separation line
//   1 2 3      skin            dark -> light
//   4 5 6 7    robe cloth      deep crease -> highlight
//   8 9        trim / leather / wood
//   a b c d    metal           dark -> light (d is the specular, 1-px edges only)
//   e f g      accent (beard, horn, hair, gold)
//   m n o      magic           dark -> light        p  magic spark  (emissive)
//   s t u      shimmer (the sprite's refraction)
//   v          void: the warlock's shadow core, the illusionist's after-images
//   E eye socket   W catch-light   Y eye glow (emissive)   G glint (emissive)   F hurt flash
// Six hue-shifted ramps per species: shadows drift violet and gain saturation, highlights drift
// amber and lose a little — never a flat darken/lighten. Light is TOP-LEFT on every facing; the
// silhouette outline is laid on LAST by `outline()` so it is exactly one pixel and is softened to
// the lilac '@' on the edges that face the light. Arms, staves and orbs carry their own outline so
// they separate from the body without any hand-drawn interior lines. Nothing pillow-shades,
// nothing dithers.
//
// SILHOUETTES (the read at gameplay distance, before any colour):
//   mage     a hat brim far wider than his shoulders over a narrow robe column, a beard hanging
//            to the belt, and a staff standing straight up beside him with a caged orb on top.
//   warlock  no hat at all: a bare horned skull between two SPIKED pauldrons that make him the
//            widest thing at the shoulder, a robe torn to points, and a ball of dark held in
//            both bare hands — the only caster with nothing above his head.
//   sprite   tiny and hovering, four dragonfly wings, and a body that is only a dark pane of
//            glass under a refracted rim: it reads as a hole in the air with two eyes in it.
//   wizard   a blank white mask under a collar split into two gilt horns that rise past his head,
//            arms flung wide, a ring of runes turning over one hand; casting splits him in three.
//
// FACINGS south / east / north are each drawn deliberately; west is the mirrored east (the
// billboard flips it). CLIPS idle(4) walk(6) attack(4) hurt(2) death(5).
import {
  Palette, paint, compose, outline, makePix, setPx, getPx, line, solid,
} from '../pixelPainter.js';

/** @typedef {import('../pixelPainter.js').Pix} Pix */

export const MON_W = 40, MON_H = 44, PIVOT_X = 20, PIVOT_Y = 41;

const LIT = { x: -1, y: -1 };
const L = (p, x = 0, y = 0) => (p ? { p, x, y } : null);
/** Compose layers and lay the one selective silhouette outline on last (the house treatment). */
const ink = (layers, w = MON_W, h = MON_H) => outline(compose(w, h, layers.filter(Boolean)), '#', { lit: LIT, litKey: '@' });
/** The same outline treatment on a single part, so it separates from whatever it is drawn over. */
const edge = (p) => outline(p, '#', { lit: LIT, litKey: '@' });

// ------------------------------------------------------------------------------------ palettes
/**
 * One species palette over the shared key vocabulary.
 * @param {{skin:string, cloth:string, trim:string, metal:string, accent:string, magic:string,
 *   eye:string, spark?:string, shimmer?:string, voidCol?:string, outline?:string, litEdge?:string,
 *   clothStep?:number, magicStep?:number}} o
 */
export function casterPalette(o) {
  return new Palette()
    .set('#', o.outline || '#161020')
    .set('@', o.litEdge || '#4a4157')
    .ramp('123', o.skin, { step: 0.07, hueShift: 0.02, satShift: 0.05 })
    .ramp('4567', o.cloth, { step: o.clothStep ?? 0.085, mid: 1, hueShift: 0.028, satShift: 0.06 })
    .ramp('89', o.trim, { step: 0.1, hueShift: 0.03, satShift: 0.07 })
    .ramp('abcd', o.metal, { step: 0.12, satShift: 0.13 })
    .ramp('efg', o.accent, { step: 0.1, hueShift: 0.02, satShift: 0.06 })
    .ramp('mno', o.magic, { step: o.magicStep ?? 0.135, satShift: 0.1 })
    .ramp('stu', o.shimmer || '#8fd0ff', { step: 0.125, satShift: 0.09 })
    .set('p', o.spark || '#fff6d8')
    .set('v', o.voidCol || '#170e28')
    .set('E', '#171020')
    .set('W', '#fff6e8')
    .set('Y', o.eye)
    .set('G', '#ffffff')
    .set('F', '#fff4f0');
}

// -------------------------------------------------------------------------------- robe & body
// A caster's skirt is a cone of cloth, so it is built rather than hand-drawn: the shading is a
// function of the angle across the cone (never a stack of horizontal bands), the fold creases
// radiate from the waist because they sit at fixed *normalised* offsets, and one number swings the
// whole hem for the walk cycle without redrawing anything.

/** Deterministic jag depths for a robe torn to points (the warlock). */
const RAG = [0, -2, -1, -3, 0, -1, -2, -1];

/**
 * @param {{top?:number, bot?:number, topW?:number, botW?:number, sway?:number, lean?:number,
 *   ragged?:boolean, split?:number, folds?:number[], cx?:number, keys?:string, flare?:number}} o
 * @returns {Pix} full-canvas layer
 */
function robePix(o = {}) {
  const {
    top = 25, bot = 40, topW = 13, botW = 19, sway = 0, lean = 0,
    ragged = false, split = 0, folds = [-0.36, 0.24], cx = PIVOT_X, keys = '4567', flare = 0,
  } = o;
  const p = makePix(MON_W, MON_H);
  const [k0, k1, k2, k3] = keys;
  const span = Math.max(1, bot - top);
  for (let y = top; y <= bot; y++) {
    const t = (y - top) / span;
    const hw = topW / 2 + ((botW + flare) - topW) / 2 * Math.pow(t, 1.28);
    const ox = cx + lean * (1 - t) + sway * t * t;
    for (let x = Math.ceil(ox - hw); x <= Math.floor(ox + hw); x++) {
      if (ragged && y > bot + RAG[(x + 24) % RAG.length]) continue;
      const u = (x - ox) / hw;
      // the front slit of a split robe: a deep crease, not a hole
      const inSlit = split > 0 && t > 0.34 && Math.abs(u) < split;
      let key = u <= -0.70 ? k3 : u <= -0.12 ? k2 : u <= 0.50 ? k1 : k0;
      for (const fu of folds) if (Math.abs(u - fu) < 0.075) key = key === k3 ? k2 : key === k2 ? k1 : k0;
      if (inSlit) key = k0;
      if (y === bot && !ragged) key = key === k3 ? k2 : k0;      // the hem reads as a dark edge
      setPx(p, x, y, key);
    }
  }
  return p;
}

/**
 * The torso above the robe: a tapered column shaded across its width, with an optional belt.
 * `prof` is the half-width for each row from `top` down.
 * @param {{top:number, prof:number[], cx?:number, keys?:string, belt?:number, beltKeys?:string}} o
 */
function torsoPix(o) {
  const { top, prof, cx = PIVOT_X, keys = '4567', belt = -1, beltKeys = '89' } = o;
  const p = makePix(MON_W, MON_H);
  const [k0, k1, k2, k3] = keys;
  for (let i = 0; i < prof.length; i++) {
    const y = top + i, hw = prof[i];
    if (hw <= 0) continue;
    for (let x = Math.ceil(cx - hw); x <= Math.floor(cx + hw); x++) {
      const u = (x - cx) / hw;
      let key = u <= -0.68 ? k3 : u <= -0.10 ? k2 : u <= 0.52 ? k1 : k0;
      if (y === belt || y === belt + 1) key = u <= -0.34 ? beltKeys[1] : beltKeys[0];
      setPx(p, x, y, key);
    }
  }
  return p;
}

/**
 * A hanging sleeve from shoulder to hand, wide at the shoulder and tapering to a cuff, with a
 * two-pixel fist at the end. Pre-outlined so it separates from the robe behind it.
 */
function sleevePix(sx, sy, hx, hy, o = {}) {
  const { keys = '4567', w0 = 2.2, w1 = 1.0, hand = '2', handLit = '3', cuff = null } = o;
  const p = makePix(MON_W, MON_H);
  const len = Math.max(1e-3, Math.hypot(hx - sx, hy - sy));
  const dx = (hx - sx) / len, dy = (hy - sy) / len;
  const nx = -dy, ny = dx;
  const steps = Math.max(6, Math.round(len * 2.6));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = sx + dx * len * t, py = sy + dy * len * t;
    const hw = w0 + (w1 - w0) * t;
    for (let u = -hw; u <= hw; u += 0.3) {
      const k = u < -hw + 0.95 ? keys[2] : u > hw - 0.85 ? keys[0] : keys[1];
      setPx(p, Math.round(px + nx * u), Math.round(py + ny * u), k);
    }
    if (cuff && t > 0.86) for (let u = -hw; u <= hw; u += 0.3) setPx(p, Math.round(px + nx * u), Math.round(py + ny * u), u < 0 ? cuff[1] : cuff[0]);
  }
  setPx(p, hx, hy, handLit); setPx(p, hx + 1, hy, hand);
  setPx(p, hx, hy + 1, hand); setPx(p, hx + 1, hy + 1, hand);
  return edge(p);
}

// ---------------------------------------------------------------------------------- spell props

/**
 * A ball of light: brightest a little up and to the left of centre (the key light passes through
 * it), falling to the rim. `dark` inverts it into a void with a bright corona — the warlock's.
 */
function orbPix(cx, cy, r, o = {}) {
  const { dark = false, keys = 'mno', spark = 'p', core = 'v' } = o;
  const p = makePix(MON_W, MON_H);
  const hx = cx - r * 0.34, hy = cy - r * 0.38;
  for (let y = Math.floor(cy - r) - 1; y <= Math.ceil(cy + r) + 1; y++) {
    for (let x = Math.floor(cx - r) - 1; x <= Math.ceil(cx + r) + 1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d > 1) continue;
      const h = Math.hypot(x + 0.5 - hx, y + 0.5 - hy) / r;
      let k;
      if (dark) k = d > 0.80 ? keys[2] : d > 0.55 ? keys[1] : core;
      else k = h < 0.34 ? spark : h < 0.66 ? keys[2] : d > 0.82 ? keys[0] : keys[1];
      setPx(p, x, y, k);
    }
  }
  return edge(p);
}

/**
 * The mage's staff: a knotted shaft with a bound iron cage at the head and a caged orb inside it.
 * `angle` is degrees clockwise from straight up; the grip is where the hand closes on it.
 */
function staffPix(gx, gy, angle, o = {}) {
  const { up = 22, down = 13, orb = 3.0, glow = 0 } = o;
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const R = Math.round;
  const p = makePix(MON_W, MON_H);
  const tx = gx + dx * up, ty = gy + dy * up;
  const bx = gx - dx * down, by = gy - dy * down;
  line(p, R(bx), R(by), R(tx), R(ty), '9');
  line(p, R(bx + 1), R(by), R(tx + 1), R(ty), '8');
  // grip bindings and a knot half way up
  for (let k = -1; k <= 1; k++) { setPx(p, R(gx) + k, R(gy), 'b'); setPx(p, R(gx) + k, R(gy + 1), 'a'); }
  setPx(p, R(gx + dx * up * 0.45), R(gy + dy * up * 0.45), '8');
  // the cage: two claws closing over the orb
  const ox = tx + dx * (orb + 0.4), oy = ty + dy * (orb + 0.4);
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
    const th = a + s * (0.55 + i * 0.16);
    setPx(p, R(ox - Math.sin(th) * (orb + 0.9)), R(oy + Math.cos(th) * (orb + 0.9)), s < 0 ? 'c' : 'a');
  }
  const q = compose(MON_W, MON_H, [L(edge(p)), L(orbPix(ox, oy, orb + (glow ? 0.7 : 0)))]);
  if (glow) for (let i = 0; i < 6; i++) {
    const th = (i / 6) * Math.PI * 2 + 0.4;
    setPx(q, R(ox + Math.cos(th) * (orb + 2.6)), R(oy + Math.sin(th) * (orb + 2.6)), 'p');
  }
  return q;
}

/**
 * The illusionist's rune ring: an ellipse of dashes seen almost edge-on, turning. `phase` picks
 * which dashes are lit, so the ring reads as spinning without any per-frame art.
 */
function hoopPix(cx, cy, rx, ry, phase) {
  const p = makePix(MON_W, MON_H);
  const N = 20;
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2 + phase * 0.42;
    const x = Math.round(cx + Math.cos(th) * rx), y = Math.round(cy + Math.sin(th) * ry);
    const front = Math.sin(th) > 0;             // the near half of the ring is brighter
    setPx(p, x, y, i % 5 === (phase % 5) ? 'p' : front ? 'o' : 'n');
  }
  return p;
}

/** Loose motes of magic (spell wake, death dissolve). `list` is [x, y, key] triples. */
function motePix(list) {
  const p = makePix(MON_W, MON_H);
  for (const [x, y, k] of list) setPx(p, Math.round(x), Math.round(y), k);
  return p;
}

/** A bolt leaving the caster: a bright head with a tapering tail behind it. */
function boltPix(x, y, dirX, dirY, len, o = {}) {
  const { keys = 'mno', spark = 'p' } = o;
  const p = makePix(MON_W, MON_H);
  const d = Math.max(1e-3, Math.hypot(dirX, dirY));
  const dx = dirX / d, dy = dirY / d, nx = -dy, ny = dx;
  for (let i = 0; i <= len * 2; i++) {
    const t = i / (len * 2);
    const hw = 1.7 * (1 - t) + 0.2;
    for (let u = -hw; u <= hw; u += 0.4) {
      const k = t < 0.2 ? spark : Math.abs(u) < hw * 0.45 ? keys[2] : keys[1];
      setPx(p, Math.round(x - dx * len * t + nx * u), Math.round(y - dy * len * t + ny * u), k);
    }
  }
  return p;
}

/** Keep only the pixels on a form's edge, recoloured — how the invisible sprite is drawn. */
function hollow(p, key) {
  const o = makePix(p.w, p.h);
  const k = key.charCodeAt(0);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (!p.d[y * p.w + x]) continue;
    if (!getPx(p, x - 1, y) || !getPx(p, x + 1, y) || !getPx(p, x, y - 1) || !getPx(p, x, y + 1)) o.d[y * p.w + x] = k;
  }
  return o;
}

// -------------------------------------------------------------------------------------- heads
// Only the heads are hand-pixelled: they carry every species' identity, and a cone, a horned skull
// and a split collar are shapes no shading formula gets right.

// ============================================================================ MAGE
// The brim is drawn wider than the shoulders on purpose; the face is left in its shadow so the two
// eye-glints are the only light up there, and the beard falls from the shadow to the belt.
const MAGE_HEAD_S = paint(`
...............76.........
..............7665........
.............766554.......
............7665544.......
...........76655544.......
..........766555444.......
.........7665555444.......
........gggffffeeee.......
.......ggggfffffeeee......
...7776665555554444444....
..66555554444444444444....
..4444...EEEEEEEE.4444....
.........EYYEEYYE.........
.........E111111E.........
........ggfffffeee........
........ggffeeffee........
........ggfffeffee........
.........gffeeffe.........
.........gfffffee.........
..........gffffe..........
..........gfffee..........
...........gffe...........
...........gffe...........
............ge............`);
const MAGE_HEAD_E = paint(`
................76........
...............7665.......
..............766554......
.............7665544......
............76655444......
...........766555444......
..........7665554444......
.........gggffffeeee......
........ggggfffffeeee.....
....7776665555554444444...
...66555554444444444444...
...4444...EEEEEEEE.4444...
..........EEEEEYY22.......
..........E11222112.......
.........ggfffffeeee......
.........ggffeeffeeee.....
..........gffffeeffee.....
..........gfffeeffee......
...........gffeeffe.......
...........gffeffe........
............gffee.........
............gffe..........
.............gfe..........
.............ge...........`);
const MAGE_HEAD_N = paint(`
...............76.........
..............7665........
.............766554.......
............7665544.......
...........76655544.......
..........766555444.......
.........7665555444.......
........gggffffeeee.......
.......ggggfffffeeee......
...7776665555554444444....
..66555554444444444444....
..4444...44444444.4444....
.........54444444.........
.........55444444.........
........ggfffffeee........
........gffffeeeee........
........gffffeeeee........
.........gffffeee.........
.........gfffeeee.........
..........gffeee..........
..........gffeee..........
...........gfee...........
..........................
..........................`);

// ============================================================================ WARLOCK
// Nothing above the head but two backswept bone horns; the face is a gaunt skull with sunk eyes
// and a set of bared teeth. He is the only caster you see the jaw of.
const WAR_HEAD_S = paint(`
.g..................g.
.gf................fe.
..gf..............fe..
...gf............fe...
....ge.33222211.ef....
......3332222111......
......3322222111......
......3EYY22YYE1......
......3222222111......
.......32211111.......
.......3gg11gg1.......
........321111........
.........3211.........
..........21..........`);
const WAR_HEAD_E = paint(`
g..g..................
gf.gf.................
.gf.gf................
..fe.fe...............
...fe.fe.33222211.....
......ee3322222111....
.......332222221112...
.......332EYY22112....
.......33222211122....
........3222111112....
........322gg1111.....
.........32111111.....
.........3211111......
..........321111......`);
const WAR_HEAD_N = paint(`
.g..................g.
.gf................fe.
..gf..............fe..
...gf............fe...
....ge.22221111.ef....
......2222111111......
......2221111111......
......2211111111......
......2111111111......
.......21111111.......
.......21111111.......
........211111........
.........2111.........
..........21..........`);

// ============================================================================ WIZARD / ILLUSIONIST
// The collar is split into two horns of stiff cloth that rise past the top of the hood; the face
// inside is pure shadow apart from two cold glints and the rune burning on the brow.
const WIZ_HEAD_S = paint(`
.cb................bc...
.cba..............abc...
.cba..............abc...
..cba............abc....
..cba...66655544...abc..
...cba.6665555444.abc...
...cba.6665554444.abc...
....cba666pp4444.abc....
....cba.gEggEgg4.abc....
.....cbaffffff.abc......
......cba.ff.abc........
.....76665555554444.....
.....66655554444444.....
......665555444444......
.......6655554444.......
........66554444........`);
const WIZ_HEAD_E = paint(`
..cb...bc...............
..cba.abc...............
...cbaabc...............
...cbaabc...............
....cbabc.6665554.......
.....cbc.66655544.......
......cc.66655444.......
.......c.666pp444.......
.........ggEgggg42......
.........fffffff42......
..........ffffff2.......
.....7665555544444......
.....665555444444.......
......6555544444........
.......65554444.........
........655444..........`);
const WIZ_HEAD_N = paint(`
.cb................bc...
.cba..............abc...
.cba..............abc...
..cba............abc....
..cba...66655544...abc..
...cba.6665555444.abc...
...cba.6665554444.abc...
....cba666554444.abc....
....cba.44444444.abc....
.....cba444444.abc......
......cba.44.abc........
.....76665555554444.....
.....66655554444444.....
......665555444444......
.......6655554444.......
........66554444........`);

/** The warlock's spiked pauldron (screen-left; the other shoulder is the mirror of it). */
const PAULDRON = paint(`
d.........
cd........
bcd..d....
abcd.cd...
.abcdbcd..
.aabccccd.
..aabccccd
...aabbccc
....aabbbc`);

// ------------------------------------------------------------------------------------ rig
/** Shoulder and resting-hand points per facing, on the 40x44 canvas. */
const RIG = {
  S: { shL: [16, 20], shR: [24, 20], handL: [13, 29], handR: [27, 29] },
  E: { shL: [19, 20], shR: [22, 21], handL: [17, 29], handR: [26, 29] },
  N: { shL: [24, 20], shR: [16, 20], handL: [27, 29], handR: [13, 29] },
};
/** Where the hands go for each beat of a cast: coil back, thrust, open wide, recover. */
const CAST = {
  S: { back: [[17, 28], [23, 28]], fwd: [[17, 25], [23, 25]], wide: [[14, 24], [26, 24]], orb: [20, 25], dir: [0, 1] },
  E: { back: [[20, 28], [18, 29]], fwd: [[27, 25], [23, 27]], wide: [[30, 24], [24, 27]], orb: [30, 24], dir: [1, 0] },
  N: { back: [[23, 28], [17, 28]], fwd: [[23, 25], [17, 25]], wide: [[26, 24], [14, 24]], orb: [20, 25], dir: [0, -1] },
};

// ------------------------------------------------------------------------------------ composer
/**
 * One composed frame of a robed caster.
 * @param {object} S species spec
 * @param {'S'|'E'|'N'} f
 * @param {{dy?:number, lean?:number, sway?:number, hdx?:number, hdy?:number, hands?:number[][],
 *   robe?:object, behind?:Array, extra?:Array}} o
 */
function frame(S, f, o = {}) {
  const dy = o.dy || 0, lean = o.lean || 0;
  const layers = [];
  for (const b of o.behind || []) layers.push(b);
  layers.push(L(robePix({
    ...S.robe, ...(o.robe || {}),
    top: (o.robe && o.robe.top !== undefined ? o.robe.top : S.robe.top) + dy,
    sway: o.sway || 0, lean, ragged: S.ragged, split: S.split, keys: S.cloth,
  })));
  layers.push(L(torsoPix({ ...S.torso[f], top: S.torso[f].top + dy, cx: PIVOT_X + lean, keys: S.cloth, belt: S.torso[f].belt + dy })));
  if (S.shoulders) for (const sh of S.shoulders(f, dy, lean)) layers.push(sh);
  const hd = S.headAt[f];
  const headLayer = L(S.head[f], hd[0] + lean + (o.hdx || 0), hd[1] + dy + (o.hdy || 0));
  if (f === 'N') { for (const a of o.arms || []) layers.push(a); layers.push(headLayer); }
  else { layers.push(headLayer); for (const a of o.arms || []) layers.push(a); }
  for (const e of o.extra || []) layers.push(e);
  return ink(layers);
}

/** Both sleeves for a pose; `hands` is [[screen-left hand], [screen-right hand]]. */
function arms(S, f, hands, dy = 0, lean = 0) {
  const R = RIG[f];
  const k = { keys: S.cloth, w0: S.sleeveW ?? 1.9, w1: 0.9, hand: S.hand || '2', handLit: S.handLit || '3', cuff: S.cuff || null };
  const out = [];
  const order = f === 'N' ? [1, 0] : [0, 1];       // the far arm first
  const sh = [R.shL, R.shR];
  for (const i of order) {
    const h = hands[i];
    if (!h) continue;
    out.push(L(sleevePix(sh[i][0] + lean, sh[i][1] + dy, h[0] + lean, h[1] + dy, k)));
  }
  return out;
}

// ------------------------------------------------------------------------------------ clips
function idleClip(S, f) {
  const mk = (i) => {
    const dy = [0, 1, 1, 0][i], sway = [0, 0.8, 0.2, -0.7][i];
    const R = RIG[f];
    const hands = [[R.handL[0], R.handL[1] + (i === 1 ? 1 : 0)], [R.handR[0], R.handR[1] + (i === 2 ? 1 : 0)]];
    const o = { dy, sway, hdy: i === 1 ? 1 : 0 };
    S.pose(S, f, 'idle', i, o, hands);
    return frame(S, f, { ...o, arms: arms(S, f, hands, dy), behind: o.behind, extra: o.extra });
  };
  return { frames: [mk(0), mk(1), mk(2), mk(3)], durations: [360, 300, 320, 300], loop: true };
}

function walkClip(S, f) {
  // a robed figure glides: the hem swings, the body bobs, the shoulders counter-rotate
  const SW = [1.9, 2.6, 1.2, -1.9, -2.6, -1.2];
  const DY = [0, 1, 1, 0, 1, 1];
  const LN = f === 'E' ? [1, 1, 0, 1, 1, 0] : [0, 0, 0, 0, 0, 0];
  const frames = SW.map((sway, i) => {
    const dy = DY[i], lean = LN[i];
    const R = RIG[f];
    const s = i < 3 ? 1 : -1;
    const hands = [[R.handL[0] + s, R.handL[1] + dy], [R.handR[0] - s, R.handR[1] - dy]];
    const o = { dy, sway, lean, hdx: Math.round(sway * 0.2), robe: { flare: 1 } };
    S.pose(S, f, 'walk', i, o, hands);
    return frame(S, f, { ...o, arms: arms(S, f, hands, dy, lean), behind: o.behind, extra: o.extra });
  });
  return { frames, durations: [110, 110, 110, 110, 110, 110], loop: true };
}

/** The cast: coil, thrust with the orb flaring between the hands, the bolt leaves, recover. */
function attackClip(S, f) {
  const C = CAST[f];
  const beats = [
    { hands: C.back.map((h) => h.slice()), dy: 1, sway: -1.2, orbR: 1.6, i: 0 },
    { hands: C.fwd.map((h) => h.slice()), dy: -1, sway: 1.4, orbR: 3.4, i: 1 },
    { hands: C.wide.map((h) => h.slice()), dy: 0, sway: 2.0, orbR: 1.2, i: 2 },
    { hands: [[RIG[f].handL[0], RIG[f].handL[1]], [RIG[f].handR[0], RIG[f].handR[1]]], dy: 0, sway: 0.4, orbR: 0, i: 3 },
  ];
  const frames = beats.map((b) => {
    const o = { dy: b.dy, sway: b.sway, orbR: b.orbR, cast: C, hdy: b.i === 1 ? -1 : 0 };
    S.pose(S, f, 'attack', b.i, o, b.hands);
    return frame(S, f, { ...o, arms: arms(S, f, b.hands, b.dy), behind: o.behind, extra: o.extra });
  });
  return { frames, durations: [150, 130, 110, 190], loop: false };
}

function hurtClip(S, f) {
  const lean = f === 'E' ? -2 : 0;
  const R = RIG[f];
  const hands = [[R.handL[0] - 1, R.handL[1] - 1], [R.handR[0] + 1, R.handR[1] - 1]];
  const o = { dy: 1, lean, sway: -1.6, hdx: lean, hdy: 1 };
  S.pose(S, f, 'hurt', 0, o, hands);
  const recoil = frame(S, f, { ...o, arms: arms(S, f, hands, 1, lean), behind: o.behind, extra: o.extra });
  return { frames: [solid(recoil, 'F'), recoil], durations: [70, 170], loop: false };
}

/**
 * A caster does not topple, he goes out: the robe folds in on itself as the magic escapes, and
 * what settles is an empty heap of cloth with the last motes drifting off it. Drawn facing the
 * camera, like the hero's death.
 */
function deathClip(S) {
  const f = 'S';
  const beats = [
    { dy: 1, hd: 0, top: 26, botW: 19, hands: [[13, 28], [27, 28]], motes: 5, spread: 3 },
    { dy: 4, hd: 1, top: 29, botW: 21, hands: [[12, 31], [28, 31]], motes: 7, spread: 6 },
    { dy: 8, hd: 2, top: 33, botW: 23, hands: [[12, 35], [28, 35]], motes: 8, spread: 9 },
    { dy: 12, hd: 4, top: 36, botW: 25, hands: null, motes: 6, spread: 13 },
    { dy: 14, hd: 4, top: 38, botW: 26, hands: null, motes: 3, spread: 16 },
  ];
  const frames = beats.map((b, i) => {
    const motes = [];
    for (let k = 0; k < b.motes; k++) {
      const th = k * 2.399 + i;
      motes.push([PIVOT_X + Math.cos(th) * b.spread, 26 - b.spread * 0.7 + Math.sin(th) * b.spread * 0.6, k % 3 === 0 ? 'p' : 'o']);
    }
    const o = {
      dy: b.dy, hdy: b.hd, hdx: -1,
      robe: { top: 25, bot: 40, botW: b.botW, topW: 13 + i },
      extra: [L(motePix(motes))],
    };
    S.pose(S, f, 'death', i, o, b.hands || [null, null]);
    return frame(S, f, { ...o, arms: b.hands ? arms(S, f, b.hands, b.dy) : [], behind: o.behind, extra: o.extra });
  });
  return { frames, durations: [140, 170, 200, 620, 700], loop: false };
}

/** Build every clip of one robed species: name -> facing -> clip. West is mirrored by the billboard. */
function buildCaster(S) {
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
  return {
    anims, palette: S.palette, w: MON_W, h: MON_H, pivot: { x: PIVOT_X, y: PIVOT_Y },
    emissive: 'YopGu', scale: S.scale || 1,
  };
}

// ============================================================================ species: MAGE
const MAGE = {
  scale: 1.06,
  cloth: '4567',
  palette: casterPalette({
    skin: '#c99a72', cloth: '#33469b', trim: '#7d5a2c', metal: '#9aa2ad',
    accent: '#d8d3c6', magic: '#57c8ff', eye: '#bdefff', spark: '#f2fbff',
  }),
  head: { S: MAGE_HEAD_S, E: MAGE_HEAD_E, N: MAGE_HEAD_N },
  headAt: { S: [7, 0], E: [7, 0], N: [7, 0] },
  torso: {
    S: { top: 17, prof: [4, 6, 7, 7, 7, 6, 6, 6, 6, 6.5, 7], belt: 25 },
    E: { top: 17, prof: [3.5, 5, 5.5, 5.5, 5.5, 5, 5, 5, 5, 5.5, 6], belt: 25 },
    N: { top: 17, prof: [4, 6, 7, 7, 7, 6, 6, 6, 6, 6.5, 7], belt: 25 },
  },
  robe: { top: 26, bot: 40, topW: 14, botW: 20, folds: [-0.38, 0.26] },
  sleeveW: 2.0,
  hand: '2', handLit: '3',
  /** The staff stands beside him; the free hand does the casting. */
  pose(S, f, clip, i, o, hands) {
    const side = f === 'N' ? -1 : 1;                 // seen from behind he holds it on the other side
    const gx = PIVOT_X + side * 8 + (o.lean || 0);
    const gy = 29 + (o.dy || 0);
    const raised = clip === 'attack' && i >= 1;
    const st = staffPix(gx, gy - (raised ? 2 : 0), side * 5, {
      up: 20, down: 11, orb: 3.0, glow: raised ? 1 : 0,
    });
    // the staff hand grips it; the free hand is the one the clips animate
    const hi = side > 0 ? 1 : 0;
    hands[hi] = [gx - 1, gy - (raised ? 2 : 0)];
    o.behind = [L(st)];
    if (clip === 'attack' && i === 2) {
      const C = CAST[f];
      o.extra = [L(boltPix(C.orb[0] + C.dir[0] * 9, C.orb[1] + C.dir[1] * 9, C.dir[0], C.dir[1], 9))];
    } else if (clip === 'attack' && i === 1) {
      const C = CAST[f];
      o.extra = [L(orbPix(C.orb[0], C.orb[1], o.orbR || 2))];
    }
  },
};

// ============================================================================ species: WARLOCK
const WARLOCK = {
  scale: 1.04,
  cloth: '4567',
  ragged: true,
  split: 0.13,
  palette: casterPalette({
    skin: '#9d8f9c', cloth: '#4c2a63', trim: '#3a2136', metal: '#8b7f96',
    accent: '#cfc3a6', magic: '#b98cff', eye: '#ff7a3c', spark: '#f0dcff',
    voidCol: '#150b26', clothStep: 0.09,
  }),
  head: { S: WAR_HEAD_S, E: WAR_HEAD_E, N: WAR_HEAD_N },
  headAt: { S: [9, 4], E: [9, 4], N: [9, 4] },
  torso: {
    S: { top: 18, prof: [5, 7, 7.5, 7.5, 7, 6.5, 6, 6, 6, 6.5, 7], belt: 26 },
    E: { top: 18, prof: [4, 5.5, 6, 6, 5.5, 5, 5, 5, 5, 5.5, 6], belt: 26 },
    N: { top: 18, prof: [5, 7, 7.5, 7.5, 7, 6.5, 6, 6, 6, 6.5, 7], belt: 26 },
  },
  robe: { top: 27, bot: 40, topW: 14, botW: 21, folds: [-0.42, 0.3] },
  sleeveW: 1.5, hand: '2', handLit: '3',
  /** Spiked pauldrons: the widest point of any caster, and the reason he needs no hat. */
  shoulders(f, dy, lean) {
    const y = 17 + dy;
    if (f === 'E') return [L(PAULDRON, 10 + lean, y), { p: PAULDRON, x: 21 + lean, y: y + 1, mirror: true }];
    return [L(PAULDRON, 9 + lean, y), { p: PAULDRON, x: 21 + lean, y, mirror: true }];
  },
  pose(S, f, clip, i, o) {
    const C = CAST[f];
    const dy = o.dy || 0;
    if (clip === 'attack') {
      if (i === 0) o.extra = [L(orbPix(C.orb[0], C.orb[1] + 2 + dy, 1.6, { dark: true }))];
      else if (i === 1) o.extra = [L(orbPix(C.orb[0], C.orb[1] + dy, o.orbR || 3.4, { dark: true }))];
      else if (i === 2) o.extra = [L(boltPix(C.orb[0] + C.dir[0] * 10, C.orb[1] + C.dir[1] * 10 + dy, C.dir[0], C.dir[1], 10))];
      return;
    }
    if (clip === 'idle') {
      // a coal of dark magic idles in the off hand and breathes
      const r = [1.3, 1.8, 2.1, 1.5][i];
      const hx = f === 'N' ? 12 : 27;
      o.extra = [L(orbPix(hx + (f === 'E' ? -1 : 0), 30 + dy, r, { dark: true }))];
    }
  },
};

// ============================================================================ species: WIZARD
const WIZARD = {
  scale: 1.08,
  cloth: '4567',
  palette: casterPalette({
    skin: '#b9906f', cloth: '#a8434c', trim: '#8a6a2e', metal: '#c9a03c',
    accent: '#e8e2d2', magic: '#8b7bff', eye: '#d6e7ff', spark: '#efe8ff',
    voidCol: '#6f63b8',
  }),
  head: { S: WIZ_HEAD_S, E: WIZ_HEAD_E, N: WIZ_HEAD_N },
  headAt: { S: [8, 2], E: [8, 2], N: [8, 2] },
  torso: {
    S: { top: 18, prof: [5, 6.5, 7.5, 7.5, 7, 6.5, 6, 6, 6, 6.5, 7], belt: 26 },
    E: { top: 18, prof: [4, 5.5, 6, 6, 5.5, 5, 5, 5, 5, 5.5, 6], belt: 26 },
    N: { top: 18, prof: [5, 6.5, 7.5, 7.5, 7, 6.5, 6, 6, 6, 6.5, 7], belt: 26 },
  },
  robe: { top: 27, bot: 40, topW: 14, botW: 21, folds: [-0.34, 0.2] },
  sleeveW: 2.2, hand: '2', handLit: '3',
  /** Two mirror doubles stand a step either side of him, drawn as rims of his own silhouette. */
  pose(S, f, clip, i, o, hands) {
    const dy = o.dy || 0;
    const R = RIG[f];
    if (clip === 'idle' || clip === 'walk') {
      // arms held out from the body, palms turned up: the illusionist never lets them hang
      const out = f === 'E' ? 1 : 2;
      hands[0] = [R.handL[0] - out, R.handL[1] - 3 + (i % 2)];
      hands[1] = [R.handR[0] + out, R.handR[1] - 3 + ((i + 1) % 2)];
    }
    const hoopAt = f === 'N' ? [13, 25] : f === 'E' ? [30, 25] : [27, 25];
    o.extra = [L(hoopPix(hoopAt[0], hoopAt[1] + dy, 6, 2.6, i))];
    if (clip === 'attack') {
      const C = CAST[f];
      if (i === 1) o.extra.push(L(orbPix(C.orb[0], C.orb[1] + dy, o.orbR || 3.4)));
      if (i === 2) o.extra.push(L(boltPix(C.orb[0] + C.dir[0] * 10, C.orb[1] + C.dir[1] * 10 + dy, C.dir[0], C.dir[1], 10)));
    }
    // the doubles: the same body, hollowed to a magic-toned rim, stepping out either side. They
    // only exist during the cast — a permanent pair of them muddies his silhouette, and an
    // illusion that is always on is not an illusion.
    const ghost = S.ghost && S.ghost[f];
    if (ghost && clip === 'attack') {
      const off = [3, 8, 11, 6][i];
      o.behind = [
        { p: ghost, x: -off, y: dy + 2 },
        { p: ghost, x: off, y: dy + 2, mirror: true },
      ];
    }
  },
};

// The wizard's doubles are his own silhouette, so they are built from a plain frame of him once the
// spec exists (a second pass: `pose` reads S.ghost, which is filled in here before any clip runs).
function makeGhosts(S) {
  S.ghost = null;
  const g = {};
  for (const f of ['S', 'E', 'N']) {
    const body = frame(S, f, { arms: arms(S, f, [RIG[f].handL, RIG[f].handR]) });
    g[f] = hollow(solid(body, 'v'), 'v');
  }
  S.ghost = g;
  return S;
}

// ============================================================================ species: SPRITE
// The one that is not there. Its body is drawn solid and then thrown away: only the rim survives,
// in the cool shimmer ramp, so what you see is the air bending around a pixie. Four dragonfly
// wings beat around it and a wake of motes trails behind — the wings and the wake are what makes
// it findable at all, which is exactly its role in play.
const SPR_W = 26, SPR_H = 30, SPR_PIVOT = { x: 13, y: 27 };
const SPRITE_PALETTE = casterPalette({
  skin: '#bfe6ff', cloth: '#7fc9ff', trim: '#4f7fa8', metal: '#9fc4d8',
  accent: '#d8f2ff', magic: '#8be8ff', eye: '#c9ff7a', spark: '#ffffff',
  shimmer: '#a8e4ff', voidCol: '#26394f',
});

/** The pixie's body, solid — never drawn, only hollowed. */
const SPR_BODY = paint(`
......xxxx......
.....xxxxxx.....
.....xxxxxx.....
......xxxx......
.......xx.......
.....xxxxxx.....
....xxxxxxxx....
....xxxxxxxx....
.....xxxxxx.....
.....xxxxxx.....
......xxxx......
......xxxx......
.....xx..xx.....
.....xx..xx.....
.....xx..xx.....
....xx....xx....
....x......x....`);

/** One dragonfly wing as a hollow leaf: two rim curves plus a single vein. */
function wingPix(p, ox, oy, len, angDeg, curl, rim = 'u', vein = 's') {
  const a = (angDeg * Math.PI) / 180;
  const R = Math.round;
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    const th = a + curl * Math.sin(t * Math.PI) * 0.5;
    const cx = ox + Math.cos(th) * len * t, cy = oy + Math.sin(th) * len * t;
    const w = len * 0.30 * Math.sin(Math.PI * Math.pow(t, 0.72));
    const nx = -Math.sin(th), ny = Math.cos(th);
    setPx(p, R(cx + nx * w), R(cy + ny * w), rim);
    setPx(p, R(cx - nx * w), R(cy - ny * w), rim);
    if (i % 6 === 0) setPx(p, R(cx), R(cy), vein);
  }
  setPx(p, R(ox + Math.cos(a) * len), R(oy + Math.sin(a) * len), 'p');
  return p;
}

/**
 * One frame of the sprite. `flap` 0..1 opens the wings, `bob` lifts the body, `fade` thins the
 * shimmer to the darkest tone (the death dissolve), `motes` is the sparkle wake.
 */
function spriteFrame({ flap = 0.5, bob = 0, fade = 0, motes = [], eyes = true, facing = 'S', bolt = null } = {}) {
  const body = makePix(SPR_W, SPR_H);
  const rimKey = fade > 1 ? 's' : fade > 0 ? 't' : 'u';
  const solidBody = compose(SPR_W, SPR_H, [L(SPR_BODY, 5, 6 + bob)]);
  const rim = hollow(solidBody, rimKey);
  const glass = fade > 0 ? null : solid(solidBody, 'v');
  // wings: the upper pair sweeps high on the down-beat, the lower pair lags behind it
  const up = -(14 + flap * 62), lo = 16 + flap * 40;
  for (const s of [-1, 1]) {
    const sx = 13 + s * 3, sy = 12 + bob;
    wingPix(body, sx, sy, 9.5, s > 0 ? up : 180 - up, s * 0.7, rimKey, fade ? 's' : 't');
    wingPix(body, sx, sy + 4, 6.5, s > 0 ? lo : 180 - lo, s * 0.5, fade ? 's' : 't', 's');
  }
  const layers = [L(body), L(glass), L(rim)];
  if (eyes) {
    const eye = makePix(SPR_W, SPR_H);
    const ex = facing === 'E' ? 1 : 0;
    setPx(eye, 11 + ex, 8 + bob, 'Y'); setPx(eye, 14 + ex, 8 + bob, 'Y');
    if (facing !== 'N') { setPx(eye, 11 + ex, 9 + bob, 'p'); setPx(eye, 14 + ex, 9 + bob, 'p'); }
    layers.push(L(eye));
  }
  if (motes.length) {
    const m = makePix(SPR_W, SPR_H);
    for (const [x, y, k] of motes) setPx(m, Math.round(x), Math.round(y), k);
    layers.push(L(m));
  }
  if (bolt) {
    const b = makePix(SPR_W, SPR_H);
    for (let i = 0; i < 8; i++) setPx(b, Math.round(bolt[0] + bolt[2] * i), Math.round(bolt[1] + bolt[3] * i), i < 2 ? 'p' : i < 5 ? 'o' : 'n');
    layers.push(L(b));
  }
  // the shimmer keeps its outline only where the light does NOT fall, so the top-left edges stay
  // open and glassy: that gap is what makes it read as invisible rather than as a pale statue
  return outline(compose(SPR_W, SPR_H, layers.filter(Boolean)), '#', { lit: LIT, litKey: null });
}

/** A deterministic sparkle wake behind the sprite. */
function spriteWake(n, phase, spread = 5, cx = 13, cy = 20) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const th = k * 2.399 + phase * 0.7;
    out.push([cx + Math.cos(th) * spread, cy + Math.sin(th) * spread * 0.8, k % 3 === 0 ? 'p' : 'o']);
  }
  return out;
}

function buildSprite() {
  const clip = (frames, durations, loop) => ({ frames, durations, loop });
  const anims = {};
  const put = (name, f, c) => { (anims[name] ||= {})[f] = { name, facing: f, ...c }; };
  for (const f of ['S', 'E', 'N']) {
    put('idle', f, clip(
      [0, 1, 2, 3].map((i) => spriteFrame({ flap: [0.15, 0.8, 0.45, 0.95][i], bob: [0, -1, 0, -1][i], facing: f, motes: spriteWake(3, i, 6) })),
      [120, 110, 120, 110], true,
    ));
    put('walk', f, clip(
      [0, 1, 2, 3, 4, 5].map((i) => spriteFrame({ flap: [0.05, 0.55, 1, 0.6, 0.15, 0.75][i], bob: [0, -1, -2, -1, 0, -1][i], facing: f, motes: spriteWake(5, i, 7) })),
      [80, 80, 80, 80, 80, 80], true,
    ));
    const dir = f === 'E' ? [1, 0] : f === 'N' ? [0, -1] : [0, 1];
    put('attack', f, clip([
      spriteFrame({ flap: 0.1, bob: 1, facing: f, motes: spriteWake(4, 0, 3) }),
      spriteFrame({ flap: 1, bob: -3, facing: f, motes: spriteWake(8, 1, 4) }),
      spriteFrame({ flap: 0.7, bob: -2, facing: f, motes: spriteWake(6, 2, 8), bolt: [13 + dir[0] * 5, 16 + dir[1] * 5, dir[0], dir[1]] }),
      spriteFrame({ flap: 0.35, bob: 0, facing: f, motes: spriteWake(3, 3, 6) }),
    ], [130, 110, 100, 180], false));
    const recoil = spriteFrame({ flap: 0.9, bob: 2, facing: f, motes: spriteWake(6, 2, 8) });
    put('hurt', f, clip([solid(recoil, 'F'), recoil], [70, 170], false));
  }
  // death: the shimmer comes apart — the wings stall, the rim dims, and only motes are left
  const death = clip([
    spriteFrame({ flap: 0.9, bob: 2, fade: 0, motes: spriteWake(7, 0, 7) }),
    spriteFrame({ flap: 0.3, bob: 4, fade: 1, motes: spriteWake(9, 1, 9) }),
    spriteFrame({ flap: 0.05, bob: 6, fade: 2, eyes: false, motes: spriteWake(10, 2, 11) }),
    (() => { const p = makePix(SPR_W, SPR_H); for (const [x, y, k] of spriteWake(8, 3, 9, 13, 22)) setPx(p, Math.round(x), Math.round(y), k); return p; })(),
    (() => { const p = makePix(SPR_W, SPR_H); for (const [x, y, k] of spriteWake(4, 4, 6, 13, 24)) setPx(p, Math.round(x), Math.round(y), k); return p; })(),
  ], [130, 150, 200, 520, 640], false);
  for (const f of ['S', 'E', 'N']) put('death', f, death);
  return {
    anims, palette: SPRITE_PALETTE, w: SPR_W, h: SPR_H, pivot: SPR_PIVOT,
    emissive: 'YopGu', scale: 0.82,
  };
}

// ------------------------------------------------------------------------------------ registry
const cache = new Map();
const build = (key, make) => () => {
  let b = cache.get(key);
  if (!b) { b = make(); cache.set(key, b); }
  return b;
};

/**
 * The spellcaster / trickster group: monster type -> builder. `mage` and `warlock` are the two
 * types the game actually rolls (game/monsters.js); `sprite` and `wizard` are registered under
 * their aliases so any bestiary that names them picks up the sprite instead of a mesh.
 * @type {Object<string, () => {anims:object, palette:import('../pixelPainter.js').Palette, w:number, h:number, pivot:{x:number,y:number}, emissive:string, scale:number}>}
 */
export const CASTER_SPRITES = {
  'mage': build('mage', () => buildCaster(MAGE)),
  'warlock': build('warlock', () => buildCaster(WARLOCK)),
  'sprite': build('sprite', buildSprite),
  'dungeon-sprite': build('sprite', buildSprite),
  'pixie': build('sprite', buildSprite),
  'wizard': build('wizard', () => buildCaster(makeGhosts(WIZARD))),
  'illusionist': build('wizard', () => buildCaster(makeGhosts(WIZARD))),
};

export { buildCaster, robePix, torsoPix, sleevePix, orbPix, staffPix, hoopPix, hollow, MAGE, WARLOCK, WIZARD };

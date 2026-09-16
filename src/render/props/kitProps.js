// kitProps: the dungeon's furniture and clutter, cut from the solid kit (render/props/kit.js).
//
// Every piece here replaces a painted billboard (furniture.js) or an imported model (models.js) that
// was measured at the play camera and read as a flat sticker: no lit top, no dark side, no contact.
// The painted pieces stay in furniture.js as the fallback and as the art the tests and the plates
// read; `buildKitProp` is simply asked first.
//
// SCALE (the reviewer's DP4, measured against the target frames, in tiles): chest ~0.8-1, barrel
// ~0.55, crate ~0.65, skull ~0.3, sarcophagus fills its tile and, sheared, stands 1.4 tiles tall on
// screen. Nothing reaches past 0.96 of its own tile in footprint (AMBIENCE §1: the wall is behind it),
// and a long table is the generator's `tableLong` run, never one piece overhanging its neighbours.
//
// Local frame for every builder: x east, y up, z south, origin at the tile centre on the floor, the
// piece's FRONT facing +z. `buildKitProp` turns it to `facing` and shears it once.
import * as THREE from 'three';
import { createRng } from '../../core/rng.js';
import { KitBuilder, MAT as M, kitMaterials } from './kit.js';
import { flame, groundGlow, getFog } from '../propFx.js';
import { patchFog } from '../lighting.js';
import { contactShadow, pixelSnap } from '../props.js';

const T32 = 1 / 32;
/** decor `facing` -> yaw that turns local +z (the front) to look that way. */
const YAW = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };
const rotX = (a) => new THREE.Matrix4().makeRotationX(a);
const rotY = (a) => new THREE.Matrix4().makeRotationY(a);
const rotZ = (a) => new THREE.Matrix4().makeRotationZ(a);
const at = (m, x, y, z) => m.setPosition(x, y, z);

// tints (vertex-colour multipliers on a material cell)
const RED = [1.35, 0.62, 0.58], GREEN = [0.72, 1.18, 0.7], BLUE = [0.62, 0.78, 1.35], TAN = [1.1, 1.0, 0.82];
const PURPLE = [1.05, 0.66, 1.25], TEAL = [0.62, 1.15, 1.1];
/** A warm-grey tint for the neutral block cell, `t` times as bright: carved tomb stone at the wall's grey. */
const stone = (t) => [1.12 * t, 1.07 * t, 0.96 * t];
/**
 * BONE CREAM ON A NEUTRAL CELL (reviewer round 2, P8: "mustard ghost masks"). The bone cell is itself a
 * warm cream, and a warm torch on a warm albedo went straight to ochre in 'default' — cooling its tint
 * a few per cent did not move it (round 3 check). Skulls and bones are now cut from the flat neutral
 * `plain` cell, so this tint IS their colour: a pale cream at low chroma that a torch warms, not paints.
 */
const BONE = [0.88, 0.87, 0.86];   // near-neutral: a warm torch adds the warmth, so the albedo must not

// ------------------------------------------------------------------------------ small things
/** A table-top clutter kit, all sitting on a surface at height `y`. */
const clutter = {
  mug(k, x, z, y, tint = 1, s = 1) {
    k.lathe(x, z, [[0.05 * s, y], [0.055 * s, y + 0.09 * s]], { mat: M.dark, seg: 7, capTop: M.void, tint: tint * 1.1 });
    k.lathe(x, z, [[0.058 * s, y + 0.066 * s], [0.058 * s, y + 0.085 * s]], { mat: M.iron, seg: 7, tint: 1.3, ao: false });
    k.cbox(x + 0.07 * s, z, 0.03 * s, 0.035 * s, y + 0.02 * s, y + 0.075 * s, { mat: M.dark, tint });
  },
  plate(k, x, z, y, food = true) {
    k.lathe(x, z, [[0.06, y], [0.08, y + 0.016]], { mat: M.slate, seg: 9, capTop: M.bone, tint: 1.15 });
    if (food) k.blob(x - 0.01, y + 0.03, z, 0.045, 0.025, 0.035, { mat: M.straw, detail: 0, lump: 0.1, under: 0.6 });
  },
  candle(k, x, z, y, h = 0.1, flames, fs = 0.1) {
    k.lathe(x, z, [[0.055, y], [0.06, y + 0.02]], { mat: M.gold, seg: 7, capTop: true, tint: 0.9 });
    k.lathe(x, z, [[0.034, y + 0.02], [0.032, y + 0.02 + h]], { mat: M.bone, seg: 6, capTop: true, tint: 1.08 });
    if (flames) flames.push([x, y + 0.02 + h, z, fs]);
  },
  book(k, x, z, y, ry, tint, open = false) {
    k.with(at(rotY(ry), x, y, z), () => {
      if (open) {
        k.box(-0.11, 0, -0.07, 0.11, 0.018, 0.07, { mat: M.leather, tint });
        k.box(-0.1, 0.018, -0.062, -0.004, 0.034, 0.062, { mat: M.page, tint: 1 });
        k.box(0.004, 0.018, -0.062, 0.1, 0.034, 0.062, { mat: M.page, tint: 0.92 });
      } else {
        k.box(-0.08, 0, -0.06, 0.08, 0.045, 0.06, { mat: M.leather, tint, bevel: T32 });
        k.box(-0.074, 0.006, 0.06, 0.074, 0.038, 0.064, { mat: M.page, tint: 0.9 });
      }
    });
  },
  bottle(k, x, z, y, tint, h = 0.13) {
    k.lathe(x, z, [[0.035, y], [0.045, y + h * 0.45], [0.02, y + h * 0.7], [0.018, y + h]], { mat: M.glass, seg: 7, capTop: M.leather, tint });
  },
  coins(k, x, z, y, n = 3) {
    for (let i = 0; i < n; i++) k.lathe(x + (i % 2) * 0.012, z, [[0.035, y + i * 0.012], [0.035, y + (i + 1) * 0.012]], { mat: M.gold, seg: 8, capTop: M.coins, tint: 1.05 });
  },
  /**
   * A skull ~0.26 tiles across at s = 1 — the reviewer's 0.3-tile target, and no smaller: the first
   * cut was 0.15 and came back as a pale speck. The sockets and the nose are cut into the FRONT face,
   * which the shear stands up toward the camera, so the face reads from above.
   */
  skull(k, x, z, y, ry = 0, s = 1, o = {}) {
    // never more than a few degrees off the camera: turned further, a skull shows the side of its head,
    // which from above is a pale egg with its sockets on one rim ('default', 'temple', seed 42)
    ry = Math.max(-0.2, Math.min(0.2, ry));
    // BONE, NOT MUSTARD, AND A SKULL, NOT A HOOD (reviewer round 2, P8: "mustard ghost masks"). The bone
    // cell pushed 8% brighter went ochre under every torch; it is now cooled a touch below its own
    // value. The cranium was taller than it was wide over a narrow jaw, which from above is a hooded
    // head: now a low wide dome, a flat face plate with brow, sockets set into it, a nose and a jaw.
    const t = o.tint || [1, 1, 1];
    const B = [BONE[0] * t[0], BONE[1] * t[1], BONE[2] * t[2]], F = [B[0] * 0.88, B[1] * 0.88, B[2] * 0.88];
    const tilt = o.tilt || 0;
    k.with(at(rotY(ry).multiply(rotZ(tilt)), x, y, z), () => {
      k.blob(0, 0.085 * s, -0.015 * s, 0.135 * s, 0.09 * s, 0.13 * s, { mat: M.plain, detail: 1, lump: 0.03, under: 0.6, flat: 0, seed: 3, tint: B });
      k.box(-0.1 * s, 0.03 * s, 0.05 * s, 0.1 * s, 0.13 * s, 0.125 * s, { mat: M.plain, bevel: T32, tint: F });          // the face
      k.box(-0.105 * s, 0.105 * s, 0.1 * s, 0.105 * s, 0.135 * s, 0.13 * s, { mat: M.plain, tint: B });                   // the brow
      const sock = o.socket ?? 0.042;
      for (const sx of [-1, 1]) {
        const w = sx > 0 && o.broken ? sock * 0.7 : sock;
        k.box(sx * 0.052 * s - w * s / 2, 0.065 * s, 0.118 * s, sx * 0.052 * s + w * s / 2, 0.102 * s, 0.128 * s, { mat: M.void });
      }
      k.box(-0.012 * s, 0.045 * s, 0.12 * s, 0.012 * s, 0.062 * s, 0.128 * s, { mat: M.void });                          // the nose
      if (!o.noJaw) {
        k.box(-0.075 * s, 0, 0.04 * s, 0.075 * s, 0.035 * s, 0.12 * s, { mat: M.plain, bevel: T32, tint: F });             // the jaw
        k.box(-0.055 * s, 0.032 * s, 0.118 * s, 0.055 * s, 0.04 * s, 0.124 * s, { mat: M.void, tint: 1.4 });              // the teeth line
      }
    });
  },
  /** A long bone: a shaft two texels thick with knuckled ends (a one-texel bone is not on screen). */
  bone(k, x, z, y, ry, len = 0.22, tint = 1) {
    k.with(at(rotY(ry), x, y, z), () => {
      k.box(-len / 2, 0, -0.035, len / 2, 0.06, 0.035, { mat: M.plain, tint: [BONE[0] * tint, BONE[1] * tint, BONE[2] * tint], bevel: T32 });
      for (const e of [-1, 1]) for (const side of [-1, 1]) k.blob(e * len / 2, 0.035, side * 0.035, 0.045, 0.04, 0.042, { mat: M.plain, detail: 0, lump: 0.05, under: 0.6, flat: 0, tint: [BONE[0] * tint, BONE[1] * tint, BONE[2] * tint] });
    });
  },
};

/** A plank body with iron bands, a bevelled lid and a lock: the chest family. */
function chestBody(k, { w, h, d, lidH, wood, band = M.iron, lock = true, gold = false, open = false, straps = 2, tint = 1 }) {
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  k.box(x0, 0, z0, x1, h, z1, { mat: wood, bevel: T32, tint });
  // feet
  for (const sx of [-1, 1]) k.cbox(sx * (w / 2 - 0.05), z1 - 0.05, 0.08, 0.08, -0.001, 0.03, { mat: band, tint: 0.8 });
  const bandsX = straps === 2 ? [-w * 0.3, w * 0.3] : [-w * 0.34, 0, w * 0.34];
  const lidT = h + lidH;
  if (!open) {
    k.box(x0 - 0.012, h, z0 - 0.012, x1 + 0.012, lidT, z1 + 0.012, { mat: wood, bevel: 2 * T32, grain: 'x', tint: tint * 1.04 });
    for (const bx of bandsX) {
      k.box(bx - 0.03, h - 0.004, z0 - 0.02, bx + 0.03, lidT + 0.012, z1 + 0.02, { mat: band, bevel: T32 });
      k.box(bx - 0.03, 0.02, z1, bx + 0.03, h, z1 + 0.014, { mat: band });
    }
    k.box(x0 - 0.016, h - 0.03, z1 + 0.004, x1 + 0.016, h + 0.004, z1 + 0.02, { mat: band, tint: 0.9 });   // the lid's iron lip
    if (lock) {
      k.box(-0.055, h - 0.1, z1 + 0.012, 0.055, h + 0.02, z1 + 0.03, { mat: gold ? M.gold : band, tint: gold ? 1 : 1.25 });
      k.box(-0.012, h - 0.075, z1 + 0.03, 0.012, h - 0.035, z1 + 0.034, { mat: M.void });
    }
  } else {
    // thrown back: the lid leans off the back edge; the open box shows a rim of its own planks
    // round a dark inside (or a heap of coin), never a black square the size of the chest
    const rim = 0.06;
    k.box(x0 + rim, h - 0.05, z0 + rim, x1 - rim, h - 0.049, z1 - rim, { mat: gold ? M.coins : M.void, sides: { n: false, s: false, e: false, w: false } });
    if (gold) k.blob(0, h - 0.05, 0.02, w * 0.36, 0.09, d * 0.3, { mat: M.coins, detail: 1, lump: 0.08, under: 0.85, flat: h - 0.05, seed: 9 });
    else k.blob(-0.08, h - 0.05, 0.03, w * 0.22, 0.05, d * 0.2, { mat: M.linen, detail: 1, lump: 0.2, under: 0.7, flat: h - 0.05, seed: 4 });
    k.with(at(rotX(-1.15), 0, h, z0), () => {
      k.box(x0 - 0.012, 0, -0.02, x1 + 0.012, d + 0.02, lidH * 0.6, { mat: wood, tint: tint * 1.05, grain: 'x' });
      for (const bx of bandsX) k.box(bx - 0.03, -0.004, lidH * 0.6, bx + 0.03, d + 0.024, lidH * 0.6 + 0.012, { mat: band, tint: 1.1 });
    });
    for (const bx of bandsX) k.box(bx - 0.03, 0.02, z1, bx + 0.03, h, z1 + 0.014, { mat: band });
  }
}

// ------------------------------------------------------------------------------ the pieces
/** Each returns {foot:[w, d], flames?:[[x,y,z,size]], pool?:[colour, radius, opacity]}. */
const PIECES = {
  table(k, v) {
    const w = 0.92, d = 0.7, h = 0.44, t = 0.06, flames = [];
    const legs = [[-1, -1], [1, -1], [-1, 1], [1, 1]].filter(([sx, sz]) => !(v >= 3 && sx > 0 && sz > 0));
    const top = () => {
      k.box(-w / 2, h - t, -d / 2, w / 2, h, d / 2, { mat: M.oak, bevel: T32, grain: 'x' });
      k.box(-w / 2 + 0.05, h - t - 0.07, -d / 2 + 0.06, w / 2 - 0.05, h - t, d / 2 - 0.06, { mat: M.dark });
    };
    if (v >= 3) k.with(at(rotZ(-0.16), 0, 0, 0), top); else top();
    for (const [sx, sz] of legs) k.cbox(sx * (w / 2 - 0.09), sz * (d / 2 - 0.09), 0.08, 0.08, 0, h - t - 0.02, { mat: M.dark });
    k.cbox(0, 0, w - 0.2, 0.05, 0.1, 0.15, { mat: M.dark, tint: 0.85 });                      // stretcher
    if (v === 0) {
      clutter.plate(k, -0.2, 0.08, h); clutter.mug(k, 0.02, -0.1, h); clutter.mug(k, 0.3, 0.12, h, 0.9);
      clutter.candle(k, 0.28, -0.16, h, 0.1, flames); clutter.coins(k, -0.02, 0.18, h, 2);
    } else if (v === 1) {
      clutter.mug(k, -0.18, 0.02, h); clutter.book(k, 0.18, 0.02, h, 0.3, RED);
    } else if (v === 2) {
      clutter.mug(k, 0.1, -0.08, h, 0.8);
    }
    return { foot: [w, d], flames };
  },

  tableLong(k, v) {
    // a run segment: v0/v2 are the ends (legs), v1 the middle; the top runs edge to edge
    const d = 0.7, h = 0.44, t = 0.06, flames = [];
    k.box(-0.5, h - t, -d / 2, 0.5, h, d / 2, { mat: M.oak, grain: 'x', bevel: 0 });
    k.box(-0.5, h - t - 0.07, -d / 2 + 0.06, 0.5, h - t, d / 2 - 0.06, { mat: M.dark });
    if (v !== 1) for (const sz of [-1, 1]) k.cbox(v === 0 ? -0.36 : 0.36, sz * (d / 2 - 0.09), 0.08, 0.08, 0, h - t, { mat: M.dark });
    if (v === 1) { clutter.plate(k, -0.15, 0.06, h); clutter.mug(k, 0.2, -0.12, h); clutter.candle(k, 0.05, -0.14, h, 0.11, flames); }
    else clutter.mug(k, 0, 0.05, h, 0.9);
    return { foot: [1, d], flames };
  },

  bench(k, v) {
    const w = 0.86, d = 0.28, h = 0.27;
    const seat = () => k.box(-w / 2, h - 0.05, -d / 2, w / 2, h, d / 2, { mat: M.ash, bevel: T32, grain: 'x' });
    if (v >= 1) k.with(at(rotZ(0.12), 0, -0.02, 0), seat); else seat();
    for (const sx of [-1, 1]) if (!(v >= 1 && sx > 0)) k.cbox(sx * (w / 2 - 0.1), 0, 0.06, d - 0.04, 0, h - 0.05, { mat: M.dark });
    return { foot: [w, d] };
  },

  stool(k, v) {
    const s = 0.32, h = 0.28;
    k.box(-s / 2, h - 0.05, -s / 2, s / 2, h, s / 2, { mat: M.ash, bevel: T32 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) if (!(v >= 1 && sx > 0 && sz > 0)) k.cbox(sx * (s / 2 - 0.05), sz * (s / 2 - 0.05), 0.05, 0.05, 0, h - 0.05, { mat: M.dark });
    return { foot: [s, s] };
  },

  barrel(k, v) {
    const R = 0.27, H = 0.58;
    const prof = [[R * 0.8, 0], [R * 0.93, H * 0.22], [R, H * 0.5], [R * 0.93, H * 0.78], [R * 0.8, H]];
    k.lathe(0, 0, prof, { mat: M.staves, seg: 12, phase: 0.13 });
    for (const [y0, y1] of [[0.05, 0.1], [H - 0.1, H - 0.05]].concat(v < 2 ? [[H * 0.4, H * 0.46]] : [])) {
      const r0 = R * (0.84 + 0.16 * Math.sin(Math.PI * y0 / H)) + 0.012, r1 = R * (0.84 + 0.16 * Math.sin(Math.PI * y1 / H)) + 0.012;
      k.lathe(0, 0, [[r0, y0], [r1, y1]], { mat: M.iron, seg: 12, phase: 0.13, tint: 1.15, ao: false });
    }
    if (v >= 2) {
      k.lathe(0, 0, [[R * 0.8, H], [R * 0.7, H + 0.01]], { mat: M.staves, seg: 12, phase: 0.13, capTop: M.void });
    } else {
      k.lathe(0, 0, [[R * 0.8, H], [R * 0.76, H + 0.012]], { mat: M.dark, seg: 12, phase: 0.13, capTop: M.oak });
      if (v === 1) clutter.mug(k, 0.06, 0.04, H + 0.012, 0.85);
    }
    return { foot: [R * 2, R * 2] };
  },

  crate(k, v) {
    const w = 0.66, h = 0.56, d = 0.62, bt = 0.055, flames = [];
    k.box(-w / 2, 0, -d / 2, w / 2, h, d / 2, { mat: M.ash, bevel: T32 });
    const band = { mat: M.dark, tint: 1.05 };
    // the frame on the front face
    for (const [x0, x1, y0, y1] of [[-w / 2, w / 2, 0, bt], [-w / 2, w / 2, h - bt, h], [-w / 2, -w / 2 + bt, 0, h], [w / 2 - bt, w / 2, 0, h]]) k.box(x0, y0, d / 2, x1, y1, d / 2 + 0.018, band);
    const diag = Math.atan2(h - 2 * bt, w - 2 * bt), len = Math.hypot(h - 2 * bt, w - 2 * bt);
    k.with(at(rotZ(diag), 0, h / 2, d / 2), () => k.box(-len / 2, -bt / 2, 0, len / 2, bt / 2, 0.016, band));
    // and on the lid, unless it has been broken open
    if (v < 2) {
      for (const [x0, x1, z0, z1] of [[-w / 2, w / 2, -d / 2, -d / 2 + bt], [-w / 2, w / 2, d / 2 - bt, d / 2], [-w / 2, -w / 2 + bt, -d / 2, d / 2], [w / 2 - bt, w / 2, -d / 2, d / 2]]) k.box(x0, h, z0, x1, h + 0.016, z1, band);
      const a = Math.atan2(d - 2 * bt, w - 2 * bt), l2 = Math.hypot(d - 2 * bt, w - 2 * bt);
      k.with(at(rotY(-a), 0, h, 0), () => k.box(-l2 / 2, 0, -bt / 2, l2 / 2, 0.016, bt / 2, band));
      if (v === 1) { clutter.candle(k, -0.12, -0.08, h + 0.016, 0.07, flames); clutter.bottle(k, 0.14, 0.06, h + 0.016, GREEN); }
    } else {
      // BROKEN OPEN, NOT A BLACK LID (reviewer round 3, F14: "a black box" in deep-level): the whole top
      // was the void cell. Now a rim of the crate's own boards round a dim inside, straw heaped in it
      k.box(-w / 2 + 0.07, h, -d / 2 + 0.07, w / 2 - 0.07, h + 0.004, d / 2 - 0.07, { mat: M.dark, tint: 0.5, sides: { n: false, s: false, e: false, w: false } });
      k.blob(0.02, h - 0.02, 0.01, w * 0.3, 0.07, d * 0.28, { mat: M.straw, detail: 1, lump: 0.22, under: 0.75, flat: h, seed: 5, tint: 1.1 });
      k.with(at(rotX(0.5), -0.1, h, d / 2 + 0.06), () => k.box(-0.08, 0, 0, 0.1, 0.02, 0.36, { mat: M.ash, tint: 0.9 }));
    }
    return { foot: [w, d], flames };
  },

  strongbox(k, v) {
    chestBody(k, { w: 0.72, h: 0.3, d: 0.5, lidH: 0.12, wood: M.dark, band: M.iron, gold: false, open: v >= 1, straps: 3, tint: 0.95 });
    if (v >= 2) clutter.skull(k, 0.3, 0.32, 0, 0.6, 0.8);
    return { foot: [0.72, 0.5] };
  },

  footlocker(k, v) {
    chestBody(k, { w: 0.76, h: 0.26, d: 0.44, lidH: 0.1, wood: M.ash, band: M.iron, gold: false, open: v >= 1, straps: 2 });
    return { foot: [0.76, 0.44] };
  },

  bookcase(k, v, o) {
    const span = Math.max(1, o.span | 0);
    const W = span > 1 ? span - 0.16 : 0.9, D = 0.34, H = 1.02, z0 = -0.12, z1 = z0 + D, flames = [];
    const x0 = -W / 2, x1 = W / 2;
    const r = createRng(`kit:bookcase:${v}:${span}`);
    k.box(x0, 0, z0, x1, 0.08, z1 + 0.02, { mat: M.dark });                                            // plinth
    // the back is planked on the outside — a case against a SOUTH wall shows the camera its back, and a
    // back made of the void material read as a black slab in 'room-scriptorium' — and dark only inside
    k.box(x0 + 0.04, 0.08, z0, x1 - 0.04, H - 0.06, z0 + 0.03, { mat: M.dark, back: M.dark, front: M.void, tint: 1.05 });
    for (const sx of [x0, x1 - 0.06]) k.box(sx, 0.08, z0, sx + 0.06, H - 0.05, z1, { mat: M.oak, grain: 'z' });
    k.box(x0 - 0.03, H - 0.06, z0 - 0.02, x1 + 0.03, H, z1 + 0.03, { mat: M.oak, bevel: T32, grain: 'x' });   // the cornice
    const shelves = [0.08, 0.38, 0.68];
    const cols = [RED, GREEN, BLUE, TAN, [0.9, 0.8, 0.7], PURPLE, TEAL];
    shelves.forEach((sy, i) => {
      if (i > 0) k.box(x0 + 0.06, sy - 0.03, z0 + 0.03, x1 - 0.06, sy, z1, { mat: M.oak, grain: 'x', tint: 0.95 });
      if (v >= 3 || (v === 2 && i === 2)) return;
      let x = x0 + 0.075;
      while (x < x1 - 0.1) {
        const bw = r.float(0.035, 0.075), bh = r.float(0.18, 0.26);
        if (r.chance(0.07 + v * 0.18)) { x += bw + 0.02; continue; }
        if (r.chance(0.12)) {                                                   // one leaning
          k.with(at(rotZ(-0.35), x + 0.02, sy, z0 + 0.04), () => k.box(0, 0, 0, bw, bh, D - 0.08, { mat: M.leather, tint: r.pick(cols) }));
          x += bw + 0.09;
          continue;
        }
        k.box(x, sy, z0 + 0.04, x + bw, sy + bh, z1 - 0.03, { mat: M.leather, tint: r.pick(cols), front: M.leather });
        x += bw + 0.004;
      }
    });
    if (v === 0) {
      clutter.candle(k, x0 + 0.16, z0 + 0.14, H, 0.08, flames);
      clutter.skull(k, x1 - 0.2, z0 + 0.14, H, -0.3, 0.9);
    } else if (v === 1) clutter.book(k, 0, z0 + 0.14, H, 0.2, RED);
    return { foot: [W, D], flames, z: (z0 + z1) / 2 };
  },

  cupboard(k, v) {
    const W = 0.82, D = 0.36, H = 0.96, z0 = -0.14, z1 = z0 + D;
    k.box(-W / 2, 0, z0, W / 2, H - 0.06, z1, { mat: M.oak, grain: 'z', front: M.dark });
    k.box(-W / 2 - 0.03, H - 0.06, z0 - 0.02, W / 2 + 0.03, H, z1 + 0.03, { mat: M.oak, bevel: T32, grain: 'x' });
    k.box(-W / 2 - 0.02, 0, z1, W / 2 + 0.02, 0.07, z1 + 0.02, { mat: M.dark });
    const doors = [[-W / 2 + 0.05, -0.012], [0.012, W / 2 - 0.05]];
    doors.forEach(([a, b], i) => {
      if (v >= 1 && i === 0) {
        k.box(a, 0.1, z1 - 0.01, b, H - 0.1, z1 + 0.002, { mat: M.void });
        k.with(at(rotY(-1.1), a, 0, z1), () => k.box(0, 0.1, 0, b - a, H - 0.1, 0.03, { mat: M.oak, grain: 'z' }));
        return;
      }
      if (v >= 2 && i === 1) return;
      k.box(a, 0.1, z1, b, H - 0.1, z1 + 0.02, { mat: M.oak, grain: 'z', tint: 1.02 });
      k.box(a + 0.05, 0.18, z1 + 0.02, b - 0.05, H - 0.18, z1 + 0.028, { mat: M.dark });
      for (const hy of [0.2, H - 0.22]) k.box(i ? b - 0.12 : a, hy, z1 + 0.02, i ? b : a + 0.12, hy + 0.04, z1 + 0.03, { mat: M.iron, tint: 1.2 });
      k.box(i ? a + 0.02 : b - 0.04, H * 0.48, z1 + 0.02, i ? a + 0.04 : b - 0.02, H * 0.56, z1 + 0.04, { mat: M.iron, tint: 1.3 });
    });
    return { foot: [W, D], z: (z0 + z1) / 2 };
  },

  weaponRack(k, v) {
    const W = 0.86, z = -0.06;
    k.box(-W / 2, 0, z - 0.12, W / 2, 0.09, z + 0.12, { mat: M.dark, bevel: T32 });
    for (const sx of [-1, 1]) k.cbox(sx * (W / 2 - 0.04), z, 0.07, 0.07, 0.09, 1.0, { mat: M.dark, tint: 1.05 });
    k.cbox(0, z, W, 0.06, 0.94, 1.02, { mat: M.oak, bevel: T32 });
    k.cbox(0, z + 0.04, W - 0.1, 0.04, 0.5, 0.55, { mat: M.oak });
    const slots = [-0.28, -0.14, 0, 0.14, 0.28];
    slots.forEach((x, i) => {
      if (v >= 1 && (i + v) % (5 - Math.min(3, v)) === 0) return;
      const kind = i % 3;
      // nothing here is under two texels across: a one-texel haft is a line on some frames and gone
      // on the next, which is what the first rack looked like
      if (kind === 0) {                                     // spear
        k.cbox(x, z + 0.05, 0.065, 0.05, 0.09, 1.04, { mat: M.leather, tint: 1.15 });
        k.lathe(x, z + 0.05, [[0.075, 1.04], [0.05, 1.1], [0, 1.28]], { mat: M.iron, seg: 4, tint: 1.6, phase: 0.78, ao: false });
      } else if (kind === 1) {                              // sword, point down
        k.cbox(x, z + 0.06, 0.09, 0.03, 0.12, 0.74, { mat: M.iron, tint: 1.75, bevel: T32 });
        k.cbox(x, z + 0.06, 0.2, 0.06, 0.74, 0.8, { mat: M.gold });
        k.cbox(x, z + 0.06, 0.065, 0.05, 0.8, 0.94, { mat: M.leather, tint: 1.1 });
        k.lathe(x, z + 0.06, [[0.045, 0.94], [0.05, 0.97], [0, 1.01]], { mat: M.gold, seg: 6 });
      } else {                                              // axe
        k.cbox(x, z + 0.05, 0.065, 0.05, 0.09, 1.0, { mat: M.leather, tint: 1.15 });
        k.box(x - 0.02, 0.76, z + 0.02, x + 0.16, 0.98, z + 0.08, { mat: M.iron, tint: 1.6, bevel: T32 });
      }
    });
    return { foot: [W, 0.26], z };
  },

  /**
   * STONE, NOT PERIWINKLE (reviewer round 1, P1: "flat periwinkle slabs that read as rugs"). They were
   * cut from the slate cell, a cool blue-grey that a cold band pushed to periwinkle; taking the blue out
   * of the tint was not enough (round 2 still read blue under the crypt's cold light). They are now the
   * neutral cut-block cell warmed a touch by `stone()`, so the piece sits at the wall's own grey. The lid is thick enough (0.15) that its sheared front shows as a
   * band four to five texels deep, with a carved groove run round it, and the contact shadow is heavier
   * than furniture's: a sarcophagus is a ton of stone, not a table.
   */
  sarcophagus(k, v) {
    const W = 0.74, D = 0.94, H = 0.36, L = 0.15, S = M.block;
    k.box(-W / 2 - 0.05, 0, -D / 2, W / 2 + 0.05, 0.08, D / 2, { mat: S, frontK: 0.82, bevel: T32, tint: stone(0.9) });
    k.box(-W / 2, 0.08, -D / 2 + 0.04, W / 2, H, D / 2 - 0.04, { mat: S, frontK: 0.82, bevel: T32, tint: stone(1.0) });
    for (const px of [-0.2, 0.2]) k.box(px - 0.13, 0.13, D / 2 - 0.04, px + 0.13, H - 0.05, D / 2 - 0.025, { mat: S, frontK: 0.82, tint: stone(1.14) });
    const lid = (ox, oz, ry) => k.with(at(rotY(ry), ox, 0, oz), () => {
      k.box(-W / 2 - 0.04, H, -D / 2 + 0.01, W / 2 + 0.04, H + L, D / 2 - 0.01, { mat: S, frontK: 0.82, bevel: 2 * T32, tint: stone(1.18) });
      k.box(-W / 2 - 0.045, H + L * 0.4, D / 2 - 0.01, W / 2 + 0.045, H + L * 0.6, D / 2 + 0.004, { mat: S, frontK: 0.82, tint: stone(0.6) });   // the groove
      const E = H + L;                                                                                       // the effigy
      k.blob(0, E + 0.03, -D / 2 + 0.19, 0.085, 0.06, 0.085, { mat: S, frontK: 0.82, detail: 1, lump: 0.04, under: 0.7, flat: E, tint: stone(1.3) });
      k.box(-0.14, E, -D / 2 + 0.29, 0.14, E + 0.06, D / 2 - 0.16, { mat: S, frontK: 0.82, bevel: T32, tint: stone(1.26) });
      k.box(-0.1, E + 0.06, -0.06, 0.1, E + 0.085, 0.03, { mat: S, frontK: 0.82, tint: stone(1.36) });
      k.box(-0.11, E, D / 2 - 0.16, 0.11, E + 0.035, D / 2 - 0.09, { mat: S, frontK: 0.82, tint: stone(1.2) });
    });
    if (v <= 1) {
      lid(0, 0, 0);
      if (v === 1) k.box(0.06, H + L, -0.3, 0.08, H + L + 0.003, 0.4, { mat: M.void });                    // the crack
    } else {
      k.box(-W / 2 + 0.06, H - 0.01, -D / 2 + 0.1, W / 2 - 0.06, H + 0.001, D / 2 - 0.1, { mat: M.void, sides: { n: false, s: false, e: false, w: false } });
      clutter.skull(k, -0.1, -0.2, H - 0.02, 0.4, 0.85);
      clutter.bone(k, 0.08, 0.1, H - 0.01, 1.2, 0.26);
      if (v === 2) lid(0.3, 0.08, 0.22);
      else k.with(at(rotZ(0.5), W / 2 + 0.14, 0, 0), () => k.box(-0.07, 0, -D / 2 + 0.05, 0.07, 0.36, D / 2 - 0.1, { mat: S, frontK: 0.82, tint: stone(1.1), bevel: T32 }));
    }
    return { foot: [W + 0.1, D], weight: 1.25 };
  },

  /** A grave slab: a low block with a carved front band and a cross on its lid (thick enough to show a front). */
  tombSlab(k, v) {
    const W = 0.78, D = 0.9, H = 0.2, S = M.block;
    const slab = (x0, x1, tilt, tint) => k.with(at(rotZ(tilt), 0, 0, 0), () => {
      k.box(x0, 0, -D / 2, x1, H, D / 2, { mat: S, frontK: 0.82, bevel: 2 * T32, tint: stone(tint) });
      k.box(x0 - 0.004, H * 0.42, D / 2, x1 + 0.004, H * 0.58, D / 2 + 0.006, { mat: S, frontK: 0.82, tint: stone(0.62) });   // the groove
    });
    if (v >= 2) {
      slab(-W / 2, -0.02, 0, 1.12);
      slab(0.02, W / 2, 0.08, 1.0);
    } else {
      slab(-W / 2, W / 2, 0, 1.14);
      k.box(-0.035, H, -0.3, 0.035, H + 0.025, 0.28, { mat: S, frontK: 0.82, tint: stone(1.36) });                           // a carved cross
      k.box(-0.16, H, -0.17, 0.16, H + 0.025, -0.1, { mat: S, frontK: 0.82, tint: stone(1.36) });
      if (v === 1) k.box(0.1, H, -0.36, 0.13, H + 0.003, 0.2, { mat: M.void });                                // cracked
    }
    return { foot: [W, D], weight: 1.2 };
  },

  urn(k, v) {
    const prof = [[0.1, 0], [0.17, 0.08], [0.2, 0.2], [0.16, 0.32], [0.09, 0.38], [0.12, 0.43]];
    const body = () => k.lathe(0, 0, prof, { mat: v === 1 ? M.slate : M.clay, seg: 10, capTop: M.void });
    if (v >= 2) {
      k.with(at(rotZ(1.45), 0.05, 0.19, 0), body);
      k.blob(0.34, 0, 0.06, 0.12, 0.03, 0.12, { mat: M.dirt, detail: 1, lump: 0.25, under: 0.9, flat: 0 });
    } else body();
    return { foot: [0.4, 0.4] };
  },

  brazier(k, v) {
    const flames = [];
    const tip = v >= 3 ? 0.9 : 0;
    k.with(at(rotZ(tip), tip ? 0.1 : 0, tip ? 0.2 : 0, 0), () => {
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3 + 0.4;
        k.with(at(rotY(-a).multiply(rotX(0.18)), Math.sin(a) * 0.14, 0, Math.cos(a) * 0.14), () => k.cbox(0, 0, 0.06, 0.06, 0, 0.42, { mat: M.iron, tint: 0.8 }));
      }
      // SMALL AND HOT ON DARK IRON (reviewer round 1, P5). A dark bowl with a bed of ash in it and a
      // small core of coals at its heart under a flame a third smaller than it was: an ember bed filling
      // the whole bowl read as an orange disc on a tripod in 'furnished-guardroom'.
      k.lathe(0, 0, [[0.06, 0.34], [0.2, 0.42], [0.26, 0.5], [0.28, 0.54], [0.22, 0.54], [0.2, 0.47]], { mat: M.iron, seg: 10, tint: 0.85, capTop: M.dirt, ao: false });
      if (v < 2) { k.blob(0, 0.47, 0, 0.09, 0.03, 0.09, { mat: M.ember, detail: 1, lump: 0.3, flat: 0.465, shade: false }); flames.push([0, 0.49, 0, 0.24]); }
    });
    return { foot: [0.44, 0.44], flames, pool: v < 2 ? [0xff7a2a, 0.6, 0.12] : null };
  },

  hearth(k, v) {
    const W = 0.96, D = 0.5, H = 0.74, z0 = -0.2, z1 = z0 + D, flames = [];
    k.box(-W / 2, 0, z0, -W / 2 + 0.22, H, z1, { mat: M.block, bevel: T32 });
    k.box(W / 2 - 0.22, 0, z0, W / 2, H, z1, { mat: M.block, bevel: T32 });
    k.box(-W / 2 + 0.22, 0.46, z0, W / 2 - 0.22, H, z1, { mat: M.block, bevel: T32, tint: 0.95 });
    k.box(-W / 2 - 0.04, H - 0.02, z0 - 0.02, W / 2 + 0.04, H + 0.08, z1 + 0.05, { mat: M.oak, bevel: T32, grain: 'x', tint: 0.9 });  // mantel
    k.box(-W / 2 + 0.22, 0, z0, W / 2 - 0.22, 0.46, z0 + 0.06, { mat: M.void });
    k.box(-W / 2 + 0.22, 0, z0, W / 2 - 0.22, 0.02, z1, { mat: v >= 2 ? M.dirt : M.ember, shade: v < 2 ? false : undefined, sides: { s: false } });
    for (const [x, a] of [[-0.08, 0.3], [0.08, -0.3]]) k.with(at(rotY(a), x, 0.03, z0 + 0.25), () => k.box(-0.12, 0, -0.03, 0.12, 0.06, 0.03, { mat: M.bark }));
    if (v < 2) flames.push([0, 0.06, z0 + 0.26, 0.4]);
    if (v === 0) { clutter.candle(k, -0.34, z0 + 0.2, H + 0.08, 0.08, flames); clutter.mug(k, 0.32, z0 + 0.22, H + 0.08); }
    return { foot: [W, D], flames, z: (z0 + z1) / 2, pool: v < 2 ? [0xff8a3a, 0.9, 0.16] : null };
  },

  candelabra(k, v) {
    const flames = [];
    k.lathe(0, 0, [[0.13, 0], [0.11, 0.04], [0.04, 0.07], [0.025, 0.1], [0.025, 0.56], [0.05, 0.6]], { mat: M.gold, seg: 8, tint: 0.8, capTop: true });
    k.cbox(0, 0, 0.34, 0.03, 0.58, 0.62, { mat: M.gold, tint: 0.85 });
    const arms = v >= 2 ? [-0.15] : v === 1 ? [-0.15, 0] : [-0.15, 0, 0.15];
    for (const x of arms) clutter.candle(k, x, 0, x === 0 ? 0.62 : 0.6, x === 0 ? 0.12 : 0.09, v >= 2 ? null : flames);
    return { foot: [0.3, 0.3], flames, pool: v < 2 ? [0xffe0a0, 0.5, 0.08] : null };
  },

  bonePile(k, v) {
    const r = createRng(`kit:bonePile:${v}`);
    for (let i = 0; i < 9 - v * 2; i++) clutter.bone(k, r.float(-0.28, 0.28), r.float(-0.22, 0.22), r.float(0, 0.05), r.float(0, 3.14), r.float(0.16, 0.26), r.float(0.85, 1.05));
    clutter.skull(k, r.float(-0.1, 0.1), r.float(-0.05, 0.1), 0.02, r.float(-0.6, 0.6), 1);
    if (v === 0) clutter.skull(k, 0.22, -0.14, 0, 1.2, 0.85);
    return { foot: [0.64, 0.5], weight: 1.2, rim: true };
  },

  pillarBroken(k, v) {
    const h = [0.95, 0.66, 0.4][v] ?? 0.4;
    k.box(-0.32, 0, -0.32, 0.32, 0.12, 0.32, { mat: M.block, bevel: 2 * T32, tint: 1.25 });
    k.lathe(0, 0, [[0.23, 0.12], [0.2, 0.2], [0.2, h - 0.04], [0.17, h]], { mat: M.block, seg: 8, jag: 0.04, capTop: M.block, phase: Math.PI / 8, tint: 1.3 });
    if (v >= 1) for (let i = 0; i < 3; i++) k.blob(0.3 - i * 0.15, 0, 0.36, 0.08, 0.06, 0.07, { mat: M.block, detail: 0, lump: 0.25, flat: 0, seed: i + v, tint: 1.25 });
    return { foot: [0.64, 0.64] };
  },

  fallenColumn(k, v) {
    k.with(at(rotZ(Math.PI / 2).multiply(rotX(0.2 * (v - 1))), 0, 0.2, 0), () => k.lathe(0, 0, [[0.2, -0.46], [0.2, 0.46]], { mat: M.block, seg: 8, capTop: M.block, capBottom: true, jag: 0.03, tint: 1.3 }));
    k.blob(0.42, 0, 0.28, 0.1, 0.07, 0.09, { mat: M.block, detail: 0, lump: 0.2, flat: 0, seed: 4, tint: 1.25 });
    return { foot: [0.96, 0.44] };
  },

  rubbleMound(k, v) {
    const r = createRng(`kit:rubble:${v}`);
    // a heap of fallen blocks, not a mound of earth: the orange dirt base read as a biscuit at the play
    // camera ('default', the start room). A low grey bed of grit, then cut blocks tumbled over it.
    k.blob(0, 0, 0, 0.36, 0.08 + v * 0.02, 0.3, { mat: M.rock, detail: 1, lump: 0.25, flat: 0, seed: 2, tint: 0.95 });
    for (let i = 0; i < 6 + v; i++) {
      const sz = r.float(0.1, 0.17), x = r.float(-0.28, 0.28), z = r.float(-0.22, 0.22);
      k.with(at(rotY(r.float(0, 3)).multiply(rotZ(r.float(-0.4, 0.4))), x, r.float(0, 0.1), z), () =>
        k.box(-sz, 0, -sz * 0.8, sz, sz * 1.1, sz * 0.8, { mat: M.block, bevel: T32, tint: r.float(1.1, 1.35) }));
    }
    return { foot: [0.8, 0.64], weight: 1.15, rim: true };
  },

  // ---------------------------------------------------------------- the workshop, the court, the cells
  alchemyBench(k, v) {
    const w = 0.92, d = 0.62, h = 0.46, flames = [];
    k.box(-w / 2, h - 0.06, -d / 2, w / 2, h, d / 2, { mat: M.dark, bevel: T32, grain: 'x', tint: 1.1 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.cbox(sx * (w / 2 - 0.08), sz * (d / 2 - 0.08), 0.08, 0.08, 0, h - 0.06, { mat: M.dark });
    k.cbox(0, 0, w - 0.16, d - 0.16, 0.08, 0.12, { mat: M.dark, tint: 0.9 });                   // the shelf under it
    for (const [x, z, c] of [[-0.3, 0.04, GREEN], [-0.22, -0.14, PURPLE], [0.36, 0.14, BLUE]]) k.lathe(x, z, [[0.05, 0.12], [0.06, 0.2], [0.02, 0.26]], { mat: M.glass, seg: 7, tint: c, capTop: M.leather });
    // the retort over its lamp
    k.lathe(0.12, -0.04, [[0.04, h], [0.06, h + 0.03]], { mat: M.iron, seg: 7, tint: 1.2, capTop: true });
    if (v < 2) flames.push([0.12, h + 0.03, -0.04, 0.08]);
    k.lathe(0.12, -0.04, [[0.02, h + 0.09], [0.1, h + 0.14], [0.11, h + 0.2], [0.07, h + 0.26], [0.025, h + 0.3], [0.025, h + 0.38]], { mat: M.glass, seg: 9, tint: v >= 2 ? [0.8, 0.8, 0.8] : GREEN, capTop: M.void });
    for (const [x, z, c, hh] of [[-0.3, -0.12, RED, 0.16], [-0.18, 0.12, GREEN, 0.12], [0.34, -0.16, TEAL, 0.14]]) clutter.bottle(k, x, z, h, c, hh);
    clutter.book(k, -0.02, 0.16, h, -0.2, PURPLE, true);
    if (v >= 1) k.blob(0.3, h, 0.02, 0.1, 0.012, 0.08, { mat: M.glass, detail: 1, lump: 0.3, flat: h, tint: GREEN });
    return { foot: [w, d], flames, pool: v < 2 ? [0x7fe3a8, 0.5, 0.08] : null };
  },

  lectern(k, v) {
    k.cbox(0, 0.02, 0.36, 0.12, 0, 0.05, { mat: M.dark, bevel: T32 });
    k.cbox(0, 0.02, 0.12, 0.36, 0, 0.05, { mat: M.dark, bevel: T32 });
    k.cbox(0, 0.02, 0.08, 0.08, 0.05, 0.56, { mat: M.oak, tint: 1.05 });
    k.with(at(rotX(0.45), 0, 0.58, 0.02), () => {
      k.box(-0.22, -0.02, -0.16, 0.22, 0.03, 0.16, { mat: M.oak, bevel: T32, grain: 'x' });
      k.box(-0.23, 0.03, 0.14, 0.23, 0.06, 0.17, { mat: M.oak, tint: 0.9 });
      if (v < 2) clutter.book(k, 0, 0, 0.03, 0, RED, true);
    });
    return { foot: [0.4, 0.36] };
  },

  throne(k, v) {
    k.box(-0.44, 0, -0.4, 0.44, 0.1, 0.42, { mat: M.slate, bevel: 2 * T32, tint: 0.95 });
    k.box(-0.32, 0.1, -0.24, 0.32, 0.36, 0.3, { mat: M.slate, bevel: T32 });
    const back = v >= 1 ? 0.78 : 1.12;
    k.box(-0.34, 0.1, -0.36, 0.34, back, -0.2, { mat: M.slate, bevel: 2 * T32, tint: 1.05 });
    for (const sx of [-1, 1]) k.box(sx * 0.3 - 0.06, 0.36, -0.22, sx * 0.3 + 0.06, 0.52, 0.3, { mat: M.slate, bevel: T32, tint: 1.1 });
    k.box(-0.24, 0.36, -0.2, 0.24, 0.42, 0.26, { mat: M.cloth, bevel: T32, tint: v >= 1 ? 0.7 : 1.1 });   // cushion
    k.box(-0.22, 0.42, -0.2, 0.22, back - 0.12, -0.18, { mat: M.cloth, tint: v >= 1 ? 0.65 : 1.05 });
    if (v === 0) {
      for (const sx of [-0.3, 0.3]) k.lathe(sx, -0.28, [[0.05, back], [0.06, back + 0.04], [0, back + 0.12]], { mat: M.gold, seg: 6 });
      k.cbox(0, -0.28, 0.14, 0.05, back, back + 0.1, { mat: M.gold, bevel: T32 });
      k.lathe(0, -0.28, [[0.04, back + 0.1], [0, back + 0.17]], { mat: M.gold, seg: 5 });
    } else k.blob(0.34, 0, 0.36, 0.14, 0.08, 0.12, { mat: M.slate, detail: 0, lump: 0.2, flat: 0 });
    return { foot: [0.88, 0.82] };
  },

  anvil(k, v) {
    k.lathe(0, 0.02, [[0.2, 0], [0.18, 0.1], [0.17, 0.22]], { mat: M.bark, seg: 8, capTop: M.endgrain });
    k.cbox(0, 0.02, 0.2, 0.18, 0.22, 0.28, { mat: M.iron, tint: 1.2, bevel: T32 });
    k.cbox(0, 0.02, 0.1, 0.1, 0.28, 0.34, { mat: M.iron, tint: 1.15 });
    k.cbox(-0.03, 0.02, 0.36, 0.2, 0.34, 0.42, { mat: M.iron, tint: 1.45, bevel: T32 });
    k.with(at(rotZ(-Math.PI / 2), 0.15, 0.38, 0.02), () => k.lathe(0, 0, [[0.07, 0], [0, 0.18]], { mat: M.iron, seg: 6, tint: 1.4, ao: false }));
    if (v === 0) k.with(at(rotY(0.5), -0.06, 0.42, 0.04), () => { k.box(-0.14, 0, -0.025, 0.1, 0.035, 0.025, { mat: M.leather, tint: 1.1 }); k.box(0.1, 0, -0.05, 0.18, 0.06, 0.05, { mat: M.iron, tint: 1.4 }); });
    return { foot: [0.44, 0.4] };
  },

  forge(k, v) {
    const flames = [];
    k.box(-0.46, 0, -0.36, 0.46, 0.44, 0.34, { mat: M.block, bevel: 2 * T32 });
    k.box(-0.36, 0.43, -0.26, 0.36, 0.445, 0.24, { mat: v >= 1 ? M.dirt : M.ember, shade: v >= 1 ? undefined : false, sides: { n: false, s: false, e: false, w: false } });
    if (v < 1) { k.blob(0, 0.44, 0, 0.3, 0.06, 0.2, { mat: M.ember, detail: 1, lump: 0.3, flat: 0.44, shade: false }); flames.push([-0.12, 0.48, 0, 0.26], [0.16, 0.48, 0.02, 0.2]); }
    k.box(-0.3, 0.44, -0.36, 0.3, 1.08, -0.18, { mat: M.block, bevel: T32, tint: 0.92 });          // the chimney
    k.box(-0.38, 0.9, -0.38, 0.38, 1.0, -0.12, { mat: M.block, bevel: T32, tint: 1.05 });
    k.with(at(rotZ(0.25), 0.54, 0.26, 0.1), () => k.box(-0.1, 0, -0.14, 0.1, 0.14, 0.14, { mat: M.leather, bevel: T32 }));   // bellows
    return { foot: [0.92, 0.7], flames, pool: v < 1 ? [0xff6a20, 0.8, 0.14] : null };
  },

  cauldron(k, v) {
    const flames = [];
    if (v === 0) { for (const a of [0.4, 1.9]) k.with(at(rotY(a), 0, 0.03, 0), () => k.box(-0.2, 0, -0.035, 0.2, 0.07, 0.035, { mat: M.bark })); flames.push([0, 0.04, 0.12, 0.2]); }
    for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.3; k.cbox(Math.sin(a) * 0.17, Math.cos(a) * 0.17, 0.05, 0.05, 0, 0.1, { mat: M.iron }); }
    // the brew is a separate disc a little under the rim, tinted: capped with the iron's own tint the
    // glass cell came out a white plate on the 'furniture' plate
    k.lathe(0, 0, [[0.16, 0.06], [0.28, 0.18], [0.28, 0.32], [0.23, 0.4], [0.27, 0.43], [0.2, 0.43], [0.2, 0.38]], { mat: M.iron, seg: 12, tint: 1.2 });
    k.lathe(0, 0, [[0.2, 0.37], [0.2, 0.39]], { mat: M.iron, seg: 12, capTop: v >= 2 ? M.void : M.glass, tint: v >= 2 ? 1 : [0.42, 0.9, 0.45], ao: false });
    if (v < 2) for (const [bx, bz, br] of [[0.06, -0.04, 0.06], [-0.08, 0.05, 0.04]]) k.blob(bx, 0.39, bz, br, 0.025, br, { mat: M.glass, detail: 1, lump: 0.2, tint: [0.6, 1.15, 0.6], flat: 0.385 });
    return { foot: [0.56, 0.56], flames, pool: v < 2 ? [0x7fe3a8, 0.45, 0.08] : null };
  },

  /**
   * A bunk (reviewer round 2, P5b: still "glowing orange checker panels"). The blanket, mattress and
   * pillow were all on the linen cell, a woven check, and a check under a wall torch reads as a lit
   * grille whatever it is dyed. Now the blanket is a plain dark wool on the smooth slate cell with two
   * fold lines, the pillow is plain, and a footboard gives the frame a front the camera can see.
   */
  bunk(k, v) {
    const w = 0.8, d = 0.94;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.cbox(sx * (w / 2 - 0.04), sz * (d / 2 - 0.04), 0.08, 0.08, 0, 0.44, { mat: M.dark });
    k.box(-w / 2, 0.14, -d / 2, w / 2, 0.26, d / 2, { mat: M.dark, bevel: T32, grain: 'z' });
    k.box(-w / 2 + 0.05, 0.26, -d / 2 + 0.06, w / 2 - 0.05, 0.3, d / 2 - 0.06, { mat: M.slate, tint: [0.46, 0.45, 0.44] });  // the tick
    k.blob(0, 0.32, -d / 2 + 0.19, 0.22, 0.045, 0.09, { mat: M.bone, detail: 1, lump: 0.06, under: 0.7, flat: 0.3, tint: [0.55, 0.55, 0.57] });
    if (v < 2) {
      // dark wool, well under the floor (reviewer round 3, P15: pale blankets on a pale floor)
      const wool = v === 1 ? [0.17, 0.2, 0.17] : [0.17, 0.17, 0.22];
      const fold = [wool[0] * 0.68, wool[1] * 0.68, wool[2] * 0.68];
      k.box(-w / 2 + 0.035, 0.3, -0.04, w / 2 - 0.035, 0.335, d / 2 - 0.06, { mat: M.slate, bevel: T32, tint: wool });
      for (const fz of [0.12, 0.28]) k.box(-w / 2 + 0.05, 0.335, fz - 0.016, w / 2 - 0.05, 0.345, fz + 0.016, { mat: M.slate, tint: fold });
    }
    k.box(-w / 2, 0.26, -d / 2, w / 2, 0.46, -d / 2 + 0.06, { mat: M.dark, bevel: T32 });   // the headboard
    k.box(-w / 2, 0.26, d / 2 - 0.06, w / 2, 0.38, d / 2, { mat: M.dark, bevel: T32, tint: 1.1 });   // the footboard
    return { foot: [w, d] };
  },

  sackPile(k, v) {
    const sacks = [[-0.16, 0.08, 1], [0.16, 0.1, 0.95], [0, -0.14, 1.05], [0.02, 0.02, 0.9, 0.2]];
    sacks.slice(0, 4 - Math.min(1, v)).forEach(([x, z, s, y = 0], i) => {
      k.blob(x, y + 0.14 * s, z, 0.17 * s, 0.15 * s, 0.14 * s, { mat: M.linen, detail: 1, lump: 0.1, under: 0.5, flat: y, seed: i + 3, tint: 1.05 });
      k.blob(x - 0.02, y + 0.3 * s, z - 0.02, 0.06 * s, 0.05 * s, 0.05 * s, { mat: M.linen, detail: 1, lump: 0.1, under: 0.6, seed: i + 9 });
      k.cbox(x - 0.02, z - 0.02, 0.09 * s, 0.07 * s, y + 0.25 * s, y + 0.27 * s, { mat: M.leather, tint: 0.9 });
    });
    if (v >= 1) k.blob(0.28, 0, 0.2, 0.16, 0.035, 0.12, { mat: M.straw, detail: 1, lump: 0.3, flat: 0 });
    if (v >= 2) clutter.coins(k, -0.28, 0.24, 0, 2);
    return { foot: [0.62, 0.52] };
  },

  cage(k, v) {
    const s = 0.34, H = 0.9;
    k.box(-s, 0, -s, s, 0.06, s, { mat: M.iron, bevel: T32, tint: 1.1 });
    k.box(-s, H - 0.06, -s, s, H, s, { mat: M.iron, bevel: T32, tint: 1.2 });
    const bars = [];
    for (let i = 0; i <= 4; i++) { const t = -s + i * (2 * s / 4); bars.push([t, -s], [t, s]); if (i > 0 && i < 4) bars.push([-s, t], [s, t]); }
    bars.forEach(([x, z], i) => { if (v >= 2 && i % 5 === 3) return; k.cbox(x, z, 0.065, 0.065, 0.06, H - 0.06, { mat: M.iron, tint: 1.25 }); });
    if (v >= 1) { clutter.skull(k, -0.08, 0.04, 0.06, 0.4, 0.9); clutter.bone(k, 0.12, -0.08, 0.06, 1.1, 0.22); }
    k.lathe(0, 0, [[0.05, H], [0.07, H + 0.06]], { mat: M.iron, seg: 6, capTop: true, tint: 1.2 });
    return { foot: [0.72, 0.72] };
  },

  rack(k, v) {
    const L = 0.9, d = 0.5;
    for (const sz of [-1, 1]) k.box(-L / 2, 0.2, sz * d / 2 - 0.05, L / 2, 0.3, sz * d / 2 + 0.05, { mat: M.dark, bevel: T32, grain: 'x' });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cbox(sx * (L / 2 - 0.06), sz * d / 2, 0.08, 0.08, 0, 0.36, { mat: M.dark });
    for (const sx of [-1, 1]) k.with(at(rotX(Math.PI / 2), sx * (L / 2 - 0.12), 0.34, 0), () => k.lathe(0, 0, [[0.06, -d / 2], [0.06, d / 2]], { mat: M.bark, seg: 7, capTop: M.endgrain, capBottom: true, ao: false }));
    for (const sz of [-0.12, 0.12]) k.box(-L / 2 + 0.12, 0.33, sz - 0.02, L / 2 - 0.12, 0.35, sz + 0.02, { mat: M.linen, tint: 1.1 });
    k.box(-0.3, 0.3, -0.16, 0.3, 0.33, 0.16, { mat: M.dark, tint: 0.8 });
    if (v >= 1) clutter.bone(k, 0.1, 0.3, 0, 0.4, 0.24);
    return { foot: [L, d + 0.1] };
  },

  chainPost(k, v) {
    k.cbox(0, 0, 0.16, 0.16, 0, 0.06, { mat: M.block, bevel: T32 });
    k.cbox(0, 0, 0.16, 0.16, 0.06, 0.9, { mat: M.dark, bevel: T32, tint: 1.25 });
    k.cbox(0, 0, 0.2, 0.2, 0.86, 0.94, { mat: M.iron, bevel: T32, tint: 1.3 });
    k.lathe(0, 0.07, [[0.06, 0.66], [0.06, 0.7]], { mat: M.iron, seg: 8, tint: 1.3 });
    const links = v >= 2 ? 3 : 7;
    for (let i = 0; i < links; i++) {
      const y = 0.64 - i * 0.09, z = 0.1 + i * 0.03;
      k.box(i % 2 ? -0.035 : -0.055, y - 0.08, z - 0.03, i % 2 ? 0.035 : 0.055, y, z + 0.03, { mat: M.iron, tint: 1.5, bevel: T32 });
    }
    if (v === 0) k.with(at(rotY(0.3), 0.08, 0, 0.36), () => k.lathe(0, 0, [[0.07, 0], [0.07, 0.04]], { mat: M.iron, seg: 8, tint: 1.3, capTop: M.void }));
    return { foot: [0.2, 0.2] };
  },

  shieldStand(k, v) {
    for (const sx of [-1, 1]) k.with(at(rotZ(sx * 0.28), sx * 0.26, 0, -0.04), () => k.cbox(0, 0, 0.06, 0.06, 0, 0.78, { mat: M.oak }));
    k.cbox(0, -0.04, 0.5, 0.06, 0.66, 0.72, { mat: M.oak, bevel: T32 });
    const cols = [RED, BLUE, GREEN];
    [-0.2, 0.2].forEach((x, i) => {
      if (v >= 2 && i === 1) return;
      k.with(at(rotX(1.2), x, 0.4, 0.04), () => {
        k.lathe(0, 0, [[0.19, 0], [0.19, 0.03]], { mat: M.iron, seg: 12, tint: 1.3, capTop: M.cloth, ao: false });
        k.lathe(0, 0, [[0.06, 0.03], [0, 0.08]], { mat: M.gold, seg: 8, ao: false });
      });
      void cols;
    });
    return { foot: [0.62, 0.3] };
  },

  armourStand(k, v) {
    k.cbox(0, 0, 0.34, 0.1, 0, 0.05, { mat: M.dark, bevel: T32 }); k.cbox(0, 0, 0.1, 0.34, 0, 0.05, { mat: M.dark, bevel: T32 });
    k.cbox(0, 0, 0.06, 0.06, 0.05, 1.0, { mat: M.oak });
    k.cbox(0, 0, 0.5, 0.06, 0.78, 0.84, { mat: M.oak });
    if (v < 2) {
      k.blob(0, 0.66, 0.03, 0.2, 0.2, 0.12, { mat: M.iron, detail: 1, lump: 0.04, under: 0.6, tint: 1.6 });      // cuirass
      for (const sx of [-1, 1]) k.blob(sx * 0.2, 0.82, 0.02, 0.1, 0.06, 0.1, { mat: M.iron, detail: 1, lump: 0.05, under: 0.6, tint: 1.5 });
      k.blob(0, 0.98, 0.01, 0.1, 0.11, 0.11, { mat: M.iron, detail: 1, lump: 0.03, under: 0.6, tint: 1.55 });      // helm
      k.box(-0.08, 0.94, 0.1, 0.08, 0.96, 0.115, { mat: M.void });
      k.box(-0.14, 0.44, -0.03, 0.14, 0.52, 0.12, { mat: M.leather, tint: 1.1 });                                    // belt/tassets
    }
    return { foot: [0.36, 0.36] };
  },

  scales(k, v) {
    k.lathe(0, 0, [[0.1, 0], [0.08, 0.03], [0.025, 0.05], [0.02, 0.5]], { mat: M.gold, seg: 8, tint: 0.9 });
    k.with(at(rotZ(v >= 1 ? 0.18 : 0), 0, 0.5, 0), () => {
      k.cbox(0, 0, 0.44, 0.03, -0.015, 0.015, { mat: M.gold });
      for (const sx of [-0.2, 0.2]) {
        k.cbox(sx, 0, 0.012, 0.012, -0.2, 0, { mat: M.gold, tint: 0.8 });
        k.lathe(sx, 0, [[0.03, -0.24], [0.1, -0.2]], { mat: M.gold, seg: 9, tint: 1.05, capTop: true });
      }
    });
    return { foot: [0.3, 0.2] };
  },

  retortStand(k, v) {
    const flames = [];
    for (let i = 0; i < 3; i++) { const a = i * 2.1; k.with(at(rotY(-a).multiply(rotX(0.2)), Math.sin(a) * 0.14, 0, Math.cos(a) * 0.14), () => k.cbox(0, 0, 0.065, 0.065, 0, 0.36, { mat: M.iron, tint: 1.35 })); }
    k.lathe(0, 0, [[0.17, 0.32], [0.17, 0.37]], { mat: M.iron, seg: 10, tint: 1.45 });
    k.lathe(0, 0, [[0.04, 0.34], [0.16, 0.42], [0.17, 0.52], [0.1, 0.61], [0.045, 0.66], [0.045, 0.8]], { mat: M.glass, seg: 9, tint: v >= 1 ? PURPLE : GREEN, capTop: M.void });
    if (v === 0) { k.lathe(0, 0, [[0.04, 0], [0.05, 0.05]], { mat: M.gold, seg: 6, capTop: true }); flames.push([0, 0.06, 0, 0.12]); }
    return { foot: [0.34, 0.34], flames, pool: [0x7fe3a8, 0.4, 0.07] };
  },

  wellHead(k, v) {
    k.lathe(0, 0, [[0.44, 0], [0.43, 0.36]], { mat: M.block, seg: 12, capTop: false, tint: 1.3 });
    k.lathe(0, 0, [[0.43, 0.36], [0.44, 0.4], [0.32, 0.4]], { mat: M.block, seg: 12, tint: 1.45 });
    k.lathe(0, 0, [[0.32, 0.395]], { mat: M.void, seg: 12, capTop: M.void });
    k.lathe(0, 0, [[0.32, 0.3], [0.32, 0.4]], { mat: M.void, seg: 12, capTop: M.void });
    if (v === 0) {
      for (const sx of [-0.4, 0.4]) k.cbox(sx, 0, 0.08, 0.08, 0.36, 0.95, { mat: M.dark });
      k.with(at(rotZ(Math.PI / 2), -0.46, 0.86, 0), () => k.lathe(0, 0, [[0.05, 0], [0.05, 0.92]], { mat: M.bark, seg: 6, capTop: M.endgrain, capBottom: true }));
      k.cbox(0.06, 0, 0.012, 0.012, 0.56, 0.86, { mat: M.linen });
      k.lathe(0.06, 0, [[0.07, 0.46], [0.08, 0.58]], { mat: M.staves, seg: 8, capTop: M.void });
    } else for (let i = 0; i < 3; i++) k.blob(0.5 - i * 0.2, 0, 0.36 + i * 0.05, 0.08, 0.06, 0.07, { mat: M.block, detail: 0, lump: 0.25, flat: 0, seed: i });
    return { foot: [0.9, 0.9] };
  },

  // ---------------------------------------------------------------- cloth on the floor (dressing.js decals)
  /**
   * A rug. The reviewer's "flat orange panel" in 'room-crypt' (round 1, P5) was the painted rug decal:
   * a saturated red field in a gold frame, lying at a wall foot straight under a torch, which is exactly
   * what a lit panel looks like. Now it is cloth two texels thick, dyed a muted colour, with a gilt border,
   * a pale medallion, a fringe at both ends and — from variant 1 — a ruck where it has been kicked up.
   * Its contact shadow is faint: a rug lies on the floor, it does not stand on it.
   */
  rug(k, v) {
    const W = 0.86, D = 0.6, T = 0.02;
    // ON THE SMOOTH SLATE CELL, NOT THE CLOTH ONE (round 3 audit, 'wayshrine' seed 42 depth 2): the cloth
    // cell is a saturated red, and at any tint a rug on it under candlelight read as a glowing red panel —
    // the same fault the crypt bunks had. Slate is a dull grey, so these tints are the rug's own colour.
    // darker dyes (reviewer round 3, P12: "flat pastel cards", the slate rug at the floor's own value)
    const field = [[0.92, 0.5, 0.48], [0.52, 0.6, 0.88], [0.82, 0.62, 0.44]][v] ?? [0.92, 0.5, 0.48];
    const dim = [field[0] * 0.72, field[1] * 0.72, field[2] * 0.72];
    k.box(-W / 2, 0, -D / 2, W / 2, T, D / 2, { mat: M.slate, tint: field, grain: 'x' });
    // the weave: a one-texel darker thread every three texels across the field
    const weave = [field[0] * 0.78, field[1] * 0.78, field[2] * 0.78], worn = [field[0] * 0.52, field[1] * 0.52, field[2] * 0.52];
    for (let z = -D / 2 + 0.08; z < D / 2 - 0.08; z += 3 / 32) k.box(-W / 2 + 0.09, T, z, W / 2 - 0.09, T + 0.002, z + 1 / 32, { mat: M.slate, tint: weave });
    // the worn edge: a dark band round the whole rug, outside the gilt border
    for (const [x0, z0, x1, z1] of [[-W / 2, -D / 2, W / 2, -D / 2 + 0.04], [-W / 2, D / 2 - 0.04, W / 2, D / 2], [-W / 2, -D / 2, -W / 2 + 0.04, D / 2], [W / 2 - 0.04, -D / 2, W / 2, D / 2]]) {
      k.box(x0, T, z0, x1, T + 0.003, z1, { mat: M.slate, tint: worn });
    }
    const b = 0.035, i0 = 0.05;
    for (const [x0, z0, x1, z1] of [
      [-W / 2 + i0, -D / 2 + i0, W / 2 - i0, -D / 2 + i0 + b], [-W / 2 + i0, D / 2 - i0 - b, W / 2 - i0, D / 2 - i0],
      [-W / 2 + i0, -D / 2 + i0, -W / 2 + i0 + b, D / 2 - i0], [W / 2 - i0 - b, -D / 2 + i0, W / 2 - i0, D / 2 - i0],
    ]) k.box(x0, T, z0, x1, T + 0.004, z1, { mat: M.gold, tint: 0.78 });
    k.with(at(rotY(Math.PI / 4), 0, T, 0), () => {
      k.box(-0.11, 0, -0.11, 0.11, 0.005, 0.11, { mat: M.linen, tint: 1.0 });
      k.box(-0.05, 0.005, -0.05, 0.05, 0.009, 0.05, { mat: M.gold, tint: 0.85 });
    });
    for (const sx of [-1, 1]) for (let z = -D / 2 + 0.05; z <= D / 2 - 0.04; z += 0.07) {
      k.box(sx > 0 ? W / 2 : -W / 2 - 0.05, 0, z - 0.012, sx > 0 ? W / 2 + 0.05 : -W / 2, 0.012, z + 0.012, { mat: M.linen, tint: 1.1 });
    }
    if (v >= 1) k.with(at(rotX(Math.PI / 2), 0.2, 0, -D / 2), () => k.lathe(0, 0, [[0.04, 0], [0.04, D]], { mat: M.slate, seg: 8, tint: dim, ao: false }));
    return { foot: [W, D], weight: 0.3 };
  },

  /** A runner: the rug's long cousin, laid tile to tile, bordered down its long sides only so a run joins. */
  runner(k, v) {
    const L = 1.0, D = 0.44, T = 0.02;
    const field = v >= 1 ? [0.82, 0.62, 0.44] : [0.92, 0.5, 0.48];
    k.box(-L / 2, 0, -D / 2, L / 2, T, D / 2, { mat: M.slate, tint: field, grain: 'x' });
    const weave = [field[0] * 0.78, field[1] * 0.78, field[2] * 0.78], worn = [field[0] * 0.52, field[1] * 0.52, field[2] * 0.52];
    for (let z = -D / 2 + 0.08; z < D / 2 - 0.08; z += 3 / 32) k.box(-L / 2, T, z, L / 2, T + 0.002, z + 1 / 32, { mat: M.slate, tint: weave });
    for (const sz of [-1, 1]) k.box(-L / 2, T, sz > 0 ? D / 2 - 0.035 : -D / 2, L / 2, T + 0.003, sz > 0 ? D / 2 : -D / 2 + 0.035, { mat: M.slate, tint: worn });
    for (const sz of [-1, 1]) k.box(-L / 2, T, sz > 0 ? D / 2 - 0.075 : -D / 2 + 0.04, L / 2, T + 0.004, sz > 0 ? D / 2 - 0.04 : -D / 2 + 0.075, { mat: M.gold, tint: 0.78 });
    k.with(at(rotY(Math.PI / 4), 0, T, 0), () => k.box(-0.07, 0, -0.07, 0.07, 0.005, 0.07, { mat: M.gold, tint: 0.8 }));
    return { foot: [L, D], weight: 0.3 };
  },

  // ---------------------------------------------------------------- the scatter (dressing.js §5.1/5.2)
  skull(k, v) {
    clutter.skull(k, 0, 0, 0, [0.35, -0.6, 1.3][v] ?? 0, 1.35);
    if (v >= 1) clutter.bone(k, 0.14, 0.12, 0, 0.7, 0.2);
    if (v >= 2) clutter.bone(k, -0.16, 0.08, 0, -0.4, 0.16, 0.9);
    return { foot: [0.26, 0.24], weight: 1.25, rim: true };
  },

  /**
   * THREE SKULLS, NOT SIX (reviewer round 2, P9: "the eyes read as a black-square QR pattern"). Six
   * identical skulls packed shoulder to shoulder were a grid of black sockets. Three, each different —
   * a big one square to the camera, a smaller one tilted with a chipped socket, one lying jawless on
   * top of them — with a few long bones, so every face is a separate thing.
   */
  skullPile(k, v) {
    clutter.bone(k, -0.2, 0.2, 0, 0.4, 0.24); clutter.bone(k, 0.18, 0.22, 0, -0.9, 0.2); clutter.bone(k, 0.02, -0.18, 0, 1.4, 0.22, 0.9);
    clutter.skull(k, -0.12, 0.05, 0, -0.12, 1.2);
    clutter.skull(k, 0.15, 0.08, 0, 0.18, 1.0, { tilt: -0.3, broken: true, tint: [0.84, 0.84, 0.86] });
    if (v < 2) clutter.skull(k, 0.0, -0.08, 0.13, 0.05, 0.9, { tilt: 0.45, noJaw: true, socket: 0.034, tint: [0.95, 0.95, 0.97] });
    return { foot: [0.5, 0.42], weight: 1.25, rim: true };
  },

  bones(k, v) {
    const r = createRng(`kit:bones:${v}`);
    const n = [4, 5, 6, 7][v] ?? 5;
    for (let i = 0; i < n; i++) clutter.bone(k, r.float(-0.32, 0.32), r.float(-0.3, 0.3), 0, r.float(0, Math.PI), r.float(0.18, 0.3), r.float(0.85, 1.05));
    if (v >= 1) clutter.bone(k, 0, 0, 0.03, 0.8, 0.3); // one crossed over another
    if (v >= 2) clutter.skull(k, r.float(-0.2, 0.2), r.float(-0.15, 0.15), 0, r.float(-1, 1), 1.05);
    return { foot: [0.7, 0.62], weight: 1.2, rim: true };
  },

  scree(k, v) {
    const r = createRng(`kit:scree:${v}`);
    for (let i = 0; i < 5 + v * 2; i++) {
      const s = r.float(0.05, 0.1);
      k.blob(r.float(-0.32, 0.32), 0, r.float(-0.3, 0.3), s, s * 0.7, s * 0.85, { mat: M.block, detail: 0, lump: 0.25, flat: 0, seed: i + 13, tint: r.float(0.62, 0.84) });
    }
    return { foot: [0.64, 0.6], weight: 1.2, rim: true };
  },

  coins(k, v) {
    const r = createRng(`kit:coins:${v}`);
    for (let i = 0; i < 6 + v * 3; i++) k.with(at(rotX(r.float(-0.3, 0.3)), r.float(-0.28, 0.28), 0, r.float(-0.24, 0.24)), () => k.lathe(0, 0, [[0.045, 0], [0.045, 0.014]], { mat: M.gold, seg: 7, capTop: M.coins, tint: 1.1 }));
    if (v >= 1) clutter.coins(k, 0.05, 0.02, 0, 4);
    return { foot: [0.5, 0.44], weight: 1.0, rim: true };
  },

  candlestick(k, v) {
    const flames = [];
    k.lathe(0, 0, [[0.1, 0], [0.08, 0.03], [0.03, 0.05], [0.028, 0.2], [0.07, 0.23]], { mat: M.gold, seg: 8, capTop: true, tint: 0.85 });
    if (v < 2) clutter.candle(k, 0, 0, 0.23, v === 0 ? 0.18 : 0.08, flames, 0.13);
    else k.with(at(rotZ(1.4), 0.12, 0.03, 0.06), () => k.lathe(0, 0, [[0.032, 0], [0.03, 0.14]], { mat: M.bone, seg: 6, capTop: true }));
    return { foot: [0.22, 0.22], flames, pool: v < 2 ? [0xffe0a0, 0.42, 0.07] : null };
  },

  bottles(k, v) {
    const cols = [GREEN, RED, BLUE, PURPLE];
    const spots = [[-0.1, -0.04, 0.24], [0.08, -0.08, 0.2], [0.02, 0.1, 0.17], [0.16, 0.08, 0.14]];
    spots.slice(0, 4 - Math.min(2, v)).forEach(([x, z, h], i) => k.lathe(x, z, [[0.06, 0], [0.07, h * 0.45], [0.03, h * 0.72], [0.028, h]], { mat: M.glass, seg: 7, capTop: M.leather, tint: cols[i] }));
    if (v >= 1) k.with(at(rotZ(1.5), -0.2, 0.06, 0.14), () => k.lathe(0, 0, [[0.05, 0], [0.06, 0.08], [0.025, 0.16]], { mat: M.glass, seg: 7, tint: TEAL }));
    return { foot: [0.4, 0.34] };
  },

  tankards(k, v) {
    clutter.mug(k, -0.1, 0, 0, 1, 1.5);
    if (v === 0) clutter.mug(k, 0.12, 0.08, 0, 0.9, 1.4);
    else k.with(at(rotZ(1.57), 0.16, 0.07, 0.06), () => clutter.mug(k, 0, 0, 0, 0.9, 1.4));
    return { foot: [0.36, 0.28] };
  },

  dice(k, v) {
    for (const [x, z, ry] of [[-0.05, 0, 0.3], [0.07, 0.05, -0.5]]) k.with(at(rotY(ry), x, 0, z), () => k.box(-0.035, 0, -0.035, 0.035, 0.07, 0.035, { mat: M.bone, bevel: T32, tint: 1.1 }));
    if (v === 0) clutter.mug(k, 0.02, -0.12, 0, 0.9, 1.1);
    return { foot: [0.24, 0.2], weight: 1.0, rim: true };
  },

  stalagmite(k, v) {
    const h = [0.95, 0.72, 0.5, 0.3][v] ?? 0.5;
    k.lathe(0, 0, [[0.26, 0], [0.18, h * 0.3], [0.09, h * 0.7], [0.02, h]], { mat: M.rock, seg: 7, jag: 0.12, capTop: M.rock, tint: 1.25 });
    k.lathe(0.2, 0.12, [[0.1, 0], [0.05, h * 0.4], [0.01, h * 0.5]], { mat: M.rock, seg: 5, jag: 0.15, tint: 0.9 });
    return { foot: [0.56, 0.5] };
  },

  dripstone(k, v) {
    const r = createRng(`kit:drip:${v}`);
    for (let i = 0; i < 4 - Math.min(2, v); i++) {
      const x = r.float(-0.22, 0.22), z = r.float(-0.2, 0.2), h = r.float(0.14, 0.34);
      k.lathe(x, z, [[0.08, 0], [0.04, h * 0.6], [0.01, h]], { mat: M.rock, seg: 5, jag: 0.12, tint: r.float(0.85, 1.05) });
    }
    k.blob(0, 0, 0, 0.3, 0.02, 0.26, { mat: M.slate, detail: 1, lump: 0.2, flat: 0, tint: [0.8, 0.95, 1.1] });
    return { foot: [0.56, 0.5], weight: 0.6 };
  },

  /**
   * Rime as a solid thing (reviewer round 1, P2: the painted rime decal was pale speckle on a pale
   * floor). A crust of flat ice plates with shards standing out of it, pale blue, with the scatter's
   * dark rim and a heavy contact shadow so it sits ON the stone.
   */
  rime(k, v) {
    const r = createRng(`kit:rime:${v}`);
    for (let i = 0; i < 6; i++) k.blob(r.float(-0.26, 0.26), 0, r.float(-0.22, 0.22), r.float(0.08, 0.14), 0.025, r.float(0.06, 0.11), { mat: M.glass, detail: 1, lump: 0.25, flat: 0, under: 0.8, seed: i + 21, tint: [0.72, 0.86, 1.0] });
    for (let i = 0; i < 5 + v * 2; i++) {
      const h = r.float(0.08, 0.2);
      k.lathe(r.float(-0.24, 0.24), r.float(-0.2, 0.2), [[0.04, 0], [0, h]], { mat: M.glass, seg: 4, tint: [0.82, 0.95, 1.1], phase: r.float(0, 1) });
    }
    return { foot: [0.62, 0.52], weight: 1.1, rim: true };
  },

  mushroomCluster(k, v) {
    const r = createRng(`kit:shroom:${v}`);
    const caps = v >= 2 ? [TEAL, [0.7, 1.3, 1.0]] : [RED, TAN, [1.2, 0.8, 0.55]];
    for (let i = 0; i < 5; i++) {
      const x = r.float(-0.2, 0.2), z = r.float(-0.16, 0.16), h = r.float(0.08, 0.2), cr = r.float(0.06, 0.11);
      k.lathe(x, z, [[0.03, 0], [0.025, h]], { mat: M.bone, seg: 6 });
      k.blob(x, h, z, cr, cr * 0.55, cr, { mat: M.clay, detail: 1, lump: 0.08, under: 0.3, flat: h - 0.01, tint: r.pick(caps) });
    }
    return { foot: [0.46, 0.38], pool: v >= 2 ? [0x7fe3a8, 0.4, 0.09] : null };
  },
};

// ------------------------------------------------------------------------------ the wall pieces
/**
 * WHAT HANGS ON A WALL, SEEN FROM ABOVE.
 *
 * At this tilt a wall's face is ~20 screen pixels, so the painted plates were stretched up past the
 * wall's top edge and came out lying on the wall top — rugs and plaques on the masonry (the reviewer's
 * baseline, and `dressing.js`'s own note says as much). Only three kinds of thing read from overhead:
 * a flame, cloth that hangs out over the foot of the wall, and a bracket. So those are built, leaning
 * out from the top edge of the face in a plane most of the way to the camera's, and every other hung
 * type builds an EMPTY group: the entry still exists, still counts and still round-trips, it simply is
 * not drawn over the stone. Local frame: origin on the wall face at the floor, +z out into the room.
 */
const WALL_TOP = 0.8;
const LEAN = -0.93;   // rotX: local -y hangs along (0, -0.6, 0.8), down and out over the floor
const WALL = {
  banner(k, v) {
    const L = [0.5, 0.46, 0.38, 0.3][v] ?? 0.4, W = 0.3;
    k.box(-0.21, WALL_TOP - 0.03, 0.0, 0.21, WALL_TOP + 0.03, 0.07, { mat: M.dark, bevel: T32 });
    for (const sx of [-1, 1]) k.lathe(sx * 0.22, 0.035, [[0.035, WALL_TOP - 0.02], [0.04, WALL_TOP + 0.02], [0, WALL_TOP + 0.06]], { mat: M.gold, seg: 6 });
    k.with(at(rotX(LEAN), 0, WALL_TOP, 0.05), () => {
      k.box(-W / 2, -L, 0, W / 2, 0, 0.025, { mat: M.cloth, tint: v >= 3 ? 0.75 : 1.08 });
      for (const sx of [-1, 1]) k.box(sx > 0 ? W / 2 - 0.035 : -W / 2, -L, 0.025, sx > 0 ? W / 2 : -W / 2 + 0.035, 0, 0.03, { mat: M.gold, tint: 0.9 });
      k.box(-0.07, -L * 0.55, 0.025, 0.07, -L * 0.3, 0.035, { mat: M.gold, bevel: T32 });           // the device
      k.box(-0.025, -L * 0.62, 0.025, 0.025, -L * 0.22, 0.036, { mat: M.gold, tint: 1.1 });
      if (v < 2) for (const sx of [-1, 1]) k.box(sx > 0 ? 0.01 : -W / 2, -L - 0.08, 0, sx > 0 ? W / 2 : -0.01, -L, 0.025, { mat: M.cloth, tint: 0.95 });
    });
    return {};
  },
  /**
   * HANGS OVER THE WALL FOOT (reviewer round 1, P7: "reads as a rug on the wall top"; round 2 still read
   * the pair in 'room-crypt' as flat orange panels). The drop runs down the wall face from a dark rod
   * with gilt finials — this camera shows the face as a band about seven texels tall — and its hem has
   * piled on the floor in a short fold with a shadow under it. The cloth is dyed DARK: a bright cloth
   * directly under a wall torch came back as one flat orange rectangle. A gilt border down both edges and
   * a gilt lozenge are what say "woven hanging" rather than "panel".
   */
  tapestry(k, v) {
    const W = 0.62;
    const tint = [[0.5, 0.58, 1.05], [0.56, 0.9, 0.56], [0.78, 0.58, 0.48]][v] ?? [0.7, 0.62, 0.6];
    const fold = [tint[0] * 0.82, tint[1] * 0.82, tint[2] * 0.82];
    k.box(-W / 2 - 0.06, WALL_TOP - 0.03, 0, W / 2 + 0.06, WALL_TOP + 0.03, 0.06, { mat: M.dark, bevel: T32, tint: 0.8 });   // the rod
    for (const sx of [-1, 1]) k.lathe(sx * (W / 2 + 0.07), 0.03, [[0.04, WALL_TOP - 0.03], [0.045, WALL_TOP + 0.03], [0, WALL_TOP + 0.07]], { mat: M.gold, seg: 6 });
    k.box(-W / 2, 0.1, 0.03, W / 2, WALL_TOP - 0.02, 0.05, { mat: M.cloth, tint });                                          // the drop
    for (const sx of [-1, 1]) k.box(sx > 0 ? W / 2 - 0.035 : -W / 2, 0.1, 0.05, sx > 0 ? W / 2 : -W / 2 + 0.035, WALL_TOP - 0.02, 0.056, { mat: M.gold, tint: 0.8 });
    k.with(at(rotZ(Math.PI / 4), 0, 0.47, 0.05), () => k.box(-0.09, -0.09, 0, 0.09, 0.09, 0.008, { mat: M.gold, tint: 0.95 }));   // the lozenge
    k.box(-W / 2, 0, 0.03, W / 2, 0.1, 0.08, { mat: M.cloth, bevel: T32, tint: fold });                                      // the bend
    k.box(-W / 2 - 0.02, 0, 0.08, W / 2 + 0.02, 0.03, 0.2, { mat: M.cloth, bevel: T32, tint: fold });                        // the fold
    k.box(-W / 2 - 0.02, 0, 0.2, W / 2 + 0.02, 0.02, 0.23, { mat: M.gold, tint: 0.75 });                                     // the fringe
    return { shadow: [W + 0.12, 0.26, 0.17] };
  },
  sconce(k, v) {
    k.box(-0.06, WALL_TOP - 0.2, 0, 0.06, WALL_TOP, 0.03, { mat: M.iron, bevel: T32, tint: 1.3 });
    k.box(-0.025, WALL_TOP - 0.1, 0.03, 0.025, WALL_TOP - 0.05, 0.16, { mat: M.iron, tint: 1.2 });
    k.lathe(0, 0.17, [[0.03, WALL_TOP - 0.08], [0.07, WALL_TOP + 0.02]], { mat: M.iron, seg: 6, tint: 1.3, capTop: v >= 2 ? M.void : M.bark, ao: false });
    return {};
  },
  hungShield(k, v) {
    k.with(at(rotX(0.64), 0, WALL_TOP - 0.12, 0.16), () => {
      const tint = [RED, BLUE, GREEN, [0.8, 0.8, 0.8]][v] ?? RED;
      k.lathe(0, 0, [[0.2, 0], [0.2, 0.025]], { mat: M.iron, seg: 12, tint: 1.3, capTop: M.cloth, ao: false });
      k.lathe(0, 0, [[0.06, 0.025], [0.04, 0.06], [0, 0.07]], { mat: M.gold, seg: 8, ao: false });
      k.box(-0.018, 0.025, -0.17, 0.018, 0.035, 0.17, { mat: M.gold, tint: 0.9 });
      k.box(-0.17, 0.025, -0.018, 0.17, 0.035, 0.018, { mat: M.gold, tint: 0.9 });
      void tint;
    });
    return {};
  },
};

/**
 * Floor decals deliberately not drawn. The entries survive in level.decor exactly like an undrawn wall piece.
 *  · crackedFlags was a painted zigzag that read as a UI glyph (reviewer round 1, P2); the floor field
 *    already paints cracked stones.
 *  · mosaic was a flat painted lattice of gold tesserae that read as "broken placeholder sprites or
 *    scaffolding" beside the solid benches and candelabra of a wayshrine (reviewer round 4, P16, found with
 *    a scene pick). The temple's own mosaic rings are painted by the floor field, which is where inlay belongs.
 */
export const UNDRAWN_DECAL_TYPES = ['crackedFlags', 'mosaic'];
/** Types that hang on a wall and are deliberately not drawn (see the note above WALL). */
export const UNDRAWN_WALL_TYPES = ['plaque', 'trophyArms', 'chains', 'manacles', 'cobweb', 'skullNiche', 'ossuaryShelf', 'ironRing', 'gargoyleSpout', 'wallShelf', 'wallCrack', 'mould', 'fungusShelf'];

/**
 * One wall entry. Placed by the caller at the wall FACE (DungeonView.addDecor), exactly where the
 * painted plate was, and turned here to look along `facing`.
 */
export function buildKitWall(type, o = {}, spec = null) {
  const vmax = spec && spec.v ? spec.v - 1 : 3;
  const v = Math.max(0, Math.min(vmax, o.variant | 0));
  const facing = YAW[o.facing] !== undefined ? o.facing : 's';
  const g = new THREE.Group();
  const build = WALL[type];
  if (build) {
    const key = `wall:${type}:${v}`;
    let rec = geoCache.get(key);
    if (!rec) {
      const k = new KitBuilder({ shear: 0 });
      k.seed = type.length * 53 + v;
      const info = build(k, v) || {};
      rec = { geo: k.build(), info };
      geoCache.set(key, rec);
    }
    const inner = new THREE.Group();
    inner.rotation.y = YAW[facing];
    const mesh = new THREE.Mesh(rec.geo, materials());
    mesh.castShadow = false; mesh.receiveShadow = false;
    inner.add(mesh);
    if (rec.info.shadow) {
      const [sw, sd, sz] = rec.info.shadow;
      const sh = contactShadow(1, { strength: 0.7 });
      sh.scale.set(sw, sd, 1);
      sh.position.set(0.03, 0.013, sz);
      inner.add(sh);
    }
    g.add(inner);
  }
  g.userData.decor = { type, variant: v, facing, cls: 'wall', kit: true, drawn: !!build };
  g.userData.mountY = spec ? spec.mount || 0 : 0;
  g.userData.blocking = false;
  return g;
}

/** A wall torch: a bracket on the face and a burning head proud of the top edge (props.js `torch`). */
export function buildKitTorchGeometry() {
  let geo = geoCache.get('torch');
  if (geo) return geo;
  // local frame: origin on the wall face at y = 0 of the group, which lighting.js puts at 0.62
  const k = new KitBuilder({ shear: 0 });
  k.box(-0.07, -0.16, 0, 0.07, 0.14, 0.03, { mat: M.iron, bevel: T32, tint: 0.75 });
  k.box(-0.03, -0.04, 0.03, 0.03, 0.02, 0.15, { mat: M.iron, tint: 0.7 });
  k.with(at(rotX(0.35), 0, 0.0, 0.14), () => {
    k.lathe(0, 0, [[0.03, -0.12], [0.034, 0.12]], { mat: M.leather, seg: 6, tint: 0.9 });
    k.lathe(0, 0, [[0.05, 0.1], [0.075, 0.2], [0.08, 0.24]], { mat: M.iron, seg: 7, tint: 0.8, capTop: M.ember, ao: false });
  });
  geo = k.build();
  geoCache.set('torch', geo);
  return geo;
}
/**
 * THE MOUTH OF A PIT (reviewer rounds 3-4, P13: "a grey speckled dome with a red crescent"). From this
 * camera a pit's shaft shows its far wall, and whatever the fog of war did to that wall and to the ember
 * haze read as a dome. So the hole is capped a hair below its own lip with what a player should see:
 *  · a black core the width of the hole (the lip's sagging inner edge overlaps and hides its rim);
 *  · embers glowing inside it, on the unlit glow material, so they stay hot in any light;
 *  · a crescent of lit, bevelled stones on the NORTH lip, the edge the camera looks past into the pit.
 * Built unsheared and cached; DungeonView places one at every pit tile. The shaft below still exists (a
 * fall still has somewhere to go) but it no longer draws the picture.
 */
export function buildKitPitCap() {
  let geo = geoCache.get('pitcap');
  if (geo) return geo;
  const k = new KitBuilder({ shear: 0 });
  k.seed = 6060;
  k.lathe(0, 0, [[0.47, -0.05], [0.47, -0.049]], { mat: M.void, seg: 20, capTop: M.void, shade: false, tint: 0.35, ao: false });
  const embers = [[-0.12, 0.06, 0.07], [0.1, 0.1, 0.06], [0.02, -0.04, 0.08], [-0.05, 0.17, 0.05], [0.17, -0.02, 0.05], [-0.18, -0.07, 0.045]];
  embers.forEach(([ex, ez, r], i) => k.blob(ex, -0.046, ez, r, 0.012, r * 0.8, { mat: M.ember, detail: 1, lump: 0.25, flat: -0.047, shade: false, seed: 70 + i }));
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (1.15 + i * 0.7 / 6), r = 0.43;
    k.with(at(rotY(-(a + Math.PI / 2)), Math.cos(a) * r, 0, Math.sin(a) * r), () =>
      k.box(-0.05, -0.03, -0.035, 0.05, 0.028, 0.035, { mat: M.block, bevel: T32, tint: 1.3 + (i % 2) * 0.08 }));
  }
  geo = k.build();
  geoCache.set('pitcap', geo);
  return geo;
}

/** The kit's snapped materials, for pieces built outside `buildKitProp` (the torch). */
export function kitPropMaterials() { return materials(); }

/**
 * The temple altar (props.js `altar`): a two-step marble dais, a carved block with a gold inlay and a
 * red runner spilling over its front, candles, and a gold cross standing up the screen. It replaces
 * the mosaic ring the reviewer read as a UI reticle; it is still the brightest, most golden object in
 * any room it stands in, which is what keeps it easy to find.
 * @returns {{mesh: THREE.Mesh, flames: THREE.Mesh[], cross: number[]}}
 */
export function buildKitAltar() {
  let rec = geoCache.get('altar');
  if (!rec) {
    const k = new KitBuilder();
    k.seed = 777;
    const flameSpots = [];
    // P6 (reviewer round 1: "legible but small and thin, reads as wall dressing"). A block a tile and a
    // quarter wide on a two-step plinth, pushed a little south of its tile so the cabinet shear leans
    // it back toward the wall without climbing onto the wall top; a squat cross instead of a pole.
    k.with(at(new THREE.Matrix4(), 0, 0, 0.14), () => {
      // GREY STONE ALL THE WAY UP (reviewer round 2, P6b: "the top is a blank white sheet that reads as a bed")
      k.box(-0.64, 0, -0.44, 0.64, 0.08, 0.44, { mat: M.block, bevel: 2 * T32, tint: 0.9, frontK: 0.85 });
      k.box(-0.56, 0.08, -0.36, 0.56, 0.16, 0.36, { mat: M.block, bevel: T32, tint: 0.94, frontK: 0.85 });
      k.box(-0.46, 0.16, -0.26, 0.46, 0.5, 0.26, { mat: M.block, bevel: 2 * T32, tint: 0.9, frontK: 0.85 });
      k.box(-0.32, 0.22, 0.26, 0.32, 0.44, 0.276, { mat: M.gold, bevel: T32 });                         // inlay
      k.box(-0.12, 0.27, 0.276, 0.12, 0.39, 0.284, { mat: M.marble, tint: 0.95 });
      k.box(-0.52, 0.5, -0.31, 0.52, 0.58, 0.31, { mat: M.block, bevel: 2 * T32, tint: 0.92, frontK: 0.85 });   // the mensa: stone, bevelled
      for (const [x0, z0, x1, z1] of [[-0.44, -0.24, 0.44, -0.21], [-0.44, 0.21, 0.44, 0.24], [-0.44, -0.24, -0.41, 0.24], [0.41, -0.24, 0.44, 0.24]]) {
        k.box(x0, 0.58, z0, x1, 0.585, z1, { mat: M.gold, tint: 0.85 });                                // the inlay border
      }
      k.box(-0.11, 0.58, -0.31, 0.11, 0.592, 0.31, { mat: M.cloth, tint: 0.9 });                         // runner
      k.box(-0.14, 0.36, 0.31, 0.14, 0.592, 0.322, { mat: M.cloth, tint: 0.95 });
      for (const sx of [-1, 1]) k.box(sx > 0 ? 0.105 : -0.14, 0.36, 0.322, sx > 0 ? 0.14 : -0.105, 0.592, 0.326, { mat: M.gold, tint: 0.9 });
      k.cbox(0, -0.16, 0.08, 0.08, 0.592, 0.77, { mat: M.gold, bevel: T32 });                            // the cross, squat: taller read as a staff
      k.cbox(0, -0.16, 0.22, 0.08, 0.66, 0.72, { mat: M.gold, bevel: T32 });
      k.lathe(0, -0.16, [[0.09, 0.592], [0.06, 0.63]], { mat: M.gold, seg: 8, capTop: true, tint: 0.85 });
      for (const sx of [-0.38, 0.38]) clutter.candle(k, sx, 0.1, 0.592, 0.12, flameSpots, 0.12);
    });
    for (const f of flameSpots) f[2] += 0.14;
    rec = { geo: k.build(), flames: flameSpots.map(([x, y, z, s]) => ({ p: k.place(x, y, z), s })), cross: k.place(0, 0.69, -0.02) };
    geoCache.set('altar', rec);
  }
  const mesh = new THREE.Mesh(rec.geo, materials());
  mesh.castShadow = true; mesh.receiveShadow = false;
  const flames = rec.flames.map((f) => { const fl = flame(f.s, 1.7, { spherical: true }); fl.position.set(f.p[0], f.p[1] - f.s * 0.12, f.p[2]); return fl; });
  return { mesh, flames, cross: rec.cross };
}

// ------------------------------------------------------------------------------ assembly
const geoCache = new Map();

/** Is `type` served by the solid kit? */
export function isKitProp(type) { return Object.prototype.hasOwnProperty.call(PIECES, type); }
export const KIT_TYPES = Object.keys(PIECES);

let snapped = null;
/** One texel, in world units: the rim's offset down and to the right. */
const RIM = 1 / 32;
let rimMats = null;
function rimMaterials() {
  if (rimMats) return rimMats;
  const m = new THREE.MeshBasicMaterial({ color: 0x120c10, depthWrite: false });
  const fog = getFog();
  if (fog) { patchFog(m, fog); m.customProgramCacheKey = () => 'fogofwar-v2|kitrim'; }
  pixelSnap(m, { rigid: true });
  rimMats = [m, m];
  return rimMats;
}
function materials() {
  if (!snapped) snapped = kitMaterials().map((m) => pixelSnap(m, { rigid: true }));
  return snapped;
}

/**
 * One decor entry as a solid prop, ready for DungeonView.addAt.
 * @param {string} type @param {{variant?:number, facing?:string, blocking?:boolean, span?:number}} o
 * @param {{v:number, blk?:boolean}} [spec] the catalogue entry (variant count, may-block)
 * @returns {THREE.Group|null}
 */
export function buildKitProp(type, o = {}, spec = null) {
  const build = PIECES[type];
  if (!build) return null;
  const vmax = spec && spec.v ? spec.v - 1 : 3;
  const v = Math.max(0, Math.min(vmax, o.variant | 0));
  const facing = YAW[o.facing] !== undefined ? o.facing : 's';
  const span = Math.max(1, o.span | 0);
  const key = `${type}:${v}:${facing}:${span}`;
  let rec = geoCache.get(key);
  if (!rec) {
    const k = new KitBuilder();
    k.seed = (type.length * 131 + v * 17) | 0;
    let info;
    const yaw = YAW[facing];
    const along = span > 1 ? (facing === 'e' || facing === 'w' ? [0, (span - 1) / 2] : [(span - 1) / 2, 0]) : [0, 0];
    k.with(at(rotY(yaw), along[0], 0, along[1]), () => { info = build(k, v, { span }) || {}; });
    const flames = (info.flames || []).map(([x, y, z, s]) => ({ p: k.withPlace(yaw, along, x, y, z), s }));
    rec = { geo: k.build(), info, flames, yaw, along };
    geoCache.set(key, rec);
  }
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(rec.geo, materials());
  mesh.castShadow = true; mesh.receiveShadow = false;
  mesh.name = `kit:${type}`;
  g.add(mesh);
  if (rec.info.rim) {
    // THE SHADOW-SIDE RIM (reviewer round 1, P2): the same geometry in flat near-black, one texel down
    // and right. It is drawn after the floor and BEFORE the piece (renderOrder 1 then 2) without writing
    // depth, so the piece paints over all of it except the one-texel sliver it overhangs, on the side away
    // from the key light — which is where a pale bone on a pale flagstone needed an edge.
    const rim = new THREE.Mesh(rec.geo, rimMaterials());
    rim.position.set(RIM, 0, RIM);
    rim.renderOrder = 1; rim.castShadow = false; rim.receiveShadow = false;
    mesh.renderOrder = 2;
    g.add(rim);
  }
  // the contact shadow: the footprint, turned with the piece, a touch wider and pushed a hair south so
  // a rim of it shows at the foot of the front face — the only side of the base the camera sees
  const [fw, fd] = rec.info.foot || [0.6, 0.6];
  const turned = facing === 'e' || facing === 'w';
  const sh = contactShadow(1, { strength: Math.min(1, 0.72 * (rec.info.weight ?? 1)) });
  const cz = rec.info.z || 0;
  const lz = turned ? 0 : cz * (facing === 'n' ? -1 : 1), lx = turned ? cz * (facing === 'e' ? -1 : 1) : 0;
  sh.scale.set((turned ? fd : fw) * 1.22, (turned ? fw : fd) * 1.2, 1);
  sh.position.set(rec.along[0] + lx + 0.03, 0.013, rec.along[1] + lz + 0.05);
  g.add(sh);
  for (const f of rec.flames) {
    const fl = flame(f.s, 1.7, { spherical: true });
    fl.position.set(f.p[0], f.p[1] - f.s * 0.12, f.p[2]);
    g.add(fl);
  }
  if (rec.info.pool) {
    const [c, rad, op] = rec.info.pool;
    const pool = groundGlow(c, rad, { opacity: op });
    pool.position.x = rec.along[0]; pool.position.z = rec.along[1];
    g.add(pool);
  }
  g.userData.decor = { type, variant: v, facing, cls: 'prop', kit: true, span };
  g.userData.blocking = span > 1 || (!!o.blocking && !!(spec && spec.blk));
  return g;
}

// a flame's world spot inside the built piece: frame (yaw + run offset), then the shear
KitBuilder.prototype.withPlace = function withPlace(yaw, along, x, y, z) {
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(along[0], 0, along[1]);
  const p = new THREE.Vector3(x, y, z).applyMatrix4(m);
  return [p.x, p.y, p.z - this.shear * p.y];
};

// ------------------------------------------------------------------------------ architecture
/**
 * THE DOORWAY ARCHES (DungeonView.addDoorways), cut from pale bevelled blocks.
 *
 * They were instances of `dungeonGeo.archGeometry` in the smooth `cutStone` material — the one
 * untextured grey object at every room mouth. Same footprint and height, now painted stone on the
 * one grid. NOT sheared: an arch stands in the line of the wall it pierces, and the walls are not
 * sheared either, so from above it reads as the wall's own threshold bar and jambs.
 * @param {Array<{x:number, z:number, ry:number, y?:number, s?:number, tint?:number}>} list
 * @returns {THREE.Mesh|null}
 */
export function buildKitArches(list) {
  if (!list || !list.length) return null;
  const k = new KitBuilder({ shear: 0 });
  k.seed = 911;
  for (const a of list) {
    const s = a.s || 1, t = 1.12 * (a.tint || 1);
    const m = new THREE.Matrix4().makeRotationY(a.ry || 0).scale(new THREE.Vector3(s, s, s)).setPosition(a.x, a.y || 0, a.z);
    k.with(m, () => {
      for (const sx of [-1, 1]) {
        k.box(sx * 0.42 - 0.11, 0, -0.16, sx * 0.42 + 0.11, 0.1, 0.16, { mat: M.block, bevel: T32, tint: t * 0.95 });
        k.box(sx * 0.42 - 0.08, 0.1, -0.12, sx * 0.42 + 0.08, 0.88, 0.12, { mat: M.block, bevel: T32, tint: t });
        k.box(sx * 0.42 - 0.11, 0.88, -0.15, sx * 0.42 + 0.11, 0.96, 0.15, { mat: M.block, bevel: T32, tint: t * 1.04 });
      }
      k.box(-0.53, 0.96, -0.14, 0.53, 1.1, 0.14, { mat: M.block, bevel: 2 * T32, tint: t * 1.06, grain: 'x' });
      k.box(-0.1, 0.96, -0.16, 0.1, 1.15, 0.16, { mat: M.block, bevel: T32, tint: t * 1.14 });
    });
  }
  const mesh = new THREE.Mesh(k.build(), materials());
  mesh.castShadow = true; mesh.receiveShadow = false;
  mesh.name = 'kit:arches';
  return mesh;
}

/**
 * Columns: the temple's marble pillars and the pillared halls' stone posts (DungeonView). Same
 * height (1.05 at h = 1) as `dungeonGeo.pillarGeometry`, now painted and bevelled; unsheared for
 * the arches' reason.
 * @param {Array<{x:number, z:number, ry?:number, h?:number, tint?:number}>} list
 * @param {boolean} marble
 * @returns {THREE.Mesh|null}
 */
export function buildKitColumns(list, marble) {
  if (!list || !list.length) return null;
  const k = new KitBuilder({ shear: 0 });
  k.seed = marble ? 313 : 317;
  // (reviewer round 3, P14: the temple's marble capitals were "four flat white squares") both kinds are
  // now the block stone, the temple's at the wall caps' value, with a stepped, bevelled top
  const mat = M.block;
  for (const p of list) {
    const t = (p.tint || 1) * (marble ? 1.0 : 1.18);
    const m = new THREE.Matrix4().makeRotationY(p.ry || 0).scale(new THREE.Vector3(1, p.h || 1, 1)).setPosition(p.x, 0, p.z);
    k.with(m, () => {
      k.box(-0.17, 0, -0.17, 0.17, 0.09, 0.17, { mat, bevel: T32, tint: t * 0.95 });
      k.lathe(0, 0, [[0.14, 0.09], [0.115, 0.18], [0.11, 0.93], [0.15, 0.99]], { mat, seg: 8, tint: t });
      k.box(-0.18, 0.99, -0.18, 0.18, 1.05, 0.18, { mat, bevel: 2 * T32, tint: t * 0.86, frontK: 0.8 });
      k.box(-0.12, 1.05, -0.12, 0.12, 1.08, 0.12, { mat, bevel: T32, tint: t * 1.0, frontK: 0.8 });
    });
  }
  const mesh = new THREE.Mesh(k.build(), materials());
  mesh.castShadow = true; mesh.receiveShadow = false;
  mesh.name = marble ? 'kit:pillars' : 'kit:posts';
  return mesh;
}

/**
 * The treasure chest PICKUP (props.js `chest`/`chestOpen`): the chest family at pickup size — about
 * a tile across on screen, the reviewer's target — with the gold lock and gilt corners that make it
 * loot, where the decor strongbox is grey iron and broken open (AMBIENCE §9).
 * @param {boolean} open
 * @returns {{mesh: THREE.Mesh, glints: number[][]}}
 */
export function buildKitChest(open = false) {
  const key = `pickupChest:${open}`;
  let rec = geoCache.get(key);
  if (!rec) {
    const k = new KitBuilder();
    k.seed = open ? 5151 : 5150;
    const w = 0.8, h = 0.34, d = 0.54;
    // brighter than any furniture oak (the loot has to out-read the room it stands in; the painted
    // pickups beside it carry a little self-light, this carries value instead)
    chestBody(k, { w, h, d, lidH: 0.15, wood: M.oak, band: M.iron, gold: true, open, straps: 2, tint: 1.38 });
    for (const sx of [-1, 1]) {
      k.box(sx * w / 2 - (sx > 0 ? 0.07 : -0.0) - (sx < 0 ? 0.016 : 0), 0.02, d / 2 - 0.02, sx * w / 2 + (sx > 0 ? 0.016 : 0.07), 0.1, d / 2 + 0.022, { mat: M.gold, tint: 1.15 });
      if (!open) k.box(sx * w / 2 - (sx > 0 ? 0.07 : -0.0) - (sx < 0 ? 0.016 : 0), h + 0.06, d / 2 - 0.02, sx * w / 2 + (sx > 0 ? 0.016 : 0.07), h + 0.16, d / 2 + 0.026, { mat: M.gold, tint: 1.15 });
    }
    rec = { geo: k.build(), glints: open ? [k.place(0.1, h + 0.08, 0), k.place(-0.16, h + 0.06, 0.06), k.place(0.02, h + 0.12, -0.04)] : [k.place(0, h + 0.02, d / 2 + 0.04), k.place(0.3, h + 0.16, d / 2)] };
    geoCache.set(key, rec);
  }
  const mesh = new THREE.Mesh(rec.geo, materials());
  mesh.castShadow = true; mesh.receiveShadow = false;
  mesh.name = open ? 'kit:chestOpen' : 'kit:chest';
  return { mesh, glints: rec.glints };
}

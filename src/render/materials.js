// Procedural textures (canvas) and shared materials for the dungeon diorama. Everything is
// generated in code from a seeded RNG; no assets are loaded. Materials are fog-of-war patched
// by lighting.js (see patchFog) so darkness is applied in the shader.
//
// ---------------------------------------------------------------------------------------------
// THE WORLD IS PIXEL-AUTHORED, ON THE SPRITE TEXEL GRID
// ---------------------------------------------------------------------------------------------
// The cast is hand-pixelled at `PX_PER_TILE` = 32 texels per world tile and drawn with NEAREST
// filtering on a whole-pixel grid (sprites/spriteBillboard.js). The floor used to be authored at
// 128 texels per tile with trilinear filtering, so at the default camera — where one sprite texel
// covers exactly 4 device pixels — the hero was square texels standing on bilinear mush. One screen
// at two resolutions is the one thing HD-2D cannot survive.
//
// So every dungeon surface texture is now authored at `TEXELS_PER_TILE` (32) texels per world unit
// and SAMPLED ON THE CAST'S OWN GRID — see "ONE TEXEL, ONE SIZE" below — uploaded with
// NearestFilter and a crisp base level:
//  - the flagstone ATLAS is 8x4 cells of 32x32 TEXELS (256x128 in all). Every texel is placed by
//    hand-style rules — a grout ring, a one-texel bevel, mottle quantised to a seven-step house
//    ramp (sprites/style.js `ramp`), then two or three WEAR MARKS drawn from nine families
//    (crack, chip, spall, pits, scuff, stain, chisel, hollow, inset) with seeded parameters. The
//    old atlas had ONE crack generator and two cracked cells, so the same worm-shaped decal landed
//    on the floor fourteen times a screen. Nine families x 30 slabs x four quarter turns does not
//    repeat inside a room.
//  - a continuous masonry strip, 128x32 texels = 4 tiles wide and exactly one world unit tall,
//    mapped in WORLD units along wall runs so brick courses flow around corners.
//  - a tileable world-space grunge map, sampled on the same 1/32-world texel grid (see
//    patchSurface) so macro variation stays blocky instead of smearing a soft gradient over the
//    pixel structure.
//
// COLOUR IS ONE FAMILY PER DEPTH, NOT PER SLAB. Slabs used to carry an independent random hue tint
// (+-8% red, +-10% blue) so neighbours read olive / pink / tan / blue-grey: noise, not stone. Now
// every slab comes off ONE seven-step ramp with value-only variation, and `stoneFamily(depth)`
// gives the whole level one gentle family multiplier. The colour interest is the torchlight.
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { patchFog } from './lighting.js';
import { ramp } from './sprites/style.js';
import { toRgb } from './sprites/pixelPainter.js';
import { frameTexelSize, texelGrid, PX_PER_TILE } from './sprites/spriteBillboard.js';

/** Palette used by the renderer (linear-space friendly hex values). */
export const PALETTE = {
  stone: 0x8a8078, stoneDark: 0x4d4640, corridor: 0x6e655c, marble: 0xd8d2c4, moss: 0x5d7a3a,
  water: 0x1c4a5e, waterDeep: 0x0b2531, gold: 0xe8b84a, brass: 0xb08d3c, wood: 0x6b4426,
  obsidian: 0x3a3048, ember: 0xff7a1a, holy: 0xbfe6ff, magic: 0x7fd4ff, sword: 0x9fd0ff, swordViolet: 0xc58cff,
  blood: 0x8a1c1c, bone: 0xe6dcc6, iron: 0x9aa0a8, leather: 0x5a3b23, cloth: 0x7a3f2e,
};

/**
 * TEXELS PER WORLD TILE — the one grid the whole game is drawn on. Sprites are hand-pixelled at
 * this density (`PX_PER_TILE` in sprites/spriteBillboard.js) and snapped to whole device pixels;
 * every world texture is authored at the same number so a floor texel and a hero texel cover the
 * same screen pixels at the default camera (4 device pixels each at 1600x900).
 */
export const TEXELS_PER_TILE = 32;

/** Atlas layout shared by materials.js (texture) and dungeon.js (cell choice). 8x4 cells of 32x32 texels. */
export const ATLAS = { cols: 8, rows: 4, cell: TEXELS_PER_TILE };
/**
 * Named atlas cells (index = row * cols + col). Eighteen plain slabs, each carrying its own
 * seeded pick of wear marks, is what keeps a room from reading as one decal stamped over and over.
 */
export const CELLS = {
  plain: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
  cracked: [18, 19, 20, 21], mossy: [22, 23, 24, 25], wet: [26, 27, 28, 29], mosaic: 30, marble: 31,
};
/** UV offset of an atlas cell. */
export function cellUV(i) { return [(i % ATLAS.cols) / ATLAS.cols, 1 - (Math.floor(i / ATLAS.cols) + 1) / ATLAS.rows]; } // canvas textures are Y-flipped on upload

// ------------------------------------------------------------------ ONE TEXEL, ONE SIZE
// THE WORLD RIDES ON THE CAST'S TEXEL GRID.
//
// Authoring the floor at 32 texels per tile is only half of "one screen, one resolution". The cast
// is drawn at ONE INTEGER number of device pixels per texel — `S`, chosen once per frame from the
// camera alone (sprites/spriteBillboard.js `frameTexelSize`) — while a floor nailed to 1/32 of a
// world unit covers the FRACTIONAL `want = pxPerWorld / 32` device pixels per texel. `S` is
// `round(want)`, so the two grids disagreed by however much that rounding moved:
//
//     bestiary +19.7%   bestiary-fighters-close +20.6%   hero-showcase +7.2%
//     combat   -12.4%   deep-level -13.4%                default -13.4%
//
// A fifth of a texel is not subtle: the hero's pixel blocks were a visibly different size from the
// stone grain he stood on, and the flagstones' 3px/4px/3px stagger is exactly the mush the sprite
// billboards go to such lengths to avoid. One screen at two resolutions is the one thing HD-2D
// cannot survive, and it does not care whether the second resolution belongs to the floor.
//
// So the world's texel is no longer 1/32 of a tile. It is `S / pxPerWorld` world units — the SAME
// world size the cast's texel has, so one floor texel is exactly `S` device pixels, exactly like
// one hero texel, measured where the camera is actually looking. `TEXELS_PER_TILE` stays 32: that
// is what the textures are PAINTED at. What moves is how densely they are sampled — `uWorldTexels`
// (K = pxPerWorld / S, ~27-37) is the live number of world texels per world unit, and the surface
// shader snaps its texture lookup to that grid (`patchSurface`, `quant`). The sample point is
// quantised, never the mip level: mip selection still runs off the CONTINUOUS uv derivatives
// (`texture2DGradEXT`), so the floor sits on level 0 — dead crisp — everywhere the game is played,
// and only the far overview zoom, where a texel really is under a pixel, drops into the mip chain
// and stays stable instead of sparkling.
//
// The price is a resample of at most |32/K - 1| (a fifth of a texel at the widest zoom): the odd
// painted texel is doubled or dropped inside a slab. That is the trade every HD-2D game makes, and
// it buys the thing a player actually sees — the stone grain and the hero's pixels are the same
// size blocks on the same grid.
//
// MEASURED AT THE PLAY CAMERA, floor device pixels per texel vs sprite device pixels per texel:
//   default 3 / 3      combat 3 / 3        deep-level 3 / 3
//   hero-showcase 5 / 5   bestiary 2 / 2   dungeon-overview (far stop) 1 / 1
// — every scenario dead level, where they were 13% and 20% apart. At the nominal camera (water,
// temple, camera-zoom-out) `want` is already exactly 4, so K comes out at 32 and nothing moves:
// the authored density was always right, it was the ROUNDING the cast does that the room had to
// follow.
/**
 * THE WORLD'S SHARE OF THE CHARACTER MASK. Sprites write `SPRITE_MASK_ALPHA` (0.35) so the grading
 * pass stops film grain crawling over flat pixel-art colour (renderer.js: <= 0.5 is fully masked,
 * >= 0.8 not at all). Stone is pixel art too, on the same grid, and 1-device-pixel grain over a
 * 3-device-pixel texel is the loudest way to destroy the grid this file exists to build — but the
 * floor is also where grain earns its keep, hiding banding in the big dark washes. 0.55 keeps a
 * whisper of it — about a sixth — where the cast keeps a tenth and the void all of it: measured at
 * 18x on the flagstone under the hero, that is the value where the 3-device-pixel blocks come back
 * as blocks and the frame still reads as film rather than vector.
 */
export const WORLD_MASK_ALPHA = 0.55;

/** The live grid, as uniform objects every patched surface material shares by reference. */
const GRID = {
  /** K: world texels per world unit. `TEXELS_PER_TILE` until the first frame sets it from the camera. */
  uWorldTexels: { value: TEXELS_PER_TILE },
  /** What the world writes into the frame's alpha: the grading pass's "this is pixel art" mask. */
  uWorldMask: { value: WORLD_MASK_ALPHA },
};

/**
 * Put the world on the frame's texel grid. Called once per frame from the dungeon's grid probe
 * (render order -2000, before any surface draws) with the live renderer and scene camera; every
 * material patched by `patchSurface` shares these uniform objects, so one write moves all of them.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Camera} camera
 * @returns {number} K, world texels per world unit
 */
export function syncWorldGrid(renderer, camera) {
  if (!renderer || !camera || !camera.isPerspectiveCamera) return GRID.uWorldTexels.value;
  const S = frameTexelSize(renderer, camera, PX_PER_TILE); // idempotent: the cast reads the same S
  const g = texelGrid();
  // one world texel = S device pixels = one sprite texel, at the depth the camera is looking at
  if (g.pxPerWorld > 0 && S > 0) GRID.uWorldTexels.value = g.pxPerWorld / S;
  return GRID.uWorldTexels.value;
}

/** Read-only snapshot of the world grid (probes, tests, audits). */
export function worldGrid() {
  return { texelsPerTile: GRID.uWorldTexels.value, texelWorld: 1 / GRID.uWorldTexels.value, mask: GRID.uWorldMask.value };
}

const rng = createRng('fargoal-materials');

/** Value-noise generator with a seeded permutation table (plus a periodic variant for tileable maps). */
function makeNoise(r) {
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  r.shuffle(p);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const lattice = (x, y) => perm[(perm[x & 255] + y) & 255] / 255;
  const fade = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = fade(x - xi), fy = fade(y - yi);
    const a = lattice(xi, yi), b = lattice(xi + 1, yi), c = lattice(xi, yi + 1), d = lattice(xi + 1, yi + 1);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  };
  const fbm = (x, y, oct = 4) => {
    let v = 0, amp = 0.5, f = 1, sum = 0;
    for (let i = 0; i < oct; i++) { v += noise(x * f, y * f) * amp; sum += amp; amp *= 0.5; f *= 2; }
    return v / sum;
  };
  /** Noise that repeats every `px` x `py` lattice units (for seamless wrap textures). */
  const pnoise = (x, y, px, py) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = fade(x - xi), fy = fade(y - yi);
    const L = (i, j) => lattice(((i % px) + px) % px, ((j % py) + py) % py);
    const a = L(xi, yi), b = L(xi + 1, yi), c = L(xi, yi + 1), d = L(xi + 1, yi + 1);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  };
  const pfbm = (x, y, period, oct = 4) => {
    let v = 0, amp = 0.5, f = 1, sum = 0;
    for (let i = 0; i < oct; i++) { v += pnoise(x * f, y * f, period * f, period * f) * amp; sum += amp; amp *= 0.5; f *= 2; }
    return v / sum;
  };
  return { noise, fbm, pnoise, pfbm };
}

const N = makeNoise(rng.fork('noise'));

/**
 * Build a canvas texture by evaluating fn(u, v) -> [r, g, b] (0..1) per pixel.
 * @param {number} size
 * @param {(u:number,v:number,x:number,y:number)=>number[]} fn
 */
export function makeTexture(size, fn, { repeat = 1, pixel = false } = {}) {
  return rgbTexture(size, size, (x, y) => fn(x / size, y / size, x, y), { repeat, srgb: true, pixel });
}

/**
 * Texture from a per-pixel RGB callback (x, y in pixels). Non-colour data (normals, roughness,
 * grunge) is stored linear (`srgb: false`).
 */
export function rgbTexture(w, h, fn, { repeat = 1, srgb = true, anisotropy = 4, pixel = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fn(x, y);
    const i = (y * w + x) * 4;
    d[i] = Math.max(0, Math.min(255, c[0] * 255 + 0.5)); d[i + 1] = Math.max(0, Math.min(255, c[1] * 255 + 0.5)); d[i + 2] = Math.max(0, Math.min(255, c[2] * 255 + 0.5)); d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = anisotropy;
  if (pixel) pixelate(tex);
  return tex;
}

/**
 * Upload a texture the way the sprite atlas is uploaded: NEAREST magnification, and a NEAREST
 * mip chain for minification. The base level stays exactly as painted — at play distance one
 * texel is ~4 device pixels, so level 0 is what the floor is sampled from and the pixel structure
 * survives; the mips only exist so a far-zoom overview does not sparkle.
 * @param {THREE.Texture} tex
 */
export function pixelate(tex) {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  return tex;
}

/** Tangent-space normal map from a height array (w*h floats, 0..1). `strength` in texels of slope. */
function normalFromHeight(hgt, w, h, strength, { wrap = true, pixel = true } = {}) {
  const at = (x, y) => {
    if (wrap) { x = (x + w) % w; y = (y + h) % h; } else { x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y)); }
    return hgt[y * w + x];
  };
  return rgbTexture(w, h, (x, y) => {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nx = -dx * strength, ny = -dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    // three's tangent frame: +x right, +y up in texture space; canvas y grows downward so flip green
    return [nx * 0.5 + 0.5, -ny * 0.5 + 0.5, nz * 0.5 + 0.5];
  }, { srgb: false, pixel });
}

function hexToRgb(hex) { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// -------------------------------------------------------------------------------- the stone palette
/** hex -> [r,g,b] in 0..1. */
const unit = (h) => toRgb(h).map((c) => c / 255);

/**
 * THE dungeon stone: seven house-law steps (sprites/style.js `ramp`), darkest first. A floor is not
 * allowed the sprites' full value range — it would compete with the cast — so the band is narrowed
 * and the hue drift softened: shadows cool a little, they never go violet. Every flagstone in the
 * game is painted out of THIS array and nothing else, which is what makes a room read as one
 * quarry instead of a random tint per slab.
 */
const STONE = ramp('#8b8274', 7, { range: 0.34, step: 0.05, hueShift: 0.018, satShift: 0.012 }).map(unit);
/** The ramp step a clean slab face sits on; wear pulls down from here, polish pushes up. */
const STONE_MID = 4;
/** Wall stone: the same family, a shade cooler and darker so walls sit behind the floor. */
const WALLSTONE = ramp('#7c7a76', 7, { range: 0.36, step: 0.05, hueShift: 0.02, satShift: 0.012 }).map(unit);
/** The obsidian re-skin for the sword level: same relief, violet-black glass. */
const GLASSSTONE = ramp('#544a63', 7, { range: 0.4, step: 0.05, hueShift: 0.02, satShift: 0.03 }).map(unit);
/** The dark between the slabs. Never pure black — the same law the sprite ink obeys. */
const GROUT = unit('#2b2529');
/** Damp growth in the hollows, five steps. */
const MOSS = ramp('#5d7a3a', 5, { range: 0.3, step: 0.05, hueShift: 0.02, satShift: 0.03 }).map(unit);
/** Pale cut marble for the temple slabs. */
const MARBLE = ramp('#c9c3b4', 7, { range: 0.3, step: 0.05, hueShift: 0.02, satShift: 0.01 }).map(unit);

/**
 * NINE FAMILIES OF WEAR. The old atlas had exactly one crack generator and two cracked cells, so a
 * single worm-shaped decal landed on the floor a dozen-plus times a screen and the eye counted it
 * instantly. Every slab now takes two or three DIFFERENT families with seeded parameters, and there
 * are thirty slabs; with the quarter-turn each instance also gets, a repeat is not findable.
 */
const WEAR_MARKS = ['crack', 'chip', 'spall', 'pits', 'scuff', 'stain', 'chisel', 'hollow', 'inset'];

/**
 * Paint the wear on ONE slab, in texels. `dv` is a shift in RAMP STEPS (negative = darker), `dh` a
 * relief delta; nothing here writes a colour, so every mark lands on the same seven-step ramp and
 * the normal map agrees with the albedo by construction.
 * @param {import('../core/rng.js').Rng} r
 * @param {number} S cell size in texels
 * @param {string[]} marks which families this slab carries (may repeat)
 */
function paintWear(r, S, marks) {
  const dv = new Float32Array(S * S), dh = new Float32Array(S * S);
  const inside = (x, y) => x >= 1 && y >= 1 && x < S - 1 && y < S - 1;
  const put = (x, y, v, h) => { if (!inside(x, y)) return; const i = y * S + x; dv[i] += v; dh[i] += h; };
  const DIR8 = (a) => { const k = Math.round(a / (Math.PI / 4)) * (Math.PI / 4); return [Math.round(Math.cos(k)), Math.round(Math.sin(k))]; };

  /** A hairline fracture: an eight-direction WALK, one texel wide, so it is a drawn line and not a resampled curve. */
  const crack = (len) => {
    let x = r.int(3, S - 4), y = r.int(3, S - 4), a = r.float(0, Math.PI * 2);
    for (let i = 0; i < len; i++) {
      put(x, y, -2.4, -0.55);
      if (r.chance(0.17)) put(x + (r.chance(0.5) ? 1 : -1), y, -0.8, -0.15);
      if (r.chance(0.08)) {                                  // a short branch off the main run
        let bx = x, by = y, ba = a + (r.chance(0.5) ? 1.15 : -1.15);
        for (let j = r.int(3, 7); j > 0; j--) {
          put(bx, by, -1.7, -0.32);
          const [sx, sy] = DIR8(ba); bx += sx; by += sy; ba += r.float(-0.6, 0.6);
          if (!inside(bx, by)) break;
        }
      }
      a += r.float(-0.85, 0.85);
      const [sx, sy] = DIR8(a); x += sx; y += sy;
      if (!inside(x, y)) break;
    }
  };

  /** A corner bitten clean off, with a jagged fracture line. */
  const chip = () => {
    const cx = r.chance(0.5) ? 0 : S - 1, cy = r.chance(0.5) ? 0 : S - 1, rad = r.float(4, 8.5), seed = r.float(0, 30);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const jag = rad * (0.76 + 0.4 * N.noise(x * 0.62 + seed, y * 0.62 + seed));
      if (Math.hypot(x - cx, y - cy) < jag) { const i = y * S + x; dv[i] -= 2.8; dh[i] -= 0.85; }
    }
  };

  /** A spall: a shallow bite out of the middle of one edge. */
  const spall = () => {
    const side = r.int(0, 3), run = r.int(5, 10), t0 = r.int(2, Math.max(3, S - 3 - run)), amp = r.float(1.4, 3.6);
    for (let t = t0; t < Math.min(S - 2, t0 + run); t++) {
      const deep = 1 + Math.round(Math.sin(((t - t0 + 0.5) / run) * Math.PI) * amp);
      for (let d = 0; d < deep; d++) {
        const x = side === 2 ? d : side === 3 ? S - 1 - d : t;
        const y = side === 0 ? d : side === 1 ? S - 1 - d : t;
        if (x < 0 || y < 0 || x >= S || y >= S) continue;
        const i = y * S + x; dv[i] -= 2.3; dh[i] -= 0.7;
      }
    }
  };

  /** Pocks: a shower of single dark texels where the face has crumbled. */
  const pits = () => {
    const cx = r.int(6, S - 7), cy = r.int(6, S - 7), spread = r.float(3, 7.5);
    for (let i = r.int(4, 10); i > 0; i--) {
      const x = cx + Math.round(r.float(-spread, spread)), y = cy + Math.round(r.float(-spread, spread));
      put(x, y, -1.9, -0.4);
      if (r.chance(0.35)) put(x + 1, y, -1.4, -0.28);
      if (r.chance(0.2)) put(x, y + 1, -1.1, -0.22);
    }
  };

  /** Drag marks: parallel pale streaks where boots and dragged crates polished the stone. */
  const scuff = () => {
    const dir = r.int(0, 3), dx = [1, 1, 1, 0][dir], dy = [0, 1, -1, 1][dir];
    const x0 = r.int(4, S - 13), y0 = r.int(6, S - 13);
    for (let k = r.int(2, 4); k > 0; k--) {
      const ox = x0 + (dir === 3 ? k * 2 : 0), oy = y0 + (dir === 3 ? 0 : k * 2);
      for (let i = r.int(4, 11); i > 0; i--) put(ox + dx * i, oy + dy * i, 1.15, 0.06);
    }
  };

  /** A damp shadow, DITHERED at the rim: a pixel-art edge, never a soft gradient. */
  const stain = () => {
    const cx = r.int(6, S - 7), cy = r.int(6, S - 7), rad = r.float(3.5, 7.5), depth = r.float(0.7, 1.5), seed = r.float(0, 30);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - cx, y - cy) / (rad * (0.8 + 0.45 * N.noise(x * 0.3 + seed, y * 0.3 + seed)));
      if (d < 0.78) put(x, y, -depth, 0);
      else if (d < 1 && ((x + y) & 1) === 0) put(x, y, -depth * 0.7, 0);
    }
  };

  /** The mason's claw: parallel tool ridges, a lit texel with an ink texel behind it. */
  const chisel = () => {
    const along = r.chance(0.5), gap = r.int(3, 5), o0 = r.int(3, 8), a = r.int(2, 6);
    for (let k = r.int(3, 6); k > 0; k--) {
      const o = o0 + k * gap; if (o >= S - 3) continue;
      const b = Math.min(S - 2, a + r.int(10, S - 8));
      for (let t = a; t < b; t++) {
        put(along ? t : o, along ? o : t, 0.75, 0.05);
        put(along ? t : o + 1, along ? o + 1 : t, -0.6, -0.05);
      }
    }
  };

  /** A dish worn pale in the middle of the slab by a century of feet. */
  const hollow = () => {
    const cx = r.float(10, S - 10), cy = r.float(10, S - 10), rad = r.float(7, 12);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - cx, y - cy) / rad;
      if (d < 1) put(x, y, (1 - d) * 1.3, (1 - d) * 0.1);
    }
  };

  /** Pebbles set into the slab: a lit block with the ink tucked under its lower-right, house key light. */
  const inset = () => {
    for (let k = r.int(2, 4); k > 0; k--) {
      const x = r.int(3, S - 7), y = r.int(3, S - 7), w = r.int(2, 3), h = r.int(2, 3);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, 1.25, 0.28);
      for (let i = 0; i < w; i++) put(x + i, y + h, -1.7, -0.1);
      for (let j = 0; j < h; j++) put(x + w, y + j, -1.4, -0.1);
    }
  };

  const draw = { crack: () => crack(r.int(9, 20)), chip, spall, pits, scuff, stain, chisel, hollow, inset };
  for (const m of marks) draw[m]();
  return { dv, dh };
}

/**
 * THE FLAGSTONE ATLAS, painted texel by texel: 32 slabs of 32x32 texels (256x128 in all), which is
 * exactly `TEXELS_PER_TILE` across a world tile — the sprite grid. Albedo, normal and roughness all
 * come off one height/step field so they agree, and every colour is a step of `STONE` (or `MOSS`,
 * `MARBLE`) so the floor cannot drift out of the family.
 * Returns { albedo, normal, rough, obsidian } textures.
 */
function flagstoneAtlas() {
  const S = ATLAS.cell, W = S * ATLAS.cols, H = S * ATLAS.rows, N_CELLS = ATLAS.cols * ATLAS.rows;
  const r = rng.fork('atlas');
  const hgt = new Float32Array(W * H);
  const alb = new Float32Array(W * H * 3);
  const rgh = new Float32Array(W * H);
  const obs = new Float32Array(W * H * 3);
  const kindOf = (i) => CELLS.plain.includes(i) ? 'plain' : CELLS.cracked.includes(i) ? 'cracked'
    : CELLS.mossy.includes(i) ? 'mossy' : CELLS.wet.includes(i) ? 'wet' : i === CELLS.mosaic ? 'mosaic' : 'marble';

  for (let idx = 0; idx < N_CELLS; idx++) {
    const kind = kindOf(idx);
    const cx0 = (idx % ATLAS.cols) * S, cy0 = Math.floor(idx / ATLAS.cols) * S;
    const seed = r.float(0, 90);
    // this slab's own value (never hue) offset, and its own pick of wear
    const lift = r.float(-0.4, 0.4);
    const pool = [...WEAR_MARKS]; r.shuffle(pool);
    const marks = pool.slice(0, r.int(2, 3));
    if (kind === 'cracked') marks.splice(0, marks.length, 'crack', 'crack', r.chance(0.5) ? 'chip' : 'spall', 'pits');
    else if (kind === 'plain' && r.chance(0.34)) marks[0] = 'crack';
    const wear = kind === 'mosaic' || kind === 'marble' ? null : paintWear(r, S, marks);
    const mossSeed = r.float(0, 40);

    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const i = py * S + px, gi = (cy0 + py) * W + cx0 + px;
      let col, h, rough, ti = STONE_MID;
      if (kind === 'mosaic') {
        // 8x8 tesserae of 4 texels with a one-texel grout line between them: a radial medallion
        const iu = px >> 2, iv = py >> 2, grout = (px & 3) === 3 || (py & 3) === 3;
        const dc = Math.hypot(iu + 0.5 - 4, iv + 0.5 - 4);
        const cross = Math.abs(iu + 0.5 - 4) < 1 || Math.abs(iv + 0.5 - 4) < 1;
        const jit = Math.round(N.noise(iu * 13.1 + seed, iv * 7.7 + seed) * 2) - 1;
        let tc;
        if (dc < 1.3) tc = unit('#ddd3ba');
        else if (dc < 2.4) tc = cross ? unit('#ddd3ba') : unit('#b98a2c');
        else if (iu === 0 || iv === 0 || iu === 7 || iv === 7) tc = unit('#a87c26');
        else tc = cross ? unit('#cfc4a6') : unit('#2c447f');
        const k = 1 + jit * 0.08;
        col = grout ? GROUT : [tc[0] * k, tc[1] * k, tc[2] * k];
        h = grout ? 0.15 : 0.85; rough = grout ? 0.9 : 0.42;
      } else if (kind === 'marble') {
        const e = Math.min(px, py, S - 1 - px, S - 1 - py);
        const vein = Math.abs(Math.sin((px / S * 2.6 + N.fbm(px / 6 + seed, py / 6 + seed, 3) * 2.6) * Math.PI));
        const grain = Math.round((N.fbm(px / 5 + seed, py / 5 + seed, 3) - 0.5) * 2);
        ti = e < 1 ? 0 : vein > 0.94 ? 2 : vein > 0.84 ? 3 : Math.max(4, Math.min(6, 5 + grain));
        col = e < 1 ? GROUT : MARBLE[ti];
        h = e < 1 ? 0.05 : e === 1 ? 0.72 : 0.9; rough = 0.4 + (e < 1 ? 0.4 : 0);
      } else {
        const e = Math.min(px, py, S - 1 - px, S - 1 - py);
        // ragged one-texel outline: the slab's edge is chewed, not ruled
        const rag = N.noise(px * 1.55 + seed, py * 1.55 + seed) < 0.3;
        const inGrout = e < 1 || (e < 2 && rag);
        // mottle: a low band of grain plus a fine per-texel speckle — both quantised with the tone
        const mot = (N.fbm(px / 6.5 + seed, py / 6.5 + seed, 3) - 0.5) * 1.9
          + (N.noise(px * 1.7 + seed, py * 1.7 + seed) - 0.5) * 0.45;
        if (inGrout) {
          col = GROUT; h = 0.04; rough = 0.95; ti = 0;
        } else {
          ti = Math.max(0, Math.min(STONE.length - 1, Math.round(STONE_MID + lift + mot + wear.dv[i])));
          col = STONE[ti];
          h = clamp01(0.68 + wear.dh[i] + (e === 1 ? -0.16 : e === 2 ? -0.05 : 0) + mot * 0.05);
          rough = 0.9 - (ti - STONE_MID) * 0.02;
          if (kind === 'mossy') {
            const mv = N.fbm(px / 7 + mossSeed, py / 7 + mossSeed, 3);
            if (mv > 0.58 || (mv > 0.51 && ((px + py) & 1) === 0)) {
              col = MOSS[Math.max(0, Math.min(MOSS.length - 1, 1 + Math.round(mot * 0.9)))];
              rough = 0.78;
            }
          } else if (kind === 'wet') {
            col = mix(col, [0.26, 0.31, 0.35], 0.45);
            rough = 0.24 + (1 - h) * 0.3;
          }
        }
      }
      hgt[gi] = h;
      alb[gi * 3] = col[0]; alb[gi * 3 + 1] = col[1]; alb[gi * 3 + 2] = col[2];
      rgh[gi] = clamp01(rough);
      // the sword level's obsidian re-skin: the same steps, read out of a violet-black glass ramp
      const oc = kind === 'mosaic' ? mix(GLASSSTONE[5], [0.55, 0.42, 0.2], 0.45) : GLASSSTONE[ti];
      obs[gi * 3] = oc[0]; obs[gi * 3 + 1] = oc[1]; obs[gi * 3 + 2] = oc[2];
    }
  }
  const albedo = rgbTexture(W, H, (x, y) => { const i = (y * W + x) * 3; return [alb[i], alb[i + 1], alb[i + 2]]; }, { pixel: true });
  const obsidian = rgbTexture(W, H, (x, y) => { const i = (y * W + x) * 3; return [obs[i], obs[i + 1], obs[i + 2]]; }, { pixel: true });
  const rough = rgbTexture(W, H, (x, y) => { const v = rgh[y * W + x]; return [v, v, v]; }, { srgb: false, pixel: true });
  const normal = normalFromHeight(hgt, W, H, 1.5, { wrap: false });
  for (const t of [albedo, obsidian, rough, normal]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
  return { albedo, normal, rough, obsidian };
}

/**
 * THE MASONRY STRIP, painted texel by texel: 128x32 texels = four world tiles wide by exactly ONE
 * world unit tall, so u and v can be world coordinates (dungeon.js MASONRY_U / MASONRY_V) and every
 * brick lands on the same 32-texels-per-tile grid as the floor and the cast. Five running-bond
 * courses of whole-texel height that sum to 32, so the strip wraps with no seam.
 *
 * Each brick face is one step of `WALLSTONE` with a value-only variation, a LIT texel along its top
 * edge and an ink texel along its bottom — the house key light, baked as form, not as hue — plus
 * seeded chipped corners and the odd hairline crack. Returns { albedo, normal, rough, obsidian }.
 */
function masonryStrip() {
  const W = TEXELS_PER_TILE * 4, H = TEXELS_PER_TILE;
  const r = rng.fork('masonry');
  const MID = 4;
  // per-texel wear overlay, indexed from the BOTTOM row up (y = 0 is the foot of the course stack)
  const dv = new Float32Array(W * H), dh = new Float32Array(W * H);
  const put = (x, y, v, h) => {
    if (y < 0 || y >= H) return;
    const i = y * W + (((x % W) + W) % W); dv[i] += v; dh[i] += h;
  };
  // courses, bottom-up: whole texel heights summing to H
  const courseH = [7, 6, 7, 6, 6];
  const rows = [];
  let base = 0;
  for (const ch of courseH) {
    const bricks = [];
    let x = -r.int(0, 9);
    while (x < W) {
      const len = r.int(9, 19);
      bricks.push({ x0: x, x1: x + len, v: r.int(-2, 2), proud: r.float(-0.1, 0.12) });
      x += len;
    }
    rows.push({ y0: base, y1: base + ch, bricks });
    base += ch;
  }
  // wear, drawn on whole texels: chipped corners and the occasional hairline crack
  for (const row of rows) for (const b of row.bricks) {
    const fy0 = row.y0, fy1 = row.y1 - 1;            // face rows (the top row of a course is mortar)
    if (r.chance(0.5)) { const n = r.int(1, 3); for (let k = 0; k < n; k++) put(b.x0 + 1 + k, fy1 - 1 - k, -2.2, -0.5); }
    if (r.chance(0.5)) { const n = r.int(1, 3); for (let k = 0; k < n; k++) put(b.x1 - 2 - k, fy0 + k, -2.2, -0.5); }
    if (r.chance(0.18)) {                            // a crack walking down the face
      let x = r.int(b.x0 + 2, Math.max(b.x0 + 3, b.x1 - 3)), y = fy1 - 1, a = -Math.PI / 2 + r.float(-0.6, 0.6);
      for (let i = fy1 - fy0; i > 0; i--) {
        put(x, y, -2.1, -0.45);
        const k = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
        x += Math.round(Math.cos(k)); y += Math.round(Math.sin(k));
        a += r.float(-0.7, 0.7);
        if (y < fy0) break;
      }
    }
    if (r.chance(0.3)) { const px = r.int(b.x0 + 2, Math.max(b.x0 + 3, b.x1 - 2)), py = r.int(fy0 + 1, Math.max(fy0 + 2, fy1 - 1)); put(px, py, -1.6, -0.3); put(px + 1, py, -1.1, -0.2); }
  }

  const hgt = new Float32Array(W * H), alb = new Float32Array(W * H * 3), rgh = new Float32Array(W * H), obs = new Float32Array(W * H * 3);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const yb = H - 1 - py;                            // canvas rows run top-down; the strip is built bottom-up
    const gi = py * W + px, fi = yb * W + px;
    const row = rows.find((rw) => yb >= rw.y0 && yb < rw.y1) || rows[rows.length - 1];
    let brick = row.bricks.find((b) => px >= b.x0 && px < b.x1);
    if (!brick) brick = row.bricks.find((b) => px + W >= b.x0 && px + W < b.x1) || row.bricks[0];
    const mortar = yb === row.y1 - 1 || px === (((brick.x1 - 1) % W) + W) % W;
    let col, h, rough, ti;
    if (mortar) {
      ti = 1;
      col = mix(GROUT, WALLSTONE[1], 0.35 + N.noise(px * 1.3, yb * 1.3) * 0.3);
      h = 0.22; rough = 0.96;
    } else {
      const grain = (N.fbm(px / 5.5 + brick.x0 * 0.7, yb / 5.5 + row.y0 * 1.3, 3) - 0.5) * 1.7
        + (N.noise(px * 1.9, yb * 1.9) - 0.5) * 0.8;
      // house key light, baked as FORM: the top course edge catches it, the bottom sits in its own shadow
      const lit = yb === row.y1 - 2 ? 1.0 : yb === row.y0 ? -1.2 : 0;
      const side = px === (((brick.x0 % W) + W) % W) ? 0.4 : px === (((brick.x1 - 2) % W) + W) % W ? -0.5 : 0;
      ti = Math.max(0, Math.min(WALLSTONE.length - 1, Math.round(MID + brick.v * 0.5 + grain + lit + side + dv[fi])));
      col = WALLSTONE[ti];
      h = clamp01(0.74 + brick.proud + dh[fi] + grain * 0.05 + (lit > 0 ? 0.06 : lit < 0 ? -0.06 : 0));
      rough = 0.9 - (ti - MID) * 0.02;
    }
    hgt[gi] = h;
    alb[gi * 3] = col[0]; alb[gi * 3 + 1] = col[1]; alb[gi * 3 + 2] = col[2];
    rgh[gi] = clamp01(rough);
    const oc = GLASSSTONE[ti];
    obs[gi * 3] = oc[0]; obs[gi * 3 + 1] = oc[1]; obs[gi * 3 + 2] = oc[2];
  }
  const albedo = rgbTexture(W, H, (x, y) => { const i = (y * W + x) * 3; return [alb[i], alb[i + 1], alb[i + 2]]; }, { pixel: true });
  const obsidian = rgbTexture(W, H, (x, y) => { const i = (y * W + x) * 3; return [obs[i], obs[i + 1], obs[i + 2]]; }, { pixel: true });
  const rough = rgbTexture(W, H, (x, y) => { const v = rgh[y * W + x]; return [v, v, v]; }, { srgb: false, pixel: true });
  const normal = normalFromHeight(hgt, W, H, 1.8);
  return { albedo, normal, rough, obsidian };
}

/**
 * Tileable world-space macro variation: mostly VALUE (damp is darker, dust is lighter) with a
 * whisper of moss and soot. The old map swung hard toward green and tan, which — sampled smoothly
 * over the floor — was half the reason neighbouring slabs read as different-coloured stone. It is
 * sampled on the 1/32-world texel grid in `patchSurface`, so what it adds is blocky, not a soft
 * airbrush laid over the pixel structure. Stored as multiplier / 1.4.
 */
function grungeTexture() {
  const S = 256, P = 8;
  const mossC = [0.7, 0.82, 0.6], dirt = [0.98, 0.94, 0.86], soot = [0.82, 0.82, 0.86];
  return rgbTexture(S, S, (x, y) => {
    const u = x / S * P, v = y / S * P;
    const a = N.pfbm(u, v, P, 4), b = N.pfbm(u + 3.3, v + 7.1, P, 3), c = N.pfbm(u * 2 + 11, v * 2 + 5, P * 2, 3);
    let m = [1, 1, 1];
    m = scale(m, 0.9 + a * 0.22);
    m = mix(m, mossC, sstep(0.68, 0.9, b) * 0.28);
    m = mix(m, dirt, sstep(0.62, 0.86, c) * 0.3);
    m = mix(m, soot, sstep(0.25, 0.05, a) * 0.45);
    return scale(m, 1 / 1.4);
  }, { srgb: false, anisotropy: 2 });
}

/**
 * ONE STONE FAMILY PER DEPTH. The dungeon's colour story is told by the depth bands (lighting.js
 * `depthTint`) and the torches; the quarry the level was cut from moves with it, but only as a
 * gentle family multiplier over the single `STONE` ramp — never as a per-slab hue, which is what
 * made a room read as noise. dungeon.js folds this into the per-instance tint.
 * @param {number} depth
 * @returns {{name:string, tint:number[], moss:number}}
 */
export function stoneFamily(depth) {
  if (depth <= 0) return { name: 'weathered court flags', tint: [1.06, 1.04, 0.98], moss: 1.15 };
  if (depth <= 5) return { name: 'warm limestone', tint: [1.02, 0.98, 0.9], moss: 1 };
  if (depth <= 12) return { name: 'cold granite', tint: [0.9, 0.94, 1.02], moss: 0.75 };
  if (depth <= 18) return { name: 'green serpentine', tint: [0.88, 0.98, 0.9], moss: 1.25 };
  return { name: 'violet basalt', tint: [0.96, 0.88, 1.02], moss: 0.45 };
}

/** Tileable caustic pattern (bright cell edges). */
function causticTexture() {
  const S = 256, r = rng.fork('caustic');
  const pts = Array.from({ length: 26 }, () => [r.float(0, 1), r.float(0, 1)]);
  return rgbTexture(S, S, (x, y) => {
    const u = x / S, v = y / S;
    let f1 = 9, f2 = 9;
    for (const [px, py] of pts) for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const d = Math.hypot(px + ox - u, py + oy - v);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    const e = f2 - f1;
    const line = Math.pow(1 - clamp01(e / 0.09), 2.2);
    const soft = 0.12 + 0.18 * N.pfbm(u * 4, v * 4, 4, 3);
    const val = clamp01(line * 0.85 + soft);
    return [val, val, val];
  }, { srgb: false, anisotropy: 2 });
}

/** Yellow/black checker homage for hidden treasure-or-trap squares. One tile, on the texel grid. */
function checkerTexture() {
  return makeTexture(TEXELS_PER_TILE, (u, v, x, y) => {
    const on = ((x >> 2) + (y >> 2)) & 1;
    const n = Math.round(N.noise(u * 20, v * 20) * 2) / 2;
    return on ? [0.75 * (0.86 + n * 0.28), 0.7 * (0.86 + n * 0.28), 0.3] : [0.12, 0.1, 0.08];
  }, { pixel: true });
}

/** Veined marble for altars and pillars: quantised to the MARBLE ramp so it is pixel art, not a gradient. */
function marbleTexture() {
  return makeTexture(32, (u, v) => {
    const vein = Math.abs(Math.sin((u * 3 + N.fbm(u * 4, v * 4, 4) * 2.5) * Math.PI));
    const grain = (N.fbm(u * 8, v * 8, 3) - 0.5) * 1.6;
    const ti = vein > 0.9 ? 3 : Math.max(0, Math.min(MARBLE.length - 1, Math.round(5 + grain)));
    return MARBLE[ti];
  }, { pixel: true });
}

/** Plain cut stone (arches, plinths): the wall ramp again, quantised, with faint claw marks. */
function cutStoneTexture() {
  return makeTexture(24, (u, v, x, y) => {
    const n = (N.pfbm(u * 6, v * 6, 6, 3) - 0.5) * 2.4;
    const marks = (y % 4 === 0 ? 0.5 : y % 4 === 2 ? -0.4 : 0);
    return WALLSTONE[Math.max(0, Math.min(WALLSTONE.length - 1, Math.round(4 + n + marks)))];
  }, { pixel: true });
}

/**
 * Dirt / rubble ground — the bed that shows in the gaps between the slabs. dungeon.js maps it at
 * half a repeat per tile, so 64 texels is exactly TEXELS_PER_TILE across a world tile.
 */
function dirtTexture() {
  return makeTexture(TEXELS_PER_TILE * 2, (u, v) => {
    const n = Math.round(N.pfbm(u * 5, v * 5, 5, 4) * 6) / 6;
    return scale([0.34, 0.29, 0.24], 0.62 + n * 0.55);
  }, { pixel: true });
}

/** Mosaic medallion for the temple floor (planar, meant for a ring/disc decal). */
function medallionTexture() {
  const S = 96;   // the medallion ring is 2.84 world units across: ~34 texels a tile, the sprite grid
  return makeTexture(S, (u, v) => {
    const dx = u - 0.5, dy = v - 0.5;
    const rad = Math.hypot(dx, dy) * 2, ang = Math.atan2(dy, dx);
    const ring = Math.floor(rad * 9);
    const segs = 6 + ring * 5;
    const a = ((ang / (Math.PI * 2)) + 1) % 1 * segs;
    const fa = a - Math.floor(a), fr = rad * 9 - ring;
    const e = Math.min(fa, 1 - fa, fr * 1.6, (1 - fr) * 1.6);
    const inT = sstep(0.05, 0.2, e);
    const jitter = N.noise(Math.floor(a) * 5.3 + ring * 11, ring * 3.1);
    let tc;
    if (ring % 3 === 0) tc = [0.8, 0.62, 0.22]; else if (ring % 3 === 1) tc = [0.16, 0.26, 0.52]; else tc = [0.86, 0.82, 0.7];
    if (ring === 8 && (Math.floor(a) % 2)) tc = [0.5, 0.15, 0.15];
    tc = scale(tc, 0.82 + Math.round(jitter * 3) / 3 * 0.34);
    return inT > 0.5 ? tc : GROUT;
  }, { pixel: true });
}

/** Lazily created texture set. */
let textures = null;
export function getTextures() {
  if (!textures) {
    const atlas = flagstoneAtlas();
    const masonry = masonryStrip();
    textures = {
      atlas, masonry,
      flagstone: atlas.albedo, obsidian: atlas.obsidian,
      grunge: grungeTexture(), caustic: causticTexture(),
      marble: marbleTexture(), checker: checkerTexture(), dirt: dirtTexture(), medallion: medallionTexture(), cutStone: cutStoneTexture(),
    };
  }
  return textures;
}

/**
 * Chain a dungeon-surface patch onto the fog patch:
 *  - `atlas`: per-vertex/instance `aTile` (vec2 uv offset) selects an atlas cell for map/normal/roughness;
 *  - `grunge`: multiplies albedo by the world-space grunge map at two incommensurate scales;
 *  - `quant`: [u, v] uv units per WORLD unit for this geometry — the surface joins the cast's texel
 *    grid (see "ONE TEXEL, ONE SIZE"): its texture lookup is snapped to `uWorldTexels` steps per
 *    world unit so one stone texel is exactly as many device pixels as one hero texel, and it
 *    writes `WORLD_MASK_ALPHA` so the grading pass treats it as pixel art. Materials without
 *    `quant` keep the plain sampling path (their uv is not a known multiple of world space).
 * @param {THREE.Material} m
 * @param {import('./lighting.js').FogOfWar} fog
 * @param {{atlas?:boolean, grunge?:number, grungeTex?:THREE.Texture, quant?:number[]}} opts
 */
export function patchSurface(m, fog, opts = {}) {
  patchFog(m, fog);
  const prev = m.onBeforeCompile;
  const grungeTex = opts.grungeTex || getTextures().grunge;
  const q = opts.quant || null;
  const key = `surface:${opts.atlas ? 'atlas' : 'uv'}:${opts.grunge ? 'g' : 'n'}:${q ? q.join(',') : 'x'}`;
  m.onBeforeCompile = (shader) => {
    prev(shader);
    m.userData.surfaceUniforms = shader.uniforms;   // audits and probes reach the live grid from here
    if (opts.grunge || q) {
      // the live world texel grid: one uniform object shared by every surface material
      shader.uniforms.uWorldTexels = GRID.uWorldTexels;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uWorldTexels;');
    }
    if (opts.atlas) {
      shader.uniforms.uAtlas = { value: new THREE.Vector2(1 / ATLAS.cols, 1 / ATLAS.rows) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute vec2 aTile; uniform vec2 uAtlas;\nconst float CELL = ${ATLAS.cell.toFixed(1)};\nvarying vec2 vSlabUv; varying vec2 vCellUv;`)
        // uv 0..1 across a slab maps to the CENTRES of the cell's first and last texel: with
        // NearestFilter, uv == 1.0 would otherwise land on the first texel of the NEXT atlas cell
        // and bleed a neighbour's stone around the rim. `vMapUv` keeps the CONTINUOUS mapping (the
        // tangent frame and the mip level are read off its derivatives); the fragment shader snaps
        // the sample point itself from `vSlabUv`.
        .replace('#include <uv_vertex>', `#include <uv_vertex>
        { vec2 tuv = (uv * (CELL - 1.0) + 0.5) / CELL * uAtlas + aTile;
          vSlabUv = uv; vCellUv = aTile;
          #ifdef USE_MAP
          vMapUv = tuv;
          #endif
          #ifdef USE_NORMALMAP
          vNormalMapUv = tuv;
          #endif
          #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = tuv;
          #endif
        }`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform vec2 uAtlas;\nconst float CELL = ${ATLAS.cell.toFixed(1)};\nvarying vec2 vSlabUv; varying vec2 vCellUv;`);
    }
    if (opts.grunge) {
      shader.uniforms.uGrunge = { value: grungeTex };
      shader.uniforms.uGrungeAmt = { value: opts.grunge };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uGrunge; uniform float uGrungeAmt;')
        // sampled on the WORLD TEXEL GRID — the cast's grid, `uWorldTexels` steps per world unit:
        // macro wear that steps with the stone instead of airbrushing a soft gradient across the
        // pixel structure
        .replace('#include <map_fragment>', `#include <map_fragment>
        { vec2 gp = floor(vFogXZ * uWorldTexels) / uWorldTexels;
          vec3 g1 = texture2D(uGrunge, gp * 0.071 + 0.13).rgb * 1.5;
          vec3 g2 = texture2D(uGrunge, gp * 0.0293 + 0.61).rgb * 1.5;
          diffuseColor.rgb *= mix(vec3(1.0), g1 * g2, uGrungeAmt); }`);
    }
    if (q) {
      // ---- the surface joins the cast's texel grid (see "ONE TEXEL, ONE SIZE") ----
      shader.uniforms.uWorldMask = GRID.uWorldMask;
      shader.uniforms.uUvPerWorld = { value: new THREE.Vector2(q[0], q[1]) };
      // `qStep` is one world texel expressed in this geometry's uv; `qUv` is the snapped sample
      // point and `qDx`/`qDy` are the CONTINUOUS derivatives, which is what keeps the mip level
      // honest — sampling with a quantised uv's own derivatives would spike the LOD at every block
      // edge and blur the floor into exactly the mush this grid exists to kill.
      const snap = opts.atlas ? `
        vec2 qStep = uUvPerWorld / uWorldTexels;
        vec2 qSlab = clamp((floor(vSlabUv / qStep) + 0.5) * qStep, 0.0, 1.0);
        qUv = (qSlab * (CELL - 1.0) + 0.5) / CELL * uAtlas + vCellUv;
        vec2 qCont = (vSlabUv * (CELL - 1.0) + 0.5) / CELL * uAtlas + vCellUv;
        qDx = dFdx(qCont); qDy = dFdy(qCont);` : `
        vec2 qStep = uUvPerWorld / uWorldTexels;
        qUv = (floor(vMapUv / qStep) + 0.5) * qStep;
        qDx = dFdx(vMapUv); qDy = dFdy(vMapUv);`;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uWorldMask; uniform vec2 uUvPerWorld;\nvec2 qUv; vec2 qDx; vec2 qDy;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n{${snap}\n}`)
        .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          diffuseColor *= texture2DGradEXT( map, qUv, qDx, qDy );
        #endif`)
        .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor *= texture2DGradEXT( roughnessMap, qUv, qDx, qDy ).g;
        #endif`)
        .replace('#include <normal_fragment_maps>', `
        #ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 mapN = texture2DGradEXT( normalMap, qUv, qDx, qDy ).xyz * 2.0 - 1.0;
          mapN.xy *= normalScale;
          normal = normalize( tbn * mapN );
        #endif`)
        // tag the frame's alpha: stone is hand-pixelled art too, so the grading pass holds most of
        // the film grain off it (renderer.js character mask; sprites write 0.35, the void 1.0)
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n gl_FragColor.a = uWorldMask;');
    }
  };
  m.customProgramCacheKey = () => 'fogofwar-v1|' + key;
  return m;
}

/**
 * Shared material set. `fog` is the FogOfWar instance whose uniforms get injected.
 * @param {import('./lighting.js').FogOfWar} fog
 */
export function createMaterials(fog) {
  const T = getTextures();
  const std = (opts) => { const m = new THREE.MeshStandardMaterial(opts); patchFog(m, fog); return m; };
  const surf = (opts, p) => { const m = new THREE.MeshStandardMaterial(opts); patchSurface(m, fog, p); return m; };
  const A = T.atlas, M = T.masonry;
  const normalScale = new THREE.Vector2(0.9, 0.9);
  // uv units per WORLD unit for each geometry family, so the shader can snap the lookup to the
  // cast's texel grid (see "ONE TEXEL, ONE SIZE"). A slab's uv spans its own 0.985-unit top face;
  // a capstone's spans its tile; masonry runs 0.25 uv per world unit across and 1 up.
  const SLAB_Q = [1 / 0.985, 1 / 0.985], CAP_Q = [1, 1], MASONRY_Q = [0.25, 1];
  const mats = {
    // instanced flagstones (aTile per instance, AO/tint via instanceColor)
    floor: surf({ map: A.albedo, normalMap: A.normal, normalScale, roughnessMap: A.rough, roughness: 1, metalness: 0.02 }, { atlas: true, grunge: 0.55, quant: SLAB_Q }),
    // merged wall caps: same atlas, per-vertex colour
    floorCap: surf({ map: A.albedo, normalMap: A.normal, normalScale, roughnessMap: A.rough, roughness: 1, metalness: 0.02, vertexColors: true }, { atlas: true, grunge: 0.45, quant: CAP_Q }),
    // merged wall bodies mapped in world units
    wall: surf({ map: M.albedo, normalMap: M.normal, normalScale: new THREE.Vector2(1.0, 1.0), roughnessMap: M.rough, roughness: 1, metalness: 0, vertexColors: true }, { grunge: 0.5, quant: MASONRY_Q }),
    obsidianFloor: surf({ map: A.obsidian, normalMap: A.normal, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.5, metalness: 0.12 }, { atlas: true, grunge: 0.35, quant: SLAB_Q }),
    obsidianCap: surf({ map: A.obsidian, normalMap: A.normal, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.5, metalness: 0.12, vertexColors: true }, { atlas: true, grunge: 0.35, quant: CAP_Q }),
    obsidianWall: surf({ map: M.obsidian, normalMap: M.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.5, metalness: 0.15, color: 0xcdbde0, vertexColors: true }, { grunge: 0.3, quant: MASONRY_Q }),
    marble: std({ map: T.marble, roughness: 0.35, metalness: 0.05 }),
    medallion: std({ map: T.medallion, roughness: 0.45, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    checker: std({ map: T.checker, roughness: 0.8 }),
    dirt: std({ map: T.dirt, roughness: 1 }),
    dark: std({ color: 0x050405, roughness: 1 }),
    pitWall: surf({ map: M.albedo, normalMap: M.normal, roughnessMap: M.rough, roughness: 1, color: 0xd8d0c8, vertexColors: true }, { grunge: 0.5, quant: MASONRY_Q }),
    rim: std({ color: 0x6a6058, roughness: 0.9 }),
    cutStone: surf({ map: T.cutStone, roughness: 0.88, metalness: 0.02, color: 0xcfc6bc }, { grunge: 0.5 }),
    rock: std({ color: 0x7a7068, roughness: 0.95, flatShading: true }),
    gold: std({ color: PALETTE.gold, roughness: 0.28, metalness: 0.95, emissive: 0x3a2a05, emissiveIntensity: 0.4 }),
    brass: std({ color: PALETTE.brass, roughness: 0.4, metalness: 0.8 }),
    wood: std({ color: PALETTE.wood, roughness: 0.85 }),
    iron: std({ color: PALETTE.iron, roughness: 0.45, metalness: 0.85 }),
    leather: std({ color: PALETTE.leather, roughness: 0.9 }),
    bone: std({ color: PALETTE.bone, roughness: 0.7 }),
    glass: std({ color: 0xff3b3b, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85, emissive: 0x7a1010, emissiveIntensity: 0.6 }),
    parchment: std({ color: 0xe9dcc0, roughness: 0.95 }),
    swordBlade: std({ color: 0xdff2ff, roughness: 0.15, metalness: 0.9, emissive: PALETTE.sword, emissiveIntensity: 1.6 }),
    swordHilt: std({ color: 0x3b2a6b, roughness: 0.5, metalness: 0.6, emissive: PALETTE.swordViolet, emissiveIntensity: 0.5 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.95 }),
    candle: std({ color: 0xf2e8d0, roughness: 0.6, emissive: 0xffe0a0, emissiveIntensity: 0.25 }),
    holyGlow: new THREE.MeshBasicMaterial({ color: PALETTE.holy, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending }),
    emberGlow: new THREE.MeshBasicMaterial({ color: 0xff4a12, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    emberFloor: new THREE.MeshBasicMaterial({ color: 0x8a1e06 }),
    rune: new THREE.MeshBasicMaterial({ color: PALETTE.magic, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    beacon: std({ color: 0x4bd66a, roughness: 0.3, emissive: 0x2fbf4f, emissiveIntensity: 1.2, transparent: true, opacity: 0.9 }),
    potionBlue: std({ color: 0x4a7dff, roughness: 0.2, transparent: true, opacity: 0.85, emissive: 0x1030a0, emissiveIntensity: 0.6 }),
    sackCloth: std({ color: 0x8a6a45, roughness: 0.95 }),
    magicSack: std({ color: 0x5b3a8a, roughness: 0.9, emissive: 0x2a1050, emissiveIntensity: 0.3 }),
    rope: std({ color: 0x9c7c4c, roughness: 1 }),
  };
  mats.flame.toneMapped = false;
  mats.holyGlow.toneMapped = false;
  mats.emberGlow.toneMapped = false;
  mats.emberFloor.toneMapped = false;
  mats.rune.toneMapped = false;
  return mats;
}

/** Character material: flat shaded, vertex-coloured; one instance per character so flashes work. */
export function createCharacterMaterial(fog, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.78, metalness: 0.08, ...opts });
  patchFog(m, fog);
  return m;
}

/** Soft vertical light shaft (additive, fades with height and toward the silhouette). */
export function createShaftMaterial(fog, color = PALETTE.holy, strength = 0.35, profile = [0, 0.3, 0.5, 1]) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uTime: { value: 0 }, uProfile: { value: new THREE.Vector4(...profile) }, fogTex: fog.uniforms.fogTex, fogSize: fog.uniforms.fogSize, fogTint: fog.uniforms.fogTint },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vFogXZ; varying float vH; varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vFogXZ = w.xz; vH = uv.y;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uStrength; uniform float uTime; uniform vec4 uProfile;
      varying vec2 vFogXZ; varying float vH; varying vec3 vN; varying vec3 vV;
      ${fog.glsl()}
      void main() {
        float rim = abs(dot(normalize(vN), normalize(vV)));
        float a = smoothstep(uProfile.x, uProfile.y, vH) * (1.0 - smoothstep(uProfile.z, uProfile.w, vH));
        a *= pow(rim, 1.6);
        a *= 0.85 + 0.15 * sin(uTime * 0.9 + vH * 6.0);
        vec3 col = applyFog(uColor * uStrength * a, vFogXZ);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  mat.toneMapped = false;
  return mat;
}

/**
 * Water surface shader: the basin floor is drawn *through* the surface with a refraction offset
 * driven by an analytic wave normal, plus animated caustics, absorption by depth, a fresnel
 * sky term, shoreline foam (per-vertex `aShore`) and the player's light reflection.
 */
export function createWaterMaterial(fog) {
  const T = getTextures();
  const [cu, cv] = cellUV(CELLS.wet[0]);
  const uniforms = {
    uTime: { value: 0 }, uLightPos: { value: new THREE.Vector3() }, uLightColor: { value: new THREE.Color(0xffc080) },
    uFloor: { value: T.atlas.albedo }, uCaustic: { value: T.caustic }, uCell: { value: new THREE.Vector2(cu, cv) }, uCellScale: { value: new THREE.Vector2(1 / ATLAS.cols, 1 / ATLAS.rows) },
    fogTex: fog.uniforms.fogTex, fogSize: fog.uniforms.fogSize, fogTint: fog.uniforms.fogTint,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: false, depthWrite: true,
    vertexShader: `
      attribute float aShore;
      varying vec2 vFogXZ; varying vec3 vWorld; varying float vShore;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vFogXZ = w.xz; vShore = aShore;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uLightPos; uniform vec3 uLightColor;
      uniform sampler2D uFloor; uniform sampler2D uCaustic; uniform vec2 uCell; uniform vec2 uCellScale;
      varying vec2 vFogXZ; varying vec3 vWorld; varying float vShore;
      ${fog.glsl()}
      // sum of directional sines; returns height and its xz gradient
      vec3 waves(vec2 p, float t) {
        vec3 r = vec3(0.0);
        vec2 d1 = vec2(0.86, 0.5), d2 = vec2(-0.6, 0.8), d3 = vec2(0.3, -0.95), d4 = vec2(-0.9, -0.3);
        float a1 = dot(p, d1) * 5.5 + t * 1.4, a2 = dot(p, d2) * 7.3 - t * 1.1, a3 = dot(p, d3) * 11.0 + t * 1.9, a4 = dot(p, d4) * 3.6 + t * 0.6;
        r.x += sin(a1) * 0.5 + sin(a2) * 0.35 + sin(a3) * 0.18 + sin(a4) * 0.6;
        r.yz += d1 * cos(a1) * 5.5 * 0.5 + d2 * cos(a2) * 7.3 * 0.35 + d3 * cos(a3) * 11.0 * 0.18 + d4 * cos(a4) * 3.6 * 0.6;
        return r;
      }
      void main() {
        vec2 p = vWorld.xz;
        vec3 wv = waves(p, uTime);
        vec3 n = normalize(vec3(-wv.y * 0.035, 1.0, -wv.z * 0.035));
        vec3 V = normalize(cameraPosition - vWorld);
        // refracted floor: the wet flagstone cell, tiled per world tile, shifted by the wave normal
        vec2 ruv = p + 0.5 + n.xz * 1.6;
        vec2 cell = fract(ruv) * 0.92 + 0.04;
        vec3 floorCol = texture2D(uFloor, cell * uCellScale + uCell).rgb;
        // caustics: two scrolling layers multiplied, warped by the wave normal
        float c1 = texture2D(uCaustic, p * 0.55 + uTime * vec2(0.021, 0.013) + n.xz * 0.4).r;
        float c2 = texture2D(uCaustic, p * 0.38 - uTime * vec2(0.017, 0.024) - n.xz * 0.3).r;
        float caustic = min(1.0, c1 * c2 * 0.7);
        vec3 deep = vec3(0.02, 0.09, 0.13);
        vec3 tint = vec3(0.22, 0.5, 0.55);
        float depthK = 0.5 - vShore * 0.15; // more absorption away from the shore
        vec3 col = mix(floorCol * tint * 1.7, deep, depthK);
        col += vec3(0.22, 0.42, 0.45) * caustic * (0.9 - depthK * 0.5);
        // fresnel sky/ambient reflection
        float fres = pow(1.0 - max(0.0, dot(n, V)), 3.0);
        col = mix(col, vec3(0.25, 0.33, 0.42), fres * 0.55);
        // shoreline foam
        float foam = smoothstep(0.32, 0.0, vShore) * (0.55 + 0.45 * sin(uTime * 1.7 + wv.x * 2.5));
        col += vec3(0.28, 0.36, 0.38) * foam * 0.35;
        // player light: diffuse glint + specular
        vec3 toL = uLightPos - vWorld;
        float d = length(toL);
        float lit = 1.5 / (1.0 + d * d * 0.3);
        vec3 H = normalize(normalize(toL) + V);
        float spec = pow(max(0.0, dot(n, H)), 140.0);
        col += uLightColor * spec * lit * 0.4;
        col = applyFog(col, vFogXZ);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return mat;
}

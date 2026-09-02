// Procedural textures (canvas) and shared materials for the dungeon diorama. Everything is
// generated in code from a seeded RNG; no assets are loaded. Materials are fog-of-war patched
// by lighting.js (see patchFog) so darkness is applied in the shader.
//
// Dungeon surfaces use three procedural texture sets:
//  - the flagstone ATLAS (4x4 unique slabs: plain, cracked, mossy, wet, mosaic, marble) with
//    albedo + tangent-space normal + roughness maps; each floor instance / wall cap picks a cell
//    through the per-instance `aTile` attribute (see patchAtlas), so no two neighbours repeat;
//  - a continuous masonry strip (4 tiles wide, 1 tile-height tall) mapped in WORLD units along
//    wall runs so brick courses flow around corners instead of restarting on every block;
//  - a tileable world-space grunge map (moss / dirt / soot) multiplied over everything at two
//    incommensurate scales, which kills visible tiling at overview zoom.
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { patchFog } from './lighting.js';

/** Palette used by the renderer (linear-space friendly hex values). */
export const PALETTE = {
  stone: 0x8a8078, stoneDark: 0x4d4640, corridor: 0x6e655c, marble: 0xd8d2c4, moss: 0x5d7a3a,
  water: 0x1c4a5e, waterDeep: 0x0b2531, gold: 0xe8b84a, brass: 0xb08d3c, wood: 0x6b4426,
  obsidian: 0x3a3048, ember: 0xff7a1a, holy: 0xbfe6ff, magic: 0x7fd4ff, sword: 0x9fd0ff, swordViolet: 0xc58cff,
  blood: 0x8a1c1c, bone: 0xe6dcc6, iron: 0x9aa0a8, leather: 0x5a3b23, cloth: 0x7a3f2e,
};

/** Atlas layout shared by materials.js (texture) and dungeon.js (cell choice). */
export const ATLAS = { cols: 4, rows: 4, cell: 128 };
/** Named atlas cells (index = row * cols + col). */
export const CELLS = {
  plain: [0, 1, 2, 3, 4, 5, 6, 7], cracked: [8, 9], mossy: [10, 11], wet: [12, 13], mosaic: 14, marble: 15,
};
/** UV offset of an atlas cell. */
export function cellUV(i) { return [(i % ATLAS.cols) / ATLAS.cols, 1 - (Math.floor(i / ATLAS.cols) + 1) / ATLAS.rows]; } // canvas textures are Y-flipped on upload

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
export function makeTexture(size, fn, { repeat = 1 } = {}) {
  return rgbTexture(size, size, (x, y) => fn(x / size, y / size, x, y), { repeat, srgb: true });
}

/**
 * Texture from a per-pixel RGB callback (x, y in pixels). Non-colour data (normals, roughness,
 * grunge) is stored linear (`srgb: false`).
 */
export function rgbTexture(w, h, fn, { repeat = 1, srgb = true, anisotropy = 4 } = {}) {
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
  return tex;
}

/** Tangent-space normal map from a height array (w*h floats, 0..1). `strength` in texels of slope. */
function normalFromHeight(hgt, w, h, strength, { wrap = true } = {}) {
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
  }, { srgb: false });
}

function hexToRgb(hex) { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** A random crack polyline (list of [x,y] in 0..1 cell space) with optional branch. */
function makeCrack(r, len, step = 0.014) {
  let x = r.float(0.15, 0.85), y = r.float(0.15, 0.85), a = r.float(0, Math.PI * 2);
  const pts = [];
  for (let i = 0; i < len; i++) { pts.push([x, y]); a += r.float(-0.55, 0.55); x += Math.cos(a) * step; y += Math.sin(a) * step; if (x < 0.02 || x > 0.98 || y < 0.02 || y > 0.98) break; }
  return pts;
}
function crackMask(cracks, u, v, width) {
  let m = 0;
  for (const c of cracks) {
    const w = c.width || width;
    for (const [px, py] of c.pts) { const d = Math.hypot(px - u, py - v); if (d < w) m = Math.max(m, 1 - d / w); }
  }
  return m;
}

/**
 * The flagstone atlas: 16 unique slabs sharing one height field so albedo, normal and roughness agree.
 * Returns { albedo, normal, rough, obsidian } textures.
 */
function flagstoneAtlas() {
  const S = ATLAS.cell, W = S * ATLAS.cols, H = S * ATLAS.rows;
  const r = rng.fork('atlas');
  const kinds = [];
  for (let i = 0; i < 16; i++) {
    const kind = i < 8 ? 'plain' : i < 10 ? 'cracked' : i < 12 ? 'mossy' : i < 14 ? 'wet' : i === 14 ? 'mosaic' : 'marble';
    const cracks = [];
    const nCr = kind === 'cracked' ? r.int(2, 3) : kind === 'mosaic' || kind === 'marble' ? 0 : r.int(0, 2);
    for (let c = 0; c < nCr; c++) cracks.push({ pts: makeCrack(r, kind === 'cracked' ? 70 : 34), width: kind === 'cracked' ? r.float(0.012, 0.02) : r.float(0.007, 0.011) });
    // chips: blobs bitten out of the edge; a cracked slab may lose a corner
    const chips = [];
    const nCh = kind === 'mosaic' || kind === 'marble' ? 0 : r.int(1, 3);
    for (let c = 0; c < nCh; c++) {
      const side = r.int(0, 3), t = r.float(0.1, 0.9), rad = r.float(0.03, 0.07);
      chips.push(side === 0 ? [t, 0, rad] : side === 1 ? [t, 1, rad] : side === 2 ? [0, t, rad] : [1, t, rad]);
    }
    if (kind === 'cracked') chips.push([r.int(0, 1), r.int(0, 1), r.float(0.14, 0.22)]);
    const tint = [1 + r.float(-0.08, 0.08), 1 + r.float(-0.06, 0.05), 1 + r.float(-0.1, 0.08)];
    const lift = r.float(0.82, 1.08);
    const mossSeed = r.float(0, 40);
    kinds.push({ kind, cracks, chips, tint, lift, mossSeed, id: i });
  }
  const hgt = new Float32Array(W * H);
  const alb = new Float32Array(W * H * 3);
  const rgh = new Float32Array(W * H);
  const obs = new Float32Array(W * H * 3);
  const base = [0.72, 0.64, 0.52], grout = [0.16, 0.145, 0.13], mossC = hexToRgb(PALETTE.moss);
  const obsBase = hexToRgb(PALETTE.obsidian);
  for (let cy = 0; cy < ATLAS.rows; cy++) for (let cx = 0; cx < ATLAS.cols; cx++) {
    const K = kinds[cy * ATLAS.cols + cx];
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const u = (px + 0.5) / S, v = (py + 0.5) / S;
      const gx = cx * S + px, gy = cy * S + py, gi = gy * W + gx;
      const ox = K.id * 3.7, oy = K.id * 1.9;
      let h, col, rough;
      if (K.kind === 'mosaic') {
        // 10x10 tesserae, radial pattern: white centre cross, gold ring, lapis field, gold border
        const n = 10, tu = u * n, tv = v * n, iu = Math.floor(tu), iv = Math.floor(tv);
        const fu = tu - iu, fv = tv - iv;
        const e = Math.min(fu, 1 - fu, fv, 1 - fv);
        const inT = sstep(0.04, 0.16, e);
        const dc = Math.hypot(iu + 0.5 - n / 2, iv + 0.5 - n / 2);
        const jitter = N.noise(iu * 13.1 + ox, iv * 7.7 + oy);
        let tc;
        const cross = Math.abs(iu + 0.5 - n / 2) < 1 || Math.abs(iv + 0.5 - n / 2) < 1;
        if (dc < 1.6) tc = [0.9, 0.86, 0.78];
        else if (dc < 3.0) tc = cross ? [0.9, 0.86, 0.78] : [0.78, 0.6, 0.22];
        else if (iu === 0 || iv === 0 || iu === n - 1 || iv === n - 1) tc = [0.72, 0.56, 0.2];
        else tc = cross ? [0.85, 0.78, 0.6] : [0.14, 0.24, 0.5];
        tc = scale(tc, 0.85 + jitter * 0.3);
        h = 0.55 + inT * 0.45 + (N.noise(u * 90 + ox, v * 90) - 0.5) * 0.06;
        col = mix(grout, tc, inT);
        rough = 0.62 - inT * 0.22;
      } else if (K.kind === 'marble') {
        const edge = Math.min(u, 1 - u, v, 1 - v);
        const bev = sstep(0, 0.045, edge);
        const vein = Math.abs(Math.sin((u * 2.6 + N.fbm(u * 4 + ox, v * 4 + oy, 4) * 2.8) * Math.PI));
        h = bev * (0.92 + N.fbm(u * 6 + ox, v * 6, 3) * 0.08);
        col = scale([0.84, 0.82, 0.76], 0.9 + N.fbm(u * 8 + ox, v * 8, 3) * 0.16);
        col = mix(col, [0.5, 0.5, 0.56], Math.pow(1 - vein, 9) * 0.85);
        col = mix(grout, col, sstep(0.0, 0.5, h));
        rough = 0.38 + (1 - bev) * 0.4;
      } else {
        // --- flagstone height: bevel + chips + surface + cracks
        let edge = Math.min(u, 1 - u, v, 1 - v);
        edge -= 0.012 * (N.noise(u * 9 + ox, v * 9 + oy) - 0.5); // ragged outline
        let hh = sstep(0, 0.06, edge);
        for (const [chx, chy, rad] of K.chips) { const d = Math.hypot(u - chx, v - chy); hh *= 1 - sstep(rad, rad * 0.55, d) * (0.9 + 0.1 * N.noise(u * 50, v * 50)); }
        const surf = (N.fbm(u * 5 + ox, v * 5 + oy, 4) - 0.5) * 0.22 + (N.noise(u * 44 + ox, v * 44) - 0.5) * 0.07;
        hh = hh * (0.85 + surf);
        const cm = crackMask(K.cracks, u, v, 0.012);
        hh -= cm * 0.45 * hh;
        h = clamp01(hh);
        // --- albedo
        const grain = 0.86 + N.fbm(u * 7 + ox, v * 7 + oy, 3) * 0.3;
        const speck = 0.92 + N.noise(u * 70 + ox, v * 70 + oy) * 0.16;
        col = scale([base[0] * K.tint[0], base[1] * K.tint[1], base[2] * K.tint[2]], K.lift * grain * speck);
        col = scale(col, 1 - cm * 0.38);
        col = mix(grout, col, sstep(0.05, 0.45, h));
        rough = 0.9 + cm * 0.08 - (h - 0.5) * 0.08;
        if (K.kind === 'mossy') {
          const m = sstep(0.42, 0.7, N.fbm(u * 3.5 + K.mossSeed, v * 3.5 + K.mossSeed, 4)) * (1 - sstep(0.7, 1, h) * 0.6);
          col = mix(col, scale(mossC, 0.75 + N.noise(u * 30, v * 30) * 0.5), m * 0.85);
          rough = rough - m * 0.15;
        } else if (K.kind === 'wet') {
          const puddle = sstep(0.55, 0.9, 1 - h) * 0.7 + 0.3;
          col = scale([col[0] * 0.66, col[1] * 0.68, col[2] * 0.72], 0.85);
          rough = 0.22 + (1 - puddle) * 0.35;
        }
      }
      hgt[gi] = h;
      alb[gi * 3] = col[0]; alb[gi * 3 + 1] = col[1]; alb[gi * 3 + 2] = col[2];
      rgh[gi] = clamp01(rough);
      // obsidian look for the sword level: same relief, glassy violet-black with lighter veins
      const vein = N.fbm(u * 5 + ox, v * 5 + oy, 4);
      let oc = mix(obsBase, [0.38, 0.3, 0.5], vein * 0.55);
      oc = scale(oc, 0.35 + h * 0.75);
      if (K.kind === 'mosaic') oc = mix(oc, [0.55, 0.42, 0.2], sstep(0.7, 1, h) * 0.5);
      obs[gi * 3] = oc[0]; obs[gi * 3 + 1] = oc[1]; obs[gi * 3 + 2] = oc[2];
    }
  }
  const albedo = rgbTexture(W, H, (x, y) => { const i = (y * W + x) * 3; return [alb[i], alb[i + 1], alb[i + 2]]; });
  const obsidian = rgbTexture(W, H, (x, y) => { const i = (y * W + x) * 3; return [obs[i], obs[i + 1], obs[i + 2]]; });
  const rough = rgbTexture(W, H, (x, y) => { const v = rgh[y * W + x]; return [v, v, v]; }, { srgb: false });
  const normal = normalFromHeight(hgt, W, H, 2.6, { wrap: false });
  for (const t of [albedo, obsidian, rough, normal]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
  return { albedo, normal, rough, obsidian };
}

/**
 * Continuous masonry strip: u spans 4 tiles (repeat), v spans one wall height. Running bond with
 * courses of varied height, bricks of varied length, chipped corners, proud/recessed stones.
 * Returns { albedo, normal, rough, obsidian }.
 */
function masonryStrip() {
  const W = 1024, H = 256;
  const r = rng.fork('masonry');
  // courses (bottom to top), heights sum to 1
  const nRows = 5;
  let hs = Array.from({ length: nRows }, () => r.float(0.75, 1.25));
  const hsum = hs.reduce((a, b) => a + b, 0); hs = hs.map((v) => v / hsum);
  const rows = [];
  let v0 = 0;
  for (let i = 0; i < nRows; i++) {
    // bricks along u (period 1 = 4 tiles); lengths vary 0.28..0.55 tiles
    const bricks = [];
    let u = r.float(0, 0.12), guard = 0;
    while (u < 1 && guard++ < 40) { const len = r.float(0.07, 0.135); bricks.push({ u0: u, u1: Math.min(1, u + len), tint: r.float(0.72, 1.18), hue: r.float(-0.05, 0.05), red: r.chance(0.12) ? r.float(0.1, 0.3) : 0, proud: r.float(-0.12, 0.12), chips: [r.chance(0.6) ? r.float(0.02, 0.05) : 0, r.chance(0.6) ? r.float(0.02, 0.05) : 0, r.chance(0.35) ? r.float(0.02, 0.05) : 0, r.chance(0.35) ? r.float(0.02, 0.05) : 0] }); u += len; }
    // last brick wraps to close the period
    bricks[bricks.length - 1].u1 = 1 + bricks[0].u0;
    rows.push({ v0, v1: v0 + hs[i], bricks });
    v0 += hs[i];
  }
  const hgt = new Float32Array(W * H);
  const alb = new Float32Array(W * H * 3);
  const rgh = new Float32Array(W * H);
  const obs = new Float32Array(W * H * 3);
  const base = [0.5, 0.465, 0.43], mortar = [0.2, 0.185, 0.165], obsBase = hexToRgb(PALETTE.obsidian);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const u = (px + 0.5) / W, v = 1 - (py + 0.5) / H; // v = 0 at the bottom of the wall
    const row = rows.find((rw) => v >= rw.v0 && v < rw.v1) || rows[nRows - 1];
    let brick = row.bricks.find((b) => u >= b.u0 && u < b.u1);
    let uu = u;
    if (!brick) { brick = row.bricks[row.bricks.length - 1]; uu = u + 1; }
    const bw = (brick.u1 - brick.u0) * 4, bh = (row.v1 - row.v0) * 0.85; // world sizes
    const bu = (uu - brick.u0) / (brick.u1 - brick.u0), bv = (v - row.v0) / (row.v1 - row.v0);
    // distance to brick edge in world units
    const du = Math.min(bu, 1 - bu) * bw, dv = Math.min(bv, 1 - bv) * bh;
    let edge = Math.min(du, dv) - 0.006 * (N.noise(u * 300, v * 60) - 0.5);
    // chipped corners
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
    let chip = 0;
    for (let c = 0; c < 4; c++) { const rad = brick.chips[c]; if (!rad) continue; const d = Math.hypot((bu - corners[c][0]) * bw, (bv - corners[c][1]) * bh); chip = Math.max(chip, sstep(rad, rad * 0.4, d)); }
    const mortarW = 0.014;
    const face = sstep(mortarW, mortarW + 0.035, edge) * (1 - chip * 0.85);
    const bulge = (N.fbm(u * 24 + brick.u0 * 50, v * 6 + row.v0 * 9, 3) - 0.5) * 0.18 + (N.noise(u * 220, v * 55) - 0.5) * 0.05;
    let h = 0.28 + face * (0.5 + brick.proud * 0.5 + bulge);
    h = clamp01(h);
    let col = scale([base[0] * (1 + brick.hue + brick.red), base[1] * (1 - Math.abs(brick.hue) * 0.5), base[2] * (1 - brick.hue - brick.red * 0.6)], brick.tint);
    col = scale(col, 0.85 + N.fbm(u * 30 + brick.u0 * 20, v * 8, 3) * 0.3);
    col = scale(col, 0.92 + N.noise(u * 400, v * 100) * 0.16);
    col = mix(scale(mortar, 0.8 + N.noise(u * 150, v * 40) * 0.4), col, sstep(0.1, 0.7, face));
    // soot near the top, dirt at the foot
    col = scale(col, 1 - sstep(0.7, 1, v) * 0.15 - sstep(0.3, 0.0, v) * 0.2);
    const gi = py * W + px;
    hgt[gi] = h;
    alb[gi * 3] = col[0]; alb[gi * 3 + 1] = col[1]; alb[gi * 3 + 2] = col[2];
    rgh[gi] = clamp01(0.86 + (1 - face) * 0.1 - brick.red * 0.2);
    let oc = mix(obsBase, [0.42, 0.34, 0.55], N.fbm(u * 12, v * 4, 3) * 0.5);
    oc = scale(oc, 0.3 + face * 0.7);
    obs[gi * 3] = oc[0]; obs[gi * 3 + 1] = oc[1]; obs[gi * 3 + 2] = oc[2];
  }
  const albedo = rgbTexture(W, H, (x, y) => { const i = (y * W + x) * 3; return [alb[i], alb[i + 1], alb[i + 2]]; });
  const obsidian = rgbTexture(W, H, (x, y) => { const i = (y * W + x) * 3; return [obs[i], obs[i + 1], obs[i + 2]]; });
  const rough = rgbTexture(W, H, (x, y) => { const v = rgh[y * W + x]; return [v, v, v]; }, { srgb: false });
  const normal = normalFromHeight(hgt, W, H, 3.2);
  return { albedo, normal, rough, obsidian };
}

/** Tileable world-space macro variation: moss in damp hollows, dirt, soot. Stored as multiplier / 1.4. */
function grungeTexture() {
  const S = 256, P = 8;
  const mossC = [0.72, 0.98, 0.55], dirt = [0.9, 0.78, 0.6], soot = [0.7, 0.68, 0.7];
  return rgbTexture(S, S, (x, y) => {
    const u = x / S * P, v = y / S * P;
    const a = N.pfbm(u, v, P, 4), b = N.pfbm(u + 3.3, v + 7.1, P, 3), c = N.pfbm(u * 2 + 11, v * 2 + 5, P * 2, 3);
    let m = [1, 1, 1];
    m = scale(m, 0.86 + a * 0.3);
    m = mix(m, mossC, sstep(0.58, 0.8, b) * 0.65);
    m = mix(m, dirt, sstep(0.6, 0.85, c) * 0.4);
    m = mix(m, soot, sstep(0.25, 0.05, a) * 0.5);
    return scale(m, 1 / 1.4);
  }, { srgb: false, anisotropy: 2 });
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

/** Yellow/black checker homage for hidden treasure-or-trap squares. */
function checkerTexture() {
  return makeTexture(64, (u, v, x, y) => {
    const on = ((x >> 3) + (y >> 3)) & 1;
    const n = N.noise(u * 20, v * 20);
    return on ? [0.75 * (0.85 + n * 0.3), 0.7 * (0.85 + n * 0.3), 0.3] : [0.12, 0.1, 0.08];
  });
}

/** Veined marble for altars and pillars (kept for props). */
function marbleTexture() {
  const base = [0.86, 0.84, 0.78];
  return makeTexture(128, (u, v) => {
    const vein = Math.abs(Math.sin((u * 3 + N.fbm(u * 4, v * 4, 4) * 2.5) * Math.PI));
    let c = scale(base, 0.9 + N.fbm(u * 8, v * 8, 3) * 0.15);
    c = mix(c, [0.55, 0.55, 0.6], Math.pow(1 - vein, 8) * 0.8);
    return c;
  });
}

/** Plain cut stone (arches, plinths): fine grain, faint tool marks. */
function cutStoneTexture() {
  return makeTexture(64, (u, v) => {
    const n = N.pfbm(u * 6, v * 6, 6, 3);
    const marks = 0.96 + 0.08 * Math.sin(v * 90 + N.pnoise(u * 3, v * 3, 3, 3) * 6);
    return scale([0.6, 0.57, 0.53], (0.8 + n * 0.4) * marks);
  });
}

/** Dirt / rubble ground (also the bed under the flagstones). */
function dirtTexture() {
  return makeTexture(64, (u, v) => {
    const n = N.pfbm(u * 5, v * 5, 5, 4);
    return scale([0.36, 0.3, 0.23], 0.6 + n * 0.6);
  });
}

/** Mosaic medallion for the temple floor (planar, meant for a ring/disc decal). */
function medallionTexture() {
  const S = 256;
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
    tc = scale(tc, 0.82 + jitter * 0.34);
    return mix([0.16, 0.145, 0.13], tc, inT);
  });
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
 *  - `grunge`: multiplies albedo by the world-space grunge map at two incommensurate scales.
 * @param {THREE.Material} m
 * @param {import('./lighting.js').FogOfWar} fog
 * @param {{atlas?:boolean, grunge?:number, grungeTex?:THREE.Texture, worldUV?:number}} opts
 */
export function patchSurface(m, fog, opts = {}) {
  patchFog(m, fog);
  const prev = m.onBeforeCompile;
  const grungeTex = opts.grungeTex || getTextures().grunge;
  const key = `surface:${opts.atlas ? 'atlas' : 'uv'}:${opts.grunge ? 'g' : 'n'}`;
  m.onBeforeCompile = (shader) => {
    prev(shader);
    if (opts.atlas) {
      shader.uniforms.uAtlas = { value: new THREE.Vector2(1 / ATLAS.cols, 1 / ATLAS.rows) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aTile; uniform vec2 uAtlas;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>
        { vec2 tuv = uv * uAtlas + aTile;
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
    }
    if (opts.grunge) {
      shader.uniforms.uGrunge = { value: grungeTex };
      shader.uniforms.uGrungeAmt = { value: opts.grunge };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uGrunge; uniform float uGrungeAmt;')
        .replace('#include <map_fragment>', `#include <map_fragment>
        { vec3 g1 = texture2D(uGrunge, vFogXZ * 0.071 + 0.13).rgb * 1.5;
          vec3 g2 = texture2D(uGrunge, vFogXZ * 0.0293 + 0.61).rgb * 1.5;
          diffuseColor.rgb *= mix(vec3(1.0), g1 * g2, uGrungeAmt); }`);
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
  const mats = {
    // instanced flagstones (aTile per instance, AO/tint via instanceColor)
    floor: surf({ map: A.albedo, normalMap: A.normal, normalScale, roughnessMap: A.rough, roughness: 1, metalness: 0.02 }, { atlas: true, grunge: 0.8 }),
    // merged wall caps: same atlas, per-vertex colour
    floorCap: surf({ map: A.albedo, normalMap: A.normal, normalScale, roughnessMap: A.rough, roughness: 1, metalness: 0.02, vertexColors: true }, { atlas: true, grunge: 0.6 }),
    // merged wall bodies mapped in world units
    wall: surf({ map: M.albedo, normalMap: M.normal, normalScale: new THREE.Vector2(1.0, 1.0), roughnessMap: M.rough, roughness: 1, metalness: 0, vertexColors: true }, { grunge: 0.7 }),
    obsidianFloor: surf({ map: A.obsidian, normalMap: A.normal, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.5, metalness: 0.12 }, { atlas: true, grunge: 0.35 }),
    obsidianCap: surf({ map: A.obsidian, normalMap: A.normal, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.5, metalness: 0.12, vertexColors: true }, { atlas: true, grunge: 0.35 }),
    obsidianWall: surf({ map: M.obsidian, normalMap: M.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.5, metalness: 0.15, color: 0xcdbde0, vertexColors: true }, { grunge: 0.3 }),
    marble: std({ map: T.marble, roughness: 0.35, metalness: 0.05 }),
    medallion: std({ map: T.medallion, roughness: 0.45, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    checker: std({ map: T.checker, roughness: 0.8 }),
    dirt: std({ map: T.dirt, roughness: 1 }),
    dark: std({ color: 0x050405, roughness: 1 }),
    pitWall: surf({ map: M.albedo, normalMap: M.normal, roughnessMap: M.rough, roughness: 1, color: 0xd8d0c8, vertexColors: true }, { grunge: 0.5 }),
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

// Procedural textures (canvas) and shared materials for the dungeon diorama. Everything is
// generated in code from a seeded RNG; no assets are loaded. Materials are fog-of-war patched
// by lighting.js (see patchFog) so darkness is applied in the shader.
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

const rng = createRng('fargoal-materials');

/** Value-noise generator with a seeded permutation table. */
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
  return { noise, fbm };
}

const N = makeNoise(rng.fork('noise'));

/**
 * Build a canvas texture by evaluating fn(u, v) -> [r, g, b] (0..1) per pixel.
 * @param {number} size
 * @param {(u:number,v:number,x:number,y:number)=>number[]} fn
 */
export function makeTexture(size, fn, { repeat = 1 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b] = fn(x / size, y / size, x, y);
    const i = (y * size + x) * 4;
    d[i] = Math.max(0, Math.min(255, r * 255)); d[i + 1] = Math.max(0, Math.min(255, g * 255)); d[i + 2] = Math.max(0, Math.min(255, b * 255)); d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  return tex;
}

function hexToRgb(hex) { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }

/** One flagstone slab: bevelled edges, speckle, a couple of cracks. */
function flagstoneTexture() {
  const base = [0.68, 0.61, 0.5];
  const cracks = [];
  for (let c = 0; c < 3; c++) {
    let x = rng.float(0.1, 0.9), y = rng.float(0.1, 0.9), a = rng.float(0, Math.PI * 2);
    const pts = [];
    for (let i = 0; i < 40; i++) { pts.push([x, y]); a += rng.float(-0.6, 0.6); x += Math.cos(a) * 0.015; y += Math.sin(a) * 0.015; }
    cracks.push(pts);
  }
  return makeTexture(128, (u, v) => {
    const edge = Math.min(u, 1 - u, v, 1 - v);
    const bevel = Math.min(1, edge / 0.045);
    let n = N.fbm(u * 6, v * 6, 4);
    let c = scale(base, 0.8 + n * 0.45);
    // grain
    c = scale(c, 0.9 + N.noise(u * 60, v * 60) * 0.2);
    // cracks
    let crack = 0;
    for (const pts of cracks) for (const [px, py] of pts) { const d = Math.hypot(px - u, py - v); if (d < 0.012) crack = Math.max(crack, 1 - d / 0.012); }
    c = scale(c, 1 - crack * 0.55);
    // bevel darkening + grout line
    c = scale(c, 0.72 + bevel * 0.28);
    if (edge < 0.012) c = scale(c, 0.8);
    return c;
  });
}

/** Coarse masonry: courses of bricks with mortar and bevels. */
function masonryTexture() {
  const base = [0.5, 0.47, 0.44];
  const rows = 5, cols = 3;
  return makeTexture(128, (u, v) => {
    const row = Math.floor(v * rows);
    const uo = (u + (row % 2) * 0.5 / cols * 1.0) % 1;
    const col = Math.floor(uo * cols);
    const bu = (uo * cols) % 1, bv = (v * rows) % 1;
    const edge = Math.min(bu, 1 - bu, bv * 1.6, (1 - bv) * 1.6);
    const id = (row * 7 + col * 13 + (row % 2) * 3) * 0.37;
    const tint = 0.78 + (N.noise(id, id * 1.7) - 0.5) * 0.5;
    let c = scale(base, tint);
    c = scale(c, 0.85 + N.fbm(u * 10 + id, v * 10, 3) * 0.3);
    c = scale(c, 0.9 + N.noise(u * 70, v * 70) * 0.2);
    const bevel = Math.min(1, edge / 0.12);
    c = scale(c, 0.3 + bevel * 0.7);
    if (edge < 0.035) c = mix(c, [0.16, 0.14, 0.13], 0.8);
    // mossy tint low in the wall
    if (v > 0.8) c = mix(c, hexToRgb(PALETTE.moss), (v - 0.8) * 0.6 * N.fbm(u * 8, v * 8, 2));
    return c;
  });
}

/** Veined marble for temples and altars. */
function marbleTexture() {
  const base = [0.86, 0.84, 0.78];
  return makeTexture(128, (u, v) => {
    const vein = Math.abs(Math.sin((u * 3 + N.fbm(u * 4, v * 4, 4) * 2.5) * Math.PI));
    let c = scale(base, 0.9 + N.fbm(u * 8, v * 8, 3) * 0.15);
    c = mix(c, [0.55, 0.55, 0.6], Math.pow(1 - vein, 8) * 0.8);
    return c;
  });
}

/** Yellow/black checker homage for hidden treasure-or-trap squares. */
function checkerTexture() {
  return makeTexture(64, (u, v, x, y) => {
    const on = ((x >> 3) + (y >> 3)) & 1;
    const n = N.noise(u * 20, v * 20);
    return on ? [0.75 * (0.85 + n * 0.3), 0.7 * (0.85 + n * 0.3), 0.3] : [0.12, 0.1, 0.08];
  });
}

/** Dirt / rubble ground. */
function dirtTexture() {
  return makeTexture(64, (u, v) => {
    const n = N.fbm(u * 5, v * 5, 4);
    return scale([0.42, 0.34, 0.26], 0.7 + n * 0.6);
  });
}

/** Obsidian for the sword level. */
function obsidianTexture() {
  return makeTexture(128, (u, v) => {
    const edge = Math.min(u, 1 - u, v, 1 - v);
    const bevel = Math.min(1, edge / 0.05);
    const n = N.fbm(u * 5, v * 5, 4);
    let c = mix(hexToRgb(PALETTE.obsidian), [0.35, 0.28, 0.45], n * 0.5);
    c = scale(c, 0.4 + bevel * 0.6);
    return c;
  });
}

/** Lazily created texture set. */
let textures = null;
export function getTextures() {
  if (!textures) {
    textures = {
      flagstone: flagstoneTexture(), masonry: masonryTexture(), marble: marbleTexture(),
      checker: checkerTexture(), dirt: dirtTexture(), obsidian: obsidianTexture(),
    };
  }
  return textures;
}

/**
 * Shared material set. `fog` is the FogOfWar instance whose uniforms get injected.
 * @param {import('./lighting.js').FogOfWar} fog
 */
export function createMaterials(fog) {
  const T = getTextures();
  const std = (opts) => { const m = new THREE.MeshStandardMaterial(opts); patchFog(m, fog); return m; };
  const mats = {
    floor: std({ map: T.flagstone, roughness: 0.92, metalness: 0.02 }),
    wall: std({ map: T.masonry, roughness: 0.95, metalness: 0.0 }),
    obsidianFloor: std({ map: T.obsidian, roughness: 0.35, metalness: 0.2 }),
    obsidianWall: std({ map: T.obsidian, roughness: 0.4, metalness: 0.25, color: 0xb9a9d0 }),
    marble: std({ map: T.marble, roughness: 0.35, metalness: 0.05 }),
    checker: std({ map: T.checker, roughness: 0.8 }),
    dirt: std({ map: T.dirt, roughness: 1 }),
    dark: std({ color: 0x050405, roughness: 1 }),
    pitWall: std({ color: 0x1a1512, roughness: 1 }),
    rim: std({ color: 0x6a6058, roughness: 0.9 }),
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
    rune: new THREE.MeshBasicMaterial({ color: PALETTE.magic, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    beacon: std({ color: 0x4bd66a, roughness: 0.3, emissive: 0x2fbf4f, emissiveIntensity: 1.2, transparent: true, opacity: 0.9 }),
    potionBlue: std({ color: 0x4a7dff, roughness: 0.2, transparent: true, opacity: 0.85, emissive: 0x1030a0, emissiveIntensity: 0.6 }),
    sackCloth: std({ color: 0x8a6a45, roughness: 0.95 }),
    magicSack: std({ color: 0x5b3a8a, roughness: 0.9, emissive: 0x2a1050, emissiveIntensity: 0.3 }),
    rope: std({ color: 0x9c7c4c, roughness: 1 }),
  };
  mats.flame.toneMapped = false;
  mats.holyGlow.toneMapped = false;
  mats.rune.toneMapped = false;
  return mats;
}

/** Character material: flat shaded, vertex-coloured; one instance per character so flashes work. */
export function createCharacterMaterial(fog, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.78, metalness: 0.08, ...opts });
  patchFog(m, fog);
  return m;
}

/** Water surface shader: animated ripples, fresnel-ish highlight, fog-of-war aware. */
export function createWaterMaterial(fog) {
  const uniforms = {
    uTime: { value: 0 }, uLightPos: { value: new THREE.Vector3() }, uLightColor: { value: new THREE.Color(0xffc080) },
    fogTex: fog.uniforms.fogTex, fogSize: fog.uniforms.fogSize, fogTint: fog.uniforms.fogTint,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: `
      varying vec2 vFogXZ; varying vec3 vWorld; varying vec2 vUv;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vFogXZ = w.xz; vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uLightPos; uniform vec3 uLightColor;
      varying vec2 vFogXZ; varying vec3 vWorld; varying vec2 vUv;
      ${fog.glsl()}
      float wave(vec2 p, float t) {
        return sin(p.x * 6.0 + t * 1.3) * 0.5 + sin(p.y * 7.0 - t * 1.1) * 0.5 + sin((p.x + p.y) * 4.5 + t * 0.7) * 0.5;
      }
      void main() {
        vec2 p = vWorld.xz;
        float h = wave(p, uTime);
        float h2 = wave(p * 1.7 + 3.1, uTime * 1.4);
        vec3 deep = vec3(0.02, 0.10, 0.15);
        vec3 shallow = vec3(0.10, 0.32, 0.38);
        vec3 col = mix(deep, shallow, 0.5 + 0.5 * h * 0.6);
        float caustic = pow(max(0.0, 0.5 + 0.5 * h2), 6.0) * 0.6;
        col += vec3(0.35, 0.6, 0.65) * caustic;
        // player light reflection
        vec3 toL = uLightPos - vWorld;
        float d = length(toL);
        float lit = 1.6 / (1.0 + d * d * 0.35);
        vec3 nrm = normalize(vec3(h * 0.25, 1.0, h2 * 0.25));
        float spec = pow(max(0.0, dot(nrm, normalize(toL + vec3(0.0, 2.0, 0.0)))), 24.0);
        col += uLightColor * (lit * 0.25 + spec * lit * 0.9);
        col = applyFog(col, vFogXZ);
        gl_FragColor = vec4(col, 0.9);
      }`,
  });
  return mat;
}

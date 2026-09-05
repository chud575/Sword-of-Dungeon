// Atmosphere: the "air" of the dungeon, three draw calls total.
//  - Dust: a GPU-drifting mote cloud that wraps around the player and is lit by the live lights
//    (player lantern + torches), so motes only sparkle where there is light to catch.
//  - Torch halos: additive soft billboards at every torch flame, flickering in sync with the lights.
//  - Light shafts: slanted, camera-facing sheets of cool light falling from cracks in the ceiling of
//    the bigger rooms (with a soft pool on the floor), strongest in the upper halls, fading with depth.
// Everything is fog-of-war aware (unknown = nothing, remembered = dim), deterministic (seeded per
// level, animated purely from time) and safe on SwiftShader (plain points/quads, no derivatives).
import * as THREE from 'three';
import { TILE } from '../core/constants.js';
import { createRng } from '../core/rng.js';
import { depthTint, torchFlicker, LIGHT_MOODS, MOOD_KEYS } from './lighting.js';

const MAX_LIGHTS = 12;
const DUST_COUNT = 900;
/** Air detail: embers off the fires, drips in the wet rooms, spores over the fungus. One draw call. */
const AIR_MAX = 420;

const AIR_VS = `
attribute float aSeed; attribute float aKind; attribute float aSize;
uniform float uTime; uniform float uScale;
varying float vKind; varying float vAlpha; varying vec2 vFogXZ;
void main() {
  float s = aSeed * 6.2831;
  vec3 p = position;
  float a = 1.0;
  if (aKind < 0.5) {
    // ember: lifts out of the fire, wanders, and burns out before it gets far
    float c = fract(uTime * (0.32 + aSeed * 0.22) + aSeed);
    p.y += c * 1.15;
    p.x += sin(uTime * 1.7 + s) * 0.12 * c + c * 0.06;
    p.z += cos(uTime * 1.3 + s * 1.7) * 0.12 * c;
    a = (1.0 - c) * (0.35 + 0.65 * abs(sin(uTime * 9.0 + s)));
  } else if (aKind < 1.5) {
    // drip: falls from the ceiling, over and over, on its own beat
    float c = fract(uTime * (0.35 + aSeed * 0.3) + aSeed);
    float f = c * c;                        // it accelerates, because it is falling
    p.y = position.y - f * (position.y - 0.02);
    a = smoothstep(0.0, 0.06, c) * (1.0 - smoothstep(0.86, 1.0, c));
  } else {
    // spore: drifts, never lands
    float c = uTime * 0.11 + aSeed;
    p.y += 0.18 + sin(c * 2.1 + s) * 0.16;
    p.x += sin(c * 1.3 + s) * 0.42;
    p.z += cos(c * 1.1 + s * 1.4) * 0.42;
    a = 0.55 + 0.45 * sin(uTime * 0.8 + s);
  }
  vKind = aKind; vAlpha = a; vFogXZ = p.xz;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_PointSize = aSize * uScale / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const AIR_FS = `
uniform vec3 uEmber; uniform vec3 uDrip; uniform vec3 uSpore;
varying float vKind; varying float vAlpha; varying vec2 vFogXZ;
FOG
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, d) * vAlpha;
  vec3 c = vKind < 0.5 ? uEmber : vKind < 1.5 ? uDrip : uSpore;
  if (vKind > 0.5) c = applyFog(c, vFogXZ);      // embers keep their own heat; water and spores do not
  else c = mix(applyFog(c, vFogXZ), c, 0.45);
  gl_FragColor = vec4(c * a, a);
}`;

const DUST_VS = `
attribute float aSeed; attribute float aSize;
uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform float uScale;
uniform vec4 uLightPos[${MAX_LIGHTS}]; uniform vec3 uLightCol[${MAX_LIGHTS}];
varying vec3 vColor; varying float vAlpha; varying vec2 vFogXZ;
void main() {
  float s = aSeed * 6.2831;
  vec3 p = position;
  p += vec3(sin(uTime * 0.21 + s) * 0.55 + uTime * 0.05, sin(uTime * 0.13 + s * 1.7) * 0.28 - uTime * 0.02, cos(uTime * 0.17 + s * 2.3) * 0.55);
  // keep the cloud centred on the player by wrapping into a box around them
  p = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5 + uCenter;
  vec3 lit = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec3 d = p - uLightPos[i].xyz;
    float dd = dot(d, d);
    lit += uLightCol[i] * (uLightPos[i].w / (1.0 + dd * 1.1));
  }
  float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + aSeed * 2.0) + s * 3.0);
  vColor = lit;
  vAlpha = twinkle;
  vFogXZ = p.xz;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_PointSize = aSize * uScale / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const DUST_FS = `
uniform vec3 uTint; uniform float uDensity;
varying vec3 vColor; varying float vAlpha; varying vec2 vFogXZ;
FOG
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.1, d) * vAlpha * uDensity;
  vec3 c = applyFog(vColor * uTint, vFogXZ) * 0.42;
  gl_FragColor = vec4(c * a, a);
}`;

const BILLBOARD_VS = `
attribute vec2 aCorner; attribute vec3 aCenter; attribute vec4 aParam; // param: sizeX, sizeY, phase/slant, kind
attribute vec3 aTint;
uniform float uTime;
varying vec2 vUv; varying float vKind; varying float vGlow; varying vec2 vFogXZ; varying vec3 vTint;
void main() {
  vTint = aTint;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p;
  float kind = aParam.w;
  if (kind < 0.5) {
    // torch halo: full billboard, flickers with the torch
    float t = uTime, ph = aParam.z;
    float f = 0.72 + 0.14 * sin(t * 8.1 + ph) + 0.07 * sin(t * 17.3 + ph * 2.1) + 0.05 * sin(t * 3.3 + ph * 0.7) + 0.06 * sin(t * 0.5 + ph * 1.3);
    vGlow = f;
    p = aCenter + right * aCorner.x * aParam.x + up * aCorner.y * aParam.y;
  } else if (kind < 1.5) {
    // light shaft: y-axis billboard sheet, slanted, drifting slowly
    vec3 r = normalize(vec3(right.x, 0.0, right.z));
    float v = aCorner.y + 0.5;
    p = aCenter + r * aCorner.x * aParam.x + vec3(aParam.z * v + sin(uTime * 0.15) * 0.15, aParam.y * v, 0.0);
    vGlow = 1.0;
  } else if (kind < 2.5) {
    // floor pool under a shaft: flat disc
    p = aCenter + vec3(aCorner.x * aParam.x, 0.03, aCorner.y * aParam.y);
    vGlow = 1.0;
  } else {
    // caustic: the light a flooded room throws back onto the stone around it
    p = aCenter + vec3(aCorner.x * aParam.x, 0.045, aCorner.y * aParam.y);
    vGlow = aParam.z;
  }
  vUv = aCorner + 0.5; vKind = kind; vFogXZ = aCenter.xz;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const BILLBOARD_FS = `
uniform vec3 uTorchColor; uniform vec3 uShaftColor; uniform float uShaftStrength; uniform float uTime;
varying vec2 vUv; varying float vKind; varying float vGlow; varying vec2 vFogXZ; varying vec3 vTint;
FOG
void main() {
  vec2 c = vUv - 0.5;
  vec3 col; float a;
  if (vKind > 2.5) {
    // a slow interference ripple, fading out at the rim so it has no edge on the stone
    float d = length(c) * 2.0;
    float r = sin((c.x * 14.0 + c.y * 9.0) + uTime * 1.3) * sin((c.x * 7.0 - c.y * 12.0) - uTime * 0.9);
    a = pow(max(0.0, 1.0 - d), 2.0) * (0.35 + 0.65 * max(0.0, r)) * vGlow;
    col = applyFog(vTint, vFogXZ);
    gl_FragColor = vec4(col * a, a);
    return;
  }
  if (vKind < 0.5) {
    float d = length(c) * 2.0;
    float core = pow(max(0.0, 1.0 - d), 2.2);
    a = core * (0.55 + 0.45 * vGlow);
    col = mix(vTint, vec3(1.0, 0.85, 0.6), core * 0.6) * 1.4;
  } else if (vKind < 1.5) {
    float edge = pow(max(0.0, 1.0 - abs(c.x) * 2.0), 1.6);
    float v = vUv.y;
    float height = smoothstep(0.0, 0.18, v) * (1.0 - smoothstep(0.55, 1.0, v));
    float streak = 0.8 + 0.2 * sin(v * 22.0 - uTime * 0.6 + c.x * 9.0) * sin(c.x * 30.0 + uTime * 0.3);
    a = edge * height * streak * uShaftStrength * 1.1;
    col = uShaftColor;
  } else {
    float d = length(c) * 2.0;
    a = pow(max(0.0, 1.0 - d), 2.5) * uShaftStrength * 1.3;
    col = uShaftColor;
  }
  col = applyFog(col, vFogXZ);
  gl_FragColor = vec4(col * a, a);
}`;

/**
 * What each piece of decor puts INTO THE AIR, and the halo it wears. `n` particles of `kind`
 * (0 ember, 1 drip, 2 spore) rise from `y`; `halo` is the width of its additive glow, in the piece's
 * own colour, so a hearth's halo is a wide orange bloom and a candle's is a pale bead. `maxV`/`minV`
 * gate on the variant: a tipped, cold brazier has no embers over it (AMBIENCE §2.1).
 */
const DECOR_AIR = {
  hearth: { n: 14, kind: 0, size: 0.075, y: 0.42, halo: 1.9, color: 0xff8a3a, maxV: 1 },
  // 2.1 was the widest halo in this table and it sat over the widest fire, and the two together
  // rubbed the forge out: in a rendered frame at the play camera its tile was a white block, and it
  // stayed a white block with every decor group hidden — because this halo is not a decor group.
  // A furnace mouth still wants to be the brightest thing in the room; it does not want to be the
  // only thing. See lighting.js DECOR_LIGHTS.forge for the other half of the same measurement.
  forge: { n: 18, kind: 0, size: 0.080, y: 0.40, halo: 1.4, color: 0xff6a20, maxV: 0 },
  brazier: { n: 12, kind: 0, size: 0.070, y: 0.62, halo: 1.5, color: 0xff7a2a, maxV: 1 },
  candelabra: { n: 4, kind: 0, size: 0.045, y: 0.80, halo: 0.8, color: 0xffe6b0, maxV: 1 },
  candlestick: { n: 3, kind: 0, size: 0.040, y: 0.55, halo: 0.6, color: 0xffe6b0, maxV: 1 },
  alchemyBench: { n: 4, kind: 2, size: 0.050, y: 0.55, halo: 0.8, color: 0x9fe07a, maxV: 1 },
  mushroomCluster: { n: 5, kind: 2, size: 0.060, y: 0.20, halo: 0.7, color: 0x7fe3a8, minV: 2 },
  gargoyleSpout: { n: 3, kind: 1, size: 0.050, y: 0.85, halo: 0, color: 0x9fd0e8 },
  wellHead: { n: 3, kind: 1, size: 0.050, y: 1.05, halo: 0, color: 0x9fd0e8 },
  dripstone: { n: 2, kind: 1, size: 0.045, y: 1.10, halo: 0, color: 0x9fd0e8 },
};

export class Atmosphere {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./lighting.js').FogOfWar} fog
   */
  constructor(scene, fog) {
    this.scene = scene; this.fog = fog;
    this.root = new THREE.Group(); this.root.name = 'atmosphere';
    scene.add(this.root);
    this.time = 0;
    const fogU = { fogTex: fog.uniforms.fogTex, fogSize: fog.uniforms.fogSize, fogTint: fog.uniforms.fogTint };
    // --- dust ---
    const rng = createRng('fargoal-dust');
    const box = new THREE.Vector3(16, 2.4, 16);
    const pos = new Float32Array(DUST_COUNT * 3), seed = new Float32Array(DUST_COUNT), size = new Float32Array(DUST_COUNT);
    for (let i = 0; i < DUST_COUNT; i++) {
      pos[i * 3] = rng.float(0, box.x); pos[i * 3 + 1] = rng.float(0.05, box.y); pos[i * 3 + 2] = rng.float(0, box.z);
      seed[i] = rng.float(0, 1); size[i] = rng.float(0.05, 0.12) * (rng.chance(0.1) ? 2.2 : 1);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    dg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.dustUniforms = {
      ...fogU, uTime: { value: 0 }, uCenter: { value: new THREE.Vector3(0, box.y * 0.5, 0) }, uBox: { value: box }, uScale: { value: 420 },
      uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, -50, 0, 0)) },
      uLightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Color(0, 0, 0)) },
      uTint: { value: new THREE.Color(1, 1, 1) }, uDensity: { value: 1 },
    };
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: this.dustUniforms, vertexShader: DUST_VS, fragmentShader: DUST_FS.replace('FOG', fog.glsl()),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.dust = new THREE.Points(dg, this.dustMat);
    this.dust.frustumCulled = false; this.dust.renderOrder = 9;
    this.root.add(this.dust);
    // --- billboards (halos + shafts + pools), rebuilt per level ---
    this.billUniforms = {
      ...fogU, uTime: { value: 0 }, uTorchColor: { value: new THREE.Color(0xff8c2a) },
      uShaftColor: { value: new THREE.Color(0xb9cbe6) }, uShaftStrength: { value: 0.4 },
    };
    this.billMat = new THREE.ShaderMaterial({
      uniforms: this.billUniforms, vertexShader: BILLBOARD_VS, fragmentShader: BILLBOARD_FS.replace('FOG', fog.glsl()),
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    });
    this.halos = null; this.shafts = null;
    // --- air detail (embers / drips / spores), rebuilt per level
    this.airUniforms = {
      ...fogU, uTime: { value: 0 }, uScale: { value: 300 },
      uEmber: { value: new THREE.Color(0xff9a46) }, uDrip: { value: new THREE.Color(0xa8d4e8) }, uSpore: { value: new THREE.Color(0x9fe3b8) },
    };
    this.airMat = new THREE.ShaderMaterial({
      uniforms: this.airUniforms, vertexShader: AIR_VS, fragmentShader: AIR_FS.replace('FOG', fog.glsl()),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.air = null;
    /** floor positions of the light shafts of the current level: [{x,z}] (scenarios) */
    this.shaftSpots = [];
    /** per-tile mood index for the dust density (-1 = no room); built with the level */
    this.moodTiles = null; this.moodW = 0; this.moodH = 0;
    this.dustBase = 1; this.dustMix = 1;
  }

  /** Build one merged quad mesh from [{x,y,z,sx,sy,p,kind,tint?}]. */
  quads(items, renderOrder) {
    if (!items.length) return null;
    const n = items.length;
    const corner = new Float32Array(n * 8), center = new Float32Array(n * 12), param = new Float32Array(n * 16), position = new Float32Array(n * 12);
    const tint = new Float32Array(n * 12);
    const index = new Uint16Array(n * 6);
    const C = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    const _c = new THREE.Color();
    items.forEach((it, i) => {
      _c.setHex(it.tint === undefined ? 0xff8c2a : it.tint);
      for (let k = 0; k < 4; k++) {
        const v = i * 4 + k;
        corner[v * 2] = C[k][0]; corner[v * 2 + 1] = C[k][1];
        center[v * 3] = it.x; center[v * 3 + 1] = it.y; center[v * 3 + 2] = it.z;
        position[v * 3] = it.x; position[v * 3 + 1] = it.y; position[v * 3 + 2] = it.z;
        param[v * 4] = it.sx; param[v * 4 + 1] = it.sy; param[v * 4 + 2] = it.p; param[v * 4 + 3] = it.kind;
        tint[v * 3] = _c.r; tint[v * 3 + 1] = _c.g; tint[v * 3 + 2] = _c.b;
      }
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    g.setAttribute('aCenter', new THREE.BufferAttribute(center, 3));
    g.setAttribute('aParam', new THREE.BufferAttribute(param, 4));
    g.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    const m = new THREE.Mesh(g, this.billMat);
    m.frustumCulled = false; m.renderOrder = renderOrder;
    return m;
  }

  /**
   * THE AIR THAT BELONGS TO A ROOM (AMBIENCE §7): embers off anything that is burning, drips in the
   * wet rooms, spores over the fungus. One `THREE.Points` for the whole level, animated entirely in
   * the vertex shader from time — no CPU particle loop, no per-frame allocation, one draw call.
   * @param {Array<{x:number,y:number,z:number,kind:number,size:number}>} sources
   */
  buildAir(sources) {
    if (!sources.length) return;
    const rng = createRng('fargoal-air');
    const n = Math.min(AIR_MAX, sources.length);
    const pos = new Float32Array(n * 3), seed = new Float32Array(n), kind = new Float32Array(n), size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = sources[i];
      pos[i * 3] = s.x + rng.float(-0.28, 0.28); pos[i * 3 + 1] = s.y; pos[i * 3 + 2] = s.z + rng.float(-0.28, 0.28);
      seed[i] = rng.float(0, 1); kind[i] = s.kind; size[i] = s.size * rng.float(0.75, 1.3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.air = new THREE.Points(g, this.airMat);
    this.air.frustumCulled = false; this.air.renderOrder = 10;
    this.root.add(this.air);
  }

  /**
   * Rebuild per-level geometry.
   * @param {import('../world/level.js').Level} level
   * @param {{x:number,y:number,z:number,nx:number,nz:number,phase:number}[]} torchSpots
   */
  setLevel(level, torchSpots) {
    this.dispose();
    const look = depthTint(level.depth);
    this.dustUniforms.uTint.value.copy(look.atmo.dust);
    this.dustBase = look.atmo.dustDensity;
    this.dustUniforms.uDensity.value = this.dustBase;
    this.billUniforms.uShaftColor.value.copy(look.atmo.shaft);
    this.billUniforms.uShaftStrength.value = look.atmo.shaftStrength;
    const halos = torchSpots.map((sp) => ({ x: sp.x + sp.nx * 0.24, y: sp.y + 0.36, z: sp.z + sp.nz * 0.24, sx: 1.7, sy: 1.5, p: sp.phase, kind: 0 }));
    // Every fire standing in a room gets the same halo the wall torches have, in its own colour —
    // a hearth's is wide and orange, a candle's is small and pale, a forge's is a furnace mouth.
    const air = [], caustics = [];
    const seen = new Set();
    for (const d of level.decor || []) {
      const f = DECOR_AIR[d.type];
      if (!f) continue;
      const v = d.variant | 0;
      if (f.maxV !== undefined && v > f.maxV) continue;
      if (f.minV !== undefined && v < f.minV) continue;
      if (f.halo) halos.push({ x: d.x, y: f.y + 0.18, z: d.y, sx: f.halo, sy: f.halo * 0.9, p: (d.x * 7 + d.y * 13) % 100, kind: 0, tint: f.color });
      for (let i = 0; i < f.n; i++) air.push({ x: d.x, y: f.y, z: d.y, kind: f.kind, size: f.size });
    }
    // The wet rooms: a drip under the ceiling of every few tiles, and the ripple the water throws
    // back onto the stone at its edge.
    this.moodW = level.width; this.moodH = level.height;
    this.moodTiles = new Int8Array(level.width * level.height).fill(-1);
    const rngAir = createRng(level.seed * 71 + level.depth * 5 + 3);
    for (const r of level.rooms) {
      const mi = MOOD_KEYS.indexOf(r.lightMood);
      if (mi >= 0) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        if (x >= 0 && y >= 0 && x < level.width && y < level.height) this.moodTiles[y * level.width + x] = mi;
      }
      if (r.lightMood !== 'water' && r.lightMood !== 'fungal') continue;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        if (!level.inBounds(x, y) || level.get(x, y) === TILE.WALL) continue;
        if (r.lightMood === 'water') {
          if (rngAir.chance(0.16)) air.push({ x, y: 1.15, z: y, kind: 1, size: 0.055 });
          const wet = level.get(x + 1, y) === TILE.WATER || level.get(x - 1, y) === TILE.WATER
            || level.get(x, y + 1) === TILE.WATER || level.get(x, y - 1) === TILE.WATER;
          if (wet && caustics.length < 28 && !seen.has(`${x},${y}`)) { seen.add(`${x},${y}`); caustics.push({ x, y: 0, z: y, sx: 1.8, sy: 1.7, p: 0.5 + rngAir.float(0, 0.3), kind: 3, tint: 0x9fd0e8 }); }
        } else if (rngAir.chance(0.1)) air.push({ x, y: 0.2, z: y, kind: 2, size: 0.07 });
      }
    }
    this.halos = this.quads(halos, 11);
    if (this.halos) this.root.add(this.halos);
    this.buildAir(air);
    // Shafts: a few of the larger rooms get a crack of light from above (deterministic per level).
    const rng = createRng(level.seed * 53 + level.depth * 7 + 11);
    const rooms = level.rooms.filter((r) => r.type !== 'surface' && r.w * r.h >= 16).slice();
    rng.shuffle(rooms);
    const shafts = []; this.shaftSpots = [];
    const count = level.depth <= 0 ? 0 : Math.min(rooms.length, level.depth <= 5 ? 4 : level.depth <= 12 ? 3 : 2);
    for (let i = 0; i < count; i++) {
      const r = rooms[i];
      const x = rng.int(r.x + 1, r.x + r.w - 2), z = rng.int(r.y + 1, r.y + r.h - 2);
      if (!level.isWalkable(x, z)) continue;
      const w = rng.float(1.4, 2.6), h = rng.float(5, 7), slant = rng.float(-1.6, 1.6);
      this.shaftSpots.push({ x, z });
      shafts.push({ x, y: 0.02, z, sx: w, sy: h, p: slant, kind: 1 });
      shafts.push({ x, y: 0, z, sx: w * 1.6, sy: w * 1.2, p: 0, kind: 2 });
    }
    for (const c of caustics) shafts.push(c);
    this.shafts = this.quads(shafts, 8);
    if (this.shafts) this.root.add(this.shafts);
  }

  /** The dust multiplier of the room a point is standing in (AMBIENCE §7's "Dust x" column). */
  dustAt(x, z) {
    if (!this.moodTiles) return 1;
    const ix = Math.round(x), iz = Math.round(z);
    if (ix < 0 || iz < 0 || ix >= this.moodW || iz >= this.moodH) return 1;
    const mi = this.moodTiles[iz * this.moodW + ix];
    return mi >= 0 ? LIGHT_MOODS[MOOD_KEYS[mi]].dust : 1;
  }

  /**
   * @param {number} dt
   * @param {{x:number,z:number}} player
   * @param {{x:number,y:number,z:number,r:number,g:number,b:number,i:number}[]} lights
   */
  update(dt, player, lights) {
    this.time += dt;
    this.dustUniforms.uTime.value = this.time;
    this.billUniforms.uTime.value = this.time;
    this.airUniforms.uTime.value = this.time;
    this.dustUniforms.uCenter.value.set(player.x, 1.2, player.z);
    // Still rooms hold more dust than wet ones; a hearth room is thick with it. Crossfaded on the
    // same beat as the light, so walking into a room changes its air as well as its colour.
    const want = this.dustAt(player.x, player.z);
    this.dustMix += (want - this.dustMix) * (1 - Math.exp(-dt / 0.45));
    this.dustUniforms.uDensity.value = this.dustBase * this.dustMix;
    const lp = this.dustUniforms.uLightPos.value, lc = this.dustUniforms.uLightCol.value;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = lights[i];
      if (!l || l.i <= 0) { lp[i].set(0, -50, 0, 0); continue; }
      lp[i].set(l.x, l.y, l.z, l.i); lc[i].setRGB(l.r, l.g, l.b);
    }
  }

  dispose() {
    for (const m of [this.halos, this.shafts, this.air]) if (m) { this.root.remove(m); m.geometry.dispose(); }
    this.halos = null; this.shafts = null; this.air = null;
  }
}

export { torchFlicker };

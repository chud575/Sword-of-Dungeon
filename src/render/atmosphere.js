// Atmosphere: the "air" of the dungeon, three draw calls total.
//  - Dust: a GPU-drifting mote cloud that wraps around the player and is lit by the live lights
//    (player lantern + torches), so motes only sparkle where there is light to catch.
//  - Torch halos: additive soft billboards at every torch flame, flickering in sync with the lights.
//  - Light shafts: slanted, camera-facing sheets of cool light falling from cracks in the ceiling of
//    the bigger rooms (with a soft pool on the floor), strongest in the upper halls, fading with depth.
// Everything is fog-of-war aware (unknown = nothing, remembered = dim), deterministic (seeded per
// level, animated purely from time) and safe on SwiftShader (plain points/quads, no derivatives).
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { depthTint, torchFlicker } from './lighting.js';

const MAX_LIGHTS = 8;
const DUST_COUNT = 900;

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
uniform float uTime;
varying vec2 vUv; varying float vKind; varying float vGlow; varying vec2 vFogXZ;
void main() {
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
  } else {
    // floor pool under a shaft: flat disc
    p = aCenter + vec3(aCorner.x * aParam.x, 0.03, aCorner.y * aParam.y);
    vGlow = 1.0;
  }
  vUv = aCorner + 0.5; vKind = kind; vFogXZ = aCenter.xz;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const BILLBOARD_FS = `
uniform vec3 uTorchColor; uniform vec3 uShaftColor; uniform float uShaftStrength; uniform float uTime;
varying vec2 vUv; varying float vKind; varying float vGlow; varying vec2 vFogXZ;
FOG
void main() {
  vec2 c = vUv - 0.5;
  vec3 col; float a;
  if (vKind < 0.5) {
    float d = length(c) * 2.0;
    float core = pow(max(0.0, 1.0 - d), 2.2);
    a = core * (0.55 + 0.45 * vGlow);
    col = mix(uTorchColor, vec3(1.0, 0.85, 0.6), core * 0.6) * 1.4;
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
    /** floor positions of the light shafts of the current level: [{x,z}] (scenarios) */
    this.shaftSpots = [];
  }

  /** Build one merged quad mesh from [{x,y,z,sx,sy,p,kind}]. */
  quads(items, renderOrder) {
    if (!items.length) return null;
    const n = items.length;
    const corner = new Float32Array(n * 8), center = new Float32Array(n * 12), param = new Float32Array(n * 16), position = new Float32Array(n * 12);
    const index = new Uint16Array(n * 6);
    const C = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    items.forEach((it, i) => {
      for (let k = 0; k < 4; k++) {
        const v = i * 4 + k;
        corner[v * 2] = C[k][0]; corner[v * 2 + 1] = C[k][1];
        center[v * 3] = it.x; center[v * 3 + 1] = it.y; center[v * 3 + 2] = it.z;
        position[v * 3] = it.x; position[v * 3 + 1] = it.y; position[v * 3 + 2] = it.z;
        param[v * 4] = it.sx; param[v * 4 + 1] = it.sy; param[v * 4 + 2] = it.p; param[v * 4 + 3] = it.kind;
      }
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    g.setAttribute('aCenter', new THREE.BufferAttribute(center, 3));
    g.setAttribute('aParam', new THREE.BufferAttribute(param, 4));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    const m = new THREE.Mesh(g, this.billMat);
    m.frustumCulled = false; m.renderOrder = renderOrder;
    return m;
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
    this.dustUniforms.uDensity.value = look.atmo.dustDensity;
    this.billUniforms.uShaftColor.value.copy(look.atmo.shaft);
    this.billUniforms.uShaftStrength.value = look.atmo.shaftStrength;
    const halos = torchSpots.map((sp) => ({ x: sp.x + sp.nx * 0.24, y: sp.y + 0.36, z: sp.z + sp.nz * 0.24, sx: 1.7, sy: 1.5, p: sp.phase, kind: 0 }));
    this.halos = this.quads(halos, 11);
    if (this.halos) this.root.add(this.halos);
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
    this.shafts = this.quads(shafts, 8);
    if (this.shafts) this.root.add(this.shafts);
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
    this.dustUniforms.uCenter.value.set(player.x, 1.2, player.z);
    const lp = this.dustUniforms.uLightPos.value, lc = this.dustUniforms.uLightCol.value;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = lights[i];
      if (!l || l.i <= 0) { lp[i].set(0, -50, 0, 0); continue; }
      lp[i].set(l.x, l.y, l.z, l.i); lc[i].setRGB(l.r, l.g, l.b);
    }
  }

  dispose() {
    for (const m of [this.halos, this.shafts]) if (m) { this.root.remove(m); m.geometry.dispose(); }
    this.halos = null; this.shafts = null;
  }
}

export { torchFlicker };

// Lighting: ambient + moon fill, player-carried light with soft shadows, flickering wall torches
// (a fixed pool so shader programs never recompile) and the fog-of-war darkness shader.
// Fog of war is a small RGBA texture (one texel per tile): R = explored, G = visible, both smoothed
// over time and sampled bilinearly, so darkness fades between tiles instead of stepping.
import * as THREE from 'three';
import { TILE } from '../core/constants.js';
import { createRng } from '../core/rng.js';

const FOG_GLSL = `
uniform sampler2D fogTex; uniform vec2 fogSize; uniform vec3 fogTint;
vec3 applyFog(vec3 c, vec2 xz) {
  vec2 fuv = (xz + 0.5) / fogSize;
  vec3 f = texture2D(fogTex, fuv).rgb;
  float explored = f.r, vis = f.g;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 memory = mix(vec3(lum), c, 0.3) * fogTint;
  return mix(vec3(0.0), mix(memory, c, vis), explored);
}`;

export class FogOfWar {
  constructor() {
    this.width = 1; this.height = 1;
    this.data = new Uint8Array(4);
    this.texture = new THREE.DataTexture(this.data, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter; this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false; this.texture.flipY = false;
    this.texture.needsUpdate = true;
    this.uniforms = {
      fogTex: { value: this.texture },
      fogSize: { value: new THREE.Vector2(1, 1) },
      fogTint: { value: new THREE.Color(0.22, 0.26, 0.36) },
    };
    this.level = null;
    /** 'all' = everything lit (debug scenarios); null = follow the level masks */
    this.override = null;
    this.explored = new Float32Array(1); this.visible = new Float32Array(1);
    this.sweep = null; // magic-map reveal wave {x,y,t}
    this.time = 0;
  }

  /** GLSL snippet (uniforms + applyFog) for custom shaders. */
  glsl() { return FOG_GLSL; }

  setLevel(level, { instant = true } = {}) {
    this.level = level;
    if (this.width !== level.width || this.height !== level.height) {
      this.width = level.width; this.height = level.height;
      this.data = new Uint8Array(level.width * level.height * 4);
      this.texture.dispose();
      this.texture = new THREE.DataTexture(this.data, level.width, level.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      this.texture.magFilter = THREE.LinearFilter; this.texture.minFilter = THREE.LinearFilter;
      this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
      this.texture.generateMipmaps = false; this.texture.flipY = false;
      this.uniforms.fogTex.value = this.texture;
      this.uniforms.fogSize.value.set(level.width, level.height);
      this.explored = new Float32Array(level.width * level.height);
      this.visible = new Float32Array(level.width * level.height);
    }
    this.sweep = null;
    if (instant) { this.explored.fill(0); this.visible.fill(0); this.update(10); }
  }

  /** Start a magic-map reveal wave from a tile. */
  startSweep(x, y) { this.sweep = { x, y, t: 0 }; }

  /** Smooth the masks toward the level state. */
  update(dt) {
    const lv = this.level; if (!lv) return;
    this.time += dt;
    const n = lv.width * lv.height;
    const kExp = 1 - Math.exp(-dt / 0.18), kVis = 1 - Math.exp(-dt / 0.12);
    const all = this.override === 'all';
    let sweepR = Infinity;
    if (this.sweep) { this.sweep.t += dt; sweepR = this.sweep.t * 22; if (sweepR > lv.width + lv.height) this.sweep = null; }
    const d = this.data;
    for (let i = 0; i < n; i++) {
      let te = all || lv.explored[i] ? 1 : 0;
      let tv = all || lv.visible[i] ? 1 : 0;
      if (this.sweep && te && !lv.visible[i]) {
        const x = i % lv.width, y = (i / lv.width) | 0;
        if (Math.hypot(x - this.sweep.x, y - this.sweep.y) > sweepR) te = this.explored[i] > 0.5 ? te : 0;
      }
      const e = this.explored[i] + (te - this.explored[i]) * kExp;
      const v = this.visible[i] + (tv - this.visible[i]) * kVis;
      this.explored[i] = e; this.visible[i] = v;
      d[i * 4] = e * 255; d[i * 4 + 1] = v * 255; d[i * 4 + 2] = 0; d[i * 4 + 3] = 255;
    }
    this.texture.needsUpdate = true;
  }
}

/**
 * Inject the fog-of-war darkening into a built-in three material via onBeforeCompile.
 * @param {THREE.Material} material
 * @param {FogOfWar} fog
 */
export function patchFog(material, fog) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.fogTex = fog.uniforms.fogTex;
    shader.uniforms.fogSize = fog.uniforms.fogSize;
    shader.uniforms.fogTint = fog.uniforms.fogTint;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFogXZ;')
      .replace('#include <project_vertex>', `#include <project_vertex>
      { vec4 fw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        fw = instanceMatrix * fw;
        #endif
        fw = modelMatrix * fw; vFogXZ = fw.xz; }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFogXZ;\n' + FOG_GLSL)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n gl_FragColor.rgb = applyFog(gl_FragColor.rgb, vFogXZ);');
  };
  material.customProgramCacheKey = () => 'fogofwar-v1';
  return material;
}

const TORCH_POOL = 4;
const TEMPLE_POOL = 2;

/** Depth bands drive the ambient tint (DESIGN.md §9.3). */
export function depthTint(depth) {
  if (depth <= 0) return { ambient: new THREE.Color(0x8fb2d8), sky: new THREE.Color(0xa9c4e0), fogTint: new THREE.Color(0.3, 0.34, 0.42) };
  if (depth <= 5) return { ambient: new THREE.Color(0x6a5a48), sky: new THREE.Color(0x7d6b55), fogTint: new THREE.Color(0.24, 0.24, 0.32) };
  if (depth <= 12) return { ambient: new THREE.Color(0x4d5a70), sky: new THREE.Color(0x5c6d86), fogTint: new THREE.Color(0.2, 0.24, 0.36) };
  if (depth <= 18) return { ambient: new THREE.Color(0x3e5a46), sky: new THREE.Color(0x4a6b52), fogTint: new THREE.Color(0.18, 0.26, 0.24) };
  return { ambient: new THREE.Color(0x5a3e58), sky: new THREE.Color(0x6b4a66), fogTint: new THREE.Color(0.3, 0.2, 0.34) };
}

export class Lighting {
  /**
   * @param {THREE.Scene} scene
   * @param {FogOfWar} fog
   */
  constructor(scene, fog) {
    this.scene = scene; this.fog = fog;
    this.rng = createRng('fargoal-lighting');
    this.time = 0;
    this.hemi = new THREE.HemisphereLight(0x7d6b55, 0x1a1512, 0.55);
    scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0x9fb4d8, 0.55);
    this.moon.position.set(-6, 14, -4);
    scene.add(this.moon);
    // Player light: a shadow-casting spot from above plus a local point glow.
    this.spot = new THREE.SpotLight(0xffd9a6, 30, 22, Math.PI / 3.2, 0.6, 1.6);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.spot.shadow.camera.near = 1; this.spot.shadow.camera.far = 24;
    this.spot.shadow.bias = -0.0015; this.spot.shadow.radius = 4;
    this.spot.target = new THREE.Object3D();
    scene.add(this.spot); scene.add(this.spot.target);
    this.point = new THREE.PointLight(0xbfd8ff, 1.0, 4.5, 1.6);
    scene.add(this.point);
    this.torches = [];
    for (let i = 0; i < TORCH_POOL; i++) {
      const l = new THREE.PointLight(0xff9a3c, 0, 6, 1.9);
      l.userData.phase = this.rng.float(0, 100);
      scene.add(l); this.torches.push(l);
    }
    this.temples = [];
    for (let i = 0; i < TEMPLE_POOL; i++) {
      const l = new THREE.PointLight(0xbfe6ff, 0, 6, 1.7);
      scene.add(l); this.temples.push(l);
    }
    /** wall torch positions for the current level: {x, y, z, nx, nz} */
    this.torchSpots = [];
    this.templeSpots = [];
    this.lightScale = 1;
    this.baseHemi = 0.55; this.baseMoon = 0.5;
    this.flickerPhase = this.rng.float(0, 100);
    this._near = []; // scratch for the per-frame nearest-spot sort
  }

  /** Nearest `n` spots to (x,z), reusing the scratch array (spots carry a transient `d`). */
  nearest(spots, x, z) {
    const out = this._near; out.length = 0;
    for (const sp of spots) { sp.d = Math.hypot(sp.x - x, sp.z - z); out.push(sp); }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  /** Choose torch spots for a level (wall faces looking into rooms). */
  setLevel(level) {
    const rng = createRng(level.seed * 31 + 7);
    const spots = [];
    const tint = depthTint(level.depth);
    this.hemi.color.copy(tint.sky); this.hemi.groundColor.set(0x14100e);
    this.moon.color.copy(tint.ambient);
    this.fog.uniforms.fogTint.value.copy(tint.fogTint);
    if (level.depth === 0) { this.baseHemi = 1.4; this.baseMoon = 1.6; }
    else { this.baseHemi = 0.55; this.baseMoon = 0.5; }
    this.hemi.intensity = this.baseHemi; this.moon.intensity = this.baseMoon;
    const candidates = [];
    for (const r of level.rooms) {
      if (r.type === 'surface') continue;
      // walls along the room perimeter facing inward
      for (let x = r.x; x < r.x + r.w; x++) {
        if (level.get(x, r.y - 1) === TILE.WALL && level.get(x, r.y) !== TILE.WALL) candidates.push({ x, y: r.y - 1, nx: 0, nz: 1, room: r });
        if (level.get(x, r.y + r.h) === TILE.WALL && level.get(x, r.y + r.h - 1) !== TILE.WALL) candidates.push({ x, y: r.y + r.h, nx: 0, nz: -1, room: r });
      }
      for (let y = r.y; y < r.y + r.h; y++) {
        if (level.get(r.x - 1, y) === TILE.WALL && level.get(r.x, y) !== TILE.WALL) candidates.push({ x: r.x - 1, y, nx: 1, nz: 0, room: r });
        if (level.get(r.x + r.w, y) === TILE.WALL && level.get(r.x + r.w - 1, y) !== TILE.WALL) candidates.push({ x: r.x + r.w, y, nx: -1, nz: 0, room: r });
      }
    }
    rng.shuffle(candidates);
    const perRoom = new Map();
    for (const c of candidates) {
      const n = perRoom.get(c.room) || 0;
      const max = c.room.type === 'temple' || c.room.type === 'shrine' ? 0 : (c.room.w * c.room.h > 20 ? 2 : 1);
      if (n >= max) continue;
      if (spots.some((s) => Math.abs(s.x - c.x) + Math.abs(s.y - c.y) < 4)) continue;
      perRoom.set(c.room, n + 1);
      spots.push({ x: c.x + c.nx * 0.5, y: 0.62, z: c.y + c.nz * 0.5, nx: c.nx, nz: c.nz, tx: c.x, ty: c.y, phase: rng.float(0, 100) });
    }
    this.torchSpots = spots;
    this.templeSpots = level.temples.map((t) => ({ x: t.x, z: t.y }));
    this.lightScale = 1;
  }

  /**
   * Per-frame update.
   * @param {number} dt
   * @param {{x:number,z:number}} player world position
   * @param {{lightOn:boolean, sword:boolean, allLit:boolean}} state
   */
  update(dt, player, state) {
    this.time += dt;
    const t = this.time;
    const lit = state.allLit ? 1 : 0;
    this.hemi.intensity = this.baseHemi * (1 + lit * 1.6);
    this.moon.intensity = this.baseMoon * (1 + lit * 1.4);
    const flick = 0.85 + 0.1 * Math.sin(t * 8.1 + this.flickerPhase) + 0.05 * Math.sin(t * 0.5) + 0.04 * Math.sin(t * 23.7);
    const target = state.lightOn ? 1.5 : 1;
    this.lightScale += (target - this.lightScale) * Math.min(1, dt * 4);
    const s = this.lightScale;
    this.spot.position.set(player.x + 0.6, 7.5, player.z + 1.4);
    this.spot.target.position.set(player.x, 0, player.z);
    this.spot.intensity = (state.allLit ? 18 : 30) * flick * s;
    this.spot.distance = 22 * s;
    this.spot.angle = Math.PI / 3.2 * Math.min(1.25, s);
    this.spot.color.set(state.lightOn ? 0xfff2cc : 0xffd9a6);
    this.point.position.set(player.x, 2.1, player.z);
    this.point.intensity = (state.lightOn ? 2.0 : 1.0) * (0.9 + 0.1 * Math.sin(t * 5.3));
    this.point.distance = 4.5 * s;
    this.point.color.set(state.sword ? 0xc9b0ff : state.lightOn ? 0xfff2cc : 0xbfd8ff);
    // Nearest torches get the real lights.
    const sorted = this.nearest(this.torchSpots, player.x, player.z);
    for (let i = 0; i < TORCH_POOL; i++) {
      const l = this.torches[i];
      const sp = sorted[i];
      if (!sp || (sp.d > 16 && !state.allLit)) { l.intensity = 0; continue; }
      const f = 0.8 + 0.15 * Math.sin(t * 9.3 + sp.phase) + 0.08 * Math.sin(t * 17.1 + sp.phase * 2) + 0.05 * Math.sin(t * 3.1 + sp.phase);
      l.position.set(sp.x + sp.nx * 0.3, 0.95, sp.z + sp.nz * 0.3);
      l.intensity = 9 * f;
      l.distance = 6.5;
    }
    const temples = this.nearest(this.templeSpots, player.x, player.z);
    for (let i = 0; i < TEMPLE_POOL; i++) {
      const l = this.temples[i];
      const sp = temples[i];
      if (!sp) { l.intensity = 0; continue; }
      l.position.set(sp.x, 2.1, sp.z);
      l.intensity = 4.5 + 0.8 * Math.sin(t * 1.7);
    }
  }
}

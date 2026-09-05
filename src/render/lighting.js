// Lighting: a fixed pool of lights (so shader programs never recompile), the fog-of-war darkness
// shader, and the per-depth look tables (ambient, memory tint, grading, atmosphere).
//
// Light design (DESIGN.md §9.3): the player carries a COOL lantern (a shadow-casting spot from above
// with a soft penumbra plus a local point glow with a gentle quadratic falloff); wall torches are WARM
// point lights with a layered flicker, and the nearest torch also casts soft shadows from its bracket.
// Fog of war is a small RGBA texture (one texel per tile): R = explored, G = visible, both smoothed
// over time, sampled bilinearly and blurred with a 5-tap cross in the shader, so darkness fades in
// soft bands between tiles: unknown = black, remembered = dim/desaturated/cool, visible = fully lit.
import * as THREE from 'three';
import { TILE } from '../core/constants.js';
import { createRng } from '../core/rng.js';

const FOG_GLSL = `
uniform sampler2D fogTex; uniform vec2 fogSize; uniform vec3 fogTint;
vec2 fogMask(vec2 xz) {
  vec2 fuv = (xz + 0.5) / fogSize;
  vec2 px = 0.55 / fogSize;
  vec2 f = texture2D(fogTex, fuv).rg * 2.0
    + texture2D(fogTex, fuv + vec2(px.x, 0.0)).rg + texture2D(fogTex, fuv - vec2(px.x, 0.0)).rg
    + texture2D(fogTex, fuv + vec2(0.0, px.y)).rg + texture2D(fogTex, fuv - vec2(0.0, px.y)).rg;
  return f * (1.0 / 6.0);
}
// Cheap value noise so unexplored rock has grain instead of being a flat fill.
float bhash(vec2 p) { return fract(sin(dot(floor(p), vec2(127.1, 311.7))) * 43758.5453); }
float bnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bhash(i), bhash(i + vec2(1.0, 0.0)), f.x),
             mix(bhash(i + vec2(0.0, 1.0)), bhash(i + vec2(1.0, 1.0)), f.x), f.y);
}
/**
 * Mottled stone: the rock the dungeon is cut from, seen by the same room light everything else is.
 *
 * BOARD-BRIGHT (the gate direction): the reference is a printed board under room light, and a
 * printed board has no black areas — the parts that are not a room are TABLE, not void. Measured
 * off the 'default' frame, this used to land at 0.064 screen luminance over the two thirds of the
 * frame unexplored rock covers: technically not black and, next to a torchlit room, read as black
 * by everyone who looked at it. It now measures 0.150 — dark lit rock. It still hides layout,
 * because it is a flat noise fill with no tiles in it: concealment is the fog mask's job (a game
 * rule), never the exposure's.
 */
vec3 bedrock(vec2 xz) {
  float n = bnoise(xz * 1.7) * 0.6 + bnoise(xz * 5.3) * 0.4;
  // Faintly warm-neutral: the post grade splits shadows toward blue, so a neutral base here
  // would come out navy. Nudging red up keeps it reading as stone rather than night sky.
  vec3 base = vec3(0.0290, 0.0254, 0.0259);
  return base * (0.62 + 0.95 * n);
}
vec3 applyFog(vec3 c, vec2 xz) {
  vec2 f = fogMask(xz);
  float explored = smoothstep(0.0, 1.0, f.r), vis = smoothstep(0.0, 1.0, f.g);
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  // MEMORY IS DIMMED, NOT CRUSHED. A room you have walked through keeps its own colour field —
  // that is the whole point of giving each room a field — so remembered stone holds three quarters
  // of its saturation and a little over half its light, and reads as "the lamp is elsewhere"
  // rather than as a hole. (Was 0.30 of saturation against a 0.3 tint: a dark grey rectangle.)
  vec3 memory = mix(vec3(lum), c, 0.76) * fogTint;
  // Unexplored space is not a void: it reads as the unlit bedrock the dungeon is cut from, so the
  // screen shows solid rock rather than black nothing. It stays featureless enough to hide layout —
  // the fog of war still conceals rooms and corridors, which is the point of exploring.
  return mix(bedrock(xz), mix(memory, c, vis), explored);
}`;

export class FogOfWar {
  constructor() {
    this.width = 1; this.height = 1;
    this.data = new Uint8Array(4);
    this.texture = this.makeTexture(1, 1);
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

  makeTexture(w, h) {
    const t = new THREE.DataTexture(this.data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false; t.flipY = false;
    t.needsUpdate = true;
    return t;
  }

  /** GLSL snippet (uniforms + fogMask/applyFog) for custom shaders. */
  glsl() { return FOG_GLSL; }

  setLevel(level, { instant = true } = {}) {
    this.level = level;
    if (this.width !== level.width || this.height !== level.height) {
      this.width = level.width; this.height = level.height;
      this.data = new Uint8Array(level.width * level.height * 4);
      this.texture.dispose();
      this.texture = this.makeTexture(level.width, level.height);
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
    const kExp = 1 - Math.exp(-dt / 0.2), kVis = 1 - Math.exp(-dt / 0.13);
    const all = this.override === 'all';
    let sweepR = Infinity;
    if (this.sweep) { this.sweep.t += dt; sweepR = this.sweep.t * 22; if (sweepR > lv.width + lv.height) this.sweep = null; }
    const d = this.data;
    for (let i = 0; i < n; i++) {
      let te = all || lv.explored[i] ? 1 : 0;
      const tv = all || lv.visible[i] ? 1 : 0;
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
  material.customProgramCacheKey = () => 'fogofwar-v2';
  return material;
}

const TORCH_POOL = 5;
const TEMPLE_POOL = 2;
const MOOD_POOL = 4;

/**
 * THE ELEVEN LIGHT MOODS (docs/AMBIENCE.md §7) — the thing that turns dressing into ambience.
 *
 * `room.lightMood` is set by the generator and this table says what each mood DOES. It is deliberately
 * built out of the vocabulary that was already here (wall-torch spots, flicker, the pooled point
 * lights, the dust density) rather than a second lighting system beside it:
 *
 *  · `torches` — how many wall-torch spots the room is allowed. A crypt gets none; a guardroom two.
 *  · `fill`    — a soft coloured point light following the player while he is IN a room of this
 *                mood. THIS IS WHAT MAKES A ROOM FEEL COLD OR WARM, and it is the reason the moods
 *                ADD light rather than subtract it: "under-lit and blue" drawn by turning the
 *                ambient down is just a dark room, and it walks the cast straight through
 *                `screenTruth.test.js`'s GROUND_LIT_MIN gate. Drawn as a blue fill it reads as cold
 *                AND leaves the hero legible, which is the only version of it that ships.
 *  · `ambient` — a gentle multiplier on the hemisphere/moon fill, clamped near 1 for the same reason.
 *  · `dust`    — how much air the room carries (atmosphere.js reads this).
 *
 * The per-piece fires (a hearth, a forge, a brazier, a candle, a glowing bench) are separate: they
 * are real point lights at the decor that carries them, from `DECOR_LIGHTS` below.
 */
export const LIGHT_MOODS = {
  torchlit: { torches: 2, ambient: 1.00, fill: 0.00, color: 0xffa04a, dust: 1.0 },
  hearth: { torches: 1, ambient: 1.06, fill: 0.55, color: 0xff8a3a, dust: 1.4 },
  forge: { torches: 1, ambient: 1.08, fill: 0.75, color: 0xff6a20, dust: 1.6 },
  candle: { torches: 0, ambient: 0.92, fill: 0.55, color: 0xffe0a8, dust: 0.8 },
  ember: { torches: 0, ambient: 0.88, fill: 0.90, color: 0xc0442a, dust: 1.2 },
  cold: { torches: 0, ambient: 0.94, fill: 1.05, color: 0x86aad4, dust: 0.7 },
  dark: { torches: 0, ambient: 0.86, fill: 0.00, color: 0x000000, dust: 0.6 },
  water: { torches: 1, ambient: 0.96, fill: 1.00, color: 0x9fd0e8, dust: 0.5 },
  fungal: { torches: 0, ambient: 0.90, fill: 1.00, color: 0x7fe3a8, dust: 0.9 },
  shrine: { torches: 0, ambient: 1.00, fill: 0.60, color: 0xdfe8ff, dust: 1.0 },
  sword: { torches: 0, ambient: 0.92, fill: 0.90, color: 0xb08ad0, dust: 0.7 },
};
export const MOOD_KEYS = Object.keys(LIGHT_MOODS);
const MOOD_INDEX = new Map(MOOD_KEYS.map((k, i) => [k, i]));

/** The decor lights that are an actual FLAME, and the moods in which nobody has lit one. */
const FIRE_KINDS = new Set(['fire', 'forge', 'candle']);
export const FIRELESS_MOODS = new Set(['dark', 'cold', 'sword']);

/**
 * The decor that is literally alight, and what it throws. `maxV`/`minV` gate on the piece's variant,
 * because AMBIENCE §2.1 runs wear UP with the index: a brazier at v3 is cold and tipped over, and a
 * cold brazier is not a lamp.
 */
const DECOR_LIGHTS = {
  hearth: { color: 0xff8a3a, intensity: 5.5, radius: 6.0, y: 0.65, kind: 'fire', maxV: 1 },
  // THE FORGE STANDS IN A HOT SPOT AND IS PARTLY ERASED BY IT. Judged in a rendered frame at the
  // play camera (seed 5, depth 1, the `forge` room): the tile came back as a featureless
  // white-orange block with no hood, no lip, no legs — the signature piece of the archetype
  // invisible in its own room. Hiding every decor group and re-rendering left the hot spot exactly
  // where it was, which rules out the sprite's own emissive and names the culprits as the things
  // that are NOT in dungeon.root: this point light, and (the larger term) the additive halo
  // billboard atmosphere.js hangs over the same tile, which was the widest in its table at 2.1.
  // Both are trimmed. It reads better and it is still hot — the room's grade and the bloom are
  // doing the rest, and that belongs to whoever owns the exposure, not to three magic numbers here.
  forge: { color: 0xff6a20, intensity: 4.6, radius: 5.8, y: 0.80, kind: 'forge', maxV: 0 },
  brazier: { color: 0xff7a2a, intensity: 4.2, radius: 5.2, y: 0.80, kind: 'fire', maxV: 1 },
  candelabra: { color: 0xffe6b0, intensity: 2.4, radius: 3.4, y: 0.85, kind: 'candle', maxV: 1 },
  candlestick: { color: 0xffe6b0, intensity: 1.6, radius: 2.6, y: 0.55, kind: 'candle', maxV: 1 },
  alchemyBench: { color: 0x9fe07a, intensity: 1.5, radius: 2.8, y: 0.55, kind: 'sickly', maxV: 1 },
  retortStand: { color: 0x9fe07a, intensity: 1.0, radius: 2.2, y: 0.5, kind: 'sickly', maxV: 1 },
  cauldron: { color: 0x8fd07a, intensity: 1.0, radius: 2.2, y: 0.4, kind: 'sickly', maxV: 0 },
  mushroomCluster: { color: 0x7fe3a8, intensity: 1.3, radius: 2.8, y: 0.22, kind: 'fungal', minV: 2 },
  spill: { color: 0x7fe3a8, intensity: 0.8, radius: 2.0, y: 0.08, kind: 'fungal', maxV: 0 },
};

/**
 * How each kind of small light behaves in 0..1-ish. A hearth breathes, a forge PULSES (the bellows
 * at about 0.7 Hz), a candle barely moves, fungus swells and fades with no flicker at all, and
 * reflected water light ripples on two beats that never line up.
 */
export function moodFlicker(kind, t, phase) {
  switch (kind) {
    case 'forge': return 0.78 + 0.34 * Math.max(0, Math.sin(t * 4.4 + phase)) ** 2 + 0.07 * Math.sin(t * 13.1 + phase);
    case 'fire': return torchFlicker(t, phase) * 0.95;
    case 'candle': return 0.86 + 0.10 * Math.sin(t * 6.3 + phase) + 0.05 * Math.sin(t * 2.1 + phase * 1.7);
    case 'sickly': return 0.80 + 0.14 * Math.sin(t * 1.3 + phase) + 0.06 * Math.sin(t * 0.41 + phase * 2.3);
    case 'fungal': return 0.70 + 0.30 * Math.sin(t * 0.55 + phase);
    case 'water': return 0.78 + 0.22 * Math.sin(t * 1.9 + phase) * Math.sin(t * 0.71 + phase * 0.5);
    default: return 1;
  }
}

/**
 * Depth bands drive the whole look (DESIGN.md §9.3): ambient/sky colours, the fog "memory" tint,
 * post grading and atmosphere.
 *
 * BOARD-BRIGHT. The reference is a printed HeroQuest board under room light: saturated colour
 * fields, everything legible, no large black areas. This table used to fight that from three sides
 * at once, and all three are pulled back here:
 *
 *  · AMBIENT. `ambientScale` ran 0.8-1.0 below the surface, which made the torches the only thing
 *    keeping a room visible and left an unlit room reading as its own shadow. It now runs 1.5-1.9:
 *    an unlit room states its colour field on its own, and the torches ADD warmth and shape on top
 *    of that instead of being the whole exposure. The band's `ground` colour came up hardest of
 *    all — 0x0a100c at 13-18, a colour with nothing in it — and now sits within about half a stop
 *    of its own `sky` (13-18 sits flat ON it: there is no sky underground, and that band's rooms
 *    are the ones that were worst crushed). That gap is not just brightness: every character
 *    sprite reads the hemisphere as `mix(ground, sky, 0.5 + 0.5*N.y)` and its fake normal peaks in
 *    N.y down the MIDDLE of the body, so a wide sky-to-ground gap is a bright stripe painted down
 *    every figure's centre line. Closing it lifts the room and takes the pillow out of the fill in
 *    the same move.
 *  · MEMORY. `fogTint` multiplies explored-but-unseen stone. At 0.22-0.3 a remembered room was a
 *    grey rectangle; at 0.54-0.66 it is the same room with the lamp somewhere else.
 *  · THE GRADE. Deep levels may still cool and darken — that is the dungeon getting worse — but by
 *    a fraction of what they did. Saturation bottomed out at 0.82 and contrast peaked at 1.2 with a
 *    0.72 vignette, which together turned depth 18 into a black-green wash with no field left in
 *    it. Saturation now never drops below 1.0 (the fields are the point), contrast stays near
 *    neutral, and the vignette is a frame rather than a tunnel. The COLOUR still moves the whole
 *    way: cold blue at 6-12, green at 13-18, violet below — the band is told by hue, not by dark.
 * @param {number} depth
 */
export function depthTint(depth) {
  const c = (h) => new THREE.Color(h);
  if (depth <= 0) return {
    ambient: c(0x8fb2d8), sky: c(0xa9c4e0), ground: c(0x5d5a52), fogTint: new THREE.Color(0.62, 0.64, 0.7), ambientScale: 2.4,
    grade: { tint: new THREE.Color(1.0, 1.0, 1.04), sat: 1.06, contrast: 0.98, vignette: 0.24, lift: 0.008, shadows: c(0xb8c6e2), highlights: c(0xfff4e0) },
    atmo: { shaft: c(0xc8dcff), shaftStrength: 0.55, dust: c(0xfff2d8), dustDensity: 0.7 },
  };
  if (depth <= 5) return {
    ambient: c(0xa08a68), sky: c(0xac9673), ground: c(0x62564a), fogTint: new THREE.Color(0.62, 0.62, 0.68), ambientScale: 1.9,
    grade: { tint: new THREE.Color(1.03, 1.0, 0.96), sat: 1.12, contrast: 0.99, vignette: 0.28, lift: 0.009, shadows: c(0xa8b0cc), highlights: c(0xffefd6) },
    atmo: { shaft: c(0xb9cbe6), shaftStrength: 0.42, dust: c(0xffe6c0), dustDensity: 1.0 },
  };
  if (depth <= 12) return {
    ambient: c(0x8d9ab4), sky: c(0x96a6c0), ground: c(0x555d6c), fogTint: new THREE.Color(0.56, 0.6, 0.7), ambientScale: 1.74,
    grade: { tint: new THREE.Color(0.98, 0.99, 1.05), sat: 1.08, contrast: 1.0, vignette: 0.32, lift: 0.008, shadows: c(0x8e9cc4), highlights: c(0xfff0dc) },
    atmo: { shaft: c(0x8fa8d8), shaftStrength: 0.26, dust: c(0xdde8ff), dustDensity: 0.9 },
  };
  if (depth <= 18) return {
    ambient: c(0x84a68e), sky: c(0x8fb098), ground: c(0x8fb098), fogTint: new THREE.Color(0.54, 0.62, 0.58), ambientScale: 1.62,
    grade: { tint: new THREE.Color(0.97, 1.02, 0.99), sat: 1.04, contrast: 0.94, vignette: 0.34, lift: 0.005, shadows: c(0x86a8a0), highlights: c(0xf4f0dc) },
    atmo: { shaft: c(0x7fb090), shaftStrength: 0.12, dust: c(0xc8e8d0), dustDensity: 0.8 },
  };
  return {
    ambient: c(0xa088a0), sky: c(0xa892a4), ground: c(0x5f5262), fogTint: new THREE.Color(0.6, 0.52, 0.64), ambientScale: 1.52,
    grade: { tint: new THREE.Color(1.03, 0.98, 1.04), sat: 1.0, contrast: 1.03, vignette: 0.36, lift: 0.007, shadows: c(0x9a82b2), highlights: c(0xffe6f0) },
    atmo: { shaft: c(0xb08ad0), shaftStrength: 0.08, dust: c(0xe6c8ff), dustDensity: 0.7 },
  };
}

/** Scratch colour for the mood crossfade (no per-frame allocation). */
const _moodTarget = new THREE.Color();

/** Layered, deterministic torch flicker (8 Hz body + 0.5 Hz drift + gusts) in 0..1. */
export function torchFlicker(t, phase) {
  const body = 0.72 + 0.14 * Math.sin(t * 8.1 + phase) + 0.07 * Math.sin(t * 17.3 + phase * 2.1) + 0.05 * Math.sin(t * 3.3 + phase * 0.7);
  const drift = 0.06 * Math.sin(t * 0.5 + phase * 1.3);
  const gust = Math.max(0, Math.sin(t * 1.1 + phase * 3.7)) ** 6 * 0.18 * Math.sin(t * 29.0 + phase);
  return Math.max(0.35, Math.min(1.15, body + drift + gust));
}

export class Lighting {
  /**
   * @param {THREE.Scene} scene
   * @param {FogOfWar} fog
   * @param {{quality?:'high'|'low'}} [opts]
   */
  constructor(scene, fog, { quality = 'high' } = {}) {
    this.scene = scene; this.fog = fog;
    this.rng = createRng('fargoal-lighting');
    this.time = 0;
    this.quality = quality;
    this.hemi = new THREE.HemisphereLight(0x7d6b55, 0x1a1512, 0.3);
    scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0x9fb4d8, 0.3);
    // Raked, not overhead. Every sprite's fake normal peaks at N.y in the MIDDLE of the body
    // (spriteBillboard: N = forward + up*0.62 + right*sx), so a key coming straight down puts its
    // brightest value down a body's centre line — the definition of pillow shading, and with the
    // board-bright ambient behind it the demon in 'deep-level' crossed screenTruth's 15% ceiling at
    // 17%. Dropping the elevation and widening the throw to the left moves the peak off the centre
    // line and onto the shoulder the whole cast is painted for. It rakes the wall blocks too, which
    // is what gives a lit board its relief.
    this.moon.position.set(-13.5, 8.2, -6.2);
    scene.add(this.moon);
    // Player lantern: a cool shadow-casting spot from above (soft penumbra) plus a local point glow.
    this.spot = new THREE.SpotLight(0xd6e4ff, 24, 26, 0.62, 0.55, 1.5);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(quality === 'low' ? 512 : 1024, quality === 'low' ? 512 : 1024);
    this.spot.shadow.camera.near = 1; this.spot.shadow.camera.far = 24;
    this.spot.shadow.bias = -0.0015; this.spot.shadow.radius = 5;
    this.spot.target = new THREE.Object3D();
    scene.add(this.spot); scene.add(this.spot.target);
    this.point = new THREE.PointLight(0xbfd8ff, 2.0, 6, 2);
    scene.add(this.point);
    this.torches = [];
    for (let i = 0; i < TORCH_POOL; i++) {
      const l = new THREE.PointLight(0xff9a3c, 0, 8, 2);
      l.userData.phase = this.rng.float(0, 100);
      scene.add(l); this.torches.push(l);
    }
    // The nearest torch also throws soft shadows into its room (second and last shadow caster).
    this.torchSpot = new THREE.SpotLight(0xffa04a, 0, 11, 1.15, 0.8, 1.6);
    this.torchSpot.castShadow = quality !== 'low';
    this.torchSpot.shadow.mapSize.set(512, 512);
    this.torchSpot.shadow.camera.near = 0.3; this.torchSpot.shadow.camera.far = 12;
    this.torchSpot.shadow.bias = -0.002; this.torchSpot.shadow.radius = 6;
    this.torchSpot.target = new THREE.Object3D();
    scene.add(this.torchSpot); scene.add(this.torchSpot.target);
    this.temples = [];
    for (let i = 0; i < TEMPLE_POOL; i++) {
      const l = new THREE.PointLight(0xbfe6ff, 0, 6, 1.7);
      scene.add(l); this.temples.push(l);
    }
    // The per-room mood (AMBIENCE §7): a fixed pool for the fires standing in the rooms, plus one
    // soft fill that follows the player and carries the colour of the room he is standing in.
    this.moodLights = [];
    for (let i = 0; i < MOOD_POOL; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 5, 2);
      scene.add(l); this.moodLights.push(l);
    }
    /** every alight decor piece on the level: {x,y,z,color,intensity,radius,kind,phase} */
    this.moodSources = [];
    /** mood index per tile (-1 outside every room), and the blended state of the room we are in */
    this.moodTiles = null; this.moodW = 0; this.moodH = 0;
    this.mood = { ambient: 1, fill: 0, dust: 1, name: 'torchlit' };
    this.moodColor = new THREE.Color(0xffffff);
    /** what atmosphere.js multiplies its dust density by this frame */
    this.dustScale = 1;
    /** wall torch positions for the current level: {x, y, z, nx, nz, tx, ty, phase} */
    this.torchSpots = [];
    this.templeSpots = [];
    this.lightScale = 1;
    this.baseHemi = 0.3; this.baseMoon = 0.3;
    this.flickerPhase = this.rng.float(0, 100);
    this.depth = 1;
    this._near = []; // scratch for the per-frame nearest-spot sort
    /** live light list for the atmosphere shaders: [{x,y,z,r,g,b,i}] (fixed length, in place) */
    this.activeLights = Array.from({ length: 2 + TORCH_POOL + TEMPLE_POOL + MOOD_POOL }, () => ({ x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, i: 0 }));
  }

  /** Nearest `n` spots to (x,z), reusing the scratch array (spots carry a transient `d`). */
  nearest(spots, x, z) {
    const out = this._near; out.length = 0;
    for (const sp of spots) { sp.d = Math.hypot(sp.x - x, sp.z - z); out.push(sp); }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  /** Choose torch spots for a level (wall faces looking into rooms) and apply the depth look. */
  setLevel(level) {
    const rng = createRng(level.seed * 31 + 7);
    const spots = [];
    const tint = depthTint(level.depth);
    this.depth = level.depth;
    this.hemi.color.copy(tint.sky); this.hemi.groundColor.copy(tint.ground);
    this.moon.color.copy(tint.ambient);
    // the band's own key colour, kept so a room's mood can tint it without losing it
    this.moonBase = tint.ambient.clone();
    this.fog.uniforms.fogTint.value.copy(tint.fogTint);
    // The room's own light, before any torch is lit. Board-bright: this is the "room light" the
    // printed reference sits under, so it has to be enough on its own — the torches are relief on
    // top of it, not the exposure. (Was 0.55/0.45 against ambientScale ~1; the two together are
    // now about 3x what they were below the surface.)
    //
    // AND THE SPLIT MATTERS AS MUCH AS THE SUM. `hemi` is omnidirectional: it raises a room and
    // models nothing, and a body lit mostly by it has no terminator. Raising both halves in the
    // old 0.55:0.45 proportion put the demon in 'deep-level' at 17% of its body centre-lit and the
    // dire wolf at 16%, against screenTruth's 15% ceiling — the ambient lift was landing as flat
    // fill. The key now carries four times the fill instead of four fifths of it: `moon` is the
    // directional every sprite in the game is painted for, so the extra light arrives with a
    // direction in it, and the wolf, the hobgoblin and the spider all came back under the ceiling.
    this.baseHemi = 0.26 * tint.ambientScale; this.baseMoon = 1.20 * tint.ambientScale;
    if (level.depth === 0) { this.baseHemi = 1.4; this.baseMoon = 1.6; }
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
      const max = this.torchBudget(c.room);
      if (n >= max) continue;
      if (spots.some((s) => Math.abs(s.x - c.x) + Math.abs(s.y - c.y) < 4)) continue;
      perRoom.set(c.room, n + 1);
      spots.push({ x: c.x + c.nx * 0.5, y: 0.62, z: c.y + c.nz * 0.5, nx: c.nx, nz: c.nz, tx: c.x, ty: c.y, phase: rng.float(0, 100) });
    }
    this.torchSpots = spots;
    this.templeSpots = level.temples.map((t) => ({ x: t.x, z: t.y }));
    this.lightScale = 1;
    this.setMoods(level, rng);
  }

  /**
   * How many wall torches a room may light. A crypt is cold because nobody has been down to light
   * it, not because the renderer dimmed it — so the mood decides the torch count, and a room with a
   * mood the generator never set keeps exactly the budget it had before this feature existed.
   */
  torchBudget(room) {
    if (room.type === 'temple' || room.type === 'shrine') return 0;
    const m = room.lightMood && LIGHT_MOODS[room.lightMood];
    if (!m) return room.w * room.h > 20 ? 2 : 1;
    return m.torches > 1 && room.w * room.h <= 20 ? 1 : m.torches;
  }

  /**
   * Per-room mood (AMBIENCE §7): a tile -> mood map for the fill that follows the player, and one
   * point-light source per piece of decor that is actually alight.
   */
  setMoods(level, rng) {
    this.moodW = level.width; this.moodH = level.height;
    this.moodTiles = new Int8Array(level.width * level.height).fill(-1);
    for (const r of level.rooms) {
      const mi = MOOD_INDEX.has(r.lightMood) ? MOOD_INDEX.get(r.lightMood) : -1;
      if (mi < 0) continue;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        if (x >= 0 && y >= 0 && x < level.width && y < level.height) this.moodTiles[y * level.width + x] = mi;
      }
    }
    const src = [];
    const moodOf = (x, y) => {
      const mi = x >= 0 && y >= 0 && x < level.width && y < level.height ? this.moodTiles[y * level.width + x] : -1;
      return mi >= 0 ? MOOD_KEYS[mi] : 'torchlit';
    };
    for (const d of level.decor || []) {
      const spec = DECOR_LIGHTS[d.type];
      if (!spec) continue;
      const v = d.variant | 0;
      if (spec.maxV !== undefined && v > spec.maxV) continue;
      if (spec.minV !== undefined && v < spec.minV) continue;
      // A FIRE NEEDS SOMEBODY TO HAVE LIT IT. `dark` is "the room is a hole" and `cold` is
      // "nobody has been down to light it" (AMBIENCE §7), so a brazier burning happily in one of
      // them contradicts its own room. The renderer draws the piece's UNLIT twin there
      // (render/props/models.js), and the light has to go out with the flame. Fungus and
      // alchemy keep their glow: neither of those needs a match.
      if (FIRE_KINDS.has(spec.kind) && FIRELESS_MOODS.has(moodOf(d.x, d.y))) continue;
      src.push({ x: d.x, y: spec.y, z: d.y, color: spec.color, intensity: spec.intensity, radius: spec.radius, kind: spec.kind, phase: rng.float(0, 100) });
    }
    // A flooded room throws its own reflected light: one rippling source over the water it holds.
    for (const r of level.rooms) {
      if (r.lightMood !== 'water') continue;
      let wx = 0, wz = 0, n = 0;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        if (level.get(x, y) === TILE.WATER) { wx += x; wz += y; n++; }
      }
      const cx = n ? wx / n : r.cx ?? r.x + r.w / 2, cz = n ? wz / n : r.cy ?? r.y + r.h / 2;
      src.push({ x: cx, y: 0.35, z: cz, color: 0x9fd0e8, intensity: n ? 3.0 : 1.8, radius: 6.0, kind: 'water', phase: rng.float(0, 100) });
    }
    this.moodSources = src;
    const start = this.moodAt(level.stairsUp ? level.stairsUp.x : 0, level.stairsUp ? level.stairsUp.y : 0);
    this.mood = { ...start };
    this.moodColor.setHex(LIGHT_MOODS[start.name].color);
    this.dustScale = start.dust;
  }

  /** The mood in force on a tile: the room's, or the level default outside every room. */
  moodAt(x, y) {
    const ix = Math.round(x), iy = Math.round(y);
    let name = 'torchlit';
    if (this.moodTiles && ix >= 0 && iy >= 0 && ix < this.moodW && iy < this.moodH) {
      const mi = this.moodTiles[iy * this.moodW + ix];
      if (mi >= 0) name = MOOD_KEYS[mi];
      else name = 'torchlit';                 // a corridor keeps the plain warm default
    }
    const m = LIGHT_MOODS[name];
    return { name, ambient: m.ambient, fill: m.fill, dust: m.dust };
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
    // Crossfade into the mood of the room the player is standing in. Half a second: long enough
    // that walking a doorway is a change of light rather than a cut, short enough to feel like one.
    const want = this.moodAt(player.x, player.z);
    const k = 1 - Math.exp(-dt / 0.45);
    this.mood.name = want.name;
    this.mood.ambient += (want.ambient - this.mood.ambient) * k;
    this.mood.fill += (want.fill - this.mood.fill) * k;
    this.mood.dust += (want.dust - this.mood.dust) * k;
    this.moodColor.lerp(_moodTarget.setHex(LIGHT_MOODS[want.name].color), k);
    this.dustScale = this.mood.dust;
    // THE MOOD IS A COLOUR ON THE KEY LIGHT. Three versions of this were measured out of the frame
    // by `screenTruth.test.js`'s pillow gate on the demon in 'deep-level', and the three failures
    // are the whole lesson:
    //
    //   1. A coloured POINT light over the player's head worked as colour and failed as light: a
    //      point light at the middle of the frame lights every nearby sprite from ITS OWN CENTRE,
    //      which is the definition of pillow shading (0.151 against a ceiling of 0.150).
    //   2. Pushing it into the HEMISPHERE instead was flatter and no better — an omnidirectional
    //      tint colours the SHADOW side of a form as much as the lit side, so the terminator stops
    //      separating them and the body reads as lit down its middle again (0.151).
    //   3. DIMMING the ambient for the cold and dark moods did the same thing from the other end:
    //      it raised the share of the frame that comes from the player's own overhead lantern,
    //      which is a centre light. So `amb` never drops below 1: a dark room is dark because
    //      nothing in it is burning, never because the renderer turned the room down.
    //
    // What works, measured at 0.146, is to colour the KEY: `moon` is the directional from
    // (-6, 14, -4) — top-left, the direction every sprite in the game is painted for — so a cold
    // room is a room whose key light has gone blue, which is what cold light actually is. The
    // hemisphere keeps the depth band's own colour and the modelling on the cast survives it.
    const amb = Math.max(1, this.mood.ambient);
    this.hemi.intensity = this.baseHemi * (1 + lit * 2.4) * (state.lightOn ? 1.25 : 1) * amb * (1 + this.mood.fill * 0.12);
    this.moon.intensity = this.baseMoon * (1 + lit * 3.0) * amb * (1 + this.mood.fill * 1.25);
    if (this.moonBase) this.moon.color.copy(this.moonBase).lerp(this.moodColor, Math.min(0.55, this.mood.fill * 0.5));
    // The carried lantern breathes slowly (a lantern, not a torch: no fast flicker).
    const breathe = 0.94 + 0.04 * Math.sin(t * 1.7 + this.flickerPhase) + 0.02 * Math.sin(t * 5.3);
    const target = state.lightOn ? 1.7 : 1;
    this.lightScale += (target - this.lightScale) * Math.min(1, dt * 4);
    const s = this.lightScale;
    const sword = state.sword ? 1 : 0;
    // Raked for the same reason as `moon` above: at (2.4, 8.0, 1.8) the lantern reached a sprite
    // 22 degrees off vertical, which is an overhead light, which is a centre light. Pushed out and
    // down it arrives at about 40 degrees — it models a body instead of flooding it, and it throws
    // a longer shadow across the flagstones, which is what a lit board looks like.
    this.spot.position.set(player.x + 4.2, 6.8, player.z + 3.2);
    this.spot.target.position.set(player.x, 0, player.z);
    // THE LANTERN IS RELIEF, NOT THE EXPOSURE. A spot 8 units directly overhead is a centre light
    // for every sprite under it; at 26 it was carrying the frame, so the frame was pillow-lit and
    // the room's own colour field only existed inside its pool. With the ambient tripled it can
    // come down to a third and still be the thing that says where the player is standing.
    this.spot.intensity = (state.allLit ? 6 : 10) * breathe * (0.75 + 0.25 * s);
    this.spot.distance = 26;
    this.spot.angle = Math.min(1.0, 0.66 * (0.6 + 0.4 * s));
    this.spot.penumbra = 0.55;
    this.spot.color.set(state.lightOn ? 0xdde9ff : 0xd2e2ff);
    this.point.position.set(player.x, 2.6, player.z);
    this.point.intensity = (state.lightOn ? 3.6 : 1.3) * breathe * (1 + sword * 0.6);   // ditto: a glow at the player's own centre
    this.point.distance = 6 * s;
    this.point.color.set(state.sword ? 0xc9b0ff : state.lightOn ? 0xcfe4ff : 0xbfd8ff);
    const al = this.activeLights;
    let n = 0;
    const put = (x, y, z, col, i) => { const a = al[n++]; a.x = x; a.y = y; a.z = z; a.r = col.r; a.g = col.g; a.b = col.b; a.i = i; };
    put(player.x, 1.5, player.z, this.point.color, this.point.intensity * 0.9);
    // Nearest torches get the real lights.
    const sorted = this.nearest(this.torchSpots, player.x, player.z);
    for (let i = 0; i < TORCH_POOL; i++) {
      const l = this.torches[i];
      const sp = sorted[i];
      if (!sp || (sp.d > 17 && !state.allLit)) { l.intensity = 0; continue; }
      const f = torchFlicker(t, sp.phase);
      l.position.set(sp.x + sp.nx * 0.32, 0.95, sp.z + sp.nz * 0.32);
      l.intensity = 11 * f;
      l.distance = 8.5;
      l.color.setRGB(1.0, 0.55 + 0.1 * f, 0.2 + 0.08 * f);
      put(l.position.x, l.position.y, l.position.z, l.color, l.intensity);
    }
    // Torch shadow spot follows the nearest torch, throwing into its room.
    const nearestTorch = sorted[0];
    if (nearestTorch && nearestTorch.d < 12) {
      const f = torchFlicker(t, nearestTorch.phase);
      const ts = this.torchSpot;
      ts.position.set(nearestTorch.x + nearestTorch.nx * 0.28, 1.05, nearestTorch.z + nearestTorch.nz * 0.28);
      ts.target.position.set(nearestTorch.x + nearestTorch.nx * 3.2, -0.6, nearestTorch.z + nearestTorch.nz * 3.2);
      ts.intensity = 7 * f;
    } else this.torchSpot.intensity = 0;
    // The fires standing in the rooms: nearest four get the pool, each on its own beat.
    const near = this.nearest(this.moodSources, player.x, player.z);
    for (let i = 0; i < MOOD_POOL; i++) {
      const l = this.moodLights[i], sp = near[i];
      if (!sp || (sp.d > 15 && !state.allLit)) { l.intensity = 0; continue; }
      const f = moodFlicker(sp.kind, t, sp.phase);
      l.position.set(sp.x, sp.y, sp.z);
      l.color.setHex(sp.color);
      l.intensity = sp.intensity * f;
      l.distance = sp.radius;
      put(l.position.x, l.position.y, l.position.z, l.color, l.intensity);
    }
    const temples = this.nearest(this.templeSpots, player.x, player.z);
    for (let i = 0; i < TEMPLE_POOL; i++) {
      const l = this.temples[i];
      const sp = temples[i];
      if (!sp) { l.intensity = 0; continue; }
      l.position.set(sp.x, 2.1, sp.z);
      l.intensity = 5 + 0.9 * Math.sin(t * 1.7);
      put(l.position.x, l.position.y, l.position.z, l.color, l.intensity);
    }
    for (; n < al.length; n++) al[n].i = 0;
  }
}

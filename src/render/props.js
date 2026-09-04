// Prop meshes: items, treasure, the Sword of Fargoal, altars, torches, arches, rubble, runes.
// All geometry is procedural and shared through a geometry cache; materials are the shared set
// from materials.js plus a few fog-aware glow/billboard materials from propFx.js.
//
// Contract with DungeonView: item props carry userData.anim {y0, amp, speed, spin, t, node?, halo?}
// (bob/spin), flames carry userData.flame (scale flicker), the altar haze carries userData.glow.
// Richer motion (glints, orbiting motes, sigils, sparks) runs through the module-level animator:
// props register a tick function and Effects.update() calls updateProps() once per frame.
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { PALETTE, createShaftMaterial } from './materials.js';
import { glowTexture, glintTexture, sigilTexture, runeCircleTexture, billboard, groundGlow, flame, litMaterial, getFog, updateFlames } from './propFx.js';
import { paint, outline, toRGBA, Palette, makePix, blit } from './sprites/pixelPainter.js';
import { INK, INK_LIT, LIT, ramp } from './sprites/style.js';
import { PX_PER_TILE } from './sprites/spriteBillboard.js';

const geoCache = new Map();
function geo(key, make) { let g = geoCache.get(key); if (!g) { g = make(); geoCache.set(key, g); } return g; }

function mesh(g, m, x = 0, y = 0, z = 0, opts = {}) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  if (opts.rx) o.rotation.x = opts.rx; if (opts.ry) o.rotation.y = opts.ry; if (opts.rz) o.rotation.z = opts.rz;
  if (opts.s) o.scale.setScalar(opts.s);
  o.castShadow = opts.shadow !== false; o.receiveShadow = true;
  return o;
}

export const SPELL_COLORS = { teleport: 0x4ee1ff, shield: 0xffd43b, regeneration: 0x69db7c, invisibility: 0xb197fc, light: 0xfff3bf, drift: 0xe9ecef };

// ==================================================================== hand-pixelled item sprites
// A treasure chest built from smooth-shaded low-poly primitives sits in the diorama like a render
// test: every other surface in shot is painted and high-frequency, and the chest has no texture at
// all. Octopath's props are 3D, but they are *painted*. So the pickups are drawn the same way the
// cast is — a hand-pixelled sprite on the house ramps, with the house ink outline and the house
// top-left key light — and billboarded upright in the lit room. Everything else (glow pools,
// glints, motes, particles) is unchanged, so the props still read as magical, just not as plastic.
const _wp = new THREE.Vector3(), _bufSize = new THREE.Vector2();
const pixTex = new Map();

/**
 * Palette from house ramps. `ramps` maps a key STRING (5-7 chars, darkest first) to a base colour;
 * `extra` sets single keys directly. The ink and its lit variant are always present.
 * @param {Object<string, string|number>} ramps @param {Object<string, string|number[]>} [extra]
 */
function itemPalette(ramps, extra = {}) {
  const p = new Palette().set('#', INK).set('@', INK_LIT);
  for (const keys in ramps) {
    const cols = ramp(ramps[keys], keys.length);
    for (let i = 0; i < keys.length; i++) p.set(keys[i], cols[i]);
  }
  for (const k in extra) p.set(k, extra[k]);
  return p;
}

/** Painted rows -> a padded, house-outlined, NearestFilter texture (built once per key). */
function pixelTexture(key, rows, pal) {
  let t = pixTex.get(key);
  if (t) return t;
  const src = paint(rows);
  const pad = makePix(src.w + 2, src.h + 2);
  blit(pad, src, 1, 1);
  const art = outline(pad, '#', { lit: LIT, litKey: '@' });
  const canvas = document.createElement('canvas');
  canvas.width = art.w; canvas.height = art.h;
  canvas.getContext('2d').putImageData(new ImageData(toRGBA(art, pal), art.w, art.h), 0, 0);
  t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.userData.size = { w: art.w, h: art.h };
  pixTex.set(key, t);
  return t;
}

/**
 * Size a pixel prop from the camera so one art texel covers a WHOLE number of device pixels (the
 * rounding spriteBillboard.js explains at length), and turn it to the camera's yaw so it stays
 * upright. Without the rounding the same 3px/4px/3px mush that ruined the characters shows up on
 * the pickups.
 */
function syncPixelSprite(m, renderer, camera) {
  m.getWorldPosition(_wp);
  // SCREEN-ALIGNED, not merely yawed to the camera. A world-upright quad under this steeply pitched
  // camera is foreshortened to about 60% of its height, which turns every carefully drawn pickup
  // into a flat lozenge on the floor. Facing the image plane keeps the art at its true aspect and
  // keeps all four corners at one depth, so the texels stay square — the same bargain the character
  // billboards make.
  m.quaternion.copy(camera.quaternion);
  const size = renderer.getDrawingBufferSize(_bufSize);
  const d = Math.max(0.5, camera.position.distanceTo(_wp));
  const pxPerWorld = (size.y * (camera.zoom || 1)) / (2 * Math.tan((camera.fov || 45) * Math.PI / 360) * d);
  const S = Math.max(2, Math.round(pxPerWorld / PX_PER_TILE));
  const w = S / pxPerWorld;
  const t = m.userData.tex;
  m.scale.set(t.w * w, t.h * w, 1);
  m.updateMatrix();
  if (m.parent) m.matrixWorld.multiplyMatrices(m.parent.matrixWorld, m.matrix);
  else m.matrixWorld.copy(m.matrix);
}

/**
 * A hand-pixelled item billboard, pivoted on its bottom edge and lit by the room like any other
 * surface (alpha-tested, so it writes depth and sorts against the dungeon properly).
 * @param {string} key @param {string[]} rows @param {Palette} pal
 * @param {{glow?:number, emissive?:number, y?:number}} [o] `glow` is the emissive floor that keeps
 *   a pickup legible in an unlit corridor; magical items push it up.
 */
function pixelSprite(key, rows, pal, o = {}) {
  const tex = pixelTexture(key, rows, pal);
  const mat = litMaterial('pixel:' + key, {
    map: tex, alphaTest: 0.5, transparent: false, side: THREE.DoubleSide,
    roughness: 1, metalness: 0,
    emissiveMap: tex, emissive: new THREE.Color(o.emissive ?? 0xffffff), emissiveIntensity: o.glow ?? 0.14,
  });
  const m = new THREE.Mesh(geo('pixelQuad', () => new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0)), mat);
  m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
  m.position.y = o.y ?? 0.01;
  m.userData.tex = tex.userData.size;
  m.onBeforeRender = (renderer, scene, camera) => syncPixelSprite(m, renderer, camera);
  return m;
}

// ------------------------------------------------------------------ the art
const ART = {
  potion: [
    '.....dd.....',
    '.....bc.....',
    '....s33q....',
    '....s33q....',
    '...s3333q...',
    '..s443333q..',
    '.s44333333q.',
    's443*333333q',
    's4333333333q',
    's3333333222q',
    's3222222221q',
    '.s22222211q.',
    '..s211111q..',
    '...s1111q...',
    '....qqqq....',
  ],
  sack: [
    '.....non......',
    '...nonomon....',
    '..nomooomon...',
    '.jnomoooomonj.',
    '.jihhhhhhhggf.',
    'jiihgihhgihgff',
    'jiihgihhgihgff',
    'jiihgihhgihgff',
    'iiihgihhgihgff',
    'iihhgihhgihgff',
    'iihhhhhhhggfff',
    '.ihhhhhhggfff.',
    '..hhhgggggff..',
    '..onm...onm...',
  ],
  magicSack: [
    '.....jij......',
    '....pppp......',
    '....jihhhg....',
    '...jiihhhhgf..',
    '..jiihhhhhggf.',
    '.jiihhXhhhggff',
    '.jiihXXXhhggff',
    'jiiihhXhhhggff',
    'iiihhhhhhggfff',
    'iihhhhhhggffff',
    '.ihhhhhhggfff.',
    '..hhhgggggff..',
  ],
  cache: [
    '....wvvu....',
    '..wvvuuuts..',
    '.wvvuuuuttss',
    'vvvuuuuttsss',
    'vvuuuuonmsss',
    'uuuuttonmsss',
    '.uutttsssss.',
  ],
  scroll: [
    '..vwwwwwwwv..',
    '.uvwwwwwwwvu.',
    'tuvwwiiiwwvut',
    'tuvwwhhhwwvut',
    'stuvvhhhvvuts',
    '.sttuhhhutts.',
    '..sstttttss..',
  ],
  book: [
    '.ssssssssxy.',
    'prrrrrrrrxyw',
    'prrrrrrrrxyw',
    'prrrrrrrrxyw',
    'prrr**rrrxyw',
    'prr*oo*rrxyw',
    'prr*oo*rrxyw',
    'prrr**rrrxyw',
    'prrrrrrrrxyw',
    'prrrrrrrrxyw',
    'pqqqqqqqqxyw',
    'pqqqqqqqqxyw',
    'pqqqqqqqqxyw',
    '.qqqqqqqqxy.',
    '.pppppppppp.',
  ],
  blade: [
    '....e....',
    '...dec...',
    '...dec...',
    '...dec...',
    '...dec...',
    '...dec...',
    '...dec...',
    '...dec...',
    '...dec...',
    '...dec...',
    '.iiihiii.',
    '.hhhghhh.',
    '....l....',
    '....l....',
    '....k....',
    '...hih...',
  ],
  crystal: [
    '....e....',
    '...dee...',
    '..cddee..',
    '.ccdddee.',
    'bccdddeed',
    'bccdddeed',
    '.bccddee.',
    '..bccdd..',
    '...bcc...',
    '....b....',
  ],
  chest: [
    '.....bccccccb.....',
    '...bccddddddccb...',
    '..bccddddddddccb..',
    '.bccddfddddddfccb.',
    'bccddfddddddfccbba',
    'bccddfddddddfccbba',
    'hhhhhhhhhhhhhhhhhh',
    'ddcccfccbbbbfbaaaa',
    'ddcccfccnmncfbaaaa',
    'ddcccfccnkncfbaaaa',
    'ddcccfccbbbbfbaaaa',
    'ccbbbfbbaaaafaaaaa',
    'ccbbbfbbaaaafaaaaa',
    'hhhhhhhhhhhhhhhhhh',
    '.gg............gg.',
  ],
  chestOpen: [
    '..bccddddddddccb..',
    '..bccddddddddccb..',
    '..hhhhhhhhhhhhhh..',
    '.gg###########gg..',
    '.gg#nmnlmnlnm#gg..',
    '.gg#mnmnmnmnm#gg..',
    '.ggclmlmlmlmlcgg..',
    'ddcccfccbbbbfbaaaa',
    'ddcccfccbbbbfbaaaa',
    'ccbbbfbbaaaafaaaaa',
    'hhhhhhhhhhhhhhhhhh',
    '.gg............gg.',
  ],
  // a floor slab, seen from above: worn stone speckle inside a brass frame
  trapSlab: [
    'pppppppppppppppp',
    'pmmmmmmmmmmmmmmp',
    'pnqqqqqqqqqqqqnp',
    'pnqrrrsrsrrrrqnp',
    'pnqrsrrrrrsrrqnp',
    'pnqrrrrsrrrrrqnp',
    'pnqrrsrrrrsrrqnp',
    'pnqsrrrrrrrrsqnp',
    'pnqrrrrsrrrrrqnp',
    'pnqrsrrrrrrsrqnp',
    'pnqrrrrrsrrrrqnp',
    'pnqrrsrrrrrrsqnp',
    'pnqrrrrrrsrrrqnp',
    'pnqqqqqqqqqqqqnp',
    'pllllllllllllllp',
    'pppppppppppppppp',
  ],
};

const GOLD_RAMP = { klmno: '#c99a2e' };
const PAL = {
  potion: itemPalette({ qrstu: '#8ba4c2', 12345: '#c8322f', abcde: '#8a6034' }, { '*': '#f4f8ff' }),
  sack: itemPalette({ fghij: '#7a5a34', ...GOLD_RAMP }, { p: '#9a7840' }),
  magicSack: itemPalette({ fghij: '#5b3a8a', ...GOLD_RAMP }, { p: '#c9a94e', X: '#e8d8ff' }),
  cache: itemPalette({ stuvw: '#6d5a42', ...GOLD_RAMP }),
  scroll: itemPalette({ stuvw: '#c6b183', fghij: '#a5262a' }),
  blade: itemPalette({ abcde: '#9fc0d8', fghij: '#c9a94e' }, { k: '#4a3020', l: '#5d3d28' }),
  crystal: itemPalette({ abcde: '#3fbf62' }),
  chest: itemPalette({ abcde: '#7a5230', fghij: '#8f8b86', ...GOLD_RAMP }),
  trapSlab: itemPalette({ pqrst: '#7d7468', klmno: '#a8843a' }),
};
/** Spellbook: cream pages + a cover in the spell's own colour (one palette per spell type). */
const bookPal = (() => {
  const cache = new Map();
  return (type) => {
    let p = cache.get(type);
    if (!p) {
      const c = '#' + new THREE.Color(SPELL_COLORS[type] || 0xffffff).getHexString();
      p = itemPalette({ pqrst: c, uvwxy: '#d9cdaa' }, { '*': '#fff6d8', o: '#e8c45a' });
      cache.set(type, p);
    }
    return p;
  };
})();

// ------------------------------------------------------------------ animator registry
const LIVE = new Set();
/** Register a per-frame tick for a prop (pruned automatically once it leaves the scene graph). */
export function animate(obj, fn) { obj.userData.tick = fn; LIVE.add(obj); return obj; }

/**
 * Advance every live prop. Called by Effects.update.
 * @param {number} dt
 * @param {number} time
 * @param {{px:number, pz:number, emit?:(o:object)=>void, rng:object}} ctx player position + particle emitter
 */
export function updateProps(dt, time, ctx) {
  updateFlames(time);
  for (const o of LIVE) {
    if (!o.parent) { LIVE.delete(o); continue; }
    const dx = o.position.x - ctx.px, dz = o.position.z - ctx.pz;
    const d2 = dx * dx + dz * dz;
    if (d2 > 16 * 16) continue; // far from the camera: skip (motion is invisible there)
    o.userData.tick(dt, time, ctx, Math.sqrt(d2));
  }
}
export function liveProps() { return LIVE.size; }

let defaultFactory = null;
/** The renderer's PropFactory (Effects borrows it for transient props such as the opened chest). */
export function getPropFactory() { return defaultFactory; }

export class PropFactory {
  /**
   * @param {ReturnType<import('./materials.js').createMaterials>} mats
   */
  constructor(mats) {
    this.mats = mats;
    this.rng = createRng('fargoal-props');
    this.scrollMats = {};
    defaultFactory = this;
  }

  /** Lit material for a spell colour (book covers, seals). */
  spellMaterial(type) {
    const c = SPELL_COLORS[type] || 0xffffff;
    return litMaterial('spell:' + type, { color: new THREE.Color(c).multiplyScalar(0.55), roughness: 0.6, metalness: 0.1, emissive: new THREE.Color(c), emissiveIntensity: 0.35 });
  }

  // ------------------------------------------------------------------ items
  /** Build a prop for an ItemInstance. */
  item(it) {
    const g = new THREE.Group();
    g.userData.anim = { y0: 0, amp: 0, speed: 0, spin: 0, t: this.rng.float(0, 6) };
    switch (it.type) {
      case 'gold': return it.hidden ? this.buriedCache(g) : this.goldSack(g, it.gold || 20);
      case 'chest': return it.hidden ? this.trapSquare(g) : this.chest(g);
      case 'sword': return this.swordInStone(g);
      case 'potion': return this.potion(g);
      case 'sack': return this.magicSack(g);
      case 'map': return this.scroll(g);
      case 'enchant': return this.enchantedWeapon(g);
      case 'beacon': return this.beaconItem(g);
      default: return this.spellbook(g, it.type);
    }
  }

  /** Twinkling glints at given local positions (scale-animated, deterministic phases). */
  addGlints(g, color, spots, { size = 0.16, rate = 1.7 } = {}) {
    const glints = spots.map(([x, y, z], i) => {
      const b = billboard(glintTexture(), color, size);
      b.position.set(x, y, z); b.userData.phase = this.rng.float(0, 6.28) + i * 1.3; b.userData.rate = rate * this.rng.float(0.8, 1.25);
      g.add(b); return b;
    });
    g.userData.glints = glints;
    return glints;
  }

  tickGlints(o, time) {
    const gl = o.userData.glints; if (!gl) return;
    for (const b of gl) {
      const s = Math.max(0, Math.sin(time * b.userData.rate + b.userData.phase));
      const k = s * s * s * s; // sharp twinkle
      b.scale.set(b.userData.size0 * (0.2 + k), b.userData.size0 * (0.2 + k), 1);
    }
  }

  finishGlints(g) {
    for (const b of g.userData.glints || []) b.userData.size0 = b.scale.x;
    animate(g, (dt, time) => this.tickGlints(g, time));
  }

  goldSack(g, amount = 20) {
    const rich = Math.min(1, amount / 120);
    g.add(pixelSprite('sack', ART.sack, PAL.sack, { glow: 0.1 }));
    g.add(groundGlow(0xffb340, 0.42, { opacity: 0.32 + rich * 0.15 }));
    this.addGlints(g, 0xfff0b0, [[-0.17, 0.035, 0.05], [0.17, 0.035, 0.05], [0.0, 0.4, 0.03]], { size: 0.14 + rich * 0.05 });
    this.finishGlints(g);
    g.userData.anim.sparkle = true;
    return g;
  }

  buriedCache(g) {
    g.add(pixelSprite('cache', ART.cache, PAL.cache, { glow: 0.08 }));
    g.add(groundGlow(0xffb340, 0.3, { opacity: 0.18 }));
    this.addGlints(g, 0xfff0b0, [[0.05, 0.11, 0.04]], { size: 0.12, rate: 1.1 });
    this.finishGlints(g);
    return g;
  }

  /** Hidden treasure/trap square: an inset slab of painted flagstone framed in brass. */
  trapSquare(g) {
    const M = this.mats;
    const slab = mesh(geo('trapSlab', () => new THREE.BoxGeometry(0.7, 0.04, 0.7)),
      litMaterial('trapSlabPix', { map: pixelTexture('trapSlab', ART.trapSlab, PAL.trapSlab), roughness: 0.92, metalness: 0.05 }), 0, 0.03, 0);
    g.add(slab);
    const frame = geo('trapFrame', () => new THREE.BoxGeometry(0.78, 0.03, 0.05));
    for (const [x, z, ry] of [[0, 0.365, 0], [0, -0.365, 0], [0.365, 0, Math.PI / 2], [-0.365, 0, Math.PI / 2]]) g.add(mesh(frame, M.brass, x, 0.035, z, { ry }));
    return g;
  }

  /** Closed chest: painted planks, iron bands and a gold lock, hand-pixelled. */
  chest(g) {
    g.add(pixelSprite('chest', ART.chest, PAL.chest, { glow: 0.1 }));
    g.add(groundGlow(0xffb340, 0.45, { opacity: 0.22 }));
    if (!g.userData.glints) { this.addGlints(g, 0xfff0b0, [[0.0, 0.29, 0.03], [0.2, 0.44, 0.02]], { size: 0.13, rate: 1.2 }); this.finishGlints(g); }
    return g;
  }

  /** Open chest for the loot moment: lid thrown back, gold heaped inside, light spilling out. */
  chestOpen() {
    const g = new THREE.Group();
    g.add(pixelSprite('chestOpen', ART.chestOpen, PAL.chest, { glow: 0.12 }));
    const inner = billboard(glowTexture(), 0xffc860, 0.9); inner.position.set(0, 0.32, 0.02); g.add(inner);
    g.userData.inner = inner;
    this.addGlints(g, 0xfff4c0, [[0.09, 0.3, 0.02], [-0.11, 0.28, 0.02], [0.0, 0.36, 0.02]], { size: 0.2, rate: 3 });
    this.finishGlints(g);
    return g;
  }

  /** The Sword of Fargoal on its plinth: hero prop with aura, light shaft, halo and orbiting motes. */
  swordInStone(g) {
    const M = this.mats;
    g.add(mesh(geo('plinthStep', () => new THREE.CylinderGeometry(0.44, 0.5, 0.08, 10)), M.marble, 0, 0.04, 0));
    g.add(mesh(geo('plinth', () => new THREE.CylinderGeometry(0.26, 0.34, 0.24, 8)), M.marble, 0, 0.2, 0));
    g.add(mesh(geo('plinthCap', () => new THREE.CylinderGeometry(0.3, 0.26, 0.05, 8)), M.marble, 0, 0.34, 0));
    const sword = this.swordMesh(1.05);
    sword.position.set(0, 0.6, 0); sword.rotation.z = Math.PI; sword.rotation.y = 0.5;
    g.add(sword);
    // aura: soft violet-blue billboard behind the blade + a hot core glint at the tip
    const aura = billboard(glowTexture(), 0x8fb4ff, 1.5, { intensity: 0.9 }); aura.position.set(0, 0.72, 0); sword.userData.aura = aura; g.add(aura);
    const core = billboard(glintTexture(), 0xe0f0ff, 0.5); core.position.set(0, 0.35, 0); g.add(core);
    const halo = mesh(geo('halo', () => new THREE.RingGeometry(0.34, 0.6, 32)), M.rune, 0, 0.37, 0, { rx: -Math.PI / 2, shadow: false });
    g.add(halo);
    const rune = new THREE.Mesh(geo('runePlane', () => new THREE.PlaneGeometry(1, 1)), new THREE.MeshBasicMaterial({ map: runeCircleTexture(), color: PALETTE.magic, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
    rune.rotation.x = -Math.PI / 2; rune.position.y = 0.09; rune.scale.setScalar(1.4); rune.renderOrder = 3; g.add(rune);
    g.add(groundGlow(0x9fb4ff, 0.9, { opacity: 0.5 }));
    const fog = getFog();
    if (fog) {
      const shaft = new THREE.Mesh(geo('swordShaft', () => new THREE.CylinderGeometry(0.16, 0.42, 3.2, 20, 1, true)), createShaftMaterial(fog, 0xa8c0ff, 0.5, [0, 0.25, 0.55, 1]));
      shaft.position.y = 1.7; shaft.renderOrder = 4; g.add(shaft); g.userData.shaft = shaft;
    }
    // orbiting motes on two tilted rings
    const motes = [];
    for (let i = 0; i < 8; i++) {
      const b = billboard(glintTexture(), i % 2 ? 0xc58cff : 0x9fd0ff, 0.14);
      b.userData.orbit = { r: 0.42 + (i % 2) * 0.12, tilt: i % 2 ? 0.55 : -0.4, phase: (i / 8) * Math.PI * 2, speed: i % 2 ? 1.3 : -0.9 };
      g.add(b); motes.push(b);
    }
    g.userData.anim = { y0: 0, amp: 0.05, speed: 1.4, spin: 0.9, t: 0, node: sword, halo, sword: true };
    animate(g, (dt, time, ctx) => {
      for (const b of motes) {
        const o = b.userData.orbit, a = time * o.speed + o.phase;
        b.position.set(Math.cos(a) * o.r, 0.85 + Math.sin(a) * o.r * o.tilt + 0.05 * Math.sin(time * 1.4), Math.sin(a) * o.r);
        const tw = 0.7 + 0.3 * Math.sin(time * 5 + o.phase * 3);
        b.scale.set(0.14 * tw, 0.14 * tw, 1);
      }
      const pulse = 0.85 + 0.15 * Math.sin(time * 2.1);
      aura.scale.set(1.5 * pulse, 1.5 * pulse, 1);
      core.scale.set(0.5 * (0.8 + 0.2 * Math.sin(time * 6.3)), 0.5 * (0.8 + 0.2 * Math.sin(time * 6.3)), 1);
      rune.rotation.z -= dt * 0.35; rune.material.opacity = 0.6 + 0.25 * Math.sin(time * 1.7);
      if (g.userData.shaft) g.userData.shaft.material.uniforms.uTime.value = time;
      if (ctx.emit) { g.userData.acc = (g.userData.acc || 0) + dt; while (g.userData.acc > 0.11) { g.userData.acc -= 0.11; ctx.emit({ x: g.position.x, y: 0.5, z: g.position.z, count: 1, color: [0x9fd0ff, 0xc58cff], speed: 0.25, spread: 1, up: 1.2, life: 1.6, size: 0.07, gravity: 0.35, drag: 0.6, radius: 0.4, kind: 2 }); } }
    });
    return g;
  }

  /** Sword geometry (blade up along +y, hilt at origin). */
  swordMesh(scale = 1) {
    const M = this.mats;
    const s = new THREE.Group();
    s.add(mesh(geo('blade', () => new THREE.BoxGeometry(0.075, 0.62, 0.022)), M.swordBlade, 0, 0.36, 0));
    s.add(mesh(geo('fuller', () => new THREE.BoxGeometry(0.02, 0.5, 0.026)), M.swordHilt, 0, 0.33, 0, { shadow: false }));
    s.add(mesh(geo('bladeTip', () => new THREE.ConeGeometry(0.053, 0.13, 4)), M.swordBlade, 0, 0.735, 0, { ry: Math.PI / 4 }));
    s.add(mesh(geo('guard', () => new THREE.BoxGeometry(0.24, 0.045, 0.055)), M.swordHilt, 0, 0.05, 0));
    s.add(mesh(geo('guardGem', () => new THREE.OctahedronGeometry(0.03, 0)), M.beacon, 0, 0.05, 0.03));
    s.add(mesh(geo('grip', () => new THREE.CylinderGeometry(0.026, 0.024, 0.16, 8)), M.leather, 0, -0.05, 0));
    s.add(mesh(geo('pommel', () => new THREE.SphereGeometry(0.038, 8, 8)), M.swordHilt, 0, -0.145, 0));
    s.scale.setScalar(scale);
    return s;
  }

  /** Healing potion: hand-pixelled flask, glowing liquid, cork and a catch-light glint. */
  potion(g) {
    g.add(pixelSprite('potion', ART.potion, PAL.potion, { glow: 0.2, emissive: 0xffb4a4 }));
    g.add(groundGlow(0xff5a48, 0.35, { opacity: 0.35 }));
    this.addGlints(g, 0xffd8d0, [[-0.1, 0.36, 0.03]], { size: 0.12, rate: 1.3 });
    this.finishGlints(g);
    g.userData.anim = { y0: 0.04, amp: 0.035, speed: 2.2, spin: 0, t: this.rng.float(0, 6) };
    return g;
  }

  /** Magic sack: violet cloth with a glowing sigil woven into it. */
  magicSack(g) {
    g.add(pixelSprite('magicSack', ART.magicSack, PAL.magicSack, { glow: 0.18, emissive: 0xc9a8ff }));
    const sig = billboard(sigilTexture('sack'), 0xd0b0ff, 0.26); sig.position.set(0, 0.22, 0.02); g.add(sig);
    g.add(groundGlow(0xb197fc, 0.36, { opacity: 0.3 }));
    this.addGlints(g, 0xe0d0ff, [[0.13, 0.3, 0.02], [-0.11, 0.14, 0.02]], { size: 0.12 });
    this.finishGlints(g);
    g.userData.anim = { y0: 0.04, amp: 0.03, speed: 1.8, spin: 0, t: this.rng.float(0, 6) };
    return g;
  }

  /** Treasure map: a rolled parchment tied with a red ribbon. */
  scroll(g) {
    g.add(pixelSprite('scroll', ART.scroll, PAL.scroll, { glow: 0.12 }));
    g.add(groundGlow(0xffe0a0, 0.3, { opacity: 0.22 }));
    g.userData.anim = { y0: 0.05, amp: 0.035, speed: 2, spin: 0, t: this.rng.float(0, 6) };
    return g;
  }

  /** Spellbook lying open: hand-pixelled cover in the spell's colour, with a sigil rising off the pages. */
  spellbook(g, type) {
    const c = SPELL_COLORS[type] || 0xffffff;
    g.add(pixelSprite('book:' + type, ART.book, bookPal(type), { glow: 0.15, emissive: c }));
    const pageGlow = billboard(glowTexture(), c, 0.22, { intensity: 0.4 }); pageGlow.position.set(0, 0.05, 0.02); g.add(pageGlow);
    const sig = billboard(sigilTexture(type), c, 0.26); sig.position.set(0, 0.5, 0.02); g.add(sig);
    g.add(groundGlow(c, 0.36, { opacity: 0.26 }));
    this.addGlints(g, 0xffffff, [[0.15, 0.14, 0.02], [-0.16, 0.14, 0.02], [0.02, 0.24, 0.02]], { size: 0.12 });
    this.finishGlints(g);
    const tick = g.userData.tick;
    animate(g, (dt, time, ctx, d) => {
      tick(dt, time, ctx, d);
      sig.position.y = 0.5 + 0.06 * Math.sin(time * 2.3 + g.userData.anim.t);
      const s = 0.26 * (0.9 + 0.1 * Math.sin(time * 4.1)); sig.scale.set(s, s, 1);
      const pg = 0.22 * (0.85 + 0.15 * Math.sin(time * 3.1 + 1)); pageGlow.scale.set(pg, pg, 1);
      if (ctx.emit && d < 9) { g.userData.acc = (g.userData.acc || 0) + dt; while (g.userData.acc > 0.3) { g.userData.acc -= 0.3; ctx.emit({ x: g.position.x, y: 0.12, z: g.position.z, count: 1, color: [c, 0xffffff], speed: 0.1, spread: 1, up: 0.9, life: 1.3, size: 0.06, gravity: 0.15, drag: 1, radius: 0.15, kind: 2 }); } }
    });
    g.userData.anim = { y0: 0.04, amp: 0.03, speed: 2, spin: 0, t: this.rng.float(0, 6) };
    return g;
  }

  enchantedWeapon(g) {
    g.add(pixelSprite('blade', ART.blade, PAL.blade, { glow: 0.2, emissive: 0x9fd0ff }));
    g.add(groundGlow(0x9fd0ff, 0.35, { opacity: 0.3 }));
    this.addGlints(g, 0xdff0ff, [[0.0, 0.5, 0.02]], { size: 0.16, rate: 2.2 });
    this.finishGlints(g);
    g.userData.anim = { y0: 0.05, amp: 0.045, speed: 2, spin: 0, t: 0 };
    return g;
  }

  beaconItem(g) {
    g.add(pixelSprite('crystal', ART.crystal, PAL.crystal, { glow: 0.4, emissive: 0x4bd66a, y: 0.16 }));
    const b = billboard(glowTexture(), 0x4bd66a, 0.7, { intensity: 0.8 }); b.position.y = 0.32; g.add(b);
    g.add(groundGlow(0x4bd66a, 0.35, { opacity: 0.35 }));
    g.userData.anim = { y0: 0.05, amp: 0.05, speed: 2.5, spin: 0, t: 0 };
    return g;
  }

  // ------------------------------------------------------------------ dungeon dressing
  /** Placed beacon marker. */
  beaconMarker() {
    const g = new THREE.Group();
    g.add(mesh(geo('beaconPole', () => new THREE.CylinderGeometry(0.03, 0.04, 0.6, 6)), this.mats.iron, 0, 0.3, 0));
    g.add(mesh(geo('crystal', () => new THREE.OctahedronGeometry(0.16, 0)), this.mats.beacon, 0, 0.75, 0));
    const b = billboard(glowTexture(), 0x4bd66a, 0.8, { intensity: 0.8 }); b.position.y = 0.75; g.add(b);
    g.add(groundGlow(0x4bd66a, 0.4, { opacity: 0.35 }));
    g.userData.anim = { y0: 0, amp: 0, speed: 0, spin: 1.5, t: 0, node: g.children[1] };
    return g;
  }

  /** Temple altar: marble steps, carved block, gold cross, candles with live flames and a holy haze. */
  altar() {
    const M = this.mats;
    const g = new THREE.Group();
    g.add(mesh(geo('altarStep', () => new THREE.BoxGeometry(0.96, 0.08, 0.96)), M.marble, 0, 0.04, 0));
    g.add(mesh(geo('altarStep2', () => new THREE.BoxGeometry(0.8, 0.06, 0.66)), M.marble, 0, 0.11, 0));
    g.add(mesh(geo('altarBase', () => new THREE.BoxGeometry(0.6, 0.34, 0.38)), M.marble, 0, 0.3, 0));
    g.add(mesh(geo('altarInset', () => new THREE.BoxGeometry(0.44, 0.2, 0.03)), M.gold, 0, 0.3, 0.19));
    g.add(mesh(geo('altarTop', () => new THREE.BoxGeometry(0.74, 0.06, 0.5)), M.marble, 0, 0.5, 0));
    g.add(mesh(geo('altarCloth', () => new THREE.BoxGeometry(0.5, 0.012, 0.56)), litMaterial('altarCloth', { color: 0x8a1c2c, roughness: 0.9 }), 0, 0.535, 0));
    // cross (refcard icon)
    g.add(mesh(geo('crossV', () => new THREE.BoxGeometry(0.06, 0.38, 0.06)), M.gold, 0, 0.73, 0));
    g.add(mesh(geo('crossH', () => new THREE.BoxGeometry(0.22, 0.06, 0.06)), M.gold, 0, 0.8, 0));
    const crossGlow = billboard(glowTexture(), 0xbfe6ff, 0.9, { intensity: 0.7 }); crossGlow.position.set(0, 0.78, 0); g.add(crossGlow);
    // candles
    for (const x of [-0.27, 0.27]) {
      g.add(mesh(geo('candleHolder', () => new THREE.CylinderGeometry(0.045, 0.06, 0.03, 8)), M.brass, x, 0.55, 0.13));
      g.add(mesh(geo('candle', () => new THREE.CylinderGeometry(0.03, 0.035, 0.15, 8)), M.candle, x, 0.64, 0.13));
      const fl = flame(0.085, 2.0); fl.position.set(x, 0.71, 0.13); g.add(fl);
      const gl = billboard(glowTexture(), 0xffb060, 0.2, { intensity: 0.45 }); gl.position.set(x, 0.76, 0.13); g.add(gl);
    }
    const glow = mesh(geo('altarGlow', () => new THREE.CylinderGeometry(0.5, 0.7, 1.4, 16, 1, true)), M.holyGlow, 0, 0.8, 0, { shadow: false });
    glow.userData.glow = true;
    g.add(glow);
    g.add(groundGlow(0xbfe6ff, 0.75, { opacity: 0.3, y: 0.085 }));
    animate(g, (dt, time) => { const s = 0.9 * (0.9 + 0.1 * Math.sin(time * 1.9)); crossGlow.scale.set(s, s, 1); });
    return g;
  }

  /** Wall torch: iron bracket, wrapped handle, layered flame billboards, ember glow, rising sparks. Faces +z. */
  torch() {
    const M = this.mats;
    const g = new THREE.Group();
    g.add(mesh(geo('torchPlate', () => new THREE.BoxGeometry(0.12, 0.16, 0.03)), M.iron, 0, 0, 0.015));
    g.add(mesh(geo('torchRing', () => new THREE.TorusGeometry(0.045, 0.012, 6, 12)), M.iron, 0, 0.1, 0.1, { rx: 0.5 }));
    g.add(mesh(geo('torchArm', () => new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6)), M.iron, 0, 0.04, 0.06, { rx: 1.1 }));
    g.add(mesh(geo('torchHandle', () => new THREE.CylinderGeometry(0.024, 0.02, 0.34, 7)), M.wood, 0, 0.1, 0.13, { rx: 0.5 }));
    g.add(mesh(geo('torchHead', () => new THREE.CylinderGeometry(0.04, 0.032, 0.1, 8)), M.dark, 0, 0.25, 0.21, { rx: 0.5 }));
    const f1 = flame(0.4, 1.8); f1.position.set(0, 0.27, 0.22); g.add(f1);
    const f2 = flame(0.24, 1.5); f2.position.set(0, 0.29, 0.225); g.add(f2);
    const ember = billboard(glowTexture(), 0xff7a2a, 0.55, { intensity: 0.9 }); ember.position.set(0, 0.33, 0.22); g.add(ember);
    animate(g, (dt, time, ctx, d) => {
      const s = 0.55 * (0.85 + 0.15 * Math.sin(time * 9.1 + g.position.x) * Math.sin(time * 5.7 + g.position.z));
      ember.scale.set(s, s, 1);
      if (!ctx.emit || d > 11) return;
      g.userData.acc = (g.userData.acc || 0) + dt;
      while (g.userData.acc > 0.28) {
        g.userData.acc -= 0.28;
        // DungeonView rotates the group to face its room: derive the facing from the yaw.
        const nx = Math.sin(g.rotation.y), nz = Math.cos(g.rotation.y);
        const wx = g.position.x + nx * 0.22, wz = g.position.z + nz * 0.22;
        ctx.emit({ x: wx, y: g.position.y + 0.32, z: wz, count: 1, color: [0xffb060, 0xff7a2a], speed: 0.25, spread: 0.6, up: 1.6, life: 1.1, size: 0.045, gravity: 0.4, drag: 1.2, radius: 0.06, kind: 1 });
      }
    });
    return g;
  }

  /** Doorway columns + lintel for staircases (the original's "III" columns). */
  archway(mat) {
    const g = new THREE.Group();
    for (const x of [-0.36, 0.36]) g.add(mesh(geo('column', () => new THREE.CylinderGeometry(0.07, 0.09, 0.95, 8)), mat, x, 0.47, 0));
    g.add(mesh(geo('lintel', () => new THREE.BoxGeometry(0.98, 0.12, 0.26)), mat, 0, 0.98, 0));
    return g;
  }

  rubble(seed) {
    const r = createRng(seed);
    const g = new THREE.Group();
    const rock = geo('rock', () => new THREE.DodecahedronGeometry(0.1, 0));
    for (let i = 0; i < 6; i++) {
      const m = mesh(rock, this.mats.rock, r.float(-0.3, 0.3), 0.05, r.float(-0.3, 0.3), { ry: r.float(0, 3), s: r.float(0.5, 1.4) });
      g.add(m);
    }
    return g;
  }

  trapRune() {
    const g = new THREE.Group();
    const ring = mesh(geo('runeRing', () => new THREE.RingGeometry(0.22, 0.3, 24)), this.mats.rune, 0, 0.012, 0, { rx: -Math.PI / 2, shadow: false });
    g.add(ring);
    const inner = mesh(geo('runeInner', () => new THREE.RingGeometry(0.08, 0.12, 6)), this.mats.rune, 0, 0.012, 0, { rx: -Math.PI / 2, shadow: false });
    g.add(inner);
    g.add(groundGlow(PALETTE.magic, 0.38, { opacity: 0.25 }));
    g.userData.anim = { y0: 0, amp: 0, speed: 0, spin: 1.2, t: 0, node: inner };
    return g;
  }

  climbMarker() {
    const g = new THREE.Group();
    g.add(mesh(geo('ropeRing', () => new THREE.TorusGeometry(0.34, 0.03, 6, 20)), this.mats.rope, 0, 0.03, 0, { rx: Math.PI / 2 }));
    return g;
  }
}

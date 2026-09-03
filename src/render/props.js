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
    const M = this.mats;
    const rich = Math.min(1, amount / 120);
    // sack: squashed sphere body with a pinched neck and a rope tie
    const body = mesh(geo('sack', () => new THREE.SphereGeometry(0.19, 12, 10)), M.sackCloth, 0, 0.17, -0.02);
    body.scale.set(1.05, 0.9, 1);
    g.add(body);
    g.add(mesh(geo('sackNeck', () => new THREE.CylinderGeometry(0.06, 0.12, 0.13, 8)), M.sackCloth, 0, 0.33, -0.02));
    g.add(mesh(geo('sackFlare', () => new THREE.ConeGeometry(0.075, 0.07, 8)), M.sackCloth, 0, 0.42, -0.02));
    g.add(mesh(geo('sackTie', () => new THREE.TorusGeometry(0.068, 0.018, 6, 12)), M.rope, 0, 0.35, -0.02, { rx: Math.PI / 2 }));
    // coin heap spilling out in front, plus stray coins around
    const coin = geo('coin', () => new THREE.CylinderGeometry(0.048, 0.048, 0.014, 12));
    const n = 9 + Math.round(rich * 8);
    const spots = [];
    for (let i = 0; i < n; i++) {
      const a = this.rng.float(-0.4, Math.PI + 0.4), r = this.rng.float(0.12, 0.3);
      const x = Math.cos(a) * r * 0.9, z = 0.08 + Math.sin(a) * r * 0.55;
      const y = 0.008 + (r < 0.2 ? this.rng.float(0, 0.045) : 0);
      const c = mesh(coin, M.gold, x, y, z, { ry: this.rng.float(0, 3), rx: this.rng.float(-0.35, 0.35), rz: this.rng.float(-0.35, 0.35) });
      g.add(c);
      if (i < 4) spots.push([x, y + 0.03, z]);
    }
    // a couple of coins peeking from the sack mouth
    g.add(mesh(coin, M.gold, 0.02, 0.44, -0.02, { rx: 0.9, ry: 0.4 }));
    g.add(mesh(coin, M.gold, -0.03, 0.46, -0.04, { rx: 1.2, ry: -0.6 }));
    spots.push([0.02, 0.48, 0.0]);
    g.add(groundGlow(0xffb340, 0.42, { opacity: 0.32 + rich * 0.15 }));
    this.addGlints(g, 0xfff0b0, spots, { size: 0.15 + rich * 0.05 });
    this.finishGlints(g);
    g.userData.anim.sparkle = true;
    return g;
  }

  buriedCache(g) {
    const M = this.mats;
    const mound = mesh(geo('mound', () => new THREE.SphereGeometry(0.24, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), M.dirt, 0, 0, 0);
    mound.scale.set(1.15, 0.42, 1);
    g.add(mound);
    const pebble = geo('pebble', () => new THREE.DodecahedronGeometry(0.035, 0));
    for (let i = 0; i < 5; i++) { const a = this.rng.float(0, 6.28), r = this.rng.float(0.18, 0.3); g.add(mesh(pebble, M.rim, Math.cos(a) * r, 0.02, Math.sin(a) * r, { ry: a, s: this.rng.float(0.6, 1.3) })); }
    const coin = geo('coin', () => new THREE.CylinderGeometry(0.048, 0.048, 0.014, 12));
    g.add(mesh(coin, M.gold, 0.08, 0.09, 0.05, { rx: 0.5 }));
    g.add(mesh(coin, M.gold, -0.1, 0.06, -0.03, { rx: -0.7, ry: 1 }));
    g.add(groundGlow(0xffb340, 0.3, { opacity: 0.18 }));
    this.addGlints(g, 0xfff0b0, [[0.08, 0.12, 0.05]], { size: 0.12, rate: 1.1 });
    this.finishGlints(g);
    return g;
  }

  /** Hidden treasure/trap square: a subtly different, inset checkered slab framed in brass. */
  trapSquare(g) {
    const M = this.mats;
    const slab = mesh(geo('trapSlab', () => new THREE.BoxGeometry(0.7, 0.04, 0.7)), litMaterial('trapChecker', { map: M.checker.map, color: 0x7e7668, roughness: 0.85 }), 0, 0.03, 0);
    g.add(slab);
    const frame = geo('trapFrame', () => new THREE.BoxGeometry(0.78, 0.03, 0.05));
    for (const [x, z, ry] of [[0, 0.365, 0], [0, -0.365, 0], [0.365, 0, Math.PI / 2], [-0.365, 0, Math.PI / 2]]) g.add(mesh(frame, M.brass, x, 0.035, z, { ry }));
    return g;
  }

  /** Closed chest: planked body, iron bands, curved lid, hinge and a gold lock. */
  chest(g) {
    const M = this.mats;
    g.add(mesh(geo('chestBase', () => new THREE.BoxGeometry(0.52, 0.26, 0.36)), M.wood, 0, 0.13, 0));
    const groove = geo('chestGroove', () => new THREE.BoxGeometry(0.53, 0.012, 0.37));
    for (const y of [0.07, 0.14, 0.21]) g.add(mesh(groove, M.dark, 0, y, 0, { shadow: false }));
    const lid = mesh(geo('chestLid', () => new THREE.CylinderGeometry(0.18, 0.18, 0.52, 10, 1, false, 0, Math.PI)), M.wood, 0, 0.26, 0, { rz: Math.PI / 2 });
    g.add(lid);
    g.userData.lid = lid;
    const band = geo('band', () => new THREE.BoxGeometry(0.54, 0.29, 0.05));
    for (const z of [-0.13, 0.13]) g.add(mesh(band, M.iron, 0, 0.14, z));
    const lidBand = geo('lidBand', () => new THREE.TorusGeometry(0.185, 0.022, 6, 12, Math.PI));
    for (const x of [-0.13, 0.13]) g.add(mesh(lidBand, M.iron, x, 0.26, 0, { ry: Math.PI / 2 }));
    g.add(mesh(geo('chestFoot', () => new THREE.BoxGeometry(0.56, 0.04, 0.4)), M.iron, 0, 0.02, 0));
    g.add(mesh(geo('lock', () => new THREE.BoxGeometry(0.08, 0.11, 0.035)), M.gold, 0, 0.19, 0.19));
    g.add(mesh(geo('lockHole', () => new THREE.BoxGeometry(0.02, 0.04, 0.02)), M.dark, 0, 0.18, 0.205, { shadow: false }));
    g.add(groundGlow(0xffb340, 0.45, { opacity: 0.22 }));
    if (!g.userData.glints) { this.addGlints(g, 0xfff0b0, [[0.02, 0.22, 0.21], [0.2, 0.36, 0.05]], { size: 0.13, rate: 1.2 }); this.finishGlints(g); }
    g.scale.setScalar(1.18);
    return g;
  }

  /** Open chest for the loot moment: lid thrown back, gold heaped inside, light spilling out. */
  chestOpen() {
    const g = new THREE.Group();
    this.chest(g);
    const lid = g.userData.lid;
    lid.position.set(0, 0.27, -0.18); lid.rotation.z = Math.PI / 2; lid.rotation.x = -1.9;
    const heap = mesh(geo('heap', () => new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), this.mats.gold, 0, 0.2, 0);
    heap.scale.set(1.1, 0.5, 0.75); g.add(heap);
    const inner = billboard(glowTexture(), 0xffc860, 0.9); inner.position.set(0, 0.42, 0); g.add(inner);
    g.userData.inner = inner;
    this.addGlints(g, 0xfff4c0, [[0.1, 0.32, 0.04], [-0.12, 0.3, -0.02], [0.02, 0.36, 0.1]], { size: 0.2, rate: 3 });
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

  /** Healing potion: round glass flask with glowing liquid, cork and a glint. */
  potion(g) {
    const M = this.mats;
    const glass = litMaterial('potionGlass', { color: 0xe8f0ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.45, depthWrite: false });
    const liquid = litMaterial('potionLiquid', { color: 0xff2a2a, roughness: 0.3, emissive: 0xff2010, emissiveIntensity: 0.9, transparent: true, opacity: 0.92 });
    const liq = mesh(geo('liquid', () => new THREE.SphereGeometry(0.115, 12, 10)), liquid, 0, 0.12, 0);
    liq.scale.set(1, 0.72, 1); g.add(liq);
    g.add(mesh(geo('flask', () => new THREE.SphereGeometry(0.155, 14, 12)), glass, 0, 0.165, 0));
    g.add(mesh(geo('flaskNeck', () => new THREE.CylinderGeometry(0.045, 0.065, 0.13, 10)), glass, 0, 0.3, 0));
    g.add(mesh(geo('flaskLip', () => new THREE.TorusGeometry(0.05, 0.014, 6, 12)), glass, 0, 0.36, 0, { rx: Math.PI / 2 }));
    g.add(mesh(geo('cork', () => new THREE.CylinderGeometry(0.036, 0.04, 0.06, 8)), M.wood, 0, 0.385, 0));
    g.add(groundGlow(0xff5a48, 0.35, { opacity: 0.35 }));
    this.addGlints(g, 0xffd8d0, [[0.06, 0.24, 0.08]], { size: 0.12, rate: 1.3 });
    this.finishGlints(g);
    g.userData.anim = { y0: 0.05, amp: 0.04, speed: 2.2, spin: 1.2, t: this.rng.float(0, 6) };
    return g;
  }

  /** Magic sack: violet cloth with a glowing sigil. */
  magicSack(g) {
    const body = mesh(geo('sack', () => new THREE.SphereGeometry(0.19, 12, 10)), this.mats.magicSack, 0, 0.17, 0);
    body.scale.set(1.05, 0.9, 1); g.add(body);
    g.add(mesh(geo('sackNeck', () => new THREE.CylinderGeometry(0.06, 0.12, 0.13, 8)), this.mats.magicSack, 0, 0.33, 0));
    g.add(mesh(geo('sackTie', () => new THREE.TorusGeometry(0.068, 0.018, 6, 12)), this.mats.gold, 0, 0.35, 0, { rx: Math.PI / 2 }));
    const sig = billboard(sigilTexture('sack'), 0xd0b0ff, 0.26); sig.position.set(0, 0.2, 0.19); g.add(sig);
    g.add(groundGlow(0xb197fc, 0.36, { opacity: 0.3 }));
    this.addGlints(g, 0xe0d0ff, [[0.12, 0.3, 0.1], [-0.1, 0.12, 0.14]], { size: 0.12 });
    this.finishGlints(g);
    g.userData.anim = { y0: 0.05, amp: 0.03, speed: 1.8, spin: 0.8, t: this.rng.float(0, 6) };
    return g;
  }

  /** Treasure map: parchment scroll with a ribbon. */
  scroll(g) {
    const M = this.mats;
    const roll = geo('scroll', () => new THREE.CylinderGeometry(0.06, 0.06, 0.36, 10));
    g.add(mesh(roll, M.parchment, 0, 0.12, 0, { rz: Math.PI / 2 }));
    g.add(mesh(geo('scrollInner', () => new THREE.CylinderGeometry(0.035, 0.035, 0.4, 8)), M.parchment, 0, 0.12, 0, { rz: Math.PI / 2 }));
    g.add(mesh(geo('scrollBand', () => new THREE.TorusGeometry(0.065, 0.014, 6, 12)), litMaterial('ribbon', { color: 0xa02020, roughness: 0.8 }), 0, 0.12, 0, { ry: Math.PI / 2 }));
    g.add(groundGlow(0xffe0a0, 0.3, { opacity: 0.22 }));
    g.userData.anim = { y0: 0.06, amp: 0.04, speed: 2, spin: 1.0, t: this.rng.float(0, 6) };
    return g;
  }

  /** Spellbook lying open: two angled cover halves with cream pages, a gold clasp, and a sigil rising from the pages. */
  spellbook(g, type) {
    const M = this.mats;
    const c = SPELL_COLORS[type] || 0xffffff;
    const cover = this.spellMaterial(type);
    const pages = litMaterial('pages', { color: 0xf1e6cc, roughness: 0.95 });
    const inkMat = litMaterial('ink:' + type, { color: 0x3a3028, roughness: 0.9, emissive: new THREE.Color(c), emissiveIntensity: 0.9 });
    const half = geo('bookHalfCover', () => new THREE.BoxGeometry(0.2, 0.02, 0.28));
    const halfPages = geo('bookHalfPages', () => new THREE.BoxGeometry(0.18, 0.05, 0.26));
    const tilt = 0.22;
    for (const s of [-1, 1]) {
      const h = new THREE.Group();
      h.position.set(s * 0.1, 0.02, 0); h.rotation.z = -s * tilt;
      h.add(mesh(half, cover, 0, 0, 0));
      h.add(mesh(halfPages, pages, 0, 0.035, 0));
      // lines of script on the page
      for (let i = 0; i < 4; i++) h.add(mesh(geo('inkLine', () => new THREE.BoxGeometry(0.12, 0.006, 0.014)), inkMat, 0, 0.063, -0.09 + i * 0.06, { shadow: false }));
      g.add(h);
    }
    g.add(mesh(geo('bookSpineOpen', () => new THREE.BoxGeometry(0.04, 0.03, 0.29)), cover, 0, 0.015, 0));
    g.add(mesh(geo('bookClaspOpen', () => new THREE.BoxGeometry(0.05, 0.02, 0.05)), M.gold, 0.19, 0.045, 0.1));
    g.add(mesh(geo('bookGem', () => new THREE.OctahedronGeometry(0.035, 0)), litMaterial('gem:' + type, { color: c, emissive: c, emissiveIntensity: 1.4, roughness: 0.2 }), 0, 0.045, 0));
    const pageGlow = billboard(glowTexture(), c, 0.55, { intensity: 0.7 }); pageGlow.position.set(0, 0.12, 0); g.add(pageGlow);
    const sig = billboard(sigilTexture(type), c, 0.34); sig.position.set(0, 0.42, 0); g.add(sig);
    g.add(groundGlow(c, 0.4, { opacity: 0.4 }));
    this.addGlints(g, 0xffffff, [[0.14, 0.12, 0.1], [-0.15, 0.12, -0.08], [0.02, 0.1, 0.12]], { size: 0.12 });
    this.finishGlints(g);
    const tick = g.userData.tick;
    animate(g, (dt, time, ctx, d) => {
      tick(dt, time, ctx, d);
      sig.position.y = 0.42 + 0.06 * Math.sin(time * 2.3 + g.userData.anim.t);
      const s = 0.34 * (0.9 + 0.1 * Math.sin(time * 4.1)); sig.scale.set(s, s, 1);
      const pg = 0.55 * (0.85 + 0.15 * Math.sin(time * 3.1 + 1)); pageGlow.scale.set(pg, pg, 1);
      if (ctx.emit && d < 9) { g.userData.acc = (g.userData.acc || 0) + dt; while (g.userData.acc > 0.3) { g.userData.acc -= 0.3; ctx.emit({ x: g.position.x, y: 0.12, z: g.position.z, count: 1, color: [c, 0xffffff], speed: 0.1, spread: 1, up: 0.9, life: 1.3, size: 0.06, gravity: 0.15, drag: 1, radius: 0.15, kind: 2 }); } }
    });
    g.userData.anim = { y0: 0.05, amp: 0.035, speed: 2, spin: 0.6, t: this.rng.float(0, 6) };
    return g;
  }

  enchantedWeapon(g) {
    const s = this.swordMesh(0.7);
    s.position.y = 0.2; s.rotation.z = 0.8;
    g.add(s);
    g.add(groundGlow(0x9fd0ff, 0.35, { opacity: 0.3 }));
    g.userData.anim = { y0: 0.05, amp: 0.05, speed: 2, spin: 1.5, t: 0 };
    return g;
  }

  beaconItem(g) {
    g.add(mesh(geo('crystal', () => new THREE.OctahedronGeometry(0.16, 0)), this.mats.beacon, 0, 0.3, 0));
    const b = billboard(glowTexture(), 0x4bd66a, 0.7, { intensity: 0.8 }); b.position.y = 0.3; g.add(b);
    g.add(groundGlow(0x4bd66a, 0.35, { opacity: 0.35 }));
    g.userData.anim = { y0: 0.05, amp: 0.05, speed: 2.5, spin: 2, t: 0 };
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
      const m = mesh(rock, this.mats.rim, r.float(-0.3, 0.3), 0.05, r.float(-0.3, 0.3), { ry: r.float(0, 3), s: r.float(0.5, 1.4) });
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

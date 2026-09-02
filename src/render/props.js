// Prop meshes: items, treasure, the Sword, altar, torches, stair arches, pit rims, rubble, runes.
// All geometry is procedural. Props carry userData.anim for bob/spin (updated by DungeonView).
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { PALETTE } from './materials.js';

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

export class PropFactory {
  /**
   * @param {ReturnType<import('./materials.js').createMaterials>} mats
   */
  constructor(mats) {
    this.mats = mats;
    this.rng = createRng('fargoal-props');
    this.scrollMats = {};
  }

  spellMaterial(type) {
    if (!this.scrollMats[type]) {
      const colors = { teleport: 0x4ee1ff, shield: 0xffd43b, regeneration: 0x69db7c, invisibility: 0xb197fc, light: 0xfff3bf, drift: 0xe9ecef };
      const c = colors[type] || 0xffffff;
      const m = this.mats.parchment.clone();
      m.emissive = new THREE.Color(c); m.emissiveIntensity = 0.35;
      this.scrollMats[type] = m;
    }
    return this.scrollMats[type];
  }

  // ------------------------------------------------------------------ items
  /** Build a prop for an ItemInstance. */
  item(it) {
    const g = new THREE.Group();
    g.userData.anim = { y0: 0, amp: 0, speed: 0, spin: 0, t: this.rng.float(0, 6) };
    switch (it.type) {
      case 'gold': return it.hidden ? this.buriedCache(g) : this.goldSack(g);
      case 'chest': return it.hidden ? this.trapSquare(g) : this.chest(g);
      case 'sword': return this.swordInStone(g);
      case 'potion': return this.potion(g);
      case 'sack': return this.magicSack(g);
      case 'map': return this.scroll(g, this.mats.parchment);
      case 'enchant': return this.enchantedWeapon(g);
      case 'beacon': return this.beaconItem(g);
      default: return this.scroll(g, this.spellMaterial(it.type));
    }
  }

  goldSack(g) {
    const M = this.mats;
    const body = mesh(geo('sack', () => new THREE.SphereGeometry(0.2, 10, 8)), M.sackCloth, 0, 0.18, 0);
    body.scale.set(1, 0.95, 1);
    g.add(body);
    g.add(mesh(geo('sackNeck', () => new THREE.CylinderGeometry(0.07, 0.11, 0.12, 8)), M.sackCloth, 0, 0.36, 0));
    g.add(mesh(geo('sackTie', () => new THREE.TorusGeometry(0.075, 0.02, 6, 10)), M.rope, 0, 0.34, 0, { rx: Math.PI / 2 }));
    // spilled coins
    const coin = geo('coin', () => new THREE.CylinderGeometry(0.045, 0.045, 0.015, 10));
    for (let i = 0; i < 5; i++) {
      const a = this.rng.float(0, Math.PI * 2), r = this.rng.float(0.2, 0.34);
      g.add(mesh(coin, M.gold, Math.cos(a) * r, 0.01, Math.sin(a) * r, { ry: this.rng.float(0, 3) }));
    }
    g.userData.anim.sparkle = true;
    return g;
  }

  buriedCache(g) {
    const M = this.mats;
    const mound = mesh(geo('mound', () => new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)), M.dirt, 0, 0.0, 0);
    mound.scale.set(1, 0.35, 1);
    g.add(mound);
    g.add(mesh(geo('coinB', () => new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10)), M.gold, 0.08, 0.1, 0.05, { rx: 0.4 }));
    return g;
  }

  trapSquare(g) {
    const slab = mesh(geo('slab', () => new THREE.BoxGeometry(0.82, 0.05, 0.82)), this.mats.checker, 0, 0.028, 0);
    g.add(slab);
    return g;
  }

  chest(g) {
    const M = this.mats;
    g.add(mesh(geo('chestBase', () => new THREE.BoxGeometry(0.5, 0.28, 0.34)), M.wood, 0, 0.14, 0));
    const lid = mesh(geo('chestLid', () => new THREE.CylinderGeometry(0.17, 0.17, 0.5, 8, 1, false, 0, Math.PI)), M.wood, 0, 0.28, 0, { rz: Math.PI / 2 });
    g.add(lid);
    for (const z of [-0.12, 0.12]) g.add(mesh(geo('band', () => new THREE.BoxGeometry(0.52, 0.3, 0.05)), M.brass, 0, 0.15, z));
    g.add(mesh(geo('lock', () => new THREE.BoxGeometry(0.08, 0.1, 0.04)), M.gold, 0, 0.2, 0.18));
    return g;
  }

  swordInStone(g) {
    const M = this.mats;
    const plinth = mesh(geo('plinth', () => new THREE.CylinderGeometry(0.28, 0.36, 0.22, 8)), M.marble, 0, 0.11, 0);
    g.add(plinth);
    const sword = this.swordMesh(1.0);
    sword.position.set(0, 0.55, 0); sword.rotation.z = Math.PI; sword.rotation.y = 0.5;
    g.add(sword);
    const halo = mesh(geo('halo', () => new THREE.RingGeometry(0.3, 0.55, 24)), M.rune, 0, 0.24, 0, { rx: -Math.PI / 2, shadow: false });
    g.add(halo);
    g.userData.anim = { y0: 0, amp: 0.04, speed: 1.4, spin: 0.9, t: 0, node: sword, halo, sword: true };
    return g;
  }

  /** Sword geometry (blade up along +y, hilt at origin). */
  swordMesh(scale = 1) {
    const M = this.mats;
    const s = new THREE.Group();
    s.add(mesh(geo('blade', () => new THREE.BoxGeometry(0.07, 0.62, 0.02)), M.swordBlade, 0, 0.36, 0));
    s.add(mesh(geo('bladeTip', () => new THREE.ConeGeometry(0.05, 0.12, 4)), M.swordBlade, 0, 0.73, 0, { ry: Math.PI / 4 }));
    s.add(mesh(geo('guard', () => new THREE.BoxGeometry(0.22, 0.04, 0.05)), M.swordHilt, 0, 0.05, 0));
    s.add(mesh(geo('grip', () => new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6)), M.leather, 0, -0.05, 0));
    s.add(mesh(geo('pommel', () => new THREE.SphereGeometry(0.035, 6, 6)), M.swordHilt, 0, -0.14, 0));
    s.scale.setScalar(scale);
    return s;
  }

  potion(g) {
    const M = this.mats;
    g.add(mesh(geo('flask', () => new THREE.SphereGeometry(0.14, 10, 8)), M.glass, 0, 0.15, 0));
    g.add(mesh(geo('flaskNeck', () => new THREE.CylinderGeometry(0.045, 0.06, 0.12, 8)), M.glass, 0, 0.3, 0));
    g.add(mesh(geo('cork', () => new THREE.CylinderGeometry(0.04, 0.04, 0.05, 8)), M.wood, 0, 0.38, 0));
    g.userData.anim = { y0: 0.05, amp: 0.04, speed: 2.2, spin: 1.2, t: this.rng.float(0, 6) };
    return g;
  }

  magicSack(g) {
    const body = mesh(geo('sack', () => new THREE.SphereGeometry(0.2, 10, 8)), this.mats.magicSack, 0, 0.18, 0);
    g.add(body);
    g.add(mesh(geo('sackNeck', () => new THREE.CylinderGeometry(0.07, 0.11, 0.12, 8)), this.mats.magicSack, 0, 0.36, 0));
    g.userData.anim = { y0: 0.05, amp: 0.03, speed: 1.8, spin: 0.8, t: this.rng.float(0, 6) };
    return g;
  }

  scroll(g, mat) {
    const roll = geo('scroll', () => new THREE.CylinderGeometry(0.06, 0.06, 0.34, 8));
    g.add(mesh(roll, mat, 0, 0.12, 0, { rz: Math.PI / 2 }));
    g.add(mesh(geo('scrollBand', () => new THREE.TorusGeometry(0.065, 0.015, 6, 10)), this.mats.brass, 0, 0.12, 0, { ry: Math.PI / 2 }));
    g.userData.anim = { y0: 0.06, amp: 0.04, speed: 2, spin: 1.0, t: this.rng.float(0, 6) };
    return g;
  }

  enchantedWeapon(g) {
    const s = this.swordMesh(0.7);
    s.position.y = 0.2; s.rotation.z = 0.8;
    g.add(s);
    g.userData.anim = { y0: 0.05, amp: 0.05, speed: 2, spin: 1.5, t: 0 };
    return g;
  }

  beaconItem(g) {
    g.add(mesh(geo('crystal', () => new THREE.OctahedronGeometry(0.16, 0)), this.mats.beacon, 0, 0.3, 0));
    g.userData.anim = { y0: 0.05, amp: 0.05, speed: 2.5, spin: 2, t: 0 };
    return g;
  }

  // ------------------------------------------------------------------ dungeon dressing
  /** Placed beacon marker. */
  beaconMarker() {
    const g = new THREE.Group();
    g.add(mesh(geo('beaconPole', () => new THREE.CylinderGeometry(0.03, 0.04, 0.6, 6)), this.mats.iron, 0, 0.3, 0));
    g.add(mesh(geo('crystal', () => new THREE.OctahedronGeometry(0.16, 0)), this.mats.beacon, 0, 0.75, 0));
    g.userData.anim = { y0: 0, amp: 0, speed: 0, spin: 1.5, t: 0, node: g.children[1] };
    return g;
  }

  altar() {
    const M = this.mats;
    const g = new THREE.Group();
    g.add(mesh(geo('altarStep', () => new THREE.BoxGeometry(0.96, 0.08, 0.96)), M.marble, 0, 0.04, 0));
    g.add(mesh(geo('altarBase', () => new THREE.BoxGeometry(0.62, 0.36, 0.4)), M.marble, 0, 0.26, 0));
    g.add(mesh(geo('altarTop', () => new THREE.BoxGeometry(0.72, 0.06, 0.5)), M.marble, 0, 0.47, 0));
    // cross (refcard icon)
    g.add(mesh(geo('crossV', () => new THREE.BoxGeometry(0.06, 0.36, 0.06)), M.gold, 0, 0.68, 0));
    g.add(mesh(geo('crossH', () => new THREE.BoxGeometry(0.2, 0.06, 0.06)), M.gold, 0, 0.74, 0));
    // candles
    for (const x of [-0.26, 0.26]) {
      g.add(mesh(geo('candle', () => new THREE.CylinderGeometry(0.03, 0.035, 0.14, 6)), M.candle, x, 0.57, 0.12));
      const fl = mesh(geo('candleFlame', () => new THREE.ConeGeometry(0.025, 0.07, 6)), M.flame, x, 0.68, 0.12, { shadow: false });
      fl.userData.flame = true;
      g.add(fl);
    }
    const glow = mesh(geo('altarGlow', () => new THREE.CylinderGeometry(0.5, 0.7, 1.4, 16, 1, true)), M.holyGlow, 0, 0.8, 0, { shadow: false });
    glow.userData.glow = true;
    g.add(glow);
    return g;
  }

  /** Wall torch: bracket, handle, flame. Faces +z by default (rotate by spot normal). */
  torch() {
    const M = this.mats;
    const g = new THREE.Group();
    g.add(mesh(geo('torchBracket', () => new THREE.BoxGeometry(0.1, 0.14, 0.06)), M.iron, 0, 0, 0.03));
    g.add(mesh(geo('torchHandle', () => new THREE.CylinderGeometry(0.025, 0.02, 0.32, 6)), M.wood, 0, 0.1, 0.12, { rx: 0.5 }));
    const fl = mesh(geo('torchFlame', () => new THREE.ConeGeometry(0.07, 0.2, 7)), M.flame, 0, 0.32, 0.2, { shadow: false });
    fl.userData.flame = true;
    g.add(fl);
    const ember = mesh(geo('torchEmber', () => new THREE.SphereGeometry(0.05, 6, 6)), M.flame, 0, 0.25, 0.2, { shadow: false });
    g.add(ember);
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
    g.userData.anim = { y0: 0, amp: 0, speed: 0, spin: 1.2, t: 0, node: inner };
    return g;
  }

  climbMarker() {
    const g = new THREE.Group();
    g.add(mesh(geo('ropeRing', () => new THREE.TorusGeometry(0.34, 0.03, 6, 20)), this.mats.rope, 0, 0.03, 0, { rx: Math.PI / 2 }));
    return g;
  }
}

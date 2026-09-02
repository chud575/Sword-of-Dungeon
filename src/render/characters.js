// CharacterFactory: procedural low-poly meshes for the player and every monster, on a shared rig
// (root > body > head/arms/wings/tail, root > legs) with vertex-coloured merged geometry per node,
// plus procedural animation (idle breathe, walk bob, attack lunge, hurt flash, death collapse, spawn).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCharacterMaterial } from './materials.js';

const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

/** Collects coloured geometry into named rig nodes. */
class RigBuilder {
  constructor() { this.nodes = new Map(); this.order = []; }
  /** Declare a node (pivot) with a parent and local position. */
  node(name, { parent = null, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) {
    if (!this.nodes.has(name)) { this.nodes.set(name, { name, parent, pos: [x, y, z], rot: [rx, ry, rz], geos: [] }); this.order.push(name); }
    return this;
  }
  /** Add geometry (in node-local space) with a colour. */
  add(node, g, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
    if (!this.nodes.has(node)) this.node(node);
    const geom = g.index ? g.toNonIndexed() : g.clone();
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _v.set(x, y, z); _s.set(sx, sy, sz);
    _m.compose(_v, _q, _s);
    geom.applyMatrix4(_m);
    const c = new THREE.Color(color);
    const n = geom.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(geom.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color' && k !== 'uv') geom.deleteAttribute(k);
    this.nodes.get(node).geos.push(geom);
    return this;
  }
}

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.5, 8, 6),
  lowSphere: new THREE.SphereGeometry(0.5, 6, 4),
  cone: new THREE.ConeGeometry(0.5, 1, 6),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 7),
  tcyl: new THREE.CylinderGeometry(0.35, 0.5, 1, 7),
  tet: new THREE.TetrahedronGeometry(0.5, 0),
  oct: new THREE.OctahedronGeometry(0.5, 0),
  wing: (() => { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.9, 0.35); s.lineTo(1.0, -0.15); s.lineTo(0.55, -0.35); s.lineTo(0.2, -0.28); s.lineTo(0, -0.1); return new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false }); })(),
};

// ------------------------------------------------------------------------------------------
// Builders. All in a 1-unit tile space; a size-1 humanoid is ~0.85 tall.

function eyes(B, y, z, spread, color = 0xffd05a, size = 0.035) {
  B.node('eyes', { parent: 'head' });
  B.add('eyes', G.box, color, { x: -spread, y, z, sx: size, sy: size * 0.7, sz: size * 0.6 });
  B.add('eyes', G.box, color, { x: spread, y, z, sx: size, sy: size * 0.7, sz: size * 0.6 });
}

/**
 * Shared humanoid. Options colour and dress the figure and choose a weapon/offhand.
 */
function humanoid(B, o) {
  const leg = o.legLen ?? 0.3, bodyH = o.bodyH ?? 0.32, bodyW = o.bodyW ?? 0.3, headR = o.headR ?? 0.11;
  const hip = leg, shoulderY = hip + bodyH * 0.92, armLen = o.armLen ?? 0.3;
  const skin = o.skin ?? 0xd9a77a, cloth = o.cloth ?? 0x6b4a2e, legs = o.legs ?? 0x3d2c1e, boots = o.boots ?? 0x2b1d12;
  B.node('root');
  B.node('legL', { parent: 'root', x: -bodyW * 0.28, y: hip, z: 0 });
  B.node('legR', { parent: 'root', x: bodyW * 0.28, y: hip, z: 0 });
  for (const n of ['legL', 'legR']) {
    B.add(n, G.box, legs, { y: -leg * 0.5, sx: bodyW * 0.3, sy: leg, sz: bodyW * 0.32 });
    B.add(n, G.box, boots, { y: -leg + 0.04, z: 0.03, sx: bodyW * 0.34, sy: 0.08, sz: bodyW * 0.42 });
  }
  B.node('body', { parent: 'root', y: hip });
  const hunch = o.hunch ?? 0;
  B.add('body', o.robe ? G.tcyl : G.box, cloth, { y: bodyH * 0.5, z: hunch * 0.05, sx: o.robe ? bodyW * 1.4 : bodyW, sy: bodyH, sz: o.robe ? bodyW * 1.2 : bodyW * 0.62 });
  if (o.robe) B.add('body', G.tcyl, cloth, { y: -leg * 0.45, sx: bodyW * 1.6, sy: leg * 0.95, sz: bodyW * 1.5 });
  if (o.belly) B.add('body', G.sphere, o.belly, { y: bodyH * 0.4, z: bodyW * 0.15, sx: bodyW * 1.1, sy: bodyH * 0.9, sz: bodyW * 0.8 });
  if (o.armor) B.add('body', G.box, o.armor, { y: bodyH * 0.6, sx: bodyW * 1.06, sy: bodyH * 0.6, sz: bodyW * 0.7 });
  if (o.belt) B.add('body', G.box, o.belt, { y: bodyH * 0.12, sx: bodyW * 1.04, sy: 0.05, sz: bodyW * 0.66 });
  if (o.shoulders) for (const sx of [-1, 1]) B.add('body', G.lowSphere, o.shoulders, { x: sx * bodyW * 0.55, y: shoulderY - hip, sx: 0.13, sy: 0.09, sz: 0.13 });
  if (o.cape) {
    B.add('body', G.box, o.cape, { y: bodyH * 0.35, z: -bodyW * 0.42, sx: bodyW * 1.05, sy: bodyH * 1.5, sz: 0.03, rx: 0.12 });
  }
  // head
  const headY = hip + bodyH + headR * 1.05 - hunch * 0.1;
  B.node('head', { parent: 'body', y: bodyH + headR * 0.2 - hunch * 0.1, z: hunch * 0.12 });
  const hy = headR * 0.85;
  if (o.hood) {
    B.add('head', G.cone, o.hood, { y: hy + headR * 0.3, sx: headR * 2.6, sy: headR * 2.6, sz: headR * 2.4 });
    B.add('head', G.box, 0x120c0a, { y: hy - headR * 0.1, z: headR * 0.5, sx: headR * 1.2, sy: headR * 0.9, sz: headR * 1.0 });
  } else {
    B.add('head', o.headShape === 'box' ? G.box : G.sphere, skin, { y: hy, sx: headR * 2, sy: headR * 2 * (o.headTall ?? 1), sz: headR * 2 });
  }
  if (o.hair) B.add('head', G.box, o.hair, { y: hy + headR * 0.5, z: -headR * 0.2, sx: headR * 2.1, sy: headR * 1.1, sz: headR * 1.8 });
  if (o.beard) B.add('head', G.box, o.beard, { y: hy - headR * 0.8, z: headR * 0.4, sx: headR * 1.6, sy: headR * 1.3, sz: headR * 1.1 });
  if (o.helmet) {
    B.add('head', G.sphere, o.helmet, { y: hy + headR * 0.25, sx: headR * 2.25, sy: headR * 2.0, sz: headR * 2.25 });
    B.add('head', G.box, o.helmet, { y: hy - headR * 0.2, z: headR * 0.9, sx: headR * 0.3, sy: headR * 1.2, sz: headR * 0.5 });
  }
  if (o.horns) for (const sx of [-1, 1]) B.add('head', G.cone, o.horns, { x: sx * headR * 0.9, y: hy + headR * 0.9, rz: -sx * 0.7, sx: headR * 0.5, sy: headR * 1.6, sz: headR * 0.5 });
  if (o.plume) B.add('head', G.box, o.plume, { y: hy + headR * 1.35, z: -headR * 0.3, sx: headR * 0.4, sy: headR * 0.9, sz: headR * 1.8 });
  if (o.hat) { B.add('head', G.cone, o.hat, { y: hy + headR * 1.3, sx: headR * 1.9, sy: headR * 2.6, sz: headR * 1.9, rz: 0.15 }); B.add('head', G.cyl, o.hat, { y: hy + headR * 0.55, sx: headR * 3.2, sy: 0.02, sz: headR * 3.2 }); }
  if (o.ears) for (const sx of [-1, 1]) B.add('head', G.cone, skin, { x: sx * headR * 1.1, y: hy + headR * 0.2, rz: -sx * 1.6, sx: headR * 0.5, sy: headR * 1.2, sz: headR * 0.3 });
  if (o.nose) B.add('head', G.cone, skin, { y: hy - headR * 0.1, z: headR * 1.1, rx: 1.5, sx: headR * 0.5, sy: headR * 0.9, sz: headR * 0.5 });
  if (o.tusks) for (const sx of [-1, 1]) B.add('head', G.cone, 0xf0e6c8, { x: sx * headR * 0.5, y: hy - headR * 0.6, z: headR * 0.8, sx: 0.03, sy: 0.08, sz: 0.03 });
  if (o.eyes !== false) eyes(B, hy + headR * 0.1, headR * 0.95, headR * 0.4, o.eyeColor ?? 0xfff2c8, o.eyeSize ?? 0.03);
  // arms
  for (const [n, sx] of [['armL', -1], ['armR', 1]]) {
    B.node(n, { parent: 'body', x: sx * (bodyW * 0.62), y: shoulderY - hip });
    B.add(n, G.box, o.sleeves ?? skin, { y: -armLen * 0.5, sx: bodyW * 0.26, sy: armLen, sz: bodyW * 0.26 });
    B.add(n, G.box, skin, { y: -armLen + 0.02, sx: bodyW * 0.28, sy: 0.07, sz: bodyW * 0.3 });
  }
  const hand = -armLen;
  weapon(B, 'armR', o.weapon, hand, o);
  offhand(B, 'armL', o.offhand, hand, o);
  void headY;
}

function weapon(B, node, type, hand, o) {
  const steel = 0xc9ced4, wood = 0x6b4426, dark = 0x2a2a30;
  const up = o.weaponPose === 'raised' ? -1 : 1; // raised arms hold the blade beyond the hand
  switch (type) {
    case 'sword': {
      B.add(node, G.box, wood, { y: hand, z: 0.04, sx: 0.03, sy: 0.16, sz: 0.03 });
      B.add(node, G.box, o.guard ?? 0xb08d3c, { y: hand + up * 0.08, z: 0.04, sx: 0.16, sy: 0.03, sz: 0.04 });
      B.add(node, G.box, o.blade ?? steel, { y: hand + up * 0.32, z: 0.04, sx: 0.05, sy: 0.46, sz: 0.018 });
      B.add(node, G.cone, o.blade ?? steel, { y: hand + up * 0.58, z: 0.04, sx: 0.05, sy: 0.08, sz: 0.018, rx: up < 0 ? Math.PI : 0 });
      break;
    }
    case 'greatsword': {
      B.add(node, G.box, wood, { y: hand, z: 0.05, sx: 0.035, sy: 0.22, sz: 0.035 });
      B.add(node, G.box, 0x555a66, { y: hand + 0.1, z: 0.05, sx: 0.22, sy: 0.035, sz: 0.05 });
      B.add(node, G.box, o.blade ?? 0x8d96a6, { y: hand + 0.42, z: 0.05, sx: 0.08, sy: 0.6, sz: 0.02 });
      B.add(node, G.cone, o.blade ?? 0x8d96a6, { y: hand + 0.77, z: 0.05, sx: 0.08, sy: 0.1, sz: 0.02 });
      break;
    }
    case 'axe': {
      B.add(node, G.cyl, wood, { y: hand + 0.12, z: 0.04, sx: 0.03, sy: 0.6, sz: 0.03 });
      B.add(node, G.box, steel, { x: 0.08, y: hand + 0.36, z: 0.04, sx: 0.16, sy: 0.18, sz: 0.02 });
      B.add(node, G.box, steel, { x: -0.08, y: hand + 0.36, z: 0.04, sx: 0.16, sy: 0.18, sz: 0.02 });
      break;
    }
    case 'hammer': {
      B.add(node, G.cyl, wood, { y: hand + 0.12, z: 0.04, sx: 0.03, sy: 0.5, sz: 0.03 });
      B.add(node, G.box, steel, { y: hand + 0.35, z: 0.04, sx: 0.2, sy: 0.12, sz: 0.1 });
      break;
    }
    case 'club': {
      B.add(node, G.tcyl, 0x5a3a22, { y: hand + 0.25, z: 0.05, sx: 0.12, sy: 0.55, sz: 0.12, rx: Math.PI });
      B.add(node, G.oct, 0x3a2a1a, { y: hand + 0.5, z: 0.05, sx: 0.16, sy: 0.16, sz: 0.16 });
      break;
    }
    case 'spear': {
      B.add(node, G.cyl, wood, { y: hand + 0.2, z: 0.04, sx: 0.025, sy: 0.9, sz: 0.025 });
      B.add(node, G.cone, steel, { y: hand + 0.72, z: 0.04, sx: 0.06, sy: 0.16, sz: 0.03 });
      break;
    }
    case 'staff': {
      B.add(node, G.cyl, wood, { y: hand + 0.2, z: 0.04, sx: 0.03, sy: 0.95, sz: 0.03 });
      if (o.orb) B.add(node, G.oct, o.orb, { y: hand + 0.72, z: 0.04, sx: 0.12, sy: 0.12, sz: 0.12 });
      break;
    }
    case 'dagger': {
      B.add(node, G.box, dark, { y: hand, z: 0.04, sx: 0.03, sy: 0.1, sz: 0.03 });
      B.add(node, G.box, steel, { y: hand + 0.14, z: 0.04, sx: 0.035, sy: 0.2, sz: 0.015 });
      B.add(node, G.cone, steel, { y: hand + 0.27, z: 0.04, sx: 0.035, sy: 0.06, sz: 0.015 });
      break;
    }
    case 'bow': break;
    default: break;
  }
}

function offhand(B, node, type, hand, o) {
  const steel = 0xc9ced4, wood = 0x6b4426;
  switch (type) {
    case 'shield':
      B.add(node, G.cyl, o.shieldColor ?? 0x8a5a2b, { y: hand + 0.14, z: 0.09, sx: 0.28, sy: 0.03, sz: 0.28, rx: Math.PI / 2 });
      B.add(node, G.lowSphere, steel, { y: hand + 0.14, z: 0.11, sx: 0.08, sy: 0.08, sz: 0.05 });
      break;
    case 'towershield':
      B.add(node, G.box, o.shieldColor ?? 0x6c1f1f, { y: hand + 0.2, z: 0.09, sx: 0.3, sy: 0.5, sz: 0.03 });
      B.add(node, G.box, 0xb08d3c, { y: hand + 0.2, z: 0.11, sx: 0.05, sy: 0.4, sz: 0.02 });
      break;
    case 'dagger':
      B.add(node, G.box, 0x2a2a30, { y: hand, z: 0.04, sx: 0.03, sy: 0.1, sz: 0.03 });
      B.add(node, G.box, steel, { y: hand + 0.14, z: 0.04, sx: 0.035, sy: 0.2, sz: 0.015 });
      break;
    case 'bow':
      B.add(node, G.cyl, wood, { y: hand + 0.1, z: 0.06, sx: 0.025, sy: 0.7, sz: 0.025 });
      B.add(node, G.box, 0xdddddd, { y: hand + 0.1, z: 0.1, sx: 0.006, sy: 0.66, sz: 0.006 });
      break;
    case 'torch':
      B.add(node, G.cyl, wood, { y: hand + 0.1, z: 0.04, sx: 0.03, sy: 0.3, sz: 0.03 });
      break;
    default: break;
  }
}

/** Four-legged beast. */
function quadruped(B, o) {
  const fur = o.fur ?? 0x6e6a66, len = o.len ?? 0.7, h = o.h ?? 0.32, w = o.w ?? 0.26, legH = o.legH ?? 0.22;
  B.node('root');
  const hip = legH;
  B.node('body', { parent: 'root', y: hip });
  B.add('body', G.box, fur, { y: h * 0.45, sx: w, sy: h * 0.8, sz: len });
  B.add('body', G.box, o.belly ?? fur, { y: h * 0.15, sx: w * 0.8, sy: h * 0.4, sz: len * 0.8 });
  if (o.mane) B.add('body', G.box, o.mane, { y: h * 0.75, z: len * 0.2, sx: w * 1.15, sy: h * 0.45, sz: len * 0.35 });
  if (o.spikes) for (let i = 0; i < 4; i++) B.add('body', G.cone, o.spikes, { y: h * 0.9, z: len * 0.3 - i * len * 0.2, sx: 0.05, sy: 0.1, sz: 0.05 });
  B.node('head', { parent: 'body', y: h * 0.75, z: len * 0.5 });
  const hs = o.headSize ?? 0.2;
  B.add('head', G.box, fur, { y: hs * 0.2, z: hs * 0.3, sx: hs, sy: hs * 0.85, sz: hs });
  B.add('head', G.box, o.snout ?? fur, { y: hs * 0.05, z: hs * 0.85, sx: hs * 0.6, sy: hs * 0.5, sz: hs * 0.7 });
  B.add('head', G.box, 0x1a1010, { y: hs * 0.1, z: hs * 1.2, sx: hs * 0.25, sy: hs * 0.2, sz: hs * 0.15 });
  for (const sx of [-1, 1]) B.add('head', G.cone, fur, { x: sx * hs * 0.35, y: hs * 0.7, z: 0, sx: hs * 0.3, sy: hs * 0.45, sz: hs * 0.2 });
  if (o.teeth) for (const sx of [-1, 1]) B.add('head', G.cone, 0xf0e6c8, { x: sx * hs * 0.2, y: -hs * 0.15, z: hs * 1.0, rx: Math.PI, sx: 0.02, sy: 0.06, sz: 0.02 });
  eyes(B, hs * 0.3, hs * 0.75, hs * 0.25, o.eyeColor ?? 0xff5a3c, 0.03);
  const lx = w * 0.42, lz = len * 0.35;
  for (const [n, sx, z] of [['legFL', -1, lz], ['legFR', 1, lz], ['legBL', -1, -lz], ['legBR', 1, -lz]]) {
    B.node(n, { parent: 'root', x: sx * lx, y: hip, z });
    B.add(n, G.box, fur, { y: -legH * 0.5, sx: w * 0.3, sy: legH, sz: w * 0.34 });
    B.add(n, G.box, o.paws ?? 0x2a2320, { y: -legH + 0.03, z: 0.02, sx: w * 0.32, sy: 0.06, sz: w * 0.42 });
  }
  B.node('tail', { parent: 'body', y: h * 0.6, z: -len * 0.5 });
  B.add('tail', G.box, fur, { z: -0.15, y: 0.03, sx: 0.07, sy: 0.07, sz: 0.3, rx: -0.4 });
}

/** Winged serpent/dragon: long body, neck, wings, two legs, tail. */
function drake(B, o) {
  const scale = o.scale ?? 0x4f7a5a, belly = o.belly ?? 0xb9b08a, len = o.len ?? 0.8;
  B.node('root');
  B.node('body', { parent: 'root', y: 0.32 });
  B.add('body', G.sphere, scale, { sx: 0.34, sy: 0.3, sz: len });
  B.add('body', G.sphere, belly, { y: -0.08, sx: 0.26, sy: 0.18, sz: len * 0.8 });
  for (let i = 0; i < 5; i++) B.add('body', G.cone, o.spine ?? scale, { y: 0.14, z: len * 0.35 - i * len * 0.17, sx: 0.05, sy: 0.12, sz: 0.06 });
  B.node('neck', { parent: 'body', y: 0.08, z: len * 0.42 });
  B.add('neck', G.cyl, scale, { y: 0.14, z: 0.06, sx: 0.16, sy: 0.32, sz: 0.16, rx: -0.5 });
  B.node('head', { parent: 'neck', y: 0.28, z: 0.14 });
  B.add('head', G.box, scale, { z: 0.06, sx: 0.18, sy: 0.14, sz: 0.24 });
  B.add('head', G.box, o.jaw ?? scale, { y: -0.06, z: 0.14, sx: 0.14, sy: 0.05, sz: 0.2 });
  for (const sx of [-1, 1]) B.add('head', G.cone, o.horn ?? 0x2a2a2a, { x: sx * 0.07, y: 0.08, z: -0.06, rx: -0.9, sx: 0.04, sy: 0.14, sz: 0.04 });
  if (o.fire) B.add('head', G.cone, o.fire, { y: -0.03, z: 0.3, rx: Math.PI / 2, sx: 0.08, sy: 0.16, sz: 0.06 });
  eyes(B, 0.03, 0.14, 0.07, o.eyeColor ?? 0xffb347, 0.03);
  for (const [n, sx] of [['wingL', -1], ['wingR', 1]]) {
    B.node(n, { parent: 'body', x: sx * 0.12, y: 0.1, z: 0.05 });
    B.add(n, G.wing, o.wing ?? scale, { rx: -Math.PI / 2, ry: sx < 0 ? Math.PI : 0, rz: 0, sx: o.wingSize ?? 0.75, sy: o.wingSize ?? 0.75, sz: 1 });
  }
  for (const [n, sx] of [['legL', -1], ['legR', 1]]) {
    B.node(n, { parent: 'root', x: sx * 0.14, y: 0.24, z: -0.05 });
    B.add(n, G.box, scale, { y: -0.1, sx: 0.09, sy: 0.22, sz: 0.1 });
    B.add(n, G.box, o.claw ?? 0x2a2a2a, { y: -0.2, z: 0.04, sx: 0.1, sy: 0.05, sz: 0.16 });
  }
  B.node('tail', { parent: 'body', y: -0.02, z: -len * 0.45 });
  B.add('tail', G.cone, scale, { z: -0.25, rx: -Math.PI / 2, sx: 0.14, sy: 0.55, sz: 0.1 });
}

function spider(B, o) {
  const chitin = o.chitin ?? 0x3a2550;
  B.node('root');
  B.node('body', { parent: 'root', y: 0.3 });
  B.add('body', G.sphere, chitin, { sx: 0.3, sy: 0.22, sz: 0.3 });
  B.add('body', G.sphere, o.abdomen ?? 0x4d2f6e, { z: -0.3, y: 0.04, sx: 0.44, sy: 0.36, sz: 0.5 });
  B.add('body', G.oct, o.mark ?? 0xb197fc, { z: -0.3, y: 0.22, sx: 0.12, sy: 0.05, sz: 0.2 });
  B.node('head', { parent: 'body', z: 0.16, y: 0.02 });
  B.add('head', G.sphere, chitin, { sx: 0.2, sy: 0.16, sz: 0.18 });
  for (const sx of [-1, 1]) B.add('head', G.cone, 0x1a1020, { x: sx * 0.06, y: -0.05, z: 0.1, rx: 1.2, sx: 0.04, sy: 0.12, sz: 0.04 });
  eyes(B, 0.04, 0.08, 0.05, 0xd0a0ff, 0.035);
  eyes(B, 0.07, 0.07, 0.09, 0xd0a0ff, 0.025);
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) {
    const n = `leg${i}${sx < 0 ? 'L' : 'R'}`;
    const z = 0.14 - i * 0.12;
    const spread = (i - 1.5) * 0.35;
    B.node(n, { parent: 'body', x: sx * 0.12, y: 0.02, z, ry: sx * spread });
    B.add(n, G.box, chitin, { x: sx * 0.16, y: 0.08, sx: 0.32, sy: 0.04, sz: 0.04, rz: sx * 0.5 });
    B.add(n, G.box, chitin, { x: sx * 0.38, y: -0.06, sx: 0.32, sy: 0.035, sz: 0.035, rz: -sx * 0.9 });
  }
}

/** Winged humanoid (gargoyle, demon). */
function winged(B, o) {
  humanoid(B, o);
  for (const [n, sx] of [['wingL', -1], ['wingR', 1]]) {
    B.node(n, { parent: 'body', x: sx * 0.1, y: (o.bodyH ?? 0.32) * 0.8, z: -0.1 });
    B.add(n, G.wing, o.wing ?? 0x555555, { rx: -Math.PI / 2, ry: sx < 0 ? Math.PI : 0, rz: sx * 0.3, sx: o.wingSize ?? 0.55, sy: o.wingSize ?? 0.55, sz: 1 });
  }
  if (o.tail) { B.node('tail', { parent: 'body', y: 0.05, z: -0.1 }); B.add('tail', G.cone, o.tail, { z: -0.2, y: -0.05, rx: -Math.PI / 2 - 0.4, sx: 0.06, sy: 0.4, sz: 0.06 }); }
}

const BUILDERS = {
  'player': (B) => humanoid(B, { skin: 0xe6c3a0, cloth: 0xb9bec7, legs: 0x4a4f5a, boots: 0x7a2a26, armor: 0xd5d9e0, belt: 0x5a3b23, shoulders: 0xc0c5cc, helmet: 0xd5d9e0, plume: 0xd0322a, cape: 0x8a1e1e, eyeColor: 0xfff6e0, weapon: 'sword', weaponPose: 'raised', blade: 0xb9c3cf, guard: 0xe8c15a, offhand: 'shield', shieldColor: 0x2f3f7a, sleeves: 0xb9bec7 }),
  'dire-wolf': (B) => quadruped(B, { fur: 0x5b5654, belly: 0x8b8580, snout: 0x4a4644, len: 0.72, h: 0.3, w: 0.26, teeth: true, eyeColor: 0xff4a2a, mane: 0x3f3a38 }),
  'ogre': (B) => humanoid(B, { skin: 0x8fa062, cloth: 0x5a3b23, legs: 0x5a3b23, bodyW: 0.46, bodyH: 0.42, legLen: 0.3, headR: 0.1, belly: 0x9fb072, tusks: true, weapon: 'club', armLen: 0.38, eyeColor: 0xffe08a, hair: 0x3a2a1a }),
  'hobgoblin': (B) => humanoid(B, { skin: 0xc8803c, cloth: 0x4a4a3a, legs: 0x3a3a2a, bodyW: 0.26, bodyH: 0.26, legLen: 0.24, headR: 0.11, ears: true, nose: true, weapon: 'spear', eyeColor: 0xffe08a }),
  'werebear': (B) => humanoid(B, { skin: 0x5a3a22, cloth: 0x5a3a22, legs: 0x4a2e1a, boots: 0x2a1a10, bodyW: 0.48, bodyH: 0.42, legLen: 0.28, headR: 0.13, hunch: 1, ears: true, nose: true, armLen: 0.4, eyeColor: 0xffb347, sleeves: 0x5a3a22, headShape: 'box' }),
  'gargoyle': (B) => winged(B, { skin: 0x6e6e74, cloth: 0x6e6e74, legs: 0x5e5e64, boots: 0x4e4e54, bodyW: 0.32, bodyH: 0.32, horns: 0x4a4a50, ears: true, hunch: 0.6, eyeColor: 0xffd05a, sleeves: 0x6e6e74, wing: 0x5a5a60, wingSize: 0.6 }),
  'troll': (B) => humanoid(B, { skin: 0x5d7a3a, cloth: 0x3f4a2a, legs: 0x3a3a2a, bodyW: 0.4, bodyH: 0.44, legLen: 0.32, headR: 0.11, hunch: 1.2, nose: true, ears: true, armLen: 0.5, hair: 0x2a3a1a, eyeColor: 0xffe08a, sleeves: 0x5d7a3a, tusks: true }),
  'wyvern': (B) => drake(B, { scale: 0x4f7a5a, belly: 0xb9b08a, wing: 0x3e6048, spine: 0x2e4a34, len: 0.8, eyeColor: 0xffb347 }),
  'dimension-spider': (B) => spider(B, { chitin: 0x3a2550, abdomen: 0x4d2f6e, mark: 0xb197fc }),
  'shadow-dragon': (B) => drake(B, { scale: 0x2a2236, belly: 0x4a3d5c, wing: 0x1f1a2a, spine: 0x6a4fa0, horn: 0x8a6fd0, len: 0.95, wingSize: 0.95, eyeColor: 0xc58cff }),
  'fyre-drake': (B) => drake(B, { scale: 0xb03a1e, belly: 0xffb347, wing: 0x8a2a14, spine: 0xff7a1a, horn: 0x3a1a10, fire: 0xffa030, len: 0.9, wingSize: 0.85, eyeColor: 0xffe060 }),
  'demon': (B) => winged(B, { skin: 0xa8281e, cloth: 0x5a1010, legs: 0x4a0e0e, boots: 0x2a0808, bodyW: 0.34, bodyH: 0.36, horns: 0x1a1010, tail: 0xa8281e, eyeColor: 0xffe060, eyeSize: 0.04, sleeves: 0xa8281e, wing: 0x3a0c0c, wingSize: 0.7, weapon: 'greatsword', blade: 0x3a1a1a }),
  'rogue': (B) => humanoid(B, { skin: 0xd9a77a, cloth: 0x3a3a44, legs: 0x2a2a34, hood: 0x3a3a44, weapon: 'dagger', offhand: 'dagger', bodyW: 0.26, eyeColor: 0xd0d0d0, belt: 0x5a3b23 }),
  'barbarian': (B) => humanoid(B, { skin: 0xd8a070, cloth: 0xd8a070, legs: 0x6b4a2e, boots: 0x3a2a1a, bodyW: 0.36, bodyH: 0.36, hair: 0x5a2a12, beard: 0x5a2a12, belt: 0x5a3b23, weapon: 'axe', eyeColor: 0xffffff }),
  'elvin-ranger': (B) => humanoid(B, { skin: 0xe8c9a5, cloth: 0x3f6b35, legs: 0x4a3a2a, hood: 0x3f6b35, cape: 0x2f5a2a, offhand: 'bow', weapon: 'dagger', bodyW: 0.26, bodyH: 0.34, legLen: 0.32, eyeColor: 0xc8ffd8 }),
  'dwarven-guard': (B) => humanoid(B, { skin: 0xd9a77a, cloth: 0x6e5a3a, legs: 0x3a3a3a, bodyW: 0.36, bodyH: 0.28, legLen: 0.2, headR: 0.11, beard: 0xc0662a, helmet: 0x8a8f96, weapon: 'hammer', offhand: 'shield', shieldColor: 0x8a5a2b, armor: 0x8a8f96, eyeColor: 0xffffff }),
  'mercenary': (B) => humanoid(B, { skin: 0xd9a77a, cloth: 0x6e6e74, legs: 0x3a3a3a, armor: 0x7a7f86, helmet: 0x7a7f86, weapon: 'sword', offhand: 'shield', shieldColor: 0x5a3b23, belt: 0x5a3b23, eyeColor: 0xffffff }),
  'swordsman': (B) => humanoid(B, { skin: 0xd9a77a, cloth: 0x8a2a2a, legs: 0x3a3a3a, armor: 0xb0b5bc, shoulders: 0xb0b5bc, weapon: 'sword', blade: 0xe0e6ee, belt: 0x5a3b23, hair: 0x2a1a10, eyeColor: 0xffffff }),
  'monk': (B) => humanoid(B, { skin: 0xd9a77a, cloth: 0xc47a2a, legs: 0xc47a2a, robe: true, belt: 0x5a3b23, weapon: 'staff', eyeColor: 0xffffff, sleeves: 0xc47a2a }),
  'dark-warrior': (B) => humanoid(B, { skin: 0x1a1a1e, cloth: 0x1e1e26, legs: 0x141418, armor: 0x2a2a34, shoulders: 0x2a2a34, helmet: 0x2a2a34, horns: 0x3a3a44, weapon: 'greatsword', blade: 0x6a6a80, cape: 0x3a0c14, eyeColor: 0xff3a2a, eyeSize: 0.04, sleeves: 0x1e1e26 }),
  'assassin': (B) => humanoid(B, { skin: 0x3a3438, cloth: 0x1e1a24, legs: 0x16121c, hood: 0x1e1a24, cape: 0x1e1a24, weapon: 'dagger', offhand: 'dagger', bodyW: 0.26, eyeColor: 0xb197fc, sleeves: 0x1e1a24 }),
  'war-lord': (B) => humanoid(B, { skin: 0xd9a77a, cloth: 0x6c1f1f, legs: 0x2a2a2a, bodyW: 0.4, bodyH: 0.4, legLen: 0.32, armor: 0xb08d3c, shoulders: 0xb08d3c, helmet: 0xb08d3c, horns: 0xe8dcc0, cape: 0x8a1e1e, weapon: 'greatsword', offhand: 'towershield', shieldColor: 0x6c1f1f, eyeColor: 0xffd05a }),
  'mage': (B) => humanoid(B, { skin: 0xd9a77a, cloth: 0x2f3f8a, legs: 0x2f3f8a, robe: true, hat: 0x2f3f8a, beard: 0xdddddd, weapon: 'staff', orb: 0x7fd4ff, belt: 0xb08d3c, eyeColor: 0x9fe0ff, sleeves: 0x2f3f8a }),
};

const ANIM_KIND = {
  'dire-wolf': 'quadruped', 'wyvern': 'drake', 'shadow-dragon': 'drake', 'fyre-drake': 'drake', 'dimension-spider': 'spider',
  'gargoyle': 'winged', 'demon': 'winged',
};

export class CharacterFactory {
  /** @param {import('./lighting.js').FogOfWar} fog */
  constructor(fog) {
    this.fog = fog;
    this.eyeMats = new Map();
    this.geoCache = new Map();
  }

  eyeMaterial(color) {
    const key = String(color);
    let m = this.eyeMats.get(key);
    if (!m) { m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }); m.color.setScalar(2.2); this.eyeMats.set(key, m); }
    return m;
  }

  /** Build (or reuse) merged geometry per node for a type. */
  rigGeometry(type) {
    let cached = this.geoCache.get(type);
    if (cached) return cached;
    const B = new RigBuilder();
    (BUILDERS[type] || BUILDERS.hobgoblin)(B);
    cached = B.order.map((name) => {
      const n = B.nodes.get(name);
      const geom = n.geos.length ? mergeGeometries(n.geos, false) : null;
      return { name, parent: n.parent, pos: n.pos, rot: n.rot, geom };
    });
    this.geoCache.set(type, cached);
    return cached;
  }

  /**
   * Create a character view for an entity.
   * @returns {{root:THREE.Group, nodes:Object<string,THREE.Object3D>, material:THREE.Material, kind:string, entity:object, anim:object}}
   */
  create(entity) {
    const type = entity.kind === 'player' ? 'player' : entity.type;
    const spec = this.rigGeometry(type);
    const material = createCharacterMaterial(this.fog);
    const nodes = {};
    const root = new THREE.Group();
    root.name = `char:${entity.id}`;
    nodes.root = root;
    for (const n of spec) {
      let obj = n.name === 'root' ? root : new THREE.Group();
      if (n.name !== 'root') {
        obj.position.set(n.pos[0], n.pos[1], n.pos[2]);
        obj.rotation.set(n.rot[0], n.rot[1], n.rot[2]);
        (nodes[n.parent] || root).add(obj);
      }
      obj.userData.rest = { pos: obj.position.clone(), rot: obj.rotation.clone() };
      if (n.geom) {
        const mesh = new THREE.Mesh(n.geom, n.name === 'eyes' ? this.eyeMaterial(0) : material);
        mesh.castShadow = n.name !== 'eyes'; mesh.receiveShadow = false;
        mesh.frustumCulled = false;
        obj.add(mesh);
      }
      nodes[n.name] = obj;
    }
    const size = (entity.size || 1) * 1.25;
    root.scale.setScalar(size);
    const kind = type === 'player' ? 'biped' : (ANIM_KIND[type] || 'biped');
    const view = {
      root, nodes, material, kind, entity, type, size,
      anim: { t: 0, walk: 0, attack: 0, attackDir: 0, hurt: 0, dead: 0, spawn: 0, flash: 0, moving: false, dying: false, done: false, angle: 0 },
      pos: new THREE.Vector3(entity.x, 0, entity.y), from: null, to: null, moveT: 1, moveDur: 0.2,
    };
    view.anim.angle = Math.atan2(entity.facing?.dx || 0, entity.facing?.dy || 1);
    root.rotation.y = view.anim.angle;
    root.position.copy(view.pos);
    if (type === 'player') {
      // hero pose: sword raised high to the right, shield forward
      nodes.armR.userData.rest.rot.set(-0.3, 0, -2.5);
      nodes.armL.userData.rest.rot.set(0.6, 0, 0.35);
    }
    return view;
  }

  /** Start a tile-to-tile move. */
  move(view, fromX, fromY, toX, toY, duration) {
    view.from = new THREE.Vector3(fromX, 0, fromY);
    view.to = new THREE.Vector3(toX, 0, toY);
    view.moveT = 0; view.moveDur = Math.max(0.05, duration);
    view.anim.moving = true;
    const dx = toX - fromX, dy = toY - fromY;
    if (dx || dy) view.anim.targetAngle = Math.atan2(dx, dy);
  }

  /** Snap the view to a tile (teleport/blink). */
  snap(view, x, y) { view.from = view.to = null; view.moveT = 1; view.pos.set(x, 0, y); }

  attack(view, dx, dy) { view.anim.attack = 0.0001; view.anim.attackDir = Math.atan2(dx, dy); view.anim.targetAngle = view.anim.attackDir; }
  hurt(view) { view.anim.hurt = 1; view.anim.flash = 1; }
  die(view) { view.anim.dying = true; view.anim.dead = 0; view.material.transparent = true; }
  spawn(view) { view.anim.spawn = 0.0001; }

  /**
   * Advance animation. ctx: {invisible:boolean, visibleToPlayer:boolean, time:number}
   */
  update(view, dt, ctx = {}) {
    const a = view.anim, n = view.nodes, e = view.entity;
    a.t += dt;
    // position interpolation
    if (view.from && view.to) {
      view.moveT = Math.min(1, view.moveT + dt / view.moveDur);
      const k = view.moveT;
      view.pos.lerpVectors(view.from, view.to, k);
      if (k >= 1) { view.from = view.to = null; }
    } else if (e) {
      // keep in sync when the game moved the entity without an event
      if (Math.abs(view.pos.x - e.x) > 1.5 || Math.abs(view.pos.z - e.y) > 1.5) view.pos.set(e.x, 0, e.y);
    }
    a.moving = !!(view.from && view.to);
    if (e) { e.px = view.pos.x; e.py = view.pos.z; }
    const wt = a.moving ? 1 : 0;
    a.walk += (wt - a.walk) * Math.min(1, dt * 14);
    // facing
    if (a.targetAngle === undefined && e && e.facing) a.targetAngle = Math.atan2(e.facing.dx, e.facing.dy);
    if (a.targetAngle !== undefined) {
      let d = a.targetAngle - a.angle;
      while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      a.angle += d * Math.min(1, dt * 16);
    }
    if (e && e.facing && !a.moving && a.attack <= 0) a.targetAngle = Math.atan2(e.facing.dx, e.facing.dy);
    const root = view.root;
    root.position.copy(view.pos);
    root.rotation.set(0, a.angle, 0);
    // reset nodes to rest
    for (const k in n) { if (k === 'root') continue; const o = n[k]; o.position.copy(o.userData.rest.pos); o.rotation.copy(o.userData.rest.rot); }
    const t = a.t, ph = t * 11;
    const breathe = Math.sin(t * 2.2) * 0.012;
    const w = a.walk;
    const bob = Math.abs(Math.sin(ph)) * 0.06 * w;
    switch (view.kind) {
      case 'biped': case 'winged': {
        n.body.position.y += breathe + bob;
        if (n.legL) { n.legL.rotation.x += Math.sin(ph) * 0.75 * w; n.legR.rotation.x += -Math.sin(ph) * 0.75 * w; }
        if (n.armL) { n.armL.rotation.x += -Math.sin(ph) * 0.5 * w; n.armR.rotation.x += Math.sin(ph) * 0.5 * w * (view.type === 'player' ? 0.2 : 1); }
        if (n.head) n.head.rotation.y += Math.sin(t * 0.7) * 0.08;
        if (n.wingL) { const f = Math.sin(t * 5) * 0.5 + 0.2; n.wingL.rotation.z += f; n.wingR.rotation.z -= f; n.body.position.y += Math.sin(t * 5) * 0.03 + 0.05; }
        if (n.tail) n.tail.rotation.y += Math.sin(t * 3) * 0.4;
        break;
      }
      case 'quadruped': {
        n.body.position.y += breathe + bob * 0.6;
        const s = Math.sin(ph) * 0.7 * w;
        n.legFL.rotation.x += s; n.legBR.rotation.x += s; n.legFR.rotation.x -= s; n.legBL.rotation.x -= s;
        n.head.rotation.x += Math.sin(t * 1.5) * 0.08 - w * 0.2;
        n.tail.rotation.y += Math.sin(t * 4) * 0.35;
        break;
      }
      case 'drake': {
        const f = Math.sin(t * 6);
        n.body.position.y += 0.12 + f * 0.05 + breathe;
        n.wingL.rotation.z += f * 0.6 + 0.2; n.wingR.rotation.z -= f * 0.6 + 0.2;
        n.neck.rotation.x += Math.sin(t * 1.3) * 0.1; n.head.rotation.y += Math.sin(t * 0.9) * 0.15;
        n.tail.rotation.y += Math.sin(t * 2.5) * 0.35;
        n.legL.rotation.x += 0.3 + w * 0.2; n.legR.rotation.x += 0.3 + w * 0.2;
        break;
      }
      case 'spider': {
        n.body.position.y += breathe * 2 + bob * 0.5;
        for (let i = 0; i < 4; i++) for (const sx of ['L', 'R']) {
          const leg = n[`leg${i}${sx}`];
          const phase = ph + i * 1.5 + (sx === 'L' ? 0 : Math.PI);
          leg.rotation.y += Math.sin(phase) * 0.25 * w;
          leg.rotation.z += Math.abs(Math.sin(phase)) * 0.2 * w * (sx === 'L' ? -1 : 1) + Math.sin(t * 3 + i) * 0.03;
        }
        break;
      }
      default: break;
    }
    // attack lunge
    if (a.attack > 0) {
      a.attack += dt / 0.32;
      const k = Math.min(1, a.attack);
      const lunge = Math.sin(k * Math.PI) * 0.32;
      root.position.x += Math.sin(a.attackDir) * lunge; root.position.z += Math.cos(a.attackDir) * lunge;
      const swing = k < 0.3 ? -k / 0.3 * 0.9 : k < 0.55 ? -0.9 + (k - 0.3) / 0.25 * 2.6 : 1.7 - (k - 0.55) / 0.45 * 1.7;
      if (n.armR) n.armR.rotation.x += swing;
      if (n.head) n.head.rotation.x += swing * 0.15;
      if (view.kind === 'quadruped' || view.kind === 'drake') { if (n.head) n.head.rotation.x += swing * 0.4; n.body.rotation.x += swing * 0.1; }
      if (view.kind === 'spider') n.body.rotation.x += -swing * 0.3;
      if (k >= 1) a.attack = 0;
    }
    // hurt recoil + flash
    if (a.hurt > 0) {
      a.hurt = Math.max(0, a.hurt - dt / 0.25);
      const r = Math.sin(a.hurt * Math.PI) * 0.12;
      root.position.x -= Math.sin(a.angle) * r; root.position.z -= Math.cos(a.angle) * r;
      if (n.body) n.body.rotation.x -= r * 1.5;
    }
    if (a.flash > 0) { a.flash = Math.max(0, a.flash - dt / 0.22); }
    view.material.emissive.setRGB(a.flash, a.flash * 0.35, a.flash * 0.25);
    view.material.emissiveIntensity = 1;
    // spawn rise
    if (a.spawn > 0) {
      a.spawn += dt / 0.45;
      const k = Math.min(1, a.spawn);
      root.scale.setScalar(view.size * (0.2 + 0.8 * k));
      root.position.y -= (1 - k) * 0.5;
      if (k >= 1) { a.spawn = 0; root.scale.setScalar(view.size); }
    }
    // death collapse + fade
    if (a.dying) {
      a.dead += dt;
      const k1 = Math.min(1, a.dead / 0.4);
      root.rotation.x = -k1 * k1 * Math.PI / 2;
      root.position.y += k1 * 0.12;
      if (a.dead > 0.35) {
        const k2 = Math.min(1, (a.dead - 0.35) / 0.6);
        view.material.opacity = 1 - k2;
        root.position.y -= k2 * 0.4;
        if (k2 >= 1) a.done = true;
      }
    }
    // invisibility shimmer
    if (ctx.invisible) {
      view.material.transparent = true;
      view.material.opacity = 0.32 + 0.1 * Math.sin(t * 9);
    } else if (!a.dying && view.material.transparent && view.material.opacity < 1) {
      view.material.opacity = 1; view.material.transparent = false;
    }
  }

  dispose(view) { view.material.dispose(); }
}

export { BUILDERS };

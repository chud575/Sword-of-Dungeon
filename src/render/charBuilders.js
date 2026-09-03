// Species builders: every character is assembled from the shared part library onto a named rig
// (root > legs > shins, root > body > head/eyes/arms > forearms/cape/wings/tail). Proportions are
// chunky and readable at the game camera (big heads, hands, feet and weapons), colours are
// blocked into a two-tone story per creature, and each species carries one glowing signature.
// Nodes whose name contains 'glow' (and 'eyes') are drawn with the emissive material.
import * as THREE from 'three';
import { P } from './charParts.js';

const C = {
  skin: 0xe0b088, skinPale: 0xe9cfb0, steel: 0xc4cad2, iron: 0x8a9098, darkIron: 0x4a4f58, gold: 0xd9a441,
  leather: 0x6a4328, darkLeather: 0x3a2618, wood: 0x7a4a26, bone: 0xefe6c9, black: 0x1a1418, cloth: 0x6b4a2e,
};

const _frame = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function frameAt(x, y, z, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _v.set(x, y, z); _s.set(1, 1, 1);
  return _frame.compose(_v, _q, _s).clone();
}

// ------------------------------------------------------------------------------------------
// Faces

/** Emissive eyes on a 'glow' child of head, plus dark sockets behind them for contrast. */
function eyes(B, o, hy, headR, { y = 0, z = 0.92, spread = 0.36, size = 0.032, color = 0xfff2c8, socket = true, node = 'head' } = {}) {
  const gn = `glow.${node}`;
  B.node(gn, { parent: node });
  const w = size * 1.15, h = size * (o.eyeSlit ? 0.45 : 0.8);
  B.both((sx) => {
    if (socket) B.add(node, P.box, 0x14100f, { x: sx * headR * spread, y: hy + headR * y, z: headR * z - 0.012, sx: w * 1.9, sy: h * 2.1, sz: 0.02, grad: 0 });
    B.add(gn, P.box, color, { x: sx * headR * spread, y: hy + headR * y, z: headR * z, sx: w, sy: h, sz: 0.02, grad: 0 });
  });
  if (o.brows) B.both((sx) => B.add(node, P.box, o.brows, { x: sx * headR * spread, y: hy + headR * (y + 0.32), z: headR * z, rz: -sx * 0.55, sx: w * 2.4, sy: h * 0.9, sz: 0.02, grad: 0 }));
}

function mouth(B, hy, headR, { z = 0.95, w = 0.5, y = -0.42, teeth = false, color = 0x2a1418, node = 'head' } = {}) {
  B.add(node, P.box, color, { y: hy + headR * y, z: headR * z, sx: headR * w, sy: headR * 0.14, sz: 0.02, grad: 0 });
  if (teeth) B.both((sx) => B.add(node, P.box, C.bone, { x: sx * headR * w * 0.32, y: hy + headR * (y + 0.1), z: headR * z, sx: headR * 0.12, sy: headR * 0.14, sz: 0.02, grad: 0 }));
}

// ------------------------------------------------------------------------------------------
// Weapons (authored with the grip at the origin, blade along +y) and off-hand gear.

function weapon(B, node, type, hand, o = {}) {
  const rx = o.weaponGrip === 'extend' ? Math.PI : Math.PI / 2 - (o.weaponPitch ?? 0.15); // 'grip' points the blade forward of the fist
  const f = frameAt(0, hand, 0.01, rx, 0, 0);
  const A = (g, color, opts) => B.add(node, g, color, { ...opts, frame: f });
  const steel = o.blade ?? C.steel, wood = C.wood, grip = 0x2c1d14;
  switch (type) {
    case 'sword': {
      A(P.cyl6, grip, { y: 0.06, sx: 0.045, sy: 0.14, sz: 0.045 });
      A(P.oct, o.guard ?? C.gold, { y: -0.02, sx: 0.06, sy: 0.06, sz: 0.06 });
      A(P.box, o.guard ?? C.gold, { y: 0.14, sx: 0.19, sy: 0.035, sz: 0.05 });
      A(P.blade, steel, { y: 0.42, sx: 0.07, sy: 0.54, sz: 0.024, grad: 0.55 });
      break;
    }
    case 'greatsword': {
      A(P.cyl6, grip, { y: 0.09, sx: 0.05, sy: 0.22, sz: 0.05 });
      A(P.oct, o.guard ?? C.darkIron, { y: -0.03, sx: 0.08, sy: 0.08, sz: 0.08 });
      A(P.box, o.guard ?? C.darkIron, { y: 0.21, sx: 0.26, sy: 0.04, sz: 0.06 });
      A(P.blade, steel, { y: 0.6, sx: 0.1, sy: 0.76, sz: 0.03, grad: 0.55 });
      break;
    }
    case 'axe': {
      A(P.cyl6, wood, { y: 0.28, sx: 0.04, sy: 0.82, sz: 0.04 });
      A(P.axe, steel, { x: 0.02, y: 0.56, ry: Math.PI / 2, sx: 0.38, sy: 0.34, sz: 1, grad: 0.55 });
      if (o.doubleAxe) A(P.axe, steel, { x: -0.02, y: 0.56, ry: -Math.PI / 2, sx: 0.38, sy: 0.34, sz: 1, grad: 0.55 });
      A(P.box, C.darkIron, { y: 0.56, sx: 0.07, sy: 0.16, sz: 0.07 });
      break;
    }
    case 'hammer': {
      A(P.cyl6, wood, { y: 0.22, sx: 0.04, sy: 0.62, sz: 0.04 });
      A(P.box, steel, { y: 0.48, sx: 0.24, sy: 0.15, sz: 0.13, grad: 0.5 });
      A(P.box, C.darkIron, { y: 0.48, sx: 0.26, sy: 0.05, sz: 0.15 });
      break;
    }
    case 'club': {
      A(P.taper, 0x5a3a22, { y: 0.3, sx: 0.18, sy: 0.7, sz: 0.18, rx: Math.PI });
      for (let i = 0; i < 5; i++) A(P.ico, C.darkIron, { x: Math.sin(i * 2.4) * 0.07, y: 0.42 + i * 0.05, z: Math.cos(i * 2.4) * 0.07, sx: 0.05, sy: 0.05, sz: 0.05 });
      break;
    }
    case 'spear': {
      A(P.cyl6, wood, { y: 0.3, sx: 0.035, sy: 1.25, sz: 0.035 });
      A(P.blade, steel, { y: 1.02, sx: 0.08, sy: 0.24, sz: 0.03, grad: 0.55 });
      A(P.box, 0xb02a2a, { y: 0.88, sx: 0.06, sy: 0.05, sz: 0.06 });
      break;
    }
    case 'staff': {
      A(P.cyl6, wood, { y: 0.25, sx: 0.04, sy: 1.15, sz: 0.04 });
      A(P.box, C.darkIron, { y: 0.74, sx: 0.06, sy: 0.05, sz: 0.06 });
      if (o.orb) {
        A(P.oct, o.orbCage ?? C.gold, { y: 0.9, sx: 0.16, sy: 0.22, sz: 0.16 });
        const gn = `glow.${node}`; B.node(gn, { parent: node });
        B.add(gn, P.ico, o.orb, { y: 0.9, sx: 0.11, sy: 0.11, sz: 0.11, grad: 0, frame: f });
      } else A(P.oct, C.darkIron, { y: 0.86, sx: 0.09, sy: 0.14, sz: 0.09 });
      break;
    }
    case 'dagger': {
      A(P.cyl6, grip, { y: 0.05, sx: 0.04, sy: 0.11, sz: 0.04 });
      A(P.box, C.darkIron, { y: 0.11, sx: 0.11, sy: 0.03, sz: 0.04 });
      A(P.blade, steel, { y: 0.26, sx: 0.05, sy: 0.3, sz: 0.02, grad: 0.55 });
      break;
    }
    default: break;
  }
}

function offhand(B, node, type, hand, o = {}) {
  const steel = C.steel;
  switch (type) {
    case 'shield': { // round shield facing forward, strapped to the forearm
      const col = o.shieldColor ?? 0x8a5a2b;
      B.add(node, P.cyl, col, { y: hand + 0.1, z: 0.07, sx: 0.34, sy: 0.035, sz: 0.34, rx: Math.PI / 2, grad: 0.5 });
      B.add(node, P.ring, o.shieldRim ?? C.iron, { y: hand + 0.1, z: 0.085, sx: 0.33, sy: 0.33, sz: 0.5, grad: 0.3 });
      B.add(node, P.lowSphere, o.shieldBoss ?? steel, { y: hand + 0.1, z: 0.095, sx: 0.1, sy: 0.1, sz: 0.06, grad: 0.6 });
      break;
    }
    case 'kite': { // heraldic kite shield with a gold cross
      const col = o.shieldColor ?? 0x2f3f7a;
      B.add(node, P.kite, col, { y: hand + 0.08, z: 0.075, sx: 0.32, sy: 0.44, sz: 0.045, grad: 0.5 });
      B.add(node, P.box, o.shieldTrim ?? C.gold, { y: hand + 0.1, z: 0.105, sx: 0.05, sy: 0.32, sz: 0.012, grad: 0.3 });
      B.add(node, P.box, o.shieldTrim ?? C.gold, { y: hand + 0.16, z: 0.105, sx: 0.24, sy: 0.05, sz: 0.012, grad: 0.3 });
      break;
    }
    case 'towershield': {
      const col = o.shieldColor ?? 0x6c1f1f;
      B.add(node, P.plate, col, { y: hand + 0.14, z: 0.08, sx: 0.36, sy: 0.62, sz: 0.05, grad: 0.5 });
      B.add(node, P.box, C.gold, { y: hand + 0.14, z: 0.11, sx: 0.06, sy: 0.5, sz: 0.012, grad: 0.3 });
      B.add(node, P.box, C.gold, { y: hand + 0.32, z: 0.11, sx: 0.28, sy: 0.05, sz: 0.012, grad: 0.3 });
      break;
    }
    case 'dagger': weapon(B, node, 'dagger', hand, o); break;
    case 'bow': { // held vertically in the fist, string toward the body
      const wood = 0x8a5a2e;
      B.add(node, P.taperUp, wood, { y: hand + 0.3, z: 0.05, sx: 0.035, sy: 0.5, sz: 0.035, rx: -0.25 });
      B.add(node, P.taperUp, wood, { y: hand - 0.3, z: 0.05, sx: 0.035, sy: 0.5, sz: 0.035, rx: Math.PI + 0.25 });
      B.add(node, P.box, C.leather, { y: hand, z: 0.06, sx: 0.05, sy: 0.14, sz: 0.05 });
      B.add(node, P.box, 0xe8e2d0, { y: hand, z: -0.05, sx: 0.008, sy: 1.02, sz: 0.008, grad: 0 });
      break;
    }
    case 'orb': { // floating spell orb above the open palm
      const gn = `glow.${node}`; B.node(gn, { parent: node });
      B.add(gn, P.ico, o.orb ?? 0x7fd4ff, { y: hand - 0.06, z: 0.05, sx: 0.09, sy: 0.09, sz: 0.09, grad: 0 });
      break;
    }
    case 'torch': {
      B.add(node, P.cyl6, C.wood, { y: hand + 0.1, z: 0.04, sx: 0.035, sy: 0.32, sz: 0.035 });
      const gn = `glow.${node}`; B.node(gn, { parent: node });
      B.add(gn, P.cone, 0xffa030, { y: hand + 0.32, z: 0.04, sx: 0.08, sy: 0.14, sz: 0.08, grad: 0 });
      break;
    }
    default: break;
  }
}

// ------------------------------------------------------------------------------------------
// Humanoid: the shared biped used by the hero, humans, goblinoids, giants and winged fiends.

/**
 * Options: legLen, bodyH, bodyW, headR, armLen, hunch, torso:'taper'|'barrel'|'robe',
 * colours (skin, cloth, sleeves, legs, boots, hair, beard, ...), dress flags and weapon/offhand.
 */
export function humanoid(B, o) {
  const leg = o.legLen ?? 0.3, bodyH = o.bodyH ?? 0.32, bodyW = o.bodyW ?? 0.3, headR = o.headR ?? 0.125, armLen = o.armLen ?? 0.3;
  const hunch = o.hunch ?? 0;
  const skin = o.skin ?? C.skin, cloth = o.cloth ?? C.cloth, legs = o.legs ?? 0x3d2c1e, boots = o.boots ?? C.darkLeather;
  const hip = leg, shoulderY = bodyH * 0.92;
  B.node('root');
  // legs (thigh > shin + boot)
  B.both((sx) => {
    const L = sx < 0 ? 'legL' : 'legR', S = sx < 0 ? 'shinL' : 'shinR';
    B.node(L, { parent: 'root', x: sx * bodyW * (o.stance ?? 0.32), y: hip, rz: -sx * 0.04 });
    B.add(L, P.taperUp, legs, { y: -leg * 0.27, sx: bodyW * 0.36, sy: leg * 0.58, sz: bodyW * 0.38 });
    B.node(S, { parent: L, y: -leg * 0.52 });
    B.add(S, P.taperUp, o.shins ?? legs, { y: -leg * 0.23, sx: bodyW * 0.31, sy: leg * 0.5, sz: bodyW * 0.33, shade: 0.88 });
    B.add(S, P.box, boots, { y: -leg * 0.48 + 0.04, z: 0.03, sx: bodyW * 0.38, sy: 0.08, sz: bodyW * 0.56, grad: 0.3 });
    if (o.greaves) B.add(S, P.box, o.greaves, { y: -leg * 0.2, z: 0.02, sx: bodyW * 0.36, sy: leg * 0.4, sz: bodyW * 0.34, grad: 0.5 });
  });
  // torso
  B.node('body', { parent: 'root', y: hip, rx: hunch * 0.32 });
  const torso = o.torso ?? 'taper';
  if (torso === 'barrel') {
    B.add('body', P.capsuleShort, cloth, { y: bodyH * 0.5, sx: bodyW * 1.3, sy: bodyH / 1.3, sz: bodyW * 1.0 });
  } else if (torso === 'robe') {
    B.add('body', P.taper, cloth, { y: (bodyH - leg) * 0.5 + 0.02, sx: bodyW * 1.75, sy: bodyH + leg - 0.02, sz: bodyW * 1.5, grad: 0.5 });
    B.add('body', P.taper, cloth, { y: bodyH * 0.7, sx: bodyW * 1.2, sy: bodyH * 0.6, sz: bodyW * 0.9, rx: Math.PI });
  } else {
    B.add('body', P.taper, cloth, { y: bodyH * 0.52, sx: bodyW * 1.2, sy: bodyH * 0.98, sz: bodyW * 0.78, rx: Math.PI });
    B.add('body', P.box, o.pelvis ?? legs, { y: bodyH * 0.05, sx: bodyW * 0.9, sy: bodyH * 0.22, sz: bodyW * 0.6, shade: 0.85 });
  }
  if (o.belly) B.add('body', P.sphere, o.belly, { y: bodyH * 0.38, z: bodyW * 0.22, sx: bodyW * 1.15, sy: bodyH * 0.85, sz: bodyW * 0.9 });
  if (o.armor) {
    B.add('body', P.plate, o.armor, { y: bodyH * 0.62, z: 0.005, sx: bodyW * 1.22, sy: bodyH * 0.72, sz: bodyW * 0.86, grad: 0.55 });
    if (o.armorTrim) B.add('body', P.box, o.armorTrim, { y: bodyH * 0.62, z: bodyW * 0.44, sx: bodyW * 0.12, sy: bodyH * 0.55, sz: 0.012, grad: 0.3 });
  }
  if (o.tabard) B.add('body', P.box, o.tabard, { y: bodyH * 0.35, z: bodyW * 0.41, sx: bodyW * 0.55, sy: bodyH * 0.9, sz: 0.015, grad: 0.5 });
  if (o.belt) { B.add('body', P.box, o.belt, { y: bodyH * 0.16, sx: bodyW * 1.12, sy: 0.05, sz: bodyW * 0.72, grad: 0.2 }); B.add('body', P.box, o.buckle ?? C.gold, { y: bodyH * 0.16, z: bodyW * 0.36, sx: 0.05, sy: 0.05, sz: 0.015, grad: 0.2 }); }
  if (o.sash) B.add('body', P.box, o.sash, { y: bodyH * 0.55, z: bodyW * 0.42, rz: 0.7, sx: bodyW * 0.28, sy: bodyH * 0.95, sz: 0.012, grad: 0.4 });
  if (o.straps) B.both((sx) => B.add('body', P.box, o.straps, { x: sx * bodyW * 0.28, y: bodyH * 0.6, z: bodyW * 0.4, rz: sx * 0.35, sx: bodyW * 0.14, sy: bodyH * 0.7, sz: 0.012, grad: 0.3 }));
  if (o.shoulders) B.both((sx) => B.add('body', o.shoulderShape === 'fur' ? P.ico : P.lowSphere, o.shoulders, { x: sx * bodyW * 0.62, y: shoulderY + 0.02, sx: 0.16, sy: 0.11, sz: 0.16, grad: 0.55 }));
  if (o.spikes) B.both((sx) => B.add('body', P.cone, o.spikes, { x: sx * bodyW * 0.7, y: shoulderY + 0.09, rz: -sx * 0.5, sx: 0.05, sy: 0.12, sz: 0.05 }));
  if (o.necklace) for (let i = -2; i <= 2; i++) B.add('body', P.cone, C.bone, { x: i * 0.035, y: bodyH * 0.82 - Math.abs(i) * 0.012, z: bodyW * 0.42, rx: Math.PI, sx: 0.025, sy: 0.06, sz: 0.02 });
  if (o.quiver) { B.add('body', P.cyl6, C.leather, { x: -bodyW * 0.3, y: bodyH * 0.55, z: -bodyW * 0.42, rx: 0.2, rz: 0.4, sx: 0.07, sy: 0.4, sz: 0.07 }); for (let i = 0; i < 3; i++) B.add('body', P.box, 0xe0d8c0, { x: -bodyW * 0.3 - 0.06 + i * 0.03, y: bodyH * 0.95, z: -bodyW * 0.45, sx: 0.012, sy: 0.18, sz: 0.012 }); }
  if (o.satchel) B.add('body', P.box, o.satchel, { x: bodyW * 0.52, y: bodyH * 0.12, z: -0.02, sx: 0.12, sy: 0.11, sz: 0.07 });
  if (o.cape) {
    B.node('cape', { parent: 'body', y: shoulderY + 0.02, z: -bodyW * 0.36, rx: 0.12 });
    B.add('cape', P.cape, o.cape, { sx: bodyW * 1.3, sy: bodyH * 1.7 + (o.capeExtra ?? 0), sz: 1, grad: 0.55, tint: o.capeTint ?? null });
  }
  // head
  B.node('head', { parent: 'body', y: bodyH + headR * 0.1, z: hunch * 0.06 });
  const hy = headR * 0.95;
  B.add('head', P.cyl6, o.neck ?? skin, { y: headR * 0.1, sx: headR * 0.8, sy: headR * 0.6, sz: headR * 0.8, shade: 0.8 });
  const headShape = o.headShape ?? 'sphere';
  if (o.hood) {
    B.add('head', P.cone, o.hood, { y: hy + headR * 0.55, sx: headR * 2.8, sy: headR * 3.1, sz: headR * 2.7, grad: 0.5 });
    B.add('head', P.sphere, o.hood, { y: hy + headR * 0.05, sx: headR * 2.5, sy: headR * 2.3, sz: headR * 2.3, grad: 0.5 });
    B.add('head', P.box, o.face ?? 0x120c0a, { y: hy - headR * 0.05, z: headR * 0.55, sx: headR * 1.3, sy: headR * 1.2, sz: headR * 1.0, grad: 0 });
    if (o.mask) B.add('head', P.box, o.mask, { y: hy - headR * 0.4, z: headR * 0.95, sx: headR * 1.1, sy: headR * 0.6, sz: 0.02, grad: 0.2 });
  } else if (headShape === 'box') {
    B.add('head', P.box, skin, { y: hy, sx: headR * 2, sy: headR * 1.8 * (o.headTall ?? 1), sz: headR * 1.9 });
  } else if (headShape === 'skull') {
    B.add('head', P.sphere, skin, { y: hy + headR * 0.1, sx: headR * 2.1, sy: headR * 2.0, sz: headR * 2.0 });
    B.add('head', P.box, skin, { y: hy - headR * 0.5, z: headR * 0.1, sx: headR * 1.3, sy: headR * 0.9, sz: headR * 1.4, shade: 0.9 });
  } else {
    B.add('head', P.sphere, skin, { y: hy, sx: headR * 2, sy: headR * 2 * (o.headTall ?? 1), sz: headR * 2 });
    B.add('head', P.box, skin, { y: hy - headR * 0.35, z: headR * 0.25, sx: headR * 1.5, sy: headR * 1.1, sz: headR * 1.5, shade: 0.92 }); // jaw
  }
  if (o.hair) {
    B.add('head', P.sphere, o.hair, { y: hy + headR * 0.42, z: -headR * 0.15, sx: headR * 2.15, sy: headR * 1.5, sz: headR * 2.1, grad: 0.5 });
    if (o.hairLong) B.add('head', P.taper, o.hair, { y: hy - headR * 0.5, z: -headR * 0.7, sx: headR * 1.8, sy: headR * 2.2, sz: headR * 1.0, grad: 0.5 });
    if (o.hairWild) for (let i = 0; i < 5; i++) B.add('head', P.tet, o.hair, { x: Math.sin(i * 1.3) * headR * 0.8, y: hy + headR * 1.0, z: Math.cos(i * 1.3) * headR * 0.5 - headR * 0.3, rx: i, ry: i * 2, sx: headR * 0.9, sy: headR * 1.2, sz: headR * 0.9, grad: 0.5 });
    if (o.topknot) B.add('head', P.cone, o.hair, { y: hy + headR * 1.35, sx: headR * 0.6, sy: headR * 0.9, sz: headR * 0.6 });
  }
  if (o.beard) {
    B.add('head', P.taper, o.beard, { y: hy - headR * 1.1, z: headR * 0.45, sx: headR * 1.7, sy: headR * 1.6 * (o.beardLong ?? 1), sz: headR * 1.1, grad: 0.5 });
    B.both((sx) => B.add('head', P.box, o.beard, { x: sx * headR * 0.45, y: hy - headR * 0.3, z: headR * 0.85, rz: -sx * 0.4, sx: headR * 0.5, sy: headR * 0.2, sz: headR * 0.3, grad: 0.2 })); // moustache
  }
  const helm = o.helmet;
  if (helm) {
    const hc = helm.color ?? C.steel;
    if (helm.type === 'kettle') {
      B.add('head', P.sphere, hc, { y: hy + headR * 0.35, sx: headR * 2.2, sy: headR * 1.9, sz: headR * 2.2, grad: 0.55 });
      B.add('head', P.cyl, hc, { y: hy + headR * 0.2, sx: headR * 3.4, sy: 0.02, sz: headR * 3.4, grad: 0.3 });
    } else if (helm.type === 'full') {
      B.add('head', P.sphere, hc, { y: hy + headR * 0.15, sx: headR * 2.3, sy: headR * 2.3, sz: headR * 2.3, grad: 0.55 });
      B.add('head', P.box, hc, { y: hy - headR * 0.35, z: headR * 0.55, sx: headR * 1.9, sy: headR * 1.4, sz: headR * 1.5, grad: 0.4 });
      if (helm.visor) { const gn = 'glow.head'; B.node(gn, { parent: 'head' }); B.add(gn, P.box, helm.visor, { y: hy + headR * 0.1, z: headR * 1.16, sx: headR * 1.4, sy: headR * 0.26, sz: 0.02, grad: 0 }); }
    } else { // open helm with nasal and cheek guards
      B.add('head', P.sphere, hc, { y: hy + headR * 0.3, sx: headR * 2.25, sy: headR * 2.05, sz: headR * 2.25, grad: 0.55 });
      B.add('head', P.box, hc, { y: hy - headR * 0.05, z: headR * 1.0, sx: headR * 0.3, sy: headR * 1.3, sz: headR * 0.4, grad: 0.3 });
      B.both((sx) => B.add('head', P.box, hc, { x: sx * headR * 0.95, y: hy - headR * 0.2, z: headR * 0.25, sx: headR * 0.4, sy: headR * 1.2, sz: headR * 1.4, grad: 0.4 }));
      if (helm.band) B.add('head', P.cyl, helm.band, { y: hy + headR * 0.05, sx: headR * 2.32, sy: headR * 0.24, sz: headR * 2.32, grad: 0.3 });
    }
    if (helm.plume) { B.add('head', P.box, helm.plume, { y: hy + headR * 1.5, z: -headR * 0.25, rx: 0.25, sx: headR * 0.4, sy: headR * 1.0, sz: headR * 2.4, grad: 0.5 }); B.add('head', P.cone, helm.plume, { y: hy + headR * 1.2, z: -headR * 1.5, rx: Math.PI * 0.75, sx: headR * 0.4, sy: headR * 1.2, sz: headR * 0.4, grad: 0.5 }); }
    if (helm.horns) B.both((sx) => B.add('head', P.cone, helm.horns, { x: sx * headR * 1.1, y: hy + headR * 0.85, rz: -sx * 0.9, rx: -0.3, sx: headR * 0.6, sy: headR * 1.7, sz: headR * 0.6, grad: 0.5 }));
    if (helm.crest) B.add('head', P.box, helm.crest, { y: hy + headR * 1.35, sx: headR * 0.22, sy: headR * 0.7, sz: headR * 2.0, grad: 0.5 });
  }
  if (o.horns) B.both((sx) => B.add('head', P.cone, o.horns, { x: sx * headR * 0.85, y: hy + headR * 0.95, rz: -sx * (o.hornSpread ?? 0.75), rx: -0.25, sx: headR * 0.55, sy: headR * 1.8, sz: headR * 0.55, grad: 0.5 }));
  if (o.hat) {
    B.add('head', P.cone, o.hat, { y: hy + headR * 1.75, sx: headR * 2.0, sy: headR * 3.4, sz: headR * 2.0, rz: 0.18, grad: 0.5 });
    B.add('head', P.cyl, o.hat, { y: hy + headR * 0.6, sx: headR * 3.9, sy: 0.025, sz: headR * 3.9, grad: 0.3 });
    B.add('head', P.box, o.hatBand ?? C.gold, { y: hy + headR * 0.8, z: headR * 0.95, sx: headR * 1.4, sy: headR * 0.18, sz: 0.02, grad: 0.2 });
  }
  if (o.ears === 'pointed') B.both((sx) => B.add('head', P.cone, skin, { x: sx * headR * 1.25, y: hy + headR * 0.25, rz: -sx * 1.75, rx: -0.15, sx: headR * 0.55, sy: headR * 1.5, sz: headR * 0.3 }));
  else if (o.ears === 'round') B.both((sx) => B.add('head', P.lowSphere, o.earColor ?? skin, { x: sx * headR * 0.95, y: hy + headR * 0.85, z: -headR * 0.1, sx: headR * 0.7, sy: headR * 0.7, sz: headR * 0.4 }));
  else if (o.ears === 'elf') B.both((sx) => B.add('head', P.cone, skin, { x: sx * headR * 1.1, y: hy + headR * 0.3, rz: -sx * 1.45, sx: headR * 0.35, sy: headR * 1.0, sz: headR * 0.25 }));
  if (o.nose) B.add('head', P.cone, skin, { y: hy - headR * 0.15, z: headR * 1.05, rx: 1.45, sx: headR * (o.noseW ?? 0.5), sy: headR * (o.noseLen ?? 0.9), sz: headR * 0.5 });
  if (o.snout) { B.add('head', P.box, o.snout, { y: hy - headR * 0.35, z: headR * 1.15, sx: headR * 1.1, sy: headR * 0.8, sz: headR * 1.0, shade: 0.95 }); B.add('head', P.box, 0x1a1010, { y: hy - headR * 0.2, z: headR * 1.62, sx: headR * 0.4, sy: headR * 0.3, sz: headR * 0.2, grad: 0 }); }
  if (o.tusks) B.both((sx) => B.add('head', P.cone, C.bone, { x: sx * headR * 0.5, y: hy - headR * 0.55, z: headR * 0.85, sx: 0.035, sy: 0.1, sz: 0.035 }));
  if (o.eyes !== false) eyes(B, o, hy, headR, { y: o.eyeY ?? 0.05, spread: o.eyeSpread ?? 0.36, size: o.eyeSize ?? 0.032, color: o.eyeColor ?? 0xfff2c8, socket: o.eyeSocket ?? !o.hood, z: o.hood ? 0.85 : 0.92 });
  if (o.mouth) mouth(B, hy, headR, typeof o.mouth === 'object' ? o.mouth : {});
  // arms (upper > forearm + hand)
  const armRest = o.armRest ?? { rx: 0.15, rz: 0.12 };
  B.both((sx) => {
    const A = sx < 0 ? 'armL' : 'armR', F = sx < 0 ? 'foreL' : 'foreR';
    const rest = sx < 0 ? (o.armRestL ?? armRest) : (o.armRestR ?? armRest);
    B.node(A, { parent: 'body', x: sx * bodyW * 0.66, y: shoulderY, rx: rest.rx ?? 0, ry: rest.ry ?? 0, rz: sx * (rest.rz ?? 0) });
    B.add(A, P.taperUp, o.sleeves ?? skin, { y: -armLen * 0.26, sx: bodyW * 0.32, sy: armLen * 0.56, sz: bodyW * 0.32 });
    if (o.shoulders) B.add(A, P.lowSphere, o.shoulders, { y: 0.01, sx: 0.15, sy: 0.1, sz: 0.15, grad: 0.55 });
    const fr = sx < 0 ? (o.foreRestL ?? { rx: -0.35 }) : (o.foreRestR ?? { rx: -0.6 });
    B.node(F, { parent: A, y: -armLen * 0.5, rx: fr.rx ?? 0, ry: fr.ry ?? 0, rz: fr.rz ?? 0 });
    B.add(F, P.taperUp, o.forearms ?? o.sleeves ?? skin, { y: -armLen * 0.24, sx: bodyW * 0.29, sy: armLen * 0.5, sz: bodyW * 0.29, shade: 0.92 });
    B.add(F, P.lowSphere, o.gloves ?? skin, { y: -armLen * 0.5, sx: bodyW * 0.36, sy: bodyW * 0.3, sz: bodyW * 0.34, grad: 0.35 });
    if (o.bracers) B.add(F, P.cyl6, o.bracers, { y: -armLen * 0.3, sx: bodyW * 0.34, sy: armLen * 0.26, sz: bodyW * 0.34, grad: 0.45 });
    if (o.claws) for (let i = -1; i <= 1; i++) B.add(F, P.cone, C.bone, { x: i * bodyW * 0.1, y: -armLen * 0.62, z: bodyW * 0.08, rx: Math.PI, sx: 0.025, sy: 0.08, sz: 0.025 });
  });
  const hand = -armLen * 0.5;
  if (o.weapon) weapon(B, o.weaponHand === 'L' ? 'foreL' : 'foreR', o.weapon, hand, o);
  if (o.offhand) offhand(B, 'foreL', o.offhand, hand, o);
  if (o.extra) o.extra(B, { hip, bodyH, bodyW, headR, hy, armLen, hand, shoulderY });
}

/** Humanoid with bat wings and an optional tail. */
export function winged(B, o) {
  humanoid(B, o);
  const bodyH = o.bodyH ?? 0.32, bodyW = o.bodyW ?? 0.3;
  B.both((sx) => {
    const n = sx < 0 ? 'wingL' : 'wingR';
    B.node(n, { parent: 'body', x: sx * bodyW * 0.3, y: bodyH * 0.8, z: -bodyW * 0.35, ry: sx * 0.35 });
    const ws = o.wingSize ?? 0.6;
    B.add(n, P.wing, o.wing ?? 0x555555, { rx: -Math.PI / 2 + 0.3, ry: sx < 0 ? Math.PI : 0, rz: sx * 0.35, sx: ws, sy: ws, sz: 1, grad: 0.5, tint: o.wingTint ?? null });
    B.add(n, P.taperUp, o.wingBone ?? o.wing ?? 0x555555, { x: sx * ws * 0.42, y: ws * 0.18, rz: -sx * 1.15, sx: 0.035, sy: ws * 0.9, sz: 0.035 });
  });
  if (o.tail) {
    B.node('tail', { parent: 'body', y: 0.06, z: -bodyW * 0.3 });
    B.add('tail', P.taperUp, o.tail, { z: -0.16, y: -0.06, rx: -Math.PI / 2 - 0.5, sx: 0.07, sy: 0.32, sz: 0.07 });
    B.node('tail2', { parent: 'tail', y: -0.15, z: -0.28 });
    B.add('tail2', P.taperUp, o.tail, { z: -0.12, y: 0.02, rx: -Math.PI / 2 + 0.3, sx: 0.045, sy: 0.26, sz: 0.045 });
    B.add('tail2', P.cone4, o.tailTip ?? o.tail, { z: -0.26, y: 0.05, rx: -Math.PI / 2 + 0.3, sx: 0.08, sy: 0.1, sz: 0.04 });
  }
}

// ------------------------------------------------------------------------------------------
// Beasts

/** Four-legged beast with a neck, knees and a two-segment tail. */
export function quadruped(B, o) {
  const fur = o.fur ?? 0x6e6a66, len = o.len ?? 0.7, h = o.h ?? 0.32, w = o.w ?? 0.26, legH = o.legH ?? 0.24;
  B.node('root');
  const hip = legH;
  B.node('body', { parent: 'root', y: hip });
  B.add('body', P.capsule, fur, { y: h * 0.45, rx: Math.PI / 2, sx: w, sy: len * 0.5, sz: h * 0.8, tint: o.belly ?? null, grad: 0.5 });
  B.add('body', P.sphere, fur, { y: h * 0.5, z: len * 0.28, sx: w * 1.25, sy: h * 0.95, sz: len * 0.42, tint: o.belly ?? null, grad: 0.5 }); // chest
  if (o.mane) B.add('body', P.ico, o.mane, { y: h * 0.78, z: len * 0.22, sx: w * 1.3, sy: h * 0.55, sz: len * 0.4, grad: 0.5 });
  if (o.spikes) for (let i = 0; i < 4; i++) B.add('body', P.cone, o.spikes, { y: h * 0.9, z: len * 0.25 - i * len * 0.18, rx: -0.3, sx: 0.05, sy: 0.11, sz: 0.05 });
  B.node('neck', { parent: 'body', y: h * 0.72, z: len * 0.42 });
  B.add('neck', P.taperUp, fur, { y: 0.05, z: 0.06, rx: -0.9, sx: w * 0.8, sy: 0.2, sz: w * 0.7, grad: 0.5 });
  B.node('head', { parent: 'neck', y: 0.1, z: 0.12 });
  const hs = o.headSize ?? 0.2;
  B.add('head', P.box, fur, { y: hs * 0.2, z: hs * 0.3, sx: hs, sy: hs * 0.85, sz: hs * 1.0 });
  B.add('head', P.taperUp, o.snout ?? fur, { y: hs * 0.05, z: hs * 1.0, rx: Math.PI / 2, sx: hs * 0.62, sy: hs * 0.9, sz: hs * 0.5, shade: 0.95 });
  B.add('head', P.box, 0x1a1010, { y: hs * 0.2, z: hs * 1.45, sx: hs * 0.28, sy: hs * 0.2, sz: hs * 0.16, grad: 0 });
  B.both((sx) => B.add('head', P.cone, fur, { x: sx * hs * 0.38, y: hs * 0.7, z: -hs * 0.05, rz: -sx * 0.35, rx: -0.2, sx: hs * 0.32, sy: hs * 0.5, sz: hs * 0.2 }));
  if (o.teeth) for (let i = -1; i <= 1; i += 2) B.add('head', P.cone, C.bone, { x: i * hs * 0.22, y: -hs * 0.18, z: hs * 1.25, rx: Math.PI, sx: 0.02, sy: 0.06, sz: 0.02 });
  B.node('glow.head', { parent: 'head' });
  B.both((sx) => { B.add('head', P.box, 0x14100f, { x: sx * hs * 0.32, y: hs * 0.32, z: hs * 0.78, sx: 0.05, sy: 0.035, sz: 0.02, grad: 0 }); B.add('glow.head', P.box, o.eyeColor ?? 0xff5a3c, { x: sx * hs * 0.32, y: hs * 0.32, z: hs * 0.8, sx: 0.032, sy: 0.02, sz: 0.02, grad: 0 }); });
  const lx = w * 0.42, lz = len * 0.34;
  for (const [n, sx, z] of [['legFL', -1, lz], ['legFR', 1, lz], ['legBL', -1, -lz], ['legBR', 1, -lz]]) {
    B.node(n, { parent: 'root', x: sx * lx, y: hip, z });
    B.add(n, P.taperUp, fur, { y: -legH * 0.27, sx: w * 0.36, sy: legH * 0.6, sz: w * 0.42, shade: 0.92 });
    B.node(`shin${n.slice(3)}`, { parent: n, y: -legH * 0.5 });
    B.add(`shin${n.slice(3)}`, P.taperUp, fur, { y: -legH * 0.22, sx: w * 0.3, sy: legH * 0.5, sz: w * 0.34, shade: 0.85 });
    B.add(`shin${n.slice(3)}`, P.box, o.paws ?? 0x2a2320, { y: -legH * 0.47 + 0.03, z: 0.03, sx: w * 0.34, sy: 0.06, sz: w * 0.5, grad: 0.3 });
  }
  B.node('tail', { parent: 'body', y: h * 0.62, z: -len * 0.48 });
  B.add('tail', P.taperUp, fur, { z: -0.14, y: 0.02, rx: -Math.PI / 2 - 0.3, sx: 0.08, sy: 0.28, sz: 0.08 });
  B.node('tail2', { parent: 'tail', z: -0.26, y: 0.06 });
  B.add('tail2', P.taperUp, o.tailTip ?? fur, { z: -0.12, rx: -Math.PI / 2 + 0.2, sx: 0.065, sy: 0.26, sz: 0.065 });
}

/** Winged serpent/dragon: long body, two-segment neck and tail, big membrane wings, two legs. */
export function drake(B, o) {
  const scale = o.scale ?? 0x4f7a5a, belly = o.belly ?? 0xb9b08a, len = (o.len ?? 0.8) * 0.8, ws = (o.wingSize ?? 0.8) * 0.72;
  const k = 0.8; // body-part scale so the largest drakes still fit a tile with wings spread
  B.node('root');
  B.node('body', { parent: 'root', y: 0.3 });
  B.add('body', P.capsule, scale, { rx: Math.PI / 2, sx: 0.36 * k, sy: len * 0.5, sz: 0.3 * k, grad: 0.5 });
  B.add('body', P.capsule, belly, { y: -0.07 * k, rx: Math.PI / 2, sx: 0.27 * k, sy: len * 0.4, sz: 0.16 * k, grad: 0.3 });
  for (let i = 0; i < 6; i++) B.add('body', P.cone4, o.spine ?? scale, { y: 0.13 * k, z: len * 0.38 - i * len * 0.15, rx: -0.3, sx: 0.06 * k, sy: (0.13 - i * 0.01) * k, sz: 0.07 * k });
  if (o.spineGlow) { B.node('glow.body', { parent: 'body' }); for (let i = 0; i < 6; i++) B.add('glow.body', P.box, o.spineGlow, { y: 0.09 * k, z: len * 0.38 - i * len * 0.15, sx: 0.02, sy: 0.02, sz: 0.04, grad: 0 }); }
  B.node('neck', { parent: 'body', y: 0.07 * k, z: len * 0.42 });
  B.add('neck', P.taperUp, scale, { y: 0.1 * k, z: 0.06 * k, rx: -0.6, sx: 0.2 * k, sy: 0.3 * k, sz: 0.2 * k, grad: 0.5 });
  B.node('neck2', { parent: 'neck', y: 0.2 * k, z: 0.13 * k });
  B.add('neck2', P.taperUp, scale, { y: 0.1 * k, z: 0.04 * k, rx: -0.35, sx: 0.16 * k, sy: 0.26 * k, sz: 0.16 * k, grad: 0.5 });
  B.node('head', { parent: 'neck2', y: 0.22 * k, z: 0.1 * k });
  B.add('head', P.box, scale, { z: 0.05 * k, sx: 0.2 * k, sy: 0.15 * k, sz: 0.24 * k });
  B.add('head', P.taperUp, scale, { y: 0.02 * k, z: 0.24 * k, rx: Math.PI / 2, sx: 0.16 * k, sy: 0.22 * k, sz: 0.11 * k, shade: 0.95 }); // muzzle
  B.node('jaw', { parent: 'head', y: -0.05 * k, z: 0.08 * k });
  B.add('jaw', P.box, o.jaw ?? belly, { y: -0.02 * k, z: 0.14 * k, sx: 0.14 * k, sy: 0.05 * k, sz: 0.24 * k, shade: 0.85 });
  B.both((sx) => { for (let i = 0; i < 3; i++) B.add('head', P.cone, C.bone, { x: sx * 0.05 * k, y: -0.06 * k, z: (0.12 + i * 0.07) * k, rx: Math.PI, sx: 0.016, sy: 0.045, sz: 0.016 }); });
  B.both((sx) => B.add('head', P.cone, o.horn ?? 0x2a2a2a, { x: sx * 0.08 * k, y: 0.1 * k, z: -0.06 * k, rx: -1.0, rz: -sx * 0.25, sx: 0.05 * k, sy: 0.2 * k, sz: 0.05 * k, grad: 0.5 }));
  if (o.crest) for (let i = 0; i < 3; i++) B.add('head', P.cone4, o.crest, { y: 0.1 * k, z: (0.02 - i * 0.06) * k, rx: -0.5, sx: 0.05 * k, sy: 0.1 * k, sz: 0.06 * k });
  B.node('glow.head', { parent: 'head' });
  B.both((sx) => { B.add('head', P.box, 0x14100f, { x: sx * 0.085 * k, y: 0.04 * k, z: 0.13 * k, sx: 0.045, sy: 0.032, sz: 0.02, grad: 0 }); B.add('glow.head', P.box, o.eyeColor ?? 0xffb347, { x: sx * 0.085 * k, y: 0.04 * k, z: 0.15 * k, sx: 0.03, sy: 0.018, sz: 0.02, grad: 0 }); });
  if (o.fire) { B.add('glow.head', P.cone, o.fire, { y: -0.04 * k, z: 0.4 * k, rx: Math.PI / 2, sx: 0.1 * k, sy: 0.22 * k, sz: 0.07 * k, grad: 0 }); B.add('glow.head', P.ico, 0xfff0a0, { y: -0.04 * k, z: 0.32 * k, sx: 0.06 * k, sy: 0.06 * k, sz: 0.06 * k, grad: 0 }); }
  B.both((sx) => {
    const n = sx < 0 ? 'wingL' : 'wingR';
    B.node(n, { parent: 'body', x: sx * 0.14 * k, y: 0.12 * k, z: 0.06 * k, ry: sx * 0.2 });
    B.add(n, P.wing, o.wing ?? scale, { rx: -Math.PI / 2 + 0.15, ry: sx < 0 ? Math.PI : 0, sx: ws, sy: ws, sz: 1, grad: 0.5, tint: o.wingTint ?? null });
    B.add(n, P.taperUp, o.wingBone ?? scale, { x: sx * ws * 0.45, y: 0.03, z: ws * 0.2, rz: -sx * 1.25, rx: -0.15, sx: 0.04, sy: ws * 0.95, sz: 0.04 });
  });
  B.both((sx) => {
    const n = sx < 0 ? 'legL' : 'legR';
    B.node(n, { parent: 'root', x: sx * 0.16 * k, y: 0.24, z: -0.02 });
    B.add(n, P.taperUp, scale, { y: -0.09, rx: 0.3, sx: 0.11 * k, sy: 0.22, sz: 0.12 * k, shade: 0.9 });
    B.add(n, P.box, o.claw ?? 0x2a2a2a, { y: -0.19, z: 0.05, sx: 0.11 * k, sy: 0.05, sz: 0.18 * k, grad: 0.3 });
    for (let i = -1; i <= 1; i++) B.add(n, P.cone, C.bone, { x: i * 0.035 * k, y: -0.19, z: 0.14 * k, rx: Math.PI / 2, sx: 0.02, sy: 0.06, sz: 0.02 });
  });
  B.node('tail', { parent: 'body', y: -0.02 * k, z: -len * 0.45 });
  B.add('tail', P.taperUp, scale, { z: -0.2 * k, rx: -Math.PI / 2, sx: 0.18 * k, sy: 0.4 * k, sz: 0.14 * k, grad: 0.5 });
  B.node('tail2', { parent: 'tail', z: -0.38 * k });
  B.add('tail2', P.taperUp, scale, { z: -0.16 * k, rx: -Math.PI / 2, sx: 0.1 * k, sy: 0.34 * k, sz: 0.09 * k, grad: 0.5 });
  B.add('tail2', P.cone4, o.tailTip ?? o.spine ?? scale, { z: -0.36 * k, rx: -Math.PI / 2, sx: 0.1 * k, sy: 0.14 * k, sz: 0.05 * k });
}

/** Eight-legged spider with jointed legs, a swollen abdomen and glowing markings. */
export function spider(B, o) {
  const chitin = o.chitin ?? 0x3a2550, abd = o.abdomen ?? 0x4d2f6e;
  B.node('root');
  B.node('body', { parent: 'root', y: 0.3 });
  B.add('body', P.sphere, chitin, { sx: 0.32, sy: 0.24, sz: 0.34, grad: 0.5 });
  B.add('body', P.sphere, abd, { z: -0.34, y: 0.06, sx: 0.5, sy: 0.42, sz: 0.56, grad: 0.5 });
  for (let i = 0; i < 4; i++) B.add('body', P.cone, chitin, { z: -0.34 - i * 0.05 + 0.1, y: 0.26 - i * 0.02, rx: -0.4, sx: 0.04, sy: 0.08, sz: 0.04 });
  B.node('glow.body', { parent: 'body' });
  B.add('glow.body', P.oct, o.mark ?? 0xb197fc, { z: -0.3, y: 0.22, sx: 0.14, sy: 0.05, sz: 0.24, grad: 0 });
  B.both((sx) => B.add('glow.body', P.box, o.mark ?? 0xb197fc, { x: sx * 0.16, z: -0.4, y: 0.16, sx: 0.06, sy: 0.03, sz: 0.1, grad: 0 }));
  B.node('head', { parent: 'body', z: 0.2, y: 0.0 });
  B.add('head', P.sphere, chitin, { sx: 0.22, sy: 0.18, sz: 0.2, grad: 0.5 });
  B.both((sx) => B.add('head', P.cone, 0x1a1020, { x: sx * 0.06, y: -0.07, z: 0.1, rx: 1.3, sx: 0.045, sy: 0.14, sz: 0.045 })); // fangs
  B.both((sx) => B.add('head', P.taperUp, chitin, { x: sx * 0.11, y: -0.02, z: 0.13, rx: 1.1, rz: -sx * 0.5, sx: 0.035, sy: 0.16, sz: 0.035 })); // pedipalps
  B.node('glow.head', { parent: 'head' });
  const ec = o.eyeColor ?? 0xd0a0ff;
  B.both((sx) => { B.add('glow.head', P.box, ec, { x: sx * 0.05, y: 0.05, z: 0.09, sx: 0.035, sy: 0.03, sz: 0.02, grad: 0 }); B.add('glow.head', P.box, ec, { x: sx * 0.09, y: 0.08, z: 0.07, sx: 0.025, sy: 0.02, sz: 0.02, grad: 0 }); B.add('glow.head', P.box, ec, { x: sx * 0.02, y: 0.09, z: 0.09, sx: 0.02, sy: 0.018, sz: 0.02, grad: 0 }); B.add('glow.head', P.box, ec, { x: sx * 0.12, y: 0.03, z: 0.06, sx: 0.02, sy: 0.018, sz: 0.02, grad: 0 }); });
  for (let i = 0; i < 4; i++) B.both((sx) => {
    const n = `leg${i}${sx < 0 ? 'L' : 'R'}`, k = `knee${i}${sx < 0 ? 'L' : 'R'}`;
    const z = 0.16 - i * 0.12;
    const spread = (i - 1.5) * 0.38;
    B.node(n, { parent: 'body', x: sx * 0.13, y: 0.04, z, ry: sx * spread, rz: sx * 0.75 });
    B.add(n, P.taperUp, chitin, { x: sx * 0.17, rz: sx * Math.PI / 2, sx: 0.045, sy: 0.34, sz: 0.045, grad: 0.3 });
    B.node(k, { parent: n, x: sx * 0.34, rz: -sx * 1.9 });
    B.add(k, P.taperUp, o.legTip ?? chitin, { x: sx * 0.19, rz: sx * Math.PI / 2, sx: 0.035, sy: 0.38, sz: 0.035, grad: 0.3 });
    B.add(k, P.ico, chitin, { sx: 0.05, sy: 0.05, sz: 0.05 });
  });
}

// ------------------------------------------------------------------------------------------
// The cast.

export const BUILDERS = {
  // The hero: a knight in bright steel with a red plume and cape, kite shield forward, sword raised like the C64 sprite.
  'player': (B) => humanoid(B, {
    skin: 0xe6c3a0, cloth: 0x9aa1ad, legs: 0x4a4f5a, boots: 0x6a2622, armor: 0xd8dde4, armorTrim: C.gold, belt: 0x5a3b23, buckle: C.gold,
    shoulders: 0xc8cdd4, helmet: { color: 0xd8dde4, plume: 0xd0322a, band: C.gold }, cape: 0x8f1f1f, capeTint: 0x4a0d10, capeExtra: 0.02,
    sleeves: 0xb9bec7, forearms: 0x8c9199, gloves: 0x5a3b23, greaves: 0xb9bec7, eyeColor: 0xfff6e0, brows: 0x5a3a22, mouth: { w: 0.35, y: -0.5 },
    weapon: 'sword', weaponGrip: 'extend', blade: 0xdfe6ee, guard: C.gold, offhand: 'kite', shieldColor: 0x2f3f7a, shieldTrim: C.gold,
    armRestR: { rx: -0.3, rz: -2.5 }, foreRestR: { rx: 0 }, armRestL: { rx: 0.7, rz: 0.4 }, foreRestL: { rx: -0.9 },
  }),
  'dire-wolf': (B) => quadruped(B, { fur: 0x6f6862, belly: 0xb5ada4, snout: 0x5a524c, len: 0.92, h: 0.38, w: 0.32, legH: 0.3, headSize: 0.25, teeth: true, eyeColor: 0xff4a2a, mane: 0x4a423e, tailTip: 0x3d3836, paws: 0x3a322e }),
  // Ogre: enormous belly, tiny head, tusks, studded club, patchwork loincloth.
  'ogre': (B) => humanoid(B, { skin: 0x8fa062, cloth: 0x8fa062, legs: 0x5a3b23, boots: 0x3a2618, bodyW: 0.5, bodyH: 0.46, legLen: 0.3, headR: 0.105, armLen: 0.42, torso: 'barrel', belly: 0xa2b374, tusks: true, nose: true, noseW: 0.8, noseLen: 0.7, mouth: { w: 0.6, y: -0.55, teeth: true }, brows: 0x4a5a2a, weapon: 'club', weaponPitch: 0.6, eyeColor: 0xffe08a, eyeSize: 0.026, hair: 0x3a2a1a, hairWild: true, belt: 0x4a3018, straps: 0x4a3018, ears: 'round', bracers: 0x4a3018, stance: 0.36, armRestR: { rx: 0.1, rz: 0.55 }, foreRestR: { rx: -0.9 } }),
  // Hobgoblin: small, hunched, huge ears and nose, spear taller than itself, rusty cap.
  'hobgoblin': (B) => humanoid(B, { skin: 0xd88a40, cloth: 0x8a7a52, legs: 0x5a4a34, boots: 0x3a2e1c, bodyW: 0.28, bodyH: 0.24, legLen: 0.22, headR: 0.135, hunch: 1.1, ears: 'pointed', nose: true, noseLen: 1.3, noseW: 0.45, mouth: { w: 0.45, y: -0.5, teeth: true }, brows: 0x5a3a1a, weapon: 'spear', weaponPitch: 1.0, eyeColor: 0xffe08a, eyeSize: 0.028, belt: 0x3a2a1a, satchel: 0x5a4028, stance: 0.36 }),
  // Werebear: hulking hunched bear-man with a box snout, round ears, claws and torn breeches.
  'werebear': (B) => humanoid(B, { skin: 0x7a4e2e, cloth: 0x7a4e2e, legs: 0x5a3a22, shins: 0x7a4e2e, boots: 0x2a1a10, bodyW: 0.5, bodyH: 0.44, legLen: 0.28, headR: 0.14, hunch: 1.0, torso: 'barrel', belly: 0xa07a52, ears: 'round', earColor: 0x5a3a22, snout: 0xa8845c, mouth: { w: 0.5, y: -0.62, z: 1.6, teeth: true }, brows: 0x2a1a10, armLen: 0.42, claws: true, eyeColor: 0xffb347, eyeSize: 0.028, sleeves: 0x7a4e2e, headShape: 'box', straps: 0x3a2618, stance: 0.34 }),
  // Gargoyle: crouched stone fiend with bat wings, horns and a barbed tail; eyes burn amber.
  'gargoyle': (B) => winged(B, { skin: 0x6e6e74, cloth: 0x6e6e74, legs: 0x62626a, boots: 0x4e4e54, bodyW: 0.32, bodyH: 0.3, legLen: 0.26, horns: 0x4a4a50, ears: 'pointed', hunch: 0.9, mouth: { w: 0.55, y: -0.45, teeth: true }, brows: 0x3a3a40, eyeColor: 0xffd05a, sleeves: 0x6e6e74, wing: 0x5a5a60, wingBone: 0x4a4a50, wingSize: 0.62, tail: 0x66666c, tailTip: 0x4a4a50, claws: true, headShape: 'skull', nose: true, noseW: 0.6, noseLen: 0.5 }),
  // Troll: tall, lanky, arms to the floor, mossy green with warts and wild hair.
  'troll': (B) => humanoid(B, { skin: 0x5d7a3a, cloth: 0x5d7a3a, legs: 0x3f4a2a, boots: 0x2a3018, bodyW: 0.4, bodyH: 0.48, legLen: 0.34, headR: 0.11, hunch: 1.3, torso: 'barrel', belly: 0x6b8a44, nose: true, noseLen: 1.4, noseW: 0.7, ears: 'pointed', armLen: 0.56, hair: 0x2a3a1a, hairWild: true, eyeColor: 0xffe08a, eyeSize: 0.026, sleeves: 0x5d7a3a, tusks: true, mouth: { w: 0.5, y: -0.6 }, brows: 0x2a3a1a, claws: true, necklace: true, extra: (B, r) => { for (let i = 0; i < 5; i++) B.add('body', P.ico, 0x4a6a2a, { x: Math.sin(i * 2.1) * r.bodyW * 0.5, y: r.bodyH * (0.3 + (i % 3) * 0.2), z: -r.bodyW * 0.42, sx: 0.04, sy: 0.04, sz: 0.04 }); } }),
  'wyvern': (B) => drake(B, { scale: 0x4f7a5a, belly: 0xc2b88f, wing: 0x3e6048, wingTint: 0x2a3f30, wingBone: 0x2e4a34, spine: 0x2e4a34, len: 0.8, eyeColor: 0xffb347, tailTip: 0x2a2a2a, crest: 0x2e4a34 }),
  'dimension-spider': (B) => spider(B, { chitin: 0x3a2550, abdomen: 0x4d2f6e, mark: 0xb197fc, legTip: 0x2a1a3c }),
  // Shadow dragon: near-black scales, violet spines that glow, huge tattered wings.
  'shadow-dragon': (B) => drake(B, { scale: 0x3d3352, belly: 0x5c4d74, wing: 0x45386a, wingTint: 0x7a5cb0, wingBone: 0x7a5cb0, spine: 0x8a6fd0, spineGlow: 0xc09cff, horn: 0x8a6fd0, len: 0.98, wingSize: 1.0, eyeColor: 0xc58cff, jaw: 0x3a2f4a }),
  // Fyre drake: ember red, orange belly plates and a flame licking from the jaws.
  'fyre-drake': (B) => drake(B, { scale: 0xb03a1e, belly: 0xffb347, wing: 0x8a2a14, wingTint: 0xff6a1a, wingBone: 0x5a1a0e, spine: 0xff7a1a, spineGlow: 0xffa040, horn: 0x3a1a10, fire: 0xffa030, len: 0.9, wingSize: 0.88, eyeColor: 0xffe060, crest: 0xff7a1a }),
  // Demon: crimson brute with ram horns, wings, a barbed tail and a smouldering greatsword.
  'demon': (B) => winged(B, { skin: 0xa8281e, cloth: 0x5a1010, legs: 0x4a0e0e, boots: 0x2a0808, bodyW: 0.36, bodyH: 0.38, legLen: 0.32, horns: 0x1a1010, hornSpread: 1.1, tail: 0xa8281e, tailTip: 0x1a1010, eyeColor: 0xffe060, eyeSize: 0.04, eyeSlit: true, sleeves: 0xa8281e, wing: 0x3a0c0c, wingTint: 0x7a1a14, wingBone: 0x1a0808, wingSize: 0.72, weapon: 'greatsword', blade: 0x3a1a1a, guard: 0x1a0808, mouth: { w: 0.55, y: -0.45, teeth: true }, brows: 0x3a0c0c, belt: 0x1a0808, spikes: 0x1a0808, ears: 'pointed', headShape: 'skull' }),
  // Rogue: slim hooded cutpurse, twin daggers, a fat satchel of stolen gold.
  'rogue': (B) => humanoid(B, { skin: 0xd9a77a, cloth: 0x4a5068, legs: 0x2e3040, hood: 0x5a6078, mask: 0x3a3e50, face: 0xd9a77a, weapon: 'dagger', offhand: 'dagger', bodyW: 0.26, eyeColor: 0xe8e8ff, eyeSize: 0.026, belt: 0x5a3b23, satchel: 0x8a6a3a, sleeves: 0x4a5068, gloves: 0x2e3040, hunch: 0.5, foreRestL: { rx: -0.9 }, foreRestR: { rx: -0.9 } }),
  // Barbarian: bare-chested, fur boots, horned helm, long hair and beard, a double-bit axe.
  'barbarian': (B) => humanoid(B, { skin: 0xd8a070, cloth: 0xd8a070, legs: 0x6b4a2e, boots: 0x7a5a3a, bodyW: 0.38, bodyH: 0.38, hair: 0x5a2a12, hairLong: true, beard: 0x5a2a12, belt: 0x5a3b23, weapon: 'axe', doubleAxe: true, eyeColor: 0xffffff, eyeSize: 0.026, brows: 0x5a2a12, shoulders: 0x8a6a4a, shoulderShape: 'fur', straps: 0x5a3b23, bracers: 0x5a3b23, helmet: { type: 'open', color: 0x8a8f96, horns: C.bone }, necklace: true }),
  // Elvin ranger: green hood and cloak, bow in the off hand, quiver on the back.
  'elvin-ranger': (B) => humanoid(B, { skin: 0xe8c9a5, cloth: 0x3f6b35, legs: 0x4a3a2a, hood: 0x3f6b35, face: 0xe8c9a5, cape: 0x2f5a2a, capeTint: 0x1a3a1a, offhand: 'bow', weapon: 'dagger', bodyW: 0.27, bodyH: 0.34, legLen: 0.32, eyeColor: 0xc8ffd8, eyeSize: 0.026, eyeSocket: true, quiver: true, belt: 0x5a3b23, sleeves: 0x3f6b35, gloves: 0x5a3b23, foreRestL: { rx: -0.2, rz: 0.5 } }),
  // Dwarven guard: short and wide, huge orange beard, steel helm, warhammer and round shield.
  'dwarven-guard': (B) => humanoid(B, { skin: 0xd9a77a, cloth: 0x6e5a3a, legs: 0x3a3a3a, bodyW: 0.4, bodyH: 0.3, legLen: 0.2, headR: 0.125, armLen: 0.26, beard: 0xc0662a, beardLong: 1.5, helmet: { type: 'open', color: 0x8a8f96, crest: 0xb08d3c }, weapon: 'hammer', offhand: 'shield', shieldColor: 0x8a5a2b, shieldBoss: C.gold, armor: 0x8a8f96, armorTrim: C.gold, belt: 0x5a3b23, eyeColor: 0xffffff, eyeSize: 0.026, brows: 0xc0662a, shoulders: 0x8a8f96, bracers: 0x5a3b23, stance: 0.4 }),
  // Mercenary: kettle helm, mail, sword and round shield, a red sash.
  'mercenary': (B) => humanoid(B, { skin: 0xd9a77a, cloth: 0x6e6e74, legs: 0x3a3a3a, armor: 0x7a7f86, helmet: { type: 'kettle', color: 0x7a7f86 }, weapon: 'sword', offhand: 'shield', shieldColor: 0x5a3b23, shieldRim: 0x4a4f58, belt: 0x5a3b23, sash: 0xa02a2a, eyeColor: 0xffffff, eyeSize: 0.026, sleeves: 0x6e6e74, gloves: 0x5a3b23, beard: 0x3a2a1a, beardLong: 0.5, mouth: { w: 0.3, y: -0.45 } }),
  // Swordsman: polished plate, red tabard, bare head with dark hair, a bright longsword.
  'swordsman': (B) => humanoid(B, { skin: 0xd9a77a, cloth: 0x8a2a2a, legs: 0x3a3a3a, armor: 0xb0b5bc, armorTrim: 0x8a2a2a, tabard: 0x8a2a2a, shoulders: 0xb0b5bc, weapon: 'sword', blade: 0xe0e6ee, belt: 0x5a3b23, hair: 0x2a1a10, eyeColor: 0xffffff, eyeSize: 0.026, brows: 0x2a1a10, mouth: { w: 0.3, y: -0.45 }, greaves: 0xb0b5bc, bracers: 0xb0b5bc, sleeves: 0x8a2a2a, gloves: 0x3a2a1a }),
  // Monk: saffron robes, shaved head with a topknot, quarterstaff, prayer beads.
  'monk': (B) => humanoid(B, { skin: 0xd9a77a, cloth: 0xc47a2a, legs: 0xc47a2a, torso: 'robe', belt: 0x5a3b23, buckle: 0x5a3b23, weapon: 'staff', weaponPitch: 0.3, eyeColor: 0xffffff, eyeSize: 0.026, sleeves: 0xc47a2a, hair: 0x1a1010, topknot: true, mouth: { w: 0.3, y: -0.45 }, sash: 0x8a4a1a, necklace: true, foreRestR: { rx: -1.2 } }),
  // Dark warrior: black spiked plate, horned full helm with a burning red visor, greatsword and blood cape.
  'dark-warrior': (B) => humanoid(B, { skin: 0x1a1a1e, cloth: 0x2a2a36, legs: 0x1c1c24, boots: 0x121218, armor: 0x3c3c4c, armorTrim: 0x8a2030, shoulders: 0x3c3c4c, spikes: 0x585868, helmet: { type: 'full', color: 0x3c3c4c, horns: 0x585868, visor: 0xff3a2a }, weapon: 'greatsword', blade: 0x7a7a90, guard: 0x585868, cape: 0x4a1018, capeTint: 0x1a0608, eyes: false, sleeves: 0x2a2a36, gloves: 0x2a2a36, greaves: 0x3c3c4c, bracers: 0x3c3c4c, belt: 0x1c1c24, buckle: 0x8a2030, bodyW: 0.34, bodyH: 0.36 }),
  // Assassin: hooded and masked in black-violet, crouched, twin daggers, lavender eyes, tattered cloak.
  'assassin': (B) => humanoid(B, { skin: 0x3a3438, cloth: 0x1e1a24, legs: 0x16121c, hood: 0x2a2436, mask: 0x4a4060, face: 0x14101c, cape: 0x2a2436, capeTint: 0x0c0a10, weapon: 'dagger', offhand: 'dagger', blade: 0x9aa4b4, bodyW: 0.26, eyeColor: 0xb197fc, eyeSize: 0.03, sleeves: 0x1e1a24, gloves: 0x16121c, hunch: 0.8, straps: 0x2a2434, foreRestL: { rx: -1.1 }, foreRestR: { rx: -1.1 } }),
  // War lord: towering in gold-chased plate, horned helm with a red plume, greatsword and tower shield.
  'war-lord': (B) => humanoid(B, { skin: 0xd9a77a, cloth: 0x6c1f1f, legs: 0x2a2a2a, bodyW: 0.4, bodyH: 0.42, legLen: 0.32, armor: 0xb08d3c, armorTrim: 0x6c1f1f, shoulders: 0xb08d3c, spikes: 0xe8dcc0, helmet: { type: 'open', color: 0xb08d3c, horns: 0xe8dcc0, plume: 0xb02020, band: 0x6c1f1f }, cape: 0x8a1e1e, capeTint: 0x3a0a0a, capeExtra: 0.06, weapon: 'greatsword', blade: 0xd8dde4, guard: 0xb08d3c, offhand: 'towershield', shieldColor: 0x6c1f1f, eyeColor: 0xffd05a, eyeSize: 0.028, brows: 0x3a2a1a, greaves: 0xb08d3c, bracers: 0xb08d3c, belt: 0x2a2a2a, buckle: 0xb08d3c, beard: 0x3a2a1a, beardLong: 0.6 }),
  // Mage: midnight-blue robes, starred pointed hat, long white beard, staff with a crackling orb.
  'mage': (B) => humanoid(B, { skin: 0xd9a77a, cloth: 0x2f3f8a, legs: 0x2f3f8a, torso: 'robe', hat: 0x2f3f8a, hatBand: C.gold, beard: 0xdddddd, beardLong: 1.6, weapon: 'staff', weaponPitch: 0.3, orb: 0x7fd4ff, orbCage: C.gold, belt: 0xb08d3c, eyeColor: 0x9fe0ff, eyeSize: 0.026, brows: 0xdddddd, sleeves: 0x2f3f8a, offhand: 'orb', foreRestR: { rx: -1.2 }, foreRestL: { rx: -1.4 }, extra: (B, r) => { for (let i = 0; i < 4; i++) B.add('body', P.oct, C.gold, { x: Math.sin(i * 1.7) * r.bodyW * 0.7, y: -r.hip * 0.3 + i * 0.05, z: Math.cos(i * 1.7) * r.bodyW * 0.6, sx: 0.025, sy: 0.035, sz: 0.01, grad: 0 }); } }),
};

/** Animation family per type (default 'biped'). */
export const ANIM_KIND = {
  'dire-wolf': 'quadruped', 'wyvern': 'drake', 'shadow-dragon': 'drake', 'fyre-drake': 'drake', 'dimension-spider': 'spider',
  'gargoyle': 'winged', 'demon': 'winged',
};

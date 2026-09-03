// CharacterFactory: builds the player and every monster from the procedural species rigs in
// charBuilders.js (shared, cached geometry per type; one merged mesh per rig node with a body
// material + an inverted-hull outline) and drives all procedural animation: idle breathing and
// weight shifts, knee/elbow walk cycles with lean and cape flutter, wind-up/strike/recover attacks,
// squash-and-knockback hurt, buckle-and-topple deaths with fade, spawn rise, hover/flap/gallop/
// tripod gaits for the beast families.
import * as THREE from 'three';
import { createCharacterMaterial } from './materials.js';
import { RigBuilder, createOutlineMaterial } from './charParts.js';
import { BUILDERS, ANIM_KIND } from './charBuilders.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
/** 0→1 over [a,b], smoothed. */
const ramp = (k, a, b) => smooth((k - a) / (b - a));
/** Attack styles: how the weapon arm moves. */
const ATTACK_STYLE = {
  'player': 'chop', 'hobgoblin': 'thrust', 'rogue': 'thrust', 'assassin': 'thrust', 'elvin-ranger': 'thrust', 'monk': 'thrust',
  'mage': 'cast', 'werebear': 'maul', 'troll': 'maul', 'gargoyle': 'maul', 'ogre': 'swing', 'demon': 'swing',
};

export class CharacterFactory {
  /** @param {import('./lighting.js').FogOfWar} fog */
  constructor(fog) {
    this.fog = fog;
    this.geoCache = new Map();
    this.sizeMul = 1.2;
  }

  /** Build (or reuse) merged geometry per node for a type. */
  rigGeometry(type) {
    let cached = this.geoCache.get(type);
    if (cached) return cached;
    const B = new RigBuilder();
    (BUILDERS[type] || BUILDERS.hobgoblin)(B);
    cached = B.build();
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
    const outline = createOutlineMaterial();
    const glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    glow.color.setScalar(2.4);
    const nodes = {};
    const root = new THREE.Group();
    root.name = `char:${entity.id}`;
    nodes.root = root;
    const bones = [];
    for (const b of spec.bones) {
      const bone = new THREE.Bone();
      bone.name = b.name;
      bone.position.set(b.pos[0], b.pos[1], b.pos[2]);
      bone.rotation.set(b.rot[0], b.rot[1], b.rot[2]);
      (nodes[b.parent] || root).add(bone);
      bone.userData.rest = { pos: bone.position.clone(), rot: bone.rotation.clone() };
      nodes[b.name] = bone;
      bones.push(bone);
    }
    root.position.set(entity.x, 0, entity.y);
    const mesh = new THREE.SkinnedMesh(spec.geometry, [material, outline, glow]);
    mesh.castShadow = true; mesh.receiveShadow = false; mesh.frustumCulled = false;
    root.add(mesh);
    root.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    const size = (entity.size || 1) * this.sizeMul;
    root.scale.setScalar(size);
    const kind = type === 'player' ? 'biped' : (ANIM_KIND[type] || 'biped');
    const view = {
      root, nodes, material, outline, glow, mesh, kind, entity, type, size,
      style: ATTACK_STYLE[type] || 'swing',
      anim: { t: entity.id ? hash(entity.id) * 10 : 0, walk: 0, alert: 0, attack: 0, attackDir: 0, hurt: 0, dead: 0, spawn: 0, flash: 0, moving: false, dying: false, done: false, angle: 0, opacity: 1 },
      pos: new THREE.Vector3(entity.x, 0, entity.y), from: null, to: null, moveT: 1, moveDur: 0.2,
    };
    view.anim.angle = Math.atan2(entity.facing?.dx || 0, entity.facing?.dy || 1);
    root.rotation.y = view.anim.angle;
    root.position.copy(view.pos);
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
  die(view) { if (view.anim.dying) return; view.anim.dying = true; view.anim.dead = 0; view.material.transparent = true; view.glow.transparent = true; }
  spawn(view) { view.anim.spawn = 0.0001; }

  /**
   * Advance animation. ctx: {invisible:boolean}
   */
  update(view, dt, ctx = {}) {
    const a = view.anim, n = view.nodes, e = view.entity;
    a.t += dt;
    // position interpolation (ease so steps read as a push-off, not a slide)
    if (view.from && view.to) {
      view.moveT = Math.min(1, view.moveT + dt / view.moveDur);
      const k = view.moveT;
      view.pos.lerpVectors(view.from, view.to, k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
      if (k >= 1) { view.from = view.to = null; }
    } else if (e) {
      if (Math.abs(view.pos.x - e.x) > 1.5 || Math.abs(view.pos.z - e.y) > 1.5) view.pos.set(e.x, 0, e.y);
    }
    a.moving = !!(view.from && view.to);
    if (e) { e.px = view.pos.x; e.py = view.pos.z; }
    a.walk += ((a.moving ? 1 : 0) - a.walk) * Math.min(1, dt * 14);
    const alertT = e && (e.state === 'hunt' || e.state === 'attack') && !a.dying ? 1 : 0;
    a.alert += (alertT - a.alert) * Math.min(1, dt * 4);
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
    root.scale.setScalar(view.size);
    for (const k in n) { if (k === 'root') continue; const o = n[k]; o.position.copy(o.userData.rest.pos); o.rotation.copy(o.userData.rest.rot); }
    const t = a.t, w = a.walk, al = a.alert;
    const ph = t * 11.5;
    const breathe = Math.sin(t * 2.1) * 0.011;
    switch (view.kind) {
      case 'biped': case 'winged': this.animBiped(view, t, w, al, ph, breathe); break;
      case 'quadruped': this.animQuadruped(view, t, w, al, ph, breathe); break;
      case 'drake': this.animDrake(view, t, w, al, ph, breathe); break;
      case 'spider': this.animSpider(view, t, w, al, ph, breathe); break;
      default: break;
    }
    if (a.attack > 0) this.animAttack(view, dt);
    // hurt: flash, knock-back, squash and a lean away from the blow
    if (a.hurt > 0) {
      a.hurt = Math.max(0, a.hurt - dt / 0.28);
      const r = Math.sin(a.hurt * Math.PI);
      root.position.x -= Math.sin(a.angle) * r * 0.14; root.position.z -= Math.cos(a.angle) * r * 0.14;
      root.scale.set(view.size * (1 + r * 0.1), view.size * (1 - r * 0.12), view.size * (1 + r * 0.1));
      if (n.body) n.body.rotation.x -= r * 0.35;
      if (n.head) n.head.rotation.x -= r * 0.3;
    }
    if (a.flash > 0) a.flash = Math.max(0, a.flash - dt / 0.18);
    view.material.emissive.setRGB(a.flash * 0.55, a.flash * 0.14, a.flash * 0.08);
    view.material.emissiveIntensity = 1;
    // spawn: rise out of the floor with a little overshoot
    if (a.spawn > 0) {
      a.spawn += dt / 0.5;
      const k = Math.min(1, a.spawn);
      const s = k < 0.8 ? k / 0.8 : 1 + Math.sin((k - 0.8) / 0.2 * Math.PI) * 0.08;
      root.scale.multiplyScalar(0.25 + 0.75 * s);
      root.position.y -= (1 - smooth(k)) * 0.45;
      if (k >= 1) a.spawn = 0;
    }
    if (a.dying) this.animDeath(view, dt);
    // opacity: death fade and invisibility shimmer
    let op = a.dying ? a.opacity : 1;
    if (ctx.invisible) op = Math.min(op, 0.3 + 0.08 * Math.sin(t * 9));
    if (op < 1) {
      view.material.transparent = true; view.material.opacity = op;
      view.glow.transparent = true; view.glow.opacity = op;
    } else if (view.material.transparent) {
      view.material.opacity = 1; view.material.transparent = false;
      view.glow.opacity = 1; view.glow.transparent = false;
    }
    view.outline.uniforms.uOpacity.value = op >= 1 ? 1 : op * 0.6;
  }

  animBiped(view, t, w, al, ph, breathe) {
    const n = view.nodes, isPlayer = view.type === 'player';
    const flee = view.entity && view.entity.state === 'flee' ? 1 : 0;
    // idle: breathe through the chest, shoulders rise, subtle weight shift
    n.body.position.y += breathe;
    n.body.rotation.z += Math.sin(t * 0.9) * 0.02;
    if (n.head) { n.head.position.y += breathe * 0.4; n.head.rotation.y += Math.sin(t * 0.7) * 0.1 + flee * 0.5; n.head.rotation.z += Math.sin(t * 0.5) * 0.03; }
    if (n.armL) { n.armL.rotation.z -= breathe * 1.5; n.armR.rotation.z += breathe * 1.5; }
    // alert (hunting): lean in, bring the weapon up
    n.body.rotation.x += al * 0.12 - flee * 0.1;
    if (!isPlayer && n.armR) { n.armR.rotation.x -= al * 0.55; if (n.foreR) n.foreR.rotation.x -= al * 0.3; }
    if (n.armL && !isPlayer) n.armL.rotation.x -= al * 0.2;
    // walk: bob, lean, roll, knees and elbows
    const bob = Math.abs(Math.sin(ph)) * 0.05 * w;
    n.body.position.y += bob;
    n.body.rotation.x += 0.13 * w;
    n.body.rotation.z += Math.sin(ph) * 0.045 * w;
    if (n.head) n.head.rotation.z -= Math.sin(ph) * 0.03 * w;
    const s = Math.sin(ph), c = Math.cos(ph);
    if (n.legL) {
      n.legL.rotation.x += s * 0.72 * w; n.legR.rotation.x -= s * 0.72 * w;
      if (n.shinL) { n.shinL.rotation.x += Math.max(0, -c) * 0.95 * w; n.shinR.rotation.x += Math.max(0, c) * 0.95 * w; }
    }
    if (n.armL) {
      n.armL.rotation.x -= s * 0.5 * w; n.armR.rotation.x += s * (isPlayer ? 0.12 : 0.42) * w;
      if (n.foreL) n.foreL.rotation.x -= Math.max(0, -s) * 0.3 * w;
    }
    if (n.cape) { n.cape.rotation.x += 0.4 * w + 0.05 * Math.sin(t * 3.1) + 0.03 * Math.sin(t * 5.7); n.cape.rotation.z += Math.sin(t * 2.3) * 0.03; }
    if (n.wingL) {
      const f = Math.sin(t * 4.2) * (0.35 + 0.3 * w) + 0.15;
      n.wingL.rotation.z -= f; n.wingR.rotation.z += f;
      n.body.position.y += Math.max(0, Math.sin(t * 4.2)) * 0.02;
    }
    if (n.tail) { n.tail.rotation.y += Math.sin(t * 2.6) * 0.45; if (n.tail2) n.tail2.rotation.y += Math.sin(t * 2.6 - 1.2) * 0.5; }
  }

  animQuadruped(view, t, w, al, ph, breathe) {
    const n = view.nodes;
    n.body.position.y += breathe * 1.5 + Math.abs(Math.sin(ph)) * 0.035 * w;
    n.body.rotation.x += Math.sin(ph * 1) * 0.03 * w;
    n.neck.rotation.x += Math.sin(t * 1.5) * 0.06 - w * 0.25 - al * 0.35;
    n.head.rotation.y += Math.sin(t * 0.7) * 0.18 * (1 - w);
    n.head.rotation.x += Math.sin(t * 2.3) * 0.04 + al * 0.1;
    const s = Math.sin(ph), c = Math.cos(ph);
    for (const [leg, sign] of [['FL', 1], ['BR', 1], ['FR', -1], ['BL', -1]]) {
      const ss = s * sign, cc = c * sign;
      n[`leg${leg}`].rotation.x += ss * 0.62 * w;
      n[`shin${leg}`].rotation.x += Math.max(0, -cc) * 0.8 * w;
    }
    n.tail.rotation.y += Math.sin(t * 4) * 0.3; n.tail.rotation.x += Math.sin(t * 1.3) * 0.1 - al * 0.3;
    n.tail2.rotation.y += Math.sin(t * 4 - 1) * 0.4;
  }

  animDrake(view, t, w, al, ph, breathe) {
    const n = view.nodes;
    const fr = 7.5 + w * 3;
    const f = Math.sin(t * fr);
    n.body.position.y += 0.14 + f * 0.045 + breathe;
    n.body.rotation.x += w * 0.18 + Math.sin(t * 1.1) * 0.03;
    n.wingL.rotation.z -= f * 0.65 + 0.2; n.wingR.rotation.z += f * 0.65 + 0.2;
    n.wingL.rotation.x += Math.max(0, f) * 0.15; n.wingR.rotation.x += Math.max(0, f) * 0.15;
    n.neck.rotation.x += Math.sin(t * 1.3) * 0.08 - al * 0.15;
    n.neck2.rotation.x += Math.sin(t * 1.3 + 0.6) * 0.08 - al * 0.1;
    n.head.rotation.y += Math.sin(t * 0.9) * 0.2 * (1 - w);
    n.tail.rotation.y += Math.sin(t * 2.5) * 0.3; n.tail2.rotation.y += Math.sin(t * 2.5 - 1.1) * 0.45;
    n.tail.rotation.x += Math.sin(t * 1.7) * 0.08;
    n.legL.rotation.x += 0.35 + w * 0.3 + Math.sin(t * fr) * 0.05; n.legR.rotation.x += 0.35 + w * 0.3 + Math.sin(t * fr + 0.4) * 0.05;
  }

  animSpider(view, t, w, al, ph, breathe) {
    const n = view.nodes;
    n.body.position.y += breathe * 1.5 + Math.abs(Math.sin(ph)) * 0.02 * w;
    n.head.rotation.x += Math.sin(t * 2) * 0.05 + al * 0.2;
    for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) {
      const side = sx < 0 ? 'L' : 'R';
      const leg = n[`leg${i}${side}`], knee = n[`knee${i}${side}`];
      const group = (i + (sx < 0 ? 0 : 1)) % 2; // tripod gait: alternate legs per side
      const phase = ph + group * Math.PI;
      const lift = Math.max(0, Math.sin(phase));
      leg.rotation.z += sx * (lift * 0.4 * w + Math.sin(t * 3 + i * 1.3) * 0.035);
      leg.rotation.y -= sx * Math.cos(phase) * 0.28 * w;
      knee.rotation.z -= sx * lift * 0.5 * w;
    }
  }

  animAttack(view, dt) {
    const a = view.anim, n = view.nodes, root = view.root;
    a.attack += dt / 0.42;
    const k = Math.min(1, a.attack);
    const wind = ramp(k, 0, 0.32), strike = ramp(k, 0.32, 0.5), rec = ramp(k, 0.55, 1);
    const lunge = Math.sin(clamp01((k - 0.15) / 0.7) * Math.PI) * 0.3;
    root.position.x += Math.sin(a.attackDir) * lunge; root.position.z += Math.cos(a.attackDir) * lunge;
    switch (view.kind) {
      case 'biped': case 'winged': {
        const st = view.style;
        if (st === 'chop') { // the hero: overhead sword comes down and across
          n.armR.rotation.x += -wind * 0.5 + strike * 2.4 - rec * 1.9;
          n.armR.rotation.z += wind * 0.4 - strike * 0.9 + rec * 0.5;
          if (n.foreR) n.foreR.rotation.x += -wind * 0.4 + strike * 0.5 - rec * 0.1;
          n.body.rotation.y += wind * 0.4 - strike * 0.75 + rec * 0.35;
          n.body.rotation.x += -wind * 0.12 + strike * 0.4 - rec * 0.28;
          if (n.armL) n.armL.rotation.x += wind * 0.2 - strike * 0.5 + rec * 0.3;
        } else if (st === 'thrust') { // daggers/spear/staff: quick stab with the elbow straightening
          n.armR.rotation.x += wind * 0.9 - strike * 2.6 + rec * 1.7;
          if (n.foreR) n.foreR.rotation.x += -wind * 0.9 + strike * 1.5 - rec * 0.6;
          n.body.rotation.y += wind * 0.35 - strike * 0.7 + rec * 0.35;
          n.body.rotation.x += strike * 0.3 - rec * 0.3;
          if (n.armL) { n.armL.rotation.x += wind * 0.5 - strike * 1.4 + rec * 0.9; if (n.foreL) n.foreL.rotation.x += -wind * 0.6 + strike * 0.8 - rec * 0.2; }
        } else if (st === 'cast') { // mage: both hands thrust forward, orb flares
          for (const arm of ['armL', 'armR']) { n[arm].rotation.x += wind * 0.6 - strike * 2.3 + rec * 1.7; }
          for (const f of ['foreL', 'foreR']) if (n[f]) n[f].rotation.x += -wind * 0.7 + strike * 1.6 - rec * 0.9;
          n.body.rotation.x += -wind * 0.15 + strike * 0.35 - rec * 0.2;
          if (n.head) n.head.rotation.x += -wind * 0.2 + strike * 0.3 - rec * 0.1;
          view.glow.color.setScalar(2.4 + Math.sin(k * Math.PI) * 3);
        } else if (st === 'maul') { // both arms rise and slam down
          for (const arm of ['armL', 'armR']) { n[arm].rotation.x += wind * 2.6 - strike * 3.8 + rec * 1.2; n[arm].rotation.z += 0; }
          for (const f of ['foreL', 'foreR']) if (n[f]) n[f].rotation.x += -wind * 1.0 + strike * 0.9 + rec * 0.1;
          n.body.rotation.x += -wind * 0.35 + strike * 0.85 - rec * 0.5;
          if (n.head) n.head.rotation.x += -wind * 0.3 + strike * 0.5 - rec * 0.2;
        } else { // swing: wind the weapon back over the shoulder and cut across
          n.armR.rotation.x += wind * 2.5 - strike * 3.6 + rec * 1.1;
          n.armR.rotation.z += -wind * 0.6 + strike * 0.9 - rec * 0.3;
          if (n.foreR) n.foreR.rotation.x += -wind * 1.1 + strike * 1.1;
          n.body.rotation.y += wind * 0.45 - strike * 0.95 + rec * 0.5;
          n.body.rotation.x += -wind * 0.15 + strike * 0.45 - rec * 0.3;
          if (n.armL) n.armL.rotation.x += -wind * 0.4 + strike * 0.6 - rec * 0.2;
        }
        if (n.head) n.head.rotation.x += strike * 0.15 - rec * 0.15;
        if (n.wingL) { const sp = wind * 0.7 - rec * 0.7; n.wingL.rotation.z -= sp; n.wingR.rotation.z += sp; }
        if (n.cape) n.cape.rotation.x += strike * 0.5 - rec * 0.5;
        break;
      }
      case 'quadruped': { // pounce and bite
        n.neck.rotation.x += -wind * 0.6 + strike * 1.1 - rec * 0.5;
        n.head.rotation.x += -wind * 0.3 + strike * 0.6 - rec * 0.3;
        n.body.rotation.x += -wind * 0.25 + strike * 0.45 - rec * 0.2;
        n.body.position.y += wind * 0.08 - rec * 0.08;
        for (const l of ['legFL', 'legFR']) n[l].rotation.x += -wind * 0.8 + strike * 0.9 - rec * 0.1;
        break;
      }
      case 'drake': { // rear the neck back, then snap forward with the jaws open
        n.neck.rotation.x += -wind * 0.7 + strike * 1.2 - rec * 0.5;
        n.neck2.rotation.x += -wind * 0.5 + strike * 0.9 - rec * 0.4;
        n.jaw.rotation.x += wind * 0.7 - rec * 0.7;
        n.body.rotation.x += -wind * 0.2 + strike * 0.35 - rec * 0.15;
        const sp = wind * 0.5 - rec * 0.5; n.wingL.rotation.z -= sp; n.wingR.rotation.z += sp;
        view.glow.color.setScalar(2.4 + Math.sin(k * Math.PI) * 2);
        break;
      }
      case 'spider': { // rear up on the back legs, front legs raised, then drop onto the prey
        n.body.rotation.x += -wind * 0.55 + strike * 0.8 - rec * 0.25;
        n.body.position.y += wind * 0.1 - rec * 0.1;
        n.head.rotation.x += wind * 0.3 - rec * 0.3;
        for (const sx of [-1, 1]) for (const i of [0, 1]) { const leg = n[`leg${i}${sx < 0 ? 'L' : 'R'}`]; leg.rotation.z += sx * (wind * 0.8 - rec * 0.8); leg.rotation.y -= sx * (wind * 0.4 - rec * 0.4); }
        break;
      }
      default: break;
    }
    if (k >= 1) { a.attack = 0; view.glow.color.setScalar(2.4); }
  }

  animDeath(view, dt) {
    const a = view.anim, n = view.nodes, root = view.root;
    a.dead += dt;
    const k1 = smooth(a.dead / 0.3);              // buckle
    const k2 = ramp(a.dead, 0.2, 0.75);            // topple
    const k3 = clamp01((a.dead - 1.7) / 0.8);      // after lingering on the floor: fade + sink
    switch (view.kind) {
      case 'biped': case 'winged': {
        if (n.legL) { n.legL.rotation.x -= k1 * 0.6; n.legR.rotation.x -= k1 * 0.5; if (n.shinL) { n.shinL.rotation.x += k1 * 1.3; n.shinR.rotation.x += k1 * 1.1; } }
        root.position.y -= k1 * 0.16;
        n.body.rotation.x += k1 * 0.5;
        if (n.head) n.head.rotation.x += k1 * 0.6;
        if (n.armL) { n.armL.rotation.x -= k1 * 0.6; n.armR.rotation.x -= k1 * 0.4; n.armL.rotation.z += k1 * 0.4; n.armR.rotation.z -= k1 * 0.4; }
        root.rotation.x += k2 * k2 * Math.PI * 0.5; // falls forward onto its face
        root.rotation.z += k2 * 0.25;
        root.position.y += k2 * 0.05;
        if (n.wingL) { n.wingL.rotation.z -= k1 * 0.5; n.wingR.rotation.z += k1 * 0.5; }
        break;
      }
      case 'quadruped': {
        for (const l of ['FL', 'FR', 'BL', 'BR']) { n[`leg${l}`].rotation.x += k1 * 0.5 * (l[0] === 'F' ? -1 : 1); n[`shin${l}`].rotation.x += k1 * 0.9; }
        root.position.y -= k1 * 0.14;
        n.neck.rotation.x += k1 * 0.8;
        root.rotation.z += k2 * k2 * Math.PI * 0.5; // rolls onto its side
        root.position.y += k2 * 0.12;
        break;
      }
      case 'drake': {
        n.body.position.y -= k1 * 0.16; // drops out of its hover
        n.neck.rotation.x += k1 * 0.6; n.neck2.rotation.x += k1 * 0.5;
        n.wingL.rotation.z += k1 * 0.4; n.wingR.rotation.z -= k1 * 0.4;
        n.wingL.rotation.x += k1 * 0.8; n.wingR.rotation.x += k1 * 0.8;
        root.rotation.z += k2 * k2 * Math.PI * 0.45;
        root.position.y += k2 * 0.1;
        n.jaw.rotation.x += k1 * 0.5;
        break;
      }
      case 'spider': {
        for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) { const s = sx < 0 ? 'L' : 'R'; n[`leg${i}${s}`].rotation.z += sx * k1 * 0.9; n[`knee${i}${s}`].rotation.z -= sx * k1 * 1.4; } // legs curl under
        root.position.y -= k1 * 0.1;
        root.rotation.z += k2 * k2 * Math.PI * 0.6;
        root.position.y += k2 * 0.2;
        break;
      }
      default: root.rotation.x += k2 * k2 * Math.PI * 0.5; break;
    }
    a.opacity = 1 - k3;
    root.position.y -= k3 * k3 * 0.35;
    if (k3 >= 1) a.done = true;
  }

  dispose(view) { view.material.dispose(); view.outline.dispose(); view.glow.dispose(); if (view.mesh.skeleton) view.mesh.skeleton.dispose(); }
}

function hash(s) { let h = 0; for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) >>> 0; return (h % 1000) / 1000; }

export { BUILDERS };

// Effects: layered, readable game-event VFX in the style of an action RPG — every beat stacks a
// flash sprite, particles (additive glow + alpha-blended matter), a shock ring / ground rune, a
// short point-light pulse, floating text, and camera shake / screen flash requests for the camera
// and grading pass. Persistent status visuals (shield bubble, regeneration helix, invisibility
// shimmer, drift feathers, the Sword's aura) live here too, as does the prop animator tick.
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { COLORS } from '../core/constants.js';
import { ParticlePool } from './particles.js';
import { DamageNumbers } from './damageNumbers.js';
import { ITEM_TABLE, SPELL_TABLE } from '../game/items.js';
import { attachFog, glowTexture, splatTexture, runeCircleTexture } from './propFx.js';
import { updateProps, getPropFactory } from './props.js';

const easeOut = (k) => 1 - (1 - k) * (1 - k);
const easeOutBack = (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };

/** Soft-edged vertical light beam: fades with height and toward the silhouette. */
function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0.9 }, uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() { float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); float h = pow(1.0 - vUv.y, 1.3); float streak = 0.75 + 0.25 * sin(vUv.x * 40.0 + uTime * 6.0 - vUv.y * 12.0);
        gl_FragColor = vec4(uColor * 1.6, f * h * streak * uOpacity); }`,
  });
}

/** Shield bubble: fresnel rim, drifting lattice, scan band; uHit flashes it white when a blow is absorbed. */
function bubbleMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xffd43b) }, uTime: { value: 0 }, uHit: { value: 0 }, uFade: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, toneMapped: false,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vL;
      void main() { vL = position; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uHit; uniform float uFade; varying vec3 vN; varying vec3 vV; varying vec3 vL;
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
        float l1 = smoothstep(0.93, 1.0, abs(sin((vL.x + vL.z) * 14.0 + vL.y * 6.0 + uTime * 0.8)));
        float l2 = smoothstep(0.93, 1.0, abs(sin((vL.x - vL.z) * 14.0 - vL.y * 6.0 - uTime * 0.6)));
        float lat = max(l1, l2) * (0.25 + fres * 0.5);
        float scan = smoothstep(0.92, 1.0, sin(vL.y * 7.0 - uTime * 2.6)) * 0.3;
        float a = (0.08 + fres * 1.1 + lat * 1.3 + scan) * uFade;
        vec3 col = mix(uColor, vec3(1.0), uHit * 0.85 + fres * 0.25) * (1.6 + uHit * 2.5);
        gl_FragColor = vec4(col * a, a);
      }`,
  });
}

/** Pool of additive sprites for impact flashes and bloom cores. */
class FlashPool {
  constructor(scene, n = 14) {
    this.items = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 });
      const s = new THREE.Sprite(m); s.visible = false; s.renderOrder = 12;
      scene.add(s); this.items.push({ s, t: 0, dur: 0, on: false });
    }
    this.cursor = 0;
  }
  play({ x, y = 0.5, z, color = 0xffffff, size0 = 0.2, size1 = 1, dur = 0.16, intensity = 1.6, opacity = 1, tex = null }) {
    const it = this.items[this.cursor]; this.cursor = (this.cursor + 1) % this.items.length;
    it.s.material.map = tex || glowTexture();
    it.s.material.color.set(color).multiplyScalar(intensity);
    it.s.position.set(x, y, z); it.s.visible = true;
    Object.assign(it, { t: 0, dur, on: true, size0, size1, opacity });
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.on) continue;
      it.t += dt; const k = Math.min(1, it.t / it.dur);
      const s = it.size0 + (it.size1 - it.size0) * easeOut(k);
      it.s.scale.set(s, s, 1); it.s.material.opacity = it.opacity * Math.pow(1 - k, 1.4);
      if (k >= 1) { it.on = false; it.s.visible = false; }
    }
  }
}

/** Pool of flat additive meshes (rings, runes, slash arcs, decals) with per-item material. */
class FlatPool {
  constructor(scene, geometry, n, { blending = THREE.AdditiveBlending, map = null, renderOrder = 4, y = 0.02 } = {}) {
    this.items = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.MeshBasicMaterial({ map, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending, side: THREE.DoubleSide });
      m.toneMapped = false;
      const mesh = new THREE.Mesh(geometry, m); mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; mesh.visible = false; mesh.renderOrder = renderOrder;
      mesh.castShadow = mesh.receiveShadow = false;
      scene.add(mesh); this.items.push({ m: mesh, t: 0, dur: 0, on: false, fn: null });
    }
    this.cursor = 0; this.y = y;
  }
  /** @returns {THREE.Mesh} */
  play({ x, z, y = this.y, color = 0xffffff, dur = 0.5, intensity = 1.5, fn }) {
    const it = this.items[this.cursor]; this.cursor = (this.cursor + 1) % this.items.length;
    it.m.material.color.set(color).multiplyScalar(intensity);
    it.m.position.set(x, y, z); it.m.visible = true; it.m.rotation.set(-Math.PI / 2, 0, 0); it.m.scale.setScalar(1);
    Object.assign(it, { t: 0, dur, on: true, fn });
    return it.m;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.on) continue;
      it.t += dt; const k = Math.min(1, it.t / it.dur);
      it.fn(it.m, k, it.t);
      if (k >= 1) { it.on = false; it.m.visible = false; }
    }
  }
}

/** Two pooled point lights for short pulses (added at construction so shaders compile once). */
class LightPool {
  constructor(scene) {
    this.items = [];
    for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xffffff, 0, 5, 2); scene.add(l); this.items.push({ l, t: 0, dur: 0, i0: 0, on: false }); }
    this.cursor = 0;
  }
  pulse({ x, y = 0.8, z, color = 0xffffff, intensity = 8, dur = 0.2, distance = 5 }) {
    const it = this.items[this.cursor]; this.cursor = (this.cursor + 1) % this.items.length;
    it.l.position.set(x, y, z); it.l.color.set(color); it.l.distance = distance; it.l.intensity = intensity;
    Object.assign(it, { t: 0, dur, i0: intensity, on: true });
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.on) continue;
      it.t += dt; const k = Math.min(1, it.t / it.dur);
      it.l.intensity = it.i0 * (1 - k) * (1 - k);
      if (k >= 1) { it.on = false; it.l.intensity = 0; }
    }
  }
}

export class Effects {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./lighting.js').FogOfWar} fog
   * @param {import('../core/events.js').EventBus} bus
   */
  constructor(scene, fog, bus) {
    this.scene = scene; this.fog = fog; this.bus = bus;
    attachFog(fog);
    this.rng = createRng('fargoal-effects');
    this.particles = new ParticlePool(fog, { max: 4000, blending: 'add' });
    this.matter = new ParticlePool(fog, { max: 1500, blending: 'matter' });
    scene.add(this.particles.points); scene.add(this.matter.points);
    this.numbers = new DamageNumbers(scene, this.rng);
    this.flashes = new FlashPool(scene, 14);
    this.rings = new FlatPool(scene, new THREE.RingGeometry(0.82, 1, 56), 8, { renderOrder: 5 });
    this.runes = new FlatPool(scene, new THREE.PlaneGeometry(1, 1), 6, { map: runeCircleTexture(), renderOrder: 4 });
    this.arcs = new FlatPool(scene, new THREE.RingGeometry(0.62, 1, 32, 1, 0, Math.PI * 0.85), 6, { renderOrder: 11, y: 0.55 });
    this.decals = new FlatPool(scene, new THREE.PlaneGeometry(1, 1), 10, { map: splatTexture(), blending: THREE.NormalBlending, renderOrder: 2, y: 0.018 });
    this.lights = new LightPool(scene);
    this.shakeRequest = 0;
    this.flash = { color: new THREE.Color(0, 0, 0), amount: 0 };
    this.time = 0;
    this.playerPos = new THREE.Vector3();
    this.prevPlayerPos = new THREE.Vector3(); this.playerVel = new THREE.Vector3(); this.hadPlayer = false;
    this.timers = { regen: 0, drift: 0, sword: 0, invis: 0, gold: 0, trail: 0, shieldGlint: 0, shieldFade: 0, regenFade: 0 };
    this.transients = []; // {obj, t, dur, fn}
    /** entity id -> world position resolver (set by renderer) */
    this.resolve = (e) => new THREE.Vector3(e.px ?? e.x, 0, e.py ?? e.y);
    this.game = null;
    this.shieldHit = 0;
    // shield bubble
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(0.72, 32, 22), bubbleMaterial());
    this.shield.visible = false; this.shield.renderOrder = 8; this.shield.castShadow = false;
    scene.add(this.shield);
    // persistent status runes under the player (shield: gold, regeneration: green)
    this.statusRunes = {};
    for (const [k, c] of [['shield', 0xffd43b], ['regeneration', 0x69db7c]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: runeCircleTexture(), color: c, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.material.toneMapped = false; m.rotation.x = -Math.PI / 2; m.position.y = 0.022; m.visible = false; m.renderOrder = 4;
      scene.add(m); this.statusRunes[k] = m;
    }
    this.unsub = [];
    this.bind();
  }

  bind() {
    const on = (n, f) => this.unsub.push(this.bus.on(n, f));
    on('entity:attacked', (p) => this.onAttacked(p));
    on('entity:died', (p) => { const v = this.resolve(p.entity); this.deathPuff(v.x, v.z, p.entity); });
    on('spell:cast', (p) => this.onSpell(p));
    on('fx:teleport', (p) => this.teleport(p.from, p.to));
    on('fx:levelup', (p) => this.levelUp(p.x, p.y)); // levelUp() already shouts LEVEL UP!
    on('fx:explosion', (p) => this.explosion(p.x, p.y));
    on('fx:fall', (p) => { this.dust(p.x, p.y, 40); this.rings.play({ x: p.x, z: p.y, color: 0x8a7a68, dur: 0.5, intensity: 0.5, fn: (m, k) => { m.scale.setScalar(0.3 + k * 1.6); m.material.opacity = 0.6 * (1 - k); } }); });
    on('fx:ceiling', (p) => { this.dust(p.x, p.y, 70); this.matter.emit({ x: p.x, y: 2.5, z: p.y, count: 30, color: [0x6a6058, 0x4a4038], speed: 0.6, up: -0.5, life: 1.2, size: 0.09, gravity: -6, drag: 0.5, radius: 0.3, bounce: 0.2 }, this.rng); this.shakeRequest += 0.7; this.flash.color.set(0.6, 0.6, 0.6); this.flash.amount = 0.5; });
    on('fx:chest', (p) => this.chestOpen(p.x, p.y));
    on('fx:blink', (p) => { this.burst(p.x, p.y, { color: [0xb197fc, 0x7f5fd0], count: 30, speed: 1.2, up: 1, life: 0.6, size: 0.1, y: 0.4, gravity: 0 }); this.flashes.play({ x: p.x, y: 0.5, z: p.y, color: 0xb197fc, size0: 0.3, size1: 1.2, dur: 0.25 }); });
    on('fx:sword-stolen', (p) => { this.burst(p.x, p.y, { color: [0x2a1040, 0x7a3ad0], count: 60, speed: 2.5, up: 2, life: 1.0, size: 0.14, y: 0.6 }); this.rings.play({ x: p.x, z: p.y, color: 0x7a3ad0, dur: 0.6, fn: (m, k) => { m.scale.setScalar(2.2 * (1 - easeOut(k)) + 0.2); m.material.opacity = 0.9 * k; } }); this.shakeRequest += 0.5; this.flash.color.set(0.3, 0, 0.5); this.flash.amount = 0.6; this.lights.pulse({ x: p.x, z: p.y, color: 0x7a3ad0, intensity: 14, dur: 0.6 }); });
    on('fx:mage', (p) => { this.castCore(p.x, p.y, 0x7fd4ff, 1.2); this.burst(p.x, p.y, { color: [0x7fd4ff, 0xffffff], count: 60, speed: 2, up: 3, life: 1.2, size: 0.12, y: 0.5, gravity: -0.5, kind: 2 }); });
    on('fx:demon', (p) => { this.burst(p.x, p.y, { color: [0xff3a2a, 0x3a0000], count: 80, speed: 2.5, up: 2, life: 1.2, size: 0.14, y: 0.5 }); this.matter.emit({ x: p.x, y: 0.4, z: p.y, count: 40, color: [0x1a0a0a, 0x3a1010], speed: 1.2, up: 1.8, life: 1.8, size: 0.28, gravity: 0.2, drag: 1, radius: 0.3, kind: 3 }, this.rng); this.flashes.play({ x: p.x, y: 0.7, z: p.y, color: 0xff3a2a, size0: 0.5, size1: 3, dur: 0.4 }); this.lights.pulse({ x: p.x, z: p.y, color: 0xff3a2a, intensity: 16, dur: 0.6 }); this.shakeRequest += 0.7; this.flash.color.set(0.5, 0, 0); this.flash.amount = 0.7; });
    on('sword:found', (p) => { this.swordFound(p.x, p.y); this.numbers.spawn(p.x, p.y, 'THE SWORD OF FARGOAL!', { style: 'banner', y: 1.8, life: 3.0, overHero: true }); });
    on('item:picked', (p) => this.onPicked(p));
    on('temple:sacrifice', (p) => { const v = this.playerPos; this.numbers.spawn(v.x, v.z, `SACRIFICED ${p?.gold ?? ''} GOLD`.replace('  ', ' '), { style: 'banner', y: 1.8, life: 2.2, overHero: true }); if (p?.xp) this.numbers.spawn(v.x, v.z, `+${p.xp} XP`, { style: 'magic', y: 0.8, life: 2.0 }); this.burst(v.x, v.z, { color: [0xffd866, 0xbfe6ff], count: 80, speed: 0.8, up: 3, life: 1.6, size: 0.1, gravity: 0.6, drag: 0.5, kind: 2 }); this.pillar(v.x, v.z, 0xbfe6ff, 1.6, 0.3); this.lights.pulse({ x: v.x, z: v.z, color: 0xbfe6ff, intensity: 10, dur: 0.8 }); });
    on('trap:triggered', (p) => { if (p.type === 'teleport') { this.castCore(p.x, p.y, 0x4ee1ff, 0.9); this.burst(p.x, p.y, { color: [0x4ee1ff, 0xffffff], count: 40, speed: 2, up: 2, life: 0.7, size: 0.1 }); } });
    on('monster:stole', (p) => { const v = this.resolve(p.entity); this.coinFountain(v.x, v.z, 14); this.numbers.spawn(v.x, v.z, `-${p.gold} gold`, { style: 'gold' }); });
    on('player:hp', (p) => { if (p.delta > 0 && p.source !== 'regen' && p.delta >= 5) { const v = this.playerPos; this.numbers.spawn(v.x, v.z, `+${p.delta}`, { style: 'heal' }); this.burst(v.x, v.z, { color: [0x69db7c, 0xd0ffd8], count: 30, speed: 0.6, up: 2, life: 1.2, size: 0.08, gravity: 0.3, drag: 0.8, y: 0.3, kind: 2 }); this.flashes.play({ x: v.x, y: 0.5, z: v.z, color: 0x69db7c, size0: 0.4, size1: 1.4, dur: 0.35, intensity: 1 }); } });
    on('level:enter', () => this.clearAll());
    on('fx:descend', () => { const v = this.playerPos; this.vortex(v.x, v.z, -1); });
    on('fx:ascend', () => { const v = this.playerPos; this.vortex(v.x, v.z, 1); });
    on('game:over', (p) => { if (p.victory) this.victory(); else this.playerDeath(); });
  }

  dispose() { this.clearAll(); for (const u of this.unsub) u(); }

  /** Drop every transient effect (new level / new game): particles, sprites, pooled meshes, lights, timers. */
  clearAll() {
    this.particles.life.fill(0); this.particles.alpha.fill(0); this.particles.geometry.setDrawRange(0, 0);
    this.matter.life.fill(0); this.matter.alpha.fill(0); this.matter.geometry.setDrawRange(0, 0);
    for (const s of this.numbers.active) { this.scene.remove(s); this.numbers.pool.push(s); }
    this.numbers.active.length = 0;
    for (const pool of [this.rings, this.runes, this.arcs, this.decals]) for (const it of pool.items) { it.on = false; it.m.visible = false; }
    for (const it of this.flashes.items) { it.on = false; it.s.visible = false; }
    for (const it of this.lights.items) { it.on = false; it.l.intensity = 0; }
    for (const tr of this.transients) { this.scene.remove(tr.obj); if (tr.obj.geometry) tr.obj.geometry.dispose(); if (tr.obj.material && tr.obj.material.dispose) tr.obj.material.dispose(); }
    this.transients.length = 0;
    this.timers.arrival = null; this.flashHomage = 0; this.shieldHit = 0; this.hadPlayer = false;
    this.flash.amount = 0;
  }

  /** World-space additive burst at a tile. */
  burst(x, z, o) {
    this.particles.emit({ x, y: o.y ?? 0.35, z, count: o.count ?? 30, color: o.color ?? 0xffffff, speed: o.speed ?? 1.5, spread: o.spread ?? 1, up: o.up ?? 1.5, life: o.life ?? 0.8, size: o.size ?? 0.08, gravity: o.gravity ?? -2.5, drag: o.drag ?? 1.5, radius: o.radius ?? 0.12, dir: o.dir, bright: o.bright, shrink: o.shrink, kind: o.kind ?? 0, bounce: o.bounce, ySpread: o.ySpread }, this.rng);
  }

  /** Alpha-blended dust cloud (matter pool). */
  dust(x, z, n) {
    this.matter.emit({ x, y: 0.25, z, count: n, color: [0x8a7a68, 0x5a4a3a, 0x6f6152], speed: 1.6, up: 1.2, life: 1.3, size: 0.24, gravity: -0.6, drag: 2, radius: 0.25, kind: 3 }, this.rng);
    this.matter.emit({ x, y: 0.1, z, count: Math.round(n * 0.4), color: [0x8a7a68, 0x4a3a2a], speed: 2.5, up: 1.5, life: 0.9, size: 0.06, gravity: -6, drag: 1, radius: 0.2, bounce: 0.2 }, this.rng);
  }

  /** Common spell-cast core: flash, shock ring, spinning rune, rising glints, light pulse, screen flash. */
  castCore(x, z, color, power = 1) {
    this.flashes.play({ x, y: 0.55, z, color, size0: 0.3, size1: 2.2 * power, dur: 0.5, intensity: 1.4 });
    this.flashes.play({ x, y: 0.5, z, color: 0xffffff, size0: 0.1, size1: 0.9 * power, dur: 0.22, intensity: 1.8 });
    this.rings.play({ x, z, color, dur: 0.7, fn: (m, k) => { const e = easeOut(k); m.scale.setScalar(0.25 + e * 2.1 * power); m.material.opacity = 0.9 * (1 - k); } });
    this.runes.play({ x, z, color, dur: 2.6, fn: (m, k, t) => { m.scale.setScalar(1.8 * power * (0.75 + 0.25 * easeOutBack(Math.min(1, t / 0.3)))); m.rotation.z = t * 0.9; m.material.opacity = Math.min(1, t / 0.12) * (1 - k * k) * 0.9; } });
    this.burst(x, z, { color: [color, 0xffffff], count: Math.round(36 * power), speed: 0.5, up: 2.0, life: 2.2, size: 0.085, y: 0.15, gravity: 0.25, drag: 0.8, radius: 0.45, kind: 2 });
    this.burst(x, z, { color: [color, color, 0xffffff], count: Math.round(24 * power), speed: 0.3, up: 0.9, life: 2.6, size: 0.07, y: 0.4, gravity: 0.12, drag: 0.6, radius: 0.6, ySpread: 1.2, kind: 0 });
    this.lights.pulse({ x, z, color, intensity: 12 * power, dur: 0.9 });
    const c = new THREE.Color(color);
    this.flash.color.copy(c).multiplyScalar(0.5); this.flash.amount = Math.max(this.flash.amount, 0.22 * power);
    this.shakeRequest += 0.06 * power;
  }

  onAttacked({ attacker, defender, damage, killed, crit }) {
    const d = this.resolve(defender), a = this.resolve(attacker);
    const dir = new THREE.Vector3().subVectors(d, a); if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1); dir.normalize();
    const isPlayer = defender.kind === 'player';
    const bleeds = defender.family === 'creature' || isPlayer;
    const steel = attacker.kind === 'player' || attacker.family === 'human';
    if (damage > 0) {
      // slash arc from the attacker's side
      this.arcs.play({ x: d.x - dir.x * 0.35, z: d.z - dir.z * 0.35, color: steel ? 0xfff2d0 : 0xff6a48, dur: 0.18, intensity: 1.8, fn: (m, k) => { m.rotation.set(-Math.PI / 2, 0, -Math.atan2(dir.z, dir.x) - Math.PI * 0.42); const s = 0.35 + easeOut(k) * 0.55; m.scale.setScalar(s); m.material.opacity = (1 - k) * 0.95; } });
      this.flashes.play({ x: d.x, y: 0.55, z: d.z, color: steel ? 0xffe6b0 : 0xff5a3a, size0: 0.25, size1: crit ? 1.6 : 0.9, dur: crit ? 0.24 : 0.15, intensity: crit ? 1.9 : 1.4 });
      if (steel) this.burst(d.x, d.z, { color: [0xfff2c8, 0xffb347, 0xffffff], count: crit ? 34 : 16, speed: 3.6, up: 1.4, life: 0.5, size: 0.05, y: 0.55, dir: { x: dir.x * 0.6, y: 0.5, z: dir.z * 0.6 }, gravity: -7, drag: 1.4, kind: 1, bounce: 0.5 });
      if (bleeds) {
        this.matter.emit({ x: d.x, y: 0.5, z: d.z, count: crit ? 30 : 14, color: [0x8a1c1c, 0x5a0e0e, 0xb02020], speed: 2.2, up: 1.2, life: 1.4, size: 0.07, gravity: -9, drag: 1, radius: 0.08, dir: { x: dir.x * 0.7, y: 0.6, z: dir.z * 0.7 }, stick: true }, this.rng);
        this.matter.emit({ x: d.x, y: 0.5, z: d.z, count: 6, color: [0x5a0e0e, 0x3a0808], speed: 0.8, up: 0.6, life: 0.7, size: 0.16, gravity: -0.5, drag: 2, radius: 0.1, kind: 3 }, this.rng);
        const rot = this.rng.float(0, 6.28), size = (crit ? 0.6 : 0.4) * this.rng.float(0.8, 1.2);
        this.decals.play({ x: d.x + dir.x * 0.25 + this.rng.float(-0.15, 0.15), z: d.z + dir.z * 0.25 + this.rng.float(-0.15, 0.15), color: 0x2a0606, intensity: 1, dur: 8, fn: (m, k) => { m.rotation.set(-Math.PI / 2, 0, rot); m.scale.setScalar(size * 1.2 * (0.6 + 0.4 * easeOut(Math.min(1, k * 20)))); m.material.opacity = 0.85 * (1 - k * k); } });
      } else this.burst(d.x, d.z, { color: [0x9a9088, 0xd0c8c0], count: 8, speed: 1.4, up: 1.2, life: 0.5, size: 0.06, y: 0.5, gravity: -5 });
      this.lights.pulse({ x: d.x, z: d.z, color: steel ? 0xffd090 : 0xff6040, intensity: crit ? 14 : 6, dur: crit ? 0.3 : 0.14, distance: 4 });
      this.numbers.spawn(d.x, d.z, crit ? `${damage}!` : `${damage}`, { style: isPlayer ? 'player' : crit ? 'crit' : 'normal' });
      this.shakeRequest += isPlayer ? Math.min(0.55, 0.14 + damage * 0.012) : crit ? 0.18 : 0.05;
      if (crit) { this.rings.play({ x: d.x, z: d.z, y: 0.03, color: 0xffffff, dur: 0.32, fn: (m, k) => { m.scale.setScalar(0.2 + easeOut(k) * 1.1); m.material.opacity = 0.9 * (1 - k); } }); this.flash.color.set(0.6, 0.55, 0.45); this.flash.amount = Math.max(this.flash.amount, 0.22); }
      if (isPlayer && damage >= 5) { this.flash.color.set(0.5, 0.05, 0.02); this.flash.amount = Math.min(0.6, 0.2 + damage * 0.02); }
    } else {
      // absorbed by the shield
      this.shieldHit = 1;
      this.burst(d.x, d.z, { color: [0xffd43b, 0xffffff], count: 26, speed: 2.2, up: 1, life: 0.55, size: 0.07, y: 0.55, gravity: -1, kind: 2, dir: { x: -dir.x * 0.6, y: 0.4, z: -dir.z * 0.6 } });
      this.flashes.play({ x: d.x - dir.x * 0.5, y: 0.6, z: d.z - dir.z * 0.5, color: 0xffe680, size0: 0.3, size1: 1.1, dur: 0.2 });
      this.rings.play({ x: d.x, z: d.z, y: 0.04, color: 0xffd43b, dur: 0.35, fn: (m, k) => { m.scale.setScalar(0.5 + easeOut(k) * 0.7); m.material.opacity = 0.8 * (1 - k); } });
      this.lights.pulse({ x: d.x, z: d.z, color: 0xffd43b, intensity: 8, dur: 0.2 });
      this.numbers.spawn(d.x, d.z, 'BLOCKED', { style: 'blocked' });
    }
    if (killed && !isPlayer) this.shakeRequest += 0.15;
  }

  deathPuff(x, z, entity) {
    if (entity.kind === 'player') return;
    const creature = entity.family !== 'human';
    const c = creature ? [0x5a4a6a, 0x2a1a3a, 0x8a1c1c] : [0x8a1c1c, 0x3a0a0a];
    this.matter.emit({ x, y: 0.4, z, count: 60, color: c, speed: 2.4, up: 2, life: 1.3, size: 0.08, gravity: -8, drag: 1.2, radius: 0.15, stick: true }, this.rng);
    this.matter.emit({ x, y: 0.4, z, count: 24, color: creature ? [0x2a1a3a, 0x1a1020] : [0x3a1010, 0x2a0a0a], speed: 1, up: 1.4, life: 1.6, size: 0.3, gravity: 0.15, drag: 1.2, radius: 0.25, kind: 3 }, this.rng);
    const soul = creature ? [0xb197fc, 0x8a5cff] : [0xbfd8ff, 0xffffff];
    this.burst(x, z, { color: soul, count: 26, speed: 0.35, up: 1.1, life: 3.2, size: 0.1, y: 0.4, gravity: 0.3, drag: 0.5, radius: 0.3, kind: 2, shrink: 0.3 });
    this.helix(x, z, soul, { turns: 2, height: 1.6, n: 40, life: 2.8 });
    this.flashes.play({ x, y: 0.5, z, color: creature ? 0x9a6cff : 0xffb090, size0: 0.4, size1: 1.7, dur: 0.35, intensity: 1.1 });
    this.flashes.play({ x, y: 0.3, z, color: creature ? 0x7a4cdf : 0xff8060, size0: 1.2, size1: 0.6, dur: 2.6, intensity: 0.5, opacity: 0.6 });
    this.rings.play({ x, z, color: creature ? 0x8a5cff : 0xff8060, dur: 0.5, intensity: 1, fn: (m, k) => { m.scale.setScalar(0.3 + easeOut(k) * 1.2); m.material.opacity = 0.6 * (1 - k); } });
    const rot = this.rng.float(0, 6.28);
    this.decals.play({ x, z, color: creature ? 0x140820 : 0x2a0606, intensity: 1, dur: 10, fn: (m, k) => { m.rotation.set(-Math.PI / 2, 0, rot); m.scale.setScalar(1.15 * (0.5 + 0.5 * easeOut(Math.min(1, k * 15)))); m.material.opacity = 0.92 * (1 - k * k); } });
    this.lights.pulse({ x, z, color: creature ? 0x8a5cff : 0xff8060, intensity: 9, dur: 0.4 });
  }

  playerDeath() {
    const v = this.playerPos;
    this.flash.color.set(0.55, 0.02, 0.02); this.flash.amount = 0.9; this.flashHomage = 0;
    this.shakeRequest += 0.9;
    this.matter.emit({ x: v.x, y: 0.5, z: v.z, count: 80, color: [0x8a1c1c, 0x4a0808], speed: 2, up: 2, life: 1.6, size: 0.09, gravity: -7, drag: 1, radius: 0.2, stick: true }, this.rng);
    this.matter.emit({ x: v.x, y: 0.4, z: v.z, count: 40, color: [0x1a0808, 0x2a0a0a], speed: 0.8, up: 1, life: 2.4, size: 0.34, gravity: 0.1, drag: 1, radius: 0.3, kind: 3 }, this.rng);
    this.rings.play({ x: v.x, z: v.z, color: 0xff3020, dur: 1.2, fn: (m, k) => { m.scale.setScalar(0.3 + easeOut(k) * 3.5); m.material.opacity = 0.9 * (1 - k); } });
    this.burst(v.x, v.z, { color: [0xbfd8ff, 0xffffff, 0xd0c0ff], count: 60, speed: 0.3, up: 1.0, life: 3.5, size: 0.1, y: 0.3, gravity: 0.3, drag: 0.4, radius: 0.35, kind: 2 });
    this.pillar(v.x, v.z, 0x9fb4ff, 3.5, 0.3);
    this.lights.pulse({ x: v.x, z: v.z, color: 0xff3020, intensity: 18, dur: 1.4, distance: 7 });
    const rot = this.rng.float(0, 6.28);
    this.decals.play({ x: v.x, z: v.z, color: 0x3a0808, intensity: 1, dur: 30, fn: (m, k) => { m.rotation.set(-Math.PI / 2, 0, rot); m.scale.setScalar(1.1 * (0.5 + 0.5 * easeOut(Math.min(1, k * 40)))); m.material.opacity = 0.85 * (1 - k); } });
  }

  onSpell({ spell, x, y }) {
    const c = COLORS.spells[spell] || '#ffffff';
    const col = new THREE.Color(c).getHex();
    switch (spell) {
      case 'shield':
        this.castCore(x, y, col, 1.1);
        this.timers.shieldFade = 0;
        this.burst(x, y, { color: [col, 0xffffff], count: 60, speed: 1.6, up: 1.4, life: 0.9, size: 0.08, y: 0.5, gravity: 0.4, drag: 1.2, kind: 2 });
        break;
      case 'light':
        this.castCore(x, y, 0xfff3bf, 1.4);
        this.flashes.play({ x, y: 1.1, z: y, color: 0xfff6d0, size0: 0.6, size1: 4.5, dur: 0.7, intensity: 1.6 });
        this.rays(x, y, 0xfff3bf);
        this.flash.color.set(1, 0.95, 0.7); this.flash.amount = 0.6;
        this.lights.pulse({ x, y: 1.5, z: y, color: 0xfff3bf, intensity: 26, dur: 0.9, distance: 9 });
        break;
      case 'regeneration':
        this.castCore(x, y, col, 0.9);
        this.timers.regenFade = 0;
        this.burst(x, y, { color: [col, 0xd0ffd8], count: 60, speed: 0.6, up: 2, life: 1.6, size: 0.1, y: 0.2, gravity: 0.6, drag: 0.6, kind: 2 });
        break;
      case 'invisibility':
        this.castCore(x, y, col, 0.9);
        // collapse: a ring of violet motes rushes inward and up
        for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2, r = 0.9; this.particles.emit({ x: x + Math.cos(a) * r, y: 0.15 + (i % 4) * 0.2, z: y + Math.sin(a) * r, count: 1, color: i % 2 ? col : 0xffffff, speed: 1.6, spread: 0, up: 0.6, life: 0.7, size: 0.07, gravity: 0.4, drag: 1.4, radius: 0, dir: { x: -Math.cos(a), y: 0.3, z: -Math.sin(a) }, kind: 1 }, this.rng); }
        this.matter.emit({ x, y: 0.5, z: y, count: 20, color: [0x3a2a5a, 0x2a1a40], speed: 0.6, up: 0.6, life: 1.6, size: 0.3, gravity: 0.05, drag: 1, radius: 0.3, kind: 3 }, this.rng);
        break;
      case 'drift':
        this.castCore(x, y, 0xe9ecef, 0.8);
        this.burst(x, y, { color: [0xffffff, col], count: 40, speed: 0.6, up: 2, life: 2.5, size: 0.09, y: 0.4, gravity: -0.25, drag: 1, kind: 1 });
        break;
      case 'teleport': break; // fx:teleport carries from/to
      default: this.castCore(x, y, col, 1);
    }
  }

  /** Radial light rays: long thin streaks fired outward at head height. */
  rays(x, z, color) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      this.particles.emit({ x, y: 0.9, z, count: 1, color: i % 3 ? color : 0xffffff, speed: 5.5, spread: 0, up: 0, life: 0.45, size: 0.12, gravity: 0, drag: 3.5, radius: 0.05, dir: { x: Math.cos(a), y: 0.05 * Math.sin(i * 1.7), z: Math.sin(a) }, kind: 1 }, this.rng);
    }
  }

  /** Expanding ring of particles. */
  ring(x, z, color, radius = 1.2, kind = 0) {
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      this.particles.emit({ x, y: 0.2, z, count: 1, color, speed: radius * 2.2, spread: 1, up: 0.15, life: 0.8, size: 0.09, gravity: 0, drag: 2.2, radius: 0, dir: { x: Math.cos(a), y: 0.1, z: Math.sin(a) }, kind }, this.rng);
    }
  }

  teleport(from, to) {
    const cyan = 0x4ee1ff;
    // departure: dissolve upward + implosion rune
    this.runes.play({ x: from.x, z: from.y, color: cyan, dur: 1.2, fn: (m, k, t) => { m.scale.setScalar(1.5 * (1 - k * 0.6)); m.rotation.z = -t * 2.2; m.material.opacity = 0.9 * (1 - k); } });
    this.flashes.play({ x: from.x, y: 0.6, z: from.y, color: cyan, size0: 1.2, size1: 0.1, dur: 0.35, intensity: 1.5 });
    this.rings.play({ x: from.x, z: from.y, color: cyan, dur: 0.5, fn: (m, k) => { m.scale.setScalar(1.6 * (1 - easeOut(k)) + 0.1); m.material.opacity = 0.9 * k; } });
    for (let i = 0; i < 70; i++) { const a = i * 0.55, r = 0.1 + (i % 7) * 0.05; this.particles.emit({ x: from.x + Math.cos(a) * r, y: 0.05 + (i / 70) * 1.6, z: from.y + Math.sin(a) * r, count: 1, color: i % 3 ? cyan : 0xffffff, speed: 1.2, spread: 0.2, up: 2.2, life: 1.1, size: 0.07, gravity: 1.5, drag: 0.8, radius: 0, kind: 1 }, this.rng); }
    this.lights.pulse({ x: from.x, z: from.y, color: cyan, intensity: 12, dur: 0.5 });
    // arrival: beam narrows into the player, double helix reassembles, rune + shock ring + flash
    this.castCore(to.x, to.y, cyan, 1.3);
    this.beam(to.x, to.y, cyan, 1.5);
    this.helix(to.x, to.y, [cyan, 0xffffff, 0x2a8fff], { life: 2.4 });
    this.flash.color.set(0.3, 0.8, 1); this.flash.amount = 0.55;
    this.shakeRequest += 0.12;
    this.timers.arrival = { x: to.x, z: to.y, t: 3.5 };
  }

  /** Double helix of motes spiralling up and drifting inward (teleport reassembly, level-up). */
  helix(x, z, colors, { turns = 2.5, height = 1.9, n = 90, life = 1.6 } = {}) {
    for (let s = 0; s < 2; s++) for (let i = 0; i < n / 2; i++) {
      const f = i / (n / 2), a = f * Math.PI * 2 * turns + s * Math.PI, r = 0.5 - f * 0.22;
      this.particles.emit({ x: x + Math.cos(a) * r, y: 0.05 + f * height, z: z + Math.sin(a) * r, count: 1, color: colors[(i + s) % colors.length], speed: 0.35, spread: 0.1, up: 1, life: life * (0.6 + 0.4 * (1 - f)), size: 0.08, gravity: 0.25, drag: 1.6, radius: 0, dir: { x: -Math.cos(a) * 0.6, y: 0.5, z: -Math.sin(a) * 0.6 }, kind: 2 }, this.rng);
    }
  }

  /** Bright vertical beam that shrinks into the ground (arrival / ascension). */
  beam(x, z, color, dur = 0.8, radius = 0.5) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.6, radius, 3.4, 24, 1, true), beamMaterial(color));
    m.position.set(x, 1.7, z);
    this.scene.add(m);
    this.transients.push({ obj: m, t: 0, dur, fn: (o, k) => { const e = easeOut(k); o.material.uniforms.uOpacity.value = 1.2 * (1 - k); o.material.uniforms.uTime.value = this.time; o.scale.set(1 - e * 0.85, 1, 1 - e * 0.85); } });
  }

  levelUp(x, z) {
    this.castCore(x, z, 0xffd866, 1.4);
    this.rings.play({ x, z, color: 0xffffff, dur: 0.8, fn: (m, k) => { m.scale.setScalar(0.3 + easeOut(k) * 3.2); m.material.opacity = 0.9 * (1 - k); } });
    this.helix(x, z, [0xffd866, 0xfff3bf, 0xffffff], { turns: 3, height: 2.2, n: 120, life: 2 });
    this.burst(x, z, { color: [0xffd866, 0xfff3bf, 0xffffff], count: 120, speed: 0.6, up: 4, life: 1.8, size: 0.1, y: 0.1, gravity: 0.8, drag: 0.4, radius: 0.35, kind: 2 });
    this.pillar(x, z, 0xffd866, 2.0);
    this.rays(x, z, 0xffd866);
    this.flash.color.set(1, 0.85, 0.4); this.flash.amount = 0.4;
    this.lights.pulse({ x, y: 1.2, z, color: 0xffd866, intensity: 14, dur: 1.2, distance: 7 });
    this.shakeRequest += 0.25;
    this.numbers.spawn(x, z, 'LEVEL UP!', { style: 'banner', y: 1.35, life: 2.2 });
  }

  /** Vertical glowing pillar that fades out. */
  pillar(x, z, color, dur = 1.5, radius = 0.32) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius, 3, 24, 1, true), beamMaterial(color));
    m.position.set(x, 1.5, z);
    this.scene.add(m);
    this.transients.push({ obj: m, t: 0, dur, fn: (o, k) => { o.material.uniforms.uOpacity.value = 0.9 * (1 - k) * (1 - k); o.material.uniforms.uTime.value = this.time; o.scale.set(1 + k * 0.5, 1, 1 + k * 0.5); } });
  }

  /** Stairs: a vortex of motes and dust spiralling into (dir<0) or out of (dir>0) the floor. */
  vortex(x, z, dir) {
    for (let i = 0; i < 70; i++) {
      const f = i / 70, a = f * Math.PI * 6, r = 0.2 + f * 0.7;
      this.particles.emit({ x: x + Math.cos(a) * r, y: dir < 0 ? 0.2 + f * 1.4 : 0.05, z: z + Math.sin(a) * r, count: 1, color: i % 3 ? 0xbfd8ff : 0xffffff, speed: 1.2, spread: 0, up: 1, life: 0.9, size: 0.07, gravity: dir < 0 ? -2.5 : 2, drag: 0.8, radius: 0, dir: { x: -Math.sin(a) * 0.8 - Math.cos(a) * 0.3, y: dir * 0.4, z: Math.cos(a) * 0.8 - Math.sin(a) * 0.3 }, kind: 1 }, this.rng);
    }
    this.matter.emit({ x, y: 0.1, z, count: 30, color: [0x6a6058, 0x4a4038], speed: 1.8, up: 0.6, life: 1.0, size: 0.2, gravity: -0.4, drag: 2, radius: 0.35, kind: 3 }, this.rng);
    this.rings.play({ x, z, color: 0xbfd8ff, dur: 0.6, intensity: 0.8, fn: (m, k) => { m.scale.setScalar(dir < 0 ? 1.5 * (1 - easeOut(k)) + 0.2 : 0.2 + easeOut(k) * 1.5); m.material.opacity = 0.7 * (dir < 0 ? k : 1 - k); } });
    this.lights.pulse({ x, z, color: 0xbfd8ff, intensity: 6, dur: 0.6 });
    this.shakeRequest += 0.12;
  }

  explosion(x, z) {
    this.burst(x, z, { color: [0xffe066, 0xff7a1a, 0xff3a1a], count: 160, speed: 3.5, up: 2.5, life: 0.9, size: 0.16, y: 0.3, gravity: -3, drag: 2, radius: 0.2 });
    this.burst(x, z, { color: [0xffe066, 0xffffff], count: 60, speed: 5, up: 2, life: 0.6, size: 0.07, y: 0.4, gravity: -6, drag: 1.2, radius: 0.1, kind: 1, bounce: 0.5 });
    this.matter.emit({ x, y: 0.4, z, count: 60, color: [0x3a2a1a, 0x1a1210, 0x2a2018], speed: 2, up: 1.5, life: 1.8, size: 0.32, gravity: 0.3, drag: 1.5, radius: 0.3, kind: 3 }, this.rng);
    this.flashes.play({ x, y: 0.5, z, color: 0xffb040, size0: 0.6, size1: 4, dur: 0.45, intensity: 2 });
    this.rings.play({ x, z, color: 0xffa030, dur: 0.5, fn: (m, k) => { m.scale.setScalar(0.3 + easeOut(k) * 3); m.material.opacity = 0.95 * (1 - k); } });
    const fire = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    fire.position.set(x, 0.4, z);
    this.scene.add(fire);
    this.transients.push({ obj: fire, t: 0, dur: 0.5, fn: (o, k) => { o.scale.setScalar(0.4 + k * 2.4); o.material.opacity = 0.9 * (1 - k); o.material.color.setRGB(1, 0.6 - k * 0.5, 0.15 * (1 - k)); } });
    const rot = this.rng.float(0, 6.28);
    this.decals.play({ x, z, color: 0x141008, intensity: 1, dur: 12, fn: (m, k) => { m.rotation.set(-Math.PI / 2, 0, rot); m.scale.setScalar(1.6); m.material.opacity = 0.8 * (1 - k); } });
    this.lights.pulse({ x, z, color: 0xffa030, intensity: 30, dur: 0.6, distance: 9 });
    this.shakeRequest += 0.9;
    this.flash.color.set(1, 0.25, 0.05); this.flash.amount = 0.85;
    this.flashHomage = 0.5; // red/yellow alternation
  }

  swordFound(x, z) {
    this.castCore(x, z, 0x9fd0ff, 2.2);
    this.pillar(x, z, 0x9fd0ff, 3.2, 0.42);
    this.beam(x, z, 0xc58cff, 1.6, 0.7);
    this.rings.play({ x, z, color: 0xc58cff, dur: 1.0, fn: (m, k) => { m.scale.setScalar(0.3 + easeOut(k) * 4.5); m.material.opacity = 0.9 * (1 - k); } });
    this.helix(x, z, [0x9fd0ff, 0xc58cff, 0xffffff], { turns: 3, height: 2.6, n: 140, life: 2.6 });
    this.burst(x, z, { color: [0x9fd0ff, 0xc58cff, 0xffffff], count: 200, speed: 0.6, up: 4.5, life: 2.6, size: 0.11, y: 0.1, gravity: 0.5, drag: 0.3, radius: 0.5, kind: 2 });
    this.rays(x, z, 0xc58cff);
    this.flash.color.set(0.6, 0.7, 1); this.flash.amount = 0.8;
    this.lights.pulse({ x, y: 1.4, z, color: 0xa88cff, intensity: 30, dur: 2.2, distance: 9 });
    this.shakeRequest += 0.4;
  }

  /** Gold pickup: coin fountain of glints with bounce, warm flash, light and a +N number. */
  coinFountain(x, z, amount) {
    const n = 22 + Math.min(34, Math.round(amount / 3));
    // coins: bounce, then settle and fade on the floor
    this.burst(x, z, { color: [0xffd866, 0xfff3bf, 0xffb020], count: n, speed: 1.6, up: 3.8, life: 2.4, size: 0.1, y: 0.2, gravity: -8, drag: 0.6, radius: 0.15, kind: 2, bounce: 0.45, shrink: 0.2 });
    this.burst(x, z, { color: [0xffd866, 0xffffff], count: 16, speed: 0.4, up: 1.2, life: 2.2, size: 0.12, y: 0.3, gravity: 0.35, drag: 1, radius: 0.25, kind: 2 });
    this.flashes.play({ x, y: 0.4, z, color: 0xffc860, size0: 0.4, size1: 1.8, dur: 0.5, intensity: 1.3 });
    this.flashes.play({ x, y: 0.3, z, color: 0xffe0a0, size0: 0.8, size1: 1.4, dur: 2.2, intensity: 0.6, opacity: 0.7 });
    this.rings.play({ x, z, color: 0xffd866, dur: 0.6, fn: (m, k) => { m.scale.setScalar(0.2 + easeOut(k) * 1.3); m.material.opacity = 0.8 * (1 - k); } });
    this.lights.pulse({ x, z, color: 0xffc860, intensity: 9, dur: 1.2 });
  }

  /** Opened chest: lid springs back, gold light spills, coins fountain, then it sinks away. */
  chestOpen(x, z) {
    const pf = getPropFactory();
    if (pf) {
      const g = pf.chestOpen();
      // the player stands on the chest tile: show the opened chest at their feet on the camera side
      // (+z), lid thrown back away from the viewer so the gold inside is on display
      g.position.set(x, 0, z + 0.45);
      const inner = g.userData.inner;
      g.rotation.y = 0;
      this.scene.add(g);
      this.transients.push({ obj: g, t: 0, dur: 3.4, fn: (o, k, t) => {
        // the lid is painted open in the art, so the "spring" is a squash on the whole prop
        const open = easeOutBack(Math.min(1, t / 0.32));
        o.scale.set(1 + 0.10 * (1 - open), 0.82 + 0.18 * open, 1);
        // `inner` is pinned to the chest art (props.js `onArt`), which owns its scale each frame
        inner.userData.k = 1.3 * (0.6 + 0.4 * Math.sin(t * 5)) * (1 - k * k);
        if (k > 0.78) { const f = (k - 0.78) / 0.22; o.position.y = -f * 0.5; o.scale.multiplyScalar(1 - f * 0.9); }
      } });
    }
    this.coinFountain(x, z, 60);
    this.burst(x, z, { color: [0xffd866, 0xffffff], count: 30, speed: 0.6, up: 2.5, life: 1.4, size: 0.1, y: 0.35, gravity: 0.3, drag: 0.5, radius: 0.2, kind: 2 });
    this.lights.pulse({ x, y: 0.6, z, color: 0xffc860, intensity: 14, dur: 1.2 });
    this.flash.color.set(1, 0.8, 0.4); this.flash.amount = Math.max(this.flash.amount, 0.18);
  }

  /** What to shout above the hero when a pickup lands. The log records it too, but a message at the
   *  player's own feet is what actually reads mid-run. */
  pickupLabel(item) {
    if (item.type === 'gold') return item.gold ? `+${item.gold} GOLD` : 'GOLD';
    const spell = SPELL_TABLE[item.type];
    if (spell) return `${spell.name.toUpperCase()} SPELL`;
    const it = ITEM_TABLE[item.type];
    if (it) return it.name.toUpperCase();
    if (item.type === 'beacon') return 'BEACON';
    return String(item.type || 'ITEM').replace(/[-_]/g, ' ').toUpperCase();
  }

  onPicked({ item, entity }) {
    if (!item) return;
    const x = item.x ?? entity.x, z = item.y ?? entity.y;
    if (item.type === 'gold') { this.coinFountain(x, z, item.gold || 20); if (item.gold) this.numbers.spawn(x, z, `+${item.gold} GOLD`, { style: 'gold', y: 1.7, life: 2.0, overHero: true }); }
    else if (item.type === 'sword') return;
    else {
      // Name it out loud: particles alone do not say WHAT was picked up.
      this.numbers.spawn(x, z, this.pickupLabel(item), { style: SPELL_TABLE[item.type] ? 'magic' : 'banner', y: 1.7, life: 2.2, overHero: true });
      const col = COLORS.spells[item.type] ? new THREE.Color(COLORS.spells[item.type]).getHex() : item.type === 'potion' ? 0xff5a48 : 0x9fd0ff;
      this.burst(x, z, { color: [0xffffff, col], count: 34, speed: 0.8, up: 2.2, life: 0.9, size: 0.08, y: 0.3, gravity: -0.5, kind: 2 });
      this.flashes.play({ x, y: 0.4, z, color: col, size0: 0.3, size1: 1.3, dur: 0.3, intensity: 1.3 });
      this.rings.play({ x, z, color: col, dur: 0.4, fn: (m, k) => { m.scale.setScalar(0.2 + easeOut(k) * 1.0); m.material.opacity = 0.7 * (1 - k); } });
      this.lights.pulse({ x, z, color: col, intensity: 7, dur: 0.3 });
    }
  }

  victory() {
    const v = this.playerPos;
    this.pillar(v.x, v.z, 0xffd866, 4, 0.8);
    this.rings.play({ x: v.x, z: v.z, color: 0xffd866, dur: 1.4, fn: (m, k) => { m.scale.setScalar(0.3 + easeOut(k) * 6); m.material.opacity = 0.9 * (1 - k); } });
    this.helix(v.x, v.z, [0xffd866, 0xffffff, 0x9fd0ff], { turns: 4, height: 3, n: 160, life: 3 });
    this.burst(v.x, v.z, { color: [0xffd866, 0xffffff, 0x9fd0ff], count: 300, speed: 1.5, up: 5, life: 3, size: 0.12, y: 0.2, gravity: -0.4, drag: 0.3, radius: 1, kind: 2 });
    this.lights.pulse({ x: v.x, y: 1.5, z: v.z, color: 0xffd866, intensity: 30, dur: 4, distance: 10 });
  }

  /**
   * Per-frame update.
   * @param {number} dt
   * @param {{player:object, playerPos:THREE.Vector3, statuses:Set<string>, hasSword:boolean, goldViews:THREE.Object3D[]}} ctx
   */
  update(dt, ctx) {
    this.time += dt;
    this.playerPos.copy(ctx.playerPos);
    const p = this.playerPos, T = this.timers, S = ctx.statuses;
    // player velocity (for glide trails)
    if (this.hadPlayer && dt > 0) { this.playerVel.subVectors(p, this.prevPlayerPos).divideScalar(dt); if (this.playerVel.lengthSq() > 64) this.playerVel.set(0, 0, 0); }
    this.prevPlayerPos.copy(p); this.hadPlayer = true;
    const moving = this.playerVel.lengthSq() > 0.5;
    // ---- persistent status visuals
    const shield = S.has('shield');
    T.shieldFade += (shield ? 1 : -1) * dt * 4; T.shieldFade = Math.max(0, Math.min(1, T.shieldFade));
    this.shield.visible = T.shieldFade > 0.01;
    if (this.shield.visible) {
      const u = this.shield.material.uniforms;
      this.shieldHit = Math.max(0, this.shieldHit - dt * 5);
      u.uTime.value = this.time; u.uHit.value = this.shieldHit; u.uFade.value = easeOut(T.shieldFade);
      const s = (1 + 0.03 * Math.sin(this.time * 4) + this.shieldHit * 0.12) * (0.6 + 0.4 * easeOutBack(T.shieldFade));
      this.shield.position.set(p.x, 0.52, p.z); this.shield.scale.setScalar(s); this.shield.rotation.y += dt * 0.4;
      T.shieldGlint += dt; while (T.shieldGlint > 0.25) { T.shieldGlint -= 0.25; if (shield) this.particles.emit({ x: p.x, y: 0.55, z: p.z, count: 1, color: [0xffd43b, 0xffffff], speed: 0.05, spread: 1, up: 0.3, life: 0.6, size: 0.07, gravity: 0, drag: 1, radius: 0.62, ySpread: 1.6, kind: 2 }, this.rng); }
    }
    this.statusRune('shield', shield, 0.35, 0.4, dt);
    const regen = S.has('regeneration');
    this.statusRune('regeneration', regen, 0.5, -0.5, dt);
    if (regen) {
      T.regen += dt;
      while (T.regen > 0.06) {
        T.regen -= 0.06;
        for (let s = 0; s < 2; s++) { const a = this.time * 3.2 + s * Math.PI, r = 0.42; this.particles.emit({ x: p.x + Math.cos(a) * r, y: 0.08, z: p.z + Math.sin(a) * r, count: 1, color: s ? 0x69db7c : 0xd0ffd8, speed: 0.2, spread: 0.2, up: 1.4, life: 1.6, size: 0.11, gravity: 0.5, drag: 0.7, radius: 0.02, kind: s ? 0 : 2, bright: 2.4 }, this.rng); }
      }
    }
    if (S.has('drift')) {
      T.drift += dt;
      while (T.drift > 0.08) { T.drift -= 0.08; this.particles.emit({ x: p.x, y: 1.7, z: p.z, count: 1, color: [0xffffff, 0xe9ecef], speed: 0.5, spread: 1, up: -0.35, life: 2.8, size: 0.14, gravity: -0.15, drag: 1.4, radius: 0.55, kind: 1, bright: 2.2 }, this.rng); }
      if (moving) this.trail(p, [0xffffff, 0xe9ecef], dt, 0.05, 1);
    }
    if (S.has('invisible')) {
      T.invis += dt;
      while (T.invis > 0.04) {
        T.invis -= 0.04;
        const a = this.time * 2.6, r = 0.36;
        this.particles.emit({ x: p.x + Math.cos(a) * r, y: 0.55 + 0.3 * Math.sin(this.time * 1.9), z: p.z + Math.sin(a) * r, count: 1, color: [0xb197fc, 0xffffff], speed: 0.05, spread: 1, up: 0.2, life: 0.55, size: 0.1, gravity: 0, drag: 1, radius: 0.02, kind: 2, bright: 2.2 }, this.rng);
        this.particles.emit({ x: p.x, y: 0.5, z: p.z, count: 1, color: 0xb197fc, speed: 0.15, spread: 1, up: 0.5, life: 0.9, size: 0.08, gravity: 0, drag: 1, radius: 0.3, ySpread: 1.4, kind: 0, bright: 1.6 }, this.rng);
      }
    }
    if (ctx.hasSword) {
      T.sword += dt;
      while (T.sword > 0.06) { T.sword -= 0.06; this.particles.emit({ x: p.x, y: 0.3, z: p.z, count: 2, color: [0x9fd0ff, 0xc58cff], speed: 0.25, spread: 1, up: 1.4, life: 1.5, size: 0.075, gravity: 0.3, drag: 0.5, radius: 0.32, kind: T.sword > 0.03 ? 2 : 0 }, this.rng); }
      if (moving) this.trail(p, [0x9fd0ff, 0xc58cff], dt, 0.04, 0);
    }
    if (T.arrival && T.arrival.t > 0) { T.arrival.t -= dt; T.arrivalAcc = (T.arrivalAcc || 0) + dt; while (T.arrivalAcc > 0.05) { T.arrivalAcc -= 0.05; this.particles.emit({ x: T.arrival.x, y: 0.1, z: T.arrival.z, count: 2, color: [0x4ee1ff, 0xffffff], speed: 0.2, spread: 1, up: 1.4, life: 1.4, size: 0.08, gravity: 0.3, drag: 0.5, radius: 0.45, kind: 2 }, this.rng); } }
    // gold sparkle on visible gold props
    if (ctx.goldViews && ctx.goldViews.length) {
      T.gold += dt;
      while (T.gold > 0.16) {
        T.gold -= 0.16;
        const g = this.rng.pick(ctx.goldViews);
        this.particles.emit({ x: g.position.x, y: 0.3, z: g.position.z, count: 1, color: [0xffd866, 0xffffff], speed: 0.12, spread: 1, up: 0.7, life: 0.8, size: 0.07, gravity: 0, drag: 1, radius: 0.28, kind: 2 }, this.rng);
      }
    }
    if (this.flashHomage > 0) { this.flashHomage -= dt; const on = Math.floor(this.time * 20) % 2 === 0; this.flash.color.set(on ? 0.85 : 0.6, on ? 0.15 : 0.55, 0.05); this.flash.amount = Math.max(this.flash.amount, 0.35); }
    this.flash.amount = Math.max(0, this.flash.amount - dt * 2.4);
    // transient meshes
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const tr = this.transients[i];
      tr.t += dt;
      const k = Math.min(1, tr.t / tr.dur);
      tr.fn(tr.obj, k, tr.t);
      if (k >= 1) { this.scene.remove(tr.obj); if (tr.obj.geometry) tr.obj.geometry.dispose(); if (tr.obj.material && tr.obj.material.dispose) tr.obj.material.dispose(); this.transients.splice(i, 1); }
    }
    // props (glints, motes, torch sparks, sigils)
    this._propCtx = this._propCtx || { px: 0, pz: 0, emit: (o) => this.particles.emit(o, this.rng), rng: this.rng };
    this._propCtx.px = p.x; this._propCtx.pz = p.z;
    updateProps(dt, this.time, this._propCtx);
    this.flashes.update(dt); this.rings.update(dt); this.runes.update(dt); this.arcs.update(dt); this.decals.update(dt); this.lights.update(dt);
    this.particles.update(dt);
    this.matter.update(dt);
    // The hero is the sprite that owns the frame: hand the numbers his box so none of them can park
    // on top of him (damageNumbers.js "NEVER OVER THE HERO"). It is the player's tile, not a mesh
    // bound, so it costs nothing and it is right even while he is mid-step between two flagstones.
    this.numbers.setProtect(p.x, p.z);
    this.numbers.update(dt);
  }

  /** Fade a persistent rune under the player in/out. */
  statusRune(key, active, opacity, spin, dt) {
    const m = this.statusRunes[key], u = m.userData;
    u.k = Math.max(0, Math.min(1, (u.k || 0) + (active ? 1 : -1) * dt * 3));
    m.visible = u.k > 0.01;
    if (!m.visible) return;
    const p = this.playerPos;
    m.position.set(p.x, 0.022, p.z); m.rotation.z += dt * spin;
    m.scale.setScalar(1.25 * (0.7 + 0.3 * easeOut(u.k)));
    m.material.opacity = opacity * easeOut(u.k) * (0.85 + 0.15 * Math.sin(this.time * 2.3));
  }

  /** Glide trail behind a moving player. */
  trail(p, colors, dt, every, kind) {
    const T = this.timers;
    T.trail += dt;
    while (T.trail > every) {
      T.trail -= every;
      const v = this.playerVel;
      this.particles.emit({ x: p.x - v.x * 0.08, y: 0.35, z: p.z - v.z * 0.08, count: 1, color: colors, speed: 0.4, spread: 0.3, up: 0.3, life: 0.7, size: 0.08, gravity: 0.1, drag: 2, radius: 0.12, ySpread: 1.2, dir: { x: -v.x * 0.25, y: 0.1, z: -v.z * 0.25 }, kind }, this.rng);
    }
  }

  /** Camera reads and clears the accumulated shake request. */
  takeShake() { const s = this.shakeRequest; this.shakeRequest = 0; return s; }
}

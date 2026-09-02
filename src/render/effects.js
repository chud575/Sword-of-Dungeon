// Effects: pooled GPU point particles, billboarded damage numbers, persistent status visuals
// (shield bubble, regeneration motes, drift feathers, sword aura), one-shot bursts for game events,
// and screen-shake / screen-flash requests consumed by the camera and post-processing.
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { COLORS } from '../core/constants.js';

const MAX_PARTICLES = 4000;

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

class ParticleSystem {
  constructor(fog) {
    this.n = MAX_PARTICLES;
    this.pos = new Float32Array(this.n * 3);
    this.vel = new Float32Array(this.n * 3);
    this.col = new Float32Array(this.n * 3);
    this.size = new Float32Array(this.n);
    this.alpha = new Float32Array(this.n);
    this.life = new Float32Array(this.n);
    this.maxLife = new Float32Array(this.n);
    this.grav = new Float32Array(this.n);
    this.drag = new Float32Array(this.n);
    this.shrink = new Float32Array(this.n);
    this.alive = 0; this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: { fogTex: fog.uniforms.fogTex, fogSize: fog.uniforms.fogSize, fogTint: fog.uniforms.fogTint, uScale: { value: 400 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        varying vec3 vColor; varying float vAlpha; varying vec2 vFogXZ; uniform float uScale;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0); vFogXZ = w.xz;
          vec4 mv = viewMatrix * w;
          gl_PointSize = aSize * uScale / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
          vColor = aColor; vAlpha = aAlpha;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha; varying vec2 vFogXZ;
        ${fog.glsl()}
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.08, d) * vAlpha;
          vec3 c = applyFog(vColor, vFogXZ);
          gl_FragColor = vec4(c * a, a);
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /**
   * Emit particles.
   * @param {{x:number,y:number,z:number,count:number,color:number|number[],speed?:number,spread?:number,up?:number,life?:number,size?:number,gravity?:number,drag?:number,radius?:number,shrink?:number,dir?:{x:number,y:number,z:number}}} o
   */
  emit(o, rng) {
    const colors = Array.isArray(o.color) ? o.color : [o.color];
    const c = new THREE.Color();
    for (let k = 0; k < o.count; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.n;
      const r = o.radius ?? 0.1;
      const a = rng.float(0, Math.PI * 2), rr = Math.sqrt(rng.next()) * r;
      this.pos[i * 3] = o.x + Math.cos(a) * rr; this.pos[i * 3 + 1] = o.y + rng.float(-r, r) * 0.3; this.pos[i * 3 + 2] = o.z + Math.sin(a) * rr;
      const sp = (o.speed ?? 1) * rng.float(0.4, 1), spread = o.spread ?? 1;
      let vx = Math.cos(a) * sp * spread, vz = Math.sin(a) * sp * spread, vy = (o.up ?? 1) * sp * rng.float(0.3, 1);
      if (o.dir) { vx = o.dir.x * sp + vx * 0.3; vy = o.dir.y * sp + vy * 0.3; vz = o.dir.z * sp + vz * 0.3; }
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      c.set(colors[k % colors.length]);
      const bright = o.bright ?? 1.6;
      this.col[i * 3] = c.r * bright; this.col[i * 3 + 1] = c.g * bright; this.col[i * 3 + 2] = c.b * bright;
      this.size[i] = (o.size ?? 0.08) * rng.float(0.6, 1.3);
      this.alpha[i] = 1;
      this.maxLife[i] = this.life[i] = (o.life ?? 0.8) * rng.float(0.6, 1.2);
      this.grav[i] = o.gravity ?? -2.5;
      this.drag[i] = o.drag ?? 1.5;
      this.shrink[i] = o.shrink ?? 0.5;
    }
  }

  update(dt) {
    let maxIdx = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      const k = 1 - Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] -= this.vel[i * 3] * k; this.vel[i * 3 + 2] -= this.vel[i * 3 + 2] * k;
      this.vel[i * 3 + 1] += this.grav[i] * dt - this.vel[i * 3 + 1] * k * 0.5;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.01 && this.grav[i] < 0) { this.pos[i * 3 + 1] = 0.01; this.vel[i * 3 + 1] *= -0.3; }
      const f = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, f * 2.5) * (1 - this.shrink[i] * (1 - f) * 0.5);
      maxIdx = i + 1;
    }
    this.geometry.setDrawRange(0, maxIdx);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }
}

class DamageNumbers {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.active = [];
  }
  spawn(x, z, text, { color = '#ffffff', size = 1, y = 0.9 } = {}) {
    let s = this.pool.pop();
    if (!s) {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 96;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
      s = new THREE.Sprite(mat); s.userData.canvas = canvas; s.userData.tex = tex; s.renderOrder = 20;
    }
    const ctx = s.userData.canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 96);
    ctx.font = `bold ${Math.round(56 * Math.min(1.4, size))}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.strokeText(text, 128, 50);
    ctx.fillStyle = color; ctx.fillText(text, 128, 50);
    s.userData.tex.needsUpdate = true;
    s.material.opacity = 1;
    s.scale.set(1.1 * size, 0.41 * size, 1);
    s.position.set(x, y, z);
    s.userData.t = 0; s.userData.vx = 0; s.userData.size = size;
    this.scene.add(s);
    this.active.push(s);
  }
  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      s.userData.t += dt;
      const t = s.userData.t;
      s.position.y += dt * (t < 0.3 ? 1.6 : 0.5);
      s.material.opacity = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.5);
      const pop = t < 0.15 ? 1 + (0.15 - t) * 3 : 1;
      s.scale.set(1.1 * s.userData.size * pop, 0.41 * s.userData.size * pop, 1);
      if (t > 1.1) { this.scene.remove(s); this.active.splice(i, 1); this.pool.push(s); }
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
    this.rng = createRng('fargoal-effects');
    this.particles = new ParticleSystem(fog);
    scene.add(this.particles.points);
    this.numbers = new DamageNumbers(scene);
    this.shakeRequest = 0;
    this.flash = { color: new THREE.Color(0, 0, 0), amount: 0 };
    this.time = 0;
    this.playerPos = new THREE.Vector3();
    this.timers = { regen: 0, drift: 0, sword: 0, invis: 0, gold: 0 };
    this.transients = []; // {obj, t, dur, fn}
    /** entity id -> world position resolver (set by renderer) */
    this.resolve = (e) => new THREE.Vector3(e.px ?? e.x, 0, e.py ?? e.y);
    this.game = null;
    // shield bubble
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 12), new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.shield.visible = false; this.shield.renderOrder = 5;
    scene.add(this.shield);
    this.shieldWire = new THREE.Mesh(new THREE.IcosahedronGeometry(0.64, 1), new THREE.MeshBasicMaterial({ color: 0xffe680, wireframe: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.shieldWire.visible = false;
    scene.add(this.shieldWire);
    this.unsub = [];
    this.bind();
  }

  bind() {
    const on = (n, f) => this.unsub.push(this.bus.on(n, f));
    on('entity:attacked', (p) => this.onAttacked(p));
    on('entity:died', (p) => { const v = this.resolve(p.entity); this.deathPuff(v.x, v.z, p.entity); });
    on('spell:cast', (p) => this.onSpell(p));
    on('fx:teleport', (p) => this.teleport(p.from, p.to));
    on('fx:levelup', (p) => this.levelUp(p.x, p.y));
    on('fx:explosion', (p) => this.explosion(p.x, p.y));
    on('fx:fall', (p) => this.dust(p.x, p.y, 40));
    on('fx:ceiling', (p) => { this.dust(p.x, p.y, 60); this.shakeRequest += 0.6; this.flash.color.set(0.6, 0.6, 0.6); this.flash.amount = 0.5; });
    on('fx:chest', (p) => this.burst(p.x, p.y, { color: [0xffd866, 0xffffff], count: 40, speed: 2, up: 2, life: 0.9, size: 0.1 }));
    on('fx:blink', (p) => this.burst(p.x, p.y, { color: [0xb197fc, 0x7f5fd0], count: 30, speed: 1.2, up: 1, life: 0.6, size: 0.1, y: 0.4, gravity: 0 }));
    on('fx:sword-stolen', (p) => { this.burst(p.x, p.y, { color: [0x2a1040, 0x7a3ad0], count: 60, speed: 2.5, up: 2, life: 1.0, size: 0.14, y: 0.6 }); this.shakeRequest += 0.5; this.flash.color.set(0.3, 0, 0.5); this.flash.amount = 0.6; });
    on('fx:mage', (p) => this.burst(p.x, p.y, { color: [0x7fd4ff, 0xffffff], count: 60, speed: 2, up: 3, life: 1.2, size: 0.12, y: 0.5, gravity: -0.5 }));
    on('fx:demon', (p) => { this.burst(p.x, p.y, { color: [0xff3a2a, 0x3a0000], count: 80, speed: 2.5, up: 2, life: 1.2, size: 0.14, y: 0.5 }); this.shakeRequest += 0.7; this.flash.color.set(0.5, 0, 0); this.flash.amount = 0.7; });
    on('sword:found', (p) => this.swordFound(p.x, p.y));
    on('item:picked', (p) => this.onPicked(p));
    on('temple:sacrifice', () => { const v = this.playerPos; this.burst(v.x, v.z, { color: [0xffd866, 0xbfe6ff], count: 80, speed: 0.8, up: 3, life: 1.6, size: 0.1, gravity: 0.6, drag: 0.5 }); });
    on('trap:triggered', (p) => { if (p.type === 'teleport') this.burst(p.x, p.y, { color: [0x4ee1ff, 0xffffff], count: 40, speed: 2, up: 2, life: 0.7, size: 0.1 }); });
    on('monster:stole', (p) => { const v = this.resolve(p.entity); this.burst(v.x, v.z, { color: [0xffd866], count: 25, speed: 2, up: 2, life: 0.8, size: 0.08, y: 0.5 }); this.numbers.spawn(v.x, v.z, `-${p.gold} gold`, { color: '#ffd866', size: 0.9 }); });
    on('player:hp', (p) => { if (p.delta > 0 && p.source !== 'regen' && p.delta >= 5) { const v = this.playerPos; this.numbers.spawn(v.x, v.z, `+${p.delta}`, { color: '#69db7c', size: 0.9 }); this.burst(v.x, v.z, { color: [0x69db7c, 0xd0ffd8], count: 30, speed: 0.6, up: 2, life: 1.2, size: 0.08, gravity: 0.3, drag: 0.8, y: 0.3 }); } });
    on('game:over', (p) => { if (p.victory) this.victory(); });
  }

  dispose() { for (const u of this.unsub) u(); }

  /** World-space burst at a tile. */
  burst(x, z, o) {
    this.particles.emit({ x, y: o.y ?? 0.35, z, count: o.count ?? 30, color: o.color ?? 0xffffff, speed: o.speed ?? 1.5, spread: o.spread ?? 1, up: o.up ?? 1.5, life: o.life ?? 0.8, size: o.size ?? 0.08, gravity: o.gravity ?? -2.5, drag: o.drag ?? 1.5, radius: o.radius ?? 0.12, dir: o.dir, bright: o.bright, shrink: o.shrink }, this.rng);
  }

  dust(x, z, n) { this.burst(x, z, { color: [0x8a7a68, 0x5a4a3a], count: n, speed: 2, up: 1.2, life: 1.1, size: 0.16, gravity: -1.5, drag: 2, bright: 0.8 }); }

  onAttacked({ attacker, defender, damage, killed, crit }) {
    const d = this.resolve(defender), a = this.resolve(attacker);
    const dir = new THREE.Vector3().subVectors(d, a).normalize();
    const isPlayer = defender.kind === 'player';
    if (damage > 0) {
      const sparks = defender.family === 'creature' || (defender.kind === 'player' && attacker.family === 'creature') ? [0xff5a48, 0x8a1c1c] : [0xfff2c8, 0xffb347];
      this.burst(d.x, d.z, { color: sparks, count: crit ? 40 : 18, speed: 3, up: 2, life: 0.5, size: 0.06, y: 0.5, dir: { x: dir.x * 0.5, y: 0.8, z: dir.z * 0.5 }, gravity: -6 });
      this.numbers.spawn(d.x, d.z, crit ? `${damage}!` : `${damage}`, { color: isPlayer ? '#ff5a48' : crit ? '#ffd866' : '#ffffff', size: crit ? 1.35 : isPlayer ? 1.05 : 0.9 });
      this.shakeRequest += isPlayer ? Math.min(0.5, 0.12 + damage * 0.01) : 0.04;
      if (isPlayer && damage >= 5) { this.flash.color.set(0.5, 0.05, 0.02); this.flash.amount = Math.min(0.6, 0.2 + damage * 0.02); }
    } else {
      // blocked by shield
      this.burst(d.x, d.z, { color: [0xffd43b, 0xffffff], count: 24, speed: 2, up: 1, life: 0.5, size: 0.07, y: 0.5, gravity: 0 });
      this.numbers.spawn(d.x, d.z, 'blocked', { color: '#ffd43b', size: 0.75 });
    }
    if (killed && !isPlayer) this.shakeRequest += 0.15;
  }

  deathPuff(x, z, entity) {
    const c = entity.family === 'human' ? [0x8a1c1c, 0x3a0a0a] : [0x5a4a6a, 0x2a1a3a, 0x8a1c1c];
    this.burst(x, z, { color: c, count: 50, speed: 1.8, up: 2, life: 1.0, size: 0.14, y: 0.35, bright: 0.9 });
  }

  onSpell({ spell, x, y }) {
    const c = COLORS.spells[spell] || '#ffffff';
    const col = new THREE.Color(c).getHex();
    switch (spell) {
      case 'shield': this.burst(x, y, { color: [col, 0xffffff], count: 80, speed: 1.4, up: 1.6, life: 1.0, size: 0.09, y: 0.4, gravity: 0.5, drag: 1 }); break;
      case 'light': this.ring(x, y, col, 1.6); this.flash.color.set(1, 0.95, 0.7); this.flash.amount = 0.6; break;
      case 'regeneration': this.burst(x, y, { color: [col, 0xd0ffd8], count: 60, speed: 0.6, up: 2, life: 1.6, size: 0.1, y: 0.2, gravity: 0.6, drag: 0.6 }); break;
      case 'invisibility': this.burst(x, y, { color: [col, 0xffffff], count: 70, speed: 0.8, up: 0.6, life: 1.4, size: 0.1, y: 0.5, gravity: 0, drag: 0.5 }); break;
      case 'drift': this.burst(x, y, { color: [0xffffff, col], count: 40, speed: 0.6, up: 2, life: 2.5, size: 0.09, y: 0.4, gravity: -0.25, drag: 1 }); break;
      case 'teleport': break; // fx:teleport carries from/to
      default: this.burst(x, y, { color: col, count: 40 });
    }
  }

  /** Expanding ring of particles. */
  ring(x, z, color, radius = 1.2) {
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      this.particles.emit({ x, y: 0.2, z, count: 1, color, speed: radius * 2.2, spread: 1, up: 0.15, life: 0.8, size: 0.09, gravity: 0, drag: 2.2, radius: 0, dir: { x: Math.cos(a), y: 0.1, z: Math.sin(a) } }, this.rng);
    }
  }

  teleport(from, to) {
    const cyan = [0x4ee1ff, 0xffffff, 0x2a8fff];
    this.spiral(from.x, from.y, cyan);
    this.spiral(to.x, to.y, cyan);
    this.flash.color.set(0.3, 0.8, 1); this.flash.amount = 0.55;
    this.timers.arrival = { x: to.x, z: to.y, t: 3.5 };
  }

  spiral(x, z, colors) {
    for (let i = 0; i < 90; i++) {
      const a = i * 0.35, r = 0.15 + i * 0.006;
      this.particles.emit({ x: x + Math.cos(a) * r, y: i * 0.012, z: z + Math.sin(a) * r, count: 1, color: colors[i % colors.length], speed: 0.35, spread: 0.3, up: 1.6, life: 2.4, size: 0.1, gravity: 0.25, drag: 1, radius: 0 }, this.rng);
    }
  }

  levelUp(x, z) {
    this.ring(x, z, 0xffd866, 1.4);
    this.burst(x, z, { color: [0xffd866, 0xfff3bf, 0xffffff], count: 140, speed: 0.5, up: 4, life: 1.8, size: 0.11, y: 0.1, gravity: 0.8, drag: 0.4, radius: 0.35 });
    this.pillar(x, z, 0xffd866, 2.0);
    this.flash.color.set(1, 0.85, 0.4); this.flash.amount = 0.5;
  }

  /** Vertical glowing pillar that fades out. */
  pillar(x, z, color, dur = 1.5, radius = 0.32) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius, 3, 24, 1, true), beamMaterial(color));
    m.position.set(x, 1.5, z);
    this.scene.add(m);
    this.transients.push({ obj: m, t: 0, dur, fn: (o, k) => { o.material.uniforms.uOpacity.value = 0.9 * (1 - k) * (1 - k); o.material.uniforms.uTime.value = this.time; o.scale.set(1 + k * 0.5, 1, 1 + k * 0.5); } });
  }

  explosion(x, z) {
    this.burst(x, z, { color: [0xffe066, 0xff7a1a, 0xff3a1a], count: 160, speed: 3.5, up: 2.5, life: 0.9, size: 0.16, y: 0.3, gravity: -3, drag: 2, radius: 0.2 });
    this.burst(x, z, { color: [0x3a2a1a, 0x1a1210], count: 60, speed: 2, up: 1.5, life: 1.6, size: 0.24, y: 0.4, gravity: -0.8, drag: 1.5, bright: 0.6 });
    const fire = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    fire.position.set(x, 0.4, z);
    this.scene.add(fire);
    this.transients.push({ obj: fire, t: 0, dur: 0.5, fn: (o, k) => { o.scale.setScalar(0.4 + k * 2.4); o.material.opacity = 0.9 * (1 - k); o.material.color.setRGB(1, 0.6 - k * 0.5, 0.15 * (1 - k)); } });
    this.shakeRequest += 0.9;
    this.flash.color.set(1, 0.25, 0.05); this.flash.amount = 0.85;
    this.flashHomage = 0.5; // red/yellow alternation
  }

  swordFound(x, z) {
    this.pillar(x, z, 0x9fd0ff, 3.2, 0.42);
    this.ring(x, z, 0xc58cff, 2.2);
    this.burst(x, z, { color: [0x9fd0ff, 0xc58cff, 0xffffff], count: 220, speed: 0.6, up: 4.5, life: 2.6, size: 0.12, y: 0.1, gravity: 0.5, drag: 0.3, radius: 0.5 });
    this.flash.color.set(0.6, 0.7, 1); this.flash.amount = 0.8;
    this.shakeRequest += 0.4;
  }

  onPicked({ item, entity }) {
    if (!item) return;
    const x = item.x ?? entity.x, z = item.y ?? entity.y;
    if (item.type === 'gold') this.burst(x, z, { color: [0xffd866, 0xfff3bf], count: 36, speed: 1.4, up: 2.4, life: 0.9, size: 0.08, y: 0.25, gravity: -2 });
    else if (item.type === 'sword') return;
    else this.burst(x, z, { color: [0xffffff, 0x7fd4ff], count: 30, speed: 1, up: 2, life: 0.9, size: 0.08, y: 0.3, gravity: -0.5 });
  }

  victory() {
    const v = this.playerPos;
    this.pillar(v.x, v.z, 0xffd866, 4, 0.8);
    this.burst(v.x, v.z, { color: [0xffd866, 0xffffff, 0x9fd0ff], count: 300, speed: 1.5, up: 5, life: 3, size: 0.12, y: 0.2, gravity: -0.4, drag: 0.3, radius: 1 });
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
    // persistent status visuals
    const shield = S.has('shield');
    this.shield.visible = this.shieldWire.visible = shield;
    if (shield) {
      const s = 1 + 0.04 * Math.sin(this.time * 4);
      this.shield.position.set(p.x, 0.5, p.z); this.shield.scale.setScalar(s);
      this.shieldWire.position.copy(this.shield.position); this.shieldWire.rotation.y += dt * 0.6; this.shieldWire.rotation.x += dt * 0.25;
      this.shield.material.opacity = 0.18 + 0.06 * Math.sin(this.time * 3);
    }
    if (S.has('regeneration')) { T.regen += dt; while (T.regen > 0.09) { T.regen -= 0.09; this.particles.emit({ x: p.x, y: 0.1, z: p.z, count: 2, color: [0x69db7c, 0xd0ffd8], speed: 0.3, spread: 1, up: 1.6, life: 1.4, size: 0.08, gravity: 0.5, drag: 0.6, radius: 0.35 }, this.rng); } }
    if (S.has('drift')) { T.drift += dt; while (T.drift > 0.12) { T.drift -= 0.12; this.particles.emit({ x: p.x, y: 1.6, z: p.z, count: 1, color: [0xffffff, 0xe9ecef], speed: 0.4, spread: 1, up: -0.2, life: 2.6, size: 0.1, gravity: -0.25, drag: 1.2, radius: 0.5 }, this.rng); } }
    if (S.has('invisible')) { T.invis += dt; while (T.invis > 0.2) { T.invis -= 0.2; this.particles.emit({ x: p.x, y: 0.5, z: p.z, count: 2, color: [0xb197fc, 0xffffff], speed: 0.2, spread: 1, up: 0.5, life: 1.0, size: 0.07, gravity: 0, drag: 1, radius: 0.3 }, this.rng); } }
    if (ctx.hasSword) { T.sword += dt; while (T.sword > 0.07) { T.sword -= 0.07; this.particles.emit({ x: p.x, y: 0.3, z: p.z, count: 2, color: [0x9fd0ff, 0xc58cff], speed: 0.25, spread: 1, up: 1.4, life: 1.5, size: 0.08, gravity: 0.3, drag: 0.5, radius: 0.3 }, this.rng); } }
    if (T.arrival && T.arrival.t > 0) { T.arrival.t -= dt; T.arrivalAcc = (T.arrivalAcc || 0) + dt; while (T.arrivalAcc > 0.05) { T.arrivalAcc -= 0.05; this.particles.emit({ x: T.arrival.x, y: 0.1, z: T.arrival.z, count: 2, color: [0x4ee1ff, 0xffffff], speed: 0.2, spread: 1, up: 1.4, life: 1.4, size: 0.08, gravity: 0.3, drag: 0.5, radius: 0.45 }, this.rng); } }
    // gold sparkle on visible gold props
    if (ctx.goldViews && ctx.goldViews.length) {
      T.gold += dt;
      while (T.gold > 0.18) {
        T.gold -= 0.18;
        const g = this.rng.pick(ctx.goldViews);
        this.particles.emit({ x: g.position.x, y: 0.35, z: g.position.z, count: 1, color: [0xffd866, 0xffffff], speed: 0.15, spread: 1, up: 0.8, life: 0.7, size: 0.07, gravity: 0, drag: 1, radius: 0.25 }, this.rng);
      }
    }
    if (this.flashHomage > 0) { this.flashHomage -= dt; const on = Math.floor(this.time * 20) % 2 === 0; this.flash.color.set(on ? 0.85 : 0.6, on ? 0.15 : 0.55, 0.05); this.flash.amount = Math.max(this.flash.amount, 0.35); }
    this.flash.amount = Math.max(0, this.flash.amount - dt * 2.4);
    // transient meshes
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const tr = this.transients[i];
      tr.t += dt;
      const k = Math.min(1, tr.t / tr.dur);
      tr.fn(tr.obj, k);
      if (k >= 1) { this.scene.remove(tr.obj); tr.obj.geometry.dispose(); tr.obj.material.dispose(); this.transients.splice(i, 1); }
    }
    this.particles.update(dt);
    this.numbers.update(dt);
  }

  /** Camera reads and clears the accumulated shake request. */
  takeShake() { const s = this.shakeRequest; this.shakeRequest = 0; return s; }
}

// Renderer: Three scene, camera rig, lighting, dungeon view, character views, effects and the
// post-processing chain (bloom, vignette/grading/flash/fade, ACES output). Listens to game events.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TILE } from '../core/constants.js';
import { FogOfWar, Lighting, depthTint } from './lighting.js';
import { createMaterials } from './materials.js';
import { PropFactory } from './props.js';
import { DungeonView } from './dungeon.js';
import { CharacterFactory } from './characters.js';
import { Effects } from './effects.js';
import { CameraRig } from './camera.js';

const GradingShader = {
  uniforms: {
    tDiffuse: { value: null }, uTint: { value: new THREE.Color(1, 1, 1) }, uVignette: { value: 0.5 },
    uFlash: { value: new THREE.Color(0, 0, 0) }, uFlashAmt: { value: 0 }, uFade: { value: 0 }, uSat: { value: 1.05 }, uLift: { value: 0.004 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec3 uTint; uniform float uVignette; uniform vec3 uFlash; uniform float uFlashAmt; uniform float uFade; uniform float uSat; uniform float uLift;
    varying vec2 vUv;
    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      col = col * uTint + uLift;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, uSat);
      vec2 d = (vUv - 0.5) * vec2(1.15, 1.0);
      float vig = smoothstep(1.08, 0.42, length(d));
      col *= mix(1.0, vig, uVignette);
      col = mix(col, uFlash * 2.5, uFlashAmt * 0.6);
      col *= (1.0 - uFade);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Renderer {
  /**
   * @param {{canvas:HTMLCanvasElement, bus:import('../core/events.js').EventBus}} opts
   */
  constructor({ canvas, bus }) {
    this.canvas = canvas; this.bus = bus;
    this.game = null;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false, preserveDrawingBuffer: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.15;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.info.autoReset = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.fog = new FogOfWar();
    this.mats = createMaterials(this.fog);
    this.props = new PropFactory(this.mats);
    this.lighting = new Lighting(this.scene, this.fog);
    this.dungeon = new DungeonView(this.scene, this.mats, this.props, this.fog);
    this.characters = new CharacterFactory(this.fog);
    this.effects = new Effects(this.scene, this.fog, bus);
    this.cameraRig = new CameraRig(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.camera = this.cameraRig.camera;
    /** @type {Map<string, object>} entity id -> character view */
    this.views = new Map();
    this.playerView = null;
    this.time = 0;
    this.frame = 0;
    this.lastLookDir = new THREE.Vector3(0, 0, 1);
    this.setupComposer();
    this.unsub = [];
    this.bind();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setupComposer() {
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    const pr = this.gl.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.gl, target);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.55, 0.82);
    this.grading = new ShaderPass(GradingShader);
    this.output = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grading);
    this.composer.addPass(this.output);
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth), h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.gl.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.cameraRig.setAspect(w / h);
  }

  bind() {
    const on = (n, f) => this.unsub.push(this.bus.on(n, f));
    on('level:enter', (p) => this.onLevelEnter(p));
    on('entity:moved', (p) => this.onMoved(p));
    on('entity:attacked', (p) => {
      const a = this.views.get(p.attacker.id), d = this.views.get(p.defender.id);
      if (a) this.characters.attack(a, p.defender.x - p.attacker.x, p.defender.y - p.attacker.y);
      if (d && p.damage > 0) this.characters.hurt(d);
    });
    on('entity:died', (p) => { const v = this.views.get(p.entity.id); if (v) this.characters.die(v); });
    on('fx:magic-map', () => { if (this.game) this.fog.startSweep(this.game.player.x, this.game.player.y); });
    on('monster:wander', (p) => { const v = this.ensureView(p.entity); if (v) this.characters.spawn(v); });
    on('fx:lost-map', () => { this.effects.flash.color.set(0.2, 0.1, 0.4); this.effects.flash.amount = 0.6; });
  }

  /** Attach (or replace) the game instance and build its current level. */
  setGame(game) {
    this.game = game;
    this.dungeon.swordDepth = game.state.quest.swordDepth;
    this.effects.game = game;
    this.effects.resolve = (e) => { const v = this.views.get(e.id); return v ? v.pos.clone() : new THREE.Vector3(e.x, 0, e.y); };
    this.rebuildLevel();
    this.cameraRig.follow(this.playerView.pos, null);
    this.cameraRig.snap();
  }

  onLevelEnter({ level, via, direction }) {
    if (!this.game) return;
    this.rebuildLevel();
    this.fog.override = this.fog.override; // keep debug override
    this.cameraRig.follow(this.playerView.pos, null);
    this.cameraRig.snap();
    if (via === 'stairs' || via === 'pit') {
      const rig = this.cameraRig;
      if (!rig.transition) { rig.startTransition(direction === 'up' ? 'ascend' : 'descend', null); rig.transition.t = rig.transition.dur * 0.5; rig.transition.midDone = true; }
    }
    if (via === 'pit') { this.effects.shakeRequest += 0.8; this.effects.dust(level.stairsUp?.x ?? 0, level.stairsUp?.y ?? 0, 0); }
  }

  /** Start a cinematic stairs transition; `onMid` should perform the actual descend/ascend. */
  transition(kind, onMid) {
    this.cameraRig.startTransition(kind, () => { onMid(); });
  }

  rebuildLevel() {
    const level = this.game.level;
    for (const v of this.views.values()) { this.scene.remove(v.root); this.characters.dispose(v); }
    this.views.clear(); this.playerView = null;
    this.lighting.setLevel(level);
    this.dungeon.setTorchSpots(this.lighting.torchSpots);
    this.dungeon.build(level);
    this.fog.setLevel(level, { instant: true });
    const tint = depthTint(level.depth);
    void tint;
    this.grading.uniforms.uTint.value.copy(this.tintFor(level.depth));
    for (const e of level.entities) this.ensureView(e, false);
    this.syncViews(0);
  }

  tintFor(depth) {
    if (depth <= 0) return new THREE.Color(1.0, 1.0, 1.05);
    if (depth <= 5) return new THREE.Color(1.06, 1.0, 0.92);
    if (depth <= 12) return new THREE.Color(0.94, 0.98, 1.08);
    if (depth <= 18) return new THREE.Color(0.92, 1.04, 0.95);
    return new THREE.Color(1.08, 0.92, 1.06);
  }

  ensureView(e, spawnAnim = true) {
    let v = this.views.get(e.id);
    if (v) return v;
    v = this.characters.create(e);
    this.views.set(e.id, v);
    this.scene.add(v.root);
    if (e.kind === 'player') {
      this.playerView = v;
      const aura = this.props.swordMesh(0.98);
      aura.position.set(0, -0.3, 0.04); aura.rotation.z = Math.PI; aura.scale.multiplyScalar(1.12);
      aura.visible = false;
      v.nodes.armR.add(aura);
      v.swordAura = aura;
    } else if (spawnAnim) this.characters.spawn(v);
    return v;
  }

  onMoved({ entity, fromX, fromY, toX, toY, blink }) {
    const v = this.ensureView(entity);
    if (!v) return;
    const far = Math.abs(toX - fromX) > 1 || Math.abs(toY - fromY) > 1;
    if (blink || far) { this.characters.snap(v, toX, toY); if (entity.kind === 'player') { this.cameraRig.follow(v.pos, null); if (far) this.cameraRig.snap(); } return; }
    let dur;
    if (entity.kind === 'player') dur = this.game.balance.playerStepTime * 0.95;
    else dur = Math.min(0.32, Math.max(0.12, (1 / Math.max(0.1, entity.speed)) * 0.45));
    this.characters.move(v, fromX, fromY, toX, toY, dur);
  }

  /** Should a monster be drawn? Original rule: drawn wherever it stands on a revealed tile. */
  monsterShown(e) {
    const g = this.game, lv = g.level;
    if (e.invisible && !g.lightOn()) return false;
    if (this.fog.override === 'all') return true;
    return lv.isExplored(e.x, e.y);
  }

  syncViews(dt) {
    const g = this.game; if (!g) return;
    const level = g.level;
    const ids = new Set();
    for (const e of level.entities) { ids.add(e.id); this.ensureView(e); }
    const invisible = !!g.player.invisible;
    for (const [id, v] of this.views) {
      const e = v.entity;
      if (!ids.has(id) && !v.anim.dying) {
        if (e.state === 'dead') this.characters.die(v); else { this.scene.remove(v.root); this.characters.dispose(v); this.views.delete(id); continue; }
      }
      if (v.anim.done) { this.scene.remove(v.root); this.characters.dispose(v); this.views.delete(id); continue; }
      const isPlayer = e.kind === 'player';
      v.root.visible = isPlayer || v.anim.dying || this.monsterShown(e);
      this.characters.update(v, dt, { invisible: isPlayer && invisible });
      if (isPlayer && v.swordAura) v.swordAura.visible = !!e.hasSword;
    }
  }

  /** Advance all render-side animation by dt (seconds). */
  update(dt) {
    const g = this.game; if (!g) return;
    this.time += dt;
    this.syncViews(dt);
    this.dungeon.update(dt);
    const pv = this.playerView;
    const ppos = pv ? pv.pos : new THREE.Vector3(g.player.x, 0, g.player.y);
    // camera follow with look-ahead from held/facing direction
    if (!this.cameraRig.overview) {
      const held = g.heldDir || (pv && pv.anim.moving ? { dx: Math.sin(pv.anim.angle), dy: Math.cos(pv.anim.angle) } : null);
      if (held) this.lastLookDir.set(held.dx, 0, held.dy).normalize().multiplyScalar(1);
      else this.lastLookDir.multiplyScalar(Math.max(0, 1 - dt * 2));
      this.cameraRig.follow(ppos, { x: this.lastLookDir.x, z: this.lastLookDir.z });
    }
    this.cameraRig.shake(this.effects.takeShake());
    this.cameraRig.update(dt);
    const statuses = new Set(g.player.statusEffects.map((s) => s.type));
    if (g.player.invisible) statuses.add('invisible');
    const goldViews = [];
    for (const v of this.dungeon.itemViews.values()) { const it = v.userData.item; if (it && it.type === 'gold' && !it.hidden && (this.fog.override === 'all' || g.level.isVisible(it.x, it.y))) goldViews.push(v); }
    this.effects.update(dt, { player: g.player, playerPos: ppos, statuses, hasSword: !!g.player.hasSword, goldViews });
    this.lighting.update(dt, { x: ppos.x, z: ppos.z }, { lightOn: g.lightOn(), sword: !!g.player.hasSword, allLit: this.fog.override === 'all' });
    if (this.dungeon.waterMat) { this.dungeon.waterMat.uniforms.uLightPos.value.set(ppos.x, 0.9, ppos.z); }
    this.fog.update(dt);
    // grading uniforms
    const u = this.grading.uniforms;
    u.uFlash.value.copy(this.effects.flash.color); u.uFlashAmt.value = this.effects.flash.amount;
    u.uFade.value = this.cameraRig.fade;
    if (g.state.quest.timer !== null && g.state.quest.timer < 300 && g.player.hasSword) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
      u.uFlash.value.lerp(new THREE.Color(0.6, 0.05, 0.05), 0.5);
      u.uFlashAmt.value = Math.max(u.uFlashAmt.value, pulse * 0.12);
    }
  }

  /** Render-side substeps for large deterministic jumps (debug.step). */
  step(seconds) {
    let rem = seconds;
    while (rem > 1e-6) { const d = Math.min(rem, 1 / 40); this.update(d); rem -= d; }
  }

  draw() {
    this.frame++;
    this.gl.info.reset();
    this.composer.render();
  }

  /** Convenience: update then draw. */
  render(dt) { this.update(dt); this.draw(); }

  /** Tile under a client-space point (ray to the y=0 plane), or null. */
  pickTile(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    const x = Math.round(hit.x), y = Math.round(hit.z);
    if (!this.game || !this.game.level.inBounds(x, y)) return null;
    return { x, y, wx: hit.x, wz: hit.z };
  }

  /** Frame the whole current level (debug/overview). */
  overview(elevation = 62) {
    const lv = this.game.level;
    let minX = lv.width, minY = lv.height, maxX = 0, maxY = 0;
    for (let y = 0; y < lv.height; y++) for (let x = 0; x < lv.width; x++) if (lv.get(x, y) !== TILE.WALL) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    this.cameraRig.setOverview((minX + maxX) / 2, (minY + maxY) / 2 + 1, maxX - minX + 3, maxY - minY + 3, { elevation });
    this.cameraRig.snap();
  }

  /** Surface time-of-day hook (debug.setTime). */
  setTimeOfDay(hour = 12) {
    const k = Math.max(0, Math.cos(((hour - 12) / 12) * Math.PI));
    this.lighting.moon.intensity = 0.3 + k * 1.4;
    this.lighting.moon.color.setHSL(0.1 - k * 0.05, 0.4, 0.5 + k * 0.4);
  }

  /** Draw-call stats for debugging. */
  stats() { const i = this.gl.info; return { calls: i.render.calls, triangles: i.render.triangles, views: this.views.size, particles: this.effects.particles.geometry.drawRange.count }; }
}

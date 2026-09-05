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
import { Atmosphere } from './atmosphere.js';
import { createMaterials } from './materials.js';
import { PropFactory } from './props.js';
import { DungeonView } from './dungeon.js';
import { CharacterFactory } from './characters.js';
import { Effects } from './effects.js';
import { CameraRig } from './camera.js';

// Grading runs on the linear HDR frame (after bloom, before the ACES output pass): per-depth tint,
// split toning (cool shadows / warm highlights), contrast about mid grey, saturation, vignette,
// film grain (deterministic in time), flash/fade, and chromatic aberration (off unless uChroma > 0).
//
// CHARACTER MASK: hand-pixelled sprites write SPRITE_MASK_ALPHA into the frame's alpha channel
// (see sprites/spriteBillboard.js); every other opaque thing writes 1. Film grain crawling over
// flat pixel-art colour is the single loudest way to break the HD-2D illusion, so the grain is
// almost entirely muted there while the room around the character keeps its full texture.
const GradingShader = {
  uniforms: {
    tDiffuse: { value: null }, uTint: { value: new THREE.Color(1, 1, 1) }, uVignette: { value: 0.5 },
    uFlash: { value: new THREE.Color(0, 0, 0) }, uFlashAmt: { value: 0 }, uFade: { value: 0 }, uSat: { value: 1.05 }, uLift: { value: 0.004 },
    uContrast: { value: 1.05 }, uShadows: { value: new THREE.Color(0.55, 0.6, 0.8) }, uHighlights: { value: new THREE.Color(1, 0.95, 0.85) },
    uChroma: { value: 0 }, uGrain: { value: 0.02 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1600, 900) }, uPulse: { value: 0 },
    uMaskLo: { value: 0.5 }, uMaskHi: { value: 0.8 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec3 uTint; uniform float uVignette; uniform vec3 uFlash; uniform float uFlashAmt; uniform float uFade; uniform float uSat; uniform float uLift;
    uniform float uContrast; uniform vec3 uShadows; uniform vec3 uHighlights; uniform float uChroma; uniform float uGrain; uniform float uTime; uniform vec2 uRes; uniform float uPulse; uniform float uMaskLo, uMaskHi;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 d = (vUv - 0.5) * vec2(1.15, 1.0);
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 col;
      if (uChroma > 0.0) {
        vec2 off = d * uChroma * dot(d, d);
        col = vec3(texture2D(tDiffuse, vUv + off).r, src.g, texture2D(tDiffuse, vUv - off).b);
      } else col = src.rgb;
      // character mask: sprites tag themselves in alpha, everything else writes 1
      float sprite = 1.0 - smoothstep(uMaskLo, uMaskHi, src.a);
      col = col * uTint + uLift;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      // split toning (luminance-preserving): shadows take the depth band's cold cast, highlights stay warm
      vec3 st = mix(uShadows, uHighlights, smoothstep(0.02, 0.5, lum));
      col *= st / max(1e-3, dot(st, vec3(0.299, 0.587, 0.114)));
      col = mix(vec3(lum), col, uSat);
      col = (col - 0.18) * uContrast + 0.18;
      col = max(col, vec3(0.0));
      float vig = smoothstep(1.12, 0.38, length(d));
      col *= mix(1.0, vig, uVignette + uPulse);
      // fine film grain, stronger in the darks (hides banding in the void)
      float g = hash(floor(vUv * uRes) + fract(uTime * 7.31) * 113.0) - 0.5;
      col += g * uGrain * (0.25 + 0.75 * (1.0 - smoothstep(0.0, 0.6, lum))) * mix(1.0, 0.1, sprite);
      col = mix(col, uFlash * 2.5, uFlashAmt * 0.6);
      col *= (1.0 - uFade);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Renderer {
  /**
   * @param {{canvas:HTMLCanvasElement, bus:import('../core/events.js').EventBus}} opts
   */
  constructor({ canvas, bus, quality = 'high' }) {
    this.canvas = canvas; this.bus = bus;
    this.game = null;
    /** 'high': 4x MSAA half-float target, soft 1024 shadows. 'low' (QA bots, weak GPUs): no MSAA, 512 hard shadows — ~2x cheaper fill. */
    this.quality = quality === 'low' ? 'low' : 'high';
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false, preserveDrawingBuffer: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality === 'low' ? 1 : 1.5));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = this.quality === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    // EXPOSURE FOLLOWS THE AMBIENT. The board-bright pass roughly tripled the room light below the
    // surface (lighting.js `depthTint`), so the exposure comes down to meet it: at 1.1 the pale
    // corridor cobble under a torch went to paper white and took the grout lines with it. 0.92 puts
    // lit stone back on the shoulder of the ACES curve, where it keeps its field colour, while the
    // flames and the Sword still have the top of the range to themselves.
    this.gl.toneMappingExposure = 0.92;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.info.autoReset = false;
    this.scene = new THREE.Scene();
    // NOT BLACK. Whatever no mesh covers — past the surround apron, and for a frame during a level
    // change — used to be the void, which is the one thing the board-bright direction rules out.
    // A shade under the unexplored bedrock (lighting.js `bedrock()`) and the apron itself
    // (surround.js), so all three read as one mountain at three distances from the light.
    // (The rock BETWEEN two corridors is not this: that mass gets no wall geometry, so what shows
    // through the gap is dungeon.js's abyss plane — materials.js `dark`, lifted with it.)
    this.scene.background = new THREE.Color(0x16131a);
    this.fog = new FogOfWar();
    this.mats = createMaterials(this.fog);
    this.props = new PropFactory(this.mats);
    this.lighting = new Lighting(this.scene, this.fog, { quality: this.quality });
    this.atmosphere = new Atmosphere(this.scene, this.fog);
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
    // per-frame scratch (no allocations in update())
    this._ppos = new THREE.Vector3(); this._statuses = new Set(); this._goldViews = []; this._alarm = new THREE.Color(0.6, 0.05, 0.05);
    this.setupComposer();
    this.unsub = [];
    this.bind();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setupComposer() {
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    const pr = this.gl.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: this.quality === 'low' ? 0 : 4 });
    this.composer = new EffectComposer(this.gl, target);
    this.renderPass = new RenderPass(this.scene, this.camera);
    // Bloom threshold sits well above lit stone and above anything the character sprites can reach
    // (spriteBillboard clamps non-emissive art under it), so only genuinely hot things glow: flames,
    // gold, magic, the Sword — the pixel art stays a crisp read instead of smearing into a halo.
    //
    // "Well above lit stone" is a moving line, and the board-bright ambient moved it: at a 1.3
    // threshold the pale corridor cobble inside a torch pool crossed it and the corridors picked up
    // a haze along every wall. 1.55 clears the brightest floor the new ambient can produce and
    // still sits under the flames and the Sword; the strength comes down with it so the glow is a
    // halo on a hot object rather than a wash over the frame.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.44, 0.5, 1.55);
    // ...and bloom adds only light: leave the alpha channel (the character mask) untouched so the
    // grading pass can still tell sprite pixels from the room.
    const bm = this.bloom.blendMaterial;
    bm.blending = THREE.CustomBlending;
    bm.blendSrc = THREE.OneFactor; bm.blendDst = THREE.OneFactor; bm.blendEquation = THREE.AddEquation;
    bm.blendSrcAlpha = THREE.ZeroFactor; bm.blendDstAlpha = THREE.OneFactor; bm.blendEquationAlpha = THREE.AddEquation;
    this.grading = new ShaderPass(GradingShader);
    this.output = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grading);
    this.composer.addPass(this.output);
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth), h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.sizeW = w; this.sizeH = h;
    this.gl.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.grading.uniforms.uRes.value.set(w * this.gl.getPixelRatio(), h * this.gl.getPixelRatio());
    // resize() also runs during construction, before the WebGL renderer exists
    if (this.renderer) this.cameraRig.setViewportHeight(this.renderer.getDrawingBufferSize(new THREE.Vector2()).y);
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
    if (via === 'pit') { const p = this.game.player; this.effects.shakeRequest += 0.8; this.effects.dust(p.x, p.y, 40); }
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
    this.atmosphere.setLevel(level, this.lighting.torchSpots);
    this.applyGrade(level.depth);
    for (const e of level.entities) this.ensureView(e, false);
    this.syncViews(0);
  }

  /** Depth-dependent colour grading: deeper = colder, less saturated, more contrast, heavier vignette. */
  applyGrade(depth) {
    const g = depthTint(depth).grade;
    const u = this.grading.uniforms;
    u.uTint.value.copy(g.tint); u.uSat.value = g.sat; u.uContrast.value = g.contrast; u.uVignette.value = g.vignette; u.uLift.value = g.lift;
    u.uShadows.value.copy(g.shadows); u.uHighlights.value.copy(g.highlights);
  }

  /** Post-processing knobs (settings menu / debug): chromatic aberration is off by default. */
  setPost({ chroma, grain, bloom } = {}) {
    if (chroma !== undefined) this.grading.uniforms.uChroma.value = chroma;
    if (grain !== undefined) this.grading.uniforms.uGrain.value = grain;
    if (bloom !== undefined) this.bloom.strength = bloom;
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
    const ppos = pv ? pv.pos : this._ppos.set(g.player.x, 0, g.player.y);
    // camera follow with look-ahead from held/facing direction
    if (!this.cameraRig.overview) {
      const held = g.heldDir || (pv && pv.anim.moving ? { dx: Math.sin(pv.anim.angle), dy: Math.cos(pv.anim.angle) } : null);
      if (held) this.lastLookDir.set(held.dx, 0, held.dy).normalize().multiplyScalar(1);
      else this.lastLookDir.multiplyScalar(Math.max(0, 1 - dt * 2));
      this.cameraRig.follow(ppos, { x: this.lastLookDir.x, z: this.lastLookDir.z });
    }
    this.cameraRig.shake(this.effects.takeShake());
    this.cameraRig.update(dt);
    const statuses = this._statuses; statuses.clear();
    for (const s of g.player.statusEffects) statuses.add(s.type);
    if (g.player.invisible) statuses.add('invisible');
    const goldViews = this._goldViews; goldViews.length = 0;
    for (const v of this.dungeon.itemViews.values()) { const it = v.userData.item; if (it && it.type === 'gold' && !it.hidden && (this.fog.override === 'all' || g.level.isVisible(it.x, it.y))) goldViews.push(v); }
    this.effects.update(dt, { player: g.player, playerPos: ppos, statuses, hasSword: !!g.player.hasSword, goldViews });
    this.lighting.update(dt, { x: ppos.x, z: ppos.z }, { lightOn: g.lightOn(), sword: !!g.player.hasSword, allLit: this.fog.override === 'all' });
    this.atmosphere.update(dt, { x: ppos.x, z: ppos.z }, this.lighting.activeLights);
    this.dungeon.syncWater(ppos, this.lighting.activeLights);
    this.fog.update(dt);
    // grading uniforms
    const u = this.grading.uniforms;
    u.uFlash.value.copy(this.effects.flash.color); u.uFlashAmt.value = this.effects.flash.amount;
    u.uFade.value = this.cameraRig.fade;
    u.uTime.value = this.time;
    u.uPulse.value = 0;
    if (g.state.quest.timer !== null && g.state.quest.timer < 300 && g.player.hasSword) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
      u.uFlash.value.lerp(this._alarm, 0.5);
      u.uFlashAmt.value = Math.max(u.uFlashAmt.value, pulse * 0.12);
      u.uPulse.value = pulse * 0.25; // the vignette breathes with the Sword's clock
    }
  }

  /** Render-side substeps for large deterministic jumps (debug.step). */
  step(seconds) {
    let rem = seconds;
    while (rem > 1e-6) { const d = Math.min(rem, 1 / 40); this.update(d); rem -= d; }
  }

  draw() {
    this.frame++;
    // layout can change without a resize event (or after it fired): keep the buffers matched to the canvas
    if (this.canvas.clientWidth !== this.sizeW || this.canvas.clientHeight !== this.sizeH) this.resize();
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

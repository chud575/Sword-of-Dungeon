// AudioEngine: fully procedural WebAudio. Short synthesised SFX for every game event (footsteps,
// hits per monster family, gold jingle, potions, spell whooshes, stairs sweeps, fanfares...), the
// C64-style proximity drone, a low-HP heartbeat and an adaptive ambient bed that darkens with depth
// and intensifies in combat. Never throws: the AudioContext is created lazily on the first user
// gesture and every call is guarded, so a blocked/absent AudioContext just means silence.
import { createRng, hashString } from './rng.js';
import { TILE } from './constants.js';

const NOTE = (n) => 440 * 2 ** ((n - 69) / 12); // MIDI note -> Hz

export class AudioEngine {
  /**
   * @param {{bus:import('./events.js').EventBus, settings?:{masterVolume:number, musicVolume:number, sfxVolume:number}}} opts
   */
  constructor({ bus, settings = {} }) {
    this.bus = bus;
    this.ctx = null;
    this.ok = false;           // context created and usable
    this.blocked = false;      // creation failed (no WebAudio)
    this.rng = createRng('fargoal-audio');
    this.volumes = { master: settings.masterVolume ?? 0.8, music: settings.musicVolume ?? 0.5, sfx: settings.sfxVolume ?? 0.8 };
    this.muted = false;
    this.ambient = null;       // ambient graph
    this.state = { depth: 1, combat: 0, danger: 0, paused: false, over: false };
    this.heartbeat = { t: 0, phase: 0 };
    this.proximity = { t: 0 };
    this.lastGrowl = new Map();
    this.stepAlt = 0;
    this.unsub = [];
    this.bind();
    // resume on the first input gesture (autoplay policies)
    if (typeof window !== 'undefined') {
      const kick = () => { this.ensure(); };
      for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, kick, { passive: true });
      this.kick = kick;
    }
  }

  // ------------------------------------------------------------------ context
  /** Create/resume the AudioContext. Returns true when audio can play. */
  ensure() {
    if (this.blocked) return false;
    try {
      if (!this.ctx) {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!AC) { this.blocked = true; return false; }
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.sfxBus = this.ctx.createGain();
        this.musicBus = this.ctx.createGain();
        this.comp = this.ctx.createDynamicsCompressor();
        this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = 0.005; this.comp.release.value = 0.15;
        this.sfxBus.connect(this.master); this.musicBus.connect(this.master);
        this.master.connect(this.comp); this.comp.connect(this.ctx.destination);
        this.noiseBuf = this.makeNoise(1.5);
        this.applyVolumes();
        this.buildAmbient();
      }
      if (this.ctx.state === 'suspended') { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); }
      this.ok = this.ctx.state === 'running';
      return this.ok;
    } catch { this.blocked = true; return false; }
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  /** @param {{master?:number, music?:number, sfx?:number}} v */
  setVolumes(v) { Object.assign(this.volumes, v); this.applyVolumes(); }
  setMuted(m) { this.muted = !!m; this.applyVolumes(); }
  applyVolumes() {
    if (!this.ctx) return;
    try {
      const t = this.now;
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, 0.05);
      this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
      this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.55, t, 0.1);
    } catch { /* ignore */ }
  }

  makeNoise(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    const r = createRng('fargoal-noise');
    for (let i = 0; i < n; i++) d[i] = r.next() * 2 - 1;
    return buf;
  }

  // ------------------------------------------------------------------ primitives
  /**
   * A single oscillator note with an ADSR-ish envelope and optional pitch slide.
   * @param {{freq:number, to?:number, type?:OscillatorType, dur?:number, gain?:number, attack?:number, decay?:number, at?:number, detune?:number, bus?:GainNode, filter?:number, q?:number, pan?:number}} o
   */
  tone(o) {
    if (!this.ensure()) return null;
    try {
      const c = this.ctx, t0 = this.now + (o.at || 0), dur = o.dur ?? 0.2, g = o.gain ?? 0.2;
      const osc = c.createOscillator();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(Math.max(20, o.freq), t0);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur);
      if (o.detune) osc.detune.value = o.detune;
      const env = c.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(g, t0 + (o.attack ?? 0.005));
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + (o.decay ?? 0.05));
      let node = osc;
      if (o.filter) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.filter; f.Q.value = o.q ?? 1; osc.connect(f); node = f; }
      node.connect(env);
      let out = env;
      if (o.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = o.pan; env.connect(p); out = p; }
      out.connect(o.bus || this.sfxBus);
      osc.start(t0); osc.stop(t0 + dur + (o.decay ?? 0.05) + 0.02);
      return osc;
    } catch { return null; }
  }

  /**
   * A filtered noise burst (footsteps, hits, explosions, whooshes).
   * @param {{dur?:number, gain?:number, type?:BiquadFilterType, freq?:number, to?:number, q?:number, attack?:number, at?:number, bus?:GainNode}} o
   */
  noise(o = {}) {
    if (!this.ensure()) return null;
    try {
      const c = this.ctx, t0 = this.now + (o.at || 0), dur = o.dur ?? 0.15, g = o.gain ?? 0.2;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      src.playbackRate.value = 0.7 + this.rng.next() * 0.6;
      const f = c.createBiquadFilter();
      f.type = o.type || 'bandpass'; f.Q.value = o.q ?? 0.8;
      f.frequency.setValueAtTime(o.freq ?? 1200, t0);
      if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), t0 + dur);
      const env = c.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(g, t0 + (o.attack ?? 0.004));
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(env); env.connect(o.bus || this.sfxBus);
      src.start(t0); src.stop(t0 + dur + 0.02);
      return src;
    } catch { return null; }
  }

  /** Arpeggio / melody helper: notes are MIDI numbers, step in seconds. */
  melody(notes, { step = 0.09, dur = 0.16, type = 'triangle', gain = 0.16, at = 0, filter = 3000 } = {}) {
    notes.forEach((n, i) => { if (n !== null) this.tone({ freq: NOTE(n), type, dur, gain, at: at + i * step, filter, decay: 0.12 }); });
  }

  // ------------------------------------------------------------------ ambient bed
  buildAmbient() {
    try {
      const c = this.ctx;
      const out = c.createGain(); out.gain.value = 0; out.connect(this.musicBus);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 1.2; lp.connect(out);
      const mk = (type, freq, detune, gain) => {
        const o = c.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
        const g = c.createGain(); g.gain.value = gain; o.connect(g); g.connect(lp); o.start();
        return { o, g };
      };
      const a = mk('sawtooth', 55, -6, 0.5), b = mk('sawtooth', 55, 7, 0.5), sub = mk('sine', 27.5, 0, 0.9), fifth = mk('triangle', 82.5, 3, 0.18);
      // slow filter LFO: the bed breathes
      const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.07;
      const lfoG = c.createGain(); lfoG.gain.value = 90; lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
      // combat layer: pulsing square through a bandpass
      const cbOut = c.createGain(); cbOut.gain.value = 0; cbOut.connect(this.musicBus);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 3; bp.connect(cbOut);
      const pulse = mk('square', 110, 0, 0.25); pulse.g.disconnect(); pulse.g.connect(bp);
      const pulse2 = mk('sawtooth', 165, 5, 0.14); pulse2.g.disconnect(); pulse2.g.connect(bp);
      const trem = c.createOscillator(); trem.type = 'square'; trem.frequency.value = 5; const tremG = c.createGain(); tremG.gain.value = 0.5; trem.connect(tremG); tremG.connect(cbOut.gain); trem.start();
      // shimmer: a high, very quiet sine that drifts (the "magic in the air")
      const sh = mk('sine', 880, 0, 0.02); sh.g.disconnect(); sh.g.connect(this.musicBus);
      const shL = c.createOscillator(); shL.frequency.value = 0.11; const shG = c.createGain(); shG.gain.value = 0.015; shL.connect(shG); shG.connect(sh.g.gain); shL.start();
      this.ambient = { out, lp, a, b, sub, fifth, cbOut, bp, pulse, pulse2, trem, sh };
    } catch { this.ambient = null; }
  }

  /** Retune the bed for depth / combat / danger (smooth). */
  updateAmbient(dt) {
    const A = this.ambient; if (!A || !this.ctx) return;
    try {
      const t = this.now, s = this.state;
      const depthK = Math.min(1, Math.max(0, (s.depth - 1) / 20));
      const base = 55 * 2 ** (-depthK * 0.9);                 // 55 Hz -> ~29 Hz at depth 20
      A.a.o.frequency.setTargetAtTime(base, t, 0.8);
      A.b.o.frequency.setTargetAtTime(base * 1.005, t, 0.8);
      A.sub.o.frequency.setTargetAtTime(base / 2, t, 0.8);
      A.fifth.o.frequency.setTargetAtTime(base * (depthK > 0.6 ? 1.414 : 1.5), t, 0.8); // tritone when deep
      const active = !s.over && !s.paused ? 1 : 0.35;
      const level = (0.55 + depthK * 0.35) * active;
      A.out.gain.setTargetAtTime(level, t, 0.6);
      A.lp.frequency.setTargetAtTime(180 + depthK * 60 + s.combat * 500 + s.danger * 140, t, 0.4);
      A.cbOut.gain.setTargetAtTime(s.combat * 0.32 * active, t, 0.25);
      A.trem.frequency.setTargetAtTime(4 + s.combat * 3 + s.danger * 2, t, 0.3);
      A.pulse.o.frequency.setTargetAtTime(base * 2 * (s.combat > 0.5 ? 1.5 : 1), t, 0.3);
      A.sh.g.gain.setTargetAtTime(0.02 + s.danger * 0.03, t, 0.5);
    } catch { /* ignore */ }
    void dt;
  }

  // ------------------------------------------------------------------ per-frame cues
  /**
   * Update adaptive layers from the live game. Call every frame.
   * @param {number} dt seconds
   * @param {import('../game/game.js').Game|null} game
   */
  update(dt, game) {
    if (!this.ctx || !this.ok) { if (this.ctx && this.ctx.state === 'running') this.ok = true; else return; }
    const s = this.state;
    if (game) {
      s.depth = game.depth; s.paused = game.paused; s.over = game.over;
      const inCombat = !!game.state.combat;
      s.combat += ((inCombat ? 1 : 0) - s.combat) * Math.min(1, dt * (inCombat ? 6 : 0.8));
      // nearest hunting/visible monster distance (Chebyshev)
      let near = Infinity;
      const p = game.player;
      for (const m of game.level.monsters) {
        if (m.state !== 'hunt' && !game.level.isVisible(m.x, m.y)) continue;
        if (m.invisible && !game.lightOn()) continue;
        near = Math.min(near, Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)));
      }
      const danger = near <= 9 ? 1 - near / 10 : 0;
      s.danger += (danger - s.danger) * Math.min(1, dt * 2);
      if (!s.paused && !s.over) {
        // proximity drone: the C64 monster-phase buzz, faster the nearer the threat
        if (near <= 9) {
          this.proximity.t -= dt;
          if (this.proximity.t <= 0) {
            this.proximity.t = 0.3 + near * 0.16;
            const g = 0.06 + (1 - near / 10) * 0.12;
            this.tone({ freq: 48 + (9 - near) * 3, to: 34, type: 'sawtooth', dur: 0.14, gain: g, filter: 260, decay: 0.08 });
          }
        } else this.proximity.t = 0;
        // heartbeat below 30% HP
        const frac = p.maxHp > 0 ? p.hp / p.maxHp : 1;
        if (frac < 0.3) {
          this.heartbeat.t -= dt;
          if (this.heartbeat.t <= 0) {
            const k = Math.max(0, frac / 0.3);
            this.heartbeat.t = 0.45 + k * 0.75;
            this.tone({ freq: 62, to: 40, type: 'sine', dur: 0.11, gain: 0.5, decay: 0.05 });
            this.tone({ freq: 55, to: 36, type: 'sine', dur: 0.1, gain: 0.35, at: 0.16, decay: 0.05 });
          }
        } else this.heartbeat.t = 0;
      }
    }
    this.updateAmbient(dt);
  }

  // ------------------------------------------------------------------ events
  bind() {
    const on = (n, f) => this.unsub.push(this.bus.on(n, (p) => { try { f(p || {}); } catch { /* never break the game */ } }));
    on('sfx:step', (p) => this.step(p));
    on('sfx:hit', (p) => this.hit(p));
    on('sfx:slain', (p) => this.slain(p));
    on('sfx:attacked', () => this.attacked());
    on('sfx:potion', () => this.potion());
    on('sfx:teleport', () => this.teleport());
    on('sfx:stairs', (p) => this.stairs(p.direction));
    on('sfx:levelup', () => this.levelUp());
    on('sfx:sword', () => this.fanfare());
    on('sfx:sword-stolen', () => this.swordStolen());
    on('sfx:death', () => this.dirge());
    on('sfx:sacrifice', () => this.sacrifice());
    on('sfx:temple', () => this.temple());
    on('sfx:trap', (p) => this.trap(p.type));
    on('sfx:stolen', () => this.stolen());
    on('sfx:mage', () => this.mage());
    on('sfx:demon', () => this.demon());
    on('sfx:ui', (p) => this.ui(p.kind));
    on('spell:cast', (p) => this.spell(p.spell));
    on('item:picked', (p) => this.picked(p.item));
    on('monster:seen', (p) => this.growl(p.entity, 0.7));
    on('monster:noticed', (p) => this.growl(p.entity, 1));
    on('monster:wander', () => this.tone({ freq: 90, to: 60, type: 'triangle', dur: 0.6, gain: 0.12, filter: 400 }));
    on('game:over', (p) => { if (p.victory) this.victory(); });
    on('fx:magic-map', () => this.melody([72, 76, 79, 84, 88, 91], { step: 0.07, type: 'sine', gain: 0.12 }));
    on('fx:lost-map', () => this.noise({ dur: 0.7, freq: 600, to: 80, gain: 0.25 }));
    on('trap:triggered', () => {});
  }

  step(p) {
    const water = p.tile === TILE.WATER;
    this.stepAlt ^= 1;
    if (water) { this.noise({ dur: 0.18, type: 'lowpass', freq: 900, to: 300, gain: 0.16 }); return; }
    const f = 1500 + this.stepAlt * 300 + this.rng.int(-150, 150);
    this.noise({ dur: 0.05, type: 'bandpass', freq: f, q: 0.6, gain: 0.12 });
    this.tone({ freq: 70 + this.stepAlt * 12, to: 45, type: 'sine', dur: 0.05, gain: 0.08 });
  }

  hit({ family, by }) {
    if (by === 'player') {
      // steel on flesh / steel on steel
      const metal = family === 'human';
      this.noise({ dur: metal ? 0.12 : 0.09, type: metal ? 'highpass' : 'bandpass', freq: metal ? 2400 : 900, to: metal ? 1800 : 300, gain: 0.22 });
      if (metal) { this.tone({ freq: 2600 + this.rng.int(-200, 200), type: 'square', dur: 0.06, gain: 0.05, filter: 5000 }); this.tone({ freq: 3900, type: 'sine', dur: 0.09, gain: 0.05 }); }
      else this.tone({ freq: 160, to: 70, type: 'triangle', dur: 0.1, gain: 0.14 });
    } else {
      // the player is hurt: heavy thud + a pained bark
      this.noise({ dur: 0.14, type: 'lowpass', freq: 500, to: 120, gain: 0.3 });
      this.tone({ freq: 110, to: 50, type: 'sawtooth', dur: 0.14, gain: 0.18, filter: 500 });
      if (family === 'creature') this.tone({ freq: 220, to: 130, type: 'sawtooth', dur: 0.18, gain: 0.06, filter: 900, at: 0.03 });
    }
  }

  slain({ family }) {
    // VIC two-note victory tune (231/237) + a dying bark
    this.melody([69, 76], { step: 0.11, dur: 0.18, type: 'square', gain: 0.1, filter: 2500 });
    if (family === 'creature') this.tone({ freq: 180, to: 60, type: 'sawtooth', dur: 0.45, gain: 0.14, filter: 700, at: 0.02 });
    else this.noise({ dur: 0.3, freq: 700, to: 200, gain: 0.14, at: 0.02 });
  }

  /** Alarm sting: two oscillators sweeping in opposite directions [VIC]. */
  attacked() {
    this.tone({ freq: 380, to: 760, type: 'square', dur: 0.32, gain: 0.12, filter: 2500 });
    this.tone({ freq: 640, to: 330, type: 'square', dur: 0.32, gain: 0.12, filter: 2500 });
    this.noise({ dur: 0.25, freq: 1800, to: 500, gain: 0.12 });
  }

  potion() {
    for (let i = 0; i < 3; i++) this.tone({ freq: 520 - i * 90, to: 300 - i * 60, type: 'sine', dur: 0.09, gain: 0.16, at: i * 0.12 });
    this.melody([79, 84, 88], { step: 0.06, dur: 0.25, type: 'sine', gain: 0.08, at: 0.4 });
  }

  teleport() {
    // warble: fast vibrato sweep up then shimmer
    for (let i = 0; i < 10; i++) this.tone({ freq: 300 + i * 90, to: 360 + i * 90, type: 'triangle', dur: 0.05, gain: 0.12, at: i * 0.04 });
    this.noise({ dur: 0.5, type: 'highpass', freq: 3000, to: 6000, gain: 0.08, at: 0.3 });
  }

  stairs(direction) {
    const down = direction !== 'up';
    this.tone({ freq: down ? 400 : 160, to: down ? 120 : 520, type: 'triangle', dur: 0.7, gain: 0.16, filter: 1800 });
    for (let i = 0; i < 4; i++) this.noise({ dur: 0.08, freq: 1000, q: 0.5, gain: 0.08, at: 0.12 + i * 0.16 });
    if (!down) this.melody([60, 64, 67, 72], { step: 0.1, type: 'triangle', gain: 0.08, at: 0.5 });
  }

  levelUp() {
    this.melody([67, 71, 74, 79, null, 74, 79, 83], { step: 0.085, dur: 0.22, type: 'square', gain: 0.08, filter: 2200 });
    this.tone({ freq: NOTE(55), type: 'sawtooth', dur: 0.9, gain: 0.1, filter: 900, at: 0.5, decay: 0.3 });
  }

  /** The Sword fanfare (also the title tune). */
  fanfare() {
    this.melody([60, 60, 60, 64, 67, null, 64, 67, 72], { step: 0.14, dur: 0.24, type: 'square', gain: 0.1, filter: 2500 });
    this.melody([48, 48, 48, 52, 55, null, 52, 55, 60], { step: 0.14, dur: 0.3, type: 'sawtooth', gain: 0.07, filter: 1200 });
    this.tone({ freq: NOTE(72), type: 'triangle', dur: 1.2, gain: 0.12, at: 1.3, decay: 0.5 });
    this.tone({ freq: NOTE(76), type: 'triangle', dur: 1.2, gain: 0.1, at: 1.3, decay: 0.5 });
    this.tone({ freq: NOTE(79), type: 'triangle', dur: 1.2, gain: 0.1, at: 1.3, decay: 0.5 });
  }

  victory() {
    this.fanfare();
    this.melody([72, 76, 79, 84, 79, 84, 88, 91], { step: 0.11, dur: 0.3, type: 'triangle', gain: 0.1, at: 2.2 });
  }

  swordStolen() {
    this.noise({ dur: 0.6, freq: 2500, to: 200, gain: 0.25 });
    this.melody([64, 60, 56, 52], { step: 0.16, dur: 0.3, type: 'sawtooth', gain: 0.1, filter: 900 });
  }

  /** Descending dirge for death / time-out. */
  dirge() {
    this.melody([62, 60, 58, 55, null, 50], { step: 0.32, dur: 0.5, type: 'sawtooth', gain: 0.1, filter: 800 });
    this.tone({ freq: 55, to: 30, type: 'sine', dur: 2.2, gain: 0.3, decay: 0.6 });
  }

  sacrifice() {
    this.melody([72, 79, 84, 88, 91, 96], { step: 0.07, dur: 0.35, type: 'sine', gain: 0.12 });
    this.tone({ freq: NOTE(60), type: 'triangle', dur: 1.0, gain: 0.08, at: 0.3, decay: 0.4 });
  }

  temple() { this.melody([60, 67, 72], { step: 0.18, dur: 0.7, type: 'sine', gain: 0.07 }); }

  trap(type) {
    if (type === 'explosion') {
      this.noise({ dur: 0.9, type: 'lowpass', freq: 1200, to: 60, gain: 0.5 });
      this.tone({ freq: 90, to: 25, type: 'sawtooth', dur: 0.6, gain: 0.3, filter: 400 });
    } else if (type === 'teleport') this.teleport();
    else {
      this.noise({ dur: 0.5, type: 'lowpass', freq: 800, to: 100, gain: 0.35 });
      this.tone({ freq: 140, to: 40, type: 'triangle', dur: 0.5, gain: 0.25 });
      if (type === 'pit') this.tone({ freq: 700, to: 90, type: 'sine', dur: 0.8, gain: 0.1, at: 0.1 });
    }
  }

  stolen() { this.melody([76, 72, 69, 65], { step: 0.07, dur: 0.12, type: 'square', gain: 0.08, filter: 3000 }); this.noise({ dur: 0.2, freq: 3000, gain: 0.08 }); }
  mage() { for (let i = 0; i < 8; i++) this.tone({ freq: 900 - i * 90, to: 600 - i * 60, type: 'sine', dur: 0.08, gain: 0.1, at: i * 0.06 }); this.noise({ dur: 0.6, type: 'highpass', freq: 4000, gain: 0.1 }); }
  demon() { this.tone({ freq: 60, to: 25, type: 'sawtooth', dur: 1.2, gain: 0.35, filter: 300 }); this.tone({ freq: 400, to: 90, type: 'sawtooth', dur: 0.9, gain: 0.1, filter: 1200 }); this.noise({ dur: 0.8, freq: 300, to: 60, gain: 0.25 }); }

  spell(spell) {
    const f = { teleport: 900, shield: 520, regeneration: 660, invisibility: 400, light: 1200, drift: 760 }[spell] || 600;
    this.noise({ dur: 0.35, type: 'bandpass', freq: f * 0.5, to: f * 2.5, q: 2, gain: 0.16 });
    this.tone({ freq: f, to: f * 1.6, type: 'sine', dur: 0.3, gain: 0.1 });
    if (spell === 'shield') this.tone({ freq: 260, type: 'triangle', dur: 0.5, gain: 0.12, decay: 0.3, at: 0.15 });
    if (spell === 'light') this.melody([84, 88, 91], { step: 0.06, type: 'sine', gain: 0.08, at: 0.1 });
    if (spell === 'regeneration') this.melody([67, 71, 74, 79], { step: 0.08, type: 'sine', gain: 0.08, at: 0.1 });
    if (spell === 'invisibility') this.tone({ freq: 500, to: 120, type: 'triangle', dur: 0.6, gain: 0.08, at: 0.2 });
  }

  picked(item) {
    if (!item) return;
    if (item.type === 'gold') {
      const base = 84 + this.rng.int(0, 4);
      this.melody([base, base + 4, base + 7, base + 12], { step: 0.055, dur: 0.14, type: 'sine', gain: 0.14 });
      this.noise({ dur: 0.08, type: 'highpass', freq: 6000, gain: 0.06 });
    } else if (item.type === 'sword') { /* fanfare comes via sfx:sword */ }
    else { this.melody([76, 88], { step: 0.09, dur: 0.3, type: 'triangle', gain: 0.12 }); this.tone({ freq: 1760, type: 'sine', dur: 0.4, gain: 0.05, at: 0.1 }); }
  }

  /** Family/type-specific growl or shout when a monster shows itself (throttled). */
  growl(m, intensity = 1) {
    if (!m) return;
    const now = this.now;
    const last = this.lastGrowl.get(m.id) || -10;
    if (now - last < 2.5) return;
    this.lastGrowl.set(m.id, now);
    const h = hashString(m.type || 'x');
    const g = 0.1 * intensity;
    if (m.family === 'human') {
      const f = 240 + (h % 7) * 30;
      this.noise({ dur: 0.18, type: 'bandpass', freq: f * 3, to: f * 2, q: 4, gain: g * 1.2 });
      this.tone({ freq: f, to: f * 0.7, type: 'square', dur: 0.16, gain: g * 0.5, filter: 1500 });
      if (m.special === 'mage') this.mage();
    } else {
      const f = 60 + (h % 9) * 12;
      const big = (m.size || 1) > 1.2;
      this.tone({ freq: f * (big ? 0.8 : 1.3), to: f * 0.8, type: 'sawtooth', dur: 0.5, gain: g * 1.4, filter: big ? 350 : 700 });
      this.tone({ freq: f * 1.5, to: f, type: 'sawtooth', dur: 0.45, gain: g * 0.6, filter: 600, at: 0.05, detune: 12 });
      this.noise({ dur: 0.4, type: 'lowpass', freq: 500, to: 150, gain: g * 0.8 });
    }
  }

  ui(kind) {
    if (kind === 'hover') this.tone({ freq: 1400, type: 'sine', dur: 0.03, gain: 0.03 });
    else if (kind === 'open') this.melody([72, 79], { step: 0.05, dur: 0.12, type: 'sine', gain: 0.06 });
    else if (kind === 'close') this.melody([79, 72], { step: 0.05, dur: 0.12, type: 'sine', gain: 0.06 });
    else this.tone({ freq: 880, to: 1100, type: 'triangle', dur: 0.06, gain: 0.07 });
  }

  /** Title tune. */
  title() { this.fanfare(); }

  dispose() { for (const u of this.unsub) u(); this.unsub = []; if (this.kick) for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, this.kick); try { if (this.ctx) this.ctx.close(); } catch { /* ignore */ } }
}

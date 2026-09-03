// AudioEngine: fully procedural WebAudio. No samples, no network — every sound is synthesised at
// runtime from oscillators, filtered noise, inharmonic partial stacks and formant voices, placed in
// a procedural convolution reverb (the dungeon) and mixed through a glue compressor + limiter.
//
//   buses:   sfx ─┐                      ┌─ reverb send ─ tone ─ convolver ─ return ─┐
//            ui  ─┼─ master ─ glue ─ limiter ─ destination                            │
//            music ─ muffle ─ duck ─┘                                                 ┘
//
// Sound design lives in audio/sfx.js (one function per cue), the adaptive score + room ambience in
// audio/music.js, DSP helpers in audio/dsp.js. This file owns the mixer, the voice primitives the
// designs are built from, spatialisation, per-frame cues (proximity drone, heartbeat, room size)
// and the event bindings. It never throws: a missing/blocked AudioContext just means silence.
//
// Offline use (tools/audiodump.mjs): `new AudioEngine({ bus, ctx: offlineCtx })` renders through the
// exact same graph, so what the tool measures is what the player hears.
import { createRng } from './rng.js';
import { TILE } from './constants.js';
import { NOTE, dB, clamp, makeNoiseBuffer, makeImpulseResponse, makeDriveCurve, periodicWave, WAVES } from './audio/dsp.js';
import { SFX, CATALOG as SFX_CATALOG } from './audio/sfx.js';
import { Score } from './audio/music.js';

export { NOTE };
const MAX_VOICES = 72;
const LOOKAHEAD = 0.4;   // s of music scheduled ahead of the clock
const IR_PRESETS = {
  crypt: { seconds: 1.9, decay: 1.4, damp: 0.55, predelay: 0.012, early: 0.7, seed: 'ir-crypt' },
  hall: { seconds: 2.8, decay: 2.2, damp: 0.5, predelay: 0.02, early: 0.55, seed: 'ir-hall' },
  cavern: { seconds: 4.2, decay: 3.4, damp: 0.42, predelay: 0.028, early: 0.45, seed: 'ir-cavern' },
};

export class AudioEngine {
  /**
   * @param {{bus:import('./events.js').EventBus, settings?:{masterVolume?:number, musicVolume?:number, sfxVolume?:number}, ctx?:BaseAudioContext, music?:boolean}} opts
   *  ctx: an existing (Offline)AudioContext to render through; music: false skips the score (SFX-only renders)
   */
  constructor({ bus, settings = {}, ctx = null, music = true }) {
    this.bus = bus;
    this.withMusic = music;
    this.ctx = null;
    this.ok = false;           // context created and running
    this.blocked = false;      // creation failed (no WebAudio)
    this.offline = false;
    this.rng = createRng('fargoal-audio');
    this.volumes = { master: settings.masterVolume ?? 0.8, music: settings.musicVolume ?? 0.5, sfx: settings.sfxVolume ?? 0.8, ui: 1 };
    this.muted = false;
    this.voices = 0;
    this.state = { depth: 1, combat: 0, danger: 0, near: Infinity, nearPan: 0, hpFrac: 1, openness: 1, paused: false, over: false, title: false, sword: false, temple: false, water: false };
    this.heartbeat = { t: 0 };
    this.proximity = { t: 0 };
    this.lastGrowl = new Map();
    this.envT = 0;
    this.stepAlt = 0;
    this.captions = settings.audioCaptions !== false;   // accessibility: 'you hear...' lines for unseen threats
    this.captionT = -10;
    this.irName = null;
    this.irCache = new Map();
    this.unsub = [];
    this.bind();
    if (ctx) { this.ctx = ctx; this.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext; this.buildGraph(); this.ok = true; }
    else if (typeof window !== 'undefined') {
      // resume on the first input gesture (autoplay policies)
      const kick = () => { this.ensure(); };
      for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, kick, { passive: true });
      this.kick = kick;
    }
  }

  // ------------------------------------------------------------------ context & mixer
  /** Create/resume the AudioContext. Returns true when audio can play. */
  ensure() {
    if (this.blocked) return false;
    if (this.offline) return true;
    try {
      if (!this.ctx) {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!AC) { this.blocked = true; return false; }
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.buildGraph();
      }
      if (this.ctx.state === 'suspended') { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); }
      this.ok = this.ctx.state === 'running';
      return this.ok;
    } catch { this.blocked = true; return false; }
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  buildGraph() {
    const c = this.ctx;
    this.master = c.createGain();
    this.glue = c.createDynamicsCompressor();
    this.glue.threshold.value = -20; this.glue.knee.value = 14; this.glue.ratio.value = 2.5; this.glue.attack.value = 0.012; this.glue.release.value = 0.28;
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -4; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.001; this.limiter.release.value = 0.09;
    this.master.connect(this.glue); this.glue.connect(this.limiter); this.limiter.connect(c.destination);
    // buses
    this.sfxBus = c.createGain(); this.sfxBus.connect(this.master);
    this.uiBus = c.createGain(); this.uiBus.connect(this.master);
    this.musicIn = c.createGain();                       // score layers land here
    this.muffle = c.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 18000; this.muffle.Q.value = 0.4;
    this.duckGain = c.createGain();
    this.musicBus = c.createGain();
    this.musicIn.connect(this.muffle); this.muffle.connect(this.duckGain); this.duckGain.connect(this.musicBus); this.musicBus.connect(this.master);
    // reverb: send -> tone -> convolver -> return
    this.reverbSend = c.createGain(); this.reverbSend.gain.value = 1;
    this.sendTone = c.createBiquadFilter(); this.sendTone.type = 'lowpass'; this.sendTone.frequency.value = 5200; this.sendTone.Q.value = 0.3;
    this.sendHp = c.createBiquadFilter(); this.sendHp.type = 'highpass'; this.sendHp.frequency.value = 140;
    this.convolver = c.createConvolver();
    this.reverbReturn = c.createGain(); this.reverbReturn.gain.value = 0.9;
    this.reverbSend.connect(this.sendHp); this.sendHp.connect(this.sendTone); this.sendTone.connect(this.convolver); this.convolver.connect(this.reverbReturn); this.reverbReturn.connect(this.master);
    this.setRoom('crypt');
    // shared resources
    this.noiseWhite = makeNoiseBuffer(c, 2, 'fargoal-noise-white', 'white');
    this.noisePink = makeNoiseBuffer(c, 2, 'fargoal-noise-pink', 'pink');
    this.noiseBrown = makeNoiseBuffer(c, 2, 'fargoal-noise-brown', 'brown');
    this.driveCurves = new Map();
    this.applyVolumes();
    // the score (adaptive music + ambience)
    this.score = null;
    if (this.withMusic) { try { this.score = new Score(this); } catch { this.score = null; } }
  }

  /** Swap the room impulse response ('crypt' | 'hall' | 'cavern'). */
  setRoom(name) {
    if (!this.ctx || this.irName === name || !IR_PRESETS[name]) return;
    try {
      let ir = this.irCache.get(name);
      if (!ir) { ir = makeImpulseResponse(this.ctx, IR_PRESETS[name]); this.irCache.set(name, ir); }
      this.convolver.buffer = ir; this.irName = name;
    } catch { /* ignore */ }
  }

  /** @param {{master?:number, music?:number, sfx?:number, ui?:number}} v */
  setVolumes(v) { Object.assign(this.volumes, v); this.applyVolumes(); }
  setMuted(m) { this.muted = !!m; this.applyVolumes(); }
  applyVolumes() {
    if (!this.ctx) return;
    try {
      const t = this.now, V = this.volumes;
      const curve = (x) => clamp(x, 0, 1) ** 1.6; // perceptual-ish slider law
      this.master.gain.setTargetAtTime(this.muted ? 0 : curve(V.master) * 1.0, t, 0.05);
      this.sfxBus.gain.setTargetAtTime(curve(V.sfx), t, 0.05);
      this.uiBus.gain.setTargetAtTime(curve(V.sfx) * 0.9 * (V.ui ?? 1), t, 0.05);
      this.musicBus.gain.setTargetAtTime(curve(V.music) * 0.7, t, 0.1);
    } catch { /* ignore */ }
  }

  busFor(b) {
    if (!b || b === 'sfx') return this.sfxBus;
    if (b === 'ui') return this.uiBus;
    if (b === 'music') return this.musicIn;
    return b; // a GainNode
  }

  ready(prio = 1) {
    if (!this.ensure()) return false;
    if (this.offline) return true;               // offline renders schedule everything up-front
    return this.voices < MAX_VOICES || prio >= 2;
  }

  track(src) {
    this.voices++;
    src.addEventListener('ended', () => { this.voices = Math.max(0, this.voices - 1); });
  }

  driveCurve(amount) {
    const k = Math.round(amount * 10) / 10;
    let cv = this.driveCurves.get(k); if (!cv) { cv = makeDriveCurve(k); this.driveCurves.set(k, cv); }
    return cv;
  }

  // ------------------------------------------------------------------ envelope & routing
  /**
   * Resolve envelope timing. Options: attack, hold, decay (exponential tail), dur (= attack+hold legacy).
   * @returns {{t0:number, a:number, h:number, d:number, tEnd:number}}
   */
  envTimes(o) {
    const t0 = this.now + (o.at || 0);
    const a = Math.max(0.001, o.attack ?? 0.005);
    let h = o.hold ?? 0;
    if (o.dur != null && o.hold == null) h = Math.max(0, o.dur - a);
    const d = Math.max(0.005, o.decay ?? o.release ?? 0.12);
    return { t0, a, h, d, tEnd: t0 + a + h + d };
  }

  /** Apply the standard envelope to a gain param. `curve`: 'exp' (default) | 'lin'. */
  envelope(param, { t0, a, h, d }, g, curve = 'exp') {
    param.setValueAtTime(0.0001, t0);
    if (curve === 'lin') param.linearRampToValueAtTime(g, t0 + a); else param.exponentialRampToValueAtTime(Math.max(0.0002, g), t0 + a);
    if (h > 0) param.setValueAtTime(Math.max(0.0002, g), t0 + a + h);
    param.exponentialRampToValueAtTime(0.0001, t0 + a + h + d);
  }

  /**
   * Route a node through optional drive/filter, an envelope, an optional panner, into a bus, with an
   * optional reverb send. Returns the envelope gain node (already connected).
   */
  route(input, o, tm) {
    const c = this.ctx;
    let node = input;
    if (o.drive) { const ws = c.createWaveShaper(); ws.curve = this.driveCurve(o.drive); ws.oversample = '2x'; node.connect(ws); node = ws; }
    const filters = [o.filter, o.filter2].filter(Boolean);
    for (const f of filters) {
      const bq = c.createBiquadFilter();
      bq.type = f.type || 'lowpass'; bq.Q.value = f.q ?? 0.9;
      bq.frequency.setValueAtTime(clamp(f.freq ?? 1200, 20, 20000), tm.t0);
      if (f.to) bq.frequency.exponentialRampToValueAtTime(clamp(f.to, 20, 20000), tm.t0 + (f.slide ?? (tm.a + tm.h + tm.d)));
      if (f.bend) { let t = tm.t0; for (const [dt, fr] of f.bend) { t += dt; bq.frequency.exponentialRampToValueAtTime(clamp(fr, 20, 20000), t); } }
      node.connect(bq); node = bq;
    }
    const env = c.createGain();
    this.envelope(env.gain, tm, o.gain ?? 0.2, o.curve);
    node.connect(env);
    let out = env;
    if (o.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1); env.connect(p); out = p; }
    out.connect(this.busFor(o.bus));
    if (o.send) { const s = c.createGain(); s.gain.value = clamp(o.send, 0, 1.5); out.connect(s); s.connect(this.reverbSend); }
    return env;
  }

  // ------------------------------------------------------------------ voice primitives
  /**
   * A single oscillator voice with envelope, pitch slide/bend, vibrato, drive, filter, pan, send.
   * @param {{freq:number, to?:number, slide?:number, bend?:[number,number][], type?:OscillatorType|string, wave?:string, detune?:number,
   *   dur?:number, attack?:number, hold?:number, decay?:number, gain?:number, at?:number, curve?:string,
   *   vibrato?:{rate:number, depth:number, delay?:number}, filter?:object, filter2?:object, drive?:number, pan?:number, send?:number, bus?:any, prio?:number}} o
   */
  osc(o) {
    if (!this.ready(o.prio)) return null;
    try {
      const c = this.ctx, tm = this.envTimes(o);
      const src = c.createOscillator();
      if (o.wave && WAVES[o.wave]) src.setPeriodicWave(periodicWave(c, o.wave, WAVES[o.wave]));
      else src.type = o.type || 'sine';
      const f0 = clamp(o.freq, 16, 20000);
      src.frequency.setValueAtTime(f0, tm.t0);
      if (o.to) src.frequency.exponentialRampToValueAtTime(clamp(o.to, 16, 20000), tm.t0 + (o.slide ?? (tm.a + tm.h + tm.d)));
      if (o.bend) { let t = tm.t0; for (const [dt, fr] of o.bend) { t += dt; src.frequency.exponentialRampToValueAtTime(clamp(fr, 16, 20000), t); } }
      if (o.detune) src.detune.value = o.detune;
      if (o.vibrato) {
        const lfo = c.createOscillator(); lfo.frequency.value = o.vibrato.rate; const lg = c.createGain(); lg.gain.setValueAtTime(0, tm.t0);
        lg.gain.linearRampToValueAtTime(o.vibrato.depth, tm.t0 + (o.vibrato.delay ?? 0.08)); lfo.connect(lg); lg.connect(src.detune); lfo.start(tm.t0); lfo.stop(tm.tEnd + 0.05);
      }
      this.route(src, o, tm);
      src.start(tm.t0); src.stop(tm.tEnd + 0.03);
      this.track(src);
      return src;
    } catch { return null; }
  }

  /**
   * A filtered noise burst. `color`: white|pink|brown; `rate`: playback rate (pitch of the noise texture).
   * @param {{color?:string, rate?:number, dur?:number, attack?:number, hold?:number, decay?:number, gain?:number, at?:number,
   *   filter?:object, filter2?:object, drive?:number, pan?:number, send?:number, bus?:any, prio?:number, curve?:string}} o
   */
  noise(o = {}) {
    if (!this.ready(o.prio)) return null;
    try {
      const c = this.ctx, tm = this.envTimes(o);
      const src = c.createBufferSource();
      src.buffer = o.color === 'pink' ? this.noisePink : o.color === 'brown' ? this.noiseBrown : this.noiseWhite; src.loop = true;
      src.loopStart = this.rng.next() * 1.5;
      src.playbackRate.value = o.rate ?? (0.85 + this.rng.next() * 0.3);
      const opts = o.filter ? o : { ...o, filter: { type: 'bandpass', freq: 1200, q: 0.8 } };
      this.route(src, opts, tm);
      src.start(tm.t0, src.loopStart); src.stop(tm.tEnd + 0.03);
      this.track(src);
      return src;
    } catch { return null; }
  }

  /**
   * Inharmonic partial stack (metal, coins, bells, glass): sines at freq*ratios[i] with their own decays.
   * @param {{freq:number, ratios:number[], amps?:number[], decays?:number[], gain?:number, attack?:number, at?:number, jitter?:number,
   *   type?:OscillatorType, pan?:number, send?:number, bus?:any, filter?:object, drive?:number, prio?:number}} o
   */
  partials(o) {
    if (!this.ready(o.prio)) return null;
    try {
      const c = this.ctx, n = o.ratios.length;
      const decays = o.decays || o.ratios.map((r, i) => (o.decay ?? 0.4) / (1 + i * 0.45));
      const longest = Math.max(...decays);
      const tm = this.envTimes({ ...o, hold: 0, decay: longest });
      const sum = c.createGain(); sum.gain.value = 1;
      const jit = o.jitter ?? 0.004;
      for (let i = 0; i < n; i++) {
        const osc = c.createOscillator(); osc.type = o.type || 'sine';
        osc.frequency.value = clamp(o.freq * o.ratios[i] * (1 + (this.rng.next() * 2 - 1) * jit), 16, 20000);
        const g = c.createGain();
        const amp = (o.amps ? o.amps[i] : 1 / (1 + i * 0.7));
        g.gain.setValueAtTime(0.0001, tm.t0);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), tm.t0 + tm.a);
        g.gain.exponentialRampToValueAtTime(0.0001, tm.t0 + tm.a + decays[i]);
        osc.connect(g); g.connect(sum);
        osc.start(tm.t0); osc.stop(tm.t0 + tm.a + decays[i] + 0.03);
        if (i === 0) this.track(osc);
      }
      this.route(sum, { ...o, curve: 'lin' }, { t0: tm.t0, a: 0.001, h: longest, d: 0.05, tEnd: tm.t0 + longest + 0.06 });
      return sum;
    } catch { return null; }
  }

  /**
   * A formant voice (growls, shouts, chants): a rich source (saw/pulse) + optional breath noise through
   * parallel bandpass "formants", with a pitch contour and vibrato. Formants: [{f, q, g}].
   * @param {{freq:number, bend?:[number,number][], to?:number, formants:{f:number,q?:number,g?:number}[], breath?:number, type?:OscillatorType|string,
   *   vibrato?:{rate:number, depth:number}, attack?:number, hold?:number, decay?:number, gain?:number, at?:number, pan?:number, send?:number,
   *   drive?:number, growl?:number, bus?:any, prio?:number}} o
   */
  formant(o) {
    if (!this.ready(o.prio)) return null;
    try {
      const c = this.ctx, tm = this.envTimes(o);
      const src = c.createOscillator();
      if (o.wave && WAVES[o.wave]) src.setPeriodicWave(periodicWave(c, o.wave, WAVES[o.wave])); else src.type = o.type || 'sawtooth';
      src.frequency.setValueAtTime(clamp(o.freq, 16, 20000), tm.t0);
      if (o.to) src.frequency.exponentialRampToValueAtTime(clamp(o.to, 16, 20000), tm.tEnd);
      if (o.bend) { let t = tm.t0; for (const [dt, fr] of o.bend) { t += dt; src.frequency.exponentialRampToValueAtTime(clamp(fr, 16, 20000), t); } }
      if (o.vibrato) {
        const lfo = c.createOscillator(); lfo.frequency.value = o.vibrato.rate; const lg = c.createGain(); lg.gain.value = o.vibrato.depth;
        lfo.connect(lg); lg.connect(src.detune); lfo.start(tm.t0); lfo.stop(tm.tEnd + 0.05);
      }
      // "growl": amplitude modulation at a sub-audio/low-audio rate gives the throaty rasp
      let srcOut = src;
      if (o.growl) {
        const am = c.createGain(); am.gain.value = 0.6;
        const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = o.growl; const lg = c.createGain(); lg.gain.value = 0.4;
        lfo.connect(lg); lg.connect(am.gain); src.connect(am); lfo.start(tm.t0); lfo.stop(tm.tEnd + 0.05); srcOut = am;
      }
      const sum = c.createGain(); sum.gain.value = 1;
      let breath = null;
      if (o.breath) { breath = c.createBufferSource(); breath.buffer = this.noisePink; breath.loop = true; breath.loopStart = this.rng.next(); const bg = c.createGain(); bg.gain.value = o.breath; breath.connect(bg); breath.start(tm.t0, breath.loopStart); breath.stop(tm.tEnd + 0.03); breath = bg; }
      for (const F of o.formants) {
        const bq = c.createBiquadFilter(); bq.type = 'bandpass'; bq.Q.value = F.q ?? 6;
        bq.frequency.setValueAtTime(clamp(F.f, 40, 12000), tm.t0);
        if (F.to) bq.frequency.exponentialRampToValueAtTime(clamp(F.to, 40, 12000), tm.tEnd);
        const g = c.createGain(); g.gain.value = F.g ?? 1;
        srcOut.connect(bq); if (breath) breath.connect(bq); bq.connect(g); g.connect(sum);
      }
      this.route(sum, o, tm);
      src.start(tm.t0); src.stop(tm.tEnd + 0.03);
      this.track(src);
      return src;
    } catch { return null; }
  }

  /** Melody helper: MIDI notes (null = rest), `step` seconds apart. Extra options go to osc(). */
  melody(notes, { step = 0.09, at = 0, ...rest } = {}) {
    notes.forEach((n, i) => { if (n != null) this.osc({ type: 'triangle', decay: 0.18, gain: 0.14, ...rest, freq: NOTE(n), at: at + i * step }); });
  }

  /** A chord of MIDI notes through osc() options. */
  chord(notes, opts = {}) { for (const n of notes) this.osc({ ...opts, freq: NOTE(n) }); }

  /** Sidechain-style music duck: dip by `amount` (0..1) and recover over `dur` seconds. */
  duck(amount = 0.5, dur = 0.8, at = 0) {
    if (!this.ctx) return;
    try {
      const g = this.duckGain.gain, t = this.now + at;
      g.cancelScheduledValues(t);
      g.setValueAtTime(1, t);
      g.linearRampToValueAtTime(1 - clamp(amount, 0, 0.95), t + 0.03);
      g.setTargetAtTime(1, t + 0.12, dur / 3);
    } catch { /* ignore */ }
  }

  /** Play a named design from audio/sfx.js. */
  play(name, p = {}) {
    const f = SFX[name];
    if (!f || !this.ready(p.prio)) return;
    try { f(this, p); } catch { /* never break the game */ }
  }

  /** Stereo position + distance attenuation for an entity relative to the player. */
  spatial(e, game) {
    const p = game && game.player;
    if (!e || !p) return { pan: 0, gain: 1, dist: 0, seen: true };
    const dx = e.x - p.x, dy = e.y - p.y;
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    const seen = game.level.isVisible(e.x, e.y);
    return { pan: clamp(dx / 7, -0.85, 0.85), gain: 1 / (1 + dist * 0.28), dist, seen, dy };
  }

  // ------------------------------------------------------------------ per-frame cues
  /**
   * Update adaptive layers from the live game. Call every frame.
   * @param {number} dt seconds
   * @param {import('../game/game.js').Game|null} game  null on the title screen
   */
  update(dt, game) {
    if (!this.ctx || !this.ok) { if (this.ctx && this.ctx.state === 'running') this.ok = true; else return; }
    dt = clamp(dt, 0, 0.1);
    const s = this.state;
    s.title = !game;
    if (!game) { s.paused = false; s.over = false; s.combat *= 1 - Math.min(1, dt * 2); s.danger *= 1 - Math.min(1, dt * 2); s.hpFrac = 1; }
    else {
      s.depth = game.depth; s.paused = !!game.paused; s.over = !!game.over;
      const inCombat = !!game.state.combat;
      s.combat += ((inCombat ? 1 : 0) - s.combat) * Math.min(1, dt * (inCombat ? 5 : 0.7));
      const p = game.player, lv = game.level;
      // nearest threatening monster (hunting or visible) — the "you hear before you see" cue
      let near = Infinity, nearPan = 0;
      for (const m of lv.monsters) {
        if (m.state !== 'hunt' && !lv.isVisible(m.x, m.y)) continue;
        if (m.invisible && !game.lightOn()) continue;
        const d = Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y));
        if (d < near) { near = d; nearPan = clamp((m.x - p.x) / 7, -0.8, 0.8); }
      }
      s.near = near; s.nearPan = nearPan;
      const danger = near <= 9 ? 1 - near / 10 : 0;
      s.danger += (danger - s.danger) * Math.min(1, dt * 2);
      s.hpFrac = p.maxHp > 0 ? clamp(p.hp / p.maxHp, 0, 1) : 1;
      // slow environment probe: room size, water, sword, temple
      this.envT -= dt;
      if (this.envT <= 0) { this.envT = 0.35; this.probeEnvironment(game); }
      if (!s.paused && !s.over) { this.proximityCue(dt); this.heartbeatCue(dt); }
    }
    this.applyMuffle();
    if (this.score) this.score.update(dt, s, this.now + LOOKAHEAD);
  }

  probeEnvironment(game) {
    const s = this.state, p = game.player, lv = game.level;
    let open = 0, water = 0, temple = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = p.x + dx, y = p.y + dy;
      if (!lv.inBounds(x, y)) continue;
      const t = lv.get(x, y);
      if (t !== TILE.WALL) open++;
      if (t === TILE.WATER) water++;
      if (t === TILE.TEMPLE) temple++;
    }
    const openness = clamp((open - 6) / 34, 0, 1);
    s.openness += (openness - s.openness) * 0.5;
    s.water = water > 0; s.temple = temple > 0;
    s.sword = !!(lv.items && lv.items.some((i) => i.type === 'sword')) || !!p.hasSword;
    try {
      const t = this.now;
      // corridors are tight and dry; halls bloom
      this.reverbReturn.gain.setTargetAtTime(0.5 + s.openness * 0.55, t, 0.4);
      this.sendTone.frequency.setTargetAtTime(2600 + s.openness * 3600, t, 0.4);
    } catch { /* ignore */ }
    this.setRoom(s.depth <= 4 ? 'crypt' : s.depth <= 11 ? 'hall' : 'cavern');
  }

  /** The C64 monster-phase drone, reborn: a tuned pulse that quickens and rises as the threat closes. */
  proximityCue(dt) {
    const s = this.state;
    if (s.near > 9 || s.combat > 0.6) { this.proximity.t = 0; return; }
    this.proximity.t -= dt;
    if (this.proximity.t > 0) return;
    const k = 1 - s.near / 10;               // 0.1 far .. 1 adjacent
    this.proximity.t = 0.22 + (1 - k) * 0.9;
    const root = this.score ? this.score.rootHz(0.5) : 55;
    this.play('proximity', { k, pan: s.nearPan, root });
  }

  heartbeatCue(dt) {
    const s = this.state;
    if (s.hpFrac >= 0.3) { this.heartbeat.t = 0; return; }
    this.heartbeat.t -= dt;
    if (this.heartbeat.t > 0) return;
    const k = clamp(s.hpFrac / 0.3, 0, 1);   // 1 at 30 %, 0 at death's door
    this.heartbeat.t = 0.42 + k * 0.75;
    this.play('heartbeat', { k: 1 - k });
  }

  /** Music muffle (low HP) — the world closes in. */
  applyMuffle() {
    try {
      const s = this.state, t = this.now;
      const k = s.title ? 1 : clamp(s.hpFrac / 0.3, 0, 1);
      this.muffle.frequency.setTargetAtTime(k >= 1 ? 18000 : 600 + k * k * 12000, t, 0.5);
    } catch { /* ignore */ }
  }

  // ------------------------------------------------------------------ events
  bind() {
    const on = (n, f) => this.unsub.push(this.bus.on(n, (p) => { try { f(p || {}); } catch { /* never break the game */ } }));
    on('sfx:step', (p) => this.play('step', { ...p, alt: (this.stepAlt ^= 1) }));
    on('sfx:hit', (p) => this.play(p.by === 'player' ? (p.family === 'human' ? 'hit-human' : 'hit-creature') : 'hurt', p));
    on('entity:attacked', (p) => this.attacked(p));
    on('sfx:slain', (p) => this.play(p.family === 'human' ? 'slain-human' : 'slain-creature', p));
    on('sfx:attacked', () => { this.play('alarm'); this.duck(0.45, 1); });
    on('combat:start', (p) => { if (p.playerInitiated) this.play('swing', { pan: p.entity ? this.spatial(p.entity, this.game).pan : 0 }); });
    on('sfx:potion', () => this.play('potion'));
    on('sfx:teleport', () => this.play('teleport'));
    on('sfx:stairs', (p) => { this.play(p.direction === 'up' ? 'stairs-up' : 'stairs-down'); this.duck(0.3, 1.2); });
    on('sfx:levelup', () => { this.play('levelup'); this.duck(0.5, 2); });
    on('sfx:sword', () => { this.play('sword-fanfare'); this.duck(0.6, 3); });
    on('sfx:sword-stolen', () => this.play('sword-stolen'));
    on('sfx:death', () => { this.play('death-dirge'); this.duck(0.7, 4); });
    on('sfx:sacrifice', () => this.play('sacrifice'));
    on('sfx:temple', () => this.play('temple'));
    on('sfx:trap', (p) => { this.play('trap-' + (p.type || 'pit')); this.duck(0.5, 1.2); });
    on('sfx:stolen', () => this.play('stolen'));
    on('sfx:mage', () => this.play('mage-cast'));
    on('sfx:demon', () => { this.play('demon-roar'); this.duck(0.5, 1.5); });
    on('sfx:ui', (p) => this.play('ui-' + (p.kind || 'click')));
    on('spell:cast', (p) => this.play('spell-' + p.spell, p));
    on('item:picked', (p) => this.picked(p.item));
    on('fx:chest', () => this.play('chest'));
    on('monster:seen', (p) => this.growl(p.entity, 0.7));
    on('monster:noticed', (p) => { this.growl(p.entity, 1); if (this.state.combat < 0.3) this.play('danger-sting', { pan: this.spatial(p.entity, this.game).pan }); });
    on('monster:wander', (p) => this.wander(p.entity));
    on('entity:moved', (p) => this.moved(p.entity));
    on('game:over', (p) => { if (p.victory) { this.play('victory'); this.duck(0.7, 4); } });
    on('game:start', (p) => { this.game = p.game; this.lastGrowl.clear(); this.captionT = -10; });
    on('level:enter', (p) => { this.state.depth = p.depth; this.envT = 0; this.lastGrowl.clear(); if (this.score) this.score.onLevel(p.depth); });
    on('fx:magic-map', () => this.play('magic-map'));
    on('fx:lost-map', () => this.play('lost-map'));
  }

  get game() { return this._game || null; }
  set game(g) { this._game = g; }

  /** Throttled sound caption in the message log (works even when audio is blocked — it is an accessibility aid). */
  caption(text, kind = 'info', minGap = 2.5) {
    if (!this.captions) return;
    // throttle on game time when a game is running (deterministic under debug.step), else wall clock
    const g = this.game;
    const t = g && g.state && typeof g.state.time === 'number' ? g.state.time : (typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000);
    if (t - this.captionT < minGap) return;
    this.captionT = t;
    try { this.bus.emit('log', { text, kind }); } catch { /* ignore */ }
  }

  /** "to the north-east" from a tile offset. */
  static dirWord(dx, dy) {
    if (!dx && !dy) return 'right here';
    const ns = dy < 0 ? 'north' : dy > 0 ? 'south' : '', ew = dx > 0 ? 'east' : dx < 0 ? 'west' : '';
    const adx = Math.abs(dx), ady = Math.abs(dy);
    const w = adx > ady * 2 ? ew : ady > adx * 2 ? ns : (ns && ew ? `${ns}-${ew}` : ns || ew);
    return `to the ${w}`;
  }

  static voiceWord(m) {
    const t = m.type || '';
    const W = { 'dire-wolf': 'a howl', 'dimension-spider': 'a dry chittering', gargoyle: 'a stony screech', wyvern: 'a shriek and the beat of wings', 'shadow-dragon': 'a vast, slow breathing', 'fyre-drake': 'a roar like a furnace', demon: 'an infernal bellow', rogue: 'a stifled snigger', monk: 'low chanting', assassin: 'a whisper', mage: 'arcane muttering', 'war-lord': 'a war-horn', hobgoblin: 'cackling', ogre: 'a deep, wet growl', troll: 'a heavy growl' };
    return W[t] || (m.family === 'human' ? 'a shout' : 'a growl');
  }

  attacked({ attacker, defender, damage, crit, killed }) {
    if (!attacker) return;
    const pan = attacker.kind === 'monster' ? this.spatial(attacker, this.game).pan : (defender ? this.spatial(defender, this.game).pan : 0);
    if (attacker.kind === 'player') {
      if (crit) { this.play('crit', { pan }); this.duck(0.3, 0.5); }
    } else {
      // monster attack voice + impact scaled by damage
      const heavy = clamp((damage || 0) / 12, 0.2, 1.2);
      this.play('monster-attack', { entity: attacker, pan, heavy });
      if (damage <= 0) this.play('shield-block', { pan });
      if (killed) this.duck(0.8, 3);
    }
  }

  picked(item) {
    if (!item) return;
    if (item.type === 'gold') this.play('gold', { amount: item.gold || 50 });
    else if (item.type === 'sword') { /* fanfare comes via sfx:sword */ }
    else if (item.type === 'potion' || item.type === 'beacon') this.play('item');
    else this.play('item', { magic: true });
  }

  /** Family/type-specific voice when a monster shows itself (throttled per monster). */
  growl(m, intensity = 1) {
    if (!m) return;
    const now = this.now;
    const last = this.lastGrowl.get(m.id) ?? -10;
    if (now - last < 2.5) return;
    this.lastGrowl.set(m.id, now);
    const sp = this.spatial(m, this.game);
    if (!sp.seen && this.game) this.caption(`You hear ${AudioEngine.voiceWord(m)} ${AudioEngine.dirWord(m.x - this.game.player.x, m.y - this.game.player.y)}.`, 'danger');
    this.play('voice', { entity: m, intensity: intensity * clamp(sp.gain * 1.3, 0.35, 1), pan: sp.pan, seen: sp.seen });
  }

  wander(m) {
    if (!m || !this.game) return;
    const sp = this.spatial(m, this.game);
    if (sp.dist > 9) return;
    if (!sp.seen) this.caption(`Something stirs ${AudioEngine.dirWord(m.x - this.game.player.x, m.y - this.game.player.y)}.`, 'info', 6);
    this.play('wander', { entity: m, pan: sp.pan, gain: sp.gain, seen: sp.seen });
  }

  /** Distant, panned, muffled footfalls of unseen monsters nearby. */
  moved(m) {
    if (!m || m.kind !== 'monster' || !this.game) return;
    const sp = this.spatial(m, this.game);
    if (sp.dist > 7 || sp.dist === 0) return;
    if (!sp.seen && sp.dist <= 5) this.caption(`${(m.size || 1) > 1.2 ? 'Heavy footfalls' : 'Footsteps'} echo ${AudioEngine.dirWord(m.x - this.game.player.x, m.y - this.game.player.y)}.`, 'info', 5);
    this.play('monster-step', { entity: m, pan: sp.pan, gain: sp.gain * (sp.seen ? 0.7 : 1), seen: sp.seen, dist: sp.dist });
  }

  /** Title tune. */
  title() { this.play('title-fanfare'); this.duck(0.5, 2.5); }

  /** Offline showcase for tools/audiodump.mjs: `seconds` of the adaptive score through a scripted arc. */
  renderMusicShowcase(seconds = 20) {
    if (!this.score) return;
    const T = seconds;
    this.score.renderTimeline([
      { t: 0, depth: 3, combat: 0, danger: 0, active: 1 },
      { t: T * 0.3, danger: 0.7 },
      { t: T * 0.45, combat: 1, danger: 1 },
      { t: T * 0.78, combat: 0, danger: 0.2 },
      { t: T * 0.9, danger: 0 },
    ], T);
  }

  dispose() {
    for (const u of this.unsub) u(); this.unsub = [];
    if (this.kick && typeof window !== 'undefined') for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, this.kick);
    try { if (this.score) this.score.dispose(); } catch { /* ignore */ }
    try { if (this.ctx && !this.offline) this.ctx.close(); } catch { /* ignore */ }
  }
}

/** Every one-shot design with representative parameters, for tools/audiodump.mjs. */
export const CATALOG = SFX_CATALOG;
export { dB };

// Adaptive generative score + room ambience. A single 16th-note grid (84 BPM) is scheduled ahead of
// the audio clock; each step decides deterministically (seeded per step) what every layer plays,
// and continuous layer gains crossfade with the game state:
//
//   pad      always: slow detuned chord bed (dark modes, key descends with depth)      + sub drone
//   motif    exploring: sparse plucked celesta melody with a dotted echo
//   pulse    danger: low heartbeat toms + tremolo low strings
//   combat   fighting: taiko/kick/snare pattern, staccato cello ostinato, brass stabs
//   shimmer  sword on this level / at a temple: high bell ostinato
//   ambience room tone (brown noise), drips (more near water), deep rumbles & gusts
//
// Offline (`renderTimeline`) schedules the whole arc up-front so tools/audiodump.mjs can render it.
import { createRng, seedFrom } from '../rng.js';
import { NOTE, MODES, degree, clamp } from './dsp.js';
import { drums } from './sfx.js';

const BPM = 84;
const STEP = 60 / BPM / 4;         // one 16th
const CHORD_STEPS = 32;            // 2 bars per chord
const LAYERS = ['pad', 'motif', 'pulse', 'combat', 'shimmer', 'amb'];

/** Key & progression for a depth. Deeper = lower root, darker mode, tenser progression. */
export function keyFor(depth) {
  const d = Math.max(1, depth | 0);
  const tier = Math.min(5, Math.floor((d - 1) / 4));         // 0..5
  const root = 45 - tier * 2;                                  // A2, G2, F2, Eb2, Db2, B1
  const mode = [MODES.aeolian, MODES.dorian, MODES.phrygian, MODES.harmonicMinor, MODES.hungarian, MODES.locrian][tier];
  // progressions as scale degrees (0 = i)
  const prog = [[0, 5, 3, 6], [0, 2, 5, 4], [0, 1, 0, 4], [0, 5, 1, 4], [0, 3, 1, 0], [0, 1, 0, 1]][tier];
  return { root, mode, prog, tier };
}

export class Score {
  /** @param {import('../audio.js').AudioEngine} e */
  constructor(e) {
    this.e = e;
    const c = e.ctx;
    this.seed = 'fargoal-score';
    this.t0 = c.currentTime;               // grid origin
    this.scheduledStep = -1;
    this.key = keyFor(1);
    this.mix = { pad: 0.9, motif: 1, pulse: 0, combat: 0, shimmer: 0, amb: 1, active: 1 };
    this.target = { ...this.mix };
    this.depth = 1;
    this.walk = 0;                          // motif random-walk position (scale degrees)
    this.amb = { drip: 2, gust: 6, rumble: 9, water: false };
    this.layer = {};
    for (const n of LAYERS) { const g = c.createGain(); g.gain.value = 0; g.connect(e.musicIn); this.layer[n] = g; }
    this.layer.pad.gain.value = 0.0001;
    this.buildPad();
    this.buildAmbience();
    this.applyMix(this.mix, c.currentTime, 0.01);
  }

  rootHz(octave = 1) { return NOTE(this.key.root) * octave; }

  // ------------------------------------------------------------------ persistent voices
  buildPad() {
    const c = this.e.ctx;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.7;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.045; const lg = c.createGain(); lg.gain.value = 160; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
    lp.connect(this.layer.pad);
    const send = c.createGain(); send.gain.value = 0.35; lp.connect(send); send.connect(this.e.reverbSend);
    this.padVoices = [];
    // three chord voices, each two detuned saws (+ a slow chorus via the LFO on detune)
    for (let v = 0; v < 3; v++) {
      const g = c.createGain(); g.gain.value = [0.15, 0.12, 0.1][v]; g.connect(lp);
      const oscs = [];
      for (const det of [-7, 6]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.detune.value = det; o.frequency.value = 110;
        const wob = c.createOscillator(); wob.frequency.value = 0.13 + v * 0.05; const wg = c.createGain(); wg.gain.value = 4; wob.connect(wg); wg.connect(o.detune); wob.start();
        o.connect(g); o.start(); oscs.push(o);
      }
      const pan = c.createStereoPanner ? c.createStereoPanner() : null;
      if (pan) { pan.pan.value = [-0.4, 0.4, 0][v]; g.disconnect(); g.connect(pan); pan.connect(lp); }
      this.padVoices.push({ g, oscs });
    }
    // sub drone: sine an octave below the root, always the root
    this.sub = c.createOscillator(); this.sub.type = 'sine'; this.sub.frequency.value = 55;
    const sg = c.createGain(); sg.gain.value = 0.08; this.sub.connect(sg); sg.connect(this.layer.pad); this.sub.start();
    // tremolo low strings for the pulse layer (gain gated by the layer bus)
    const strLp = c.createBiquadFilter(); strLp.type = 'lowpass'; strLp.frequency.value = 700; strLp.Q.value = 1.5; strLp.connect(this.layer.pulse);
    const tremG = c.createGain(); tremG.gain.value = 0.5; tremG.connect(strLp);
    const trem = c.createOscillator(); trem.type = 'sine'; trem.frequency.value = 7; const tg = c.createGain(); tg.gain.value = 0.5; trem.connect(tg); tg.connect(tremG.gain); trem.start();
    this.strings = [];
    for (const det of [-9, 0, 8]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.detune.value = det; o.frequency.value = 110; const g = c.createGain(); g.gain.value = 0.05; o.connect(g); g.connect(tremG); o.start(); this.strings.push(o); }
    this.trem = trem;
    this.retune(this.key, 0, c.currentTime, 0.01);
  }

  buildAmbience() {
    const c = this.e.ctx;
    // room tone: brown noise, lowpassed, breathing very slowly
    const src = c.createBufferSource(); src.buffer = this.e.noiseBrown; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 120; lp.Q.value = 0.5;
    const g = c.createGain(); g.gain.value = 0.1;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.05; const lg = c.createGain(); lg.gain.value = 0.035; lfo.connect(lg); lg.connect(g.gain); lfo.start();
    src.connect(lp); lp.connect(g); g.connect(this.layer.amb); src.start();
    // air: faint high pink hiss for "space" — becomes audible only in big rooms through the send
    const air = c.createBufferSource(); air.buffer = this.e.noisePink; air.loop = true; air.loopStart = 0.7;
    const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 2400; hp.Q.value = 0.4;
    const ag = c.createGain(); ag.gain.value = 0.004; air.connect(hp); hp.connect(ag); ag.connect(this.layer.amb); air.start(0, 0.7);
    this.roomTone = { src, air, lp, g };
  }

  /** Retune pad + strings to chord index `ci` of the key at time t. */
  retune(key, ci, t, tau = 0.6) {
    const deg = key.prog[ci % key.prog.length];
    const chord = [degree(key.root, key.mode, deg), degree(key.root, key.mode, deg + 2), degree(key.root, key.mode, deg + 4)];
    // keep voices in a tight register: fold into root..root+12
    const fold = (n) => { while (n >= key.root + 13) n -= 12; while (n < key.root) n += 12; return n; };
    const notes = chord.map(fold);
    this.padVoices.forEach((v, i) => { const f = NOTE(notes[i] + 12); for (const o of v.oscs) o.frequency.setTargetAtTime(f, t, tau); });
    this.sub.frequency.setTargetAtTime(NOTE(fold(chord[0]) - 12), t, tau);
    this.strings.forEach((o, i) => o.frequency.setTargetAtTime(NOTE(notes[i === 2 ? 0 : i]), t, tau));
    this.chordNotes = notes; this.chordDeg = deg;
  }

  // ------------------------------------------------------------------ mixing
  applyMix(m, t, tau = 0.8) {
    const L = this.layer, act = m.active ?? 1;
    const depthK = clamp((this.depth - 1) / 20, 0, 1);
    const set = (g, v, k = tau) => g.gain.setTargetAtTime(Math.max(0.0001, v), t, k);
    set(L.pad, (0.55 + depthK * 0.3) * (m.pad ?? 1) * act);
    set(L.motif, 0.9 * (m.motif ?? 1) * (1 - 0.8 * (m.combat ?? 0)) * act);
    set(L.pulse, 0.9 * (m.pulse ?? 0) * act, tau * 0.6);
    set(L.combat, 1.0 * (m.combat ?? 0) * act, tau * 0.35);
    set(L.shimmer, 0.7 * (m.shimmer ?? 0) * act);
    set(L.amb, (0.35 + depthK * 0.4) * (m.amb ?? 1) * (0.4 + 0.6 * act), tau * 2);
    this.trem.frequency.setTargetAtTime(6 + (m.pulse ?? 0) * 4, t, tau);
  }

  onLevel(depth) {
    this.depth = depth;
    const key = keyFor(depth);
    if (key.root !== this.key.root || key.mode !== this.key.mode) { this.key = key; this.retune(key, 0, this.e.now, 1.2); }
    this.amb.water = false;
  }

  // ------------------------------------------------------------------ live update
  /**
   * @param {number} dt
   * @param {object} s engine state (combat, danger, hpFrac, paused, over, title, sword, temple, water, depth)
   * @param {number} until schedule the grid up to this audio time
   */
  update(dt, s, until) {
    const e = this.e, now = e.now;
    if (s.depth !== this.depth) this.onLevel(s.depth);
    const tgt = this.target;
    const active = s.over ? 0.25 : s.paused ? 0.45 : 1;
    tgt.active = active;
    tgt.combat = s.title ? 0 : s.combat;
    tgt.pulse = s.title ? 0 : clamp(s.danger * 1.2, 0, 1) * (1 - s.combat * 0.5);
    tgt.motif = s.title ? 0.7 : 1 - s.danger * 0.35;
    tgt.pad = 1;
    tgt.shimmer = s.title ? 0.35 : (s.sword ? 1 : s.temple ? 0.7 : 0);
    tgt.amb = s.title ? 0.4 : 1;
    // smooth toward targets and apply (cheap: a few setTargetAtTime calls every 100 ms)
    this.mixT = (this.mixT || 0) - dt;
    if (this.mixT <= 0) { this.mixT = 0.1; for (const k in tgt) this.mix[k] = tgt[k]; this.applyMix(this.mix, now, 0.7); }
    this.amb.water = !!s.water;
    this.schedule(until, () => this.mix);
    this.ambience(dt, s);
  }

  /** Random one-shot ambience: drips, gusts, rumbles — panned around the listener. */
  ambience(dt, s) {
    if (s.paused || s.over) return;
    const e = this.e, A = this.amb, r = e.rng;
    A.drip -= dt; A.gust -= dt; A.rumble -= dt;
    if (A.drip <= 0) { A.drip = A.water ? 0.8 + r.next() * 2.2 : 3 + r.next() * 8; e.play('drip', { pan: (r.next() - 0.5) * 1.6, gain: (A.water ? 0.11 : 0.07) * (0.6 + r.next() * 0.6), bus: this.layer.amb }); }
    if (A.gust <= 0) { A.gust = 9 + r.next() * 14; e.play('wind-gust', { pan: (r.next() - 0.5) * 1.4, gain: 0.05 + r.next() * 0.05, bus: this.layer.amb }); }
    if (A.rumble <= 0) { A.rumble = 14 + r.next() * 20; if (this.depth >= 5) e.play('rumble', { pan: (r.next() - 0.5) * 0.8, gain: 0.12 + clamp((this.depth - 5) / 15, 0, 1) * 0.18, bus: this.layer.amb }); }
  }

  // ------------------------------------------------------------------ the grid
  /**
   * Schedule every 16th-note step up to `until`. `mixAt(time)` returns the layer mix in force at that
   * time, so offline renders can script an arc while the live game simply reports the current mix.
   */
  schedule(until, mixAt) {
    const last = Math.floor((until - this.t0) / STEP);
    for (let sIdx = this.scheduledStep + 1; sIdx <= last; sIdx++) {
      const t = this.t0 + sIdx * STEP;
      if (t < this.e.now - 0.05) continue;   // never schedule into the past
      this.step(sIdx, t, mixAt(t));
    }
    this.scheduledStep = Math.max(this.scheduledStep, last);
  }

  step(s, t, m) {
    const e = this.e, key = this.key, L = this.layer;
    const r = createRng(seedFrom(this.seed, s, key.root));
    const at = t - e.now;                                   // primitives take relative times
    const beat = s % 16, bar = Math.floor(s / 16), inChord = s % CHORD_STEPS;
    if (inChord === 0) this.retune(key, Math.floor(s / CHORD_STEPS), t, 0.5);
    const chord = this.chordNotes || [key.root, key.root + 3, key.root + 7];
    const combat = m.combat ?? 0, pulse = m.pulse ?? 0, motif = m.motif ?? 1, shimmer = m.shimmer ?? 0;
    const pan = (v) => v;

    // ---- motif: sparse celesta, random walk over the mode with chord-tone gravity, dotted echo
    if (motif > 0.05 && combat < 0.7 && (s % 2 === 0)) {
      const density = 0.16 + 0.1 * (beat === 0 ? 1 : 0) + (m.title ? 0.08 : 0);
      if (r.chance(density)) {
        const drift = r.int(-2, 2);
        this.walk = clamp(this.walk + drift, -3, 9);
        let n = degree(key.root + 24, key.mode, this.walk);
        if (r.chance(0.55)) { // snap to the nearest chord tone
          let best = n, bd = 99; for (const cn of chord) for (const o of [0, 12, 24]) { const c2 = cn + o; const d = Math.abs(c2 - n); if (d < bd) { bd = d; best = c2; } } n = best;
        }
        const g = 0.24 + r.next() * 0.1, p = (r.next() - 0.5) * 0.9;
        this.pluck(n, g, at, p, L.motif);
        this.pluck(n, g * 0.42, at + STEP * 3, -p, L.motif, 0.6);     // dotted-8th echo
        this.pluck(n, g * 0.18, at + STEP * 6, p * 0.5, L.motif, 0.45);
      }
    }
    // ---- pulse: heartbeat toms on 1 and 3 (and a ghost on the "and" of 4 when high)
    if (pulse > 0.05) {
      if (beat === 0 || beat === 8) drums.tom(e, { at, gain: 0.55 * (0.6 + 0.4 * pulse), tune: 0.55, bus: L.pulse, send: 0.35 });
      if (beat === 14 && pulse > 0.6) drums.tom(e, { at, gain: 0.3, tune: 0.7, bus: L.pulse, send: 0.35 });
    }
    // ---- combat: drums + cello ostinato + brass stabs
    if (combat > 0.08) {
      const k = combat;
      if ([0, 3, 6, 8, 11, 14].includes(beat)) drums.taiko(e, { at, gain: 0.85 * (beat === 0 || beat === 8 ? 1 : 0.75), tune: beat % 8 === 6 ? 1.15 : 1, bus: L.combat, pan: beat % 8 === 6 ? 0.25 : -0.1 });
      if (beat === 4 || beat === 12) drums.snare(e, { at, gain: 0.45, bus: L.combat, pan: 0.15 });
      if (beat % 2 === 0 || k > 0.7) drums.hat(e, { at, gain: beat % 4 === 2 ? 0.11 : 0.06, bus: L.combat, pan: 0.3, open: beat === 14 });
      // cello ostinato: root-root-fifth-root-b2... driving 8ths
      if (beat % 2 === 0) {
        const pattern = [0, 0, 7, 0, 0, 1, 0, 7];
        const iv = pattern[(beat / 2) | 0];
        const n = key.root + (iv === 1 ? key.mode[1] : iv);
        this.cello(n, 0.2, at, L.combat, beat % 8 === 0 ? 0.3 : 0.2);
      }
      // brass stabs on bar 2 and 4 of each chord
      if (inChord === 24 || inChord === 30) this.stab(chord, at, L.combat, inChord === 30 ? 0.16 : 0.22);
    }
    // ---- shimmer: high bell arpeggio every 3 steps
    if (shimmer > 0.05 && s % 3 === 0) {
      const n = chord[(s / 3) % chord.length] + 36 - (r.chance(0.3) ? 12 : 0);
      e.partials({ freq: NOTE(n), ratios: [1, 2.76, 5.4], amps: [1, 0.25, 0.08], decays: [1.6, 0.6, 0.25], gain: 0.05 + 0.03 * r.next(), at, pan: Math.sin(s * 0.7) * 0.6, send: 0.9, bus: L.shimmer, prio: 0 });
    }
    void bar; void pan;
  }

  pluck(n, g, at, pan, bus, decay = 0.9) {
    const e = this.e, f = NOTE(n);
    e.osc({ freq: f, type: 'sine', attack: 0.003, decay, gain: g, at, pan, send: 0.55, bus, prio: 0 });
    e.osc({ freq: f * 2, type: 'triangle', attack: 0.002, decay: decay * 0.35, gain: g * 0.3, at, pan, send: 0.3, bus, prio: 0 });
    e.noise({ filter: { type: 'bandpass', freq: f * 3, q: 2 }, attack: 0.001, decay: 0.012, gain: g * 0.45, at, pan, bus, prio: 0 });
  }

  cello(n, len, at, bus, g) {
    const e = this.e, f = NOTE(n);
    for (const det of [-6, 5]) e.osc({ freq: f, type: 'sawtooth', detune: det, filter: { type: 'lowpass', freq: f * 5, to: f * 2.5, q: 1.5 }, attack: 0.012, hold: len * 0.6, decay: 0.08, gain: g / 2, at, pan: det < 0 ? -0.2 : 0.2, bus, send: 0.2, drive: 0.25, prio: 0 });
    e.osc({ freq: f / 2, type: 'triangle', attack: 0.01, hold: len * 0.6, decay: 0.06, gain: g * 0.5, at, bus, prio: 0 });
  }

  stab(chord, at, bus, g) {
    const e = this.e;
    for (const n of chord) for (const det of [-5, 4]) e.osc({ freq: NOTE(n + 12), wave: 'brass', detune: det, filter: { type: 'lowpass', freq: 600, to: 2400, slide: 0.04, q: 1.5 }, attack: 0.015, hold: 0.09, decay: 0.16, gain: g / 6, at, pan: det < 0 ? -0.3 : 0.3, bus, send: 0.5, drive: 0.25, prio: 0 });
    drums.kick(e, { at, gain: 0.5, bus, send: 0.2 });
  }

  // ------------------------------------------------------------------ offline showcase
  /**
   * Schedule a scripted arc for an OfflineAudioContext render.
   * @param {{t:number, depth?:number, combat?:number, danger?:number, active?:number, sword?:boolean}[]} timeline
   * @param {number} seconds
   */
  renderTimeline(timeline, seconds) {
    const e = this.e;
    const pts = timeline.slice().sort((a, b) => a.t - b.t);
    const stateAt = (t) => { const st = { depth: 3, combat: 0, danger: 0, active: 1, sword: false }; for (const p of pts) if (p.t <= t) Object.assign(st, p); return st; };
    const mixOf = (st) => ({ active: st.active, combat: st.combat, pulse: clamp(st.danger * 1.2, 0, 1) * (1 - st.combat * 0.5), motif: 1 - st.danger * 0.35, pad: 1, shimmer: st.sword ? 1 : 0, amb: 1 });
    this.onLevel(stateAt(0).depth);
    this.t0 = e.now;
    this.scheduledStep = -1;
    // apply mix changes at each timeline point (smooth), then schedule the grid with the mix in force
    for (const p of pts) { this.depth = stateAt(p.t).depth; this.applyMix(mixOf(stateAt(p.t)), e.now + p.t, 0.7); }
    this.schedule(e.now + seconds, (t) => mixOf(stateAt(t - e.now)));
    // ambience: deterministic drips
    for (let t = 0.8; t < seconds; t += 2.5 + (e.rng.next() * 3)) e.play('drip', { at: t, pan: (e.rng.next() - 0.5) * 1.4, gain: 0.08, bus: this.layer.amb });
    e.play('wind-gust', { at: 2, gain: 0.07, bus: this.layer.amb });
  }

  dispose() {
    try { for (const v of this.padVoices) for (const o of v.oscs) o.stop(); this.sub.stop(); this.trem.stop(); for (const o of this.strings) o.stop(); this.roomTone.src.stop(); this.roomTone.air.stop(); } catch { /* ignore */ }
  }
}

export { STEP, BPM };

// Sound designs. Each entry is `(e, p) => void` where `e` is the AudioEngine (voice primitives:
// osc / noise / partials / formant / melody / chord / duck) and `p` the event payload. Designs are
// layered like real SFX: transient + body + tail, with material-specific timbres (stone, water,
// gravel, steel, flesh), stereo placement and a reverb send so they sit in the dungeon.
import { NOTE, clamp } from './dsp.js';
import { hashString } from '../rng.js';
import { TILE } from '../constants.js';

const VOWELS = { ah: [730, 1090, 2440], oh: [570, 840, 2410], ee: [270, 2290, 3010], uh: [640, 1190, 2390], oo: [300, 870, 2240] };
const pick = (e, arr) => arr[Math.floor(e.rng.next() * arr.length)];
const vary = (e, v, amt = 0.08) => v * (1 + (e.rng.next() * 2 - 1) * amt);

// ------------------------------------------------------------------ shared building blocks
/** A drum kit usable by SFX and the score (pass bus to land on a music layer). */
export const drums = {
  kick(e, { at = 0, gain = 0.8, bus, pan = 0, tune = 1, send = 0.08 } = {}) {
    e.osc({ freq: 150 * tune, to: 38 * tune, slide: 0.09, type: 'sine', attack: 0.002, decay: 0.32, gain, at, bus, pan, send, drive: 0.2 });
    e.noise({ filter: { type: 'lowpass', freq: 2400, to: 300 }, attack: 0.001, decay: 0.035, gain: gain * 0.5, at, bus, pan });
  },
  taiko(e, { at = 0, gain = 0.8, bus, pan = 0, tune = 1, send = 0.25 } = {}) {
    e.osc({ freq: 120 * tune, to: 52 * tune, slide: 0.14, type: 'sine', attack: 0.003, decay: 0.55, gain, at, bus, pan, send, drive: 0.35 });
    e.osc({ freq: 240 * tune, to: 90 * tune, slide: 0.08, type: 'triangle', attack: 0.002, decay: 0.16, gain: gain * 0.35, at, bus, pan });
    e.noise({ color: 'pink', filter: { type: 'bandpass', freq: 900, q: 0.7 }, attack: 0.001, decay: 0.08, gain: gain * 0.6, at, bus, pan, send });
  },
  snare(e, { at = 0, gain = 0.5, bus, pan = 0, send = 0.2 } = {}) {
    e.noise({ filter: { type: 'bandpass', freq: 1900, q: 0.6 }, filter2: { type: 'highpass', freq: 500 }, attack: 0.001, decay: 0.16, gain, at, bus, pan, send });
    e.osc({ freq: 230, to: 150, slide: 0.05, type: 'triangle', attack: 0.001, decay: 0.09, gain: gain * 0.7, at, bus, pan });
  },
  hat(e, { at = 0, gain = 0.18, bus, pan = 0, open = false } = {}) {
    e.noise({ filter: { type: 'highpass', freq: 7000 }, filter2: { type: 'bandpass', freq: 9500, q: 1.2 }, attack: 0.001, decay: open ? 0.22 : 0.045, gain, at, bus, pan });
  },
  tom(e, { at = 0, gain = 0.5, bus, pan = 0, tune = 1, send = 0.3 } = {}) {
    e.osc({ freq: 180 * tune, to: 70 * tune, slide: 0.18, type: 'sine', attack: 0.002, decay: 0.4, gain, at, bus, pan, send });
    e.noise({ color: 'pink', filter: { type: 'lowpass', freq: 1200 }, attack: 0.001, decay: 0.05, gain: gain * 0.4, at, bus, pan });
  },
};

/** Metallic clang: inharmonic partials + scrape. */
function clang(e, { freq = 1700, gain = 0.5, at = 0, pan = 0, send = 0.4, bright = 1, decay = 0.42 } = {}) {
  e.partials({ freq, ratios: [1, 1.48, 2.31, 3.18, 4.71, 6.02], amps: [1, 0.7, 0.55 * bright, 0.4 * bright, 0.28 * bright, 0.16 * bright], decays: [decay, decay * 0.7, decay * 0.5, decay * 0.35, decay * 0.25, decay * 0.18], attack: 0.001, gain, at, pan, send, jitter: 0.01 });
  e.noise({ filter: { type: 'highpass', freq: 3800 }, attack: 0.001, decay: 0.06, gain: gain * 0.55, at, pan, send: send * 0.5 });
}

/** Meaty impact on flesh. */
function thud(e, { gain = 0.6, at = 0, pan = 0, low = 1, send = 0.25 } = {}) {
  e.noise({ color: 'pink', filter: { type: 'lowpass', freq: 900 * low, to: 140 }, attack: 0.001, decay: 0.11, gain, at, pan, send });
  e.osc({ freq: 170 * low, to: 55 * low, slide: 0.06, type: 'sine', attack: 0.001, decay: 0.13, gain: gain * 0.9, at, pan, send: send * 0.5, drive: 0.3 });
  e.noise({ filter: { type: 'bandpass', freq: 2300, q: 3 }, attack: 0.002, decay: 0.045, gain: gain * 0.28, at: at + 0.012, pan });
}

/** Sword whoosh: band-passed noise whose centre rises then falls with the swing. */
function whoosh(e, { gain = 0.3, at = 0, pan = 0, len = 0.16, from = 500, peak = 2600 } = {}) {
  e.noise({ color: 'pink', filter: { type: 'bandpass', freq: from, q: 1.4, bend: [[len * 0.35, peak], [len * 0.65, from * 1.4]] }, attack: len * 0.35, decay: len * 0.75, gain, at, pan, send: 0.15 });
  e.noise({ filter: { type: 'highpass', freq: 5500 }, attack: len * 0.3, decay: len * 0.5, gain: gain * 0.25, at, pan });
}

/** Growl / roar formant voice. size scales the throat (bigger = lower formants, longer). */
function growl(e, { f0 = 90, size = 1, len = 0.55, gain = 0.5, at = 0, pan = 0, seen = true, rasp = 32, breath = 0.35, contour = 'rise-fall', send = 0.35, drive = 0.35 } = {}) {
  const bend = contour === 'rise-fall' ? [[len * 0.12, f0 * 1.35], [len * 0.45, f0 * 1.2], [len * 0.43, f0 * 0.62]] : contour === 'fall' ? [[len, f0 * 0.6]] : [[len * 0.5, f0 * 1.6], [len * 0.5, f0 * 1.3]];
  const F = (f, q, g) => ({ f: f / size, q, g });
  e.formant({ freq: f0, bend, formants: [F(520, 5, 1), F(1150, 7, 0.6), F(2500, 8, 0.28)], breath, growl: rasp, drive, vibrato: { rate: 5.5, depth: 22 }, attack: 0.03, hold: len * 0.45, decay: len * 0.55, gain, at, pan, send, filter: seen ? { type: 'lowpass', freq: 8000, q: 0.5 } : { type: 'lowpass', freq: 650, q: 0.8 } });
  if (size > 1.15) e.osc({ freq: f0 * 0.5, to: f0 * 0.32, type: 'sawtooth', filter: { type: 'lowpass', freq: 220 }, drive: 0.5, attack: 0.05, hold: len * 0.5, decay: len * 0.7, gain: gain * 0.5, at, pan, send: 0.2 });
}

/** Human shout with a vowel, falling pitch contour. */
function shout(e, { f0 = 140, vowel = 'ah', len = 0.28, gain = 0.4, at = 0, pan = 0, seen = true, drive = 0.15, send = 0.4, breath = 0.12 } = {}) {
  const v = VOWELS[vowel] || VOWELS.ah;
  e.formant({ freq: f0 * 0.85, bend: [[0.04, f0 * 1.25], [len * 0.4, f0 * 1.08], [len * 0.6, f0 * 0.72]], formants: [{ f: v[0], q: 8, g: 1 }, { f: v[1], q: 9, g: 0.5 }, { f: v[2], q: 10, g: 0.22 }], breath, drive, vibrato: { rate: 5.8, depth: 26 }, attack: 0.02, hold: len * 0.5, decay: len * 0.6, gain, at, pan, send, filter: seen ? { type: 'lowpass', freq: 9000, q: 0.5 } : { type: 'lowpass', freq: 700, q: 0.8 } });
}

/** Steel drawn from a scabbard. */
function steelDraw(e, { gain = 0.22, at = 0, pan = 0 } = {}) {
  e.noise({ filter: { type: 'bandpass', freq: 3200, to: 7500, q: 6 }, attack: 0.02, hold: 0.12, decay: 0.18, gain, at, pan, send: 0.35 });
  e.partials({ freq: 2900, ratios: [1, 1.41, 2.2], amps: [1, 0.5, 0.3], decays: [0.5, 0.3, 0.2], gain: gain * 0.5, at: at + 0.16, pan, send: 0.45 });
}

/** Coin ping. */
function coin(e, { freq = 4200, gain = 0.3, at = 0, pan = 0, send = 0.3 } = {}) {
  e.partials({ freq, ratios: [1, 1.37, 1.92, 2.6], amps: [1, 0.55, 0.35, 0.18], decays: [0.22, 0.16, 0.12, 0.08], attack: 0.001, gain, at, pan, send, jitter: 0.02 });
}

/** Church/temple bell partials (Rayleigh-ish ratios). */
function bell(e, { freq = 440, gain = 0.4, at = 0, pan = 0, decay = 2.2, send = 0.7 } = {}) {
  e.partials({ freq, ratios: [0.5, 1, 1.183, 1.506, 2, 2.514, 2.662, 3.011, 4.166], amps: [0.6, 1, 0.55, 0.5, 0.4, 0.25, 0.22, 0.18, 0.1], decays: [decay * 1.3, decay, decay * 0.7, decay * 0.6, decay * 0.5, decay * 0.35, decay * 0.3, decay * 0.25, decay * 0.15], attack: 0.003, gain, at, pan, send, jitter: 0.002 });
  e.noise({ filter: { type: 'bandpass', freq: freq * 2, q: 4 }, attack: 0.001, decay: 0.02, gain: gain * 0.4, at, pan });
}

/** Plucked celesta/harp note. */
function pluck(e, { note = 72, gain = 0.25, at = 0, pan = 0, send = 0.5, decay = 0.9, bus } = {}) {
  const f = NOTE(note);
  e.osc({ freq: f, type: 'sine', attack: 0.003, decay, gain, at, pan, send, bus });
  e.osc({ freq: f * 2, type: 'triangle', attack: 0.002, decay: decay * 0.35, gain: gain * 0.35, at, pan, send: send * 0.5, bus });
  e.osc({ freq: f * 4.02, type: 'sine', attack: 0.001, decay: decay * 0.12, gain: gain * 0.12, at, pan, bus });
  e.noise({ filter: { type: 'bandpass', freq: f * 3, q: 2 }, attack: 0.001, decay: 0.015, gain: gain * 0.5, at, pan, bus });
}

/** Brass section note: detuned saws through an opening lowpass. */
function brass(e, { note = 67, len = 0.3, gain = 0.2, at = 0, pan = 0, send = 0.45, bus, attack = 0.035 } = {}) {
  const f = NOTE(note);
  for (const [det, pn] of [[-6, -0.3], [5, 0.3], [0, 0]]) e.osc({ freq: f, wave: 'brass', detune: det, filter: { type: 'lowpass', freq: f * 2.2, to: f * 6.5, slide: 0.12, q: 1.2 }, attack, hold: len, decay: 0.16, gain: gain / 3, at, pan: pan + pn * 0.5, send, bus, drive: 0.2 });
}

/** Timpani hit + short roll. */
function timpani(e, { note = 43, gain = 0.5, at = 0, roll = 0, bus } = {}) {
  const f = NOTE(note);
  const hit = (t, g) => { e.osc({ freq: f * 1.1, to: f, slide: 0.06, type: 'sine', attack: 0.003, decay: 0.7, gain: g, at: t, bus, send: 0.45, drive: 0.25 }); e.noise({ color: 'pink', filter: { type: 'lowpass', freq: 700 }, attack: 0.001, decay: 0.05, gain: g * 0.6, at: t, bus }); };
  if (roll > 0) for (let t = 0; t < roll; t += 0.055) hit(at + t, gain * (0.25 + 0.6 * t / roll));
  hit(at + roll, gain);
}

// ------------------------------------------------------------------ the designs
export const SFX = {
  // ---- movement
  step(e, p = {}) {
    const alt = p.alt ? 1 : 0, pan = (alt ? 0.14 : -0.14), a = p.at || 0;
    const t = p.tile;
    if (t === TILE.WATER) {
      e.noise({ filter: { type: 'bandpass', freq: 1100, to: 380, q: 0.9 }, attack: 0.012, decay: 0.2, gain: 0.16, at: a, pan, send: 0.5 });
      for (let i = 0; i < 3; i++) e.osc({ freq: vary(e, 480 + i * 160, 0.2), to: 1100, slide: 0.03, type: 'sine', attack: 0.004, decay: 0.045, gain: 0.07, at: a + 0.03 + i * 0.045 + e.rng.next() * 0.03, pan: pan + (e.rng.next() - 0.5) * 0.4, send: 0.6 });
      e.osc({ freq: 2400, to: 1900, type: 'sine', attack: 0.002, decay: 0.05, gain: 0.05, at: a + 0.24 + e.rng.next() * 0.1, pan: -pan, send: 0.9 });
      return;
    }
    if (t === TILE.RUBBLE) {
      for (let i = 0; i < 6; i++) e.noise({ filter: { type: 'bandpass', freq: vary(e, 2600, 0.35), q: 2.5 }, attack: 0.001, decay: 0.02 + e.rng.next() * 0.02, gain: 0.3 + e.rng.next() * 0.2, at: a + e.rng.next() * 0.08, pan: pan + (e.rng.next() - 0.5) * 0.3, send: 0.2 });
      e.noise({ color: 'pink', filter: { type: 'lowpass', freq: 600 }, attack: 0.003, decay: 0.08, gain: 0.28, at: a, pan, send: 0.25 });
      return;
    }
    const sacred = t === TILE.TEMPLE || t === TILE.STAIRS_UP || t === TILE.STAIRS_DOWN;
    const send = sacred ? 0.75 : 0.35;
    const pitch = vary(e, 1, 0.1);
    // heel transient, stone body, sole scuff
    e.noise({ filter: { type: 'highpass', freq: 2800 * pitch }, attack: 0.001, decay: 0.014, gain: 0.14, at: a, pan, send: send * 0.4 });
    e.noise({ color: 'pink', filter: { type: 'bandpass', freq: 420 * pitch, q: 1.8 }, attack: 0.002, decay: 0.05, gain: 0.15, at: a, pan, send });
    e.osc({ freq: 150 * pitch, to: 80, slide: 0.03, type: 'sine', attack: 0.001, decay: 0.045, gain: 0.07, at: a, pan, send: send * 0.4 });
    e.noise({ filter: { type: 'bandpass', freq: 1400 * pitch, q: 1.2 }, attack: 0.008, decay: 0.03, gain: 0.04, at: a + 0.035 + e.rng.next() * 0.02, pan, send: send * 0.6 });
  },

  /** A monster's footfall heard from a distance (soft, panned, muffled through walls). */
  'monster-step'(e, p = {}) {
    const m = p.entity || {}, size = m.size || 1, g = (p.gain ?? 0.5) * 0.55;
    const muff = p.seen ? 3500 : 500;
    e.noise({ color: 'pink', filter: { type: 'lowpass', freq: muff }, filter2: { type: 'bandpass', freq: 300 / size, q: 1.4 }, attack: 0.003, decay: 0.07 * size, gain: g, pan: p.pan, send: 0.5 });
    e.osc({ freq: 120 / size, to: 60 / size, type: 'sine', attack: 0.002, decay: 0.08 * size, gain: g * 0.5 * size, pan: p.pan, send: 0.3 });
  },

  // ---- combat
  swing(e, p = {}) { whoosh(e, { gain: 0.34, pan: (p.pan || 0) * 0.5, len: 0.15 }); },
  'hit-creature'(e, p = {}) {
    const pan = (p.pan || 0) * 0.5;
    whoosh(e, { gain: 0.2, pan, len: 0.1, at: 0 });
    thud(e, { gain: 0.42, at: 0.055, pan });
    e.noise({ filter: { type: 'bandpass', freq: 1900, to: 700, q: 2.2 }, attack: 0.004, decay: 0.09, gain: 0.2, at: 0.06, pan, send: 0.3 });
  },
  'hit-human'(e, p = {}) {
    const pan = (p.pan || 0) * 0.5;
    whoosh(e, { gain: 0.2, pan, len: 0.1 });
    clang(e, { freq: vary(e, 1750, 0.1), gain: 0.26, at: 0.06, pan, send: 0.45, decay: 0.3 });
    thud(e, { gain: 0.22, at: 0.06, pan, low: 1.2, send: 0.2 });
  },
  crit(e, p = {}) {
    const pan = (p.pan || 0) * 0.5;
    e.osc({ freq: 90, to: 30, slide: 0.2, type: 'sine', attack: 0.002, decay: 0.45, gain: 0.4, at: 0.05, pan, drive: 0.4, send: 0.3 });
    clang(e, { freq: 2300, gain: 0.2, at: 0.05, pan, bright: 1.4, decay: 0.6 });
    e.noise({ filter: { type: 'highpass', freq: 3000 }, attack: 0.001, decay: 0.2, gain: 0.25, at: 0.05, pan, send: 0.5 });
  },
  hurt(e, p = {}) {
    const pan = (p.pan || 0) * 0.4;
    thud(e, { gain: 0.5, pan, low: 0.85, send: 0.2 });
    e.noise({ color: 'pink', filter: { type: 'lowpass', freq: 400 }, attack: 0.002, decay: 0.2, gain: 0.35, pan });
    // the hero's pained grunt
    e.formant({ freq: 150, bend: [[0.05, 175], [0.16, 110]], formants: [{ f: 640, q: 6, g: 1 }, { f: 1200, q: 8, g: 0.45 }, { f: 2400, q: 9, g: 0.2 }], breath: 0.25, drive: 0.2, attack: 0.02, hold: 0.06, decay: 0.16, gain: 0.32, at: 0.03, pan: 0, send: 0.3 });
  },
  'shield-block'(e, p = {}) { clang(e, { freq: 900, gain: 0.32, pan: (p.pan || 0) * 0.5, bright: 0.6, decay: 0.55 }); e.osc({ freq: 200, to: 120, type: 'triangle', attack: 0.002, decay: 0.12, gain: 0.25, pan: (p.pan || 0) * 0.5 }); },
  'monster-attack'(e, p = {}) {
    const m = p.entity || {}, pan = (p.pan || 0) * 0.5, heavy = p.heavy ?? 0.6;
    if (m.family === 'human') { whoosh(e, { gain: 0.3, pan, len: 0.13, from: 400, peak: 1800 }); shout(e, { f0: 120 + (hashString(m.type || 'h') % 5) * 12, vowel: 'uh', len: 0.16, gain: 0.34 * heavy, at: 0.02, pan, breath: 0.2 }); clang(e, { freq: vary(e, 1400, 0.1), gain: 0.16 * heavy, at: 0.1, pan, decay: 0.2, bright: 0.7 }); }
    else { growl(e, { f0: 75 + (hashString(m.type || 'c') % 7) * 9, size: m.size || 1, len: 0.28, gain: 0.32 * heavy, pan, rasp: 40, contour: 'fall' }); e.noise({ filter: { type: 'bandpass', freq: 2600, q: 3 }, attack: 0.003, decay: 0.05, gain: 0.2 * heavy, at: 0.04, pan }); }
  },
  alarm(e) {
    // the VIC alarm sting (two oscillators sweeping apart) re-armed with a snare crack and a dread chord
    e.osc({ freq: 380, to: 780, type: 'square', filter: { type: 'lowpass', freq: 2200 }, attack: 0.004, hold: 0.22, decay: 0.12, gain: 0.16, pan: -0.35 });
    e.osc({ freq: 660, to: 320, type: 'square', filter: { type: 'lowpass', freq: 2200 }, attack: 0.004, hold: 0.22, decay: 0.12, gain: 0.16, pan: 0.35 });
    drums.snare(e, { gain: 0.5, send: 0.4 });
    drums.taiko(e, { gain: 0.6, at: 0.01, tune: 0.9 });
    e.chord([38, 44, 50], { type: 'sawtooth', filter: { type: 'lowpass', freq: 500, to: 900 }, attack: 0.03, hold: 0.25, decay: 0.5, gain: 0.09, at: 0.05, send: 0.5, drive: 0.3 });
  },
  'danger-sting'(e, p = {}) {
    e.chord([36, 43, 49], { type: 'sawtooth', filter: { type: 'lowpass', freq: 380, to: 900, q: 2 }, attack: 0.02, hold: 0.1, decay: 0.7, gain: 0.1, send: 0.5, drive: 0.4, pan: (p.pan || 0) * 0.4 });
    drums.tom(e, { gain: 0.35, tune: 0.7, pan: (p.pan || 0) * 0.3 });
  },
  'slain-creature'(e, p = {}) {
    // the VIC two-note victory (231/237) as bright bells, over the beast's death rattle
    e.partials({ freq: NOTE(81), ratios: [1, 2.01, 3.03], amps: [1, 0.3, 0.12], decays: [0.5, 0.25, 0.12], gain: 0.22, send: 0.5, pan: 0.15 });
    e.partials({ freq: NOTE(88), ratios: [1, 2.01, 3.03], amps: [1, 0.3, 0.12], decays: [0.8, 0.3, 0.15], gain: 0.22, at: 0.12, send: 0.6, pan: -0.15 });
    growl(e, { f0: 110, size: (p.size || 1.1), len: 0.7, gain: 0.34, at: 0.02, contour: 'fall', rasp: 22, breath: 0.6, pan: (p.pan || 0) * 0.4 });
    thud(e, { gain: 0.4, at: 0.55, low: 1.3, send: 0.5 });
  },
  'slain-human'(e, p = {}) {
    e.partials({ freq: NOTE(81), ratios: [1, 2.01, 3.03], amps: [1, 0.3, 0.12], decays: [0.5, 0.25, 0.12], gain: 0.22, send: 0.5, pan: 0.15 });
    e.partials({ freq: NOTE(88), ratios: [1, 2.01, 3.03], amps: [1, 0.3, 0.12], decays: [0.8, 0.3, 0.15], gain: 0.22, at: 0.12, send: 0.6, pan: -0.15 });
    shout(e, { f0: 130, vowel: 'oh', len: 0.45, gain: 0.3, at: 0.02, breath: 0.4, pan: (p.pan || 0) * 0.4 });
    // armour clatters to the flagstones
    for (let i = 0; i < 4; i++) clang(e, { freq: vary(e, 1200 + i * 300, 0.2), gain: 0.14 - i * 0.02, at: 0.42 + i * 0.07 + e.rng.next() * 0.03, pan: (e.rng.next() - 0.5) * 0.6, decay: 0.25, bright: 0.8 });
    thud(e, { gain: 0.35, at: 0.5, low: 1.2, send: 0.5 });
  },

  // ---- monster voices
  voice(e, p = {}) {
    const m = p.entity || {}, k = clamp(p.intensity ?? 1, 0, 1.2), pan = p.pan || 0, seen = p.seen !== false;
    const h = hashString(m.type || 'x'), t = m.type;
    const g = 0.5 * k;
    if (t === 'dire-wolf') {
      e.formant({ freq: 300, bend: [[0.35, 520], [0.5, 480], [0.45, 330]], formants: [{ f: 700, q: 6, g: 1 }, { f: 1400, q: 8, g: 0.4 }], breath: 0.15, vibrato: { rate: 4.5, depth: 40 }, wave: 'reed', attack: 0.15, hold: 0.7, decay: 0.5, gain: g * 0.55, pan, send: 0.8, filter: seen ? null : { type: 'lowpass', freq: 700 } });
      return;
    }
    if (t === 'dimension-spider') {
      for (let i = 0; i < 14; i++) e.noise({ filter: { type: 'bandpass', freq: vary(e, 3800, 0.3), q: 8 }, attack: 0.001, decay: 0.012, gain: g * 0.7, at: i * 0.028 + e.rng.next() * 0.01, pan: pan + (e.rng.next() - 0.5) * 0.4 });
      e.osc({ freq: 1800, to: 900, type: 'square', filter: { type: 'lowpass', freq: 3000 }, attack: 0.05, hold: 0.2, decay: 0.2, gain: g * 0.08, pan, send: 0.4 });
      return;
    }
    if (t === 'gargoyle') {
      e.formant({ freq: 420, bend: [[0.06, 760], [0.25, 620], [0.2, 300]], formants: [{ f: 1600, q: 7, g: 1 }, { f: 3100, q: 9, g: 0.5 }], breath: 0.5, growl: 55, drive: 0.5, attack: 0.01, hold: 0.22, decay: 0.3, gain: g * 0.45, pan, send: 0.6 });
      for (let i = 0; i < 4; i++) e.noise({ filter: { type: 'bandpass', freq: vary(e, 2200, 0.3), q: 3 }, attack: 0.001, decay: 0.03, gain: g * 0.3, at: 0.3 + i * 0.05, pan, send: 0.3 });
      return;
    }
    if (t === 'wyvern' || t === 'shadow-dragon' || t === 'fyre-drake') {
      const big = t !== 'wyvern';
      growl(e, { f0: big ? 55 : 95, size: big ? 1.7 : 1.3, len: big ? 1.1 : 0.7, gain: g * (big ? 0.6 : 0.45), pan, seen, rasp: big ? 24 : 34, breath: 0.5, drive: 0.5 });
      if (t === 'fyre-drake') e.noise({ color: 'pink', filter: { type: 'bandpass', freq: 900, to: 2400, q: 0.8 }, attack: 0.25, hold: 0.4, decay: 0.5, gain: g * 0.4, at: 0.2, pan, send: 0.5 });
      if (t === 'shadow-dragon') e.noise({ color: 'brown', filter: { type: 'lowpass', freq: 300, to: 80 }, attack: 0.3, hold: 0.5, decay: 0.8, gain: g * 0.8, pan, send: 0.6 });
      // wing beats
      for (let i = 0; i < 2; i++) e.noise({ color: 'pink', filter: { type: 'lowpass', freq: 700, to: 200 }, attack: 0.05, decay: 0.16, gain: g * 0.3, at: 0.7 + i * 0.42, pan: pan + (i ? 0.25 : -0.25), send: 0.4 });
      return;
    }
    if (t === 'demon') { SFX['demon-roar'](e, { pan, gain: g }); return; }
    if (t === 'rogue') { for (let i = 0; i < 3; i++) shout(e, { f0: 165 - i * 12, vowel: 'ee', len: 0.09, gain: g * 0.35, at: i * 0.11, pan, seen, breath: 0.35 }); return; }
    if (t === 'monk') { e.formant({ freq: 130, bend: [[0.6, 138], [0.5, 130]], formants: [{ f: 400, q: 7, g: 1 }, { f: 800, q: 8, g: 0.6 }, { f: 2500, q: 10, g: 0.15 }], wave: 'voice', vibrato: { rate: 4.2, depth: 12 }, attack: 0.25, hold: 0.7, decay: 0.5, gain: g * 0.45, pan, send: 0.9 }); return; }
    if (t === 'assassin') { e.noise({ color: 'pink', filter: { type: 'bandpass', freq: 2600, q: 4, bend: [[0.15, 1600], [0.25, 3000]] }, filter2: { type: 'bandpass', freq: 900, q: 3 }, attack: 0.05, hold: 0.15, decay: 0.3, gain: g * 2.2, pan, send: 0.3 }); return; }
    if (t === 'mage') { SFX['mage-cast'](e, { pan, gain: g }); return; }
    if (t === 'war-lord') { shout(e, { f0: 100, vowel: 'oh', len: 0.5, gain: g * 0.55, pan, seen, drive: 0.35 }); e.osc({ freq: NOTE(43), wave: 'brass', filter: { type: 'lowpass', freq: 600, to: 1600 }, attack: 0.08, hold: 0.5, decay: 0.4, gain: g * 0.18, at: 0.1, pan, send: 0.8 }); return; }
    if (m.family === 'human') {
      const f0 = 110 + (h % 6) * 11;
      shout(e, { f0, vowel: pick(e, ['ah', 'oh', 'uh']), len: 0.24 + (h % 3) * 0.06, gain: g * 0.5, pan, seen, drive: t === 'dark-warrior' ? 0.45 : 0.15 });
      if (t !== 'elvin-ranger') steelDraw(e, { gain: g * 0.3, at: 0.05, pan });
      else e.osc({ freq: 900, to: 2200, type: 'sine', attack: 0.004, decay: 0.12, gain: g * 0.12, at: 0.1, pan, send: 0.5 }); // bowstring twang
      return;
    }
    // generic creature: size from the table decides the throat
    const size = m.size || 1, f0 = (70 + (h % 9) * 9) / Math.sqrt(size);
    growl(e, { f0, size, len: 0.4 + size * 0.25, gain: g * (0.42 + size * 0.15), pan, seen, rasp: 26 + (h % 5) * 6 });
    if (t === 'hobgoblin') for (let i = 0; i < 3; i++) shout(e, { f0: 200 - i * 20, vowel: 'ee', len: 0.07, gain: g * 0.22, at: 0.45 + i * 0.09, pan, seen });
  },
  wander(e, p = {}) {
    const m = p.entity || {}, g = (p.gain ?? 0.5) * 0.4, muff = p.seen ? 5000 : 600;
    if (m.family === 'human') e.noise({ color: 'pink', filter: { type: 'lowpass', freq: muff }, filter2: { type: 'bandpass', freq: 1800, q: 4 }, attack: 0.01, decay: 0.12, gain: g * 0.6, pan: p.pan, send: 0.5 }); // armour rustle
    else growl(e, { f0: 70, size: m.size || 1, len: 0.35, gain: g * 0.5, pan: p.pan, seen: p.seen, rasp: 20, breath: 0.5, contour: 'fall', drive: 0.1 });
  },
  'demon-roar'(e, p = {}) {
    const g = (p.gain ?? 0.9) * 0.4, pan = p.pan || 0;
    e.osc({ freq: 55, to: 22, type: 'sawtooth', filter: { type: 'lowpass', freq: 260, q: 2 }, drive: 0.8, attack: 0.05, hold: 0.8, decay: 0.8, gain: g * 0.7, pan, send: 0.5 });
    growl(e, { f0: 48, size: 2.1, len: 1.3, gain: g * 0.8, pan, rasp: 18, breath: 0.4, drive: 0.7, send: 0.7 });
    e.formant({ freq: 340, to: 120, formants: [{ f: 900, q: 5, g: 1 }, { f: 2200, q: 8, g: 0.5 }], growl: 70, drive: 0.6, attack: 0.1, hold: 0.5, decay: 0.6, gain: g * 0.25, at: 0.15, pan, send: 0.6 });
    e.noise({ color: 'brown', filter: { type: 'lowpass', freq: 200, to: 60 }, attack: 0.1, hold: 0.7, decay: 0.9, gain: g * 0.9, pan, send: 0.4 });
  },
  'mage-cast'(e, p = {}) {
    const g = p.gain ?? 0.7, pan = p.pan || 0;
    const notes = [91, 89, 86, 84, 81, 79, 77, 74];
    notes.forEach((n, i) => e.osc({ freq: NOTE(n), wave: 'glass', attack: 0.004, decay: 0.35, gain: g * 0.14, at: i * 0.055, pan: pan + Math.sin(i) * 0.4, send: 0.7 }));
    e.noise({ filter: { type: 'highpass', freq: 5000 }, attack: 0.15, hold: 0.2, decay: 0.4, gain: g * 0.12, pan, send: 0.6 });
    e.osc({ freq: 220, to: 55, type: 'triangle', filter: { type: 'lowpass', freq: 800 }, attack: 0.2, hold: 0.2, decay: 0.6, gain: g * 0.22, at: 0.3, pan, send: 0.6 });
  },

  // ---- loot & items
  gold(e, p = {}) {
    const amount = p.amount || 60, n = clamp(Math.round(4 + Math.log2(amount + 1)), 5, 11);
    for (let i = 0; i < n; i++) coin(e, { freq: vary(e, 3600 + (i % 3) * 700, 0.2), gain: 0.2 + e.rng.next() * 0.12, at: i * (0.03 + e.rng.next() * 0.025), pan: (e.rng.next() - 0.5) * 0.9 });
    // rising harp figure in the current key's brightest triad (major-sounding, a treat)
    const base = 84;
    [0, 4, 7, 12].forEach((iv, i) => pluck(e, { note: base + iv, gain: 0.24, at: 0.16 + i * 0.065, pan: -0.3 + i * 0.2, send: 0.6, decay: 0.9 }));
    if (amount >= 200) bell(e, { freq: NOTE(84), gain: 0.16, at: 0.42, decay: 1.6 });
  },
  item(e, p = {}) {
    e.noise({ color: 'pink', filter: { type: 'bandpass', freq: 1500, q: 1.5 }, attack: 0.01, decay: 0.08, gain: 0.2, send: 0.3 }); // cloth/leather rustle
    pluck(e, { note: 76, gain: 0.28, at: 0.05, pan: -0.2, send: 0.5 });
    pluck(e, { note: 88, gain: 0.26, at: 0.17, pan: 0.2, send: 0.6, decay: 1.2 });
    if (p.magic) e.osc({ freq: 1760, to: 2640, wave: 'glass', attack: 0.05, hold: 0.15, decay: 0.7, gain: 0.08, at: 0.2, send: 0.9 });
  },
  chest(e) {
    // creaking lid, then the lock
    e.osc({ freq: 180, to: 320, type: 'sawtooth', filter: { type: 'bandpass', freq: 900, q: 6 }, vibrato: { rate: 18, depth: 90 }, attack: 0.03, hold: 0.28, decay: 0.12, gain: 0.14, send: 0.4, drive: 0.3 });
    e.noise({ filter: { type: 'bandpass', freq: 2400, q: 4 }, attack: 0.05, hold: 0.25, decay: 0.1, gain: 0.1, send: 0.3 });
    clang(e, { freq: 1100, gain: 0.2, at: 0.38, decay: 0.3, bright: 0.6 });
    thud(e, { gain: 0.3, at: 0.36, low: 0.9, send: 0.4 });
  },
  potion(e) {
    // cork pop, three gulps, then the warmth spreading
    e.osc({ freq: 520, to: 180, slide: 0.03, type: 'sine', attack: 0.002, decay: 0.05, gain: 0.35 });
    e.noise({ filter: { type: 'bandpass', freq: 1500, q: 2 }, attack: 0.001, decay: 0.03, gain: 0.28 });
    for (let i = 0; i < 3; i++) {
      const at = 0.16 + i * 0.16;
      e.osc({ freq: vary(e, 300 - i * 40, 0.12), to: vary(e, 160 - i * 25, 0.1), slide: 0.08, type: 'sawtooth', filter: { type: 'lowpass', freq: 900, to: 300, q: 4 }, attack: 0.01, hold: 0.03, decay: 0.09, gain: 0.26, at, drive: 0.3 });
      e.osc({ freq: 900 + i * 120, to: 1400, type: 'sine', attack: 0.004, decay: 0.04, gain: 0.09, at: at + 0.04, send: 0.3 }); // bubble
    }
    [67, 71, 74, 79, 83].forEach((n, i) => pluck(e, { note: n, gain: 0.18, at: 0.7 + i * 0.07, pan: -0.4 + i * 0.2, send: 0.8, decay: 1.4 }));
    e.osc({ freq: NOTE(55), wave: 'organ', attack: 0.3, hold: 0.5, decay: 0.8, gain: 0.07, at: 0.7, send: 0.9 });
  },
  stolen(e) {
    e.melody([76, 72, 69, 65], { step: 0.07, type: 'square', filter: { type: 'lowpass', freq: 2800 }, decay: 0.1, gain: 0.1, send: 0.3 });
    for (let i = 0; i < 4; i++) coin(e, { freq: vary(e, 3800, 0.25), gain: 0.14, at: 0.02 + i * 0.05, pan: 0.6 - i * 0.4 });
    e.noise({ color: 'pink', filter: { type: 'bandpass', freq: 1800, q: 3 }, attack: 0.01, decay: 0.18, gain: 0.15, at: 0.2, pan: -0.6, send: 0.5 }); // scampering away
  },

  // ---- spells (each a distinct signature)
  'spell-teleport'(e) {
    for (let i = 0; i < 12; i++) e.osc({ freq: 300 + i * 95, to: 380 + i * 95, wave: 'glass', vibrato: { rate: 22, depth: 60 }, attack: 0.005, decay: 0.09, gain: 0.13, at: i * 0.035, pan: Math.sin(i * 1.7) * 0.7, send: 0.6 });
    e.noise({ filter: { type: 'highpass', freq: 2500, to: 7000 }, attack: 0.28, decay: 0.12, gain: 0.16, at: 0.25, send: 0.7 }); // reverse swell
    e.partials({ freq: 1320, ratios: [1, 1.5, 2.27, 3.4], amps: [1, 0.5, 0.35, 0.2], decays: [1.2, 0.8, 0.5, 0.3], gain: 0.22, at: 0.66, send: 0.9 }); // arrival
    e.osc({ freq: 80, to: 40, type: 'sine', attack: 0.003, decay: 0.3, gain: 0.3, at: 0.66, send: 0.3 });
  },
  'spell-shield'(e) {
    bell(e, { freq: NOTE(64), gain: 0.28, decay: 1.8, send: 0.7 });
    e.osc({ freq: NOTE(52), wave: 'organ', attack: 0.06, hold: 0.5, decay: 0.9, gain: 0.12, send: 0.7 });
    e.noise({ filter: { type: 'bandpass', freq: 600, to: 3200, q: 3 }, attack: 0.02, decay: 0.3, gain: 0.14, send: 0.5 });
    e.osc({ freq: 2000, to: 2600, type: 'sine', vibrato: { rate: 8, depth: 30 }, attack: 0.2, hold: 0.4, decay: 0.6, gain: 0.05, at: 0.1, send: 0.9 }); // the hum of the ward
  },
  'spell-regeneration'(e) {
    [60, 64, 67, 71, 74, 79].forEach((n, i) => pluck(e, { note: n, gain: 0.2, at: i * 0.09, pan: -0.5 + i * 0.2, send: 0.8, decay: 1.6 }));
    e.chord([48, 55, 64], { wave: 'voice', attack: 0.35, hold: 0.5, decay: 1.0, gain: 0.05, at: 0.2, send: 0.9 });
    e.noise({ color: 'pink', filter: { type: 'bandpass', freq: 800, to: 4000, q: 2 }, attack: 0.3, hold: 0.2, decay: 0.5, gain: 0.08, send: 0.7 });
  },
  'spell-invisibility'(e) {
    e.noise({ filter: { type: 'bandpass', freq: 3500, to: 250, q: 2.5 }, attack: 0.05, hold: 0.1, decay: 0.7, gain: 0.22, send: 0.7 });
    e.osc({ freq: 660, to: 110, type: 'triangle', vibrato: { rate: 6, depth: 40 }, attack: 0.05, hold: 0.2, decay: 0.6, gain: 0.1, at: 0.05, send: 0.6 });
    for (let i = 0; i < 6; i++) e.osc({ freq: 2400 - i * 300, wave: 'glass', attack: 0.004, decay: 0.2, gain: 0.07 - i * 0.008, at: 0.1 + i * 0.09, pan: (i % 2 ? 0.5 : -0.5), send: 0.8 });
  },
  'spell-light'(e) {
    e.noise({ filter: { type: 'bandpass', freq: 500, to: 6000, q: 1.5 }, attack: 0.08, decay: 0.35, gain: 0.2, send: 0.5 }); // flare
    e.osc({ freq: 180, to: 60, type: 'sine', attack: 0.004, decay: 0.25, gain: 0.25, send: 0.2 }); // ignition thump
    [84, 88, 91, 96].forEach((n, i) => e.osc({ freq: NOTE(n), wave: 'glass', attack: 0.01, decay: 0.7, gain: 0.12, at: 0.1 + i * 0.06, pan: -0.3 + i * 0.2, send: 0.8 }));
    e.chord([60, 67, 72, 76], { wave: 'organ', attack: 0.2, hold: 0.3, decay: 1.0, gain: 0.03, at: 0.15, send: 0.9 });
  },
  'spell-drift'(e) {
    e.noise({ color: 'pink', filter: { type: 'bandpass', freq: 400, to: 1600, q: 1 }, attack: 0.3, hold: 0.3, decay: 0.6, gain: 0.2, send: 0.7 });
    e.osc({ freq: 330, to: 660, wave: 'reed', vibrato: { rate: 3, depth: 60 }, attack: 0.3, hold: 0.3, decay: 0.7, gain: 0.08, send: 0.8 });
    [72, 76, 79, 83].forEach((n, i) => pluck(e, { note: n, gain: 0.16, at: 0.35 + i * 0.1, pan: -0.4 + i * 0.27, send: 0.9, decay: 1.6 }));
  },
  teleport(e) { SFX['spell-teleport'](e); },
  'magic-map'(e) { [72, 76, 79, 84, 88, 91, 96].forEach((n, i) => pluck(e, { note: n, gain: 0.2, at: i * 0.06, pan: -0.5 + i * 0.17, send: 0.8, decay: 1.5 })); e.noise({ filter: { type: 'highpass', freq: 4000 }, attack: 0.2, hold: 0.2, decay: 0.6, gain: 0.08, send: 0.8 }); },
  'lost-map'(e) { e.noise({ filter: { type: 'bandpass', freq: 800, to: 90, q: 1.2 }, attack: 0.02, hold: 0.2, decay: 0.7, gain: 0.3, send: 0.5 }); [64, 60, 57, 52].forEach((n, i) => e.osc({ freq: NOTE(n), wave: 'reed', filter: { type: 'lowpass', freq: 1200 }, attack: 0.01, decay: 0.3, gain: 0.1, at: i * 0.12, send: 0.5 })); },

  // ---- traversal & traps
  'stairs-down'(e) {
    for (let i = 0; i < 5; i++) {
      const at = i * 0.21, pan = i % 2 ? 0.15 : -0.15, pitch = 1 - i * 0.07;
      e.noise({ filter: { type: 'highpass', freq: 2500 * pitch }, attack: 0.001, decay: 0.014, gain: 0.26, at, pan, send: 0.5 });
      e.noise({ color: 'pink', filter: { type: 'bandpass', freq: 400 * pitch, q: 1.8 }, attack: 0.002, decay: 0.06, gain: 0.3, at, pan, send: 0.8 });
      e.osc({ freq: 140 * pitch, to: 70, type: 'sine', attack: 0.001, decay: 0.05, gain: 0.16, at, pan, send: 0.4 });
    }
    e.osc({ freq: 400, to: 110, type: 'triangle', filter: { type: 'lowpass', freq: 1500 }, attack: 0.05, hold: 0.5, decay: 0.4, gain: 0.12, send: 0.6 }); // the VIC sweep, softened
    e.noise({ color: 'brown', filter: { type: 'lowpass', freq: 260, to: 90 }, attack: 0.2, hold: 0.5, decay: 0.7, gain: 0.5, send: 0.6 }); // stone grinding
    e.osc({ freq: 48, to: 30, type: 'sine', attack: 0.4, hold: 0.4, decay: 0.8, gain: 0.3, at: 0.5, send: 0.2 });
  },
  'stairs-up'(e) {
    for (let i = 0; i < 5; i++) {
      const at = i * 0.19, pan = i % 2 ? 0.15 : -0.15, pitch = 0.85 + i * 0.06;
      e.noise({ filter: { type: 'highpass', freq: 2500 * pitch }, attack: 0.001, decay: 0.014, gain: 0.26, at, pan, send: 0.4 });
      e.noise({ color: 'pink', filter: { type: 'bandpass', freq: 420 * pitch, q: 1.8 }, attack: 0.002, decay: 0.06, gain: 0.3, at, pan, send: 0.7 });
    }
    e.osc({ freq: 150, to: 560, type: 'triangle', filter: { type: 'lowpass', freq: 1800 }, attack: 0.05, hold: 0.5, decay: 0.4, gain: 0.1, send: 0.6 });
    // the "crescendo": rising brass over a swell of light
    [60, 64, 67, 72].forEach((n, i) => brass(e, { note: n, len: 0.16, gain: 0.16 + i * 0.03, at: 0.55 + i * 0.13, pan: -0.3 + i * 0.2 }));
    e.chord([72, 76, 79], { wave: 'organ', attack: 0.2, hold: 0.5, decay: 1.2, gain: 0.05, at: 1.05, send: 0.9 });
    e.noise({ filter: { type: 'highpass', freq: 3000, to: 8000 }, attack: 0.5, hold: 0.1, decay: 0.7, gain: 0.08, at: 0.5, send: 0.8 });
  },
  'trap-pit'(e) {
    e.noise({ color: 'brown', filter: { type: 'lowpass', freq: 500, to: 120 }, attack: 0.01, hold: 0.1, decay: 0.5, gain: 0.4, send: 0.4 }); // floor gives way
    for (let i = 0; i < 8; i++) e.noise({ filter: { type: 'bandpass', freq: vary(e, 2200, 0.4), q: 2.5 }, attack: 0.001, decay: 0.03, gain: 0.16, at: e.rng.next() * 0.25, pan: (e.rng.next() - 0.5) * 0.8, send: 0.3 });
    e.noise({ color: 'pink', filter: { type: 'bandpass', freq: 1400, to: 300, q: 0.8 }, attack: 0.15, hold: 0.2, decay: 0.4, gain: 0.3, at: 0.2, send: 0.5 }); // falling whoosh
    e.osc({ freq: 700, to: 90, type: 'sine', attack: 0.05, hold: 0.3, decay: 0.3, gain: 0.08, at: 0.2 }); // the hero's yelp, cartoon-honest
    thud(e, { gain: 0.4, at: 0.85, low: 1.4, send: 0.6 });
    e.osc({ freq: 60, to: 28, type: 'sine', attack: 0.003, decay: 0.6, gain: 0.32, at: 0.85, send: 0.3 });
  },
  'trap-ceiling'(e) {
    e.noise({ color: 'brown', filter: { type: 'lowpass', freq: 300, to: 100 }, attack: 0.05, hold: 0.25, decay: 0.5, gain: 0.5, send: 0.5 }); // rumble
    for (let i = 0; i < 10; i++) { const at = 0.2 + i * 0.06 + e.rng.next() * 0.05; thud(e, { gain: 0.22 + e.rng.next() * 0.2, at, low: 1.1 + e.rng.next() * 0.5, pan: (e.rng.next() - 0.5) * 0.9, send: 0.5 }); }
    e.osc({ freq: 55, to: 25, type: 'sine', attack: 0.01, decay: 0.8, gain: 0.5, at: 0.3, drive: 0.3 });
  },
  'trap-explosion'(e) {
    e.osc({ freq: 120, to: 18, slide: 0.35, type: 'sine', attack: 0.002, decay: 0.9, gain: 0.7, drive: 0.6, send: 0.3 }); // sub boom
    e.noise({ filter: { type: 'lowpass', freq: 6000, to: 120 }, attack: 0.001, hold: 0.04, decay: 0.8, gain: 0.6, drive: 0.5, send: 0.6 }); // crack
    e.noise({ filter: { type: 'highpass', freq: 2000 }, attack: 0.001, decay: 0.12, gain: 0.5, pan: 0.2 });
    for (let i = 0; i < 12; i++) e.noise({ filter: { type: 'bandpass', freq: vary(e, 2600, 0.4), q: 3 }, attack: 0.001, decay: 0.02 + e.rng.next() * 0.03, gain: 0.2, at: 0.3 + e.rng.next() * 0.9, pan: (e.rng.next() - 0.5), send: 0.5 }); // debris
    e.osc({ freq: 3400, type: 'sine', attack: 0.05, hold: 0.8, decay: 1.2, gain: 0.03, at: 0.1 }); // tinnitus ring
  },
  'trap-teleport'(e) { SFX['spell-teleport'](e); },
  proximity(e, p = {}) {
    // tuned to the score's root so it reads as music, not noise; faster and brighter as the threat closes
    const k = p.k ?? 0.5, root = p.root || 55;
    e.osc({ freq: root * (1 + 0.06 * k), to: root * 0.75, type: 'sawtooth', filter: { type: 'lowpass', freq: 180 + k * 520, q: 4 }, drive: 0.3, attack: 0.008, hold: 0.04 + k * 0.05, decay: 0.12, gain: 0.16 + k * 0.16, pan: (p.pan || 0) * 0.5, send: 0.25 });
    e.osc({ freq: root * 2.06, type: 'square', filter: { type: 'lowpass', freq: 500 + k * 900 }, attack: 0.004, decay: 0.05, gain: 0.03 + k * 0.05, pan: (p.pan || 0) * 0.7 });
  },
  heartbeat(e, p = {}) {
    const k = p.k ?? 0.5; // 0 = 30 % HP, 1 = dying
    e.osc({ freq: 72, to: 38, slide: 0.08, type: 'sine', attack: 0.004, decay: 0.16, gain: 0.55 + k * 0.3, drive: 0.25 });
    e.noise({ color: 'brown', filter: { type: 'lowpass', freq: 220 }, attack: 0.003, decay: 0.08, gain: 0.3 });
    e.osc({ freq: 62, to: 34, slide: 0.08, type: 'sine', attack: 0.004, decay: 0.2, gain: 0.42 + k * 0.25, at: 0.17, drive: 0.25 });
  },

  // ---- fanfares, temple, death
  levelup(e) {
    timpani(e, { note: 43, gain: 0.36, roll: 0.35 });
    const line = [[67, 0.12], [72, 0.12], [76, 0.12], [79, 0.45]];
    let t = 0.3;
    for (const [n, len] of line) { brass(e, { note: n, len, gain: 0.2, at: t, pan: 0.15 }); brass(e, { note: n - 5, len, gain: 0.12, at: t, pan: -0.25 }); t += len + 0.04; }
    e.chord([48, 55, 60, 64, 67], { wave: 'organ', attack: 0.15, hold: 0.9, decay: 1.4, gain: 0.05, at: 0.78, send: 0.9 });
    drums.hat(e, { gain: 0.14, open: true, at: 0.78 });
    [84, 88, 91, 96].forEach((n, i) => pluck(e, { note: n, gain: 0.16, at: 0.85 + i * 0.07, pan: -0.4 + i * 0.27, send: 0.9, decay: 1.6 }));
    timpani(e, { note: 43, gain: 0.4, at: 0.78 });
  },
  'sword-fanfare'(e) {
    const mel = [[60, 0.13], [60, 0.13], [60, 0.13], [64, 0.24], [67, 0.24], [null, 0.08], [64, 0.13], [67, 0.13], [72, 0.6]];
    let t = 0.05;
    timpani(e, { note: 36, gain: 0.32 });
    for (const [n, len] of mel) { if (n != null) { brass(e, { note: n, len, gain: 0.14, at: t, pan: 0.2 }); brass(e, { note: n - 12, len, gain: 0.08, at: t, pan: -0.2, attack: 0.05 }); } t += len + 0.03; }
    timpani(e, { note: 36, gain: 0.34, at: t - 0.63, roll: 0.3 });
    e.chord([72, 76, 79, 84], { wave: 'organ', attack: 0.2, hold: 1.2, decay: 1.6, gain: 0.05, at: t - 0.6, send: 0.9 });
    bell(e, { freq: NOTE(72), gain: 0.2, at: t - 0.6, decay: 3, send: 0.9 });
    [84, 88, 91, 96, 100].forEach((n, i) => pluck(e, { note: n, gain: 0.14, at: t - 0.5 + i * 0.07, pan: -0.5 + i * 0.25, send: 0.9, decay: 1.8 }));
    drums.hat(e, { gain: 0.12, open: true, at: t - 0.6 });
  },
  'title-fanfare'(e) { SFX['sword-fanfare'](e); },
  victory(e) {
    SFX['sword-fanfare'](e);
    [72, 76, 79, 84, 79, 84, 88, 91].forEach((n, i) => brass(e, { note: n, len: 0.14, gain: 0.13, at: 2.3 + i * 0.16, pan: Math.sin(i) * 0.4 }));
    e.chord([60, 67, 72, 76, 79, 84], { wave: 'organ', attack: 0.3, hold: 1.4, decay: 2.2, gain: 0.05, at: 3.55, send: 0.9 });
    timpani(e, { note: 36, gain: 0.55, at: 3.55, roll: 0.4 });
    bell(e, { freq: NOTE(84), gain: 0.2, at: 3.6, decay: 3 });
  },
  'sword-stolen'(e) {
    e.noise({ filter: { type: 'bandpass', freq: 3000, to: 200, q: 1.5 }, attack: 0.02, hold: 0.2, decay: 0.6, gain: 0.3, send: 0.5 });
    [64, 60, 56, 52].forEach((n, i) => brass(e, { note: n, len: 0.2, gain: 0.16, at: i * 0.22, pan: -0.3 + i * 0.2 }));
    e.chord([40, 46], { type: 'sawtooth', filter: { type: 'lowpass', freq: 500 }, drive: 0.4, attack: 0.05, hold: 0.6, decay: 1.0, gain: 0.1, at: 0.4, send: 0.5 });
    steelDraw(e, { gain: 0.3, at: 0.1, pan: 0.5 });
  },
  'death-dirge'(e) {
    // tolling bell, organ descent, the last breath, a sub that fades into black
    bell(e, { freq: NOTE(45), gain: 0.26, decay: 4, send: 0.9 });
    [62, 60, 58, 55, null, 50].forEach((n, i) => { if (n != null) e.chord([n, n - 12], { wave: 'organ', attack: 0.06, hold: 0.32, decay: 0.5, gain: 0.06, at: 0.2 + i * 0.36, send: 0.8 }); });
    bell(e, { freq: NOTE(45), gain: 0.22, at: 1.7, decay: 4, send: 0.9 });
    e.noise({ color: 'pink', filter: { type: 'bandpass', freq: 900, to: 300, q: 1.5 }, attack: 0.4, hold: 0.3, decay: 1.2, gain: 0.12, at: 0.3, send: 0.6 });
    e.osc({ freq: 50, to: 26, type: 'sine', attack: 0.4, hold: 1.2, decay: 2.2, gain: 0.3, at: 0.5, send: 0.3 });
  },
  sacrifice(e) {
    [72, 79, 84, 88, 91, 96].forEach((n, i) => bell(e, { freq: NOTE(n), gain: 0.14, at: i * 0.09, pan: -0.5 + i * 0.2, decay: 1.6 + i * 0.2, send: 0.9 }));
    e.chord([48, 55, 60, 64], { wave: 'voice', attack: 0.4, hold: 0.6, decay: 1.4, gain: 0.05, at: 0.3, send: 0.95 });
    e.noise({ filter: { type: 'highpass', freq: 4000, to: 9000 }, attack: 0.4, hold: 0.2, decay: 0.9, gain: 0.07, at: 0.2, send: 0.9 });
  },
  temple(e) {
    e.chord([48, 55, 60, 64, 67], { wave: 'voice', attack: 0.6, hold: 0.8, decay: 1.8, gain: 0.05, send: 0.95 });
    bell(e, { freq: NOTE(60), gain: 0.16, at: 0.3, decay: 3, send: 0.95 });
    bell(e, { freq: NOTE(67), gain: 0.12, at: 0.9, decay: 3, send: 0.95 });
  },

  // ---- UI (dry, quiet, quick — on the ui bus)
  'ui-hover'(e) { e.osc({ freq: 1500, type: 'sine', attack: 0.002, decay: 0.03, gain: 0.12, bus: 'ui' }); e.noise({ filter: { type: 'highpass', freq: 6000 }, attack: 0.001, decay: 0.012, gain: 0.12, bus: 'ui' }); },
  'ui-click'(e) { e.noise({ filter: { type: 'bandpass', freq: 2600, q: 2 }, attack: 0.001, decay: 0.03, gain: 0.65, bus: 'ui' }); e.osc({ freq: 900, to: 1300, type: 'triangle', attack: 0.002, decay: 0.06, gain: 0.26, bus: 'ui' }); e.osc({ freq: 240, to: 160, type: 'sine', attack: 0.001, decay: 0.05, gain: 0.28, bus: 'ui' }); },
  'ui-open'(e) { e.noise({ color: 'pink', filter: { type: 'bandpass', freq: 600, to: 2600, q: 1.2 }, attack: 0.03, decay: 0.12, gain: 0.2, bus: 'ui' }); pluck(e, { note: 72, gain: 0.14, bus: 'ui', send: 0 }); pluck(e, { note: 79, gain: 0.14, at: 0.06, bus: 'ui', send: 0 }); },
  'ui-close'(e) { e.noise({ color: 'pink', filter: { type: 'bandpass', freq: 2600, to: 600, q: 1.2 }, attack: 0.03, decay: 0.12, gain: 0.2, bus: 'ui' }); pluck(e, { note: 79, gain: 0.14, bus: 'ui', send: 0 }); pluck(e, { note: 72, gain: 0.14, at: 0.06, bus: 'ui', send: 0 }); },

  // ---- ambience one-shots (scheduled by the score)
  drip(e, p = {}) {
    const f = vary(e, 1900, 0.35), at = p.at || 0;
    e.osc({ freq: f, to: f * 0.72, slide: 0.03, type: 'sine', attack: 0.002, decay: 0.09, gain: p.gain ?? 0.09, at, pan: p.pan || 0, send: 1.2, bus: p.bus });
    e.osc({ freq: f * 2.7, type: 'sine', attack: 0.001, decay: 0.02, gain: (p.gain ?? 0.09) * 0.4, at, pan: p.pan || 0, bus: p.bus });
  },
  rumble(e, p = {}) {
    e.osc({ freq: 38, to: 28, type: 'sine', attack: 1.2, hold: 1, decay: 2.4, gain: p.gain ?? 0.25, at: p.at || 0, pan: p.pan || 0, bus: p.bus, drive: 0.2 });
    e.noise({ color: 'brown', filter: { type: 'lowpass', freq: 120 }, attack: 1.4, hold: 0.8, decay: 2.2, gain: (p.gain ?? 0.25) * 1.2, at: p.at || 0, pan: p.pan || 0, bus: p.bus, send: 0.4 });
  },
  'wind-gust'(e, p = {}) {
    e.noise({ color: 'pink', filter: { type: 'bandpass', freq: 350, to: 900, q: 1.6, bend: [[1.2, 700], [1.8, 260]] }, attack: 1.4, hold: 0.6, decay: 1.8, gain: p.gain ?? 0.08, at: p.at || 0, pan: p.pan || 0, bus: p.bus, send: 0.6 });
  },
};

/** Representative renders for tools/audiodump.mjs. */
export const CATALOG = [
  { name: 'step-stone', seconds: 1, run: (e) => { e.play('step', { tile: TILE.FLOOR, alt: 0 }); e.play('step', { tile: TILE.FLOOR, alt: 1, at: 0.4 }); } },
  { name: 'step-water', seconds: 1.2, run: (e) => e.play('step', { tile: TILE.WATER }) },
  { name: 'step-rubble', seconds: 1, run: (e) => e.play('step', { tile: TILE.RUBBLE }) },
  { name: 'monster-step-unseen', seconds: 1, run: (e) => e.play('monster-step', { entity: { size: 1.3 }, pan: -0.5, gain: 0.5, seen: false, dist: 4 }) },
  { name: 'swing', seconds: 1, run: (e) => e.play('swing') },
  { name: 'hit-creature', seconds: 1.5, run: (e) => e.play('hit-creature') },
  { name: 'hit-human', seconds: 1.5, run: (e) => e.play('hit-human') },
  { name: 'crit', seconds: 2, run: (e) => e.play('crit') },
  { name: 'hurt', seconds: 1.5, run: (e) => e.play('hurt') },
  { name: 'shield-block', seconds: 1.5, run: (e) => e.play('shield-block') },
  { name: 'monster-attack-creature', seconds: 1.5, run: (e) => e.play('monster-attack', { entity: { type: 'troll', family: 'creature', size: 1.4 }, heavy: 1 }) },
  { name: 'monster-attack-human', seconds: 1.5, run: (e) => e.play('monster-attack', { entity: { type: 'swordsman', family: 'human' }, heavy: 0.8 }) },
  { name: 'alarm', seconds: 2, run: (e) => e.play('alarm') },
  { name: 'danger-sting', seconds: 2, run: (e) => e.play('danger-sting') },
  { name: 'slain-creature', seconds: 2.5, run: (e) => e.play('slain-creature', { family: 'creature' }) },
  { name: 'slain-human', seconds: 2.5, run: (e) => e.play('slain-human', { family: 'human' }) },
  { name: 'voice-ogre', seconds: 2.5, run: (e) => e.play('voice', { entity: { type: 'ogre', family: 'creature', size: 1.3 } }) },
  { name: 'voice-dire-wolf', seconds: 2.5, run: (e) => e.play('voice', { entity: { type: 'dire-wolf', family: 'creature', size: 0.8 } }) },
  { name: 'voice-gargoyle', seconds: 2.5, run: (e) => e.play('voice', { entity: { type: 'gargoyle', family: 'creature', size: 1 } }) },
  { name: 'voice-dimension-spider', seconds: 2, run: (e) => e.play('voice', { entity: { type: 'dimension-spider', family: 'creature', size: 1.1 } }) },
  { name: 'voice-fyre-drake', seconds: 3.5, run: (e) => e.play('voice', { entity: { type: 'fyre-drake', family: 'creature', size: 1.6 } }) },
  { name: 'voice-barbarian', seconds: 2, run: (e) => e.play('voice', { entity: { type: 'barbarian', family: 'human', size: 1.1 } }) },
  { name: 'voice-monk', seconds: 2.5, run: (e) => e.play('voice', { entity: { type: 'monk', family: 'human', size: 1 } }) },
  { name: 'voice-assassin', seconds: 2, run: (e) => e.play('voice', { entity: { type: 'assassin', family: 'human', size: 1 } }) },
  { name: 'voice-unseen-troll', seconds: 2.5, run: (e) => e.play('voice', { entity: { type: 'troll', family: 'creature', size: 1.4 }, seen: false, pan: 0.6, intensity: 0.6 }) },
  { name: 'demon-roar', seconds: 3.5, run: (e) => e.play('demon-roar') },
  { name: 'mage-cast', seconds: 2.5, run: (e) => e.play('mage-cast') },
  { name: 'gold', seconds: 2.5, run: (e) => e.play('gold', { amount: 120 }) },
  { name: 'gold-hoard', seconds: 3, run: (e) => e.play('gold', { amount: 900 }) },
  { name: 'item', seconds: 2.5, run: (e) => e.play('item', { magic: true }) },
  { name: 'chest', seconds: 2, run: (e) => e.play('chest') },
  { name: 'potion', seconds: 3, run: (e) => e.play('potion') },
  { name: 'stolen', seconds: 1.5, run: (e) => e.play('stolen') },
  { name: 'spell-teleport', seconds: 3, run: (e) => e.play('spell-teleport') },
  { name: 'spell-shield', seconds: 3, run: (e) => e.play('spell-shield') },
  { name: 'spell-regeneration', seconds: 3.5, run: (e) => e.play('spell-regeneration') },
  { name: 'spell-invisibility', seconds: 2.5, run: (e) => e.play('spell-invisibility') },
  { name: 'spell-light', seconds: 3, run: (e) => e.play('spell-light') },
  { name: 'spell-drift', seconds: 3.5, run: (e) => e.play('spell-drift') },
  { name: 'magic-map', seconds: 3, run: (e) => e.play('magic-map') },
  { name: 'stairs-down', seconds: 3.5, run: (e) => e.play('stairs-down') },
  { name: 'stairs-up', seconds: 3.5, run: (e) => e.play('stairs-up') },
  { name: 'trap-pit', seconds: 3, run: (e) => e.play('trap-pit') },
  { name: 'trap-ceiling', seconds: 3, run: (e) => e.play('trap-ceiling') },
  { name: 'trap-explosion', seconds: 4, run: (e) => e.play('trap-explosion') },
  { name: 'proximity-far', seconds: 1, run: (e) => e.play('proximity', { k: 0.2, root: 55 }) },
  { name: 'proximity-near', seconds: 1, run: (e) => e.play('proximity', { k: 0.9, root: 55, pan: 0.5 }) },
  { name: 'heartbeat', seconds: 1.5, run: (e) => e.play('heartbeat', { k: 0.6 }) },
  { name: 'levelup', seconds: 4.5, run: (e) => e.play('levelup') },
  { name: 'sword-fanfare', seconds: 6, run: (e) => e.play('sword-fanfare') },
  { name: 'victory', seconds: 8, run: (e) => e.play('victory') },
  { name: 'sword-stolen', seconds: 3, run: (e) => e.play('sword-stolen') },
  { name: 'death-dirge', seconds: 7, run: (e) => e.play('death-dirge') },
  { name: 'sacrifice', seconds: 4, run: (e) => e.play('sacrifice') },
  { name: 'temple', seconds: 5, run: (e) => e.play('temple') },
  { name: 'ui-click', seconds: 0.6, run: (e) => e.play('ui-click') },
  { name: 'ui-open', seconds: 1, run: (e) => e.play('ui-open') },
  { name: 'ambience-drip', seconds: 3, run: (e) => { e.play('drip', { pan: -0.4 }); e.play('drip', { pan: 0.5, at: 1.1 }); } },
];

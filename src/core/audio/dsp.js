// DSP helpers for the procedural audio engine: deterministic noise buffers, a procedural stereo
// impulse response (the dungeon reverb), waveshaper curves, musical scales and note math.
// Everything is pure and seeded (core/rng.js) so renders are bit-for-bit reproducible.
import { createRng } from '../rng.js';

/** MIDI note number -> Hz. */
export const NOTE = (n) => 440 * 2 ** ((n - 69) / 12);
/** Decibels -> linear gain. */
export const dB = (d) => 10 ** (d / 20);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Musical modes as semitone offsets from the root (7 degrees). */
export const MODES = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  hungarian: [0, 2, 3, 6, 7, 8, 11],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

/**
 * MIDI note of scale degree `deg` (0-based, may exceed 7 or be negative) above `root` in `mode`.
 * @param {number} root  MIDI root
 * @param {number[]} mode semitone table
 * @param {number} deg
 */
export function degree(root, mode, deg) {
  const n = mode.length;
  const oct = Math.floor(deg / n), i = ((deg % n) + n) % n;
  return root + oct * 12 + mode[i];
}

/**
 * Deterministic noise buffer. `color`: 'white' | 'pink' | 'brown'.
 * @param {BaseAudioContext} ctx
 */
export function makeNoiseBuffer(ctx, seconds, seed, color = 'white') {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  const r = createRng(seed);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    if (color === 'white') for (let i = 0; i < n; i++) d[i] = r.next() * 2 - 1;
    else if (color === 'pink') {
      // Paul Kellet's economy pink filter
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < n; i++) {
        const w = r.next() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
      }
    } else {
      let y = 0;
      for (let i = 0; i < n; i++) { y = (y + 0.02 * (r.next() * 2 - 1)) / 1.02; d[i] = y * 3.5; }
    }
  }
  return buf;
}

/**
 * Procedural stereo room impulse response: sparse early reflections followed by an exponentially
 * decaying, progressively darker diffuse tail (air absorption). Used by the convolver reverb.
 * @param {BaseAudioContext} ctx
 * @param {{seconds?:number, decay?:number, damp?:number, predelay?:number, early?:number, seed?:string|number, lowBoost?:number}} o
 *  seconds: tail length; decay: RT60-ish seconds; damp: 0..1 how fast highs die; predelay: s; early: early-reflection level
 */
export function makeImpulseResponse(ctx, o = {}) {
  const sr = ctx.sampleRate;
  const seconds = o.seconds ?? 2.4, rt = o.decay ?? 1.8, damp = o.damp ?? 0.5, pre = Math.floor((o.predelay ?? 0.018) * sr), early = o.early ?? 0.6;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  const r = createRng(o.seed ?? 'fargoal-ir');
  // early reflection taps (ms) with mild stereo asymmetry
  const taps = [[9, 0.55, 0.3], [17, 0.42, -0.5], [29, 0.36, 0.6], [41, 0.3, -0.25], [57, 0.24, 0.45], [73, 0.18, -0.6], [97, 0.12, 0.2]];
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const k = Math.log(1000) / rt; // -60 dB after rt seconds
    // diffuse tail: noise * exp decay, low-passed with a coefficient that closes over time
    let lp = 0, lp2 = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp(-k * t);
      // build-up over the first ~40 ms so the tail does not start with a click
      const rise = Math.min(1, t / 0.04);
      const w = (r.next() * 2 - 1) * env * rise;
      // one-pole lowpass that darkens as the tail evolves
      const cut = clamp(1 - damp * (0.35 + 0.65 * Math.min(1, t / rt)), 0.03, 1);
      lp += cut * (w - lp);
      lp2 += 0.6 * (lp - lp2);
      d[i] = lp2 * 0.75 + (o.lowBoost ? lp2 * 0 : 0);
    }
    for (const [ms, g, side] of taps) {
      const i = pre + Math.floor(ms / 1000 * sr);
      if (i < n) d[i] += g * early * (c === 0 ? 1 - side * 0.35 : 1 + side * 0.35) * (1 - 2 * (r.next() < 0.5));
    }
  }
  // normalise to a sane peak
  let peak = 0;
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i])); }
  if (peak > 0) for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) d[i] /= peak; }
  return buf;
}

/** Soft-clip / saturation curve for WaveShaperNode. amount 0..1. */
export function makeDriveCurve(amount = 0.5, samples = 1024) {
  const k = 2 + amount * 60;
  const c = new Float32Array(samples);
  for (let i = 0; i < samples; i++) { const x = (i / (samples - 1)) * 2 - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return c;
}

/** Periodic wave with a given harmonic amplitude profile (fn(harmonic) -> amp). Cached per ctx by name. */
const waveCache = new WeakMap();
export function periodicWave(ctx, name, fn, harmonics = 24) {
  let m = waveCache.get(ctx); if (!m) { m = new Map(); waveCache.set(ctx, m); }
  if (m.has(name)) return m.get(name);
  const re = new Float32Array(harmonics + 1), im = new Float32Array(harmonics + 1);
  for (let h = 1; h <= harmonics; h++) im[h] = fn(h);
  const w = ctx.createPeriodicWave(re, im, { disableNormalization: false });
  m.set(name, w);
  return w;
}

/** Named timbres for periodicWave(). */
export const WAVES = {
  organ: (h) => ([1, 2, 3, 4, 6, 8].includes(h) ? 1 / h : 0),
  brass: (h) => (1 / h) * (h % 2 ? 1 : 0.75),
  reed: (h) => (h % 2 ? 1 / h : 0.15 / h),
  glass: (h) => ([1, 3, 7].includes(h) ? 1 / (h * h) : 0),
  voice: (h) => Math.exp(-0.25 * h) * (h < 6 ? 1 : 0.5),
  bass: (h) => (h <= 3 ? 1 / h : 0.3 / h),
};

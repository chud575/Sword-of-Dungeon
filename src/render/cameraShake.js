// Camera shake: a "trauma" model (shake = trauma², linear decay) driven by seeded smooth value
// noise, so hits read as a handheld jolt with roll instead of white-noise jitter. Deterministic:
// the noise table comes from core/rng and the output is a pure function of elapsed time.
import { createRng } from '../core/rng.js';

const TABLE = 128;

/** Seeded 1-D smooth noise in [-1, 1]. */
export class SmoothNoise {
  constructor(seed = 'fargoal-shake') {
    const rng = createRng(seed);
    this.table = new Float32Array(TABLE);
    for (let i = 0; i < TABLE; i++) this.table[i] = rng.float(-1, 1);
  }

  /** Cosine-interpolated sample at continuous coordinate t. */
  at(t) {
    const i = Math.floor(t), f = t - i;
    const k = (1 - Math.cos(f * Math.PI)) * 0.5;
    const a = this.table[((i % TABLE) + TABLE) % TABLE], b = this.table[(((i + 1) % TABLE) + TABLE) % TABLE];
    return a + (b - a) * k;
  }
}

export class TraumaShaker {
  /**
   * @param {{maxOffset?:number, maxRoll?:number, decay?:number, frequency?:number}} opts
   *   maxOffset in world units (applied in camera space), maxRoll in radians, decay in trauma/s.
   */
  constructor({ maxOffset = 0.42, maxRoll = 2.4 * Math.PI / 180, decay = 1.7, frequency = 13 } = {}) {
    this.noise = new SmoothNoise('fargoal-shake');
    this.maxOffset = maxOffset; this.maxRoll = maxRoll; this.decay = decay; this.frequency = frequency;
    this.trauma = 0;
    this.enabled = true;
    this.hold = false; // debug/stills: no decay
    this.time = 0;
    this.out = { x: 0, y: 0, roll: 0, amount: 0 };
  }

  /** Add trauma (0..1); the response is quadratic so small hits stay subtle. */
  add(amount) { if (this.enabled && amount > 0) this.trauma = Math.min(1, this.trauma + amount); }

  /** Advance and compute this frame's camera-space offsets. */
  update(dt) {
    this.time += dt;
    if (this.trauma <= 0.0005) { this.trauma = 0; this.out.x = this.out.y = this.out.roll = this.out.amount = 0; return this.out; }
    if (!this.hold) this.trauma = Math.max(0, this.trauma - this.decay * dt);
    const s = this.trauma * this.trauma;
    const t = this.time * this.frequency;
    this.out.x = this.maxOffset * s * this.noise.at(t);
    this.out.y = this.maxOffset * 0.7 * s * this.noise.at(t + 37.3);
    this.out.roll = this.maxRoll * s * this.noise.at(t * 0.8 + 71.9);
    this.out.amount = s;
    return this.out;
  }
}

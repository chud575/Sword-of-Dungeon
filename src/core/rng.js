// Seeded deterministic RNG (mulberry32). All game randomness must go through here.

/** FNV-1a 32-bit hash of a string. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Normalise any seed (number, numeric string, text) into a uint32. */
export function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return (Math.floor(seed) >>> 0);
  if (typeof seed === 'string') {
    const n = Number(seed);
    if (seed.trim() !== '' && Number.isFinite(n)) return Math.floor(n) >>> 0;
    return hashString(seed);
  }
  return hashString(String(seed));
}

/** Combine several parts (numbers/strings) into one deterministic uint32 seed. */
export function seedFrom(...parts) {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h ^= normalizeSeed(p);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/**
 * Create a seeded RNG.
 * @param {number|string} seed
 * @returns {{ seed:number, next():number, int(a:number,b:number):number, float(a:number,b:number):number,
 *   pick<T>(arr:T[]):T, chance(p:number):boolean, shuffle<T>(arr:T[]):T[], fork(label:string):object,
 *   getState():number, setState(s:number):void, state:number }}
 */
export function createRng(seed) {
  let s = normalizeSeed(seed);
  const initial = s;
  const nextU32 = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  const rng = {
    seed: initial,
    /** Uniform float in [0, 1). */
    next() { return nextU32() / 4294967296; },
    /** Integer in [a, b] inclusive. */
    int(a, b) {
      if (b === undefined) { b = a; a = 0; }
      if (b < a) { const t = a; a = b; b = t; }
      return a + Math.floor(rng.next() * (b - a + 1));
    },
    /** Float in [a, b). */
    float(a = 0, b = 1) { return a + rng.next() * (b - a); },
    /** Random element (undefined for empty arrays). */
    pick(arr) { return arr.length ? arr[Math.floor(rng.next() * arr.length)] : undefined; },
    /** True with probability p. */
    chance(p) { return rng.next() < p; },
    /** In-place Fisher-Yates shuffle; returns the array. */
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
    /** Derive an independent RNG (consumes one value from this one). */
    fork(label = '') { return createRng(seedFrom(nextU32(), label)); },
    getState() { return s >>> 0; },
    setState(v) { s = (v | 0); },
    get state() { return s >>> 0; },
    set state(v) { s = (v | 0); },
  };
  return rng;
}

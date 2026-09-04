// pixelPainter: a small pixel-art toolkit for hand-authored sprites. No DOM, no THREE — pure data,
// so sheets can be built (and inspected) from node as well as in the browser.
//
// A Pix is a w×h grid of palette *keys* (single characters; '.'/0 = transparent). Art is written as
// rows of characters (see `paint`), shaded by hand with the keys of hue-shifted colour ramps, and
// composed from layered parts with per-frame offsets. Colours are only resolved at the very end
// (`toRGBA`), which keeps recolouring, outlining, mirroring and flashing trivial.

/** @typedef {{w:number,h:number,d:Uint16Array}} Pix */

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** '#rrggbb' or 0xrrggbb -> [r,g,b] (0..255). */
export function toRgb(c) {
  if (typeof c === 'number') return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const s = c.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

export function hslToRgb([h, s, l]) {
  h = ((h % 1) + 1) % 1; s = clamp01(s); l = clamp01(l);
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = ((t % 1) + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

/** Shortest signed distance between two hues (0..1 wrap). */
const hueDelta = (from, to) => { let d = to - from; while (d > 0.5) d -= 1; while (d < -0.5) d += 1; return d; };

/**
 * A hue-shifted colour ramp: shadows drift toward a cool hue (purple/blue) and gain saturation,
 * highlights drift toward a warm hue (yellow) and lose a little saturation — never a plain
 * darken/lighten. `tones` colours from darkest to lightest around `base` (index `mid`).
 * @param {string|number} base
 * @param {{tones?:number, mid?:number, step?:number, shadowHue?:number, lightHue?:number, hueShift?:number, satShift?:number}} [o]
 * @returns {number[][]} [r,g,b] list, darkest first
 */
export function makeRamp(base, o = {}) {
  const tones = o.tones ?? 4, mid = o.mid ?? Math.floor((tones - 1) / 2);
  const step = o.step ?? 0.11, shadowHue = o.shadowHue ?? 0.74, lightHue = o.lightHue ?? 0.13;
  const hueShift = o.hueShift ?? 0.055, satShift = o.satShift ?? 0.12;
  const [h, s, l] = rgbToHsl(toRgb(base));
  const out = [];
  for (let i = 0; i < tones; i++) {
    const k = i - mid; // negative = darker
    const toward = k < 0 ? shadowHue : lightHue;
    const hh = h + hueDelta(h, toward) * Math.min(1, Math.abs(k) * hueShift * 3.2);
    const ss = clamp01(s + (k < 0 ? 1 : -1) * Math.abs(k) * satShift * (s > 0.08 ? 1 : 0));
    const ll = clamp01(l + k * step * (k < 0 ? 1 : 0.92));
    out.push(hslToRgb([hh, ss, ll]));
  }
  return out;
}

/** Palette: maps single-character keys to colours. */
export class Palette {
  constructor() { /** @type {Map<string, number[]>} */ this.map = new Map(); }
  /** Register one key. */
  set(key, color) { this.map.set(key, Array.isArray(color) ? color : toRgb(color)); return this; }
  /** Register a ramp: `keys` string (darkest first), one key per tone. */
  ramp(keys, base, opts = {}) {
    const cols = makeRamp(base, { tones: keys.length, ...opts });
    for (let i = 0; i < keys.length; i++) this.map.set(keys[i], cols[i]);
    return this;
  }
  get(key) { return this.map.get(key) || [255, 0, 255]; }
  has(key) { return this.map.has(key); }
}

// ------------------------------------------------------------------------------------------ Pix

export function makePix(w, h) { return { w, h, d: new Uint16Array(w * h) }; }

/**
 * Parse hand-drawn rows into a Pix. '.' and ' ' are transparent; rows are right-padded so a
 * ragged block is fine. Leading/trailing blank lines are dropped.
 * @param {string|string[]} rows
 */
export function paint(rows) {
  const lines = (Array.isArray(rows) ? rows : rows.split('\n')).filter((l, i, a) => !(l.trim() === '' && (i === 0 || i === a.length - 1)));
  const w = Math.max(...lines.map((l) => l.length)), h = lines.length;
  const p = makePix(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < lines[y].length; x++) {
    const c = lines[y][x];
    if (c !== '.' && c !== ' ') p.d[y * w + x] = c.charCodeAt(0);
  }
  return p;
}

export function getPx(p, x, y) { return x < 0 || y < 0 || x >= p.w || y >= p.h ? 0 : p.d[y * p.w + x]; }
export function setPx(p, x, y, key) { if (x >= 0 && y >= 0 && x < p.w && y < p.h) p.d[y * p.w + x] = typeof key === 'string' ? key.charCodeAt(0) : key; }
export function clone(p) { return { w: p.w, h: p.h, d: new Uint16Array(p.d) }; }

/** Horizontal mirror (a new Pix). */
export function mirror(p) {
  const o = makePix(p.w, p.h);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) o.d[y * p.w + (p.w - 1 - x)] = p.d[y * p.w + x];
  return o;
}

/** Mirror and swap key pairs (so lit/shadow tones stay on the lit/shadow side): swaps = 'ab' pairs. */
export function mirrorLit(p, swaps = '') {
  const o = mirror(p);
  if (!swaps) return o;
  const m = new Map();
  for (let i = 0; i + 1 < swaps.length; i += 2) { m.set(swaps.charCodeAt(i), swaps.charCodeAt(i + 1)); m.set(swaps.charCodeAt(i + 1), swaps.charCodeAt(i)); }
  for (let i = 0; i < o.d.length; i++) { const r = m.get(o.d[i]); if (r) o.d[i] = r; }
  return o;
}

/** Copy `src` onto `dst` at (dx,dy); transparent source pixels are skipped. */
export function blit(dst, src, dx, dy, { mirror: mir = false } = {}) {
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const k = src.d[y * src.w + (mir ? src.w - 1 - x : x)];
    if (k) setPx(dst, dx + x, dy + y, k);
  }
  return dst;
}

/**
 * Compose layers (drawn in order) into a new w×h Pix.
 * @param {number} w @param {number} h
 * @param {Array<{p:Pix, x:number, y:number, mirror?:boolean}|null>} layers
 */
export function compose(w, h, layers) {
  const out = makePix(w, h);
  for (const L of layers) if (L && L.p) blit(out, L.p, L.x | 0, L.y | 0, { mirror: !!L.mirror });
  return out;
}

/** Replace keys: map = { from: to, ... } (single chars). */
export function recolor(p, map) {
  const o = clone(p);
  const m = new Map(Object.entries(map).map(([a, b]) => [a.charCodeAt(0), b.charCodeAt(0)]));
  for (let i = 0; i < o.d.length; i++) { const r = m.get(o.d[i]); if (r !== undefined) o.d[i] = r; }
  return o;
}

/** Every opaque pixel becomes `key` (hurt flash, silhouette). */
export function solid(p, key) {
  const o = clone(p), k = key.charCodeAt(0);
  for (let i = 0; i < o.d.length; i++) if (o.d[i]) o.d[i] = k;
  return o;
}

/** Lossless quarter turn (clockwise when `cw`); the result is h×w. */
export function rotate90(p, cw = true) {
  const o = makePix(p.h, p.w);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const k = p.d[y * p.w + x];
    if (!k) continue;
    if (cw) o.d[x * o.w + (p.h - 1 - y)] = k; else o.d[(p.w - 1 - x) * o.w + y] = k;
  }
  return o;
}

/** Shift a Pix by (dx,dy) inside its own bounds (pixels falling off are dropped). */
export function shift(p, dx, dy) { const o = makePix(p.w, p.h); blit(o, p, dx, dy); return o; }

/**
 * Selective outline: wraps every opaque pixel with `key` on transparent 4-neighbours, except on
 * edges that face the light (`lit` = {x,y} direction toward the light, e.g. {x:-1,y:-1}) where
 * `litKey` is used instead (or nothing when litKey is null) — the classic "outline lost on the
 * lit edge". Pixels already holding an outline are left alone.
 */
export function outline(p, key = '#', { lit = null, litKey = null, keys = null } = {}) {
  const o = clone(p), k = key.charCodeAt(0), lk = litKey ? litKey.charCodeAt(0) : 0;
  const isOutline = (c) => c === k || (keys && keys.includes(String.fromCharCode(c)));
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (p.d[y * p.w + x]) continue;
    let ex = 0, ey = 0, any = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = getPx(p, x + dx, y + dy);
      if (c && !isOutline(c)) { any = true; ex -= dx; ey -= dy; }
    }
    if (!any) continue;
    let use = k;
    if (lit) { const facing = ex * lit.x + ey * lit.y; if (facing > 0) use = lk; }
    if (use) o.d[y * p.w + x] = use;
  }
  return o;
}

/**
 * THE HOUSE INK PASS — run this on a FINISHED frame, after everything has been composed.
 *
 * `outline()` alone cannot hold the law once parts are layered: each part arrives carrying its own
 * ring, so where two of them meet the coat lands twice (a 2-px line down the join), where a third
 * covers a ring the coat is lost entirely (the hero's sword arm, the demon's left arm), and the
 * lit-edge softening was decided on the PART's silhouette, not the figure's. This pass fixes all
 * three in one place:
 *
 *   1. PEEL   every coat but the first. An ink pixel that touches empty space but has no fill in
 *             its 8-neighbourhood is not holding an edge — it is a second coat, and it goes.
 *   2. COAT   `outline()` lays exactly one pixel of ink around whatever fill is still bare.
 *   3. RE-KEY every ink pixel on the finished silhouette against the FIGURE's own normal: `key`
 *             everywhere, softening to `litKey` only on the edges that face `lit`.
 *
 * The result is the law in style.js: exactly 1 px of INK all the way round, INK_LIT on the
 * top-left facing edges, never absent, never doubled, never a second colour. Ink INSIDE the
 * silhouette (the line between a head and the shoulder behind it, the hollow of an open hood) is
 * not touched — it is drawing, not outline.
 *
 * @param {Pix} p
 * @param {{key?:string, litKey?:string, lit?:{x:number,y:number}|null, inkKeys?:string}} [o]
 *   `inkKeys` names any extra keys the art used as outline (legacy per-file inks) so they are
 *   peeled and re-keyed with the rest.
 * @returns {Pix} a new Pix
 */
export function houseOutline(p, { key = '#', litKey = null, lit = null, inkKeys = null } = {}) {
  const k = key.charCodeAt(0), lk = litKey ? litKey.charCodeAt(0) : 0;
  const inks = new Set([k, lk, ...(inkKeys ? [...inkKeys].map((c) => c.charCodeAt(0)) : [])].filter(Boolean));
  const o = clone(p);
  // 1. peel every coat but the first.
  //
  // THE TEST HAS TO BE THE EXACT COMPLEMENT OF `outline()`, OR THE HALO SURVIVES. `outline()` lays
  // ink on an empty pixel only when a fill sits ORTHOGONALLY beside it, so an ink pixel with no
  // orthogonal fill neighbour is, by definition, a pixel the one true coat would never occupy: it
  // is a second coat and it goes. This test used to accept a DIAGONAL fill neighbour as proof of
  // "holding an edge", which is why every shallow diagonal in the cast shipped two texels thick —
  // the werebear's shoulder and the barbarian's mane and axe arm wore a 2-texel lavender halo
  // (INK_LIT is a light violet: doubled, it stops reading as a line and starts reading as a rim
  // light nobody drew). Peeling can never expose bare fill, because a pixel with no orthogonal
  // fill neighbour is covering none; step 2 then re-lays the single coat.
  for (let pass = 0; pass < 6; pass++) {
    const snap = new Uint16Array(o.d);
    const at = (x, y) => (x < 0 || y < 0 || x >= o.w || y >= o.h ? 0 : snap[y * o.w + x]);
    let peeled = 0;
    for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) {
      const i = y * o.w + x;
      if (!inks.has(snap[i])) continue;
      let open = false, fill = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = at(x + dx, y + dy);
        if (!c) open = true; else if (!inks.has(c)) fill = true;
      }
      if (open && !fill) { o.d[i] = 0; peeled++; }
    }
    if (!peeled) break;
  }
  // 2. one fresh coat wherever fill is still bare.
  // `outline()` must be told that `litKey` is INK TOO. It only knows the keys it is handed, and
  // handed just '#' it treats every softened lit-edge pixel as FILL and dutifully wraps a second
  // coat around it — which is where the cast's 2-texel lavender rim came from, laid down again
  // immediately after the peel above had taken it off.
  const knownInk = `${litKey || ''}${inkKeys || ''}`;
  const coated = outline(o, key, { lit, litKey, keys: knownInk || null });
  // 3. re-key the whole coat against the finished figure's own outward normal
  const at = (x, y) => (x < 0 || y < 0 || x >= p.w || y >= p.h ? 0 : coated.d[y * p.w + x]);
  const out = clone(coated);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const i = y * p.w + x;
    if (!inks.has(coated.d[i])) continue;
    // the OUTWARD normal is the direction the empty space lies in (`outline()` measures the same
    // normal from the other side — from the hole toward the fill — hence the opposite sign there)
    let ex = 0, ey = 0, edge = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!at(x + dx, y + dy)) { edge = true; ex += dx; ey += dy; }
    }
    if (!edge) continue;                                   // interior ink is drawing, leave it
    out.d[i] = lit && lk && (ex * lit.x + ey * lit.y) > 0 ? lk : k;
  }
  return out;
}

/**
 * THE SEAM PASS — the other half of the ink law, run on a FINISHED frame right after
 * `houseOutline`: INK IS THE OUTER CONTOUR AND NOTHING ELSE.
 *
 * `houseOutline` deliberately leaves ink INSIDE the silhouette alone, on the grounds that it is
 * drawing rather than outline. That was half true and it cost the cast dearly. A pixel of INK
 * (luminance 0.08 — the darkest tone the style law allows anywhere) sitting inside a lit garment is
 * not a line, it is a HOLE: at the playing camera the grading pass crushes it to black while the
 * plate around it reads at 0.4, so the hero shipped with pure-black blocks punched through his
 * neck, his belt, both faulds and the full length of the leg gap, and the barbarian wore a black
 * bar across the collarbone and black rings round both arms. A seam between two planes of the SAME
 * garment is a step down that garment's own ramp — never the silhouette ink.
 *
 * So: every ink pixel with no transparent 4-neighbour (i.e. one that holds no part of the outer
 * contour) is re-keyed ONE STEP BELOW the darker of the two planes it separates, in whichever
 * material it is cutting through, measured from its own 8-neighbourhood — a local crease, not the
 * bottom of the ramp. Ink that touches air is untouched, which is why this can never eat the
 * silhouette; hollows that genuinely read as holes in a body (an eye socket, an open maw, the
 * inside of a hood) are painted with their own key — style.js `INK_DEEP` — and are not ink, so
 * they are not touched either.
 *
 * @param {Pix} p a finished frame (outline already laid)
 * @param {{ramps?:string[], inkKeys?:string, drop?:Object<string,number>, keep?:string}} [o]
 *   `ramps`: each material's keys DARKEST FIRST ('123' skin, '7456' cloth, …) — the same strings
 *   the palette was built from. `drop`: how many steps BELOW the darkest neighbouring tone of that
 *   material the seam lands (1 = one step, the house default); where the ramp has no step left the
 *   ink stays, so a form painted at the bottom of its own curve keeps its separation. `keep`: ink
 *   pixels whose neighbourhood is dominated by one of these keys are left alone.
 * @returns {Pix} a new Pix
 */
export function seamInk(p, { ramps = [], inkKeys = '#@', drop = { '#': 1, '@': 1 }, keep = '' } = {}) {
  if (!ramps.length) return p;
  const inks = new Set([...inkKeys].map((c) => c.charCodeAt(0)));
  const held = new Set([...keep].map((c) => c.charCodeAt(0)));
  /** key code -> [material index, step within that material] */
  const owner = new Map();
  ramps.forEach((keys, m) => { [...keys].forEach((c, i) => { if (!owner.has(c.charCodeAt(0))) owner.set(c.charCodeAt(0), [m, i]); }); });
  const out = clone(p);
  const at = (x, y) => (x < 0 || y < 0 || x >= p.w || y >= p.h ? 0 : p.d[y * p.w + x]);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const i = y * p.w + x, c = p.d[i];
    if (!inks.has(c)) continue;
    // any transparent orthogonal neighbour means this pixel is holding the outer contour
    if (!at(x + 1, y) || !at(x - 1, y) || !at(x, y + 1) || !at(x, y - 1)) continue;
    const votes = new Map(), lowest = new Map();
    let held9 = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const n = at(x + dx, y + dy);
      if (held.has(n)) { held9++; continue; }
      const o = owner.get(n);
      if (!o) continue;
      votes.set(o[0], (votes.get(o[0]) || 0) + (dx && dy ? 1 : 2));   // orthogonal neighbours count double
      const lo = lowest.get(o[0]);
      if (lo === undefined || o[1] < lo) lowest.set(o[0], o[1]);
    }
    if (!votes.size || held9 > 4) continue;
    // A seam is one step BELOW the darker of the two planes it separates — a local crease, not the
    // bottom of the ramp, which is what keeps a lit garment lit. A material whose darkest tone is
    // already sitting against this pixel has no step left to give, so it is not eligible and the
    // seam is taken from the next material that voted; when NONE of them has room the ink stays,
    // and that is the sheet saying this form is painted too low to hold a seam at all — flattening
    // it mechanically would merge two limbs into one silhouette.
    const fall = drop[String.fromCharCode(c)] ?? 1;
    let best = -1, bestN = -1, bestStep = 0;
    for (const [m, n] of votes) {
      const step = lowest.get(m) - fall;
      if (step < 0) continue;
      if (n > bestN || (n === bestN && m < best)) { best = m; bestN = n; bestStep = step; }
    }
    if (best < 0) continue;
    out.d[i] = ramps[best].charCodeAt(bestStep);
  }
  return out;
}

/**
 * THE HOUSE KEY LIGHT, applied to a hand-drawn block: re-shade every pixel already holding one of
 * `keys` (darkest first) as if the form were turning under one light at `lit` (top-left).
 *
 * WHY IT IS NOT A LAMBERT SPHERE. The obvious implementation — normalise each row across its own
 * span and add `sqrt(1 - r²)` for the dome — is exactly how pillow shading happens: that term peaks
 * at the middle of EVERY ROW, so the highlight runs down the centre of the form and the shadow
 * rings the outside, left edge as dark as right. style.js bans it and it was still in the cast (the
 * hoods, the troll's arm). Here the normal is taken across the WHOLE region (`nx`, `ny` from its
 * bounding box), the dome term is small, and the terminator is a plane: the highlight lands on the
 * upper-left third, the core shadow on the lower-right third.
 *
 * `rim` then adds the one thing a plane terminator cannot: a single pixel of REFLECTED LIGHT along
 * the bottom-right silhouette edge — one step up the ramp, never more, so the form turns away from
 * the light and is still lifted off the floor behind it.
 *
 * @param {Pix} p @param {string} keys the material's ramp keys, DARKEST FIRST
 * @param {{lit?:{x:number,y:number}, gain?:number, mid?:number, up?:number, bias?:number,
 *   dome?:number, rim?:boolean, local?:number}} [o]
 *   gain = terminator contrast · mid = where the unlit normal sits on the ramp · up = how much of
 *   the light's vertical component this form takes (a column takes less than a head) ·
 *   local = how much of the cross-form normal is measured per row rather than across the region
 *   (0 for a flat panel, up to ~0.5 for something that really does taper) · dome ≤ 0.2.
 * @returns {Pix} a new Pix
 */
export function keyShade(p, keys, o = {}) {
  const ks = [...keys], set = new Set(ks.map((c) => c.charCodeAt(0)));
  const lit = o.lit || { x: -1, y: -1 };
  const gain = o.gain ?? 0.62, mid = o.mid ?? 0.50, up = o.up ?? 0.62, bias = o.bias ?? 0;
  const dome = Math.min(0.2, o.dome ?? 0.10), local = o.local ?? 0.3;
  let x0 = p.w, x1 = -1, y0 = p.h, y1 = -1;
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (!set.has(p.d[y * p.w + x])) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (y1 < 0) return p;
  const out = { w: p.w, h: p.h, d: new Uint16Array(p.d) };
  const gcx = (x0 + x1 + 1) / 2, grx = Math.max(1, (x1 - x0 + 1) / 2);
  const cy = (y0 + y1 + 1) / 2, ry = Math.max(1, (y1 - y0 + 1) / 2);
  const L = Math.hypot(lit.x, lit.y) || 1, lx = lit.x / L, ly = lit.y / L;
  for (let y = y0; y <= y1; y++) {
    let rx0 = p.w, rx1 = -1;
    for (let x = 0; x < p.w; x++) if (set.has(p.d[y * p.w + x])) { if (x < rx0) rx0 = x; if (x > rx1) rx1 = x; }
    if (rx1 < 0) continue;
    const lcx = (rx0 + rx1 + 1) / 2, lrx = Math.max(1, (rx1 - rx0 + 1) / 2);
    for (let x = rx0; x <= rx1; x++) {
      if (!set.has(p.d[y * p.w + x])) continue;
      // the form's normal, measured across the WHOLE region (a plane terminator), with only a
      // little of the row's own taper mixed in
      const nx = (1 - local) * ((x + 0.5 - gcx) / grx) + local * ((x + 0.5 - lcx) / lrx);
      const ny = ((y + 0.5 - cy) / ry) * up;
      const r2 = Math.min(1, nx * nx + ny * ny);
      let t = (nx * lx + ny * ly) * gain + Math.sqrt(1 - r2) * dome + mid + bias;
      // reflected light: one step up the ramp on the single pixel of bottom-right silhouette
      if (o.rim !== false) {
        const outR = !set.has(p.d[y * p.w + x + 1]) && (x + 1 > rx1);
        const outD = y + 1 > y1 || !set.has(p.d[(y + 1) * p.w + x]);
        if ((outR || outD) && (nx * lx + ny * ly) < -0.15) t += 0.9 / ks.length;
      }
      t = t < 0 ? 0 : t > 0.999 ? 0.999 : t;
      out.d[y * p.w + x] = ks[(t * ks.length) | 0].charCodeAt(0);
    }
  }
  return out;
}

/**
 * PLANT A FOOT. The last three rows of every biped in the game, drawn once: the boot, then a SOLE
 * one step darker running the full width with a toe pushed forward, and the ink shadow the house
 * outline pass then lays under it. Nothing this touches can end in a straight horizontal line —
 * the toe breaks the front edge and the heel breaks the back.
 *
 * @param {Pix} p @param {number} cx centre of the ankle @param {number} by the SOLE row (fill; the
 *   ink shadow lands on `by + 1`) @param {string} keys the leather/hide ramp, darkest first
 * @param {{dir?:number, w?:number, toe?:number, heel?:number, rows?:number}} [o]
 *   dir = which way the toe points (+1 screen right) · w = half-width of the boot
 */
export function footPlant(p, cx, by, keys, o = {}) {
  const ks = [...keys];
  const dark = ks[0], mid = ks[Math.min(ks.length - 1, 1)], hi = ks[ks.length - 1];
  const dir = o.dir ?? 1, w = o.w ?? 2, toe = o.toe ?? 1, heel = o.heel ?? 0, rows = o.rows ?? 2;
  for (let r = 0; r < rows; r++) {                       // the boot: square, one lit pixel top-left
    const y = by - rows + r;
    for (let x = -w; x <= w; x++) setPx(p, cx + x, y, x === -w && r === 0 ? hi : x < 0 ? mid : dark);
  }
  const x0 = cx - w - (dir < 0 ? toe : heel), x1 = cx + w + (dir > 0 ? toe : heel);
  for (let x = x0; x <= x1; x++) setPx(p, x, by - 1, x === x0 ? mid : dark);   // instep + toe box
  for (let x = x0; x <= x1; x++) setPx(p, x, by, dark);                        // the sole
  setPx(p, cx - w * dir, by - 1, mid);                                         // the heel breaks back
  return p;
}

/** Bresenham line of `key`. */
export function line(p, x0, y0, x1, y1, key) {
  const k = key.charCodeAt(0);
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
  for (;;) {
    setPx(p, x0, y0, k);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return p;
}

/**
 * Sword-smear arc: a crescent between radii r0..r1 over angles a0..a1 (radians, screen space, y down),
 * shaded `keys` from the trailing edge (first key) to the leading edge (last key).
 */
export function smearArc(p, cx, cy, r0, r1, a0, a1, keys) {
  const n = keys.length;
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const r = Math.hypot(dx, dy);
    if (r < r0 || r > r1) continue;
    let a = Math.atan2(dy, dx);
    let t = (a - a0) / (a1 - a0);
    if (t < 0 || t > 1) { a += a > 0 ? -Math.PI * 2 : Math.PI * 2; t = (a - a0) / (a1 - a0); }
    if (t < 0 || t > 1) continue;
    const i = Math.min(n - 1, Math.floor(t * n));
    // a thin crescent hugging the outer radius, tapering to a point at the trailing end
    let thick = Math.max(1, (r1 - r0) * (0.15 + 0.85 * t));
    if (t > 0.78) thick = Math.max(1, thick * (1 - (t - 0.78) / 0.22 * 0.75)); // and back to a point at the tip
    if (r < r1 - thick) continue;
    setPx(p, x, y, keys[i]);
  }
  return p;
}

/** Tight bounding box of opaque pixels, or null. */
export function bounds(p) {
  let x0 = p.w, y0 = p.h, x1 = -1, y1 = -1;
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.d[y * p.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Resolve keys to RGBA bytes (row 0 = top). Unknown keys come out magenta so they are noticed. */
export function toRGBA(p, palette) {
  const out = new Uint8ClampedArray(p.w * p.h * 4);
  const cache = new Map();
  for (let i = 0; i < p.d.length; i++) {
    const k = p.d[i];
    if (!k) continue;
    let c = cache.get(k);
    if (!c) { c = palette.get(String.fromCharCode(k)); cache.set(k, c); }
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
  }
  return out;
}

/** Count the distinct keys used (palette discipline check). */
export function usedKeys(p) { const s = new Set(); for (const k of p.d) if (k) s.add(String.fromCharCode(k)); return [...s].sort(); }

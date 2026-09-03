// style: THE HOUSE STYLE LAW for every hand-pixelled character in the game — hero and all 22
// monsters. One ink, one key light, one ramp builder, one set of gamut limits, one scale table.
// Everything here is pure data + pure functions (no THREE, no DOM), so the art files, the renderer
// and `node --test` all read the same numbers.
//
// WHY THIS FILE EXISTS
// Five monster group files each declared their own "near-black violet" outline (#1b1426, #181121,
// #17111f, #161020, #150f1e), their own ramp steps and their own idea of how big a creature is.
// Five slightly different inks is five slightly different games. From here on there is ONE:
//
//     import { INK, INK_LIT, LIT, ramp } from '../style.js';
//     const hide = ramp('#7c8752', 5);                  // 5 hue-shifted steps, darkest first
//     const pal = new Palette().set('#', INK).set('@', INK_LIT);
//     [...'12345'].forEach((k, i) => pal.set(k, hide[i]));
//     const art = outline(compose(...), '#', { lit: LIT, litKey: '@' });
//
// Group files are still migrating (other agents own them), so `lint()` accepts any ink within
// `INK_TOL` of INK — which covers all five legacy values and nothing else — and reports anything
// further out as a violation. New art must use INK itself.
//
// THE LAW, in one paragraph: hand-pixelled 2D sprites billboarded in a lit 3D diorama. Colour comes
// from hue-shifted ramps (shadows drift cooler / toward violet and gain saturation, highlights drift
// warmer / toward amber and lose a little) — never a flat darken/lighten. One dark, non-black ink
// outline of exactly one pixel, softened on the edges that face the light. The key light is TOP-LEFT
// on every facing, every frame, every creature. Clean silhouettes; no pillow shading; no banding; no
// dithering except where a form is deliberately dissolving. Nothing is painted at a fluorescent
// chroma, nothing outshines the torches, and nothing collapses into the bottom of its own ramp.
import { toRgb, rgbToHsl, hslToRgb } from './pixelPainter.js';

// ------------------------------------------------------------------------------------ the ink
/**
 * THE outline colour for the whole cast: a near-black violet, never pure black. It is the darkest
 * value that may appear in any sprite, and it appears only as the one-pixel silhouette outline (and
 * the hollows that read as holes in a body: an open hood, a maw).
 */
export const INK = '#17111f';

/**
 * How far (Euclidean RGB distance, 0-441) a sheet's measured outline may sit from `INK` before
 * `lint()` calls it a violation. The five legacy inks are all within 9 of INK; a pure black (#000)
 * is 32 away and a warm brown ink is further still. New art must use INK exactly.
 */
export const INK_TOL = 12;

/** The lit-edge colour the outline softens to on light-facing edges (`outline(..., {litKey})`). */
export const INK_LIT = '#4e4459';

// ------------------------------------------------------------------------------------ the light
/**
 * THE key-light direction, in sprite/screen space with y pointing DOWN: {x:-1, y:-1} is up-and-left.
 * Every facing of every creature is lit from here — south, east and north rows alike — which is what
 * makes a rank of monsters read as one cast standing in one room instead of a sticker album.
 * `pixelPainter.outline(p, '#', { lit: LIT, litKey: '@' })` takes it directly.
 */
export const LIT = { x: -1, y: -1 };

// ------------------------------------------------------------------------------------ the gamut
/**
 * Maximum chroma of any tone that covers a real area of a creature (>= `AREA_MIN` of its body
 * pixels). Chroma here is `(max-min)/255` weighted toward the lights, because a hot colour hurts
 * most when it is also bright: a mid-grey-green is scenery, a fluorescent #3a3 slime is a bug.
 * A creature may carry a hot accent (the Rogue's gold, 0.56); it may not BE one — hence the second,
 * tighter limit on the body AVERAGE, `CHROMA_CEIL * CHROMA_MEAN_FRACTION`.
 */
export const CHROMA_CEIL = 0.60;
/** The body-average chroma limit, as a fraction of `CHROMA_CEIL` (the hottest shipping creature, the Barbarian, sits at 0.213). */
export const CHROMA_MEAN_FRACTION = 0.40;

/**
 * Maximum luminance (0-1) of any tone covering a real area. The torches are the brightest thing in
 * the dungeon; a highlight brighter than them makes a sprite look like a cut-out lit by nothing.
 * Tiny catch-lights (under `AREA_MIN` coverage) and pixels flagged emissive are exempt — they are
 * the sparkle, not the paint.
 */
export const VALUE_CEIL = 0.92;

/**
 * Minimum MEDIAN luminance of a creature's body. Below this the figure has collapsed into the
 * bottom two steps of its own ramp and reads as a hole in the floor rather than a creature. (The
 * darkest shipping sprites — the Dimension Spider at 0.25, the Assassin at 0.29 — clear this by a
 * hair; `READ_THROUGH_TARGET` below is the level the cast should be redrawn to.)
 */
export const VALUE_FLOOR = 0.22;

/** A ramp must actually run light to dark: min luminance spread from a sheet's darkest to its brightest area tone. */
export const VALUE_RANGE_MIN = 0.30;
/** The house target for that spread (a 5-7 step ramp drawn properly lands here). */
export const VALUE_RANGE_TARGET = 0.55;

/** Fewest distinct fill tones (ink excluded) a character sheet may use — a 5-step ramp, minimum. */
export const RAMP_MIN_STEPS = 5;
/** Most steps a single ramp should hold: past 7 the eye stops reading steps and starts reading mush. */
export const RAMP_MAX_STEPS = 7;

/**
 * Minimum "rim delta": mean luminance of the silhouette pixels whose outward normal faces `LIT`,
 * minus the mean of those facing away. Positive means the art is lit from the top-left; negative
 * means it is lit from the wrong side. The whole shipping cast sits between 0.03 and 0.21.
 */
export const KEY_LIGHT_MIN = 0.02;

/** Fraction of a sprite's pixels that must sit in the upper half of its own value range (warning-level house target). */
export const READ_THROUGH_TARGET = 0.15;

/** Coverage (fraction of body pixels) at which a tone stops being a sparkle and starts being paint. */
export const AREA_MIN = 0.03;

/** Clips that are not colour-graded art and are skipped by `lint()` (the hurt clip is a deliberate white flash). */
export const LINT_SKIP_ANIMS = ['hurt'];

// ------------------------------------------------------------------------------------ the ramp
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
/** Rec.601 luminance of an [r,g,b] triple, 0-1. */
export const luminance = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
/** House chroma: distance from grey, weighted toward the lights (see `CHROMA_CEIL`). */
export const chroma = (c) => ((Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])) / 255) * (0.55 + 0.45 * luminance(c));
/** '#rrggbb' from an [r,g,b] triple. */
export const hex = (c) => `#${c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
/** Shortest signed hue distance (0..1 wrap). */
const hueDelta = (from, to) => { let d = to - from; while (d > 0.5) d -= 1; while (d < -0.5) d += 1; return d; };

/** Hue the shadows drift toward (violet) and the hue the highlights drift toward (amber). */
export const SHADOW_HUE = 0.72, LIGHT_HUE = 0.115;

/**
 * Which way round the wheel a shadow cools. Between amber and violet (yellow, green, cyan, blue)
 * the cool way is UP the wheel; everywhere else (magenta, red, orange) it is the short way round
 * through magenta. Taking the plain shortest path would send an olive creature's shadows through
 * ORANGE, which is the opposite of cooling — that is the classic hue-shift mistake.
 */
const shadowDelta = (h) => (h > LIGHT_HUE && h < SHADOW_HUE ? SHADOW_HUE - h : hueDelta(h, SHADOW_HUE));

/**
 * Build THE house ramp for a base colour: 5-7 hue-shifted steps, darkest first, ready to hand to
 * `Palette.ramp` keys or `Palette.set` one at a time.
 *
 *   ramp('#7c8752', 4)  ->  throws  (four steps is not a ramp, it is a gradient)
 *   ramp('#7c8752')     ->  ['#173b22', '#416a34', '#869259', '#a6aa8d', '#c4c4bf']
 *
 * Shadows drift toward `SHADOW_HUE` and gain saturation; highlights drift toward `LIGHT_HUE` and
 * lose a little. The band is then WIDENED until the darkest and lightest steps really are
 * `VALUE_RANGE_TARGET` apart in luminance — widening upward first, because the one thing a ramp may
 * never do is sink into the ink: the darkest step is held above `RAMP_FLOOR_L` so the bottom of the
 * ramp still reads as a colour and not as a hole. Every step is finally clamped into the house
 * gamut (`VALUE_CEIL`, `CHROMA_CEIL`).
 *
 * @param {string|number} base the mid tone, '#rrggbb' or 0xrrggbb
 * @param {number} [steps] 5-7
 * @param {{mid?:number, step?:number, hueShift?:number, satShift?:number, range?:number}} [o]
 * @returns {string[]} hex strings, darkest first
 */
export function ramp(base, steps = 5, o = {}) {
  if (!Number.isInteger(steps) || steps < RAMP_MIN_STEPS || steps > RAMP_MAX_STEPS) {
    throw new RangeError(`ramp(): steps must be ${RAMP_MIN_STEPS}-${RAMP_MAX_STEPS}, got ${steps}`);
  }
  const hueShift = o.hueShift ?? 0.055, satShift = o.satShift ?? 0.10;
  const wantRange = o.range ?? VALUE_RANGE_TARGET;
  const [h, s, l] = rgbToHsl(toRgb(base));
  const mid = o.mid ?? Math.floor((steps - 1) / 2);
  let spread = (o.step ?? 0.115) * (steps - 1);
  let out = [];
  for (let attempt = 0; attempt < 24; attempt++) {
    // the band of HSL lightness the ramp occupies: the base sits at its `mid` step, shadows fall a
    // little faster than highlights rise (the lit side of a form is the narrow band)
    let lo = l - spread * (mid / (steps - 1)) * 1.12;
    let hi = l + spread * ((steps - 1 - mid) / (steps - 1)) * 0.9;
    if (lo < RAMP_FLOOR_L) { hi += (RAMP_FLOOR_L - lo) * 0.75; lo = RAMP_FLOOR_L; }
    if (hi > RAMP_CEIL_L) { lo = Math.max(RAMP_FLOOR_L, lo - (hi - RAMP_CEIL_L) * 0.5); hi = RAMP_CEIL_L; }
    out = [];
    for (let i = 0; i < steps; i++) {
      const k = i - mid;                                   // negative = darker than the base
      const drift = k < 0 ? shadowDelta(h) : hueDelta(h, LIGHT_HUE);
      const hh = h + drift * Math.min(1, Math.abs(k) * hueShift * 3.2);
      const ss = clamp01(s + (k < 0 ? 1 : -1) * Math.abs(k) * satShift * (s > 0.08 ? 1 : 0));
      const ll = lo + (hi - lo) * (i / (steps - 1));
      out.push(gamut(hslToRgb([hh, ss, ll])));
    }
    const range = luminance(out[out.length - 1]) - luminance(out[0]);
    if (range >= wantRange || spread > 1.4) break;
    spread *= 1.1;
  }
  return out.map(hex);
}

/** The HSL-lightness band a house ramp lives in: never down into the ink, never up past the torches. */
export const RAMP_FLOOR_L = 0.16, RAMP_CEIL_L = 0.86;

/** Pull one colour into the house gamut: never brighter than the torches, never fluorescent. */
function gamut(c) {
  let [r, g, b] = c;
  const l = luminance([r, g, b]);
  if (l > VALUE_CEIL) { const k = VALUE_CEIL / l; r *= k; g *= k; b *= k; }
  const ch = chroma([r, g, b]);
  if (ch > CHROMA_CEIL) {
    const grey = luminance([r, g, b]) * 255, k = CHROMA_CEIL / ch;
    r = grey + (r - grey) * k; g = grey + (g - grey) * k; b = grey + (b - grey) * k;
  }
  return [Math.round(clamp(r, 0, 255)), Math.round(clamp(g, 0, 255)), Math.round(clamp(b, 0, 255))];
}

// ------------------------------------------------------------------------------------ the scale
/**
 * Height of the hero's figure in texels (heroSprite.js: a 48x48 canvas with the body filling 46
 * rows). Every other creature's on-screen size is derived from this, so 1.0 in `SCALE` below is
 * exactly "as tall as the hero".
 */
export const HERO_FIGURE_PX = 46;

/**
 * RELATIVE ON-SCREEN HEIGHT of every one of the 22 shipping monsters, hero = 1.0. This is the size
 * hierarchy of the whole game, in one table: a player must be able to read danger from silhouette
 * size alone, across a lit room, before any name or health bar.
 *
 *   0.7 - 0.9   vermin and small things       dire wolf, dimension spider, rogue, dwarven guard
 *   0.9 - 1.0   ordinary humans               monk, mercenary, swordsman, ranger, assassin, mage
 *   1.0         THE HERO
 *   1.1 - 1.35  heavies                       barbarian, dark warrior, gargoyle, wyvern
 *   1.45 - 1.7  the loomers                   werebear, ogre, troll
 *   1.6 - 2.2   the apex                      fyre drake, war lord, demon, shadow dragon
 *
 * The Ogre used to be 1.35x the hero and the Demon was hero-height; a monster whose whole identity
 * is "it is enormous" has to actually be enormous. The Fyre Drake is the one deliberate exception to
 * "bigger number = scarier": it is a low, sprawling salamander whose mass is length, not height.
 */
export const SCALE = {
  // vermin and small things
  'dire-wolf': 0.72,          // low quadruped: shoulder-height on a man
  'dimension-spider': 0.86,   // crouched wide, never tall
  'rogue': 0.86,              // small and hunched, the smallest human
  'dwarven-guard': 0.84,      // short and broad
  // ordinary humans — all below the hero, who is the one the camera follows
  'hobgoblin': 0.90,
  'monk': 0.92,
  'assassin': 0.94,
  'mercenary': 0.95,
  'elvin-ranger': 0.96,
  'swordsman': 0.97,
  'mage': 0.98,
  // heavies
  'barbarian': 1.12,
  'dark-warrior': 1.18,
  'gargoyle': 1.22,
  'wyvern': 1.32,
  // the loomers
  'werebear': 1.48,
  'ogre': 1.58,
  'troll': 1.66,
  // the apex
  'war-lord': 1.70,
  'fyre-drake': 1.60,         // long, not tall — its bulk runs along the floor
  'demon': 1.95,
  'shadow-dragon': 2.20,
};

/** The hero's own entry, so `SCALE` can be read for any character view. */
export const HERO_SCALE = 1.0;

/**
 * How far a sprite's texel density may stray from the hero's when its art is drawn at the wrong
 * size for its `SCALE`. A sprite needing a multiplier outside this band is a request to REDRAW it on
 * a bigger (or smaller) canvas — blowing 16px of spider up to three times the hero's texel size is
 * a stopgap, not the house look. The clamp keeps the hierarchy readable in the meantime.
 */
export const DENSITY_MIN = 0.6, DENSITY_MAX = 2.2;

/**
 * The billboard scale multiplier for a creature: how much bigger than 1 texel = 1/32 tile this
 * sprite must be drawn so its figure lands at `SCALE[type]` times the hero's height.
 * @param {string} type monster type (or 'player')
 * @param {number} figurePx the creature's figure height in texels (see `measureFigure`)
 * @returns {number}
 */
export function sizeFor(type, figurePx) {
  const want = type === 'player' ? HERO_SCALE : (SCALE[type] ?? 1);
  if (!(figurePx > 0)) return want;
  return clamp((want * HERO_FIGURE_PX) / figurePx, DENSITY_MIN, DENSITY_MAX);
}

/**
 * The figure height of a packed sheet, in texels: how far the drawn body rises above the pivot row
 * on its idle frames. Weapons held overhead inflate it a little, which is fine — that is what the
 * silhouette really occupies on screen.
 * @param {import('./spriteSheet.js').Sheet} sheet
 * @param {{anim?:string, facing?:string}} [o]
 * @returns {number}
 */
export function measureFigure(sheet, { anim = 'idle', facing = 'S' } = {}) {
  const W = sheet.width, D = sheet.data;
  let best = 0;
  for (const fr of sheet.frames) {
    if (fr.name !== anim || (facing && fr.facing !== facing)) continue;
    for (let y = 0; y < fr.h; y++) {
      let row = false;
      for (let x = 0; x < fr.w && !row; x++) if (D[((fr.y + y) * W + fr.x + x) * 4 + 3]) row = true;
      if (row) { best = Math.max(best, fr.py - y); break; }
    }
  }
  return best || HERO_FIGURE_PX;
}

// ------------------------------------------------------------------------------------ the depth tint
/**
 * How much of the renderer's per-depth colour grade a character sprite is allowed to take. The
 * dungeon's depth bands push the whole frame green at depth 18 and violet at depth 19+, which is
 * exactly right for stone and air and exactly wrong for a creature: species identity must not change
 * with the floor you meet it on. 1.0 would cancel the depth grade on characters entirely and float
 * them off the background; 0 is the old bug. 0.78 keeps a Shadow Dragon violet everywhere while the
 * room around it still turns.
 */
export const DEPTH_TINT_CLAMP = 0.78;

// ------------------------------------------------------------------------------------ the lint
/**
 * @typedef {{rule:string, severity:'error'|'warning', detail:string, value:number, limit:number}} Violation
 */

/**
 * Measure a packed sheet: the ink it actually used, its tone histogram and its key-light direction.
 * Pure analysis, no judgement — `lint()` turns this into violations.
 * @param {import('./spriteSheet.js').Sheet} sheet
 * @param {{skipAnims?:string[]}} [o]
 */
export function analyseSheet(sheet, { skipAnims = LINT_SKIP_ANIMS } = {}) {
  const W = sheet.width, D = sheet.data;
  const at = (x, y) => { const i = (y * W + x) * 4; return D[i + 3] ? [D[i], D[i + 1], D[i + 2], D[i + 3]] : null; };
  const counts = new Map(), edges = new Map(), emissive = new Set();
  let litSum = 0, litN = 0, awaySum = 0, awayN = 0, pixels = 0;
  for (const fr of sheet.frames) {
    if (skipAnims.includes(fr.name)) continue;
    for (let y = 0; y < fr.h; y++) for (let x = 0; x < fr.w; x++) {
      const c = at(fr.x + x, fr.y + y);
      if (!c) continue;
      pixels++;
      const key = `${c[0]},${c[1]},${c[2]}`;
      if (c[3] < 255) emissive.add(key);            // packSheet flags emissive keys in alpha
      counts.set(key, (counts.get(key) || 0) + 1);
      // outward normal: which way the transparent neighbours lie
      let nx = 0, ny = 0, edge = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const px = x + dx, py = y + dy;
        const out = px < 0 || py < 0 || px >= fr.w || py >= fr.h || !at(fr.x + px, fr.y + py);
        if (out) { edge = true; nx += dx; ny += dy; }
      }
      if (!edge) continue;
      edges.set(key, (edges.get(key) || 0) + 1);
      const facing = nx * LIT.x + ny * LIT.y, L = luminance(c);
      if (facing > 0) { litSum += L; litN++; } else if (facing < 0) { awaySum += L; awayN++; }
    }
  }
  if (!pixels) return null;
  const inkKey = [...edges.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const ink = inkKey.split(',').map(Number);
  const fills = [...counts.entries()].filter(([k]) => k !== inkKey && !emissive.has(k));
  const total = fills.reduce((s, [, n]) => s + n, 0) || 1;
  const tones = fills.map(([k, n]) => {
    const c = k.split(',').map(Number);
    return { rgb: c, hex: hex(c), n, coverage: n / total, lum: luminance(c), chroma: chroma(c) };
  }).sort((a, b) => a.lum - b.lum);
  const area = tones.filter((t) => t.coverage >= AREA_MIN);
  let acc = 0, median = 0;
  for (const t of tones) { acc += t.n; if (acc >= total / 2) { median = t.lum; break; } }
  const maxLum = area.length ? Math.max(...area.map((t) => t.lum)) : tones[tones.length - 1].lum;
  const minLum = tones[0].lum;
  const cut = minLum + (maxLum - minLum) * 0.5;
  const readThrough = tones.reduce((s, t) => s + (t.lum >= cut ? t.n : 0), 0) / total;
  return {
    ink, inkHex: hex(ink), tones, area, steps: tones.length, median, minLum, maxLum,
    range: maxLum - minLum, readThrough,
    peakChroma: area.length ? Math.max(...area.map((t) => t.chroma)) : 0,
    meanChroma: tones.reduce((s, t) => s + t.chroma * t.coverage, 0),
    keyLight: (litN ? litSum / litN : 0) - (awayN ? awaySum / awayN : 0),
    figurePx: measureFigure(sheet),
  };
}

/** Euclidean RGB distance. */
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Judge a packed sheet against the house style. Returns every violation it finds, most severe
 * first; an empty array means the art is inside the law.
 *
 * Severities: 'error' is a rule no sprite may ship breaking (the test suite fails on these).
 * 'warning' is a house target the current cast has not all reached yet — read them, they are the
 * list of sprites that still need another pass.
 *
 * @param {import('./spriteSheet.js').Sheet} sheet a packSheet() result
 * @param {{type?:string, name?:string, skipAnims?:string[]}} [meta]
 * @returns {Violation[]}
 */
export function lint(sheet, meta = {}) {
  const a = analyseSheet(sheet, { skipAnims: meta.skipAnims || LINT_SKIP_ANIMS });
  const v = [];
  const who = meta.name || meta.type || 'sprite';
  if (!a) return [{ rule: 'empty', severity: 'error', detail: `${who}: sheet has no opaque pixels`, value: 0, limit: 1 }];
  const inkOff = dist(a.ink, toRgb(INK));
  if (inkOff > INK_TOL) {
    v.push({ rule: 'ink', severity: 'error', value: +inkOff.toFixed(1), limit: INK_TOL,
      detail: `${who}: outlined in ${a.inkHex}, house ink is ${INK} (off by ${inkOff.toFixed(1)}, tolerance ${INK_TOL})` });
  }
  if (a.steps < RAMP_MIN_STEPS) {
    v.push({ rule: 'ramp-steps', severity: 'error', value: a.steps, limit: RAMP_MIN_STEPS,
      detail: `${who}: only ${a.steps} fill tones — a ramp is at least ${RAMP_MIN_STEPS} steps` });
  }
  if (a.range < VALUE_RANGE_MIN) {
    v.push({ rule: 'value-range', severity: 'error', value: +a.range.toFixed(3), limit: VALUE_RANGE_MIN,
      detail: `${who}: value range ${a.range.toFixed(2)} — the ramp never gets light (min ${VALUE_RANGE_MIN})` });
  }
  if (a.maxLum > VALUE_CEIL) {
    v.push({ rule: 'value-ceil', severity: 'error', value: +a.maxLum.toFixed(3), limit: VALUE_CEIL,
      detail: `${who}: a highlight at ${a.maxLum.toFixed(2)} outshines the torches (ceiling ${VALUE_CEIL})` });
  }
  if (a.median < VALUE_FLOOR) {
    v.push({ rule: 'value-floor', severity: 'error', value: +a.median.toFixed(3), limit: VALUE_FLOOR,
      detail: `${who}: median value ${a.median.toFixed(2)} — the figure has collapsed into the bottom of its ramp (floor ${VALUE_FLOOR})` });
  }
  if (a.peakChroma > CHROMA_CEIL) {
    v.push({ rule: 'chroma-peak', severity: 'error', value: +a.peakChroma.toFixed(3), limit: CHROMA_CEIL,
      detail: `${who}: a tone at chroma ${a.peakChroma.toFixed(2)} is outside the dungeon palette (ceiling ${CHROMA_CEIL})` });
  }
  const meanCeil = +(CHROMA_CEIL * CHROMA_MEAN_FRACTION).toFixed(3);
  if (a.meanChroma > meanCeil) {
    v.push({ rule: 'chroma-mean', severity: 'error', value: +a.meanChroma.toFixed(3), limit: meanCeil,
      detail: `${who}: body averages chroma ${a.meanChroma.toFixed(2)} — the whole creature is a hot accent (ceiling ${meanCeil})` });
  }
  if (a.keyLight < KEY_LIGHT_MIN) {
    v.push({ rule: 'key-light', severity: 'error', value: +a.keyLight.toFixed(3), limit: KEY_LIGHT_MIN,
      detail: `${who}: rim delta ${a.keyLight.toFixed(3)} — the key light does not agree with LIT (top-left)` });
  }
  if (a.readThrough < READ_THROUGH_TARGET) {
    v.push({ rule: 'read-through', severity: 'warning', value: +a.readThrough.toFixed(3), limit: READ_THROUGH_TARGET,
      detail: `${who}: only ${(a.readThrough * 100).toFixed(0)}% of the body is in the upper half of its value range — it will read as a hole at gameplay distance` });
  }
  if (a.range < VALUE_RANGE_TARGET) {
    v.push({ rule: 'value-spread', severity: 'warning', value: +a.range.toFixed(3), limit: VALUE_RANGE_TARGET,
      detail: `${who}: value range ${a.range.toFixed(2)} is under the house target ${VALUE_RANGE_TARGET}` });
  }
  return v.sort((x, y) => (x.severity === y.severity ? 0 : x.severity === 'error' ? -1 : 1));
}

/** Only the violations that must never ship. */
export function lintErrors(sheet, meta) { return lint(sheet, meta).filter((x) => x.severity === 'error'); }

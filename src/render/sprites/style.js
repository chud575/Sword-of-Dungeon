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
// AND THERE WAS A SECOND INK LAYER UNDER THAT ONE. Every group also kept a private near-black for
// eye sockets, hollows and voids — ten of them, all groping for the same colour. Those are now
// `INK_DEEP`, declared here with the other two, so this file defines EVERY near-black in the game
// and the three of them have three different jobs: `INK` is the outer contour, `INK_LIT` the part
// of that contour facing the light, `INK_DEEP` the holes in a body. An internal seam is none of
// the three — it is a dark step of the material's own ramp (`pixelPainter.seamInk`).
//
// THE LAW, in one paragraph: hand-pixelled 2D sprites billboarded in a lit 3D diorama. Colour comes
// from hue-shifted ramps (shadows drift cooler / toward violet and gain saturation, highlights drift
// warmer / toward amber and lose a little) — never a flat darken/lighten. One dark, non-black ink
// outline of exactly one pixel, softened on the edges that face the light. The key light is TOP-LEFT
// on every facing, every frame, every creature — and "no pillow shading" in that sentence is now a
// RULE and not a wish: `form-pillow` (see "the form check") fails a sheet whose forms are lit down
// their own middle. Clean silhouettes; no pillow shading; no banding; no
// dithering except where a form is deliberately dissolving. Nothing is painted at a fluorescent
// chroma, nothing outshines the torches, and nothing collapses into the bottom of its own ramp.
import { toRgb, rgbToHsl, hslToRgb } from './pixelPainter.js';

// ------------------------------------------------------------------------------------ the ink
/**
 * THE outline colour for the whole cast: a near-black violet, never pure black. It belongs to the
 * OUTER CONTOUR and to nothing else — one pixel of it, softened to `INK_LIT` where the edge faces
 * the light. It is not a drawing colour: a seam between two planes of one garment is a step down
 * that garment's own ramp (`pixelPainter.seamInk`), and a hollow that reads as a hole in a body —
 * an eye socket, an open hood, a maw — is `INK_DEEP` below.
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

/**
 * THE SECOND INK, DECLARED AT LAST — the one tone for every VOID in the game.
 *
 * `INK` above claims to be "the darkest value that may appear in any sprite", and for a long time
 * that was simply not true: underneath it every group file kept a private near-black of its own for
 * the holes in a body, and there were TEN of them — '#1c1526' (beasts), '#1b1424' (boss),
 * '#171020' and the voids '#170e28'/'#150b26' (caster), '#1d1526'/'#1a1425'/'#150e18'/'#1b1526'
 * (the four drakes), '#0b0812'/'#150f1c' (undead), '#191322' (humanoid + humans), '#1c1424'
 * (vermin) and the hero's eye, which was INK itself. Averaged, nine of the ten land on #181122 —
 * i.e. they were all groping for the same colour, one file at a time, and the tenth was three times
 * darker than its neighbours. That is exactly the failure the top of this file was written to stop,
 * repeated one layer down. There is now ONE:
 *
 *     import { INK, INK_LIT, INK_DEEP } from '../style.js';
 *     pal.set('#', INK).set('@', INK_LIT).set('E', INK_DEEP);   // outline · lit edge · eye socket
 *
 * WHAT IT IS FOR, and why it is not INK. An eye socket, an open maw, the inside of a hood and the
 * gap under a helm are not outline: they are places where the body is not there, and the eye has to
 * read them as BEHIND the silhouette, not on it. So `INK_DEEP` sits one clear step BELOW `INK`
 * (luminance 0.061 against 0.080, and cooler) — deep enough that a socket never reads as a stray
 * length of contour, close enough that the two never fight. It is the only tone in the game allowed
 * below the ink, it is only ever used INSIDE a silhouette, and nothing else in the cast may invent
 * another one: `lint()` measures the outline, but this is the colour a player reads as a hole.
 */
export const INK_DEEP = '#120c1c';

/**
 * EVERY near-black in the game, and there are exactly three. `lint()` used to check only the ONE
 * colour that held most of a sheet's OUTER EDGE, which meant a private near-black painted anywhere
 * else was invisible to this file: an auditor swapped all 269 of the hero's `INK_DEEP` texels for a
 * private '#0a0410' and `lint()` returned CLEAN. A rule nothing can fail is not a rule. Every tone
 * a sheet paints below `NEAR_BLACK_L` must now be one of these three, within `INK_TOL`.
 */
export const DECLARED_INKS = [INK, INK_LIT, INK_DEEP];

/**
 * The luminance below which a tone is a NEAR-BLACK — a hole, a contour or a void — and not a step
 * of some material's ramp. Above it a dark tone is paint and answers to `VALUE_FLOOR` and the ramp
 * rules; below it, it is one of `DECLARED_INKS` or it is a bug.
 *
 * 0.105 is measured, not chosen: across the hero and all 22 shipping monster sheets the darkest
 * PAINT is the Demon's '#2b1226' at 0.109 and the Assassin's '#1c163b' at 0.110, while the only
 * tones under 0.105 anywhere in the cast are INK itself (0.080) and INK_DEEP (0.061). So the line
 * sits in the gap between the game's darkest legitimate colour and its declared blacks — the five
 * legacy inks (0.087-0.095) land above INK and stay covered by `INK_TOL`, and the '#0a0410' of the
 * substitution above lands at 0.028 with nothing within 40 units of it.
 */
export const NEAR_BLACK_L = 0.105;

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

/**
 * THE INK-DISCIPLINE TARGET: how much of a sheet's ink may sit INSIDE the silhouette rather than
 * holding the outer contour. INK is the darkest tone the law allows, so a pixel of it in the middle
 * of a lit garment is not a line — the scene grade crushes it to black while the plate around it
 * reads at 0.4, and the player sees a hole punched through the armour. This measured the hero at
 * 2-3 texels of pure black across the neck, three across the belt, notches out of both faulds and a
 * black column the length of the leg gap; the barbarian at a bar across the collarbone and rings
 * round both arms. A seam belongs to its own material's ramp (`pixelPainter.seamInk`), and the only
 * ink left inside a figure should be where that material is already at the bottom of its own curve.
 *
 * Most of the cast now sits at 2-11% (the hero 7, the barbarian 10, the shadow dragon 2). The five
 * still over 12 — fyre drake 30, demon 25, war lord 21, mage 16, dark warrior 16 — are the sheets
 * whose materials are painted so low that `seamInk` finds no darker step to fall to and leaves the
 * ink where it is. That is not the pass failing; it is the pass reporting that those hides and
 * plates need repainting UP before their seams can be drawn at all. Warning, not error, for exactly
 * that reason: it is a list of the sheets that still need another pass, not a gate.
 */
export const INTERIOR_INK_TARGET = 0.12;

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
 * HOW THE NUMBERS ARE DERIVED — the ladder is KEYED OFF `MONSTER_TABLE` (game/monsters.js), not off
 * whichever canvas an art file happened to be drawn on. Two columns of that table do the work:
 *   `size`      the creature's BUILD — 0.8 dire wolf, 1.0 a man, 1.4 troll, 1.6 dragon. This is the
 *               spine of the ladder; a monster never outranks a monster the table builds bigger
 *               unless its species is a different shape of thing entirely (a wyvern flies).
 *   `depthMin`  its STATION in the dungeon, worth a few points of presence at the top end: of two
 *               1.0-build humans the depth-12 War Lord is the one who has to stop a player dead.
 * The bands below fall straight out of those two columns, and nothing may cross a band without a
 * reason a player can see from across a room.
 *
 *   0.70 - 0.90   vermin and small things       dire wolf, rogue, dwarven guard
 *   0.90 - 1.25   PEOPLE, hero = 1.0 among them ordinary humans below him, elite humans above,
 *                                               the War Lord topping the band at 1.25
 *   1.15 - 1.25   odd builds                    dimension spider (wide, but a depth-8 horror),
 *                                               gargoyle (squat stone brute)
 *   1.45 - 1.75   the loomers                   werebear, ogre, troll
 *   1.78 - 2.30   the apex                      demon, wyvern, fyre drake, shadow dragon
 *
 * TWO BUGS THIS TABLE EXISTS TO KILL, both of which had the ladder upside down:
 *  1. THE LADDER WAS INVERTED AT THE TOP. War Lord 1.70 > troll 1.66 > fyre drake 1.60 > ogre 1.58
 *     put a human commander (build 1.2) over a drake (build 1.6) and over an ogre (build 1.3), and
 *     dimension spider 0.86 < hobgoblin 0.90 made a depth-8 horror smaller than a depth-1 mook.
 *     The table's own `size` column says otherwise in every one of those cases.
 *  2. THE TOP OF THE LADDER ATE THE FRAME. At the real playing camera the cast's shared grid is 3
 *     device px per texel at 1600x900, so 1.0 is 138 px of a 900 px frame: the old Demon at 1.95 and
 *     War Lord at 1.70 asked for art 235-270 px tall that reached into the HUD and left the hero the
 *     smallest readable figure on screen. The Demon is a lean depth-14 horror (build 1.0), not a
 *     dragon: it comes down to 1.78. The War Lord is a MAN, however big his pauldrons: 1.25, the top of the
 *     human band. Only the true monsters — the drakes and the Shadow Dragon — pass 1.9, and the
 *     tallest thing in the game now lands at 2.30 (~310 px), a third of the frame, not half of it.
 *
 * The Fyre Drake keeps its one deliberate note: it is a low, sprawling salamander whose bulk runs
 * ALONG the floor, so it is the widest thing in the bestiary while sitting below the Shadow Dragon
 * in height. Its redraw therefore bought part of the extra height by RAISING THE HEAD rather than by
 * inflating the sprawl (monsters/drakes.js `FD_LIFT`): a straight 1.42x repaint would have made it
 * 125 texels wide, and a creature four tiles across reaches the HUD from the middle of a room.
 * Height is what the ladder asks of it; footprint is not.
 *
 * THE ART NOW CARRIES THIS TABLE. Everything above used to be dead code — `spriteBillboard` sizes a
 * creature purely by how many texels its art occupies, and `characters.js` explicitly does not size
 * the billboard, so a sheet drawn at 0.70 of its slot simply walked on screen at 0.70 of its slot.
 * Every creature above SCALE 1.1 has since been REPAINTED at the height its slot demands — not
 * scaled: the procedural groups (beasts, boss, drakes) are authored in their own coordinate space
 * and re-rasterised at a per-creature draw scale, so every capsule, superellipse and terminator is
 * re-solved on the finer grid; the hand-typed ones (the Barbarian's whole body, the War Lord's
 * crest) were typed again at the new size. `DENSITY_MIN`/`DENSITY_MAX` and
 * `tests/spriteStyle.test.js` now hold it there.
 *
 * CHECKED AT THE PLAYING CAMERA ('deep-level' and 'combat'), not just in the bestiary line-up, by
 * rendering the whole cast at the sizes this table asks for. The Shadow Dragon lands at 317 px (a
 * third of the frame), the Demon at 246 and the War Lord at 172 — where the old table put the War
 * Lord at 235 and the Demon at 269 and left the hero, at 138, the least of them. The hero is now a
 * head shorter than the loomers and a head taller than the mooks, which is what a reader needs from
 * a size hierarchy.
 */
export const SCALE = {
  // ---- vermin and small things (build <= 0.9, depth 1)
  'dire-wolf': 0.70,          // build 0.8, low quadruped: shoulder-height on a man
  'rogue': 0.86,              // build 0.9, small and hunched, the smallest human
  'dwarven-guard': 0.88,      // build 0.9, short and broad — height is not where his mass went
  // ---- people: the hero stands at 1.0 IN this band, not above it
  'hobgoblin': 0.92,          // build 0.9, the depth-1 mook
  'elvin-ranger': 0.95,       // build 1.0
  'mercenary': 0.96,          // build 1.0
  'monk': 0.97,               // build 1.0
  'assassin': 0.98,           // build 1.0, depth 10 — lean, and mostly not visible anyway
  'mage': 0.98,               // build 1.0, depth 14, but a caster is not a big man
  'swordsman': 0.99,          // build 1.0
  'barbarian': 1.10,          // build 1.1
  'dark-warrior': 1.14,       // build 1.1, depth 8: the biggest ordinary soldier
  'war-lord': 1.25,           // build 1.2, depth 12: tops the human band and stops there
  // ---- odd builds that read big without being loomers
  'dimension-spider': 1.15,   // build 1.1, depth 8: crouched and WIDE, never tall — but never a mook
  'gargoyle': 1.20,           // build 1.0, depth 2, but carved out of a block of stone
  // ---- the loomers
  'werebear': 1.48,           // build 1.2
  'ogre': 1.58,               // build 1.3
  'troll': 1.72,              // build 1.4
  // ---- the apex
  'demon': 1.78,              // build 1.0 but depth 14: tall and lean, the deepest thing that walks
  'wyvern': 1.90,             // build 1.3, depth 6, and it has wings on top of that
  'fyre-drake': 1.92,         // build 1.6, depth 12 — long, not tall: its bulk runs along the floor
  'shadow-dragon': 2.30,      // build 1.6, depth 10: the tallest silhouette in the game
};

/** The hero's own entry, so `SCALE` can be read for any character view. */
export const HERO_SCALE = 1.0;

/**
 * THE ART IS THE SIZE LAW, AND THIS IS HOW FAR IT MAY MISS.
 *
 * `sizeFor(type, figurePx)` is the multiplier a sheet WOULD need to reach the height its `SCALE`
 * slot asks for. Nothing applies it any more — `spriteBillboard` sizes a creature purely by how
 * many texels its art occupies times one shared texel size (see sprites/spriteBillboard.js, "ONE
 * TEXEL SIZE FOR THE WHOLE SCREEN") — so a multiplier away from 1.0 is not a correction, it is a
 * MEASUREMENT OF THE ERROR: the amount by which that sheet's art disagrees with the ladder.
 *
 * WHY THE BAND USED TO BE 0.6-2.2, AND WHY THAT WAS THE BUG. A window that wide admits a 3.7x
 * disagreement, which is another way of saying it admits any disagreement at all — and the cast
 * duly drifted into one. Every sheet above SCALE 1.1 was painted at about 0.70 of the height its
 * slot demanded, and the ladder inverted where it mattered most: the War Lord (slot 1.25) walked on
 * screen at 1.46 of the hero, TALLER than the Wyvern (1.41) and the Fyre Drake (1.35); the Shadow
 * Dragon (slot 2.30, the tallest thing in the game) came on at 1.57, BELOW the Demon; the Dimension
 * Spider was smaller than the hero it ambushes. Every one of those sheets measured "inside the
 * band", so nothing failed and nobody noticed for two audits.
 *
 * 0.90-1.25 is the band the repainted cast actually holds (worst: the Assassin at 1.22, still drawn
 * on the 40x40 grunt canvas; the War Lord at 0.96). It is tight enough that the old state fails it
 * at BOTH ends — the Troll at 1.46 and the War Lord at 0.86 — and `tests/spriteStyle.test.js`
 * asserts per type that no shipping sheet needs clamping at all, plus the RANK law the band cannot
 * see: any two creatures more than `LADDER_RANK_MARGIN` apart in `SCALE` must come out that way
 * round in texels.
 */
export const DENSITY_MIN = 0.90, DENSITY_MAX = 1.25;

/**
 * How far apart two creatures must be on the `SCALE` ladder before the ART is required to put them
 * in that order. Below this they are the same size to a player across a lit room and the sheets may
 * tie; above it, a bigger slot MUST measure taller in texels, or the hierarchy is a lie. 0.14 is
 * about a head of height on a man.
 */
export const LADDER_RANK_MARGIN = 0.14;

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
 * How much of the renderer's per-depth colour grade a character sprite is allowed to CANCEL. The
 * dungeon's depth bands push the whole frame green at depth 18 and violet at depth 19+, which is
 * exactly right for stone and air and — at full strength — wrong for a creature: species identity
 * must not change with the floor you meet it on. 1.0 would cancel the depth grade on characters
 * entirely and float them off the background; 0 lets the band repaint the species.
 *
 * IT WAS 0.78, AND THAT WAS AN OVER-CORRECTION. At 0.78 the cast kept its own colour world: an
 * olive wyvern and a red-and-white hero stood in a saturated cyan room and read as stickers on a
 * photograph, because nearly all of the light the ROOM was graded by was being divided back out of
 * them. A figure belongs to a room only if the room's light lands on it. 0.42 leaves the Shadow
 * Dragon recognisably violet on every floor while letting a good half of each band's cast reach
 * the cast — enough that hero, monster and flagstone are lit by the same lamp.
 */
export const DEPTH_TINT_CLAMP = 0.42;

// ---------------------------------------------------------------------------- the scene tone pass
/**
 * THE SHEET IS NOT WHAT THE PLAYER SEES.
 *
 * `lint()` used to judge a packed atlas and stop there, and two audits in a row proved that is not
 * the same question as "does this creature read on screen". The renderer multiplies a sprite's
 * albedo by the room's light (measured live at the playing camera: about `SCENE_GAIN` of it in a
 * lit hall), the grading pass then lifts, split-tones and pushes CONTRAST ABOUT MID GREY — which
 * crushes everything below ~0.013 linear to nothing — and the output pass finally runs ACES and
 * encodes to sRGB. The crush is brutal in the darks: a sheet whose median sits at 0.22 (legal by
 * `VALUE_FLOOR`) lands at 0.01 on screen, i.e. a hole in the floor, while the hero's 0.44 lands at
 * 0.23. Seven sheets shipped that way — demon, fyre drake, gargoyle, dark warrior, war lord,
 * werebear and assassin — every one of them "passing" lint.
 *
 * These constants are the pass, measured from the live uniforms (spriteBillboard's `uAmbientGain`
 * /`uDirectGain`/`uFloor` against the scene's lights at the 'bestiary', 'bestiary-idle' and
 * 'deep-level' cameras) and from renderer.js's GradingShader + OutputPass. They are deliberately
 * a REPRESENTATIVE middle of the game, not any one frame: near a torch a sprite reads brighter,
 * in a far corner darker.
 */
export const SCENE_GAIN = 0.32;
/** The grading pass's black lift, contrast and pivot (renderer.js GradingShader). */
export const SCENE_LIFT = 0.003, SCENE_CONTRAST = 1.08, SCENE_PIVOT = 0.18;
/** `renderer.gl.toneMappingExposure` ahead of the ACES output pass. */
export const SCENE_EXPOSURE = 1.1;

const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
/** The ACES filmic curve three.js applies in the output pass (Narkowicz's fit — three's own). */
const acesCurve = (x) => clamp01((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));

/**
 * What a sheet tone of luminance `v` (0-1, as the art file paints it) actually reads as on screen,
 * after the room's light, the depth grade and the tone map. Monotone, pure, and the number `lint()`
 * judges — see `SCENE_GAIN` for where the constants come from.
 * @param {number} v
 * @returns {number} screen luminance, 0-1
 */
export function sceneValue(v) {
  let c = srgbToLinear(clamp01(v)) * SCENE_GAIN + SCENE_LIFT;
  c = (c - SCENE_PIVOT) * SCENE_CONTRAST + SCENE_PIVOT;
  if (c < 0) c = 0;
  return linearToSrgb(acesCurve(c * SCENE_EXPOSURE));
}

// ------------------------------------------------------------------------------ the read-lift
/**
 * THE RENDERER'S RESCUE, AND ITS LIMIT.
 *
 * A sheet that lands under `READ_LIFT_TARGET` is pulled up to it by a per-sheet GAMMA applied to
 * the albedo in `spriteBillboard`'s fragment shader (`uReadLift`). Gamma, not a brightness add:
 * `x^g` fixes both ends, so the one-pixel INK outline (luminance 0.08) stays under the grading
 * pass's contrast crush and keeps reading as pure black, while the body — the part that was
 * disappearing — comes up. An additive lift greys the ink out and eats the silhouette.
 *
 * The rescue is CAPPED at `READ_LIFT_MIN_GAMMA`. Uncapped it would flatten a genuinely dark
 * creature into a grey one and, worse, would make `lint()`'s post-lighting rule unfailable: with
 * infinite rescue no sheet is ever too dark. Capped, a sheet drawn darker than about median 0.20
 * cannot be saved by the renderer and fails CI, which is exactly the class of bug this pass exists
 * to stop shipping.
 */
export const READ_LIFT_TARGET = 0.36;
/** The strongest rescue: `x^0.68` takes a median of 0.224 (the Demon) to 0.36 and no further. */
export const READ_LIFT_MIN_GAMMA = 0.68;

/**
 * The albedo gamma the renderer applies to a sheet whose body median is `median`. 1 = untouched.
 * @param {number} median a sheet's median body luminance (see `analyseSheet`)
 * @returns {number} gamma in [READ_LIFT_MIN_GAMMA, 1]
 */
export function readLift(median) {
  const m = clamp(median, 1e-3, 0.999);
  if (m >= READ_LIFT_TARGET) return 1;
  return clamp(Math.log(READ_LIFT_TARGET) / Math.log(m), READ_LIFT_MIN_GAMMA, 1);
}

/**
 * The gamma for a packed sheet, measured once and memoised on the sheet object (the character
 * factory caches one sheet per type, but builds a billboard per entity).
 * @param {import('./spriteSheet.js').Sheet} sheet
 * @returns {number}
 */
export function readLiftFor(sheet) {
  if (typeof sheet.readLift === 'number') return sheet.readLift;
  const a = analyseSheet(sheet);
  const g = a ? readLift(a.median) : 1;
  Object.defineProperty(sheet, 'readLift', { value: g, enumerable: false, writable: true });
  return g;
}

/**
 * Minimum median value a creature may read at on screen after the scene pass (`sceneValue`), with
 * the renderer's capped read-lift applied. Below this the figure is a hole in the floor at the
 * playing camera however legal its atlas looks. The lifted cast lands at 0.143; the hero, who needs
 * no lift at all, at 0.232.
 */
export const LIT_VALUE_FLOOR = 0.12;

/**
 * Minimum SCREEN value range a creature's ramp must still hold after the scene pass — the rule the
 * atlas cannot express. `VALUE_RANGE_MIN` measures the ramp as painted, and a ramp painted low can
 * be a legal 0.30 wide in the file and land almost flat on screen, because the grading pass's
 * contrast crush eats the bottom of it and ACES compresses the top: 0.10-0.40 in the file (median
 * 0.25 — legal by every sheet rule there is) comes out as 0.00-0.32, a third of the separation the
 * shipping cast holds. That is a creature with no form on it, which is a different failure from a
 * creature that is too dark, and this is the rule that catches it. The cast runs 0.52-0.64.
 */
export const LIT_RANGE_MIN = 0.40;

// ------------------------------------------------------------------------------- the form check
/**
 * PILLOW SHADING, AND WHY EVERY RULE ABOVE LET IT THROUGH.
 *
 * Everything above this line histograms TONES. Not one of them looks at WHERE a tone was put, so a
 * creature can hold a perfect seven-step ramp, a legal median, a positive rim delta and the full
 * screen contrast — and still be lit from nowhere, because the light was painted down the MIDDLE of
 * every form with the shadow ringed symmetrically around it. That is pillow shading, the oldest
 * mistake in pixel art, and it shipped on the largest masses in the game while lint said nothing:
 * the hero's two cape panels (one crimson value across ~250 texels with a one-pixel dark hem), the
 * dwarven guard's skirt, the barbarian's torso, the mercenary's tunic, the swordsman's coat and the
 * War Lord's cloak — a third of the War Lord's body area measured centre-lit.
 *
 * WHAT THIS MEASURES. Along every row of every frame, a RUN is a stretch of one material (a jump of
 * more than `FORM_MAT_TOL` in RGB ends it, and so does the ink — an outline is not form). A run at
 * least `FORM_RUN_MIN` long is a form the player can read, and its profile is split in thirds. It
 * FAILS when the middle third is brighter than both ends by more than `FORM_STEP` while the two
 * ends sit within `FORM_SYMMETRY` of each other — light in the centre, shadow on both edges, which
 * is a tube of light on a flat sheet and is exactly what a key light never does. A profile that
 * falls one way (the light side, the terminator, the core shadow, the reflected-light edge) passes,
 * whichever way it falls, because a form turned away from the key is still a form.
 *
 * ONE-PIXEL SEAMS ARE READ THROUGH. A drawn crease — `seamInk`'s job — is structure, not shading,
 * and a single dark pixel sitting between two lighter ones is replaced by their mean before the
 * profile is judged. Without that, every seam in the cast turns its own row into a false positive.
 */
export const FORM_RUN_MIN = 4;

/**
 * AND THE DENOMINATOR IS THE WHOLE BODY. It was not: `formPx` used to count only the pixels inside
 * runs at least `FORM_RUN_MIN` long, so the rule reported a fraction OF THE PART OF THE SHEET IT
 * HAD LOOKED AT. At the old FORM_RUN_MIN of 8 that was 18% of the Rogue, 21% of the Elvin Ranger,
 * 34% of the hero and 15-46% of the human sheets generally — a pillow could be painted across every
 * short run in a figure and the number would not move, and a sheet could improve its score by
 * BREAKING its long forms up. Now every non-ink body pixel is counted in the denominator, whatever
 * length of run it sits in, and `FORM_RUN_MIN` only decides which runs are long enough to HAVE a
 * middle and two ends worth judging (four is a form a player can read; three is a rivet). The cast
 * measures 0.02-0.11 under the whole-body denominator against 0.02-0.12 under the old partial one,
 * so the limits below are unchanged — what changed is that the number can no longer be gamed by
 * where the rule was pointed.
 */
export const FORM_WHOLE_BODY = true;
/**
 * How far two neighbouring pixels may sit apart in RGB and still count as one material. It has to
 * clear a whole ramp step at its widest: the War Lord's plate reads four steps off a seven-step
 * curve and walks 97-105 units between neighbours, and at any tighter figure his breastplate splits
 * into single-tone runs and the pillow on the biggest human in the game measures as nothing at all.
 */
export const FORM_MAT_TOL = 110;
/** How much brighter the middle of a run must be than both its ends before it reads as a pillow. */
export const FORM_STEP = 0.035;
/** How near the two ends of a run must be, as a fraction of the centre's lift, to read as symmetric. */
export const FORM_SYMMETRY = 0.6;
/**
 * Fraction of a sheet's BODY pixels (see `FORM_WHOLE_BODY`) that may be centre-lit before it is a
 * bug. The repainted cast
 * runs 0.02-0.12 (worst: the Wyvern); the state this rule was written against ran to 0.35 on the War
 * Lord, 0.30 on the Dwarven Guard and two flat crimson slabs on the hero, so it bites hard on the
 * failure and leaves a few points of room for a sheet mid-repaint.
 */
export const FORM_PILLOW_MAX = 0.15;
/** The house target for that fraction — above it, the sheet still has a pass of form work owing. */
export const FORM_PILLOW_TARGET = 0.06;

/**
 * Measure how much of a sheet's body is lit down the middle instead of from `LIT`. Pure analysis;
 * `lint()` turns it into a violation. See `FORM_RUN_MIN` and `FORM_WHOLE_BODY` for the method:
 * `formPx` is EVERY non-ink body pixel, `pillowPx` those inside a centre-lit form.
 * @param {import('./spriteSheet.js').Sheet} sheet
 * @param {{skipAnims?:string[]}} [o]
 * @returns {{formPx:number, pillowPx:number, pillow:number, worst:null|{anim:string, facing:string, y:number, x:number, n:number}}}
 */
export function analyseForms(sheet, { skipAnims = LINT_SKIP_ANIMS } = {}) {
  const W = sheet.width, D = sheet.data, ink = toRgb(INK);
  const at = (x, y) => { const i = (y * W + x) * 4; return D[i + 3] ? [D[i], D[i + 1], D[i + 2]] : null; };
  let formPx = 0, pillowPx = 0, worst = null;
  for (const fr of sheet.frames) {
    if (skipAnims.includes(fr.name)) continue;
    for (let y = 0; y < fr.h; y++) {
      let run = [], prev = null;
      const flush = (xEnd) => {
        const n = run.length;
        formPx += n;                                        // EVERY body pixel, run or not
        if (n >= FORM_RUN_MIN) {
          const p = run.slice();                            // read through one-pixel drawn seams
          for (let i = 1; i < n - 1; i++) {
            if (run[i] < run[i - 1] - 0.05 && run[i] < run[i + 1] - 0.05) p[i] = (run[i - 1] + run[i + 1]) / 2;
          }
          const t = Math.floor(n / 3);
          const mean = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += p[i]; return s / (b - a); };
          const lo = mean(0, t), mid = mean(t, n - t), hi = mean(n - t, n);
          const dark = Math.min(lo, hi), light = Math.max(lo, hi);
          if (mid - light > FORM_STEP && light - dark < (mid - dark) * FORM_SYMMETRY) {
            pillowPx += n;
            if (!worst || n > worst.n) worst = { anim: fr.name, facing: fr.facing, y, x: xEnd - n, n };
          }
        }
        run = [];
      };
      for (let x = 0; x < fr.w; x++) {
        const c = at(fr.x + x, fr.y + y);
        if (!c || dist(c, ink) <= INK_TOL) { flush(x); prev = null; continue; }
        if (prev && dist(c, prev) > FORM_MAT_TOL) flush(x);   // a new material is a new form
        run.push(luminance(c));
        prev = c;
      }
      flush(fr.w);
    }
  }
  return { formPx, pillowPx, pillow: formPx ? pillowPx / formPx : 0, worst };
}

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
  // ---- INK DISCIPLINE: how much of the ink is NOT holding the outer contour. An ink pixel with no
  // transparent 4-neighbour is inside the figure, where INK is not a line but the darkest tone the
  // law allows sitting in the middle of a lit garment — a hole, once the scene grade reaches it.
  // (`pixelPainter.seamInk` is the pass that takes those down to a step of the material's own ramp;
  // this is the number that says whether a sheet has had it.)
  let inkPx = 0, innerInk = 0;
  for (const fr of sheet.frames) {
    if (skipAnims.includes(fr.name)) continue;
    for (let y = 0; y < fr.h; y++) for (let x = 0; x < fr.w; x++) {
      const c = at(fr.x + x, fr.y + y);
      if (!c || `${c[0]},${c[1]},${c[2]}` !== inkKey) continue;
      inkPx++;
      const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const px = x + dx, py = y + dy;
        return px < 0 || py < 0 || px >= fr.w || py >= fr.h || !at(fr.x + px, fr.y + py);
      });
      if (!open) innerInk++;
    }
  }
  const interiorInk = inkPx ? innerInk / inkPx : 0;
  // ---- EVERY NEAR-BLACK MUST BE DECLARED IN THIS FILE. `ink` above is only the most common colour
  // on the OUTER EDGE, so a private near-black used anywhere else — an eye socket, a cape lining,
  // 269 texels of the hero — never came near this measurement and shipped clean. Here we walk the
  // whole histogram instead: any tone under `NEAR_BLACK_L` that is not within `INK_TOL` of one of
  // `DECLARED_INKS` is a second ink layer, and `lint()` fails it by name.
  const declaredRgb = DECLARED_INKS.map(toRgb);
  const strayInk = [];
  for (const [k, n] of counts) {
    const c = k.split(',').map(Number);
    const L = luminance(c);
    if (L >= NEAR_BLACK_L) continue;
    const off = Math.min(...declaredRgb.map((d) => dist(c, d)));
    if (off <= INK_TOL) continue;
    strayInk.push({ hex: hex(c), rgb: c, n, coverage: n / pixels, lum: +L.toFixed(3), off: +off.toFixed(1) });
  }
  strayInk.sort((a, b) => b.n - a.n);
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
  // ---- what the PLAYER sees: the same tones after the room's light, the grade and the tone map
  // (see `sceneValue`), both as painted and with the renderer's capped read-lift (see `readLift`).
  const gamma = readLift(median);
  const litMedian = sceneValue(median ** gamma);
  const unaidedMedian = sceneValue(median);
  const litRange = (area.length ? Math.max(...area.map((t) => sceneValue(t.lum ** gamma))) : sceneValue(maxLum ** gamma))
    - sceneValue(minLum ** gamma);
  return {
    ink, inkHex: hex(ink), strayInk, tones, area, steps: tones.length, median, minLum, maxLum,
    range: maxLum - minLum, readThrough, readLift: gamma, litMedian, unaidedMedian, litRange,
    peakChroma: area.length ? Math.max(...area.map((t) => t.chroma)) : 0,
    meanChroma: tones.reduce((s, t) => s + t.chroma * t.coverage, 0),
    keyLight: (litN ? litSum / litN : 0) - (awayN ? awaySum / awayN : 0),
    interiorInk, figurePx: measureFigure(sheet),
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
  if (a.strayInk.length) {
    const total = a.strayInk.reduce((s, x) => s + x.n, 0), worst = a.strayInk[0];
    v.push({ rule: 'ink-undeclared', severity: 'error', value: a.strayInk.length, limit: 0,
      detail: `${who}: ${total} texels painted in ${a.strayInk.length} near-black${a.strayInk.length > 1 ? 's' : ''} style.js does not declare — worst ${worst.hex} x${worst.n} (luminance ${worst.lum}, ${worst.off} from the nearest of ${DECLARED_INKS.join('/')}). This file declares EVERY near-black in the game: INK for the outer contour, INK_LIT for its lit side, INK_DEEP for a hole in a body; an internal seam is a dark step of the material's own ramp (pixelPainter.seamInk), never a private black` });
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
  // THE RULE THAT MEASURES WHERE THE LIGHT WAS PUT, not which tones were used. `keyLight` below
  // only ever asked the SILHOUETTE which way it faces; this asks every form inside it (see
  // `analyseForms`) whether it is lit from the top-left or lit down its own middle.
  const f = analyseForms(sheet, { skipAnims: meta.skipAnims || LINT_SKIP_ANIMS });
  const where = f.worst ? ` (worst: ${f.worst.n} px across ${f.worst.anim}/${f.worst.facing} row ${f.worst.y})` : '';
  if (f.pillow > FORM_PILLOW_MAX) {
    v.push({ rule: 'form-pillow', severity: 'error', value: +f.pillow.toFixed(3), limit: FORM_PILLOW_MAX,
      detail: `${who}: ${(f.pillow * 100).toFixed(0)}% of its form area is lit down the CENTRE with shadow on both edges — pillow shading, not a key light${where} (ceiling ${FORM_PILLOW_MAX})` });
  } else if (f.pillow > FORM_PILLOW_TARGET) {
    v.push({ rule: 'form-pillow', severity: 'warning', value: +f.pillow.toFixed(3), limit: FORM_PILLOW_TARGET,
      detail: `${who}: ${(f.pillow * 100).toFixed(0)}% of its form area is still centre-lit rather than key-directional${where} (house target ${FORM_PILLOW_TARGET})` });
  }
  if (a.keyLight < KEY_LIGHT_MIN) {
    v.push({ rule: 'key-light', severity: 'error', value: +a.keyLight.toFixed(3), limit: KEY_LIGHT_MIN,
      detail: `${who}: rim delta ${a.keyLight.toFixed(3)} — the key light does not agree with LIT (top-left)` });
  }
  // THE RULE THAT MEASURES THE SCREEN, NOT THE ATLAS. Every rule above judges the packed sheet;
  // this one runs the sheet through a representative lighting + grade pass first (`sceneValue`),
  // WITH the renderer's capped read-lift, and asks whether a player would see a creature or a hole.
  if (a.litMedian < LIT_VALUE_FLOOR) {
    v.push({ rule: 'value-lit', severity: 'error', value: +a.litMedian.toFixed(3), limit: LIT_VALUE_FLOOR,
      detail: `${who}: reads at ${a.litMedian.toFixed(3)} under scene lighting even with the renderer's strongest read-lift (x^${a.readLift.toFixed(2)}) — a black hole at the play camera (floor ${LIT_VALUE_FLOOR})` });
  }
  if (a.litRange < LIT_RANGE_MIN) {
    v.push({ rule: 'lit-contrast', severity: 'error', value: +a.litRange.toFixed(3), limit: LIT_RANGE_MIN,
      detail: `${who}: its ramp spans only ${a.litRange.toFixed(2)} of screen value once lit and graded (file range ${a.range.toFixed(2)}) — the form flattens out at the play camera (min ${LIT_RANGE_MIN})` });
  }
  if (a.unaidedMedian < LIT_VALUE_FLOOR) {
    v.push({ rule: 'value-lit-unaided', severity: 'warning', value: +a.unaidedMedian.toFixed(3), limit: LIT_VALUE_FLOOR,
      detail: `${who}: as painted it reads at ${a.unaidedMedian.toFixed(3)} on screen (median ${a.median.toFixed(2)}) and only the renderer's read-lift x^${a.readLift.toFixed(2)} keeps it out of the floor — repaint it lighter` });
  }
  if (a.interiorInk > INTERIOR_INK_TARGET) {
    v.push({ rule: 'interior-ink', severity: 'warning', value: +a.interiorInk.toFixed(3), limit: INTERIOR_INK_TARGET,
      detail: `${who}: ${(a.interiorInk * 100).toFixed(0)}% of its ink is INSIDE the silhouette — INK is the outer contour, and a seam drawn in it is a hole punched through a lit garment; draw it a step down that material's own ramp (pixelPainter.seamInk) (house target ${INTERIOR_INK_TARGET})` });
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

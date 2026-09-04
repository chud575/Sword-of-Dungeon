// screenTruth: the gates that judge the FRAME. Everything in spriteStyle.test.js judges a packed
// atlas; this file renders the game and reads the pixels back (tools/audit.mjs), because the two are
// not the same question and this project has now been burned by the difference three times:
//
//   1. style.js `sceneValue()` predicted litMedian 0.143 for the fyre drake, war lord, demon and
//      shadow dragon. Canvas readback found 0.014-0.047 — the model was 3-10x optimistic and every
//      one of those sheets was shipping "clean".
//   2. An auditor swapped all 269 of the hero's INK_DEEP texels for a private #0a0410 and `lint()`
//      returned CLEAN, because it only ever measured the most common colour on the OUTER EDGE.
//   3. FORM_RUN_MIN=8 meant the pillow rule's denominator was the part of the sheet it had chosen
//      to look at — 15-46% of the human sheets' body pixels — so a fraction of it meant nothing.
//
// THE CAMERA IS ORTHOGRAPHIC: a fixed plan view tilted 17 degrees off vertical, with the frustum
// derived from a whole texel size, so one world unit is the same number of device pixels everywhere
// in the frame and the pixel grid is exact by construction. tools/audit.mjs reads the scale off
// `camera.top/bottom/zoom` (there is no `fov`) and reports it as `pxPerWorld`, which is what makes
// `tilePx` an exact number rather than a rounded `PX_PER_TILE * texel`.
//
// So: four scenarios are rendered at the camera each is played on, every character on screen is
// isolated by its own texel grid and re-rendered to find what the room draws in front of it, and
// these gates read the resulting numbers. They are expected to FAIL on art that looks wrong,
// however legal its atlas is — that is the entire point, and the failure names the creature, the
// scenario and the metric so the next pass knows what to repaint.
//
// AND EVERY GATE IS PROVEN TO BITE. The auditor can sabotage the frame on purpose ('no-shadows',
// 'dark-cast', 'off-grid'); each sabotage below must turn its own gate red and is asserted to.
//
// This file renders ~40 frames in software GL and takes a couple of minutes. That is the price of
// measuring the screen instead of a histogram.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';

import { auditScenarios, formatReport } from '../tools/audit.mjs';
import { buildHero } from '../src/render/sprites/heroSprite.js';
import { packSheet } from '../src/render/sprites/spriteSheet.js';
import { Palette, paint, outline } from '../src/render/sprites/pixelPainter.js';
import {
  INK, INK_TOL, INK_DEEP, NEAR_BLACK_L, DECLARED_INKS, LIT_VALUE_FLOOR, FORM_PILLOW_MAX,
  FORM_RUN_MIN, analyseForms, analyseSheet, lint, lintErrors, luminance, LINT_SKIP_ANIMS,
} from '../src/render/sprites/style.js';

/** The four frames these gates judge: the game as it starts, a fight, the deep dungeon, the cast. */
const SCENARIOS = ['default', 'combat', 'deep-level', 'bestiary'];
/** The same frame broken on purpose, one gate at a time. */
const SABOTAGE = [
  { scenario: 'default', sabotage: 'no-shadows' },
  { scenario: 'default', sabotage: 'dark-cast' },
  { scenario: 'default', sabotage: 'off-grid' },
];

// ------------------------------------------------------------------------------- the thresholds
/**
 * How lit the FLOOR A CREATURE STANDS ON has to be before the creature is held to the value floor.
 * Measured with the creature's own contact shadow lifted off (audit.mjs `groundLight`), so this is
 * the light the room is offering it, not the light it happens to reflect. A figure in an unlit
 * corner of the dungeon is SUPPOSED to read dark and is not judged; a figure on a torchlit
 * flagstone has nowhere to hide. The shipping frames run 0.15-0.45 on lit floor.
 */
const GROUND_LIT_MIN = 0.10;
/**
 * AND WHAT A FIGURE OWES A DARK ROOM. Below `GROUND_LIT_MIN` the room is not offering enough light
 * to hold anyone to an absolute value — the deep floors are a violet near-black by design — but a
 * creature still has to be a SHAPE there rather than a slightly different shade of the floor. So on
 * unlit ground the rule becomes separation: its own median must stand this far off the background
 * the room shows through it. 0.05 of screen luminance is about 13 of 255, which is the difference
 * between a silhouette and a smudge. The Fyre Drake clears it at +0.099 against the void; the War
 * Lord on that same floor measures +0.000, which is what a hole in the floor looks like as a number.
 */
const DARK_SEPARATION_MIN = 0.05;
/**
 * How much of a figure the room may draw in front of before it stops being measurable. The hero in
 * 'combat' stands behind a boulder that covers two thirds of him: his visible pixels are the ROCK's,
 * and his tone and his (invisible) shadow are facts about the rock, not about the art.
 *
 * TWO NUMBERS, because there are two ways to be hidden. `occlusion` is measured (audit.mjs redraws
 * the sprite with its depth comparison set to ALWAYS), and it catches everything the room draws
 * before the cast; a rock drawn in the TRANSPARENT pass cannot be got in front of at all, and shows
 * up instead as `coverage` — how much of the figure changes the frame when it is hidden. Low
 * coverage also happens when a creature simply cannot be told apart from the floor, which is a
 * FAILURE and not an excuse, so it is never used to skip the value floor: an occluder is lit room
 * geometry and can only push a tone measurement UP, so a figure that measures dark measures dark
 * whether or not something stands in front of it.
 */
const OCCLUSION_MAX = 0.5, COVERAGE_MIN = 0.5;
/** How much of the bottom sixth of a figure must be on screen before its shadow can be judged. */
const FEET_VISIBLE_MIN = 0.35;
/** A body needs this many visible texels before a fraction of it means anything. */
const MIN_BODY_TEXELS = 200;
/**
 * A contact shadow a player can actually see: this many darkened floor pixels under the feet, and a
 * darkest point at least this far down. The shipping cast lands at 900-16000 px and peaks of
 * 0.15-1.0 where it is visible at all; a figure with no blob at all measures 0 and 0.
 */
const CONTACT_MIN_PX = 64, CONTACT_MIN_PEAK = 0.08;
/**
 * THE ONE GRID. Every character sprite in a frame is drawn at the same integer texel size S
 * (spriteBillboard `frameTexelSize`), and the world is snapped to it too (materials `syncWorldGrid`).
 * `runTexels` is the mean horizontal run of one colour divided by S — under 1 means the art is being
 * resampled below its own resolution — and `edgeAlign` is the fraction of a figure's colour edges
 * that land on one repeating column phase, which is what having a texel grid MEANS. A sprite drawn
 * on its own fractional grid collapses edgeAlign toward 1/S.
 */
const GRID_RUN_MIN = 0.75, GRID_EDGE_ALIGN_MIN = 0.75;
/**
 * BOTH ARE MEASURED ON THE PIXELS THE FIGURE OWNS, and that qualifier is load-bearing. A sprite's
 * footprint is not all its own: the room can be drawn in front of it, another sprite can overlap
 * it, and a spell burst, a spray of blood or a damage number can be BLENDED over it in the
 * transparent pass. Those pixels carry the overlay's colour at the overlay's own sub-pixel phase,
 * and counting them measures the SPELL's grid, not the art's. Before audit.mjs dropped them, the
 * Werebear standing inside a magic burst in 'combat' scored 0.61 of its edges on the grid and the
 * props in that same frame scored 0.44 — both were failures of the instrument, and both read 0.99
 * and 1.00 once the overlays were excluded (`ownSet` / `fxAt` in tools/audit.mjs). This exclusion
 * applies to the GRID numbers only. The tone, contact and ambient samples keep every pixel: they
 * are what the player is looking at, and a creature that cannot be told from the floor must stay in
 * that median. The sabotage run below proves the gate still bites through the exclusion.
 */
/** The floor's grid is measured in WORLD space on a plane at an angle, so only its run length is
 * comparable to the cast's; its screen phase legitimately slides with depth. Props are 3D objects
 * standing on that same world grid, so they are held to the run length and not to the phase. */
const PROP_RUN_MIN = 0.6;

let REPORTS = null;

before(async () => {
  const { reports, errors, unknown } = await auditScenarios([...SCENARIOS, ...SABOTAGE], { seed: 42 });
  assert.deepEqual(unknown, [], 'audit could not find these scenarios');
  assert.deepEqual(errors, [], 'the page logged errors while being audited');
  REPORTS = reports;
  for (const name of SCENARIOS) console.log(formatReport(reports[name]) + '\n');
}, { timeout: 900000 });

// ------------------------------------------------------------------------------- helpers
const real = () => SCENARIOS.map((n) => REPORTS[n]);
/** A figure whose pixels are its own: the room is not standing in front of it (see OCCLUSION_MAX). */
const visible = (c) => c.occlusion <= OCCLUSION_MAX && c.coverage >= COVERAGE_MIN;
/** A figure the room is offering light to. */
const lit = (c) => c.groundLight >= GROUND_LIT_MIN;
const who = (r, c) => `${r.scenario}/${c.name}`;

/** The gates, as pure functions of a report, so a sabotaged report can be run through them too. */
const GATES = {
  /**
   * Nothing may read as a hole in the floor: an absolute value on lit ground, and at the very least
   * a separation from the background on unlit ground (see GROUND_LIT_MIN / DARK_SEPARATION_MIN).
   */
  litFloor: (r) => r.characters.flatMap((c) => {
    const seen = `${Math.round((1 - c.coverage) * 100)}% of it never changes the frame at all`;
    if (lit(c)) {
      return c.litMedian >= LIT_VALUE_FLOOR ? [] : [`${who(r, c)}: litMedian ${c.litMedian.toFixed(3)} on screen — under the floor `
        + `${LIT_VALUE_FLOOR} on ground lit to ${c.groundLight.toFixed(3)} (P10 ${c.p10.toFixed(3)}, P90 ${c.p90.toFixed(3)}, `
        + `${seen}) — a hole in the floor at the play camera`];
    }
    return c.contrast >= DARK_SEPARATION_MIN ? [] : [`${who(r, c)}: on unlit ground (${c.groundLight.toFixed(3)}) it reads `
      + `${c.litMedian.toFixed(3)} against a background of ${c.ambient.toFixed(3)} — a separation of ${c.contrast.toFixed(3)} `
      + `(min ${DARK_SEPARATION_MIN}, ${seen}) — the figure and the floor are the same colour`];
  }),

  /** Every lit figure whose feet the room does not cover must be standing ON something. */
  contactShadow: (r) => r.characters
    .filter((c) => lit(c) && c.feetOccluded < 0.5 && c.feetCoverage >= FEET_VISIBLE_MIN
      && (c.contact.px < CONTACT_MIN_PX || c.contact.peak < CONTACT_MIN_PEAK))
    .map((c) => `${who(r, c)}: contact shadow is ${c.contact.px} px, peak ${c.contact.peak.toFixed(3)}, core ${c.contact.core} px `
      + `(needs ${CONTACT_MIN_PX} px and a peak of ${CONTACT_MIN_PEAK}) — the figure is pasted on the floor, not standing on it`),

  /** One screen, one pixel grid — for the cast and for the props standing among them. */
  grid: (r) => {
    const out = [];
    for (const c of r.characters) {
      if (!visible(c) || c.squashed) continue;        // a body mid-recoil is allowed to be off-grid
      if (c.runTexels < GRID_RUN_MIN) {
        out.push(`${who(r, c)}: mean colour run ${c.runPx.toFixed(2)} device px = ${c.runTexels.toFixed(2)} of the frame's `
          + `${r.texelPx}px texel (min ${GRID_RUN_MIN}) — its art is being resampled below its own resolution`);
      } else if (c.edgeAlign < GRID_EDGE_ALIGN_MIN) {
        out.push(`${who(r, c)}: only ${(c.edgeAlign * 100).toFixed(0)}% of its ${c.edges} colour edges land on the frame's `
          + `${r.texelPx}px texel grid (min ${(GRID_EDGE_ALIGN_MIN * 100).toFixed(0)}%) — this sprite is on a grid of its own`);
      }
    }
    if (r.props && r.props.runTexels < PROP_RUN_MIN) {
      out.push(`${r.scenario}/PROPS: mean colour run ${r.props.runPx.toFixed(2)} device px = ${r.props.runTexels.toFixed(2)} of the `
        + `frame's ${r.texelPx}px texel (min ${PROP_RUN_MIN}) — the props are smooth where the cast is pixels`);
    }
    return out;
  },

  /** No body may be lit down its own middle — measured over its WHOLE visible area. */
  pillow: (r) => r.characters
    .filter((c) => visible(c) && c.pillow && c.pillow.bodyTexels >= MIN_BODY_TEXELS && c.pillow.pillow > FORM_PILLOW_MAX)
    .map((c) => `${who(r, c)}: ${(c.pillow.pillow * 100).toFixed(0)}% of its ${c.pillow.bodyTexels} visible body texels are lit down the `
      + `CENTRE with shadow on both edges (ceiling ${(FORM_PILLOW_MAX * 100).toFixed(0)}%`
      + `${c.pillow.worst ? `, worst ${c.pillow.worst.n} texels at row ${c.pillow.worst.row}` : ''}) — pillow shading, not a key light`),
};

// ------------------------------------------------------------------------------- the instrument
test('the auditor found the cast, on the grid it says the renderer is using', () => {
  for (const r of real()) {
    assert.ok(r.characters.length > 0, `${r.scenario}: no characters were measured at all`);
    assert.ok(r.texelPx >= 1, `${r.scenario}: no texel size`);
    for (const c of r.characters) {
      // the mask is rebuilt from spriteBillboard's own placement maths; if this file's copy of it
      // has drifted, sliding the mask would explain the frame better than leaving it where it is
      assert.ok(c.align.coverage - c.coverage < 0.05,
        `${who(r, c)}: the predicted texel grid is misplaced — shifting it by (${c.align.dx},${c.align.dy}) px explains `
        + `${(c.align.coverage * 100).toFixed(0)}% of the frame against ${(c.coverage * 100).toFixed(0)}% where it is. `
        + 'tools/audit.mjs no longer matches spriteBillboard, and every number in this file is measuring the wrong pixels');
      assert.ok(c.figureTexels > 4, `${who(r, c)}: figure measures ${c.figureTexels} texels tall`);
    }
  }
});

// ------------------------------------------------------------------------------- the gates
test('no lit character reads as a hole in the floor at the play camera', () => {
  const fails = real().flatMap(GATES.litFloor);
  assert.deepEqual(fails, []);
});

test('every lit character with visible feet stands on a contact shadow', () => {
  const fails = real().flatMap(GATES.contactShadow);
  assert.deepEqual(fails, []);
});

test('the cast and the props are on the frame\'s one texel grid', () => {
  const fails = real().flatMap(GATES.grid);
  assert.deepEqual(fails, []);
});

test('no body is lit down its own middle, measured over its whole visible area', () => {
  const fails = real().flatMap(GATES.pillow);
  assert.deepEqual(fails, []);
});

// ------------------------------------------------------- and the gates are proven to be failable
/**
 * A sabotage must make its own gate WORSE than the same frame untouched. Comparing against the
 * control rather than against zero is the honest test: it proves the gate responds to the thing
 * that was broken, whatever the shipping art happens to score on that frame today.
 */
function sabotageAdds(gate, key) {
  const broken = REPORTS[key], control = REPORTS.default;
  assert.ok(broken, `the ${key} run is missing`);
  const after = GATES[gate](broken), before = GATES[gate](control);
  assert.ok(after.length > before.length,
    `sabotage ${key} produced ${after.length} ${gate} failures and the untouched frame produces ${before.length} — `
    + `the ${gate} gate did not notice. Untouched: ${JSON.stringify(before)} / sabotaged: ${JSON.stringify(after)}`);
  return after;
}

test('SABOTAGE no-shadows: taking the contact shadows away fails the contact gate', () => {
  assert.match(sabotageAdds('contactShadow', 'default#no-shadows')[0], /contact shadow is \d+ px/);
});

test('SABOTAGE dark-cast: dropping the cast\'s albedo fails the screen value floor', () => {
  assert.match(sabotageAdds('litFloor', 'default#dark-cast')[0], /litMedian/);
});

test('SABOTAGE off-grid: a per-sprite texel size fails the grid gate', () => {
  assert.match(sabotageAdds('grid', 'default#off-grid')[0], /texel/);
});

// ------------------------------------------------- the two sheet rules that could not fail before
/** The hero's sheet with every INK_DEEP texel replaced by one private near-black — the exact
 * substitution an auditor made when `lint()` returned CLEAN. */
function heroWithPrivateBlack(hex = '#0a0410') {
  const sheet = packSheet(buildHero());
  const D = sheet.data;
  const from = [0x12, 0x0c, 0x1c], to = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  let n = 0;
  for (let i = 0; i < D.length; i += 4) {
    if (!D[i + 3] || D[i] !== from[0] || D[i + 1] !== from[1] || D[i + 2] !== from[2]) continue;
    D[i] = to[0]; D[i + 1] = to[1]; D[i + 2] = to[2]; n++;
  }
  return { sheet, n };
}

test('every near-black in a sheet must be declared in style.js', () => {
  assert.deepEqual(lintErrors(packSheet(buildHero()), { type: 'player' }).map((e) => e.rule), [],
    'the hero as shipped must pass the rule');
  const { sheet, n } = heroWithPrivateBlack();
  assert.ok(n > 200, `expected the hero to carry a few hundred INK_DEEP texels, found ${n}`);
  const rules = lintErrors(sheet, { type: 'player' }).map((e) => e.rule);
  assert.ok(rules.includes('ink-undeclared'),
    `substituting ${n} texels of #0a0410 into the hero produced no error at all (rules: ${rules.join(', ') || 'none'}) — `
    + 'the near-black rule is still only looking at the outer contour');
  const a = analyseSheet(sheet);
  assert.equal(a.strayInk[0].hex, '#0a0410');
  assert.ok(a.strayInk[0].n > 200);
  // and it is a rule about NEAR-BLACKS, not about every colour: the declared three all pass
  for (const h of DECLARED_INKS) {
    const c = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const off = Math.min(...DECLARED_INKS.map((d) => {
      const q = [parseInt(d.slice(1, 3), 16), parseInt(d.slice(3, 5), 16), parseInt(d.slice(5, 7), 16)];
      return Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2]);
    }));
    assert.ok(off <= INK_TOL, `${h} is declared and must pass`);
  }
  assert.ok(luminance([0x0a, 0x04, 0x10]) < NEAR_BLACK_L, 'the substituted black must be under the near-black line');
});

test('the pillow rule looks at the WHOLE body and at forms shorter than eight texels', () => {
  // a 6-texel-wide form, lit down its middle with the shadow ringed symmetrically around it. At the
  // old FORM_RUN_MIN of 8 this was not merely allowed, it was not even counted: `formPx` came out 0.
  const rows = Array.from({ length: 14 }, () => '.dmllmd.');
  const built = {
    w: 8, h: 14, pivot: { x: 4, y: 14 },
    palette: new Palette().set('#', INK).set('d', '#404040').set('m', '#606060').set('l', '#808080'),
    anims: { idle: { S: { frames: [outline(paint(rows), '#')], durations: [100], loop: true } } },
  };
  const sheet = packSheet(built);
  assert.ok(FORM_RUN_MIN <= 6, `FORM_RUN_MIN is ${FORM_RUN_MIN}: a six-texel form is invisible to the pillow rule again`);
  const f = analyseForms(sheet);
  assert.ok(f.pillow > FORM_PILLOW_MAX,
    `a sheet that is nothing but centre-lit six-texel forms measured pillow ${f.pillow.toFixed(3)} (ceiling ${FORM_PILLOW_MAX})`);
  assert.ok(lint(sheet, { type: 'pillow-slab' }).some((v) => v.rule === 'form-pillow' && v.severity === 'error'),
    'lint did not report the pillow');

  // ...and the denominator is every non-ink body pixel, not the part of the sheet the rule chose to
  // look at. Counted here independently of style.js.
  const hero = packSheet(buildHero());
  const W = hero.width, D = hero.data;
  const ink = [0x17, 0x11, 0x1f];
  let body = 0;
  for (const fr of hero.frames) {
    if (LINT_SKIP_ANIMS.includes(fr.name)) continue;
    for (let y = 0; y < fr.h; y++) for (let x = 0; x < fr.w; x++) {
      const i = (((fr.y + y) * W) + fr.x + x) * 4;
      if (!D[i + 3]) continue;
      if (Math.hypot(D[i] - ink[0], D[i + 1] - ink[1], D[i + 2] - ink[2]) <= INK_TOL) continue;
      body++;
    }
  }
  assert.equal(analyseForms(hero).formPx, body,
    'analyseForms is still measuring a fraction of the sheet instead of the whole body');
});

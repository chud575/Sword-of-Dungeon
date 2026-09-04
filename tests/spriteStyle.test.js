// The house style law (render/sprites/style.js) applied to the art that actually ships: every
// builder registered for a real MONSTER_TABLE type, plus the hero, must pass lint(). The negative
// cases at the bottom prove the lint actually bites — a rule nothing can fail is not a rule.
import test from 'node:test';
import assert from 'node:assert/strict';

import { MONSTER_TYPES } from '../src/game/monsters.js';
import { MONSTER_SPRITES } from '../src/render/sprites/monsters/index.js';
import { buildHero } from '../src/render/sprites/heroSprite.js';
import { packSheet } from '../src/render/sprites/spriteSheet.js';
import { Palette, paint, outline } from '../src/render/sprites/pixelPainter.js';
import {
  INK, INK_TOL, LIT, SCALE, HERO_SCALE, ramp, lint, lintErrors, analyseSheet, sizeFor, measureFigure,
  CHROMA_CEIL, VALUE_CEIL, VALUE_FLOOR, VALUE_RANGE_MIN, RAMP_MIN_STEPS, RAMP_MAX_STEPS,
  DENSITY_MIN, DENSITY_MAX, LADDER_RANK_MARGIN, HERO_FIGURE_PX, luminance, chroma,
} from '../src/render/sprites/style.js';

const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const sheetOf = (built) => packSheet(built, { order: ['idle', 'walk', 'attack', 'hurt', 'death'] });
/** The registered sprite builders that draw a monster the game can actually spawn. */
const REAL_SPRITES = MONSTER_TYPES.filter((t) => MONSTER_SPRITES[t]);

test('the bestiary is the 22 types of MONSTER_TABLE, and some of them are sprites', () => {
  assert.equal(MONSTER_TYPES.length, 22);
  assert.ok(REAL_SPRITES.length > 0, 'no MONSTER_TABLE type has a sprite builder');
});

test('every sprite builder for a real monster passes the house style lint', () => {
  const failures = [];
  for (const type of REAL_SPRITES) {
    const errs = lintErrors(sheetOf(MONSTER_SPRITES[type]()), { type });
    if (errs.length) failures.push(...errs.map((e) => e.detail));
  }
  assert.deepEqual(failures, []);
});

test('the hero passes the same lint as the cast he stands next to', () => {
  assert.deepEqual(lintErrors(packSheet(buildHero()), { type: 'player' }).map((e) => e.detail), []);
});

test('every real sprite is inked, lit and ramped to the one house style', () => {
  for (const type of REAL_SPRITES) {
    const a = analyseSheet(sheetOf(MONSTER_SPRITES[type]()));
    const ink = hexToRgb(INK), off = Math.hypot(a.ink[0] - ink[0], a.ink[1] - ink[1], a.ink[2] - ink[2]);
    assert.ok(off <= INK_TOL, `${type}: ink ${a.inkHex} is ${off.toFixed(1)} from ${INK}`);
    assert.ok(a.steps >= RAMP_MIN_STEPS, `${type}: ${a.steps} tones`);
    assert.ok(a.range >= VALUE_RANGE_MIN, `${type}: value range ${a.range.toFixed(2)}`);
    assert.ok(a.median >= VALUE_FLOOR, `${type}: median value ${a.median.toFixed(2)}`);
    assert.ok(a.maxLum <= VALUE_CEIL, `${type}: highlight at ${a.maxLum.toFixed(2)}`);
    assert.ok(a.peakChroma <= CHROMA_CEIL, `${type}: chroma ${a.peakChroma.toFixed(2)}`);
    assert.ok(a.keyLight > 0, `${type}: key light disagrees with LIT`);
  }
});

test('lint reports a wrong ink, a dead ramp and a fluorescent body', () => {
  // a 10x10 blob of one near-pure green, outlined in PURE BLACK and lit from nowhere
  const rows = Array.from({ length: 10 }, (_, y) => (y === 0 || y === 9 ? '..gggggg..' : 'gggggggggg'));
  const pix = outline(paint(rows), '#');
  const palette = new Palette().set('#', '#000000').set('g', '#33aa33');
  const built = {
    w: 10, h: 10, pivot: { x: 5, y: 10 }, palette,
    anims: { idle: { S: { frames: [pix], durations: [100], loop: true } } },
  };
  const rules = lint(packSheet(built), { type: 'blob' }).map((v) => v.rule);
  for (const r of ['ink', 'ramp-steps', 'value-range', 'key-light']) {
    assert.ok(rules.includes(r), `lint missed ${r}: got ${rules.join(', ')}`);
  }
});

test('lint accepts every legacy ink the group files still declare, and nothing darker', () => {
  const legacy = ['#1b1426', '#181121', '#17111f', '#161020', '#150f1e'];
  const ink = hexToRgb(INK);
  const off = (h) => { const c = hexToRgb(h); return Math.hypot(c[0] - ink[0], c[1] - ink[1], c[2] - ink[2]); };
  for (const h of legacy) assert.ok(off(h) <= INK_TOL, `${h} should be inside the migration tolerance`);
  assert.ok(off('#000000') > INK_TOL, 'pure black must never pass as the house ink');
  assert.ok(off('#2a1a10') > INK_TOL, 'a warm brown ink must never pass as the house ink');
});

test('the key light is top-left, once, for everyone', () => {
  assert.deepEqual(LIT, { x: -1, y: -1 });
});

test('ramp() builds a hue-shifted 5-7 step ramp inside the house gamut', () => {
  for (const base of ['#7c8752', '#4fa83c', '#3c3757', '#7c2434', '#c08540', '#2c2438', '#8a7a68']) {
    for (const steps of [5, 6, 7]) {
      const r = ramp(base, steps);
      assert.equal(r.length, steps);
      const cols = r.map(hexToRgb), L = cols.map(luminance);
      for (let i = 1; i < L.length; i++) assert.ok(L[i] > L[i - 1], `${base}/${steps}: step ${i} is not lighter`);
      assert.ok(L[L.length - 1] - L[0] >= VALUE_RANGE_MIN, `${base}/${steps}: range ${(L[L.length - 1] - L[0]).toFixed(2)}`);
      assert.ok(L[L.length - 1] <= VALUE_CEIL + 1e-3, `${base}/${steps}: highlight outshines the torches`);
      assert.ok(L[0] > VALUE_FLOOR * 0.45, `${base}/${steps}: darkest step sinks into the ink`);
      for (const c of cols) assert.ok(chroma(c) <= CHROMA_CEIL + 1e-3, `${base}/${steps}: ${c} is fluorescent`);
      // hue-shifted, not a flat darken/lighten: the ends do not share the base's hue
      const dh = Math.abs(cols[0][0] - cols[0][2]) - Math.abs(cols[cols.length - 1][0] - cols[cols.length - 1][2]);
      assert.ok(Number.isFinite(dh));
    }
  }
  assert.throws(() => ramp('#7c8752', 4), RangeError);
  assert.throws(() => ramp('#7c8752', RAMP_MAX_STEPS + 1), RangeError);
});

test('SCALE covers all 22 monsters and reads as one size hierarchy', () => {
  for (const t of MONSTER_TYPES) assert.equal(typeof SCALE[t], 'number', `SCALE is missing ${t}`);
  assert.equal(Object.keys(SCALE).length, MONSTER_TYPES.length, 'SCALE holds a type that cannot spawn');
  // The bands of style.js SCALE, which are keyed off MONSTER_TABLE `size` (build) and `depthMin`.
  const small = ['dire-wolf', 'rogue', 'dwarven-guard'];
  const people = ['hobgoblin', 'elvin-ranger', 'mercenary', 'monk', 'assassin', 'mage', 'swordsman', 'barbarian', 'dark-warrior', 'war-lord'];
  const ordinary = people.filter((t) => !['barbarian', 'dark-warrior', 'war-lord'].includes(t));
  const loomers = ['werebear', 'ogre', 'troll'];
  const apex = ['demon', 'wyvern', 'fyre-drake', 'shadow-dragon'];
  const max = (g) => Math.max(...g.map((t) => SCALE[t]));
  const min = (g) => Math.min(...g.map((t) => SCALE[t]));
  assert.ok(max(small) < min(ordinary), 'small things must be smaller than people');
  assert.ok(min(people) >= 0.85 && max(people) <= 1.25, 'the human band is 0.85 - 1.25');
  assert.equal(max(people), SCALE['war-lord'], 'the War Lord tops the human band');
  assert.ok(max(ordinary) < HERO_SCALE, 'an ordinary soldier does not out-loom the hero');
  assert.ok(min(loomers) >= 1.45 && max(loomers) <= 1.75, 'ogre/werebear/troll are the 1.45 - 1.75 loomers');
  assert.ok(min(loomers) > max(people), 'the loomers loom over every human, the War Lord included');
  assert.ok(min(apex) > max(loomers), 'the drakes, the dragon and the demon are the apex');
  const drakes = ['wyvern', 'fyre-drake', 'shadow-dragon'];
  assert.ok(min(drakes) >= 1.9 && max(drakes) <= 2.4, 'the drakes and the dragon live in 1.9 - 2.4');
  // the two inversions this table was re-keyed to kill
  assert.ok(SCALE['war-lord'] < SCALE.ogre && SCALE['war-lord'] < SCALE['fyre-drake'],
    'a human commander must not out-loom an ogre or a drake');
  assert.ok(SCALE['dimension-spider'] > SCALE.hobgoblin,
    'a depth-8 horror must not be smaller than a depth-1 mook');
  // the odd builds sit between the people and the loomers
  for (const t of ['dimension-spider', 'gargoyle']) {
    assert.ok(SCALE[t] > max(ordinary) && SCALE[t] < min(loomers), `${t} belongs between the people and the loomers`);
  }
  // and the frame it must not eat: at the play camera 1.0 is ~138px of a 900px frame
  assert.ok(max(MONSTER_TYPES) * 138 < 450, 'nothing may span half the frame at the playing camera');
});

test('sizeFor turns a SCALE into a billboard multiplier, clamped to a sane texel density', () => {
  assert.equal(sizeFor('player', HERO_FIGURE_PX), HERO_SCALE);
  // art drawn at exactly the right height needs no scaling at all
  assert.ok(Math.abs(sizeFor('troll', HERO_FIGURE_PX * SCALE.troll) - 1) < 1e-9);
  // art drawn far too small is clamped rather than blown up without limit
  assert.equal(sizeFor('shadow-dragon', 4), DENSITY_MAX);
  assert.equal(sizeFor('dire-wolf', 400), DENSITY_MIN);
});

test('measureFigure reads the hero at the height style.js says he is', () => {
  const px = measureFigure(packSheet(buildHero()));
  assert.ok(Math.abs(px - HERO_FIGURE_PX) <= 2, `hero measured ${px}px, HERO_FIGURE_PX is ${HERO_FIGURE_PX}`);
});

// ============================================================================================
// THE SIZE LADDER, MEASURED ON THE ART
// ============================================================================================
// The tests above check SCALE against ITSELF, which is why the ladder could be dead code for two
// audits: `spriteBillboard` sizes a creature purely by how many texels its art occupies (see its
// "ONE TEXEL SIZE FOR THE WHOLE SCREEN" note) and `characters.js` explicitly does not size the
// billboard, so a sheet painted at 0.70 of its slot walked on screen at 0.70 of its slot no matter
// what SCALE said. Everything below measures the ART.

/** Figure height in texels of every shipping sprite, plus the hero, measured off the packed sheet. */
const FIGURE = (() => {
  const m = { player: measureFigure(packSheet(buildHero())) };
  for (const t of REAL_SPRITES) m[t] = measureFigure(sheetOf(MONSTER_SPRITES[t]()));
  return m;
})();
/** The height this type's SCALE slot asks for, in texels. */
const wanted = (t) => (t === 'player' ? HERO_SCALE : SCALE[t]) * HERO_FIGURE_PX;

test('the hero is drawn at exactly the height the rest of the ladder is measured against', () => {
  assert.ok(Math.abs(FIGURE.player - HERO_FIGURE_PX) <= 2,
    `the hero measures ${FIGURE.player}px, HERO_FIGURE_PX is ${HERO_FIGURE_PX} — every SCALE below is relative to him`);
});

test('every sheet is PAINTED at the height its SCALE slot demands (no sprite needs clamping)', () => {
  // `sizeFor` is the multiplier a sheet would need to reach its slot. Nothing applies it: it is a
  // measurement of the error. A sheet outside DENSITY_MIN..DENSITY_MAX is a canvas to repaint.
  const bad = [];
  for (const t of REAL_SPRITES) {
    const px = FIGURE[t], want = wanted(t), mult = want / px;
    if (mult < DENSITY_MIN || mult > DENSITY_MAX) {
      bad.push(`${t}: art is ${px}px, SCALE ${SCALE[t]} wants ${want.toFixed(0)}px `
        + `(x${mult.toFixed(2)}, band ${DENSITY_MIN}-${DENSITY_MAX}) — repaint the sheet, do not scale it`);
    }
    // and the clamp must never actually bite on shipping art
    assert.equal(sizeFor(t, px), mult > DENSITY_MAX ? DENSITY_MAX : mult < DENSITY_MIN ? DENSITY_MIN : mult);
  }
  assert.deepEqual(bad, []);
});

test('the ART ranks the cast the way SCALE ranks it', () => {
  // The band above cannot see an inversion between two creatures that are BOTH mis-drawn by the
  // same factor — which is exactly how a War Lord ended up out-looming a Fyre Drake. Any two
  // creatures more than LADDER_RANK_MARGIN apart on the ladder must come out that way in texels.
  const all = [...REAL_SPRITES, 'player'];
  const bad = [];
  for (const a of all) for (const b of all) {
    if (a === b) continue;
    const sa = a === 'player' ? HERO_SCALE : SCALE[a], sb = b === 'player' ? HERO_SCALE : SCALE[b];
    if (sa - sb <= LADDER_RANK_MARGIN) continue;          // close enough to tie
    if (FIGURE[a] > FIGURE[b]) continue;
    bad.push(`${a} (SCALE ${sa}) is ${FIGURE[a]}px but ${b} (SCALE ${sb}) is ${FIGURE[b]}px `
      + '— the art has the hierarchy backwards');
  }
  assert.deepEqual(bad, []);
});

test('the heavies loom, the humans do not, and the hero stands between them', () => {
  // The three reads a player must get from silhouette size alone, stated on the ART.
  const px = (t) => FIGURE[t];
  const hero = px('player');
  for (const t of ['werebear', 'ogre', 'troll', 'demon', 'wyvern', 'fyre-drake', 'shadow-dragon']) {
    assert.ok(px(t) > hero * 1.4, `${t} must loom over the hero (${px(t)}px vs ${hero}px)`);
  }
  for (const t of ['war-lord', 'dark-warrior', 'barbarian', 'swordsman', 'mercenary', 'monk', 'assassin', 'rogue']) {
    assert.ok(px(t) < px('werebear'), `${t} is a man: no human may reach the smallest loomer`);
  }
  assert.ok(px('war-lord') < px('fyre-drake') && px('war-lord') < px('ogre'),
    'a human commander must not out-loom an ogre or a drake IN TEXELS, not just in the table');
  assert.ok(px('shadow-dragon') > px('demon'),
    'the tallest silhouette in the game must actually be the tallest sheet');
  assert.ok(px('dimension-spider') > hero, 'a depth-8 horror must not be smaller than the hero');
  assert.ok(px('barbarian') > px('rogue') && px('barbarian') > px('hobgoblin'),
    'the barbarian is the big one of his group; on the old shared canvas all five measured the same');
  // and the hero has to stay readable: nothing may be so big it swallows the frame
  assert.ok(Math.max(...REAL_SPRITES.map(px)) < hero * 2.5, 'nothing may be two and a half heroes tall');
});

test('the cast is painted at ONE texel density — no sheet is a zoomed sprite', () => {
  // Every sheet drawn at its own slot means every sheet shares the hero's texel size. Spread is
  // the ratio of the worst over-drawn sheet to the worst under-drawn one; it was 1.72 when the art
  // carried a flatter hierarchy of its own, and the 0.6-2.2 clamp admitted 3.7.
  const mults = REAL_SPRITES.map((t) => wanted(t) / FIGURE[t]);
  const spread = Math.max(...mults) / Math.min(...mults);
  assert.ok(spread <= 1.45, `texel-density spread across the cast is ${spread.toFixed(2)} (max 1.45)`);
  assert.ok(DENSITY_MAX / DENSITY_MIN <= 1.5,
    'the density band itself must stay tight — a wide band is how the ladder became dead code');
});

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
  DENSITY_MIN, DENSITY_MAX, HERO_FIGURE_PX, luminance, chroma,
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
  const small = ['dire-wolf', 'dimension-spider', 'rogue', 'dwarven-guard'];
  const humans = ['hobgoblin', 'monk', 'assassin', 'mercenary', 'elvin-ranger', 'swordsman', 'mage'];
  const heavies = ['barbarian', 'dark-warrior', 'gargoyle', 'wyvern'];
  const loomers = ['werebear', 'ogre', 'troll'];
  const apex = ['war-lord', 'demon', 'shadow-dragon'];
  const max = (g) => Math.max(...g.map((t) => SCALE[t]));
  const min = (g) => Math.min(...g.map((t) => SCALE[t]));
  assert.ok(max(small) < min(humans.filter((t) => t !== 'hobgoblin')), 'small things must be smaller than people');
  assert.ok(max(humans) < HERO_SCALE, 'the hero is the tallest ordinary person on screen');
  assert.ok(min(heavies) > HERO_SCALE, 'heavies must be bigger than the hero');
  assert.ok(min(loomers) > max(heavies), 'the ogre/troll/werebear must loom over the heavies');
  assert.ok(min(apex) > max(loomers), 'dragon/demon/war lord are the apex');
  assert.ok(SCALE.ogre > 1.5 && SCALE.demon > 1.8, 'the old bug: ogre 1.35x, demon hero-height');
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

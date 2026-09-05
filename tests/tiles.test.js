// THE BOARD'S FIELDS. Every room on the HeroQuest board is ONE flat field and the CHANGE of field
// at a doorway is what tells you you have entered somewhere new (render/tiles.js). Two things have
// to hold for that to survive: every room must actually carry a field, and a level must show a
// SPREAD of them rather than the same one over and over — a level of twelve grey-stone rooms is
// exactly the failure this vocabulary exists to end. Both are asserted here, plus the atlas
// bookkeeping that turns a style id into the cells the renderer samples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLevel } from '../src/world/generator.js';
import { Level } from '../src/world/level.js';
import { TILE_STYLES, ROOM_STYLE_IDS, VARIANTS } from '../src/render/tiles.js';
import { styleCellMap, styleCells, ATLAS, SPECIAL_CELLS, cellUV } from '../src/render/materials.js';

const SEEDS = [1, 42, 907, 20241, 88888];

test('every room on every level carries a field, and a seed reproduces the same fields', () => {
  for (const seed of SEEDS) {
    for (let depth = 0; depth <= 20; depth++) {
      const lv = generateLevel(seed, depth);
      assert.ok(lv.rooms.length > 0, `no rooms seed=${seed} depth=${depth}`);
      for (const r of lv.rooms) {
        assert.ok(ROOM_STYLE_IDS.includes(r.tileStyle),
          `room ${r.type} at ${r.x},${r.y} has no field (${r.tileStyle}) seed=${seed} depth=${depth}`);
        assert.ok(r.tileStyle !== 'corridor' && r.tileStyle !== 'wallTop',
          'corridor and wall-top are placed by the map, never assigned to a room');
      }
      // the same seed and depth always paint the same rooms
      const again = generateLevel(seed, depth);
      assert.deepEqual(again.rooms.map((r) => r.tileStyle), lv.rooms.map((r) => r.tileStyle),
        `fields not reproducible seed=${seed} depth=${depth}`);
    }
  }
});

test('a level shows a spread of fields, not one field repeated', () => {
  for (const seed of SEEDS) {
    for (let depth = 1; depth <= 20; depth++) {
      const lv = generateLevel(seed, depth);
      const styles = lv.rooms.map((r) => r.tileStyle);
      const distinct = new Set(styles).size;
      // styles are dealt from a shuffled deck, so up to ROOM_STYLE_IDS.length rooms cannot repeat
      const want = Math.min(styles.length, ROOM_STYLE_IDS.length);
      assert.equal(distinct, want,
        `only ${distinct} fields across ${styles.length} rooms seed=${seed} depth=${depth}: ${styles.join()}`);
    }
  }
});

test('different seeds lay the fields out differently', () => {
  const a = generateLevel(1, 5).rooms.map((r) => r.tileStyle).join();
  const b = generateLevel(2, 5).rooms.map((r) => r.tileStyle).join();
  assert.notEqual(a, b);
});

test('a room field survives serialization', () => {
  const lv = generateLevel(77, 4);
  const back = Level.deserialize(JSON.parse(JSON.stringify(lv.serialize())));
  assert.deepEqual(back.rooms.map((r) => r.tileStyle), lv.rooms.map((r) => r.tileStyle));
  for (const r of back.rooms) assert.ok(ROOM_STYLE_IDS.includes(r.tileStyle));
});

test('the atlas holds every style at VARIANTS cells, with the temple cells clear of them', () => {
  const map = styleCellMap();
  const ids = Object.keys(TILE_STYLES);
  assert.deepEqual(Object.keys(map), ids);
  const seen = new Set();
  for (const id of ids) {
    const cells = styleCells(id);
    assert.equal(cells.length, VARIANTS, `${id} wants ${VARIANTS} variants`);
    for (const c of cells) {
      assert.ok(Number.isInteger(c) && c >= 0 && c < ATLAS.cols * ATLAS.rows, `${id} cell ${c} off the sheet`);
      assert.ok(c !== SPECIAL_CELLS.mosaic && c !== SPECIAL_CELLS.marble, `${id} treads on a temple cell`);
      assert.ok(!seen.has(c), `cell ${c} claimed twice`);
      seen.add(c);
    }
  }
  assert.equal(seen.size, ids.length * VARIANTS);
  // corridor and wall top are in the sheet: the map places them, no room ever picks them
  assert.equal(styleCells('corridor').length, VARIANTS);
  assert.equal(styleCells('wallTop').length, VARIANTS);
  // an unknown id falls back to the cobble rather than sampling black
  assert.deepEqual(styleCells('no-such-field'), styleCells('corridor'));
  // uv of a cell lands inside the sheet, on the cell's own bottom-left corner
  for (const c of [0, 17, SPECIAL_CELLS.marble]) {
    const [u, v] = cellUV(c);
    assert.ok(u >= 0 && u < 1 && v >= 0 && v < 1, `cell ${c} uv ${u},${v}`);
  }
});

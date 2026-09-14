// forest: the outdoor level is glades and trails in a wood, and it is still a whole Fargoal level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLevel } from '../src/world/generator.js';
import { Level } from '../src/world/level.js';
import { TILE } from '../src/core/constants.js';
import { FOREST_STYLES, TILE_STYLES, ROOM_STYLE_IDS } from '../src/render/tiles.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => 101 + i * 37);
const forest = (seed) => generateLevel(seed, 1, { biome: 'forest' });

test('a forest is glades of irregular shape joined by trails, not rooms and corridors', () => {
  for (const seed of SEEDS) {
    const lv = forest(seed);
    assert.equal(lv.biome, 'forest');
    assert.ok(lv.rooms.length >= 6, `seed ${seed}: only ${lv.rooms.length} glades`);
    for (const r of lv.rooms) {
      assert.equal(r.type, 'glade');
      assert.ok(FOREST_STYLES[r.tileStyle], `seed ${seed}: glade on '${r.tileStyle}'`);
      assert.ok(r.area < r.w * r.h * 0.9, `seed ${seed}: a ${r.w}x${r.h} glade fills ${r.area} tiles — a rectangle, not a glade`);
    }
    let floor = 0, trail = 0;
    for (let i = 0; i < lv.tiles.length; i++) { if (lv.tiles[i] === TILE.FLOOR) floor++; else if (lv.tiles[i] === TILE.CORRIDOR) trail++; }
    assert.ok(trail > 0 && trail < floor, `seed ${seed}: ${trail} trail tiles against ${floor} glade tiles`);
  }
});

test('the whole wood is walkable from the way in, and the way down and the temple are in it', () => {
  for (const seed of SEEDS) {
    const lv = forest(seed);
    assert.ok(lv.stairsUp && lv.get(lv.stairsUp.x, lv.stairsUp.y) === TILE.STAIRS_UP, `seed ${seed}: no way in`);
    assert.ok(lv.stairsDown && lv.get(lv.stairsDown.x, lv.stairsDown.y) === TILE.STAIRS_DOWN, `seed ${seed}: no way down`);
    const reach = lv.floodFill(lv.stairsUp.x, lv.stairsUp.y);
    for (let y = 0; y < lv.height; y++) for (let x = 0; x < lv.width; x++) {
      if (lv.isWalkable(x, y)) assert.ok(reach[lv.idx(x, y)], `seed ${seed}: (${x},${y}) cannot be reached`);
    }
    assert.ok(reach[lv.idx(lv.stairsDown.x, lv.stairsDown.y)]);
    for (const t of lv.temples) assert.ok(reach[lv.idx(t.x, t.y)], `seed ${seed}: temple unreachable`);
    const apart = Math.hypot(lv.stairsDown.x - lv.stairsUp.x, lv.stairsDown.y - lv.stairsUp.y);
    assert.ok(apart >= 8, `seed ${seed}: the way down is only ${apart.toFixed(1)} tiles from the way in`);
  }
});

test('the edge of the map is woods, all the way round', () => {
  for (const seed of SEEDS) {
    const lv = forest(seed);
    for (let x = 0; x < lv.width; x++) { assert.equal(lv.get(x, 0), TILE.WALL); assert.equal(lv.get(x, lv.height - 1), TILE.WALL); }
    for (let y = 0; y < lv.height; y++) { assert.equal(lv.get(0, y), TILE.WALL); assert.equal(lv.get(lv.width - 1, y), TILE.WALL); }
  }
});

test('a seed builds the same forest every time, and different seeds build different ones', () => {
  const a = forest(7), b = forest(7), c = forest(8);
  assert.deepEqual(Array.from(a.tiles), Array.from(b.tiles));
  assert.deepEqual(a.rooms, b.rooms);
  assert.notDeepEqual(Array.from(a.tiles), Array.from(c.tiles));
});

test('it is still a Fargoal level: treasure, traps, monsters, and it survives a save', () => {
  for (const seed of SEEDS.slice(0, 6)) {
    const lv = forest(seed);
    assert.ok(lv.items.some((it) => it.type === 'gold'), `seed ${seed}: no gold`);
    assert.ok(lv.entities.some((e) => e.kind === 'monster'), `seed ${seed}: no monsters`);
    const back = Level.deserialize(JSON.parse(JSON.stringify(lv.serialize())));
    assert.equal(back.biome, 'forest');
    assert.deepEqual(Array.from(back.tiles), Array.from(lv.tiles));
    assert.deepEqual(back.rooms.map((r) => r.tileStyle), lv.rooms.map((r) => r.tileStyle));
  }
});

test('the forest ground never leaks into the dungeon: not a room style, not in the flagstone atlas', () => {
  for (const id of Object.keys(FOREST_STYLES)) {
    assert.ok(!TILE_STYLES[id], `'${id}' is in TILE_STYLES`);
    assert.ok(!ROOM_STYLE_IDS.includes(id), `'${id}' could be dealt to a dungeon room`);
  }
  const dungeon = generateLevel(7, 1);
  assert.equal(dungeon.biome, null);
  for (const r of dungeon.rooms) assert.ok(!FOREST_STYLES[r.tileStyle], `a dungeon room got '${r.tileStyle}'`);
});

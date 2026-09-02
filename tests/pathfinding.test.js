import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLevel } from '../src/world/generator.js';
import { aStar, bfsNearest, flowField, flowStep } from '../src/world/pathfinding.js';
import { TILE } from '../src/core/constants.js';

test('aStar finds a valid path between the stairs on generated levels', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const lv = generateLevel(seed, 6, { monsters: false });
    const path = aStar(lv, lv.stairsUp, lv.stairsDown);
    assert.ok(path && path.length, 'path exists');
    let prev = lv.stairsUp;
    for (const s of path) {
      assert.ok(Math.abs(s.x - prev.x) <= 1 && Math.abs(s.y - prev.y) <= 1, 'adjacent steps');
      assert.ok(lv.isWalkable(s.x, s.y));
      assert.ok(lv.canStep(prev.x, prev.y, s.x - prev.x, s.y - prev.y), 'no corner cutting');
      prev = s;
    }
    assert.deepEqual({ x: prev.x, y: prev.y }, lv.stairsDown);
    const ff = flowField(lv, [lv.stairsDown]);
    const step = flowStep(lv, ff, lv.stairsUp.x, lv.stairsUp.y);
    assert.ok(step && ff[lv.idx(step.x, step.y)] < ff[lv.idx(lv.stairsUp.x, lv.stairsUp.y)]);
  }
});

test('aStar respects passable predicate and returns null when blocked', () => {
  const lv = generateLevel(9, 2, { monsters: false });
  assert.equal(aStar(lv, lv.stairsUp, lv.stairsDown, { passable: () => false }), null);
  const path = bfsNearest(lv, lv.stairsUp, (x, y) => lv.get(x, y) === TILE.STAIRS_DOWN);
  assert.ok(path && path.length);
  assert.equal(lv.get(path[path.length - 1].x, path[path.length - 1].y), TILE.STAIRS_DOWN);
});

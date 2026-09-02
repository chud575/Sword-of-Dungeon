import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLevel } from '../src/world/generator.js';
import { Level } from '../src/world/level.js';
import { computeVisibility, canSee, computeFov } from '../src/world/fov.js';
import { TILE } from '../src/core/constants.js';
import { createRng } from '../src/core/rng.js';

test('shadowcasting is symmetric between floor tiles', () => {
  const rng = createRng(5);
  let checked = 0;
  for (const seed of [1, 2, 3]) {
    const lv = generateLevel(seed, 3, { monsters: false });
    const floors = [];
    for (let y = 0; y < lv.height; y++) for (let x = 0; x < lv.width; x++) if (lv.isWalkable(x, y)) floors.push({ x, y });
    for (let i = 0; i < 400; i++) {
      const a = rng.pick(floors), b = rng.pick(floors);
      if (Math.abs(a.x - b.x) > 8 || Math.abs(a.y - b.y) > 8) continue;
      const ab = canSee(lv, a.x, a.y, b.x, b.y, 8), ba = canSee(lv, b.x, b.y, a.x, a.y, 8);
      assert.equal(ab, ba, `asymmetric ${JSON.stringify(a)} ${JSON.stringify(b)}`);
      checked++;
    }
  }
  assert.ok(checked > 100);
});

test('computeVisibility reveals origin + neighbours, respects radius and walls, accumulates explored', () => {
  const lv = new Level({ depth: 1, width: 21, height: 21 });
  for (let y = 1; y < 20; y++) for (let x = 1; x < 20; x++) lv.set(x, y, TILE.FLOOR);
  for (let y = 1; y < 20; y++) lv.set(12, y, TILE.WALL); // a wall column
  computeVisibility(lv, 10, 10, 6);
  assert.ok(lv.isVisible(10, 10));
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) assert.ok(lv.isVisible(10 + dx, 10 + dy));
  assert.ok(lv.isVisible(12, 10), 'wall face visible');
  assert.ok(!lv.isVisible(13, 10), 'behind wall hidden');
  assert.ok(!lv.isVisible(15, 10), 'behind wall hidden');
  assert.ok(!lv.isVisible(10, 2), 'beyond radius hidden');
  assert.ok(lv.isVisible(10, 5));
  assert.ok(lv.isExplored(10, 5));
  computeVisibility(lv, 5, 5, 2);
  assert.ok(!lv.isVisible(10, 5) && lv.isExplored(10, 5), 'explored is remembered');
});

test('computeFov calls reveal once per tile', () => {
  const seen = new Map();
  computeFov(0, 0, 5, () => false, (x, y) => { const k = `${x},${y}`; seen.set(k, (seen.get(k) || 0) + 1); });
  for (const [, n] of seen) assert.equal(n, 1);
  assert.ok(seen.size > 60);
});

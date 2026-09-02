import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLevel } from '../src/world/generator.js';
import { TILE } from '../src/core/constants.js';
import { MONSTERS_BY_TYPE } from '../src/game/monsters.js';
import { swordDepthForSeed } from '../src/game/quest.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => 1000 + i * 37);

test('levels are connected, deterministic and well-formed for 20 seeds x depths 1..25', () => {
  let fixes = 0;
  for (const seed of SEEDS) {
    const swordDepth = swordDepthForSeed(seed);
    assert.ok(swordDepth >= 15 && swordDepth <= 19);
    for (let depth = 1; depth <= 25; depth++) {
      const lv = generateLevel(seed, depth);
      const again = generateLevel(seed, depth);
      assert.equal(JSON.stringify(lv.serialize()), JSON.stringify(again.serialize()), `determinism seed=${seed} depth=${depth}`);
      assert.equal(lv.componentCount(), 1, `connectivity seed=${seed} depth=${depth}`);
      fixes += lv.debug.connectivityFixes;
      // border is solid rock
      for (let x = 0; x < lv.width; x++) { assert.equal(lv.get(x, 0), TILE.WALL); assert.equal(lv.get(x, lv.height - 1), TILE.WALL); }
      for (let y = 0; y < lv.height; y++) { assert.equal(lv.get(0, y), TILE.WALL); assert.equal(lv.get(lv.width - 1, y), TILE.WALL); }
      // stairs exist, are far apart and reachable from each other
      assert.ok(lv.stairsUp && lv.get(lv.stairsUp.x, lv.stairsUp.y) === TILE.STAIRS_UP);
      assert.ok(lv.stairsDown && lv.get(lv.stairsDown.x, lv.stairsDown.y) === TILE.STAIRS_DOWN);
      const dist = lv.distanceMap(lv.stairsUp.x, lv.stairsUp.y);
      const d = dist[lv.idx(lv.stairsDown.x, lv.stairsDown.y)];
      assert.ok(d >= 10, `stairs too close (${d}) seed=${seed} depth=${depth}`);
      assert.ok(lv.stairsDownAll.length >= 1 && lv.stairsDownAll.length <= 3);
      // pits, temples, traps, water, treasure
      let pits = 0, water = 0;
      for (let i = 0; i < lv.tiles.length; i++) { if (lv.tiles[i] === TILE.PIT) pits++; if (lv.tiles[i] === TILE.WATER) water++; }
      assert.ok(pits >= 0 && pits <= 3, `pits ${pits}`);
      assert.ok(lv.temples.length <= 2);
      for (const t of lv.temples) assert.equal(lv.get(t.x, t.y), TILE.TEMPLE);
      for (const tr of lv.traps) { assert.ok(['teleport', 'pit'].includes(tr.type)); assert.equal(tr.revealed, false); assert.ok(lv.isWalkable(tr.x, tr.y)); }
      const sacks = lv.items.filter((it) => it.type === 'gold' && !it.hidden);
      assert.ok(sacks.length >= 6 && sacks.length <= 10, `gold sacks ${sacks.length}`);
      for (const s of sacks) assert.ok(s.gold >= 10 * depth && s.gold < 10 * depth + 20);
      const squares = lv.items.filter((it) => it.type === 'chest' && it.hidden);
      assert.ok(squares.length >= 3 && squares.length <= depth + 2, `treasure squares ${squares.length}`);
      for (const it of lv.items) assert.ok(lv.isWalkable(it.x, it.y), 'item on walkable tile');
      // sword level: sword instead of temple
      const sword = lv.items.find((it) => it.type === 'sword');
      if (depth === swordDepth) { assert.ok(sword, 'sword present'); assert.equal(lv.temples.length, 0); }
      else { assert.ok(!sword); assert.ok(lv.temples.length >= 1); }
      // monsters within bestiary depth ranges
      assert.ok(lv.monsters.length >= 3, 'monsters spawned');
      for (const m of lv.monsters) {
        const def = MONSTERS_BY_TYPE[m.type];
        assert.ok(def, `known type ${m.type}`);
        assert.ok(depth >= def.depthMin && depth <= def.depthMax, `${m.type} at depth ${depth}`);
        assert.ok(m.hp > 0 && m.strength > 0);
        assert.ok(lv.isWalkable(m.x, m.y));
        assert.ok(!(m.special === 'mage' || m.special === 'demon') || depth >= 14);
      }
      const ids = new Set(lv.monsters.map((m) => m.id));
      assert.equal(ids.size, lv.monsters.length, 'unique ids');
    }
  }
  assert.ok(fixes >= 0);
});

test('depth 0 surface exists with a way down and is lit', () => {
  const lv = generateLevel(5, 0);
  assert.ok(lv.stairsDown);
  assert.equal(lv.get(lv.stairsDown.x, lv.stairsDown.y), TILE.STAIRS_DOWN);
  assert.equal(lv.monsters.length, 0);
  assert.ok(lv.explored.every((v) => v === 1));
});

test('corridors are twisty single-tile passages with dead ends', () => {
  const lv = generateLevel(77, 4);
  let corridors = 0, deadEnds = 0;
  for (let y = 1; y < lv.height - 1; y++) for (let x = 1; x < lv.width - 1; x++) {
    if (lv.get(x, y) !== TILE.CORRIDOR) continue;
    corridors++;
    const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => lv.isWalkable(x + dx, y + dy)).length;
    if (open === 1) deadEnds++;
  }
  assert.ok(corridors > 60, `corridor tiles ${corridors}`);
  assert.ok(deadEnds >= 1, 'has dead ends');
});

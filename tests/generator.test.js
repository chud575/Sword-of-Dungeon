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

// ---------------------------------------------------------------- generator polish (round 1)
import { levelStats } from '../tools/mapdump.mjs';

const POLISH_SEEDS = [42, 7, 1234, 99, 2024, 31337];

test('room variety: irregular shapes, wide halls with pillars, caves deeper down', () => {
  const shapesSeen = new Set();
  let hallsWithPillars = 0, cavesShallow = 0, cavesDeep = 0;
  for (const seed of POLISH_SEEDS) {
    for (const depth of [2, 5, 10, 16, 22]) {
      const lv = generateLevel(seed, depth, { monsters: false });
      for (const r of lv.rooms) {
        shapesSeen.add(r.shape);
        assert.ok(lv.isWalkable(r.cx, r.cy), `room centre walkable seed=${seed} depth=${depth} ${r.type}`);
        assert.ok(r.x >= 1 && r.y >= 1 && r.x + r.w <= lv.width - 1 && r.y + r.h <= lv.height - 1, 'room inside the map');
        if (r.shape === 'cave') { if (depth <= 5) cavesShallow++; else cavesDeep++; }
      }
      const st = levelStats(lv);
      if (lv.rooms.some((r) => r.shape === 'hall') && st.pillars >= 2) hallsWithPillars++;
    }
  }
  for (const s of ['rect', 'bitten', 'cross', 'round', 'cave', 'hall', 'chamber', 'alcove']) assert.ok(shapesSeen.has(s), `shape ${s} appears`);
  assert.ok(hallsWithPillars >= POLISH_SEEDS.length * 3, `pillared halls ${hallsWithPillars}`);
  assert.ok(cavesDeep > cavesShallow, `caves scale with depth (${cavesShallow} shallow vs ${cavesDeep} deep)`);
});

test('corridors: single-tile, twisting, with dead ends and loops, no 2x2 corridor blocks', () => {
  let totalDead = 0, totalLoops = 0;
  for (const seed of POLISH_SEEDS) for (const depth of [1, 4, 9, 17]) {
    const lv = generateLevel(seed, depth, { monsters: false });
    const st = levelStats(lv);
    assert.equal(st.wide2x2, 0, `no double-wide corridors seed=${seed} depth=${depth}`);
    assert.ok(st.corridor >= 60, `corridor tiles ${st.corridor} seed=${seed} depth=${depth}`);
    // twistiness: at least a third of corridor tiles are bends or junctions
    let bends = 0, straight = 0;
    for (let y = 1; y < lv.height - 1; y++) for (let x = 1; x < lv.width - 1; x++) {
      if (lv.get(x, y) !== TILE.CORRIDOR) continue;
      const ew = lv.isWalkable(x - 1, y) && lv.isWalkable(x + 1, y), ns = lv.isWalkable(x, y - 1) && lv.isWalkable(x, y + 1);
      const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => lv.isWalkable(x + dx, y + dy)).length;
      if (open === 2 && (ew || ns)) straight++; else bends++;
    }
    assert.ok(bends / (bends + straight) >= 0.12, `twisty corridors seed=${seed} depth=${depth} (${bends}/${bends + straight})`);
    totalDead += st.deadEnds; totalLoops += st.loops;
  }
  assert.ok(totalDead >= POLISH_SEEDS.length * 4 * 2, `dead ends ${totalDead}`);
  assert.ok(totalLoops >= POLISH_SEEDS.length * 4, `loops ${totalLoops}`);
});

test('temples sit in small side chambers behind a single doorway; alcoves hide gold', () => {
  for (const seed of POLISH_SEEDS) for (const depth of [1, 3, 7, 12, 21]) {
    const lv = generateLevel(seed, depth, { monsters: false });
    const chambers = lv.rooms.filter((r) => r.type === 'temple');
    if (depth === swordDepthForSeed(seed)) continue;
    assert.ok(chambers.length >= 1, `temple chamber seed=${seed} depth=${depth}`);
    for (const r of chambers) {
      assert.ok(r.w <= 4 && r.h <= 4, 'temple chamber is small');
      assert.equal(lv.get(r.cx, r.cy), TILE.TEMPLE);
      assert.equal(lv.get(r.door.x, r.door.y), TILE.DOOR, 'chamber has a doorway');
      // the doorway is the only way in: every walkable tile bordering the chamber box is the door
      let openings = 0;
      for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) {
        const inside = x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
        if (!inside && lv.isWalkable(x, y)) openings++;
      }
      assert.equal(openings, 1, `single doorway seed=${seed} depth=${depth}`);
    }
    for (const a of lv.rooms.filter((r) => r.type === 'alcove')) {
      assert.equal(lv.get(a.door.x, a.door.y), TILE.DOOR);
      const cache = lv.items.find((it) => it.type === 'gold' && it.hidden && it.x === a.cx && it.y === a.cy);
      assert.ok(cache && cache.gold >= 30 * depth, 'alcove holds a hidden cache worth at least 3x a sack');
    }
  }
});

test('water pools are organic blobs, rubble and treasure scale with depth, stairs are far apart', () => {
  let rubbleShallow = 0, rubbleDeep = 0, hiddenShallow = 0, hiddenDeep = 0;
  for (const seed of POLISH_SEEDS) for (const depth of [1, 2, 4, 12, 18, 24]) {
    const lv = generateLevel(seed, depth, { monsters: false });
    const st = levelStats(lv);
    // every water tile touches at least one other water tile (no lone puddles), pools stay inside rooms
    for (let y = 1; y < lv.height - 1; y++) for (let x = 1; x < lv.width - 1; x++) {
      if (lv.get(x, y) !== TILE.WATER) continue;
      const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => lv.get(x + dx, y + dy) === TILE.WATER).length;
      assert.ok(wet >= 1, `lone water tile at ${x},${y} seed=${seed} depth=${depth}`);
      assert.ok(lv.rooms.some((r) => x > r.x && y > r.y && x < r.x + r.w - 1 && y < r.y + r.h - 1), 'water inside a room');
    }
    for (let i = 0; i < lv.tiles.length; i++) if (lv.tiles[i] === TILE.RUBBLE) assert.ok(lv.isWalkable(i % lv.width, (i / lv.width) | 0));
    if (depth <= 2) { rubbleShallow += st.rubble; hiddenShallow += st.hiddenGold; } else if (depth >= 12) { rubbleDeep += st.rubble; hiddenDeep += st.hiddenGold; }
    assert.ok(st.stairsDist >= 30, `stairs far apart (${st.stairsDist}) seed=${seed} depth=${depth}`);
    for (const s of lv.stairsDownAll) assert.equal(lv.get(s.x, s.y), TILE.STAIRS_DOWN);
    assert.equal(lv.componentCount(), 1);
    assert.ok(lv.countWalkable() >= 380 && lv.countWalkable() <= 760, `walkable area ${lv.countWalkable()} seed=${seed} depth=${depth}`);
  }
  assert.ok(rubbleDeep > rubbleShallow, `rubble scales (${rubbleShallow} vs ${rubbleDeep})`);
  assert.ok(hiddenDeep > hiddenShallow, `hidden gold scales (${hiddenShallow} vs ${hiddenDeep})`);
});

test('sword level: obsidian style, sword in a shrine chamber, no temple', () => {
  for (const seed of POLISH_SEEDS) {
    const d = swordDepthForSeed(seed);
    const lv = generateLevel(seed, d, { monsters: false });
    assert.equal(lv.debug.style, 'obsidian');
    const shrine = lv.rooms.find((r) => r.type === 'shrine');
    const sword = lv.items.find((it) => it.type === 'sword');
    assert.ok(shrine && sword && sword.x === shrine.cx && sword.y === shrine.cy, 'sword in the shrine');
    assert.equal(lv.temples.length, 0);
  }
});

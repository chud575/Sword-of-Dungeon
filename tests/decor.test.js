// Ambience placement: the contract in docs/AMBIENCE.md, enforced.
// Decor must be deterministic, must never sit on a forbidden tile, must never sever a level,
// and a level must read as a set of different places rather than one repeated room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLevel, DECOR_TYPES, ARCHETYPES } from '../src/world/generator.js';
import { Level } from '../src/world/level.js';
import { TILE, DIRS4, DIRS8 } from '../src/core/constants.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => 1000 + i * 37);
const SMALL = [42, 7, 1234, 99, 2024, 31337];
const SIDE = new Set(['temple', 'shrine', 'alcove', 'surface']);
const BLOCKABLE = new Set(['sarcophagus', 'fallenColumn', 'pillarBroken', 'rubbleMound', 'stalagmite',
  'wellHead', 'cage', 'forge', 'anvil']);
const CORRIDOR_OK = new Set(['bones', 'scree', 'puddle', 'sconce', 'cobweb', 'wallCrack', 'skull',
  'bloodstain', 'mould', 'rat', 'rubbleMound']);
const FACING = { n: { dx: 0, dy: -1 }, e: { dx: 1, dy: 0 }, s: { dx: 0, dy: 1 }, w: { dx: -1, dy: 0 } };
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** The tiles of a room that decor accounting cares about. */
function roomFloorTiles(lv, r) {
  const out = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    const t = lv.get(x, y);
    if (t === TILE.FLOOR || t === TILE.RUBBLE) out.push({ x, y });
  }
  return out;
}

test('decor is deterministic: the same seed and depth build a byte-identical level.decor', () => {
  for (const seed of SMALL) for (const depth of [0, 1, 4, 9, 17, 25]) {
    const a = generateLevel(seed, depth, { monsters: false });
    const b = generateLevel(seed, depth, { monsters: false });
    assert.deepEqual(a.decor, b.decor, `decor determinism seed=${seed} depth=${depth}`);
    assert.deepEqual(a.rooms.map((r) => [r.archetype, r.lightMood, r.decay, r.decorSeed]),
      b.rooms.map((r) => [r.archetype, r.lightMood, r.decay, r.decorSeed]), 'archetype determinism');
    const other = generateLevel(seed + 1, depth, { monsters: false });
    if (depth > 0) assert.notDeepEqual(a.decor, other.decor, 'a different seed dresses a different level');
  }
});

test('every decor entry obeys the data contract (§4.1, §5)', () => {
  for (const seed of SMALL) for (const depth of [1, 3, 8, 14, 20, 25]) {
    const lv = generateLevel(seed, depth);
    assert.ok(Array.isArray(lv.decor));
    for (const d of lv.decor) {
      const where = `seed=${seed} depth=${depth} ${d.type}@${d.x},${d.y}`;
      assert.equal(Object.keys(d).length, 6, `exactly the six contract fields (${where})`);
      const def = DECOR_TYPES[d.type];
      assert.ok(def, `known type (${where})`);
      assert.ok(Number.isInteger(d.x) && Number.isInteger(d.y) && lv.inBounds(d.x, d.y), `in bounds (${where})`);
      assert.ok(['n', 'e', 's', 'w'].includes(d.facing), `facing (${where})`);
      assert.ok(Number.isInteger(d.variant) && d.variant >= 0 && d.variant < def.v, `variant (${where})`);
      assert.equal(typeof d.blocking, 'boolean');
      if (d.blocking) assert.ok(BLOCKABLE.has(d.type), `only a blockable type may block (${where})`);
      if (def.cls === 'wall') {
        assert.equal(lv.get(d.x, d.y), TILE.WALL, `a wall piece hangs on a wall (${where})`);
        const f = FACING[d.facing];
        assert.notEqual(lv.get(d.x + f.dx, d.y + f.dy), TILE.WALL, `a wall piece has a viewer (${where})`);
        assert.equal(d.blocking, false, 'wall pieces never block');
      } else {
        assert.ok(lv.get(d.x, d.y) !== TILE.WALL, `floor decor stands on floor (${where})`);
      }
    }
    // two standing props may never share a tile; two decals may never share a tile (§8.2 rule 12);
    // and one wall tile carries at most one hung piece (§8.2 rule 11)
    const props = new Set(), decals = new Set(), mounts = new Set();
    for (const d of lv.decor) {
      const k = `${d.x},${d.y}`, cls = DECOR_TYPES[d.type].cls;
      if (cls === 'prop') { assert.ok(!props.has(k), `one prop per tile ${k}`); props.add(k); }
      if (cls === 'decal') { assert.ok(!decals.has(k), `one decal per tile ${k}`); decals.add(k); }
      if (cls === 'wall') { assert.ok(!mounts.has(k), `one hung piece per wall tile ${k}`); mounts.add(k); }
    }
    assert.ok(lv.decor.length <= 220, `level decor budget ${lv.decor.length}`);
  }
});

test('no decor sits on a forbidden tile (§4.4)', () => {
  for (const seed of SEEDS.slice(0, 10)) for (const depth of [1, 2, 6, 11, 16, 19, 23]) {
    const lv = generateLevel(seed, depth);
    const stairs = [lv.stairsUp, ...lv.stairsDownAll].filter(Boolean);
    for (const d of lv.decor) {
      const where = `seed=${seed} depth=${depth} ${d.type}@${d.x},${d.y}`;
      const t = lv.get(d.x, d.y);
      if (DECOR_TYPES[d.type].cls === 'wall') continue;   // mounted on the rock itself
      assert.ok(t !== TILE.DOOR && t !== TILE.STAIRS_UP && t !== TILE.STAIRS_DOWN && t !== TILE.TEMPLE
        && t !== TILE.PIT && t !== TILE.WATER && t !== TILE.TRAP_TELEPORT && t !== TILE.TRAP_PIT, `tile type (${where})`);
      assert.ok(!lv.trapAt(d.x, d.y), `never marks a hidden trap (${where})`);
      assert.ok(!lv.itemsAt(d.x, d.y).length, `never buries an item (${where})`);
      if (DECOR_TYPES[d.type].cls === 'prop') assert.notEqual(t, TILE.RUBBLE, `rubble takes decals only (${where})`);
      for (const s of stairs) assert.ok(cheb(s, d) > 1, `nothing crowds a staircase (${where})`);
      for (const dir of DIRS4) assert.notEqual(lv.get(d.x + dir.dx, d.y + dir.dy), TILE.DOOR, `door throat clear (${where})`);
    }
  }
});

test('every level stays fully connected with decor placed, 20 seeds x depths 1..25 (§4.3)', () => {
  let levels = 0, cleanFills = 0, blockingTotal = 0;
  for (const seed of SEEDS) for (let depth = 1; depth <= 25; depth++) {
    const lv = generateLevel(seed, depth, { monsters: false });
    const where = `seed=${seed} depth=${depth}`;
    levels++;
    blockingTotal += lv.decor.filter((d) => d.blocking).length;
    if ((lv.debug.decor.blockDrops || 0) === 0) cleanFills++;
    assert.equal(lv.componentCount(), 1, `connectivity ${where}`);
    // everything the run needs is still reachable from the way in
    const reach = lv.floodFill(lv.stairsUp.x, lv.stairsUp.y);
    const reached = (p) => reach[lv.idx(p.x, p.y)] === 1;
    for (const s of [lv.stairsUp, ...lv.stairsDownAll]) assert.ok(reached(s), `staircase reachable ${where}`);
    for (const t of lv.temples) assert.ok(reached(t), `temple reachable ${where}`);
    for (const it of lv.items) assert.ok(reached(it), `item reachable ${where} ${it.type}`);
    for (const r of lv.rooms) assert.ok(reached({ x: r.cx, y: r.cy }), `room centre reachable ${where} ${r.type}`);
    for (const d of lv.decor) {
      if (!d.blocking) continue;
      assert.equal(lv.get(d.x, d.y), TILE.FLOOR, `blocking only on room floor ${where}`);
      for (const dir of DIRS8) {
        const t = lv.get(d.x + dir.dx, d.y + dir.dy);
        assert.ok(t !== TILE.STAIRS_UP && t !== TILE.STAIRS_DOWN && t !== TILE.TEMPLE && t !== TILE.DOOR
          && t !== TILE.PIT && t !== TILE.CORRIDOR, `blocking keeps its distance ${where}`);
      }
    }
    for (const r of lv.rooms) {
      const floor = roomFloorTiles(lv, r);
      const blocking = lv.decor.filter((d) => d.blocking && d.x >= r.x && d.y >= r.y && d.x < r.x + r.w && d.y < r.y + r.h);
      assert.ok(blocking.length <= 2, `at most two blocking pieces per room ${where}`);
      assert.ok(blocking.length <= Math.floor(floor.length / 12), `one blocking piece per twelve tiles ${where}`);
    }
  }
  assert.ok(blockingTotal > 100, `blocking decor does get used (${blockingTotal})`);
  assert.ok(cleanFills / levels >= 0.95, `the flood fill needs no rescue on 95% of levels (${cleanFills}/${levels})`);
});

test('a room reads as walkable floor: density stays inside §8.3', () => {
  for (const seed of SEEDS.slice(0, 8)) for (const depth of [1, 5, 10, 15, 20, 24]) {
    const lv = generateLevel(seed, depth, { monsters: false });
    for (const r of lv.rooms) {
      const floor = roomFloorTiles(lv, r);
      if (!floor.length) continue;
      const inside = new Set(floor.map((t) => `${t.x},${t.y}`));
      const mine = lv.decor.filter((d) => DECOR_TYPES[d.type].cls !== 'wall' && inside.has(`${d.x},${d.y}`));
      const tiles = new Set(mine.map((d) => `${d.x},${d.y}`));
      const props = new Set(mine.filter((d) => DECOR_TYPES[d.type].cls === 'prop').map((d) => `${d.x},${d.y}`));
      const where = `seed=${seed} depth=${depth} ${r.type}/${r.archetype} floor=${floor.length}`;
      assert.ok(tiles.size <= Math.max(1, Math.floor(0.35 * floor.length)), `35% any decor (${where} ${tiles.size})`);
      assert.ok(props.size <= Math.max(1, Math.floor(0.18 * floor.length)), `18% standing props (${where} ${props.size})`);
      assert.ok(floor.length - tiles.size >= Math.ceil(0.55 * floor.length) || floor.length <= 2,
        `55% clear floor (${where} ${floor.length - tiles.size})`);
    }
  }
});

test('corridors stay bare (§3)', () => {
  for (const seed of SEEDS.slice(0, 10)) for (const depth of [1, 4, 9, 15, 21]) {
    const lv = generateLevel(seed, depth, { monsters: false });
    let corridorTiles = 0, deadEnds = 0;
    for (let y = 1; y < lv.height - 1; y++) for (let x = 1; x < lv.width - 1; x++) {
      if (lv.get(x, y) !== TILE.CORRIDOR) continue;
      corridorTiles++;
      if (DIRS4.filter((d) => lv.isWalkable(x + d.dx, y + d.dy)).length === 1) deadEnds++;
    }
    // a corridor piece is one that stands on a corridor tile, or hangs on a wall looking at one
    const pieces = lv.decor.filter((d) => {
      if (DECOR_TYPES[d.type].cls === 'wall') {
        const f = FACING[d.facing];
        return lv.get(d.x + f.dx, d.y + f.dy) === TILE.CORRIDOR;
      }
      return lv.get(d.x, d.y) === TILE.CORRIDOR;
    });
    const where = `seed=${seed} depth=${depth}`;
    assert.ok(pieces.length <= Math.min(12, Math.floor(corridorTiles / 10)) + 6,
      `corridor budget ${pieces.length} of ${corridorTiles} tiles ${where}`);
    for (const d of pieces) {
      assert.ok(CORRIDOR_OK.has(d.type), `only the corridor catalogue (${d.type}) ${where}`);
      assert.equal(d.blocking, false, `corridor decor never blocks ${where}`);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        assert.notEqual(lv.get(d.x + dx, d.y + dy), TILE.DOOR, `two tiles clear of a doorway ${where}`);
      }
    }
    const spots = pieces.map((d) => (DECOR_TYPES[d.type].cls === 'wall'
      ? { x: d.x + FACING[d.facing].dx, y: d.y + FACING[d.facing].dy } : { x: d.x, y: d.y }));
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
      assert.ok(cheb(spots[i], spots[j]) >= 2, `corridor pieces keep two tiles apart ${where}`);
    }
    assert.ok(deadEnds >= 0);
  }
});

test('rooms get varied archetypes, capped, banded, and a quarter of them deliberately bare (§6)', () => {
  const seen = new Map();
  let levels = 0, distinctMin = 99, bareMin = 1, bareMax = 0;
  for (const seed of SEEDS) for (const depth of [1, 3, 6, 9, 12, 15, 18, 21, 24]) {
    const lv = generateLevel(seed, depth, { monsters: false });
    const where = `seed=${seed} depth=${depth}`;
    const main = lv.rooms.filter((r) => !SIDE.has(r.type));
    const counts = {};
    for (const r of lv.rooms) {
      assert.ok(ARCHETYPES[r.archetype], `known archetype ${r.archetype} ${where}`);
      assert.ok(typeof r.lightMood === 'string' && r.lightMood.length, `light mood ${where}`);
      assert.ok(r.decay >= 0 && r.decay <= 1, `decay ${where}`);
      assert.ok(Number.isInteger(r.decorSeed) && r.decorSeed > 0, `decor seed ${where}`);
      if (r.type === 'temple' || r.type === 'shrine') assert.equal(r.archetype, 'shrine', `side room ${where}`);
      if (r.type === 'alcove') assert.equal(r.archetype, 'bare', `alcove ${where}`);
      counts[r.archetype] = (counts[r.archetype] || 0) + 1;
      seen.set(r.archetype, (seen.get(r.archetype) || 0) + 1);
    }
    for (const [id, n] of Object.entries(counts)) {
      if (id === 'shrine') continue;
      assert.ok(n <= ARCHETYPES[id].cap, `per-level cap ${id} ${n} ${where}`);
    }
    if (main.length >= 6) {
      levels++;
      const distinct = new Set(main.map((r) => r.archetype)).size;
      distinctMin = Math.min(distinctMin, distinct);
      assert.ok(distinct >= 3, `a level is not one room repeated (${distinct} identities) ${where}`);
      const bare = main.filter((r) => r.archetype === 'bare').length / main.length;
      bareMin = Math.min(bareMin, bare); bareMax = Math.max(bareMax, bare);
      assert.ok(bare >= 0.25 - 1e-9, `at least a quarter bare (${bare.toFixed(2)}) ${where}`);
      assert.ok(bare <= 0.75, `not a level of empty rooms (${bare.toFixed(2)}) ${where}`);
    }
    // the signature piece is actually there
    for (const r of lv.rooms) {
      const sig = ARCHETYPES[r.archetype].sig;
      if (!sig || SIDE.has(r.type)) continue;
      const has = lv.decor.some((d) => d.type === sig && d.x >= r.x - 1 && d.y >= r.y - 1 && d.x <= r.x + r.w && d.y <= r.y + r.h);
      assert.ok(has, `${r.archetype} has its ${sig} ${where}`);
    }
  }
  assert.ok(levels > 100);
  assert.ok(seen.size >= 18, `the catalogue of identities gets used (${seen.size})`);
  for (const id of ['guardroom', 'crypt', 'armoury', 'storeroom', 'collapsed', 'flooded', 'audience'])
    assert.ok((seen.get(id) || 0) > 0, `${id} appears somewhere`);
});

test('decor survives a save: serialize round-trips it, and old saves without it still load', () => {
  const lv = generateLevel(4242, 12);
  const back = Level.deserialize(JSON.parse(JSON.stringify(lv.serialize())));
  assert.deepEqual(back.decor, lv.decor);
  for (const d of lv.decor.filter((e) => e.blocking)) assert.equal(back.decorBlocked(d.x, d.y), true);
  assert.equal(back.componentCount(), lv.componentCount());
  const old = lv.serialize();
  delete old.decor;
  const legacy = Level.deserialize(JSON.parse(JSON.stringify(old)));
  assert.deepEqual(legacy.decor, []);
  assert.equal(legacy.decorBlocked(lv.stairsUp.x, lv.stairsUp.y), false);
});

test('the surface courtyard is dressed and keeps its temple and stairs clear', () => {
  const lv = generateLevel(11, 0);
  assert.equal(lv.rooms[0].archetype, 'courtyard');
  assert.ok(lv.decor.length >= 1, 'the courtyard is dressed');
  for (const d of lv.decor) {
    if (DECOR_TYPES[d.type].cls === 'wall') continue;
    const t = lv.get(d.x, d.y);
    assert.ok(t !== TILE.TEMPLE && t !== TILE.STAIRS_DOWN && t !== TILE.WATER);
    assert.equal(d.blocking, false, 'nothing blocks the way down on the surface');
  }
  assert.equal(lv.componentCount(), 1);
});

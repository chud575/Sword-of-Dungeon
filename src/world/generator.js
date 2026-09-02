// Procedural level generator: rooms + random-walk tunnels in the spirit of the 1982 digger,
// with guaranteed connectivity, far-apart stairs, pits, temples, water, hidden traps, treasure
// and depth-scaled monsters. Pure: same (seed, depth) => same Level.
import { TILE, MAP_WIDTH, MAP_HEIGHT, DIRS4, BALANCE } from '../core/constants.js';
import { createRng, seedFrom } from '../core/rng.js';
import { Level } from './level.js';
import { rollMonster } from '../game/monsters.js';
import { goldValue, rollTreasure, rollTrap } from '../game/items.js';
import { swordDepthForSeed, placeSword } from '../game/quest.js';

const ROOM_TYPES = ['hall', 'crypt', 'cistern', 'library', 'barracks', 'vault'];

/**
 * Generate a level.
 * @param {number|string} seed game seed
 * @param {number} depth 0 = surface, 1.. = dungeon
 * @param {{width?:number, height?:number, swordDepth?:number, balance?:object, monsters?:boolean}} opts
 * @returns {Level}
 */
export function generateLevel(seed, depth, opts = {}) {
  const width = opts.width ?? MAP_WIDTH, height = opts.height ?? MAP_HEIGHT;
  const balance = opts.balance || BALANCE.classic;
  const swordDepth = opts.swordDepth ?? swordDepthForSeed(seed, balance);
  const levelSeed = seedFrom(seed, 'level', depth);
  const rng = createRng(levelSeed);
  const level = new Level({ depth, width, height, seed: levelSeed });
  if (depth === 0) return generateSurface(level, rng);
  const isSwordLevel = depth === swordDepth;

  carveRooms(level, rng, isSwordLevel);
  carveTunnels(level, rng);
  ensureConnectivity(level, rng);
  placeStairs(level, rng);
  placeTemples(level, rng, isSwordLevel);
  placePits(level, rng);
  placeWater(level, rng);
  placeTraps(level, rng);
  placeTreasure(level, rng);
  if (opts.monsters !== false) spawnMonsters(level, rng, balance);
  return level;
}

function generateSurface(level, rng) {
  // A small courtyard at the mountain's foot: the temple of Ferrin and the way down.
  const w = 9, h = 7;
  const x0 = Math.floor(level.width / 2 - w / 2), y0 = Math.floor(level.height / 2 - h / 2);
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) level.set(x, y, TILE.FLOOR);
  level.rooms.push({ x: x0, y: y0, w, h, type: 'surface', cx: x0 + (w >> 1), cy: y0 + (h >> 1) });
  const cx = x0 + (w >> 1), cy = y0 + (h >> 1);
  level.set(cx, cy, TILE.STAIRS_DOWN);
  level.stairsDown = { x: cx, y: cy };
  level.stairsDownAll = [{ x: cx, y: cy }];
  level.set(x0 + 1, y0 + 1, TILE.TEMPLE);
  level.temples.push({ x: x0 + 1, y: y0 + 1 });
  for (let i = 0; i < 3; i++) level.set(x0 + w - 2, y0 + 1 + i, TILE.WATER);
  level.revealAll();
  void rng;
  return level;
}

function overlaps(level, x, y, w, h, margin) {
  for (const r of level.rooms) {
    if (x < r.x + r.w + margin && x + w + margin > r.x && y < r.y + r.h + margin && y + h + margin > r.y) return true;
  }
  return false;
}

function carveRoom(level, room) {
  for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) level.set(x, y, TILE.FLOOR);
  level.rooms.push(room);
}

function carveRooms(level, rng, isSwordLevel) {
  const W = level.width, H = level.height;
  const count = rng.int(9, 13);
  let placed = 0, attempts = 0;
  while (placed < count && attempts < 400) {
    attempts++;
    const w = rng.int(3, 9), h = rng.int(3, 6);
    const x = rng.int(1, W - w - 2), y = rng.int(1, H - h - 2);
    const margin = rng.chance(0.15) ? -1 : 1; // occasionally rooms may merge like the original
    if (overlaps(level, x, y, w, h, margin)) continue;
    carveRoom(level, { x, y, w, h, type: rng.pick(ROOM_TYPES), cx: x + (w >> 1), cy: y + (h >> 1) });
    placed++;
  }
  // Small temple/shrine rooms (0-2). The sword level gets exactly one shrine for the sword.
  const shrines = isSwordLevel ? 1 : (rng.chance(0.25) ? 2 : 1);
  let shrinePlaced = 0; attempts = 0;
  while (shrinePlaced < shrines && attempts < 300) {
    attempts++;
    const w = rng.int(3, 4), h = rng.int(3, 4);
    const x = rng.int(1, W - w - 2), y = rng.int(1, H - h - 2);
    if (overlaps(level, x, y, w, h, 1)) continue;
    carveRoom(level, { x, y, w, h, type: isSwordLevel ? 'shrine' : 'temple', cx: x + (w >> 1), cy: y + (h >> 1) });
    shrinePlaced++;
  }
}

/** Random-walk tunnel from (sx,sy) [VIC lines 8–25]: stop when it breaks through rock into open space. */
function digTunnel(level, rng, sx, sy, maxSteps = 500) {
  let x = sx, y = sy, prev = -1, throughRock = false, steps = 0;
  const W = level.width, H = level.height;
  while (steps < maxSteps) {
    let dir;
    do { dir = rng.int(0, 3); } while (dir === (prev ^ 2) && prev >= 0 && rng.chance(0.9));
    const len = rng.int(5, 9);
    for (let i = 0; i < len && steps < maxSteps; i++) {
      const nx = x + DIRS4[dir].dx, ny = y + DIRS4[dir].dy;
      if (nx < 1 || ny < 1 || nx > W - 2 || ny > H - 2) break;
      steps++;
      if (level.get(nx, ny) === TILE.WALL) { level.set(nx, ny, TILE.CORRIDOR); throughRock = true; }
      else if (throughRock) return true; // broke into existing open space
      x = nx; y = ny;
    }
    prev = dir;
  }
  return false;
}

function carveTunnels(level, rng) {
  for (const r of level.rooms) digTunnel(level, rng, r.cx, r.cy);
  // A few extra passages for loops and dead ends.
  const extra = rng.int(2, 4);
  for (let i = 0; i < extra; i++) {
    const r = rng.pick(level.rooms);
    digTunnel(level, rng, rng.int(r.x, r.x + r.w - 1), rng.int(r.y, r.y + r.h - 1), 120);
  }
  // Short dead-end stubs off corridors.
  const stubs = rng.int(1, 3);
  for (let i = 0; i < stubs; i++) {
    const t = pickTile(level, rng, (x, y) => level.get(x, y) === TILE.CORRIDOR);
    if (!t) continue;
    let { x, y } = t;
    const d = rng.pick(DIRS4);
    const len = rng.int(2, 5);
    for (let k = 0; k < len; k++) {
      const nx = x + d.dx, ny = y + d.dy;
      if (nx < 1 || ny < 1 || nx > level.width - 2 || ny > level.height - 2) break;
      if (level.get(nx, ny) !== TILE.WALL) break;
      level.set(nx, ny, TILE.CORRIDOR);
      x = nx; y = ny;
    }
  }
}

function pickTile(level, rng, pred, tries = 300) {
  for (let i = 0; i < tries; i++) {
    const x = rng.int(1, level.width - 2), y = rng.int(1, level.height - 2);
    if (pred(x, y)) return { x, y };
  }
  const all = [];
  for (let y = 1; y < level.height - 1; y++) for (let x = 1; x < level.width - 1; x++) if (pred(x, y)) all.push({ x, y });
  return all.length ? rng.pick(all) : null;
}

/** Connect every walkable component to the main one with an L-shaped corridor [designed fix]. */
function ensureConnectivity(level, rng) {
  for (let guard = 0; guard < 50; guard++) {
    const main = level.floodFill(level.rooms[0].cx, level.rooms[0].cy);
    let target = null;
    outer: for (let y = 1; y < level.height - 1; y++) for (let x = 1; x < level.width - 1; x++) {
      if (level.isWalkable(x, y) && !main[level.idx(x, y)]) { target = { x, y }; break outer; }
    }
    if (!target) return;
    // nearest main-component tile
    let best = null, bestD = Infinity;
    for (let y = 1; y < level.height - 1; y++) for (let x = 1; x < level.width - 1; x++) {
      if (!main[level.idx(x, y)]) continue;
      const d = Math.abs(x - target.x) + Math.abs(y - target.y);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
    carveL(level, rng, target, best);
    level.debug.connectivityFixes++;
  }
}

function carveL(level, rng, a, b) {
  const horizontalFirst = rng.chance(0.5);
  let x = a.x, y = a.y;
  const carve = (cx, cy) => { if (level.get(cx, cy) === TILE.WALL) level.set(cx, cy, TILE.CORRIDOR); };
  const goX = () => { while (x !== b.x) { x += Math.sign(b.x - x); carve(x, y); } };
  const goY = () => { while (y !== b.y) { y += Math.sign(b.y - y); carve(x, y); } };
  if (horizontalFirst) { goX(); goY(); } else { goY(); goX(); }
}

function roomTiles(level, pred) {
  const out = [];
  for (const r of level.rooms) {
    if (r.type === 'temple' || r.type === 'shrine') continue;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (pred(x, y)) out.push({ x, y, room: r });
  }
  return out;
}

function placeStairs(level, rng) {
  const plain = (x, y) => level.get(x, y) === TILE.FLOOR;
  const candidates = roomTiles(level, plain);
  const up = rng.pick(candidates);
  level.set(up.x, up.y, TILE.STAIRS_UP);
  level.stairsUp = { x: up.x, y: up.y };
  const dist = level.distanceMap(up.x, up.y);
  let far = null, farD = -1;
  for (const c of candidates) {
    const d = dist[level.idx(c.x, c.y)];
    if (d > farD && c.room !== up.room) { farD = d; far = c; }
  }
  if (!far) far = rng.pick(candidates.filter((c) => c.x !== up.x || c.y !== up.y)) || up;
  const downs = [far];
  const extra = rng.int(1, 2); // 2–3 down staircases like the original
  for (let i = 0; i < extra; i++) {
    const c = rng.pick(candidates.filter((t) => plain(t.x, t.y) && dist[level.idx(t.x, t.y)] >= 12 && !downs.some((d) => Math.abs(d.x - t.x) + Math.abs(d.y - t.y) < 8)));
    if (c) downs.push(c);
  }
  for (const d of downs) level.set(d.x, d.y, TILE.STAIRS_DOWN);
  level.stairsDown = { x: far.x, y: far.y };
  level.stairsDownAll = downs.map((d) => ({ x: d.x, y: d.y }));
}

function placeTemples(level, rng, isSwordLevel) {
  const shrineRooms = level.rooms.filter((r) => r.type === 'temple' || r.type === 'shrine');
  if (isSwordLevel) {
    const r = shrineRooms[0];
    const pos = r ? { x: r.cx, y: r.cy } : rng.pick(roomTiles(level, (x, y) => level.get(x, y) === TILE.FLOOR));
    placeSword(level, pos.x, pos.y);
    return;
  }
  for (const r of shrineRooms) {
    level.set(r.cx, r.cy, TILE.TEMPLE);
    level.temples.push({ x: r.cx, y: r.cy });
  }
  if (!level.temples.length) {
    const pos = rng.pick(roomTiles(level, (x, y) => level.get(x, y) === TILE.FLOOR));
    level.set(pos.x, pos.y, TILE.TEMPLE);
    level.temples.push({ x: pos.x, y: pos.y });
  }
}

function nearSpecial(level, x, y, r = 1) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const t = level.get(x + dx, y + dy);
    if (t === TILE.STAIRS_UP || t === TILE.STAIRS_DOWN || t === TILE.TEMPLE || t === TILE.PIT) return true;
  }
  return false;
}

function placePits(level, rng) {
  const n = level.depth < 2 ? rng.int(0, 1) : rng.int(0, 3);
  for (let i = 0; i < n; i++) {
    const t = pickTile(level, rng, (x, y) => level.get(x, y) === TILE.FLOOR && !nearSpecial(level, x, y, 2) && !level.itemsAt(x, y).length);
    if (t) level.set(t.x, t.y, TILE.PIT);
  }
}

function placeWater(level, rng) {
  const pools = rng.int(0, 3);
  for (let i = 0; i < pools; i++) {
    const rooms = level.rooms.filter((r) => r.type !== 'temple' && r.type !== 'shrine' && r.w >= 4 && r.h >= 4);
    if (!rooms.length) return;
    const r = rng.chance(0.5) ? rooms.find((q) => q.type === 'cistern') || rng.pick(rooms) : rng.pick(rooms);
    let x = rng.int(r.x + 1, r.x + r.w - 2), y = rng.int(r.y + 1, r.y + r.h - 2);
    const size = rng.int(3, 9);
    for (let k = 0; k < size * 3 && k < 60; k++) {
      if (level.get(x, y) === TILE.FLOOR && !level.itemsAt(x, y).length) level.set(x, y, TILE.WATER);
      const d = rng.pick(DIRS4);
      const nx = x + d.dx, ny = y + d.dy;
      if (nx > r.x && ny > r.y && nx < r.x + r.w - 1 && ny < r.y + r.h - 1) { x = nx; y = ny; }
    }
  }
}

function placeTraps(level, rng) {
  // Shallow levels only hide teleport traps; a hidden pit on level 1 would end a run in seconds.
  const n = level.depth <= 2 ? rng.int(0, 1) : rng.int(1, 3) + Math.floor(level.depth / 6);
  for (let i = 0; i < n; i++) {
    const t = pickTile(level, rng, (x, y) => (level.get(x, y) === TILE.CORRIDOR || level.get(x, y) === TILE.FLOOR)
      && !nearSpecial(level, x, y, 1) && !level.trapAt(x, y) && !level.itemsAt(x, y).length);
    if (!t) continue;
    const type = level.depth <= 2 || rng.chance(0.55) ? 'teleport' : 'pit';
    level.traps.push({ x: t.x, y: t.y, type, revealed: false });
  }
}

function placeTreasure(level, rng) {
  const d = level.depth;
  const free = (x, y) => level.isEmptyFloor(x, y) && level.get(x, y) !== TILE.WATER && !level.trapAt(x, y);
  const bags = Math.floor(5 * rng.next() + 6);
  for (let i = 0; i < bags; i++) {
    const t = pickTile(level, rng, free);
    if (t) level.addItem({ type: 'gold', x: t.x, y: t.y, qty: 1, gold: goldValue(rng, d), hidden: false });
  }
  const buried = rng.int(0, 2);
  for (let i = 0; i < buried; i++) {
    const t = pickTile(level, rng, free);
    if (t) level.addItem({ type: 'gold', x: t.x, y: t.y, qty: 1, gold: goldValue(rng, d) * 2, hidden: true });
  }
  const squares = Math.floor(d * rng.next() + 3);
  for (let i = 0; i < squares; i++) {
    const t = pickTile(level, rng, free);
    if (!t) continue;
    const trap = rollTrap(rng);
    const content = trap ? null : rollTreasure(rng, d);
    level.addItem({ type: 'chest', x: t.x, y: t.y, qty: 1, hidden: true, trap, content });
  }
  if (d >= 2 && rng.chance(0.5)) {
    const t = pickTile(level, rng, free);
    if (t) level.addItem({ type: 'chest', x: t.x, y: t.y, qty: 1, hidden: false, trap: null, content: rollTreasure(rng, d) });
  }
}

function spawnMonsters(level, rng, balance) {
  const d = level.depth;
  const creatures = Math.floor(3 * rng.next() + 1) + 1 + Math.floor(d / 12);
  const humans = Math.floor(3 * rng.next()) + 1 + Math.floor(d / 15);
  const up = level.stairsUp;
  let n = 0;
  const spawn = (family) => {
    const m = rollMonster(rng, d, { family, id: `m${d}-${++n}`, mageDemonMinDepth: balance.mageDemonMinDepth });
    let spot;
    if (m.type === 'assassin' && level.stairsDown) {
      spot = level.randomFloorTile(rng, { filter: (x, y) => Math.max(Math.abs(x - level.stairsDown.x), Math.abs(y - level.stairsDown.y)) <= 3 && Math.max(Math.abs(x - up.x), Math.abs(y - up.y)) > 6 });
    }
    if (!spot) spot = level.randomFloorTile(rng, { minDist: { x: up.x, y: up.y, d: 7 }, plainOnly: true });
    if (!spot) spot = level.randomFloorTile(rng, { minDist: { x: up.x, y: up.y, d: 3 } });
    if (!spot) return;
    m.x = spot.x; m.y = spot.y; m.px = spot.x; m.py = spot.y;
    level.addEntity(m);
  };
  for (let i = 0; i < creatures; i++) spawn('creature');
  for (let i = 0; i < humans; i++) spawn('human');
}

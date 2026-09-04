// Procedural level generator: varied rooms (masonry rectangles, bitten and cross outlines,
// round chambers, cellular caverns, pillared halls) joined by the 1982 random-walk digger
// (single-tile twisting corridors with dead ends and loops), guaranteed connectivity, stairs
// far apart, temples in side chambers behind a doorway, secret alcoves with hidden gold,
// water pools, rubble, hidden traps, treasure and depth-scaled monsters.
// Pure: same (seed, depth) => same Level. All randomness via core/rng.
import { TILE, MAP_WIDTH, MAP_HEIGHT, DIRS4, DIRS8, BALANCE } from '../core/constants.js';
import { createRng, seedFrom } from '../core/rng.js';
import { Level } from './level.js';
import { shapeWeights, pickShape, rollSize, buildMask, maskCentre, maskArea } from './rooms.js';
import { digTunnel, digStub, thinCorridors, ensureConnectivity } from './tunnels.js';
import { rollMonster } from '../game/monsters.js';
import { goldValue, rollTreasure, rollTrap } from '../game/items.js';
import { swordDepthForSeed, placeSword } from '../game/quest.js';

const MASONRY_TYPES = ['crypt', 'library', 'barracks', 'vault', 'cistern'];
/** Rooms that are not part of the main run of the level (never get stairs, pits or pools). */
const SIDE_ROOMS = new Set(['temple', 'shrine', 'alcove']);

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
  if (depth === 0) { generateSurface(level, rng); placeDecor(level, false); return level; }
  const isSwordLevel = depth === swordDepth;
  const style = levelStyle(depth, rng, isSwordLevel);
  level.debug.style = style.name;

  carveRooms(level, rng, style);
  carveTunnels(level, rng, style);
  const hub = level.rooms[0];
  level.debug.connectivityFixes += ensureConnectivity(level, rng, { x: hub.cx, y: hub.cy });
  level.debug.thinned = thinCorridors(level, rng);
  addDeadEnds(level, rng, style);
  placeTempleChambers(level, rng, isSwordLevel);
  placeAlcoves(level, rng, style);
  // anything above could only add walkable tiles attached to open space, but be certain:
  level.debug.connectivityFixes += ensureConnectivity(level, rng, { x: hub.cx, y: hub.cy });
  placeStairs(level, rng);
  placeTemples(level, rng, isSwordLevel);
  placeWater(level, rng, style);
  placeRubble(level, rng, style);
  placePits(level, rng);
  placeTraps(level, rng);
  placeTreasure(level, rng);
  placeDecor(level, isSwordLevel);
  if (opts.monsters !== false) spawnMonsters(level, rng, balance);
  return level;
}

/** Depth-driven look: shallow levels are dressed masonry, deep levels crumble into caverns. */
function levelStyle(depth, rng, isSwordLevel) {
  const t = Math.max(0, Math.min(1, (depth - 2) / 16));
  const caveBias = Math.min(0.85, t * 0.9 + rng.float(-0.1, 0.1));
  return {
    name: isSwordLevel ? 'obsidian' : caveBias < 0.25 ? 'masonry' : caveBias < 0.55 ? 'ruin' : 'cavern',
    caveBias: Math.max(0, caveBias),
    rooms: caveBias < 0.4 ? rng.int(9, 12) : rng.int(8, 10),
    margin: 3,
    halls: depth >= 9 ? rng.int(1, 2) : 1,
    loops: rng.int(2, 4) + (isSwordLevel ? 2 : 0),
    stubs: rng.int(3, 6),
    alcoves: rng.int(1, 2) + (depth >= 6 ? 1 : 0),
    rubble: Math.min(10, Math.floor(depth / 3) + (caveBias > 0.4 ? 3 : 0)),
    water: depth <= 1 ? rng.int(0, 1) : rng.int(1, 3),
  };
}

function generateSurface(level, rng) {
  // A small courtyard at the mountain's foot: the temple of Ferrin and the way down.
  const w = 9, h = 7;
  const x0 = Math.floor(level.width / 2 - w / 2), y0 = Math.floor(level.height / 2 - h / 2);
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) level.set(x, y, TILE.FLOOR);
  level.rooms.push({ x: x0, y: y0, w, h, type: 'surface', cx: x0 + (w >> 1), cy: y0 + (h >> 1), shape: 'court', area: w * h });
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

// ------------------------------------------------------------------------------------ rooms

function boxOverlaps(level, x, y, w, h, margin) {
  for (const r of level.rooms) {
    if (x < r.x + r.w + margin && x + w + margin > r.x && y < r.y + r.h + margin && y + h + margin > r.y) return true;
  }
  return false;
}

/** Commit a mask to the map as FLOOR and register the room. */
function commitRoom(level, m, x, y, type) {
  for (let ly = 0; ly < m.h; ly++) for (let lx = 0; lx < m.w; lx++) if (m.mask[ly * m.w + lx]) level.set(x + lx, y + ly, TILE.FLOOR);
  const c = maskCentre(m);
  const room = { x, y, w: m.w, h: m.h, type, cx: x + c.x, cy: y + c.y, shape: m.shape, area: maskArea(m) };
  level.rooms.push(room);
  return room;
}

function roomTypeFor(rng, shape, style) {
  if (shape === 'cave') return rng.chance(0.3) ? 'grotto' : 'cave';
  if (shape === 'hall') return 'hall';
  if (shape === 'round') return rng.pick(['cistern', 'crypt', 'crypt', 'library']);
  if (style.caveBias > 0.5 && rng.chance(0.4)) return 'cave';
  return rng.pick(MASONRY_TYPES);
}

function carveRooms(level, rng, style) {
  const W = level.width, H = level.height;
  const weights = shapeWeights(style.caveBias);
  let placed = 0, attempts = 0;
  const wanted = style.rooms;
  // one or two wide halls first so they get the space they need
  let hallsLeft = style.halls;
  while (placed < wanted && attempts < 900) {
    attempts++;
    const shape = hallsLeft > 0 ? 'hall' : pickShape(rng, weights);
    const { w, h } = rollSize(rng, shape);
    if (w > W - 4 || h > H - 4) { if (shape === 'hall') hallsLeft--; continue; }
    const x = rng.int(2, W - w - 3), y = rng.int(2, H - h - 3);
    // rooms normally keep two tiles of rock between them; sometimes they run together
    const margin = rng.chance(0.1) ? 0 : style.margin;
    if (boxOverlaps(level, x, y, w, h, margin)) { if (shape === 'hall' && attempts > 200) hallsLeft--; continue; }
    const m = buildMask(rng, shape, w, h);
    commitRoom(level, m, x, y, roomTypeFor(rng, shape, style));
    if (shape === 'hall') hallsLeft--;
    placed++;
  }
  // plain big rectangles sometimes get a pair of columns
  for (const r of level.rooms) {
    if (r.shape !== 'rect' || r.w < 7 || r.h < 5 || !rng.chance(0.35)) continue;
    const cy = r.y + (r.h >> 1), inset = rng.int(1, 2);
    for (const px of [r.x + inset, r.x + r.w - 1 - inset]) {
      if (level.get(px, cy) === TILE.FLOOR && px !== r.cx) level.set(px, cy, TILE.WALL);
    }
    r.pillars = 2;
  }
}

// ---------------------------------------------------------------------------------- tunnels

function carveTunnels(level, rng, style) {
  // [VIC lines 8–25]: from each room centre, a random-walk tunnel until it breaks into open space
  for (const r of level.rooms) digTunnel(level, rng, r.cx, r.cy);
  // loops: tunnels aimed from one room toward another (they stop at whatever they hit first)
  for (let i = 0; i < style.loops; i++) {
    const a = rng.pick(level.rooms), b = rng.pick(level.rooms);
    if (a === b) continue;
    const sx = rng.int(a.x, a.x + a.w - 1), sy = rng.int(a.y, a.y + a.h - 1);
    if (!level.isWalkable(sx, sy)) continue;
    digTunnel(level, rng, sx, sy, { target: { x: b.cx, y: b.cy }, bias: 0.6, maxSteps: 160 });
  }
}

function addDeadEnds(level, rng, style) {
  let made = 0;
  const straight = (x, y) => (level.isWalkable(x - 1, y) && level.isWalkable(x + 1, y)) || (level.isWalkable(x, y - 1) && level.isWalkable(x, y + 1));
  for (let i = 0; i < style.stubs * 5 && made < style.stubs; i++) {
    const t = pickTile(level, rng, (x, y) => level.get(x, y) === TILE.CORRIDOR && straight(x, y), 80);
    if (!t) break;
    if (digStub(level, rng, t.x, t.y, rng.int(2, 6)) >= 2) made++;
  }
  level.debug.stubs = made;
}

// ------------------------------------------------------------------------------- chambers

/**
 * Find a rock pocket of size cw x ch reachable through one door tile from an open anchor tile.
 * Returns {door:{x,y}, box:{x,y,w,h}} or null.
 */
function findPocket(level, rng, size, anchorPred, tries = 400) {
  const W = level.width, H = level.height;
  const rockRect = (x0, y0, x1, y1, except) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x < 1 || y < 1 || x > W - 2 || y > H - 2) return false;
      if (except && x === except.x && y === except.y) continue;
      if (level.get(x, y) !== TILE.WALL) return false;
    }
    return true;
  };
  for (let i = 0; i < tries; i++) {
    const ax = rng.int(1, W - 2), ay = rng.int(1, H - 2);
    if (!level.isWalkable(ax, ay) || !anchorPred(ax, ay)) continue;
    const d = DIRS4[rng.int(0, 3)];
    const { w: cw, h: ch } = typeof size === 'function' ? size(d) : size;
    const door = { x: ax + d.dx, y: ay + d.dy };
    if (level.get(door.x, door.y) !== TILE.WALL) continue;
    // the door must be flanked by rock (a doorway, not a gap in a wall)
    if (level.get(door.x - d.dy, door.y + d.dx) !== TILE.WALL || level.get(door.x + d.dy, door.y - d.dx) !== TILE.WALL) continue;
    // chamber box beyond the door, door centred on its near side
    let bx, by;
    if (d.dx === 1) { bx = door.x + 1; by = door.y - (ch >> 1); }
    else if (d.dx === -1) { bx = door.x - cw; by = door.y - (ch >> 1); }
    else if (d.dy === 1) { bx = door.x - (cw >> 1); by = door.y + 1; }
    else { bx = door.x - (cw >> 1); by = door.y - ch; }
    // the box plus a one-tile rock rim must be solid rock (except the door itself) and must not
    // borrow the wall of another side chamber (a temple must stay sealed behind its one door)
    if (!rockRect(bx - 1, by - 1, bx + cw, by + ch, door)) continue;
    if (level.rooms.some((r) => SIDE_ROOMS.has(r.type) && bx - 1 <= r.x + r.w && bx + cw >= r.x - 1 && by - 1 <= r.y + r.h && by + ch >= r.y - 1)) continue;
    if (level.rooms.some((r) => SIDE_ROOMS.has(r.type) && ax >= r.x && ay >= r.y && ax < r.x + r.w && ay < r.y + r.h)) continue;
    return { door, box: { x: bx, y: by, w: cw, h: ch }, dir: d };
  }
  return null;
}

/** Temples live in small side chambers off a passage, entered through a single doorway. */
function placeTempleChambers(level, rng, isSwordLevel) {
  const count = isSwordLevel ? 1 : (rng.chance(0.2) ? 2 : 1);
  const corridorAnchor = (x, y) => level.get(x, y) === TILE.CORRIDOR;
  const anyAnchor = (x, y) => level.get(x, y) === TILE.CORRIDOR || level.get(x, y) === TILE.FLOOR;
  for (let i = 0; i < count; i++) {
    const cw = rng.int(3, 4), ch = rng.chance(0.7) ? 3 : 4;
    const pocket = findPocket(level, rng, { w: cw, h: ch }, corridorAnchor, 500) || findPocket(level, rng, { w: cw, h: ch }, anyAnchor, 500)
      || findPocket(level, rng, { w: 3, h: 3 }, anyAnchor, 800);
    if (!pocket) break;
    const { door, box } = pocket;
    for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) level.set(x, y, TILE.FLOOR);
    level.set(door.x, door.y, TILE.DOOR);
    level.rooms.push({ x: box.x, y: box.y, w: box.w, h: box.h, type: isSwordLevel ? 'shrine' : 'temple', cx: box.x + (box.w >> 1), cy: box.y + (box.h >> 1), shape: 'chamber', area: box.w * box.h, door });
  }
}

/** Secret alcoves: a one-tile niche behind a doorway, with a hidden cache of gold. */
function placeAlcoves(level, rng, style) {
  let made = 0;
  const anchor = (x, y) => level.get(x, y) === TILE.CORRIDOR || level.get(x, y) === TILE.FLOOR;
  for (let i = 0; i < style.alcoves; i++) {
    const deep = rng.chance(0.4) ? 2 : 1;
    // the niche extends away from the door
    const p = findPocket(level, rng, (d) => (d.dx ? { w: deep, h: 1 } : { w: 1, h: deep }), anchor, 300);
    if (!p) continue;
    const { door, box } = p;
    for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) level.set(x, y, TILE.FLOOR);
    level.set(door.x, door.y, TILE.DOOR);
    // the cache sits at the far end
    const far = { x: box.x + (p.dir.dx > 0 ? box.w - 1 : 0), y: box.y + (p.dir.dy > 0 ? box.h - 1 : 0) };
    level.rooms.push({ x: box.x, y: box.y, w: box.w, h: box.h, type: 'alcove', cx: far.x, cy: far.y, shape: 'alcove', area: box.w * box.h, door });
    level.addItem({ type: 'gold', x: far.x, y: far.y, qty: 1, gold: goldValue(rng, level.depth) * 3, hidden: true });
    made++;
  }
  level.debug.alcoves = made;
}

// ------------------------------------------------------------------------------ placement

function pickTile(level, rng, pred, tries = 300) {
  for (let i = 0; i < tries; i++) {
    const x = rng.int(1, level.width - 2), y = rng.int(1, level.height - 2);
    if (pred(x, y)) return { x, y };
  }
  const all = [];
  for (let y = 1; y < level.height - 1; y++) for (let x = 1; x < level.width - 1; x++) if (pred(x, y)) all.push({ x, y });
  return all.length ? rng.pick(all) : null;
}

function roomTiles(level, pred) {
  const out = [];
  for (const r of level.rooms) {
    if (SIDE_ROOMS.has(r.type)) continue;
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
    const c = rng.pick(candidates.filter((t) => plain(t.x, t.y) && dist[level.idx(t.x, t.y)] >= 14 && !downs.some((d) => Math.abs(d.x - t.x) + Math.abs(d.y - t.y) < 10)));
    if (c) downs.push(c);
  }
  for (const d of downs) level.set(d.x, d.y, TILE.STAIRS_DOWN);
  level.stairsDown = { x: far.x, y: far.y };
  level.stairsDownAll = downs.map((d) => ({ x: d.x, y: d.y }));
}

function placeTemples(level, rng, isSwordLevel) {
  const chambers = level.rooms.filter((r) => r.type === 'temple' || r.type === 'shrine');
  if (isSwordLevel) {
    const r = chambers[0];
    const pos = r ? { x: r.cx, y: r.cy } : rng.pick(roomTiles(level, (x, y) => level.get(x, y) === TILE.FLOOR));
    placeSword(level, pos.x, pos.y);
    return;
  }
  for (const r of chambers) {
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
    if (t === TILE.STAIRS_UP || t === TILE.STAIRS_DOWN || t === TILE.TEMPLE || t === TILE.PIT || t === TILE.DOOR) return true;
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

/** Organic pools: a random-walk blob smoothed so it has no one-tile spikes. */
function placeWater(level, rng, style) {
  const pools = style.water;
  const eligible = level.rooms.filter((r) => !SIDE_ROOMS.has(r.type) && r.w >= 4 && r.h >= 4 && r.area >= 14);
  if (!eligible.length) return;
  const used = new Set();
  for (let i = 0; i < pools; i++) {
    const wet = eligible.filter((r) => (r.type === 'cistern' || r.type === 'grotto') && !used.has(r));
    const r = wet.length && rng.chance(0.8) ? rng.pick(wet) : rng.pick(eligible.filter((q) => !used.has(q))) || rng.pick(eligible);
    used.add(r);
    const ok = (x, y) => level.get(x, y) === TILE.FLOOR && !nearSpecial(level, x, y, 1) && !level.itemsAt(x, y).length
      && x > r.x && y > r.y && x < r.x + r.w - 1 && y < r.y + r.h - 1;
    const seed = pickTile(level, rng, ok, 60);
    if (!seed) continue;
    const target = Math.min(rng.int(5, 7 + Math.floor(r.area / 5)), Math.floor(r.area * 0.45));
    const blob = new Set([level.idx(seed.x, seed.y)]);
    // growth: keep adding a frontier tile, favouring tiles already hugged by water (lobes, not lines)
    for (let k = 0; k < target * 8 && blob.size < target; k++) {
      const frontier = [];
      for (const j of blob) {
        const bx = j % level.width, by = (j / level.width) | 0;
        for (const d of DIRS4) {
          const qx = bx + d.dx, qy = by + d.dy, qj = level.idx(qx, qy);
          if (blob.has(qj) || !ok(qx, qy)) continue;
          const hug = DIRS4.filter((e) => blob.has(level.idx(qx + e.dx, qy + e.dy))).length;
          for (let w = 0; w < [0, 2, 5, 7, 8][hug]; w++) frontier.push(qj);
        }
      }
      if (!frontier.length) break;
      blob.add(rng.pick(frontier));
    }
    // smoothing: drop tiles with fewer than two wet neighbours, fill enclosed dry tiles
    for (let pass = 0; pass < 2; pass++) {
      for (const j of [...blob]) {
        const bx = j % level.width, by = (j / level.width) | 0;
        const n = DIRS4.filter((d) => blob.has(level.idx(bx + d.dx, by + d.dy))).length;
        if (n < 2) blob.delete(j);
      }
      for (const j of [...blob]) {
        const bx = j % level.width, by = (j / level.width) | 0;
        for (const d of DIRS4) {
          const qx = bx + d.dx, qy = by + d.dy, qj = level.idx(qx, qy);
          if (blob.has(qj) || !ok(qx, qy)) continue;
          const n = DIRS4.filter((e) => blob.has(level.idx(qx + e.dx, qy + e.dy))).length;
          if (n >= 3) blob.add(qj);
        }
      }
    }
    if (blob.size < 3) continue;
    for (const j of blob) level.tiles[j] = TILE.WATER;
  }
}

/** Rubble: collapsed corridor stretches and scree in caverns (walkable, just debris). */
function placeRubble(level, rng, style) {
  let n = style.rubble;
  const caves = level.rooms.filter((r) => r.type === 'cave' || r.type === 'grotto');
  const okTile = (x, y) => (level.get(x, y) === TILE.FLOOR || level.get(x, y) === TILE.CORRIDOR) && !nearSpecial(level, x, y, 1) && !level.itemsAt(x, y).length;
  for (const r of caves) {
    if (n <= 0) break;
    const k = Math.min(n, rng.int(1, 3));
    for (let i = 0; i < k; i++) {
      const t = pickTile(level, rng, (x, y) => okTile(x, y) && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h, 60);
      if (t) { level.set(t.x, t.y, TILE.RUBBLE); n--; }
    }
  }
  // collapsed passages: 1–3 consecutive corridor tiles
  while (n > 0) {
    const t = pickTile(level, rng, (x, y) => level.get(x, y) === TILE.CORRIDOR && okTile(x, y), 120);
    if (!t) break;
    const run = rng.int(1, Math.min(3, n));
    let { x, y } = t;
    for (let i = 0; i < run; i++) {
      level.set(x, y, TILE.RUBBLE); n--;
      const next = DIRS4.map((d) => ({ x: x + d.dx, y: y + d.dy })).filter((q) => level.get(q.x, q.y) === TILE.CORRIDOR && okTile(q.x, q.y));
      if (!next.length) break;
      ({ x, y } = rng.pick(next));
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
  const free = (x, y) => level.isEmptyFloor(x, y) && level.get(x, y) !== TILE.WATER && level.get(x, y) !== TILE.RUBBLE && !level.trapAt(x, y);
  const inRoom = (x, y) => level.get(x, y) === TILE.FLOOR;
  const bags = Math.floor(5 * rng.next() + 6);
  for (let i = 0; i < bags; i++) {
    const t = pickTile(level, rng, free);
    if (t) level.addItem({ type: 'gold', x: t.x, y: t.y, qty: 1, gold: goldValue(rng, d), hidden: false });
  }
  // buried caches: more, and richer, the deeper you go
  const buried = rng.int(0, 1 + Math.floor(d / 8));
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
  // vaults keep an open chest; from depth 2 a stray chest may lie about elsewhere
  const vault = level.rooms.find((r) => r.type === 'vault');
  if (vault && d >= 2) {
    const t = pickTile(level, rng, (x, y) => free(x, y) && inRoom(x, y) && x >= vault.x && y >= vault.y && x < vault.x + vault.w && y < vault.y + vault.h, 80);
    if (t) level.addItem({ type: 'chest', x: t.x, y: t.y, qty: 1, hidden: false, trap: null, content: rollTreasure(rng, d) });
  } else if (d >= 2 && rng.chance(0.5)) {
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
  const spawn = (family, near) => {
    const m = rollMonster(rng, d, { family, id: `m${d}-${++n}`, mageDemonMinDepth: balance.mageDemonMinDepth });
    let spot;
    if (m.type === 'assassin' && level.stairsDown) {
      spot = level.randomFloorTile(rng, { filter: (x, y) => Math.max(Math.abs(x - level.stairsDown.x), Math.abs(y - level.stairsDown.y)) <= 3 && Math.max(Math.abs(x - up.x), Math.abs(y - up.y)) > 6 });
    }
    if (!spot && near) spot = level.randomFloorTile(rng, { plainOnly: true, filter: (x, y) => Math.max(Math.abs(x - near.x), Math.abs(y - near.y)) <= 2 && Math.max(Math.abs(x - up.x), Math.abs(y - up.y)) > 6 });
    if (!spot) spot = level.randomFloorTile(rng, { minDist: { x: up.x, y: up.y, d: 7 }, plainOnly: true });
    if (!spot) spot = level.randomFloorTile(rng, { minDist: { x: up.x, y: up.y, d: 3 } });
    if (!spot) return;
    m.x = spot.x; m.y = spot.y; m.px = spot.x; m.py = spot.y;
    level.addEntity(m);
  };
  for (let i = 0; i < creatures; i++) spawn('creature');
  for (let i = 0; i < humans; i++) spawn('human');
  // deeper vaults are guarded
  const chest = level.items.find((it) => it.type === 'chest' && !it.hidden);
  if (chest && d >= 6 && rng.chance(0.6)) spawn(rng.chance(0.5) ? 'creature' : 'human', chest);
}

// ============================================================================== ambience
// Room archetypes, furniture, scatter and corridor dressing. docs/AMBIENCE.md is the binding
// contract; section references below point at it. Everything here runs off a decor-only RNG
// fork so dressing never perturbs the rest of generation, and a seed reproduces it exactly.

/** The catalogue (§5): class, variant count, and whether the type may ever be blocking. */
export const DECOR_TYPES = {
  // standing props
  strongbox: { cls: 'prop', v: 3 }, bookcase: { cls: 'prop', v: 4 }, cupboard: { cls: 'prop', v: 3 },
  lectern: { cls: 'prop', v: 3 }, table: { cls: 'prop', v: 4 }, tableLong: { cls: 'prop', v: 3, run: true },
  bench: { cls: 'prop', v: 2 }, stool: { cls: 'prop', v: 2 }, throne: { cls: 'prop', v: 2 },
  sarcophagus: { cls: 'prop', v: 4, blk: true }, tombSlab: { cls: 'prop', v: 3 }, urn: { cls: 'prop', v: 3 },
  alchemyBench: { cls: 'prop', v: 3 }, retortStand: { cls: 'prop', v: 2 }, scales: { cls: 'prop', v: 2 },
  cauldron: { cls: 'prop', v: 3 }, brazier: { cls: 'prop', v: 4 }, hearth: { cls: 'prop', v: 3 },
  forge: { cls: 'prop', v: 2, blk: true }, anvil: { cls: 'prop', v: 2, blk: true },
  weaponRack: { cls: 'prop', v: 4 }, shieldStand: { cls: 'prop', v: 3 }, armourStand: { cls: 'prop', v: 3 },
  barrel: { cls: 'prop', v: 3 }, crate: { cls: 'prop', v: 3 }, sackPile: { cls: 'prop', v: 3 },
  bunk: { cls: 'prop', v: 3, run: true }, footlocker: { cls: 'prop', v: 2 }, rack: { cls: 'prop', v: 2 },
  chainPost: { cls: 'prop', v: 3 }, cage: { cls: 'prop', v: 3, blk: true }, wellHead: { cls: 'prop', v: 2, blk: true },
  pillarBroken: { cls: 'prop', v: 3, blk: true }, fallenColumn: { cls: 'prop', v: 3, blk: true },
  rubbleMound: { cls: 'prop', v: 4, blk: true }, stalagmite: { cls: 'prop', v: 4, blk: true },
  dripstone: { cls: 'prop', v: 3 }, mushroomCluster: { cls: 'prop', v: 4 },
  candlestick: { cls: 'prop', v: 3 }, candelabra: { cls: 'prop', v: 3 }, skull: { cls: 'prop', v: 3 },
  skullPile: { cls: 'prop', v: 3 }, bonePile: { cls: 'prop', v: 3 }, rat: { cls: 'prop', v: 2 },
  bottles: { cls: 'prop', v: 3 }, tankards: { cls: 'prop', v: 2 }, dice: { cls: 'prop', v: 2 },
  // floor decals
  bones: { cls: 'decal', v: 4 }, scree: { cls: 'decal', v: 4 }, puddle: { cls: 'decal', v: 3 },
  bloodstain: { cls: 'decal', v: 3 }, scorch: { cls: 'decal', v: 3 }, crackedFlags: { cls: 'decal', v: 3 },
  mosaic: { cls: 'decal', v: 4 }, rug: { cls: 'decal', v: 3 }, runner: { cls: 'decal', v: 2, run: true },
  chalkSigil: { cls: 'decal', v: 3 }, spill: { cls: 'decal', v: 3 }, ashBed: { cls: 'decal', v: 2 },
  coins: { cls: 'decal', v: 3 }, sporePatch: { cls: 'decal', v: 3 }, lichen: { cls: 'decal', v: 3 },
  rime: { cls: 'decal', v: 2 }, drainGrate: { cls: 'decal', v: 2 },
  // wall-mounted
  sconce: { cls: 'wall', v: 3 }, banner: { cls: 'wall', v: 4 }, tapestry: { cls: 'wall', v: 3 },
  hungShield: { cls: 'wall', v: 4 }, trophyArms: { cls: 'wall', v: 3 }, chains: { cls: 'wall', v: 3 },
  manacles: { cls: 'wall', v: 2 }, cobweb: { cls: 'wall', v: 4 }, skullNiche: { cls: 'wall', v: 3 },
  ossuaryShelf: { cls: 'wall', v: 3, run: true }, ironRing: { cls: 'wall', v: 2 },
  gargoyleSpout: { cls: 'wall', v: 3 }, wallShelf: { cls: 'wall', v: 3 }, plaque: { cls: 'wall', v: 3 },
  wallCrack: { cls: 'wall', v: 3 }, mould: { cls: 'wall', v: 3 }, fungusShelf: { cls: 'wall', v: 3 },
};

/**
 * The 24 archetypes (§6). `w` is the weight in depth bands B1..B4, `cap` the per-level maximum,
 * `sig` the signature piece, `min` the floor tiles the room needs before it may claim the identity.
 */
export const ARCHETYPES = {
  guardroom: { rooms: ['hall', 'barracks', 'crypt', 'library', 'vault', 'cistern'], w: [8, 6, 2, 0], cap: 2, mood: 'torchlit', sig: 'table', min: 9 },
  barracks: { rooms: ['barracks', 'hall'], w: [6, 5, 2, 0], cap: 2, mood: 'torchlit', sig: 'bunk', min: 10 },
  armoury: { rooms: ['vault', 'barracks', 'hall'], w: [4, 4, 2, 1], cap: 1, mood: 'torchlit', sig: 'weaponRack', min: 8 },
  forge: { rooms: ['hall', 'vault'], w: [2, 3, 2, 1], cap: 1, mood: 'forge', sig: 'forge', min: 12 },
  refectory: { rooms: ['hall'], w: [4, 3, 1, 0], cap: 1, mood: 'hearth', sig: 'tableLong', min: 14 },
  storeroom: { rooms: ['vault', 'barracks', 'cave'], w: [5, 5, 3, 1], cap: 2, mood: 'dark', sig: 'crate', min: 8 },
  vault: { rooms: ['vault'], w: [2, 3, 3, 2], cap: 1, mood: 'candle', sig: 'strongbox', min: 8 },
  scriptorium: { rooms: ['library'], w: [4, 4, 2, 0], cap: 1, mood: 'candle', sig: 'bookcase', min: 9 },
  alchemy: { rooms: ['library', 'vault'], w: [2, 4, 3, 1], cap: 1, mood: 'candle', sig: 'alchemyBench', min: 9 },
  audience: { rooms: ['hall'], w: [2, 3, 2, 1], cap: 1, mood: 'torchlit', sig: 'throne', min: 14 },
  torture: { rooms: ['crypt', 'barracks', 'vault'], w: [1, 4, 3, 2], cap: 1, mood: 'ember', sig: 'rack', min: 12 },
  kennel: { rooms: ['cave', 'barracks', 'hall'], w: [3, 4, 4, 3], cap: 1, mood: 'ember', sig: 'cage', min: 10 },
  crypt: { rooms: ['crypt'], w: [3, 5, 6, 4], cap: 2, mood: 'cold', sig: 'sarcophagus', min: 9 },
  ossuary: { rooms: ['crypt', 'cave'], w: [1, 3, 5, 4], cap: 1, mood: 'cold', sig: 'skullPile', min: 8 },
  barrow: { rooms: ['crypt', 'vault'], w: [0, 2, 5, 5], cap: 1, mood: 'cold', sig: 'tombSlab', min: 9 },
  cistern: { rooms: ['cistern', 'grotto'], w: [3, 4, 4, 2], cap: 1, mood: 'water', sig: 'wellHead', min: 10 },
  flooded: { rooms: ['cave', 'grotto', 'cistern'], w: [1, 3, 5, 4], cap: 2, mood: 'water', sig: 'dripstone', min: 8 },
  mushroom: { rooms: ['cave', 'grotto'], w: [1, 3, 5, 3], cap: 1, mood: 'fungal', sig: 'mushroomCluster', min: 8 },
  collapsed: { rooms: ['cave', 'hall', 'crypt'], w: [2, 4, 5, 5], cap: 2, mood: 'dark', sig: 'fallenColumn', min: 12 },
  wellroom: { rooms: ['cistern', 'hall'], w: [2, 2, 1, 0], cap: 1, mood: 'torchlit', sig: 'wellHead', min: 12 },
  warren: { rooms: ['cave', 'barracks', 'hall'], w: [5, 5, 3, 2], cap: 2, mood: 'ember', sig: 'sackPile', min: 8 },
  bare: { rooms: ['*'], w: [5, 6, 7, 8], cap: 99, mood: 'dark', sig: null, min: 0 },
  shrine: { rooms: ['temple', 'shrine'], w: [0, 0, 0, 0], cap: 99, mood: 'shrine', sig: null, min: 0 },
  courtyard: { rooms: ['surface'], w: [0, 0, 0, 0], cap: 1, mood: 'shrine', sig: null, min: 0 },
};

/** Archetypes the sword level may roll (§6.2). */
const SWORD_ARCHETYPES = new Set(['crypt', 'barrow', 'ossuary', 'collapsed', 'vault', 'bare']);

/**
 * Furniture plans (§6.1 / §8.1). `p` is the placement rule:
 * wall = against a wall facing in, wallLong = the room's long wall, wallCentre = the middle of the
 * longest wall run, interior = away from the walls, around = ringing the last anchor, any = either.
 */
const PLANS = {
  guardroom: [{ t: 'table', n: [1, 1], p: 'interior', anchor: true }, { t: 'stool', n: [2, 3], p: 'around' },
    { t: 'weaponRack', n: [1, 1], p: 'wallLong' }, { t: 'brazier', n: [1, 2], p: 'wall' }, { t: 'bench', n: [0, 1], p: 'wall' }],
  barracks: [{ t: 'bunk', n: [2, 4], p: 'wallLong', run: true }, { t: 'footlocker', n: [1, 2], p: 'wall' },
    { t: 'armourStand', n: [0, 1], p: 'wall' }, { t: 'stool', n: [0, 1], p: 'any' }],
  armoury: [{ t: 'weaponRack', n: [2, 3], p: 'wallLong' }, { t: 'shieldStand', n: [1, 1], p: 'wall' },
    { t: 'armourStand', n: [0, 1], p: 'wall' }, { t: 'crate', n: [0, 2], p: 'wall' }, { t: 'anvil', n: [0, 1], p: 'interior' }],
  forge: [{ t: 'forge', n: [1, 1], p: 'wallCentre', anchor: true }, { t: 'anvil', n: [1, 1], p: 'interior' },
    { t: 'barrel', n: [1, 1], p: 'wall' }, { t: 'crate', n: [0, 1], p: 'wall' }, { t: 'weaponRack', n: [0, 1], p: 'wall' }],
  refectory: [{ t: 'tableLong', n: [2, 3], p: 'interior', run: true, anchor: true }, { t: 'bench', n: [2, 4], p: 'around' },
    { t: 'hearth', n: [1, 1], p: 'wallCentre' }, { t: 'barrel', n: [1, 3], p: 'wall' }, { t: 'cupboard', n: [0, 1], p: 'wall' }],
  storeroom: [{ t: 'crate', n: [2, 3], p: 'wall' }, { t: 'barrel', n: [1, 2], p: 'wall' }, { t: 'sackPile', n: [1, 2], p: 'wall' },
    { t: 'cupboard', n: [0, 1], p: 'wall' }, { t: 'strongbox', n: [0, 1], p: 'wall' }],
  vault: [{ t: 'strongbox', n: [2, 3], p: 'wall' }, { t: 'cupboard', n: [0, 1], p: 'wall' },
    { t: 'candelabra', n: [1, 2], p: 'wall' }, { t: 'pillarBroken', n: [0, 1], p: 'interior' }],
  scriptorium: [{ t: 'bookcase', n: [2, 2], p: 'wallLong' }, { t: 'lectern', n: [1, 1], p: 'wall' },
    { t: 'table', n: [1, 1], p: 'interior', anchor: true }, { t: 'stool', n: [1, 2], p: 'around' }, { t: 'candelabra', n: [0, 1], p: 'wall' }],
  alchemy: [{ t: 'alchemyBench', n: [1, 1], p: 'wallLong', anchor: true }, { t: 'retortStand', n: [1, 1], p: 'wall' },
    { t: 'scales', n: [0, 1], p: 'wall' }, { t: 'cauldron', n: [1, 1], p: 'interior' }, { t: 'bookcase', n: [0, 1], p: 'wall' },
    { t: 'stool', n: [0, 1], p: 'any' }],
  audience: [{ t: 'throne', n: [1, 1], p: 'wallCentre', anchor: true }, { t: 'brazier', n: [2, 2], p: 'flank' },
    { t: 'bench', n: [1, 2], p: 'wall' }, { t: 'candelabra', n: [0, 2], p: 'wall' }],
  torture: [{ t: 'rack', n: [1, 1], p: 'interior', anchor: true }, { t: 'brazier', n: [1, 1], p: 'wall' },
    { t: 'cage', n: [0, 1], p: 'wall' }, { t: 'chainPost', n: [1, 2], p: 'wall' }, { t: 'stool', n: [0, 1], p: 'any' }],
  kennel: [{ t: 'cage', n: [2, 3], p: 'wall' }, { t: 'chainPost', n: [1, 2], p: 'wall' },
    { t: 'barrel', n: [0, 1], p: 'wall' }, { t: 'cauldron', n: [0, 1], p: 'interior' }],
  crypt: [{ t: 'sarcophagus', n: [1, 2], p: 'wallLong', anchor: true }, { t: 'tombSlab', n: [2, 3], p: 'wall' },
    { t: 'urn', n: [0, 2], p: 'wall' }, { t: 'candlestick', n: [0, 2], p: 'any' }],
  ossuary: [{ t: 'skullPile', n: [2, 3], p: 'wall' }, { t: 'urn', n: [1, 2], p: 'wall' },
    { t: 'bonePile', n: [0, 2], p: 'wall' }, { t: 'candlestick', n: [0, 1], p: 'any' }],
  barrow: [{ t: 'tombSlab', n: [2, 2], p: 'wall', anchor: true }, { t: 'sarcophagus', n: [0, 1], p: 'wallLong' },
    { t: 'weaponRack', n: [0, 1], p: 'wall' }, { t: 'brazier', n: [0, 1], p: 'wall' }, { t: 'strongbox', n: [0, 1], p: 'wall' }],
  cistern: [{ t: 'wellHead', n: [1, 1], p: 'interior', anchor: true }, { t: 'barrel', n: [0, 1], p: 'wall' },
    { t: 'pillarBroken', n: [0, 2], p: 'interior' }],
  flooded: [{ t: 'dripstone', n: [1, 2], p: 'wall' }, { t: 'stalagmite', n: [2, 3], p: 'any' },
    { t: 'rubbleMound', n: [0, 1], p: 'any' }],
  mushroom: [{ t: 'mushroomCluster', n: [4, 6], p: 'any' }, { t: 'stalagmite', n: [1, 2], p: 'any' },
    { t: 'dripstone', n: [0, 1], p: 'wall' }],
  collapsed: [{ t: 'fallenColumn', n: [1, 1], p: 'interior', anchor: true }, { t: 'pillarBroken', n: [1, 3], p: 'any' },
    { t: 'rubbleMound', n: [2, 3], p: 'any' }],
  wellroom: [{ t: 'wellHead', n: [1, 1], p: 'interior', anchor: true }, { t: 'bench', n: [1, 2], p: 'wall' },
    { t: 'barrel', n: [0, 1], p: 'wall' }, { t: 'brazier', n: [0, 2], p: 'wall' }],
  warren: [{ t: 'sackPile', n: [2, 2], p: 'wall' }, { t: 'crate', n: [1, 2], p: 'wall' }, { t: 'barrel', n: [1, 2], p: 'wall' },
    { t: 'cauldron', n: [0, 1], p: 'interior' }, { t: 'chainPost', n: [0, 1], p: 'wall' }],
  shrine: [{ t: 'candelabra', n: [1, 2], p: 'wall' }, { t: 'candlestick', n: [0, 1], p: 'any' }, { t: 'bench', n: [0, 1], p: 'wall' }],
  courtyard: [{ t: 'bench', n: [1, 2], p: 'wall' }, { t: 'barrel', n: [0, 1], p: 'wall' }, { t: 'candelabra', n: [0, 2], p: 'wall' }],
  bare: [],
};

/** Scatter dressing per archetype (§6.1), and the wall pieces each room may hang. */
const SCATTER = {
  guardroom: ['tankards', 'dice', 'bottles', 'bones', 'coins'],
  barracks: ['bottles', 'rat', 'bones', 'bloodstain'],
  armoury: ['scree', 'coins', 'bones'],
  forge: ['ashBed', 'scorch', 'scree'],
  refectory: ['tankards', 'bottles', 'bones', 'rat', 'ashBed'],
  storeroom: ['scree', 'rat', 'coins'],
  vault: ['coins', 'mosaic', 'chalkSigil'],
  scriptorium: ['bottles', 'chalkSigil', 'rug', 'coins'],
  alchemy: ['bottles', 'spill', 'chalkSigil', 'scorch'],
  audience: ['rug', 'runner', 'mosaic', 'coins'],
  torture: ['bloodstain', 'bones', 'scorch', 'skull'],
  kennel: ['bones', 'bonePile', 'bloodstain', 'scorch', 'rat'],
  crypt: ['bones', 'skull', 'skullPile', 'crackedFlags'],
  ossuary: ['bones', 'bonePile', 'skull', 'scree'],
  barrow: ['bones', 'coins', 'rime', 'crackedFlags'],
  shrine: ['mosaic', 'rug', 'coins'],
  cistern: ['puddle', 'drainGrate', 'lichen', 'rime'],
  flooded: ['puddle', 'lichen', 'sporePatch', 'bones'],
  mushroom: ['sporePatch', 'lichen', 'bones', 'rat'],
  collapsed: ['scree', 'crackedFlags', 'bones', 'scorch'],
  wellroom: ['puddle', 'coins', 'mosaic'],
  warren: ['bones', 'bloodstain', 'rat', 'scorch', 'tankards'],
  bare: ['scree', 'bones', 'crackedFlags'],
  courtyard: ['mosaic', 'rug', 'puddle'],
};

const WALL_SET = {
  guardroom: ['sconce', 'hungShield'], barracks: ['sconce', 'chains', 'hungShield'],
  armoury: ['trophyArms', 'hungShield', 'sconce'], forge: ['trophyArms', 'wallShelf'],
  refectory: ['banner', 'sconce'], storeroom: ['wallShelf', 'sconce'], vault: ['plaque', 'tapestry'],
  scriptorium: ['tapestry', 'wallShelf', 'cobweb'], alchemy: ['wallShelf', 'cobweb'],
  audience: ['banner', 'tapestry'], torture: ['manacles', 'chains', 'ironRing'],
  kennel: ['ironRing', 'chains', 'mould'], crypt: ['skullNiche', 'plaque', 'cobweb'],
  ossuary: ['ossuaryShelf', 'skullNiche', 'cobweb'], barrow: ['plaque', 'banner', 'cobweb'],
  shrine: ['tapestry', 'plaque'], cistern: ['gargoyleSpout', 'mould', 'wallCrack'],
  flooded: ['mould', 'fungusShelf', 'gargoyleSpout'], mushroom: ['fungusShelf', 'mould'],
  collapsed: ['wallCrack', 'cobweb'], wellroom: ['gargoyleSpout', 'ironRing', 'sconce'],
  warren: ['hungShield', 'chains', 'mould'], bare: ['cobweb', 'wallCrack'], courtyard: ['banner', 'plaque'],
};

/** The whole corridor catalogue (§3) — nothing else may ever stand in a corridor. */
const CORRIDOR_TABLE = [
  { t: 'bones', w: 5 }, { t: 'scree', w: 4 }, { t: 'puddle', w: 3 }, { t: 'sconce', w: 3 },
  { t: 'cobweb', w: 3 }, { t: 'wallCrack', w: 2 }, { t: 'skull', w: 2 }, { t: 'bloodstain', w: 1 },
  { t: 'mould', w: 1 }, { t: 'rat', w: 1 },
];

const FACE = { n: { dx: 0, dy: -1 }, e: { dx: 1, dy: 0 }, s: { dx: 0, dy: 1 }, w: { dx: -1, dy: 0 } };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const key = (x, y) => `${x},${y}`;

/** Depth band index 0..3 for B1..B4 (§2). */
function bandIndex(depth) {
  return depth <= 5 ? 0 : depth <= 12 ? 1 : depth <= 18 ? 2 : 3;
}

/** Weighted pick from [{t,w}] entries; null when everything is zero. */
function weightedPick(rng, entries) {
  let total = 0;
  for (const e of entries) total += Math.max(0, e.w);
  if (total <= 0) return null;
  let r = rng.next() * total;
  for (const e of entries) { r -= Math.max(0, e.w); if (r < 0) return e; }
  return entries[entries.length - 1];
}

/** Variant index for a type: intact when the room is kept, wrecked when it is not (§2.1). */
function variantFor(rng, type, decay) {
  const n = DECOR_TYPES[type].v;
  const v = Math.round(decay * (n - 1) + rng.float(-0.8, 0.8));
  return Math.max(0, Math.min(n - 1, v));
}

/** Mood drift with decay (§2.1): a broken room cannot keep its torches lit. */
function driftMood(mood, decay) {
  if (decay > 0.8) return mood === 'ember' ? 'cold' : mood === 'candle' ? 'dark' : mood === 'torchlit' ? 'ember' : mood;
  if (decay > 0.55) return mood === 'torchlit' ? 'ember' : mood === 'hearth' ? 'ember' : mood;
  return mood;
}

/** The room's own floor tiles (never corridor, never another room's). */
function roomFloor(level, room) {
  const out = [];
  for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) {
    const t = level.get(x, y);
    if (t === TILE.FLOOR || t === TILE.RUBBLE) out.push({ x, y });
  }
  return out;
}

/** Everything the placer needs to know about one room's floor, computed once. */
function roomSpace(level, room) {
  let floor = roomFloor(level, room);
  // a room box can catch a sliver of somebody else's floor; only real lobes count as this room
  const comps = components(floor);
  if (comps.length > 1) {
    const keep = comps.filter((c) => c.length >= 3);
    floor = (keep.length ? keep : [comps.slice().sort((a, b) => b.length - a.length)[0]]).flat();
  }
  const inRoom = new Set(floor.map((t) => key(t.x, t.y)));
  const entrances = new Set();
  const outside = (x, y) => x < room.x || y < room.y || x >= room.x + room.w || y >= room.y + room.h;
  for (const t of floor) {
    for (const d of DIRS4) {
      const nx = t.x + d.dx, ny = t.y + d.dy, nt = level.get(nx, ny);
      // a way in is a corridor, a doorway, or open ground outside the room box — not this room's
      // own pool of water, which would otherwise fence off the whole shoreline
      if (!level.isWalkable(nx, ny)) continue;
      if (nt === TILE.CORRIDOR || nt === TILE.DOOR || (outside(nx, ny) && !inRoom.has(key(nx, ny)))) {
        entrances.add(key(t.x, t.y)); break;
      }
    }
  }
  const wallSide = new Map();   // tile -> facing away from a wall, into the room
  for (const t of floor) {
    for (const d of DIRS4) {
      if (level.get(t.x - d.dx, t.y - d.dy) !== TILE.WALL) continue;
      const f = d.dx === 1 ? 'e' : d.dx === -1 ? 'w' : d.dy === 1 ? 's' : 'n';
      if (!wallSide.has(key(t.x, t.y))) wallSide.set(key(t.x, t.y), f);
    }
  }
  const free = floor.filter((t) => !entrances.has(key(t.x, t.y)) && !level.decorForbidden(t.x, t.y, true));
  return { floor, inRoom, entrances, wallSide, free };
}

/** 4-connected components of a tile list. */
function components(tiles) {
  const set = new Map(tiles.map((t) => [key(t.x, t.y), t]));
  const seen = new Set(), out = [];
  for (const t of tiles) {
    const k0 = key(t.x, t.y);
    if (seen.has(k0)) continue;
    const comp = [], stack = [t];
    seen.add(k0);
    while (stack.length) {
      const c = stack.pop();
      comp.push(c);
      for (const d of DIRS4) {
        const k = key(c.x + d.dx, c.y + d.dy);
        if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push(set.get(k)); }
      }
    }
    out.push(comp);
  }
  return out;
}

/**
 * Dress one room: furniture by the placement grammar, then scatter thinning away from it,
 * then wall pieces. Returns { furniture, scatter } (both arrays of Decor entries).
 */
function dressRoom(level, room, space) {
  const out = { furniture: [], scatter: [] };
  const plan = PLANS[room.archetype] || [];
  const { floor, entrances, wallSide, free } = space;
  if (!floor.length) return out;
  const rng = createRng(room.decorSeed);
  const freeSet = new Set(free.map((t) => key(t.x, t.y)));
  const decay = room.decay;
  const props = new Set(), decals = new Set(), usedWalls = new Set();
  const maxProps = Math.max(1, Math.floor(0.18 * floor.length));
  const maxAny = Math.floor(0.35 * floor.length);
  const longAxis = room.w >= room.h ? 'x' : 'y';
  // §8.2 rule 10: the four tiles nearest the room centre stay clear of standing scatter
  const centreTiles = new Set(floor.slice()
    .sort((a, b) => (Math.abs(a.x - room.cx) + Math.abs(a.y - room.cy)) - (Math.abs(b.x - room.cx) + Math.abs(b.y - room.cy))
      || a.y - b.y || a.x - b.x)
    .slice(0, 4).map((t) => key(t.x, t.y)));

  const taken = new Set();                       // floor tiles carrying any decor
  const baseComps = components(floor);
  const clearFloor = Math.ceil(0.55 * floor.length);
  /** Would occupying (x,y) still leave the room reading as walkable floor? (§8.3) */
  const fitsFloor = (x, y) => {
    const k = key(x, y);
    if (taken.has(k)) return true;
    if (taken.size + 1 > maxAny) return false;
    if (floor.length - (taken.size + 1) < clearFloor) return false;
    for (const comp of baseComps) {
      if (!comp.some((t) => t.x === x && t.y === y)) continue;
      const keep = comp.filter((t) => !taken.has(key(t.x, t.y)) && !(t.x === x && t.y === y));
      if (!keep.length || components(keep).length !== 1) return false;
    }
    return true;
  };
  const used = () => taken.size;
  const freeFor = (cls) => free.filter((t) => {
    const k = key(t.x, t.y);
    if (cls === 'prop') return !props.has(k) && !decals.has(k);
    return !decals.has(k);
  });
  const canAddProp = () => props.size < maxProps && used() < maxAny;

  let anchor = null;
  let blockingLeft = floor.length >= 12 ? Math.min(2, Math.floor(floor.length / 12)) : 0;

  const push = (list, type, x, y, facing, variant, blocking) => {
    const cls = DECOR_TYPES[type].cls;
    if (cls === 'prop') props.add(key(x, y)); else if (cls === 'decal') decals.add(key(x, y));
    taken.add(key(x, y));
    list.push({ type, x, y, facing, variant, blocking });
  };

  /** Candidate tiles for a placement rule, best first. */
  const candidates = (p) => {
    const pool = freeFor('prop');
    const wall = pool.filter((t) => wallSide.has(key(t.x, t.y)));
    const inner = pool.filter((t) => !wallSide.has(key(t.x, t.y)));
    if (p === 'interior') return (inner.length ? inner : pool);
    if (p === 'any') return pool;
    if (p === 'around' && anchor) {
      return pool.filter((t) => Math.max(Math.abs(t.x - anchor.x), Math.abs(t.y - anchor.y)) === 1);
    }
    if (p === 'flank' && anchor) {
      const along = FACE[anchor.facing].dx !== 0 ? [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }] : [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }];
      return along.map((d) => pool.find((t) => t.x === anchor.x + d.dx && t.y === anchor.y + d.dy)).filter(Boolean);
    }
    if (p === 'wallLong') {
      const want = longAxis === 'x' ? ['n', 's'] : ['e', 'w'];
      const run = wall.filter((t) => want.includes(wallSide.get(key(t.x, t.y))));
      return run.length ? run : wall;
    }
    if (p === 'wallCentre') {
      // a hearth, a throne or a forge belongs on the room's outer wall, not against a pillar
      const rim = wall.filter((t) => t.x === room.x || t.y === room.y || t.x === room.x + room.w - 1 || t.y === room.y + room.h - 1);
      return (rim.length ? rim : wall).slice().sort((a, b) => (Math.abs(a.x - room.cx) + Math.abs(a.y - room.cy)) - (Math.abs(b.x - room.cx) + Math.abs(b.y - room.cy))
        || a.y - b.y || a.x - b.x);
    }
    return wall.length ? wall : pool;
  };

  const facingFor = (p, t) => {
    const wf = wallSide.get(key(t.x, t.y));
    if (p === 'around' && anchor) {
      const dx = anchor.x - t.x, dy = anchor.y - t.y;
      return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
    }
    if (wf && p !== 'interior') return wf;
    const dx = room.cx - t.x, dy = room.cy - t.y;
    if (dx === 0 && dy === 0) return 's';
    return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
  };

  for (const step of plan) {
    const want = rng.int(step.n[0], step.n[1]);
    for (let i = 0; i < want; i++) {
      if (!canAddProp()) break;
      const ordered = candidates(step.p);
      if (!ordered.length) break;
      // the connectivity half of the density rule is expensive: sample first, scan only if we must
      const inOrder = step.p === 'wallCentre' || step.p === 'flank';
      let t = null;
      if (!inOrder) for (let k = 0; k < 8 && !t; k++) { const c = rng.pick(ordered); if (fitsFloor(c.x, c.y)) t = c; }
      if (!t) t = ordered.find((c) => fitsFloor(c.x, c.y)) || null;
      if (!t) break;
      const facing = facingFor(step.p, t);
      let variant = variantFor(rng, step.t, decay);
      let blocking = false;
      if (DECOR_TYPES[step.t].blk && blockingLeft > 0 && rng.chance(0.55) && blockingOk(level, t.x, t.y)) {
        blocking = true; blockingLeft--;
      }
      if (step.run) {
        // a run lies along the axis perpendicular to `facing`; segments are 0 / 1.. / 2 (§5.4)
        const perp = FACE[facing].dx !== 0 ? { dx: 0, dy: 1 } : { dx: 1, dy: 0 };
        const len = Math.min(want - i, 3);
        const seg = [];
        for (let k = 0; k < len; k++) {
          const q = { x: t.x + perp.dx * k, y: t.y + perp.dy * k };
          if (!freeSet.has(key(q.x, q.y)) || props.has(key(q.x, q.y)) || !canAddProp() || !fitsFloor(q.x, q.y)) break;
          seg.push(q);
        }
        if (seg.length >= 2) {
          seg.forEach((q, k) => push(out.furniture, step.t, q.x, q.y, facing, k === 0 ? 0 : k === seg.length - 1 ? 2 : 1, false));
          i += seg.length - 1;
          if (step.anchor && !anchor) anchor = { x: seg[0].x, y: seg[0].y, facing };
          continue;
        }
        variant = 0;
      }
      push(out.furniture, step.t, t.x, t.y, facing, variant, blocking);
      if (step.anchor && !anchor) anchor = { x: t.x, y: t.y, facing };
    }
  }

  const sig = ARCHETYPES[room.archetype].sig;
  if (sig && !out.furniture.some((d) => d.type === sig)) {
    room.archetype = 'bare';
    room.lightMood = driftMood(ARCHETYPES.bare.mood, decay);
    out.furniture.length = 0;
    props.clear(); decals.clear(); taken.clear();
  }

  // ---- scatter, thinning away from the furniture (§8.2 rule 9)
  const furnTiles = out.furniture.map((d) => ({ x: d.x, y: d.y }));
  const table = (SCATTER[room.archetype] || []).map((t) => ({ t, w: scatterWeight(level, t, decay) })).filter((e) => e.w > 0);
  if (table.length && room.archetype !== 'bare') {
    const base = 0.5 + decay * 0.2;
    for (const t of free) {
      if (used() >= maxAny) break;
      const k = key(t.x, t.y);
      let d = 3;
      for (const f of furnTiles) d = Math.min(d, Math.max(Math.abs(f.x - t.x), Math.abs(f.y - t.y)));
      if (!furnTiles.length) d = 2;
      if (!rng.chance(base * Math.pow(0.35, Math.min(d, 3)))) continue;
      const pick = weightedPick(rng, table);
      if (!pick) continue;
      const cls = DECOR_TYPES[pick.t].cls;
      // one type repeated eight times is wallpaper, not dressing
      const cap = cls === 'prop' ? 2 : 3;
      if (out.scatter.filter((d) => d.type === pick.t).length >= cap) continue;
      if (cls === 'prop') {
        if (centreTiles.has(k) || props.has(k) || !canAddProp()) continue;
      } else if (decals.has(k) || (centreTiles.has(k) && [...centreTiles].some((c) => decals.has(c)))) continue;
      if (!fitsFloor(t.x, t.y)) continue;
      push(out.scatter, pick.t, t.x, t.y, rng.pick(['n', 'e', 's', 'w']), variantFor(rng, pick.t, decay), false);
    }
  } else if (room.archetype === 'bare' && free.length && rng.chance(0.5)) {
    const t = rng.pick(free.filter((c) => fitsFloor(c.x, c.y)) );
    const type = rng.pick(['scree', 'bones', 'crackedFlags']);
    if (t) push(out.scatter, type, t.x, t.y, rng.pick(['n', 'e', 's', 'w']), variantFor(rng, type, decay), false);
  }

  // ---- wall dressing (§8.2 rule 11): only walls a floor tile of this room can look at
  const wallSpots = [];
  for (const t of floor) {
    if (entrances.has(key(t.x, t.y))) continue;
    for (const d of DIRS4) {
      const wx = t.x + d.dx, wy = t.y + d.dy;
      if (level.get(wx, wy) !== TILE.WALL) continue;
      // `facing` runs from the wall tile into the tile that looks at it (§4.1 coordinate law)
      const facing = d.dx === 1 ? 'w' : d.dx === -1 ? 'e' : d.dy === 1 ? 'n' : 's';
      wallSpots.push({ x: wx, y: wy, facing });
    }
  }
  const wallList = WALL_SET[room.archetype] || ['cobweb'];
  let wallWant = floor.length < 4 ? 0 : room.archetype === 'bare' ? (rng.chance(0.35) ? 1 : 0) : rng.int(1, 3);
  if (decay > 0.5 && room.archetype !== 'bare') wallWant += rng.int(0, 1);
  rng.shuffle(wallSpots);
  for (const spot of wallSpots) {
    if (wallWant <= 0) break;
    const k = key(spot.x, spot.y);
    if (usedWalls.has(k)) continue;
    let type = rng.pick(wallList);
    if (decay > 0.45 && rng.chance(0.35)) type = 'cobweb';
    if (type === 'mould' && level.depth < 6) type = 'cobweb';
    if (type === 'cobweb') {
      // corners only: the mount wall must have wall on an adjacent side
      const perp = FACE[spot.facing].dx !== 0 ? [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }] : [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
      if (!perp.some((d) => level.get(spot.x + d.dx, spot.y + d.dy) === TILE.WALL)) continue;
    }
    if (out.scatter.some((d) => d.type === type && DECOR_TYPES[d.type].cls === 'wall'
      && Math.max(Math.abs(d.x - spot.x), Math.abs(d.y - spot.y)) < 2)) continue;
    usedWalls.add(k);
    out.scatter.push({ type, x: spot.x, y: spot.y, facing: spot.facing, variant: variantFor(rng, type, decay), blocking: false });
    wallWant--;
  }

  // ---- density (§8.3): drop scatter, newest first, until the room reads as walkable floor.
  // The clear floor must stay as connected as the bare room was — a room whose floor is already
  // split (water, pillars, a bitten outline) is judged component by component, not as one blob.
  const base = components(floor);
  const clearOk = () => {
    const taken = new Set();
    for (const d of out.furniture.concat(out.scatter)) {
      if (DECOR_TYPES[d.type].cls === 'wall') continue;
      taken.add(key(d.x, d.y));
    }
    if (taken.size > maxAny) return false;
    const clear = floor.filter((t) => !taken.has(key(t.x, t.y)));
    if (clear.length < Math.ceil(0.55 * floor.length)) return false;
    for (const comp of base) {
      const keep = comp.filter((t) => !taken.has(key(t.x, t.y)));
      if (!keep.length) return false;
      if (components(keep).length !== 1) return false;
      // every way in stays walkable and clear
      for (const t of comp) if (entrances.has(key(t.x, t.y)) && taken.has(key(t.x, t.y))) return false;
    }
    return true;
  };
  let drops = 0;
  while (!clearOk() && out.scatter.length) { out.scatter.pop(); drops++; }
  while (!clearOk() && out.furniture.length > 1) { out.furniture.pop(); drops++; }
  if (!clearOk()) { out.furniture.length = 0; out.scatter.length = 0; drops++; }
  out.drops = drops;
  return out;
}

/** Scatter weight for a type in this room: decay and depth decide what has survived (§2.1). */
function scatterWeight(level, type, decay) {
  const d = level.depth;
  let w = 3;
  if (type === 'bones' || type === 'bonePile' || type === 'skull' || type === 'skullPile') w = 2 + decay * 4;
  else if (type === 'scree') w = 1 + decay * 4;
  else if (type === 'rug' || type === 'runner' || type === 'mosaic') w = Math.max(0, 3 - decay * 5);
  else if (type === 'coins' || type === 'tankards' || type === 'dice' || type === 'bottles') w = Math.max(0.5, 3 - decay * 2);
  else if (type === 'rime') w = d >= 13 ? 3 : 0;
  else if (type === 'bloodstain') w = d >= 3 ? 2 : 0;
  else if (type === 'rat') w = d <= 12 ? 2 : 0;
  else if (type === 'puddle') w = 3;
  return w;
}

/** May a blocking piece stand here? (§4.3 rule 3) */
function blockingOk(level, x, y) {
  if (level.get(x, y) !== TILE.FLOOR) return false;
  // a room's centre is the tile everything else is measured from; never shut it
  if (level.rooms.some((r) => r.cx === x && r.cy === y)) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const t = level.get(x + dx, y + dy);
    if (t === TILE.STAIRS_UP || t === TILE.STAIRS_DOWN || t === TILE.TEMPLE || t === TILE.DOOR
      || t === TILE.PIT || t === TILE.CORRIDOR || t === TILE.TRAP_PIT || t === TILE.TRAP_TELEPORT) return false;
    if (level.trapAt(x + dx, y + dy)) return false;
    if (level.itemsAt(x + dx, y + dy).length) return false;
    if (level.entityAt(x + dx, y + dy)) return false;
  }
  return true;
}

/** Corridor dressing (§3): bare by law, with one indulgence at the dead ends. */
function dressCorridors(level, rng) {
  const out = [];
  const tiles = [];
  for (let y = 1; y < level.height - 1; y++) for (let x = 1; x < level.width - 1; x++) {
    if (level.get(x, y) === TILE.CORRIDOR) tiles.push({ x, y });
  }
  if (!tiles.length) return out;
  const budget = Math.min(12, Math.floor(tiles.length / 10));
  const taken = [];
  const spaced = (x, y) => !taken.some((t) => Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) < 2);
  const spread = (pred, r) => {
    const g = new Uint8Array(level.width * level.height);
    for (let y = 0; y < level.height; y++) for (let x = 0; x < level.width; x++) {
      if (!pred(level.get(x, y))) continue;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (level.inBounds(x + dx, y + dy)) g[level.idx(x + dx, y + dy)] = 1;
      }
    }
    return g;
  };
  const doorGrid = spread((t) => t === TILE.DOOR, 2), waterGrid = spread((t) => t === TILE.WATER, 6);
  const nearDoor = (x, y) => doorGrid[level.idx(x, y)] === 1;
  const wetNear = (x, y) => waterGrid[level.idx(x, y)] === 1;
  const decay = clamp01((level.depth - 1) / 18);
  const place = (t, type) => {
    const cls = DECOR_TYPES[type].cls;
    if (cls === 'wall') {
      const opts = DIRS4.map((d) => ({ x: t.x + d.dx, y: t.y + d.dy, facing: d.dx === 1 ? 'w' : d.dx === -1 ? 'e' : d.dy === 1 ? 'n' : 's' }))
        .filter((w) => level.get(w.x, w.y) === TILE.WALL);
      // `facing` points from the wall tile into the corridor tile
      const spot = opts.length ? rng.pick(opts) : null;
      if (!spot || nearDoor(spot.x, spot.y)) return false;
      if (type === 'cobweb') {
        const perp = FACE[spot.facing].dx !== 0 ? [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }] : [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
        if (!perp.some((d) => level.get(spot.x + d.dx, spot.y + d.dy) === TILE.WALL)) return false;
      }
      out.push({ type, x: spot.x, y: spot.y, facing: spot.facing, variant: variantFor(rng, type, decay), blocking: false });
    } else {
      out.push({ type, x: t.x, y: t.y, facing: rng.pick(['n', 'e', 's', 'w']), variant: variantFor(rng, type, decay), blocking: false });
    }
    taken.push({ x: t.x, y: t.y });
    return true;
  };
  // the "someone died here" beat at a dead end, capped so corridors stay corridors
  let extras = 0;
  for (const t of tiles) {
    if (extras >= 6) break;
    const open = DIRS4.filter((d) => level.isWalkable(t.x + d.dx, t.y + d.dy)).length;
    if (open !== 1 || !rng.chance(0.3)) continue;
    if (level.decorForbidden(t.x, t.y, true) || nearDoor(t.x, t.y) || !spaced(t.x, t.y)) continue;
    if (place(t, rng.pick(['bones', 'scree', 'rubbleMound']))) extras++;
  }
  let made = 0;
  for (let i = 0; i < tiles.length * 4 && made < budget; i++) {
    const t = rng.pick(tiles);
    if (level.decorForbidden(t.x, t.y, true) || nearDoor(t.x, t.y) || !spaced(t.x, t.y)) continue;
    const table = CORRIDOR_TABLE.map((e) => ({
      t: e.t,
      w: e.t === 'puddle' ? (wetNear(t.x, t.y) || decay > 0.5 ? e.w : 0)
        : e.t === 'bloodstain' ? (level.depth >= 3 ? e.w : 0)
          : e.t === 'mould' ? (level.depth >= 6 ? e.w : 0)
            : e.t === 'rat' ? (level.depth <= 12 ? e.w : 0)
              : e.t === 'scree' ? e.w * (0.5 + decay) : e.w,
    }));
    const pick = weightedPick(rng, table);
    if (pick && place(t, pick.t)) made++;
  }
  return out;
}

/**
 * Assign an archetype, a light mood, a decay level and a dressing seed to every room (§6.3).
 * Side rooms are locked first; the rest are picked largest-first so the biggest room gets first
 * claim on a signature identity, and a quarter of the level is deliberately left bare.
 */
function assignArchetypes(level, rng, isSwordLevel) {
  const band = bandIndex(level.depth);
  for (const room of level.rooms) {
    room.decay = clamp01((level.depth - 1) / 18 + rng.float(-0.12, 0.12));
    room.decorSeed = rng.int(1, 2 ** 30);
  }
  const counts = {};
  const lock = (room, id) => { room.archetype = id; counts[id] = (counts[id] || 0) + 1; };
  const spaces = new Map();
  for (const room of level.rooms) spaces.set(room, roomSpace(level, room));
  const fits = (room, id) => {
    const a = ARCHETYPES[id];
    const sp = spaces.get(room), free = sp.free;
    if (sp.floor.length < a.min || free.length < 2) return false;
    if (!a.sig) return true;
    const wallHug = !['table', 'tableLong', 'rack', 'wellHead', 'fallenColumn', 'cauldron'].includes(a.sig);
    return free.some((t) => (sp.wallSide.has(key(t.x, t.y)) === wallHug) || free.length > 6);
  };
  const main = [];
  for (const room of level.rooms) {
    if (room.type === 'temple' || room.type === 'shrine') lock(room, 'shrine');
    else if (room.type === 'alcove') lock(room, 'bare');
    else if (room.type === 'surface') lock(room, 'courtyard');
    else main.push(room);
  }
  const order = main.map((r, i) => ({ r, i })).sort((a, b) => (b.r.area || b.r.w * b.r.h) - (a.r.area || a.r.w * a.r.h) || a.i - b.i);
  // the biggest room on the level gets first pick of a signature identity, and is the least likely
  // to be left empty; the closets are the ones that stay bare (§6.3 rule 2)
  const bareBias = (i) => (order.length < 3 ? 1 : i < order.length / 3 ? 0.4 : i < (order.length * 2) / 3 ? 1 : 1.8);
  for (const [oi, { r }] of order.entries()) {
    const table = [];
    for (const [id, a] of Object.entries(ARCHETYPES)) {
      if (id === 'shrine' || id === 'courtyard') continue;
      if (isSwordLevel && !SWORD_ARCHETYPES.has(id)) continue;
      if (!a.rooms.includes('*') && !a.rooms.includes(r.type)) continue;
      if ((counts[id] || 0) >= a.cap) continue;
      let w = a.w[band];
      if (w <= 0) continue;
      if (id === 'bare') w *= bareBias(oi);
      else if (!fits(r, id)) continue;
      table.push({ t: id, w });
    }
    const pick = weightedPick(rng, table);
    lock(r, pick ? pick.t : 'bare');
  }
  // §6.3 rule 6: between a quarter and three-fifths of a level is deliberately empty
  const bareOf = (r) => r.archetype === 'bare';
  const minBare = Math.ceil(main.length * 0.25), maxBare = Math.floor(main.length * 0.6);
  let bare = main.filter(bareOf).length;
  const bySize = main.slice().sort((a, b) => (a.area || a.w * a.h) - (b.area || b.w * b.h));
  for (const r of bySize) {
    if (bare >= minBare) break;
    if (bareOf(r)) continue;
    counts[r.archetype]--; r.archetype = 'bare'; bare++;
  }
  for (const r of bySize.slice().reverse()) {
    if (bare <= maxBare) break;
    if (!bareOf(r)) continue;
    const table = [];
    for (const [id, a] of Object.entries(ARCHETYPES)) {
      if (id === 'bare' || id === 'shrine' || id === 'courtyard') continue;
      if (isSwordLevel && !SWORD_ARCHETYPES.has(id)) continue;
      if (!a.rooms.includes('*') && !a.rooms.includes(r.type)) continue;
      if ((counts[id] || 0) >= a.cap || a.w[band] <= 0 || !fits(r, id)) continue;
      table.push({ t: id, w: a.w[band] });
    }
    const pick = weightedPick(rng, table);
    if (!pick) continue;
    lock(r, pick.t); bare--;
  }
  for (const room of level.rooms) {
    const a = ARCHETYPES[room.archetype];
    room.lightMood = isSwordLevel && room.archetype !== 'shrine' ? 'sword' : driftMood(a.mood, room.decay);
  }
  return spaces;
}

/**
 * Place every piece of ambience on the level and prove it broke nothing (docs/AMBIENCE.md).
 * Runs after the treasure is down and before the monsters go in, so nothing lands on loot.
 * @param {Level} level
 * @param {boolean} isSwordLevel
 */
export function placeDecor(level, isSwordLevel = false) {
  const rng = createRng(seedFrom(level.seed, 'decor'));
  const spaces = assignArchetypes(level, rng, isSwordLevel);
  const furniture = [], scatter = [];
  let drops = 0;
  for (const room of level.rooms) {
    const dressed = dressRoom(level, room, spaces.get(room));
    furniture.push(...dressed.furniture);
    scatter.push(...dressed.scatter);
    drops += dressed.drops || 0;
  }
  const corridor = dressCorridors(level, rng);
  let all = furniture.concat(scatter, corridor);
  if (all.length > 220) all = all.slice(0, 220);   // renderer budget (§8.3)
  level.setDecor(all);
  // §4.3 rule 4: nothing may sever the level. Back blocking pieces out until the fill passes.
  let backedOut = 0;
  const start = level.stairsUp || level.stairsDown;
  if (start) {
    for (;;) {
      const reach = level.floodFill(start.x, start.y);
      let missing = 0;
      for (let i = 0; i < level.tiles.length; i++) {
        if (reach[i] || level.tiles[i] === TILE.WALL) continue;
        // a tile a blocking piece stands on is meant to be shut; anything else must still be reached
        if (!level.decorBlocked(i % level.width, (i / level.width) | 0)) missing++;
      }
      if (!missing) break;
      const last = [...all].reverse().find((d) => d.blocking);
      if (!last) break;
      last.blocking = false; backedOut++;
      level.setDecor(all);
    }
  }
  level.debug.decor = { pieces: all.length, blocking: all.filter((d) => d.blocking).length, densityDrops: drops, blockDrops: backedOut };
  return all;
}

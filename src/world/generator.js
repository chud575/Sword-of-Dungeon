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
  if (depth === 0) return generateSurface(level, rng);
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

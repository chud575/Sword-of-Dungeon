// Screenshot / smoke scenarios. Each sets up a visually representative state. The context gives
// `reset(seed)` (fresh Game), `game`, `renderer`, `step(ms)` (deterministic sim + render substeps).
import { TILE } from '../core/constants.js';
import { Level } from '../world/level.js';
import { MONSTER_TYPES } from '../game/monsters.js';
import { addHallOfFameEntry, getHallOfFame } from '../core/save.js';

/** Walkable tiles adjacent to (x,y) (8-way), nearest-first order as given by DIRS8. */
function neighbours(level, x, y, { empty = true } = {}) {
  const out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (!level.isWalkable(nx, ny)) continue;
    const t = level.get(nx, ny);
    if (t === TILE.PIT || t === TILE.TRAP_PIT || t === TILE.STAIRS_DOWN || t === TILE.WATER) continue;
    if (empty && (level.entityAt(nx, ny) || level.itemsAt(nx, ny).length)) continue;
    out.push({ x: nx, y: ny });
  }
  return out;
}

/** Put the player next to a tile (prefers the tile south of it so the camera sees both). */
function teleportNear(game, x, y) {
  const lv = game.level;
  const opts = neighbours(lv, x, y, { empty: false }).filter((n) => !lv.monsterAt(n.x, n.y));
  opts.sort((a, b) => (b.y - y) - (a.y - y) || Math.abs(a.x - x) - Math.abs(b.x - x));
  const s = opts[0];
  if (s) game.teleportTo(s.x, s.y);
  return s;
}

/** Put the player beside a tile (east/west first, then south) so the camera sees the tile unobstructed. */
function teleportBeside(game, x, y) {
  const lv = game.level;
  const opts = neighbours(lv, x, y, { empty: false }).filter((n) => !lv.monsterAt(n.x, n.y));
  const rank = (n) => (n.y === y && Math.abs(n.x - x) === 1 ? 0 : n.y > y ? 1 : 2) * 10 + Math.abs(n.x - x) + Math.abs(n.y - y);
  opts.sort((a, b) => rank(a) - rank(b));
  const s = opts[0];
  if (s) game.teleportTo(s.x, s.y);
  return s;
}

function findTiles(level, tile) {
  const out = [];
  for (let y = 0; y < level.height; y++) for (let x = 0; x < level.width; x++) if (level.get(x, y) === tile) out.push({ x, y });
  return out;
}

/** Find a depth (from `from`) whose level contains a tile type; returns {depth, tiles} or null. */
function findDepthWith(game, tile, from = 1, to = 12) {
  for (let d = from; d <= to; d++) {
    const lv = game.getLevel(d);
    const tiles = findTiles(lv, tile);
    if (tiles.length) return { depth: d, tiles };
  }
  return null;
}

function freeze(m) { m.speed = 0; m.moveTimer = 0; }

/** Empty, visible floor tiles at Chebyshev distance rMin..rMax from (x,y), nearest ring first. */
function ringTiles(level, x, y, rMin, rMax, { visible = true } = {}) {
  const out = [];
  for (let r = rMin; r <= rMax; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const tx = x + dx, ty = y + dy;
    if (!level.isEmptyFloor(tx, ty) || (visible && !level.isVisible(tx, ty))) continue;
    out.push({ x: tx, y: ty, r });
  }
  return out;
}

/** Spawn a hunting monster that already knows where the hero is (scenario helper). */
function hunter(g, type, s, { depth, speed = 1.5, timer = 0.95 } = {}) {
  const m = g.spawnMonster(type, s.x, s.y, { depth: depth ?? g.depth, state: 'hunt' });
  if (!m) return null;
  const p = g.player;
  m.lastSeen = { x: p.x, y: p.y }; m.target = m.lastSeen; m.hadPrey = true;
  m.facing = { dx: Math.sign(p.x - s.x), dy: Math.sign(p.y - s.y) };
  m.speed = speed; m.moveTimer = timer;
  return m;
}

/** Depth in [from,to] whose level shows off the generator best (shape variety, water, pillars, temple chambers). */
function pickShowcaseDepth(game, from, to) {
  let best = from, bestScore = -Infinity;
  for (let d = from; d <= to; d++) {
    const lv = game.getLevel(d);
    const shapes = new Set(lv.rooms.map((r) => r.shape || r.type)).size;
    let pillars = 0;
    for (let y = 1; y < lv.height - 1; y++) for (let x = 1; x < lv.width - 1; x++) {
      if (lv.get(x, y) === TILE.WALL && lv.isWalkable(x - 1, y) && lv.isWalkable(x + 1, y) && lv.isWalkable(x, y - 1) && lv.isWalkable(x, y + 1)) pillars++;
    }
    const s = shapes * 2 + Math.min(20, findTiles(lv, TILE.WATER).length) * 0.4 + Math.min(12, pillars) * 0.5 + lv.temples.length * 2 + findTiles(lv, TILE.RUBBLE).length * 0.3;
    if (s > bestScore) { bestScore = s; best = d; }
  }
  return best;
}

/** Frame the whole level from above, padded so the 45-degree view keeps every corner on screen. */
function fitOverview(ctx, elevation = 62) {
  const lv = ctx.game.level;
  let minX = lv.width, minY = lv.height, maxX = 0, maxY = 0;
  for (let y = 0; y < lv.height; y++) for (let x = 0; x < lv.width; x++) if (lv.get(x, y) !== TILE.WALL) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const w = maxX - minX + 3, h = maxY - minY + 3;
  ctx.renderer.cameraRig.setOverview((minX + maxX) / 2, (minY + maxY) / 2 + 1, w * 1.12, h * 1.22, { elevation });
  ctx.renderer.cameraRig.snap();
}

/** A lit rectangular hall registered at `depth` (used by the bestiary scenarios). */
function bestiaryHall(g, W, H, depth) {
  const lv = new Level({ depth, width: W, height: H, seed: 7 });
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) lv.set(x, y, TILE.FLOOR);
  lv.rooms.push({ x: 1, y: 1, w: W - 2, h: H - 2, type: 'hall', cx: W >> 1, cy: H >> 1 });
  lv.set(1, 1, TILE.STAIRS_UP); lv.stairsUp = { x: 1, y: 1 };
  lv.set(W - 2, 1, TILE.STAIRS_DOWN); lv.stairsDown = { x: W - 2, y: 1 }; lv.stairsDownAll = [{ x: W - 2, y: 1 }];
  lv.set(1, H - 2, TILE.TEMPLE); lv.temples.push({ x: 1, y: H - 2 });
  lv.revealAll();
  g.levels.set(depth, lv);
  return lv;
}

/** Monsters in two ranks in front of the hero, seen from the ordinary gameplay camera. */
function lineup(ctx, types) {
  const g = ctx.reset();
  const W = 18, H = 12, depth = 3;
  bestiaryHall(g, W, H, depth);
  const px = W >> 1, py = H - 3;
  g.enterLevel(depth, 'teleport', { arrival: { x: px, y: py } });
  const p = g.player; p.facing = { dx: 0, dy: -1 };
  const front = Math.ceil(types.length / 2), back = types.length - front;
  types.forEach((t, i) => {
    const row = i < front ? 0 : 1, col = i < front ? i : i - front, n = row === 0 ? front : back;
    const x = px + Math.round((col - (n - 1) / 2) * 1.5), y = py - 2 - row * 2;
    const m = g.spawnMonster(t, x, y, { depth: 10, state: 'idle' });
    if (m) { freeze(m); m.facing = { dx: 0, dy: 1 }; m.invisible = false; m.flags.invisible = false; }
  });
  ctx.renderer.fog.override = 'all';
  ctx.renderer.rebuildLevel();
  ctx.renderer.cameraRig.follow(ctx.renderer.playerView.pos, { x: 0, z: -1.5 });
  ctx.renderer.cameraRig.snap();
  ctx.step(500);
}

function castWith(ctx, spell) {
  const g = ctx.game;
  g.give(spell, 1);
  g.castSpell(spell);
}

/** Step the player off the up-stairs (its archway hides effects) onto an open floor tile, preferring south. */
function clearStart(game) {
  const p = game.player, lv = game.level;
  const opts = neighbours(lv, p.x, p.y).filter((n) => lv.get(n.x, n.y) === TILE.FLOOR);
  opts.sort((a, b) => (b.y - p.y) - (a.y - p.y) || Math.abs(a.x - p.x) - Math.abs(b.x - p.x));
  const s = opts[0];
  if (s) { game.teleportTo(s.x, s.y); game.updateFov(); }
  return s;
}

/** Nearest empty floor tile (at least `minDist` from the player) whose 8 neighbours are all plain floor. */
function interiorSpot(game, minDist = 2) {
  const p = game.player, lv = game.level;
  let best = null, bestD = Infinity;
  for (let y = 1; y < lv.height - 1; y++) for (let x = 1; x < lv.width - 1; x++) {
    if (lv.get(x, y) !== TILE.FLOOR || !lv.isEmptyFloor(x, y)) continue;
    let ok = true;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (lv.get(x + dx, y + dy) !== TILE.FLOOR) { ok = false; break; }
    if (!ok) continue;
    const d = Math.abs(x - p.x) + Math.abs(y - p.y);
    if (d >= minDist && d < bestD) { best = { x, y }; bestD = d; }
  }
  return best;
}

/** Stage a pickup: player north of an interior tile, item on it, then step south onto it. */
function stageStepOnto(ctx, item) {
  const g = ctx.game, lv = g.level;
  const s = interiorSpot(g, 2);
  if (!s) return null;
  g.teleportTo(s.x, s.y - 1); g.updateFov();
  if (item) lv.addItem({ qty: 1, x: s.x, y: s.y, ...item });
  ctx.step(200);
  g.move(0, 1);
  ctx.step(g.balance.playerStepTime * 1000 + 40);
  return s;
}

/** Empty floor tiles around the player ordered south row, sides, north row, then the second ring. */
function ringSpots(game, max = 12) {
  const p = game.player, lv = game.level;
  const spots = [];
  for (let r = 1; r <= 2 && spots.length < max; r++) {
    const ring = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = p.x + dx, y = p.y + dy;
      if ((lv.get(x, y) === TILE.FLOOR || lv.get(x, y) === TILE.CORRIDOR) && lv.isEmptyFloor(x, y)) ring.push({ x, y, dx, dy });
    }
    ring.sort((a, b) => (b.dy - a.dy) || Math.abs(a.dx) - Math.abs(b.dx));
    spots.push(...ring);
  }
  return spots;
}

export const scenarios = {
  /** Depth 1 start, player on the up-stairs with the first room revealed. */
  async 'default'(ctx) {
    ctx.reset();
    ctx.step(400);
  },

  /** Audio showcase: unseen threats in the dark (captioned in the log), low HP heartbeat, water drips, deep-level score. */
  async 'audio-cues'(ctx) {
    const g = ctx.reset();
    g.goToDepth(6);
    clearStart(g);
    const p = g.player, lv = g.level;
    p.hp = Math.max(1, Math.floor(p.maxHp * 0.2));
    g.emit('player:hp', { hp: p.hp, maxHp: p.maxHp });
    // hidden floor tiles 3-6 tiles away (Chebyshev), nearest first
    const hidden = [];
    for (let y = 0; y < lv.height; y++) for (let x = 0; x < lv.width; x++) {
      const d = Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
      const t = lv.get(x, y);
      if (d < 3 || d > 7 || !lv.isWalkable(x, y) || (t !== TILE.FLOOR && t !== TILE.CORRIDOR) || lv.entityAt(x, y)) continue;
      hidden.push({ x, y, d, seen: lv.isVisible(x, y) ? 1 : 0 });
    }
    hidden.sort((a, b) => a.seen - b.seen || a.d - b.d); // unseen first, then nearest
    const unseen = hidden.filter((h) => !h.seen);
    const far = unseen[unseen.length - 1] || hidden[hidden.length - 1], near = unseen[0] || hidden[0];
    const troll = far && g.spawnMonster('troll', far.x, far.y, { depth: 6, state: 'hunt' });
    const rogue = near && near !== far && g.spawnMonster('rogue', near.x, near.y, { depth: 6, state: 'wander' });
    if (troll) { freeze(troll); ctx.bus.emit('monster:noticed', { entity: troll }); }
    ctx.step(300);
    if (rogue) { freeze(rogue); ctx.bus.emit('monster:wander', { entity: rogue }); }
    ctx.step(300);
    if (troll) ctx.bus.emit('entity:moved', { entity: troll, fromX: troll.x, fromY: troll.y, toX: troll.x, toY: troll.y });
    ctx.step(600);
  },

  /** Whole level revealed and lit from a high camera. */
  async 'dungeon-overview'(ctx) {
    const g = ctx.reset();
    g.goToDepth(pickShowcaseDepth(g, 2, 5));
    g.revealAll();
    ctx.renderer.fog.override = 'all';
    fitOverview(ctx, 62);
    ctx.step(600);
  },

  /** A deep cavern level (crumbling caves, rubble, pools, pillared halls) revealed from above. */
  async 'cavern-overview'(ctx) {
    const g = ctx.reset();
    g.goToDepth(pickShowcaseDepth(g, 13, 16));
    g.revealAll();
    ctx.renderer.fog.override = 'all';
    fitOverview(ctx, 62);
    ctx.step(600);
  },

  /** A live brawl on depth 6: a pack closes in and surrounds the hero while a warlock kites and hurls bolts from range. */
  async 'combat'(ctx) {
    const g = ctx.reset();
    g.goToDepth(6);
    const p = g.player;
    p.maxHp = 420; p.hp = 420; p.skill = 40; p.level = 5; p.xp = 1700; // mid-run hero: a kill here will not trigger a level-up flash
    for (const m of g.level.monsters) freeze(m);
    g.give('light', 1); g.castSpell('light');
    const lv = g.level;
    const near = ringTiles(lv, p.x, p.y, 2, 3).sort((a, b) => (b.y - p.y) - (a.y - p.y) || Math.abs(a.x - p.x) - Math.abs(b.x - p.x));
    const types = ['werebear', 'hobgoblin', 'hobgoblin', 'swordsman'];
    for (let i = 0; i < types.length && near.length; i++) {
      // spread them around the ring so they arrive from different sides
      const s = near.splice(Math.floor((i * near.length) / types.length) % near.length, 1)[0];
      hunter(g, types[i], s, { depth: 9, speed: 1.6, timer: 0.95 - i * 0.12 });
    }
    const los = (s) => { const dx = Math.abs(s.x - p.x), dy = Math.abs(s.y - p.y); let ok = true; for (let k = 1; k < Math.max(dx, dy); k++) { const x = p.x + Math.round((s.x - p.x) * k / Math.max(dx, dy)), y = p.y + Math.round((s.y - p.y) * k / Math.max(dx, dy)); if (lv.isOpaque(x, y)) ok = false; } return ok; };
    const far = ringTiles(lv, p.x, p.y, 3, 4).filter((s) => s.y <= p.y && los(s)).sort((a, b) => b.r - a.r || Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
    if (far) hunter(g, 'warlock', far, { depth: 14, speed: 1.1, timer: 0.9 });
    // let them close in until the first blows land, then the hero answers the nearest attacker with a held swing
    const adjacent = () => lv.monsters.filter((m) => Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= 1);
    for (let t = 0; t < 3000 && adjacent().length < 2; t += 100) ctx.step(100);
    const adj = adjacent().sort((a, b) => (b.y - p.y) - (a.y - p.y))[0];
    if (adj) { g.move(adj.x - p.x, adj.y - p.y); g.setHeld(adj.x - p.x, adj.y - p.y); }
    ctx.step(380);
  },

  /** Dragon breath: a fyre drake charges a searing breath down a hall and lets it loose at the hero; a wyvern spits venom from the flank. */
  async 'combat-breath'(ctx) {
    const g = ctx.reset();
    const W = 18, H = 14, depth = 12;
    bestiaryHall(g, W, H, depth);
    const px = W >> 1, py = H - 4;
    g.enterLevel(depth, 'teleport', { arrival: { x: px, y: py } });
    const p = g.player; p.facing = { dx: 0, dy: -1 };
    p.maxHp = 900; p.hp = 900; p.skill = 220;
    ctx.renderer.fog.override = 'all';
    ctx.renderer.rebuildLevel();
    // timed against the shot tool's 1.5 s advance: the drake inhales at ~0.9 s and lets loose at ~1.57 s, the wyvern just before it
    const drake = hunter(g, 'fyre-drake', { x: px, y: py - 4 }, { depth, speed: 1.5, timer: -0.35 });
    const wyv = hunter(g, 'wyvern', { x: px - 3, y: py - 3 }, { depth, speed: 1.5, timer: -0.1 });
    if (drake) drake.cooldowns.ranged = 0;
    if (wyv) wyv.cooldowns.ranged = 0;
    ctx.step(300);
  },

  /** Pack tactics on depth 1: a dire wolf catches sight of the hero and howls; its kin come running from the dark. */
  async 'combat-pack'(ctx) {
    const g = ctx.reset();
    const p = g.player;
    p.maxHp = 80; p.hp = 80; p.skill = 14;
    for (const m of g.level.monsters) freeze(m);
    g.give('light', 1); g.castSpell('light');
    const lv = g.level;
    const spots = ringTiles(lv, p.x, p.y, 3, 5).sort((a, b) => a.r - b.r || (b.y - p.y) - (a.y - p.y));
    const wolves = [];
    for (let i = 0; i < 5 && spots.length; i++) {
      // the first wolf is nearest and looking our way; the rest are further off, facing away, until the howl
      const s = i === 0 ? spots.shift() : spots.splice(Math.floor(((i - 1) * spots.length) / 4) % spots.length, 1)[0];
      const w = g.spawnMonster('dire-wolf', s.x, s.y, { state: 'wander' });
      if (!w) continue;
      w.speed = 1.4; w.moveTimer = i === 0 ? 0.98 : 0.3 + i * 0.15;
      w.facing = i === 0 ? { dx: Math.sign(p.x - s.x), dy: Math.sign(p.y - s.y) } : { dx: -Math.sign(p.x - s.x) || 1, dy: -Math.sign(p.y - s.y) };
      wolves.push(w);
    }
    // run until the pack is on top of the hero (at least two wolves within reach)
    const close = () => wolves.filter((w) => w.state !== 'dead' && Math.max(Math.abs(w.x - p.x), Math.abs(w.y - p.y)) <= 1).length;
    for (let t = 0; t < 3000 && close() < 2; t += 200) ctx.step(200);
    ctx.step(150);
  },

  /** A rogue snatches the hero's purse and bolts for the dark: coins fly, the log screams, the chase is on. */
  async 'combat-thief'(ctx) {
    const g = ctx.reset();
    const p = g.player;
    p.maxHp = 40; p.hp = 40; p.skill = 12;
    for (const m of g.level.monsters) freeze(m);
    g.give('light', 1); g.castSpell('light');
    g.give('gold', 85);
    clearStart(g); // off the archway so the snatch is in plain view
    const s = neighbours(g.level, p.x, p.y).sort((a, b) => (b.y - p.y) - (a.y - p.y) || Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
    // the snatch lands ~1.2 s from now: the shot tool's 1.5 s advance catches the coins in the air and the rogue turning to run
    if (s) hunter(g, 'rogue', s, { speed: 1.6, timer: -0.9 });
    ctx.step(16);
  },

  /** Sanctuary: the hero rests on the temple while hunters prowl its edge, unable to enter. */
  async 'combat-sanctuary'(ctx) {
    const g = ctx.reset();
    const found = findDepthWith(g, TILE.TEMPLE, 2, 6);
    if (found) { if (found.depth !== g.depth) g.goToDepth(found.depth); g.teleportTo(found.tiles[0].x, found.tiles[0].y); g.updateFov(); }
    const p = g.player;
    p.maxHp = 120; p.hp = 70; p.skill = 30;
    for (const m of g.level.monsters) freeze(m);
    g.give('light', 1); g.castSpell('light');
    const spots = ringTiles(g.level, p.x, p.y, 2, 3);
    const types = ['ogre', 'hobgoblin', 'mercenary'];
    types.forEach((t, i) => { const s = spots[Math.floor((i * spots.length) / types.length) % spots.length]; if (s) hunter(g, t, s, { speed: 1.5, timer: 0.9 - i * 0.2 }); });
    ctx.step(2000);
  },

  /** The temple altar, glowing, with the player beside it carrying gold. */
  async 'temple'(ctx) {
    const g = ctx.reset();
    const found = findDepthWith(g, TILE.TEMPLE, 1, 6);
    if (found) { if (found.depth !== g.depth) g.goToDepth(found.depth); teleportNear(g, found.tiles[0].x, found.tiles[0].y); }
    g.give('gold', 55);
    ctx.step(500);
  },

  /** Down staircase: the player steps onto it and the camera dives (parked mid-flight for the still). */
  async 'stairs'(ctx) {
    const g = ctx.reset();
    const sd = g.level.stairsDown;
    teleportBeside(g, sd.x, sd.y);
    castWith(ctx, 'light');
    ctx.step(300);
    g.move(sd.x - g.player.x, sd.y - g.player.y);
    ctx.step(g.balance.playerStepTime * 1000 + 120);
    ctx.renderer.transition('descend', () => g.descend());
    ctx.step(200);
    ctx.renderer.cameraRig.freezeTransition(0.22);
    ctx.step(100);
  },

  /** Camera: zoomed all the way in — low, dramatic diorama angle with the FOV tightened. */
  async 'camera-zoom-in'(ctx) {
    const g = ctx.reset();
    castWith(ctx, 'light');
    ctx.renderer.cameraRig.setZoomExact(1.4);
    ctx.step(1200);
  },

  /** Camera: zoomed all the way out — high tactical view over a revealed level. */
  async 'camera-zoom-out'(ctx) {
    const g = ctx.reset();
    g.goToDepth(3); g.revealAll(); ctx.renderer.fog.override = 'all';
    ctx.renderer.cameraRig.setZoomExact(0.72);
    ctx.step(1200);
  },

  /** Camera: pit free-fall caught at the landing thud (trauma shake + bounce). */
  async 'camera-pit-drop'(ctx) {
    const g = ctx.reset();
    ctx.step(200);
    g.enterLevel(g.depth + 1, 'pit', { levels: 1 });
    castWith(ctx, 'light');
    ctx.step(60);
    const rig = ctx.renderer.cameraRig;
    rig.freezeTransition(0.52); rig.shaker.hold = true; rig.shaker.trauma = 0.7;
    ctx.step(120);
  },

  /** Camera: standing at the altar — the rig drops into its reverent low tilt and dollies in. */
  async 'camera-sanctum'(ctx) {
    const g = ctx.reset();
    const found = findDepthWith(g, TILE.TEMPLE, 1, 6);
    if (found) { if (found.depth !== g.depth) g.goToDepth(found.depth); g.teleportTo(found.tiles[0].x, found.tiles[0].y); g.updateFov(); }
    g.give('gold', 120);
    ctx.renderer.cameraRig.snap();
    ctx.step(1500);
  },

  /** Camera: a heavy hit — trauma shake with roll and recoil, held for the still. */
  async 'camera-shake'(ctx) {
    await scenarios.combat(ctx);
    const g = ctx.game;
    g.setHeld(null);
    for (const e of g.level.entities) if (e.kind === 'monster') freeze(e);
    const rig = ctx.renderer.cameraRig;
    rig.shaker.hold = true; rig.shaker.trauma = 0.75;
    rig.punchFov(3);
    ctx.step(90);
  },

  /** An open pit beside the player. */
  async 'pit'(ctx) {
    const g = ctx.reset();
    const found = findDepthWith(g, TILE.PIT, 1, 8);
    if (found) { if (found.depth !== g.depth) g.goToDepth(found.depth); teleportBeside(g, found.tiles[0].x, found.tiles[0].y); }
    else {
      const p = g.player; const s = neighbours(g.level, p.x, p.y)[0];
      if (s) { g.level.set(s.x, s.y, TILE.PIT); ctx.renderer.rebuildLevel(); }
    }
    g.updateFov();
    ctx.step(400);
  },

  /** A cistern pool with animated water. */
  async 'water'(ctx) {
    const g = ctx.reset();
    const found = findDepthWith(g, TILE.WATER, 1, 12);
    if (found) {
      if (found.depth !== g.depth) g.goToDepth(found.depth);
      const t = found.tiles[Math.floor(found.tiles.length / 2)];
      teleportNear(g, t.x, t.y);
      castWith(ctx, 'light');
    }
    ctx.step(600);
  },

  /** Gold, chests, potions, spellbooks and a magic sack laid out around the player in the open. */
  async 'treasure'(ctx) {
    const g = ctx.reset();
    clearStart(g);
    const lv = g.level;
    castWith(ctx, 'light');
    ctx.step(2600); // let the cast settle so the props carry the shot
    const spots = ringSpots(g, 12);
    const items = [
      { type: 'chest', hidden: false, trap: null, content: { item: 'potion' } }, { type: 'gold', gold: 140 }, { type: 'potion' },
      { type: 'teleport' }, { type: 'shield' }, { type: 'sack' }, { type: 'gold', gold: 25 }, { type: 'regeneration' },
      { type: 'chest', hidden: true, trap: null, content: { item: 'sack' } }, { type: 'gold', gold: 60, hidden: true }, { type: 'map' }, { type: 'invisibility' },
    ];
    items.forEach((it, i) => { const s = spots[i]; if (s) lv.addItem({ qty: 1, x: s.x, y: s.y, ...it }); });
    ctx.step(700);
  },

  /** Level-up burst: gold shock ring, helix, pillar, rays and the banner. */
  async 'level-up'(ctx) {
    const g = ctx.reset();
    clearStart(g);
    ctx.step(300);
    g.give('xp', 250);
    ctx.step(120);
  },

  /** Gold pickup: the player steps onto a fat gold sack — coin fountain, flash and the +gold number. */
  async 'gold-pickup'(ctx) {
    const g = ctx.reset();
    stageStepOnto(ctx, { type: 'gold', gold: 95 });
  },

  /** Opening a chest: lid springs back, gold light spills out, coins fountain. */
  async 'chest-open'(ctx) {
    const g = ctx.reset();
    stageStepOnto(ctx, { type: 'chest', hidden: false, trap: null, content: { item: 'potion' } });
    void g;
  },

  /** A monster slain beside the player: ichor burst, soul motes, floor splat. */
  async 'monster-slain'(ctx) {
    const g = ctx.reset();
    const p = g.player;
    p.maxHp = 200; p.hp = 200; p.skill = 60;
    const s = interiorSpot(g, 2);
    if (s) { g.teleportTo(s.x, s.y - 1); g.updateFov(); }
    const m = s ? g.spawnMonster('hobgoblin', s.x, s.y, { depth: 1, state: 'hunt' }) : null;
    if (m) { m.hp = 1; m.facing = { dx: 0, dy: -1 }; g.move(0, 1); }
    ctx.step(260);
  },

  /** The Sword of Fargoal just picked up: pillar of light, aura, sword raised. */
  async 'sword-found'(ctx) {
    const g = ctx.reset();
    const d = g.state.quest.swordDepth;
    g.goToDepth(d);
    const sw = g.level.items.find((it) => it.type === 'sword');
    g.heal(); g.player.maxHp = 500; g.player.hp = 500;
    for (const m of g.level.monsters) freeze(m);
    if (sw) {
      teleportNear(g, sw.x, sw.y);
      ctx.step(200);
      const p = g.player;
      g.move(sw.x - p.x, sw.y - p.y);
      ctx.step(350);
    }
  },

  async 'spell-light'(ctx) { const g = ctx.reset(); castWith(ctx, 'light'); void g; ctx.step(250); },

  /** Fog of war as darkness: the start room remembered (dim, cool), a corridor visible, the rest unknown. */
  async 'fog-of-war'(ctx) {
    const g = ctx.reset();
    ctx.step(200);
    const p = g.player, lv = g.level;
    let best = null, bestD = Infinity;
    for (const t of findTiles(lv, TILE.CORRIDOR)) {
      const d = Math.abs(t.x - p.x) + Math.abs(t.y - p.y);
      if (d >= 5 && d <= 9 && lv.isEmptyFloor(t.x, t.y) && Math.abs(d - 6) < bestD) { best = t; bestD = Math.abs(d - 6); }
    }
    if (best) { g.teleportTo(best.x, best.y); g.updateFov(); }
    ctx.step(700);
  },

  /** A wall torch up close with the lantern off: warm flicker, halo, torch-cast shadows, dust in the beam. */
  async 'torchlight'(ctx) {
    const g = ctx.reset();
    const p = g.player, lv = g.level;
    const spots = ctx.renderer.lighting.torchSpots.slice().sort((a, b) => Math.hypot(a.tx - p.x, a.ty - p.y) - Math.hypot(b.tx - p.x, b.ty - p.y));
    for (const sp of spots) {
      const x = sp.tx + sp.nx * 2, y = sp.ty + sp.nz * 2;
      const alt = { x: sp.tx + sp.nx, y: sp.ty + sp.nz };
      const t = lv.isEmptyFloor(x, y) ? { x, y } : lv.isEmptyFloor(alt.x, alt.y) ? alt : null;
      if (t) { g.teleportTo(t.x, t.y); p.facing = { dx: sp.nx, dy: sp.nz }; g.updateFov(); break; }
    }
    ctx.step(600);
  },

  /** The air itself: a shaft of light from a crack in the ceiling, dust drifting through it, torches beyond. */
  async 'atmosphere'(ctx) {
    const g = ctx.reset();
    for (let d = 2; d <= 6; d++) {
      g.goToDepth(d);
      const spots = ctx.renderer.atmosphere.shaftSpots;
      if (spots.length) {
        const s = spots[0];
        const n = neighbours(g.level, s.x, s.z, { empty: true }).sort((a, b) => (b.y - s.z) - (a.y - s.z))[0];
        if (n) { g.teleportTo(n.x, n.y); g.updateFov(); break; }
      }
    }
    for (const m of g.level.monsters) freeze(m);
    ctx.step(900);
  },
  async 'spell-teleport'(ctx) {
    const g = ctx.reset();
    castWith(ctx, 'teleport');
    ctx.renderer.cameraRig.follow(ctx.renderer.playerView.pos, null); ctx.renderer.cameraRig.snap();
    void g; ctx.step(250);
  },
  async 'spell-shield'(ctx) { const g = ctx.reset(); clearStart(g); ctx.step(200); castWith(ctx, 'shield'); ctx.step(300); },
  async 'spell-invisibility'(ctx) { const g = ctx.reset(); clearStart(g); ctx.step(200); castWith(ctx, 'invisibility'); ctx.step(300); },
  async 'spell-regeneration'(ctx) { const g = ctx.reset(); clearStart(g); ctx.step(200); g.player.hp = Math.floor(g.player.maxHp / 2); castWith(ctx, 'regeneration'); ctx.step(300); },
  async 'spell-drift'(ctx) { const g = ctx.reset(); clearStart(g); ctx.step(200); castWith(ctx, 'drift'); ctx.step(300); },

  /** Depth 18: obsidian/green band, many deep monsters in view. */
  async 'deep-level'(ctx) {
    const g = ctx.reset();
    g.goToDepth(18);
    const p = g.player;
    p.maxHp = 999; p.hp = 999; p.skill = 400;
    // stand in the biggest cavern or hall so the light spell shows the deep level's bones
    const big = g.level.rooms.filter((r) => ['cave', 'grotto', 'hall'].includes(r.type) && (r.area || r.w * r.h) >= 24).sort((a, b) => (b.area || 0) - (a.area || 0))[0];
    if (big) { const s = neighbours(g.level, big.cx, big.cy).concat([{ x: big.cx, y: big.cy }]).find((n) => g.level.isEmptyFloor(n.x, n.y)); if (s) { g.teleportTo(s.x, s.y); g.updateFov(); } }
    castWith(ctx, 'light');
    for (const m of g.level.monsters) freeze(m);
    const types = ['fyre-drake', 'shadow-dragon', 'war-lord', 'dark-warrior', 'dimension-spider', 'troll', 'wyvern', 'demon'];
    const lv = g.level;
    const spots = [];
    for (let r = 2; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = p.x + dx, y = p.y + dy;
      if (lv.isEmptyFloor(x, y) && lv.isVisible(x, y)) spots.push({ x, y });
    }
    types.forEach((t, i) => { const s = spots[i * 2]; if (s) { const m = g.spawnMonster(t, s.x, s.y, { depth: 18, state: 'hunt' }); if (m) { freeze(m); m.facing = { dx: Math.sign(p.x - s.x), dy: Math.sign(p.y - s.y) }; } } });
    ctx.step(500);
  },

  /** Every monster type in a warm, lit hall facing the camera in ranks, the hero in front. */
  async 'bestiary'(ctx) {
    const g = ctx.reset();
    const W = 16, H = 14, depth = 3;
    const lv = bestiaryHall(g, W, H, depth);
    g.enterLevel(depth, 'teleport', { arrival: { x: W >> 1, y: H - 3 } });
    const p = g.player; p.facing = { dx: 0, dy: 1 };
    const types = MONSTER_TYPES;
    const cols = 6;
    types.forEach((t, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = 3 + col * 2, y = 3 + row * 2;
      const m = g.spawnMonster(t, x, y, { depth: 10, state: 'idle' });
      if (m) { freeze(m); m.facing = { dx: 0, dy: 1 }; m.invisible = false; m.flags.invisible = false; }
    });
    ctx.renderer.fog.override = 'all';
    ctx.renderer.rebuildLevel();
    void lv;
    ctx.renderer.cameraRig.setOverview(W / 2, H / 2 - 0.4, 13.5, 10.5, { elevation: 40 });
    ctx.renderer.cameraRig.snap();
    ctx.step(500);
  },

  /** A killing blow: the hero mid-swing, a hobgoblin buckling and toppling, another one flinching from a hit. */
  async 'monster-death'(ctx) {
    const g = ctx.reset();
    const p = g.player;
    p.maxHp = 200; p.hp = 200; p.skill = 400;
    const spots = neighbours(g.level, p.x, p.y).sort((a, b) => (b.y - p.y) - (a.y - p.y) || Math.abs(a.x - p.x) - Math.abs(b.x - p.x));
    const victims = [];
    for (let i = 0; i < Math.min(2, spots.length); i++) {
      const s = spots[i];
      const m = g.spawnMonster(i === 0 ? 'hobgoblin' : 'ogre', s.x, s.y, { depth: 1, state: 'hunt' });
      if (m) { freeze(m); m.facing = { dx: Math.sign(p.x - s.x), dy: Math.sign(p.y - s.y) }; victims.push(m); }
    }
    ctx.step(300);
    if (victims[0]) { victims[0].hp = 1; g.move(victims[0].x - p.x, victims[0].y - p.y); }
    ctx.step(120);
    if (victims[1]) { victims[1].hp = 999; victims[1].maxHp = 999; ctx.renderer.characters.hurt(ctx.renderer.views.get(victims[1].id)); }
    ctx.step(160);
  },

  /** The creature family up close at the gameplay camera: two ranks in front of the hero. */
  async 'bestiary-beasts'(ctx) {
    lineup(ctx, ['dire-wolf', 'ogre', 'hobgoblin', 'werebear', 'gargoyle', 'troll', 'wyvern', 'dimension-spider', 'shadow-dragon', 'fyre-drake', 'demon']);
  },

  /** The human family up close at the gameplay camera: two ranks in front of the hero. */
  async 'bestiary-humans'(ctx) {
    lineup(ctx, ['rogue', 'barbarian', 'elvin-ranger', 'dwarven-guard', 'mercenary', 'swordsman', 'monk', 'dark-warrior', 'assassin', 'war-lord', 'mage']);
  },
};

/** A believable mid-run state for HUD/menu shots: items, statuses, a log and a nearby monster. */
function midRun(ctx, { depth = 6 } = {}) {
  const g = ctx.reset();
  g.goToDepth(depth);
  const p = g.player;
  p.maxHp = 44; p.hp = 31; p.skill = 37; p.enchant = 1;
  g.give('xp', 1450); g.give('gold', 73);
  g.give('shield', 2); g.give('teleport', 2); g.give('regeneration', 1); g.give('light', 1); g.give('invisibility', 1); g.give('drift', 1);
  g.give('potion', 2); g.give('sack', 1); g.give('beacon', 1); g.give('map', 1);
  g.castSpell('light'); g.castSpell('shield'); g.castSpell('regeneration');
  p.kills = 7;
  for (const m of g.level.monsters) freeze(m);
  return g;
}

/** UI scenarios (build step 3): title, panels, menus and end screens. `ctx.ui` is the UI layer. */
export const uiScenarios = {
  /** Title screen over the rotating dungeon backdrop. */
  async 'title'(ctx) {
    ctx.reset();
    ctx.ui.app.toTitle();
    ctx.step(1200);
  },

  /** Inventory / character panel with a full satchel. */
  async 'inventory'(ctx) {
    midRun(ctx);
    ctx.step(300);
    ctx.ui.inventory.show();
    ctx.step(100);
  },

  /** Click-to-move: a committed golden route with its destination reticle and a hovered alternative. */
  async 'qol-path'(ctx) {
    const g = midRun(ctx, { depth: 4 });
    g.revealAll();
    for (const m of g.level.monsters) g.level.removeEntity(m); // a monster coming into view would (rightly) cancel the walk
    ctx.step(2600); // let midRun's level-up banners fade
    const inp = ctx.debug.input, p = g.player, lv = g.level;
    let best = null;
    for (let y = 0; y < lv.height; y++) for (let x = 0; x < lv.width; x++) {
      const dx = Math.abs(x - p.x), dy = Math.abs(y - p.y), d = Math.max(dx, dy);
      const t = lv.get(x, y);
      if (d < 4 || dx > 7 || dy > 5 || !lv.isWalkable(x, y) || lv.isHazard(x, y) || lv.entityAt(x, y) || (t !== TILE.FLOOR && t !== TILE.CORRIDOR)) continue;
      const path = g.pathTo(x, y);
      if (!path || path.length < 4 || path.length > 13) continue;
      const score = path.length >= 6 && path.length <= 11 ? 100 + path.length : path.length; // prefer a winding route that stays on screen
      if (!best || score > best.score) best = { x, y, path, score };
    }
    if (best) { inp.preview.commit(best.path); ctx.bus.emit('input:click', { x: best.x, y: best.y, button: 0, shift: false }); }
    ctx.step(380);
    // hover a second tile off to the side for the dim preview
    let hover = null;
    for (let y = 0; y < lv.height && !hover; y++) for (let x = 0; x < lv.width; x++) {
      const d = Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
      if (d < 4 || d > 6 || !lv.isWalkable(x, y) || lv.isHazard(x, y) || lv.entityAt(x, y)) continue;
      if (best && Math.max(Math.abs(x - best.x), Math.abs(y - best.y)) < 5) continue;
      hover = { x, y }; break;
    }
    if (hover) inp.preview.setHover(hover);
    inp.preview.update(0.4);
    ctx.step(16);
  },

  /** Auto-explore: the teal route to the next frontier, mid-walk. */
  async 'qol-explore'(ctx) {
    const g = ctx.reset();
    g.goToDepth(3);
    for (const m of g.level.monsters) g.level.removeEntity(m); // a sighting would (rightly) stop the exploration
    ctx.step(200);
    ctx.bus.emit('ui:explore', { on: true }); // scenarios run frozen (main.js ignores input), so light the mode directly
    ctx.step(300);
    ctx.debug.input.preview.update(0.3);
    ctx.step(16);
  },

  /** Undo-safe prompt: Space on the stairs down while carrying the Sword. */
  async 'qol-confirm'(ctx) {
    const g = midRun(ctx, { depth: 12 });
    g.give('sword');
    g.state.quest.timer = 1234;
    const sd = g.level.stairsDown;
    if (sd) g.teleportTo(sd.x, sd.y);
    ctx.step(300);
    ctx.debug.input.press('interact');
    ctx.step(200);
  },

  /** Touch controls: the thumb pad and action cluster over a mid-run dungeon. */
  async 'qol-touch'(ctx) {
    const g = midRun(ctx, { depth: 5 });
    const inp = ctx.debug.input;
    inp.settings.touchControls = 'on';
    inp.update(0.016);
    const spots = neighbours(g.level, g.player.x, g.player.y);
    if (spots[0]) { const m = g.spawnMonster('hobgoblin', spots[0].x, spots[0].y, { depth: 5, state: 'hunt' }); if (m) freeze(m); }
    ctx.step(2600); // let the level-up banners from midRun fade
    inp.touch.setExploring(false);
    const arrow = inp.touch.arrows.find((a) => a.d.dx === 1 && a.d.dy === 0);
    if (arrow) arrow.el.classList.add('lit');
    inp.touch.pad.classList.add('active');
    inp.touch.thumb.style.transform = 'translate(28px, 0)';
    ctx.step(16);
  },

  /** Rebindable keys: the controls sheet, one row listening for a new key. */
  async 'qol-controls'(ctx) {
    midRun(ctx, { depth: 4 });
    ctx.step(200);
    const inp = ctx.debug.input;
    inp.controls.open();
    inp.controls.sel = inp.controls.rows.findIndex((r) => r.action.id === 'explore');
    inp.controls.highlight();
    inp.controls.startListening();
    ctx.step(100);
  },

  /** Run statistics sheet after a busy descent. */
  async 'qol-stats'(ctx) {
    const g = midRun(ctx, { depth: 9 });
    const st = g.stats;
    Object.assign(st, { damageDealt: 412, damageTaken: 197, maxHitDealt: 23, maxHitTaken: 14, potions: 3, spells: 5, sacrifices: 2, buried: 60, fled: 2, fights: 11, longestFight: 9, wanderers: 4, trapsSprung: 2, lowestHp: 6, treasures: 6, goldFound: 340, goldSacrificed: 210, levelsVisited: 9, steps: 1830 });
    st.depthTime = { 1: 95, 2: 140, 3: 210, 4: 88, 5: 260, 6: 175, 7: 120, 8: 64, 9: 42 };
    g.state.elapsed = 1194; g.state.time = 1194;
    ctx.step(100);
    ctx.debug.input.statsSheet.open();
    ctx.step(100);
  },

  /** The minimap enlarged over a well-explored level with monsters in view. */
  async 'minimap'(ctx) {
    const g = midRun(ctx, { depth: 4 });
    g.revealAll();
    const p = g.player, lv = g.level;
    // leave the far third of the level unexplored so the map reads as a work in progress
    const farSide = p.x < lv.width / 2 ? 1 : -1;
    for (let y = 0; y < lv.height; y++) for (let x = 0; x < lv.width; x++) { const far = farSide > 0 ? x > lv.width * 0.72 : x < lv.width * 0.28; if (far) lv.explored[y * lv.width + x] = 0; }
    lv.lit = false;
    const spots = neighbours(lv, p.x, p.y);
    ['werebear', 'mercenary'].forEach((t, i) => { const s = spots[i]; if (s) { const m = g.spawnMonster(t, s.x, s.y, { depth: 4, state: 'hunt' }); if (m) freeze(m); } });
    for (const m of lv.monsters) if (m.state !== 'hunt') m.state = 'wander';
    // a beacon and a remembered monster that slipped back into the dark
    const b = lv.randomFloorTile(g.rngs.world, { minDist: { x: p.x, y: p.y, d: 6 }, filter: (x, y) => lv.isExplored(x, y) });
    if (b && lv.isExplored(b.x, b.y)) lv.beacon = { x: b.x, y: b.y };
    const ghost = lv.randomFloorTile(g.rngs.world, { minDist: { x: p.x, y: p.y, d: 10 }, filter: (x, y) => lv.isExplored(x, y) });
    if (ghost && lv.isExplored(ghost.x, ghost.y)) ctx.ui.minimap.seen.set('ghost', { x: ghost.x, y: ghost.y, t: ctx.ui.minimap.time - 4, hunt: false });
    ctx.ui.minimap.toggle(true);
    ctx.ui.minimap.big = true; ctx.ui.minimap.dirty = true;
    ctx.step(600);
  },

  /** Hover tooltip over a hunting monster: threat meter, combat maths and a lore line. */
  async 'tooltip'(ctx) {
    const g = midRun(ctx, { depth: 6 });
    const p = g.player, lv = g.level;
    g.updateFov();
    const spots = ringSpots(g, 16).filter((s) => lv.isVisible(s.x, s.y));
    spots.sort((a, b) => (Math.abs(b.dx) + Math.abs(b.dy)) - (Math.abs(a.dx) + Math.abs(a.dy)) || b.dy - a.dy);
    const s = spots[0] || neighbours(lv, p.x, p.y)[0];
    const m = s ? g.spawnMonster('dark-warrior', s.x, s.y, { depth: 10, state: 'hunt' }) : null;
    if (m) { freeze(m); m.facing = { dx: Math.sign(p.x - m.x), dy: Math.sign(p.y - m.y) }; m.hp = Math.max(1, Math.round(m.maxHp * 0.7)); }
    p.statusEffects = p.statusEffects.filter((e) => e.type !== 'shield'); // show real damage numbers
    ctx.step(2200);
    if (m) ctx.ui.tooltip.showAt({ x: m.x, y: m.y });
    ctx.step(200);
  },

  /** Death screen: slain by a war lord deep down, with stats and the last-30-seconds timeline. */
  async 'death'(ctx) {
    const g = midRun(ctx, { depth: 11 });
    const p = g.player;
    const s = neighbours(g.level, p.x, p.y)[0];
    const m = s ? g.spawnMonster('war-lord', s.x, s.y, { depth: 11, state: 'hunt' }) : null;
    g.state.elapsed = 1534; g.stats.treasures = 9; g.stats.steps = 2310; g.stats.goldSacrificed = 640;
    g.log('YOU ARE ATTACKED BY AN EXPER WAR LORD', 'danger');
    g.log('HITS: 9 CLANG', 'combat'); g.log('HITS: 2 SLASH', 'combat');
    ctx.step(200);
    p.hp = -7;
    g.die('slain', m);
    ctx.step(2000);
  },

  /** Victory screen: escaped with the Sword and time to spare. */
  async 'victory'(ctx) {
    const g = midRun(ctx, { depth: 1 });
    const p = g.player;
    g.give('sword');
    g.state.quest.timer = 812; g.state.quest.timerTotal = 2000;
    g.give('xp', 61000); p.kills = 84; g.state.deepest = 17; g.state.elapsed = 2140;
    ctx.step(100);
    g.gameOver(true, 'victory');
    ctx.step(2600);
  },

  /** Pause menu over the dungeon. */
  async 'pause'(ctx) {
    const g = midRun(ctx);
    g.state.elapsed = 743;
    ctx.step(300);
    g.setPaused(true);
    ctx.step(100);
  },

  async 'help'(ctx) { midRun(ctx); ctx.step(200); ctx.ui.menus.showHelp(); ctx.step(100); },
  async 'settings'(ctx) { midRun(ctx); ctx.step(200); ctx.ui.menus.showSettings(); ctx.step(100); },

  /** New quest screen: difficulty cards, name and seed, over the title backdrop. */
  async 'new-game'(ctx) {
    ctx.reset();
    ctx.ui.app.toTitle();
    ctx.step(200);
    ctx.ui.menus.showNewGame({});
    ctx.step(100);
  },

  /** Hall of fame with a believable roster (seeded into this browser's table). */
  async 'hall-of-fame'(ctx) {
    ctx.reset();
    const heroes = [
      ['Aldric', 'classic', 'victory', 18, 11, 212000, 12, 184, 3610, null, 1983],
      ['Maeve', 'standard', 'victory', 17, 10, 96400, 10, 91, 2140, null, 42],
      ['Brannoc', 'nightmare', 'slain', 14, 9, 41200, 8, 77, 1820, 'demon', 7],
      ['Ysolde', 'classic', 'slain', 12, 8, 33800, 7, 58, 1533, 'war lord', 314],
      ['Tobin', 'story', 'victory', 16, 9, 30100, 9, 64, 2980, null, 8],
      ['Ranulf', 'standard', 'timeout', 15, 8, 22500, 7, 49, 2760, null, 99],
      ['Ceridwen', 'classic', 'slain', 9, 6, 12700, 5, 31, 990, 'werebear', 2024],
      ['Osric', 'nightmare', 'slain', 6, 4, 5400, 4, 17, 610, 'dark warrior', 1],
    ];
    const have = new Set(getHallOfFame().map((e) => e.name + ':' + e.seed));
    for (const [name, difficulty, outcome, deepest, level, xp, , kills, elapsed, killer, seed] of heroes) {
      if (have.has(name + ':' + seed)) continue; // localStorage persists between runs: seed once
      const victory = outcome === 'victory';
      addHallOfFameEntry({ score: xp + 1000 * deepest + (victory ? 25000 : 0), xp, level, deepest, kills, elapsed, seed, difficulty, victory, cause: victory ? null : outcome, killer }, { name, daily: seed === 42 });
    }
    ctx.ui.app.toTitle();
    ctx.step(200);
    ctx.ui.menus.showHall();
    ctx.step(100);
  },

  /** HUD under pressure: 3 hits left, the Sword's clock in the red, statuses, a hunter next door. */
  async 'hud-low-hp'(ctx) {
    const g = midRun(ctx, { depth: 16 });
    const p = g.player;
    g.give('sword');
    g.state.quest.timer = 247; g.state.quest.timerTotal = 2000;
    p.hp = 3; p.autohealRate = 100000; // keep the bar in the red for the shot
    const spots = neighbours(g.level, p.x, p.y);
    const s = spots[spots.length - 1];
    if (s) { const m = g.spawnMonster('dark-warrior', s.x, s.y, { depth: 16, state: 'hunt' }); if (m) { freeze(m); m.facing = { dx: Math.sign(p.x - s.x), dy: Math.sign(p.y - s.y) }; } }
    g.log('YOU ARE ATTACKED BY AN EXPER DARK WARRIOR', 'danger');
    g.log('HITS: 3 CHOP', 'combat');
    g.log('TIMER: 300 seconds left!', 'danger');
    ctx.step(700);
    ctx.ui.hud.showBanner('An exper dark warrior comes into view', 'Paused — any key to continue', 'danger', 0);
    ctx.step(400);
  },

  /** HUD showcase: a healthy mid-run with a full hotbar, statuses, a fat purse and a lively mixed log. */
  async 'hud-showcase'(ctx) {
    const g = midRun(ctx, { depth: 7 });
    const p = g.player;
    p.maxHp = 58; p.hp = 41; p.kills = 12;
    g.give('gold', 267); g.give('teleport', 1); g.give('potion', 1);
    g.log('You descend the stairs. Cold air rises from below.', 'info');
    g.log('A kobold strikes from the shadows! HITS: 44', 'combat');
    g.log('HITS: 41 SLASH', 'combat');
    g.log('The kobold is slain. +38 exp', 'combat');
    g.log('GOLD! 120 pieces', 'loot');
    g.log('TELEPORT SPELL!!', 'magic');
    g.log('The air hums here. Something of great power lies on this level.', 'quest');
    const spots = neighbours(g.level, p.x, p.y);
    const s = spots[spots.length - 1];
    if (s) { const m = g.spawnMonster('mercenary', s.x, s.y, { depth: 7, state: 'hunt' }); if (m) { freeze(m); m.facing = { dx: Math.sign(p.x - s.x), dy: Math.sign(p.y - s.y) }; } }
    ctx.step(900);
  },
};

/**
 * Register every scenario on the debug object.
 * @param {object} debug window.__game.debug
 */
export function registerScenarios(debug) {
  for (const [name, fn] of Object.entries(scenarios)) debug.scenarios[name] = fn;
  for (const [name, fn] of Object.entries(uiScenarios)) debug.scenarios[name] = fn;
  return debug.scenarios;
}

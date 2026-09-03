// Screenshot / smoke scenarios. Each sets up a visually representative state. The context gives
// `reset(seed)` (fresh Game), `game`, `renderer`, `step(ms)` (deterministic sim + render substeps).
import { TILE } from '../core/constants.js';
import { Level } from '../world/level.js';
import { MONSTER_TYPES } from '../game/monsters.js';

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

  /** Whole level revealed and lit from a high camera. */
  async 'dungeon-overview'(ctx) {
    const g = ctx.reset();
    let best = 6, bestScore = -1;
    for (let d = 2; d <= 5; d++) { const lv = g.getLevel(d); const s = lv.rooms.length + findTiles(lv, TILE.WATER).length * 0.5 + lv.temples.length * 3; if (s > bestScore) { bestScore = s; best = d; } }
    g.goToDepth(best);
    g.revealAll();
    ctx.renderer.fog.override = 'all';
    ctx.renderer.overview(60);
    ctx.step(600);
  },

  /** Three monsters adjacent, mid-fight, damage numbers flying. */
  async 'combat'(ctx) {
    const g = ctx.reset();
    const p = g.player;
    p.maxHp = 260; p.hp = 260; p.skill = 42;
    g.give('light', 1); g.castSpell('light');
    const spots = neighbours(g.level, p.x, p.y);
    const types = ['werebear', 'gargoyle', 'swordsman'];
    const ms = [];
    spots.sort((a, b) => (b.y - p.y) - (a.y - p.y));
    for (let i = 0; i < Math.min(3, spots.length); i++) {
      const s = spots[i];
      const m = g.spawnMonster(types[i], s.x, s.y, { depth: 8, state: 'hunt' });
      if (m) { m.lastSeen = { x: p.x, y: p.y }; m.facing = { dx: Math.sign(p.x - s.x), dy: Math.sign(p.y - s.y) }; m.moveTimer = 0.9; ms.push(m); }
    }
    if (ms.length) {
      const m = ms[0];
      g.move(m.x - p.x, m.y - p.y);
      g.setHeld(m.x - p.x, m.y - p.y);
    }
    ctx.step(700);
  },

  /** The temple altar, glowing, with the player beside it carrying gold. */
  async 'temple'(ctx) {
    const g = ctx.reset();
    const found = findDepthWith(g, TILE.TEMPLE, 1, 6);
    if (found) { if (found.depth !== g.depth) g.goToDepth(found.depth); teleportNear(g, found.tiles[0].x, found.tiles[0].y); }
    g.give('gold', 55);
    ctx.step(500);
  },

  /** Down staircase next to the player. */
  async 'stairs'(ctx) {
    const g = ctx.reset();
    const sd = g.level.stairsDown;
    teleportBeside(g, sd.x, sd.y);
    castWith(ctx, 'light');
    ctx.step(400);
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
    clearStart(g);
    const lv = g.level, p = g.player;
    const s = ringSpots(g, 3)[0];
    if (s) {
      lv.addItem({ qty: 1, x: s.x, y: s.y, type: 'gold', gold: 95 });
      ctx.step(200);
      g.move(s.x - p.x, s.y - p.y);
      ctx.step(g.balance.playerStepTime * 1000 + 60);
    }
  },

  /** Opening a chest: lid springs back, gold light spills out, coins fountain. */
  async 'chest-open'(ctx) {
    const g = ctx.reset();
    clearStart(g);
    const lv = g.level, p = g.player;
    const s = ringSpots(g, 3)[0];
    if (s) {
      lv.addItem({ qty: 1, x: s.x, y: s.y, type: 'chest', hidden: false, trap: null, content: { item: 'potion' } });
      ctx.step(200);
      g.move(s.x - p.x, s.y - p.y);
      ctx.step(g.balance.playerStepTime * 1000 + 40);
    }
  },

  /** A monster slain beside the player: ichor burst, soul motes, floor splat. */
  async 'monster-slain'(ctx) {
    const g = ctx.reset();
    clearStart(g);
    const p = g.player;
    p.maxHp = 200; p.hp = 200; p.skill = 60;
    const s = ringSpots(g, 3)[0];
    const m = s ? g.spawnMonster('hobgoblin', s.x, s.y, { depth: 1, state: 'hunt' }) : null;
    if (m) { m.hp = 1; m.facing = { dx: Math.sign(p.x - s.x), dy: Math.sign(p.y - s.y) }; g.move(s.x - p.x, s.y - p.y); }
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

  /** The minimap enlarged over a well-explored level with monsters in view. */
  async 'minimap'(ctx) {
    const g = midRun(ctx, { depth: 4 });
    g.revealAll();
    const p = g.player;
    const spots = neighbours(g.level, p.x, p.y);
    ['werebear', 'mercenary'].forEach((t, i) => { const s = spots[i]; if (s) { const m = g.spawnMonster(t, s.x, s.y, { depth: 4, state: 'hunt' }); if (m) freeze(m); } });
    ctx.ui.minimap.toggle(true);
    ctx.ui.minimap.big = true; ctx.ui.minimap.dirty = true;
    ctx.step(500);
  },

  /** Death screen: slain by a war lord deep down, with stats and the last-30-seconds timeline. */
  async 'death'(ctx) {
    const g = midRun(ctx, { depth: 11 });
    const p = g.player;
    const s = neighbours(g.level, p.x, p.y)[0];
    const m = s ? g.spawnMonster('war-lord', s.x, s.y, { depth: 11, state: 'hunt' }) : null;
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
    ctx.step(300);
    g.setPaused(true);
    ctx.step(100);
  },

  async 'help'(ctx) { midRun(ctx); ctx.step(200); ctx.ui.menus.showHelp(); ctx.step(100); },
  async 'settings'(ctx) { midRun(ctx); ctx.step(200); ctx.ui.menus.showSettings(); ctx.step(100); },

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

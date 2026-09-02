// Game: owns the state, levels, player, monsters, timers and the Sword quest. Headless.
import { SIM_DT, TILE, BALANCE, DIRS8 } from '../core/constants.js';
import { createRng, seedFrom, normalizeSeed } from '../core/rng.js';
import { bus as globalBus } from '../core/events.js';
import { createGameState, SAVE_VERSION } from './state.js';
import { createPlayer, gainXp, addGold, healPlayer, damagePlayer, regenTick, hasStatus, removeStatus, addStatus, resetLevelEffects } from './player.js';
import { rollMonster, updateMonsters, describeMonster, monsterVisibleToPlayer, MONSTERS_BY_TYPE } from './monsters.js';
import { useItem as useItemFn, castSpell as castSpellFn, toggleLight as toggleLightFn, sightRadius, lightOn, pickupGold, grantTreasure, ITEM_TABLE, SPELL_TABLE } from './items.js';
import { playerAttack, monsterAttack, killMonster, resolveRound } from './combat.js';
import { createQuestState, pickupSword, tickQuest, checkVictory, SWORD_TYPE, placeSword } from './quest.js';
import { generateLevel } from '../world/generator.js';
import { Level } from '../world/level.js';
import { computeVisibility } from '../world/fov.js';
import { aStar, bfsNearest } from '../world/pathfinding.js';

const MAX_LOG = 200;

export class Game {
  /**
   * @param {{seed?:number|string, difficulty?:string, bus?:import('../core/events.js').EventBus, autoStart?:boolean}} opts
   */
  constructor(opts = {}) {
    this.bus = opts.bus || globalBus;
    this.balance = BALANCE[opts.difficulty] || BALANCE.standard;
    this.seed = normalizeSeed(opts.seed ?? 1);
    this.state = createGameState({ seed: this.seed, difficulty: this.balance.name });
    /** @type {Map<number, Level>} */
    this.levels = new Map();
    this.rngs = {
      main: createRng(seedFrom(this.seed, 'main')),
      combat: createRng(seedFrom(this.seed, 'combat')),
      ai: createRng(seedFrom(this.seed, 'ai')),
      loot: createRng(seedFrom(this.seed, 'loot')),
      world: createRng(seedFrom(this.seed, 'world')),
    };
    this.accumulator = 0;
    this.heldDir = null;
    this.pendingMove = null;
    this.seenMonsterIds = [];
    this.player = createPlayer(this.rngs.main, this.balance);
    this.state.player = this.player;
    this.stats = this.state.stats;
    if (opts.autoStart !== false) this.start();
  }

  // ------------------------------------------------------------------ accessors
  /** Current level. */
  get level() { return this.levels.get(this.state.depth); }
  get depth() { return this.state.depth; }
  get over() { return this.state.over; }
  get paused() { return this.state.paused; }

  emit(name, payload) { this.bus.emit(name, payload); }

  /** Append a message to the log and emit 'log'. */
  log(text, kind = 'info') {
    const entry = { text, kind, time: this.state.time };
    this.state.log.push(entry);
    if (this.state.log.length > MAX_LOG) this.state.log.splice(0, this.state.log.length - MAX_LOG);
    this.emit('log', entry);
    return entry;
  }

  // ------------------------------------------------------------------ lifecycle
  start() {
    this.enterLevel(1, 'new');
    this.log('YOUR QUEST BEGINS!! Somewhere below lies the Sword of Fargoal.', 'quest');
  }

  /** Get (generating and caching on first use) the level at a depth. */
  getLevel(depth) {
    let lv = this.levels.get(depth);
    if (!lv) {
      lv = generateLevel(this.seed, depth, { swordDepth: this.state.quest.swordDepth, balance: this.balance });
      if (depth === this.state.quest.swordDepth && !this.state.quest.swordPos) {
        const sw = lv.items.find((it) => it.type === SWORD_TYPE);
        if (sw) this.state.quest.swordPos = { x: sw.x, y: sw.y };
      }
      this.levels.set(depth, lv);
    }
    return lv;
  }

  /**
   * Move the player to another level.
   * @param {number} depth
   * @param {'stairs'|'pit'|'teleport'|'new'} via
   * @param {{direction?:'down'|'up', arrival?:{x:number,y:number}, followers?:object[], levels?:number}} opts
   */
  enterLevel(depth, via = 'stairs', opts = {}) {
    const p = this.player;
    const old = this.level;
    const followers = opts.followers || [];
    if (old) {
      old.removeEntity(p);
      for (const m of followers) old.removeEntity(m);
      old.visible.fill(0);
    }
    const level = this.getLevel(depth);
    this.state.depth = depth;
    if (depth > this.state.deepest) { this.state.deepest = depth; p.deepest = depth; }
    const firstVisit = !level.visited;
    level.visited = true;
    if (firstVisit) this.stats.levelsVisited++;
    if (p.maps.includes(depth) && !level.lit) {
      level.revealAll();
      p.maps = p.maps.filter((d) => d !== depth);
      this.log(`The magic map unfurls: level ${depth} lies revealed.`, 'magic');
      this.emit('fx:magic-map', { depth });
    }
    let arrival = opts.arrival || null;
    if (!arrival) {
      if (depth === 0) arrival = level.stairsDown;
      else if (via === 'stairs' && opts.direction === 'down') arrival = level.stairsUp;
      else if (via === 'stairs' && opts.direction === 'up') arrival = level.lastStairsDown || level.stairsDown;
      else if (via === 'new') arrival = level.stairsUp;
      else arrival = level.randomFloorTile(this.rngs.world, { plainOnly: true }) || level.stairsUp;
    }
    const blocker = level.monsterAt(arrival.x, arrival.y);
    if (blocker) {
      const spot = level.randomFloorTile(this.rngs.world, { minDist: { x: arrival.x, y: arrival.y, d: 3 } });
      if (spot) { blocker.x = spot.x; blocker.y = spot.y; } else level.removeEntity(blocker);
    }
    p.x = arrival.x; p.y = arrival.y; p.px = arrival.x; p.py = arrival.y;
    level.addEntity(p);
    resetLevelEffects(p, this.balance);
    this.state.combat = null;
    this.heldDir = null; this.pendingMove = null;
    this.seenMonsterIds = [];
    p.moveTimer = 0;
    level.wanderTimer = this.balance.wanderFirst + this.balance.wanderPerKill * (1 + level.killsOnLevel);
    for (const m of followers) {
      const spots = DIRS8.map((d) => ({ x: p.x + d.dx, y: p.y + d.dy })).filter((s) => level.isWalkable(s.x, s.y) && !level.entityAt(s.x, s.y) && !level.isTemple(s.x, s.y));
      const s = spots.length ? this.rngs.world.pick(spots) : level.randomFloorTile(this.rngs.world, {});
      if (!s) continue;
      m.x = s.x; m.y = s.y; m.px = s.x; m.py = s.y; m.level = depth;
      m.state = 'hunt'; m.lastSeen = { x: p.x, y: p.y }; m.moveTimer = 0;
      level.addEntity(m);
      this.log(`The ${m.name.toLowerCase()} follows you ${opts.direction === 'up' ? 'up' : 'down'} the stairs!`, 'danger');
    }
    this.updateFov();
    this.emit('level:enter', { level, depth, via, direction: opts.direction || null, firstVisit });
    if (via === 'pit' && opts.levels) {
      level.climbable.push({ x: p.x, y: p.y, levels: opts.levels });
      this.log('CLIMBABLE PIT ABOVE!', 'info');
    }
    if (depth === 0) {
      if (checkVictory(this)) this.gameOver(true, 'victory');
      return;
    }
    if (via === 'stairs') this.emit('sfx:stairs', { direction: opts.direction });
    if (!firstVisit && via !== 'new') this.log('YOUR QUEST CONTINUES!', 'quest');
    if (depth === this.state.quest.swordDepth && level.items.some((it) => it.type === SWORD_TYPE)) {
      this.log('The air hums here. Something of great power lies on this level.', 'quest');
    }
  }

  // ------------------------------------------------------------------ simulation
  /**
   * Advance the simulation by dt seconds using a fixed-step accumulator.
   * @returns {number} number of fixed steps executed
   */
  update(dt) {
    if (!(dt > 0)) return 0;
    this.accumulator = Math.min(this.accumulator + dt, 1.0);
    let steps = 0;
    while (this.accumulator >= SIM_DT - 1e-9) {
      this.accumulator -= SIM_DT;
      this.step(SIM_DT);
      steps++;
    }
    return steps;
  }

  /** One fixed simulation step. */
  step(dt) {
    const s = this.state, p = this.player, B = this.balance;
    if (s.over || s.paused) return;
    s.time += dt; s.elapsed += dt;
    if (tickQuest(this, dt)) return;

    // Player pacing: one tile per playerStepTime; queued or held direction.
    p.moveTimer = Math.max(0, p.moveTimer - dt);
    if (p.moveTimer <= 0) {
      const mv = this.pendingMove || this.heldDir;
      if (mv) { this.pendingMove = null; this.performMove(mv.dx, mv.dy); }
    }
    if (s.over) return;

    // Combat rounds.
    const c = s.combat;
    if (c) {
      const m = this.level.entities.find((e) => e.id === c.monsterId);
      if (!m || m.state === 'dead') this.endCombat('gone');
      else if (Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) > 1) this.endCombat('separated');
      else {
        c.timer -= dt;
        if (c.timer <= 0) {
          if (!c.playerInitiated) {
            c.timer = B.combatRoundTime; c.rounds++;
            resolveRound(this, m, { playerFirst: false });
          } else if (this.heldDir && p.x + this.heldDir.dx === m.x && p.y + this.heldDir.dy === m.y) {
            playerAttack(this, m);
          } else {
            c.idle = (c.idle || 0) + dt;
            if (c.idle > 0.6) this.endCombat('disengaged');
          }
        }
      }
    }
    if (s.over) return;

    // Idle regeneration ticks (only outside fights, and only when standing still).
    p.idleTime += dt;
    while (p.idleTime >= B.idleTickTime) {
      p.idleTime -= B.idleTickTime;
      if (!s.combat && s.time - (p.lastMoveTime || 0) >= B.idleTickTime) regenTick(this);
    }
    if (!s.combat) this.checkIdleDeath();
    if (s.over) return;

    updateMonsters(this, dt);
    if (s.over) return;

    // Wandering monsters (C64 rule).
    const level = this.level;
    if (level && level.depth > 0) {
      level.wanderTimer -= dt * B.wanderMultiplier;
      if (level.wanderTimer <= 0) { level.wanderTimer = B.wanderRepeat; this.spawnWanderer(); }
    }

    // Smooth render positions for headless consumers (renderer may override).
    const k = Math.min(1, dt * 12);
    for (const e of level.entities) { e.px += (e.x - e.px) * k; e.py += (e.y - e.py) * k; }
    this.updateSeenMonsters();
  }

  /** HP < 0 outside a fight: auto-potion or death [VIC 55, 83]. */
  checkIdleDeath() {
    const p = this.player;
    if (p.hp >= 0 || this.state.over) return;
    if (p.inventory.potion > 0) { useItemFn(this, 'potion'); this.log('(drunk automatically)', 'magic'); }
    else this.die('died', null);
  }

  // ------------------------------------------------------------------ player actions
  /**
   * Move (or attack/interact) one tile. Executes now if the player is ready, else queues it.
   * @returns {boolean} true if the step was performed immediately
   */
  move(dx, dy) {
    if (this.state.over) return false;
    dx = Math.sign(dx); dy = Math.sign(dy);
    if (!dx && !dy) return false;
    if (this.player.moveTimer <= 0) return this.performMove(dx, dy);
    this.pendingMove = { dx, dy };
    return false;
  }

  /** Hold a direction (real-time auto-repeat); pass (0,0) or null to release. Releasing disengages a fight you started. */
  setHeld(dx, dy) {
    if (dx === null || dx === undefined || (!dx && !dy)) {
      this.heldDir = null;
      const c = this.state.combat;
      if (c && c.playerInitiated) this.endCombat('fled');
      return;
    }
    this.heldDir = { dx: Math.sign(dx), dy: Math.sign(dy) };
  }

  /** Stand still for a moment (lets regeneration tick). */
  wait() {
    if (this.state.over) return false;
    this.pendingMove = null;
    this.player.moveTimer = Math.max(this.player.moveTimer, this.balance.playerStepTime);
    return true;
  }

  /** Perform a step attempt right now. */
  performMove(dx, dy) {
    const p = this.player, level = this.level, s = this.state;
    if (s.over) return false;
    p.facing = { dx, dy };
    const c = s.combat;
    if (c && !c.playerInitiated) {
      const m = level.entities.find((e) => e.id === c.monsterId);
      if (m && m.state !== 'dead') { playerAttack(this, m); p.moveTimer = this.balance.playerStepTime; return true; }
    }
    const nx = p.x + dx, ny = p.y + dy;
    const m = level.monsterAt(nx, ny);
    if (m) {
      if (!level.canStep(p.x, p.y, dx, dy)) return false;
      if (c && c.monsterId === m.id && c.timer > 0) {
        // next round is not ready yet: keep the blow queued so it lands the moment it is
        this.pendingMove = { dx, dy };
        p.moveTimer = c.timer;
        return false;
      }
      if (m.invisible && !this.lightOn()) this.log('You strike at something unseen!', 'combat');
      playerAttack(this, m);
      p.moveTimer = this.balance.playerStepTime;
      return true;
    }
    if (!level.canStep(p.x, p.y, dx, dy)) return false;
    if (c) this.endCombat('fled');
    this.moveEntity(p, nx, ny);
    p.moveTimer = this.balance.playerStepTime;
    p.lastMoveTime = s.time;
    this.stats.steps++;
    this.emit('sfx:step', { x: nx, y: ny, tile: level.get(nx, ny) });
    this.onPlayerEnterTile();
    return true;
  }

  /** Teleport/step an entity to a tile and emit 'entity:moved'. */
  moveEntity(e, x, y) {
    const fromX = e.x, fromY = e.y;
    e.x = x; e.y = y;
    this.emit('entity:moved', { entity: e, fromX, fromY, toX: x, toY: y });
  }

  /** Consequences of the player standing on a new tile. */
  onPlayerEnterTile() {
    const p = this.player, level = this.level;
    this.updateFov();
    const x = p.x, y = p.y;
    const trap = level.trapAt(x, y);
    if (trap && !trap.revealed) {
      trap.revealed = true;
      level.traps = level.traps.filter((t) => t !== trap);
      this.springTrap(trap.type, x, y);
      return;
    }
    const tile = level.get(x, y);
    if (tile === TILE.TRAP_TELEPORT) { this.springTrap('teleport', x, y, true); return; }
    if (tile === TILE.TRAP_PIT) { this.springTrap('pit', x, y, true); return; }
    for (const it of level.itemsAt(x, y)) {
      if (this.state.over || this.level !== level || p.x !== x || p.y !== y) return;
      if (it.type === 'gold') { pickupGold(this, it); this.stats.goldFound += it.gold || 0; }
      else if (it.type === SWORD_TYPE) pickupSword(this, it);
      else if (it.type === 'chest') this.openChest(it);
      else if (it.type === 'beacon') { level.removeItem(it); p.inventory.beacon++; this.log('BEACON!!', 'loot'); this.emit('item:picked', { item: it, entity: p }); }
      else if (ITEM_TABLE[it.type]) { level.removeItem(it); p.inventory[it.type] = (p.inventory[it.type] || 0) + (it.qty || 1); this.log(ITEM_TABLE[it.type].found || `${ITEM_TABLE[it.type].name}!`, 'loot'); this.emit('item:picked', { item: it, entity: p }); }
      else if (SPELL_TABLE[it.type]) { level.removeItem(it); p.spells[it.type] = (p.spells[it.type] || 0) + (it.qty || 1); this.log(SPELL_TABLE[it.type].found, 'loot'); this.emit('item:picked', { item: it, entity: p }); }
    }
    if (this.state.over || this.level !== level) return;
    if (tile === TILE.STAIRS_DOWN) this.log('STAIRS GOING DOWN', 'info');
    else if (tile === TILE.STAIRS_UP) this.log(level.depth === 1 && !p.hasSword ? 'The way out is sealed by Umla\'s magic. Only the Sword can open it.' : 'STAIRS GOING UP', 'info');
    else if (tile === TILE.TEMPLE) {
      this.log('TEMPLE! You are safe here.', 'info');
      this.emit('sfx:temple', {});
      if (this.balance.autoSacrifice && p.gold > 0) this.sacrifice();
    } else if (tile === TILE.PIT) this.climbPit();
    else if (level.climbableAt(x, y)) this.log('CLIMBABLE PIT ABOVE! (interact to climb)', 'info');
  }

  /** Open a treasure/trap square. */
  openChest(item) {
    const level = this.level;
    level.removeItem(item);
    if (item.trap) { this.springTrap(item.trap, item.x, item.y); return; }
    const content = item.content || { item: 'potion', spell: null };
    this.emit('fx:chest', { x: item.x, y: item.y });
    grantTreasure(this, content);
  }

  /** Spring a trap at (x,y): 'pit' | 'ceiling' | 'explosion' | 'teleport'. */
  springTrap(type, x, y, known = false) {
    const p = this.player, level = this.level, L = Math.max(1, level.depth), rng = this.rngs.loot;
    this.stats.trapsSprung++;
    this.emit('trap:triggered', { type, x, y });
    this.emit('sfx:trap', { type });
    const loseMap = () => {
      if (rng.chance(0.25)) { level.forget(); this.updateFov(); this.log('LOST YOUR MAP!', 'danger'); this.emit('fx:lost-map', {}); }
    };
    switch (type) {
      case 'pit': {
        level.set(x, y, TILE.PIT);
        const levels = Math.floor(4 * rng.next() + 2);
        if (hasStatus(p, 'drift')) { removeStatus(p, 'drift'); this.log('PIT!! ...LIKE A FEATHER...', 'magic'); }
        else { const dmg = damagePlayer(this, Math.floor(10 * rng.next() + L), 'trap:pit'); this.log(`PIT!!...YOU FELL! (${dmg} damage)`, 'danger'); }
        if (!known) loseMap();
        this.emit('fx:fall', { x, y });
        this.checkIdleDeath();
        if (this.state.over) return;
        this.enterLevel(level.depth + levels, 'pit', { levels });
        this.log(`DOWN ${levels} LEVELS`, 'danger');
        return;
      }
      case 'ceiling': {
        level.set(x, y, TILE.RUBBLE);
        const dmg = damagePlayer(this, Math.floor(10 * rng.next() + L), 'trap:ceiling');
        this.log(`CEILING TRAP! A block of stone crashes down. (${dmg} damage)`, 'danger');
        this.emit('fx:ceiling', { x, y });
        loseMap();
        this.checkIdleDeath();
        return;
      }
      case 'explosion': {
        if (hasStatus(p, 'shield')) { removeStatus(p, 'shield'); this.log('EXPLOSION!! SHIELDED FROM BLAST!', 'magic'); }
        else { const dmg = damagePlayer(this, Math.floor(15 * rng.next() + L), 'trap:explosion'); this.log(`EXPLOSION!! (${dmg} damage)`, 'danger'); }
        this.emit('fx:explosion', { x, y });
        loseMap();
        this.checkIdleDeath();
        return;
      }
      case 'teleport':
      default: {
        level.set(x, y, TILE.TRAP_TELEPORT);
        this.log('TELEPORT...', 'magic');
        if (!known) loseMap();
        this.teleportPlayer('trap');
      }
    }
  }

  /** Walk into an open pit: 50% climb down safely, 50% fall. */
  climbPit() {
    const p = this.player, level = this.level, L = level.depth, rng = this.rngs.loot;
    this.log('CLIMBING THE PIT...', 'info');
    const levels = Math.floor(4 * rng.next() + 2);
    if (rng.chance(0.5)) {
      gainXp(this, Math.floor(10 * rng.next() + 5 * levels));
      this.log(`DOWN ${levels} LEVELS`, 'info');
    } else {
      if (hasStatus(p, 'drift')) { removeStatus(p, 'drift'); this.log('YOU FELL! ...LIKE A FEATHER...', 'magic'); }
      else { const dmg = damagePlayer(this, Math.floor(10 * rng.next() + 3 * levels + L), 'fall'); this.log(`YOU FELL! (${dmg} damage) DOWN ${levels} LEVELS`, 'danger'); }
      this.checkIdleDeath();
      if (this.state.over) return;
    }
    this.emit('fx:fall', { x: p.x, y: p.y });
    this.enterLevel(L + levels, 'pit', { levels });
  }

  /** Context action: stairs, temple, climbable pit. Returns true if something happened. */
  interact() {
    if (this.state.over) return false;
    const p = this.player, level = this.level;
    const tile = level.get(p.x, p.y);
    if (tile === TILE.STAIRS_DOWN) return this.descend();
    if (tile === TILE.STAIRS_UP) return this.ascend();
    if (tile === TILE.TEMPLE) {
      if (p.gold > 0) return this.sacrifice();
      this.log('You rest at the altar. Nothing to offer.', 'info');
      return false;
    }
    const climb = level.climbableAt(p.x, p.y);
    if (climb) {
      const target = Math.max(1, level.depth - climb.levels);
      const n = level.depth - target;
      gainXp(this, Math.floor(10 * this.rngs.loot.next() + 5 * n));
      this.log(`UP ${n} LEVELS`, 'info');
      this.enterLevel(target, 'pit', { levels: 0 });
      return true;
    }
    return false;
  }

  /** Take the down staircase under the player. */
  descend() {
    const p = this.player, level = this.level;
    if (this.state.over || level.get(p.x, p.y) !== TILE.STAIRS_DOWN) return false;
    level.lastStairsDown = { x: p.x, y: p.y };
    if (level.depth > 0) gainXp(this, Math.floor(10 * this.rngs.loot.next() + 1) * level.depth);
    this.log('STAIRS GOING DOWN', 'info');
    this.emit('fx:descend', {});
    this.enterLevel(level.depth + 1, 'stairs', { direction: 'down', followers: this.collectFollowers() });
    return true;
  }

  /** Take the up staircase under the player (level 1 needs the sword; leads to the surface). */
  ascend() {
    const p = this.player, level = this.level;
    if (this.state.over || level.get(p.x, p.y) !== TILE.STAIRS_UP) return false;
    if (level.depth === 1 && !p.hasSword) { this.log('The way out is sealed by Umla\'s magic. Only the Sword can open it.', 'quest'); return false; }
    this.log('STAIRS GOING UP', 'info');
    this.emit('fx:ascend', {});
    this.enterLevel(level.depth - 1, 'stairs', { direction: 'up', followers: this.collectFollowers() });
    return true;
  }

  /** Hunting monsters next to the player that follow through stairs. */
  collectFollowers() {
    const p = this.player, B = this.balance;
    return this.level.monsters.filter((m) => m.flags.follows && m.state === 'hunt'
      && Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= B.followDistance);
  }

  /** Offer all carried gold at the temple: 1 gold = 1 XP. */
  sacrifice() {
    const p = this.player;
    if (!this.level.isTemple(p.x, p.y) || p.gold <= 0) return false;
    const gold = p.gold;
    addGold(this, -gold);
    this.stats.goldSacrificed += gold;
    this.log(`SACRIFICE OF GOLD! ${gold} gold offered for ${gold} experience.`, 'quest');
    this.emit('temple:sacrifice', { gold, xp: gold });
    this.emit('sfx:sacrifice', {});
    gainXp(this, gold);
    return true;
  }

  /** Bury all carried gold under your feet (max 10 caches per level). */
  buryGold() {
    const p = this.player, level = this.level;
    if (p.gold <= 0) { this.log('No gold to hide.', 'info'); return false; }
    if (level.buriedCount >= this.balance.maxBuriedCaches) { this.log('Too many caches on this level.', 'info'); return false; }
    if (level.isTemple(p.x, p.y) || level.isStairs(p.x, p.y)) { this.log("You can't dig here.", 'info'); return false; }
    const gold = p.gold;
    addGold(this, -gold);
    level.addItem({ type: 'gold', x: p.x, y: p.y, qty: 1, gold, hidden: true });
    level.buriedCount++;
    this.log(`HIDING ${gold} GOLD P'S`, 'info');
    return true;
  }

  /** Use an inventory item (potion, beacon). */
  useItem(type) { return useItemFn(this, type); }
  /** Cast a spell (teleport, shield, regeneration, invisibility, light, drift). */
  castSpell(type) { return castSpellFn(this, type); }
  /** Toggle an active Light spell. */
  toggleLight() { return toggleLightFn(this); }

  /** Teleport the player to a random empty tile (or the beacon). */
  teleportPlayer(cause = 'spell') {
    const level = this.level;
    let target = null;
    if (level.beacon && cause === 'spell' && (level.beacon.x !== this.player.x || level.beacon.y !== this.player.y)) target = level.beacon;
    if (!target) target = level.randomFloorTile(this.rngs.loot, { plainOnly: true }) || level.randomFloorTile(this.rngs.loot, {});
    if (!target) return false;
    if (this.state.combat) this.endCombat('teleport');
    const from = { x: this.player.x, y: this.player.y };
    this.moveEntity(this.player, target.x, target.y);
    this.player.lastMoveTime = this.state.time;
    this.emit('fx:teleport', { from, to: target, cause });
    this.emit('sfx:teleport', {});
    this.updateFov();
    return true;
  }

  /** Finish the current fight: shield is consumed, engagement cleared. */
  endCombat(reason) {
    const c = this.state.combat;
    if (!c) return;
    this.state.combat = null;
    if (hasStatus(this.player, 'shield')) { removeStatus(this.player, 'shield'); this.log('Your shield fades.', 'magic'); }
    this.emit('combat:end', { reason, monsterId: c.monsterId, rounds: c.rounds });
  }

  /** Monster reaches the player (called by AI). */
  monsterAttack(m) { return monsterAttack(this, m); }
  /** Remove a monster (pit death, debug kill...). */
  killMonster(m, killer = null) { return killMonster(this, m, killer); }

  /** Player death. */
  die(cause, killer) {
    if (this.state.over) return;
    if (cause === 'slain') this.log(`THOU ART SLAIN! SLAIN BY ${killer ? describeMonster(killer, this.player.skill).toUpperCase() : 'THE DARK'}`, 'danger');
    else this.log('YOU DIED!!', 'danger');
    this.emit('sfx:death', {});
    this.gameOver(false, cause, killer);
  }

  /** End the game. */
  gameOver(victory, cause, killer = null) {
    if (this.state.over) return;
    this.state.over = true;
    this.state.outcome = { victory, cause, killer: killer ? killer.name : null };
    this.state.combat = null; this.heldDir = null; this.pendingMove = null;
    if (this.level) this.level.revealAll();
    if (victory) this.log('YOUR QUEST IS COMPLETE! Gedwyn takes the Sword; the Great Forest is safe.', 'quest');
    const stats = this.getStats();
    this.emit('game:over', { victory, cause, stats, killer });
  }

  /** Score-screen statistics. */
  getStats() {
    const p = this.player, s = this.state, q = s.quest;
    const victory = !!(s.outcome && s.outcome.victory);
    const remaining = q.timer === null ? 0 : Math.max(0, q.timer);
    return {
      xp: p.xp, level: p.level, deepest: s.deepest, kills: p.kills, hp: p.hp, maxHp: p.maxHp, skill: p.skill, gold: p.gold,
      elapsed: s.elapsed, minutes: Math.floor(s.elapsed / 60), steps: this.stats.steps, treasures: this.stats.treasures,
      goldSacrificed: this.stats.goldSacrificed, seed: this.seed, difficulty: this.balance.name,
      swordFound: q.swordFound, swordHeld: p.hasSword, timerRemaining: remaining, victory,
      cause: s.outcome ? s.outcome.cause : null, killer: s.outcome ? s.outcome.killer : null,
      score: p.xp + 1000 * s.deepest + (victory ? 25000 + Math.floor(remaining) * 10 : 0),
    };
  }

  setPaused(paused) {
    paused = !!paused;
    if (this.state.paused === paused) return;
    this.state.paused = paused;
    this.emit('game:paused', { paused });
  }

  // ------------------------------------------------------------------ perception
  /** Recompute visibility from the player's tile. */
  updateFov() {
    const level = this.level, p = this.player;
    if (!level) return;
    computeVisibility(level, p.x, p.y, sightRadius(this));
    this.emit('fov:updated', { level, x: p.x, y: p.y });
  }

  /** Emit 'monster:seen' for monsters that just came into view. */
  updateSeenMonsters() {
    const seen = [];
    for (const m of this.level.monsters) {
      if (!monsterVisibleToPlayer(this, m)) continue;
      seen.push(m.id);
      if (!this.seenMonsterIds.includes(m.id)) {
        this.emit('monster:seen', { entity: m, description: describeMonster(m, this.player.skill) });
      }
    }
    this.seenMonsterIds = seen;
  }

  /** Monsters the player can currently see (invisible ones need Light). */
  visibleMonsters() { return this.level.monsters.filter((m) => monsterVisibleToPlayer(this, m)); }
  lightOn() { return lightOn(this.player); }
  sightRadius() { return sightRadius(this); }
  playerOnTemple() { const p = this.player; return !!this.level && this.level.isTemple(p.x, p.y); }
  /** Temple or beacon: monsters ignore you here. */
  playerOnSanctuary() {
    const p = this.player, level = this.level;
    if (!level) return false;
    if (level.isTemple(p.x, p.y)) return true;
    return !!(level.beacon && level.beacon.x === p.x && level.beacon.y === p.y);
  }
  /** Can this monster not perceive the player? (invisibility without Light, sanctuary) */
  isPlayerHiddenFrom(m) {
    void m;
    if (this.playerOnSanctuary()) return true;
    if (this.player.invisible && !this.lightOn()) return true;
    return false;
  }
  /** Describe a monster relative to the player ("a weak dire wolf"). */
  describe(m) { return describeMonster(m, this.player.skill); }

  // ------------------------------------------------------------------ navigation helpers
  hazardAt(x, y) {
    const level = this.level;
    if (level.isHazard(x, y)) return true;
    const m = level.monsterAt(x, y);
    return !!(m && monsterVisibleToPlayer(this, m));
  }

  /**
   * Next step toward the nearest unexplored frontier (safe tiles only).
   * @returns {{x:number,y:number,dx:number,dy:number,path:{x:number,y:number}[],target:{x:number,y:number}}|null}
   */
  autoExplore() {
    const level = this.level, p = this.player;
    if (!level || this.state.over) return null;
    const passable = (x, y) => level.isExplored(x, y) && level.isWalkable(x, y) && !this.hazardAt(x, y) && !level.isTemple(x, y);
    const frontier = (x, y) => {
      if (!level.isExplored(x, y) || !level.isWalkable(x, y) || this.hazardAt(x, y)) return false;
      for (const d of DIRS8) { const nx = x + d.dx, ny = y + d.dy; if (level.inBounds(nx, ny) && !level.explored[level.idx(nx, ny)]) return true; }
      return false;
    };
    const path = bfsNearest(level, { x: p.x, y: p.y }, frontier, { passable });
    if (!path || !path.length) return null;
    const s = path[0];
    return { x: s.x, y: s.y, dx: s.x - p.x, dy: s.y - p.y, path, target: path[path.length - 1] };
  }

  /**
   * Path from the player to (x,y) through explored, safe tiles.
   * @returns {{x:number,y:number}[]|null}
   */
  pathTo(x, y) {
    const level = this.level, p = this.player;
    if (!level || !level.inBounds(x, y) || !level.isWalkable(x, y)) return null;
    const passable = (tx, ty) => level.isExplored(tx, ty) && !this.hazardAt(tx, ty) && !level.isTemple(tx, ty);
    return aStar(level, { x: p.x, y: p.y }, { x, y }, { passable, maxNodes: 6000 });
  }

  // ------------------------------------------------------------------ spawning / debug helpers
  /** A wandering monster climbs in from a neighbouring level. */
  spawnWanderer() {
    const level = this.level, p = this.player;
    const depth = Math.max(1, level.depth + this.rngs.world.int(-1, 1));
    const m = rollMonster(this.rngs.world, depth, { id: `m${level.depth}-w${++level.wanderCount}`, mageDemonMinDepth: this.balance.mageDemonMinDepth });
    let spot = level.randomFloorTile(this.rngs.world, { unexplored: true, minDist: { x: p.x, y: p.y, d: this.balance.wanderMinDistance }, plainOnly: true });
    if (!spot) spot = level.randomFloorTile(this.rngs.world, { minDist: { x: p.x, y: p.y, d: this.balance.wanderMinDistance } });
    if (!spot) return null;
    m.x = spot.x; m.y = spot.y; m.px = spot.x; m.py = spot.y; m.level = level.depth;
    level.addEntity(m);
    this.log('You hear something climbing in the dark...', 'danger');
    this.emit('monster:wander', { entity: m });
    return m;
  }

  /** Spawn a monster of a type at a tile (debug). */
  spawnMonster(type, x, y, opts = {}) {
    const level = this.level;
    if (!MONSTERS_BY_TYPE[type]) throw new Error(`unknown monster type: ${type}`);
    const m = rollMonster(this.rngs.world, opts.depth ?? level.depth, { type, id: `m${level.depth}-s${++level.wanderCount}` });
    if (!level.isWalkable(x, y) || level.entityAt(x, y)) {
      const spot = level.randomFloorTile(this.rngs.world, {});
      if (!spot) return null;
      x = spot.x; y = spot.y;
    }
    m.x = x; m.y = y; m.px = x; m.py = y; m.level = level.depth;
    if (opts.state) m.state = opts.state;
    level.addEntity(m);
    return m;
  }

  /** Give the player items/spells/gold/sword (debug). */
  give(type, qty = 1) {
    const p = this.player;
    if (type === 'gold') { addGold(this, qty); return true; }
    if (type === 'sword') { if (!p.hasSword) pickupSword(this, null); return true; }
    if (type === 'xp') { gainXp(this, qty); return true; }
    if (type === 'enchant') { p.enchant += qty; p.skill += 10 * qty; return true; }
    if (type === 'map') { p.maps.push(this.level.depth + 1); return true; }
    if (SPELL_TABLE[type]) { p.spells[type] = (p.spells[type] || 0) + qty; return true; }
    if (ITEM_TABLE[type]) { p.inventory[type] = (p.inventory[type] || 0) + qty; return true; }
    return false;
  }

  /** Jump to a depth (debug). */
  goToDepth(d) { this.enterLevel(Math.max(0, Math.floor(d)), 'teleport'); }
  /** Move the player to a tile (debug). */
  teleportTo(x, y) {
    const level = this.level;
    if (!level.isWalkable(x, y)) return false;
    const m = level.monsterAt(x, y); if (m) level.removeEntity(m);
    this.moveEntity(this.player, x, y);
    this.player.px = x; this.player.py = y;
    this.updateFov();
    return true;
  }
  revealAll() { this.level.revealAll(); this.updateFov(); }
  heal() { const p = this.player; p.hp = p.maxHp; this.emit('player:hp', { hp: p.hp, maxHp: p.maxHp }); }
  /** Kill an entity outright (debug). */
  kill(entity) { if (entity && entity.kind === 'monster') killMonster(this, entity, this.player); }

  // ------------------------------------------------------------------ serialization
  /** Plain JSON-able snapshot of the entire game (all levels, RNG states, timers). */
  serialize() {
    const s = this.state;
    return {
      version: SAVE_VERSION,
      seed: this.seed,
      difficulty: this.balance.name,
      state: (() => { const c = { ...s, log: s.log.slice(-MAX_LOG) }; delete c.player; return c; })(),
      player: JSON.parse(JSON.stringify(this.player)),
      levels: [...this.levels.values()].map((lv) => lv.serialize()),
      rngs: Object.fromEntries(Object.entries(this.rngs).map(([k, r]) => [k, r.getState()])),
      accumulator: this.accumulator,
      heldDir: this.heldDir, pendingMove: this.pendingMove,
      seenMonsterIds: [...this.seenMonsterIds],
    };
  }

  /** Restore a snapshot into this instance. Accepts an object or JSON string. */
  load(data) {
    if (typeof data === 'string') data = JSON.parse(data);
    if (!data || data.version !== SAVE_VERSION) throw new Error('unsupported save version');
    this.seed = normalizeSeed(data.seed);
    this.balance = BALANCE[data.difficulty] || BALANCE.standard;
    const st = JSON.parse(JSON.stringify(data.state));
    this.player = JSON.parse(JSON.stringify(data.player));
    st.player = this.player;
    this.state = st;
    this.stats = st.stats;
    this.levels = new Map();
    for (const ld of data.levels) this.levels.set(ld.depth, Level.deserialize(ld));
    for (const [k, v] of Object.entries(data.rngs)) { if (!this.rngs[k]) this.rngs[k] = createRng(0); this.rngs[k].setState(v); }
    this.accumulator = data.accumulator || 0;
    this.heldDir = data.heldDir || null;
    this.pendingMove = data.pendingMove || null;
    this.seenMonsterIds = [...(data.seenMonsterIds || [])];
    const level = this.level;
    if (level) { level.removeEntity('player'); level.addEntity(this.player); }
    return this;
  }

  /**
   * Build a Game from serialize() output (object or JSON string).
   * @param {object|string} data
   * @param {{bus?:import('../core/events.js').EventBus}} opts
   */
  static deserialize(data, opts = {}) {
    if (typeof data === 'string') data = JSON.parse(data);
    const g = new Game({ seed: data.seed, difficulty: data.difficulty, bus: opts.bus, autoStart: false });
    g.load(data);
    return g;
  }
}

export { SIM_DT, createQuestState, placeSword, addStatus, healPlayer };

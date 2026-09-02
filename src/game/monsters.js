// Bestiary, monster generation formulas and monster AI (DESIGN.md §2.6, §4).
import { TILE, DIRS8, monsterPhaseSeconds } from '../core/constants.js';
import { aStar } from '../world/pathfinding.js';

/**
 * The 22 original monsters. `typeIndex` is the VIC type index x (0-9) within its family.
 * depthMin/depthMax are the depths on which the index can be rolled (max Infinity = open-ended).
 */
export const MONSTER_TABLE = [
  { type: 'dire-wolf', name: 'Dire Wolf', family: 'creature', typeIndex: 0, glyph: 31, depthMin: 1, depthMax: 1, speedMul: 1.5, flees: true, follows: false, special: null, size: 0.8 },
  { type: 'ogre', name: 'Ogre', family: 'creature', typeIndex: 1, glyph: 27, depthMin: 1, depthMax: 3, speedMul: 0.8, flees: false, follows: false, special: null, size: 1.3 },
  { type: 'hobgoblin', name: 'Hobgoblin', family: 'creature', typeIndex: 2, glyph: 27, depthMin: 1, depthMax: 5, speedMul: 1.1, flees: true, follows: false, special: null, size: 0.9 },
  { type: 'werebear', name: 'Werebear', family: 'creature', typeIndex: 3, glyph: 27, depthMin: 1, depthMax: 7, speedMul: 1.0, flees: false, follows: false, special: null, size: 1.2 },
  { type: 'gargoyle', name: 'Gargoyle', family: 'creature', typeIndex: 4, glyph: 28, depthMin: 2, depthMax: 9, speedMul: 1.0, flees: false, follows: true, special: null, size: 1.0 },
  { type: 'troll', name: 'Troll', family: 'creature', typeIndex: 5, glyph: 27, depthMin: 4, depthMax: Infinity, speedMul: 0.9, flees: false, follows: false, special: null, size: 1.4 },
  { type: 'wyvern', name: 'Wyvern', family: 'creature', typeIndex: 6, glyph: 30, depthMin: 6, depthMax: Infinity, speedMul: 1.2, flees: false, follows: true, special: null, size: 1.3 },
  { type: 'dimension-spider', name: 'Dimension Spider', family: 'creature', typeIndex: 7, glyph: 29, depthMin: 8, depthMax: Infinity, speedMul: 1.0, flees: false, follows: true, special: 'blink', size: 1.1 },
  { type: 'shadow-dragon', name: 'Shadow Dragon', family: 'creature', typeIndex: 8, glyph: 30, depthMin: 10, depthMax: Infinity, speedMul: 1.0, flees: false, follows: false, special: null, size: 1.6 },
  { type: 'fyre-drake', name: 'Fyre Drake', family: 'creature', typeIndex: 9, glyph: 30, depthMin: 12, depthMax: Infinity, speedMul: 1.1, flees: false, follows: true, special: null, size: 1.6 },
  { type: 'demon', name: 'Demon', family: 'creature', typeIndex: -1, glyph: 28, depthMin: 14, depthMax: Infinity, speedMul: 1.0, flees: false, follows: false, special: 'demon', size: 1.0 },
  { type: 'rogue', name: 'Rogue', family: 'human', typeIndex: 0, glyph: 42, depthMin: 1, depthMax: 1, speedMul: 1.3, flees: true, follows: false, special: 'thief', size: 0.9 },
  { type: 'barbarian', name: 'Barbarian', family: 'human', typeIndex: 1, glyph: 41, depthMin: 1, depthMax: 3, speedMul: 1.0, flees: false, follows: false, special: null, size: 1.1 },
  { type: 'elvin-ranger', name: 'Elvin Ranger', family: 'human', typeIndex: 2, glyph: 41, depthMin: 1, depthMax: 5, speedMul: 1.2, flees: true, follows: false, special: null, size: 1.0 },
  { type: 'dwarven-guard', name: 'Dwarven Guard', family: 'human', typeIndex: 3, glyph: 43, depthMin: 1, depthMax: 7, speedMul: 0.9, flees: false, follows: false, special: null, size: 0.9 },
  { type: 'mercenary', name: 'Mercenary', family: 'human', typeIndex: 4, glyph: 41, depthMin: 2, depthMax: 9, speedMul: 1.0, flees: true, follows: false, special: null, size: 1.0 },
  { type: 'swordsman', name: 'Swordsman', family: 'human', typeIndex: 5, glyph: 41, depthMin: 4, depthMax: Infinity, speedMul: 1.0, flees: false, follows: false, special: null, size: 1.0 },
  { type: 'monk', name: 'Monk', family: 'human', typeIndex: 6, glyph: 41, depthMin: 6, depthMax: Infinity, speedMul: 1.1, flees: false, follows: false, special: null, size: 1.0 },
  { type: 'dark-warrior', name: 'Dark Warrior', family: 'human', typeIndex: 7, glyph: 41, depthMin: 8, depthMax: Infinity, speedMul: 1.0, flees: false, follows: true, special: null, size: 1.1 },
  { type: 'assassin', name: 'Assassin', family: 'human', typeIndex: 8, glyph: 40, depthMin: 10, depthMax: Infinity, speedMul: 1.2, flees: false, follows: true, special: 'invisible', size: 1.0 },
  { type: 'war-lord', name: 'War Lord', family: 'human', typeIndex: 9, glyph: 41, depthMin: 12, depthMax: Infinity, speedMul: 1.0, flees: false, follows: true, special: null, size: 1.2 },
  { type: 'mage', name: 'Mage', family: 'human', typeIndex: -1, glyph: 41, depthMin: 14, depthMax: Infinity, speedMul: 1.0, flees: false, follows: false, special: 'mage', size: 1.0 },
];

/** Lookup by type string. */
export const MONSTERS_BY_TYPE = Object.fromEntries(MONSTER_TABLE.map((m) => [m.type, m]));
export const MONSTER_TYPES = MONSTER_TABLE.map((m) => m.type);

/** Definition for a family/type index. */
export function monsterDefFor(family, typeIndex) {
  return MONSTER_TABLE.find((m) => m.family === family && m.typeIndex === typeIndex) || null;
}

/**
 * Roll the type index for a depth [VIC]: x = int(4·rnd + L/2); x >= 10 → r = int(6·rnd):
 * r > 0 → 10 − r, r = 0 → Mage/Demon (only from `mageDemonMinDepth`).
 * @returns {{typeIndex:number, special:boolean}}
 */
export function rollTypeIndex(rng, depth, mageDemonMinDepth = 14) {
  let x = Math.floor(4 * rng.next() + depth / 2);
  if (mageDemonMinDepth < 14 && depth >= mageDemonMinDepth && depth < 14 && rng.chance(0.08)) return { typeIndex: -1, special: true };
  if (x >= 10) {
    const r = Math.floor(6 * rng.next());
    if (r === 0 && depth >= mageDemonMinDepth) return { typeIndex: -1, special: true };
    x = r === 0 ? 9 : 10 - r;
  }
  return { typeIndex: Math.min(9, x), special: false };
}

function rollStats(rng, family, depth, x) {
  const L = Math.max(1, depth);
  const bonus = () => Math.floor(x * rng.next() + x);
  let strength = 0, hp = 0;
  if (family === 'creature') {
    const n = 2 + Math.floor(L / 4);
    for (let k = 0; k < n; k++) strength += Math.floor(4 * rng.next() + L);
    for (let k = 0; k < n; k++) hp += Math.floor(6 * rng.next() + 1.5 * L);
  } else {
    const n = 3 + Math.floor(L / 4);
    for (let k = 0; k < n; k++) strength += Math.floor(3 * rng.next() + 1.5 * L);
    for (let k = 0; k < n; k++) hp += Math.floor(4 * rng.next() + L);
  }
  strength += bonus(); hp += bonus();
  return { strength: Math.max(1, strength), hp: Math.max(1, hp) };
}

/**
 * Roll a monster entity for a depth.
 * @param {ReturnType<import('../core/rng.js').createRng>} rng
 * @param {number} depth
 * @param {{family?:'creature'|'human', type?:string, id?:string, mageDemonMinDepth?:number}} opts
 */
export function rollMonster(rng, depth, opts = {}) {
  let def;
  if (opts.type) {
    def = MONSTERS_BY_TYPE[opts.type];
    if (!def) throw new Error(`unknown monster type ${opts.type}`);
  } else {
    const family = opts.family || (rng.chance(0.6) ? 'creature' : 'human');
    const { typeIndex, special } = rollTypeIndex(rng, depth, opts.mageDemonMinDepth ?? 14);
    let x = typeIndex;
    // The VIC formula can roll one step below the bestiary's listed range at shallow depths; clamp to the table.
    while (!special && x > 0 && monsterDefFor(family, x).depthMin > depth) x--;
    def = special ? MONSTERS_BY_TYPE[family === 'creature' ? 'demon' : 'mage'] : monsterDefFor(family, x);
  }
  const x = def.typeIndex < 0 ? 5 : def.typeIndex;
  const { strength, hp } = rollStats(rng, def.family, depth, x);
  const speed = (1 / monsterPhaseSeconds(depth)) * def.speedMul;
  return {
    id: opts.id || `m${depth}-${Math.floor(rng.next() * 1e9)}`,
    kind: 'monster', type: def.type, name: def.name, family: def.family, typeIndex: def.typeIndex, glyph: def.glyph,
    x: 0, y: 0, px: 0, py: 0, facing: { dx: 0, dy: 1 },
    hp, maxHp: hp, initialHp: hp, strength, level: depth, xpValue: (strength + hp) * Math.max(1, depth),
    speed, moveTimer: rng.next() * 0.5, state: 'wander', target: null, lastSeen: null,
    invisible: def.special === 'invisible', special: def.special,
    flags: { thief: def.special === 'thief', blink: def.special === 'blink', flees: def.flees, follows: def.follows, invisible: def.special === 'invisible' },
    statusEffects: [], gold: 0, stolenGold: 0, wanderDir: null, fleeing: null, homeDepth: depth, size: def.size,
  };
}

/** Quality prefix compared with the player's battle skill [VIC]. */
export function monsterPrefix(monster, playerSkill) {
  if (monster.special === 'mage' || monster.special === 'demon') return '';
  const r = (monster.strength / Math.max(1, playerSkill)) * 5;
  if (monster.family === 'creature') return r < 1 ? 'weak' : r > 6 ? 'power' : '';
  return r < 1 ? 'inferior' : r > 6 ? 'exper' : '';
}

/** "a weak dire wolf" / "an exper war lord". */
export function describeMonster(monster, playerSkill) {
  const prefix = monsterPrefix(monster, playerSkill);
  const words = `${prefix ? prefix + ' ' : ''}${monster.name.toLowerCase()}`;
  const article = /^[aeiou]/.test(words) ? 'an' : 'a';
  return `${article} ${words}`;
}

/** Can the player see this monster? (tile visible, and not invisible unless Light is on) */
export function monsterVisibleToPlayer(game, monster) {
  if (monster.state === 'dead') return false;
  if (!game.level.isVisible(monster.x, monster.y)) return false;
  if (monster.invisible && !game.lightOn()) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// AI

/** Advance every monster on the current level by dt seconds. */
export function updateMonsters(game, dt) {
  const level = game.level;
  for (const m of [...level.entities]) {
    if (m.kind !== 'monster' || m.state === 'dead' || game.state.over) continue;
    m.moveTimer += dt * m.speed;
    let acts = 0;
    while (m.moveTimer >= 1 && acts < 2 && m.state !== 'dead' && !game.state.over) {
      m.moveTimer -= 1;
      monsterAct(game, m);
      acts++;
    }
  }
}

function cheb(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }

/** A monster may enter a tile if walkable, not the temple, not occupied by another monster. */
function monsterCanEnter(game, m, x, y, { allowPits = false } = {}) {
  const level = game.level;
  const t = level.get(x, y);
  if (t === TILE.WALL || t === TILE.TEMPLE) return false;
  if (!allowPits && (t === TILE.PIT || t === TILE.TRAP_PIT)) return false;
  const e = level.entityAt(x, y);
  if (e && e !== m) return false;
  return true;
}

/** Step a monster to a tile, applying tile consequences (pits kill creatures, humans grab gold). */
export function stepMonster(game, m, nx, ny) {
  const level = game.level;
  const fromX = m.x, fromY = m.y;
  m.facing = { dx: Math.sign(nx - fromX), dy: Math.sign(ny - fromY) };
  m.x = nx; m.y = ny;
  game.emit('entity:moved', { entity: m, fromX, fromY, toX: nx, toY: ny });
  const t = level.get(nx, ny);
  if (t === TILE.PIT && m.family === 'creature') {
    game.killMonster(m, 'pit');
    return;
  }
  if (m.family === 'human') {
    for (const it of level.itemsAt(nx, ny)) {
      if (it.type === 'gold' && !it.hidden) {
        level.removeItem(it);
        m.gold += it.gold || 0;
        if (level.isVisible(nx, ny)) game.log(`The ${m.name.toLowerCase()} snatches a sack of gold.`, 'info');
      }
    }
  }
}

function greedyStep(game, m, tx, ty, allowPits) {
  const dx = Math.sign(tx - m.x), dy = Math.sign(ty - m.y);
  const tries = [[dx, dy], [0, dy], [dx, 0]];
  for (const [ddx, ddy] of tries) {
    if (ddx === 0 && ddy === 0) continue;
    if (!game.level.canStep(m.x, m.y, ddx, ddy)) continue;
    if (!monsterCanEnter(game, m, m.x + ddx, m.y + ddy, { allowPits })) continue;
    stepMonster(game, m, m.x + ddx, m.y + ddy);
    return true;
  }
  const rng = game.rngs.ai;
  for (let i = 0; i < 5; i++) {
    const d = rng.pick(DIRS8);
    if (game.level.canStep(m.x, m.y, d.dx, d.dy) && monsterCanEnter(game, m, m.x + d.dx, m.y + d.dy, { allowPits })) {
      stepMonster(game, m, m.x + d.dx, m.y + d.dy);
      return true;
    }
  }
  return false;
}

function pathStep(game, m, tx, ty) {
  const level = game.level;
  const near = cheb(m.x, m.y, tx, ty) <= 2;
  const allowPits = m.family === 'creature' && near; // creatures can be baited into pits at close range
  const path = aStar(level, { x: m.x, y: m.y }, { x: tx, y: ty }, {
    maxNodes: 600,
    passable: (x, y) => monsterCanEnter(game, m, x, y, { allowPits }),
  });
  if (path && path.length) {
    const s = path[0];
    if (monsterCanEnter(game, m, s.x, s.y, { allowPits: true })) { stepMonster(game, m, s.x, s.y); return true; }
  }
  return greedyStep(game, m, tx, ty, allowPits);
}

function wanderStep(game, m) {
  const rng = game.rngs.ai, level = game.level;
  if (rng.chance(0.3)) return; // pause now and then
  let d = m.wanderDir;
  if (!d || rng.chance(0.25) || !level.canStep(m.x, m.y, d.dx, d.dy) || !monsterCanEnter(game, m, m.x + d.dx, m.y + d.dy)) {
    const options = DIRS8.filter((o) => level.canStep(m.x, m.y, o.dx, o.dy) && monsterCanEnter(game, m, m.x + o.dx, m.y + o.dy));
    if (!options.length) { m.wanderDir = null; return; }
    d = rng.pick(options);
    m.wanderDir = { dx: d.dx, dy: d.dy };
  }
  stepMonster(game, m, m.x + d.dx, m.y + d.dy);
}

function fleeStep(game, m) {
  const p = game.player, level = game.level, rng = game.rngs.ai;
  const options = DIRS8.filter((o) => level.canStep(m.x, m.y, o.dx, o.dy) && monsterCanEnter(game, m, m.x + o.dx, m.y + o.dy));
  if (!options.length) return;
  const dNow = cheb(m.x, m.y, p.x, p.y);
  let best = null, bestScore = -Infinity;
  for (const o of options) {
    const nx = m.x + o.dx, ny = m.y + o.dy;
    let score = cheb(nx, ny, p.x, p.y) - dNow;
    if (m.fleeing === 'escape' && !level.isExplored(nx, ny)) score += 2;
    if (level.get(nx, ny) === TILE.CORRIDOR) score += 0.3;
    score += rng.next() * 0.5;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  if (best) stepMonster(game, m, m.x + best.dx, m.y + best.dy);
  if (m.state === 'dead') return;
  if (m.fleeing === 'escape' && !level.isExplored(m.x, m.y) && cheb(m.x, m.y, p.x, p.y) > 3) {
    level.removeEntity(m); m.state = 'dead';
    game.log(`The ${m.name.toLowerCase()} escapes into the shadows${m.gold ? ' with your gold' : ''}.`, 'danger');
    game.emit('monster:escaped', { entity: m });
  } else if (m.fleeing === 'coward' && cheb(m.x, m.y, p.x, p.y) > game.balance.aggroRange) {
    m.state = 'wander'; m.fleeing = null;
  }
}

/** One AI decision for a monster. */
export function monsterAct(game, m) {
  const p = game.player, level = game.level, B = game.balance, rng = game.rngs.ai;
  if (m.state === 'dead' || game.state.over) return;
  const dist = cheb(m.x, m.y, p.x, p.y);
  if (m.state === 'flee') { fleeStep(game, m); return; }

  // Perception: symmetric FOV means "the player's visible mask covers my tile" == "I can see the player".
  const hidden = game.isPlayerHiddenFrom(m);
  let aware = false;
  if (!hidden && dist <= B.aggroRange && (level.isVisible(m.x, m.y) || dist <= B.hearRange)) aware = true;
  if (aware) {
    m.lastSeen = { x: p.x, y: p.y };
    if (m.state !== 'hunt') { m.state = 'hunt'; game.emit('monster:noticed', { entity: m }); }
  } else if (m.state === 'hunt' && hidden) {
    m.state = 'wander'; m.lastSeen = null;
  }

  // Cowards run when badly hurt.
  if (m.flags.flees && m.hp < m.maxHp * 0.25 && aware && m.strength < p.skill) {
    m.state = 'flee'; m.fleeing = 'coward';
    if (level.isVisible(m.x, m.y)) game.log(`The ${m.name.toLowerCase()} turns and runs!`, 'info');
    fleeStep(game, m);
    return;
  }

  // Dimension Spider: blink next to the player when close but not adjacent.
  if (m.flags.blink && aware && dist <= B.spiderBlinkRange && dist > 1) {
    const spots = DIRS8.map((d) => ({ x: p.x + d.dx, y: p.y + d.dy })).filter((s) => monsterCanEnter(game, m, s.x, s.y));
    if (spots.length) {
      const s = rng.pick(spots);
      const fromX = m.x, fromY = m.y;
      m.x = s.x; m.y = s.y;
      game.emit('entity:moved', { entity: m, fromX, fromY, toX: s.x, toY: s.y, blink: true });
      game.emit('fx:blink', { entity: m, x: s.x, y: s.y });
      game.log('The dimension spider phases in beside you!', 'danger');
      return;
    }
  }

  if (m.state === 'hunt') {
    if (dist <= 1 && !hidden && level.canStep(m.x, m.y, p.x - m.x, p.y - m.y)) { game.monsterAttack(m); return; }
    const t = m.lastSeen;
    if (t && (t.x !== m.x || t.y !== m.y)) { pathStep(game, m, t.x, t.y); return; }
    m.state = 'wander'; m.lastSeen = null;
    wanderStep(game, m);
    return;
  }
  // Unaware monsters far from the player drift lazily; nearer ones roam.
  if (dist > B.aggroRange * 2 && rng.chance(0.5)) return;
  wanderStep(game, m);
}

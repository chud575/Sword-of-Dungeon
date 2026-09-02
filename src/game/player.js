// Player stats, levelling, gold and status effects (DESIGN.md §3).
import { xpForLevel } from '../core/constants.js';

/**
 * Create the player entity.
 * @param {ReturnType<import('../core/rng.js').createRng>} rng
 * @param {object} balance BALANCE entry
 */
export function createPlayer(rng, balance) {
  const hp = balance.rolledStats ? 3 * Math.floor(6 * rng.next() + 1) : balance.startHp;
  const skill = balance.rolledStats ? 3 * Math.floor(6 * rng.next() + 1) : balance.startSkill;
  return {
    id: 'player', kind: 'player', type: 'player', name: 'Warrior',
    x: 0, y: 0, px: 0, py: 0, facing: { dx: 0, dy: 1 },
    hp, maxHp: hp, level: 1, xp: 0, xpValue: 0, skill, gold: 0, kills: 0,
    speed: 1 / balance.playerStepTime, moveTimer: 0, state: 'idle', target: null, invisible: false,
    flags: {}, statusEffects: [],
    inventory: { potion: 1, sack: 0, beacon: 0 },
    spells: { teleport: 1, shield: 0, regeneration: 0, invisibility: 0, light: 0, drift: 0 },
    enchant: 0, maps: [], hasSword: false,
    autohealRate: balance.autohealRate, regenCounter: 0, idleTime: 0,
    deepest: 1, buriedCaches: 0,
  };
}

export function hasStatus(player, type) { return player.statusEffects.some((s) => s.type === type); }
export function getStatus(player, type) { return player.statusEffects.find((s) => s.type === type) || null; }
/** Add (or return the existing) status effect. */
export function addStatus(player, type, extra = {}) {
  let st = getStatus(player, type);
  if (!st) { st = { type, ...extra }; player.statusEffects.push(st); }
  return st;
}
export function removeStatus(player, type) {
  player.statusEffects = player.statusEffects.filter((s) => s.type !== type);
}

/** Gold the player can carry. */
export function goldCapacity(player, balance) {
  return balance.goldCapacity + balance.sackCapacity * (player.inventory.sack || 0);
}

/** Experience level for a cumulative XP amount. */
export function levelFromXp(xp) {
  let n = 1;
  while (xp >= xpForLevel(n + 1)) n++;
  return n;
}

/**
 * Award XP and apply any level-ups (+5..19 max HP, +1..10 skill each) [VIC 88].
 * @returns {{leveledUp:boolean, levels:number}}
 */
export function gainXp(game, amount) {
  const p = game.player;
  amount = Math.max(0, Math.floor(amount));
  p.xp += amount;
  let levels = 0;
  while (p.xp >= xpForLevel(p.level + 1)) {
    p.level++; levels++;
    const hpGain = Math.floor(15 * game.rngs.main.next() + 5);
    const skillGain = Math.floor(10 * game.rngs.main.next() + 1);
    p.maxHp += hpGain;
    p.hp += hpGain;
    p.skill += skillGain;
    game.log(`LEVEL RAISED TO ${p.level}! (+${hpGain} hits, +${skillGain} skill)`, 'quest');
    game.emit('fx:levelup', { x: p.x, y: p.y });
    game.emit('sfx:levelup', {});
  }
  game.emit('player:xp', { xp: p.xp, level: p.level, leveledUp: levels > 0 });
  if (levels > 0) game.emit('player:hp', { hp: p.hp, maxHp: p.maxHp });
  return { leveledUp: levels > 0, levels };
}

/** Lose a level (Demon). */
export function drainLevel(game) {
  const p = game.player;
  p.xp = Math.floor(p.xp / 2);
  if (p.level > 1) p.level--;
  game.emit('player:xp', { xp: p.xp, level: p.level, leveledUp: false });
}

/** Add gold up to capacity. Returns the amount actually added (can be negative for losses). */
export function addGold(game, delta) {
  const p = game.player;
  const cap = goldCapacity(p, game.balance);
  const before = p.gold;
  p.gold = Math.max(0, Math.min(cap, p.gold + delta));
  const actual = p.gold - before;
  if (actual !== 0) game.emit('player:gold', { gold: p.gold, delta: actual });
  return actual;
}

export function healPlayer(game, amount) {
  const p = game.player;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + Math.max(0, Math.floor(amount)));
  if (p.hp !== before) game.emit('player:hp', { hp: p.hp, maxHp: p.maxHp, delta: p.hp - before });
  return p.hp - before;
}

/** Apply damage (no death check here; callers decide the rule that applies). */
export function damagePlayer(game, amount, source = null) {
  const p = game.player;
  amount = Math.max(0, Math.floor(amount));
  if (hasStatus(p, 'shield') && source !== 'trap:pit' && source !== 'trap:ceiling' && source !== 'fall') amount = 0;
  p.hp -= amount;
  game.emit('player:hp', { hp: p.hp, maxHp: p.maxHp, delta: -amount, source });
  return amount;
}

/** Idle regeneration tick [VIC 45]: heal 1 when counter exceeds (hp/maxHp) * rate. */
export function regenTick(game) {
  const p = game.player;
  if (p.hp >= p.maxHp) { p.regenCounter = 0; return false; }
  p.regenCounter++;
  const rate = game.playerOnTemple() ? p.autohealRate / 2 : p.autohealRate;
  const threshold = (Math.max(0, p.hp) / p.maxHp) * rate;
  if (p.regenCounter > threshold) {
    p.regenCounter = 0;
    healPlayer(game, 1);
    return true;
  }
  return false;
}

/** Per-level resets: light off, regeneration gone, autoheal back to 50. */
export function resetLevelEffects(player, balance) {
  player.statusEffects = player.statusEffects.filter((s) => s.type !== 'light' && s.type !== 'regeneration');
  player.autohealRate = balance.autohealRate;
}

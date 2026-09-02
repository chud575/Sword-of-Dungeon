// Combat resolution (DESIGN.md §7.3): no hit rolls — every round both sides deal damage.
import { COMBAT_WORDS } from '../core/constants.js';
import { hasStatus, removeStatus, damagePlayer, addGold, gainXp, drainLevel } from './player.js';
import { swordStealable, stealSword } from './quest.js';
import { describeMonster } from './monsters.js';

/** Damage ratio x = monster strength / player skill. */
export function damageRatio(monster, player) {
  return monster.strength / Math.max(1, player.skill);
}

/** Player hit on a monster: int((1/x)·4·depth·rnd + 1 + enchantments). */
export function playerStrikeDamage(rng, monster, player, depth) {
  const x = damageRatio(monster, player);
  const roll = rng.next();
  return { damage: Math.floor((1 / x) * 4 * depth * roll + 1 + player.enchant), crit: roll > 0.9 };
}

/** Monster hit on the player: int(x·4·depth·rnd + 1); zero while shielded. */
export function monsterStrikeDamage(rng, monster, player, depth) {
  const x = damageRatio(monster, player);
  const roll = rng.next();
  if (hasStatus(player, 'shield')) return { damage: 0, crit: false };
  return { damage: Math.floor(x * 4 * depth * roll + 1), crit: roll > 0.9 };
}

/** XP for a kill: (strength + initial HP) × depth. */
export function killXp(monster, depth) {
  return (monster.strength + monster.initialHp) * Math.max(1, depth);
}

/** Expected fight outcome for tooltips: returns 'trivial'|'easy'|'even'|'hard'|'deadly'. */
export function dangerBand(monster, player) {
  const x = damageRatio(monster, player) * 5;
  if (x < 1) return 'trivial';
  if (x < 3) return 'easy';
  if (x < 6) return 'even';
  if (x < 12) return 'hard';
  return 'deadly';
}

/**
 * One exchange of blows. Player-initiated: player strikes first; ambush: monster first.
 * @returns {{playerDamage:number, monsterDamage:number, killed:boolean, playerDead:boolean}}
 */
export function resolveRound(game, monster, { playerFirst = true } = {}) {
  const p = game.player, depth = Math.max(1, game.level.depth), rng = game.rngs.combat;
  const result = { playerDamage: 0, monsterDamage: 0, killed: false, playerDead: false };
  const order = playerFirst ? ['p', 'm'] : ['m', 'p'];
  for (const side of order) {
    if (game.state.over || monster.state === 'dead') break;
    if (side === 'p') {
      const { damage, crit } = playerStrikeDamage(rng, monster, p, depth);
      monster.hp -= damage;
      result.playerDamage = damage;
      const killed = monster.hp < 0;
      game.emit('entity:attacked', { attacker: p, defender: monster, damage, killed, crit });
      game.emit('sfx:hit', { family: monster.family, by: 'player' });
      if (killed) { result.killed = true; killMonster(game, monster, p); break; }
    } else {
      const { damage, crit } = monsterStrikeDamage(rng, monster, p, depth);
      damagePlayer(game, damage, monster);
      result.monsterDamage = damage;
      const word = rng.pick(COMBAT_WORDS[monster.family] || COMBAT_WORDS.creature);
      const dead = p.hp < game.balance.deathHp;
      game.emit('entity:attacked', { attacker: monster, defender: p, damage, killed: dead, crit });
      game.emit('sfx:hit', { family: monster.family, by: 'monster' });
      game.log(damage > 0 ? `HITS: ${p.hp} ${word}` : `Your shield turns the blow. ${word}`, 'combat');
      if (dead) { result.playerDead = true; game.die('slain', monster); break; }
    }
  }
  return result;
}

/** Remove a slain monster: XP, skill, kills, stolen gold recovery, spell expiries. */
export function killMonster(game, monster, killer) {
  const p = game.player, level = game.level;
  monster.state = 'dead';
  monster.hp = Math.min(monster.hp, -1);
  level.removeEntity(monster);
  level.killsOnLevel++;
  const byPlayer = killer && killer.kind === 'player';
  game.emit('entity:died', { entity: monster, killer });
  if (byPlayer) {
    const xp = killXp(monster, level.depth);
    p.kills++;
    game.stats.kills++;
    const skillGain = Math.floor(5 * game.rngs.combat.next() + 1);
    p.skill += skillGain;
    const verb = game.rngs.combat.chance(0.5) ? 'YOU HAVE SLAIN' : 'YOU VANQUISHED';
    game.log(`${verb} the ${monster.name.toLowerCase()}! (+${xp} XP)`, 'combat');
    game.emit('sfx:slain', { family: monster.family });
    gainXp(game, xp);
    if (hasStatus(p, 'invisible')) { removeStatus(p, 'invisible'); p.invisible = false; game.log('Your invisibility fades.', 'magic'); }
  } else if (monster.state === 'dead' && killer === 'pit') {
    game.log(`The ${monster.name.toLowerCase()} tumbles into the pit!`, 'info');
  }
  if (monster.gold > 0) {
    const stolen = monster.stolenGold || 0;
    if (stolen > 0) game.log(`FOUND YOUR ${stolen} GOLD!!`, 'loot');
    const taken = addGold(game, monster.gold);
    if (taken < monster.gold) level.addItem({ type: 'gold', x: monster.x, y: monster.y, qty: 1, gold: monster.gold - taken, hidden: false });
    monster.gold = 0;
  }
  if (game.state.combat && game.state.combat.monsterId === monster.id) game.endCombat('killed');
}

/**
 * A monster reaches the player: sword theft, Mage/Demon touch, gold theft or a forced fight.
 * @returns {boolean} whether the monster did anything
 */
export function monsterAttack(game, monster) {
  const p = game.player;
  if (game.state.over || monster.state === 'dead') return false;
  if (game.playerOnSanctuary()) return false;
  const level = game.level;
  const name = describeMonster(monster, p.skill);
  monster.facing = { dx: Math.sign(p.x - monster.x), dy: Math.sign(p.y - monster.y) };
  if (monster.special === 'mage') {
    for (const k of Object.keys(p.spells)) p.spells[k] = 0;
    level.removeEntity(monster); monster.state = 'dead';
    game.log('THE MAGE TAKES YOUR MAGIC SPELLS!! He is gone before you can strike.', 'danger');
    game.emit('fx:mage', { x: p.x, y: p.y });
    game.emit('sfx:mage', {});
    return true;
  }
  if (monster.special === 'demon') {
    drainLevel(game);
    level.removeEntity(monster); monster.state = 'dead';
    game.log('THE DEMON DRAINS YOUR EXPERIENCE LEVEL!! It fades back into the stone.', 'danger');
    game.emit('fx:demon', { x: p.x, y: p.y });
    game.emit('sfx:demon', {});
    return true;
  }
  if (swordStealable(game)) { stealSword(game, monster); return true; }
  // Gold theft by humans: rogues always; others when much weaker or stronger than you.
  if (monster.family === 'human' && p.gold > 0 && monster.state !== 'flee') {
    const x = damageRatio(monster, p);
    if (monster.flags.thief || x < 0.5 || x > 1) {
      const gold = p.gold;
      addGold(game, -gold);
      monster.gold += gold;
      monster.stolenGold = (monster.stolenGold || 0) + gold;
      monster.state = 'flee'; monster.fleeing = 'escape'; monster.lastSeen = null;
      game.log(`YOUR GOLD IS STOLEN!! ${name} grabs ${gold} gold and runs.`, 'danger');
      game.emit('monster:stole', { entity: monster, gold });
      game.emit('sfx:stolen', {});
      return true;
    }
  }
  const combat = game.state.combat;
  if (!combat) {
    game.state.combat = { monsterId: monster.id, playerInitiated: false, timer: game.balance.combatRoundTime, rounds: 0 };
    game.log(`YOU ARE ATTACKED BY ${name}!`, 'danger');
    game.emit('combat:start', { entity: monster, playerInitiated: false });
    game.emit('sfx:attacked', {});
    game.state.combat.rounds++;
    resolveRound(game, monster, { playerFirst: false });
    return true;
  }
  if (combat.monsterId !== monster.id) {
    // A second attacker joins: it just lands its blow this phase.
    const depth = Math.max(1, level.depth);
    const { damage, crit } = monsterStrikeDamage(game.rngs.combat, monster, p, depth);
    damagePlayer(game, damage, monster);
    const dead = p.hp < game.balance.deathHp;
    game.emit('entity:attacked', { attacker: monster, defender: p, damage, killed: dead, crit });
    game.log(`${name} strikes from the side! HITS: ${p.hp}`, 'combat');
    if (dead) game.die('slain', monster);
    return true;
  }
  return false;
}

/** The player bumps into a monster: start (or continue) a fight, striking first. */
export function playerAttack(game, monster) {
  const p = game.player;
  if (game.state.over || monster.state === 'dead') return false;
  const combat = game.state.combat;
  if (combat && !combat.playerInitiated && combat.monsterId !== monster.id) {
    // locked in a forced fight: blows go to the attacker
    const engaged = game.level.entities.find((e) => e.id === combat.monsterId);
    if (engaged) monster = engaged;
  }
  if (!combat || combat.monsterId !== monster.id) {
    if (combat) game.endCombat('switch');
    game.state.combat = { monsterId: monster.id, playerInitiated: true, timer: game.balance.combatRoundTime, rounds: 0 };
    game.log(`${describeMonster(monster, p.skill)}!`, 'combat');
    game.emit('combat:start', { entity: monster, playerInitiated: true });
  } else if (game.state.combat.timer > 0) {
    return false; // too soon: rounds are 250 ms apart
  }
  p.facing = { dx: Math.sign(monster.x - p.x), dy: Math.sign(monster.y - p.y) };
  game.state.combat.timer = game.balance.combatRoundTime;
  game.state.combat.idle = 0;
  game.state.combat.rounds++;
  resolveRound(game, monster, { playerFirst: true });
  return true;
}

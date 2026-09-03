// Combat resolution (DESIGN.md §7.3): no hit rolls — every round both sides deal damage. Top-10% rolls are
// crits (cosmetic in Classic; in extended rules a player crit staggers the monster and interrupts its
// breath), bottom-10% rolls are glancing. Every round is a noise other monsters can hear.
import { COMBAT_WORDS } from '../core/constants.js';
import { hasStatus, removeStatus, damagePlayer, addGold, gainXp, drainLevel } from './player.js';
import { swordStealable, stealSword } from './quest.js';
import { describeMonster } from './monsters.js';
import { makeNoise, stagger, onMonsterSlain, extendedRules, AI } from './monsterAi.js';

/** Damage ratio x = monster strength / player skill. */
export function damageRatio(monster, player) {
  return monster.strength / Math.max(1, player.skill);
}

/** Player hit on a monster: int((1/x)·4·depth·rnd + 1 + enchantments). */
export function playerStrikeDamage(rng, monster, player, depth) {
  const x = damageRatio(monster, player);
  const roll = rng.next();
  return { damage: Math.floor((1 / x) * 4 * depth * roll + 1 + player.enchant), crit: roll > 0.9, glancing: roll < 0.1, roll };
}

/** Monster hit on the player: int(x·4·depth·rnd + 1); zero while shielded. */
export function monsterStrikeDamage(rng, monster, player, depth) {
  const x = damageRatio(monster, player);
  const roll = rng.next();
  if (hasStatus(player, 'shield')) return { damage: 0, crit: false, glancing: false, roll };
  return { damage: Math.floor(x * 4 * depth * roll + 1), crit: roll > 0.9, glancing: roll < 0.1, roll };
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

/** Wound stage for a monster's HP fraction (monster HP itself stays hidden, as in the original). */
export function woundStage(monster) {
  const f = monster.hp / Math.max(1, monster.maxHp);
  if (f <= 0) return 'slain';
  if (f <= 0.2) return 'dying';
  if (f <= 0.5) return 'bloodied';
  if (f < 1) return 'scratched';
  return 'unhurt';
}

/** Narrate wound thresholds crossed by a hit (extended rules only). */
function narrateWound(game, monster, hpBefore) {
  if (monster.state === 'dead' || !extendedRules(game)) return;
  const before = hpBefore / Math.max(1, monster.maxHp), after = monster.hp / Math.max(1, monster.maxHp);
  const name = monster.name.toLowerCase();
  let text = null, stage = null;
  if (before > 0.5 && after <= 0.5 && after > 0.2) { stage = 'bloodied'; text = monster.family === 'human' ? `The ${name} staggers, bleeding.` : `The ${name} is bloodied.`; }
  else if (before > 0.2 && after <= 0.2) { stage = 'dying'; text = `The ${name} reels, near death!`; }
  if (!stage) return;
  game.log(text, 'combat');
  game.emit('monster:wounded', { entity: monster, frac: after, stage });
}

/** The player's blow lands on a monster (shared by rounds and any future player-side ability). */
export function playerHits(game, monster, { damage, crit, glancing }) {
  const p = game.player;
  const hpBefore = monster.hp;
  monster.hp -= damage;
  const killed = monster.hp < 0;
  game.emit('entity:attacked', { attacker: p, defender: monster, damage, killed, crit, glancing, kind: 'melee' });
  game.emit('sfx:hit', { family: monster.family, by: 'player', crit });
  if (killed) { killMonster(game, monster, p); return true; }
  if (crit) {
    game.emit('combat:crit', { attacker: p, defender: monster, damage });
    if (extendedRules(game)) {
      const name = monster.name.toLowerCase();
      game.log(`A telling blow! The ${name} staggers.`, 'combat');
      stagger(game, monster);
    }
  }
  narrateWound(game, monster, hpBefore);
  return false;
}

/** A monster's blow lands on the player. Returns true if the player died. */
export function monsterHits(game, monster, { damage, crit, glancing }, { fromSide = false } = {}) {
  const p = game.player, rng = game.rngs.combat;
  damagePlayer(game, damage, monster);
  const word = rng.pick(COMBAT_WORDS[monster.family] || COMBAT_WORDS.creature);
  const dead = p.hp < game.balance.deathHp;
  game.emit('entity:attacked', { attacker: monster, defender: p, damage, killed: dead, crit, glancing, kind: 'melee' });
  game.emit('sfx:hit', { family: monster.family, by: 'monster', crit });
  const who = fromSide ? `${describeMonster(monster, p.skill)} strikes from the side! ` : '';
  if (damage > 0) game.log(`${who}HITS: ${p.hp} ${word}${crit ? ' — a savage blow!' : glancing ? ' (glancing)' : ''}`, 'combat');
  else game.log(`${who}Your shield turns the blow. ${word}`, 'combat');
  if (crit) game.emit('combat:crit', { attacker: monster, defender: p, damage });
  if (dead) game.die('slain', monster);
  return dead;
}

/**
 * One exchange of blows. Player-initiated: player strikes first; ambush: monster first.
 * @returns {{playerDamage:number, monsterDamage:number, killed:boolean, playerDead:boolean}}
 */
export function resolveRound(game, monster, { playerFirst = true } = {}) {
  const p = game.player, depth = Math.max(1, game.level.depth), rng = game.rngs.combat;
  const result = { playerDamage: 0, monsterDamage: 0, killed: false, playerDead: false };
  makeNoise(game.level, p.x, p.y, AI.combatNoise, game.state.time, 'combat');
  const order = playerFirst ? ['p', 'm'] : ['m', 'p'];
  for (const side of order) {
    if (game.state.over || monster.state === 'dead') break;
    if (side === 'p') {
      const hit = playerStrikeDamage(rng, monster, p, depth);
      result.playerDamage = hit.damage;
      if (playerHits(game, monster, hit)) { result.killed = true; break; }
    } else {
      const hit = monsterStrikeDamage(rng, monster, p, depth);
      result.monsterDamage = hit.damage;
      if (monsterHits(game, monster, hit)) { result.playerDead = true; break; }
    }
  }
  return result;
}

/** Remove a slain monster: XP, skill, kills, stolen gold recovery, spell expiries, kin morale. */
export function killMonster(game, monster, killer) {
  const p = game.player, level = game.level;
  monster.state = 'dead';
  monster.hp = Math.min(monster.hp, -1);
  monster.charging = null;
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
    game.log(`${verb} the ${monster.name.toLowerCase()}! (+${xp} XP, +${skillGain} skill)`, 'combat');
    game.emit('sfx:slain', { family: monster.family });
    game.emit('player:skill', { skill: p.skill, delta: skillGain });
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
  if (!game.state.over) onMonsterSlain(game, monster);
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
    if (game.state.combat && game.state.combat.monsterId === monster.id) game.endCombat('vanished');
    return true;
  }
  if (monster.special === 'demon') {
    drainLevel(game);
    level.removeEntity(monster); monster.state = 'dead';
    game.log('THE DEMON DRAINS YOUR EXPERIENCE LEVEL!! It fades back into the stone.', 'danger');
    game.emit('fx:demon', { x: p.x, y: p.y });
    game.emit('sfx:demon', {});
    if (game.state.combat && game.state.combat.monsterId === monster.id) game.endCombat('vanished');
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
      monster.state = 'flee'; monster.fleeing = 'escape'; monster.lastSeen = null; monster.target = null;
      game.log(`YOUR GOLD IS STOLEN!! ${name} grabs ${gold} gold and runs.`, 'danger');
      game.emit('monster:stole', { entity: monster, gold });
      game.emit('monster:flee', { entity: monster, reason: 'escape' });
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
    const hit = monsterStrikeDamage(game.rngs.combat, monster, p, depth);
    makeNoise(level, p.x, p.y, AI.combatNoise, game.state.time, 'combat');
    game.emit('combat:flank', { entity: monster });
    monsterHits(game, monster, hit, { fromSide: true });
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
    // Being struck wakes anything: the monster turns to fight even if it never saw you coming.
    if (monster.state !== 'flee' && monster.special !== 'mage' && monster.special !== 'demon') {
      const was = monster.state;
      monster.state = 'hunt'; monster.lastSeen = { x: p.x, y: p.y }; monster.target = monster.lastSeen; monster.hadPrey = true;
      if (was !== 'hunt') game.emit('monster:noticed', { entity: monster, how: 'struck' });
    }
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

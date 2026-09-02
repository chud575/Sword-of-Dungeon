import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/game.js';
import { EventBus } from '../src/core/events.js';
import { resolveRound, playerStrikeDamage, monsterStrikeDamage, killXp, damageRatio } from '../src/game/combat.js';
import { rollMonster, describeMonster } from '../src/game/monsters.js';
import { createRng } from '../src/core/rng.js';
import { addStatus } from '../src/game/player.js';

function adjacentFree(g) {
  const p = g.player, lv = g.level;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (lv.isWalkable(p.x + dx, p.y + dy) && !lv.entityAt(p.x + dx, p.y + dy)) return { x: p.x + dx, y: p.y + dy };
  return null;
}

test('a fresh warrior beats a dire wolf on level 1 most of the time', () => {
  let wins = 0, losses = 0, rounds = 0;
  for (let i = 0; i < 150; i++) {
    const g = new Game({ seed: 500 + i, difficulty: 'standard', bus: new EventBus() });
    const spot = adjacentFree(g);
    const m = g.spawnMonster('dire-wolf', spot.x, spot.y);
    for (let r = 0; r < 100 && m.state !== 'dead' && !g.over; r++) { resolveRound(g, m, { playerFirst: true }); rounds++; }
    if (m.state === 'dead' && !g.over) wins++; else losses++;
  }
  assert.ok(wins / (wins + losses) > 0.8, `win rate ${wins}/${wins + losses}`);
  assert.ok(rounds / 150 < 15, 'fights are short');
});

test('damage formulas stay within the VIC bounds and shields block', () => {
  const rng = createRng(3);
  const g = new Game({ seed: 77, bus: new EventBus() });
  const p = g.player;
  for (let depth = 1; depth <= 20; depth += 3) {
    for (let i = 0; i < 200; i++) {
      const m = rollMonster(rng, depth);
      const x = damageRatio(m, p);
      const pd = playerStrikeDamage(rng, m, p, depth).damage;
      assert.ok(pd >= 1 + p.enchant && pd <= Math.floor((1 / x) * 4 * depth + 1 + p.enchant), `player dmg ${pd}`);
      const md = monsterStrikeDamage(rng, m, p, depth).damage;
      assert.ok(md >= 1 && md <= Math.floor(x * 4 * depth + 1), `monster dmg ${md}`);
      assert.equal(killXp(m, depth), (m.strength + m.initialHp) * depth);
      assert.match(describeMonster(m, p.skill), /^an? /);
    }
  }
  addStatus(p, 'shield', {});
  const m = rollMonster(rng, 5);
  for (let i = 0; i < 50; i++) assert.equal(monsterStrikeDamage(rng, m, p, 5).damage, 0);
});

test('killing grants XP, skill and ends invisibility; player-initiated fights can be fled', () => {
  const g = new Game({ seed: 9, bus: new EventBus() });
  const p = g.player;
  const spot = adjacentFree(g);
  const m = g.spawnMonster('dire-wolf', spot.x, spot.y);
  m.hp = 1;
  p.invisible = true; addStatus(p, 'invisible', {});
  const xpBefore = p.xp, skillBefore = p.skill;
  g.move(spot.x - p.x, spot.y - p.y);
  assert.equal(m.state, 'dead');
  assert.equal(p.kills, 1);
  assert.ok(p.xp > xpBefore && p.skill > skillBefore);
  assert.equal(p.invisible, false);
  assert.equal(g.state.combat, null);

  const spot2 = adjacentFree(g);
  const m2 = g.spawnMonster('ogre', spot2.x, spot2.y);
  m2.hp = 100000;
  g.update(1);
  g.move(spot2.x - p.x, spot2.y - p.y);
  assert.ok(g.state.combat && g.state.combat.playerInitiated);
  g.setHeld(0, 0);
  assert.equal(g.state.combat, null, 'released the stick: fight over');
  g.level.removeEntity(m2);
});

test('monster-initiated fights are forced and a rogue steals gold', () => {
  const g = new Game({ seed: 21, bus: new EventBus() });
  const p = g.player;
  g.give('gold', 50);
  const spot = adjacentFree(g);
  const rogue = g.spawnMonster('rogue', spot.x, spot.y);
  g.monsterAttack(rogue);
  assert.equal(p.gold, 0);
  assert.equal(rogue.gold, 50);
  assert.equal(rogue.state, 'flee');
  g.kill(rogue);
  assert.equal(p.gold, 50, 'gold recovered on kill');

  const spot2 = adjacentFree(g);
  const ogre = g.spawnMonster('ogre', spot2.x, spot2.y);
  ogre.strength = 1; ogre.hp = 1000; ogre.maxHp = 1000;
  g.monsterAttack(ogre);
  assert.ok(g.state.combat && !g.state.combat.playerInitiated, 'forced fight');
  const before = { x: p.x, y: p.y };
  g.move(-(spot2.x - p.x), -(spot2.y - p.y));
  assert.deepEqual({ x: p.x, y: p.y }, before, 'cannot walk out of an ambush');
  g.castSpell('teleport');
  assert.equal(g.state.combat, null, 'teleport escapes');
});

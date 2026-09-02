import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/game.js';
import { EventBus } from '../src/core/events.js';
import { swordDepthForSeed } from '../src/game/quest.js';

test('sword depth is 15..19 and stable per seed', () => {
  for (let s = 0; s < 50; s++) {
    const d = swordDepthForSeed(s);
    assert.ok(d >= 15 && d <= 19);
    assert.equal(d, swordDepthForSeed(s));
  }
});

test('level 1 exit is sealed without the sword; with it, reaching the surface wins', () => {
  const bus = new EventBus();
  const events = [];
  bus.on('game:over', (e) => events.push(e));
  bus.on('sword:found', (e) => events.push({ found: e }));
  const g = new Game({ seed: 3, bus });
  const up = g.level.stairsUp;
  g.teleportTo(up.x, up.y);
  assert.equal(g.interact(), false);
  assert.equal(g.depth, 1);
  g.give('xp', 100);
  g.give('sword');
  assert.equal(g.player.xp, 200, 'XP doubled on pickup');
  assert.ok(g.state.quest.timer > 0);
  assert.ok(events.some((e) => e.found && e.found.first));
  assert.equal(g.interact(), true);
  assert.equal(g.depth, 0);
  assert.ok(g.over);
  const over = events.find((e) => e.stats);
  assert.ok(over && over.victory === true && over.cause === 'victory');
  assert.ok(over.stats.score > 25000);
});

test('picking the sword up from its level by walking onto it starts the countdown', () => {
  const g = new Game({ seed: 12, bus: new EventBus() });
  const d = g.state.quest.swordDepth;
  g.goToDepth(d);
  const sword = g.level.items.find((it) => it.type === 'sword');
  assert.ok(sword, 'sword lies on its level');
  assert.equal(g.level.temples.length, 0, 'no temple on the sword level');
  const lv = g.level;
  let from = null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (lv.isWalkable(sword.x + dx, sword.y + dy)) { from = { x: sword.x + dx, y: sword.y + dy }; break; }
  g.teleportTo(from.x, from.y);
  g.move(sword.x - from.x, sword.y - from.y);
  assert.ok(g.player.hasSword);
  assert.equal(g.state.quest.timer, g.balance.swordTimer);
  assert.ok(!g.level.items.some((it) => it.type === 'sword'));
});

test('running out of time is a defeat', () => {
  const bus = new EventBus();
  let over = null;
  bus.on('game:over', (e) => { over = e; });
  const g = new Game({ seed: 4, bus });
  g.give('sword');
  g.state.quest.timer = 0.5;
  g.update(1);
  assert.ok(g.over);
  assert.equal(over.victory, false);
  assert.equal(over.cause, 'timeout');
});

test('an ambush steals the sword and returns it to its level; the clock keeps running', () => {
  const g = new Game({ seed: 8, bus: new EventBus() });
  g.give('sword');
  const p = g.player;
  let spot = null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (g.level.isWalkable(p.x + dx, p.y + dy)) { spot = { x: p.x + dx, y: p.y + dy }; break; }
  const m = g.spawnMonster('ogre', spot.x, spot.y);
  g.monsterAttack(m);
  assert.equal(p.hasSword, false);
  assert.equal(m.state, 'dead');
  assert.equal(g.state.quest.stolenCount, 1);
  const swordLevel = g.getLevel(g.state.quest.swordDepth);
  assert.ok(swordLevel.items.some((it) => it.type === 'sword'));
  const before = g.state.quest.timer;
  g.update(2);
  assert.ok(g.state.quest.timer < before);
  assert.ok(!g.over);
});

test('temple sacrifice converts gold to XP and pits drop you deeper', () => {
  const g = new Game({ seed: 6, bus: new EventBus() });
  const t = g.level.temples[0];
  g.give('gold', 40);
  g.teleportTo(t.x, t.y);
  assert.ok(g.playerOnSanctuary());
  const xp = g.player.xp;
  assert.equal(g.interact(), true);
  assert.equal(g.player.gold, 0);
  assert.equal(g.player.xp, xp + 40);
  g.heal();
  g.springTrap('pit', g.player.x, g.player.y);
  assert.ok(g.depth >= 3 && g.depth <= 6, `fell to ${g.depth}`);
  assert.ok(g.level.climbable.length === 1);
  const d = g.depth;
  assert.equal(g.interact(), true, 'climb back up');
  assert.ok(g.depth < d);
});

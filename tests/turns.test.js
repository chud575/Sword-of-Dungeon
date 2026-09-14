// turns: a fight is announced, then fought one blow at a time; and monsters can keep up with you.
//
// The 2009 iOS port, measured off its footage (the AppSpy review, 67-72 s): an ogre closes two tiles
// in half a second, the top band reads "AN OGRE!" before anyone swings, and the blows then come singly
// and in turn — the hero's SLASH!, the ogre's SWIPE! (a miss), the hero's OUCH! — about half a second
// apart. The remake used to let the hero outwalk every monster (a level-1 monster took 3.2 s a tile)
// and resolved both blows of an exchange on the same tick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/game.js';
import { EventBus } from '../src/core/events.js';
import { BALANCE, monsterTilesPerSecond, monsterPhaseSeconds } from '../src/core/constants.js';

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function freeNeighbours(g) {
  const p = g.player, lv = g.level;
  return ORTHO.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).filter((s) => lv.isWalkable(s.x, s.y) && !lv.entityAt(s.x, s.y));
}

/** A monster that will neither die nor run for the length of a test. */
function sturdy(g, type, s) {
  const m = g.spawnMonster(type, s.x, s.y);
  m.hp = m.maxHp = 1e6; m.flags.flees = false; m.state = 'hunt';
  return m;
}

/** Run the sim, recording every blow between the player and `m` (not blows from anyone else). */
function fight(g, m, seconds, dt = 1 / 60) {
  const blows = [];
  const off = g.bus.on('entity:attacked', (e) => {
    if (e.attacker.id !== m.id && e.defender.id !== m.id) return;
    blows.push({ t: g.state.time, by: e.attacker.kind === 'player' ? 'p' : 'm' });
  });
  for (let t = 0; t < seconds && !g.over; t += dt) g.update(dt);
  if (typeof off === 'function') off();
  return blows;
}

function newGame(seed) {
  const g = new Game({ seed, difficulty: 'classic', bus: new EventBus() });
  g.player.hp = g.player.maxHp = 1e6;
  return g;
}

test('a fight you start is announced, held for a standoff, then fought one blow a turn — yours first', () => {
  const g = newGame(31);
  const p = g.player, B = g.balance;
  const [spot] = freeNeighbours(g);
  const m = sturdy(g, 'ogre', spot);
  const starts = [];
  g.bus.on('combat:start', (e) => starts.push(e));
  const t0 = g.state.time;
  g.move(spot.x - p.x, spot.y - p.y);
  assert.equal(starts.length, 1, 'one fight began');
  assert.equal(starts[0].playerInitiated, true);
  assert.match(starts[0].announce, /^AN? .*OGRE!$/, `announced as "${starts[0].announce}"`);
  const blows = fight(g, m, 4);
  assert.ok(blows.length >= 6, `only ${blows.length} blows in 4 s`);
  const first = blows[0].t - t0;
  assert.ok(first >= B.combatOpening - 1e-6 && first < B.combatOpening + 0.1, `first blow ${first.toFixed(2)} s after the bump (standoff is ${B.combatOpening} s)`);
  blows.forEach((b, i) => assert.equal(b.by, i % 2 === 0 ? 'p' : 'm', `blow ${i + 1} was by ${b.by === 'p' ? 'the player' : 'the monster'}`));
  for (let i = 1; i < blows.length; i++) {
    const gap = blows[i].t - blows[i - 1].t;
    assert.ok(Math.abs(gap - B.combatTurnTime) < 0.05, `blows ${i} and ${i + 1} were ${gap.toFixed(2)} s apart, not ${B.combatTurnTime}`);
  }
  assert.ok(g.state.combat && g.state.combat.monsterId === m.id, 'the fight is still on');
});

test('an ambush is announced as ATTACKED BY, the monster swings first, and you cannot walk out of it', () => {
  const g = newGame(32);
  const p = g.player;
  const [spot] = freeNeighbours(g);
  const m = sturdy(g, 'ogre', spot);
  const starts = [];
  g.bus.on('combat:start', (e) => starts.push(e));
  g.monsterAttack(m);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].playerInitiated, false);
  assert.match(starts[0].announce, /^ATTACKED BY AN? .*OGRE!$/, `announced as "${starts[0].announce}"`);
  const before = { x: p.x, y: p.y };
  g.update(0.3);
  g.move(-(spot.x - p.x), -(spot.y - p.y));
  g.update(0.2);
  assert.deepEqual({ x: p.x, y: p.y }, before, 'walked out of an ambush');
  const blows = fight(g, m, 3);
  assert.ok(blows.length >= 4, `only ${blows.length} blows`);
  blows.forEach((b, i) => assert.equal(b.by, i % 2 === 0 ? 'm' : 'p', `blow ${i + 1} out of turn`));
});

test('hunting monsters keep close to walking pace: a little under it on level 1, level with it by the sword levels', () => {
  const player = 1 / BALANCE.classic.playerStepTime;
  assert.ok(monsterTilesPerSecond(1) >= 0.55 * player && monsterTilesPerSecond(1) < player, `level 1: ${monsterTilesPerSecond(1).toFixed(2)} tiles/s against the player's ${player}`);
  assert.ok(monsterTilesPerSecond(15) >= 0.93 * player, `level 15: ${monsterTilesPerSecond(15).toFixed(2)} tiles/s`);
  assert.ok(monsterTilesPerSecond(20) <= monsterTilesPerSecond(15) + 1e-9, 'it levels off rather than overtaking the hero forever');
  const g = newGame(12);
  const [spot] = freeNeighbours(g);
  const m = g.spawnMonster('ogre', spot.x, spot.y);
  assert.ok(Math.abs(m.speed - monsterTilesPerSecond(Math.max(1, g.depth)) * 0.8) < 1e-9, `a level-${g.depth} ogre moves at ${m.speed}`);
  const old = 1 / monsterPhaseSeconds(1);
  assert.ok(m.speed > 5 * old, 'at least five times the old one-tile-a-phase pace');
});

test('a second monster joining a fight lands at most one blow per exchange', () => {
  const g = newGame(33);
  const spots = freeNeighbours(g);
  assert.ok(spots.length >= 2, 'the start has two free neighbours');
  const a = sturdy(g, 'ogre', spots[0]);
  const b = sturdy(g, 'ogre', spots[1]);
  g.monsterAttack(a);
  let fromB = 0;
  g.bus.on('entity:attacked', (e) => { if (e.attacker.id === b.id) fromB++; });
  const seconds = 3, dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) { g.monsterAttack(b); g.update(dt); }   // asking every frame, far more often than it acts
  const exchange = 2 * g.balance.combatTurnTime;
  assert.ok(fromB >= 1, 'the flanker never struck');
  assert.ok(fromB <= Math.ceil(seconds / exchange) + 1, `the flanker struck ${fromB} times in ${seconds} s (one exchange is ${exchange} s)`);
});

test('monster abilities keep the old clock: cooldowns count monster phases, not the faster steps', () => {
  const g = newGame(44);
  const p = g.player;
  const spot = g.level.randomFloorTile(g.rngs.ai, { plainOnly: true, filter: (x, y) => Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) >= 10 });
  assert.ok(spot, 'a floor tile well away from the hero');
  const m = g.spawnMonster('ogre', spot.x, spot.y);
  m.state = 'asleep'; m.cooldowns = { blink: 3 };
  const phase = monsterPhaseSeconds(Math.max(1, g.depth));
  const dt = 1 / 30;
  for (let t = 0; t < 2.5 * phase; t += dt) g.update(dt);
  assert.ok(m.cooldowns.blink >= 1, `a 3-phase cooldown ran out within 2.5 phases (${(2.5 * phase).toFixed(1)} s)`);
  for (let t = 0; t < 0.8 * phase; t += dt) g.update(dt);
  assert.ok(!(m.cooldowns.blink > 0), 'the cooldown did not run out after 3.3 phases');
});

test('a fight moves the camera one whole texel closer, only when that step is slight, and back out after', async () => {
  // The frame is drawn on whole texel sizes (CLAUDE.md rule 2), so the "slight zoom in" for a fight is
  // one texel closer or nothing. A x1.18 multiplier, the first try, rounded back to the same texel size
  // at every real frame height and did nothing at all.
  const { CameraRig } = await import('../src/render/camera.js');
  const rig = new CameraRig(16 / 9);
  const texelAt = (px, fighting) => {
    rig.setViewportHeight(px);
    rig.setCombatFocus(fighting);
    for (let i = 0; i < 90; i++) rig.update(1 / 30);
    rig.place();
    return rig.texelSize;
  };
  // 1254 device px tall (a 1510x836 Safari window at the game's 1.5 pixel ratio) draws at texel 3
  assert.equal(texelAt(1254, false), 3);
  assert.equal(texelAt(1254, true), 4, 'a fight steps in one texel (x1.33)');
  assert.equal(texelAt(1254, false), 3, 'and steps back out when it ends');
  // 900 px draws at texel 2, where one texel closer would be x1.5: no zoom rather than a lurch
  assert.equal(texelAt(900, false), 2);
  assert.equal(texelAt(900, true), 2, 'a x1.5 jump is not a slight zoom');
});

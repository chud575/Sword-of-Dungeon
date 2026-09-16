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

test('hunting monsters close slowly on level 1 and reach walking pace by the sword levels — never faster than before', () => {
  // At 62% of walking pace from level 1 (the first cut of this), every monster reached you and struck
  // first. Level 1 is now ~37%; the curve rejoins the old straight line at level 15 and never runs
  // ahead of it, so no depth got faster and the deep game did not get slower.
  const player = 1 / BALANCE.classic.playerStepTime;
  const l1 = monsterTilesPerSecond(1);
  assert.ok(l1 >= 0.33 * player && l1 <= 0.42 * player, `level 1: ${l1.toFixed(2)} tiles/s against the player's ${player}`);
  assert.ok(1.5 * l1 < 0.7 * player, `a level-1 dire wolf (x1.5) moves at ${(1.5 * l1).toFixed(2)} tiles/s: catchable, but under walking pace`);
  assert.ok(monsterTilesPerSecond(15) >= 0.93 * player, `level 15: ${monsterTilesPerSecond(15).toFixed(2)} tiles/s`);
  assert.ok(monsterTilesPerSecond(20) <= monsterTilesPerSecond(15) + 1e-9, 'it levels off rather than overtaking the hero forever');
  const retiredLine = (d) => 6 * (0.62 + 0.33 * Math.max(0, Math.min(1, (d - 1) / 14)));
  for (let d = 1; d <= 25; d++) {
    assert.ok(monsterTilesPerSecond(d) <= retiredLine(d) + 1e-9, `level ${d} is faster than it used to be`);
    if (d >= 15) assert.ok(Math.abs(monsterTilesPerSecond(d) - retiredLine(d)) < 1e-9, `level ${d} is slower than it used to be`);
    if (d > 1) assert.ok(monsterTilesPerSecond(d) >= monsterTilesPerSecond(d - 1), `monsters get slower going from level ${d - 1} to ${d}`);
  }
  const g = newGame(12);
  const [spot] = freeNeighbours(g);
  const m = g.spawnMonster('ogre', spot.x, spot.y);
  assert.ok(Math.abs(m.speed - monsterTilesPerSecond(Math.max(1, g.depth)) * 0.8) < 1e-9, `a level-${g.depth} ogre moves at ${m.speed}`);
  const old = 1 / monsterPhaseSeconds(1);
  assert.ok(m.speed > 5 * old, 'at least five times the old one-tile-a-phase pace');
});

test('a second monster joining a fight lands at most one blow per monster phase', () => {
  const g = newGame(33);
  const spots = freeNeighbours(g);
  assert.ok(spots.length >= 2, 'the start has two free neighbours');
  const a = sturdy(g, 'ogre', spots[0]);
  const b = sturdy(g, 'ogre', spots[1]);
  g.monsterAttack(a);
  const times = [];
  g.bus.on('entity:attacked', (e) => { if (e.attacker.id === b.id) times.push(g.state.time); });
  const seconds = 7, dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) { g.monsterAttack(b); g.update(dt); }   // asking every frame, far more often than it acts
  const phase = monsterPhaseSeconds(Math.max(1, g.depth));
  assert.ok(times.length >= 2, `the flanker struck ${times.length} times in ${seconds} s`);
  assert.ok(times.length <= Math.floor(seconds / phase) + 1, `the flanker struck ${times.length} times in ${seconds} s (one phase is ${phase.toFixed(2)} s)`);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= phase - 1e-6, `flank blows ${(times[i] - times[i - 1]).toFixed(2)} s apart, under a phase`);
});

/** A hunting monster placed `d` tiles from the hero along a clear straight line, or null. */
function huntingAt(g, type, d) {
  const p = g.player, lv = g.level;
  for (const [dx, dy] of ORTHO) {
    let ok = true;
    for (let i = 1; i <= d && ok; i++) ok = lv.isWalkable(p.x + dx * i, p.y + dy * i) && !lv.entityAt(p.x + dx * i, p.y + dy * i) && !lv.isTemple(p.x + dx * i, p.y + dy * i);
    if (!ok) continue;
    const m = sturdy(g, type, { x: p.x + dx * d, y: p.y + dy * d });
    m.lastSeen = { x: p.x, y: p.y }; m.target = m.lastSeen; m.hadPrey = true;
    return m;
  }
  return null;
}

function watch(g) {
  const ev = { starts: [], winding: [], wake: [] };
  g.bus.on('combat:start', (e) => ev.starts.push({ t: g.state.time, ...e }));
  g.bus.on('monster:winding', (e) => ev.winding.push({ t: g.state.time, ...e }));
  g.bus.on('monster:wake', (e) => ev.wake.push({ t: g.state.time, ...e }));
  return ev;
}

test('a monster that arrives next to you winds up before its first blow; bump it inside the wind-up and the fight is yours', async () => {
  const { engageWindupSeconds } = await import('../src/game/monsterAi.js');
  const windup = engageWindupSeconds(1);
  assert.ok(windup >= 0.35 && windup <= 0.6, `level-1 wind-up is ${windup.toFixed(2)} s`);
  assert.ok(engageWindupSeconds(15) < 0.2 && engageWindupSeconds(15) > 0.05, 'and short by the sword levels');

  // Left alone, it closes, waits out the wind-up (announcing it), then attacks.
  let g = newGame(35);
  let ev = watch(g);
  let m = huntingAt(g, 'ogre', 3);
  assert.ok(m, 'a clear line of three tiles from the start');
  let arrived = null;
  for (let t = 0; t < 6 && !ev.starts.length; t += 1 / 60) {
    g.update(1 / 60);
    if (arrived === null && Math.max(Math.abs(m.x - g.player.x), Math.abs(m.y - g.player.y)) <= 1) arrived = g.state.time;
  }
  assert.ok(arrived !== null, 'the ogre never reached the hero');
  assert.equal(ev.starts.length, 1, 'the ogre never attacked');
  assert.equal(ev.starts[0].playerInitiated, false);
  assert.ok(ev.starts[0].t - arrived >= windup - 1 / 30 - 1e-9, `it struck ${(ev.starts[0].t - arrived).toFixed(2)} s after arriving (wind-up ${windup.toFixed(2)} s)`);
  assert.ok(ev.winding.some((w) => w.entity === m && w.t <= ev.starts[0].t), 'monster:winding was emitted before the attack');

  // The same approach, but the hero bumps it the moment it arrives: a fight he started, his blow first.
  g = newGame(35);
  ev = watch(g);
  m = huntingAt(g, 'ogre', 3);
  for (let t = 0; t < 6 && Math.max(Math.abs(m.x - g.player.x), Math.abs(m.y - g.player.y)) > 1; t += 1 / 60) g.update(1 / 60);
  assert.equal(ev.starts.length, 0, 'it attacked on the act that brought it next to the hero');
  g.update(0.1);
  assert.equal(ev.starts.length, 0, 'it attacked inside its wind-up');
  g.move(m.x - g.player.x, m.y - g.player.y);
  assert.equal(ev.starts.length, 1);
  assert.equal(ev.starts[0].playerInitiated, true, 'a bump during the wind-up is the hero\'s fight');
  const blows = fight(g, m, 2);
  assert.ok(blows.length >= 2 && blows[0].by === 'p', 'and the hero strikes first');
});

test('the wind-up resets when the monster is no longer next to you, holds a woken sleeper and a thief, and stops while paused', async () => {
  const { engageWindupSeconds } = await import('../src/game/monsterAi.js');
  const windup = engageWindupSeconds(1);

  // A sleeper that wakes next to you still winds up before it strikes.
  let g = newGame(36);
  let ev = watch(g);
  let [spot] = freeNeighbours(g);
  let m = sturdy(g, 'ogre', spot);
  m.state = 'asleep';
  for (let t = 0; t < 8 && !ev.starts.length; t += 1 / 60) g.update(1 / 60);
  assert.equal(ev.wake.length, 1, 'it woke');
  assert.equal(ev.starts.length, 1, 'and attacked');
  assert.ok(ev.starts[0].t - ev.wake[0].t >= windup - 1 / 30 - 1e-9, `it struck ${(ev.starts[0].t - ev.wake[0].t).toFixed(2)} s after waking`);

  // A rogue does not grab your gold the instant it reaches you.
  g = newGame(37);
  g.give('gold', 40);
  [spot] = freeNeighbours(g);
  m = sturdy(g, 'rogue', spot);
  g.update(windup * 0.5);
  assert.equal(g.player.gold, 40, 'the rogue stole inside its wind-up');
  g.update(1.5);
  assert.equal(g.player.gold, 0, 'the rogue still steals once the wind-up is over');

  // Stepping out of reach resets the clock, and a pause stops it.
  g = newGame(38);
  ev = watch(g);
  [spot] = freeNeighbours(g);
  m = sturdy(g, 'ogre', spot);
  g.update(0.1);
  const firstUntil = m.engageAt;
  assert.ok(firstUntil > g.state.time, 'the wind-up clock is running');
  const far = g.level.randomFloorTile(g.rngs.world, { plainOnly: true, filter: (x, y) => Math.max(Math.abs(x - g.player.x), Math.abs(y - g.player.y)) >= 8 && !g.level.entityAt(x, y) });
  assert.ok(far, 'somewhere well out of reach');
  m.x = far.x; m.y = far.y;   // lift it out of reach for a tick
  g.update(1 / 30);
  assert.equal(m.engageAt, null, 'out of reach, the clock resets');
  m.x = spot.x; m.y = spot.y; m.state = 'hunt';
  g.update(1 / 30);
  assert.ok(m.engageAt > firstUntil, 'back in reach, a fresh wind-up');
  const t0 = g.state.time;
  g.setPaused(true);
  g.update(1); g.update(1); g.update(1);
  assert.equal(g.state.time, t0, 'game time does not advance while paused (the auto-pause on sight cannot eat the wind-up)');
  assert.equal(ev.starts.length, 0, 'nothing struck during the pause');
  g.setPaused(false);
  for (let t = 0; t < 2 && !ev.starts.length; t += 1 / 60) g.update(1 / 60);
  assert.equal(ev.starts.length, 1, 'after the pause the ogre attacks');
  assert.ok(ev.starts[0].t >= m.engageAt - 1e-9);
});

test('stepping in and out of reach does not freeze a hunting monster: the wind-up gates its blow, not its acts', () => {
  // The first cut put the monster's next act back to the end of each wind-up. A hero stepping out of
  // reach and back every 0.4 s restarted the clock faster than the act could come, and a hunting werebear
  // stood still beside him for 300 seconds (found by the level-1 playtest harness: 705 wind-ups).
  const g = newGame(39);
  const p = g.player, lv = g.level;
  const home = { x: p.x, y: p.y };
  let pair = null;
  for (const [dx, dy] of ORTHO) {
    const m = { x: home.x + dx, y: home.y + dy }, out = { x: home.x - dx, y: home.y - dy };
    if (lv.isWalkable(m.x, m.y) && !lv.entityAt(m.x, m.y) && lv.isWalkable(out.x, out.y) && !lv.entityAt(out.x, out.y)) { pair = { m, out }; break; }
  }
  assert.ok(pair, 'the start has a tile for the monster and one to step back to');
  const m = sturdy(g, 'ogre', pair.m);
  let acted = 0, starts = 0;
  g.bus.on('entity:moved', (e) => { if (e.entity === m) acted++; });
  g.bus.on('combat:start', () => starts++);
  let atHome = true;
  for (let t = 0; t < 6 && !starts && !acted; t += 1 / 60) {
    if (Math.round(t * 60) % 12 === 0 && t > 0) {           // every 0.2 s: out, then back in
      const to = atHome ? pair.out : home;
      if (lv.entityAt(to.x, to.y)) break;
      g.teleportTo(to.x, to.y); atHome = !atHome;
    }
    g.update(1 / 60);
  }
  assert.ok(acted + starts > 0, 'the ogre neither moved nor attacked in 6 s of the hero dancing beside it');
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

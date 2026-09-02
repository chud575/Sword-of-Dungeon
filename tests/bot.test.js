import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/game.js';
import { EventBus } from '../src/core/events.js';
import { createRng } from '../src/core/rng.js';
import { SPELL_TYPES } from '../src/game/items.js';
import { TILE } from '../src/core/constants.js';

function botStep(g, rng) {
  const p = g.player, lv = g.level;
  const adjacent = g.visibleMonsters().find((m) => Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= 1);
  if (p.hp < p.maxHp * 0.3 && p.inventory.potion > 0 && rng.chance(0.5)) { g.useItem('potion'); return; }
  if (adjacent) { g.move(adjacent.x - p.x, adjacent.y - p.y); return; }
  const r = rng.next();
  if (r < 0.6) {
    const s = g.autoExplore();
    if (s) g.move(s.dx, s.dy); else g.move(rng.int(-1, 1), rng.int(-1, 1));
  } else if (r < 0.75) g.move(rng.int(-1, 1), rng.int(-1, 1));
  else if (r < 0.85) { if (lv.get(p.x, p.y) === TILE.STAIRS_DOWN || lv.isTemple(p.x, p.y) || lv.climbableAt(p.x, p.y)) g.interact(); else g.wait(); }
  else if (r < 0.9) g.castSpell(rng.pick(SPELL_TYPES));
  else if (r < 0.93) { const path = g.pathTo(lv.stairsDown.x, lv.stairsDown.y); if (path && path.length) g.move(path[0].x - p.x, path[0].y - p.y); }
  else if (r < 0.95) g.buryGold();
  else g.wait();
}

test('a headless bot plays 2000 steps on 5 seeds without throwing', () => {
  const seen = new Set();
  let games = 0, deaths = 0, deepest = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const bus = new EventBus();
    bus.on('*', (name) => seen.add(name));
    let g = new Game({ seed, bus });
    games++;
    const rng = createRng(seed * 7919);
    for (let i = 0; i < 2000; i++) {
      if (g.over) { deaths++; g = new Game({ seed: seed + 100 * games, bus }); games++; }
      if (i % 400 === 399 && !g.over) g.goToDepth(g.depth + 4);
      if (i % 700 === 699 && !g.over) { g.give('potion', 2); g.give('shield', 1); g.give('light', 1); g.give('invisibility', 1); }
      botStep(g, rng);
      g.update(0.15);
      deepest = Math.max(deepest, g.depth);
      assert.ok(g.level.entities.includes(g.player), 'player is on the level');
      assert.ok(Number.isFinite(g.player.hp));
    }
  }
  for (const ev of ['level:enter', 'entity:moved', 'entity:attacked', 'entity:died', 'player:hp', 'player:xp', 'player:gold', 'item:picked', 'log', 'combat:start'])
    assert.ok(seen.has(ev), `event ${ev} emitted`);
  assert.ok(deepest >= 10, `bot reached depth ${deepest}`);
});

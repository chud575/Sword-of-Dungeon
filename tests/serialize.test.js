import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/game.js';
import { EventBus } from '../src/core/events.js';
import { createRng } from '../src/core/rng.js';

function drive(g, rng, steps) {
  for (let i = 0; i < steps && !g.over; i++) {
    const r = rng.next();
    if (r < 0.6) { const s = g.autoExplore(); if (s) g.move(s.dx, s.dy); else g.move(rng.int(-1, 1), rng.int(-1, 1)); }
    else if (r < 0.8) g.move(rng.int(-1, 1), rng.int(-1, 1));
    else if (r < 0.9) g.interact();
    else g.wait();
    g.update(0.2);
  }
}

test('serialize/deserialize round-trips the whole game and stays deterministic afterwards', () => {
  const g = new Game({ seed: 11, bus: new EventBus() });
  drive(g, createRng(1), 300);
  g.goToDepth(3);
  drive(g, createRng(2), 100);
  const snap = g.serialize();
  const json = JSON.stringify(snap);
  const g2 = Game.deserialize(json, { bus: new EventBus() });
  assert.deepEqual(g2.serialize(), JSON.parse(json));
  assert.equal(g2.levels.size, g.levels.size);
  assert.equal(g2.level.entities.filter((e) => e.kind === 'player').length, 1);
  assert.equal(g2.player, g2.state.player);
  // both continue identically under identical inputs
  drive(g, createRng(3), 150);
  drive(g2, createRng(3), 150);
  assert.equal(JSON.stringify(g2.serialize()), JSON.stringify(g.serialize()));
  assert.ok(g.state.time > 0);
});

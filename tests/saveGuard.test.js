// saveGuard: the game built at boot (behind the title screen) is a placeholder, and nothing may save it over a real quest.
// Regression: the title menu pauses that game, a pause autosaves, and every page load replaced the player's save with
// an empty level-1 hero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveGame } from '../src/core/save.js';
import { Lifecycle } from '../src/core/lifecycle.js';

const fakeGame = (placeholder) => {
  const g = { placeholder, over: false, paused: false, serialized: 0, balance: { name: 'classic' }, seed: 1, depth: 1,
    player: { level: 1, hp: 3, maxHp: 3, xp: 0, kills: 0 }, state: { elapsed: 0, deepest: 1 } };
  g.serialize = () => { g.serialized++; return {}; };
  g.setPaused = (p) => { g.paused = p; };
  return g;
};
const bus = { on: () => () => {} };

test('saveGame refuses a placeholder without even serializing it', () => {
  const g = fakeGame(true);
  assert.equal(saveGame(g), false);
  assert.equal(g.serialized, 0);
});

test('no lifecycle save path writes a placeholder: pause, hidden tab, periodic, unload, manual', () => {
  const g = fakeGame(true);
  const lc = new Lifecycle({ bus, getGame: () => g, getSettings: () => ({ autosaveInterval: 1 }) });
  assert.equal(lc.autoSave('pause'), false);
  assert.equal(lc.saveNow('manual'), false);
  lc.hidden();
  lc.update(5);
  assert.equal(g.serialized, 0);
  assert.equal(g.paused, false, 'a hidden tab does not pause the boot game either');
});

test('a real game still goes through the save path', () => {
  const g = fakeGame(false);
  const lc = new Lifecycle({ bus, getGame: () => g, getSettings: () => ({}) });
  lc.saveNow('manual');
  assert.equal(g.serialized, 1);
});

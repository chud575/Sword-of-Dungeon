import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, seedFrom, hashString, normalizeSeed } from '../src/core/rng.js';

test('rng is deterministic for a seed and restores from state', () => {
  const a = createRng(123), b = createRng(123);
  const xs = Array.from({ length: 50 }, () => a.next());
  const ys = Array.from({ length: 50 }, () => b.next());
  assert.deepEqual(xs, ys);
  const state = a.getState();
  const after = Array.from({ length: 10 }, () => a.next());
  const c = createRng(0); c.setState(state);
  assert.deepEqual(Array.from({ length: 10 }, () => c.next()), after);
});

test('int/pick/chance/shuffle stay in range', () => {
  const r = createRng('hello');
  for (let i = 0; i < 2000; i++) { const v = r.int(3, 7); assert.ok(v >= 3 && v <= 7 && Number.isInteger(v)); }
  for (let i = 0; i < 200; i++) { const v = r.next(); assert.ok(v >= 0 && v < 1); }
  assert.ok([1, 2, 3].includes(r.pick([1, 2, 3])));
  assert.equal(r.pick([]), undefined);
  const arr = r.shuffle([1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...arr].sort(), [1, 2, 3, 4, 5, 6]);
  let hits = 0; for (let i = 0; i < 5000; i++) if (r.chance(0.3)) hits++;
  assert.ok(hits > 1300 && hits < 1700, `chance(0.3) hit ${hits}/5000`);
});

test('forks and seed helpers are deterministic and distinct', () => {
  const a = createRng(9).fork('x'), b = createRng(9).fork('x'), c = createRng(9).fork('y');
  assert.equal(a.next(), b.next());
  assert.notEqual(a.next(), c.next());
  assert.equal(seedFrom(1, 'level', 3), seedFrom(1, 'level', 3));
  assert.notEqual(seedFrom(1, 'level', 3), seedFrom(1, 'level', 4));
  assert.equal(hashString('abc'), hashString('abc'));
  assert.equal(normalizeSeed('42'), 42);
  assert.equal(normalizeSeed(42.9), 42);
});

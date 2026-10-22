// Full random games, start to finish, for every player count. Every action is
// checked against the invariants in helpers.ts (gold limits, every card in
// exactly one place, one King in the King's seat, role-correct hands...).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playRandomGame } from './helpers.js';

for (let n = 4; n <= 8; n++) {
  test(`random ${n}-player games run to a winner without breaking any invariant`, () => {
    for (let seed = 1; seed <= 12; seed++) {
      const g = playRandomGame(n, seed);
      assert.equal(g.phase, 'over');
      assert.equal(g.round, 4);
      assert.equal(g.winner, g.seats[g.kingSeat], 'the winner is whoever is King at the end');
    }
  });
}

test('random games also finish with continuous crown checks and physical dice timing out', () => {
  for (let seed = 1; seed <= 6; seed++) playRandomGame(6, seed, { kingCheck: 'continuous' });
});

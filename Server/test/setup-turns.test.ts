import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createGame, tick } from '../src/game/engine.js';
import { viewFor } from '../src/game/view.js';
import { T0, act, fails, give, king, newGame, nobles } from './helpers.js';

describe('setup (Rules p5-p9)', () => {
  test('supports exactly 4-8 players', () => {
    const mk = (n: number) => () => createGame(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` })), { seed: 1, now: T0 });
    assert.throws(mk(3));
    assert.throws(mk(9));
    for (let n = 4; n <= 8; n++) assert.doesNotThrow(mk(n));
  });

  for (let n = 4; n <= 8; n++) {
    test(`${n} players: one King with 1000, Nobles with 600, 8 cards each from their own deck`, () => {
      const g = newGame(n, { seed: n });
      const roles = Object.values(g.players).map((p) => p.role);
      assert.equal(roles.filter((r) => r === 'king').length, 1);
      for (const p of Object.values(g.players)) {
        assert.equal(p.gold, p.role === 'king' ? 1000 : 600);
        assert.equal(p.hand.length, 8);
        for (const id of p.hand) assert.equal(g.cards[id].deck, p.role);
      }
      assert.equal(g.decks.king.length, 25 - 8);
      assert.equal(g.decks.noble.length, 74 - 8 * (n - 1));
    });
  }

  test('the King card goes to a random seat', () => {
    const seats = new Set(Array.from({ length: 30 }, (_, s) => newGame(6, { seed: s + 1 }).kingSeat));
    assert.ok(seats.size >= 4, `King seats seen: ${[...seats]}`);
  });

  test('card ids do not reveal what a card is', () => {
    const a = newGame(5, { seed: 1 });
    const b = newGame(5, { seed: 2 });
    const keysA = Object.fromEntries(Object.values(a.cards).map((c) => [c.id, c.key]));
    const same = Object.values(b.cards).filter((c) => keysA[c.id] === c.key).length;
    assert.ok(same < 15, `${same} card ids mapped to the same card in two games`);
  });
});

describe('turns and rounds (Rules p8, p11-p14)', () => {
  test('the King goes first, then the next seats clockwise in round 1', () => {
    const g = newGame(5, { seed: 3 });
    assert.equal(g.turn!.playerId, king(g));
    const order = g.turnOrder;
    for (let i = 0; i < 5; i++) assert.equal(order[i], (g.kingSeat + i) % 5);
  });

  test('King plays 3 cards (2 when there are only 3 Nobles); Nobles play 2', () => {
    assert.equal(newGame(4).turn!.allowance, 2);
    assert.equal(newGame(5).turn!.allowance, 3);
    assert.equal(newGame(8).turn!.allowance, 3);
  });

  test('playing your cards ends the turn, draws the same number back to 8, and passes to the next seat', () => {
    let g = newGame(5, { seed: 4 });
    const k = king(g);
    const cards = ['king:loyal_dog', 'king:loyal_dog', 'king:loyal_dog'].map(() => give(g, k, 'king:loyal_dog'));
    void cards;
    const target = nobles(g)[0];
    for (let i = 0; i < 3; i++) {
      const id = g.players[k].hand.find((c) => g.cards[c].key === 'king:loyal_dog')!;
      g = act(g, k, { type: 'play', cardId: id, setup: { target, amount: '100' } });
      // the pledge prompt
      g = act(g, target, { type: 'respond', promptId: g.resolution!.prompt!.id, response: { text: '' } });
    }
    assert.equal(g.players[k].hand.length, 8);
    assert.equal(g.turn!.playerId, g.seats[(g.kingSeat + 1) % 5]);
  });

  test("you can't play out of turn or end your turn while you still have playable cards", () => {
    const g = newGame(5);
    const noble = nobles(g).find((id) => id !== g.turn!.playerId)!;
    fails(g, noble, { type: 'play', cardId: g.players[noble].hand[0] }, /isn't your turn/);
    fails(g, king(g), { type: 'endTurn' }, /still have cards/);
  });

  test('after every seat has played, the timed Negotiation Phase starts; when it ends, round 2 runs counter-clockwise', () => {
    let g = newGame(4, { seed: 5, config: { negotiationMs: 120_000 } });
    // everyone places face-down cards to get through the round quickly
    while (g.phase === 'playing') {
      const pid = g.turn!.playerId;
      const v = viewFor(g, pid);
      const c = v.hand.find((h) => h.place.ok)!;
      g = act(g, pid, { type: 'place', cardId: c.id, targetId: c.place.targets[0] });
    }
    assert.equal(g.phase, 'negotiation');
    assert.equal(g.negotiation!.endsAt, T0 + 120_000);
    assert.equal(tick(g, T0 + 60_000), null, 'nothing happens before the timer runs out');
    g = tick(g, T0 + 120_000)!;
    assert.equal(g.round, 2);
    assert.equal(g.phase, 'playing');
    assert.equal(g.direction, -1);
    assert.equal(g.turn!.playerId, king(g));
    assert.equal(g.turnOrder[1], (g.kingSeat + 3) % 4, 'second seat is counter-clockwise from the King');
  });

  test('after round 4 whoever is King wins — not whoever has the most gold', () => {
    let g = newGame(4, { seed: 6 });
    const rich = nobles(g)[0];
    g.players[rich].gold = 1000; // equal to the King: not more, so no crown
    let now = T0;
    for (let round = 1; round <= 4; round++) {
      while (g.phase === 'playing') {
        const pid = g.turn!.playerId;
        const c = viewFor(g, pid).hand.find((h) => h.place.ok)!;
        g = act(g, pid, { type: 'place', cardId: c.id, targetId: c.place.targets[0] }, now);
      }
      now = g.negotiation!.endsAt;
      g = tick(g, now)!;
    }
    assert.equal(g.phase, 'over');
    assert.equal(g.winner, king(g));
    assert.notEqual(g.winner, rich);
  });
});

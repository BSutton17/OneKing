// Players who are gone (A17): removed by the host for good, or away (offline
// for a while) and so no longer needed to overrule a spoken line (C20).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { removePlayer, setAway, tick } from '../src/game/engine.js';
import type { GameState, PlayerId } from '../src/game/types.js';
import { viewFor } from '../src/game/view.js';
import { T0, act, checkInvariants, fails, give, king, newGame, nobles } from './helpers.js';

function remove(g: GameState, pid: PlayerId): GameState {
  const r = removePlayer(g, pid, T0);
  if (!r.ok) throw new Error(r.error);
  checkInvariants(r.state);
  return r.state;
}

function placeOne(g: GameState): GameState {
  const pid = g.turn!.playerId;
  const c = viewFor(g, pid).hand.find((h) => h.place.ok)!;
  return act(g, pid, { type: 'place', cardId: c.id, targetId: c.place.targets[0] });
}

const prompt = (g: GameState) => g.resolution!.prompt!;

describe('the host removes a player', () => {
  test('a removed Noble: cards, gold and effects go, their turns are skipped, nobody can pick them, and they can no longer act', () => {
    let g = newGame(5);
    const k = king(g);
    const gone = nobles(g)[1];
    g = act(g, k, { type: 'place', cardId: g.players[k].hand[0], targetId: gone });
    g.statuses.push({ id: 'bb', kind: 'badBlood', owner: nobles(g)[0], a: gone, b: nobles(g)[2] });
    g = remove(g, gone);
    const p = g.players[gone];
    assert.equal(p.out, true);
    assert.equal(p.hand.length, 0);
    assert.equal(p.gold, 0);
    assert.equal(g.faceDown.filter((f) => f.protectedId === gone).length, 0, 'the Knight guarding them is discarded');
    assert.equal(g.statuses.length, 0, 'the Bad Blood involving them is over');
    assert.ok(g.log.some((e) => /P\d has been removed from the game/.test(e.text)));
    assert.ok(!viewFor(g, k).hand.some((h) => h.place.targets.includes(gone)), 'the King can no longer protect them');
    fails(g, gone, { type: 'overrule', claimId: 'x', vote: true }, /removed/);

    const turns = new Set<PlayerId>();
    while (g.phase === 'playing') {
      turns.add(g.turn!.playerId);
      g = placeOne(g);
    }
    assert.equal(turns.has(gone), false, 'their turn was skipped');
    assert.equal(turns.size, 4);
    fails(g, nobles(g)[0], { type: 'offer', to: gone, giveGold: 100 }, /another player/);
  });

  test('a removed King: the richest Noble takes the crown', () => {
    let g = newGame(5);
    const k = king(g);
    const rich = nobles(g)[2];
    g.players[rich].gold = 900;
    g = remove(g, k);
    assert.equal(king(g), rich);
    assert.equal(g.players[k].role, 'noble');
    assert.equal(g.players[k].hand.length + g.players[k].gold, 0);
    assert.equal(g.players[rich].hand.length, 8);
  });

  test('a removed King with two Nobles tied for the most gold: they roll off', () => {
    let g = newGame(5);
    const [a, b] = nobles(g);
    g.players[a].gold = 900;
    g.players[b].gold = 900;
    g = remove(g, king(g));
    assert.equal(g.resolution?.kind, 'rolloff');
    assert.deepEqual([...prompt(g).who].sort(), [a, b].sort());
  });

  test('whatever they still had to answer is answered at once with the defaults; the King waits for the card to finish', () => {
    let g = newGame(5);
    const k = king(g);
    const [, target, gone] = nobles(g);
    g = act(g, k, { type: 'play', cardId: give(g, k, 'king:snakes'), setup: { target } });
    assert.ok(prompt(g).who.includes(gone));
    assert.match((removePlayer(g, k, T0) as { error: string }).error, /current card/);
    g = remove(g, gone);
    assert.deepEqual(prompt(g).responses[gone], { kind: 'vote', yes: false });
    assert.ok(g.log.some((e) => e.text.endsWith('has left the game (counted as no)')));
    assert.ok(g.players[gone].hand.length > 0, 'their cards wait until the card is resolved');
    for (const pid of prompt(g).who.filter((id) => !prompt(g).responses[id])) g = act(g, pid, { type: 'respond', promptId: prompt(g).id, response: { yes: false } });
    assert.equal(g.resolution, null);
    assert.equal(g.players[gone].hand.length, 0);
  });

  test('offers to and from them are withdrawn; at least 3 players have to stay', () => {
    let g = newGame(4);
    while (g.phase === 'playing') g = placeOne(g);
    const [a, b, c] = nobles(g);
    g = act(g, a, { type: 'offer', to: b, giveGold: 100 });
    g = act(g, c, { type: 'offer', to: a, giveGold: 100 });
    g = remove(g, a);
    assert.equal(g.negotiation!.offers.length, 0);
    assert.match((removePlayer(g, b, T0) as { error: string }).error, /At least 3/);
    assert.match((removePlayer(g, a, T0) as { error: string }).error, /already left/);
    g = tick(g, g.negotiation!.endsAt)!;
    assert.equal(g.round, 2);
  });
});

describe('players who are away (offline for a while)', () => {
  function loyalDog() {
    let g = newGame(5, { seed: 91, config: { mode: 'inPerson', diceMode: 'physical' } });
    const k = king(g);
    const dog = nobles(g)[0];
    g = act(g, k, { type: 'play', cardId: give(g, k, 'king:loyal_dog'), setup: { target: dog, amount: '300' } });
    g = act(g, dog, { type: 'respond', promptId: prompt(g).id, response: { value: 'say' } });
    return { g, k, dog, id: g.claims.at(-1)!.id };
  }

  test("an away player doesn't hold up an overrule; once they're back they count again", () => {
    let { g, dog, id } = loyalDog();
    const [gone, ...rest] = g.seats.filter((x) => x !== dog);
    g = setAway(g, [gone], T0)!;
    assert.equal(setAway(g, [gone], T0), null, 'nothing changed');
    assert.ok(!viewFor(g, dog).claims[0].voters.includes(gone));
    g = setAway(g, [], T0)!;
    for (const pid of rest) g = act(g, pid, { type: 'overrule', claimId: id, vote: true });
    assert.ok(g.claims[0].open, 'still waiting for the player who came back');
    g = setAway(g, [gone], T0)!;
    assert.ok(g.claims[0].overruled, 'with them away, everyone else agreeing is enough');
    assert.equal(g.players[dog].gold, 600);
  });

  test('with everyone else away, nothing is overruled', () => {
    let { g, dog } = loyalDog();
    g = setAway(g, g.seats.filter((x) => x !== dog), T0)!;
    assert.ok(g.claims[0].open);
    assert.equal(g.players[dog].gold, 900);
  });
});

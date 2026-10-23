// Spoken lines in person (C20): tapping "I said it" is a claim the rest of the
// table can overrule — unanimously, before the round ends.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { tick } from '../src/game/engine.js';
import type { GameState, PlayerId } from '../src/game/types.js';
import { viewFor } from '../src/game/view.js';
import { act, fails, give, king, newGame, nobles } from './helpers.js';

const inPerson = (n = 5, seed = 91) => newGame(n, { seed, config: { mode: 'inPerson', diceMode: 'physical' } });
const prompt = (g: GameState) => g.resolution!.prompt!;
const respond = (g: GameState, pid: string, response: unknown) => act(g, pid, { type: 'respond', promptId: prompt(g).id, response });
const overrule = (g: GameState, pid: PlayerId, claimId: string, vote = true) => act(g, pid, { type: 'overrule', claimId, vote });
const lastClaim = (g: GameState) => g.claims.at(-1)!;

function placeOne(g: GameState): GameState {
  const pid = g.turn!.playerId;
  const c = viewFor(g, pid).hand.find((h) => h.place.ok)!;
  return act(g, pid, { type: 'place', cardId: c.id, targetId: c.place.targets[0] });
}

/** King plays Loyal Dog for 300 on the first Noble, who says they said the line. */
function loyalDog(): { g: GameState; k: PlayerId; dog: PlayerId } {
  let g = inPerson();
  const k = king(g);
  const dog = nobles(g)[0];
  g = act(g, k, { type: 'play', cardId: give(g, k, 'king:loyal_dog'), setup: { target: dog, amount: '300' } });
  g = respond(g, dog, { value: 'say' });
  return { g, k, dog };
}

describe('overruling a spoken line (in person)', () => {
  test('the claimed line is in the log with a claim everyone can see', () => {
    const { g, dog } = loyalDog();
    assert.equal(g.players[dog].gold, 900);
    const c = lastClaim(g);
    assert.equal(c.by, dog);
    assert.ok(c.open);
    const entry = g.log.find((e) => e.claimId === c.id)!;
    assert.match(entry.text, /pledged their loyalty/);
    const seen = viewFor(g, nobles(g)[2]).claims.find((x) => x.id === c.id)!;
    assert.deepEqual([...seen.voters].sort(), g.seats.filter((id) => id !== dog).sort(), 'everyone but the speaker decides');
  });

  test('it takes every other player — the King included — to overrule; then the reward goes back', () => {
    let { g, k, dog } = loyalDog();
    const id = lastClaim(g).id;
    const rest = g.seats.filter((x) => x !== dog && x !== k);
    for (const pid of rest) g = overrule(g, pid, id);
    assert.equal(g.players[dog].gold, 900, 'not unanimous yet');
    assert.ok(lastClaim(g).open);
    g = overrule(g, k, id);
    assert.equal(g.players[dog].gold, 600, 'the 300 went back to the bank');
    assert.ok(lastClaim(g).overruled);
    assert.ok(g.log.some((e) => /The table overrules/.test(e.text)));
    fails(g, k, { type: 'overrule', claimId: id, vote: false }, /no longer/);
  });

  test('the speaker cannot vote, a vote can be taken back, and the round ending closes the claim', () => {
    let { g, k, dog } = loyalDog();
    const id = lastClaim(g).id;
    fails(g, dog, { type: 'overrule', claimId: id, vote: true }, /yourself/);
    const [a, b, c] = g.seats.filter((x) => x !== dog && x !== k);
    g = overrule(g, a, id);
    g = overrule(g, a, id, false);
    assert.deepEqual(lastClaim(g).votes, []);
    for (const pid of [b, c, k]) g = overrule(g, pid, id);
    while (g.phase === 'playing') g = placeOne(g);
    g = tick(g, g.negotiation!.endsAt)!;
    assert.equal(g.round, 2);
    assert.equal(lastClaim(g).open, false);
    fails(g, a, { type: 'overrule', claimId: id, vote: true }, /no longer/);
    assert.equal(g.players[dog].gold >= 900, true, 'it stood');
  });

  test('Royal Parrot and Bend the Knee: overruled means the 300 penalty is paid', () => {
    let g = inPerson(5, 92);
    const k = king(g);
    const [parrot, kneeler] = nobles(g);
    g = act(g, k, { type: 'play', cardId: give(g, k, 'king:royal_parrot'), setup: { target: parrot } });
    g = respond(g, parrot, { value: 'repeat' });
    assert.equal(g.players[parrot].gold, 500);
    const pc = lastClaim(g).id;
    for (const pid of g.seats.filter((x) => x !== parrot)) g = overrule(g, pid, pc);
    assert.equal(g.players[parrot].gold, 200);

    g = act(g, k, { type: 'play', cardId: give(g, k, 'king:bend_the_knee'), setup: { target: kneeler } });
    g = respond(g, kneeler, { value: 'thank' });
    const kc = lastClaim(g).id;
    for (const pid of g.seats.filter((x) => x !== kneeler)) g = overrule(g, pid, kc);
    assert.equal(g.players[kneeler].gold, 300);
  });

  test('Council Meeting: overruled praise loses the two cards drawn', () => {
    let g = inPerson(5, 93);
    while (g.players[g.turn!.playerId].role === 'king') g = placeOne(g);
    const me = g.turn!.playerId;
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:council_meeting'), option: 1, setup: {} });
    const before = [...g.players[me].hand];
    g = respond(g, me, { value: 'praise' });
    const drawn = g.players[me].hand.filter((id) => !before.includes(id));
    assert.equal(drawn.length, 2);
    const id = lastClaim(g).id;
    for (const pid of g.seats.filter((x) => x !== me)) g = overrule(g, pid, id);
    assert.ok(drawn.every((c) => !g.players[me].hand.includes(c)), 'the drawn cards are discarded');
    assert.ok(drawn.every((c) => g.discard.noble.includes(c)));
  });

  test('an overrule that completes mid-card waits until the card is resolved', () => {
    let { g, k, dog } = loyalDog();
    const id = lastClaim(g).id;
    const rest = g.seats.filter((x) => x !== dog && x !== k);
    for (const pid of rest) g = overrule(g, pid, id);
    g = act(g, k, { type: 'play', cardId: give(g, k, 'king:snakes'), setup: { target: nobles(g)[1] } });
    g = overrule(g, k, id);
    assert.ok(lastClaim(g).open, 'still waiting on the Snakes vote');
    assert.equal(g.players[dog].gold, 900);
    for (const pid of prompt(g).who) g = respond(g, pid, { yes: false });
    assert.ok(lastClaim(g).overruled);
    assert.equal(g.players[dog].gold, 600);
  });

  test('refusing makes no claim, and virtual games (the line is posted for you) have nothing to dispute', () => {
    let g = inPerson();
    const k = king(g);
    g = act(g, k, { type: 'play', cardId: give(g, k, 'king:loyal_dog'), setup: { target: nobles(g)[0], amount: '100' } });
    g = respond(g, nobles(g)[0], { value: 'refuse' });
    assert.equal(g.claims.length, 0);

    let v = newGame(5, { seed: 91 });
    const vk = king(v);
    v = act(v, vk, { type: 'play', cardId: give(v, vk, 'king:loyal_dog'), setup: { target: nobles(v)[0], amount: '100' } });
    v = respond(v, nobles(v)[0], { value: 'say' });
    assert.equal(v.claims.length, 0);
  });
});

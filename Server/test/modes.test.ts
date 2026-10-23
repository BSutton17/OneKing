// In person vs virtual: what changes (spoken lines, the parrot's sentence) and
// what doesn't (votes, choices that cost gold, the rules of trading).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { GameState } from '../src/game/types.js';
import { viewFor } from '../src/game/view.js';
import { act, give, king, newGame, nobles } from './helpers.js';

const inPerson = (n = 5, seed = 81) => newGame(n, { seed, config: { mode: 'inPerson', diceMode: 'physical' } });
const prompt = (g: GameState) => g.resolution!.prompt!;

/** Finish the King's turn with face-down cards so a Noble is up. */
function toNobleTurn(g: GameState): GameState {
  while (g.players[g.turn!.playerId].role === 'king') {
    const pid = g.turn!.playerId;
    const c = viewFor(g, pid).hand.find((h) => h.place.ok)!;
    g = act(g, pid, { type: 'place', cardId: c.id, targetId: c.place.targets[0] });
  }
  return g;
}

describe('in-person mode', () => {
  test('spoken cards with nothing riding on them show an instruction to everyone and do not wait', () => {
    let g = inPerson();
    const k = king(g);
    g = toNobleTurn(g);
    const me = g.turn!.playerId;
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:actors'), option: 0, setup: {} });
    assert.equal(g.resolution, null, 'resolved at once');
    const say = g.log.filter((e) => e.kind === 'say').at(-1)!;
    assert.match(say.text, /must thank/);
    assert.equal(viewFor(g, nobles(g)[2]).log.at(-1)!.text, say.text, 'everyone sees it');
    void k;
  });

  test('Loyal Dog pays only once the line is said — the Noble can refuse and get nothing', () => {
    let g = inPerson();
    const k = king(g);
    const [a, b] = nobles(g);
    g = act(g, k, { type: 'play', cardId: give(g, k, 'king:loyal_dog'), setup: { target: a, amount: '200' } });
    assert.equal(prompt(g).kind, 'choice');
    assert.deepEqual(prompt(g).who, [a]);
    assert.match(prompt(g).text, /Say out loud: “Thank you my king/);
    assert.equal(g.players[a].gold, 600, 'nothing paid yet');
    g = act(g, a, { type: 'respond', promptId: prompt(g).id, response: { value: 'say' } });
    assert.equal(g.players[a].gold, 800);
    g = act(g, k, { type: 'play', cardId: give(g, k, 'king:loyal_dog'), setup: { target: b, amount: '300' } });
    g = act(g, b, { type: 'respond', promptId: prompt(g).id, response: { value: 'refuse' } });
    assert.equal(g.players[b].gold, 600, 'refused: no gold');
  });

  test("the Royal Parrot's sentence is spoken by the King, not typed — refusing still costs 300", () => {
    let g = inPerson();
    const k = king(g);
    const n = nobles(g)[0];
    const card = give(g, k, 'king:royal_parrot');
    const fields = viewFor(g, k).hand.find((h) => h.id === card)!.play.options[0].fields;
    assert.deepEqual(fields.map((f) => f.name), ['target']);
    g = act(g, k, { type: 'play', cardId: card, setup: { target: n } });
    assert.match(prompt(g).text, /out loud/);
    g = act(g, n, { type: 'respond', promptId: prompt(g).id, response: { value: 'refuse' } });
    assert.equal(g.players[n].gold, 200, '-100 then -300');
  });

  test('votes stay buttons in person (they change the game)', () => {
    let g = inPerson();
    const k = king(g);
    g = act(g, k, { type: 'play', cardId: give(g, k, 'king:snakes'), setup: { target: nobles(g)[0] } });
    assert.equal(prompt(g).kind, 'vote');
  });

  test('virtual mode asks for the typed line instead', () => {
    let g = toNobleTurn(newGame(5, { seed: 81 }));
    const me = g.turn!.playerId;
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:actors'), option: 0, setup: {} });
    assert.equal(prompt(g).kind, 'speech');
  });
});

describe('trades in both modes', () => {
  test('the card offered in a swap stays face down until the swap happens (players can lie)', () => {
    let g = inPerson(4, 82);
    while (g.phase === 'playing') {
      const pid = g.turn!.playerId;
      const c = viewFor(g, pid).hand.find((h) => h.place.ok)!;
      g = act(g, pid, { type: 'place', cardId: c.id, targetId: c.place.targets[0] });
    }
    const [a, b] = nobles(g);
    const mine = g.players[a].hand[0];
    g = act(g, a, { type: 'offer', to: b, giveCard: mine, askCard: true });
    assert.equal(viewFor(g, a).negotiation!.offers[0].giveCardKey, g.cards[mine].key, 'the proposer sees their own card');
    assert.equal(viewFor(g, b).negotiation!.offers[0].giveCardKey, null, 'the other player does not');
    g = act(g, b, { type: 'acceptOffer', offerId: g.negotiation!.offers[0].id, cardId: g.players[b].hand[0] });
    assert.ok(g.players[b].hand.includes(mine));
    assert.ok(viewFor(g, b).log.some((e) => e.kind === 'private' && e.text.startsWith('You received')));
  });
});

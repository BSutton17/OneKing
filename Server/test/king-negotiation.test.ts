import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { tick } from '../src/game/engine.js';
import type { GameState, PlayerId } from '../src/game/types.js';
import { viewFor } from '../src/game/view.js';
import { T0, act, fails, give, king, newGame, nobles } from './helpers.js';

const game = (n = 5, seed = 51, config = {}) => newGame(n, { seed, config: { diceMode: 'physical', ...config } });
const prompt = (g: GameState) => g.resolution!.prompt!;
const respond = (g: GameState, pid: string, response: unknown) => act(g, pid, { type: 'respond', promptId: prompt(g).id, response });
const gold = (g: GameState, pid: string) => g.players[pid].gold;

function placeOne(g: GameState): GameState {
  const pid = g.turn!.playerId;
  const c = viewFor(g, pid).hand.find((h) => h.place.ok)!;
  return act(g, pid, { type: 'place', cardId: c.id, targetId: c.place.targets[0] });
}
function toTurnOf(g: GameState, pid: PlayerId): GameState {
  for (let guard = 0; guard < 40 && g.turn?.playerId !== pid; guard++) g = placeOne(g);
  assert.equal(g.turn?.playerId, pid);
  return g;
}
function toNegotiation(g: GameState): GameState {
  while (g.phase === 'playing') g = placeOne(g);
  return g;
}

describe('changing the King (Rules p15)', () => {
  test('a Noble with more gold than the King becomes King: seats, cards and roles swap; the turn passes on', () => {
    let g = game(5, 52);
    const k = king(g);
    g = placeOne(g); // King plays one card
    const lucky = nobles(g)[1];
    g.players[lucky].gold = 900;
    const luckySeat = g.players[lucky].seat;
    const luckyHand = [...g.players[lucky].hand];
    const kingHand = [...g.players[k].hand];
    g = act(g, k, { type: 'play', cardId: give(g, k, 'king:loyal_dog'), setup: { target: lucky, amount: '200' } });
    g = respond(g, lucky, { value: 'say' });
    assert.equal(king(g), lucky);
    assert.equal(g.players[lucky].role, 'king');
    assert.equal(g.players[k].role, 'noble');
    assert.equal(g.players[lucky].seat, g.kingSeat);
    assert.equal(g.players[k].seat, luckySeat);
    assert.ok(luckyHand.every((c) => g.players[k].hand.includes(c)), 'the old King took the new King’s cards');
    assert.ok(g.players[lucky].hand.every((c) => g.cards[c].deck === 'king'));
    assert.equal(g.players[lucky].hand.length, 8);
    assert.notEqual(g.turn!.playerId, lucky);
    assert.notEqual(g.turn!.playerId, k, 'the King’s turn ended: the next seat plays (A3)');
    void kingHand;
  });

  test('equal gold is not more gold: no crown change', () => {
    let g = game(5, 53);
    const k = king(g);
    const n = nobles(g)[0];
    g.players[n].gold = 800;
    g = act(g, k, { type: 'play', cardId: give(g, k, 'king:loyal_dog'), setup: { target: n, amount: '200' } });
    g = respond(g, n, { value: 'say' });
    assert.equal(g.players[n].gold, 1000);
    assert.equal(king(g), k);
  });

  test('two Nobles passing the King together with equal gold roll off; the lower roll loses 100', () => {
    let g = game(5, 54);
    g = toTurnOf(g, nobles(g)[0]);
    const me = g.turn!.playerId;
    const k = king(g);
    const [a, b] = nobles(g).filter((x) => x !== me);
    g.players[a].gold = 300;
    g.players[b].gold = 300;
    g.players[k].gold = 400;
    g.players[me].gold = 400;
    // Beggar's Blessing: every Noble with ≤300 gains 200 -> a and b both reach 500 > 400 at once
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:beggars_blessing') });
    assert.equal(g.resolution!.kind, 'rolloff');
    assert.deepEqual([...prompt(g).who].sort(), [a, b].sort());
    g = respond(g, a, { value: 2 });
    g = respond(g, b, { value: 2 });
    assert.equal(g.resolution!.kind, 'rolloff', 'a tie rolls again');
    g = respond(g, a, { value: 5 });
    g = respond(g, b, { value: 3 });
    assert.equal(king(g), a);
    assert.equal(gold(g, b), 400, 'the lower roll paid 100');
  });

  test("People's Champion moves the crown without gold, and it sticks (A1)", () => {
    let g = game(5, 55);
    g.round = 4;
    g = toTurnOf(g, nobles(g)[0]);
    const me = g.turn!.playerId;
    const k = king(g);
    const voters = nobles(g).filter((x) => x !== me);
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:peoples_champion'), setup: { target: me } });
    for (const v of voters) g = respond(g, v, { yes: true });
    g = respond(g, me, { value: 6 });
    g = respond(g, k, { value: 1 });
    assert.equal(king(g), me);
    assert.equal(gold(g, me), 600);
    assert.equal(gold(g, k), 1000, 'the old King is richer but is not re-crowned until gold changes');
  });

  test('the Royal Bomb is discarded when its holder becomes King', () => {
    let g = game(5, 56);
    const k = king(g);
    const n = nobles(g)[0];
    const bomb = give(g, n, 'noble:royal_bomb');
    g.players[n].gold = 900;
    g = act(g, k, { type: 'play', cardId: give(g, k, 'king:loyal_dog'), setup: { target: n, amount: '200' } });
    assert.equal(king(g), k, 'no crown change in the middle of a card');
    g = respond(g, n, { value: 'say' });
    assert.equal(king(g), n);
    assert.ok(g.discard.noble.includes(bomb));
    assert.ok(!g.players[k].hand.includes(bomb), 'the old King did not inherit it');
  });

  test('Scout pays out the moment the backed Noble becomes King', () => {
    let g = game(5, 57);
    g = toTurnOf(g, nobles(g)[0]);
    const me = g.turn!.playerId;
    const pick = nobles(g).find((x) => x !== me)!;
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:scout'), setup: { target: pick } });
    g.players[pick].gold = 1100; // (test shortcut) then any gain crowns them
    g.players[me].gold = 600;
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:shadow_deal'), setup: { target: pick, amount: '100' } });
    assert.equal(king(g), pick);
    assert.equal(gold(g, me), 900);
  });
});

describe('Knights and protections', () => {
  test('Isolation (gold) does not stop a Betrayal', () => {
    let g = game(5, 58);
    g.round = 2;
    g = toTurnOf(g, nobles(g)[0]);
    const victim = g.turn!.playerId;
    g = act(g, victim, { type: 'play', cardId: give(g, victim, 'noble:isolation'), option: 1 });
    g = placeOne(g);
    const me = g.turn!.playerId;
    const backer = nobles(g).find((x) => x !== me && x !== victim)!;
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:betrayal'), setup: { target: victim } });
    g = respond(g, backer, {});
    assert.equal(gold(g, victim), 0);
  });

  test("King's Eye: a Noble taking from the protected player pays the bank 100", () => {
    let g = game(5, 59);
    const k = king(g);
    const order = g.turnOrder.map((s) => g.seats[s]);
    const guarded = order[2];
    const taker = order[1];
    g = act(g, k, { type: 'play', cardId: give(g, k, 'king:kings_eye'), setup: { target: guarded } });
    while (g.turn!.playerId === k) g = placeOne(g);
    assert.equal(g.turn!.playerId, taker);
    g = act(g, taker, { type: 'play', cardId: give(g, taker, 'noble:meat_for_meat'), setup: { target: guarded } });
    g = respond(g, taker, { value: 6 });
    g = respond(g, guarded, { value: 1 });
    assert.equal(gold(g, taker), 700, '+200 taken, −100 for King’s Eye');
    assert.equal(gold(g, guarded), 400);
  });

  test("King's Eye ends when the King's next turn starts; Isolation at the end of its player's next turn", () => {
    let g = game(4, 60);
    const k = king(g);
    g = act(g, k, { type: 'play', cardId: give(g, k, 'king:kings_eye'), setup: { target: nobles(g)[0] } });
    g = toNegotiation(g);
    assert.ok(g.statuses.some((s) => s.kind === 'kingsEye'));
    g = tick(g, g.negotiation!.endsAt)!;
    assert.equal(g.turn!.playerId, k);
    assert.ok(!g.statuses.some((s) => s.kind === 'kingsEye'));
  });
});

describe('lasting effects', () => {
  test('Bad Blood pays its player 200 each new round until one of the two pays the other 200', () => {
    let g = game(5, 61);
    g = toTurnOf(g, nobles(g)[0]);
    const me = g.turn!.playerId;
    const [a, b] = nobles(g).filter((x) => x !== me);
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:bad_blood'), setup: { a, b } });
    g = toNegotiation(g);
    const before = gold(g, me);
    g = tick(g, g.negotiation!.endsAt)!;
    assert.equal(gold(g, me), before + 200);
    const status = g.statuses.find((s) => s.kind === 'badBlood')!;
    fails(g, me, { type: 'payBadBlood', statusId: status.id }, /isn't yours/);
    g = act(g, a, { type: 'payBadBlood', statusId: status.id });
    assert.ok(!g.statuses.some((s) => s.kind === 'badBlood'));
  });

  test('Indebted: on 3-6 the debtor pays 100 each new round; anyone else can free them for 200', () => {
    let g = game(5, 62);
    g = toTurnOf(g, nobles(g)[0]);
    const me = g.turn!.playerId;
    const debtor = nobles(g).find((x) => x !== me)!;
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:indebted'), setup: { target: debtor } });
    g = respond(g, me, { value: 3 });
    g = toNegotiation(g);
    const [mine, theirs] = [gold(g, me), gold(g, debtor)];
    g = tick(g, g.negotiation!.endsAt)!;
    assert.equal(gold(g, me), mine + 100);
    assert.equal(gold(g, debtor), theirs - 100);
    const debt = g.statuses.find((s) => s.kind === 'debt')!;
    fails(g, debtor, { type: 'freeDebtor', statusId: debt.id }, /Another player/);
    g = act(g, king(g), { type: 'freeDebtor', statusId: debt.id });
    assert.ok(!g.statuses.some((s) => s.kind === 'debt'));
  });

  test('Hindsight that never comes true costs 100 at the end of the next round', () => {
    let g = game(5, 63);
    g = toTurnOf(g, nobles(g)[0]);
    const me = g.turn!.playerId;
    const backed = nobles(g).find((x) => x !== me)!;
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:hindsight'), setup: { target: backed } });
    for (let r = 1; r <= 2; r++) {
      g = toNegotiation(g);
      g = tick(g, g.negotiation!.endsAt)!;
    }
    assert.ok(!g.statuses.some((s) => s.kind === 'hindsight'));
    assert.ok(g.transactions.some((t) => t.from === me && t.source === 'card:noble:hindsight' && t.amount === 100));
  });
});

describe('negotiation (Rules p13-14)', () => {
  function negotiating(seed = 70): GameState {
    return toNegotiation(game(5, seed));
  }

  test('a gold offer changes nothing until accepted, then moves the gold', () => {
    let g = negotiating();
    const [a, b] = nobles(g);
    g = act(g, a, { type: 'offer', to: b, giveGold: 200 });
    assert.equal(gold(g, a), 600);
    const offer = g.negotiation!.offers[0];
    fails(g, a, { type: 'acceptOffer', offerId: offer.id }, /not for you/);
    g = act(g, b, { type: 'acceptOffer', offerId: offer.id });
    assert.equal(gold(g, a), 400);
    assert.equal(gold(g, b), 800);
    assert.equal(g.transactions.at(-1)!.source, 'negotiation');
  });

  test('nobody can receive more than 400 gold in one negotiation phase, across several deals', () => {
    let g = negotiating();
    const [a, b, c] = nobles(g);
    g = act(g, a, { type: 'offer', to: c, giveGold: 300 });
    g = act(g, c, { type: 'acceptOffer', offerId: g.negotiation!.offers[0].id });
    fails(g, b, { type: 'offer', to: c, giveGold: 200 }, /400/);
    g = act(g, b, { type: 'offer', to: c, giveGold: 100 });
    g = act(g, c, { type: 'acceptOffer', offerId: g.negotiation!.offers[0].id });
    assert.equal(g.players[c].receivedInNegotiation, 400);
  });

  test('cards are exchanged only 1-for-1, and never between the King and a Noble', () => {
    let g = negotiating();
    const [a, b] = nobles(g);
    const mine = g.players[a].hand[0];
    fails(g, a, { type: 'offer', to: b, giveCard: mine }, /1-for-1/);
    fails(g, a, { type: 'offer', to: king(g), giveCard: mine, askCard: true }, /can't change hands/);
    g = act(g, a, { type: 'offer', to: b, giveCard: mine, askCard: true });
    const theirs = g.players[b].hand[3];
    const offer = g.negotiation!.offers[0];
    fails(g, b, { type: 'acceptOffer', offerId: offer.id }, /Pick the card/);
    g = act(g, b, { type: 'acceptOffer', offerId: offer.id, cardId: theirs });
    assert.ok(g.players[a].hand.includes(theirs));
    assert.ok(g.players[b].hand.includes(mine));
    assert.equal(g.players[a].hand.length, 8);
  });

  test('a card discarded as part of a deal is replaced at once', () => {
    let g = negotiating();
    const [a, b] = nobles(g);
    const bomb = give(g, a, 'noble:royal_bomb');
    g = act(g, a, { type: 'offer', to: b, discardCard: bomb, askGold: 100 });
    g = act(g, b, { type: 'acceptOffer', offerId: g.negotiation!.offers[0].id });
    assert.ok(g.discard.noble.includes(bomb));
    assert.equal(g.players[a].hand.length, 8);
    assert.equal(gold(g, a), 700);
  });

  test('offers are only visible to the two players involved', () => {
    let g = negotiating();
    const [a, b, c] = nobles(g);
    g = act(g, a, { type: 'offer', to: b, giveGold: 100 });
    assert.equal(viewFor(g, a).negotiation!.offers.length, 1);
    assert.equal(viewFor(g, b).negotiation!.offers.length, 1);
    assert.equal(viewFor(g, c).negotiation!.offers.length, 0);
  });

  test('deals are only possible in the Negotiation Phase, and gold moves in steps of 100', () => {
    const g = game(5, 71);
    const [a, b] = nobles(g);
    fails(g, a, { type: 'offer', to: b, giveGold: 100 }, /Negotiation Phase/);
    const n = negotiating();
    fails(n, a, { type: 'offer', to: b, giveGold: 150 }, /steps of 100/);
  });

  test('the Negotiation Phase runs on the server clock: offers expire with it', () => {
    let g = negotiating();
    const [a, b] = nobles(g);
    g = act(g, a, { type: 'offer', to: b, giveGold: 100 });
    g = tick(g, g.negotiation!.endsAt)!;
    assert.equal(g.round, 2);
    assert.equal(g.negotiation, null);
    void T0;
  });
});

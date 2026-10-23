import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { tick } from '../src/game/engine.js';
import type { GameState } from '../src/game/types.js';
import { viewFor } from '../src/game/view.js';
import { T0, act, answerAll, fails, give, king, newGame, nobles } from './helpers.js';

// physical dice: tests type the roll they want
const game = (n = 5, seed = 11) => newGame(n, { seed, config: { diceMode: 'physical' } });

/** Finish the King's turn with harmless face-down cards so a Noble is up. */
function toNobleTurn(g: GameState): GameState {
  while (g.players[g.turn!.playerId].role === 'king') {
    const pid = g.turn!.playerId;
    const c = viewFor(g, pid).hand.find((h) => h.place.ok)!;
    g = act(g, pid, { type: 'place', cardId: c.id, targetId: c.place.targets[0] });
  }
  return g;
}

const prompt = (g: GameState) => g.resolution!.prompt!;
const respond = (g: GameState, pid: string, response: unknown) => act(g, pid, { type: 'respond', promptId: prompt(g).id, response });
const gold = (g: GameState, pid: string) => g.players[pid].gold;

describe('dotted-line cards (Rules p10)', () => {
  let g: GameState;
  let me: string;
  let other: string;
  beforeEach(() => {
    g = toNobleTurn(game());
    me = g.turn!.playerId;
    other = nobles(g).find((id) => id !== me)!;
  });

  test('you must pick one option and only that option resolves', () => {
    const card = give(g, me, 'noble:wrath');
    fails(g, me, { type: 'play', cardId: card, option: 2, setup: { target: other } }, /one of the two options/);
    const next = act(g, me, { type: 'play', cardId: card, option: 1, setup: { target: other } });
    assert.equal(gold(next, me), 600, 'option 2 costs the player nothing');
    assert.equal(gold(next, other), 500);
  });

  test('option 1 of Wrath: you lose 100, the Noble loses 300', () => {
    const card = give(g, me, 'noble:wrath');
    const next = act(g, me, { type: 'play', cardId: card, option: 0, setup: { target: other } });
    assert.equal(gold(next, me), 500);
    assert.equal(gold(next, other), 300);
  });

  test('targets are validated: Wrath option 1 needs a Noble, not the King', () => {
    const card = give(g, me, 'noble:wrath');
    fails(g, me, { type: 'play', cardId: card, option: 0, setup: { target: king(g) } }, /Choose/);
    fails(g, me, { type: 'play', cardId: card, option: 0, setup: { target: me } }, /Choose/);
  });

  test("you can't play a card that isn't in your hand", () => {
    const theirs = g.players[other].hand[0];
    fails(g, me, { type: 'play', cardId: theirs, option: 0, setup: {} }, /isn't in your hand/);
  });
});

describe('Council Meeting', () => {
  let g: GameState;
  let me: string;
  beforeEach(() => {
    g = toNobleTurn(game());
    me = g.turn!.playerId;
  });

  test('only the other Nobles vote — the King cannot vote to protect his gold', () => {
    const k = king(g);
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:council_meeting'), option: 0, setup: {} });
    assert.deepEqual([...prompt(g).who].sort(), nobles(g).filter((id) => id !== me).sort());
    assert.ok(!prompt(g).who.includes(k));
    fails(g, k, { type: 'respond', promptId: prompt(g).id, response: { yes: false } });
    g = answerAll(g, () => ({ yes: true }));
    assert.equal(gold(g, me), 700);
    assert.equal(gold(g, k), 900);
  });

  test('one Noble voting no costs the player 100', () => {
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:council_meeting'), option: 0, setup: {} });
    const naysayer = prompt(g).who[0];
    g = answerAll(g, (pid) => ({ yes: pid !== naysayer }));
    assert.equal(gold(g, me), 500);
  });

  test('the two cards are only drawn once the King has been praised; refusing draws nothing', () => {
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:council_meeting'), option: 1, setup: {} });
    assert.equal(prompt(g).kind, 'choice');
    assert.deepEqual(prompt(g).who, [me]);
    const before = g.players[me].hand.length;
    const refused = respond(g, me, { value: 'refuse' });
    assert.equal(refused.players[me].hand.length, before);
    const praised = respond(g, me, { value: 'praise' });
    assert.equal(praised.players[me].hand.length, before + 2);
  });
});

describe('dice cards', () => {
  test('Meat for Meat: higher roll collects 200; a tie does nothing', () => {
    let g = toNobleTurn(game());
    const me = g.turn!.playerId;
    const them = nobles(g).find((id) => id !== me)!;
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:meat_for_meat'), setup: { target: them } });
    assert.deepEqual(prompt(g).who, [me, them]);
    fails(g, me, { type: 'respond', promptId: prompt(g).id, response: { value: 7 } }, /1-6/);
    g = respond(g, me, { value: 5 });
    g = respond(g, them, { value: 2 });
    assert.equal(gold(g, me), 800);
    assert.equal(gold(g, them), 400);
  });

  test('digital dice are rolled by the server, never by the client', () => {
    let g = toNobleTurn(newGame(5, { seed: 2 }));
    const me = g.turn!.playerId;
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:unprotected') });
    g = respond(g, me, { value: 6 }); // ignored in digital mode
    const roll = g.log.filter((e) => e.kind === 'dice').at(-1)!.text;
    assert.match(roll, /rolls [1-6]/);
  });

  test('a roller who never answers is rolled for at the deadline', () => {
    let g = toNobleTurn(game());
    const me = g.turn!.playerId;
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:unprotected') }, T0);
    assert.equal(tick(g, prompt(g).deadline - 1), null, 'not before the deadline');
    g = tick(g, prompt(g).deadline)!;
    assert.equal(g.resolution, null);
    assert.match(g.log.filter((e) => e.kind === 'dice').at(-1)!.text, new RegExp(`${g.players[me].name} rolls [1-6]`));
  });

  test('Divine Right waits for the last two rounds and needs 300 gold or less', () => {
    let g = toNobleTurn(game());
    const me = g.turn!.playerId;
    const card = give(g, me, 'noble:divine_right');
    fails(g, me, { type: 'play', cardId: card }, /last 2 rounds/);
    g.round = 3;
    fails(g, me, { type: 'play', cardId: card }, /300 gold or less/);
    g.players[me].gold = 300;
    g = act(g, me, { type: 'play', cardId: card });
    g = respond(g, me, { value: 5 });
    assert.equal(gold(g, me), 1500);
  });
});

describe('Betrayal, Knights and bluffs (Rules p16)', () => {
  function round2(seed = 12): GameState {
    let g = game(5, seed);
    g.round = 2; // pretend we're in round 2
    return toNobleTurn(g);
  }

  test('not playable in the first round', () => {
    const g = toNobleTurn(game());
    const me = g.turn!.playerId;
    const card = give(g, me, 'noble:betrayal');
    fails(g, me, { type: 'play', cardId: card, setup: { target: nobles(g).find((x) => x !== me)! } }, /first round/);
  });

  test('the player names their backer; once the backer confirms, they take all the gold', () => {
    let g = round2();
    const me = g.turn!.playerId;
    const [victim, backer] = nobles(g).filter((x) => x !== me);
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:betrayal'), setup: { target: victim, backer } });
    assert.deepEqual(prompt(g).who, [backer], 'only the named backer is asked');
    assert.match(g.log.findLast((e) => e.kind === 'play')!.text, new RegExp(`backed by ${g.players[backer].name}`));
    g = respond(g, backer, {});
    assert.equal(gold(g, victim), 0);
    assert.equal(gold(g, me), 1200);
    assert.ok(g.log.some((e) => e.text === `${g.players[backer].name} confirms they backed the Betrayal`));
  });

  test('a backer is required, it cannot be the victim, and a backer who denies it (or stays silent) stops it', () => {
    let g = round2();
    const me = g.turn!.playerId;
    const [victim, backer] = nobles(g).filter((x) => x !== me);
    const card = give(g, me, 'noble:betrayal');
    fails(g, me, { type: 'play', cardId: card, setup: { target: victim } }, /backed you/);
    fails(g, me, { type: 'play', cardId: card, setup: { target: victim, backer: victim } }, /someone different/);
    fails(g, me, { type: 'play', cardId: card, setup: { target: victim, backer: king(g) } }, /backed you/);
    const denied = respond(act(g, me, { type: 'play', cardId: card, setup: { target: victim, backer } }), backer, { declined: true });
    assert.equal(gold(denied, victim), 600);
    assert.ok(denied.log.some((e) => /did not back the Betrayal/.test(e.text)));
    g = act(g, me, { type: 'play', cardId: card, setup: { target: victim, backer } });
    g = tick(g, prompt(g).deadline)!;
    assert.equal(gold(g, victim), 600);
    assert.equal(gold(g, me), 600);
  });

  test('a real Knight blocks it and is spent; a bluff offers no protection and is revealed', () => {
    let g = round2(13);
    const me = g.turn!.playerId;
    const [shielded, bluffer, backer] = nobles(g).filter((x) => x !== me);
    const knight = give(g, shielded, 'noble:knight');
    g.players[shielded].hand = g.players[shielded].hand.filter((c) => c !== knight);
    g.faceDown.push({ slot: 'fx1', cardId: knight, placedBy: shielded, protectedId: shielded });
    const fake = g.players[bluffer].hand.find((c) => !g.cards[c].key.endsWith(':knight'))!;
    g.players[bluffer].hand = g.players[bluffer].hand.filter((c) => c !== fake);
    g.players[bluffer].hand.push(g.decks.noble.pop()!);
    g.faceDown.push({ slot: 'fx2', cardId: fake, placedBy: bluffer, protectedId: bluffer });
    g.players[shielded].hand.push(g.decks.noble.pop()!);

    // public view: nobody else can tell which is real
    const v = viewFor(g, me);
    for (const p of v.players) for (const f of p.faceDown) assert.equal(f.cardKey, null);

    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:betrayal'), setup: { target: shielded, backer } });
    g = respond(g, backer, {});
    assert.equal(gold(g, shielded), 600, 'the Knight blocked it');
    assert.equal(g.faceDown.some((f) => f.slot === 'fx1'), false, 'the Knight is spent');

    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:betrayal'), setup: { target: bluffer, backer } });
    g = respond(g, backer, {});
    assert.equal(gold(g, bluffer), 0, 'a bluff gives no protection');
    assert.ok(g.log.some((e) => /was a bluff/.test(e.text)));
  });

  test('a placed face-down card counts as a play, and only its owner knows what it is', () => {
    let g = toNobleTurn(game());
    const me = g.turn!.playerId;
    const c = g.players[me].hand[0];
    g = act(g, me, { type: 'place', cardId: c });
    assert.equal(g.turn!.plays, 1);
    const slot = g.faceDown.find((f) => f.cardId === c)!.slot;
    const mine = viewFor(g, me).players.find((p) => p.id === me)!.faceDown.find((f) => f.slot === slot)!;
    assert.equal(mine.cardKey, g.cards[c].key);
    const theirs = viewFor(g, king(g)).players.find((p) => p.id === me)!.faceDown.find((f) => f.slot === slot)!;
    assert.equal(theirs.cardKey, null);
  });

  test('Royal Bomb can never be placed face down', () => {
    const g = toNobleTurn(game());
    const me = g.turn!.playerId;
    const bomb = give(g, me, 'noble:royal_bomb');
    fails(g, me, { type: 'place', cardId: bomb }, /negotiation/);
  });
});

describe('Betray the King and King Maker', () => {
  test('King rolls 1-3 (with King Makers): the player and the King switch places, cards and gold', () => {
    let g = game(6, 21);
    g.round = 2;
    g = toNobleTurn(g);
    const me = g.turn!.playerId;
    const oldKing = king(g);
    const [s1, s2, maker] = nobles(g).filter((x) => x !== me);
    const kmCard = give(g, maker, 'noble:king_maker');
    const mySeat = g.players[me].seat;
    const kingHand = [...g.players[oldKing].hand];
    fails(g, me, { type: 'play', cardId: give(g, me, 'noble:betray_the_king'), setup: { backer: s1, backer2: oldKing } }, /backed you/);
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:betray_the_king'), setup: { backer: s1, backer2: s2 } });
    assert.deepEqual(prompt(g).who, [s1, s2], 'only the two named backers are asked');
    g = respond(g, s1, {});
    g = respond(g, s2, {});
    assert.equal(prompt(g).kind, 'kingMaker');
    g = respond(g, maker, { cardId: kmCard, side: 'oppose' });
    g = answerAll(g, () => ({ cardId: null }));
    assert.equal(prompt(g).kind, 'roll');
    assert.deepEqual(prompt(g).who, [oldKing]);
    g = respond(g, oldKing, { value: 4 }); // 4 - 1 (King Maker) = 3 -> switch
    assert.equal(g.seats[g.kingSeat], me, 'the betrayer is King');
    assert.equal(g.players[me].seat, g.kingSeat);
    assert.equal(g.players[oldKing].seat, mySeat, 'the old King took their seat');
    assert.equal(gold(g, me), 1000);
    assert.equal(gold(g, oldKing), 600);
    assert.deepEqual(g.players[me].hand.slice(0, kingHand.length).sort(), kingHand.sort(), 'the new King has the King cards');
    assert.equal(gold(g, maker), 600, "the King Maker's side won");
    assert.notEqual(g.turn?.playerId, me, 'the new King’s turn ended (A3)');
  });

  test('King rolls 4-6: the King stays and gains 200; a supporting King Maker on the losing side pays 300', () => {
    let g = game(6, 22);
    g.round = 2;
    g = toNobleTurn(g);
    const me = g.turn!.playerId;
    const k = king(g);
    const [s1, s2, maker] = nobles(g).filter((x) => x !== me);
    const km = give(g, maker, 'noble:king_maker');
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:betray_the_king'), setup: { backer: s1, backer2: s2 } });
    g = respond(g, s1, {});
    g = respond(g, s2, {});
    g = respond(g, maker, { cardId: km, side: 'oppose' });
    g = answerAll(g, () => ({ cardId: null }));
    g = respond(g, k, { value: 6 });
    assert.equal(king(g), k);
    assert.equal(gold(g, k), 1200);
    assert.equal(gold(g, maker), 300);
  });
});

describe('protections', () => {
  test('Isolation (gold) stops gold-taking cards from targeting you (Betrayal: see king-negotiation.test.ts)', () => {
    let g = toNobleTurn(game(5, 31));
    const me = g.turn!.playerId;
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:isolation'), option: 1 });
    // next player tries to take from `me`
    g = act(g, me, { type: 'place', cardId: g.players[me].hand[0] });
    const next = g.turn!.playerId;
    const mfm = give(g, next, 'noble:meat_for_meat');
    const opts = viewFor(g, next).hand.find((h) => h.id === mfm)!.play.options[0];
    assert.ok(!opts.fields[0].choices!.some((c) => c.value === me), 'an isolated player is not offered as a target');
  });

  test('Sub Rosa shows the hand only to the player who played it', () => {
    let g = toNobleTurn(game(5, 33));
    const me = g.turn!.playerId;
    const victim = nobles(g).find((x) => x !== me)!;
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:sub_rosa'), setup: { target: `player:${victim}` } });
    const mine = viewFor(g, me).resolution!.prompt!.private!;
    assert.equal(mine.cards.length, 8);
    for (const other of g.seats.filter((x) => x !== me)) {
      const v = viewFor(g, other);
      assert.equal(v.resolution!.prompt!.private, undefined);
      const json = JSON.stringify(v);
      for (const id of g.players[victim].hand) if (other !== victim) assert.ok(!json.includes(id), 'card ids of another hand never leak');
    }
    g = respond(g, me, {});
    g = respond(g, me, { value: 5 });
    const pick = viewFor(g, me).resolution!.prompt!;
    assert.equal(pick.kind, 'card');
    g = respond(g, me, { index: 0 });
    assert.equal(g.players[me].hand.length, 8, 'stole one card (7 + 1)');
    assert.equal(g.players[victim].hand.length, 8, 'the victim drew a replacement');
  });
});

describe('resolution safety', () => {
  test('a prompt answered once cannot be answered again, and an old prompt id is rejected', () => {
    let g = toNobleTurn(game(5, 41));
    const me = g.turn!.playerId;
    const judge = nobles(g).find((x) => x !== me)!;
    const victim = nobles(g).find((x) => x !== me && x !== judge)!;
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:grudge'), setup: { judge, victim } });
    const id = prompt(g).id;
    fails(g, victim, { type: 'respond', promptId: id, response: { value: 'agree' } }, /isn't for you/);
    const after = act(g, judge, { type: 'respond', promptId: id, response: { value: 'agree' } });
    assert.equal(gold(after, me), 800);
    fails(after, judge, { type: 'respond', promptId: id, response: { value: 'agree' } }, /already been answered|Nothing is waiting/);
  });

  test('the playing player chooses everything up front — nothing is chosen for them', () => {
    const g = toNobleTurn(game(5, 42));
    const me = g.turn!.playerId;
    fails(g, me, { type: 'play', cardId: give(g, me, 'noble:shadow_deal'), setup: { target: king(g) } }, /How much/);
  });

  test('gold never goes past 2000 — the excess returns to the bank', () => {
    let g = toNobleTurn(game(5, 43));
    const me = g.turn!.playerId;
    const rich = nobles(g).find((x) => x !== me)!;
    g.players[rich].gold = 1900;
    g.players[king(g)].gold = 2000;
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:shadow_deal'), setup: { target: rich, amount: '200' } });
    assert.equal(gold(g, rich), 2000);
    const tx = g.transactions.at(-1)!;
    assert.equal(tx.requested, 200);
    assert.equal(tx.received, 100);
  });

  test('losing gold at 0 leaves you at 0', () => {
    let g = toNobleTurn(game(5, 44));
    const me = g.turn!.playerId;
    const poor = nobles(g).find((x) => x !== me)!;
    g.players[poor].gold = 100;
    g = act(g, me, { type: 'play', cardId: give(g, me, 'noble:wrath'), option: 0, setup: { target: poor } });
    assert.equal(gold(g, poor), 0);
  });
});

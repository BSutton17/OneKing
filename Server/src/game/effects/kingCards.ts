// What each King card does. Printed text: cards/catalog.ts.

import { discard, draw, isRoyalBomb, refill, removeFromHand } from '../cards.js';
import { bankGain, bankLoss } from '../gold.js';
import { canTake, take } from '../protection.js';
import { ask, choiceOf, pickOf, rollOf, voteOf } from '../prompts.js';
import { allIds, log, nameOf, nextId, nobleIds, seatFrom } from '../state.js';
import type { GameState, PlayerId, Prompt, Resolution } from '../types.js';
import { amountField, announce, lookable, playerField, say, speak, src, target } from './kit.js';
import type { CardHandler } from './types.js';

const n = (g: GameState, id: PlayerId) => nameOf(g, id);
const rolled = (g: GameState, p: Prompt, ids: PlayerId[]) => log(g, 'dice', ids.map((id) => `${n(g, id)} rolls ${rollOf(p, id)}`).join(', '));
const rollFor = (g: GameState, res: Resolution, who: PlayerId[], title: string, text: string) => ask(g, res, { kind: 'roll', title, text, who, ms: g.config.rollMs });

export const kingCards: Record<string, CardHandler> = {
  black_plague: {
    fields: (g) => [{ name: 'order', kind: 'order', label: 'Pair up the Nobles: tap them in order (1st + 2nd, 3rd + 4th…)', choices: nobleIds(g).map((id) => ({ value: id, label: n(g, id) })) }],
    validate(g, _a, _o, setup) {
      const order = setup.order as string[];
      const nobles = nobleIds(g);
      return order.length === nobles.length && nobles.every((id) => order.includes(id)) ? null : 'Put every Noble into a pair';
    },
    start(g, res) {
      const order = res.setup.order as string[];
      const pairs: PlayerId[][] = [];
      for (let i = 0; i < order.length; i += 2) pairs.push(order.slice(i, i + 2));
      const lone = pairs.find((p) => p.length === 1);
      res.data.pairs = pairs;
      announce(g, res, pairs.map((p) => (p.length === 2 ? `${n(g, p[0])} & ${n(g, p[1])}` : `${n(g, p[0])} (with the King)`)).join(', '));
      rollFor(g, res, lone ? [...order, res.actor] : order, 'Black Plague', 'If anyone in your pair rolls a 1, both Nobles of the pair lose 200.');
    },
    onPrompt(g, res, p) {
      rolled(g, p, p.who);
      for (const pair of res.data.pairs as PlayerId[][]) {
        const rollers = pair.length === 2 ? pair : [pair[0], res.actor]; // a lone Noble rolls with the King (C6)
        if (!rollers.some((id) => rollOf(p, id) === 1)) continue;
        say(g, `The plague strikes ${pair.map((id) => n(g, id)).join(' and ')}`);
        pair.forEach((id) => bankLoss(g, id, 200, src(res)));
      }
    },
  },

  eye_for_an_eye: {
    fields: (g) => [playerField(g, 'target', 'Who loses 300?', nobleIds(g))],
    start(g, res) {
      announce(g, res, `on ${n(g, target(res))}`);
      bankLoss(g, res.actor, 100, src(res));
      bankLoss(g, target(res), 300, src(res));
    },
  },

  bend_the_knee: {
    fields: (g) => [playerField(g, 'target', 'Who must thank you?', nobleIds(g))],
    start(g, res) {
      const t = target(res);
      announce(g, res, `${n(g, t)} must thank the King`);
      ask(g, res, {
        kind: 'choice', title: 'Bend the Knee', who: [t], defaultValue: 'thank', ms: g.config.responseMs,
        text: `Thank ${n(g, res.actor)} for everything they've done for you — or refuse and pay the bank 300.`,
        options: [
          { value: 'thank', label: 'Thank the King' },
          { value: 'refuse', label: 'Refuse (pay 300)', disabled: g.players[t].gold < 300 ? "You can't afford to refuse" : undefined },
        ],
      });
    },
    onPrompt(g, res, p) {
      const t = target(res);
      if (choiceOf(p, t) === 'refuse') {
        say(g, `${n(g, t)} refuses to thank the King`);
        bankLoss(g, t, 300, src(res));
      } else if (g.config.mode === 'inPerson') log(g, 'say', `${n(g, t)} must thank ${n(g, res.actor)} for everything they've done for them.`, { actor: t });
      else log(g, 'speech', `Thank you, my King, for everything you've done for me.`, { actor: t });
    },
  },

  helping_hand: {
    notCounted: true,
    start(g, res) {
      announce(g, res, 'draws 2 and gets an extra play');
      draw(g, res.actor, 2);
      if (g.turn?.playerId === res.actor) g.turn.allowance += 1;
    },
  },

  knight: { playable: false, unplayableReason: 'Place it face down in front of a Noble', start() {} },

  anchor: {
    fields: (g) => [
      playerField(g, 'target', 'Who must choose?', nobleIds(g)),
      playerField(g, 'other', 'Who loses 100 to you if they refuse to lose 200?', nobleIds(g)),
    ],
    start(g, res) {
      const [t, other] = [target(res), target(res, 'other')];
      announce(g, res, `${n(g, t)} chooses`);
      ask(g, res, {
        kind: 'choice', title: 'Anchor', who: [t], defaultValue: 'lose', ms: g.config.responseMs,
        text: `Lose 200 to the bank, or let ${other === t ? 'yourself' : n(g, other)} lose 100 to ${n(g, res.actor)}.`,
        options: [
          { value: 'lose', label: 'I lose 200 to the bank' },
          { value: 'other', label: `${other === t ? 'I lose' : `${n(g, other)} loses`} 100 to the King`, disabled: canTake(g, res.actor, other) ? undefined : `${n(g, other)} is protected` },
        ],
      });
    },
    onPrompt(g, res, p) {
      const [t, other] = [target(res), target(res, 'other')];
      if (choiceOf(p, t) === 'other') take(g, res.actor, other, 100, src(res));
      else bankLoss(g, t, 200, src(res));
    },
  },

  loyal_dog: {
    fields: (g) => [playerField(g, 'target', 'Give gold to', nobleIds(g)), amountField('amount', 'How much?', [100, 200, 300])],
    start(g, res) {
      const t = target(res);
      announce(g, res, `${n(g, t)} gets ${res.setup.amount}`);
      bankGain(g, t, Number(res.setup.amount), src(res));
      speak(g, res, {
        title: 'Loyal Dog', text: 'You must say:', who: [t], line: 'Thank you my king, I pledge my loyalty to you my king.',
        instruction: `${n(g, t)} must say: “Thank you my king, I pledge my loyalty to you my king.”`,
      });
    },
  },

  mad_king: {
    start(g, res) {
      announce(g, res, 'everyone rolls');
      rollFor(g, res, allIds(g), 'Mad King', 'Roll a 1 and lose 300 (the King loses 500).');
    },
    onPrompt(g, res, p) {
      rolled(g, p, p.who);
      for (const id of p.who) if (rollOf(p, id) === 1) bankLoss(g, id, id === res.actor ? 500 : 300, src(res));
    },
  },

  debt_collector: {
    fields: (g) => [playerField(g, 'target', 'Who picks the victim?', nobleIds(g))],
    start(g, res) {
      const t = target(res);
      announce(g, res, `${n(g, t)} picks who loses 200`);
      ask(g, res, { kind: 'player', title: 'Debt Collector', text: 'Pick someone to lose 200 gold to the bank.', who: [t], players: allIds(g), ms: g.config.responseMs });
    },
    onPrompt(g, res, p) {
      const victim = pickOf(p, target(res));
      if (!victim) return;
      say(g, `${n(g, target(res))} picks ${n(g, victim)}`);
      bankLoss(g, victim, 200, src(res));
    },
  },

  royal_parrot: {
    // in person the King says the sentence out loud, so there is nothing to type
    fields: (g) => [
      playerField(g, 'target', 'Who is your parrot?', nobleIds(g)),
      ...(g.config.mode === 'virtual' ? [{ name: 'sentence', kind: 'text' as const, label: 'The sentence they must repeat', maxLength: 120 }] : []),
    ],
    start(g, res) {
      const t = target(res);
      announce(g, res, `${n(g, t)} is the royal parrot`);
      bankLoss(g, t, 100, src(res));
      ask(g, res, {
        kind: 'choice', title: 'Royal Parrot', who: [t], defaultValue: 'repeat', ms: g.config.responseMs,
        text: res.setup.sentence
          ? `Repeat in a high-pitched voice: "${res.setup.sentence}" — or refuse and pay the bank 300.`
          : `Repeat ${n(g, res.actor)}'s sentence out loud in a high-pitched voice — or refuse and pay the bank 300.`,
        options: [{ value: 'repeat', label: 'Repeat it' }, { value: 'refuse', label: 'Refuse (pay 300)' }],
      });
    },
    onPrompt(g, res, p) {
      const t = target(res);
      if (choiceOf(p, t) === 'refuse') {
        say(g, `${n(g, t)} refuses to repeat it`);
        bankLoss(g, t, 300, src(res));
      } else if (res.setup.sentence) log(g, 'speech', String(res.setup.sentence).toUpperCase(), { actor: t });
      else log(g, 'say', `${n(g, t)} repeats the King's sentence in a high-pitched voice`, { actor: t });
    },
  },

  shifting_tides: {
    fields: (g) => [playerField(g, 'a', 'First Noble', nobleIds(g)), playerField(g, 'b', 'Second Noble', nobleIds(g), ['a'])],
    start(g, res) {
      const [a, b] = [target(res, 'a'), target(res, 'b')];
      announce(g, res, `${n(g, a)} and ${n(g, b)} can only take gold from each other until the King's next turn`);
      g.statuses.push({ id: nextId(g, 's'), kind: 'shiftingTides', a, b, by: res.actor, expires: { at: 'turnStart', playerId: res.actor, afterTurnNo: g.turnNo } });
    },
  },

  snakes: {
    fields: (g, a) => [playerField(g, 'target', 'Who is in danger?', allIds(g).filter((id) => id !== a))],
    start(g, res) {
      const t = target(res);
      announce(g, res, `${n(g, t)} is chosen`);
      ask(g, res, { kind: 'vote', title: 'Snakes', secret: true, who: nobleIds(g), ms: g.config.voteMs, text: `Raise your hand? If even one Noble raises their hand, ${n(g, t)} loses 300.` });
    },
    onPrompt(g, res, p) {
      const hands = p.who.filter((id) => voteOf(p, id));
      if (!hands.length) return say(g, 'No hands are raised');
      say(g, `Hands raised: ${hands.map((id) => n(g, id)).join(', ')}`);
      bankLoss(g, target(res), 300, src(res));
    },
  },

  sub_rosa: {
    fields: (g, a) => [playerField(g, 'target', "Whose hand will you look at?", lookable(g, a, nobleIds(g)))],
    start(g, res) {
      const t = target(res);
      announce(g, res, `looks at ${n(g, t)}'s hand`);
      res.step = 'look';
      ask(g, res, {
        kind: 'look', title: `${n(g, t)}'s hand`, text: 'Only you can see this.', who: [res.actor], ms: g.config.revealMs,
        private: { [res.actor]: { heading: `${n(g, t)}'s hand`, cards: g.players[t].hand.map((id) => ({ key: g.cards[id].key })) } },
      });
    },
    onPrompt(g, res, p) {
      const t = target(res);
      if (res.step === 'look') {
        res.step = 'roll';
        rollFor(g, res, [res.actor], 'Sub Rosa', `Roll 4 or higher to discard a card from ${n(g, t)}'s hand.`);
        return;
      }
      if (res.step === 'roll') {
        rolled(g, p, [res.actor]);
        if (rollOf(p, res.actor) < 4) return say(g, 'Sub Rosa: no card discarded');
        const choices = g.players[t].hand.filter((id) => !isRoyalBomb(g, id));
        if (!choices.length) return say(g, `${n(g, t)} has no card that can be discarded`);
        res.data.choices = choices;
        res.step = 'discard';
        ask(g, res, {
          kind: 'card', title: 'Discard a card', text: `Pick a card to discard from ${n(g, t)}'s hand.`, who: [res.actor], ms: g.config.responseMs,
          private: { [res.actor]: { heading: `${n(g, t)}'s hand`, cards: choices.map((id) => ({ key: g.cards[id].key })) } },
        });
        return;
      }
      const r = p.responses[res.actor];
      if (r?.kind !== 'card' || r.index === null) return say(g, 'The King discards nothing');
      const cardId = (res.data.choices as string[])[r.index];
      removeFromHand(g, t, cardId);
      discard(g, cardId);
      log(g, 'info', `The King discards ${n(g, t)}'s card`);
      log(g, 'private', `The King discarded your card`, { to: [t] });
      refill(g, t);
    },
  },

  scapegoat: {
    start(g, res) {
      // "starting from the noble to your left" = the next seat clockwise (C7)
      const order: PlayerId[] = [];
      for (let i = 1; i < g.seats.length; i++) {
        const id = g.seats[seatFrom(g, g.kingSeat, i)];
        if (g.players[id].role === 'noble') order.push(id);
      }
      announce(g, res, 'the Nobles vote');
      ask(g, res, {
        kind: 'player', title: 'Scapegoat', sequential: true, notSelf: true, who: order, players: order, ms: g.config.voteMs,
        text: 'Vote, one at a time, for another Noble to lose 300 gold to the bank.',
      });
    },
    onPrompt(g, res, p) {
      if (res.step === 'tie') {
        const pool = res.data.pool as PlayerId[];
        rolled(g, p, pool);
        const min = Math.min(...pool.map((id) => rollOf(p, id)));
        const low = pool.filter((id) => rollOf(p, id) === min);
        if (low.length > 1) return tieBreak(g, res, low);
        return scapegoat(g, res, low[0]);
      }
      const tally: Record<string, number> = {};
      for (const id of p.who) {
        const v = pickOf(p, id);
        if (v) tally[v] = (tally[v] ?? 0) + 1;
      }
      say(g, `Votes: ${Object.entries(tally).map(([id, c]) => `${n(g, id)} ${c}`).join(', ')}`);
      const max = Math.max(...Object.values(tally));
      const top = Object.keys(tally).filter((id) => tally[id] === max);
      if (top.length > 1) return tieBreak(g, res, top);
      scapegoat(g, res, top[0]);
    },
  },

  kings_eye: {
    fields: (g) => [playerField(g, 'target', 'Protect whom?', allIds(g))],
    start(g, res) {
      const t = target(res);
      announce(g, res, `${n(g, t)} is protected until the King's next turn`);
      g.statuses.push({ id: nextId(g, 's'), kind: 'kingsEye', playerId: t, by: res.actor, expires: { at: 'turnStart', playerId: res.actor, afterTurnNo: g.turnNo } });
    },
  },

  we_ride_together: {
    fields: (g) => [playerField(g, 'a', 'First rider', allIds(g)), playerField(g, 'b', 'Second rider', allIds(g), ['a'])],
    start(g, res) {
      announce(g, res, `${n(g, target(res, 'a'))} and ${n(g, target(res, 'b'))} ride together`);
      res.step = 'roll';
      rollFor(g, res, [target(res, 'a'), target(res, 'b')], 'We Ride Together', 'Lower roll loses 200 to the bank.');
    },
    onPrompt(g, res, p) {
      const [a, b] = [target(res, 'a'), target(res, 'b')];
      if (res.step === 'roll') {
        rolled(g, p, [a, b]);
        if (rollOf(p, a) === rollOf(p, b)) return void rollFor(g, res, [a, b], 'Tie — roll again', 'Lower roll loses 200 to the bank.');
        res.data.low = rollOf(p, a) < rollOf(p, b) ? a : b;
        res.step = 'split';
        ask(g, res, {
          kind: 'vote', title: 'Split the loss?', who: [a, b], ms: g.config.voteMs,
          text: `${n(g, res.data.low)} rolled lower and loses 200 — unless you BOTH agree to lose 100 each instead.`,
        });
        return;
      }
      if (voteOf(p, a) && voteOf(p, b)) {
        say(g, 'They agree to share the loss');
        bankLoss(g, a, 100, src(res));
        bankLoss(g, b, 100, src(res));
      } else bankLoss(g, res.data.low, 200, src(res));
    },
  },
};

function tieBreak(g: GameState, res: Resolution, pool: PlayerId[]) {
  res.step = 'tie';
  res.data.pool = pool;
  say(g, `Tie between ${pool.map((id) => n(g, id)).join(' and ')} — the lowest roll is the scapegoat`);
  rollFor(g, res, pool, 'Scapegoat tie', 'Lowest roll loses 300.');
}

function scapegoat(g: GameState, res: Resolution, id: PlayerId) {
  say(g, `${n(g, id)} is the scapegoat`);
  bankLoss(g, id, 300, src(res));
}

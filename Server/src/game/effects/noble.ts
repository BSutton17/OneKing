// What each Noble card does. Printed text: cards/catalog.ts. Decisions the
// PDFs leave open are referenced by their rule-audit ids (A*, C*).

import { cardDef } from '../../cards/catalog.js';
import { discard, draw, isRoyalBomb, refill, removeFromHand } from '../cards.js';
import { bankGain, bankLoss, transfer } from '../gold.js';
import { crown } from '../king.js';
import { knightBlocksBetrayal, removeAllExcept } from '../knights.js';
import { canTake, kingsEyePenalty, take } from '../protection.js';
import { ask, choiceOf, pickOf, rollOf, supporters, voteOf } from '../prompts.js';
import { kingOf, log, nameOf, nextId, nobleIds, others, otherNobles } from '../state.js';
import type { GameState, PlayerId, Prompt, Resolution } from '../types.js';
import { amountField, announce, lookable, playerField, say, src, takeable, target } from './kit.js';
import type { CardHandler } from './types.js';

const n = (g: GameState, id: PlayerId) => nameOf(g, id);
const rolled = (g: GameState, p: Prompt, ids: PlayerId[]) => log(g, 'dice', ids.map((id) => `${n(g, id)} rolls ${rollOf(p, id)}`).join(', '));
const rollFor = (g: GameState, res: Resolution, who: PlayerId[], title: string, text: string) => ask(g, res, { kind: 'roll', title, text, who, ms: g.config.rollMs });

/** Hindsight backers win the moment the backed Noble plays a Betrayal (C3). */
function betrayalPlayed(g: GameState, by: PlayerId) {
  for (const s of [...g.statuses]) {
    if (s.kind !== 'hindsight' || s.backed !== by) continue;
    g.statuses = g.statuses.filter((x) => x !== s);
    discard(g, s.cardId);
    log(g, 'info', `${n(g, s.owner)}'s Hindsight was right: ${n(g, by)} played a Betrayal`);
    bankGain(g, s.owner, 300, 'card:noble:hindsight');
  }
}

export const noble: Record<string, CardHandler> = {
  actors: {
    fields: (g, a, opt) => (opt === 1 ? [playerField(g, 'target', 'Who must everyone laugh at?', others(g, a))] : []),
    start(g, res) {
      if (res.option === 0) {
        announce(g, res, 'everyone must thank the King');
        ask(g, res, {
          kind: 'speech', title: 'Thank the King', text: 'Everyone must thank the King for their glorious rule, however horrible and cruel it might have been.',
          who: nobleIds(g), speech: 'Thank you, my King, for your glorious rule!', allowCustom: true, ms: g.config.speechMs,
        });
      } else {
        const t = target(res);
        announce(g, res, `everyone must laugh at ${n(g, t)}`);
        ask(g, res, { kind: 'speech', title: `Laugh at ${n(g, t)}`, text: `Everyone must laugh at ${n(g, t)}.`, who: others(g, t), speech: `HA HA HA! 🤣 ${n(g, t)}!`, allowCustom: true, ms: g.config.speechMs });
      }
    },
  },

  allies: {
    fields: (g, a) => [playerField(g, 'target', 'Pick a Noble to decide', otherNobles(g, a))],
    start(g, res) {
      const t = target(res);
      announce(g, res, `${n(g, t)} decides`);
      ask(g, res, {
        kind: 'choice', title: 'Allies', text: `${n(g, res.actor)} played Allies. You decide: do they gain 100 gold, or lose 200 to the bank? Anyone may try to convince you.`,
        who: [t], options: [{ value: 'gain', label: `${n(g, res.actor)} gains 100` }, { value: 'lose', label: `${n(g, res.actor)} loses 200` }],
        defaultValue: 'gain', ms: g.config.responseMs,
      });
    },
    onPrompt(g, res, p) {
      const t = target(res);
      if (choiceOf(p, t) === 'lose') {
        say(g, `${n(g, t)} chooses: ${n(g, res.actor)} loses 200`);
        bankLoss(g, res.actor, 200, src(res));
      } else {
        say(g, `${n(g, t)} chooses: ${n(g, res.actor)} gains 100`);
        bankGain(g, res.actor, 100, src(res));
      }
    },
  },

  bad_blood: {
    fields: (g, a) => [playerField(g, 'a', 'First Noble', otherNobles(g, a)), playerField(g, 'b', 'Second Noble', otherNobles(g, a), ['a'])],
    start(g, res) {
      const [a, b] = [target(res, 'a'), target(res, 'b')];
      announce(g, res, `bad blood between ${n(g, a)} and ${n(g, b)}`);
      g.statuses.push({ id: nextId(g, 's'), kind: 'badBlood', owner: res.actor, a, b });
      say(g, `${n(g, res.actor)} gains 200 at the start of every round until ${n(g, a)} or ${n(g, b)} pays the other 200`);
    },
  },

  beggars_blessing: {
    start(g, res) {
      announce(g, res);
      const poor = nobleIds(g).filter((id) => g.players[id].gold <= 300);
      if (!poor.length) say(g, 'No Noble has 300 gold or less');
      poor.forEach((id) => bankGain(g, id, 200, src(res)));
    },
  },

  betrayal: {
    check: (g) => (g.round < 2 ? 'Not playable in the first round' : null),
    fields: (g, a) => [playerField(g, 'target', 'Whose gold will you take?', otherNobles(g, a))],
    start(g, res) {
      const t = target(res);
      announce(g, res, `targeting ${n(g, t)}`);
      betrayalPlayed(g, res.actor);
      const who = otherNobles(g, res.actor).filter((id) => id !== t);
      if (!who.length) return say(g, 'No Noble is able to support it — no effect');
      ask(g, res, {
        kind: 'support', title: 'Betrayal!', need: 1, who, ms: g.config.betrayalSupportMs,
        text: `${n(g, res.actor)} wants to take ALL of ${n(g, t)}'s gold (${g.players[t].gold}). It needs vocal support from one Noble.`,
      });
    },
    onPrompt(g, res, p) {
      const t = target(res);
      const backers = supporters(p);
      if (!backers.length) return say(g, 'Nobody supported the Betrayal — it has no effect');
      say(g, `${backers.map((id) => n(g, id)).join(', ')} supported the Betrayal`);
      if (knightBlocksBetrayal(g, t)) return;
      take(g, res.actor, t, g.players[t].gold, src(res), res.actor, true);
    },
  },

  betray_the_king: {
    check: (g) => (g.round < 2 ? 'Not playable in the first round' : null),
    start(g, res) {
      const king = kingOf(g).id;
      announce(g, res, `challenging ${n(g, king)}`);
      const who = others(g, res.actor).filter((id) => id !== king);
      if (who.length < 2) return say(g, 'Not enough players could support it — no effect');
      res.step = 'support';
      ask(g, res, {
        kind: 'support', title: 'Betray the King!', need: 2, who, ms: g.config.betrayKingSupportMs,
        text: `${n(g, res.actor)} moves against ${n(g, king)}. It needs vocal support from TWO players.`,
      });
    },
    onPrompt(g, res, p) {
      const king = kingOf(g).id;
      if (res.step === 'support') {
        const backers = supporters(p);
        if (backers.length < 2) return say(g, 'Betray the King did not get two supporters — no effect');
        say(g, `${backers.map((id) => n(g, id)).join(' and ')} support the betrayal`);
        res.step = 'kingMaker';
        ask(g, res, {
          kind: 'kingMaker', title: 'King Maker', who: nobleIds(g), ms: g.config.kingMakerMs,
          text: `If you hold a King Maker you may play it now: support the King (+1 to the roll) or oppose (−1). If your side fails you pay 300.`,
        });
        return;
      }
      if (res.step === 'kingMaker') {
        const sides: Record<string, 'support' | 'oppose'> = {};
        for (const [id, r] of Object.entries(p.responses)) if (r.kind === 'kingMaker' && r.cardId && r.side) sides[id] = r.side;
        res.data.sides = sides;
        res.step = 'roll';
        const mod = Object.values(sides).reduce((m, s) => m + (s === 'support' ? 1 : -1), 0);
        rollFor(g, res, [king], 'The King rolls', `1–3: ${n(g, res.actor)} switches places and gold with you. 4–6: you stay King and gain 200.${mod ? ` King Makers: ${mod > 0 ? '+' : ''}${mod}.` : ''}`);
        return;
      }
      const sides = res.data.sides as Record<string, 'support' | 'oppose'>;
      const mod = Object.values(sides).reduce((m, s) => m + (s === 'support' ? 1 : -1), 0);
      const roll = rollOf(p, king);
      const total = roll + mod;
      log(g, 'dice', `${n(g, king)} rolls ${roll}${mod ? ` ${mod > 0 ? '+' : '−'} ${Math.abs(mod)} (King Makers) = ${total}` : ''}`);
      const kingWins = total >= 4;
      for (const id of (res.data.kingMakerCards as string[] | undefined) ?? []) discard(g, id);
      if (kingWins) {
        say(g, `${n(g, king)} survives the betrayal`);
        bankGain(g, king, 200, src(res));
      } else {
        crown(g, res.actor, { swapGold: true, source: src(res), why: 'Betray the King' });
      }
      const losing = kingWins ? 'oppose' : 'support';
      for (const [id, side] of Object.entries(sides)) {
        if (side !== losing) continue;
        say(g, `${n(g, id)}'s King Maker side failed`);
        bankLoss(g, id, 300, 'card:noble:king_maker');
      }
    },
  },

  council_meeting: {
    start(g, res) {
      if (res.option === 1) {
        announce(g, res, 'draws two cards and must praise the King');
        draw(g, res.actor, 2);
        ask(g, res, { kind: 'speech', title: 'Praise the King', text: 'You must praise the King.', who: [res.actor], speech: 'Long live the King! 👑', allowCustom: true, ms: g.config.speechMs });
        return;
      }
      announce(g, res, 'everyone votes');
      ask(g, res, {
        kind: 'vote', title: 'Council Meeting', secret: true, who: others(g, res.actor), ms: g.config.voteMs,
        text: `If ALL vote yes, ${n(g, res.actor)} takes 100 gold from the King. If anyone votes no, ${n(g, res.actor)} loses 100.`,
      });
    },
    onPrompt(g, res, p) {
      if (res.option === 1) return;
      const no = p.who.filter((id) => !voteOf(p, id));
      say(g, no.length ? `Voted no: ${no.map((id) => n(g, id)).join(', ')}` : 'Everyone voted yes');
      if (no.length) bankLoss(g, res.actor, 100, src(res));
      else take(g, res.actor, kingOf(g).id, 100, src(res));
    },
  },

  divine_right: {
    check: (g, a) => (g.round < 3 ? 'Only in the last 2 rounds' : g.players[a].gold > 300 ? 'Only with 300 gold or less' : null),
    start(g, res) {
      announce(g, res);
      rollFor(g, res, [res.actor], 'Divine Right', 'Roll 5 or 6 to gain 1200 gold.');
    },
    onPrompt(g, res, p) {
      rolled(g, p, [res.actor]);
      if (rollOf(p, res.actor) >= 5) bankGain(g, res.actor, 1200, src(res));
      else say(g, 'The heavens are silent');
    },
  },

  grudge: {
    fields: (g, a) => [
      playerField(g, 'judge', 'Who must agree?', others(g, a)),
      playerField(g, 'victim', 'Take 200 from which Noble?', takeable(g, a, otherNobles(g, a))),
    ],
    start(g, res) {
      const [judge, victim] = [target(res, 'judge'), target(res, 'victim')];
      announce(g, res, `${n(g, judge)} must agree to them taking 200 from ${n(g, victim)}`);
      ask(g, res, {
        kind: 'choice', title: 'Grudge', who: [judge], defaultValue: 'disagree', ms: g.config.responseMs,
        text: `${n(g, res.actor)} wants to take 200 gold from ${victim === judge ? 'you' : n(g, victim)}. If you disagree, ${n(g, res.actor)} loses 100.`,
        options: [{ value: 'agree', label: 'Agree' }, { value: 'disagree', label: 'Disagree' }],
      });
    },
    onPrompt(g, res, p) {
      const [judge, victim] = [target(res, 'judge'), target(res, 'victim')];
      if (choiceOf(p, judge) === 'agree') {
        say(g, `${n(g, judge)} agrees`);
        take(g, res.actor, victim, 200, src(res));
      } else {
        say(g, `${n(g, judge)} disagrees`);
        bankLoss(g, res.actor, 100, src(res));
      }
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

  hindsight: {
    fields: (g, a) => [playerField(g, 'target', 'Which Noble will play a Betrayal?', otherNobles(g, a))],
    start(g, res) {
      const t = target(res);
      const deadlineRound = Math.min(g.round + 1, 4);
      announce(g, res, `backs ${n(g, t)} to play a Betrayal by the end of round ${deadlineRound}`);
      g.statuses.push({ id: nextId(g, 's'), kind: 'hindsight', owner: res.actor, backed: t, deadlineRound, cardId: res.cardId! });
      res.keepCard = true;
    },
  },

  icarus: {
    check(g, a) {
      const need = 100 * otherNobles(g, a).length;
      return g.players[a].gold < need ? `You can only play this if you can afford it (${need} gold)` : null;
    },
    start(g, res) {
      announce(g, res);
      rollFor(g, res, [res.actor], 'Icarus', 'Roll 4–6: every other Noble pays you 100. Otherwise you pay each of them 100.');
    },
    onPrompt(g, res, p) {
      rolled(g, p, [res.actor]);
      const win = rollOf(p, res.actor) >= 4;
      for (const id of otherNobles(g, res.actor)) {
        if (win) take(g, res.actor, id, 100, src(res));
        else transfer(g, res.actor, id, 100, src(res));
      }
    },
  },

  indebted: {
    fields: (g, a) => [playerField(g, 'target', 'Who will owe you?', otherNobles(g, a))],
    start(g, res) {
      announce(g, res, `${n(g, target(res))} may become indebted`);
      rollFor(g, res, [res.actor], 'Indebted', `Roll 3–6 and ${n(g, target(res))} must pay you 100 at the start of every round.`);
    },
    onPrompt(g, res, p) {
      rolled(g, p, [res.actor]);
      if (rollOf(p, res.actor) < 3) return say(g, 'No debt');
      const t = target(res);
      g.statuses.push({ id: nextId(g, 's'), kind: 'debt', creditor: res.actor, debtor: t });
      say(g, `${n(g, t)} owes ${n(g, res.actor)} 100 at the start of every round until someone pays ${n(g, res.actor)} 200 to free them`);
    },
  },

  isolation: {
    start(g, res) {
      announce(g, res, res.option === 0 ? 'no one can look at their cards until the end of their next turn' : 'no one can take their gold until the end of their next turn');
      const expires = { at: 'turnEnd' as const, playerId: res.actor, afterTurnNo: g.turnNo };
      g.statuses.push(res.option === 0 ? { id: nextId(g, 's'), kind: 'isolationLook', playerId: res.actor, expires } : { id: nextId(g, 's'), kind: 'isolationGold', playerId: res.actor, expires });
    },
  },

  king_maker: { playable: false, unplayableReason: 'Play it out of turn when someone plays Betray the King', start() {} },
  knight: { playable: false, unplayableReason: 'Place it face down in front of you', start() {} },

  loyalty: {
    fields: (g, a, opt) =>
      opt === 0
        ? [playerField(g, 'target', 'Pick a player', others(g, a))]
        : [playerField(g, 'target', 'Who must pay the King 100?', takeable(g, a, otherNobles(g, a)))],
    start(g, res) {
      const t = target(res);
      const king = kingOf(g).id;
      if (res.option === 1) {
        announce(g, res, `${n(g, t)} must pay the King 100 and pledge loyalty`);
        take(g, res.actor, t, 100, src(res), king);
        ask(g, res, { kind: 'speech', title: 'Pledge your loyalty', text: `Pledge your loyalty to ${n(g, king)}.`, who: [t], speech: `I pledge my loyalty to you, ${n(g, king)}, my King.`, allowCustom: true, ms: g.config.speechMs });
        return;
      }
      announce(g, res, `${n(g, t)} decides who pays`);
      if (t === king) return void take(g, res.actor, king, 100, src(res));
      const options = [
        { value: 'pay', label: `I pay ${n(g, res.actor)} 100`, disabled: canTake(g, res.actor, t) ? undefined : 'You are protected' },
        { value: 'king', label: `The King pays ${n(g, res.actor)} 100`, disabled: canTake(g, res.actor, king) ? undefined : 'The King is protected' },
      ];
      if (options.every((o) => o.disabled)) return say(g, 'Nobody can be made to pay — no effect');
      ask(g, res, { kind: 'choice', title: 'Loyalty', text: `${n(g, res.actor)} played Loyalty on you. Who pays them 100?`, who: [t], options, defaultValue: 'pay', ms: g.config.responseMs });
    },
    onPrompt(g, res, p) {
      if (res.option === 1) return;
      const t = target(res);
      const payer = choiceOf(p, t) === 'king' ? kingOf(g).id : t;
      take(g, res.actor, payer, 100, src(res));
    },
  },

  meat_for_meat: {
    fields: (g, a) => [playerField(g, 'target', 'Roll against which Noble?', takeable(g, a, otherNobles(g, a)))],
    start(g, res) {
      announce(g, res, `against ${n(g, target(res))}`);
      rollFor(g, res, [res.actor, target(res)], 'Meat for Meat', `If ${n(g, res.actor)} rolls higher, they collect 200 from ${n(g, target(res))}.`);
    },
    onPrompt(g, res, p) {
      const t = target(res);
      rolled(g, p, [res.actor, t]);
      if (rollOf(p, res.actor) > rollOf(p, t)) take(g, res.actor, t, 200, src(res));
      else say(g, `${n(g, res.actor)} didn't roll higher — nothing happens`);
    },
  },

  peoples_champion: {
    check: (g) => (g.round < 4 ? 'Only in the last round' : null),
    fields: (g) => [playerField(g, 'target', 'Nominate a Noble as King', nobleIds(g))],
    start(g, res) {
      const t = target(res);
      announce(g, res, `nominating ${n(g, t)}`);
      const voters = nobleIds(g).filter((id) => id !== t && id !== res.actor);
      if (!voters.length) return startDuel(g, res);
      res.step = 'vote';
      ask(g, res, { kind: 'vote', title: "People's Champion", secret: true, who: voters, ms: g.config.voteMs, text: `Should ${n(g, t)} challenge ${n(g, kingOf(g).id)} for the throne? Every other Noble must agree.` });
    },
    onPrompt(g, res, p) {
      const t = target(res);
      const king = kingOf(g).id;
      if (res.step === 'vote') {
        const no = p.who.filter((id) => !voteOf(p, id));
        if (no.length) return say(g, `Not unanimous (no: ${no.map((id) => n(g, id)).join(', ')}) — no effect`);
        say(g, 'The Nobles agree!');
        return startDuel(g, res);
      }
      rolled(g, p, [t, king]);
      if (rollOf(p, t) === rollOf(p, king)) return startDuel(g, res, true);
      if (rollOf(p, t) > rollOf(p, king)) crown(g, t, { source: src(res), why: "People's Champion" });
      else say(g, `${n(g, king)} keeps the throne`);
    },
  },

  royal_bomb: {
    start(g, res) {
      announce(g, res, 'every Noble loses 800');
      for (const id of [res.actor, ...otherNobles(g, res.actor)]) bankLoss(g, id, 800, src(res));
    },
  },

  scout: {
    fields: (g, a) => [playerField(g, 'target', 'Which Noble will become King?', otherNobles(g, a))],
    start(g, res) {
      const t = target(res);
      const deadlineRound = Math.min(g.round + 1, 4);
      announce(g, res, `backs ${n(g, t)} to become King by the end of round ${deadlineRound}`);
      g.statuses.push({ id: nextId(g, 's'), kind: 'scout', owner: res.actor, backed: t, deadlineRound, cardId: res.cardId! });
      res.keepCard = true;
    },
  },

  shadow_deal: {
    fields: (g, a) => [playerField(g, 'target', 'Give gold to', others(g, a)), amountField('amount', 'How much?', [100, 200])],
    start(g, res) {
      const amount = Number(res.setup.amount);
      announce(g, res, `${n(g, target(res))} gets ${amount} from the bank`);
      bankGain(g, target(res), amount, src(res));
    },
  },

  sub_rosa: {
    fields(g, a) {
      const hands = lookable(g, a, others(g, a)).map((id) => ({ value: `player:${id}`, label: `${n(g, id)}'s hand` }));
      const slots = g.faceDown
        .filter((f) => f.protectedId !== a && lookable(g, a, [f.protectedId]).length)
        .map((f) => ({ value: `slot:${f.slot}`, label: `Face-down card in front of ${n(g, f.protectedId)}` }));
      return [{ name: 'target', kind: 'choice', label: 'Look at…', choices: [...hands, ...slots] }];
    },
    start(g, res) {
      const [mode, ref] = String(res.setup.target).split(':');
      if (mode === 'player') {
        res.data = { mode, victim: ref };
        announce(g, res, `looks at ${n(g, ref)}'s hand`);
        ask(g, res, {
          kind: 'look', title: `${n(g, ref)}'s hand`, text: 'Only you can see this.', who: [res.actor], ms: g.config.revealMs,
          private: { [res.actor]: { heading: `${n(g, ref)}'s hand`, cards: g.players[ref].hand.map((id) => ({ key: g.cards[id].key })) } },
        });
        kingsEyePenalty(g, res.actor, ref, 'looked at the cards of');
      } else {
        const f = g.faceDown.find((x) => x.slot === ref)!;
        res.data = { mode, victim: f.protectedId };
        announce(g, res, `looks at the face-down card in front of ${n(g, f.protectedId)}`);
        ask(g, res, {
          kind: 'look', title: 'Face-down card', text: 'Only you can see this.', who: [res.actor], ms: g.config.revealMs,
          private: { [res.actor]: { heading: `Face-down card in front of ${n(g, f.protectedId)}`, cards: [{ key: g.cards[f.cardId].key }] } },
        });
        kingsEyePenalty(g, res.actor, f.protectedId, 'looked at the cards of');
      }
      res.step = 'look';
    },
    onPrompt(g, res, p) {
      const victim = res.data.victim as PlayerId;
      if (res.step === 'look') {
        res.step = 'roll';
        rollFor(g, res, [res.actor], 'Sub Rosa', `Roll 4 or higher to take a card from ${n(g, victim)}'s hand.`);
        return;
      }
      if (res.step === 'roll') {
        rolled(g, p, [res.actor]);
        if (rollOf(p, res.actor) < 4) return say(g, 'Sub Rosa: no card taken');
        if (g.players[victim].role === 'king') return say(g, "Nobles can't hold King cards — no card taken");
        const stealable = g.players[victim].hand.filter((id) => !isRoyalBomb(g, id));
        if (!stealable.length) return say(g, `${n(g, victim)} has no card that can be taken`);
        res.data.stealable = stealable;
        res.step = 'take';
        const blind = res.data.mode === 'slot';
        ask(g, res, {
          kind: 'card', title: 'Take a card', text: blind ? `Pick a card from ${n(g, victim)}'s hand, sight unseen.` : `Pick a card to take from ${n(g, victim)}'s hand.`,
          who: [res.actor], ms: g.config.responseMs,
          private: { [res.actor]: { heading: `${n(g, victim)}'s hand`, blind, cards: stealable.map((id) => ({ key: blind ? null : g.cards[id].key })) } },
        });
        return;
      }
      const r = p.responses[res.actor];
      if (r?.kind !== 'card' || r.index === null) return say(g, `${n(g, res.actor)} takes nothing`);
      const cardId = (res.data.stealable as string[])[r.index];
      removeFromHand(g, victim, cardId);
      g.players[res.actor].hand.push(cardId);
      const name = cardDef(g.cards[cardId].key).name;
      say(g, `${n(g, res.actor)} takes a card from ${n(g, victim)}`);
      log(g, 'private', `You took ${name} from ${n(g, victim)}`, { to: [res.actor] });
      log(g, 'private', `${n(g, res.actor)} took your ${name}`, { to: [victim] });
      refill(g, victim);
    },
  },

  subsidies: {
    start(g, res) {
      announce(g, res);
      for (const id of nobleIds(g)) {
        const gold = g.players[id].gold;
        const amount = gold === 0 ? 300 : gold <= 300 ? 200 : gold <= 500 ? 100 : 0;
        if (amount) bankGain(g, id, amount, src(res));
      }
    },
  },

  suppress_rebellion: {
    start(g, res) {
      announce(g, res);
      rollFor(g, res, [kingOf(g).id], 'Suppress Rebellion', `If you pathetically roll 1–3, ${n(g, res.actor)} gains 200 and every other Noble gains 100.`);
    },
    onPrompt(g, res, p) {
      const king = kingOf(g).id;
      rolled(g, p, [king]);
      if (rollOf(p, king) > 3) return say(g, 'The rebellion is crushed — nothing happens');
      bankGain(g, res.actor, 200, src(res));
      otherNobles(g, res.actor).forEach((id) => bankGain(g, id, 100, src(res)));
    },
  },

  tithe: {
    check: (g, a) => (takeable(g, a, otherNobles(g, a)).length ? null : 'No Noble can be made to pay you'),
    fields: (g, a) => [playerField(g, 'target', 'Who picks the Noble that pays?', others(g, a))],
    start(g, res) {
      const t = target(res);
      announce(g, res, `${n(g, t)} picks who pays`);
      ask(g, res, {
        kind: 'player', title: 'Tithe', text: `Pick a Noble to give ${n(g, res.actor)} 100 gold.`,
        who: [t], players: takeable(g, res.actor, otherNobles(g, res.actor)), ms: g.config.responseMs,
      });
    },
    onPrompt(g, res, p) {
      const payer = pickOf(p, target(res));
      if (!payer) return;
      say(g, `${n(g, target(res))} picks ${n(g, payer)}`);
      take(g, res.actor, payer, 100, src(res));
    },
  },

  unprotected: {
    start(g, res) {
      announce(g, res);
      rollFor(g, res, [res.actor], 'Unprotected', 'Roll 5 or 6 to remove every face-down Knight except yours.');
    },
    onPrompt(g, res, p) {
      rolled(g, p, [res.actor]);
      if (rollOf(p, res.actor) < 5) return say(g, 'The Knights stand firm');
      const removed = removeAllExcept(g, res.actor);
      say(g, removed ? `${removed} face-down card${removed > 1 ? 's are' : ' is'} removed` : 'There were no face-down Knights to remove');
    },
  },

  wrath: {
    fields: (g, a, opt) =>
      opt === 0 ? [playerField(g, 'target', 'Which Noble loses 300?', otherNobles(g, a))] : [playerField(g, 'target', 'Who loses 100?', others(g, a))],
    start(g, res) {
      const t = target(res);
      announce(g, res, `on ${n(g, t)}`);
      if (res.option === 0) {
        bankLoss(g, res.actor, 100, src(res));
        bankLoss(g, t, 300, src(res));
      } else bankLoss(g, t, 100, src(res));
    },
  },
};

/** People's Champion: nominee and King roll (rerolling ties). */
function startDuel(g: GameState, res: Resolution, again = false) {
  const t = target(res);
  const king = kingOf(g).id;
  res.step = 'duel';
  rollFor(g, res, [t, king], again ? 'Tie — roll again' : "People's Champion", `${n(g, t)} and ${n(g, king)} roll. Higher roll takes the throne.`);
}

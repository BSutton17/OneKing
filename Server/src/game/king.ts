// Changing the King (Rules p15) and the "more gold than the King" check
// (Rules p5; rule audit A1-A3).

import { discard, isRoyalBomb, refill } from './cards.js';
import type { CardHandler } from './effects/types.js';
import { bankGain, bankLoss, swapGold } from './gold.js';
import { ask, rollOf } from './prompts.js';
import { kingOf, log, nameOf, nextId, nobleIds } from './state.js';
import type { GameState, PlayerId, Resolution } from './types.js';

/** `newKingId` becomes King: seats, hands and roles swap with the old King. */
export function crown(g: GameState, newKingId: PlayerId, opts: { swapGold?: boolean; source: string; why: string }): void {
  const old = kingOf(g);
  const nu = g.players[newKingId];
  if (old.id === nu.id) return;

  // Royal Bomb: "If you become king, the card is discarded."
  for (const id of nu.hand.filter((c) => isRoyalBomb(g, c))) {
    nu.hand.splice(nu.hand.indexOf(id), 1);
    discard(g, id);
    log(g, 'info', `${nu.name}'s Royal Bomb is discarded (they became King)`);
  }
  // Indebted: "Any debts are gone if you become king." (C4)
  const debts = g.statuses.filter((s) => s.kind === 'debt' && s.creditor === nu.id);
  if (debts.length) {
    g.statuses = g.statuses.filter((s) => !debts.includes(s));
    log(g, 'info', `Debts owed to ${nu.name} are wiped out`);
  }

  if (opts.swapGold) swapGold(g, nu.id, old.id, opts.source);

  // physically swap seats; the King's seat never moves
  [nu.seat, old.seat] = [old.seat, nu.seat];
  g.seats[nu.seat] = nu.id;
  g.seats[old.seat] = old.id;
  // swap cards "as they are", then both refill to 8 from their new decks
  [nu.hand, old.hand] = [old.hand, nu.hand];
  nu.role = 'king';
  old.role = 'noble';
  log(g, 'crown', `${nu.name} is the new King! (${opts.why}) ${old.name} becomes a Noble — they swap seats and cards.`, { actor: nu.id });
  refill(g, nu.id);
  refill(g, old.id);

  // A3: if the player whose turn it is just swapped, that turn is over
  if (g.turn && (g.turn.playerId === nu.id || g.turn.playerId === old.id)) g.turn.endNow = true;

  // Scout: backers of the new King are proven right (C3)
  for (const s of g.statuses.filter((x) => x.kind === 'scout' && x.backed === nu.id)) {
    if (s.kind !== 'scout') continue;
    g.statuses = g.statuses.filter((x) => x !== s);
    discard(g, s.cardId);
    log(g, 'info', `${nameOf(g, s.owner)}'s Scout was right about ${nu.name}`);
    bankGain(g, s.owner, 300, 'card:noble:scout');
  }
}

/** Run the gold check (A1). Returns true if it crowned someone or started a roll-off. */
export function crownCheck(g: GameState): boolean {
  const king = kingOf(g);
  const pool = g.config.kingCheck === 'continuous' || g.kingLostGold ? nobleIds(g) : g.goldRisers.filter((id) => g.players[id].role === 'noble' && !g.players[id].out);
  g.goldRisers = [];
  g.kingLostGold = false;
  const richer = pool.filter((id) => g.players[id].gold > king.gold);
  if (richer.length === 0) return false;
  const top = Math.max(...richer.map((id) => g.players[id].gold));
  const tied = richer.filter((id) => g.players[id].gold === top);
  if (tied.length === 1) {
    crown(g, tied[0], { source: 'system:crown', why: `${top} gold beats the King's ${king.gold}` });
    return true;
  }
  // Rules p15: two (or more) become King at the same time -> roll off
  const res: Resolution = {
    id: nextId(g, 'r'), kind: 'rolloff', actor: king.id, setup: {}, counted: false,
    step: 'win', data: { candidates: tied, pool: tied }, prompt: null, done: false,
  };
  g.resolution = res;
  log(g, 'crown', `${tied.map((id) => nameOf(g, id)).join(' and ')} pass the King at the same time with ${top} gold — they roll off for the crown`);
  rolloff.start(g, res);
  return true;
}

export const rolloff: CardHandler = {
  start(g, res) {
    ask(g, res, { kind: 'roll', title: 'Roll for the crown', text: 'Highest roll becomes King. The lowest roll loses 100 gold.', who: res.data.pool, ms: g.config.rollMs });
  },
  onPrompt(g, res, prompt) {
    const rolls: Record<string, number> = Object.fromEntries((res.data.pool as string[]).map((id) => [id, rollOf(prompt, id)]));
    log(g, 'dice', Object.entries(rolls).map(([id, v]) => `${nameOf(g, id)} rolls ${v}`).join(', '));
    res.data.first ??= rolls;
    const pool = res.data.pool as string[];
    if (res.step === 'win') {
      const max = Math.max(...pool.map((id) => rolls[id]));
      const top = pool.filter((id) => rolls[id] === max);
      if (top.length > 1) {
        res.data.pool = top;
        rolloff.start(g, res);
        return;
      }
      res.data.winner = top[0];
      const rest = (res.data.candidates as string[]).filter((id) => id !== top[0]);
      const first = res.data.first as Record<string, number>;
      const min = Math.min(...rest.map((id) => first[id] ?? 7));
      const low = rest.filter((id) => (first[id] ?? 7) === min);
      if (low.length > 1) {
        res.step = 'lose';
        res.data.pool = low;
        ask(g, res, { kind: 'roll', title: 'Roll to avoid the penalty', text: 'Lowest roll loses 100 gold.', who: low, ms: g.config.rollMs });
        return;
      }
      finish(g, res, low[0]);
      return;
    }
    const min = Math.min(...pool.map((id) => rolls[id]));
    const low = pool.filter((id) => rolls[id] === min);
    if (low.length > 1) {
      res.data.pool = low;
      ask(g, res, { kind: 'roll', title: 'Roll again', text: 'Still tied — lowest roll loses 100 gold.', who: low, ms: g.config.rollMs });
      return;
    }
    finish(g, res, low[0]);
  },
};

function finish(g: GameState, res: Resolution, loser: PlayerId) {
  bankLoss(g, loser, 100, 'system:crown roll-off');
  crown(g, res.data.winner, { source: 'system:crown', why: 'won the roll-off' });
}

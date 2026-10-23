// Spoken lines in person (rule audit C20). The game can't hear a Noble pledge
// their loyalty or parrot the King, so tapping "I said it" is only a claim.
// Every other player may vote to overrule it until the round ends; once they
// all have, the speaker is treated as having refused: the reward goes back or
// the printed penalty is paid. Online the game posts the line itself, so
// there is nothing to dispute.

import { cardDef } from '../cards/catalog.js';
import { discard, refill } from './cards.js';
import { bankLoss } from './gold.js';
import { randomIndex } from './rng.js';
import { fail, log, nameOf, nextId, others, plural } from './state.js';
import type { Claim, GameState, PlayerId } from './types.js';

/** Who must agree to overrule `c`: everyone but the speaker, leaving out anyone who is away (A17). */
export const overrulers = (g: GameState, c: Claim): PlayerId[] => others(g, c.by).filter((id) => !g.away.includes(id));

/** Log a spoken line. In person it becomes a claim the table can overrule. */
export function claim(g: GameState, o: { by: PlayerId; cardKey: string; text: string; penalty: string; undo: Claim['undo'] }): void {
  if (g.config.mode !== 'inPerson') {
    log(g, 'info', o.text, { actor: o.by });
    return;
  }
  const c: Claim = { id: nextId(g, 'k'), by: o.by, round: g.round, cardKey: o.cardKey, text: o.text, penalty: o.penalty, undo: o.undo, votes: [], open: true, overruled: false };
  g.claims.push(c);
  log(g, 'info', o.text, { actor: o.by, claimId: c.id });
}

export function voteOverrule(g: GameState, pid: PlayerId, claimId: unknown, vote: unknown): void {
  const c = g.claims.find((x) => x.id === claimId);
  if (!c || !c.open) fail('That can no longer be disputed');
  if (c.by === pid) fail("You can't overrule yourself");
  const card = cardDef(c.cardKey).name;
  if (vote === true) {
    if (c.votes.includes(pid)) fail('You already want to overrule this');
    c.votes.push(pid);
    log(g, 'info', `${nameOf(g, pid)} says ${nameOf(g, c.by)} didn't really do it (${card}) — ${c.votes.length}/${overrulers(g, c).length} to overrule`, { actor: pid, claimId: c.id });
  } else {
    if (!c.votes.includes(pid)) fail("You haven't disputed this");
    c.votes = c.votes.filter((x) => x !== pid);
    log(g, 'info', `${nameOf(g, pid)} takes back their dispute (${card})`, { actor: pid, claimId: c.id });
  }
}

/**
 * Apply every claim the whole table has overruled. Runs between cards (never
 * mid-resolution) so it can't pull a card out from under one. Returns true if
 * anything changed.
 */
export function settleClaims(g: GameState): boolean {
  let changed = false;
  for (const c of g.claims) {
    const voters = overrulers(g, c);
    if (!c.open || !voters.length || !voters.every((id) => c.votes.includes(id))) continue;
    c.open = false;
    c.overruled = true;
    changed = true;
    log(g, 'info', `The table overrules ${nameOf(g, c.by)} on ${cardDef(c.cardKey).name}: ${c.penalty}`, { actor: c.by, claimId: c.id });
    if (c.undo.kind === 'gold') {
      bankLoss(g, c.by, c.undo.amount, c.undo.source);
    } else {
      // the cards they drew go; one they've already played is replaced by a random card from their hand
      const p = g.players[c.by];
      const lost = c.undo.cardIds.filter((id) => p.hand.includes(id));
      for (let k = lost.length; k < c.undo.cardIds.length; k++) {
        const rest = p.hand.filter((id) => !lost.includes(id));
        if (rest.length) lost.push(rest[randomIndex(g, rest.length)]);
      }
      p.hand = p.hand.filter((id) => !lost.includes(id));
      lost.forEach((id) => discard(g, id));
      log(g, 'info', `${p.name} discards ${plural(lost.length, 'card')}`, { actor: c.by });
      refill(g, c.by);
    }
  }
  return changed;
}

/** At the end of the round, what was said stands. */
export function closeClaims(g: GameState): void {
  for (const c of g.claims) c.open = false;
}

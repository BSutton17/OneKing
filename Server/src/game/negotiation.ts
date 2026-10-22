// The Negotiation Phase (Rules p13-14): offers are proposals only — nothing
// changes until the other player accepts, and then everything in the deal
// happens at once or not at all. Promises outside an offer are not tracked:
// deals aren't binding.

import { cardDef } from '../cards/catalog.js';
import { discard, refill, removeFromHand } from './cards.js';
import { GOLD_MAX, NEGOTIATION_RECEIVE_LIMIT } from './config.js';
import { transfer } from './gold.js';
import { fail, log, nameOf, nextId, player } from './state.js';
import type { GameState, Offer, PlayerId } from './types.js';

const MAX_OPEN_OFFERS = 6;

function assertOpen(g: GameState) {
  if (g.phase !== 'negotiation' || !g.negotiation) fail('Deals can only be made in the Negotiation Phase');
}

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= GOLD_MAX && v % 100 === 0;

/** Timing limits on discarding (A7 / printed text). */
function discardBlocked(g: GameState, cardId: string): string | null {
  const key = g.cards[cardId].key;
  if (key === 'noble:divine_right' && g.round < 3) return 'Divine Right can only be discarded in the last 2 rounds';
  if (key === 'noble:peoples_champion' && g.round < 4) return "People's Champion can only be discarded in the last round";
  return null;
}

/** Everything that must hold for `offer` to happen right now (with the recipient's picks). */
function checkDeal(g: GameState, o: Offer, cardFromTo: string | null, discardByTo: string | null) {
  const from = player(g, o.from);
  const to = player(g, o.to);
  if (o.giveCard || o.askCard) {
    if (from.role !== to.role) fail("King cards and Noble cards can't change hands");
  }
  if (from.gold < o.giveGold) fail(`${from.name} doesn't have ${o.giveGold} gold`);
  if (to.gold < o.askGold) fail(`${to.name} doesn't have ${o.askGold} gold`);
  if (to.receivedInNegotiation + o.giveGold > NEGOTIATION_RECEIVE_LIMIT) fail(`${to.name} can't receive more than ${NEGOTIATION_RECEIVE_LIMIT} gold this negotiation (already got ${to.receivedInNegotiation})`);
  if (from.receivedInNegotiation + o.askGold > NEGOTIATION_RECEIVE_LIMIT) fail(`${from.name} can't receive more than ${NEGOTIATION_RECEIVE_LIMIT} gold this negotiation (already got ${from.receivedInNegotiation})`);
  if (to.gold - o.askGold + o.giveGold > GOLD_MAX) fail(`${to.name} would go over ${GOLD_MAX} gold`);
  if (from.gold - o.giveGold + o.askGold > GOLD_MAX) fail(`${from.name} would go over ${GOLD_MAX} gold`);
  if (o.giveCard && !from.hand.includes(o.giveCard)) fail(`${from.name} no longer has that card`);
  if (o.discardCard) {
    if (!from.hand.includes(o.discardCard)) fail(`${from.name} no longer has the card they offered to discard`);
    const why = discardBlocked(g, o.discardCard);
    if (why) fail(why);
  }
  if (o.askCard) {
    if (!cardFromTo) fail('Pick the card you give in exchange');
    if (!to.hand.includes(cardFromTo)) fail("That card isn't in your hand");
  }
  if (o.askDiscard) {
    if (!discardByTo) fail('Pick the card you discard');
    if (!to.hand.includes(discardByTo) || discardByTo === cardFromTo) fail('Pick another card in your hand to discard');
    const why = discardBlocked(g, discardByTo);
    if (why) fail(why);
  }
}

export interface OfferInput {
  to: unknown; giveGold: unknown; giveCard: unknown; discardCard: unknown; askGold: unknown; askCard: unknown; askDiscard: unknown;
}

export function makeOffer(g: GameState, from: PlayerId, input: OfferInput): void {
  assertOpen(g);
  const to = typeof input.to === 'string' ? input.to : '';
  if (!g.players[to] || to === from) fail('Pick another player to deal with');
  const giveGold = input.giveGold ?? 0;
  const askGold = input.askGold ?? 0;
  if (!isAmount(giveGold) || !isAmount(askGold)) fail('Gold amounts go in steps of 100');
  const giveCard = typeof input.giveCard === 'string' && input.giveCard ? input.giveCard : null;
  const discardCard = typeof input.discardCard === 'string' && input.discardCard ? input.discardCard : null;
  const askCard = input.askCard === true;
  const askDiscard = input.askDiscard === true;
  // Rules p14: you can only give someone a card if you get one in return
  if (Boolean(giveCard) !== askCard) fail('Cards can only be exchanged 1-for-1: give a card AND ask for one');
  if (giveCard && giveCard === discardCard) fail("You can't give and discard the same card");
  if (!giveGold && !askGold && !giveCard && !discardCard && !askDiscard) fail('The deal is empty');
  const offers = g.negotiation!.offers;
  if (offers.filter((o) => o.from === from).length >= MAX_OPEN_OFFERS) fail('You have too many open offers — cancel one first');
  const offer: Offer = { id: nextId(g, 'o'), from, to, giveGold, giveCard, discardCard, askGold, askCard, askDiscard, createdAt: g.now };
  // the proposer's side must already be possible (the recipient's is checked on accept)
  checkDeal(g, { ...offer, askCard: false, askDiscard: false }, null, null);
  if (askCard && g.players[from].role !== g.players[to].role) fail("King cards and Noble cards can't change hands");
  offers.push(offer);
  log(g, 'private', `${nameOf(g, from)} offers you a deal`, { to: [to] });
}

export function acceptOffer(g: GameState, by: PlayerId, offerId: unknown, cardId: unknown, discardId: unknown): void {
  assertOpen(g);
  const offers = g.negotiation!.offers;
  const o = offers.find((x) => x.id === offerId);
  if (!o) fail('That offer is gone');
  if (o.to !== by) fail('That offer is not for you');
  const card = typeof cardId === 'string' ? cardId : null;
  const disc = typeof discardId === 'string' ? discardId : null;
  checkDeal(g, o, card, disc);

  const from = g.players[o.from];
  const to = g.players[o.to];
  const parts: string[] = [];
  if (o.giveGold) {
    transfer(g, from.id, to.id, o.giveGold, 'negotiation');
    to.receivedInNegotiation += o.giveGold;
    parts.push(`${from.name} gives ${to.name} ${o.giveGold} gold`);
  }
  if (o.askGold) {
    transfer(g, to.id, from.id, o.askGold, 'negotiation');
    from.receivedInNegotiation += o.askGold;
    parts.push(`${to.name} gives ${from.name} ${o.askGold} gold`);
  }
  if (o.giveCard && card) {
    removeFromHand(g, from.id, o.giveCard);
    removeFromHand(g, to.id, card);
    from.hand.push(card);
    to.hand.push(o.giveCard);
    parts.push('they exchange a card');
    log(g, 'private', `You received ${cardDef(g.cards[card].key).name} from ${to.name}`, { to: [from.id] });
    log(g, 'private', `You received ${cardDef(g.cards[o.giveCard].key).name} from ${from.name}`, { to: [to.id] });
  }
  // discards (only ever as part of a deal) are replaced at once (Rules p14-15)
  for (const [who, c] of [[from.id, o.discardCard], [to.id, o.askDiscard ? disc : null]] as const) {
    if (!c) continue;
    removeFromHand(g, who, c);
    discard(g, c);
    parts.push(`${nameOf(g, who)} discards a card`);
    refill(g, who);
  }
  g.negotiation!.offers = offers.filter((x) => x !== o && !touches(x, o, card, disc));
  log(g, 'deal', `🤝 Deal: ${parts.join('; ')}`, { actor: by });
}

/** Other open offers that relied on a card that just moved. */
function touches(x: Offer, done: Offer, card: string | null, disc: string | null): boolean {
  const moved = [done.giveCard, done.discardCard, card, disc].filter(Boolean);
  return moved.includes(x.giveCard) || moved.includes(x.discardCard);
}

export function declineOffer(g: GameState, by: PlayerId, offerId: unknown): void {
  assertOpen(g);
  const o = g.negotiation!.offers.find((x) => x.id === offerId);
  if (!o || o.to !== by) fail('That offer is gone');
  g.negotiation!.offers = g.negotiation!.offers.filter((x) => x !== o);
  log(g, 'private', `${nameOf(g, by)} declined your offer`, { to: [o.from] });
}

export function cancelOffer(g: GameState, by: PlayerId, offerId: unknown): void {
  assertOpen(g);
  const o = g.negotiation!.offers.find((x) => x.id === offerId);
  if (!o || o.from !== by) fail('That offer is gone');
  g.negotiation!.offers = g.negotiation!.offers.filter((x) => x !== o);
  log(g, 'private', `${nameOf(g, by)} withdrew their offer`, { to: [o.to] });
}

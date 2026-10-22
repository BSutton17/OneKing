// Decks, hands and discard piles. Every card id is always in exactly one
// place: a deck, a discard pile, a hand, face down on the table, the card
// being resolved, or in front of its player (Hindsight / Scout).

import { cardDef } from '../cards/catalog.js';
import { HAND_SIZE } from './config.js';
import { shuffle } from './rng.js';
import { fail, log, plural } from './state.js';
import type { DeckName, GameState, PlayerId } from './types.js';

export const keyOf = (g: GameState, cardId: string): string => g.cards[cardId].key;
export const nameOfCard = (key: string): string => cardDef(key).name;

/** Draw one card for a deck, reshuffling its discard pile if the deck is empty (A4). */
function drawOne(g: GameState, deck: DeckName): string | null {
  if (g.decks[deck].length === 0 && g.discard[deck].length > 0) {
    g.decks[deck] = shuffle(g, g.discard[deck]);
    g.discard[deck] = [];
    log(g, 'info', `The ${deck === 'king' ? 'King' : 'Noble'} discard pile was shuffled into a new deck`);
  }
  return g.decks[deck].pop() ?? null;
}

/** A player draws from their role's deck (Nobles never hold King cards, Rules p17). */
export function draw(g: GameState, playerId: PlayerId, count: number): number {
  const p = g.players[playerId];
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    const id = drawOne(g, p.role);
    if (!id) break;
    p.hand.push(id);
    drawn++;
  }
  return drawn;
}

/** Top a hand back up to 8 (Rules p15: "always have at least 8 cards"). */
export function refill(g: GameState, playerId: PlayerId): void {
  const p = g.players[playerId];
  const missing = HAND_SIZE - p.hand.length;
  if (missing > 0) {
    const n = draw(g, playerId, missing);
    if (n > 0) log(g, 'info', `${p.name} draws ${plural(n, 'replacement card')}`, { actor: playerId });
  }
}

export function removeFromHand(g: GameState, playerId: PlayerId, cardId: string): void {
  const p = g.players[playerId];
  const i = p.hand.indexOf(cardId);
  if (i < 0) fail("That card isn't in your hand");
  p.hand.splice(i, 1);
}

export function discard(g: GameState, cardId: string): void {
  const card = g.cards[cardId];
  g.discard[card.deck].push(cardId);
}

export const handHas = (g: GameState, playerId: PlayerId, key: string): string[] =>
  g.players[playerId].hand.filter((id) => g.cards[id].key === key);

export const isRoyalBomb = (g: GameState, cardId: string) => g.cards[cardId].key === 'noble:royal_bomb';

// Face-down cards claimed to be Knights (Rules p16; rule audit A7-A9).

import { cardDef } from '../cards/catalog.js';
import { discard } from './cards.js';
import { log, nameOf, nextId } from './state.js';
import type { GameState, PlayerId } from './types.js';

export const isRealKnight = (g: GameState, cardId: string) => /:knight$/.test(g.cards[cardId].key);

/** Cards whose own timing forbids bluffing with them right now (A7). */
export function bluffBlocked(g: GameState, cardId: string): string | null {
  const key = g.cards[cardId].key;
  if (key === 'noble:royal_bomb') return 'The Royal Bomb can only leave your hand during negotiation';
  if ((key === 'noble:betrayal' || key === 'noble:betray_the_king') && g.round < 2) return 'Not playable in the first round';
  if (key === 'noble:divine_right' && g.round < 3) return 'Only in the last 2 rounds';
  if (key === 'noble:peoples_champion' && g.round < 4) return 'Only in the last round';
  return null;
}

export function placeFaceDown(g: GameState, cardId: string, placedBy: PlayerId, protectedId: PlayerId): void {
  g.faceDown.push({ slot: nextId(g, 'f'), cardId, placedBy, protectedId });
  const where = placedBy === protectedId ? 'in front of themselves' : `in front of ${nameOf(g, protectedId)}`;
  log(g, 'play', `${nameOf(g, placedBy)} places a card face down ${where}, claiming it's a Knight`, { actor: placedBy });
  log(g, 'private', `Your face-down card in front of ${placedBy === protectedId ? 'you' : nameOf(g, protectedId)} is ${cardDef(g.cards[cardId].key).name}${isRealKnight(g, cardId) ? '' : ' (a bluff)'}`, { to: [placedBy] });
}

/**
 * A supported Betrayal hits `targetId`: a real Knight in front of them blocks it
 * and is spent. Returns true if blocked. If nothing real was there, the bluffs
 * are revealed and discarded (A8).
 */
export function knightBlocksBetrayal(g: GameState, targetId: PlayerId): boolean {
  const mine = g.faceDown.filter((f) => f.protectedId === targetId);
  const real = mine.find((f) => isRealKnight(g, f.cardId));
  if (real) {
    g.faceDown = g.faceDown.filter((f) => f !== real);
    discard(g, real.cardId);
    log(g, 'info', `🛡️ A Knight in front of ${nameOf(g, targetId)} is revealed and blocks the Betrayal!`);
    return true;
  }
  if (mine.length) {
    const names = mine.map((f) => cardDef(g.cards[f.cardId].key).name).join(', ');
    g.faceDown = g.faceDown.filter((f) => !mine.includes(f));
    mine.forEach((f) => discard(g, f.cardId));
    log(g, 'info', `The face-down card${mine.length > 1 ? 's' : ''} in front of ${nameOf(g, targetId)} ${mine.length > 1 ? 'were bluffs' : 'was a bluff'}: ${names}`);
  }
  return false;
}

/** Unprotected: every face-down card not in front of `keeper` is discarded unrevealed. */
export function removeAllExcept(g: GameState, keeper: PlayerId): number {
  const gone = g.faceDown.filter((f) => f.protectedId !== keeper);
  g.faceDown = g.faceDown.filter((f) => f.protectedId === keeper);
  gone.forEach((f) => discard(g, f.cardId));
  return gone.length;
}

// Players who are gone (rule audit A17). Two kinds:
// - away: offline for a while (the room layer keeps g.away up to date). Their
//   seat plays on with the prompt defaults; they don't hold up an overrule (C20).
// - out: removed from the game by the host. Their turns are skipped, their
//   prompts answered with the defaults, nobody can pick them, and their cards,
//   gold and effects go. If it was the King, the crown passes on.

import { discard } from './cards.js';
import { bankLoss } from './gold.js';
import { crown } from './king.js';
import { randomIndex } from './rng.js';
import { kingOf, nobleIds } from './state.js';
import type { GameState, PlayerId, Status } from './types.js';

const PLAYER_FIELDS = ['playerId', 'by', 'a', 'b', 'owner', 'creditor', 'debtor', 'backed'] as const;

/** Does `s` name `id` anywhere (including whose turn ends it)? */
function involves(s: Status, id: PlayerId): boolean {
  if ('expires' in s && s.expires.playerId === id) return true;
  return PLAYER_FIELDS.some((k) => (s as Record<string, unknown>)[k] === id);
}

/**
 * Clear out what players who are out leave behind. Runs between cards (never
 * mid-resolution), so a card that is looking at their hand or gold finishes first.
 * Returns true if it crowned someone.
 */
export function settleLeavers(g: GameState): boolean {
  for (const p of Object.values(g.players)) {
    if (!p.out) continue;
    p.hand.forEach((id) => discard(g, id));
    p.hand = [];
    const guards = g.faceDown.filter((f) => f.protectedId === p.id);
    guards.forEach((f) => discard(g, f.cardId));
    g.faceDown = g.faceDown.filter((f) => !guards.includes(f));
    const ended = g.statuses.filter((s) => involves(s, p.id));
    for (const s of ended) if ('cardId' in s) discard(g, s.cardId);
    g.statuses = g.statuses.filter((s) => !ended.includes(s));
    for (const c of g.claims) if (c.by === p.id) c.open = false;
    if (p.gold > 0) bankLoss(g, p.id, p.gold, 'system:left the game');
  }
  const king = kingOf(g);
  if (!king.out) return false;
  // the richest Noble still playing takes the crown (the gold check right after this, with a roll-off if tied)
  const pool = nobleIds(g);
  if (pool.some((id) => g.players[id].gold > 0)) {
    g.kingLostGold = true;
    return false;
  }
  crown(g, pool[randomIndex(g, pool.length)], { source: 'system:crown', why: `${king.name} left the game` });
  return true;
}

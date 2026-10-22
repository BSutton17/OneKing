// Isolation, King's Eye and Shifting Tides: who may take gold from, or look at
// the cards of, whom. "Taking" = a forced player-to-player payment caused by a
// card, credited to the card's player (rule audit A12).

import { bankLoss, transfer } from './gold.js';
import { isNoble, log, nameOf } from './state.js';
import type { GameState, PlayerId, Status } from './types.js';

const statusesOf = <K extends Status['kind']>(g: GameState, kind: K) =>
  g.statuses.filter((s): s is Extract<Status, { kind: K }> => s.kind === kind);

/** Why `actor` may not take gold from `victim` right now, or null if they may. */
export function takeBlocked(g: GameState, actor: PlayerId, victim: PlayerId, betrayal = false): string | null {
  if (betrayal) return null; // Isolation and Shifting Tides both exclude Betrayal
  if (statusesOf(g, 'isolationGold').some((s) => s.playerId === victim)) return `${nameOf(g, victim)} is isolated: no one can take their gold`;
  for (const s of statusesOf(g, 'shiftingTides')) {
    const partner = s.a === actor ? s.b : s.b === actor ? s.a : null;
    if (partner && partner !== victim) return `Shifting Tides: you can only take gold from ${nameOf(g, partner)}`;
  }
  return null;
}

/** Why `actor` may not look at `victim`'s cards right now, or null. */
export function lookBlocked(g: GameState, _actor: PlayerId, victim: PlayerId): string | null {
  if (statusesOf(g, 'isolationLook').some((s) => s.playerId === victim)) return `${nameOf(g, victim)} is isolated: no one can look at their cards`;
  return null;
}

export const canTake = (g: GameState, actor: PlayerId, victim: PlayerId) => takeBlocked(g, actor, victim) === null;
export const canLook = (g: GameState, actor: PlayerId, victim: PlayerId) => lookBlocked(g, actor, victim) === null;

/** King's Eye: a Noble who looks at / takes from a protected player pays 100. */
export function kingsEyePenalty(g: GameState, actor: PlayerId, victim: PlayerId, what: 'looked at the cards of' | 'took gold from'): void {
  if (!isNoble(g, actor)) return;
  if (!statusesOf(g, 'kingsEye').some((s) => s.playerId === victim)) return;
  log(g, 'info', `King's Eye: ${nameOf(g, actor)} ${what} ${nameOf(g, victim)} and must pay the bank 100`);
  bankLoss(g, actor, 100, "system:king's eye");
}

/**
 * `actor` takes `amount` from `victim` (paid to `recipient`, normally the actor).
 * Applies Isolation / Shifting Tides (no effect if blocked) and King's Eye.
 */
export function take(g: GameState, actor: PlayerId, victim: PlayerId, amount: number, source: string, recipient: PlayerId = actor, betrayal = false): number {
  const blocked = takeBlocked(g, actor, victim, betrayal);
  if (blocked) {
    log(g, 'info', `${blocked} — nothing is taken`);
    return 0;
  }
  const { moved } = transfer(g, victim, recipient, amount, source);
  if (moved > 0) kingsEyePenalty(g, actor, victim, 'took gold from');
  return moved;
}

export { statusesOf };

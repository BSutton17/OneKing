// Small lookups and bookkeeping shared by the whole engine.

import type { GameState, LogEntry, PlayerId, PlayerState } from './types.js';

export class RuleError extends Error {}

/** Throw a player-facing error; applyAction turns it into { ok: false }. */
export function fail(message: string): never {
  throw new RuleError(message);
}

export function nextId(g: GameState, prefix: string): string {
  g.seq += 1;
  return `${prefix}${g.seq.toString(36)}`;
}

export const player = (g: GameState, id: PlayerId): PlayerState => {
  const p = g.players[id];
  if (!p) fail('Unknown player');
  return p;
};

export const nameOf = (g: GameState, id: PlayerId | 'bank'): string => (id === 'bank' ? 'the bank' : g.players[id]?.name ?? '?');

export const kingOf = (g: GameState): PlayerState => g.players[g.seats[g.kingSeat]];

/** Every player, in seat order. */
export const allIds = (g: GameState): PlayerId[] => [...g.seats];

export const nobleIds = (g: GameState): PlayerId[] => g.seats.filter((id) => g.players[id].role === 'noble');

export const others = (g: GameState, id: PlayerId): PlayerId[] => g.seats.filter((x) => x !== id);

export const otherNobles = (g: GameState, id: PlayerId): PlayerId[] => nobleIds(g).filter((x) => x !== id);

export const isNoble = (g: GameState, id: PlayerId): boolean => g.players[id]?.role === 'noble';

/** Seat `steps` away from `seat` going clockwise (negative = counter-clockwise). */
export const seatFrom = (g: GameState, seat: number, steps: number): number => {
  const n = g.seats.length;
  return (((seat + steps) % n) + n) % n;
};

export function log(g: GameState, kind: LogEntry['kind'], text: string, extra: Partial<LogEntry> = {}): void {
  g.log.push({ id: nextId(g, 'e'), t: g.now, round: g.round, kind, text, ...extra });
  if (g.log.length > 600) g.log.splice(0, g.log.length - 600);
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

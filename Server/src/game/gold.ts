// The only code that changes a gold balance. Every change is recorded as a
// Transaction (who, how much, why, which action) and noted for the crown check.
//
// Limits (Rules p16): balances stay within 0..2000. Losing more than you have
// leaves you at 0 (the taker gets only what you had). Card effects that would
// push a balance past 2000 stop at 2000 and the excess returns to the bank (A10).

import { GOLD_MAX } from './config.js';
import { log, nextId } from './state.js';
import type { GameState, PlayerId } from './types.js';

function record(g: GameState, from: PlayerId | 'bank', to: PlayerId | 'bank', requested: number, amount: number, received: number, source: string) {
  g.transactions.push({
    id: nextId(g, 't'), t: g.now, round: g.round, phase: g.phase,
    from, to, requested, amount, received, source, actionId: g.actionId,
  });
}

function noteChange(g: GameState, id: PlayerId, delta: number) {
  if (delta === 0) return;
  const p = g.players[id];
  if (p.role === 'noble' && delta > 0 && !g.goldRisers.includes(id)) g.goldRisers.push(id);
  if (p.role === 'king' && delta < 0) g.kingLostGold = true;
}

// 'card:noble:wrath' -> ' (wrath)', 'system:bad blood' -> ' (bad blood)'
const why = (source: string) => {
  const m = /^card:[^:]+:(.+)$/.exec(source);
  const text = m ? m[1].replace(/_/g, ' ') : source.replace(/^system:/, '');
  return text ? ` (${text})` : '';
};

/** Gain from the bank. Returns what was actually received. */
export function bankGain(g: GameState, id: PlayerId, amount: number, source: string): number {
  const p = g.players[id];
  const received = Math.max(0, Math.min(amount, GOLD_MAX - p.gold));
  p.gold += received;
  record(g, 'bank', id, amount, amount, received, source);
  noteChange(g, id, received);
  const capped = received < amount ? ` (capped at ${GOLD_MAX})` : '';
  log(g, 'gold', `${p.name} +${received} from the bank${capped}${why(source)}`, { actor: id });
  return received;
}

/** Lose to the bank. Returns what was actually lost. */
export function bankLoss(g: GameState, id: PlayerId, amount: number, source: string): number {
  const p = g.players[id];
  const lost = Math.max(0, Math.min(amount, p.gold));
  p.gold -= lost;
  record(g, id, 'bank', amount, lost, lost, source);
  noteChange(g, id, -lost);
  log(g, 'gold', `${p.name} −${lost} to the bank${lost < amount ? ` (had only ${lost})` : ''}${why(source)}`, { actor: id });
  return lost;
}

/** Move gold between players. Returns what left `from` and what reached `to`. */
export function transfer(g: GameState, from: PlayerId, to: PlayerId, amount: number, source: string): { moved: number; received: number } {
  const a = g.players[from];
  const b = g.players[to];
  const moved = Math.max(0, Math.min(amount, a.gold));
  const received = Math.max(0, Math.min(moved, GOLD_MAX - b.gold));
  a.gold -= moved;
  b.gold += received;
  record(g, from, to, amount, moved, received, source);
  noteChange(g, from, -moved);
  noteChange(g, to, received);
  const extra = moved < amount ? ` (had only ${moved})` : received < moved ? ` (${moved - received} over the ${GOLD_MAX} cap returned to the bank)` : '';
  log(g, 'gold', `${a.name} → ${b.name}: ${moved}${extra}${why(source)}`, { actor: from });
  return { moved, received };
}

/** Betray the King's "switch places and gold": both balances trade places. */
export function swapGold(g: GameState, a: PlayerId, b: PlayerId, source: string): void {
  const pa = g.players[a];
  const pb = g.players[b];
  const [ga, gb] = [pa.gold, pb.gold];
  pa.gold = gb;
  pb.gold = ga;
  record(g, a, b, ga, ga, ga, source);
  record(g, b, a, gb, gb, gb, source);
  log(g, 'gold', `${pa.name} and ${pb.name} switch gold (${ga} ⇄ ${gb})`);
}


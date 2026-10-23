// Test helpers: a fixed clock, game builders, a random legal-move driver and
// invariant checks used by the engine tests and the full-game fuzz test.

import assert from 'node:assert/strict';
import { applyAction, createGame, endNegotiationEarly, removePlayer, setAway, tick, type Action } from '../src/game/engine.js';
import { HAND_SIZE } from '../src/game/config.js';
import type { GameConfig, GameState, PlayerId } from '../src/game/types.js';
import { viewFor } from '../src/game/view.js';

export const T0 = 1_700_000_000_000;

/** Engine tests default to virtual mode (spoken lines are prompts); pass mode: 'inPerson' to test that. */
export function newGame(n = 5, opts: { seed?: number; config?: Partial<GameConfig> } = {}) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  return createGame(players, { seed: opts.seed ?? 1, now: T0, config: { mode: 'virtual', ...opts.config } });
}

/** Apply or throw (tests that expect success). */
export function act(g: GameState, pid: PlayerId, action: Action, now = T0): GameState {
  const r = applyAction(g, pid, action, { now });
  if (!r.ok) throw new Error(`${pid} ${action.type}: ${r.error}`);
  checkInvariants(r.state);
  return r.state;
}

export function fails(g: GameState, pid: PlayerId, action: Action, pattern?: RegExp): string {
  const r = applyAction(g, pid, action, { now: T0 });
  assert.equal(r.ok, false, `expected ${action.type} by ${pid} to fail`);
  if (!r.ok && pattern) assert.match(r.error, pattern);
  return r.ok ? '' : r.error;
}

export const king = (g: GameState) => g.seats[g.kingSeat];
export const nobles = (g: GameState) => g.seats.filter((id) => g.players[id].role === 'noble' && !g.players[id].out);
/** Players still in the game, in seat order. */
export const live = (g: GameState) => g.seats.filter((id) => !g.players[id].out);
export const keyOfCard = (g: GameState, id: string) => g.cards[id].key;

/** Put a specific card into a player's hand (swapping one of theirs back into the deck). */
export function give(g: GameState, pid: PlayerId, key: string): string {
  const deck = key.startsWith('king:') ? 'king' : 'noble';
  const where = [g.decks[deck], g.discard[deck], ...Object.values(g.players).filter((p) => p.id !== pid).map((p) => p.hand)];
  for (const pile of where) {
    const i = pile.findIndex((id) => g.cards[id].key === key);
    if (i < 0) continue;
    const [id] = pile.splice(i, 1);
    const me = g.players[pid];
    const back = me.hand.shift();
    if (back !== undefined) pile.splice(i, 0, back);
    me.hand.push(id);
    return id;
  }
  const own = g.players[pid].hand.find((id) => g.cards[id].key === key);
  if (own) return own;
  throw new Error(`no free ${key}`);
}

/** Answer the current prompt (only that one) for everyone still due, with a chooser per player. */
export function answerAll(g: GameState, answer: (pid: PlayerId) => unknown, now = T0): GameState {
  const first = g.resolution?.prompt?.id;
  for (let guard = 0; guard < 20; guard++) {
    const p = g.resolution?.prompt;
    if (!p || p.id !== first) return g;
    const next = p.who.find((id) => !p.responses[id] && (!p.sequential || p.who.find((x) => !p.responses[x]) === id));
    if (!next) return g;
    g = act(g, next, { type: 'respond', promptId: p.id, response: answer(next) }, now);
  }
  return g;
}

export function checkInvariants(g: GameState): void {
  const seen = new Map<string, string>();
  const note = (id: string, where: string) => {
    assert.ok(!seen.has(id), `card ${id} is both in ${seen.get(id)} and ${where}`);
    seen.set(id, where);
  };
  for (const d of ['king', 'noble'] as const) {
    g.decks[d].forEach((id) => note(id, `${d} deck`));
    g.discard[d].forEach((id) => note(id, `${d} discard`));
  }
  for (const p of Object.values(g.players)) {
    p.hand.forEach((id) => note(id, `${p.name}'s hand`));
    assert.ok(p.gold >= 0 && p.gold <= 2000, `${p.name} has ${p.gold} gold`);
    assert.equal(p.gold % 100, 0, `${p.name} has ${p.gold} gold`);
    for (const id of p.hand) assert.equal(g.cards[id].deck, p.role, `${p.name} (${p.role}) holds ${g.cards[id].key}`);
  }
  g.faceDown.forEach((f) => note(f.cardId, 'face down'));
  if (g.resolution?.cardId) note(g.resolution.cardId, 'being resolved');
  for (const s of g.statuses) if ('cardId' in s) note(s.cardId, `${s.kind} in front of a player`);
  for (const id of (g.resolution?.data.kingMakerCards as string[] | undefined) ?? []) note(id, 'king maker in play');
  assert.equal(seen.size, Object.keys(g.cards).length, 'every card is somewhere exactly once');
  const kings = Object.values(g.players).filter((p) => p.role === 'king');
  assert.equal(kings.length, 1, 'exactly one King');
  assert.equal(g.seats[g.kingSeat], kings[0].id, 'the King sits in the King seat');
  g.seats.forEach((id, seat) => assert.equal(g.players[id].seat, seat));
  for (const p of Object.values(g.players)) {
    if (!p.out || g.resolution) continue;
    assert.equal(p.role, 'noble', `${p.name} left but is still King`);
    assert.equal(p.hand.length + p.gold, 0, `${p.name} left but still has cards or gold`);
  }
  if (g.phase === 'negotiation' && !g.resolution) {
    for (const p of Object.values(g.players)) {
      if (p.out) continue;
      const canDraw = g.decks[p.role].length + g.discard[p.role].length > 0;
      if (canDraw) assert.ok(p.hand.length >= HAND_SIZE, `${p.name} has ${p.hand.length} cards in negotiation`);
    }
  }
}

// ---- random legal play --------------------------------------------------------

export function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)];

function randomResponse(r: () => number, g: GameState, pid: PlayerId): unknown {
  const p = g.resolution!.prompt!;
  switch (p.kind) {
    case 'choice': return { value: pick(r, p.options!.filter((o) => !o.disabled)).value };
    case 'player': return { playerId: pick(r, p.players!.filter((x) => !p.notSelf || x !== pid)) };
    case 'vote': return { yes: r() < 0.6 };
    case 'support': return { declined: r() < 0.4 };
    case 'roll': return {};
    case 'kingMaker': {
      const km = g.players[pid].hand.find((id) => g.cards[id].key === 'noble:king_maker');
      return km && r() < 0.7 ? { cardId: km, side: r() < 0.5 ? 'support' : 'oppose' } : { cardId: null };
    }
    case 'card': {
      const n = p.private?.[pid]?.cards.length ?? 0;
      return { index: n && r() < 0.8 ? Math.floor(r() * n) : null };
    }
    case 'look': return {};
    case 'speech': return { text: r() < 0.5 ? 'Long live!' : '' };
  }
}

/** One random legal step; returns the new state (or null if only time can move it on). */
export function randomStep(g: GameState, r: () => number, now: number): GameState | null {
  const prompt = g.resolution?.prompt;
  if (prompt) {
    const who = prompt.who.filter((id) => !prompt.responses[id] && (!prompt.sequential || prompt.who.find((x) => !prompt.responses[x]) === id));
    if (!who.length || r() < 0.03) return tick(g, prompt.deadline); // sometimes let the clock run out
    const pid = pick(r, who);
    return act(g, pid, { type: 'respond', promptId: prompt.id, response: randomResponse(r, g, pid) }, now);
  }
  if (g.phase === 'playing' && g.turn) {
    const pid = g.turn.playerId;
    // now and then someone drops out for a while, or the host removes a player for good (A17)
    if (r() < 0.01) return setAway(g, live(g).filter(() => r() < 0.3), now) ?? g;
    if (r() < 0.002 && live(g).length > 4) {
      const res = removePlayer(g, pick(r, live(g)), now);
      if (res.ok) return res.state;
    }
    // occasionally dispute a spoken line (in person), settle a feud or free a debtor out of turn
    const disputed = g.claims.find((c) => c.open);
    if (disputed && r() < 0.3) {
      const voter = live(g).find((id) => id !== disputed.by && !disputed.votes.includes(id));
      if (voter) return act(g, voter, { type: 'overrule', claimId: disputed.id, vote: true }, now);
    }
    for (const id of live(g)) {
      const v = viewFor(g, id);
      if (v.legal.payBadBlood.length && r() < 0.1) return act(g, id, { type: 'payBadBlood', statusId: v.legal.payBadBlood[0] }, now);
      if (v.legal.freeDebtor.length && r() < 0.05) return act(g, id, { type: 'freeDebtor', statusId: v.legal.freeDebtor[0] }, now);
    }
    const v = viewFor(g, pid);
    const moves: Action[] = [];
    for (const c of v.hand) {
      c.play.options.forEach((o, option) => {
        if (!c.play.ok || !o.ok) return;
        const setup: Record<string, string | string[]> = {};
        for (const f of o.fields) {
          if (f.kind === 'text') setup[f.name] = 'I am a pretty parrot';
          else if (f.kind === 'order') setup[f.name] = [...f.choices!.map((x) => x.value)].sort(() => r() - 0.5);
          else {
            const taken = (f.distinctFrom ?? []).map((n) => setup[n]);
            setup[f.name] = pick(r, f.choices!.filter((x) => !taken.includes(x.value))).value;
          }
        }
        moves.push({ type: 'play', cardId: c.id, option, setup });
      });
      if (c.place.ok && r() < 0.15) moves.push({ type: 'place', cardId: c.id, targetId: pick(r, c.place.targets) });
    }
    if (!moves.length) {
      assert.ok(v.legal.canEndTurn, `${pid} is stuck with no moves`);
      return act(g, pid, { type: 'endTurn' }, now);
    }
    return act(g, pid, pick(r, moves), now);
  }
  if (g.phase === 'negotiation' && g.negotiation) {
    const roll = r();
    const pid = pick(r, live(g));
    const v = viewFor(g, pid);
    const incoming = v.negotiation!.offers.filter((o) => o.to === pid);
    if (incoming.length && roll < 0.35) {
      const o = incoming[0];
      const mine = g.players[pid].hand;
      const res = applyAction(g, pid, { type: 'acceptOffer', offerId: o.id, cardId: o.askCard ? mine[0] : null, discardId: o.askDiscard ? mine[1] : null }, { now });
      if (res.ok) return (checkInvariants(res.state), res.state);
      return act(g, pid, { type: 'declineOffer', offerId: o.id }, now);
    }
    if (roll < 0.7) {
      const to = pick(r, live(g).filter((x) => x !== pid));
      const sameRole = g.players[to].role === g.players[pid].role;
      const card = sameRole && r() < 0.5 ? pick(r, g.players[pid].hand) : null;
      const offer: Action = {
        type: 'offer', to, giveGold: r() < 0.5 ? 100 * Math.floor(r() * 4) : 0, askGold: r() < 0.3 ? 100 : 0,
        giveCard: card, askCard: Boolean(card), discardCard: null, askDiscard: false,
      };
      const res = applyAction(g, pid, offer, { now });
      if (res.ok) return (checkInvariants(res.state), res.state);
    }
    if (roll < 0.8) return endNegotiationEarly(g, now);
    return tick(g, g.negotiation.endsAt);
  }
  return null;
}

/** Play a whole random game. Returns the final state. */
export function playRandomGame(n: number, seed: number, config: Partial<GameConfig> = {}): GameState {
  const r = makeRng(seed * 7919 + n);
  let g = newGame(n, { seed, config });
  checkInvariants(g);
  let now = T0;
  for (let steps = 0; steps < 5000; steps++) {
    if (g.phase === 'over') return g;
    now += 1000;
    const next = randomStep(g, r, now);
    assert.ok(next, `stuck in ${g.phase} (round ${g.round})`);
    checkInvariants(next);
    g = next;
  }
  throw new Error(`game ${seed} did not finish`);
}

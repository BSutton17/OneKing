// The rules engine. Pure from the outside: applyAction / tick take a state and
// return a NEW state (the input is never touched), so a failed action can't
// leave half its changes behind, and the room layer can persist / broadcast
// whatever comes back.
//
// Flow: a round = Playing Phase (one turn per seat, starting at the King's
// seat, in the round's direction) then the Negotiation Phase (timed), then
// end-of-round bookkeeping. advance() moves the state forward until it needs
// a player (a turn to be played, a prompt to be answered, the timer).

import { CARDS, cardDef } from '../cards/catalog.js';
import { discard, draw, refill, removeFromHand } from './cards.js';
import { closeClaims, settleClaims, voteOverrule } from './claims.js';
import { HAND_SIZE, MAX_PLAYERS, MIN_PLAYERS, ROUNDS, START_GOLD, makeConfig } from './config.js';
import { handlerFor, handlerForKey } from './effects/index.js';
import type { FieldSpec } from './effects/types.js';
import { bankGain, bankLoss, transfer } from './gold.js';
import { crownCheck } from './king.js';
import { bluffBlocked, placeFaceDown } from './knights.js';
import { acceptOffer, cancelOffer, declineOffer, makeOffer } from './negotiation.js';
import { take } from './protection.js';
import { expire, isComplete, respond } from './prompts.js';
import { randomIndex, seedRng, shuffle } from './rng.js';
import { RuleError, fail, kingOf, log, nameOf, nextId, nobleIds, seatFrom } from './state.js';
import type { GameConfig, GameState, PlayerId, Resolution, Setup } from './types.js';

export type Action =
  | { type: 'play'; cardId: string; option?: number; setup?: Setup }
  | { type: 'place'; cardId: string; targetId?: string }
  | { type: 'endTurn' }
  | { type: 'respond'; promptId: string; response: unknown }
  | { type: 'payBadBlood'; statusId: string }
  | { type: 'freeDebtor'; statusId: string }
  | { type: 'offer'; to: string; giveGold?: number; giveCard?: string | null; discardCard?: string | null; askGold?: number; askCard?: boolean; askDiscard?: boolean }
  | { type: 'acceptOffer'; offerId: string; cardId?: string | null; discardId?: string | null }
  | { type: 'declineOffer'; offerId: string }
  | { type: 'cancelOffer'; offerId: string }
  | { type: 'doneNegotiating'; done: boolean }
  | { type: 'overrule'; claimId: string; vote: boolean };

export type Result = { ok: true; state: GameState } | { ok: false; error: string };

// ---- setup -------------------------------------------------------------------

/** Players in seat order (clockwise). The King's character card is dealt at random (Rules p5). */
export function createGame(seated: { id: PlayerId; name: string }[], opts: { config?: Partial<GameConfig>; seed?: number; now?: number } = {}): GameState {
  if (seated.length < MIN_PLAYERS || seated.length > MAX_PLAYERS) throw new Error(`One King One Crown needs ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  const now = opts.now ?? Date.now();
  const g: GameState = {
    version: 0, config: makeConfig(opts.config), rng: seedRng(opts.seed), seq: 0,
    players: {}, seats: seated.map((p) => p.id), kingSeat: 0,
    round: 1, phase: 'playing', direction: 1, turnOrder: [], turn: null, nextTurnIndex: 0, turnNo: 0,
    cards: {}, decks: { king: [], noble: [] }, discard: { king: [], noble: [] },
    faceDown: [], statuses: [], claims: [], resolution: null, negotiation: null, roundEnd: null,
    goldRisers: [], kingLostGold: false, log: [], transactions: [], winner: null, actionId: 'setup', now,
  };

  // deal the character cards face down, then reveal
  g.kingSeat = randomIndex(g, seated.length);
  seated.forEach((p, seat) => {
    const role = seat === g.kingSeat ? 'king' : 'noble';
    g.players[p.id] = { id: p.id, name: p.name, seat, role, gold: START_GOLD[role], hand: [], receivedInNegotiation: 0, negotiationDone: false };
  });

  // build both decks; card ids come from a shuffled pool so an id says nothing about the card
  const total = CARDS.reduce((s, c) => s + c.copies, 0);
  const ids = shuffle(g, Array.from({ length: total }, (_, i) => 100 + i * 7));
  for (const def of CARDS) {
    for (let k = 0; k < def.copies; k++) {
      const id = `c${ids.pop()!.toString(36)}`;
      g.cards[id] = { id, key: def.key, deck: def.deck };
      g.decks[def.deck].push(id);
    }
  }
  shuffle(g, g.decks.king);
  shuffle(g, g.decks.noble);
  for (const id of g.seats) draw(g, id, HAND_SIZE);

  g.turnOrder = orderFor(g);
  const king = kingOf(g);
  log(g, 'round', `The character cards are revealed: ${king.name} is the King (${START_GOLD.king} gold); everyone else is a Noble (${START_GOLD.noble} gold).`);
  log(g, 'round', `Round 1 — clockwise, starting with the King`);
  advance(g);
  return g;
}

/** Seats in turn order for this round: the King's seat, then around in the round's direction. */
function orderFor(g: GameState): number[] {
  return g.seats.map((_, i) => seatFrom(g, g.kingSeat, i * g.direction));
}

// ---- applying actions ----------------------------------------------------------

export function applyAction(state: GameState, playerId: PlayerId, action: Action, ctx: { now: number; actionId?: string }): Result {
  const g = structuredClone(state);
  g.now = ctx.now;
  g.actionId = ctx.actionId ?? nextId(g, 'a');
  try {
    if (!g.players[playerId]) fail('You are not in this game');
    if (g.phase === 'over') fail('The game is over');
    dispatch(g, playerId, action);
    advance(g);
  } catch (err) {
    if (err instanceof RuleError) return { ok: false, error: err.message };
    throw err;
  }
  g.version += 1;
  return { ok: true, state: g };
}

function dispatch(g: GameState, pid: PlayerId, a: Action) {
  switch (a?.type) {
    case 'play': return playCard(g, pid, a.cardId, a.option, a.setup);
    case 'place': return placeCard(g, pid, a.cardId, a.targetId);
    case 'endTurn': return endTurnEarly(g, pid);
    case 'respond': {
      if (!g.resolution) fail('Nothing is waiting for an answer');
      return respond(g, g.resolution, pid, a.promptId, a.response);
    }
    case 'payBadBlood': return payBadBlood(g, pid, a.statusId);
    case 'freeDebtor': return freeDebtor(g, pid, a.statusId);
    case 'offer': return makeOffer(g, pid, a as never);
    case 'acceptOffer': return acceptOffer(g, pid, a.offerId, a.cardId, a.discardId);
    case 'declineOffer': return declineOffer(g, pid, a.offerId);
    case 'cancelOffer': return cancelOffer(g, pid, a.offerId);
    case 'doneNegotiating': {
      if (g.phase !== 'negotiation' || !g.negotiation) fail('Not negotiating right now');
      g.players[pid].negotiationDone = a.done === true;
      return;
    }
    case 'overrule': return voteOverrule(g, pid, a.claimId, a.vote);
    default: fail('Unknown action');
  }
}

/** Time passed: apply prompt defaults / end negotiation. Returns null if nothing changed. */
export function tick(state: GameState, now: number): GameState | null {
  const due = nextDeadline(state);
  if (due === null || due > now) return null;
  const g = structuredClone(state);
  g.now = now;
  g.actionId = nextId(g, 'a');
  const prompt = g.resolution?.prompt;
  if (prompt && prompt.deadline <= now) expire(g, prompt);
  if (g.negotiation && g.negotiation.endsAt <= now) closeNegotiation(g, 'Time is up!');
  advance(g);
  g.version += 1;
  return g;
}

export function nextDeadline(g: GameState): number | null {
  const times = [g.resolution?.prompt?.deadline, g.phase === 'negotiation' ? g.negotiation?.endsAt : undefined].filter((t): t is number => typeof t === 'number');
  return times.length ? Math.min(...times) : null;
}

/** Room layer: every connected player pressed "Done negotiating" (A15). */
export function endNegotiationEarly(state: GameState, now: number): GameState | null {
  if (state.phase !== 'negotiation' || !state.negotiation) return null;
  const g = structuredClone(state);
  g.now = now;
  closeNegotiation(g, 'Everyone is done negotiating');
  advance(g);
  g.version += 1;
  return g;
}

/** Room layer: the current player has been disconnected too long — skip their turn (A17). */
export function skipTurn(state: GameState, now: number): GameState | null {
  if (state.phase !== 'playing' || !state.turn || state.resolution) return null;
  const g = structuredClone(state);
  g.now = now;
  log(g, 'info', `${nameOf(g, g.turn!.playerId)} is disconnected — their turn is skipped`);
  finishTurn(g, true);
  advance(g);
  g.version += 1;
  return g;
}

// ---- the state machine ------------------------------------------------------------

function advance(g: GameState): void {
  for (let guard = 0; guard < 500; guard++) {
    if (g.phase === 'over') return;
    const res = g.resolution;
    if (res) {
      if (res.prompt) {
        if (!isComplete(res.prompt)) return; // waiting for answers
        const p = res.prompt;
        res.prompt = null;
        handlerFor(res).onPrompt?.(g, res, p);
        if (!res.prompt) res.done = true;
        continue;
      }
      if (!res.done) return;
      finishResolution(g, res);
      continue;
    }
    if (settleClaims(g)) continue;
    if ((g.goldRisers.length || g.kingLostGold || g.config.kingCheck === 'continuous') && crownCheck(g)) continue;

    if (g.phase === 'playing') {
      const t = g.turn;
      if (!t) {
        if (g.nextTurnIndex < g.turnOrder.length) startTurn(g, g.nextTurnIndex);
        else enterNegotiation(g);
        continue;
      }
      if (t.endNow || t.plays >= t.allowance) {
        finishTurn(g, false);
        continue;
      }
      return; // waiting for the current player
    }
    // negotiation
    if (g.roundEnd === 'settle') {
      settlePredictions(g);
      g.roundEnd = 'advance';
      continue;
    }
    if (g.roundEnd === 'advance') {
      g.roundEnd = null;
      if (g.round >= ROUNDS) gameOver(g);
      else startRound(g);
      continue;
    }
    return; // negotiating
  }
  throw new Error('advance() did not settle');
}

function finishResolution(g: GameState, res: Resolution) {
  if (res.kind === 'card' && res.cardId && !res.keepCard) discard(g, res.cardId);
  g.resolution = null;
}

function startTurn(g: GameState, index: number) {
  const seat = g.turnOrder[index];
  const pid = g.seats[seat];
  const p = g.players[pid];
  g.turnNo += 1;
  expireStatuses(g, 'turnStart', pid);
  // Rules p11-12: King plays 3 (2 with only 3 Nobles), Nobles play 2
  const allowance = p.role === 'king' ? (nobleIds(g).length === 3 ? 2 : 3) : 2;
  g.turn = { index, seat, playerId: pid, plays: 0, allowance, baseDraw: allowance, startedAt: g.now };
  log(g, 'round', `${p.name}'s turn${p.role === 'king' ? ' (King)' : ''}: play ${allowance} cards`, { actor: pid });
}

/**
 * End the current turn: draw the printed count, then top up to 8 (A5). A
 * skipped turn (A17) draws nothing extra but still obeys the 8-card rule.
 */
function finishTurn(g: GameState, skipped: boolean) {
  const t = g.turn!;
  if (!t.endNow && !skipped) draw(g, t.playerId, t.baseDraw);
  refill(g, t.playerId);
  expireStatuses(g, 'turnEnd', t.playerId);
  g.turn = null;
  g.nextTurnIndex = t.index + 1;
}

function expireStatuses(g: GameState, at: 'turnStart' | 'turnEnd', pid: PlayerId) {
  const gone = g.statuses.filter((s) => 'expires' in s && s.expires.at === at && s.expires.playerId === pid && g.turnNo > s.expires.afterTurnNo);
  if (!gone.length) return;
  g.statuses = g.statuses.filter((s) => !gone.includes(s));
  const names: Record<string, string> = { isolationLook: 'Isolation', isolationGold: 'Isolation', kingsEye: "King's Eye", shiftingTides: 'Shifting Tides' };
  for (const s of gone) log(g, 'info', `${names[s.kind] ?? s.kind} ends`);
}

function enterNegotiation(g: GameState) {
  g.phase = 'negotiation';
  g.turn = null;
  g.negotiation = { endsAt: g.now + g.config.negotiationMs, offers: [] };
  for (const p of Object.values(g.players)) {
    p.receivedInNegotiation = 0;
    p.negotiationDone = false;
  }
  log(g, 'phase', `Negotiation Phase — ${Math.round(g.config.negotiationMs / 1000)} seconds. Trade gold, exchange cards, make deals. Nothing is binding.`);
}

function closeNegotiation(g: GameState, why: string) {
  if (!g.negotiation) return;
  // offers nobody answered expire: say so, or the proposer may think the gold moved
  for (const o of g.negotiation.offers) {
    log(g, 'private', `${nameOf(g, o.to)} never confirmed your offer — nothing changed hands`, { to: [o.from] });
    log(g, 'private', `You never answered ${nameOf(g, o.from)}'s offer — it expired`, { to: [o.to] });
  }
  g.negotiation = null;
  g.roundEnd = 'settle';
  log(g, 'phase', `${why} The Negotiation Phase is over.`);
}

/** Hindsight / Scout cards whose deadline is this round lose 100 (C3). */
function settlePredictions(g: GameState) {
  for (const s of [...g.statuses]) {
    if ((s.kind !== 'hindsight' && s.kind !== 'scout') || s.deadlineRound > g.round) continue;
    g.statuses = g.statuses.filter((x) => x !== s);
    discard(g, s.cardId);
    log(g, 'info', `${nameOf(g, s.owner)}'s ${s.kind === 'scout' ? 'Scout' : 'Hindsight'} on ${nameOf(g, s.backed)} was wrong`);
    bankLoss(g, s.owner, 100, `card:noble:${s.kind}`);
  }
}

function startRound(g: GameState) {
  closeClaims(g);
  g.round += 1;
  g.direction = g.round % 2 === 1 ? 1 : -1;
  g.turnOrder = orderFor(g);
  g.phase = 'playing';
  g.turn = null;
  g.nextTurnIndex = 0;
  log(g, 'round', `Round ${g.round} — ${g.direction === 1 ? 'clockwise' : 'counter-clockwise'}, starting with the King`);
  // "at the beginning of every round" payments (Bad Blood, Indebted)
  for (const s of [...g.statuses]) {
    if (s.kind === 'badBlood') {
      log(g, 'info', `Bad Blood between ${nameOf(g, s.a)} and ${nameOf(g, s.b)} pays ${nameOf(g, s.owner)}`);
      bankGain(g, s.owner, 200, 'card:noble:bad_blood');
    }
    if (s.kind === 'debt') {
      log(g, 'info', `${nameOf(g, s.debtor)} pays their debt to ${nameOf(g, s.creditor)}`);
      take(g, s.creditor, s.debtor, 100, 'card:noble:indebted');
    }
  }
}

function gameOver(g: GameState) {
  const king = kingOf(g);
  closeClaims(g);
  g.phase = 'over';
  g.winner = king.id;
  g.negotiation = null;
  log(g, 'over', `After four rounds, ${king.name} is the King — and the winner! There's only One Crown.`, { actor: king.id });
}

// ---- playing cards -------------------------------------------------------------------

/** Why `pid` can't act in the Playing Phase right now, or null. */
function turnBlocked(g: GameState, pid: PlayerId): string | null {
  if (g.phase !== 'playing') return 'Cards are played in the Playing Phase';
  if (!g.turn || g.turn.playerId !== pid) return "It isn't your turn";
  if (g.resolution) return 'Finish resolving the current card first';
  if (g.turn.endNow || g.turn.plays >= g.turn.allowance) return 'You have played all your cards this turn';
  return null;
}

function cardInHand(g: GameState, pid: PlayerId, cardId: unknown): string {
  if (typeof cardId !== 'string' || !g.players[pid].hand.includes(cardId)) fail("That card isn't in your hand");
  return cardId;
}

export interface OptionLegality { ok: boolean; reason?: string; fields: FieldSpec[] }

/** Can `pid` play this card now, and what must they choose? (also drives the client UI) */
export function playLegality(g: GameState, pid: PlayerId, cardId: string): { ok: boolean; reason?: string; options: OptionLegality[] } {
  const key = g.cards[cardId].key;
  const def = cardDef(key);
  const h = handlerForKey(key);
  const optionCount = def.options ? 2 : 1;
  const blocked = turnBlocked(g, pid);
  const options: OptionLegality[] = [];
  for (let o = 0; o < optionCount; o++) {
    if (h.playable === false) {
      options.push({ ok: false, reason: h.unplayableReason, fields: [] });
      continue;
    }
    const why = h.check?.(g, pid, o) ?? null;
    const fields = why ? [] : h.fields?.(g, pid, o) ?? [];
    const empty = fields.find((f) => f.kind !== 'text' && (!f.choices || f.choices.length < (f.distinctFrom?.length ? 2 : 1)));
    const reason = why ?? (empty ? `No valid choice for "${empty.label}"` : undefined);
    options.push({ ok: !reason, reason, fields });
  }
  const anyOk = options.some((o) => o.ok);
  const reason = blocked ?? (anyOk ? undefined : options.find((o) => o.reason)?.reason);
  return { ok: !blocked && anyOk, reason, options };
}

export function placeLegality(g: GameState, pid: PlayerId, cardId: string): { ok: boolean; reason?: string; targets: PlayerId[] } {
  const p = g.players[pid];
  const targets = p.role === 'king' ? nobleIds(g) : [pid];
  const reason = turnBlocked(g, pid) ?? bluffBlocked(g, cardId) ?? undefined;
  return { ok: !reason, reason, targets };
}

function playCard(g: GameState, pid: PlayerId, rawCard: unknown, rawOption: unknown, rawSetup: unknown) {
  const cardId = cardInHand(g, pid, rawCard);
  const key = g.cards[cardId].key;
  const def = cardDef(key);
  const legal = playLegality(g, pid, cardId);
  const option = def.options ? Number(rawOption) : 0;
  if (def.options && option !== 0 && option !== 1) fail('Choose one of the two options');
  const opt = legal.options[option];
  if (!legal.ok && turnBlocked(g, pid)) fail(turnBlocked(g, pid)!);
  if (!opt?.ok) fail(opt?.reason ?? legal.reason ?? "You can't play that card now");
  const setup = cleanSetup(opt.fields, rawSetup);
  const h = handlerForKey(key);
  const why = h.validate?.(g, pid, option, setup);
  if (why) fail(why);

  removeFromHand(g, pid, cardId);
  const res: Resolution = {
    id: nextId(g, 'r'), kind: 'card', actor: pid, cardId, cardKey: key, option: def.options ? option : undefined,
    setup, counted: !h.notCounted, step: '', data: {}, prompt: null, done: false,
  };
  if (res.counted) g.turn!.plays += 1;
  g.resolution = res;
  h.start(g, res);
  if (!res.prompt) res.done = true;
}

/** Validate the up-front choices against what the card offered. */
function cleanSetup(fields: FieldSpec[], raw: unknown): Setup {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Setup = {};
  for (const f of fields) {
    const v = input[f.name];
    const allowed = new Set((f.choices ?? []).map((c) => c.value));
    if (f.kind === 'text') {
      const text = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, f.maxLength ?? 120) : '';
      if (!text) fail(`Fill in: ${f.label}`);
      out[f.name] = text;
    } else if (f.kind === 'order') {
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !allowed.has(x)) || new Set(v).size !== v.length) fail(`Check: ${f.label}`);
      out[f.name] = v as string[];
    } else {
      if (typeof v !== 'string' || !allowed.has(v)) fail(`Choose: ${f.label}`);
      out[f.name] = v;
    }
  }
  for (const f of fields) for (const other of f.distinctFrom ?? []) if (out[f.name] === out[other]) fail(`"${f.label}" must be someone different`);
  return out;
}

function placeCard(g: GameState, pid: PlayerId, rawCard: unknown, rawTarget: unknown) {
  const cardId = cardInHand(g, pid, rawCard);
  const legal = placeLegality(g, pid, cardId);
  if (!legal.ok) fail(legal.reason!);
  const targetId = g.players[pid].role === 'king' ? rawTarget : pid;
  if (typeof targetId !== 'string' || !legal.targets.includes(targetId)) fail('Choose a Noble to protect');
  removeFromHand(g, pid, cardId);
  placeFaceDown(g, cardId, pid, targetId);
  g.turn!.plays += 1; // "Placing a knight down counts as a card played"
}

/** A6: allowed only when no card in hand can be played or placed. */
export function canEndTurnEarly(g: GameState, pid: PlayerId): boolean {
  if (turnBlocked(g, pid)) return false;
  return g.players[pid].hand.every((c) => !playLegality(g, pid, c).ok && !placeLegality(g, pid, c).ok);
}

function endTurnEarly(g: GameState, pid: PlayerId) {
  const blocked = turnBlocked(g, pid);
  if (blocked) fail(blocked);
  if (!canEndTurnEarly(g, pid)) fail('You still have cards you can play');
  log(g, 'info', `${nameOf(g, pid)} has no card they can play and ends their turn`);
  finishTurn(g, false);
}

// ---- out-of-turn payments (Bad Blood, Indebted) ----------------------------------------

function outOfTurnBlocked(g: GameState): void {
  if (g.resolution) fail('Wait until the current card is resolved');
}

function payBadBlood(g: GameState, pid: PlayerId, statusId: unknown) {
  outOfTurnBlocked(g);
  const s = g.statuses.find((x) => x.id === statusId);
  if (!s || s.kind !== 'badBlood') fail('That Bad Blood is over');
  if (pid !== s.a && pid !== s.b) fail("This feud isn't yours to settle");
  if (g.players[pid].gold < 200) fail('You need 200 gold to settle it');
  const other = pid === s.a ? s.b : s.a;
  transfer(g, pid, other, 200, 'card:noble:bad_blood');
  g.statuses = g.statuses.filter((x) => x !== s);
  log(g, 'info', `${nameOf(g, pid)} pays ${nameOf(g, other)} 200 — the Bad Blood is over`);
}

function freeDebtor(g: GameState, pid: PlayerId, statusId: unknown) {
  outOfTurnBlocked(g);
  const s = g.statuses.find((x) => x.id === statusId);
  if (!s || s.kind !== 'debt') fail('That debt is gone');
  if (pid === s.debtor || pid === s.creditor) fail('Another player must pay to free them');
  if (g.players[pid].gold < 200) fail('You need 200 gold to free them');
  transfer(g, pid, s.creditor, 200, 'card:noble:indebted');
  g.statuses = g.statuses.filter((x) => x !== s);
  log(g, 'info', `${nameOf(g, pid)} pays ${nameOf(g, s.creditor)} 200 and frees ${nameOf(g, s.debtor)} from their debt`);
}


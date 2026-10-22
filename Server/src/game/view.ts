// What one player is allowed to see. Built from scratch for each player — the
// full state is never sent and hidden things are never "hidden with CSS":
// other players' hands, the decks, face-down card identities (unless you
// placed it), other people's offers and private log lines are simply absent.

import { canEndTurnEarly, placeLegality, playLegality } from './engine.js';
import { statusesOf } from './protection.js';
import { kingOf } from './state.js';
import type { GameState, LogEntry, PlayerId, PrivateReveal, Prompt, Response, Status } from './types.js';

export interface PromptView {
  id: string;
  kind: Prompt['kind'];
  title: string;
  text: string;
  who: PlayerId[];
  need: Prompt['need'];
  deadline: number;
  options?: Prompt['options'];
  players?: PlayerId[];
  notSelf?: boolean;
  sequential?: boolean;
  speech?: string;
  allowCustom?: boolean;
  answered: PlayerId[];
  responses: Record<PlayerId, Partial<Response>>; // empty for secret prompts
  mine: boolean; // you still need to answer
  private?: PrivateReveal;
}

function promptView(g: GameState, p: Prompt, pid: PlayerId): PromptView {
  const answered = Object.keys(p.responses);
  const responses: Record<PlayerId, Partial<Response>> = {};
  if (!p.secret) {
    for (const [id, r] of Object.entries(p.responses)) {
      responses[id] = r.kind === 'kingMaker' ? { kind: 'kingMaker', side: r.side } : r; // played King Makers are public; their ids are not
    }
  }
  const waitingOnMe = p.who.includes(pid) && !p.responses[pid] && (!p.sequential || p.who.find((id) => !p.responses[id]) === pid);
  return {
    id: p.id, kind: p.kind, title: p.title, text: p.text, who: p.who, need: p.need, deadline: p.deadline,
    options: p.options, players: p.players, notSelf: p.notSelf, sequential: p.sequential, speech: p.speech, allowCustom: p.allowCustom,
    answered, responses, mine: waitingOnMe,
    private: p.private?.[pid],
  };
}

const visible = (e: LogEntry, pid: PlayerId) => !e.to || e.to.includes(pid);

export function viewFor(g: GameState, pid: PlayerId) {
  const me = g.players[pid];
  const res = g.resolution;
  const myTurn = g.phase === 'playing' && g.turn?.playerId === pid;
  const hand = me
    ? me.hand.map((id) => ({ id, key: g.cards[id].key, play: playLegality(g, pid, id), place: placeLegality(g, pid, id) }))
    : [];
  const statuses: Status[] = g.statuses;
  return {
    you: pid,
    version: g.version,
    serverNow: Date.now(),
    round: g.round,
    phase: g.phase,
    direction: g.direction,
    kingId: kingOf(g).id,
    kingSeat: g.kingSeat,
    turnOrder: g.turnOrder.map((seat, i) => ({ seat, playerId: g.seats[seat], done: g.phase !== 'playing' || (g.turn ? i < g.turn.index : i < g.nextTurnIndex) })),
    turn: g.turn ? { playerId: g.turn.playerId, plays: g.turn.plays, allowance: g.turn.allowance } : null,
    players: g.seats.map((id) => {
      const p = g.players[id];
      return {
        id, name: p.name, seat: p.seat, role: p.role, gold: p.gold, handCount: p.hand.length,
        receivedInNegotiation: p.receivedInNegotiation, negotiationDone: p.negotiationDone,
        faceDown: g.faceDown
          .filter((f) => f.protectedId === id)
          .map((f) => ({
            slot: f.slot, placedBy: f.placedBy,
            deck: g.cards[f.cardId].deck, // the card's back is visible on the table
            cardKey: f.placedBy === pid ? g.cards[f.cardId].key : null,
          })),
      };
    }),
    statuses: statuses.map((s) => ('cardId' in s ? { ...s, cardId: undefined } : s)),
    resolution: res
      ? {
          id: res.id, kind: res.kind, actor: res.actor, cardKey: res.cardKey ?? null, option: res.option ?? null,
          setup: res.setup, step: res.step, prompt: res.prompt ? promptView(g, res.prompt, pid) : null,
        }
      : null,
    hand,
    legal: {
      myTurn,
      canEndTurn: myTurn ? canEndTurnEarly(g, pid) : false,
      payBadBlood: res ? [] : statusesOf(g, 'badBlood').filter((s) => (s.a === pid || s.b === pid) && (me?.gold ?? 0) >= 200).map((s) => s.id),
      freeDebtor: res ? [] : statusesOf(g, 'debt').filter((s) => s.debtor !== pid && s.creditor !== pid && (me?.gold ?? 0) >= 200).map((s) => s.id),
    },
    decks: { king: g.decks.king.length, noble: g.decks.noble.length, kingDiscard: g.discard.king.length, nobleDiscard: g.discard.noble.length },
    negotiation: g.negotiation
      ? {
          endsAt: g.negotiation.endsAt,
          offers: g.negotiation.offers
            .filter((o) => o.from === pid || o.to === pid)
            .map((o) => ({
              ...o,
              giveCardKey: o.giveCard ? g.cards[o.giveCard].key : null,
              discardCardKey: o.discardCard ? g.cards[o.discardCard].key : null,
              // the recipient never needs the proposer's card ids
              giveCard: o.from === pid ? o.giveCard : null,
              discardCard: o.from === pid ? o.discardCard : null,
            })),
        }
      : null,
    roundEnding: g.roundEnd !== null,
    log: g.log.filter((e) => visible(e, pid)).slice(-250),
    transactions: g.transactions.slice(-200),
    winner: g.winner,
  };
}

export type GameView = ReturnType<typeof viewFor>;

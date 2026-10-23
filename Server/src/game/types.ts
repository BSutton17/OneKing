// The complete, server-only game state. Nothing in here is ever sent to a
// client as-is: game/view.ts builds what each player is allowed to see.

export type PlayerId = string;
export type Role = 'king' | 'noble';
export type DeckName = 'king' | 'noble';
export type Phase = 'playing' | 'negotiation' | 'over';

export interface GameConfig {
  // inPerson: everyone is at the same table and talks out loud (no chat, no typed speeches);
  // virtual: remote play with chat, private messages and speech bubbles
  mode: 'inPerson' | 'virtual';
  negotiationMs: number; // official: 2 minutes (Rules p13)
  diceMode: 'digital' | 'physical'; // physical = rollers type the number they rolled (A18)
  kingCheck: 'onChange' | 'continuous'; // see docs/rule-audit.md A1
  // response windows (digital-edition additions, see rule audit)
  responseMs: number; // a single player's choice / pick
  voteMs: number;
  rollMs: number;
  speechMs: number;
  revealMs: number; // time to look at a hand you were shown
  betrayalSupportMs: number;
  betrayKingSupportMs: number;
  kingMakerMs: number;
  disconnectedTurnMs: number; // a disconnected player's turn is skipped after this (A17)
}

/** One physical card. Ids are random-looking so an id never reveals the card. */
export interface CardInstance {
  id: string;
  key: string; // catalog key, e.g. 'noble:betrayal'
  deck: DeckName;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  seat: number; // index into GameState.seats (the physical circle, clockwise)
  role: Role;
  gold: number;
  hand: string[]; // card ids
  receivedInNegotiation: number; // gold received through deals this negotiation phase (Rules p14)
  negotiationDone: boolean; // pressed "Done negotiating" (A15)
}

/** A card lying face down in front of a player, claimed to be a Knight. */
export interface FaceDown {
  slot: string; // public id, unrelated to the card id
  cardId: string;
  protectedId: PlayerId;
  placedBy: PlayerId;
}

/** When a timed status ends (A13). turnNo = the turn it was created in. */
export interface Expiry {
  at: 'turnStart' | 'turnEnd';
  playerId: PlayerId;
  afterTurnNo: number;
}

export type Status =
  | { id: string; kind: 'isolationLook'; playerId: PlayerId; expires: Expiry }
  | { id: string; kind: 'isolationGold'; playerId: PlayerId; expires: Expiry }
  | { id: string; kind: 'kingsEye'; playerId: PlayerId; by: PlayerId; expires: Expiry }
  | { id: string; kind: 'shiftingTides'; a: PlayerId; b: PlayerId; by: PlayerId; expires: Expiry }
  | { id: string; kind: 'badBlood'; owner: PlayerId; a: PlayerId; b: PlayerId }
  | { id: string; kind: 'debt'; creditor: PlayerId; debtor: PlayerId }
  | { id: string; kind: 'hindsight'; owner: PlayerId; backed: PlayerId; deadlineRound: number; cardId: string }
  | { id: string; kind: 'scout'; owner: PlayerId; backed: PlayerId; deadlineRound: number; cardId: string };

export type PromptKind =
  | 'choice' // pick one of `options`
  | 'player' // pick one of `players`
  | 'vote' // yes / no
  | 'support' // press Support (need N supporters)
  | 'roll' // roll a die
  | 'kingMaker' // play a King Maker on a side, or pass
  | 'card' // pick a card shown privately (or a blind position)
  | 'look' // look at cards shown privately, then continue
  | 'speech'; // say a line (posted to the table)

export interface PromptOption {
  value: string;
  label: string;
  disabled?: string; // reason it can't be picked
}

/** A question the game is waiting on. Lives inside a Resolution. */
export interface Prompt {
  id: string;
  kind: PromptKind;
  title: string;
  text: string;
  who: PlayerId[]; // who may answer (in order, when sequential)
  need: 'all' | number; // 'all' of who, or N "support"s
  responses: Record<PlayerId, Response>;
  deadline: number; // epoch ms
  options?: PromptOption[];
  players?: PlayerId[];
  notSelf?: boolean; // 'player': you may not pick yourself (Scapegoat)
  secret?: boolean; // answers hidden until everyone has answered
  sequential?: boolean; // answer one at a time in `who` order
  defaultValue?: string; // used for missing 'choice' answers at the deadline
  // per-player private content (cards shown to one player only)
  private?: Record<PlayerId, PrivateReveal>;
  speech?: string; // the line a 'speech' prompt asks for (default text)
  allowCustom?: boolean; // speech: may type their own words
}

export interface PrivateReveal {
  heading: string;
  cards: { key: string | null; id?: string }[]; // key null = face down / blind
  blind?: boolean; // pick by position, identities hidden
}

export type Response =
  | { kind: 'choice'; value: string }
  | { kind: 'player'; playerId: PlayerId }
  | { kind: 'vote'; yes: boolean }
  | { kind: 'support'; declined?: boolean }
  | { kind: 'roll'; value: number; auto?: boolean }
  | { kind: 'kingMaker'; cardId: string | null; side?: 'support' | 'oppose' }
  | { kind: 'card'; index: number | null } // null = take nothing
  | { kind: 'look' }
  | { kind: 'speech'; text: string; silent?: boolean };

export type Setup = Record<string, string | string[]>;

/** A card being resolved (or a system procedure such as a crown roll-off). */
export interface Resolution {
  id: string;
  kind: 'card' | 'rolloff';
  actor: PlayerId;
  cardId?: string;
  cardKey?: string;
  option?: number;
  setup: Setup;
  counted: boolean; // counts toward the actor's plays this turn
  step: string;
  data: Record<string, any>;
  prompt: Prompt | null;
  done: boolean;
  keepCard?: boolean; // card stays in front of its player (Hindsight, Scout)
}

export interface TurnState {
  index: number; // position in turnOrder
  seat: number;
  playerId: PlayerId;
  plays: number;
  allowance: number;
  baseDraw: number;
  startedAt: number;
  endNow?: boolean; // a crown change ended this turn (A3)
}

export interface Offer {
  id: string;
  from: PlayerId;
  to: PlayerId;
  giveGold: number;
  giveCard: string | null;
  discardCard: string | null; // proposer discards this card as part of the deal
  askGold: number;
  askCard: boolean; // recipient gives a card of their choice (required when giveCard is set)
  askDiscard: boolean; // recipient discards a card of their choice
  createdAt: number;
}

export interface LogEntry {
  id: string;
  t: number;
  round: number;
  // speech = a line a player typed (virtual); say = an instruction to speak out loud (in person)
  kind: 'info' | 'play' | 'gold' | 'dice' | 'crown' | 'round' | 'phase' | 'speech' | 'say' | 'private' | 'deal' | 'over';
  text: string;
  to?: PlayerId[]; // private entry: only these players see it
  actor?: PlayerId;
  cardKey?: string;
  claimId?: string; // a spoken line the rest of the table can overrule (C20)
}

/**
 * In person the game can't hear a line being said, so the speaker's tap is a
 * claim. Until the round ends, every other player can vote to overrule it;
 * if they all do, the speaker is treated as having refused (C20).
 */
export interface Claim {
  id: string;
  by: PlayerId;
  round: number;
  cardKey: string;
  text: string; // "Bob pledged their loyalty"
  penalty: string; // what overruling does, e.g. "Bob gives the 300 gold back to the bank"
  undo: { kind: 'gold'; amount: number; source: string } | { kind: 'cards'; cardIds: string[] };
  votes: PlayerId[]; // who wants to overrule
  open: boolean;
  overruled: boolean;
}

export interface Transaction {
  id: string;
  t: number;
  round: number;
  phase: Phase;
  from: PlayerId | 'bank';
  to: PlayerId | 'bank';
  amount: number; // what actually moved out of `from`
  received: number; // what actually arrived (less if the 2000 cap bit, A10)
  requested: number;
  source: string; // 'card:noble:wrath' | 'negotiation' | 'system:...'
  actionId: string;
}

export interface GameState {
  version: number;
  config: GameConfig;
  rng: number[];
  seq: number;
  players: Record<PlayerId, PlayerState>;
  seats: PlayerId[]; // seat index -> player (clockwise)
  kingSeat: number; // never changes: the new King takes the old King's seat
  round: number;
  phase: Phase;
  direction: 1 | -1; // 1 = clockwise
  turnOrder: number[]; // seats in this round's order, starting at the King
  turn: TurnState | null;
  nextTurnIndex: number; // position in turnOrder of the next turn to start
  turnNo: number;
  cards: Record<string, CardInstance>;
  decks: Record<DeckName, string[]>;
  discard: Record<DeckName, string[]>;
  faceDown: FaceDown[];
  statuses: Status[];
  claims: Claim[];
  resolution: Resolution | null;
  negotiation: { endsAt: number; offers: Offer[] } | null;
  // after negotiation: settle this round's predictions, then start the next round / end the game
  roundEnd: null | 'settle' | 'advance';
  // who gained (or whether the King lost) gold since the last crown check (A1)
  goldRisers: PlayerId[];
  kingLostGold: boolean;
  log: LogEntry[];
  transactions: Transaction[];
  winner: PlayerId | null;
  actionId: string; // id of the action currently being applied (for transactions)
  now: number; // the time of the action being applied
}

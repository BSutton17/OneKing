// The shapes the server sends (Server/src/game/view.ts, rooms/roomManager.ts).
// The client holds no rules: legality, targets and prompts all come from here.

export type PlayerId = string;
export type Role = 'king' | 'noble';

export interface CardDef {
  key: string;
  id: string;
  deck: Role;
  name: string;
  copies: number;
  printedText: string;
  options?: [string, string];
  dice?: string;
  timing?: string;
  targets: string;
  effect: string;
  notes?: string[];
  art: { full: string; small: string };
}

export interface FieldSpec {
  name: string;
  kind: 'player' | 'choice' | 'text' | 'order';
  label: string;
  choices?: { value: string; label: string }[];
  distinctFrom?: string[];
  maxLength?: number;
}

export interface OptionLegality { ok: boolean; reason?: string; fields: FieldSpec[] }

export interface HandCard {
  id: string;
  key: string;
  play: { ok: boolean; reason?: string; options: OptionLegality[] };
  place: { ok: boolean; reason?: string; targets: PlayerId[] };
}

export interface PlayerView {
  id: PlayerId;
  name: string;
  seat: number;
  role: Role;
  gold: number;
  handCount: number;
  receivedInNegotiation: number;
  negotiationDone: boolean;
  faceDown: { slot: string; placedBy: PlayerId; deck: Role; cardKey: string | null }[];
}

export type Status =
  | { id: string; kind: 'isolationLook' | 'isolationGold'; playerId: PlayerId }
  | { id: string; kind: 'kingsEye'; playerId: PlayerId; by: PlayerId }
  | { id: string; kind: 'shiftingTides'; a: PlayerId; b: PlayerId; by: PlayerId }
  | { id: string; kind: 'badBlood'; owner: PlayerId; a: PlayerId; b: PlayerId }
  | { id: string; kind: 'debt'; creditor: PlayerId; debtor: PlayerId }
  | { id: string; kind: 'hindsight' | 'scout'; owner: PlayerId; backed: PlayerId; deadlineRound: number };

export interface PromptView {
  id: string;
  kind: 'choice' | 'player' | 'vote' | 'support' | 'roll' | 'kingMaker' | 'card' | 'look' | 'speech';
  title: string;
  text: string;
  who: PlayerId[];
  need: 'all' | number;
  deadline: number;
  options?: { value: string; label: string; disabled?: string }[];
  players?: PlayerId[];
  notSelf?: boolean;
  sequential?: boolean;
  speech?: string;
  allowCustom?: boolean;
  answered: PlayerId[];
  responses: Record<PlayerId, { kind?: string; value?: number | string; yes?: boolean; playerId?: string; side?: string; declined?: boolean; auto?: boolean; text?: string }>;
  mine: boolean;
  private?: { heading: string; cards: { key: string | null }[]; blind?: boolean };
}

export interface Offer {
  id: string;
  from: PlayerId;
  to: PlayerId;
  giveGold: number;
  giveCard: string | null;
  giveCardKey: string | null;
  discardCard: string | null;
  discardCardKey: string | null;
  askGold: number;
  askCard: boolean;
  askDiscard: boolean;
  createdAt: number;
}

export interface LogEntry {
  id: string;
  t: number;
  round: number;
  kind: 'info' | 'play' | 'gold' | 'dice' | 'crown' | 'round' | 'phase' | 'speech' | 'private' | 'deal' | 'over';
  text: string;
  actor?: PlayerId;
  cardKey?: string;
}

export interface Transaction {
  id: string;
  t: number;
  round: number;
  from: PlayerId | 'bank';
  to: PlayerId | 'bank';
  amount: number;
  received: number;
  requested: number;
  source: string;
}

export interface GameView {
  you: PlayerId;
  version: number;
  serverNow: number;
  round: number;
  phase: 'playing' | 'negotiation' | 'over';
  direction: 1 | -1;
  kingId: PlayerId;
  kingSeat: number;
  turnOrder: { seat: number; playerId: PlayerId; done: boolean }[];
  turn: { playerId: PlayerId; plays: number; allowance: number } | null;
  players: PlayerView[];
  statuses: Status[];
  resolution: {
    id: string;
    kind: 'card' | 'rolloff';
    actor: PlayerId;
    cardKey: string | null;
    option: number | null;
    setup: Record<string, string | string[]>;
    step: string;
    prompt: PromptView | null;
  } | null;
  hand: HandCard[];
  legal: { myTurn: boolean; canEndTurn: boolean; payBadBlood: string[]; freeDebtor: string[] };
  decks: { king: number; noble: number; kingDiscard: number; nobleDiscard: number };
  negotiation: { endsAt: number; offers: Offer[] } | null;
  roundEnding: boolean;
  log: LogEntry[];
  transactions: Transaction[];
  winner: PlayerId | null;
}

export interface ChatMessage { id: string; from: PlayerId; to: PlayerId | null; text: string; t: number }

export interface RoomView {
  code: string;
  status: 'lobby' | 'playing' | 'over';
  hostId: PlayerId;
  settings: { negotiationSeconds: number; diceMode: 'digital' | 'physical' };
  you: PlayerId;
  members: { id: PlayerId; name: string; connected: boolean; since: number }[];
  limits: { min: number; max: number };
  game: GameView | null;
  chat: ChatMessage[];
}

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };

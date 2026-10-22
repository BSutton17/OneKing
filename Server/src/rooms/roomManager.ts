// Owns every room: the lobby and its seats, who is connected, the game state,
// chat, timers and saving. It knows nothing about socket.io — the socket layer
// calls these methods and re-broadcasts whenever `onChange` fires — which keeps
// it testable with fake timers. Rooms live in memory only: a refresh or a phone
// that slept reconnects to its seat with the token its browser kept.

import { randomInt, randomUUID } from 'node:crypto';
import { MAX_PLAYERS, MIN_PLAYERS, OFFICIAL_NEGOTIATION_MS } from '../game/config.js';
import { applyAction, createGame, endNegotiationEarly, nextDeadline, skipTurn, tick, type Action } from '../game/engine.js';
import type { GameState, PlayerId } from '../game/types.js';
import { viewFor } from '../game/view.js';

// Room codes are 4-digit numbers, 0000-9999 (as in Overlord)
const CODE_DIGITS = 4;
const CODE_SPACE = 10 ** CODE_DIGITS;
const MAX_NAME = 16;
const MAX_CHAT = 300;
const CHAT_KEEP = 400;
const RECENT_ACTIONS = 60;

export interface ChatMessage { id: string; from: PlayerId; to: PlayerId | null; text: string; t: number }
export interface Settings { mode: 'inPerson' | 'virtual'; negotiationSeconds: number; diceMode: 'digital' | 'physical' }

export interface Member {
  id: PlayerId;
  token: string;
  name: string;
  socketId: string | null;
  connected: boolean;
  since: number; // when they (dis)connected
  recentActions: string[]; // replay protection
  lastChat: number;
}

export interface Room {
  code: string;
  hostId: PlayerId;
  status: 'lobby' | 'playing' | 'over';
  members: Member[]; // seat order, clockwise
  settings: Settings;
  game: GameState | null;
  chat: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  chatSeq: number;
}

type Ok<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface ManagerOptions {
  now?: () => number;
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  onChange?: (room: Room) => void;
  onKick?: (socketId: string, reason: string) => void;
  lobbySeatGraceMs?: number; // a disconnected lobby member keeps their seat this long
  abandonedRoomMs?: number; // a room with nobody connected is deleted after this
  seed?: () => number; // game seeds (tests)
}

export function normalizeName(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '';
}

export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const code = String(raw).replace(/\s+/g, '');
  return /^\d{4}$/.test(code) ? code : null;
}

export class RoomManager {
  rooms = new Map<string, Room>();
  private sessions = new Map<string, { code: string; playerId: PlayerId }>(); // token ->
  private sockets = new Map<string, { code: string; playerId: PlayerId }>(); // socketId ->
  private timers = new Map<string, ReturnType<typeof setTimeout>>(); // per room: next game deadline
  private seatTimers = new Map<string, ReturnType<typeof setTimeout>>(); // per member
  private now: () => number;
  private t: NonNullable<ManagerOptions['timers']>;
  onChange: (room: Room) => void;
  onKick: (socketId: string, reason: string) => void;
  private lobbySeatGraceMs: number;
  private abandonedRoomMs: number;
  private seed: () => number | undefined;

  constructor(opts: ManagerOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.t = opts.timers ?? { setTimeout, clearTimeout };
    this.onChange = opts.onChange ?? (() => {});
    this.onKick = opts.onKick ?? (() => {});
    this.lobbySeatGraceMs = opts.lobbySeatGraceMs ?? 60_000;
    this.abandonedRoomMs = opts.abandonedRoomMs ?? 6 * 60 * 60_000;
    this.seed = opts.seed ?? (() => undefined);
  }

  // ---- lookups ----------------------------------------------------------------

  private where(socketId: string): { room: Room; member: Member } | null {
    const w = this.sockets.get(socketId);
    const room = w && this.rooms.get(w.code);
    const member = room?.members.find((m) => m.id === w!.playerId);
    return room && member ? { room, member } : null;
  }

  private host(socketId: string): { room: Room; member: Member } | string {
    const found = this.where(socketId);
    if (!found) return 'You are not in a room';
    if (found.room.hostId !== found.member.id) return 'Only the host can do that';
    if (found.room.status !== 'lobby') return 'The game has already started';
    return found;
  }

  // ---- joining & leaving ----------------------------------------------------------

  create({ socketId, name }: { socketId: string; name: unknown }): Ok<{ code: string; token: string; playerId: string }> {
    const clean = normalizeName(name);
    if (!clean) return { ok: false, error: 'Please enter your name' };
    this.leave(socketId);
    const code = this.newCode();
    const now = this.now();
    const room: Room = {
      code, hostId: '', status: 'lobby', members: [], game: null, chat: [], createdAt: now, updatedAt: now, chatSeq: 0,
      settings: { mode: 'inPerson', negotiationSeconds: OFFICIAL_NEGOTIATION_MS / 1000, diceMode: 'digital' },
    };
    this.rooms.set(code, room);
    const m = this.addMember(room, socketId, clean);
    room.hostId = m.id;
    this.changed(room);
    return { ok: true, code, token: m.token, playerId: m.id };
  }

  join({ socketId, name, code }: { socketId: string; name: unknown; code: unknown }): Ok<{ code: string; token: string; playerId: string }> {
    const clean = normalizeName(name);
    if (!clean) return { ok: false, error: 'Please enter your name' };
    const c = normalizeCode(code);
    const room = c ? this.rooms.get(c) : undefined;
    if (!room) return { ok: false, error: c ? `No room with code ${c}` : 'Room codes are 4 digits, like 0427' };
    if (room.status !== 'lobby') return { ok: false, error: 'That game has already started' };
    if (room.members.length >= MAX_PLAYERS) return { ok: false, error: `That room is full (${MAX_PLAYERS} players)` };
    this.leave(socketId);
    const m = this.addMember(room, socketId, clean);
    this.changed(room);
    return { ok: true, code: room.code, token: m.token, playerId: m.id };
  }

  private addMember(room: Room, socketId: string, name: string): Member {
    let final = name;
    for (let k = 2; room.members.some((m) => m.name.toLowerCase() === final.toLowerCase()); k++) final = `${name.slice(0, MAX_NAME - 2)} ${k}`;
    const m: Member = { id: `p${randomUUID().slice(0, 8)}`, token: randomUUID(), name: final, socketId, connected: true, since: this.now(), recentActions: [], lastChat: 0 };
    room.members.push(m);
    this.sessions.set(m.token, { code: room.code, playerId: m.id });
    this.sockets.set(socketId, { code: room.code, playerId: m.id });
    return m;
  }

  /** Re-attach a (re)connected socket to the seat its token belongs to. */
  resume({ socketId, token }: { socketId: string; token: unknown }): Ok<{ code: string; playerId: string }> {
    const s = typeof token === 'string' ? this.sessions.get(token) : undefined;
    const room = s && this.rooms.get(s.code);
    const m = room?.members.find((x) => x.id === s!.playerId);
    if (!room || !m || m.token !== token) return { ok: false, error: 'That game no longer exists' };
    if (m.socketId && m.socketId !== socketId) {
      this.sockets.delete(m.socketId);
      if (m.connected) this.onKick(m.socketId, 'You opened this game somewhere else');
    }
    const prev = this.sockets.get(socketId);
    if (prev && prev.code !== room.code) this.leave(socketId);
    m.socketId = socketId;
    m.connected = true;
    m.since = this.now();
    this.clearSeatTimer(m.id);
    this.sockets.set(socketId, { code: room.code, playerId: m.id });
    this.changed(room);
    return { ok: true, code: room.code, playerId: m.id };
  }

  /** The player pressed Leave. In the lobby they give up their seat; mid-game the seat is kept (A17). */
  leave(socketId: string): Ok {
    const found = this.where(socketId);
    this.sockets.delete(socketId);
    if (!found) return { ok: true };
    const { room, member } = found;
    if (room.status === 'playing') {
      member.connected = false;
      member.socketId = null;
      member.since = this.now();
      this.changed(room);
      return { ok: true };
    }
    this.removeMember(room, member);
    return { ok: true };
  }

  private removeMember(room: Room, member: Member) {
    this.sessions.delete(member.token);
    if (member.socketId) this.sockets.delete(member.socketId);
    this.clearSeatTimer(member.id);
    room.members = room.members.filter((m) => m !== member);
    if (!room.members.length) return this.deleteRoom(room.code);
    if (room.hostId === member.id) room.hostId = (room.members.find((m) => m.connected) ?? room.members[0]).id;
    this.changed(room);
  }

  disconnect(socketId: string): void {
    const found = this.where(socketId);
    this.sockets.delete(socketId);
    if (!found || found.member.socketId !== socketId) return;
    const { room, member } = found;
    member.connected = false;
    member.socketId = null;
    member.since = this.now();
    if (room.status !== 'playing') {
      // in the lobby (or after the game) the seat is freed if they don't come back
      this.setSeatTimer(member.id, this.lobbySeatGraceMs, () => {
        const r = this.rooms.get(room.code);
        const m = r?.members.find((x) => x.id === member.id);
        if (r && m && !m.connected && r.status !== 'playing') this.removeMember(r, m);
      });
    }
    this.changed(room);
  }

  // ---- lobby (host only) ----------------------------------------------------------------

  settings(socketId: string, input: { mode?: unknown; negotiationSeconds?: unknown; diceMode?: unknown }): Ok {
    const h = this.host(socketId);
    if (typeof h === 'string') return { ok: false, error: h };
    const s = h.room.settings;
    if (input.mode !== undefined) {
      if (input.mode !== 'inPerson' && input.mode !== 'virtual') return { ok: false, error: 'Unknown mode' };
      s.mode = input.mode;
    }
    if (input.negotiationSeconds !== undefined) {
      const v = Number(input.negotiationSeconds);
      if (![60, 120, 180, 300].includes(v)) return { ok: false, error: 'Pick 1, 2 (official), 3 or 5 minutes' };
      s.negotiationSeconds = v;
    }
    if (input.diceMode !== undefined) {
      if (input.diceMode !== 'digital' && input.diceMode !== 'physical') return { ok: false, error: 'Unknown dice mode' };
      s.diceMode = input.diceMode;
    }
    this.changed(h.room);
    return { ok: true };
  }

  /** Arrange seats to match the real table (seat order is clockwise). */
  moveSeat(socketId: string, playerId: unknown, dir: unknown): Ok {
    const h = this.host(socketId);
    if (typeof h === 'string') return { ok: false, error: h };
    const list = h.room.members;
    const i = list.findIndex((m) => m.id === playerId);
    const j = i + (dir === -1 ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return { ok: false, error: "Can't move that seat" };
    [list[i], list[j]] = [list[j], list[i]];
    this.changed(h.room);
    return { ok: true };
  }

  kick(socketId: string, playerId: unknown): Ok {
    const h = this.host(socketId);
    if (typeof h === 'string') return { ok: false, error: h };
    const m = h.room.members.find((x) => x.id === playerId);
    if (!m || m.id === h.member.id) return { ok: false, error: "Can't remove that player" };
    if (m.socketId) this.onKick(m.socketId, 'The host removed you from the room');
    this.removeMember(h.room, m);
    return { ok: true };
  }

  start(socketId: string): Ok {
    const h = this.host(socketId);
    if (typeof h === 'string') return { ok: false, error: h };
    const { room } = h;
    const n = room.members.length;
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) return { ok: false, error: `You need ${MIN_PLAYERS}–${MAX_PLAYERS} players (you have ${n})` };
    if (room.members.some((m) => !m.connected)) return { ok: false, error: 'Wait for everyone to reconnect' };
    room.members.forEach((m) => this.clearSeatTimer(m.id));
    room.game = createGame(room.members.map((m) => ({ id: m.id, name: m.name })), {
      now: this.now(), seed: this.seed(),
      config: { mode: room.settings.mode, negotiationMs: room.settings.negotiationSeconds * 1000, diceMode: room.settings.diceMode },
    });
    room.status = 'playing';
    room.members.forEach((m) => (m.recentActions = []));
    this.changed(room);
    return { ok: true };
  }

  /** After the game: everyone back to the lobby, same room and seats. */
  backToLobby(socketId: string): Ok {
    const found = this.where(socketId);
    if (!found || found.room.status !== 'over') return { ok: false, error: 'The game is not over' };
    if (found.room.hostId !== found.member.id) return { ok: false, error: 'Only the host can do that' };
    const room = found.room;
    room.status = 'lobby';
    room.game = null;
    for (const m of [...room.members]) if (!m.connected) this.removeMember(room, m);
    this.changed(room);
    return { ok: true };
  }

  // ---- playing ------------------------------------------------------------------------------

  act(socketId: string, raw: unknown): Ok<{ duplicate?: boolean }> {
    const found = this.where(socketId);
    if (!found) return { ok: false, error: 'You are not in a room' };
    const { room, member } = found;
    if (room.status !== 'playing' || !room.game) return { ok: false, error: 'The game is not running' };
    const action = (raw && typeof raw === 'object' ? raw : {}) as Action & { actionId?: unknown };
    const actionId = typeof action.actionId === 'string' && action.actionId.length <= 64 ? action.actionId : null;
    if (!actionId) return { ok: false, error: 'Missing action id' };
    if (member.recentActions.includes(actionId)) return { ok: true, duplicate: true }; // a resend: already done
    const result = applyAction(room.game, member.id, action, { now: this.now(), actionId });
    if (!result.ok) return result;
    member.recentActions.push(actionId);
    if (member.recentActions.length > RECENT_ACTIONS) member.recentActions.shift();
    this.setGame(room, result.state);
    return { ok: true };
  }

  chat(socketId: string, input: { to?: unknown; text?: unknown }): Ok {
    const found = this.where(socketId);
    if (!found) return { ok: false, error: 'You are not in a room' };
    const { room, member } = found;
    if (room.settings.mode === 'inPerson') return { ok: false, error: "You're at the same table — say it out loud!" };
    const text = typeof input.text === 'string' ? input.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_CHAT) : '';
    if (!text) return { ok: false, error: 'Say something' };
    const to = input.to === null || input.to === undefined || input.to === '' ? null : String(input.to);
    if (to && (to === member.id || !room.members.some((m) => m.id === to))) return { ok: false, error: 'Unknown player' };
    const now = this.now();
    if (now - member.lastChat < 400) return { ok: false, error: 'Slow down!' };
    member.lastChat = now;
    room.chat.push({ id: `m${++room.chatSeq}`, from: member.id, to, text, t: now });
    if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
    this.changed(room);
    return { ok: true };
  }

  // ---- what each player sees ----------------------------------------------------------------

  view(room: Room, playerId: PlayerId) {
    return {
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      settings: room.settings,
      you: playerId,
      members: room.members.map((m) => ({ id: m.id, name: m.name, connected: m.connected, since: m.since })),
      limits: { min: MIN_PLAYERS, max: MAX_PLAYERS },
      game: room.game ? viewFor(room.game, playerId) : null,
      // public messages, plus private ones you sent or received — nobody else's
      chat: room.chat.filter((c) => c.to === null || c.to === playerId || c.from === playerId).slice(-200),
    };
  }

  // ---- time -------------------------------------------------------------------------------------

  private setGame(room: Room, game: GameState) {
    room.game = game;
    if (game.phase === 'over') room.status = 'over';
    this.changed(room);
  }

  /**
   * After every change: end negotiation early if everyone is done, re-arm the
   * room's timer. Returns true if it moved the game on (and so already announced it).
   */
  private schedule(room: Room): boolean {
    const old = this.timers.get(room.code);
    if (old) this.t.clearTimeout(old);
    this.timers.delete(room.code);
    const g = room.game;
    if (room.status !== 'playing' || !g) return false;
    const now = this.now();

    // A15: every connected player is done negotiating
    if (g.phase === 'negotiation' && g.negotiation && !g.resolution) {
      const online = room.members.filter((m) => m.connected);
      if (online.length && online.every((m) => g.players[m.id]?.negotiationDone)) {
        const next = endNegotiationEarly(g, now);
        if (next) {
          this.setGame(room, next);
          return true;
        }
      }
    }
    const due: number[] = [];
    const deadline = nextDeadline(g);
    if (deadline !== null) due.push(deadline);
    // A17: a disconnected player's turn is skipped after a while
    if (g.phase === 'playing' && g.turn && !g.resolution) {
      const m = room.members.find((x) => x.id === g.turn!.playerId);
      if (m && !m.connected) due.push(Math.max(m.since, g.turn.startedAt) + g.config.disconnectedTurnMs);
    }
    if (!due.length) return false;
    const at = Math.min(...due);
    const timer = this.t.setTimeout(() => this.fire(room.code), Math.max(0, at - now) + 5);
    (timer as { unref?: () => void }).unref?.();
    this.timers.set(room.code, timer);
    return false;
  }

  /** A timer went off (also called directly by tests). */
  fire(code: string): void {
    const room = this.rooms.get(code);
    if (!room?.game || room.status !== 'playing') return;
    const now = this.now();
    let g: GameState = room.game;
    const ticked = tick(g, now);
    if (ticked) g = ticked;
    if (g.phase === 'playing' && g.turn && !g.resolution) {
      const m = room.members.find((x) => x.id === g.turn!.playerId);
      if (m && !m.connected && now >= Math.max(m.since, g.turn.startedAt) + g.config.disconnectedTurnMs) g = skipTurn(g, now) ?? g;
    }
    if (g !== room.game) this.setGame(room, g);
    else this.schedule(room);
  }

  /** Delete rooms nobody has been connected to for a long time (call periodically). */
  sweep(): void {
    const now = this.now();
    for (const room of [...this.rooms.values()]) {
      if (room.members.some((m) => m.connected)) continue;
      const lastSeen = Math.max(room.updatedAt, ...room.members.map((m) => m.since));
      const limit = room.status === 'playing' ? this.abandonedRoomMs : Math.min(this.abandonedRoomMs, 30 * 60_000);
      if (now - lastSeen > limit) this.deleteRoom(room.code);
    }
  }

  stats() {
    let playing = 0;
    for (const r of this.rooms.values()) if (r.status === 'playing') playing++;
    return { rooms: this.rooms.size, playing };
  }

  dispose(): void {
    for (const t of this.timers.values()) this.t.clearTimeout(t);
    for (const t of this.seatTimers.values()) this.t.clearTimeout(t);
    this.timers.clear();
    this.seatTimers.clear();
  }

  // ---- internals --------------------------------------------------------------------------------

  private changed(room: Room) {
    if (!this.rooms.has(room.code)) return;
    room.updatedAt = this.now();
    if (this.schedule(room)) return;
    this.onChange(room);
  }

  private deleteRoom(code: string) {
    const room = this.rooms.get(code);
    if (!room) return;
    const t = this.timers.get(code);
    if (t) this.t.clearTimeout(t);
    this.timers.delete(code);
    for (const m of room.members) {
      this.sessions.delete(m.token);
      this.clearSeatTimer(m.id);
      if (m.socketId) this.sockets.delete(m.socketId);
    }
    this.rooms.delete(code);
  }

  /** A random free 4-digit code (walks on from a random start when nearly full). */
  private newCode(): string {
    if (this.rooms.size >= CODE_SPACE) throw new Error('Every room code is in use');
    const start = randomInt(CODE_SPACE);
    for (let k = 0; k < CODE_SPACE; k++) {
      const code = String((start + k) % CODE_SPACE).padStart(CODE_DIGITS, '0');
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Every room code is in use');
  }

  private setSeatTimer(id: string, ms: number, fn: () => void) {
    this.clearSeatTimer(id);
    const t = this.t.setTimeout(() => {
      this.seatTimers.delete(id);
      fn();
    }, ms);
    (t as { unref?: () => void }).unref?.();
    this.seatTimers.set(id, t);
  }

  private clearSeatTimer(id: string) {
    const t = this.seatTimers.get(id);
    if (t) this.t.clearTimeout(t);
    this.seatTimers.delete(id);
  }
}

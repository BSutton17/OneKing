// Translates socket.io events into RoomManager calls.
//
// Client -> server (each takes a payload object and an ack callback; the ack
// gets { ok: true, ... } or { ok: false, error }):
//   room:create   { name }                       new private room; you are host
//   room:join     { name, code }                 join a lobby by its 4-digit code
//   room:resume   { token }                      re-attach after a refresh / dropped connection
//   room:leave    {}
//   room:settings { mode?, negotiationSeconds?, diceMode? }   host, lobby (mode: inPerson | virtual)
//   room:seat     { playerId, dir: -1 | 1 }      host, lobby: move a seat
//   room:kick     { playerId }                   host, lobby
//   room:start    {}                             host, lobby, 4-8 players
//   room:lobby    {}                             host, after the game
//   game:action   { actionId, type, ... }        see game/engine.ts Action
//   game:skip     { playerId }                   host, mid-game: skip that player's turn
//   game:remove   { playerId }                   host, mid-game: remove that player from the game
//   chat:send     { to: playerId | null, text }  null = everyone; virtual games only
//
// Server -> client:
//   server:hello  { cards }      the card catalog (text, art paths), once per connection
//   room:state    <view>         everything this player may see, on every change
//   room:closed   { reason }     you were removed / opened the game elsewhere

import type { Server } from 'socket.io';
import { CARDS } from '../cards/catalog.js';
import type { RoomManager } from '../rooms/roomManager.js';

const MAX_EVENTS_PER_SECOND = 20;

export function attachHandlers(io: Server, manager: RoomManager, { log = console }: { log?: Pick<Console, 'error'> } = {}) {
  manager.onChange = (room) => {
    for (const m of room.members) {
      if (m.connected && m.socketId) io.to(m.socketId).emit('room:state', manager.view(room, m.id));
    }
  };
  manager.onKick = (socketId, reason) => io.to(socketId).emit('room:closed', { reason });

  io.on('connection', (socket) => {
    socket.emit('server:hello', { cards: CARDS });

    let windowStart = Date.now();
    let count = 0;
    const allowed = () => {
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        count = 0;
      }
      count += 1;
      return count <= MAX_EVENTS_PER_SECOND;
    };

    // every handler gets a plain-object payload and a callable ack, and can never take the server down
    const on = (event: string, handler: (body: Record<string, unknown>) => unknown) => {
      socket.on(event, (payload: unknown, ack: unknown) => {
        const reply = typeof ack === 'function' ? (ack as (r: unknown) => void) : () => {};
        if (!allowed()) return reply({ ok: false, error: 'Slow down!' });
        const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
        try {
          reply(handler(body) ?? { ok: true });
        } catch (err) {
          log.error(`[${event}] failed:`, err);
          reply({ ok: false, error: 'Something went wrong on the server' });
        }
      });
    };

    on('room:create', ({ name }) => manager.create({ socketId: socket.id, name }));
    on('room:join', ({ name, code }) => manager.join({ socketId: socket.id, name, code }));
    on('room:resume', ({ token }) => manager.resume({ socketId: socket.id, token }));
    on('room:leave', () => manager.leave(socket.id));
    on('room:settings', (b) => manager.settings(socket.id, b));
    on('room:seat', ({ playerId, dir }) => manager.moveSeat(socket.id, playerId, dir));
    on('room:kick', ({ playerId }) => manager.kick(socket.id, playerId));
    on('room:start', () => manager.start(socket.id));
    on('room:lobby', () => manager.backToLobby(socket.id));
    on('game:action', (action) => manager.act(socket.id, action));
    on('game:skip', ({ playerId }) => manager.hostSkipTurn(socket.id, playerId));
    on('game:remove', ({ playerId }) => manager.hostRemove(socket.id, playerId));
    on('chat:send', (b) => manager.chat(socket.id, b));

    socket.on('disconnect', () => manager.disconnect(socket.id));
  });
}

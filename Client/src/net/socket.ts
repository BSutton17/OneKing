// The one connection to the game server, plus a tiny store the UI subscribes
// to. The server is authoritative: the client only sends requests and renders
// whatever room:state says.

import { useSyncExternalStore } from 'react';
import { io } from 'socket.io-client';
import type { Ack, CardDef, RoomView } from '../lib/types';

const SERVER_URL: string = import.meta.env.VITE_SERVER_URL || `${location.protocol}//${location.hostname}:3001`;
const SESSION_KEY = 'okoc.session';
const NAME_KEY = 'okoc.name';

export interface Toast { id: number; text: string; tone: 'error' | 'info' | 'speech'; who?: string }

interface Store {
  connected: boolean;
  everConnected: boolean;
  room: RoomView | null;
  cards: Record<string, CardDef>;
  clockOffset: number; // server time - local time
  notice: string | null; // shown on the landing page (e.g. "the room was closed")
  toasts: Toast[];
}

let state: Store = { connected: false, everConnected: false, room: null, cards: {}, clockOffset: 0, notice: null, toasts: [] };
const listeners = new Set<() => void>();
const set = (patch: Partial<Store>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Subscribe to one slice of the store (return a value from the store, not a new object). */
export function useStore<T>(select: (s: Store) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}
export const getStore = () => state;

// ---- toasts --------------------------------------------------------------------------

let toastSeq = 0;
export function toast(text: string, tone: Toast['tone'] = 'error', who?: string) {
  const t = { id: ++toastSeq, text, tone, who };
  set({ toasts: [...state.toasts, t].slice(-4) });
  setTimeout(() => set({ toasts: state.toasts.filter((x) => x.id !== t.id) }), tone === 'speech' ? 5000 : 3500);
}

// ---- session -------------------------------------------------------------------------

const loadSession = (): { token: string; code: string } | null => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
  } catch {
    return null;
  }
};
const saveSession = (s: { token: string; code: string }) => {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* private mode: the session just won't survive a refresh */
  }
};
const clearSession = () => {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
};
export const savedName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
};
const rememberName = (name: string) => {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
};

// ---- connection ------------------------------------------------------------------------

export const socket = io(SERVER_URL, { transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });

socket.on('connect', () => {
  set({ connected: true, everConnected: true });
  const s = loadSession();
  if (s) {
    socket.emit('room:resume', { token: s.token }, (r: Ack) => {
      if (!r.ok) {
        clearSession();
        set({ room: null, notice: r.error });
      }
    });
  }
});
socket.on('disconnect', () => set({ connected: false }));
socket.on('server:hello', ({ cards }: { cards: CardDef[] }) => set({ cards: Object.fromEntries(cards.map((c) => [c.key, c])) }));
socket.on('room:state', (room: RoomView) => {
  set({ room, clockOffset: room.game ? room.game.serverNow - Date.now() : state.clockOffset, notice: null });
});
socket.on('room:closed', ({ reason }: { reason: string }) => {
  clearSession();
  set({ room: null, notice: reason });
});

// randomUUID only exists on https / localhost — phones on a LAN dev server use plain http
const newId = () => (typeof globalThis.crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

function emit<T = object>(event: string, payload: object = {}, timeoutMs = 8000): Promise<Ack<T>> {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve({ ok: false, error: 'Not connected to the server — reconnecting…' });
    socket.timeout(timeoutMs).emit(event, payload, (err: unknown, r: Ack<T>) => {
      resolve(err ? { ok: false, error: 'The server did not answer — try again' } : r);
    });
  });
}

/** Show the error of a failed request as a toast; returns whether it worked. */
async function run<T>(p: Promise<Ack<T>>): Promise<Ack<T>> {
  const r = await p;
  if (!r.ok) toast(r.error);
  return r;
}

// ---- requests ----------------------------------------------------------------------------

export const api = {
  async create(name: string) {
    rememberName(name);
    const r = await run(emit<{ code: string; token: string }>('room:create', { name }));
    if (r.ok) saveSession({ token: r.token, code: r.code });
    return r;
  },
  async join(name: string, code: string) {
    rememberName(name);
    const r = await run(emit<{ code: string; token: string }>('room:join', { name, code }));
    if (r.ok) saveSession({ token: r.token, code: r.code });
    return r;
  },
  async leave() {
    await emit('room:leave');
    clearSession();
    set({ room: null });
  },
  settings: (s: { negotiationSeconds?: number; diceMode?: string }) => run(emit('room:settings', s)),
  seat: (playerId: string, dir: -1 | 1) => run(emit('room:seat', { playerId, dir })),
  kick: (playerId: string) => run(emit('room:kick', { playerId })),
  start: () => run(emit('room:start')),
  lobby: () => run(emit('room:lobby')),
  chat: (to: string | null, text: string) => run(emit('chat:send', { to, text })),
  /** A game action. If the answer is lost, it is resent with the same id (the server ignores repeats). */
  async act(action: { type: string } & Record<string, unknown>) {
    const payload = { ...action, actionId: newId() };
    let r = await emit('game:action', payload);
    if (!r.ok && /did not answer/.test(r.error)) r = await emit('game:action', payload);
    if (!r.ok) toast(r.error);
    return r;
  },
};

export const serverUrl = SERVER_URL;

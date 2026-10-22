// Heroku eco dynos sleep after 30 minutes without an HTTP request, and an open
// socket doesn't count as one — so a long game could get the server put to
// sleep mid-round, wiping the room it holds in memory. While a game runs we
// ping /ping over plain HTTP every 10 minutes. If the game goes quiet (no
// server events for 30 minutes — a tab left open) we stop, so the dyno can
// still sleep and save eco hours. Same idea as Hypo's keepAwake.js.

import type { Socket } from 'socket.io-client';

const PING_EVERY_MS = 10 * 60 * 1000;
const STOP_AFTER_IDLE_MS = 30 * 60 * 1000;

/** Starts pinging; returns a cleanup function (handy as a useEffect return). */
export function keepServerAwake(serverUrl: string, socket: Socket): () => void {
  let lastActivity = Date.now();
  const markActive = () => {
    lastActivity = Date.now();
  };
  socket.onAny(markActive);
  const ping = () => {
    if (Date.now() - lastActivity > STOP_AFTER_IDLE_MS) return;
    fetch(new URL('/ping', serverUrl), { cache: 'no-store' }).catch(() => {
      // asleep or unreachable — the socket's own reconnect handles that
    });
  };
  ping();
  const timer = setInterval(ping, PING_EVERY_MS);
  return () => {
    clearInterval(timer);
    socket.offAny(markActive);
  };
}

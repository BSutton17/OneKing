import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { RoomManager, type ManagerOptions } from './rooms/roomManager.js';
import { attachHandlers } from './socket/handlers.js';

export function createServer({
  clientOrigins = '*' as string | string[],
  manager: managerOptions = {},
  log = console,
}: { clientOrigins?: string | string[]; manager?: ManagerOptions; log?: Pick<Console, 'error' | 'log'> } = {}) {
  const app = express();
  app.use(cors({ origin: clientOrigins }));

  const manager = new RoomManager(managerOptions);
  const sweeper = setInterval(() => manager.sweep(), 60_000);
  sweeper.unref();

  app.get('/', (_req, res) => {
    res.send('One King One Crown server is running');
  });
  app.get('/health', (_req, res) => {
    res.json({ ok: true, ...manager.stats() });
  });
  // the client pings this during a game so a Heroku eco dyno doesn't fall asleep
  app.get('/ping', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ ok: true, t: Date.now() });
  });

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: clientOrigins, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 32 * 1024, // game messages are tiny; refuse anything big
  });
  attachHandlers(io, manager, { log });

  const close = async () => {
    clearInterval(sweeper);
    manager.dispose();
    await new Promise<void>((resolve) => io.close(() => resolve()));
  };

  return { app, httpServer, io, manager, close };
}

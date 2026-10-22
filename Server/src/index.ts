import path from 'node:path';
import { FileStore, MongoStore, type RoomStore } from './persistence/store.js';
import { createServer } from './server.js';

const port = Number(process.env.PORT) || 3001;
// default '*': no cookies are used, and phones on your Wi-Fi load the client from your LAN address
const origins = (process.env.CLIENT_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
const clientOrigins = origins.includes('*') ? '*' : origins;

let store: RoomStore;
if (process.env.MONGODB_URI) {
  store = await MongoStore.connect(process.env.MONGODB_URI);
  console.log('Saving rooms to MongoDB');
} else {
  const dir = path.resolve(process.env.DATA_DIR || './data');
  store = new FileStore(dir);
  console.log(`Saving rooms to ${dir}`);
}

const server = await createServer({ clientOrigins, store });
server.httpServer.listen(port, () => console.log(`One King One Crown server listening on :${port}`));

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

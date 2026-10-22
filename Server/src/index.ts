import { createServer } from './server.js';

const port = Number(process.env.PORT) || 3001;
// default '*': no cookies are used, and phones on your Wi-Fi load the client from your LAN address
// browsers send an origin without a trailing slash, so "https://x.app/" must match "https://x.app"
const origins = (process.env.CLIENT_ORIGINS || '*').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const clientOrigins = origins.includes('*') ? '*' : origins;

const server = createServer({ clientOrigins });
server.httpServer.listen(port, () => console.log(`One King One Crown server listening on :${port}`));

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

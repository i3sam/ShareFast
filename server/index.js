import http from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { ShareStore } from './store.js';

const SWEEP_INTERVAL_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 2 * 60 * 60 * 1000;

const config = loadConfig();
const store = new ShareStore({ dir: config.dataDir });
await store.init();

const server = http.createServer({ requestTimeout: UPLOAD_TIMEOUT_MS }, createApp({ store, config }));

const sweeper = setInterval(async () => {
  try {
    await store.sweep();
  } catch (error) {
    console.error('Failed to remove expired shares:', error);
  }
}, SWEEP_INTERVAL_MS);

server.listen(config.port, config.host, () => {
  console.log(`ShareFast is running on http://localhost:${config.port}`);
});

function shutdown() {
  clearInterval(sweeper);
  server.close(() => process.exit(0));
  server.closeAllConnections();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

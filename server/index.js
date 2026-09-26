import http from 'node:http';
import { createApp } from './app.js';
import { createBackend } from './backends/index.js';
import { loadConfig } from './config.js';

const SWEEP_INTERVAL_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 2 * 60 * 60 * 1000;

const config = loadConfig();
const backend = await createBackend(config);

const server = http.createServer({ requestTimeout: UPLOAD_TIMEOUT_MS }, createApp({ backend, config }));

const sweeper = setInterval(async () => {
  try {
    await backend.sweep();
  } catch (error) {
    console.error('Failed to remove expired shares:', error);
  }
}, SWEEP_INTERVAL_MS);

server.listen(config.port, config.host, () => {
  console.log(`ShareFast is running on http://localhost:${config.port} (${backend.constructor.name})`);
});

function shutdown() {
  clearInterval(sweeper);
  server.close(() => process.exit(0));
  server.closeAllConnections();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

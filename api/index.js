import { createApp } from '../server/app.js';
import { createBackend } from '../server/backends/index.js';
import { loadConfig } from '../server/config.js';
import { sendJson } from '../server/http.js';

// Vercel entry point. vercel.json rewrites every /api/* request here and
// passes the original path along as ?__route=..., which is restored below
// so the normal router can handle it.

const config = loadConfig();
const app = createBackend(config).then(
  (backend) => createApp({ backend, config, serveStaticFiles: false }),
  (error) => error,
);

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const route = url.searchParams.get('__route');
  if (route !== null) {
    url.searchParams.delete('__route');
    url.pathname = `/api/${route}`;
    req.url = `${url.pathname}${url.search}`;
  }

  const handle = await app;
  if (handle instanceof Error) {
    sendJson(res, 503, { error: handle.message });
    return;
  }
  await handle(req, res);
}

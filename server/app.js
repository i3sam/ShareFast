import { createApi } from './api.js';
import { HttpError, sendJson } from './http.js';
import { serveStatic } from './static.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export function createApp({ backend, config, serveStaticFiles = true }) {
  const handleApi = createApi({ backend, config });

  return async function handleRequest(req, res) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(name, value);
    }

    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
      } else if (serveStaticFiles) {
        await serveStatic(req, res, url.pathname);
      } else {
        throw new HttpError(404, 'Not found.');
      }
    } catch (error) {
      respondWithError(res, error);
    }
  };
}

function respondWithError(res, error) {
  const isHttpError = error instanceof HttpError;
  const clientWentAway = error?.code === 'ERR_STREAM_PREMATURE_CLOSE' || error?.code === 'ECONNRESET';

  if (!isHttpError && !clientWentAway) console.error(error);

  if (res.headersSent || res.destroyed) {
    res.destroy();
    return;
  }

  if (isHttpError) {
    // Upload errors can fire before the body is read; close so the client stops sending.
    sendJson(res, error.status, { error: error.message }, { Connection: 'close', ...error.headers });
  } else {
    sendJson(res, 500, { error: 'Server error.' });
  }
}

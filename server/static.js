import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { HttpError } from './http.js';
import { isValidSlug } from './slug.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

// Kept in sync with vercel.json by a test. The Vercel Blob hosts are only
// used when files live in Blob storage.
export const PAGE_CSP = [
  "default-src 'self'",
  "connect-src 'self' https://vercel.com https://*.blob.vercel-storage.com",
  "img-src 'self' blob: data: https://*.blob.vercel-storage.com",
  "media-src 'self' blob: https://*.blob.vercel-storage.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new HttpError(405, 'Method not allowed.');
  }

  const file = resolvePublicPath(pathname);
  if (file && (await sendFile(req, res, file, 200))) return;

  await sendFile(req, res, path.join(PUBLIC_DIR, '404.html'), 404);
}

function resolvePublicPath(pathname) {
  if (pathname === '/') return path.join(PUBLIC_DIR, 'index.html');
  if (pathname === '/robots.txt') return path.join(PUBLIC_DIR, 'robots.txt');
  if (isValidSlug(pathname.slice(1))) return path.join(PUBLIC_DIR, 'share.html');

  if (pathname.startsWith('/assets/')) {
    const file = path.join(PUBLIC_DIR, pathname);
    return file.startsWith(path.join(PUBLIC_DIR, 'assets') + path.sep) ? file : null;
  }
  return null;
}

async function sendFile(req, res, file, status) {
  let stats;
  try {
    stats = await fs.stat(file);
  } catch {
    return false;
  }
  if (!stats.isFile()) return false;

  const extension = path.extname(file);
  const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'Cache-Control': extension === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
    ETag: etag,
  };
  if (extension === '.html') headers['Content-Security-Policy'] = PAGE_CSP;

  if (status === 200 && req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers).end();
    return true;
  }

  res.writeHead(status, { ...headers, 'Content-Length': stats.size });
  if (req.method === 'HEAD') res.end();
  else await pipeline(createReadStream(file), res);
  return true;
}

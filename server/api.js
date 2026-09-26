import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import QRCode from 'qrcode';
import { DEFAULT_EXPIRY, EXPIRY_OPTIONS } from './config.js';
import { HttpError, clientIp, readJson, sendJson } from './http.js';
import { RateLimiter } from './rate-limit.js';
import { Router } from './router.js';
import { isValidSlug, randomWord, randomWordWithNumber } from './slug.js';
import { UploadSizeError } from './store.js';
import { parseShareInput } from './validate.js';

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_QR_LENGTH = 512;

// Only these are ever served inline. Everything else is forced to download,
// so an uploaded HTML or SVG file can never run on this origin.
const PREVIEW_TYPES = new Set([
  'image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm',
]);

export function createApi({ store, config }) {
  const requestLimit = new RateLimiter({ windowMs: 60_000, max: 300 });
  const createLimit = new RateLimiter({ windowMs: 10 * 60_000, max: 30 });
  // One-word links are easy to guess, so looking up links that don't exist
  // (or asking whether one is taken) has a much tighter budget.
  const lookupLimit = new RateLimiter({ windowMs: 10 * 60_000, max: 100 });

  const router = new Router()
    .on('GET', '/api/config', getConfig)
    .on('GET', '/api/qr', getQrCode)
    .on('GET', '/api/slugs/suggest', suggestSlug)
    .on('GET', '/api/slugs/:slug', checkSlug)
    .on('POST', '/api/shares', createShare)
    .on('GET', '/api/shares/:slug', getShare)
    .on('DELETE', '/api/shares/:slug', deleteShare)
    .on('PUT', '/api/shares/:slug/files/:fileId', uploadFile)
    .on('GET', '/api/shares/:slug/files/:fileId', downloadFile);

  return async function handleApi(req, res, url) {
    res.setHeader('X-Robots-Tag', 'noindex');

    const ip = clientIp(req, config.trustProxy);
    if (!requestLimit.take(ip)) {
      throw new HttpError(429, 'Too many requests. Try again in a minute.');
    }

    const { handler, params } = router.match(req.method, url.pathname);
    await handler({ req, res, url, params, ip });
  };

  function getConfig({ res }) {
    sendJson(res, 200, {
      maxShareBytes: config.maxShareBytes,
      maxFiles: config.maxFiles,
      maxTextBytes: config.maxTextBytes,
      expiryOptions: EXPIRY_OPTIONS,
      defaultExpiry: DEFAULT_EXPIRY,
    });
  }

  async function getQrCode({ res, url }) {
    const data = url.searchParams.get('data') ?? '';
    if (data === '' || data.length > MAX_QR_LENGTH) throw new HttpError(400, 'Nothing to encode.');

    const svg = await QRCode.toString(data, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'private, max-age=3600',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.end(svg);
  }

  function suggestSlug({ res, ip }) {
    requireLookupBudget(ip);
    sendJson(res, 200, { slug: uniqueSlug() });
  }

  function checkSlug({ res, params, ip }) {
    requireLookupBudget(ip);
    const valid = isValidSlug(params.slug);
    sendJson(res, 200, { valid, available: valid && !store.has(params.slug) });
  }

  async function createShare({ req, res, ip }) {
    if (!createLimit.take(ip)) {
      throw new HttpError(429, 'Too many shares created. Try again in a few minutes.');
    }

    const input = parseShareInput(await readJson(req, MAX_JSON_BYTES), config);
    const totalBytes = input.files.reduce((sum, file) => sum + file.size, 0);

    if (totalBytes > config.maxShareBytes) {
      throw new HttpError(413, 'Files are larger than the share limit.');
    }
    if (store.usedBytes + totalBytes > config.maxStorageBytes) {
      throw new HttpError(507, 'Server storage is full. Try again later.');
    }
    if (input.slug && store.has(input.slug)) {
      throw new HttpError(409, 'That link is already taken.');
    }

    const { share, token } = await store.create({
      slug: input.slug ?? uniqueSlug(),
      expiresAt: Date.now() + input.expiresIn * 1000,
      text: input.text,
      files: input.files,
      encryption: input.encryption,
    });

    sendJson(res, 201, { ...toPublicShare(share), token });
  }

  function getShare({ res, params, ip }) {
    if (!store.has(params.slug)) requireLookupBudget(ip);
    sendJson(res, 200, toPublicShare(requireShare(params.slug)));
  }

  async function deleteShare({ req, res, params }) {
    const share = requireShare(params.slug);
    requireOwner(req, share);
    await store.delete(share.slug);
    res.writeHead(204).end();
  }

  async function uploadFile({ req, res, params }) {
    const share = requireShare(params.slug);
    requireOwner(req, share);
    const file = requireFile(share, params.fileId);

    if (file.uploaded || store.isUploading(share, file)) {
      throw new HttpError(409, 'This file has already been uploaded.');
    }

    const declaredLength = req.headers['content-length'];
    if (declaredLength !== undefined && Number(declaredLength) !== file.size) {
      throw new HttpError(400, 'File size does not match what was announced.');
    }

    try {
      await store.writeFile(share, file, req);
    } catch (error) {
      if (error instanceof UploadSizeError) throw new HttpError(400, error.message);
      throw error;
    }

    sendJson(res, 200, { ready: store.isReady(share) });
  }

  async function downloadFile({ req, res, url, params }) {
    const share = requireShare(params.slug);
    const file = requireFile(share, params.fileId);
    if (!file.uploaded) throw new HttpError(409, 'This file is still uploading.');

    const encrypted = share.encryption !== null;
    const inline = !encrypted && url.searchParams.has('inline') && PREVIEW_TYPES.has(file.type);
    const range = parseRange(req.headers.range, file.size);

    const headers = {
      'Content-Type': encrypted ? 'application/octet-stream' : file.type,
      'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', file.name ?? `file-${file.id}`),
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
      'Accept-Ranges': 'bytes',
      'Content-Length': range ? range.end - range.start + 1 : file.size,
    };
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${file.size}`;

    res.writeHead(range ? 206 : 200, headers);
    if (req.method === 'HEAD' || file.size === 0) {
      res.end();
      return;
    }
    await pipeline(createReadStream(store.pathFor(share, file), range ?? {}), res);
  }

  function uniqueSlug() {
    for (const pick of [randomWord, randomWordWithNumber]) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const slug = pick();
        if (!store.has(slug)) return slug;
      }
    }
    throw new HttpError(503, 'Could not create a link. Try again.');
  }

  function requireLookupBudget(ip) {
    if (!lookupLimit.take(ip)) throw new HttpError(429, 'Too many lookups. Try again in a few minutes.');
  }

  function requireShare(slug) {
    const share = store.get(slug);
    if (!share) throw new HttpError(404, 'This link does not exist or has expired.');
    return share;
  }

  function requireOwner(req, share) {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!store.verifyToken(share, token)) {
      throw new HttpError(403, 'You cannot change this share.');
    }
  }

  function toPublicShare(share) {
    return {
      slug: share.slug,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
      ready: store.isReady(share),
      text: share.text,
      encryption: share.encryption,
      files: share.files.map(({ id, name, type, size, uploaded }) => ({ id, name, type, size, uploaded })),
    };
  }
}

function requireFile(share, fileId) {
  const file = share.files.find((candidate) => candidate.id === fileId);
  if (!file) throw new HttpError(404, 'File not found.');
  return file;
}

// Supports a single "bytes=start-end" range, which is all browsers need for
// seeking in videos and resuming downloads. Anything fancier gets the full file.
function parseRange(header, size) {
  const match = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;

  let start;
  let end;
  if (match[1] === '') {
    start = Math.max(size - Number(match[2]), 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }

  if (start > end || start >= size) {
    throw new HttpError(416, 'Range not satisfiable.', { 'Content-Range': `bytes */${size}` });
  }
  return { start, end };
}

function contentDisposition(type, filename) {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

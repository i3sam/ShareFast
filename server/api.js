import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { DEFAULT_EXPIRY, EXPIRY_OPTIONS } from './config.js';
import { HttpError, clientIp, readJson, sendJson } from './http.js';
import { RateLimiter } from './rate-limit.js';
import { Router } from './router.js';
import { isValidSlug, randomWord, randomWordWithNumber } from './slug.js';
import { parseShareInput } from './validate.js';

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_QR_LENGTH = 512;

// The routes are the same everywhere; `backend` decides where shares and
// files actually live (local disk, or Vercel Blob and Upstash Redis).
export function createApi({ backend, config }) {
  const requestLimit = new RateLimiter({ windowMs: 60_000, max: 300 });
  const createLimit = backend.limiter({ name: 'create', windowMs: 10 * 60_000, max: 30 });
  // One-word links are easy to guess, so looking up links that don't exist
  // (or asking whether one is taken) has a much tighter budget.
  const lookupLimit = backend.limiter({ name: 'lookup', windowMs: 10 * 60_000, max: 100 });

  const router = new Router()
    .on('GET', '/api/config', getConfig)
    .on('GET', '/api/qr', getQrCode)
    .on('GET', '/api/sweep', sweep)
    .on('GET', '/api/slugs/suggest', suggestSlug)
    .on('GET', '/api/slugs/:slug', checkSlug)
    .on('POST', '/api/shares', createShare)
    .on('GET', '/api/shares/:slug', getShare)
    .on('DELETE', '/api/shares/:slug', deleteShare)
    .on('PUT', '/api/shares/:slug/files/:fileId', receiveUpload)
    .on('POST', '/api/shares/:slug/files/:fileId/presign', presignUpload)
    .on('POST', '/api/shares/:slug/files/:fileId/complete', completeUpload)
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

  // Called daily by Vercel Cron (see vercel.json). Safe to call by hand too.
  async function sweep({ req, res }) {
    if (config.cronSecret && req.headers.authorization !== `Bearer ${config.cronSecret}`) {
      throw new HttpError(401, 'Not allowed.');
    }
    sendJson(res, 200, { removed: await backend.sweep({ limit: 500 }) });
  }

  async function suggestSlug({ res, ip }) {
    await requireLookupBudget(ip);
    sendJson(res, 200, { slug: await uniqueSlug() });
  }

  async function checkSlug({ res, params, ip }) {
    await requireLookupBudget(ip);
    const valid = isValidSlug(params.slug);
    sendJson(res, 200, { valid, available: valid && !(await backend.isTaken(params.slug)) });
  }

  async function createShare({ req, res, ip }) {
    if (!(await createLimit.take(ip))) {
      throw new HttpError(429, 'Too many shares created. Try again in a few minutes.');
    }

    const input = parseShareInput(await readJson(req, MAX_JSON_BYTES), config);
    const totalBytes = input.files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > config.maxShareBytes) {
      throw new HttpError(413, 'Files are larger than the share limit.');
    }

    // Clearing out a few expired shares here keeps storage tidy between the
    // daily cleanup runs, and frees their space before the check below.
    await backend.sweep({ limit: 10 });
    if ((await backend.usedBytes()) + totalBytes > config.maxStorageBytes) {
      throw new HttpError(507, 'Storage is full right now. Try again later.');
    }
    if (input.slug && (await backend.isTaken(input.slug))) {
      throw new HttpError(409, 'That link is already taken.');
    }

    const token = randomBytes(24).toString('base64url');
    const now = Date.now();
    const share = await backend.create({
      slug: input.slug ?? (await uniqueSlug()),
      createdAt: now,
      expiresAt: now + input.expiresIn * 1000,
      tokenHash: hashToken(token),
      text: input.text,
      encryption: input.encryption,
      files: input.files.map((file, index) => ({ id: String(index), ...file })),
    });

    sendJson(res, 201, {
      ...toPublicShare(share),
      token,
      uploads: share.files.map((file) => backend.uploadTarget(share, file)),
    });
  }

  async function getShare({ res, params, ip }) {
    const share = await backend.get(params.slug);
    if (!share) {
      await requireLookupBudget(ip);
      throw notFound();
    }
    sendJson(res, 200, toPublicShare(share));
  }

  async function deleteShare({ req, res, params }) {
    const share = await requireShare(params.slug);
    requireOwner(req, share);
    await backend.delete(share);
    res.writeHead(204).end();
  }

  // Local disk only: the browser streams the file to this route.
  async function receiveUpload({ req, res, params }) {
    const { share, file } = await requireOwnedFile(req, params);
    await backend.receiveUpload(req, share, file);
    sendJson(res, 200, { ready: isReady(share) });
  }

  // Vercel only: the browser gets a presigned URL, then uploads straight to Blob.
  async function presignUpload({ req, res, params }) {
    const { share, file } = await requireOwnedFile(req, params);
    sendJson(res, 200, await backend.presignUpload(share, file));
  }

  async function completeUpload({ req, res, params }) {
    const { share, file } = await requireOwnedFile(req, params);
    await backend.completeUpload(share, file);
    sendJson(res, 200, { ready: isReady(share) });
  }

  async function downloadFile({ req, res, url, params }) {
    const share = await requireShare(params.slug);
    const file = requireFile(share, params.fileId);
    await backend.serveFile(req, res, share, file, { inline: url.searchParams.has('inline') });
  }

  async function uniqueSlug() {
    for (const pick of [randomWord, randomWordWithNumber]) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const slug = pick();
        if (!(await backend.isTaken(slug))) return slug;
      }
    }
    throw new HttpError(503, 'Could not create a link. Try again.');
  }

  async function requireLookupBudget(ip) {
    if (!(await lookupLimit.take(ip))) {
      throw new HttpError(429, 'Too many lookups. Try again in a few minutes.');
    }
  }

  async function requireShare(slug) {
    const share = await backend.get(slug);
    if (!share) throw notFound();
    return share;
  }

  async function requireOwnedFile(req, params) {
    const share = await requireShare(params.slug);
    requireOwner(req, share);
    return { share, file: requireFile(share, params.fileId) };
  }
}

function notFound() {
  return new HttpError(404, 'This link does not exist or has expired.');
}

function requireFile(share, fileId) {
  const file = share.files.find((candidate) => candidate.id === fileId);
  if (!file) throw new HttpError(404, 'File not found.');
  return file;
}

function requireOwner(req, share) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const matches =
    token !== '' && timingSafeEqual(Buffer.from(hashToken(token), 'hex'), Buffer.from(share.tokenHash, 'hex'));
  if (!matches) throw new HttpError(403, 'You cannot change this share.');
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function isReady(share) {
  return share.files.every((file) => file.uploaded);
}

function toPublicShare(share) {
  return {
    slug: share.slug,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    ready: isReady(share),
    text: share.text,
    encryption: share.encryption,
    files: share.files.map(({ id, name, type, size, uploaded }) => ({ id, name, type, size, uploaded })),
  };
}

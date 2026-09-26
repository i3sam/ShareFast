import { randomBytes } from 'node:crypto';
import { BlobNotFoundError, del, head } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';
import { canPreview } from '../files.js';
import { HttpError } from '../http.js';

const DAY = 24 * 60 * 60 * 1000;
// Share records outlive their expiry long enough for the daily cleanup job to
// find them and delete their files. Reads treat them as gone right away.
const RECORD_GRACE_MS = 8 * DAY;
// Above this size the browser uploads in parallel parts.
const MULTIPART_THRESHOLD = 64 * 1024 * 1024;

const EXPIRING_KEY = 'expiring';
const USAGE_KEY = 'usage:bytes';
const shareKey = (slug) => `share:${slug}`;
const filesKey = (slug) => `share:${slug}:files`;

// Runs on Vercel: share records live in Upstash Redis, files in a public
// Vercel Blob store. Browsers upload straight to Blob, so file size isn't
// limited by the 4.5 MB function body limit.
export class VercelBackend {
  #redis;
  #blob;

  constructor({ redis, blob = { del, head, handleUpload } }) {
    this.#redis = redis;
    this.#blob = blob;
  }

  async get(slug, now = Date.now()) {
    const share = await this.#load(slug);
    return share && share.expiresAt > now ? share : null;
  }

  async isTaken(slug) {
    return (await this.get(slug)) !== null;
  }

  async usedBytes() {
    return Number(await this.#redis.get(USAGE_KEY)) || 0;
  }

  async create(share) {
    // A random folder per share keeps blob URLs unguessable even though the store is public.
    const folder = `shares/${share.slug}/${randomBytes(16).toString('hex')}`;
    for (const file of share.files) {
      file.pathname = `${folder}/${file.id}/${blobFileName(share, file)}`;
    }

    if (!(await this.#claim(share))) {
      const existing = await this.#load(share.slug);
      if (existing && existing.expiresAt > Date.now()) {
        throw new HttpError(409, 'That link is already taken.');
      }
      if (existing) await this.#purge(existing);
      if (!(await this.#claim(share))) throw new HttpError(409, 'That link is already taken.');
    }

    await Promise.all([
      this.#redis.zadd(EXPIRING_KEY, { score: share.expiresAt, member: share.slug }),
      this.#redis.incrby(USAGE_KEY, totalSize(share)),
    ]);

    for (const file of share.files) file.uploaded = false;
    return share;
  }

  uploadTarget(share, file) {
    return {
      blob: {
        pathname: file.pathname,
        access: 'public',
        handleUploadUrl: `/api/shares/${share.slug}/files/${file.id}/token`,
        multipart: file.size > MULTIPART_THRESHOLD,
      },
    };
  }

  async receiveUpload() {
    throw new HttpError(404, 'Files are uploaded directly to storage.');
  }

  // Hands the browser a short-lived token that can write exactly one blob:
  // this file's path, at most its announced size, and never over an existing one.
  async authorizeUpload(req, body, share, file) {
    if (file.uploaded) throw new HttpError(409, 'This file has already been uploaded.');

    try {
      return await this.#blob.handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async (pathname) => {
          if (pathname !== file.pathname) throw new Error('Unexpected upload path.');
          return {
            maximumSizeInBytes: Math.max(file.size, 1),
            addRandomSuffix: false,
            allowOverwrite: false,
          };
        },
      });
    } catch (error) {
      throw new HttpError(400, error.message || 'Could not authorize this upload.');
    }
  }

  async completeUpload(share, file) {
    if (file.uploaded) return;

    let blob;
    try {
      blob = await this.#blob.head(file.pathname);
    } catch (error) {
      if (error instanceof BlobNotFoundError || error?.name === 'BlobNotFoundError') {
        throw new HttpError(409, 'This file has not finished uploading.');
      }
      throw error;
    }

    if (blob.size !== file.size) {
      await this.#blob.del(file.pathname);
      throw new HttpError(400, 'The uploaded file does not match the announced size.');
    }

    const key = filesKey(share.slug);
    await this.#redis.hset(key, { [file.id]: { url: blob.url, downloadUrl: blob.downloadUrl } });
    await this.#redis.pexpireat(key, share.expiresAt + RECORD_GRACE_MS);
    Object.assign(file, { uploaded: true, url: blob.url, downloadUrl: blob.downloadUrl });
  }

  // Files are served by the Blob CDN, which handles ranges and caching.
  // Previews and encrypted files use the plain URL; downloads use the one
  // that makes the browser save the file.
  async serveFile(req, res, share, file, { inline }) {
    if (!file.uploaded) throw new HttpError(409, 'This file is still uploading.');

    const showInline = (inline && canPreview(share, file)) || share.encryption !== null;
    res.writeHead(302, {
      Location: showInline ? file.url : file.downloadUrl,
      'Cache-Control': 'private, no-store',
    });
    res.end();
  }

  async delete(share) {
    await this.#purge(share);
  }

  async sweep({ now = Date.now(), limit = 50 } = {}) {
    const slugs = await this.#redis.zrange(EXPIRING_KEY, 0, now, { byScore: true, offset: 0, count: limit });
    let removed = 0;

    for (const slug of slugs) {
      const share = await this.#load(slug);
      // The word may have been reused since; its new score keeps it out of the next sweep.
      if (share && share.expiresAt > now) continue;

      if (share) await this.#purge(share);
      else await this.#redis.zrem(EXPIRING_KEY, slug);
      removed += 1;
    }
    return removed;
  }

  limiter({ name, windowMs, max }) {
    return new RedisRateLimiter(this.#redis, { name, windowMs, max });
  }

  async #claim(share) {
    const stored = { ...share, files: share.files.map(({ uploaded, ...file }) => file) };
    const result = await this.#redis.set(shareKey(share.slug), stored, {
      nx: true,
      pxat: share.expiresAt + RECORD_GRACE_MS,
    });
    return result === 'OK';
  }

  async #load(slug) {
    const [share, uploads] = await Promise.all([
      this.#redis.get(shareKey(slug)),
      this.#redis.hgetall(filesKey(slug)),
    ]);
    if (!share) return null;

    for (const file of share.files) {
      const blob = uploads?.[file.id];
      Object.assign(file, { uploaded: Boolean(blob), url: blob?.url, downloadUrl: blob?.downloadUrl });
    }
    return share;
  }

  async #purge(share) {
    const pathnames = share.files.map((file) => file.pathname);
    if (pathnames.length > 0) await this.#blob.del(pathnames);

    await Promise.all([
      this.#redis.del(shareKey(share.slug), filesKey(share.slug)),
      this.#redis.zrem(EXPIRING_KEY, share.slug),
      this.#redis.decrby(USAGE_KEY, totalSize(share)),
    ]);
  }
}

class RedisRateLimiter {
  #redis;
  #name;
  #windowMs;
  #max;

  constructor(redis, { name, windowMs, max }) {
    this.#redis = redis;
    this.#name = name;
    this.#windowMs = windowMs;
    this.#max = max;
  }

  async take(key) {
    const counter = `limit:${this.#name}:${key}`;
    const count = await this.#redis.incr(counter);
    if (count === 1) await this.#redis.pexpire(counter, this.#windowMs);
    return count <= this.#max;
  }
}

function totalSize(share) {
  return share.files.reduce((sum, file) => sum + file.size, 0);
}

// The last path segment becomes the filename when someone downloads the file,
// so keep it readable but safe for a URL.
function blobFileName(share, file) {
  if (share.encryption !== null) return 'file';
  const safe = file.name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(-100);
  return safe || 'file';
}

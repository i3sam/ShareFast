import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { canPreview, contentDisposition, parseRange } from '../files.js';
import { HttpError } from '../http.js';
import { RateLimiter } from '../rate-limit.js';

const META_FILE = 'meta.json';

// Stores everything on local disk: <dir>/<slug>/meta.json plus one file per
// upload, named by its index. Used for local development and self-hosting.
// Whether a file has finished uploading is derived from whether it exists.
export class DiskBackend {
  #dir;
  #shares = new Map();
  #uploading = new Set();

  constructor({ dir }) {
    this.#dir = dir;
  }

  async init(now = Date.now()) {
    await fs.mkdir(this.#dir, { recursive: true });
    const entries = await fs.readdir(this.#dir, { withFileTypes: true });

    for (const entry of entries) {
      const share = entry.isDirectory() ? await this.#load(entry.name) : null;
      if (share && share.expiresAt > now) {
        this.#shares.set(share.slug, share);
      } else {
        await fs.rm(path.join(this.#dir, entry.name), { recursive: true, force: true });
      }
    }
  }

  async get(slug, now = Date.now()) {
    const share = this.#shares.get(slug);
    return share && share.expiresAt > now ? share : null;
  }

  async isTaken(slug) {
    return (await this.get(slug)) !== null;
  }

  async usedBytes() {
    let total = 0;
    for (const share of this.#shares.values()) {
      for (const file of share.files) total += file.size;
    }
    return total;
  }

  async create(share) {
    if (this.#shares.has(share.slug)) {
      if (await this.isTaken(share.slug)) throw new HttpError(409, 'That link is already taken.');
      await this.delete(this.#shares.get(share.slug));
    }

    // Claim the slug before the first await so concurrent requests can't both take it.
    this.#shares.set(share.slug, share);
    try {
      const dir = path.join(this.#dir, share.slug);
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, META_FILE), JSON.stringify(share));
    } catch (error) {
      this.#shares.delete(share.slug);
      throw error;
    }

    for (const file of share.files) file.uploaded = false;
    return share;
  }

  uploadTarget(share, file) {
    return { method: 'PUT', url: `/api/shares/${share.slug}/files/${file.id}` };
  }

  async receiveUpload(req, share, file) {
    const key = `${share.slug}/${file.id}`;
    if (file.uploaded || this.#uploading.has(key)) {
      throw new HttpError(409, 'This file has already been uploaded.');
    }

    const declaredLength = req.headers['content-length'];
    if (declaredLength !== undefined && Number(declaredLength) !== file.size) {
      throw new HttpError(400, 'File size does not match what was announced.');
    }

    const target = this.#filePath(share, file);
    const partial = `${target}.part`;

    this.#uploading.add(key);
    try {
      await pipeline(req, exactSize(file.size), createWriteStream(partial));
      await fs.rename(partial, target);
      file.uploaded = true;
    } catch (error) {
      await fs.rm(partial, { force: true });
      throw error;
    } finally {
      this.#uploading.delete(key);
    }
  }

  async authorizeUpload() {
    throw new HttpError(404, 'Files are uploaded directly to this server.');
  }

  async completeUpload(share, file) {
    if (!file.uploaded) throw new HttpError(409, 'This file has not finished uploading.');
  }

  async serveFile(req, res, share, file, { inline }) {
    if (!file.uploaded) throw new HttpError(409, 'This file is still uploading.');

    const encrypted = share.encryption !== null;
    const showInline = inline && canPreview(share, file);
    const range = parseRange(req.headers.range, file.size);

    const headers = {
      'Content-Type': encrypted ? 'application/octet-stream' : file.type,
      'Content-Disposition': contentDisposition(showInline ? 'inline' : 'attachment', file.name ?? `file-${file.id}`),
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
    await pipeline(createReadStream(this.#filePath(share, file), range ?? {}), res);
  }

  async delete(share) {
    this.#shares.delete(share.slug);
    await fs.rm(path.join(this.#dir, share.slug), { recursive: true, force: true });
  }

  async sweep({ now = Date.now() } = {}) {
    const expired = [...this.#shares.values()].filter((share) => share.expiresAt <= now);
    await Promise.all(expired.map((share) => this.delete(share)));
    return expired.length;
  }

  limiter(options) {
    return new RateLimiter(options);
  }

  #filePath(share, file) {
    return path.join(this.#dir, share.slug, file.id);
  }

  async #load(slug) {
    try {
      const share = JSON.parse(await fs.readFile(path.join(this.#dir, slug, META_FILE), 'utf8'));
      for (const file of share.files) {
        file.uploaded = await exists(this.#filePath(share, file));
      }
      return share;
    } catch {
      return null;
    }
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function exactSize(expected) {
  let received = 0;
  return new Transform({
    transform(chunk, _encoding, done) {
      received += chunk.length;
      if (received > expected) {
        done(new HttpError(400, 'File is larger than the size that was announced.'));
      } else {
        done(null, chunk);
      }
    },
    flush(done) {
      if (received === expected) done();
      else done(new HttpError(400, `Expected ${expected} bytes but received ${received}.`));
    },
  });
}

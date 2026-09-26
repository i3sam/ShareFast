import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const META_FILE = 'meta.json';

export class UploadSizeError extends Error {}

// Each share is a folder: data/<slug>/meta.json plus one file per upload,
// named by its index. Metadata is written once at creation; whether a file
// has finished uploading is derived from whether it exists on disk.
export class ShareStore {
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

  get(slug, now = Date.now()) {
    const share = this.#shares.get(slug);
    return share && share.expiresAt > now ? share : undefined;
  }

  has(slug) {
    return this.get(slug) !== undefined;
  }

  get usedBytes() {
    let total = 0;
    for (const share of this.#shares.values()) {
      for (const file of share.files) total += file.size;
    }
    return total;
  }

  isReady(share) {
    return share.files.every((file) => file.uploaded);
  }

  isUploading(share, file) {
    return this.#uploading.has(uploadKey(share, file));
  }

  verifyToken(share, token) {
    if (typeof token !== 'string' || token === '') return false;
    return timingSafeEqual(Buffer.from(hashToken(token), 'hex'), Buffer.from(share.tokenHash, 'hex'));
  }

  pathFor(share, file) {
    return path.join(this.#dir, share.slug, file.id);
  }

  async create({ slug, expiresAt, text, files, encryption }) {
    if (this.#shares.has(slug)) {
      if (this.has(slug)) throw new Error(`Share "${slug}" already exists`);
      await this.delete(slug);
    }

    const token = randomBytes(24).toString('base64url');
    const share = {
      slug,
      createdAt: Date.now(),
      expiresAt,
      tokenHash: hashToken(token),
      text,
      encryption,
      files: files.map((file, index) => ({ id: String(index), ...file })),
    };

    // Claim the slug before the first await so concurrent requests can't both take it.
    this.#shares.set(slug, share);
    try {
      const dir = path.join(this.#dir, slug);
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, META_FILE), JSON.stringify(share));
    } catch (error) {
      this.#shares.delete(slug);
      throw error;
    }

    for (const file of share.files) file.uploaded = false;
    return { share, token };
  }

  async writeFile(share, file, source) {
    const key = uploadKey(share, file);
    const target = this.pathFor(share, file);
    const partial = `${target}.part`;

    this.#uploading.add(key);
    try {
      await pipeline(source, exactSize(file.size), createWriteStream(partial));
      await fs.rename(partial, target);
      file.uploaded = true;
    } catch (error) {
      await fs.rm(partial, { force: true });
      throw error;
    } finally {
      this.#uploading.delete(key);
    }
  }

  async delete(slug) {
    this.#shares.delete(slug);
    await fs.rm(path.join(this.#dir, slug), { recursive: true, force: true });
  }

  async sweep(now = Date.now()) {
    const expired = [...this.#shares.values()].filter((share) => share.expiresAt <= now);
    await Promise.all(expired.map((share) => this.delete(share.slug)));
    return expired.length;
  }

  async #load(slug) {
    try {
      const share = JSON.parse(await fs.readFile(path.join(this.#dir, slug, META_FILE), 'utf8'));
      for (const file of share.files) {
        file.uploaded = await exists(this.pathFor(share, file));
      }
      return share;
    } catch {
      return null;
    }
  }
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function uploadKey(share, file) {
  return `${share.slug}/${file.id}`;
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
        done(new UploadSizeError(`File is larger than the ${expected} bytes that were announced.`));
      } else {
        done(null, chunk);
      }
    },
    flush(done) {
      if (received === expected) done();
      else done(new UploadSizeError(`Expected ${expected} bytes but received ${received}.`));
    },
  });
}

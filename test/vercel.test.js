import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../server/app.js';
import { VercelBackend } from '../server/backends/vercel.js';
import { loadConfig } from '../server/config.js';
import { PAGE_CSP } from '../server/static.js';

// Just enough of @upstash/redis for the backend. Values round-trip through
// JSON like they do over Upstash's REST API.
class FakeRedis {
  #data = new Map();
  #expiry = new Map();

  #live(key) {
    if (this.#expiry.has(key) && this.#expiry.get(key) <= Date.now()) {
      this.#data.delete(key);
      this.#expiry.delete(key);
    }
    return this.#data.get(key);
  }

  async get(key) {
    const value = this.#live(key);
    return value === undefined ? null : JSON.parse(JSON.stringify(value));
  }

  async set(key, value, { nx, pxat } = {}) {
    if (nx && this.#live(key) !== undefined) return null;
    this.#data.set(key, JSON.parse(JSON.stringify(value)));
    if (pxat) this.#expiry.set(key, pxat);
    return 'OK';
  }

  async del(...keys) {
    for (const key of keys) this.#data.delete(key);
  }

  async hset(key, fields) {
    this.#data.set(key, { ...(this.#live(key) ?? {}), ...JSON.parse(JSON.stringify(fields)) });
  }

  async hgetall(key) {
    return this.get(key);
  }

  async pexpireat(key, at) {
    this.#expiry.set(key, at);
  }

  async pexpire(key, ms) {
    this.#expiry.set(key, Date.now() + ms);
  }

  async incr(key) {
    return this.incrby(key, 1);
  }

  async incrby(key, amount) {
    const value = (this.#live(key) ?? 0) + amount;
    this.#data.set(key, value);
    return value;
  }

  async decrby(key, amount) {
    return this.incrby(key, -amount);
  }

  async zadd(key, { score, member }) {
    const set = this.#live(key) ?? {};
    set[member] = score;
    this.#data.set(key, set);
  }

  async zrem(key, member) {
    const set = this.#live(key) ?? {};
    delete set[member];
  }

  async zrange(key, min, max, { offset, count }) {
    return Object.entries(this.#live(key) ?? {})
      .filter(([, score]) => score >= min && score <= max)
      .sort((a, b) => a[1] - b[1])
      .slice(offset, offset + count)
      .map(([member]) => member);
  }
}

// Stands in for Vercel Blob. `put` simulates the browser finishing an upload.
class FakeBlob {
  files = new Map();

  put(pathname, size) {
    this.files.set(pathname, size);
  }

  head = async (pathname) => {
    if (!this.files.has(pathname)) {
      const error = new Error('Blob not found');
      error.name = 'BlobNotFoundError';
      throw error;
    }
    const url = `https://store.public.blob.vercel-storage.com/${pathname}`;
    return { size: this.files.get(pathname), url, downloadUrl: `${url}?download=1` };
  };

  del = async (pathnames) => {
    for (const pathname of [pathnames].flat()) this.files.delete(pathname);
  };

  issueSignedToken = async (options) => ({ delegationToken: 'delegation', clientSigningToken: 'secret', options });

  presignUrl = async (token, options) => {
    assert.equal(options.pathname, token.options.pathname);
    const query = new URLSearchParams({ max: options.maximumSizeInBytes, overwrite: options.allowOverwrite });
    return { presignedUrl: `https://vercel.com/api/blob/?pathname=${options.pathname}&${query}` };
  };
}

let server;
let baseUrl;
let backend;
const blob = new FakeBlob();

before(async () => {
  const config = loadConfig({ MAX_SHARE_MB: '1' });
  backend = new VercelBackend({ redis: new FakeRedis(), blob });
  server = http.createServer(createApp({ backend, config, serveStaticFiles: false }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function call(pathname, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(baseUrl + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
}

async function createShare(input) {
  const response = await call('/api/shares', { method: 'POST', body: input });
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
}

function requestUploadUrl(share, fileId, token = share.token) {
  return call(share.uploads[fileId].presign, { method: 'POST', token, body: {} });
}

// Where the browser would upload this file, read back from its presigned URL.
async function uploadPath(share, index) {
  const { url } = await (await requestUploadUrl(share, index)).json();
  return new URL(url).searchParams.get('pathname');
}

describe('Vercel backend', () => {
  test('hands the owner a presigned URL for exactly one file', async () => {
    const share = await createShare({ files: [{ name: 'My Photo (1).jpg', type: 'image/jpeg', size: 10 }] });
    assert.deepEqual(share.uploads, [{ presign: `/api/shares/${share.slug}/files/0/presign` }]);

    assert.equal((await requestUploadUrl(share, 0, 'wrong')).status, 403);

    const { url, headers } = await (await requestUploadUrl(share, 0)).json();
    assert.match(url, new RegExp(`pathname=shares/${share.slug}/[0-9a-f]{32}/0/My-Photo-1-.jpg&max=10&overwrite=false$`));
    assert.deepEqual(headers, { 'Content-Type': 'image/jpeg' });
  });

  test('marks a file uploaded only once Blob has it at the right size', async () => {
    const share = await createShare({ files: [{ name: 'a.txt', type: 'text/plain', size: 10 }] });
    const pathname = await uploadPath(share, 0);
    const complete = () => call(`/api/shares/${share.slug}/files/0/complete`, { method: 'POST', body: {}, token: share.token });

    assert.equal((await complete()).status, 409);

    blob.put(pathname, 7);
    assert.equal((await complete()).status, 400);
    assert.equal(blob.files.has(pathname), false);

    blob.put(pathname, 10);
    assert.deepEqual(await (await complete()).json(), { ready: true });
    assert.equal((await (await call(`/api/shares/${share.slug}`)).json()).ready, true);
  });

  test('redirects downloads to Blob, inline only for safe previews', async () => {
    const share = await createShare({
      files: [
        { name: 'a.png', type: 'image/png', size: 1 },
        { name: 'b.html', type: 'text/html', size: 1 },
      ],
    });
    for (const index of share.uploads.keys()) {
      blob.put(await uploadPath(share, index), 1);
      await call(`/api/shares/${share.slug}/files/${index}/complete`, { method: 'POST', body: {}, token: share.token });
    }

    const download = await call(`/api/shares/${share.slug}/files/0`);
    assert.equal(download.status, 302);
    assert.match(download.headers.get('location'), /a\.png\?download=1$/);

    const preview = await call(`/api/shares/${share.slug}/files/0?inline`);
    assert.match(preview.headers.get('location'), /a\.png$/);

    const page = await call(`/api/shares/${share.slug}/files/1?inline`);
    assert.match(page.headers.get('location'), /\?download=1$/);
  });

  test('refuses taken words and frees them once expired', async () => {
    await createShare({ slug: 'harbor', text: 'first' });
    assert.equal((await call('/api/shares', { method: 'POST', body: { slug: 'harbor', text: 'second' } })).status, 409);

    const expired = await backend.create({
      slug: 'lagoon',
      createdAt: Date.now() - 2000,
      expiresAt: Date.now() - 1000,
      tokenHash: '00',
      text: 'old',
      encryption: null,
      files: [],
    });
    assert.equal(await backend.isTaken(expired.slug), false);

    const reused = await createShare({ slug: 'lagoon', text: 'new' });
    assert.equal((await (await call(`/api/shares/${reused.slug}`)).json()).text, 'new');
  });

  test('sweeping deletes expired files and records', async () => {
    const share = await createShare({ files: [{ name: 'a.txt', type: 'text/plain', size: 3 }], expiresIn: 600 });
    const pathname = await uploadPath(share, 0);
    blob.put(pathname, 3);
    await call(`/api/shares/${share.slug}/files/0/complete`, { method: 'POST', body: {}, token: share.token });

    const removed = await backend.sweep({ now: share.expiresAt + 1 });
    assert.ok(removed >= 1);
    assert.equal(blob.files.has(pathname), false);
    assert.equal((await call(`/api/shares/${share.slug}`)).status, 404);
  });

  test('deleting a share removes its files', async () => {
    const share = await createShare({ files: [{ name: 'a.txt', type: 'text/plain', size: 3 }] });
    const pathname = await uploadPath(share, 0);
    blob.put(pathname, 3);

    assert.equal((await call(`/api/shares/${share.slug}`, { method: 'DELETE', token: share.token })).status, 204);
    assert.equal(blob.files.has(pathname), false);
  });
});

test('local and Vercel pages use the same Content Security Policy', async () => {
  const vercel = JSON.parse(await fs.readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const header = vercel.headers
    .flatMap((rule) => rule.headers)
    .find((entry) => entry.key === 'Content-Security-Policy');
  assert.equal(header.value, PAGE_CSP);
});

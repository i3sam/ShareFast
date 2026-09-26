import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { ShareStore } from '../server/store.js';

let server;
let store;
let dataDir;
let baseUrl;

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sharefast-'));
  const config = loadConfig({ DATA_DIR: dataDir, MAX_SHARE_MB: '1' });
  store = new ShareStore({ dir: config.dataDir });
  await store.init();

  server = http.createServer(createApp({ store, config }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
});

function call(pathname, { method = 'GET', body, token, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body instanceof Uint8Array) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return fetch(baseUrl + pathname, init);
}

async function createShare(input) {
  const response = await call('/api/shares', { method: 'POST', body: input });
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
}

describe('text shares', () => {
  test('creates a share with a random slug and reads it back', async () => {
    const share = await createShare({ text: 'hello from my laptop' });
    assert.match(share.slug, /^[a-z]+\d*$/);
    assert.equal(share.ready, true);

    const read = await (await call(`/api/shares/${share.slug}`)).json();
    assert.equal(read.text, 'hello from my laptop');
    assert.equal(read.token, undefined);
  });

  test('rejects an empty share', async () => {
    const response = await call('/api/shares', { method: 'POST', body: { text: '' } });
    assert.equal(response.status, 400);
  });

  test('returns 404 for unknown links', async () => {
    const response = await call('/api/shares/no-such-share');
    assert.equal(response.status, 404);
  });
});

describe('custom links', () => {
  test('uses the requested slug and refuses duplicates', async () => {
    const share = await createShare({ slug: 'my-notes', text: 'one' });
    assert.equal(share.slug, 'my-notes');

    const duplicate = await call('/api/shares', { method: 'POST', body: { slug: 'my-notes', text: 'two' } });
    assert.equal(duplicate.status, 409);

    const check = await (await call('/api/slugs/my-notes')).json();
    assert.deepEqual(check, { valid: true, available: false });
  });

  test('rejects invalid slugs', async () => {
    const response = await call('/api/shares', { method: 'POST', body: { slug: 'API', text: 'x' } });
    assert.equal(response.status, 400);
  });
});

describe('files', () => {
  const bytes = new Uint8Array(4096).map((_, i) => i % 256);

  test('uploads and downloads a file byte for byte', async () => {
    const share = await createShare({ files: [{ name: 'photo.png', type: 'image/png', size: bytes.length }] });
    assert.equal(share.ready, false);

    const upload = await call(`/api/shares/${share.slug}/files/0`, { method: 'PUT', body: bytes, token: share.token });
    assert.equal(upload.status, 200);

    const read = await (await call(`/api/shares/${share.slug}`)).json();
    assert.equal(read.ready, true);

    const download = await call(`/api/shares/${share.slug}/files/0`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition'), /^attachment; filename="photo.png"/);
    assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);

    const partial = await call(`/api/shares/${share.slug}/files/0`, { headers: { Range: 'bytes=10-19' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), `bytes 10-19/${bytes.length}`);
    assert.deepEqual(new Uint8Array(await partial.arrayBuffer()), bytes.slice(10, 20));
  });

  test('serves previews inline only for safe types', async () => {
    const share = await createShare({
      files: [
        { name: 'a.png', type: 'image/png', size: 1 },
        { name: 'b.html', type: 'text/html', size: 1 },
      ],
    });
    for (const id of ['0', '1']) {
      await call(`/api/shares/${share.slug}/files/${id}`, { method: 'PUT', body: new Uint8Array([1]), token: share.token });
    }

    const image = await call(`/api/shares/${share.slug}/files/0?inline`);
    assert.match(image.headers.get('content-disposition'), /^inline/);

    const page = await call(`/api/shares/${share.slug}/files/1?inline`);
    assert.match(page.headers.get('content-disposition'), /^attachment/);
    assert.match(page.headers.get('content-security-policy'), /sandbox/);
  });

  test('requires the owner token to upload', async () => {
    const share = await createShare({ files: [{ name: 'a.txt', type: 'text/plain', size: 3 }] });
    const response = await call(`/api/shares/${share.slug}/files/0`, {
      method: 'PUT',
      body: new Uint8Array(3),
      token: 'not-the-token',
    });
    assert.equal(response.status, 403);
  });

  test('rejects uploads that do not match the announced size', async () => {
    const share = await createShare({ files: [{ name: 'a.txt', type: 'text/plain', size: 3 }] });
    const response = await call(`/api/shares/${share.slug}/files/0`, {
      method: 'PUT',
      body: new Uint8Array(5),
      token: share.token,
    });
    assert.equal(response.status, 400);
  });

  test('rejects shares over the size limit', async () => {
    const response = await call('/api/shares', {
      method: 'POST',
      body: { files: [{ name: 'big.bin', type: 'application/octet-stream', size: 2 * 1024 * 1024 }] },
    });
    assert.equal(response.status, 413);
  });
});

describe('encrypted shares', () => {
  test('stores no file names or text in plain form', async () => {
    const share = await createShare({
      encryption: {
        iterations: 600000,
        salt: Buffer.alloc(16, 1).toString('base64'),
        iv: Buffer.alloc(12, 2).toString('base64'),
        manifest: Buffer.from('ciphertext').toString('base64'),
      },
      files: [{ name: 'secret.pdf', type: 'application/pdf', size: 32 }],
    });

    const read = await (await call(`/api/shares/${share.slug}`)).json();
    assert.equal(read.text, null);
    assert.equal(read.files[0].name, undefined);
    assert.equal(read.files[0].type, undefined);
    assert.equal(read.encryption.iterations, 600000);
  });

  test('refuses plain text alongside encryption', async () => {
    const response = await call('/api/shares', {
      method: 'POST',
      body: {
        text: 'leaked',
        encryption: {
          iterations: 600000,
          salt: Buffer.alloc(16).toString('base64'),
          iv: Buffer.alloc(12).toString('base64'),
          manifest: 'AAAA',
        },
      },
    });
    assert.equal(response.status, 400);
  });
});

describe('deleting and expiry', () => {
  test('only the owner can delete a share', async () => {
    const share = await createShare({ text: 'bye' });

    const denied = await call(`/api/shares/${share.slug}`, { method: 'DELETE', token: 'nope' });
    assert.equal(denied.status, 403);

    const deleted = await call(`/api/shares/${share.slug}`, { method: 'DELETE', token: share.token });
    assert.equal(deleted.status, 204);
    assert.equal((await call(`/api/shares/${share.slug}`)).status, 404);
  });

  test('sweeping removes expired shares from memory and disk', async () => {
    const share = await createShare({ text: 'short lived', expiresIn: 600 });
    const removed = await store.sweep(share.expiresAt + 1);

    assert.ok(removed >= 1);
    assert.equal(store.has(share.slug), false);
    await assert.rejects(fs.access(path.join(dataDir, share.slug)));
  });

  test('shares survive a restart', async () => {
    const share = await createShare({ slug: 'keep-me', text: 'still here' });
    const reloaded = new ShareStore({ dir: dataDir });
    await reloaded.init();
    assert.equal(reloaded.get(share.slug).text, 'still here');
  });
});

describe('pages', () => {
  test('serves the home page and share pages', async () => {
    const home = await call('/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);

    const sharePage = await call('/otter');
    assert.equal(sharePage.status, 200);
    assert.match(await sharePage.text(), /receive\.js/);
  });

  test('does not serve files outside the assets folder', async () => {
    for (const pathname of ['/assets/../../server/index.js', '/assets/%2e%2e/%2e%2e/package.json', '/server/index.js']) {
      const response = await call(pathname);
      assert.equal(response.status, 404, pathname);
    }
  });
});

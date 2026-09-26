// Password-protected shares are encrypted here, in the browser. The server
// only ever stores ciphertext and never sees the password or the file names.
//
// Key:   PBKDF2-SHA256(password, random 16-byte salt) -> AES-256-GCM
// Files: split into 1 MiB chunks, each sealed with its own IV
//        (8-byte random per-file nonce + 4-byte chunk counter), so large
//        files never have to sit in memory as a single buffer.

export const KDF_ITERATIONS = 600_000;

const CHUNK_SIZE = 1024 * 1024;
const TAG_SIZE = 16;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export async function deriveKey(password, salt, iterations = KDF_ITERATIONS) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJson(key, value) {
  const iv = randomBytes(12);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
  return { iv, data: new Uint8Array(data) };
}

export async function decryptJson(key, iv, data) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return JSON.parse(decoder.decode(plain));
}

export function encryptedSize(size) {
  return size + Math.ceil(size / CHUNK_SIZE) * TAG_SIZE;
}

export async function encryptFile(key, file, nonce) {
  const parts = [];
  for (let offset = 0, index = 0; offset < file.size; offset += CHUNK_SIZE, index++) {
    const chunk = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: chunkIv(nonce, index) }, key, chunk);
    parts.push(new Blob([sealed]));
  }
  return new Blob(parts);
}

export async function decryptFile(key, blob, nonce, { size, type }) {
  const parts = [];
  for (let offset = 0, index = 0; offset < blob.size; offset += CHUNK_SIZE + TAG_SIZE, index++) {
    const chunk = await blob.slice(offset, offset + CHUNK_SIZE + TAG_SIZE).arrayBuffer();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: chunkIv(nonce, index) }, key, chunk);
    parts.push(new Blob([plain]));
  }

  const file = new Blob(parts, { type });
  if (file.size !== size) throw new Error('The decrypted file is incomplete.');
  return file;
}

function chunkIv(nonce, index) {
  const iv = new Uint8Array(12);
  iv.set(nonce);
  new DataView(iv.buffer).setUint32(8, index);
  return iv;
}

export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

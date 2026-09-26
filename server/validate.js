import { DEFAULT_EXPIRY, EXPIRY_OPTIONS } from './config.js';
import { HttpError } from './http.js';
import { isValidSlug } from './slug.js';

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MIME_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const UNSAFE_FILENAME_CHARS = /[\u0000-\u001f\u007f/\\]/g;

const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 10_000_000;

export function parseShareInput(body, limits) {
  if (!isPlainObject(body)) invalid('Expected a JSON object.');

  const slug = parseSlug(body.slug);
  const expiresIn = parseExpiry(body.expiresIn);
  const encryption = body.encryption == null ? null : parseEncryption(body.encryption, limits);
  const text = parseText(body.text, encryption, limits);
  const files = parseFiles(body.files, encryption, limits);

  if (!encryption && text === null && files.length === 0) {
    invalid('Add some text or at least one file.');
  }

  return { slug, expiresIn, encryption, text, files };
}

function parseSlug(value) {
  if (value == null || value === '') return null;
  if (!isValidSlug(value)) {
    invalid('Links can use 3 to 40 lowercase letters, numbers and single dashes.');
  }
  return value;
}

function parseExpiry(value) {
  if (value == null) return DEFAULT_EXPIRY;
  if (!EXPIRY_OPTIONS.some((option) => option.seconds === value)) invalid('Unsupported expiry time.');
  return value;
}

function parseText(value, encryption, limits) {
  if (value == null || value === '') return null;
  if (encryption) invalid('Encrypted shares keep their text inside the encrypted manifest.');
  if (typeof value !== 'string') invalid('Text must be a string.');
  if (Buffer.byteLength(value) > limits.maxTextBytes) invalid('Text is too long.');
  return value;
}

function parseFiles(value, encryption, limits) {
  if (value == null) return [];
  if (!Array.isArray(value)) invalid('Files must be a list.');
  if (value.length > limits.maxFiles) invalid(`A share can hold up to ${limits.maxFiles} files.`);

  return value.map((file) => {
    if (!isPlainObject(file)) invalid('Invalid file entry.');
    if (!Number.isSafeInteger(file.size) || file.size < 0) invalid('Invalid file size.');

    // With encryption on, names and types live in the encrypted manifest instead.
    if (encryption) return { size: file.size };
    return { name: cleanFileName(file.name), type: cleanMimeType(file.type), size: file.size };
  });
}

function parseEncryption(value, limits) {
  if (!isPlainObject(value)) invalid('Invalid encryption settings.');

  const { iterations, salt, iv, manifest } = value;
  const maxManifestLength = Math.ceil((limits.maxTextBytes + 256 * 1024) * 4 / 3);

  if (!Number.isSafeInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    invalid('Invalid key derivation settings.');
  }
  if (!isBase64Bytes(salt, 16) || !isBase64Bytes(iv, 12)) invalid('Invalid encryption parameters.');
  if (typeof manifest !== 'string' || manifest.length === 0 || manifest.length > maxManifestLength || !BASE64.test(manifest)) {
    invalid('Invalid encrypted manifest.');
  }

  return { iterations, salt, iv, manifest };
}

function cleanFileName(value) {
  const name = typeof value === 'string' ? value.replace(UNSAFE_FILENAME_CHARS, '_').trim().slice(0, 255) : '';
  return name || 'file';
}

function cleanMimeType(value) {
  const type = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return type.length <= 128 && MIME_TYPE.test(type) ? type : 'application/octet-stream';
}

function isBase64Bytes(value, length) {
  return typeof value === 'string' && BASE64.test(value) && Buffer.from(value, 'base64').length === length;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message) {
  throw new HttpError(400, message);
}

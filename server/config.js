import path from 'node:path';

const MB = 1024 * 1024;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const EXPIRY_OPTIONS = [
  { seconds: 10 * MINUTE, label: '10 min' },
  { seconds: HOUR, label: '1 hour' },
  { seconds: DAY, label: '1 day' },
  { seconds: 7 * DAY, label: '7 days' },
];

export const DEFAULT_EXPIRY = HOUR;

export function loadConfig(env = process.env) {
  // Vercel Blob's free tier holds 1 GB in total, so the defaults there are smaller.
  const onVercel = Boolean(env.VERCEL);

  return Object.freeze({
    port: readInt(env, 'PORT', 3000),
    host: env.HOST || '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR || 'data'),
    maxShareBytes: readInt(env, 'MAX_SHARE_MB', onVercel ? 250 : 1024) * MB,
    maxStorageBytes: readInt(env, 'MAX_STORAGE_MB', onVercel ? 900 : 20 * 1024) * MB,
    maxFiles: readInt(env, 'MAX_FILES', 50),
    maxTextBytes: MB,
    trustProxy: onVercel || env.TRUST_PROXY === 'true',
    cronSecret: env.CRON_SECRET || null,
  });
}

function readInt(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a whole number, got "${raw}"`);
  }
  return value;
}

import { Redis } from '@upstash/redis';
import { DiskBackend } from './disk.js';
import { VercelBackend } from './vercel.js';

// Uses Vercel Blob + Upstash Redis when both are connected, local disk otherwise.
export async function createBackend(config, env = process.env) {
  const redisUrl = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const redisToken = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  const hasBlob = Boolean(env.BLOB_READ_WRITE_TOKEN);

  if (hasBlob && redisUrl && redisToken) {
    return new VercelBackend({ redis: new Redis({ url: redisUrl, token: redisToken }) });
  }

  if (env.VERCEL) {
    const missing = [!hasBlob && 'a Blob store', !(redisUrl && redisToken) && 'an Upstash Redis database'].filter(Boolean);
    throw new Error(`Storage isn't set up yet. Connect ${missing.join(' and ')} to this project in Vercel, then redeploy.`);
  }

  const backend = new DiskBackend({ dir: config.dataDir });
  await backend.init();
  return backend;
}

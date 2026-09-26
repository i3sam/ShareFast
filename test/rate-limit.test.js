import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RateLimiter } from '../server/rate-limit.js';

test('allows up to the limit within a window', () => {
  const limiter = new RateLimiter({ windowMs: 1000, max: 2 });
  assert.equal(limiter.take('a', 0), true);
  assert.equal(limiter.take('a', 10), true);
  assert.equal(limiter.take('a', 20), false);
  assert.equal(limiter.take('b', 20), true);
});

test('resets after the window passes', () => {
  const limiter = new RateLimiter({ windowMs: 1000, max: 1 });
  assert.equal(limiter.take('a', 0), true);
  assert.equal(limiter.take('a', 500), false);
  assert.equal(limiter.take('a', 1000), true);
});

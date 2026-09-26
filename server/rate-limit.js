// Fixed-window counter per key. Good enough for a single process; put a real
// limiter in front if you run several instances.
export class RateLimiter {
  #hits = new Map();
  #windowMs;
  #max;
  #lastPrune = 0;

  constructor({ windowMs, max }) {
    this.#windowMs = windowMs;
    this.#max = max;
  }

  take(key, now = Date.now()) {
    this.#prune(now);

    const entry = this.#hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.#hits.set(key, { count: 1, resetAt: now + this.#windowMs });
      return true;
    }
    if (entry.count >= this.#max) return false;

    entry.count += 1;
    return true;
  }

  #prune(now) {
    if (now - this.#lastPrune < this.#windowMs) return;
    this.#lastPrune = now;
    for (const [key, entry] of this.#hits) {
      if (entry.resetAt <= now) this.#hits.delete(key);
    }
  }
}

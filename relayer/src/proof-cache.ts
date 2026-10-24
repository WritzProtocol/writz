/**
 * Bounded, in-memory TTL cache with request coalescing, for the SPV proof
 * route. Per-process like the rate limiter (src/rate-limit.ts): it resets on
 * restart and is not shared across instances, which is enough for the single
 * Railway service the relayer runs as.
 *
 * Coalescing: while a value for a key is being computed, every other caller
 * for that key awaits the same promise instead of starting its own upstream
 * calls. A computation that throws is never cached; the next caller retries.
 */

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export interface Computed<V> {
  value: V;
  /** How long to keep the value; 0 or less means do not cache it. */
  ttlMs: number;
}

export class TtlCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly inflight = new Map<string, Promise<V>>();

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Re-insert so Map order tracks recency: eviction drops the least
    // recently used entry, not the oldest inserted one.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    if (ttlMs <= 0 || this.maxEntries <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  /** Cached value for `key`, or the result of one shared `compute()` call. */
  getOrCompute(key: string, compute: () => Promise<Computed<V>>): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return Promise.resolve(hit);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = compute()
      .then(({ value, ttlMs }) => {
        this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }
}

export const IDEMPOTENCY_TTL_MS = 5 * 60_000;
export const IDEMPOTENCY_MAX_ENTRIES = 500;

interface Entry<T> {
  expiresAt: number;
  promise: Promise<T>;
  settled: boolean;
}

export class IdempotencyCache {
  private readonly entries = new Map<string, Entry<unknown>>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = IDEMPOTENCY_TTL_MS,
    private readonly maxEntries = IDEMPOTENCY_MAX_ENTRIES,
  ) {}

  getOrCreate<T>(key: string, operation: () => Promise<T>): Promise<T> {
    this.prune();
    const existing = this.entries.get(key);
    if (existing) return existing.promise as Promise<T>;
    let entry: Entry<T>;
    const promise = Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          entry.settled = true;
          entry.expiresAt = this.now() + this.ttlMs;
          this.evictSettledOverflow();
          return value;
        },
        (error: unknown) => {
          if (this.entries.get(key) === entry) this.entries.delete(key);
          throw error;
        },
      );
    entry = { expiresAt: Number.POSITIVE_INFINITY, promise, settled: false };
    this.entries.set(key, entry);
    this.evictSettledOverflow();
    return entry.promise;
  }

  prune(): void {
    const now = this.now();
    for (const [key, entry] of this.entries)
      if (entry.settled && entry.expiresAt <= now) this.entries.delete(key);
  }

  private evictSettledOverflow(): void {
    if (this.entries.size <= this.maxEntries) return;
    for (const [key, entry] of this.entries) {
      if (!entry.settled) continue;
      this.entries.delete(key);
      if (this.entries.size <= this.maxEntries) return;
    }
  }

  get size(): number {
    this.prune();
    return this.entries.size;
  }
}

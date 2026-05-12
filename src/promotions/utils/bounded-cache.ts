export interface BoundedCacheOptions {
  maxSize: number;
  ttlMs: number;
}

interface CacheEntry<TValue> {
  value: TValue;
  expiresAt: number;
}

export class BoundedCache<TKey, TValue> {
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly store = new Map<TKey, CacheEntry<TValue>>();

  constructor(options: BoundedCacheOptions) {
    this.maxSize = Math.max(1, options.maxSize);
    this.ttlMs = Math.max(1, options.ttlMs);
  }

  get size(): number {
    this.pruneExpired();
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  get(key: TKey): TValue | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: TKey, value: TValue): void {
    this.pruneExpired();

    if (!this.store.has(key) && this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value as TKey | undefined;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  private pruneExpired(): void {
    const now = Date.now();

    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }
}

export interface TtlCacheOptions {
  ttlMs: number;
}

interface Entry<V> { value: V; expiresAt: number }

export class TtlCache<K, V> {
  private readonly map = new Map<K, Entry<V>>();
  private readonly ttlMs: number;

  constructor(opts: TtlCacheOptions) { this.ttlMs = opts.ttlMs; }

  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (e === undefined) return undefined;
    if (Date.now() >= e.expiresAt) { this.map.delete(key); return undefined; }
    return e.value;
  }

  set(key: K, value: V): void {
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(key: K): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TtlCache } from '../../src/shared/cache.js';

describe('TtlCache', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns a cached value on second get within TTL', () => {
    const c = new TtlCache<string, number>({ ttlMs: 1000 });
    c.set('k', 1);
    vi.advanceTimersByTime(500);
    expect(c.get('k')).toBe(1);
  });

  it('returns undefined after TTL expires', () => {
    const c = new TtlCache<string, number>({ ttlMs: 1000 });
    c.set('k', 1);
    vi.advanceTimersByTime(1001);
    expect(c.get('k')).toBeUndefined();
  });

  it('invalidate(key) removes a single entry', () => {
    const c = new TtlCache<string, number>({ ttlMs: 1000 });
    c.set('a', 1); c.set('b', 2);
    c.invalidate('a');
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
  });

  it('clear() removes all entries', () => {
    const c = new TtlCache<string, number>({ ttlMs: 1000 });
    c.set('a', 1); c.set('b', 2);
    c.clear();
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBeUndefined();
  });

  it('overwrites existing entry and resets TTL', () => {
    const c = new TtlCache<string, number>({ ttlMs: 1000 });
    c.set('k', 1);
    vi.advanceTimersByTime(900);
    c.set('k', 2);
    vi.advanceTimersByTime(900);
    expect(c.get('k')).toBe(2);
  });
});

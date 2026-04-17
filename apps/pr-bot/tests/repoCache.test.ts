import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RepoCache } from '../src/graph/repoCache.js';

const TEST_BASE = '/tmp/ctxloom-bot-test';

describe('RepoCache', () => {
  afterEach(async () => {
    await fs.rm(TEST_BASE, { recursive: true, force: true });
  });

  it('pathFor returns a stable absolute path under baseDir', () => {
    const cache = new RepoCache(TEST_BASE);
    const key = { installationId: 1, repoId: 2, baseSha: 'abc123' };
    const result = cache.pathFor(key);

    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toBe(path.join(TEST_BASE, '1', '2', 'abc123'));
    // stable: calling again returns same value
    expect(cache.pathFor(key)).toBe(result);
  });

  it('round-trips a file written to the cache path', async () => {
    const cache = new RepoCache(TEST_BASE);
    const key = { installationId: 1, repoId: 2, baseSha: 'deadbeef' };
    const dir = cache.pathFor(key);

    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, 'graph.json');
    await fs.writeFile(filePath, JSON.stringify({ nodes: 3 }), 'utf-8');

    const content = await fs.readFile(filePath, 'utf-8');
    expect(JSON.parse(content)).toEqual({ nodes: 3 });
  });

  it('evict removes entries older than maxAgeDays and returns count', async () => {
    const cache = new RepoCache(TEST_BASE);

    // Create two entries
    const old = cache.pathFor({ installationId: 1, repoId: 1, baseSha: 'old' });
    const fresh = cache.pathFor({ installationId: 1, repoId: 1, baseSha: 'fresh' });

    await fs.mkdir(old, { recursive: true });
    await fs.mkdir(fresh, { recursive: true });

    // Mock fs.stat to return old mtime for 'old' dir and current for 'fresh'
    const realStat = fs.stat.bind(fs);
    const now = Date.now();
    const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;

    vi.spyOn(fs, 'stat').mockImplementation(async (p) => {
      const pStr = String(p);
      if (pStr.endsWith('old')) {
        const s = await realStat(pStr);
        return { ...s, mtimeMs: eightDaysAgo } as Awaited<ReturnType<typeof fs.stat>>;
      }
      return realStat(pStr);
    });

    const evicted = await cache.evict(7);
    vi.restoreAllMocks();

    expect(evicted).toBe(1);
    // old dir should be gone
    await expect(fs.access(old)).rejects.toThrow();
    // fresh dir should still exist
    await expect(fs.access(fresh)).resolves.toBeUndefined();
  });
});

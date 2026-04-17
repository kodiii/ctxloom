import { describe, it, expect } from 'vitest';
import { RepoCache } from '../src/graph/repoCache.js';
import { ensureGraph, type EnsureGraphParams } from '../src/graph/ensureGraph.js';

const TEST_CACHE_BASE = '/tmp/ctxloom-bot-ensure-graph-test';

const BASE_PARAMS: EnsureGraphParams = {
  installationId: 42,
  repoId: 7,
  baseSha: 'aabbcc',
  headSha: 'ddeeff',
};

describe('ensureGraph', () => {
  it('when localRepoPath is provided: returns GraphHandle with rootDir === localRepoPath and matching shas', async () => {
    const cache = new RepoCache(TEST_CACHE_BASE);
    const params: EnsureGraphParams = { ...BASE_PARAMS, localRepoPath: '/some/path' };

    const handle = await ensureGraph(params, cache);

    expect(handle.rootDir).toBe('/some/path');
    expect(handle.baseSha).toBe(BASE_PARAMS.baseSha);
    expect(handle.headSha).toBe(BASE_PARAMS.headSha);
  });

  it('when localRepoPath is not provided: returns GraphHandle with rootDir under the cache directory', async () => {
    const cache = new RepoCache(TEST_CACHE_BASE);
    const params: EnsureGraphParams = { ...BASE_PARAMS };

    const handle = await ensureGraph(params, cache);

    const expectedCachePath = cache.pathFor({
      installationId: BASE_PARAMS.installationId,
      repoId: BASE_PARAMS.repoId,
      baseSha: BASE_PARAMS.baseSha,
    });
    expect(handle.rootDir.startsWith(TEST_CACHE_BASE)).toBe(true);
    expect(handle.rootDir).toBe(expectedCachePath);
    expect(handle.baseSha).toBe(BASE_PARAMS.baseSha);
    expect(handle.headSha).toBe(BASE_PARAMS.headSha);
  });

  it('both branches resolve without throwing', async () => {
    const cache = new RepoCache(TEST_CACHE_BASE);

    await expect(ensureGraph({ ...BASE_PARAMS, localRepoPath: '/some/path' }, cache)).resolves.toBeDefined();
    await expect(ensureGraph({ ...BASE_PARAMS }, cache)).resolves.toBeDefined();
  });
});

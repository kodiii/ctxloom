/**
 * Unit tests for ProjectStateManager.
 *
 * Verifies:
 *   - get(root) creates and caches ProjectState
 *   - second get(sameRoot) returns the cached state (object identity)
 *   - LRU cap evicts the oldest non-pinned entry
 *   - pinned entries never evict
 *   - dispose is called on eviction
 *   - concurrency: two parallel get(coldRoot) share one state
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectStateManager } from '../packages/core/src/server/ProjectStateManager.js';

describe('ProjectStateManager', () => {
  it('creates and caches ProjectState on first get', () => {
    const mgr = new ProjectStateManager({ maxProjects: 3 });
    const s1 = mgr.get('/abs/foo');
    const s2 = mgr.get('/abs/foo');
    expect(s1).toBe(s2); // object identity
    expect(s1.projectRoot).toBe('/abs/foo');
    expect(mgr.size()).toBe(1);
  });

  it('updates lastTouchedAt on each get', async () => {
    const mgr = new ProjectStateManager({ maxProjects: 3 });
    const s = mgr.get('/abs/foo');
    const t1 = s.lastTouchedAt;
    await new Promise((r) => setTimeout(r, 5));
    mgr.get('/abs/foo');
    expect(s.lastTouchedAt).toBeGreaterThan(t1);
  });

  it('evicts LRU non-pinned entry when cap exceeded', async () => {
    const disposeCalls: string[] = [];
    const mgr = new ProjectStateManager({
      maxProjects: 2,
      onDispose: (state) => {
        disposeCalls.push(state.projectRoot);
        return Promise.resolve();
      },
    });
    mgr.get('/abs/a'); // first
    await new Promise((r) => setTimeout(r, 5));
    mgr.get('/abs/b'); // second
    await new Promise((r) => setTimeout(r, 5));
    mgr.get('/abs/c'); // third — should evict /abs/a (LRU)
    await new Promise((r) => setTimeout(r, 50));
    expect(disposeCalls).toEqual(['/abs/a']);
    expect(mgr.has('/abs/a')).toBe(false);
    expect(mgr.has('/abs/b')).toBe(true);
    expect(mgr.has('/abs/c')).toBe(true);
  });

  it('never evicts a pinned entry, even if it is the LRU', async () => {
    const mgr = new ProjectStateManager({ maxProjects: 2 });
    mgr.pin('/abs/default'); // pinned, first
    await new Promise((r) => setTimeout(r, 5));
    mgr.get('/abs/b'); // second
    await new Promise((r) => setTimeout(r, 5));
    mgr.get('/abs/c'); // third — must evict /abs/b, NOT /abs/default
    expect(mgr.has('/abs/default')).toBe(true);
    expect(mgr.has('/abs/b')).toBe(false);
    expect(mgr.has('/abs/c')).toBe(true);
  });

  it('parallel get() on the same cold root returns identical ProjectState', () => {
    const mgr = new ProjectStateManager({ maxProjects: 3 });
    // get() is synchronous and idempotent — first call creates, second sees cache.
    const a = mgr.get('/abs/foo');
    const b = mgr.get('/abs/foo');
    expect(a).toBe(b);
    expect(mgr.size()).toBe(1);
  });

  it('throws on adding past cap when ALL entries are pinned', () => {
    const mgr = new ProjectStateManager({ maxProjects: 2 });
    mgr.pin('/abs/a');
    mgr.pin('/abs/b');
    expect(() => mgr.get('/abs/c')).toThrow(/cannot evict — all .* pinned/);
  });
});

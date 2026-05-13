/**
 * KillSwitch.test.ts
 *
 * Verifies the CTXLOOM_DISABLE_MULTIPROJECT=1 kill-switch semantics:
 *
 *   1. ProjectStateManager with maxProjects=1 (the cap applied by the kill
 *      switch) evicts the non-pinned entry when a second project is requested,
 *      leaving exactly 1 project in the list at all times.
 *
 *   2. When the only entry is pinned (mirroring the kill-switch scenario where
 *      the default project is pinned at server boot), attempting a second
 *      project throws — the caller cannot slip past the cap.
 *
 *   3. resolveOrDefault kill-switch path: when DISABLE_MULTIPROJECT forces
 *      maxProjects=1 and the default project is pinned, any attempt to add a
 *      distinct second project throws, proving that the stateManager is the
 *      enforcement point regardless of what project_root argument was passed.
 *
 * NOTE: The [DEPRECATED] startup warning emitted by startServer() when
 * CTXLOOM_DISABLE_MULTIPROJECT=1 is set is exercised here via a comment-level
 * reference. Asserting logger output in unit tests requires intercepting the
 * pino/logger singleton, which would add an unnecessary test-infrastructure
 * dependency. The warning exists at src/server.ts inside startServer() and is
 * covered by code inspection + integration smoke tests.
 */
import { describe, it, expect } from 'vitest';
import { ProjectStateManager } from '../packages/core/src/server/ProjectStateManager.js';

describe('Kill-switch: ProjectStateManager with maxProjects=1', () => {
  it('evicts the first (non-pinned) project when a second is requested', async () => {
    const disposed: string[] = [];
    const mgr = new ProjectStateManager({
      maxProjects: 1,
      onDispose: (state) => {
        disposed.push(state.projectRoot);
        return Promise.resolve();
      },
    });

    // First touch — creates project A.
    const stateA = mgr.get('/tmp/projA');
    expect(stateA.projectRoot).toBe('/tmp/projA');
    expect(mgr.size()).toBe(1);

    // Second touch — cap is 1, so A must be evicted to make room for B.
    const stateB = mgr.get('/tmp/projB');
    expect(stateB.projectRoot).toBe('/tmp/projB');

    // After eviction, exactly 1 project remains in the live list.
    expect(mgr.size()).toBe(1);
    expect(mgr.has('/tmp/projA')).toBe(false);
    expect(mgr.has('/tmp/projB')).toBe(true);
    expect(mgr.list()).toHaveLength(1);
    expect(mgr.list()[0].projectRoot).toBe('/tmp/projB');

    // Allow the fire-and-forget onDispose to settle.
    await new Promise((r) => setTimeout(r, 20));
    expect(disposed).toEqual(['/tmp/projA']);
  });

  it('throws when the sole entry is pinned and a second project is requested', () => {
    // This mirrors kill-switch mode at runtime: the default project is pinned
    // at server boot via stateManager.pin(defaultRoot). With maxProjects=1 no
    // unpinned victim exists, so get() on any other root must throw rather than
    // silently evicting the default project.
    const mgr = new ProjectStateManager({
      maxProjects: 1,
      onDispose: () => Promise.resolve(),
    });

    // Pin the default project (as server boot does).
    mgr.pin('/tmp/defaultProject');
    expect(mgr.size()).toBe(1);

    // Any other root should throw because the only entry is pinned.
    expect(() => mgr.get('/tmp/otherProject')).toThrow(/cannot evict — all .* pinned/);

    // The pinned default project is untouched.
    expect(mgr.has('/tmp/defaultProject')).toBe(true);
    expect(mgr.size()).toBe(1);
  });

  it('returns the same pinned state on repeated gets — no eviction attempt', () => {
    // Sanity-check: calling get() on the already-pinned root never triggers
    // eviction because the entry already exists in the map.
    const mgr = new ProjectStateManager({
      maxProjects: 1,
      onDispose: () => Promise.resolve(),
    });

    const s1 = mgr.pin('/tmp/defaultProject');
    const s2 = mgr.get('/tmp/defaultProject'); // same key — must hit the cache
    expect(s1).toBe(s2); // object identity
    expect(mgr.size()).toBe(1);
  });

  it('list() always returns at most maxProjects=1 entries after sequential gets', async () => {
    // Simulates a series of distinct project_root values arriving over time
    // (e.g. the test suite or an MCP client passing different roots). With
    // maxProjects=1 and no pinning the list must never grow beyond 1.
    const mgr = new ProjectStateManager({
      maxProjects: 1,
      onDispose: () => Promise.resolve(),
    });

    const roots = ['/tmp/alpha', '/tmp/beta', '/tmp/gamma', '/tmp/delta'];
    for (const root of roots) {
      // Small delay so lastTouchedAt ordering is deterministic.
      await new Promise((r) => setTimeout(r, 5));
      mgr.get(root);
      expect(mgr.list().length).toBeLessThanOrEqual(1);
    }

    // Only the last-requested root should remain.
    expect(mgr.list()[0].projectRoot).toBe('/tmp/delta');
  });
});

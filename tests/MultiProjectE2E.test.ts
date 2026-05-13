/**
 * Multi-project end-to-end integration test.
 *
 * Exercises the composition of the core multi-project components together:
 *   ProjectStateManager + RepoRegistry + resolveProjectRoot + FirstTouchTracker
 *   + wrapWithIndexingEnvelope + aliasNotFoundError
 *
 * Tests run at unit speed — no MCP server process is spun up. All components
 * are real instances operating on in-memory or temp-dir state.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectStateManager } from '../packages/core/src/server/ProjectStateManager.js';
import { RepoRegistry } from '../packages/core/src/tools/cross-repo-search.js';
import { resolveProjectRoot } from '../packages/core/src/server/resolveProjectRoot.js';
import { FirstTouchTracker, wrapWithIndexingEnvelope } from '../packages/core/src/server/indexingEnvelope.js';
import { aliasNotFoundError } from '../packages/core/src/server/structuredErrors.js';
import { disposeProjectState } from '../packages/core/src/server/ProjectState.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a transient RepoRegistry backed by a temp file. */
function makeTempRegistry(): { registry: RepoRegistry; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-e2e-'));
  const filePath = path.join(tmpDir, 'repos.json');
  const registry = new RepoRegistry(filePath);
  return {
    registry,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Multi-project E2E: component composition', () => {
  // 1. Two-project state isolation
  it('ProjectStateManager holds independent state for two different roots', () => {
    const manager = new ProjectStateManager({ maxProjects: 5, onDispose: () => Promise.resolve() });

    const stateA = manager.get('/tmp/projA');
    const stateB = manager.get('/tmp/projB');

    const listed = manager.list();
    const roots = listed.map((s) => s.projectRoot);

    expect(roots).toContain('/tmp/projA');
    expect(roots).toContain('/tmp/projB');
    expect(listed).toHaveLength(2);

    // Each root yields a distinct object
    expect(stateA).not.toBe(stateB);
    expect(stateA.projectRoot).toBe('/tmp/projA');
    expect(stateB.projectRoot).toBe('/tmp/projB');
  });

  // 2. Alias resolution round-trip
  it('resolveProjectRoot resolves a registered alias to its root path', () => {
    const { registry, cleanup } = makeTempRegistry();
    try {
      registry.register('/tmp/projAlpha', '/tmp/projAlpha/.ctxloom/vectors.lancedb', { alias: 'alpha' });

      const outcome = resolveProjectRoot({
        arg: 'alpha',
        env: undefined,
        cwd: '/tmp/default',
        registry,
      });

      expect(outcome.kind).toBe('ok');
      if (outcome.kind === 'ok') {
        expect(outcome.root).toBe('/tmp/projAlpha');
        expect(outcome.alias).toBe('alpha');
        expect(outcome.source).toBe('arg-alias');
      }
    } finally {
      cleanup();
    }
  });

  // 3. Path resolution round-trip
  it('resolveProjectRoot resolves an existing absolute path directly', () => {
    const { registry, cleanup } = makeTempRegistry();
    // Use os.tmpdir() which is guaranteed to exist on the host
    const existingPath = os.tmpdir();
    try {
      const outcome = resolveProjectRoot({
        arg: existingPath,
        env: undefined,
        cwd: '/tmp/default',
        registry,
      });

      expect(outcome.kind).toBe('ok');
      if (outcome.kind === 'ok') {
        // realpathSync may expand symlinks (e.g. /tmp → /private/tmp on macOS)
        expect(outcome.root).toBeTruthy();
        expect(outcome.source).toBe('arg-path');
      }
    } finally {
      cleanup();
    }
  });

  // 4. Unknown alias returns alias_not_found
  it('resolveProjectRoot returns alias_not_found for an unregistered alias', () => {
    const { registry, cleanup } = makeTempRegistry();
    try {
      const outcome = resolveProjectRoot({
        arg: 'unknown',
        env: undefined,
        cwd: '/tmp/default',
        registry,
      });

      expect(outcome.kind).toBe('alias_not_found');
      if (outcome.kind === 'alias_not_found') {
        expect(outcome.alias).toBe('unknown');
        expect(Array.isArray(outcome.didYouMean)).toBe(true);
      }
    } finally {
      cleanup();
    }
  });

  // 5. LRU eviction at cap=2
  it('ProjectStateManager evicts the LRU entry when maxProjects=2 is exceeded', async () => {
    const disposedRoots: string[] = [];
    const manager2 = new ProjectStateManager({
      maxProjects: 2,
      onDispose: (state) => {
        disposedRoots.push(state.projectRoot);
        return Promise.resolve();
      },
    });

    manager2.get('/tmp/p1');
    // Introduce ordering so lastTouchedAt differs between entries
    await new Promise<void>((r) => setTimeout(r, 5));
    manager2.get('/tmp/p2');
    await new Promise<void>((r) => setTimeout(r, 5));
    // Adding /tmp/p3 forces eviction of the LRU entry (/tmp/p1)
    manager2.get('/tmp/p3');

    // Allow the fire-and-forget onDispose promise to settle
    await new Promise<void>((r) => setTimeout(r, 50));

    const listed = manager2.list();
    expect(listed).toHaveLength(2);
    expect(listed.map((s) => s.projectRoot)).not.toContain('/tmp/p1');
    expect(listed.map((s) => s.projectRoot)).toContain('/tmp/p2');
    expect(listed.map((s) => s.projectRoot)).toContain('/tmp/p3');
  });

  // 6. FirstTouchTracker per-root isolation
  it('FirstTouchTracker tracks first-touch independently for each root', () => {
    const tracker = new FirstTouchTracker();

    // First touch for /tmp/pA graph — must be true
    expect(tracker.markAndCheck('/tmp/pA', 'graph')).toBe(true);
    // Subsequent touch for same root+tier — must be false
    expect(tracker.markAndCheck('/tmp/pA', 'graph')).toBe(false);
    // Different root, same tier — must be true (independent tracking)
    expect(tracker.markAndCheck('/tmp/pB', 'graph')).toBe(true);
    // Second call for /tmp/pB — false
    expect(tracker.markAndCheck('/tmp/pB', 'graph')).toBe(false);
  });

  // 7. Indexing envelope wraps on first touch only
  it('wrapWithIndexingEnvelope prepends envelope on first touch and passes through otherwise', () => {
    const firstTouchResult = wrapWithIndexingEnvelope(
      { firstTouch: true, projectRoot: '/tmp/proj', tier: 'graph', durationMs: 100 },
      'tool output',
    );
    expect(firstTouchResult).toMatch(/^<ctxloom_indexing/);
    expect(firstTouchResult).toContain('tool output');

    const subsequentResult = wrapWithIndexingEnvelope(
      { firstTouch: false, projectRoot: '/tmp/proj', tier: 'graph', durationMs: 0 },
      'tool output',
    );
    expect(subsequentResult).toBe('tool output');
  });

  // 8. aliasNotFoundError XML structure
  it('aliasNotFoundError produces valid XML with alias and didYouMean values', () => {
    const xml = aliasNotFoundError({ alias: 'ghost', didYouMean: ['alpha'] });

    expect(xml).toContain('code="alias_not_found"');
    expect(xml).toContain('ghost');
    expect(xml).toContain('alpha');
  });
});

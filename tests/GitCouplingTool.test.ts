/**
 * Tests for ctx_git_coupling MCP tool.
 *
 * Builds a fake ServerContext with a pre-populated GitOverlayStore
 * and verifies co-change coupling results.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { GitOverlayStore } from '../src/git/GitOverlayStore.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerGitCouplingTool } from '../src/tools/git-coupling.js';
import type { ServerContext } from '../src/tools/context.js';
import type { GitCommitEvent } from '../src/git/GitHistoryMiner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW_S = Math.floor(Date.now() / 1000);

function makeEvent(
  sha: string,
  paths: string[],
  timestamp: number,
  message = `commit ${sha}`,
): GitCommitEvent {
  return {
    sha,
    author: 'Test Author',
    authorEmail: 'author@example.com',
    timestamp,
    message,
    files: paths.map((p) => ({ path: p, added: 10, deleted: 2 })),
    isBulk: false,
    isMerge: false,
  };
}

function makeCtxWithOverlay(overlay: GitOverlayStore): ServerContext {
  return {
    projectRoot: '/fake',
    dbPath: '/fake/.ctxloom/vectors.lancedb',
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.reject(new Error('not needed')),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: () => Promise.reject(new Error('not needed')),
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => false,
    isParserInitialized: () => false,
    overlay,
  };
}

function makeCtxNoOverlay(): ServerContext {
  return {
    projectRoot: '/fake',
    dbPath: '/fake/.ctxloom/vectors.lancedb',
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.reject(new Error('not needed')),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: () => Promise.reject(new Error('not needed')),
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => false,
    isParserInitialized: () => false,
  };
}

// ---------------------------------------------------------------------------
// Build a synthetic overlay store
// ---------------------------------------------------------------------------

function buildOverlay(): GitOverlayStore {
  // We create a minimal stand-in that wraps CoChangeIndex directly.
  // GitOverlayStore requires a repoRoot; we pass '/fake' and never call rebuild/refresh.
  const store = new GitOverlayStore('/fake');

  // 5 commits where src/a.ts and src/b.ts co-appear (above noise floor of 3)
  for (let i = 0; i < 5; i++) {
    const event = makeEvent(`ab${i}`, ['src/a.ts', 'src/b.ts'], NOW_S - i * 100);
    store.coChange.ingest(event);
    store.churn.ingest(event);
    store.ownership.ingest(event);
  }

  // 2 commits where src/a.ts and src/c.ts co-appear (below noise floor of 3)
  for (let i = 0; i < 2; i++) {
    const event = makeEvent(`ac${i}`, ['src/a.ts', 'src/c.ts'], NOW_S - i * 50);
    store.coChange.ingest(event);
    store.churn.ingest(event);
    store.ownership.ingest(event);
  }

  return store;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ctx_git_coupling', () => {
  let registry: ToolRegistry;
  let overlay: GitOverlayStore;

  beforeEach(() => {
    overlay = buildOverlay();
    registry = new ToolRegistry();
    registerGitCouplingTool(registry, makeCtxWithOverlay(overlay));
  });

  it('returns src/b.ts in results with confidence > 0, sharedCommits=5, lastSharedDaysAgo, explanation', async () => {
    const raw = await registry.dispatch('ctx_git_coupling', {
      file: 'src/a.ts',
      limit: 3,
    });

    const result = JSON.parse(raw) as {
      file: string;
      coupledFiles: Array<{
        file: string;
        confidence: number;
        sharedCommits: number;
        lastSharedDaysAgo: number;
        explanation: string;
      }>;
      note: string | null;
    };

    expect(result.file).toBe('src/a.ts');

    const bEntry = result.coupledFiles.find((e) => e.file === 'src/b.ts');
    expect(bEntry).toBeDefined();
    expect(bEntry!.confidence).toBeGreaterThan(0);
    expect(bEntry!.sharedCommits).toBe(5);
    expect(typeof bEntry!.lastSharedDaysAgo).toBe('number');
    expect(typeof bEntry!.explanation).toBe('string');
    expect(bEntry!.explanation.length).toBeGreaterThan(0);
  });

  it('does NOT include src/c.ts with default min_confidence (sharedCommits=2 < noise floor)', async () => {
    const raw = await registry.dispatch('ctx_git_coupling', {
      file: 'src/a.ts',
      limit: 10,
    });

    const result = JSON.parse(raw) as { coupledFiles: Array<{ file: string }> };
    const cEntry = result.coupledFiles.find((e) => e.file === 'src/c.ts');
    expect(cEntry).toBeUndefined();
  });

  it('returns note explaining missing overlay when overlay is undefined on context', async () => {
    const reg2 = new ToolRegistry();
    registerGitCouplingTool(reg2, makeCtxNoOverlay());

    const raw = await reg2.dispatch('ctx_git_coupling', { file: 'src/a.ts' });
    const result = JSON.parse(raw) as { note: string | null; coupledFiles: unknown[] };

    expect(result.coupledFiles).toHaveLength(0);
    expect(result.note).toBeTruthy();
    expect(typeof result.note).toBe('string');
  });

  it('results are sorted descending by confidence', async () => {
    // Add src/d.ts with 4 shared commits — still above noise floor, but fewer than b
    for (let i = 0; i < 4; i++) {
      const event = makeEvent(`ad${i}`, ['src/a.ts', 'src/d.ts'], NOW_S - i * 200);
      overlay.coChange.ingest(event);
    }

    const raw = await registry.dispatch('ctx_git_coupling', {
      file: 'src/a.ts',
      limit: 10,
    });

    const result = JSON.parse(raw) as {
      coupledFiles: Array<{ confidence: number }>;
    };

    const confs = result.coupledFiles.map((e) => e.confidence);
    for (let i = 1; i < confs.length; i++) {
      expect(confs[i - 1]!).toBeGreaterThanOrEqual(confs[i]!);
    }
  });
});

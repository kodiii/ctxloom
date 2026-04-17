import { describe, it, expect } from 'vitest';
import { computeBlastRadius, type BlastRadiusOptions, registerBlastRadiusTool } from '../src/tools/blast-radius.js';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { GitOverlayStore } from '../src/git/GitOverlayStore.js';
import type { ServerContext } from '../src/tools/context.js';
import type { GitCommitEvent } from '../src/git/GitHistoryMiner.js';

function makeGraph(): DependencyGraph {
  const g = new DependencyGraph();
  // auth.ts ← services/user.ts ← controllers/api.ts ← server.ts
  g.addEdge('services/user.ts', 'auth.ts');
  g.addEdge('controllers/api.ts', 'services/user.ts');
  g.addEdge('server.ts', 'controllers/api.ts');
  return g;
}

function makeCtx(graph: DependencyGraph, overlay?: GitOverlayStore): ServerContext {
  return {
    projectRoot: '/fake',
    dbPath: '/fake/.ctxloom/vectors.lancedb',
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.resolve(graph),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: () => Promise.reject(new Error('not needed')),
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => true,
    isParserInitialized: () => false,
    overlay,
  };
}

describe('computeBlastRadius', () => {
  it('identifies direct importers', async () => {
    const graph = makeGraph();
    const result = await computeBlastRadius({
      changedFiles: ['auth.ts'],
      depth: 1,
      projectRoot: '/fake',
      graph,
    });
    expect(result.directImporters).toContain('services/user.ts');
    expect(result.directImporters).not.toContain('controllers/api.ts');
  });

  it('identifies transitive importers at depth 3', async () => {
    const graph = makeGraph();
    const result = await computeBlastRadius({
      changedFiles: ['auth.ts'],
      depth: 3,
      projectRoot: '/fake',
      graph,
    });
    expect(result.transitiveImporters).toContain('controllers/api.ts');
    expect(result.transitiveImporters).toContain('server.ts');
  });

  it('excludes changed files from importer lists', async () => {
    const graph = makeGraph();
    const result = await computeBlastRadius({
      changedFiles: ['auth.ts'],
      depth: 3,
      projectRoot: '/fake',
      graph,
    });
    expect(result.directImporters).not.toContain('auth.ts');
    expect(result.transitiveImporters).not.toContain('auth.ts');
  });

  it('returns empty results for isolated file', async () => {
    const graph = makeGraph();
    const result = await computeBlastRadius({
      changedFiles: ['isolated.ts'],
      depth: 3,
      projectRoot: '/fake',
      graph,
    });
    expect(result.directImporters).toHaveLength(0);
    expect(result.transitiveImporters).toHaveLength(0);
  });
});

describe('historicalCoupling', () => {
  /**
   * Build a GitOverlayStore where src/a.ts and src/z.ts co-change in 5 commits.
   * src/z.ts has NO static import relationship with src/a.ts.
   */
  function buildOverlayWithCoupling(): GitOverlayStore {
    const store = new GitOverlayStore('/fake-repo');
    const now = Math.floor(Date.now() / 1000);
    const dayAgo = now - 86400;

    const events: GitCommitEvent[] = [
      {
        sha: 'c1',
        author: 'Bob',
        authorEmail: 'bob@example.com',
        timestamp: dayAgo,
        message: 'feat: update a and z together',
        files: [
          { path: 'src/a.ts', added: 10, deleted: 2 },
          { path: 'src/z.ts', added: 5, deleted: 1 },
        ],
        isMerge: false,
        isBulk: false,
      },
      {
        sha: 'c2',
        author: 'Bob',
        authorEmail: 'bob@example.com',
        timestamp: dayAgo,
        message: 'fix: bug in a and z',
        files: [
          { path: 'src/a.ts', added: 3, deleted: 1 },
          { path: 'src/z.ts', added: 2, deleted: 0 },
        ],
        isMerge: false,
        isBulk: false,
      },
      {
        sha: 'c3',
        author: 'Bob',
        authorEmail: 'bob@example.com',
        timestamp: dayAgo,
        message: 'refactor: clean up a and z',
        files: [
          { path: 'src/a.ts', added: 8, deleted: 4 },
          { path: 'src/z.ts', added: 3, deleted: 3 },
        ],
        isMerge: false,
        isBulk: false,
      },
      {
        sha: 'c4',
        author: 'Bob',
        authorEmail: 'bob@example.com',
        timestamp: dayAgo,
        message: 'chore: update a and z',
        files: [
          { path: 'src/a.ts', added: 2, deleted: 0 },
          { path: 'src/z.ts', added: 1, deleted: 0 },
        ],
        isMerge: false,
        isBulk: false,
      },
      {
        sha: 'c5',
        author: 'Bob',
        authorEmail: 'bob@example.com',
        timestamp: dayAgo,
        message: 'feat: new feature in a and z',
        files: [
          { path: 'src/a.ts', added: 15, deleted: 3 },
          { path: 'src/z.ts', added: 7, deleted: 2 },
        ],
        isMerge: false,
        isBulk: false,
      },
    ];

    for (const event of events) {
      store.coChange.ingest(event);
      store.churn.ingest(event);
      store.ownership.ingest(event);
    }

    return store;
  }

  it('includes historicalCoupling with src/z.ts when it co-changes strongly with src/a.ts', async () => {
    // src/a.ts has no static import relationship to src/z.ts
    const graph = new DependencyGraph();
    // src/a.ts only has static imports from src/b.ts — not z
    graph.addEdge('src/b.ts', 'src/a.ts');

    const overlay = buildOverlayWithCoupling();
    const registry = new ToolRegistry();
    registerBlastRadiusTool(registry, makeCtx(graph, overlay));

    const result = await registry.dispatch('ctx_blast_radius', {
      changed_files: ['src/a.ts'],
      use_git: false,
    });

    expect(result).toContain('historical_coupling');
    expect(result).toContain('src/z.ts');
    // confidence must be a positive number attribute
    expect(result).toMatch(/confidence="\d+(\.\d+)?"/);
  });

  it('src/z.ts is NOT in the static blast radius (directImporters / transitiveImporters)', async () => {
    const graph = new DependencyGraph();
    graph.addEdge('src/b.ts', 'src/a.ts');

    const overlay = buildOverlayWithCoupling();
    const registry = new ToolRegistry();
    registerBlastRadiusTool(registry, makeCtx(graph, overlay));

    const result = await registry.dispatch('ctx_blast_radius', {
      changed_files: ['src/a.ts'],
      use_git: false,
    });

    // Verify structure: src/z.ts should only appear inside historical_coupling, not in
    // direct_importers or transitive_importers sections
    const directImportersSection = result.match(/<direct_importers[\s\S]*?<\/direct_importers>/)?.[0] ?? '';
    const transitiveImportersSection = result.match(/<transitive_importers[\s\S]*?<\/transitive_importers>/)?.[0] ?? '';
    expect(directImportersSection).not.toContain('src/z.ts');
    expect(transitiveImportersSection).not.toContain('src/z.ts');
  });

  it('historicalCoupling includes evidence string', async () => {
    const graph = new DependencyGraph();
    graph.addEdge('src/b.ts', 'src/a.ts');

    const overlay = buildOverlayWithCoupling();
    const registry = new ToolRegistry();
    registerBlastRadiusTool(registry, makeCtx(graph, overlay));

    const result = await registry.dispatch('ctx_blast_radius', {
      changed_files: ['src/a.ts'],
      use_git: false,
    });

    // evidence attribute should mention "commits"
    expect(result).toMatch(/evidence="[^"]*commits[^"]*"/);
  });

  it('historicalCoupling is empty when overlay is absent', async () => {
    const graph = new DependencyGraph();
    graph.addEdge('src/b.ts', 'src/a.ts');

    // No overlay
    const registry = new ToolRegistry();
    registerBlastRadiusTool(registry, makeCtx(graph));

    const result = await registry.dispatch('ctx_blast_radius', {
      changed_files: ['src/a.ts'],
      use_git: false,
    });

    // historical_coupling section must be present but empty (count="0")
    expect(result).toContain('historical_coupling');
    expect(result).toContain('count="0"');
    expect(result).not.toContain('src/z.ts');
  });
});

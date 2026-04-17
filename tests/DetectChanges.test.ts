import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerDetectChangesTool } from '../src/tools/detect-changes.js';
import type { ServerContext } from '../src/tools/context.js';
import { GitOverlayStore } from '../src/git/GitOverlayStore.js';
import type { GitCommitEvent } from '../src/git/GitHistoryMiner.js';

function makeCtx(graph: DependencyGraph): ServerContext {
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
  };
}

function makeCtxWithOverlay(graph: DependencyGraph, overlay: GitOverlayStore): ServerContext {
  return { ...makeCtx(graph), overlay };
}

/**
 * Build a GitOverlayStore pre-populated with synthetic commit events without
 * hitting the file system or git subprocess.
 *
 * - 6 commits to src/risky.ts where 3 have bug-fix messages → bugDensity ≈ 0.5
 * - 4 commits where src/risky.ts and src/partner.ts co-appear → sharedCommits = 4
 * - Single author (Alice) for src/risky.ts
 */
function buildPopulatedOverlay(): GitOverlayStore {
  const store = new GitOverlayStore('/fake-repo');

  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 86400;

  const events: GitCommitEvent[] = [
    // Commit 1: risky + partner, bug fix
    {
      sha: 'aaa1',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      timestamp: dayAgo,
      message: 'fix: correct edge case in risky',
      files: [
        { path: 'src/risky.ts', added: 10, deleted: 5 },
        { path: 'src/partner.ts', added: 3, deleted: 1 },
      ],
      isMerge: false,
      isBulk: false,
    },
    // Commit 2: risky + partner, bug fix
    {
      sha: 'aaa2',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      timestamp: dayAgo,
      message: 'fix: another bug in risky',
      files: [
        { path: 'src/risky.ts', added: 8, deleted: 4 },
        { path: 'src/partner.ts', added: 2, deleted: 0 },
      ],
      isMerge: false,
      isBulk: false,
    },
    // Commit 3: risky + partner, feature
    {
      sha: 'aaa3',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      timestamp: dayAgo,
      message: 'feat: add new behaviour to risky',
      files: [
        { path: 'src/risky.ts', added: 20, deleted: 0 },
        { path: 'src/partner.ts', added: 5, deleted: 2 },
      ],
      isMerge: false,
      isBulk: false,
    },
    // Commit 4: risky + partner, refactor
    {
      sha: 'aaa4',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      timestamp: dayAgo,
      message: 'refactor: clean up risky',
      files: [
        { path: 'src/risky.ts', added: 15, deleted: 10 },
        { path: 'src/partner.ts', added: 1, deleted: 0 },
      ],
      isMerge: false,
      isBulk: false,
    },
    // Commit 5: risky only, bug fix
    {
      sha: 'aaa5',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      timestamp: dayAgo,
      message: 'fix: hotfix for risky',
      files: [
        { path: 'src/risky.ts', added: 2, deleted: 2 },
      ],
      isMerge: false,
      isBulk: false,
    },
    // Commit 6: risky only, feature
    {
      sha: 'aaa6',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      timestamp: dayAgo,
      message: 'feat: extend risky API',
      files: [
        { path: 'src/risky.ts', added: 12, deleted: 0 },
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

describe('ctx_detect_changes', () => {
  it('returns XML with detect_changes element', async () => {
    const g = new DependencyGraph();
    g.addEdge('src/api.ts', 'src/auth.ts');
    const registry = new ToolRegistry();
    registerDetectChangesTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_detect_changes', {
      changed_files: ['src/auth.ts'],
      use_git: false,
    });
    expect(result).toContain('<detect_changes');
    expect(result).toContain('</detect_changes>');
  });

  it('scores hub file (>=5 importers) with no test as critical', async () => {
    const g = new DependencyGraph();
    for (let i = 0; i < 6; i++) g.addEdge(`src/consumer${i}.ts`, 'src/core.ts');
    const registry = new ToolRegistry();
    registerDetectChangesTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_detect_changes', {
      changed_files: ['src/core.ts'],
      use_git: false,
    });
    expect(result).toContain('risk="critical"');
  });

  it('scores low-importer file with test as low', async () => {
    const g = new DependencyGraph();
    g.addEdge('tests/util.test.ts', 'src/util.ts');
    const registry = new ToolRegistry();
    registerDetectChangesTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_detect_changes', {
      changed_files: ['src/util.ts'],
      use_git: false,
    });
    expect(result).toContain('risk="low"');
  });

  it('includes file path and importer_count in output', async () => {
    const g = new DependencyGraph();
    g.addEdge('src/a.ts', 'src/b.ts');
    g.addEdge('src/c.ts', 'src/b.ts');
    const registry = new ToolRegistry();
    registerDetectChangesTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_detect_changes', {
      changed_files: ['src/b.ts'],
      use_git: false,
    });
    expect(result).toContain('src/b.ts');
    expect(result).toContain('importer_count="2"');
  });

  it('returns empty result for no changed files', async () => {
    const g = new DependencyGraph();
    const registry = new ToolRegistry();
    registerDetectChangesTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_detect_changes', {
      changed_files: [],
      use_git: false,
    });
    expect(result).toContain('count="0"');
  });
});

describe('risk enrichment', () => {
  it('includes overlay_risk element with churn bucket for changed file', async () => {
    const g = new DependencyGraph();
    const overlay = buildPopulatedOverlay();
    const registry = new ToolRegistry();
    registerDetectChangesTool(registry, makeCtxWithOverlay(g, overlay));

    const result = await registry.dispatch('ctx_detect_changes', {
      changed_files: ['src/risky.ts'],
      use_git: false,
    });

    // overlay_risk element must be present with a churn bucket attribute
    expect(result).toContain('<overlay_risk');
    // churn must be one of 'low', 'medium', 'high'
    expect(result).toMatch(/churn="(low|medium|high)"/);
    // bug_density must be a numeric attribute
    expect(result).toMatch(/bug_density="\d+(\.\d+)?"/);
  });

  it('coupledNodes contains src/partner.ts when sharedCommits >= 3', async () => {
    const g = new DependencyGraph();
    const overlay = buildPopulatedOverlay();
    const registry = new ToolRegistry();
    registerDetectChangesTool(registry, makeCtxWithOverlay(g, overlay));

    const result = await registry.dispatch('ctx_detect_changes', {
      changed_files: ['src/risky.ts'],
      use_git: false,
    });

    // src/partner.ts co-appears in 4 commits — above the noise threshold of 3
    expect(result).toContain('src/partner.ts');
    expect(result).toContain('<coupled_node');
  });

  it('owners element contains Alice', async () => {
    const g = new DependencyGraph();
    const overlay = buildPopulatedOverlay();
    const registry = new ToolRegistry();
    registerDetectChangesTool(registry, makeCtxWithOverlay(g, overlay));

    const result = await registry.dispatch('ctx_detect_changes', {
      changed_files: ['src/risky.ts'],
      use_git: false,
    });

    expect(result).toContain('<owner');
    expect(result).toContain('author="Alice"');
  });

  it('risk is null (overlay_risk risk="null") for every file when ctx.overlay is undefined', async () => {
    const g = new DependencyGraph();
    const registry = new ToolRegistry();
    registerDetectChangesTool(registry, makeCtx(g));

    const result = await registry.dispatch('ctx_detect_changes', {
      changed_files: ['src/risky.ts'],
      use_git: false,
    });

    // No overlay → overlay_risk element with risk="null" sentinel
    expect(result).toContain('risk="null"');
    // Must NOT contain actual overlay data
    expect(result).not.toContain('<coupled_node');
    expect(result).not.toContain('<owner');
  });

  it('includes overlayNote comment when overlay is absent', async () => {
    const g = new DependencyGraph();
    const registry = new ToolRegistry();
    registerDetectChangesTool(registry, makeCtx(g));

    const result = await registry.dispatch('ctx_detect_changes', {
      changed_files: ['src/risky.ts'],
      use_git: false,
    });

    // overlayNote is emitted as an XML comment when overlay is absent
    expect(result).toContain('overlayNote');
  });
});

import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerGitDiffReviewTool } from '../src/tools/git-diff-review.js';
import type { ServerContext } from '../src/tools/context.js';

function makeGraph(): DependencyGraph {
  const g = new DependencyGraph();
  // api depends on auth
  g.addEdge('src/api/handler.ts', 'src/auth/user.ts');
  g.addEdge('src/api/router.ts', 'src/api/handler.ts');
  g.addEdge('src/server.ts', 'src/api/router.ts');
  return g;
}

function makeCtx(graph: DependencyGraph): ServerContext {
  return {
    projectRoot: '/fake',
    dbPath: '/fake/.ctxloom/vectors.lancedb',
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.resolve(graph),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: async () => {
      const { Skeletonizer } = await import('../src/ast/Skeletonizer.js');
      const sk = new Skeletonizer();
      await sk.init();
      return sk;
    },
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => true,
    isParserInitialized: () => false,
  };
}

// ─── ctx_git_diff_review ───────────────────────────────────────────────────

describe('ctx_git_diff_review', () => {
  it('returns XML with git_diff_review element', async () => {
    const registry = new ToolRegistry();
    registerGitDiffReviewTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_git_diff_review', {
      changed_files: ['src/auth/user.ts'],
      use_git: false,
    });
    expect(result).toContain('<git_diff_review');
    expect(result).toContain('</git_diff_review>');
  });

  it('includes changed_files section', async () => {
    const registry = new ToolRegistry();
    registerGitDiffReviewTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_git_diff_review', {
      changed_files: ['src/auth/user.ts'],
      use_git: false,
    });
    expect(result).toContain('<changed_files');
    expect(result).toContain('src/auth/user.ts');
  });

  it('includes direct_importers section with files that import changed files', async () => {
    const registry = new ToolRegistry();
    registerGitDiffReviewTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_git_diff_review', {
      changed_files: ['src/auth/user.ts'],
      use_git: false,
    });
    expect(result).toContain('<direct_importers');
    // src/api/handler.ts imports src/auth/user.ts → direct importer
    expect(result).toContain('src/api/handler.ts');
  });

  it('includes transitive_importers section', async () => {
    const registry = new ToolRegistry();
    registerGitDiffReviewTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_git_diff_review', {
      changed_files: ['src/auth/user.ts'],
      use_git: false,
    });
    expect(result).toContain('<transitive_importers');
    // src/api/router.ts → src/api/handler.ts → src/auth/user.ts (transitive)
    expect(result).toContain('src/api/router.ts');
  });

  it('includes call_sites section', async () => {
    const registry = new ToolRegistry();
    registerGitDiffReviewTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_git_diff_review', {
      changed_files: ['src/auth/user.ts'],
      use_git: false,
    });
    expect(result).toContain('<call_sites');
  });

  it('handles empty changed_files list (use_git=false)', async () => {
    const registry = new ToolRegistry();
    registerGitDiffReviewTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_git_diff_review', {
      changed_files: [],
      use_git: false,
    });
    expect(result).toContain('<git_diff_review');
    // Should indicate no changed files
    expect(result).toContain('changed_files="0"');
  });

  it('respects depth parameter for transitive traversal', async () => {
    const registry = new ToolRegistry();
    registerGitDiffReviewTool(registry, makeCtx(makeGraph()));
    // depth=1 → only direct importers, no transitive
    const result = await registry.dispatch('ctx_git_diff_review', {
      changed_files: ['src/auth/user.ts'],
      use_git: false,
      depth: 1,
    });
    expect(result).toContain('<transitive_importers');
    // With depth=1, transitive should be empty — server.ts is 3 hops away
    expect(result).not.toContain('src/server.ts');
  });

  it('includes diff section per changed file (empty when use_git=false)', async () => {
    const registry = new ToolRegistry();
    registerGitDiffReviewTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_git_diff_review', {
      changed_files: ['src/auth/user.ts'],
      use_git: false,
    });
    // Each changed file should have a <file> element with a diff child
    expect(result).toContain('<diff');
  });

  it('include_skeletons=false suppresses skeleton output', async () => {
    const registry = new ToolRegistry();
    registerGitDiffReviewTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_git_diff_review', {
      changed_files: ['src/auth/user.ts'],
      use_git: false,
      include_skeletons: false,
    });
    expect(result).not.toContain('<skeleton');
  });
});

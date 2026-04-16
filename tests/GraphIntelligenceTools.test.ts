import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerCommunityListTool } from '../src/tools/community-list.js';
import { registerArchitectureOverviewTool } from '../src/tools/architecture-overview.js';
import { registerKnowledgeGapsTool } from '../src/tools/knowledge-gaps.js';
import { registerSurprisingConnectionsTool } from '../src/tools/surprising-connections.js';
import type { ServerContext } from '../src/tools/context.js';

function makeGraph(): DependencyGraph {
  const g = new DependencyGraph();
  // Auth cluster
  g.addEdge('src/auth/user.ts', 'src/auth/session.ts');
  g.addEdge('src/auth/user.ts', 'src/auth/token.ts');
  g.addEdge('src/auth/session.ts', 'src/auth/token.ts');
  // API cluster
  g.addEdge('src/api/handler.ts', 'src/api/router.ts');
  g.addEdge('src/api/router.ts', 'src/api/middleware.ts');
  g.addEdge('src/api/handler.ts', 'src/api/middleware.ts');
  // Cross-cluster
  g.addEdge('src/api/handler.ts', 'src/auth/user.ts');
  return g;
}

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

// ─── ctx_community_list ────────────────────────────────────────────────────

describe('ctx_community_list', () => {
  it('returns XML with communities element', async () => {
    const registry = new ToolRegistry();
    registerCommunityListTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_community_list', {});
    expect(result).toContain('<communities');
    expect(result).toContain('</communities>');
  });

  it('includes total and edge_count attributes', async () => {
    const registry = new ToolRegistry();
    registerCommunityListTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_community_list', {});
    expect(result).toMatch(/total="\d+"/);
    expect(result).toMatch(/edge_count="\d+"/);
  });

  it('handles empty graph gracefully', async () => {
    const registry = new ToolRegistry();
    registerCommunityListTool(registry, makeCtx(new DependencyGraph()));
    const result = await registry.dispatch('ctx_community_list', {});
    expect(result).toContain('total="0"');
  });
});

// ─── ctx_architecture_overview ─────────────────────────────────────────────

describe('ctx_architecture_overview', () => {
  it('returns XML with architecture element', async () => {
    const registry = new ToolRegistry();
    registerArchitectureOverviewTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_architecture_overview', {});
    expect(result).toContain('<architecture');
    expect(result).toContain('</architecture>');
  });

  it('includes community elements with name and size', async () => {
    const registry = new ToolRegistry();
    registerArchitectureOverviewTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_architecture_overview', {});
    expect(result).toMatch(/name="[^"]+"/);
    expect(result).toMatch(/size="\d+"/);
  });

  it('handles empty graph gracefully', async () => {
    const registry = new ToolRegistry();
    registerArchitectureOverviewTool(registry, makeCtx(new DependencyGraph()));
    const result = await registry.dispatch('ctx_architecture_overview', {});
    expect(result).toContain('total_communities="0"');
  });
});

// ─── ctx_knowledge_gaps ────────────────────────────────────────────────────

describe('ctx_knowledge_gaps', () => {
  it('returns XML with knowledge_gaps element', async () => {
    const registry = new ToolRegistry();
    registerKnowledgeGapsTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_knowledge_gaps', {});
    expect(result).toContain('<knowledge_gaps');
    expect(result).toContain('</knowledge_gaps>');
  });

  it('detects isolated files (zero edges)', async () => {
    const registry = new ToolRegistry();
    registerKnowledgeGapsTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_knowledge_gaps', {});
    expect(result).toContain('isolated_files');
    expect(result).toContain('dead_code_candidates');
    expect(result).toContain('untested_hubs');
  });

  it('identifies dead code candidates (not imported by anyone)', async () => {
    const g = new DependencyGraph();
    // util.ts is imported by no one — dead code candidate
    g.addEdge('main.ts', 'service.ts');
    g.addEdge('service.ts', 'helper.ts');
    // util.ts: add to graph as importer of something but not imported
    g.addEdge('util.ts', 'helper.ts');

    const registry = new ToolRegistry();
    registerKnowledgeGapsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_knowledge_gaps', { min_importers: 2 });
    // util.ts has 0 importers and is not an entry-point → dead code candidate
    expect(result).toContain('util.ts');
  });

  it('identifies untested hub files', async () => {
    const g = new DependencyGraph();
    // service.ts is imported by 4 files — it's a hub
    g.addEdge('a.ts', 'service.ts');
    g.addEdge('b.ts', 'service.ts');
    g.addEdge('c.ts', 'service.ts');
    g.addEdge('d.ts', 'service.ts');
    // No service.test.ts in the graph

    const registry = new ToolRegistry();
    registerKnowledgeGapsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_knowledge_gaps', { min_importers: 3 });
    expect(result).toContain('service.ts');
  });

  it('handles empty graph gracefully', async () => {
    const registry = new ToolRegistry();
    registerKnowledgeGapsTool(registry, makeCtx(new DependencyGraph()));
    const result = await registry.dispatch('ctx_knowledge_gaps', {});
    expect(result).toContain('<knowledge_gaps');
  });
});

// ─── ctx_surprising_connections ────────────────────────────────────────────

describe('ctx_surprising_connections', () => {
  it('returns XML with surprising_connections element', async () => {
    const registry = new ToolRegistry();
    registerSurprisingConnectionsTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_surprising_connections', {});
    expect(result).toContain('<surprising_connections');
    expect(result).toContain('</surprising_connections>');
  });

  it('detects circular dependencies', async () => {
    const g = new DependencyGraph();
    g.addEdge('a.ts', 'b.ts');
    g.addEdge('b.ts', 'c.ts');
    g.addEdge('c.ts', 'a.ts'); // cycle: a → b → c → a

    const registry = new ToolRegistry();
    registerSurprisingConnectionsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_surprising_connections', {});
    expect(result).toContain('<circular_dependencies');
    // cycle members should appear
    expect(result).toContain('a.ts');
    expect(result).toContain('b.ts');
    expect(result).toContain('c.ts');
  });

  it('detects production files importing test files', async () => {
    const g = new DependencyGraph();
    // Surprising: production file imports a test file
    g.addEdge('src/auth.ts', 'tests/helpers.test.ts');

    const registry = new ToolRegistry();
    registerSurprisingConnectionsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_surprising_connections', {});
    expect(result).toContain('prod_imports_test');
    expect(result).toContain('src/auth.ts');
  });

  it('detects cross-community imports', async () => {
    const registry = new ToolRegistry();
    registerSurprisingConnectionsTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_surprising_connections', {});
    expect(result).toContain('cross_community_imports');
  });

  it('handles empty graph gracefully', async () => {
    const registry = new ToolRegistry();
    registerSurprisingConnectionsTool(registry, makeCtx(new DependencyGraph()));
    const result = await registry.dispatch('ctx_surprising_connections', {});
    expect(result).toContain('<surprising_connections');
  });
});

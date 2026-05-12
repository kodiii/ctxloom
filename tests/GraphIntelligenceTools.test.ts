import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerCommunityListTool } from '../src/tools/community-list.js';
import { registerArchitectureOverviewTool } from '../src/tools/architecture-overview.js';
import { registerKnowledgeGapsTool } from '../src/tools/knowledge-gaps.js';
import { registerSurprisingConnectionsTool } from '../src/tools/surprising-connections.js';
import { registerWikiGenerateTool } from '../src/tools/wiki-generate.js';
import { registerGraphExportTool } from '../src/tools/graph-export.js';
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

function makeCtx(graph: DependencyGraph, projectRoot = '/fake'): ServerContext {
  return {
    projectRoot,
    dbPath: `${projectRoot}/.ctxloom/vectors.lancedb`,
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

  // ─── Paging (issue #56) ──────────────────────────────────────────────────

  function makeLargeGraph(communityCount: number): DependencyGraph {
    // Build N disjoint two-file communities so Louvain detects them as
    // separate clusters.
    const g = new DependencyGraph();
    for (let i = 0; i < communityCount; i++) {
      g.addEdge(`src/mod${i}/a.ts`, `src/mod${i}/b.ts`);
    }
    return g;
  }

  it('respects the default limit of 50', async () => {
    const registry = new ToolRegistry();
    registerCommunityListTool(registry, makeCtx(makeLargeGraph(120)));
    const result = await registry.dispatch('ctx_community_list', {});
    expect(result).toMatch(/showing="50"/);
    expect(result).toMatch(/has_more="true"/);
    const communityCount = (result.match(/<community /g) ?? []).length;
    expect(communityCount).toBe(50);
  });

  it('honours offset for paging through results', async () => {
    const ctx = makeCtx(makeLargeGraph(120));
    const r1 = new ToolRegistry();
    registerCommunityListTool(r1, ctx);
    const r2 = new ToolRegistry();
    registerCommunityListTool(r2, ctx);

    const page1 = await r1.dispatch('ctx_community_list', { limit: 20, offset: 0 });
    const page2 = await r2.dispatch('ctx_community_list', { limit: 20, offset: 20 });
    expect(page1).toMatch(/offset="0"/);
    expect(page2).toMatch(/offset="20"/);
    // The two pages must not overlap on community ids.
    const ids1 = [...page1.matchAll(/id="(\d+)"/g)].map((m) => m[1]);
    const ids2 = [...page2.matchAll(/id="(\d+)"/g)].map((m) => m[1]);
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
  });

  it('filters communities below min_size', async () => {
    // Two-file communities are the only kind in makeLargeGraph; min_size=3
    // should produce an empty filtered set.
    const registry = new ToolRegistry();
    registerCommunityListTool(registry, makeCtx(makeLargeGraph(10)));
    const result = await registry.dispatch('ctx_community_list', { min_size: 3 });
    expect(result).toMatch(/filtered_total="0"/);
    expect(result).toMatch(/showing="0"/);
  });

  it('detail_level=minimal returns counts only and no community elements', async () => {
    const registry = new ToolRegistry();
    registerCommunityListTool(registry, makeCtx(makeLargeGraph(20)));
    const result = await registry.dispatch('ctx_community_list', { detail_level: 'minimal' });
    expect(result).toContain('detail_level="minimal"');
    expect(result).not.toContain('<community ');
    expect(result).toMatch(/total="\d+"/);
    expect(result).toMatch(/filtered_total="\d+"/);
  });

  it('rejects limit above the documented maximum', async () => {
    const registry = new ToolRegistry();
    registerCommunityListTool(registry, makeCtx(makeLargeGraph(5)));
    await expect(
      registry.dispatch('ctx_community_list', { limit: 999 }),
    ).rejects.toThrow();
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

// ─── ctx_wiki_generate ─────────────────────────────────────────────────────

describe('ctx_wiki_generate', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-wiki-tool-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns XML with wiki_generate element', async () => {
    const registry = new ToolRegistry();
    registerWikiGenerateTool(registry, makeCtx(makeGraph(), tmpDir));
    const result = await registry.dispatch('ctx_wiki_generate', {});
    expect(result).toContain('<wiki_generate');
    expect(result).toContain('</wiki_generate>');
  });

  it('includes written and skipped counts', async () => {
    const registry = new ToolRegistry();
    registerWikiGenerateTool(registry, makeCtx(makeGraph(), tmpDir));
    const result = await registry.dispatch('ctx_wiki_generate', {});
    expect(result).toMatch(/written="\d+"/);
    expect(result).toMatch(/skipped="\d+"/);
  });

  it('second call skips all pages (cache hit)', async () => {
    const ctx = makeCtx(makeGraph(), tmpDir);
    const r1 = new ToolRegistry();
    registerWikiGenerateTool(r1, ctx);
    await r1.dispatch('ctx_wiki_generate', {});

    const r2 = new ToolRegistry();
    registerWikiGenerateTool(r2, ctx);
    const second = await r2.dispatch('ctx_wiki_generate', {});
    expect(second).toContain('written="0"');
  });

  it('force=true rewrites all pages', async () => {
    const ctx = makeCtx(makeGraph(), tmpDir);
    const r1 = new ToolRegistry();
    registerWikiGenerateTool(r1, ctx);
    const first = await r1.dispatch('ctx_wiki_generate', {});
    const firstWritten = Number((first.match(/written="(\d+)"/) ?? [])[1] ?? 0);

    const r2 = new ToolRegistry();
    registerWikiGenerateTool(r2, ctx);
    const second = await r2.dispatch('ctx_wiki_generate', { force: true });
    expect(second).toContain(`written="${firstWritten}"`);
    expect(second).toContain('skipped="0"');
  });

  it('handles empty graph', async () => {
    const registry = new ToolRegistry();
    registerWikiGenerateTool(registry, makeCtx(new DependencyGraph(), tmpDir));
    const result = await registry.dispatch('ctx_wiki_generate', {});
    expect(result).toContain('written="0"');
  });

  // ─── Token-budget regression (issue #56) ─────────────────────────────────

  it('does not emit per-skipped <page> entries (issue #56)', async () => {
    const ctx = makeCtx(makeGraph(), tmpDir);
    // First run writes pages.
    const r1 = new ToolRegistry();
    registerWikiGenerateTool(r1, ctx);
    await r1.dispatch('ctx_wiki_generate', {});

    // Second run skips everything via the hash cache. The response must
    // not list any per-page entries for skipped pages — that's the
    // O(communities × page-line) blowup the issue is about.
    const r2 = new ToolRegistry();
    registerWikiGenerateTool(r2, ctx);
    const second = await r2.dispatch('ctx_wiki_generate', {});
    expect(second).toContain('skipped="');
    expect(second).not.toMatch(/status="skipped"/);
  });

  it('written pages include size attribute', async () => {
    const registry = new ToolRegistry();
    registerWikiGenerateTool(registry, makeCtx(makeGraph(), tmpDir));
    const result = await registry.dispatch('ctx_wiki_generate', {});
    expect(result).toMatch(/size="\d+"/);
  });

  it('detail_level=minimal returns counts only and no page elements', async () => {
    const registry = new ToolRegistry();
    registerWikiGenerateTool(registry, makeCtx(makeGraph(), tmpDir));
    const result = await registry.dispatch('ctx_wiki_generate', { detail_level: 'minimal' });
    expect(result).toContain('detail_level="minimal"');
    expect(result).not.toContain('<page ');
    expect(result).toMatch(/written="\d+"/);
    expect(result).toMatch(/skipped="\d+"/);
  });
});

// ─── ctx_graph_export ──────────────────────────────────────────────────────

describe('ctx_graph_export', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-export-tool-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('graphml: returns XML with graph_export element', async () => {
    const registry = new ToolRegistry();
    registerGraphExportTool(registry, makeCtx(makeGraph(), tmpDir));
    const result = await registry.dispatch('ctx_graph_export', { format: 'graphml' });
    expect(result).toContain('<graph_export');
    expect(result).toContain('format="graphml"');
    expect(result).toMatch(/nodes="\d+"/);
    expect(result).toMatch(/edges="\d+"/);
  });

  it('graphml: writes graph.graphml to .ctxloom/export/', async () => {
    const registry = new ToolRegistry();
    registerGraphExportTool(registry, makeCtx(makeGraph(), tmpDir));
    await registry.dispatch('ctx_graph_export', { format: 'graphml' });
    expect(fs.existsSync(path.join(tmpDir, '.ctxloom', 'export', 'graph.graphml'))).toBe(true);
  });

  it('dot: writes graph.dot to .ctxloom/export/', async () => {
    const registry = new ToolRegistry();
    registerGraphExportTool(registry, makeCtx(makeGraph(), tmpDir));
    await registry.dispatch('ctx_graph_export', { format: 'dot' });
    expect(fs.existsSync(path.join(tmpDir, '.ctxloom', 'export', 'graph.dot'))).toBe(true);
  });

  it('obsidian: writes one .md per node to .ctxloom/export/obsidian/', async () => {
    const registry = new ToolRegistry();
    const graph = makeGraph();
    registerGraphExportTool(registry, makeCtx(graph, tmpDir));
    await registry.dispatch('ctx_graph_export', { format: 'obsidian' });
    const obsidianDir = path.join(tmpDir, '.ctxloom', 'export', 'obsidian');
    const files = fs.readdirSync(obsidianDir).filter(f => f.endsWith('.md'));
    expect(files.length).toBe(graph.allFiles().length);
  });

  it('handles empty graph', async () => {
    const registry = new ToolRegistry();
    registerGraphExportTool(registry, makeCtx(new DependencyGraph(), tmpDir));
    const result = await registry.dispatch('ctx_graph_export', { format: 'graphml' });
    expect(result).toContain('nodes="0"');
    expect(result).toContain('edges="0"');
  });
});

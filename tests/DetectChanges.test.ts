import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerDetectChangesTool } from '../src/tools/detect-changes.js';
import type { ServerContext } from '../src/tools/context.js';

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

import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerSuggestedQuestionsTool } from '../src/tools/suggested-questions.js';
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

describe('ctx_suggested_questions', () => {
  it('returns XML with suggested_questions element', async () => {
    const g = new DependencyGraph();
    g.addEdge('src/a.ts', 'src/b.ts');
    const registry = new ToolRegistry();
    registerSuggestedQuestionsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_suggested_questions', {
      changed_files: ['src/b.ts'],
      use_git: false,
    });
    expect(result).toContain('<suggested_questions');
    expect(result).toContain('</suggested_questions>');
  });

  it('asks about dependents when blast radius is non-trivial', async () => {
    const g = new DependencyGraph();
    for (let i = 0; i < 4; i++) g.addEdge(`src/consumer${i}.ts`, 'src/core.ts');
    const registry = new ToolRegistry();
    registerSuggestedQuestionsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_suggested_questions', {
      changed_files: ['src/core.ts'],
      use_git: false,
    });
    expect(result).toMatch(/importer|dependent|depend/i);
  });

  it('asks about test coverage when no tests exist', async () => {
    const g = new DependencyGraph();
    g.addEdge('src/a.ts', 'src/util.ts');
    const registry = new ToolRegistry();
    registerSuggestedQuestionsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_suggested_questions', {
      changed_files: ['src/util.ts'],
      use_git: false,
    });
    expect(result).toMatch(/test|coverage/i);
  });

  it('flags hub files as high-risk', async () => {
    const g = new DependencyGraph();
    for (let i = 0; i < 6; i++) g.addEdge(`src/consumer${i}.ts`, 'src/hub.ts');
    const registry = new ToolRegistry();
    registerSuggestedQuestionsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_suggested_questions', {
      changed_files: ['src/hub.ts'],
      use_git: false,
    });
    expect(result).toMatch(/hub|high.risk|6 files/i);
  });

  it('returns at least one question for any changed file', async () => {
    const g = new DependencyGraph();
    g.addEdge('src/a.ts', 'src/b.ts');
    const registry = new ToolRegistry();
    registerSuggestedQuestionsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_suggested_questions', {
      changed_files: ['src/a.ts'],
      use_git: false,
    });
    expect(result).toContain('<question');
  });
});

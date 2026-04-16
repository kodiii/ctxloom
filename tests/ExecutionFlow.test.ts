import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { CallGraphIndex } from '../src/graph/CallGraphIndex.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerExecutionFlowTool } from '../src/tools/execution-flow.js';
import type { ServerContext } from '../src/tools/context.js';

/**
 * Build a graph with hand-crafted call edges:
 *
 *   src/api/handler.ts
 *     handleRequest → validateInput (in same file)
 *     handleRequest → processPayment (in src/payment/processor.ts)
 *
 *   src/payment/processor.ts
 *     processPayment → chargeCard (in src/payment/processor.ts)
 *     processPayment → logTransaction (in src/logger.ts)
 *
 *   src/logger.ts
 *     logTransaction → formatLog (in src/logger.ts)
 */
function makeGraph(): DependencyGraph {
  const g = new DependencyGraph();
  g.addEdge('src/api/handler.ts', 'src/payment/processor.ts');
  g.addEdge('src/payment/processor.ts', 'src/logger.ts');

  const callIdx = g.getCallGraphIndex();
  callIdx.addEdge({ callerFile: 'src/api/handler.ts', callerSymbol: 'handleRequest', calleeSymbol: 'validateInput', line: 5 });
  callIdx.addEdge({ callerFile: 'src/api/handler.ts', callerSymbol: 'handleRequest', calleeSymbol: 'processPayment', line: 10 });
  callIdx.addEdge({ callerFile: 'src/payment/processor.ts', callerSymbol: 'processPayment', calleeSymbol: 'chargeCard', line: 8 });
  callIdx.addEdge({ callerFile: 'src/payment/processor.ts', callerSymbol: 'processPayment', calleeSymbol: 'logTransaction', line: 12 });
  callIdx.addEdge({ callerFile: 'src/logger.ts', callerSymbol: 'logTransaction', calleeSymbol: 'formatLog', line: 3 });
  return g;
}

/** Graph with a cycle: a → b → c → a */
function makeCyclicGraph(): DependencyGraph {
  const g = new DependencyGraph();
  const callIdx = g.getCallGraphIndex();
  callIdx.addEdge({ callerFile: 'src/a.ts', callerSymbol: 'funcA', calleeSymbol: 'funcB', line: 1 });
  callIdx.addEdge({ callerFile: 'src/b.ts', callerSymbol: 'funcB', calleeSymbol: 'funcC', line: 1 });
  callIdx.addEdge({ callerFile: 'src/c.ts', callerSymbol: 'funcC', calleeSymbol: 'funcA', line: 1 });
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

// ─── ctx_execution_flow ───────────────────────────────────────────────────

describe('ctx_execution_flow', () => {
  it('returns XML with execution_flow element', async () => {
    const registry = new ToolRegistry();
    registerExecutionFlowTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_execution_flow', {
      entry_point: 'handleRequest',
    });
    expect(result).toContain('<execution_flow');
    expect(result).toContain('</execution_flow>');
  });

  it('includes the entry point symbol in the output', async () => {
    const registry = new ToolRegistry();
    registerExecutionFlowTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_execution_flow', {
      entry_point: 'handleRequest',
    });
    expect(result).toContain('entry="handleRequest"');
  });

  it('traverses direct callees of the entry point', async () => {
    const registry = new ToolRegistry();
    registerExecutionFlowTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_execution_flow', {
      entry_point: 'handleRequest',
    });
    // handleRequest calls validateInput and processPayment
    expect(result).toContain('validateInput');
    expect(result).toContain('processPayment');
  });

  it('traverses transitive callees (depth > 1)', async () => {
    const registry = new ToolRegistry();
    registerExecutionFlowTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_execution_flow', {
      entry_point: 'handleRequest',
      depth: 5,
    });
    // processPayment → chargeCard, logTransaction → formatLog
    expect(result).toContain('chargeCard');
    expect(result).toContain('logTransaction');
    expect(result).toContain('formatLog');
  });

  it('respects depth parameter — stops at depth limit', async () => {
    const registry = new ToolRegistry();
    registerExecutionFlowTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_execution_flow', {
      entry_point: 'handleRequest',
      depth: 1,
    });
    // depth=1: direct callees only
    expect(result).toContain('validateInput');
    expect(result).toContain('processPayment');
    // depth=1: should NOT include transitive callees of processPayment
    expect(result).not.toContain('chargeCard');
    expect(result).not.toContain('formatLog');
  });

  it('detects cycles and marks them in output', async () => {
    const registry = new ToolRegistry();
    registerExecutionFlowTool(registry, makeCtx(makeCyclicGraph()));
    const result = await registry.dispatch('ctx_execution_flow', {
      entry_point: 'funcA',
      depth: 10,
    });
    expect(result).toContain('has_cycles="true"');
    expect(result).toContain('cycle');
  });

  it('reports total_steps attribute', async () => {
    const registry = new ToolRegistry();
    registerExecutionFlowTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_execution_flow', {
      entry_point: 'handleRequest',
    });
    expect(result).toMatch(/total_steps="\d+"/);
  });

  it('handles unknown entry point gracefully', async () => {
    const registry = new ToolRegistry();
    registerExecutionFlowTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_execution_flow', {
      entry_point: 'doesNotExist',
    });
    expect(result).toContain('<execution_flow');
    expect(result).toContain('total_steps="0"');
  });

  it('includes file attribute on steps when entry file is provided', async () => {
    const registry = new ToolRegistry();
    registerExecutionFlowTool(registry, makeCtx(makeGraph()));
    const result = await registry.dispatch('ctx_execution_flow', {
      entry_point: 'handleRequest',
      entry_file: 'src/api/handler.ts',
    });
    expect(result).toContain('src/api/handler.ts');
  });
});

// ─── CallGraphIndex.getCallees ────────────────────────────────────────────

describe('CallGraphIndex.getCallees', () => {
  it('returns callees for a known caller', () => {
    const g = makeGraph();
    const callIdx = g.getCallGraphIndex();
    const callees = callIdx.getCallees('src/api/handler.ts', 'handleRequest');
    expect(callees).toContain('validateInput');
    expect(callees).toContain('processPayment');
  });

  it('returns empty array for unknown caller', () => {
    const g = makeGraph();
    const callIdx = g.getCallGraphIndex();
    expect(callIdx.getCallees('src/unknown.ts', 'unknownFn')).toEqual([]);
  });

  it('stays in sync after removeEdgesForFile', () => {
    const g = makeGraph();
    const callIdx = g.getCallGraphIndex();
    callIdx.removeEdgesForFile('src/api/handler.ts');
    expect(callIdx.getCallees('src/api/handler.ts', 'handleRequest')).toEqual([]);
  });

  it('reconstructs forward index via fromJSON round-trip', () => {
    const g = makeGraph();
    const original = g.getCallGraphIndex();
    const restored = CallGraphIndex.fromJSON(original.toJSON());
    const callees = restored.getCallees('src/api/handler.ts', 'handleRequest');
    expect(callees).toContain('validateInput');
    expect(callees).toContain('processPayment');
  });
});

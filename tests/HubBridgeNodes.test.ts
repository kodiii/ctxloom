import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerHubNodesTool } from '../src/tools/hub-nodes.js';
import { registerBridgeNodesTool } from '../src/tools/bridge-nodes.js';
import type { ServerContext } from '../src/tools/context.js';

/**
 * Graph: auth.ts ← user.ts ← api.ts ← server.ts
 *                           ↑
 *                        utils.ts
 *
 * user.ts: in=1 (api), out=1 (auth)  → total=2
 * api.ts:  in=1 (server), out=2 (user, utils) → total=3
 * auth.ts: in=1 (user), out=0 → total=1
 */
function makeGraph(): DependencyGraph {
  const g = new DependencyGraph();
  g.addEdge('user.ts', 'auth.ts');
  g.addEdge('api.ts', 'user.ts');
  g.addEdge('api.ts', 'utils.ts');
  g.addEdge('server.ts', 'api.ts');
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

describe('ctx_hub_nodes', () => {
  it('returns files sorted by total degree', async () => {
    const graph = makeGraph();
    const registry = new ToolRegistry();
    registerHubNodesTool(registry, makeCtx(graph));

    const result = await registry.dispatch('ctx_hub_nodes', { limit: 10, min_degree: 1 });
    // api.ts has total_degree=3, should appear first
    const apiIndex = result.indexOf('api.ts');
    const userIndex = result.indexOf('user.ts');
    expect(apiIndex).toBeGreaterThanOrEqual(0);
    expect(apiIndex).toBeLessThan(userIndex);
  });

  it('filters by min_degree', async () => {
    const graph = makeGraph();
    const registry = new ToolRegistry();
    registerHubNodesTool(registry, makeCtx(graph));

    const result = await registry.dispatch('ctx_hub_nodes', { limit: 10, min_degree: 3 });
    expect(result).toContain('api.ts');
    // auth.ts has total_degree=1 → excluded
    expect(result).not.toContain('auth.ts');
  });

  it('respects limit', async () => {
    const graph = makeGraph();
    const registry = new ToolRegistry();
    registerHubNodesTool(registry, makeCtx(graph));

    const result = await registry.dispatch('ctx_hub_nodes', { limit: 1, min_degree: 1 });
    // Only one <file> element
    const matches = result.match(/<file /g);
    expect(matches).toHaveLength(1);
  });
});

describe('ctx_bridge_nodes', () => {
  it('returns an XML result with bridge_nodes element', async () => {
    const graph = makeGraph();
    const registry = new ToolRegistry();
    registerBridgeNodesTool(registry, makeCtx(graph));

    const result = await registry.dispatch('ctx_bridge_nodes', { limit: 10, sample: 100 });
    expect(result).toContain('<bridge_nodes');
    expect(result).toContain('</bridge_nodes>');
  });

  it('api.ts has higher betweenness than leaf files', async () => {
    const graph = makeGraph();
    const registry = new ToolRegistry();
    registerBridgeNodesTool(registry, makeCtx(graph));

    const result = await registry.dispatch('ctx_bridge_nodes', { limit: 10, sample: 100 });
    // api.ts is on the path from server.ts to auth.ts/utils.ts — should appear before utils.ts
    const apiIndex = result.indexOf('api.ts');
    const utilsIndex = result.indexOf('utils.ts');
    // api.ts should appear (betweenness > 0)
    expect(apiIndex).toBeGreaterThanOrEqual(0);
    // utils.ts is a leaf — either absent or ranked lower than api.ts
    if (utilsIndex >= 0) {
      expect(apiIndex).toBeLessThan(utilsIndex);
    }
  });

  it('handles empty graph gracefully', async () => {
    const registry = new ToolRegistry();
    registerBridgeNodesTool(registry, makeCtx(new DependencyGraph()));

    const result = await registry.dispatch('ctx_bridge_nodes', {});
    expect(result).toContain('total_files="0"');
  });
});

import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerRulesCheckTool } from '../src/tools/rules-check.js';
import type { ServerContext } from '../src/tools/context.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/**
 * Build a minimal ServerContext stub for the rules-check tool.
 * Only `projectRoot` and `getGraph` are used by the tool — the remaining
 * fields are stubbed to throw so any unexpected call fails loudly.
 */
function makeCtx(fixtureName: string, graph: DependencyGraph): ServerContext {
  const projectRoot = path.join(repoRoot, 'test', 'fixtures', 'rules', fixtureName);
  return {
    projectRoot,
    dbPath: path.join(projectRoot, '.ctxloom', 'vectors.lancedb'),
    getStore: () => { throw new Error('getStore not needed by ctx_rules_check'); },
    getGraph: async () => graph,
    getParser: () => { throw new Error('getParser not needed by ctx_rules_check'); },
    getSkeletonizer: () => { throw new Error('getSkeletonizer not needed by ctx_rules_check'); },
    getRuleManager: () => { throw new Error('getRuleManager not needed by ctx_rules_check'); },
    getPathValidator: () => { throw new Error('getPathValidator not needed by ctx_rules_check'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => true,
    isParserInitialized: () => false,
  } as ServerContext;
}

describe('ctx_rules_check — MCP integration', () => {
  it('returns 0 violations for a clean graph', async () => {
    const graph = new DependencyGraph();
    graph.addEdge('src/domain/user.ts', 'src/domain/order.ts');

    const registry = new ToolRegistry();
    registerRulesCheckTool(registry, makeCtx('clean-repo', graph));

    const raw = await registry.dispatch('ctx_rules_check', {});
    const result = JSON.parse(raw);

    expect(result.schemaVersion).toBe(1);
    expect(result.violations).toHaveLength(0);
  });

  it('detects violations from the live graph', async () => {
    const graph = new DependencyGraph();
    graph.addEdge('src/domain/user.ts', 'src/infra/db.ts');
    graph.addEdge('src/domain/order.ts', 'src/infra/cache.ts');

    const registry = new ToolRegistry();
    registerRulesCheckTool(registry, makeCtx('violating-repo', graph));

    const raw = await registry.dispatch('ctx_rules_check', {});
    const result = JSON.parse(raw);

    expect(result.violations).toHaveLength(2);
    expect(result.violations[0].rule).toBe('domain must not import infra');
  });

  it('returns warning (not error) when no config file exists', async () => {
    const graph = new DependencyGraph();
    const registry = new ToolRegistry();
    registerRulesCheckTool(registry, makeCtx('no-config', graph));

    const raw = await registry.dispatch('ctx_rules_check', {});
    const result = JSON.parse(raw);

    expect(result.violations).toHaveLength(0);
    expect(result.warnings.some((w: string) => w.includes('rules.yml'))).toBe(true);
  });

  it('reflects a newly-added edge without restart', async () => {
    const graph = new DependencyGraph();
    const registry = new ToolRegistry();
    registerRulesCheckTool(registry, makeCtx('violating-repo', graph));

    const before = JSON.parse(await registry.dispatch('ctx_rules_check', {}));
    expect(before.violations).toHaveLength(0);

    graph.addEdge('src/domain/user.ts', 'src/infra/db.ts');

    const after = JSON.parse(await registry.dispatch('ctx_rules_check', {}));
    expect(after.violations).toHaveLength(1);
  });
});

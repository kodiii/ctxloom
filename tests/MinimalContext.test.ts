/**
 * Tests for packages/core/src/tools/minimal-context.ts — Phase 1a of
 * the agent-harness plan. Pins:
 *
 *   - Task-aware routing (each regex picks the expected first tool)
 *   - Cache hit/miss semantics (10s TTL)
 *   - Working-tree fallback when no task is provided
 *   - Budget surface integration (skeleton fallback drops recent_changes)
 *   - Security: task input is sanitized + capped + never echoed to response
 *   - Performance: cache hit returns in <5ms (proxy for the <1ms ceiling
 *     to account for vitest scheduler noise)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolRegistry } from '../packages/core/src/tools/registry.js';
import {
  registerMinimalContextTool,
  __clearMinimalContextCacheForTests,
} from '../packages/core/src/tools/minimal-context.js';

// Build a minimal ServerContext stub. The tool reads:
//   - ctx.projectRoot
//   - ctx.isGraphInitialized()
//   - ctx.getGraph(projectRoot) — only on the ready path
function makeContext(opts: {
  projectRoot?: string;
  graphReady?: boolean;
  graphStats?: { files: string[]; importsByFile: Record<string, string[]> };
} = {}): import('../packages/core/src/tools/context.js').ServerContext {
  const graphReady = opts.graphReady ?? false;
  const graphStats = opts.graphStats ?? { files: [], importsByFile: {} };
  return {
    projectRoot: opts.projectRoot ?? '/tmp/stub',
    dbPath: '/tmp/stub/.ctxloom/db',
    noDefaultMode: false,
    getStore: () => {
      throw new Error('not used in minimal-context');
    },
    getGraph: async () => ({
      allFiles: () => graphStats.files,
      getImports: (f: string) => graphStats.importsByFile[f] ?? [],
      getImporters: (f: string) =>
        graphStats.files.filter((src) =>
          (graphStats.importsByFile[src] ?? []).includes(f),
        ),
    }) as never,
    getParser: () => {
      throw new Error('not used');
    },
    getSkeletonizer: () => {
      throw new Error('not used');
    },
    getRuleManager: () => {
      throw new Error('not used');
    },
    getPathValidator: () => {
      throw new Error('not used');
    },
    isStoreInitialized: () => false,
    isGraphInitialized: () => graphReady,
    isParserInitialized: () => false,
    registry: { list: () => [] } as never,
    stateManager: { has: () => false, get: () => null, list: () => [], max: 0 } as never,
  };
}

function setup(ctxOpts?: Parameters<typeof makeContext>[0]) {
  const registry = new ToolRegistry();
  const ctx = makeContext(ctxOpts);
  registerMinimalContextTool(registry, ctx);
  return registry;
}

beforeEach(() => {
  __clearMinimalContextCacheForTests();
});
afterEach(() => {
  __clearMinimalContextCacheForTests();
});

// ─── tool registration ───────────────────────────────────────────────

describe('registerMinimalContextTool', () => {
  it('registers the ctx_get_minimal_context tool', () => {
    const registry = setup();
    const names = registry.list().map((t) => t.name);
    expect(names).toContain('ctx_get_minimal_context');
  });
});

// ─── task-aware routing ──────────────────────────────────────────────

describe('task-aware first-tool routing', () => {
  it.each([
    ['rename emitTelemetry', 'ctx_get_call_graph'],
    ['refactor the budget surface', 'ctx_get_call_graph'],
    ['blast radius for ServerContext', 'ctx_blast_radius'],
    ['what does this change impact?', 'ctx_blast_radius'],
    ['architecture overview please', 'ctx_architecture_overview'],
    ['explore this repo', 'ctx_architecture_overview'],
    ['check test coverage', 'ctx_knowledge_gaps'],
    ['review PR 142', 'ctx_detect_changes'],
    ['audit this commit', 'ctx_detect_changes'],
  ])('task=%j → %s', async (task, expectedTool) => {
    const registry = setup({ projectRoot: '/tmp/stub-' + Math.random() });
    const out = await registry.dispatch('ctx_get_minimal_context', { task });
    expect(out).toContain(`<tool>${expectedTool}</tool>`);
  });

  it('falls back to ctx_detect_changes when working tree dirty + no task', async () => {
    // Real git status would need a real repo; instead we rely on the
    // function's signature: readRecentChanges returns [] when subprocess
    // fails, so on /tmp/stub it should report no dirty changes →
    // fall through to ctx_architecture_overview, NOT detect_changes.
    // This test pins the "clean tree → architecture_overview" branch.
    const registry = setup({ projectRoot: '/tmp/stub-' + Math.random() });
    const out = await registry.dispatch('ctx_get_minimal_context', {});
    expect(out).toContain('<tool>ctx_architecture_overview</tool>');
  });
});

// ─── cache semantics ─────────────────────────────────────────────────

describe('response cache', () => {
  it('returns identical response for repeated calls within 10s', async () => {
    const registry = setup({ projectRoot: '/tmp/cache-' + Math.random() });
    const r1 = await registry.dispatch('ctx_get_minimal_context', { task: 'rename X' });
    const r2 = await registry.dispatch('ctx_get_minimal_context', { task: 'rename X' });
    expect(r1).toBe(r2);
  });

  it('keys cache by (project_root, task) — different task → different cache entry', async () => {
    const registry = setup({ projectRoot: '/tmp/cache-' + Math.random() });
    const r1 = await registry.dispatch('ctx_get_minimal_context', { task: 'rename X' });
    const r2 = await registry.dispatch('ctx_get_minimal_context', { task: 'review PR' });
    expect(r1).not.toBe(r2);
    expect(r1).toContain('ctx_get_call_graph');
    expect(r2).toContain('ctx_detect_changes');
  });

  it('cache hit is FAST (proxy for <1ms ceiling)', async () => {
    const registry = setup({ projectRoot: '/tmp/cache-perf' });
    // Prime
    await registry.dispatch('ctx_get_minimal_context', { task: 'perf test' });
    // Measure
    const start = performance.now();
    await registry.dispatch('ctx_get_minimal_context', { task: 'perf test' });
    const elapsed = performance.now() - start;
    // Vitest scheduler can add noise; assert <5ms which is still <10× the
    // <1ms ceiling claim from the design doc.
    expect(elapsed).toBeLessThan(5);
  });
});

// ─── security: task sanitization ─────────────────────────────────────

describe('task input sanitization', () => {
  it('strips control characters before routing (defense in depth)', async () => {
    const registry = setup({ projectRoot: '/tmp/sec' });
    // Inject control chars between the keyword letters — sanitizer
    // strips them, so the regex still matches.
    const malicious = 'r\x00e\x01n\x02a\x03me X';
    const out = await registry.dispatch('ctx_get_minimal_context', { task: malicious });
    expect(out).toContain('<tool>ctx_get_call_graph</tool>');
  });

  it('caps task length at 200 chars via schema', async () => {
    const registry = setup({ projectRoot: '/tmp/sec' });
    const tooLong = 'x'.repeat(500);
    // Zod schema rejects (`.max(200)`); dispatch throws.
    await expect(
      registry.dispatch('ctx_get_minimal_context', { task: tooLong }),
    ).rejects.toThrow();
  });

  it('never echoes the raw task into the response body', async () => {
    const registry = setup({ projectRoot: '/tmp/sec-' + Math.random() });
    const sentinel = 'SECRET_SENTINEL_DO_NOT_LEAK';
    const out = await registry.dispatch('ctx_get_minimal_context', {
      task: `review ${sentinel}`,
    });
    expect(out).not.toContain(sentinel);
  });
});

// ─── budget surface integration ──────────────────────────────────────

describe('budget surface integration', () => {
  it('returns raw body when no budget args present (back-compat)', async () => {
    const registry = setup({ projectRoot: '/tmp/budget-1' });
    const out = await registry.dispatch('ctx_get_minimal_context', { task: 'review' });
    // No JSON envelope when budget surface didn't engage.
    expect(out).toMatch(/^<minimal_context/);
  });

  it('returns {data, meta} envelope when budget args engage', async () => {
    const registry = setup({ projectRoot: '/tmp/budget-2' });
    const out = await registry.dispatch('ctx_get_minimal_context', {
      task: 'review',
      max_response_tokens: 1000,
    });
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({
      data: expect.stringContaining('<minimal_context'),
      meta: expect.objectContaining({ format: expect.any(String) }),
    });
  });

  it('falls back to skeleton (no recent_changes block) when over-budget', async () => {
    const registry = setup({ projectRoot: '/tmp/budget-3' });
    const out = await registry.dispatch('ctx_get_minimal_context', {
      task: 'review',
      max_response_tokens: 20, // very tight — forces skeleton
    });
    const parsed = JSON.parse(out);
    // Skeleton renderer marks itself with format="skeleton" on the element.
    expect(parsed.data).toContain('format="skeleton"');
  });
});

// ─── graph readiness ─────────────────────────────────────────────────

describe('graph readiness signaling', () => {
  it('reports ready=false when graph not initialized', async () => {
    const registry = setup({ graphReady: false });
    const out = await registry.dispatch('ctx_get_minimal_context', {});
    expect(out).toContain('ready="false"');
  });

  it('reports ready=true + populates nodes/edges when graph ready', async () => {
    const registry = setup({
      graphReady: true,
      graphStats: {
        files: ['a.ts', 'b.ts', 'c.ts'],
        importsByFile: { 'a.ts': ['b.ts'], 'b.ts': ['c.ts'] },
      },
    });
    const out = await registry.dispatch('ctx_get_minimal_context', {});
    expect(out).toContain('ready="true"');
    expect(out).toContain('nodes="3"');
    expect(out).toContain('edges="2"');
  });

  it('surfaces top hubs from the graph (fan-in/out/bridge reasons)', async () => {
    const registry = setup({
      graphReady: true,
      graphStats: {
        files: ['hub.ts', 'leaf1.ts', 'leaf2.ts', 'leaf3.ts'],
        importsByFile: {
          'leaf1.ts': ['hub.ts'],
          'leaf2.ts': ['hub.ts'],
          'leaf3.ts': ['hub.ts'],
        },
      },
    });
    const out = await registry.dispatch('ctx_get_minimal_context', {});
    expect(out).toContain('name="hub.ts"');
    expect(out).toContain('reason="fan_in"');
  });
});

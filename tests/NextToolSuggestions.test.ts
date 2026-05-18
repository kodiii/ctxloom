/**
 * Tests for packages/core/src/budget/nextToolSuggestions.ts and its
 * integration into `enforceBudget`. Pin the Phase 1b contract:
 *
 *   - Static rules attach to every budget-wrapped response
 *   - Allowlist filter drops non-registered tool names (Phase 4b defense)
 *   - Estimate clamping bounds untrusted input
 *   - Drift detection: every rule's source AND target tool name MUST be
 *     in the registered tool set — prevents a deleted tool from
 *     producing stale suggestions
 */
import { describe, it, expect } from 'vitest';
import {
  suggestNext,
  __referencedToolsForTests,
  __sourceToolsForTests,
} from '../packages/core/src/budget/nextToolSuggestions.js';
import { enforceBudget } from '../src/budget/budget.js';

// ─── static rule shape ───────────────────────────────────────────────

describe('suggestNext static rules', () => {
  it('returns suggestions for a known source tool', () => {
    const out = suggestNext('ctx_get_file');
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toMatchObject({
      tool: expect.any(String),
      why: expect.any(String),
      estimated_tokens: expect.any(Number),
    });
  });

  it('caps suggestions at 3 per call (signal-density rule)', () => {
    // Find any rule with ≥3 suggestions and verify the cap.
    const sourceCounts = __sourceToolsForTests()
      .map((t) => ({ tool: t, n: suggestNext(t).length }))
      .filter((x) => x.n > 0);
    // At least one tool has multiple suggestions (otherwise the cap
    // assertion is vacuous).
    expect(sourceCounts.some((x) => x.n > 1)).toBe(true);
    for (const { n } of sourceCounts) {
      expect(n).toBeLessThanOrEqual(3);
    }
  });

  it('returns empty array for an unknown source tool', () => {
    expect(suggestNext('ctx_fictional_tool_that_does_not_exist')).toEqual([]);
  });

  it('returns empty array for ctx_get_minimal_context (no follow-up rules — the tool itself proposes the first step)', () => {
    expect(suggestNext('ctx_get_minimal_context')).toEqual([]);
  });
});

// ─── allowlist filter ────────────────────────────────────────────────

describe('suggestNext allowlist filter', () => {
  it('drops suggestions whose tool is NOT in the registered set', () => {
    // ctx_get_file currently suggests ctx_get_call_graph + ctx_get_definition + ctx_blast_radius.
    // Pass an allowlist that contains only ctx_get_call_graph → the others get filtered.
    const allowlist = new Set(['ctx_get_call_graph']);
    const out = suggestNext('ctx_get_file', allowlist);
    expect(out.length).toBe(1);
    expect(out[0].tool).toBe('ctx_get_call_graph');
  });

  it('keeps every suggestion when the allowlist contains them all', () => {
    const out_unfiltered = suggestNext('ctx_get_file');
    const allowlist = new Set(out_unfiltered.map((s) => s.tool));
    const out_filtered = suggestNext('ctx_get_file', allowlist);
    expect(out_filtered.map((s) => s.tool).sort()).toEqual(
      out_unfiltered.map((s) => s.tool).sort(),
    );
  });

  it('returns empty array when allowlist excludes every suggestion', () => {
    const allowlist = new Set(['some_other_tool']);
    expect(suggestNext('ctx_get_file', allowlist)).toEqual([]);
  });
});

// ─── estimate clamping ───────────────────────────────────────────────

describe('estimate clamping', () => {
  it('every static-rule estimated_tokens is finite and in [0, 100000]', () => {
    for (const source of __sourceToolsForTests()) {
      for (const s of suggestNext(source)) {
        expect(Number.isFinite(s.estimated_tokens)).toBe(true);
        expect(s.estimated_tokens).toBeGreaterThanOrEqual(0);
        expect(s.estimated_tokens).toBeLessThanOrEqual(100_000);
      }
    }
  });
});

// ─── enforceBudget integration ───────────────────────────────────────

describe('enforceBudget attaches next_tool_suggestions to meta', () => {
  it('over-budget response carries next_tool_suggestions for ctx_get_file', async () => {
    const result = await enforceBudget({
      full: 'x'.repeat(10_000),
      args: { max_response_tokens: 100 },
      toolName: 'ctx_get_file',
      skeletonProducer: async () => 'class Foo {}',
    });
    expect(result.meta.next_tool_suggestions).toBeDefined();
    expect(result.meta.next_tool_suggestions!.length).toBeGreaterThan(0);
    // First suggestion for ctx_get_file is ctx_get_call_graph per the rules.
    expect(result.meta.next_tool_suggestions![0].tool).toBe('ctx_get_call_graph');
  });

  it('under-budget response also carries suggestions (always-on field)', async () => {
    const result = await enforceBudget({
      full: 'short',
      args: { max_response_tokens: 100 },
      toolName: 'ctx_get_file',
    });
    expect(result.meta.next_tool_suggestions).toBeDefined();
    expect(result.meta.next_tool_suggestions!.length).toBeGreaterThan(0);
  });

  it('omits the field entirely when there are no rules for the source tool', async () => {
    // ctx_get_minimal_context has [] rules — the meta should NOT have
    // the field at all (vs. an empty array, which would noisily ship).
    const result = await enforceBudget({
      full: 'short',
      args: { max_response_tokens: 100 },
      toolName: 'ctx_get_minimal_context',
    });
    expect(result.meta.next_tool_suggestions).toBeUndefined();
  });
});

// ─── drift detection ─────────────────────────────────────────────────

describe('drift: every rule references a real registered tool', () => {
  // This is the v1.4.0 substitute for runtime allowlist enforcement.
  // We don't pass `registeredTools` to suggestNext at runtime — instead
  // we assert at test-time that every rule (source tool + target tool)
  // names a tool that's actually in the registry. A typo or a deleted
  // tool here fails CI.
  it('every source tool key in STATIC_RULES is a real registered tool name', async () => {
    const registry = await loadRegisteredTools();
    const missing = __sourceToolsForTests().filter((t) => !registry.has(t));
    expect(missing, `Source rules reference unregistered tools: ${missing.join(', ')}`).toEqual([]);
  });

  it('every target tool referenced by any rule is a real registered tool name', async () => {
    const registry = await loadRegisteredTools();
    const missing = __referencedToolsForTests().filter((t) => !registry.has(t));
    expect(missing, `Rule targets reference unregistered tools: ${missing.join(', ')}`).toEqual([]);
  });
});

/**
 * Build a snapshot of registered tool names by spinning up the real
 * registry with a minimal stub ServerContext. Cheap — registration is
 * synchronous + tools don't run.
 */
async function loadRegisteredTools(): Promise<Set<string>> {
  const { createToolRegistry } = await import('../packages/core/src/tools/index.js');
  // Cast to satisfy ServerContext shape — none of the registrars
  // actually invoke these stubs at registration time.
  const ctx = makeStubContext();
  const registry = createToolRegistry(ctx);
  return new Set(registry.list().map((t) => t.name));
}

function makeStubContext(): never {
  // Stub ServerContext sufficient for tool registration. The functions
  // throw if invoked — proves tool registration doesn't depend on
  // runtime context.
  const stub = {
    projectRoot: '/tmp/stub',
    dbPath: '/tmp/stub/.ctxloom/db',
    noDefaultMode: false,
    getStore: () => {
      throw new Error('stub');
    },
    getGraph: () => {
      throw new Error('stub');
    },
    getParser: () => {
      throw new Error('stub');
    },
    getSkeletonizer: () => {
      throw new Error('stub');
    },
    getRuleManager: () => {
      throw new Error('stub');
    },
    getPathValidator: () => {
      throw new Error('stub');
    },
    isStoreInitialized: () => false,
    isGraphInitialized: () => false,
    isParserInitialized: () => false,
    registry: { list: () => [] },
    stateManager: { has: () => false, get: () => null, list: () => [], max: 0 },
  };
  return stub as never;
}

/**
 * Tests for packages/core/src/budget/taskBudget.ts — Phase 4a of the
 * agent-harness plan. Pins:
 *
 *   - Counter increments + ceiling enforcement
 *   - Inactivity-gap auto-reset
 *   - firstBreach fires exactly once per task
 *   - CTXLOOM_DISABLE_BUDGET=1 kill-switch
 *   - CTXLOOM_TASK_TOOL_BUDGET env override
 *   - Argument-override merge: caller hints DO get overridden
 *   - ToolRegistry.dispatch integration: exempt tools not counted,
 *     non-exempt tools see injected args when over budget
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  TaskBudgetTracker,
  applyOverBudgetOverrides,
  OVER_BUDGET_ARG_OVERRIDES,
  __resetTaskBudgetTrackerForTests,
  getTaskBudgetTracker,
} from '../packages/core/src/budget/taskBudget.js';
import { ToolRegistry } from '../packages/core/src/tools/registry.js';

const ORIG_KILLSWITCH = process.env.CTXLOOM_DISABLE_BUDGET;
const ORIG_BUDGET = process.env.CTXLOOM_TASK_TOOL_BUDGET;

beforeEach(() => {
  delete process.env.CTXLOOM_DISABLE_BUDGET;
  delete process.env.CTXLOOM_TASK_TOOL_BUDGET;
  __resetTaskBudgetTrackerForTests();
});
afterEach(() => {
  if (ORIG_KILLSWITCH === undefined) delete process.env.CTXLOOM_DISABLE_BUDGET;
  else process.env.CTXLOOM_DISABLE_BUDGET = ORIG_KILLSWITCH;
  if (ORIG_BUDGET === undefined) delete process.env.CTXLOOM_TASK_TOOL_BUDGET;
  else process.env.CTXLOOM_TASK_TOOL_BUDGET = ORIG_BUDGET;
  __resetTaskBudgetTrackerForTests();
});

// ─── basic counter behavior ──────────────────────────────────────────

describe('TaskBudgetTracker counter', () => {
  it('increments callCount across calls', () => {
    const t = new TaskBudgetTracker({ maxCalls: 8 });
    const t0 = 1_000_000;
    expect(t.recordCall('s', t0).callCount).toBe(1);
    expect(t.recordCall('s', t0 + 100).callCount).toBe(2);
    expect(t.recordCall('s', t0 + 200).callCount).toBe(3);
  });

  it('returns overBudget=true when count exceeds maxCalls', () => {
    const t = new TaskBudgetTracker({ maxCalls: 3 });
    const t0 = 1_000_000;
    expect(t.recordCall('s', t0 + 0).overBudget).toBe(false);
    expect(t.recordCall('s', t0 + 1).overBudget).toBe(false);
    expect(t.recordCall('s', t0 + 2).overBudget).toBe(false);
    expect(t.recordCall('s', t0 + 3).overBudget).toBe(true); // 4th call > 3
  });

  it('fires firstBreach exactly once per task', () => {
    const t = new TaskBudgetTracker({ maxCalls: 2 });
    const t0 = 1_000_000;
    expect(t.recordCall('s', t0 + 0).firstBreach).toBe(false);
    expect(t.recordCall('s', t0 + 1).firstBreach).toBe(false);
    // 3rd call: first breach
    expect(t.recordCall('s', t0 + 2).firstBreach).toBe(true);
    // 4th, 5th calls: still over budget, but no subsequent firstBreach
    expect(t.recordCall('s', t0 + 3).firstBreach).toBe(false);
    expect(t.recordCall('s', t0 + 4).firstBreach).toBe(false);
  });
});

// ─── inactivity gap ──────────────────────────────────────────────────

describe('TaskBudgetTracker inactivity gap', () => {
  it('resets the counter after gap of resetGapMs', () => {
    const t = new TaskBudgetTracker({ maxCalls: 8, resetGapMs: 90_000 });
    const t0 = 1_000_000;
    t.recordCall('s', t0);
    t.recordCall('s', t0 + 1000);
    expect(t.__getCount('s')).toBe(2);
    // Gap is measured from the LAST call (t0+1000). Need > 90s
    // after that point to trigger reset.
    const decision = t.recordCall('s', t0 + 1000 + 90_001);
    expect(decision.callCount).toBe(1);
    expect(decision.overBudget).toBe(false);
    expect(decision.firstBreach).toBe(false);
  });

  it('inactivity reset re-arms the firstBreach flag', () => {
    const t = new TaskBudgetTracker({ maxCalls: 1, resetGapMs: 1000 });
    const t0 = 1_000_000;
    t.recordCall('s', t0); // count=1
    const first = t.recordCall('s', t0 + 1); // count=2, breach
    expect(first.firstBreach).toBe(true);
    // Inactivity reset
    const fresh = t.recordCall('s', t0 + 5000);
    expect(fresh.callCount).toBe(1);
    expect(fresh.firstBreach).toBe(false);
    // Now we can re-breach this new task
    const reBreach = t.recordCall('s', t0 + 5001);
    expect(reBreach.firstBreach).toBe(true);
  });
});

// ─── kill switch + env override ──────────────────────────────────────

describe('CTXLOOM_DISABLE_BUDGET kill switch', () => {
  it('disables enforcement entirely when set to "1"', () => {
    process.env.CTXLOOM_DISABLE_BUDGET = '1';
    const t = new TaskBudgetTracker({ maxCalls: 1 });
    // Many calls, no breach, no counter mutation
    for (let i = 0; i < 100; i++) {
      const d = t.recordCall('s');
      expect(d.overBudget).toBe(false);
      expect(d.callCount).toBe(0);
    }
  });
});

describe('CTXLOOM_TASK_TOOL_BUDGET env override', () => {
  it('honors CTXLOOM_TASK_TOOL_BUDGET when set to a positive int', () => {
    process.env.CTXLOOM_TASK_TOOL_BUDGET = '3';
    const t = new TaskBudgetTracker();
    const t0 = 1_000_000;
    expect(t.recordCall('s', t0 + 0).overBudget).toBe(false);
    expect(t.recordCall('s', t0 + 1).overBudget).toBe(false);
    expect(t.recordCall('s', t0 + 2).overBudget).toBe(false);
    expect(t.recordCall('s', t0 + 3).overBudget).toBe(true);
  });

  it.each(['0', '-5', 'abc', ''])(
    'falls back to default when env is %j (invalid)',
    (bad) => {
      process.env.CTXLOOM_TASK_TOOL_BUDGET = bad;
      const t = new TaskBudgetTracker();
      // Default 8 calls; the 9th breaches.
      const t0 = 1_000_000;
      for (let i = 0; i < 8; i++) {
        expect(t.recordCall('s', t0 + i).overBudget).toBe(false);
      }
      expect(t.recordCall('s', t0 + 8).overBudget).toBe(true);
    },
  );

  it('constructor opts beat env override', () => {
    process.env.CTXLOOM_TASK_TOOL_BUDGET = '20';
    const t = new TaskBudgetTracker({ maxCalls: 2 });
    const t0 = 1_000_000;
    t.recordCall('s', t0);
    t.recordCall('s', t0 + 1);
    expect(t.recordCall('s', t0 + 2).overBudget).toBe(true);
  });
});

// ─── argument injection ─────────────────────────────────────────────

describe('applyOverBudgetOverrides', () => {
  it('returns a fresh object containing every override key', () => {
    const out = applyOverBudgetOverrides({}) as Record<string, unknown>;
    for (const key of Object.keys(OVER_BUDGET_ARG_OVERRIDES)) {
      expect(out[key]).toBe(OVER_BUDGET_ARG_OVERRIDES[key]);
    }
  });

  it('OVERRIDES the caller hints (not preserves them)', () => {
    // The whole point: an agent saying "give me full" must still
    // get skeleton when over budget.
    const out = applyOverBudgetOverrides({
      max_response_tokens: 10_000,
      response_format: 'full',
      detail_level: 'standard',
    }) as Record<string, unknown>;
    expect(out.max_response_tokens).toBe(200);
    expect(out.response_format).toBe('skeleton');
    expect(out.detail_level).toBe('minimal');
  });

  it('preserves caller args that are NOT overridden', () => {
    const out = applyOverBudgetOverrides({
      symbol: 'emitTelemetry',
      project_root: '/repo/x',
      depth: 2,
    }) as Record<string, unknown>;
    expect(out.symbol).toBe('emitTelemetry');
    expect(out.project_root).toBe('/repo/x');
    expect(out.depth).toBe(2);
  });

  it('handles non-object args gracefully', () => {
    expect(applyOverBudgetOverrides(null)).toMatchObject(OVER_BUDGET_ARG_OVERRIDES);
    expect(applyOverBudgetOverrides(undefined)).toMatchObject(OVER_BUDGET_ARG_OVERRIDES);
    expect(applyOverBudgetOverrides('a string')).toMatchObject(OVER_BUDGET_ARG_OVERRIDES);
  });
});

// ─── ToolRegistry.dispatch enforcement ──────────────────────────────

describe('ToolRegistry.dispatch budget enforcement', () => {
  it('non-exempt tool sees injected args when over budget', async () => {
    process.env.CTXLOOM_TASK_TOOL_BUDGET = '2';
    const registry = new ToolRegistry();
    const seen: unknown[] = [];
    registry.register(
      'ctx_get_file',
      { name: 'ctx_get_file', description: 'test' } as never,
      async (args) => {
        seen.push(args);
        return 'ok';
      },
    );
    // First 2 calls — args pass through untouched.
    await registry.dispatch('ctx_get_file', { path: 'a.ts', max_response_tokens: 9000 });
    await registry.dispatch('ctx_get_file', { path: 'b.ts', max_response_tokens: 9000 });
    expect((seen[0] as { max_response_tokens: number }).max_response_tokens).toBe(9000);
    expect((seen[1] as { max_response_tokens: number }).max_response_tokens).toBe(9000);
    // 3rd call — over budget, args overridden.
    await registry.dispatch('ctx_get_file', { path: 'c.ts', max_response_tokens: 9000 });
    expect((seen[2] as { max_response_tokens: number }).max_response_tokens).toBe(200);
    expect((seen[2] as { response_format: string }).response_format).toBe('skeleton');
  });

  it('exempt tools (ctx_get_minimal_context) bypass the budget entirely', async () => {
    process.env.CTXLOOM_TASK_TOOL_BUDGET = '1';
    const registry = new ToolRegistry();
    const seen: unknown[] = [];
    registry.register(
      'ctx_get_minimal_context',
      { name: 'ctx_get_minimal_context', description: 'test' } as never,
      async (args) => {
        seen.push(args);
        return 'ok';
      },
    );
    // 50 calls all see un-throttled args.
    for (let i = 0; i < 50; i++) {
      await registry.dispatch('ctx_get_minimal_context', { iter: i });
    }
    for (const args of seen) {
      expect((args as { response_format?: string }).response_format).toBeUndefined();
    }
  });

  it('exempt tools do not consume budget on behalf of non-exempt tools', async () => {
    process.env.CTXLOOM_TASK_TOOL_BUDGET = '3';
    const registry = new ToolRegistry();
    const seen: unknown[] = [];
    registry.register('ctx_status', { name: 'ctx_status', description: 'd' } as never, async () => 'ok');
    registry.register('ctx_get_file', { name: 'ctx_get_file', description: 'd' } as never, async (args) => {
      seen.push(args);
      return 'ok';
    });

    // 10 exempt calls — shouldn't move the counter
    for (let i = 0; i < 10; i++) await registry.dispatch('ctx_status', {});
    // 3 non-exempt — all under budget
    await registry.dispatch('ctx_get_file', { path: 'a.ts', max_response_tokens: 9000 });
    await registry.dispatch('ctx_get_file', { path: 'b.ts', max_response_tokens: 9000 });
    await registry.dispatch('ctx_get_file', { path: 'c.ts', max_response_tokens: 9000 });
    // 4th — first breach
    await registry.dispatch('ctx_get_file', { path: 'd.ts', max_response_tokens: 9000 });

    expect((seen[0] as { max_response_tokens: number }).max_response_tokens).toBe(9000);
    expect((seen[1] as { max_response_tokens: number }).max_response_tokens).toBe(9000);
    expect((seen[2] as { max_response_tokens: number }).max_response_tokens).toBe(9000);
    expect((seen[3] as { max_response_tokens: number }).max_response_tokens).toBe(200);
  });

  it('kill switch fully disables enforcement at dispatch layer', async () => {
    process.env.CTXLOOM_DISABLE_BUDGET = '1';
    process.env.CTXLOOM_TASK_TOOL_BUDGET = '1';
    const registry = new ToolRegistry();
    const seen: unknown[] = [];
    registry.register('ctx_get_file', { name: 'ctx_get_file', description: 'd' } as never, async (args) => {
      seen.push(args);
      return 'ok';
    });
    // 50 calls — every one passes through untouched
    for (let i = 0; i < 50; i++) {
      await registry.dispatch('ctx_get_file', { path: 'x', max_response_tokens: 9000 });
    }
    for (const args of seen) {
      expect((args as { max_response_tokens: number }).max_response_tokens).toBe(9000);
    }
  });
});

// ─── singleton ───────────────────────────────────────────────────────

describe('getTaskBudgetTracker singleton', () => {
  it('returns the same instance across calls', () => {
    const a = getTaskBudgetTracker();
    const b = getTaskBudgetTracker();
    expect(a).toBe(b);
  });
  it('reset rebuilds the singleton (env-var changes take effect)', () => {
    const a = getTaskBudgetTracker();
    __resetTaskBudgetTrackerForTests();
    const b = getTaskBudgetTracker();
    expect(a).not.toBe(b);
  });
});

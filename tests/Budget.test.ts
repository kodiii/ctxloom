/**
 * Tests for packages/core/src/budget/budget.ts — Phase B2.1 infrastructure.
 *
 * Every per-tool integration that lands in B2.2…B2.5 depends on this
 * helper, so the contract must be airtight. Each block tests one of
 * the 5 branches of the enforceBudget decision tree (kill switch,
 * explicit skeleton, no budget, under budget, over budget) plus the
 * helper utilities around it (hasBudgetArgs, readBudgetArgs,
 * wrapResponse, telemetry emission).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultTokenEstimator,
  hasBudgetArgs,
  readBudgetArgs,
  isBudgetDisabled,
  enforceBudget,
  wrapResponse,
  emitTelemetry,
  type BudgetArgs,
} from '../src/budget/budget.js';

// ─── helpers ─────────────────────────────────────────────────────────

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    original[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(env)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

// ─── token estimator ─────────────────────────────────────────────────

describe('defaultTokenEstimator', () => {
  it('approximates tokens as ceil(chars/4)', () => {
    expect(defaultTokenEstimator('')).toBe(0);
    expect(defaultTokenEstimator('a')).toBe(1);
    expect(defaultTokenEstimator('abcd')).toBe(1);
    expect(defaultTokenEstimator('abcde')).toBe(2);
    expect(defaultTokenEstimator('a'.repeat(100))).toBe(25);
  });
});

// ─── hasBudgetArgs ───────────────────────────────────────────────────

describe('hasBudgetArgs', () => {
  it('returns false when args is null, undefined, or non-object', () => {
    expect(hasBudgetArgs(null)).toBe(false);
    expect(hasBudgetArgs(undefined)).toBe(false);
    expect(hasBudgetArgs('string')).toBe(false);
    expect(hasBudgetArgs(42)).toBe(false);
  });

  it('returns false when none of the 3 budget fields are present', () => {
    expect(hasBudgetArgs({})).toBe(false);
    expect(hasBudgetArgs({ path: 'foo.ts', project_root: '/x' })).toBe(false);
  });

  it.each([
    ['max_response_tokens', { max_response_tokens: 1000 }],
    ['on_budget_exceeded', { on_budget_exceeded: 'skeleton' }],
    ['response_format', { response_format: 'skeleton' }],
  ] as const)('returns true when %s is set', (_label, args) => {
    expect(hasBudgetArgs(args)).toBe(true);
  });

  it('is the back-compat boundary: opting out leaves raw responses unchanged', () => {
    // Pinning the invariant in test form: any tool's existing callers
    // that don't pass budget args MUST NOT see envelope changes.
    expect(hasBudgetArgs({ path: 'foo.ts' })).toBe(false);
  });
});

// ─── readBudgetArgs ──────────────────────────────────────────────────

describe('readBudgetArgs', () => {
  it('returns empty object for null/undefined/non-object', () => {
    expect(readBudgetArgs(null)).toEqual({});
    expect(readBudgetArgs(undefined)).toEqual({});
    expect(readBudgetArgs(42)).toEqual({});
  });

  it('extracts only the 3 budget fields, ignoring everything else', () => {
    expect(
      readBudgetArgs({
        path: 'foo.ts',
        max_response_tokens: 5000,
        on_budget_exceeded: 'truncate',
        response_format: 'auto',
        other_field: 'ignored',
      }),
    ).toEqual({
      max_response_tokens: 5000,
      on_budget_exceeded: 'truncate',
      response_format: 'auto',
    });
  });

  it('drops fields with invalid types/values (fail-loud at schema layer, fail-quiet here)', () => {
    expect(
      readBudgetArgs({
        max_response_tokens: 'not-a-number',
        on_budget_exceeded: 'not-a-valid-mode',
        response_format: 'banana',
      }),
    ).toEqual({});
  });
});

// ─── isBudgetDisabled ────────────────────────────────────────────────

describe('isBudgetDisabled (CTXLOOM_DISABLE_BUDGET=1 kill switch)', () => {
  it('returns true only when env var is exactly "1"', () => {
    withEnv({ CTXLOOM_DISABLE_BUDGET: '1' }, () => {
      expect(isBudgetDisabled()).toBe(true);
    });
  });

  it.each([undefined, '', '0', 'true', 'yes'])('returns false for %s', (val) => {
    withEnv({ CTXLOOM_DISABLE_BUDGET: val }, () => {
      expect(isBudgetDisabled()).toBe(false);
    });
  });
});

// ─── enforceBudget — the decision tree ───────────────────────────────

describe('enforceBudget', () => {
  describe('(1) kill switch', () => {
    it('returns full text + format=full when CTXLOOM_DISABLE_BUDGET=1, ignoring everything else', async () => {
      const result = await withEnv({ CTXLOOM_DISABLE_BUDGET: '1' }, () =>
        enforceBudget({
          full: 'a'.repeat(10000),
          args: { max_response_tokens: 10, on_budget_exceeded: 'error' },
          toolName: 'ctx_get_file',
          skeletonProducer: async () => 'skeleton',
        }),
      );
      expect(result.text).toBe('a'.repeat(10000));
      expect(result.meta.format).toBe('full');
      expect(result.meta.fallback_reason).toBeNull();
      // Critical: even on_budget_exceeded='error' must NOT throw under kill switch.
    });
  });

  describe('(2) explicit response_format: skeleton', () => {
    it('runs the skeleton producer regardless of budget, returns format=skeleton', async () => {
      const result = await enforceBudget({
        full: 'function foo() { /* huge body */ return 42; }',
        args: { response_format: 'skeleton' }, // no max_response_tokens at all
        toolName: 'ctx_get_file',
        skeletonProducer: async () => 'function foo(): number;',
      });
      expect(result.text).toBe('function foo(): number;');
      expect(result.meta.format).toBe('skeleton');
      expect(result.meta.fallback_reason).toBeNull();
      expect(result.meta.original_tokens_est).toBeGreaterThan(result.meta.returned_tokens_est);
    });

    it('falls through to full text when skeleton producer returns null, flags skeleton_failed', async () => {
      const result = await enforceBudget({
        full: 'binary blob',
        args: { response_format: 'skeleton' },
        toolName: 'ctx_get_file',
        skeletonProducer: async () => null,
      });
      expect(result.text).toBe('binary blob');
      expect(result.meta.format).toBe('full');
      expect(result.meta.fallback_reason).toBe('skeleton_failed');
    });
  });

  describe('(3) no budget resolved', () => {
    it('returns full text when neither caller budget nor default is set', async () => {
      const result = await enforceBudget({
        full: 'a'.repeat(10000),
        args: { on_budget_exceeded: 'truncate' }, // mode set but no budget
        toolName: 'ctx_get_file',
      });
      expect(result.text).toBe('a'.repeat(10000));
      expect(result.meta.format).toBe('full');
      expect(result.meta.original_tokens_est).toBe(result.meta.returned_tokens_est);
    });

    it('uses tool default when caller did not specify max_response_tokens', async () => {
      const result = await enforceBudget({
        full: 'a'.repeat(10000), // ~2500 tokens
        args: { on_budget_exceeded: 'truncate' },
        toolName: 'ctx_get_file',
        defaultMaxTokens: 100, // forces fallback
      });
      expect(result.meta.format).toBe('truncated');
      expect(result.meta.fallback_reason).toBe('budget_exceeded');
    });

    it('caller budget overrides tool default', async () => {
      const result = await enforceBudget({
        full: 'a'.repeat(400), // 100 tokens
        args: { max_response_tokens: 200 },
        toolName: 'ctx_get_file',
        defaultMaxTokens: 50, // would have forced fallback, but caller overrode
      });
      expect(result.meta.format).toBe('full');
    });
  });

  describe('(4) under budget', () => {
    it('returns full text unchanged, format=full, fallback_reason=null', async () => {
      const result = await enforceBudget({
        full: 'small response',
        args: { max_response_tokens: 1000 },
        toolName: 'ctx_get_file',
      });
      expect(result.text).toBe('small response');
      expect(result.meta.format).toBe('full');
      expect(result.meta.fallback_reason).toBeNull();
    });
  });

  describe('(5) over budget', () => {
    const BIG = 'a'.repeat(10000); // ~2500 tokens

    it("throws a structured Error when on_budget_exceeded === 'error'", async () => {
      await expect(
        enforceBudget({
          full: BIG,
          args: { max_response_tokens: 10, on_budget_exceeded: 'error' },
          toolName: 'ctx_get_file',
        }),
      ).rejects.toThrow(/exceeds max_response_tokens=10/);
    });

    it("truncates the full text when on_budget_exceeded === 'truncate'", async () => {
      const result = await enforceBudget({
        full: BIG,
        args: { max_response_tokens: 10, on_budget_exceeded: 'truncate' },
        toolName: 'ctx_get_file',
      });
      expect(result.meta.format).toBe('truncated');
      expect(result.meta.fallback_reason).toBe('budget_exceeded');
      // chars/4 estimator → 10 tokens ≈ 40 chars (defensive: don't pin exact slice)
      expect(result.text.length).toBeLessThanOrEqual(40);
      expect(result.meta.returned_tokens_est).toBeLessThanOrEqual(10);
    });

    it("uses skeleton fallback by default (on_budget_exceeded undefined)", async () => {
      const result = await enforceBudget({
        full: BIG,
        args: { max_response_tokens: 100 },
        toolName: 'ctx_get_file',
        skeletonProducer: async () => 'class Foo { method(): void; }',
      });
      expect(result.text).toBe('class Foo { method(): void; }');
      expect(result.meta.format).toBe('skeleton');
      expect(result.meta.fallback_reason).toBe('budget_exceeded');
    });

    it('truncates the skeleton when even the skeleton is over budget', async () => {
      const bigSkeleton = 'class Foo { '.repeat(100); // way over a 10-token budget
      const result = await enforceBudget({
        full: 'a'.repeat(10000),
        args: { max_response_tokens: 10 },
        toolName: 'ctx_get_file',
        skeletonProducer: async () => bigSkeleton,
      });
      expect(result.meta.format).toBe('truncated');
      expect(result.meta.fallback_reason).toBe('budget_exceeded');
      expect(result.meta.returned_tokens_est).toBeLessThanOrEqual(10);
    });

    it('falls back to plain truncation with skeleton_failed when no skeletonProducer is provided', async () => {
      const result = await enforceBudget({
        full: BIG,
        args: { max_response_tokens: 10 },
        toolName: 'ctx_get_file',
      });
      expect(result.meta.format).toBe('truncated');
      expect(result.meta.fallback_reason).toBe('skeleton_failed');
    });

    it('falls back to plain truncation with skeleton_failed when skeletonProducer returns null', async () => {
      const result = await enforceBudget({
        full: BIG,
        args: { max_response_tokens: 10 },
        toolName: 'ctx_get_file',
        skeletonProducer: async () => null,
      });
      expect(result.meta.format).toBe('truncated');
      expect(result.meta.fallback_reason).toBe('skeleton_failed');
    });

    it('falls back to plain truncation when skeletonProducer throws (crash isolation)', async () => {
      // Pins the issue risk matrix mitigation:
      // "Skeletonizer crashes on a new language → tool returns error
      //  Mitigation: Wrap in try/catch, fall back to raw truncation"
      const result = await enforceBudget({
        full: BIG,
        args: { max_response_tokens: 10 },
        toolName: 'ctx_get_file',
        skeletonProducer: async () => { throw new Error('parser exploded'); },
      });
      expect(result.meta.format).toBe('truncated');
      expect(result.meta.fallback_reason).toBe('skeleton_failed');
    });
  });

  describe('pluggable estimator', () => {
    it('honors a custom estimator (e.g. tiktoken stand-in)', async () => {
      // Identity-byte estimator: every char is 1 token. With budget=5
      // and a 10-char input, we should trip the fallback even though
      // the default chars/4 estimator would not have.
      const result = await enforceBudget({
        full: '1234567890',
        args: { max_response_tokens: 5, on_budget_exceeded: 'truncate' },
        toolName: 'ctx_get_file',
        estimator: (s) => s.length,
      });
      expect(result.meta.format).toBe('truncated');
      expect(result.meta.original_tokens_est).toBe(10);
    });
  });
});

// ─── telemetry ───────────────────────────────────────────────────────

describe('emitTelemetry', () => {
  let captured: Array<{ stream: 'stderr'; chunk: string }>;
  let originalWrite: typeof process.stderr.write;
  let tempTelemetryDir: string;
  let originalTelemetryDir: string | undefined;

  beforeEach(() => {
    captured = [];
    originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      captured.push({ stream: 'stderr', chunk: chunk.toString() });
      return true;
    }) as typeof process.stderr.write;

    // Scope CTXLOOM_TELEMETRY_DIR to a temp dir per test so the
    // appendEvent() call inside emitTelemetry doesn't leak files
    // into the developer's real ~/.ctxloom/telemetry/. Pre-PR #135
    // emitTelemetry was stderr-only; post-PR it ALSO writes to disk
    // and these tests would otherwise pollute the same JSONL file
    // the user's `ctxloom budget-stats` reads. Pinned by the
    // convergent TEST-135-2 + PERF-135-1 dogfood finding on PR #135.
    tempTelemetryDir = mkdtempSync(join(tmpdir(), 'ctxloom-budget-test-'));
    originalTelemetryDir = process.env.CTXLOOM_TELEMETRY_DIR;
    process.env.CTXLOOM_TELEMETRY_DIR = tempTelemetryDir;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
    rmSync(tempTelemetryDir, { recursive: true, force: true });
    if (originalTelemetryDir === undefined) delete process.env.CTXLOOM_TELEMETRY_DIR;
    else process.env.CTXLOOM_TELEMETRY_DIR = originalTelemetryDir;
  });

  it('writes nothing when CTXLOOM_TELEMETRY_LEVEL is unset', () => {
    withEnv({ CTXLOOM_TELEMETRY_LEVEL: undefined, CTXLOOM_LOG_MODE: 'json' }, () => {
      emitTelemetry({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file', ratio: 2 });
    });
    expect(captured).toEqual([]);
  });

  it('writes a structured JSON line when CTXLOOM_TELEMETRY_LEVEL=full', () => {
    withEnv({ CTXLOOM_TELEMETRY_LEVEL: 'full', CTXLOOM_LOG_MODE: 'json' }, () => {
      emitTelemetry({ event: 'mcp.budget.exceeded', tool: 'ctx_get_file', ratio: 2 });
    });
    expect(captured.length).toBe(1);
    const line = JSON.parse(captured[0].chunk.trim());
    expect(line.msg).toBe('mcp.budget.exceeded');
    expect(line.event).toBe('mcp.budget.exceeded');
    expect(line.tool).toBe('ctx_get_file');
    expect(line.ratio).toBe(2);
  });

  it('fires mcp.budget.exceeded + mcp.fallback.used from enforceBudget on a budget breach', async () => {
    await withEnv({ CTXLOOM_TELEMETRY_LEVEL: 'full', CTXLOOM_LOG_MODE: 'json' }, async () => {
      await enforceBudget({
        full: 'a'.repeat(10000),
        args: { max_response_tokens: 10, on_budget_exceeded: 'truncate' },
        toolName: 'ctx_get_file',
      });
    });
    const events = captured
      .map((c) => JSON.parse(c.chunk.trim()))
      .filter((e: { msg: string }) => e.msg.startsWith('mcp.'));
    expect(events.map((e: { msg: string }) => e.msg)).toEqual([
      'mcp.budget.exceeded',
      'mcp.fallback.used',
    ]);
  });
});

// ─── wrapResponse ────────────────────────────────────────────────────

describe('wrapResponse', () => {
  it('serializes BudgetedResult into the {data, meta} envelope', () => {
    const wrapped = wrapResponse({
      text: 'hello',
      meta: {
        format: 'full',
        original_tokens_est: 2,
        returned_tokens_est: 2,
        fallback_reason: null,
      },
    });
    expect(JSON.parse(wrapped)).toEqual({
      data: 'hello',
      meta: {
        format: 'full',
        original_tokens_est: 2,
        returned_tokens_est: 2,
        fallback_reason: null,
      },
    });
  });
});

// ─── back-compat type guard (pinning the spec invariant) ─────────────

describe('back-compat invariant', () => {
  it('hasBudgetArgs gates whether a tool wraps its response', () => {
    // The 21 untouched tools and all pre-B2 callers MUST see no
    // envelope. This test pins the contract in one place — any
    // tool integration must check hasBudgetArgs before wrapResponse.
    const preB2Args: unknown = { path: 'foo.ts', project_root: '/x' };
    expect(hasBudgetArgs(preB2Args)).toBe(false);

    const optedInArgs: unknown = { path: 'foo.ts', max_response_tokens: 1000 };
    expect(hasBudgetArgs(optedInArgs)).toBe(true);

    // Sanity: readBudgetArgs is safe to call on either shape.
    const args: BudgetArgs = readBudgetArgs(optedInArgs);
    expect(args.max_response_tokens).toBe(1000);
  });
});

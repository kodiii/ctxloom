/**
 * Tests for packages/core/src/budget/budgetStats.ts — per-tool
 * aggregation + render.
 *
 * The aggregation logic is the input to the eventual per-tool
 * default tuning follow-up (re-derive DEFAULT_MAX_RESPONSE_TOKENS
 * from real p75). An off-by-one in percentile() or a bug in the
 * fallback-mode bucket counts silently corrupts every future tuning
 * decision — same blast radius as the apps/pr-bot percentile()
 * tests guard against (pinned in tests/telemetry-aggregate.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { percentile, summarize, renderSummary } from '../src/budget/budgetStats.js';
import type { PersistedEvent } from '../src/budget/eventCollector.js';

function ev(overrides: Partial<PersistedEvent>): PersistedEvent {
  return {
    ts: '2026-05-18T12:00:00.000Z',
    event: 'mcp.budget.exceeded',
    tool: 'ctx_get_file',
    ...overrides,
  };
}

// ─── percentile (parallels aggregate-telemetry.ts:percentile) ────────

describe('percentile', () => {
  it('returns null for empty input', () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it('single element: returns it for any p', () => {
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 1)).toBe(42);
  });

  it('nearest-rank for [1..10]: p=0→1, p=0.5→5, p=0.75→7, p=1→10', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(v, 0)).toBe(1);
    expect(percentile(v, 0.5)).toBe(5);
    expect(percentile(v, 0.75)).toBe(7);
    expect(percentile(v, 1)).toBe(10);
  });

  it('does NOT mutate the caller array (defensive copy guard)', () => {
    const original = [7, 3, 10, 1, 5];
    const snapshot = [...original];
    percentile(original, 0.5);
    expect(original).toEqual(snapshot);
  });
});

// ─── summarize: empty-window degenerate case ─────────────────────────

describe('summarize — empty input', () => {
  it('returns zeroed summary with empty tables when no events', () => {
    const s = summarize([], new Date('2026-05-04T00:00:00Z'), new Date('2026-05-18T00:00:00Z'));
    expect(s.totalEvents).toBe(0);
    expect(s.fallbackTable).toEqual([]);
    expect(s.distributionTable).toEqual([]);
    expect(s.windowStart).toBe('2026-05-04T00:00:00.000Z');
    expect(s.windowEnd).toBe('2026-05-18T00:00:00.000Z');
  });
});

// ─── summarize: distribution table ───────────────────────────────────

describe('summarize — original-token distribution', () => {
  it('per-tool percentiles for a single tool', () => {
    const events: PersistedEvent[] = [1000, 2000, 3000, 4000, 5000].map((t) =>
      ev({ original_tokens: t, tool: 'ctx_get_file' }),
    );
    const s = summarize(events, new Date('2026-05-18T00:00:00Z'), new Date('2026-05-18T23:59:59Z'));
    expect(s.distributionTable).toEqual([
      { tool: 'ctx_get_file', n: 5, min: 1000, p50: 3000, p75: 4000, p95: 4000, max: 5000 },
    ]);
  });

  it('separates buckets by tool (no cross-contamination)', () => {
    const events: PersistedEvent[] = [
      ev({ tool: 'ctx_get_file', original_tokens: 8000 }),
      ev({ tool: 'ctx_get_file', original_tokens: 12000 }),
      ev({ tool: 'ctx_search', original_tokens: 1000 }),
    ];
    const s = summarize(events, new Date('2026-05-18T00:00:00Z'), new Date('2026-05-18T23:59:59Z'));
    expect(s.distributionTable.length).toBe(2);
    const file = s.distributionTable.find((r) => r.tool === 'ctx_get_file')!;
    const search = s.distributionTable.find((r) => r.tool === 'ctx_search')!;
    expect(file.n).toBe(2);
    expect(file.min).toBe(8000);
    expect(file.max).toBe(12000);
    expect(search.n).toBe(1);
    expect(search.p75).toBe(1000);
  });

  it('only counts mcp.budget.exceeded events (not mcp.fallback.used)', () => {
    // Mixing in fallback events shouldn't inflate the breach count or
    // skew percentiles — only the breaches feed the distribution.
    const events: PersistedEvent[] = [
      ev({ tool: 'ctx_get_file', event: 'mcp.budget.exceeded', original_tokens: 8000 }),
      ev({ tool: 'ctx_get_file', event: 'mcp.fallback.used', mode: 'skeleton' }),
      ev({ tool: 'ctx_get_file', event: 'mcp.fallback.used', mode: 'truncate' }),
    ];
    const s = summarize(events, new Date('2026-05-18T00:00:00Z'), new Date('2026-05-18T23:59:59Z'));
    const file = s.distributionTable.find((r) => r.tool === 'ctx_get_file')!;
    expect(file.n).toBe(1); // not 3
  });

  it('drops breach events with missing/non-numeric original_tokens (malformed payload guard)', () => {
    const events: PersistedEvent[] = [
      ev({ tool: 'ctx_get_file', original_tokens: 5000 }),
      ev({ tool: 'ctx_get_file', original_tokens: 'not a number' }),
      ev({ tool: 'ctx_get_file' }), // missing original_tokens entirely
    ];
    const s = summarize(events, new Date('2026-05-18T00:00:00Z'), new Date('2026-05-18T23:59:59Z'));
    const file = s.distributionTable.find((r) => r.tool === 'ctx_get_file')!;
    expect(file.n).toBe(1);
  });

  it('alphabetical sort guarantees stable output for snapshot/screenshot consumers', () => {
    const events: PersistedEvent[] = [
      ev({ tool: 'ctx_search', original_tokens: 1000 }),
      ev({ tool: 'ctx_apply_refactor', original_tokens: 500 }),
      ev({ tool: 'ctx_get_file', original_tokens: 5000 }),
    ];
    const s = summarize(events, new Date('2026-05-18T00:00:00Z'), new Date('2026-05-18T23:59:59Z'));
    expect(s.distributionTable.map((r) => r.tool)).toEqual(['ctx_apply_refactor', 'ctx_get_file', 'ctx_search']);
  });
});

// ─── summarize: fallback distribution table ──────────────────────────

describe('summarize — fallback distribution', () => {
  it('per-tool fallback split totals 100% (rounded)', () => {
    // 4 skeleton + 1 truncate + 0 error → 80% / 20% / 0%
    const events: PersistedEvent[] = [
      ev({ tool: 'ctx_get_file', event: 'mcp.fallback.used', mode: 'skeleton' }),
      ev({ tool: 'ctx_get_file', event: 'mcp.fallback.used', mode: 'skeleton' }),
      ev({ tool: 'ctx_get_file', event: 'mcp.fallback.used', mode: 'skeleton' }),
      ev({ tool: 'ctx_get_file', event: 'mcp.fallback.used', mode: 'skeleton' }),
      ev({ tool: 'ctx_get_file', event: 'mcp.fallback.used', mode: 'truncate' }),
    ];
    const s = summarize(events, new Date('2026-05-18T00:00:00Z'), new Date('2026-05-18T23:59:59Z'));
    expect(s.fallbackTable).toEqual([
      { tool: 'ctx_get_file', breaches: 5, skeletonPct: 80, truncatePct: 20, errorPct: 0 },
    ]);
  });

  it('collapses mode variants: skeleton+truncate → skeleton bucket, truncate-fallback → truncate bucket', () => {
    // The variants exist because enforceBudget tags them differently
    // for telemetry (skeleton-too-big still falls back to slicing,
    // skeletonless tools fall straight through to slicing). For the
    // user-facing table the question is "did the skeleton path win
    // or did we end up truncating?" — collapse accordingly.
    const events: PersistedEvent[] = [
      ev({ tool: 'ctx_get_file', event: 'mcp.fallback.used', mode: 'skeleton+truncate' }),
      ev({ tool: 'ctx_get_file', event: 'mcp.fallback.used', mode: 'truncate-fallback' }),
    ];
    const s = summarize(events, new Date('2026-05-18T00:00:00Z'), new Date('2026-05-18T23:59:59Z'));
    expect(s.fallbackTable).toEqual([
      { tool: 'ctx_get_file', breaches: 2, skeletonPct: 50, truncatePct: 50, errorPct: 0 },
    ]);
  });
});

// ─── renderSummary ───────────────────────────────────────────────────

describe('renderSummary', () => {
  it('empty summary renders a no-events placeholder with diagnostics', () => {
    const s = summarize([], new Date('2026-05-04T00:00:00Z'), new Date('2026-05-18T00:00:00Z'));
    const out = renderSummary(s);
    expect(out).toContain('No events in window');
    expect(out).toContain('CTXLOOM_TELEMETRY_LEVEL');
  });

  it('populated summary renders both tables', () => {
    const events: PersistedEvent[] = [
      ev({ tool: 'ctx_get_file', original_tokens: 8000 }),
      ev({ tool: 'ctx_get_file', event: 'mcp.fallback.used', mode: 'skeleton' }),
    ];
    const s = summarize(events, new Date('2026-05-18T00:00:00Z'), new Date('2026-05-18T23:59:59Z'));
    const out = renderSummary(s);
    expect(out).toContain('Fallback distribution per tool');
    expect(out).toContain('Original-token distribution per tool');
    expect(out).toContain('ctx_get_file');
    // Footer that names p75 as the tuning input — the markdown
    // bold wraps the "p75" token so check both halves separately.
    expect(out).toMatch(/p75.*column is the input.*tuning/i);
  });
});

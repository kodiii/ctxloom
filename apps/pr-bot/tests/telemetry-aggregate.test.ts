/**
 * Unit tests for `percentile()` in
 * `apps/pr-bot/scripts/aggregate-telemetry.ts`.
 *
 * Closes TEST-114-2 (high) from PR #114 dogfood: this function
 * produces the `p75` column that Phase B (#106) will wire into every
 * per-tool default budget. An off-by-one or sort-mutation bug here
 * silently corrupts every downstream budget — the most consequential
 * math in the telemetry pipeline.
 */
import { describe, it, expect } from 'vitest';

import { percentile, summarize } from '../scripts/aggregate-telemetry.js';
import type { TelemetryRow } from '../src/telemetry/schema.js';

describe('percentile', () => {
  it('returns null for an empty array', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([], 0.75)).toBeNull();
    expect(percentile([], 0)).toBeNull();
    expect(percentile([], 1)).toBeNull();
  });

  it('returns the single element for a one-element array', () => {
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.75)).toBe(42);
    expect(percentile([42], 1)).toBe(42);
  });

  it('computes nearest-rank percentiles for [1..10]', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // idx = floor((10-1) * p) = floor(9p)
    // p=0   → idx=0 → 1
    // p=0.5 → idx=4 → 5
    // p=0.75 → idx=6 → 7
    // p=0.95 → idx=8 → 9
    // p=1   → idx=9 → 10
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, 0.5)).toBe(5);
    expect(percentile(values, 0.75)).toBe(7);
    expect(percentile(values, 0.95)).toBe(9);
    expect(percentile(values, 1)).toBe(10);
  });

  it('handles unsorted input correctly (does NOT trust insertion order)', () => {
    const shuffled = [7, 3, 10, 1, 5, 9, 4, 8, 2, 6];
    expect(percentile(shuffled, 0)).toBe(1);
    expect(percentile(shuffled, 0.5)).toBe(5);
    expect(percentile(shuffled, 0.75)).toBe(7);
    expect(percentile(shuffled, 1)).toBe(10);
  });

  it('does NOT mutate the caller array (sort-mutation guard)', () => {
    const original = [7, 3, 10, 1, 5];
    const snapshot = [...original];
    percentile(original, 0.5);
    expect(original).toEqual(snapshot);
  });

  it('handles duplicate values correctly', () => {
    expect(percentile([5, 5, 5, 5], 0.5)).toBe(5);
    expect(percentile([5, 5, 5, 5], 0.75)).toBe(5);
    expect(percentile([5, 5, 5, 5], 1)).toBe(5);
  });

  it('handles real-world Phase A token data (security specialist)', () => {
    // Mirrors the actual telemetry from PRs #104, #108, #109, #110, #111
    // (the 5 PRs with full per-specialist data).
    // Sorted: 43, 46, 49, 51, 67
    const securitySamples = [67000, 49000, 46000, 51000, 43000];
    expect(percentile(securitySamples, 0.5)).toBe(49000);
    // p=0.75 → idx=floor((5-1)*0.75)=3 → 51000
    expect(percentile(securitySamples, 0.75)).toBe(51000);
    // p=0.95 → idx=floor((5-1)*0.95)=floor(3.8)=3 → 51000
    // (nearest-rank percentile doesn't reach the max on a 5-element
    // sample until p=1.0 — known property of this percentile method).
    expect(percentile(securitySamples, 0.95)).toBe(51000);
    expect(percentile(securitySamples, 1)).toBe(67000);
  });
});

describe('summarize', () => {
  function makeRow(
    pr: number,
    specialists: Partial<TelemetryRow['specialists']>,
    total = 0,
    tier_distribution: TelemetryRow['tier_distribution'] = null,
  ): TelemetryRow {
    return {
      pr,
      title: `PR #${pr}`,
      url: `https://github.com/kodiii/ctxloom/pull/${pr}`,
      posted_at: '2026-05-16T00:00:00Z',
      specialists: {
        security: null,
        architecture: null,
        testing: null,
        performance: null,
        ...specialists,
      },
      total_specialist_tokens: total,
      verdict: 'approve',
      severity_counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      tier_distribution,
      full_file_reads: null,
      source: 'markdown-table',
    };
  }

  it('counts rows correctly', () => {
    const rows = [makeRow(1, { security: 100 }), makeRow(2, { security: 200 })];
    expect(summarize(rows).rowCount).toBe(2);
  });

  it('produces per-specialist statistics that skip null entries', () => {
    const rows = [
      makeRow(1, { security: 100 }),                   // architecture/testing/performance: null
      makeRow(2, { security: 200, architecture: 50 }), // testing/performance: null
    ];
    const summary = summarize(rows);
    const security = summary.perSpecialist.find((s) => s.specialist === 'security')!;
    expect(security.n).toBe(2);
    expect(security.min).toBe(100);
    expect(security.max).toBe(200);

    const architecture = summary.perSpecialist.find((s) => s.specialist === 'architecture')!;
    expect(architecture.n).toBe(1);
    expect(architecture.min).toBe(50);

    const testing = summary.perSpecialist.find((s) => s.specialist === 'testing')!;
    expect(testing.n).toBe(0);
    expect(testing.min).toBeNull();
    expect(testing.p75).toBeNull();
  });

  it('aggregates tierTotals across rows, skipping null tier_distribution', () => {
    const rows = [
      makeRow(1, {}, 0, { T0: 5, T1: 2, T2: 0, T3: 1 }),
      makeRow(2, {}, 0, { T0: 1, T1: 0, T2: 3, T3: 0 }),
      makeRow(3, {}, 0, null),  // null excluded from totals
    ];
    const summary = summarize(rows);
    expect(summary.tierTotals).toEqual({ T0: 6, T1: 2, T2: 3, T3: 1 });
    expect(summary.tierTotal).toBe(12);
  });

  it('counts verdicts and severity sums correctly', () => {
    const rows = [
      { ...makeRow(1, {}), verdict: 'approve' as const, severity_counts: { critical: 0, high: 0, medium: 2, low: 3, info: 1 } },
      { ...makeRow(2, {}), verdict: 'approve_with_nits' as const, severity_counts: { critical: 0, high: 1, medium: 0, low: 4, info: 5 } },
    ];
    const summary = summarize(rows);
    expect(summary.verdictCounts).toEqual({ approve: 1, approve_with_nits: 1 });
    expect(summary.severitySums).toEqual({ critical: 0, high: 1, medium: 2, low: 7, info: 6 });
  });
});

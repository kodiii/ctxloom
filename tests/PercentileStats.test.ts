/**
 * Tests for the shared percentile() utility at
 * packages/core/src/utils/stats.ts.
 *
 * Closes ARCH-135-2 from PR #135's dogfood — consolidates the
 * previous duplicate declarations in
 * `packages/core/src/budget/budgetStats.ts` and
 * `apps/pr-bot/scripts/aggregate-telemetry.ts`. Both call sites now
 * import from the shared utility, so this single test file is the
 * authoritative contract.
 *
 * The function is load-bearing for:
 *   - per-tool default budget tuning (budgetStats summarize → p75)
 *   - pr-bot dogfood-telemetry aggregation (aggregate-telemetry → p75)
 *
 * An off-by-one or sort-mutation bug here silently corrupts every
 * downstream consumer. The existing per-consumer tests
 * (tests/BudgetStats.test.ts, apps/pr-bot/tests/telemetry-aggregate.test.ts)
 * keep their own percentile cases for end-to-end coverage; THIS file
 * pins the math itself.
 */
import { describe, it, expect } from 'vitest';
import { percentile } from '../packages/core/src/utils/stats.js';

describe('percentile (shared util)', () => {
  it('returns null for an empty array (no values → no meaningful percentile)', () => {
    expect(percentile([], 0)).toBeNull();
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([], 0.75)).toBeNull();
    expect(percentile([], 1)).toBeNull();
  });

  it('returns the single element for a one-element array regardless of p', () => {
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.75)).toBe(42);
    expect(percentile([42], 1)).toBe(42);
  });

  it('uses nearest-rank: index = floor((n-1) * p) on [1..10]', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // idx = floor(9 * p)
    expect(percentile(v, 0)).toBe(1);    // idx=0
    expect(percentile(v, 0.5)).toBe(5);  // idx=4
    expect(percentile(v, 0.75)).toBe(7); // idx=6
    expect(percentile(v, 0.95)).toBe(9); // idx=floor(8.55)=8
    expect(percentile(v, 1)).toBe(10);   // idx=9
  });

  it('sorts the input before indexing (does not trust insertion order)', () => {
    const shuffled = [7, 3, 10, 1, 5, 9, 4, 8, 2, 6];
    expect(percentile(shuffled, 0)).toBe(1);
    expect(percentile(shuffled, 0.5)).toBe(5);
    expect(percentile(shuffled, 0.75)).toBe(7);
    expect(percentile(shuffled, 1)).toBe(10);
  });

  it('does NOT mutate the caller array (defensive copy guard)', () => {
    // The most common percentile() regression: a maintainer "optimizes"
    // away the [...values] spread to save the allocation, then every
    // caller that re-uses the array gets back a silently sorted version.
    // This test catches that class of regression.
    const original = [7, 3, 10, 1, 5];
    const snapshot = [...original];
    percentile(original, 0.5);
    expect(original).toEqual(snapshot);
  });

  it('handles duplicate values correctly (no special-case for ties)', () => {
    expect(percentile([5, 5, 5, 5], 0.5)).toBe(5);
    expect(percentile([5, 5, 5, 5], 0.75)).toBe(5);
    expect(percentile([5, 5, 5, 5], 1)).toBe(5);
  });

  it('matches the known Phase A security-specialist token data', () => {
    // Real telemetry from the apps/pr-bot dogfood (PRs #104, #108, #109,
    // #110, #111). Confirms the de-duped util produces the same numbers
    // as the previous in-file copies — a regression here would silently
    // shift every per-tool default the next tuning PR derives.
    const sorted = [43000, 46000, 49000, 51000, 67000];
    expect(percentile(sorted, 0.5)).toBe(49000);   // idx=floor(4*0.5)=2
    expect(percentile(sorted, 0.75)).toBe(51000);  // idx=floor(4*0.75)=3
    expect(percentile(sorted, 0.95)).toBe(51000);  // idx=floor(3.8)=3 — known nearest-rank cap on small samples
    expect(percentile(sorted, 1)).toBe(67000);
  });
});

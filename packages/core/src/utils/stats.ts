/**
 * Shared statistics utilities.
 *
 * Today: one function, `percentile()`. The de-dup target for ARCH-135-2
 * from PR #135's dogfood — the same nearest-rank percentile was
 * previously declared twice (in `packages/core/src/budget/budgetStats.ts`
 * and `apps/pr-bot/scripts/aggregate-telemetry.ts`). Both files are the
 * canonical p75 math for ctxloom telemetry; a bugfix in one was
 * silently a bugfix-debt in the other.
 *
 * Both call sites now import from here. The function is small enough
 * to fit in a single file; if more stats utilities accumulate they
 * stay co-located here rather than fanning out.
 */

/**
 * Compute the p-th percentile of a number array using nearest-rank
 * (no interpolation — the value returned is always a real element of
 * the input). `p` is in [0, 1].
 *
 * Contract:
 *   - Empty input → null
 *   - Single element → that element regardless of p
 *   - Does NOT mutate the input array (uses a sorted copy)
 *   - p = 0 → minimum
 *   - p = 1 → maximum
 *   - Intermediate p uses `floor((n - 1) * p)` as the index
 *
 * This is the load-bearing math for Phase B (#106) per-tool default
 * budgets AND for the pr-bot dogfood-telemetry aggregation. An
 * off-by-one or sort-mutation bug here silently corrupts every
 * downstream budget/tuning decision. Test coverage in
 * tests/PercentileStats.test.ts is mandatory — two consumers depend
 * on it.
 *
 * @public
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

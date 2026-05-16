/**
 * TelemetryRow schema — single source of truth.
 *
 * Used by:
 *   - apps/pr-bot/scripts/extract-budget-telemetry.ts (writer)
 *   - apps/pr-bot/scripts/aggregate-telemetry.ts     (reader)
 *   - apps/pr-bot/tests/dogfood-telemetry-data.test.ts (contract test)
 *   - apps/pr-bot/data/README.md                     (linked schema doc)
 *
 * Closes the converged-high finding from PR #114 dogfood
 * (ARCH-114-1 + TEST-114-6): the interface was previously declared
 * verbatim in both scripts AND described separately in markdown,
 * giving three sources of truth that could silently drift.
 */
import { z } from 'zod';

/**
 * Per-specialist token counts. Null where the early reviews didn't
 * surface a per-specialist breakdown (only an aggregate `**Total**` row).
 */
export const SpecialistTokensSchema = z.object({
  security: z.number().int().nonnegative().nullable(),
  architecture: z.number().int().nonnegative().nullable(),
  testing: z.number().int().nonnegative().nullable(),
  performance: z.number().int().nonnegative().nullable(),
});
export type SpecialistTokens = z.infer<typeof SpecialistTokensSchema>;

export const SpecialistNames = ['security', 'architecture', 'testing', 'performance'] as const;
export type SpecialistName = (typeof SpecialistNames)[number];

export const SeverityCountsSchema = z.object({
  critical: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
});
export type SeverityCounts = z.infer<typeof SeverityCountsSchema>;

export const TierDistributionSchema = z.object({
  T0: z.number().int().nonnegative(),
  T1: z.number().int().nonnegative(),
  T2: z.number().int().nonnegative(),
  T3: z.number().int().nonnegative(),
});
export type TierDistribution = z.infer<typeof TierDistributionSchema>;

/**
 * Telemetry source quality. Determines confidence in downstream
 * statistics: `machine-block` (orchestrator-emitted, full granularity)
 * > `markdown-table` (table scraped, per-specialist available)
 * > `incomplete` (only aggregate Total available, or partially missing).
 */
export const TelemetrySourceSchema = z.enum(['machine-block', 'markdown-table', 'incomplete']);
export type TelemetrySource = z.infer<typeof TelemetrySourceSchema>;

export const VerdictSchema = z.enum(['approve', 'approve_with_nits', 'needs_changes', 'unknown']);
export type Verdict = z.infer<typeof VerdictSchema>;

export const TelemetryRowSchema = z.object({
  /** GitHub PR number */
  pr: z.number().int().positive(),
  title: z.string(),
  /** Direct link to the AI review comment */
  url: z.string().url(),
  /** ISO-8601 timestamp the comment was posted (matches GitHub's createdAt) */
  posted_at: z.string().datetime({ offset: true }),

  specialists: SpecialistTokensSchema,
  /** Sum of non-null specialist values, OR the `**Total**` row when per-specialist absent. */
  total_specialist_tokens: z.number().int().nonnegative(),

  verdict: VerdictSchema,
  severity_counts: SeverityCountsSchema,

  /** Null when the review didn't surface a tier distribution. */
  tier_distribution: TierDistributionSchema.nullable(),
  full_file_reads: z.number().int().nonnegative().nullable(),

  source: TelemetrySourceSchema,
});
export type TelemetryRow = z.infer<typeof TelemetryRowSchema>;

/**
 * Parse a JSONL line into a `TelemetryRow`. Throws a clear error if
 * the line is invalid JSON or fails schema validation — used by
 * `aggregate-telemetry.ts` for fail-loud reading instead of silent
 * type-cast (`JSON.parse(line) as TelemetryRow`).
 */
export function parseTelemetryRow(line: string): TelemetryRow {
  const parsed: unknown = JSON.parse(line);
  return TelemetryRowSchema.parse(parsed);
}

/**
 * Phase A dogfood PRs — the historical record the extractor walks.
 *
 * Pinned because the backfill is a frozen historical artifact: re-running
 * the extractor on a closed PR's comment must produce the same output.
 * New reviews flow through the orchestrator's HTML-comment block, not
 * this list. Lives here (not in `scripts/`) so that contract tests and
 * future Phase B consumers can import it without pulling in `child_process`
 * or `fs` from the extractor module.
 */
export const PHASE_A_PRS = [102, 104, 108, 109, 110, 111, 113] as const;

/**
 * Aggregated statistics for a single specialist across all reviews.
 * Produced by `summarize()` in aggregate-telemetry.ts; consumed by
 * Phase B (#106) to derive per-tool default budgets from `.p75`.
 */
export interface PerSpecialistSummary {
  specialist: SpecialistName;
  n: number;
  min: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  max: number | null;
}

/**
 * Aggregate statistics across the sum-of-all-specialists per-review total.
 */
export interface AggregateSummary {
  n: number;
  min: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  max: number | null;
}

/**
 * Full dogfood summary shape — the contract between `aggregate-telemetry.ts`
 * (writer) and Phase B (#106) consumers (readers of `dogfood-summary.json`).
 */
export interface DogfoodSummary {
  rowCount: number;
  perSpecialist: PerSpecialistSummary[];
  aggregate: AggregateSummary;
  verdictCounts: Record<string, number>;
  severitySums: { critical: number; high: number; medium: number; low: number; info: number };
  tierTotals: { T0: number; T1: number; T2: number; T3: number };
  tierTotal: number;
}

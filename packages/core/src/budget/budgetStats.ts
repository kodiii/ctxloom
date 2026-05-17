/**
 * budgetStats.ts — per-tool aggregation of persisted budget events.
 *
 * Reads `mcp.budget.exceeded` and `mcp.fallback.used` events written
 * by eventCollector.appendEvent and produces the two summaries
 * `ctxloom budget-stats` renders:
 *
 *   1. Fallback distribution per tool (how often each tool fell
 *      back to skeleton vs truncated vs error)
 *   2. Original-token-count distribution per tool over breaches
 *      only — the input that re-derived per-tool default budgets
 *      will use
 *
 * Pure functions; no I/O. `readEvents` from eventCollector is the
 * only disk touch surface in this module's pipeline.
 */
import type { PersistedEvent } from './eventCollector.js';

/**
 * Compute the p-th percentile of a number array (nearest-rank, no
 * interpolation). Same shape as
 * apps/pr-bot/scripts/aggregate-telemetry.ts:percentile() — the
 * canonical p75 math across both telemetry pipelines.
 *
 * @public
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

/** One row of the "fallback distribution per tool" table. */
export interface FallbackRow {
  tool: string;
  breaches: number;
  skeletonPct: number;
  truncatePct: number;
  errorPct: number;
}

/** One row of the "original-token distribution per tool" table. */
export interface DistributionRow {
  tool: string;
  n: number;
  min: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  max: number | null;
}

export interface BudgetStatsSummary {
  windowStart: string;   // ISO-8601 (inclusive)
  windowEnd: string;     // ISO-8601 (inclusive)
  totalEvents: number;
  fallbackTable: FallbackRow[];
  distributionTable: DistributionRow[];
}

/**
 * Aggregate a flat event list into per-tool summary tables.
 *
 * Algorithm: bucket events by tool, then for each bucket compute:
 *   - fallback split = counts of `mcp.fallback.used` by `mode`
 *     ('skeleton', 'truncate', 'error'), normalized to percentages
 *   - distribution = percentile spread of `original_tokens` from
 *     `mcp.budget.exceeded` events only (those are the ones that
 *     would feed per-tool default re-derivation)
 *
 * Tools with zero events in the window are excluded from both tables
 * — sparse output is more useful than padded zeros across the 12-
 * tool surface.
 *
 * @public
 */
export function summarize(events: PersistedEvent[], windowStart: Date, windowEnd: Date): BudgetStatsSummary {
  const byTool = new Map<string, PersistedEvent[]>();
  for (const e of events) {
    const existing = byTool.get(e.tool);
    if (existing) existing.push(e);
    else byTool.set(e.tool, [e]);
  }

  const fallbackTable: FallbackRow[] = [];
  const distributionTable: DistributionRow[] = [];

  for (const [tool, bucket] of byTool) {
    // Fallback split — count by mode on mcp.fallback.used events.
    const fallbackUsed = bucket.filter((e) => e.event === 'mcp.fallback.used');
    if (fallbackUsed.length > 0) {
      let skeleton = 0, truncate = 0, error = 0;
      for (const e of fallbackUsed) {
        const mode = typeof e.mode === 'string' ? e.mode : '';
        if (mode === 'skeleton' || mode === 'skeleton+truncate') skeleton++;
        else if (mode === 'truncate' || mode === 'truncate-fallback') truncate++;
        else if (mode === 'error') error++;
      }
      const total = skeleton + truncate + error;
      if (total > 0) {
        fallbackTable.push({
          tool,
          breaches: fallbackUsed.length,
          skeletonPct: Math.round((skeleton / total) * 100),
          truncatePct: Math.round((truncate / total) * 100),
          errorPct: Math.round((error / total) * 100),
        });
      }
    }

    // Distribution — original_tokens from breaches only. Drop events
    // without a numeric original_tokens (malformed/old payload shape).
    const tokens = bucket
      .filter((e) => e.event === 'mcp.budget.exceeded')
      .map((e) => (typeof e.original_tokens === 'number' ? e.original_tokens : null))
      .filter((n): n is number => n !== null);
    if (tokens.length > 0) {
      distributionTable.push({
        tool,
        n: tokens.length,
        min: Math.min(...tokens),
        p50: percentile(tokens, 0.5),
        p75: percentile(tokens, 0.75),
        p95: percentile(tokens, 0.95),
        max: Math.max(...tokens),
      });
    }
  }

  // Stable alphabetical sort so the rendered table is deterministic
  // across runs (matters for diff-based screenshot tests later).
  fallbackTable.sort((a, b) => a.tool.localeCompare(b.tool));
  distributionTable.sort((a, b) => a.tool.localeCompare(b.tool));

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    totalEvents: events.length,
    fallbackTable,
    distributionTable,
  };
}

/**
 * Render a `BudgetStatsSummary` as human-readable text for the CLI.
 * Two markdown-style tables plus a header line. Extracted so the CLI
 * command is a thin wrapper and the renderer can be tested in
 * isolation.
 *
 * @public
 */
export function renderSummary(s: BudgetStatsSummary): string {
  const lines: string[] = [];
  const startDate = s.windowStart.slice(0, 10);
  const endDate = s.windowEnd.slice(0, 10);
  lines.push(`Budget event summary (${startDate} → ${endDate}, ${s.totalEvents} events)`);
  lines.push('');

  if (s.totalEvents === 0) {
    lines.push('No events in window. Either:');
    lines.push('  - No budget breaches occurred (everything fit under budgets)');
    lines.push('  - CTXLOOM_TELEMETRY_LEVEL is not set to "full" in the MCP server\'s env');
    lines.push('  - No tool calls have opted into the budget surface yet');
    return lines.join('\n');
  }

  lines.push('Fallback distribution per tool');
  lines.push('');
  if (s.fallbackTable.length === 0) {
    lines.push('  (no fallback events recorded in window)');
  } else {
    lines.push('| Tool                       | Breaches | Skeleton % | Truncate % | Error % |');
    lines.push('|----------------------------|---------:|-----------:|-----------:|--------:|');
    for (const r of s.fallbackTable) {
      lines.push(
        `| ${r.tool.padEnd(26)} | ${String(r.breaches).padStart(8)} | ${String(r.skeletonPct).padStart(9)}% | ${String(r.truncatePct).padStart(9)}% | ${String(r.errorPct).padStart(6)}% |`,
      );
    }
  }
  lines.push('');

  lines.push('Original-token distribution per tool (over-budget calls only)');
  lines.push('');
  if (s.distributionTable.length === 0) {
    lines.push('  (no budget-breach events recorded in window)');
  } else {
    lines.push('| Tool                       |   n |    min |    p50 |    p75 |    p95 |    max |');
    lines.push('|----------------------------|----:|-------:|-------:|-------:|-------:|-------:|');
    for (const r of s.distributionTable) {
      lines.push(
        `| ${r.tool.padEnd(26)} | ${String(r.n).padStart(3)} | ${fmt(r.min)} | ${fmt(r.p50)} | ${fmt(r.p75)} | ${fmt(r.p95)} | ${fmt(r.max)} |`,
      );
    }
    lines.push('');
    lines.push('The **p75** column is the input for per-tool default budget tuning');
    lines.push('(packages/core/src/tools/*.ts → DEFAULT_MAX_RESPONSE_TOKENS).');
  }

  return lines.join('\n');
}

function fmt(n: number | null): string {
  return n === null ? '     —' : String(n).padStart(6);
}

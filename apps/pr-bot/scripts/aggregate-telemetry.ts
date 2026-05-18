#!/usr/bin/env tsx
/**
 * aggregate-telemetry.ts — Summarize dogfood-telemetry.jsonl into
 * per-specialist + per-tier statistics that inform Phase B (#106)
 * default budgets.
 *
 * Produces a human-readable report on stdout AND writes a machine-
 * readable JSON summary to `apps/pr-bot/data/dogfood-summary.json`
 * for downstream tooling.
 *
 * Closes Issue #112 (Part 3 — aggregation script).
 *
 * Test coverage:
 *   apps/pr-bot/tests/telemetry-aggregate.test.ts (percentile() unit
 *   tests with edge cases — closes TEST-114-2 from PR #114 dogfood,
 *   since this function produces the p75 budgets Phase B wires into
 *   every per-tool default).
 *
 * Usage:
 *   tsx apps/pr-bot/scripts/aggregate-telemetry.ts
 *
 * Outputs:
 *   stdout: human-readable per-specialist + per-tier breakdown
 *   apps/pr-bot/data/dogfood-summary.json: machine-readable summary
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SpecialistNames,
  parseTelemetryRow,
  type AggregateSummary,
  type DogfoodSummary,
  type PerSpecialistSummary,
  type TelemetryRow,
} from '../src/telemetry/schema.js';
// Relative cross-package import (rather than `@ctxloom/core/utils/stats`)
// because @ctxloom/core's `exports` field only exposes the root entry.
// The two-up `../../..` resolves to the repo root, then into the
// workspace package. Same shape as how the pr-bot tests reach into
// `../../../packages/core/...`.
import { percentile } from '../../../packages/core/src/utils/stats.js';

export type { DogfoodSummary, PerSpecialistSummary, AggregateSummary };
// Re-export so existing tests/consumers that import percentile from
// aggregate-telemetry keep working. ARCH-135-2 dogfood finding (PR
// #135) consolidated the previous duplicate; the function now lives
// in packages/core/src/utils/stats.ts.
export { percentile };

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const DATA_DIR = join(REPO_ROOT, 'apps', 'pr-bot', 'data');
const IN_FILE = join(DATA_DIR, 'dogfood-telemetry.jsonl');
const OUT_FILE = join(DATA_DIR, 'dogfood-summary.json');

// percentile() was historically declared here. Consolidated in PR
// #135 dogfood follow-up (ARCH-135-2) to packages/core/src/utils/stats.ts
// and re-exported above for backward-compat with existing test imports.

function loadRows(): TelemetryRow[] {
  const text = readFileSync(IN_FILE, 'utf8');
  // parseTelemetryRow validates against the Zod schema — a malformed
  // row (renamed field, wrong shape, etc.) throws with a clear
  // ZodError naming the failing field, instead of silently casting
  // garbage that produces NaN p75 downstream.
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map(parseTelemetryRow);
}

/**
 * Build the summary from a set of telemetry rows.
 *
 * @public Exported for unit testing.
 */
export function summarize(rows: TelemetryRow[]): DogfoodSummary {
  const perSpecialist: PerSpecialistSummary[] = SpecialistNames.map((sp) => {
    const samples = rows
      .map((r) => r.specialists[sp])
      .filter((v): v is number => v !== null);
    return {
      specialist: sp,
      n: samples.length,
      min: samples.length ? Math.min(...samples) : null,
      p50: percentile(samples, 0.5),
      p75: percentile(samples, 0.75),
      p95: percentile(samples, 0.95),
      max: samples.length ? Math.max(...samples) : null,
    };
  });

  const totals = rows.map((r) => r.total_specialist_tokens).filter((v) => v > 0);
  const aggregate: AggregateSummary = {
    n: totals.length,
    min: totals.length ? Math.min(...totals) : null,
    p50: percentile(totals, 0.5),
    p75: percentile(totals, 0.75),
    p95: percentile(totals, 0.95),
    max: totals.length ? Math.max(...totals) : null,
  };

  const verdictCounts: Record<string, number> = {};
  for (const row of rows) {
    verdictCounts[row.verdict] = (verdictCounts[row.verdict] ?? 0) + 1;
  }

  const severitySums = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const row of rows) {
    for (const sev of ['critical', 'high', 'medium', 'low', 'info'] as const) {
      severitySums[sev] += row.severity_counts[sev];
    }
  }

  const tierRows = rows.filter((r) => r.tier_distribution !== null);
  const tierTotals = { T0: 0, T1: 0, T2: 0, T3: 0 };
  for (const row of tierRows) {
    if (!row.tier_distribution) continue;
    for (const t of ['T0', 'T1', 'T2', 'T3'] as const) {
      tierTotals[t] += row.tier_distribution[t];
    }
  }
  const tierTotal = Object.values(tierTotals).reduce((a, b) => a + b, 0);

  return { perSpecialist, aggregate, verdictCounts, severitySums, tierTotals, tierTotal, rowCount: rows.length };
}

function fmtK(v: number | null): string {
  return v === null ? '—' : `${(v / 1000).toFixed(1)}k`;
}

function renderReport(s: DogfoodSummary): string {
  const lines: string[] = [];
  lines.push('# Dogfood Telemetry Summary');
  lines.push('');
  lines.push(`Total reviews analyzed: **${s.rowCount}**`);
  lines.push('');
  lines.push('## Per-specialist token usage (informs Phase B.4 defaults)');
  lines.push('');
  lines.push('| Specialist | n | min | p50 | **p75** | p95 | max |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of s.perSpecialist) {
    lines.push(`| ${r.specialist} | ${r.n} | ${fmtK(r.min)} | ${fmtK(r.p50)} | **${fmtK(r.p75)}** | ${fmtK(r.p95)} | ${fmtK(r.max)} |`);
  }
  lines.push('');
  lines.push(`**Aggregate total (all 4 specialists combined):**`);
  lines.push(`n=${s.aggregate.n}, min=${fmtK(s.aggregate.min)}, p50=${fmtK(s.aggregate.p50)}, **p75=${fmtK(s.aggregate.p75)}**, p95=${fmtK(s.aggregate.p95)}, max=${fmtK(s.aggregate.max)}`);
  lines.push('');
  lines.push('## Verdict distribution');
  lines.push('');
  for (const [v, n] of Object.entries(s.verdictCounts)) lines.push(`- ${v}: ${n}`);
  lines.push('');
  lines.push('## Severity counts (sum across all reviews)');
  lines.push('');
  for (const sev of ['critical', 'high', 'medium', 'low', 'info'] as const) {
    lines.push(`- ${sev}: ${s.severitySums[sev]}`);
  }
  lines.push('');
  lines.push('## Tier distribution (where reported)');
  lines.push('');
  if (s.tierTotal === 0) {
    lines.push('_No tier distribution data — needs orchestrator to emit machine-block telemetry going forward._');
  } else {
    for (const t of ['T0', 'T1', 'T2', 'T3'] as const) {
      const pct = ((s.tierTotals[t] / s.tierTotal) * 100).toFixed(1);
      lines.push(`- ${t}: ${s.tierTotals[t]} calls (${pct}%)`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function main(): void {
  const rows = loadRows();
  const summary = summarize(rows);
  const report = renderReport(summary);
  process.stdout.write(report);
  writeFileSync(OUT_FILE, JSON.stringify(summary, null, 2) + '\n');
  console.error(`\nMachine-readable summary written to ${OUT_FILE}`);
}

// Only run main() when invoked as a script, not when imported by tests.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}

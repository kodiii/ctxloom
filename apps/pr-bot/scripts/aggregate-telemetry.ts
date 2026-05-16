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

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const DATA_DIR = join(REPO_ROOT, 'apps', 'pr-bot', 'data');
const IN_FILE = join(DATA_DIR, 'dogfood-telemetry.jsonl');
const OUT_FILE = join(DATA_DIR, 'dogfood-summary.json');

type SpecialistName = 'security' | 'architecture' | 'testing' | 'performance';
const SPECIALISTS: SpecialistName[] = ['security', 'architecture', 'testing', 'performance'];

interface TelemetryRow {
  pr: number;
  title: string;
  posted_at: string;
  specialists: Record<SpecialistName, number | null>;
  total_specialist_tokens: number;
  verdict: string;
  severity_counts: { critical: number; high: number; medium: number; low: number; info: number };
  tier_distribution: { T0: number; T1: number; T2: number; T3: number } | null;
  full_file_reads: number | null;
  source: string;
}

/** Sample N values with at least M present → return percentile p ∈ [0, 1]. */
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

function loadRows(): TelemetryRow[] {
  const text = readFileSync(IN_FILE, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TelemetryRow);
}

function summarize(rows: TelemetryRow[]) {
  const perSpecialist = SPECIALISTS.map((sp) => {
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
  const aggregate = {
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

function renderReport(s: ReturnType<typeof summarize>): string {
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
    const fmt = (v: number | null) => (v === null ? '—' : `${(v / 1000).toFixed(1)}k`);
    lines.push(`| ${r.specialist} | ${r.n} | ${fmt(r.min)} | ${fmt(r.p50)} | **${fmt(r.p75)}** | ${fmt(r.p95)} | ${fmt(r.max)} |`);
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

function fmtK(v: number | null): string {
  return v === null ? '—' : `${(v / 1000).toFixed(1)}k`;
}

function main(): void {
  const rows = loadRows();
  const summary = summarize(rows);
  const report = renderReport(summary);
  process.stdout.write(report);
  writeFileSync(OUT_FILE, JSON.stringify(summary, null, 2) + '\n');
  console.error(`\nMachine-readable summary written to ${OUT_FILE}`);
}

main();

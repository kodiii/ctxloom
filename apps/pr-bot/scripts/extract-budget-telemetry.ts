#!/usr/bin/env tsx
/**
 * extract-budget-telemetry.ts — Backfill telemetry from the AI review
 * comments accumulated across the Phase A dogfood cycles.
 *
 * Phase A (PRs #102, #104, #108, #109, #110, #111, #113) accumulated
 * 9 rounds of multi-agent AI review comments. Each comment contains
 * a token-budget table (per-specialist token counts), a verdict +
 * severity profile, and sometimes a tier distribution. That data was
 * markdown-locked — never parsed, never aggregated, never fed back
 * into Phase B's per-tool default budgets.
 *
 * This script unlocks it.
 *
 * It uses `gh` CLI to fetch every AI review comment from a hard-coded
 * list of PRs (the Phase A dogfood set), parses the structured data
 * with anchored regexes, and writes one JSON line per PR to
 * `apps/pr-bot/data/dogfood-telemetry.jsonl`. The aggregate script
 * (`aggregate-telemetry.ts`) consumes that file for per-specialist
 * p50/p75/p95 statistics that inform Phase B (#106) default budgets.
 *
 * The same parsing logic also supports the live-capture path: future
 * orchestrator reviews emit a machine-readable
 * `<!-- ctxloom-telemetry: {...} -->` HTML-comment block that this
 * script reads in preference to the human-readable table when present.
 *
 * Closes Issue #112 (Part 1 — backfill from existing comments).
 *
 * Test coverage:
 *   apps/pr-bot/tests/telemetry-parsers.test.ts
 *
 * Every parser below is `export`ed so the tests can pin them with
 * synthetic fixtures (closes TEST-114-1 + TEST-114-3 from PR #114
 * dogfood — pure functions deserve unit tests, and the 3 bugs caught
 * during the original implementation now have permanent regression
 * coverage).
 *
 * Usage:
 *   tsx apps/pr-bot/scripts/extract-budget-telemetry.ts
 *
 * Output:
 *   apps/pr-bot/data/dogfood-telemetry.jsonl  (one row per PR)
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SpecialistNames,
  TelemetryRowSchema,
  type SpecialistName,
  type SpecialistTokens,
  type TelemetryRow,
  type Verdict,
} from '../src/telemetry/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const DATA_DIR = join(REPO_ROOT, 'apps', 'pr-bot', 'data');
const OUT_FILE = join(DATA_DIR, 'dogfood-telemetry.jsonl');

/**
 * Phase A dogfood PRs. Pinned because the backfill is a historical
 * record — adding new PRs to this list rewrites historical data
 * which is not the intent. New reviews flow through the
 * orchestrator's HTML-comment block, not this list.
 */
export const PHASE_A_PRS = [102, 104, 108, 109, 110, 111, 113] as const;

interface PrComment {
  id: string;
  author: { login: string };
  body: string;
  createdAt: string;
  url: string;
}

interface PrView {
  number: number;
  title: string;
  comments: PrComment[];
}

/**
 * Fetch all comments on a PR via gh CLI. Returns the AI review
 * comment (one whose body starts with `# 🤖 ctxloom AI Review`)
 * or null if none.
 */
function fetchAiReviewComment(pr: number): { comment: PrComment; title: string } | null {
  const json = execSync(
    `gh pr view ${pr} --repo kodiii/ctxloom --json number,title,comments`,
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );
  const data: PrView = JSON.parse(json);
  const aiComment = data.comments.find((c) => c.body.startsWith('# 🤖 ctxloom AI Review'));
  if (!aiComment) return null;
  return { comment: aiComment, title: data.title };
}

/**
 * Parse a token value like "63k" or "~218k" or "**43k**" into a number.
 * Returns null if the cell is blank, n/a, or unrecognized.
 *
 * @public Exported for unit testing.
 */
export function parseTokenCell(raw: string): number | null {
  const cleaned = raw.replace(/[*~`\s|]/g, '');
  if (!cleaned || cleaned.toLowerCase() === 'n/a' || cleaned.toLowerCase() === 'tbd') return null;
  const m = cleaned.match(/^(\d+(?:\.\d+)?)k$/i);
  if (m) return Math.round(parseFloat(m[1]) * 1000);
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract per-specialist token counts from the markdown table.
 * Each row looks like:
 *   | 🔒 security | 63k | 67k | 49k | 46k | 51k | **43k** |
 * Some tables (PR #108-style) have a trailing "Δ vs ..." percentage
 * column. We scan right-to-left for the first cell that parses as a
 * token value, so the delta column is correctly skipped.
 *
 * @public Exported for unit testing.
 */
export function extractSpecialistTokensFromTable(body: string): SpecialistTokens {
  const tokens: SpecialistTokens = {
    security: null,
    architecture: null,
    testing: null,
    performance: null,
  };
  const rowPatterns: Record<SpecialistName, RegExp> = {
    security:    /^\|\s*🔒\s*security\s*\|(.+)\|\s*$/m,
    architecture:/^\|\s*🏛\s*architecture\s*\|(.+)\|\s*$/m,
    testing:     /^\|\s*🧪\s*testing\s*\|(.+)\|\s*$/m,
    performance: /^\|\s*⚡\s*performance\s*\|(.+)\|\s*$/m,
  };
  for (const sp of SpecialistNames) {
    const m = body.match(rowPatterns[sp]);
    if (!m) continue;
    const cells = m[1].split('|').map((c) => c.trim()).filter((c) => c.length > 0);
    // Scan right-to-left for the first cell that parses as a token.
    // Regression guard from PR #114 dogfood: a naïve `cells[length-1]`
    // takes the trailing "Δ vs ..." column on PR #108-era tables.
    for (let i = cells.length - 1; i >= 0; i--) {
      const v = parseTokenCell(cells[i]);
      if (v !== null) {
        tokens[sp] = v;
        break;
      }
    }
  }
  return tokens;
}

/**
 * Fallback for compact reviews that only print a `**Total**` (or
 * `**Specialists total**`) row without per-specialist breakdown.
 * Used when extractSpecialistTokensFromTable returns all-nulls but
 * the aggregate is still parseable — gives Phase B partial signal.
 *
 * @public Exported for unit testing.
 */
export function extractTotalFromTable(body: string): number | null {
  const re = /^\|\s*\*\*(?:Specialists\s*total|Total)\*\*\s*\|(.+)\|\s*$/m;
  const m = body.match(re);
  if (!m) return null;
  const cells = m[1].split('|').map((c) => c.trim()).filter((c) => c.length > 0);
  if (cells.length === 0) return null;
  // Right-to-left scan, same regression guard as the specialist rows.
  for (let i = cells.length - 1; i >= 0; i--) {
    const v = parseTokenCell(cells[i]);
    if (v !== null) return v;
  }
  return null;
}

/**
 * Fallback for the earliest reviews (PRs #102 / #104 / #108) that
 * reported token usage as inline prose like:
 *   - security: 63k
 *   - architecture: 54k
 * rather than a markdown table.
 *
 * @public Exported for unit testing.
 */
export function extractSpecialistTokensFromProse(body: string): SpecialistTokens {
  const tokens: SpecialistTokens = {
    security: null,
    architecture: null,
    testing: null,
    performance: null,
  };
  for (const sp of SpecialistNames) {
    const re = new RegExp(`^[-*\\s]*(?:🔒|🏛|🧪|⚡)?\\s*${sp}\\s*:\\s*([0-9.]+k)\\b`, 'im');
    const m = body.match(re);
    if (m) tokens[sp] = parseTokenCell(m[1]);
  }
  return tokens;
}

/**
 * Parse the Verdict line. Examples:
 *   **Verdict: 🟡 Approve with nits — 1 medium, 4 low, 6 info**
 *   **Verdict: 🔴 Needs changes — 1 critical / 3 high / 7 medium / 7 low**
 *   **Verdict: 🟢 Approve — no blockers**
 *
 * Regression guard from PR #114 dogfood: "no blockers" is a POSITIVE
 * signal but contains substring "block". The original implementation
 * false-matched it as `needs_changes`. The current implementation
 * uses `\b` word boundaries and an explicit "no blockers" override.
 *
 * @public Exported for unit testing.
 */
export function extractVerdictAndSeverity(body: string): {
  verdict: Verdict;
  severity_counts: TelemetryRow['severity_counts'];
} {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const verdictMatch = body.match(/\*\*Verdict:\s*[^*]+\*\*/);
  if (!verdictMatch) return { verdict: 'unknown', severity_counts: counts };
  const line = verdictMatch[0].toLowerCase();

  let verdict: Verdict = 'unknown';
  const isNegative = line.includes('needs changes') ||
    (/\b(?:reject|block(?:er|ing)?)\b/.test(line) && !line.includes('no blocker'));
  if (isNegative) verdict = 'needs_changes';
  else if (line.includes('approve') && (line.includes('nit') || line.includes('upgraded') || line.includes('with one') || line.includes('with 2 medium'))) verdict = 'approve_with_nits';
  else if (line.includes('approve')) verdict = 'approve';

  for (const sev of ['critical', 'high', 'medium', 'low', 'info'] as const) {
    const re = new RegExp(`(\\d+)\\s*${sev}`, 'i');
    const m = line.match(re);
    if (m) counts[sev] = parseInt(m[1], 10);
  }
  return { verdict, severity_counts: counts };
}

/**
 * Extract tier distribution from sections like:
 *   - T0 structural: 5 calls
 *   - T1 skeleton: 0 calls
 *   - T2 definition: 0 calls
 *   - T3 full file: 1 call
 *
 * @public Exported for unit testing.
 */
export function extractTierDistribution(
  body: string,
): { dist: TelemetryRow['tier_distribution']; full_file_reads: number | null } {
  const dist = { T0: 0, T1: 0, T2: 0, T3: 0 };
  let found = false;
  for (const tier of ['T0', 'T1', 'T2', 'T3'] as const) {
    const re = new RegExp(`-?\\s*\\*?\\*?${tier}[^:]*:\\*?\\*?\\s*(\\d+)\\s*calls?`, 'i');
    const m = body.match(re);
    if (m) {
      dist[tier] = parseInt(m[1], 10);
      found = true;
    }
  }
  let full_file_reads: number | null = null;
  // Allow markdown bold on either the label OR the value, with optional
  // whitespace anywhere. Real-world formats:
  //   "Full-file reads: 1"
  //   "**Full-file reads:** 1"          ← caught by tests, was previously broken
  //   "- **Full-file reads:** **6**"
  const ffr = body.match(/full[- ]file reads?:\*{0,2}\s*\*{0,2}(\d+)/i);
  if (ffr) full_file_reads = parseInt(ffr[1], 10);
  return { dist: found ? dist : null, full_file_reads };
}

/**
 * Preferred path: parse the LAST `<!-- ctxloom-telemetry: { ... } -->`
 * block in the comment. Falls back to markdown-table scraping if no
 * block is present.
 *
 * Closes ARCH-114-2 from PR #114 dogfood: the original implementation
 * used `body.match(...)` which returns the FIRST match — if the
 * orchestrator emits a second block on re-runs, stale earlier values
 * would win. `matchAll().at(-1)` correctly returns the most recent.
 *
 * @public Exported for unit testing.
 */
export function extractMachineBlock(body: string): Partial<TelemetryRow> | null {
  const matches = [...body.matchAll(/<!--\s*ctxloom-telemetry:\s*(\{[\s\S]*?\})\s*-->/g)];
  const last = matches.at(-1);
  if (!last) return null;
  try {
    return JSON.parse(last[1]);
  } catch {
    return null;
  }
}

export function extractRowFromComment(pr: number, comment: PrComment, title: string): TelemetryRow {
  const body = comment.body;

  // Preferred: machine block (forward-compatible)
  const machine = extractMachineBlock(body);
  if (machine) {
    const merged = {
      pr,
      title,
      url: comment.url,
      posted_at: comment.createdAt,
      specialists: { security: null, architecture: null, testing: null, performance: null },
      total_specialist_tokens: 0,
      verdict: 'unknown' as Verdict,
      severity_counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      tier_distribution: null,
      full_file_reads: null,
      source: 'machine-block' as const,
      ...machine,
    };
    return TelemetryRowSchema.parse(merged);
  }

  // Fallback chain:
  //   1. Per-specialist table rows (best — full breakdown)
  //   2. Per-specialist prose ("security: 63k") in early reviews
  //   3. Total row only (compact reviews like PR #113)
  let specialists = extractSpecialistTokensFromTable(body);
  let allMissing = SpecialistNames.every((sp) => specialists[sp] === null);
  if (allMissing) {
    specialists = extractSpecialistTokensFromProse(body);
    allMissing = SpecialistNames.every((sp) => specialists[sp] === null);
  }
  const fromSpecialists = SpecialistNames.reduce((sum, sp) => sum + (specialists[sp] ?? 0), 0);
  const fromTotalRow = extractTotalFromTable(body);
  const total = fromSpecialists > 0 ? fromSpecialists : (fromTotalRow ?? 0);

  const { verdict, severity_counts } = extractVerdictAndSeverity(body);
  const { dist, full_file_reads } = extractTierDistribution(body);

  const someSpecialistMissing = SpecialistNames.some((sp) => specialists[sp] === null);

  return {
    pr,
    title,
    url: comment.url,
    posted_at: comment.createdAt,
    specialists,
    total_specialist_tokens: total,
    verdict,
    severity_counts,
    tier_distribution: dist,
    full_file_reads,
    source: someSpecialistMissing ? 'incomplete' : 'markdown-table',
  };
}

async function main(): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });
  const rows: TelemetryRow[] = [];

  for (const pr of PHASE_A_PRS) {
    process.stdout.write(`PR #${pr}... `);
    const found = fetchAiReviewComment(pr);
    if (!found) {
      console.log('no AI review comment found, skipping');
      continue;
    }
    const row = extractRowFromComment(pr, found.comment, found.title);
    rows.push(row);
    console.log(
      `${row.source} · ${row.total_specialist_tokens || '?'} tokens · verdict=${row.verdict}`,
    );
  }

  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  writeFileSync(OUT_FILE, jsonl);
  console.log(`\nWrote ${rows.length} rows → ${OUT_FILE}`);
}

// Only run main() when invoked as a script, not when imported by tests.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

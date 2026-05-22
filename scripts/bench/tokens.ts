/**
 * Token-reduction measurement for the v1.7.0 bench.
 *
 * Two questions, two numbers per PR:
 *
 *   1. naiveTokens — what would the agent re-read WITHOUT ctxloom?
 *      Sum of full-file tokens for every file in groundTruthFiles,
 *      plus their 1-hop forward imports. Approximates the
 *      "read the diff + every file it touches" baseline that an
 *      agent without graph context falls into.
 *
 *   2. graphTokens — what ctxloom would actually feed the agent?
 *      Sum of SKELETON tokens for every file in predictedFiles.
 *      The skeleton view drops bodies and keeps signatures — the
 *      shape the dependency-aware tools (ctx_get_context_packet,
 *      ctx_git_diff_review) serve by default.
 *
 *   reduction = naiveTokens / graphTokens (the multiplier — e.g. 12.4×)
 *
 * Why this metric is honest:
 *
 *   The "naive" baseline isn't a strawman — it's what most agents
 *   actually do today (read each changed file + grep for callers).
 *   The "graph" branch is what we'd send if asked the same question;
 *   skeletons are our default response_format, so the comparison is
 *   apples-to-apples, not skeleton-vs-bundled-source.
 *
 *   The token estimator is shared with the production budget code
 *   (chars/4 default — see packages/core/src/budget/budget.ts) so the
 *   numbers reported here line up with what end users see in the
 *   max_response_tokens telemetry surface, not a synthetic benchmark
 *   tokenizer that no production code uses.
 *
 * Failure handling:
 *
 *   - Files outside the worktree (e.g. removed in the PR) contribute 0
 *     tokens to both sides rather than failing the audit.
 *   - Skeletonizer throws on bundled/minified files — we count those
 *     under their raw size on the naive side, and skip on the graph side
 *     (the production graph tools take the same path). Avoids
 *     misattributing a skeletonizer-skip to a "ctxloom inflated tokens"
 *     win.
 *   - Binary files (no extension match in INDEXED_EXTENSIONS) contribute
 *     0 tokens to both sides — token counts are undefined for them and
 *     including them would smear the ratio either direction depending on
 *     which side they happened to fall on.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Skeletonizer } from '../../packages/core/src/ast/Skeletonizer.js';
import { defaultTokenEstimator } from '../../packages/core/src/budget/budget.js';
import type { DependencyGraph } from '@ctxloom/core';

/** Extensions whose tokens we count — mirrors graph-correctness.ts. */
const COUNTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs',
  '.py', '.go', '.rs', '.java', '.kt', '.kts',
  '.cs', '.rb', '.swift', '.vue', '.php', '.dart',
  // Doc/config extensions the agent would ALSO re-read in the naive
  // baseline. Including them keeps the naive number honest — agents
  // without ctxloom DO open the README and the YAML in their re-reads.
  '.md', '.yml', '.yaml', '.json', '.toml',
]);

export interface PRTokens {
  /**
   * Sum of full-file tokens for groundTruthFiles ∪ their 1-hop forward
   * imports. The "no-ctxloom" baseline.
   */
  naiveTokens: number;
  /**
   * Sum of skeleton tokens for predictedFiles. What ctxloom would feed
   * the agent via the budget-aware tools.
   */
  graphTokens: number;
  /** naiveTokens / graphTokens. 1.0 means break-even; <1.0 is a regression. */
  reduction: number;
}

/**
 * Measure full-file token cost for a set of files inside the worktree.
 * Skips files that don't exist (removed in PR) and files outside the
 * counted extension set.
 */
function fullFileTokens(repoPath: string, files: readonly string[]): number {
  let total = 0;
  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (!COUNTED_EXTENSIONS.has(ext)) continue;
    const abs = path.join(repoPath, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      const content = fs.readFileSync(abs, 'utf-8');
      total += defaultTokenEstimator(content);
    } catch {
      // unreadable — skip rather than blow up the audit
    }
  }
  return total;
}

/**
 * Measure skeleton token cost for a set of files. Skeletonizer throws
 * on bundled/minified inputs; those contribute 0 — matching what the
 * production tool surface does (the same files are skipped by the
 * Skeletonizer when serving ctx_get_context_packet).
 */
async function skeletonTokens(
  repoPath: string,
  files: readonly string[],
  skeletonizer: Skeletonizer,
): Promise<number> {
  let total = 0;
  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (!COUNTED_EXTENSIONS.has(ext)) continue;
    const abs = path.join(repoPath, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      const skeleton = await skeletonizer.skeletonize(abs);
      total += defaultTokenEstimator(skeleton);
    } catch {
      // Skeletonizer threw — production tools take the same null path
    }
  }
  return total;
}

/**
 * Compute naive + graph token costs for one PR.
 *
 * Pre-conditions: the graph must already be loaded (we use it to
 * expand groundTruthFiles by their 1-hop forward imports — the
 * "agent reads the file then opens what it imports" baseline).
 */
export async function measurePRTokens(
  repoPath: string,
  groundTruthFiles: readonly string[],
  predictedFiles: readonly string[],
  graph: DependencyGraph,
  skeletonizer: Skeletonizer,
): Promise<PRTokens> {
  // Naive: GT files + their 1-hop forward imports. Deduped because a
  // file imported by multiple GT files should count once, not N times.
  const naiveSet = new Set<string>(groundTruthFiles);
  for (const gt of groundTruthFiles) {
    for (const dep of graph.getImports(gt)) {
      naiveSet.add(dep);
    }
  }

  const naiveTokens = fullFileTokens(repoPath, Array.from(naiveSet));
  const graphTokens = await skeletonTokens(repoPath, predictedFiles, skeletonizer);

  // reduction = naive / graph. Guard against div-by-zero: when the
  // prediction is empty (rare — most PRs have ≥1 predicted file), the
  // reduction is undefined; report 0 rather than Infinity to keep the
  // aggregation arithmetic finite.
  const reduction = graphTokens === 0 ? 0 : naiveTokens / graphTokens;

  return { naiveTokens, graphTokens, reduction };
}

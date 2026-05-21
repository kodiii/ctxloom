/**
 * Precision / recall / F1 — the only metric definitions in the whole
 * harness. Kept in one file so they can be unit-tested in isolation
 * (no I/O, no graph dependencies, pure functions).
 *
 * Methodology rationale (matches the public methodology doc):
 *
 * Each file in the repo is a binary classification:
 *   - TRUE  = file is in the ground-truth PR diff
 *   - FALSE = file is not
 *
 * The graph predicts a set of "affected" files. We compute:
 *
 *   true_positives  = |predicted ∩ ground_truth|
 *   false_positives = |predicted - ground_truth|
 *   false_negatives = |ground_truth - predicted|
 *
 *   precision = TP / (TP + FP)
 *   recall    = TP / (TP + FN)
 *   F1        = 2 * P * R / (P + R)
 *
 * Edge case: if both predicted and ground_truth are empty, precision
 * and recall are undefined. We treat this as F1=1.0 (the graph
 * correctly identified that no files are affected). This is unlikely
 * in practice — a merged PR always has ≥1 changed file.
 */
import type { Metrics } from './types.js';
import type { DependencyGraph } from '@ctxloom/core';

/**
 * Pure metric calculation. No I/O. No side effects. Easy to test.
 *
 * Computes the standard {TP, FP, FN, P, R, F1} against the full
 * ground truth AND a separate {sourceTruePositives, sourceRecall}
 * filtered through `isSourcePredicate`.
 *
 * Why two recall numbers: PRs often include unindexable files in
 * their diff — Markdown changelogs, YAML config, lockfiles, etc.
 * The graph can't possibly predict those, so counting them as
 * false negatives understates real graph quality. Reporting both
 * the total recall AND the source-file-only recall makes the
 * structural ceiling distinguishable from the graph-quality ceiling.
 *
 * Empirical example from the v1.6.0 spike: express #6903's ground
 * truth was {History.md, lib/application.js, test/app.render.js}.
 * Total recall = 2/3 = 0.67. Source-file recall = 2/2 = 1.00. The
 * graph found everything it could find; the missed file was a
 * changelog entry no dependency graph could predict.
 *
 * `isSourcePredicate` is INJECTED (not imported) so this module
 * stays pure — no fs/path dependency, trivial unit testing.
 */
export function computeMetrics(
  prNumber: number,
  groundTruth: readonly string[],
  predicted: readonly string[],
  isSourcePredicate: (filepath: string) => boolean,
): Metrics {
  const truthSet = new Set(groundTruth);
  const predictedSet = new Set(predicted);

  let truePositives = 0;
  for (const file of predictedSet) {
    if (truthSet.has(file)) truePositives++;
  }

  const falsePositives = predictedSet.size - truePositives;
  const falseNegatives = truthSet.size - truePositives;

  const precision = predictedSet.size === 0 ? 1 : truePositives / predictedSet.size;
  const recall = truthSet.size === 0 ? 1 : truePositives / truthSet.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  // Source-file-only recall. Denominator drops unindexable GT files;
  // numerator counts only TPs that are source files.
  const sourceTruth = [...truthSet].filter(isSourcePredicate);
  const sourceGroundTruthCount = sourceTruth.length;
  let sourceTruePositives = 0;
  for (const file of sourceTruth) {
    if (predictedSet.has(file)) sourceTruePositives++;
  }
  const sourceRecall =
    sourceGroundTruthCount === 0 ? 1 : sourceTruePositives / sourceGroundTruthCount;

  return {
    prNumber,
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1,
    sourceGroundTruthCount,
    sourceTruePositives,
    sourceRecall,
    // Populated by the caller after computeGraphReachability().
    // Defaulted here so the type stays satisfied; the bench eval
    // path always overwrites before reporting.
    graphReachable: 0,
    graphReachability: 0,
  };
}

/** Average a numeric field across a list — used in repo + overall rollups. */
export function avg(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Graph reachability — separate from prediction-algorithm recall.
 *
 * Answers: of the source-file ground-truth set, what fraction is
 * structurally connectable to the entry point via BFS over the
 * import graph (forward + reverse edges)?
 *
 * This isolates GRAPH COMPLETENESS from ALGORITHM QUALITY:
 *
 *   sourceRecall   = predict(entry) ∩ GT  → algorithm hit rate
 *   reachability  = bfs(entry) ∩ GT      → graph hit rate ceiling
 *
 * If reachability >> sourceRecall: algorithm is too conservative —
 *   the graph contains the right edges but we don't traverse far
 *   enough or rank/cap too tightly.
 *
 * If reachability ≈ sourceRecall: algorithm is doing the best the
 *   graph allows — improvement requires more / better edges.
 *
 * If reachability is itself low: the graph is missing edges —
 *   re-exports, dynamic imports, cross-package connections that
 *   the import resolver doesn't capture.
 *
 * Note: this uses the same import-graph the prediction draws from,
 * but the comparison stays honest because the ORACLE is still the
 * external merged PR diff. We're asking "is this PR file in the
 * graph's reach, regardless of how we'd rank it?" — not "does our
 * prediction match our own graph traversal" (the self-referential
 * pattern). Depth cap of 4 captures meaningful structural distance
 * without exploding into the full transitive closure.
 */
const REACHABILITY_DEPTH = 4;

export function computeGraphReachability(
  entryPoint: string,
  groundTruthSourceFiles: readonly string[],
  graph: DependencyGraph,
): { reachable: number; reachability: number } {
  const truth = new Set(groundTruthSourceFiles);
  const visited = new Set<string>([entryPoint]);
  let frontier = new Set<string>([entryPoint]);

  for (let depth = 0; depth < REACHABILITY_DEPTH; depth += 1) {
    const nextFrontier = new Set<string>();
    for (const file of frontier) {
      // Forward edges (files this one imports)
      for (const dep of graph.getImports(file)) {
        if (visited.has(dep)) continue;
        visited.add(dep);
        nextFrontier.add(dep);
      }
      // Reverse edges (files that import this one)
      for (const imp of graph.getImporters(file)) {
        if (visited.has(imp)) continue;
        visited.add(imp);
        nextFrontier.add(imp);
      }
    }
    if (nextFrontier.size === 0) break;
    frontier = nextFrontier;
  }

  let reachableInTruth = 0;
  for (const f of truth) {
    if (visited.has(f)) reachableInTruth += 1;
  }
  const reachability = truth.size === 0 ? 1 : reachableInTruth / truth.size;
  return { reachable: reachableInTruth, reachability };
}

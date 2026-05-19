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

/** Pure metric calculation. No I/O. No side effects. Easy to test. */
export function computeMetrics(
  prNumber: number,
  groundTruth: readonly string[],
  predicted: readonly string[],
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

  return {
    prNumber,
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1,
  };
}

/** Average a numeric field across a list — used in repo + overall rollups. */
export function avg(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

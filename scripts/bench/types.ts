/**
 * Type definitions for the v1.6.0 bench harness.
 *
 * Two-stage release:
 *   Stage A — spike on 2 repos (express, fastapi) to gate publication
 *   Stage B — full corpus (6 repos × 3 PRs each) if spike passes
 *
 * The spike re-uses the same harness; corpus.ts is the only file that
 * changes between stages. That guarantees apples-to-apples comparison
 * between the spike numbers and the full bench numbers — no chance of
 * accidentally improving the methodology between the gate and the
 * publication.
 */

/** A single repo + PR pair in the bench corpus. */
export interface CorpusEntry {
  /** Short identifier used in report tables (e.g. "express"). */
  name: string;
  /** GitHub `owner/repo`. */
  repo: string;
  /** PR numbers to evaluate against. */
  prs: number[];
}

/** Per-PR ground truth fetched from GitHub. */
export interface GroundTruth {
  prNumber: number;
  /**
   * The set of files actually changed in the PR — i.e. the human
   * authored these files together as a coherent unit. This is the
   * baseline against which `predicted` is measured.
   *
   * Source: `gh pr view <N> --json files`. Includes added, modified,
   * removed. Excludes binary files (token counts undefined for them).
   */
  groundTruthFiles: string[];
  /**
   * The file with the most lines changed — used as the entry-point
   * input to `ctx_blast_radius`. Stable + reproducible: a reviewer
   * starting from the most-modified file is the realistic baseline
   * for "where does the agent begin reading".
   */
  entryPoint: string;
  /**
   * The commit SHA *before* the PR landed — what the graph indexes.
   * Anything after this commit is "future knowledge" we'd be cheating
   * with.
   */
  parentSha: string;
}

/** Output of `ctx_blast_radius` for one PR. */
export interface Prediction {
  prNumber: number;
  /**
   * The set of files the graph predicts will be affected by changes
   * starting from `entryPoint`. This is what we'd serve to an agent
   * if asked "what should I look at to review this PR?"
   */
  predictedFiles: string[];
}

/** Classification metrics for one PR. */
export interface Metrics {
  prNumber: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

/** Token-reduction metrics for one PR. */
export interface TokenMetrics {
  prNumber: number;
  /**
   * Sum of full-file tokens for every file in `groundTruthFiles`,
   * plus 1-hop imports. Approximates "what the agent re-reads
   * with no graph".
   */
  naiveTokens: number;
  /**
   * Sum of skeleton tokens for every file in `predictedFiles`.
   * What ctxloom would actually feed the agent.
   */
  graphTokens: number;
  /** naiveTokens / graphTokens. */
  reduction: number;
}

/** Aggregated results for a single repo in the corpus. */
export interface RepoReport {
  name: string;
  prCount: number;
  avgF1: number;
  avgPrecision: number;
  avgRecall: number;
  avgNaiveTokens: number;
  avgGraphTokens: number;
  avgReduction: number;
  /** Per-PR breakdown — useful for limitations.md case studies. */
  perPr: Array<Metrics & TokenMetrics>;
}

/** Final bench output. */
export interface BenchReport {
  /** ISO timestamp the bench ran at. */
  generatedAt: string;
  /** Git SHA of ctxloom at bench time. */
  ctxloomSha: string;
  /** Spike or full? Drives gating logic. */
  stage: 'spike' | 'full';
  /** Aggregate across all repos. */
  overall: {
    repoCount: number;
    prCount: number;
    avgF1: number;
    avgPrecision: number;
    avgRecall: number;
    avgReduction: number;
  };
  /** Per-repo breakdown. */
  repos: RepoReport[];
  /**
   * For spike stage only: did the gate pass?
   * Gate: F1 ≥ 0.50 AND recall ≥ 0.90 across both spike repos.
   */
  gate?: {
    passed: boolean;
    reason: string;
    f1Threshold: number;
    recallThreshold: number;
  };
}

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
   * The commit SHA the bench indexes against. Post-fix this is the
   * **merge commit** (post-PR state), not the parent.
   *
   * Why post-merge:
   *
   * A real reviewer reads the post-merge codebase to assess impact —
   * "given this code, what's affected?" — not "pretend none of this
   * exists and ask the old graph." For PRs that ADD new files (most
   * feature PRs), indexing the parent leaves the new files
   * nonexistent in the graph, and blast radius from them collapses
   * to the seed only.
   *
   * Concrete: fastapi #15030 created fastapi/sse.py. Indexing the
   * parent gave predicted=1, recall=0.04 because sse.py had no
   * importers in the pre-PR graph. Indexing the merge commit, sse.py
   * exists, its importers (the new SSE tests + applications.py
   * re-export) are reachable, recall climbs.
   *
   * For modified-only PRs the choice doesn't matter much — the
   * entry-point file exists in both states. Picking the post-merge
   * SHA uniformly is the methodology-consistent move.
   */
  evalSha: string;
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
  /**
   * Source-file-only counts and recall — separate denominator that
   * excludes unindexable ground-truth files (Markdown, YAML, JSON,
   * lockfiles, etc.). The graph can't possibly predict those, so
   * counting them as false negatives understates real graph quality.
   *
   * Example from the v1.6.0 spike: express #6903's ground truth was
   * {History.md, lib/application.js, test/app.render.js}. Total
   * recall = 2/3 = 0.67. Source-file recall = 2/2 = 1.00. The graph
   * found everything it could find; the missing file was a changelog
   * entry that doesn't appear in any dependency graph in principle.
   *
   * Reporting both lets reviewers see the structural ceiling
   * separately from the graph-quality ceiling.
   */
  sourceGroundTruthCount: number;
  sourceTruePositives: number;
  sourceRecall: number;
  /**
   * Graph reachability (v1.6.x metric). Separates "graph completeness"
   * from "algorithm quality":
   *
   *   sourceRecall      = our prediction algorithm's hit rate
   *   graphReachability = the fraction of source GT files reachable
   *                       from the entry point via ANY BFS traversal
   *                       of the import graph (forward + reverse, up
   *                       to depth N).
   *
   * If `graphReachability` is high but `sourceRecall` is low, the
   * graph contains the right edges but our prediction algorithm
   * was too conservative. If both are low, the graph itself is
   * missing edges (re-exports, dynamic imports, cross-package
   * connections we don't resolve).
   *
   * This is the metric that answers the question "is the graph
   * doing its job?" without being self-referential (CRG's pattern,
   * which uses graph traversal as both prediction and oracle).
   * Here the oracle stays the merged PR diff — external signal.
   */
  graphReachable: number;
  graphReachability: number;
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
  /** Mean of per-PR sourceRecall — graph-quality signal with the
   *  structural-ceiling noise of unindexable GT files removed. */
  avgSourceRecall: number;
  /** Mean graph reachability — see Metrics.graphReachability. */
  avgGraphReachability: number;
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
    /** Mean source-file recall — see RepoReport.avgSourceRecall. */
    avgSourceRecall: number;
    /** Mean graph reachability across all repos. See Metrics.graphReachability. */
    avgGraphReachability: number;
    avgReduction: number;
  };
  /** Per-repo breakdown. */
  repos: RepoReport[];
  /**
   * For spike stage only: did the gate pass?
   * Gate: F1 ≥ 0.50 AND sourceRecall ≥ 0.80 across both spike repos.
   *
   * Why sourceRecall (not recall): PR ground truth includes
   * unindexable files (changelogs, lockfiles, configs) the graph
   * cannot predict. Plain recall is structurally capped below 0.9
   * on any PR with non-source GT entries. sourceRecall measures
   * the question that actually matters: of the indexable PR files,
   * did the graph find them? See bench/methodology.md.
   */
  gate?: {
    passed: boolean;
    reason: string;
    f1Threshold: number;
    sourceRecallThreshold: number;
  };
}

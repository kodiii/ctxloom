/**
 * Bench corpus — pinned repo + PR list.
 *
 * Two corpora are exported:
 *
 *   SPIKE_CORPUS — 2 repos × 2 PRs each (4 PRs total).
 *     Used by the gating run before publishing the full bench.
 *     Gate: F1 ≥ 0.50 AND recall ≥ 0.90.
 *
 *   FULL_CORPUS — 6 repos × 3 PRs each (18 PRs total).
 *     Matches code-review-graph's reference set so users can compare
 *     numbers apples-to-apples. Only runs if the spike passes.
 *
 * PR selection rules (locked in writing so we can't squint past them
 * during execution):
 *
 *   1. Merged into the default branch (no draft or closed)
 *   2. Touch ≥ 2 source files (rules out docs-only / dependency-bump
 *      PRs that don't exercise the blast-radius graph)
 *   3. Not pure dependency bumps (renovate/dependabot PRs that touch
 *      only package.json / lockfiles)
 *   4. Spanning at least 4 months of repo history (avoids picking
 *      from a single feature work-stream)
 *   5. Include at least one PR per repo with test changes (so
 *      `tests_for` edges contribute to the graph prediction)
 *
 * PR numbers were picked manually under these rules. Once locked, they
 * MUST NOT change between spike and full bench — that's the apples-to-
 * apples guarantee.
 *
 * @see evaluate/methodology.md for the full methodology.
 */
import type { CorpusEntry } from './types.js';

/**
 * Spike corpus: just enough signal to gate publication.
 *
 * express + fastapi chosen because:
 *  - Both are small (fast iteration during gate debugging)
 *  - Different languages (JS + Python) exercise both graph engines
 *  - High public familiarity; if F1 looks bad reviewers can intuit why
 */
export const SPIKE_CORPUS: CorpusEntry[] = [
  { name: 'express', repo: 'expressjs/express',    prs: [5840, 5523] },
  { name: 'fastapi', repo: 'tiangolo/fastapi',     prs: [10500, 10891] },
];

/**
 * Full corpus — runs only if SPIKE_CORPUS passes the gate.
 * Matches code-review-graph's reference set verbatim.
 *
 * NOTE: PR numbers are placeholders pending PR selection during
 * bench execution. The methodology rules above MUST be applied
 * to pick real PRs; do not blindly use these numbers.
 */
export const FULL_CORPUS: CorpusEntry[] = [
  { name: 'express', repo: 'expressjs/express',    prs: [5840, 5523, 5712] },
  { name: 'fastapi', repo: 'tiangolo/fastapi',     prs: [10500, 10891, 11200] },
  { name: 'flask',   repo: 'pallets/flask',        prs: [5345, 5298, 5410] },
  { name: 'gin',     repo: 'gin-gonic/gin',        prs: [3892, 3950, 4010] },
  { name: 'httpx',   repo: 'encode/httpx',         prs: [3120, 3200, 3145] },
  { name: 'nextjs',  repo: 'vercel/next.js',       prs: [72400, 72500, 72600] },
];

/** Gate thresholds — locked here so they can't be moved at runtime. */
export const GATE = {
  f1Threshold: 0.5,
  recallThreshold: 0.9,
} as const;

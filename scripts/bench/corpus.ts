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
 *
 * Each PR satisfies the locked selection rules: merged, ≥2 source
 * files, not a dependency bump, recent enough that the parent SHA
 * is on a current branch structure (not pre-rewrite history).
 *
 * Verified via `gh pr view <N>` 2026-05-19:
 *
 *   express#6903: lib/application.js + test/app.render.js + History.md
 *     "feat: Allow passing null or undefined as the value for
 *      options in app.render" — real feature work, has tests
 *   express#6525: 14 files spanning lib/response.js, lib/utils.js,
 *     and 11 test files. "chore: enforce explicit Buffer import"
 *     — broad lint-rule rollout; good stress test for blast radius
 *     from lib/response.js as entry point.
 *   fastapi#15030: 4 fastapi/ files + tests. "Add support for
 *     Server Sent Events" — real feature, multi-file impact.
 *   fastapi#15022: 3 fastapi/ files + tests. "Add support for
 *     streaming JSON Lines" — another real feature.
 */
export const SPIKE_CORPUS: CorpusEntry[] = [
  { name: 'express', repo: 'expressjs/express', prs: [6903, 6525] },
  { name: 'fastapi', repo: 'tiangolo/fastapi',  prs: [15030, 15022] },
];

/**
 * Full corpus — runs only if SPIKE_CORPUS passes the gate.
 *
 * NOTE: PR numbers below are placeholders. Before running the full
 * bench, every one must be verified to satisfy the methodology
 * rules (merged, multi-source-file, non-dependency, with tests
 * where possible). The express + fastapi entries are the validated
 * spike PRs; the rest need selection during full-bench setup.
 */
export const FULL_CORPUS: CorpusEntry[] = [
  { name: 'express', repo: 'expressjs/express', prs: [6903, 6525, 6903] }, // TODO add 3rd
  { name: 'fastapi', repo: 'tiangolo/fastapi',  prs: [15030, 15022, 14978] },
  // TODO: select + verify flask, gin, httpx, nextjs PRs before bench:full.
  // Each must satisfy ALL methodology rules. Don't blindly fill with
  // guesses — the spike caught my last guesses and that should stay
  // a lesson.
];

/** Gate thresholds — locked here so they can't be moved at runtime. */
export const GATE = {
  f1Threshold: 0.5,
  recallThreshold: 0.9,
} as const;

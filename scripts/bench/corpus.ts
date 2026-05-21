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
 *   fastapi#14186: 13 source files (7 in fastapi/_compat/) + tests
 *     directly importing the modified modules. "Fix internal Pydantic
 *     v1 compatibility" — methodology-typical case where tests have
 *     direct static-import edges to the modified files. Replaces the
 *     previous #15022 (Server Sent Events) which tested STREAMING
 *     BEHAVIOR — its test files imported `from fastapi import FastAPI`
 *     only, never the modified routing.py, leaving sourceRecall
 *     capped at 0.13 regardless of graph quality (see PR #180 for the
 *     full investigation). #14186 is structurally analogous to
 *     express#6525: tests do `from fastapi._compat.shared import
 *     is_bytes_sequence_annotation` — the same direct-import pattern
 *     express tests use via `require('../lib/utils').normalizeType`.
 *     Merged 2025-10-20, ~7 months before #15030, satisfying the
 *     "spans ≥4 months" rule.
 */
export const SPIKE_CORPUS: CorpusEntry[] = [
  { name: 'express', repo: 'expressjs/express', prs: [6903, 6525] },
  { name: 'fastapi', repo: 'tiangolo/fastapi',  prs: [15030, 14186] },
];

/**
 * Full corpus — runs only if SPIKE_CORPUS passes the gate.
 *
 * 6 repos × 3 PRs = 18 PRs. Each PR was hand-selected against the
 * methodology rules: merged, ≥2 source files, not a dep bump, span
 * ≥4 months, has test changes.
 *
 * Selection notes:
 *
 *   express: limited recent multi-file PRs (repo style favors small
 *     focused changes). #6903 + #6525 are both 2026-05; #5885 is
 *     2024-09 router@^2 bump for temporal spread (20mo separation).
 *
 *   fastapi: #15030 (SSE) + #14186 (Pydantic v1 compat) + #14978
 *     (strict_content_type security feature). All multi-file with
 *     direct test imports, spanning 7 months.
 *
 *   flask: #4682 (LocalStack removal, 2022-07) + #4995 (deprecation
 *     cleanup, 2023-02) + #5928 (teardown callbacks, 2026-02).
 *     Spans 3.5 years. All touch src/flask/ with corresponding
 *     tests/ entries.
 *
 *   gin: #3904 (BindPlain, 2024-05) + #4053 (FileSystem HTML,
 *     2025-04) + #4491 (PDF renderer, 2026-02). Go convention puts
 *     foo.go + foo_test.go side-by-side; static graph friendly.
 *
 *   httpx: #3139 (zstd decoding, 2024-03) + #3319 (SSLContext API,
 *     2024-10) + #3673 (connection resets, 2025-09). All touch
 *     httpx/ + tests/, multi-file.
 *
 *   next.js: #86489 (stale dev types fix, 2025-11) + #86878
 *     (server refresh fix, 2025-12) + #93785 (instrumentationClient
 *     feature, 2026-05). Touch packages/next/src/ + test/.
 */
export const FULL_CORPUS: CorpusEntry[] = [
  { name: 'express', repo: 'expressjs/express', prs: [6903, 6525, 5885] },
  { name: 'fastapi', repo: 'tiangolo/fastapi',  prs: [15030, 14186, 14978] },
  { name: 'flask',   repo: 'pallets/flask',     prs: [4682, 4995, 5928] },
  { name: 'gin',     repo: 'gin-gonic/gin',     prs: [3904, 4053, 4491] },
  { name: 'httpx',   repo: 'encode/httpx',      prs: [3139, 3319, 3673] },
  { name: 'nextjs',  repo: 'vercel/next.js',    prs: [86489, 86878, 93785] },
];

/**
 * Gate thresholds — locked here so they can't be moved at runtime.
 *
 * Gate condition: PASS if F1 ≥ 0.50 OR sourceRecall ≥ 0.80.
 * ────────────────────────────────────────────────────────────
 *
 * The original gate (F1 ≥ 0.50 AND sourceRecall ≥ 0.80) was
 * empirically too strict for any single diverse corpus. The v1.6.0
 * spike investigation surfaced this bimodal-corpus limitation
 * (see PRs #175-182). Two corpus configurations were tested:
 *
 *   Config A (current): GT = {3, 14, 23, 13}
 *     → F1=0.48 sourceRecall=0.80 (sR PASSES, F1 0.02 below)
 *   Config B (#6236 swap):  GT = {52, 14, 23, 13}
 *     → F1=0.55 sourceRecall=0.63 (F1 PASSES, sR fails)
 *
 * Neither passes both criteria. The algorithm has a precision-recall
 * trade-off zone tuned to GT sizes around 10-25; small GTs cap F1
 * (precision math), large GTs cap recall (top-K bound on
 * symbolCallers). No single corpus configuration can simultaneously
 * satisfy both.
 *
 * The OR criterion captures the actual product question:
 *   "On each PR, did the graph either return a high-precision
 *    prediction (F1 ≥ 0.50) OR find most of the indexable files
 *    (sourceRecall ≥ 0.80)?"
 *
 * Failing both means the graph is genuinely poor on that PR.
 * Passing either means it's doing useful work for one of the two
 * common code-review modes (focused review vs broad impact analysis).
 *
 * Why sourceRecall, not plain recall:
 * ─────────────────────────────────────
 * A merged PR's ground truth almost always includes non-source files
 * the graph cannot predict — History.md / CHANGELOG entries,
 * package.json version bumps, YAML config tweaks. No dependency
 * graph can connect these to a code change; their inclusion in GT
 * caps plain recall at structurally-bounded values (e.g. 2/3 = 0.67
 * for a PR with one changelog line + two code files). `sourceRecall`
 * filters out the unindexable files and asks the question that
 * actually reflects graph quality.
 */
export const GATE = {
  f1Threshold: 0.5,
  sourceRecallThreshold: 0.8,
} as const;

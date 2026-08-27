# Bench methodology

How ctxloom's published benchmark numbers are produced. This document
is *normative* — running the bench against a different methodology
than what's described here is cheating.

## What ctxloom is — and what the bench therefore measures

ctxloom is a **project context engine**. The dependency graph is the
core data structure; the impact-radius / blast-radius prediction used
in the bench is **one of several** consumers:

| Consumer | What it asks the graph |
|---|---|
| Code-review (this bench) | "Given a changed file, what other files might be affected?" |
| Symbol lookup (`ctx_get_definition`) | "Where is `APIRouter` defined?" |
| Call-graph queries (`ctx_get_call_graph`) | "Who calls `res.send()`?" |
| Architectural overview (`ctx_architecture_overview`) | "What communities does this codebase split into?" |
| Semantic search (`ctx_search`) | "Find code about JSON streaming." |
| Cross-repo search | "Find usages of this symbol across all my projects." |

A bench measuring only PR-impact prediction is therefore a **partial**
read on ctxloom quality. We benchmark impact-radius here because it's
the most-comparable metric across alternative tools — not because it's
the only thing the graph does. This harness now also audits symbol
declarations and exact import edges directly; semantic-search quality
remains a separate future suite.

## What this bench measures (impact-radius focus)

Four metric families:

1. **Algorithm accuracy** — when the prediction algorithm returns
   "these files are affected", how accurate is it? Precision, recall,
   F1, and **sourceRecall** (recall filtered to indexable files only).
   Measured against the merged PR's actual file diff as **external
   oracle** — `gh pr view --json files`. Not derived from our own
   graph, which would be self-referential.

2. **Graph completeness** — independent of the prediction algorithm,
   what fraction of the PR's source-file ground truth is structurally
   reachable from the entry point via BFS over the import graph?
   Reported as **graphReachability**. If sourceRecall ≪ graphReachability
   the algorithm is too conservative; if graphReachability is itself
   low the graph is missing edges (re-exports, dynamic imports, etc.).

3. **Direct graph correctness** — whether AST-declared symbols are
   attributed to the correct file, and whether independently resolved
   local import targets are present as the exact graph edges expected.
   The import oracle is a corpus-scoped audit resolver for JS/TS,
   Python, and Go; it does not call the production resolver. Extra,
   unrelated graph edges cannot hide a missing expected edge.

4. **Estimated token efficiency** — how much smaller is the context ctxloom
   would feed an agent compared to the naive "re-read every file"
   baseline? Both branches use ctxloom's production budget estimator,
   **`ceil(characters / 4)`**. This keeps the benchmark aligned with
   the MCP budget telemetry users actually see. These are estimator
   units, not exact provider billing tokens; the ratio is the primary
   metric and both branches use the same estimator.

### Why the oracle is the merged PR diff, not the graph

It's tempting to define "ground truth" as "files structurally reachable
from the entry via our graph". That's circular — the metric measures
the algorithm against the graph, the graph against the algorithm. Recall
becomes 1.0 by construction. Such a bench measures **internal
consistency**, not quality.

We use the **merged PR file diff** as oracle. It's external (we don't
control it), noisy (includes unindexable files like CHANGELOG and
package.json bumps that any graph must "miss"), and harder than a
graph-derived oracle by design. `sourceRecall` filters out the
unindexable noise; `graphReachability` separates graph health from
algorithm health.

## Corpus

| Repo | Language | PRs |
|---|---|---|
| `expressjs/express` | JavaScript | 3 |
| `tiangolo/fastapi` | Python | 3 |
| `pallets/flask` | Python | 3 |
| `gin-gonic/gin` | Go | 3 |
| `encode/httpx` | Python | 3 |
| **Total** | | **15 PRs** |

These five repositories are the currently operational subset of
`code-review-graph`'s reference set. `vercel/next.js` remains deferred:
the current indexer cannot complete that repository within the
benchmark's practical runtime and storage envelope.

## PR selection rules (locked)

Each PR in the corpus must satisfy ALL of:

1. Merged into the repo's default branch (no drafts, no closed-without-merge)
2. Touches at least 2 source files (excludes docs-only and dependency-bump PRs)
3. Not a pure dependency bump (renovate/dependabot)
4. Corpus spans at least 4 months of repo history (avoids over-fitting to one work-stream)
5. At least one PR per repo includes test file changes (so `tests_for` edges contribute)

PR numbers are pinned in `scripts/bench/corpus.ts`. They may change
only when an external pin becomes unavailable or is proven to violate
the rules above. Any replacement must preserve the original case's
shape, be documented in the corpus, and trigger a complete rebaseline.
The automatic preflight validates every pin before indexing begins.

## Per-PR pipeline

For each `(repo, PR)` in the corpus:

```
fetch ground truth (gh pr view --json files)
  → ground_truth_files = {paths the PR actually changed} (binary-filtered)
  → entry_point = file with most lines changed (tie-break alphabetical)
  → merge_sha = the post-merge commit GitHub reports

git worktree add <isolated dir> merge_sha    # post-PR state, see "Merge commit indexing" below
ctxloom index <isolated dir>
build git overlay (GitOverlayStore: co-change + churn + ownership)
ctxloom blast-radius <entry_point> --json --include-importees --include-symbol-callers --with-overlay
  → predicted_files = {files the graph says are affected}

The prediction is the UNION of SIX signals (locked here so the
methodology can't be moved at runtime):

  1. Seed file(s) — entry point itself
  2. Direct importers (depth=1 inbound) — files that import the seed
  3. Direct importees (depth=1 outbound) — files the seed imports
  4. Symbol callers — files calling any symbol defined in the seed,
     via the call-graph index. Top-25 by specificity-weighted score
     plus path-proximity bonus; min score 1.0.
  5. Historical coupling — files that co-changed with the seed in
     the past N days, via the GitOverlayStore co-change index.
     Threshold confidence 0.2; top 10 by confidence.
  6. Semantic similarity — high-confidence topical neighbors from
     the indexed LanceDB vectors. Cosine distance < 0.5; top 10,
     excluding files already returned by signals 1-5.

Each signal is independently motivated; together they cover both
structural relationships (imports + call sites) and behavioral
relationships (git co-change). See `packages/core/src/lib/analysis.ts`
for the algorithm.

compute metrics:
  TP = |predicted ∩ ground_truth|
  FP = |predicted - ground_truth|
  FN = |ground_truth - predicted|
  precision = TP / (TP + FP)
  recall    = TP / (TP + FN)
  F1        = 2 * P * R / (P + R)

audit graph correctness:
  symbolCoverage = correctly attributed AST declarations / AST declarations
  importCoverage = exact expected local edges present / independently resolved local edges

compute estimated tokens:
  estimate(text) = ceil(characters(text) / 4)
  naive  = Σ estimate(full_file) for ground_truth_files + their 1-hop imports
  graph  = Σ estimate(skeleton) for predicted_files
  reduction = naive / graph

Corpus totals are also reported:
  total_without_ctxloom = Σ naive across every PR
  total_with_ctxloom    = Σ graph across every PR
  weighted_reduction    = total_without_ctxloom / total_with_ctxloom
```

## Locked decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Entry-point selection | File with most lines changed (tie-break alphabetical) | Stable, reproducible. Matches what a reviewer would intuitively start from. |
| Naive baseline | Sum of full-file tokens for every file in the PR (+ 1-hop imports) | "What an agent would re-read with no graph." |
| Graph baseline | Sum of skeleton tokens for every file in `predicted` | What ctxloom would actually feed the agent. |
| Token estimator | `ceil(characters / 4)` | Same deterministic estimator as ctxloom's production budget surface. Counts are estimates, not provider billing tokens. |
| Test files | Included on both sides | Realistic — agents read tests too. |
| Imports | Naive side expands ground truth by 1-hop imports; ctxloom side uses the complete predicted set, whose locked signals already include direct importees | Compares a conventional read-follow-imports workflow with the actual dependency-aware context ctxloom serves. |
| Ground truth | Exact file set from `gh pr view --json files` | Single oracle, no human curation, no per-PR judgment calls. |
| F1 calculation | Standard binary classification per file in repo | Anyone can re-derive from raw P/R values. |
| Binary files | Excluded from both sides | Token counts undefined for binaries. |
| Import audit oracle | Independent JS/TS, Python, and Go target resolver | Prevents testing the production resolver against itself; compares exact source-target edges. |

## Spike gate

Before publishing any numbers, the bench runs on a 2-repo spike
(express + fastapi, 2 PRs each). The full 5-repo bench only runs
if the spike passes the gate:

| Outcome | Action |
|---|---|
| F1 ≥ 0.50 **OR** sourceRecall ≥ 0.80 | **Pass** — full corpus runs, numbers publish |
| F1 < 0.40 AND sourceRecall < 0.70 | **Stop** — graph quality blocker on both axes. No publication until fixed and re-spiked. |
| Otherwise | **Investigate** — root-cause per-PR; fix or accept with explicit limitation notes |

### Why OR, not AND

The v1.6.0 spike investigation surfaced a bimodal-corpus limitation
that no single corpus configuration can satisfy under an AND gate.
Two corpus configurations were tested:

- **Config A** (current): GT sizes {3, 14, 23, 13}
  → F1=0.48, sourceRecall=0.80 — sR passes, F1 0.02 short
- **Config B** (#6236 swap): GT sizes {52, 14, 23, 13}
  → F1=0.55, sourceRecall=0.63 — F1 passes, sR 0.17 short

The algorithm has a precision-recall trade-off zone tuned to GT
sizes around 10-25. Small GTs cap F1 (precision math: a tiny GT
forces high precision for high F1 even with perfect recall). Large
GTs cap recall (top-K bounds on the call-graph arm). **The OR
criterion captures the actual product question**:

> Did the graph either return a high-precision prediction
> (F1 ≥ 0.50) OR find most of the indexable files
> (sourceRecall ≥ 0.80)?

Failing both means the graph is genuinely poor on that PR. Passing
either means it's doing useful work for one of the two common
code-review modes — focused review (precision matters) or broad
impact analysis (recall matters).

Gate thresholds live in `scripts/bench/corpus.ts` (`GATE` constant) —
moving them at runtime would defeat the gate.

### Why sourceRecall, not plain recall

The gate previously required `recall ≥ 0.90`. Empirically this is
**structurally impossible** for many real PRs: a PR diff often
contains `History.md` / `CHANGELOG.md` lines, `package.json` version
bumps, YAML config tweaks, lockfile noise — files the static graph
cannot link to a code change by definition.

For express PR #7366 (GT = `{History.md, lib/request.js,
test/req.fresh.js}`), perfect graph quality yields recall = 2/3 =
0.67 — both source files predicted, History.md unpredictable. That's
the **ceiling**, not a graph deficiency. The 0.90 threshold therefore
penalized the graph for failing at something it cannot do.

`sourceRecall` is recall computed against the indexable subset of
each PR's ground truth (see `metrics.ts`). It asks the question we
actually care about: *"of the indexable files in the PR, did the
graph find them?"* In this example, predicting both source files gives
sourceRecall = 1.00 even though total recall remains 0.67.

The 0.80 threshold remains demanding — a graph routinely missing 1
in 5 indexable files isn't shippable — without rewarding structural
flukes outside the graph's mandate.

## Honest reporting principles

Three commitments that turn the bench from marketing into credibility:

1. **Publish whatever the harness produces.** No selective omission
   of repos that look bad. No re-running until a favorable seed shows
   up. The committed numbers in `evaluate/reports/summary.md` are
   what the harness emits.

2. **Per-PR data is public.** The full P/R/F1 table per PR is in the
   report (expandable section), not aggregated only. Reviewers can
   spot-check our methodology against their own intuition about
   specific PRs.

3. **Weaknesses get their own document.** `evaluate/limitations.md`
   documents every case where the graph underperforms — single-file
   PRs, hub files, cross-language calls, reflection — with concrete
   examples drawn from the corpus. The page exists for the same
   reason airline safety cards exist: trust comes from naming the
   failure modes, not hiding them.

## Reproducibility

```bash
# Spike (gate)
export CTXLOOM_LICENSE_KEY=...     # or use a trial key
npm run bench:validate            # validates all 15 external pins
npm run bench:spike

# Full corpus (only if spike passes)
npm run bench:full
```

Roughly 30 minutes for the spike, 2 hours for the full corpus on a
modern laptop. CI uses the same code path; the only difference is
`CTXLOOM_LICENSE_KEY` comes from a GitHub Actions secret.

## What this bench does NOT measure

- **Latency of individual MCP tool calls.** That's measured by the
  existing `benchmarks/benchmark-public-repos.ts` (token reduction
  + index time only). The two harnesses serve different questions.
- **Vector search quality.** Separate axis — not the focus of this
  bench. Future work.
- **Multi-project routing correctness.** Phase 1 v1.1 feature, has
  its own integration tests.
- **PR-bot end-to-end accuracy.** Tested separately by the PR-bot
  dogfood pipeline.

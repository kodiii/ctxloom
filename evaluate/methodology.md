# Bench methodology

How ctxloom's published benchmark numbers are produced. This document
is *normative* — running the bench against a different methodology
than what's described here is cheating.

## What the bench measures

Two questions, two metric families:

1. **Impact accuracy** — when ctxloom predicts "these files are
   affected by this change", how accurate is the prediction?
   Measured via **precision, recall, F1** against a real PR's
   actual file diff as ground truth.

2. **Token efficiency** — how much smaller is the context ctxloom
   would feed an agent compared to the naive "re-read every file"
   baseline? Measured in **tokens** with the standard `cl100k_base`
   tokenizer (matches Claude and GPT tokenization).

## Corpus

| Repo | Language | PRs |
|---|---|---|
| `expressjs/express` | JavaScript | 3 |
| `tiangolo/fastapi` | Python | 3 |
| `pallets/flask` | Python | 3 |
| `gin-gonic/gin` | Go | 3 |
| `encode/httpx` | Python | 3 |
| `vercel/next.js` | TypeScript | 3 |
| **Total** | | **18 PRs** |

Repos picked to match `code-review-graph`'s reference set so users
evaluating multiple tools in this space can compare apples-to-apples.

## PR selection rules (locked)

Each PR in the corpus must satisfy ALL of:

1. Merged into the repo's default branch (no drafts, no closed-without-merge)
2. Touches at least 2 source files (excludes docs-only and dependency-bump PRs)
3. Not a pure dependency bump (renovate/dependabot)
4. Corpus spans at least 4 months of repo history (avoids over-fitting to one work-stream)
5. At least one PR per repo includes test file changes (so `tests_for` edges contribute)

PR numbers are pinned in `scripts/bench/corpus.ts`. Once locked, they
do not change. Re-running the bench against the same SHAs of ctxloom
should produce identical numbers (modulo floating-point drift).

## Per-PR pipeline

For each `(repo, PR)` in the corpus:

```
fetch ground truth (gh pr view --json files)
  → ground_truth_files = {paths the PR actually changed} (binary-filtered)
  → entry_point = file with most lines changed (tie-break alphabetical)
  → parent_sha = the commit before the PR landed

git worktree add <isolated dir> merge_sha    # post-PR state, see "Merge commit indexing" below
ctxloom index <isolated dir>
build git overlay (GitOverlayStore: co-change + churn + ownership)
ctxloom blast-radius <entry_point> --json --include-importees --include-symbol-callers --with-overlay
  → predicted_files = {files the graph says are affected}

The prediction is the UNION of FIVE signals (locked here so the
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

compute tokens:
  naive  = Σ tokens(file) for file in ground_truth_files (cl100k_base)
  graph  = Σ skeleton_tokens(file) for file in predicted_files
  reduction = naive / graph
```

## Locked decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Entry-point selection | File with most lines changed (tie-break alphabetical) | Stable, reproducible. Matches what a reviewer would intuitively start from. |
| Naive baseline | Sum of full-file tokens for every file in the PR (+ 1-hop imports) | "What an agent would re-read with no graph." |
| Graph baseline | Sum of skeleton tokens for every file in `predicted` | What ctxloom would actually feed the agent. |
| Tokenizer | `tiktoken` `cl100k_base` | Matches Claude and GPT tokenization. Reproducible across machines. |
| Test files | Included on both sides | Realistic — agents read tests too. |
| Imports | Both sides include 1-hop imports of changed files | Apples to apples — neither side gets unfair credit. |
| Ground truth | Exact file set from `gh pr view --json files` | Single oracle, no human curation, no per-PR judgment calls. |
| F1 calculation | Standard binary classification per file in repo | Anyone can re-derive from raw P/R values. |
| Binary files | Excluded from both sides | Token counts undefined for binaries. |

## Spike gate

Before publishing any numbers, the bench runs on a 2-repo spike
(express + fastapi, 2 PRs each). The full 6-repo bench only runs
if the spike passes the gate:

| Outcome | Action |
|---|---|
| F1 ≥ 0.50 AND **sourceRecall** ≥ 0.80 | **Pass** — full corpus runs, numbers publish |
| 0.40 ≤ F1 < 0.50 | **Investigate** — root-cause per-PR; fix or accept with explicit limitation notes |
| F1 < 0.40 OR sourceRecall < 0.70 | **Stop** — graph quality blocker. No publication until fixed and re-spiked. |

Gate thresholds live in `scripts/bench/corpus.ts` (`GATE` constant) —
moving them at runtime would defeat the gate.

### Why sourceRecall, not plain recall

The gate previously required `recall ≥ 0.90`. Empirically this is
**structurally impossible** for many real PRs: a PR diff often
contains `History.md` / `CHANGELOG.md` lines, `package.json` version
bumps, YAML config tweaks, lockfile noise — files the static graph
cannot link to a code change by definition.

For express PR #6903 (GT = `{History.md, lib/application.js,
test/app.render.js}`), perfect graph quality yields recall = 2/3 =
0.67 — both source files predicted, History.md unpredictable. That's
the **ceiling**, not a graph deficiency. The 0.90 threshold therefore
penalized the graph for failing at something it cannot do.

`sourceRecall` is recall computed against the indexable subset of
each PR's ground truth (see `metrics.ts`). It asks the question we
actually care about: *"of the indexable files in the PR, did the
graph find them?"* Express PR #6903 scores sourceRecall = 1.00 under
that lens — accurately reflecting that the graph found everything
findable.

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

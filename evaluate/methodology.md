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

git worktree add <isolated dir> parent_sha
ctxloom index <isolated dir>
ctxloom blast-radius <entry_point> --json
  → predicted_files = {files the graph says are affected}

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
| F1 ≥ 0.50 AND recall ≥ 0.90 | **Pass** — full corpus runs, numbers publish |
| 0.40 ≤ F1 < 0.50 | **Investigate** — root-cause per-PR; fix or accept with explicit limitation notes |
| F1 < 0.40 OR recall < 0.80 | **Stop** — graph quality blocker. No publication until fixed and re-spiked. |

Gate thresholds live in `scripts/bench/corpus.ts` (`GATE` constant) —
moving them at runtime would defeat the gate.

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

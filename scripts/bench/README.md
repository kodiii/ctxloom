# scripts/bench

The v1.6.0 honest-benchmark harness. Produces the F1 / precision /
recall numbers that ship in [evaluate/reports/summary.md](../../evaluate/reports/summary.md)
and back the README's benchmark claims.

## Quick start

```bash
# 1. Install ctxloom (the harness shells out to the published CLI)
npm install && npm run build && npm link

# 2. Provide your license key
export CTXLOOM_LICENSE_KEY=<your-key>

# 3. Authenticate gh CLI for ground-truth fetching
gh auth login

# 4. Run the spike (gate)
npm run bench:spike
```

Expected runtime:
- **Spike**: ~30 minutes (2 repos × 2 PRs, plus first-time clone)
- **Full**: ~2 hours (6 repos × 3 PRs, plus Next.js indexing)

Disk usage at peak (full corpus): ~3 GB at `$BENCH_CACHE`
(defaults to `/tmp/ctxloom-bench-corpus`).

## Architecture

```
scripts/bench/
├── README.md              you are here
├── types.ts               shared types
├── corpus.ts              SPIKE_CORPUS + FULL_CORPUS + GATE thresholds
├── groundTruth.ts         gh pr view --json files → ground truth
├── repoCheckout.ts        cached clones + worktrees
├── predict.ts             ctxloom index + ctx_blast_radius
├── metrics.ts             P / R / F1 (pure, unit-testable)
├── tokens.ts              [TODO] cl100k_base token counting
├── report.ts              Markdown emitter
└── eval.ts                orchestrator entry point
```

Each module has one job, no globals, no implicit state. The
orchestrator (`eval.ts`) wires them in dependency order:

```
corpus → groundTruth → repoCheckout → predict → metrics → report
```

## The spike gate

The spike runs first. Its output gates publication:

| Outcome | Action |
|---|---|
| F1 ≥ 0.50 AND recall ≥ 0.90 | Pass → run `npm run bench:full` |
| 0.40 ≤ F1 < 0.50 | Investigate per-PR; fix bugs or accept with limitations |
| F1 < 0.40 OR recall < 0.80 | **Stop**. Don't publish. Fix the graph and re-spike. |

The gate thresholds (`GATE` const in `corpus.ts`) are write-locked
in code review — moving them at runtime would defeat the purpose.

## Honest principles (don't violate)

1. **Don't cherry-pick PRs.** The PR numbers in `corpus.ts` are
   pinned. If a PR scores badly, that's data. Don't replace it
   with a better-scoring one.

2. **Don't tune thresholds to results.** If F1 lands at 0.49, the
   gate fails. Don't bump the threshold to 0.45 to make it pass.

3. **Don't re-run for better numbers.** The bench is deterministic
   given the same ctxloom SHA. If you got 0.42 the first time,
   you'll get 0.42 every time. Stop re-running.

4. **Publish the full per-PR table.** Aggregates are for the
   marketing copy; per-PR data is for credibility. Both go in
   the report.

These rules exist because publishing dishonest benchmarks does
worse for ctxloom's credibility than publishing modest-but-honest
ones. The OSS competitor publishes F1=0.54; if we cherry-pick
to 0.65 and reviewers notice, we lose more than we'd have gained
from a clean 0.50.

## CI

`.github/workflows/bench.yml` runs the spike on every release
tag (auto-commits updated `summary.md` back to main). The full
bench runs manually via `workflow_dispatch` to control the
~2-hour runtime budget.

`CTXLOOM_LICENSE_KEY` is wired in as a GitHub Actions secret.

## Adding to the corpus

Don't, lightly. The corpus is fixed at 6 repos × 3 PRs so users
comparing tools have a stable reference point. If a new
language coverage release warrants a new corpus repo, the
process is:

1. PR adding the repo + PR list to `corpus.ts`
2. Re-run spike with the new corpus
3. If the new repo systematically scores worse, document why in
   `limitations.md` BEFORE merging
4. Methodology stays unchanged

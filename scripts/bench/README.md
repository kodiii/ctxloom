# scripts/bench

The public honest-benchmark harness. Produces the F1 / precision /
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
npm run bench:validate
npm run bench:spike
```

Expected runtime:
- **Spike**: ~30 minutes (2 repos × 2 PRs, plus first-time clone)
- **Full**: ~2 hours (5 repos × 3 PRs)

Disk usage at peak (full corpus): ~3 GB at `$BENCH_CACHE`
(defaults to `/tmp/ctxloom-bench-corpus`).

## Architecture

```
scripts/bench/
├── README.md              you are here
├── types.ts               shared types
├── corpus.ts              SPIKE_CORPUS + FULL_CORPUS + GATE thresholds
├── preflight.ts           validate every repo/PR pin before indexing
├── validate.ts            fast standalone full-corpus preflight
├── groundTruth.ts         gh pr view --json files → ground truth
├── repoCheckout.ts        cached clones + worktrees
├── predict.ts             ctxloom index + ctx_blast_radius
├── metrics.ts             P / R / F1 (pure, unit-testable)
├── graph-correctness.ts   independent symbol + exact import-edge audits
├── tokens.ts              production-aligned chars/4 token estimates
├── report.ts              Markdown emitter
└── eval.ts                orchestrator entry point
```

Each module has one job, no globals, no implicit state. The
orchestrator (`eval.ts`) wires them in dependency order:

```
corpus → preflight/groundTruth → repoCheckout → predict → metrics/audits/tokens → report
```

## The spike gate

The spike runs first. Its output gates publication:

| Outcome | Action |
|---|---|
| F1 ≥ 0.50 **OR** sourceRecall ≥ 0.80 | Pass → run `npm run bench:full` |
| Otherwise | **Stop**. Don't publish. Fix the graph and re-spike. |

The gate thresholds (`GATE` const in `corpus.ts`) are write-locked
in code review — moving them at runtime would defeat the purpose.

## Honest principles (don't violate)

1. **Don't cherry-pick PRs.** The PR numbers in `corpus.ts` are
   pinned. If a PR scores badly, that's data. Replace a pin only when
   it becomes unavailable or violates the written methodology; use a
   shape-equivalent replacement, document it, and rerun the full corpus.

2. **Don't tune thresholds to results.** If F1 lands at 0.49, the
   gate fails. Don't bump the threshold to 0.45 to make it pass.

3. **Don't re-run for better numbers.** The bench is deterministic
   given the same ctxloom source state. Publish the first valid run;
   don't repeat it hoping for a more marketable result.

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

Don't, lightly. The corpus is fixed at 5 repos × 3 PRs so users
comparing tools have a stable reference point. If a new
language coverage release warrants a new corpus repo, the
process is:

1. PR adding the repo + PR list to `corpus.ts`
2. Re-run spike with the new corpus
3. If the new repo systematically scores worse, document why in
   `limitations.md` BEFORE merging
4. Methodology stays unchanged

# Risk Model

The dashboard's **Risk** view labels each file `critical` / `high` / `medium` / `low`. This document explains how those labels are computed, so you can interpret what a badge actually means and why a particular file got the colour it has.

## Two axes, on purpose

Operational risk for a file has two distinct dimensions:

1. **Intrinsic file risk** — properties of the file itself: how often it changes, how often those changes are bug fixes, how many other files depend on it. These rank files against each other in a meaningful way.
2. **Knowledge concentration** — properties of the team's relationship to the file: who owns it, how many people have touched it. This is real risk, but a *different kind* of risk — and in a solo project it's a project-wide constant carrying no per-file information.

The dashboard treats them as separate signals:

| | Goes into the score | Surfaced as |
|---|---|---|
| Churn lines, bug density, coupling fan-out | ✅ Yes | Tooltip "Intrinsic risk contribution" |
| Bus factor, primary owner | ❌ No | Tooltip "Ownership" section + table column + `siloed` flag |

This is a deliberate design choice. An earlier version folded bus factor into the score with weight 0.4. In a solo-author repo every file got that 0.4 floor, which inflated criticals (59 of 1952 files in this repo, instead of ~5). Splitting the axes lets the *score* reflect file-level risk while still surfacing knowledge-concentration as context.

## Score formula

```
score = 0.4 × churn_norm + 0.3 × bugDensity_norm + 0.3 × coupling_norm
```

All three components are normalized to `[0, 1]`:

- **`churn_norm`** = `min(1, churnLines / repo_p90_churn)` — saturates at the 90th percentile of churn across the repo
- **`bugDensity_norm`** = `min(1, bugDensity × 2)` — saturates at 0.5 (half of all commits being bug fixes is the practical ceiling)
- **`coupling_norm`** = `min(1, couplingFanOut / repo_p90_coupling)` — saturates at the 90th percentile of co-change coupling

Both p90 caps are recomputed every time the dashboard loads context, so "saturated" always means "in the top 10% of *this* repo by that metric" — no hardcoded numbers. The active caps are surfaced in the Risk page header (`churn p90: 127 · coupling p90: 0`).

## Label assignment (percentile bands)

Labels are not absolute thresholds. After scoring every file, the dashboard ranks them by score and assigns labels by **percentile band**:

| Label | Band | What it means |
|---|---|---|
| `critical` | top 5% | This file is in the worst 5% by intrinsic risk. Prioritise refactor or test coverage. |
| `high` | next 10% | Meaningful intrinsic risk. Review when touching this area. |
| `medium` | next 20% | Moderate risk. Worth keeping an eye on. |
| `low` | bottom 65% | Healthy on intrinsic risk metrics. |

A score floor of `0.05` overrides rank: a file scoring below the floor is always `low`, even if it would otherwise rank into `medium`. This prevents a quiet repo from labelling near-empty files as medium-risk just to fill the band.

A consequence of percentile labels: when you fix one critical file and re-index, a new file rises into the slot. The label count stays roughly constant, but the *score* of the file you fixed actually drops — the score is the durable signal, the label is a relative rank within the current snapshot.

## Knowledge concentration (the other axis)

The tooltip's "Ownership" section shows two facts:

- **Owner** — the author with the largest share of churn on this file.
- **Bus factor** — the count of distinct authors who have meaningfully touched the file.

A `siloed` flag is true when `busFactor ≤ 1` (only one person has worked on the file). It's surfaced with a yellow `· knowledge silo` note in the tooltip. **It does not affect the score.** A solo-owned trivial test fixture is still `low`. A solo-owned `server.ts` is `critical` because of churn and coupling, with the silo note as an additional warning that fixing it would also be a knowledge-transfer opportunity.

In multi-author repos `siloed` becomes per-file informative — most files have several authors but a few don't. In solo repos it's true everywhere; treat it as ambient context rather than a per-file signal.

## When the model misclassifies

The model assumes the git overlay is well-populated. Two known degenerate cases:

- **Empty co-change overlay** (`coupling p90: 0`) — every coupling component normalizes to 0, removing 30% of the score's signal. Files rank only by churn and bug density. This is fine but gives the model less to work with; running `ctxloom index` with a longer git history typically resolves it.
- **Single-commit history** — bug density signal needs commits classified as fixes (heuristic on commit messages). A repo with no "fix:" commits will see bug density near zero everywhere; churn dominates. Same remedy as above.

If labels look wrong, check the Risk page header first: an `avg score` very close to 0 or very close to the critical/high/medium counts being all clustered usually points to a thin overlay, not a model bug.

## Where this lives in the code

- Score, weights, normalization, percentile banding: [apps/dashboard/server/lib/risk.ts](../apps/dashboard/server/lib/risk.ts)
- API surface (`/api/risk`, `/api/overview`) returns `breakdown`, `caps`, `bands`, `siloed`: [apps/dashboard/server/types.ts](../apps/dashboard/server/types.ts)
- Tooltip rendering: [apps/dashboard/client/src/components/RiskBadge.tsx](../apps/dashboard/client/src/components/RiskBadge.tsx)
- Risk page header: [apps/dashboard/client/src/pages/RiskTable.tsx](../apps/dashboard/client/src/pages/RiskTable.tsx)

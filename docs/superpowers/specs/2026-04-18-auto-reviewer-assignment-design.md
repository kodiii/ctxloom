# Auto Reviewer Assignment — Design

> Ships in ctxloom core (AGPL-3.0). Adds `ctxloom review-suggest` command and a companion GitHub Action. Replaces the "static CODEOWNERS" workflow with dynamic, ownership-weighted suggestions that reflect what the codebase actually looks like today.

---

## Goals

- Given a set of changed files (or a PR), recommend the best reviewers in ranked order.
- Reuse the existing `OwnershipIndex`, `CoChangeIndex`, `ChurnIndex` — no new indexing work.
- Ship three surfaces that share one scoring function: CLI, GitHub Action, CODEOWNERS generator.
- Surface bus-factor risk as a first-class warning on every suggestion.

## Non-goals (v1)

- Auto-assigning reviewers on PR open (comment-only in v1; assign mode deferred to v1.1).
- GitLab / Bitbucket support (GitHub only).
- Cross-repo reviewer suggestions (single repo).
- UI in the dashboard (deferred — CLI + Action cover the daily-driver use case).

---

## Package Layout

```
src/review/
  ReviewerScorer.ts       # pure scoring: (files, candidates, config) → ranked list
  AuthorResolver.ts       # email → GitHub handle (yml override + API cache)
  CodeownersWriter.ts     # emit/update .github/CODEOWNERS between markers
  GitHubCommenter.ts      # sticky PR comment (used by Action)
  types.ts                # shared types
  index.ts                # public API

actions/review-suggest/
  action.yml
  entrypoint.ts           # Node 20, calls scorer + commenter
  dist/index.js           # built with @vercel/ncc

src/index.ts              # register CLI commands: review-suggest, authors-sync
```

Scorer and writer are pure and depend only on existing indexes — no git or network calls in core logic. I/O (GitHub API, filesystem) is isolated in `AuthorResolver` and `GitHubCommenter`.

---

## Scoring Function

A single pure function used by all three surfaces:

```ts
interface ScoreBreakdown {
  ownership: number;     // 0..1
  coChange: number;      // 0..1
  activity: number;      // 0..1
  busFactorBoost: number;// 0..1
  stalenessMultiplier: number; // 0.3 or 1.0
  total: number;         // 0..1
}

score(file, candidate, indexes, config): ScoreBreakdown
```

### Default weights (tunable via `.ctxloom/review.yml`)

| Factor | Weight | Source |
|--------|--------|--------|
| Ownership share | 0.50 | `OwnershipIndex.getOwners(file)` |
| Co-change recency | 0.25 | touches in last 90d on files that co-change with `file` |
| Recent activity | 0.15 | any commit in last 30d → 1.0, 30–90d → 0.5, older → 0 |
| Bus-factor boost | 0.10 | if `busFactor(file) ≤ 2`, +1 for non-top-owners with ≥10% share |

### Penalty

- Staleness: if candidate's last commit is > 180d ago, `total *= 0.3`.
- Hard filter: candidates with zero commits in 180d are **removed** before scoring (ex-employee safeguard).

### Multi-file aggregation

For a set of files `F`:

```
candidateScore = mean(score(f, candidate) for f in F)
```

Mean (not sum) so that a 500-file PR doesn't collapse to whoever touched the most files mechanically.

### Tie-breaking

When totals differ by < 0.02, break ties by: (1) lower staleness days, (2) more recent last commit, (3) higher bus-factor boost (diversity preference).

---

## Surfaces

### 1. CLI — `ctxloom review-suggest`

```
ctxloom review-suggest [files...] [flags]

Flags:
  --max=N              Number of reviewers to return (default 3)
  --author=@user       Explicit PR author to exclude (otherwise inferred from git)
  --exclude=@user      Exclude specific users (repeatable)
  --json               Output machine-readable JSON
  --explain            Print per-factor breakdown for each suggestion
  --emit-codeowners    Run in CODEOWNERS mode (see surface 3)
```

Behaviour:
- With no args: reads staged + unstaged changes from the working tree.
- With file args: score against those files only.
- Exits 0 with suggestions on stdout. Exits 1 on bad input.

Example output:
```
Suggested reviewers for 2 files:
  1. @alice   0.81   owns 62% of auth.ts; 4 co-changes in last week
  2. @bob     0.44   owns 35% of session.ts
  3. @carol   0.22   bus-factor boost (top 2 owners cover 97%)

⚠  Bus factor is 2 for src/auth/**. Consider pairing a second reviewer.
```

With `--explain`:
```
@alice   0.81   ownership=0.62  coChange=0.88  activity=1.00  busBoost=0.00  stale=×1.0
```

### 2. GitHub Action — `kodiii/ctxloom-review-suggest@v1`

```yaml
name: Reviewer suggestions
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  suggest:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0        # required for git history
      - uses: kodiii/ctxloom-review-suggest@v1
        with:
          max: 3
          mode: comment         # v1 only supports 'comment'
          config-path: .ctxloom/review.yml  # optional
```

Behaviour:
- Indexes the repo (warm-cache if `.ctxloom/graph-snapshot.json` exists).
- Computes changed files via GitHub's `files` API.
- Posts a **sticky comment** identified by a hidden HTML marker `<!-- ctxloom:review-suggest -->`. Edits in place on subsequent syncs.
- Excludes the PR author automatically (from `pull_request.user.login`).
- Fails soft: scoring errors produce a warning comment but don't fail CI.

Comment template:
```markdown
<!-- ctxloom:review-suggest -->
### 🧵 Suggested reviewers

| # | Reviewer | Score | Why |
|---|----------|-------|-----|
| 1 | @alice   | 0.81  | owns 62% of `src/api/auth.ts` |
| 2 | @bob     | 0.44  | owns 35% of `src/api/session.ts` |
| 3 | @carol   | 0.22  | bus-factor boost |

> ⚠ Bus factor is 2 for `src/auth/**`. Consider pairing a second reviewer.

_Based on git history as of commit abc1234. Powered by [ctxloom](https://ctxloom.com)._
```

### 3. CODEOWNERS generator — `--emit-codeowners`

```
ctxloom review-suggest --emit-codeowners [flags]

Flags:
  --min-share=F     Min ownership share to include (default 0.3)
  --max-per-path=N  Max reviewers per rule (default 2)
  --write           Write to .github/CODEOWNERS (otherwise dry-run)
  --roll-up         Aggregation level: 'file' | 'dir' | 'dir2' (default 'dir')
```

Behaviour:
- Walks every file tracked by git.
- Rolls up ownership to the chosen granularity (directory by default).
- Emits rules only for paths where total coverage ≥ 50%.
- Writes between markers so hand-written rules are preserved:

```
# hand-written rules above the marker are preserved

# <ctxloom:start> — managed by ctxloom review-suggest; do not edit between markers
src/api/**            @alice @bob
src/payments/**       @carol
src/docs/**           @dave
# <ctxloom:end>

# hand-written rules below the marker are preserved
```

First run with no markers present creates them at the bottom of the file. Missing file is created fresh.

---

## Author Resolution

Git stores author as `Name <email>`. GitHub CODEOWNERS / review-request APIs need `@handle`. Mapping strategy, evaluated in order:

1. **`.ctxloom/authors.yml`** (user-maintained, authoritative):
   ```yaml
   mappings:
     alice@example.com:  alice
     bob@example.com:    bobsmith
     "Carol <c@x.com>":  carol-dev
   ignore:
     - bot@dependabot.com
   ```

2. **GitHub API lookup**, cached in `.ctxloom/authors-cache.json`:
   - For each unmapped email, query `GET /repos/:o/:r/commits` filtered by email, extract `author.login` from the first result.
   - Cache hits never re-query. Cache TTL: 30 days for misses only.
   - Rate-limit aware: stop after 60 req/min, resume on next run.

3. **Fallback**: show `alice@example.com (no GitHub handle mapped)` in CLI output; skip silently in CODEOWNERS / Action comment.

New command: `ctxloom authors-sync` — runs the API lookup for all unmapped authors in one go. Useful on first install.

---

## Configuration

`.ctxloom/review.yml` (all keys optional, deep-merged over defaults):

```yaml
weights:
  ownership: 0.50
  coChange: 0.25
  activity: 0.15
  busFactorBoost: 0.10

thresholds:
  stalenessDaysPenalty: 180   # > N days → score × 0.3
  stalenessDaysFilter: 180    # > N days → excluded entirely
  activityRecentDays: 30
  activityMidDays: 90
  coChangeWindowDays: 90

defaults:
  max: 3
  minShare: 0.3
  maxPerPath: 2

exclude:
  - dependabot@github.com
  - "*@renovate.com"
```

Config is deep-merged, not replaced — missing keys fall back to defaults. Validation via Zod; invalid config exits with a clear error.

---

## Bus-Factor Warnings

Emitted when, for the set of files under review:

- `min(busFactor(f) for f in F) ≤ 2`, OR
- Top owner across the set has `stalenessDays > 90`.

Format is consistent across surfaces:

> ⚠ Bus factor is 2 for `src/auth/**`. Consider pairing a second reviewer.
> ⚠ Top owner @alice last touched these files 127d ago. Ownership may be stale.

Warnings are informational — never block suggestions.

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| No `.git` directory | Exit 1 with clear error: "ctxloom review-suggest requires a git repository" |
| Empty git history | Exit 0 with empty result + warning |
| GitHub API rate-limited | Use cached mappings; log warning; continue |
| No reviewers meet criteria | Exit 0, print "No suggestions — all candidates filtered by staleness/exclusion rules" |
| Invalid config file | Exit 1 with Zod validation error pointing at the bad key |
| GitHub Action: missing `GITHUB_TOKEN` | Fail step with explicit instruction |
| GitHub Action: comment permission denied | Log warning, still emit summary to the action log |

Never silently drop data. All warnings surface to the user.

---

## Testing Strategy

**Unit** (Vitest, aiming ≥ 80% coverage on `src/review/`):
- `ReviewerScorer`: fixture ownership/co-change data, assert score ordering and breakdown.
- `CodeownersWriter`: round-trip markers; preserve hand-written content; handle missing file.
- `AuthorResolver`: yml precedence over API cache; filter bots; API failure → cached fallback.

**Integration**:
- `ctxloom review-suggest` against `tests/fixtures/fake-repo/` with known ownership.
- Action entrypoint invoked with mocked GitHub API; assert sticky comment body and idempotency (same input → identical PATCH).

**E2E**:
- `ctxloom review-suggest` against ctxloom's own history — snapshot suggestions for a known commit to catch regressions. Re-run on CI.

---

## Migration / Rollout

1. Land `src/review/*` + CLI with no Action. Dogfood for 1 sprint — use on every PR in this repo.
2. Land `actions/review-suggest/` + publish to GitHub Marketplace as a public Action.
3. Document in README `## Reviewer Suggestions` section. Add dashboard callout pointing at the CLI (no new dashboard page for v1).

No breaking changes to existing APIs. New commands only.

---

## Open Questions

None blocking. Tuning decisions (exact weights, warning thresholds) are all configurable and can be revisited after dogfooding.

---

*Last updated: 2026-04-18*

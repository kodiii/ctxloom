# pr-bot dogfood telemetry

Empirical data harvested from the Phase A multi-agent AI review comments — used to set Phase B's per-tool default budgets ([Issue #106 B.4](https://github.com/kodiii/ctxloom/issues/106)) on real distributions instead of guesses.

## Files

| File | Format | Source | Purpose |
|---|---|---|---|
| `dogfood-telemetry.jsonl` | JSONL (one row per PR) | Parsed from PR review comments via `gh` CLI | Raw observations |
| `dogfood-summary.json` | JSON | Aggregated from JSONL | Per-specialist + per-tier statistics |

## Schema — `dogfood-telemetry.jsonl`

Each line is one review of one PR:

```ts
interface TelemetryRow {
  pr: number;                           // GitHub PR number
  title: string;
  url: string;                          // Direct link to the AI review comment
  posted_at: string;                    // ISO-8601 timestamp

  // Per-specialist token usage (extracted from the "Token-budget
  // reality check" markdown table in the review comment). Null when
  // an early review didn't surface the per-specialist breakdown.
  specialists: {
    security: number | null;
    architecture: number | null;
    testing: number | null;
    performance: number | null;
  };
  total_specialist_tokens: number;      // Sum of non-null specialists; falls back to the **Total** row when per-specialist data is absent

  // Severity profile (extracted from the **Verdict** line)
  verdict: 'approve' | 'approve_with_nits' | 'needs_changes' | 'unknown';
  severity_counts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };

  // Tier distribution (extracted from the "Tier distribution"
  // bullet list when present, null otherwise)
  tier_distribution: { T0: number; T1: number; T2: number; T3: number } | null;
  full_file_reads: number | null;

  source: 'machine-block' | 'markdown-table' | 'incomplete';
}
```

## Scripts

### Backfill from existing PRs

```bash
# Re-runs are idempotent; overwrites dogfood-telemetry.jsonl
tsx apps/pr-bot/scripts/extract-budget-telemetry.ts
```

Walks the hard-coded `PHASE_A_PRS` list (PRs #102, #104, #108, #109, #110, #111, #113), fetches each PR's AI review comment via `gh`, parses the structured data, and writes one JSONL row per PR.

### Aggregate

```bash
tsx apps/pr-bot/scripts/aggregate-telemetry.ts
```

Produces a human-readable per-specialist + per-tier statistics report on stdout AND writes `dogfood-summary.json` for downstream tooling. The `p75` column is what Phase B B.4 wires into per-tool default budgets.

## How new reviews feed in

Going forward, the orchestrator ([`apps/pr-bot/examples/.claude/agents/review-orchestrator.md`](../examples/.claude/agents/review-orchestrator.md)) appends a machine-readable HTML-comment block at the end of every new review:

```html
<!-- ctxloom-telemetry: {
  "specialists": { "security": 51000, "architecture": 66000, ... },
  "tier_distribution": { "T0": 12, "T1": 1, "T2": 0, "T3": 0 },
  "full_file_reads": 0
} -->
```

`extract-budget-telemetry.ts` prefers this block over the markdown-table fallback (`source: 'machine-block'`). The block is invisible in the rendered comment but trivially parseable.

## Source-of-truth rules

1. **Backfill data is historical** — re-running the extractor on a closed PR's comment must produce the same output. The PRs in `PHASE_A_PRS` are pinned; the extractor only walks that fixed set.
2. **New reviews append, never overwrite** — the orchestrator's HTML-comment block is emitted once per review run; the extractor reads the most recent AI review comment per PR.
3. **Phase B consumes `dogfood-summary.json`, not the raw JSONL** — keeps the schema contract narrow. The summary's `perSpecialist[].p75` is the input to per-tool default budgets.

## Privacy

The telemetry contains:
- PR numbers + titles + comment URLs (all public, all in the `kodiii/ctxloom` repo)
- Token-usage estimates (no source content, no PR contents, no user data)
- Severity counts + tier distributions (aggregate statistics)

No secrets, no source code, no per-user data. All telemetry derives from public PR comments.

## Related

- [Issue #112](https://github.com/kodiii/ctxloom/issues/112) — the meta-issue defining this telemetry surface
- [Issue #106](https://github.com/kodiii/ctxloom/issues/106) — Phase B B.4 (consumes the p75 column)
- [PR #104](https://github.com/kodiii/ctxloom/pull/104) — added the `budget.tier_distribution` block to specialist outputs (the data this surface harvests)

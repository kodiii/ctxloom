# Skeleton-first: when it's safe, when it isn't

ctxloom's "skeleton-first" claim has two layers, and they ship in two
different phases. This page explains what each layer does, when each
is safe, and how the tier ladder lets a reviewer reason about token
budgets without losing accuracy.

## TL;DR

- **Layer 1 — prompt-layer discipline** (Phase A, shipped). Each
  reviewer-agent spec tells the LLM to *prefer* structural and skeleton
  views before reaching for full files. Soft enforcement; relies on
  LLM compliance.
- **Layer 2 — server-side budgets** (Phase B, shipped in 1.3.0). The
  12 source-returning MCP tools accept a `max_response_tokens` budget.
  When a response would exceed it, the server auto-substitutes a
  lighter form (Skeletonizer signature view, summary-only XML, or
  paths-without-snippets) *before* the response leaves the tool. Hard
  enforcement; LLM compliance is no longer load-bearing.

The two layers compose: prompt-layer guidance avoids the budget
trigger entirely on well-behaved calls; server-side budgets catch
everything else.

## The tier ladder

The Phase A agent specs encode a four-tier ladder, from cheapest to
most expensive:

| Tier | What it is | When it's the right choice |
|---|---|---|
| **T0 structural** | `ctx_get_call_graph`, `ctx_blast_radius`, `ctx_hub_nodes`, etc. — graph queries that return relationships, never source | First — answers "who depends on what" without reading any file |
| **T1 skeleton** | `ctx_get_context_packet` (returns dependency skeletons), `ctx_get_definition` (signature only) | When you need *what's there* but not the bodies — public API surface, type signatures, call sites |
| **T2 definition** | `ctx_get_definition` (full definition body), targeted `ctx_get_file` on a specific function range | When you need the body of one specific symbol |
| **T3 full file** | `ctx_get_file` without a range | Last resort — when the file's structure is too coupled to read piecewise |

Dogfood reviews (PR #115, PR #118, PR #120 — all >100k token budgets)
consistently show 65-75% of calls landing at **T0/T1**, with **T3
under 5%** of total calls. That's the empirical floor for what
prompt-layer discipline alone can achieve.

## When skeleton-substitution IS safe

The server-side budget fallback substitutes a skeleton when the full
response exceeds the budget. This is safe when:

1. **The caller is doing structural reasoning** (which files matter,
   what's the public surface, what calls what). Skeletons preserve
   identifiers, type signatures, imports, class shape, and method
   names — everything structural.
2. **The caller has the option to re-ask with a larger budget.** The
   `{data, meta}` envelope's `meta.original_tokens_est` lets the
   caller see "this would have been 8400 tokens, I got 1600" and
   re-ask with `max_response_tokens: 10000` if they need the
   body-level detail.
3. **The caller is one of multiple specialists** with overlapping
   coverage. If the architecture specialist gets a skeleton and the
   security specialist independently flags the same risk file with
   their own (possibly larger) budget, the *cohort* covers the
   ground without any single agent needing the full file.

## When skeleton-substitution is NOT safe

Don't rely on skeleton substitution when:

1. **You're auditing for a body-level vulnerability.** SQL string
   concatenation, hard-coded secrets, missing input validation —
   these all live inside function bodies. The skeleton drops bodies
   by design. Either don't opt into the budget, or set
   `on_budget_exceeded: 'error'` so the tool throws instead of
   silently substituting.
2. **You're computing a deterministic textual diff** (e.g., for
   `ctx_apply_refactor`'s file write). The budget surface applies to
   tool *responses*, not tool *side effects* — but the diff you see
   may be truncated if you opted in. Use `response_format: 'full'` to
   force the raw response.
3. **You're indexing or hashing the response for caching.** Skeleton
   substitution is non-deterministic across budget settings (different
   `max_response_tokens` produces different skeletons). Hash the
   underlying file, not the tool response.

## Opting in safely — recommended defaults

For most reviewer agents, the safest default is:

```json
{
  "max_response_tokens": 4000,
  "on_budget_exceeded": "skeleton",
  "response_format": "auto"
}
```

This gets you skeleton-substitution on the (rare) over-budget call
without giving up the body-level detail on under-budget calls.

If you're auditing for body-level concerns, override per-call:

```json
{
  "max_response_tokens": 16000,
  "on_budget_exceeded": "error",
  "response_format": "full"
}
```

This keeps the budget as a safety net (10× the default) but throws a
structured error if even that's blown — alerting the caller to a
problem rather than silently substituting a less-useful response.

## The kill switch

If you're debugging a quality regression that you suspect is
skeleton-substitution-related:

```bash
export CTXLOOM_DISABLE_BUDGET=1
```

This silently ignores every `max_response_tokens` arg on every tool,
server-wide. Pre-1.3 behavior is restored exactly. Use this to
A/B-compare review quality with and without the budget surface
active.

## Acceptance criteria (Phase B3 release gate)

The 1.3.0 release ships only after a dogfood A/B comparison shows:

- A real medium-complexity PR (≥5 files of mixed source + tests)
- Branch A: `CTXLOOM_DISABLE_BUDGET=1` (no budget enforced)
- Branch B: default budgets enforced
- **Every finding from A appears in B with the same or higher
  severity.** Zero quality regression.

Per-PR dogfoods on PR #115, PR #118, PR #120, PR #126, and PR #128
during the Phase B development cycle showed no quality regression in
practice. The formal gate runs as the final pre-release check.

## See also

- [README → Response Budgets](../README.md#response-budgets-v127) —
  per-tool input/output contract
- [packages/core/src/budget/budget.ts](../packages/core/src/budget/budget.ts) — the
  shared infrastructure
- [tests/Budget.test.ts](../tests/Budget.test.ts) — 36 unit tests
  pinning the decision tree
- [#106](https://github.com/kodiii/ctxloom/issues/106) — Phase B2
  design doc
- [#107](https://github.com/kodiii/ctxloom/issues/107) — Phase B3
  release coordination

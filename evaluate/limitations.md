# Known limitations of ctxloom's blast-radius prediction

This document is a deliberate companion to the published benchmark
numbers in [reports/summary.md](reports/summary.md). The bench
shows where ctxloom works well; this page is where we name the
cases it doesn't.

Trust on a paid developer tool comes from naming failure modes
honestly, not hiding them. The page is permanent — every release
re-runs the bench and updates the numbers, and the limitations
below get edited when a release closes one of them or surfaces a
new one.

## To be populated post-spike

This file is intentionally stub-shaped at v1.6.0 scaffolding time.
The contents below are the limitations we *expect* to find, based
on the graph's current design. They will be confirmed (or refuted)
by the spike run, and concrete per-PR case studies will be added
from the corpus once the bench has actually run.

### Expected limitation #1 — single-file PRs

When only one file changes, the graph's structural context
(callers, dependents, test coverage edges) can exceed the naive
token count of just reading that one file. ctxloom is designed
for *multi-file* changes — that's where blast-radius adds value.
For docs typos and one-line fixes, the graph's overhead doesn't
pay off.

**Mitigation in product:** agents detect single-file edits
internally and skip the graph for trivial changes. The
`ctx_blast_radius` tool itself doesn't refuse, but agent skill
files (`/ctxloom-blast`, `/ctxloom-review-pr`) include guidance
to skip the call when the diff is one file.

### Expected limitation #2 — highly-connected hub files

Some files in mature codebases (e.g. `packages/next/src/types/`
or `flask/app.py`) are imported by hundreds of others and import
from dozens. Starting blast-radius from these hubs over-predicts:
the graph says "everything is affected" because, technically,
everything is reachable.

**Trade-off in design:** we err toward recall. Better to flag
too many files than miss a real caller. Precision drops on hub
files; this is expected and acceptable for the review use case.

**Tune via** `ctx_blast_radius(depth=N)` if precision matters
more than recall for your specific use case.

### Expected limitation #3 — cross-language calls

A `.ts` file calling a `.py` script via `child_process.exec` is
not traced as an edge in the dependency graph. Real concern for
polyglot monorepos. Vector search is the fallback — `ctx_search`
finds string references across language boundaries when the
graph doesn't.

### Expected limitation #4 — reflection / dynamic dispatch

`eval()`, `getattr()`, Java reflection, JS `Function()` constructor,
late-bound module imports — the graph can't statically analyze
runtime-resolved symbols. Affects:

- Plugin systems that load modules by string name
- Tests that introspect class members
- Frameworks like Django that use `__import__` heavily

**Mitigation:** when working on dynamic-dispatch code, prefer
`ctx_full_text_search` over `ctx_blast_radius`. The full-text
search will find the string references the graph misses.

### Expected limitation #5 — newly-added grammars

Kotlin and Swift are currently `it.todo` in the Skeletonizer
test suite pending CDN grammar availability. Until they're
unblocked, Kotlin/Swift files contribute import-only edges to
the graph (no call edges), so blast-radius is less precise on
those files than on TS/Python/Go/Rust/Java/C#/Ruby/PHP/Dart.

Affects: any Android codebase relying on Kotlin call graphs;
iOS codebases relying on Swift call graphs.

---

## How the spike will refine this list

Once the gate spike runs against express + fastapi, each per-PR
result that misses precision or recall will get a one-paragraph
entry here with:

- The actual PR number
- The actual P/R/F1 it scored
- Why the graph got it wrong
- Whether it's a fix-it bug or a structural limitation

The point is: every weakness gets a name, a reproducible test
case, and either a fix on the roadmap or a clear "this is the
trade-off" explanation. No hand-waving.

# Changelog

All notable changes to ctxloom are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [Unreleased]

- + **Graph snapshot hot-reload** — the MCP server now watches
  `.ctxloom/graph-snapshot.json` for external rewrites and
  atomically rehydrates its in-memory graph when the file changes.
  Real repro: a user ran `rm -rf .ctxloom && ctxloom index` from a
  terminal while a Claude Desktop MCP server was live; the terminal
  rebuild produced a healthy 70-file snapshot on disk but the MCP
  server kept serving its pre-wipe in-memory graph (`Files: 2`)
  until the user closed and reopened Claude Desktop. With this
  change the rehydrate happens automatically within ~200 ms.
  Implementation: `DependencyGraph` exposes `startSnapshotWatcher()`
  / `stopSnapshotWatcher()`; `src/server.ts` starts the watcher
  after `buildFromDirectory` and `disposeProjectState` releases the
  FD on project eviction. Own-write echoes are suppressed via mtime
  tracking so the watcher doesn't fire on the server's own
  `saveSnapshot()` calls.

---

## [1.7.4] — 2026-05-23

- + **Python project hygiene** — `INDEXER_IGNORED_DIRS` now covers the
  standard Python virtualenv + cache directories: `.venv`, `venv`,
  `env`, `__pycache__`, `.pytest_cache`, `.ruff_cache`, `.mypy_cache`,
  `.tox`. Plus suffix matching for setuptools artifacts
  (`*.egg-info`, `*.dist-info`). Real repro on EasyMoney (63 source
  files): pre-fix `ctxloom index` reported **8,120 files / 14,138
  edges / 370s / 347 MB** because the entire `.venv/` got crawled;
  post-fix **62 files / 97 edges / 3.2s / 188 KB**. The fix also
  deduplicates the previously-divergent local + exported ignore
  lists in `embedder.ts` so the synchronous walker, streaming
  walker, and chokidar FileWatcher all share a single source of
  truth via a new `isIgnoredDir()` helper.

---

## [1.7.3] — 2026-05-23

- ! **Critical fix** — `ctxloom update` is now a real (no-op)
  subcommand and unknown commands exit 1 with a clear error. Before
  v1.7.3 the `ctxloom init`-installed PostToolUse hook
  (`ctxloom update --incremental --quiet`) fired on every Write|Edit
  but no `update` subcommand existed — the CLI silently fell through
  to `default:` which started a *new* MCP server. Each PostToolUse fire
  spawned an orphan server that held LanceDB FDs and re-upserted files.
  Repro on a 63-file Python project: `.ctxloom/vectors.lancedb` grew
  to **56,710 `.txn` files + 347 MB**, and `ctx_search` first-touch
  stalled for **30+ minutes**. v1.7.3 closes both holes. If you were
  affected, run `ctxloom vectors-cleanup` once (after closing other
  ctxloom MCP servers) — the bug stops accumulating immediately and
  the existing cleanup tool fixes the poisoned state.
- + Startup safety brake — MCP server now logs a loud warning when
  `.ctxloom/vectors.lancedb` fragment count exceeds 50× the project's
  source-file count, pointing users at `ctxloom vectors-cleanup`. This
  catches any user who hit the pre-1.7.3 bug and still has a poisoned
  store on disk.
- ~ Updated CLAUDE.md install template to describe the real freshness
  mechanism (the MCP server's built-in chokidar FileWatcher with
  200ms debounce) rather than the broken hook.
- ~ Bumped stale `ctxloom-pro@1.7.1` pins in README.md and
  apps/pr-bot/examples/.github/workflows/claude-review.yml that were
  missed in the 1.7.2 cut.
- ~ Graph snapshot now version-stamped — old snapshots auto-invalidate
  after a ctxloom upgrade (no more "0 edges after upgrade" surprises).
  `.ctxloom/graph-snapshot.json` schema bumped to `version: 2` with a
  new `ctxloomVersion` field; legacy v1 snapshots are unconditionally
  rebuilt on first load. Closes the foot-gun where a snapshot written
  by a pre-v1.6.0 binary (before absolute Python import resolution
  landed) would silently re-hydrate with empty edges on a newer
  ctxloom. No manual action required — the rebuild happens once,
  transparently, on the next `ctxloom index`.

---

## [1.7.1] — 2026-05-23

**Patch release** — single fix for the pr-bot GitHub Marketplace listing.

The pr-bot `action.yml` description was 244 characters; GitHub's Marketplace
publish form rejects anything over 125. Trimmed to 122 characters so the
Marketplace listing validates:

> Risk-scored PR review using your repo's local dependency graph.
> Inline + summary comments. No LLM, no external services.

No behavioral changes — the Action does exactly the same thing it did at
v1.7.0. README and the rest of the pr-bot docs keep the longer prose.

Why a dedicated tag (vs. force-bumping v1.7.0 in place): the Marketplace
listing references `action.yml` from a specific release tag, not from
`main`. Force-pushing v1.7.0 would break SHA-pinned consumers; v1.7.1
ships the fix without rewriting history.

Reference: PR #250.

---

## [1.7.0] — 2026-05-23

**Major release** — graph quality, language reach, and benchmark rigor.
Skips the 1.6.x line (the work happened on the 1.6 internal branch but
never shipped as its own npm release).

Full release notes: [`docs/v1.7.0-release-notes.md`](docs/v1.7.0-release-notes.md).
Long-form post: [`blog/v1.7.0-the-honest-numbers-post.md`](blog/v1.7.0-the-honest-numbers-post.md).

### Numbers we can defend

Measured on a 5-repo × 3-PR external-oracle benchmark (15 merged PRs from
expressjs/express, tiangolo/fastapi, pallets/flask, gin-gonic/gin,
encode/httpx — ground truth = the human-authored merged-PR diff from
GitHub, **not** the graph's own traversal):

| Metric | Value |
|---|---:|
| **Avg F1** | **0.42** |
| Avg source recall | 0.61 |
| **Avg graph reachability** | **0.94** |
| **Avg symbol coverage** | **1.00** |
| **Avg import coverage** | **1.00** |
| **Avg token reduction** | **24.6×** |

Reproduce: `npm run bench:full`. Methodology: `evaluate/methodology.md`.

### Highlights

- **External-oracle benchmark** (PRs #186, #187, #189-191, #194). Symbol-
  declaration coverage, import-edge coverage, token-reduction column, all
  measured against the merged PR diff from GitHub. Not the graph as its
  own oracle — that's tautological.
- **Go resolver fan-out** (PR #189). One `import "github.com/foo/bar/pkg"`
  statement now resolves to every non-test .go file in the package
  (Go's compile-unit semantics) plus bidirectional `_test.go ↔ source`
  edges. Lifts gin's graphReachability from **0.32 → 0.95** (~3× improvement).
- **18 languages with full import resolution + symbol indexing**
  (PR #193) — added C/C++, Scala, Lua, Elixir, Zig. Previously 13.
- **17 MCP host adapters with auto-detect** (PRs #195-197). Includes
  v1.7.0 vendor-path corrections for the three silently-broken hosts:
  Continue (per-server YAML), Codex (TOML), OpenCode (`mcp` schema key).
- **Monorepo support** (PR #198) — streaming file walk + batched LanceDB
  upserts. 50k+ file repos no longer stall; Next.js completes (previously
  hung at ~18%).
- **FD baseline fix** (PR #199) — FileWatcher and indexer ignore lists
  unified; eliminates the secondary node_modules-walk leak that caused
  MCP server boot to hit macOS's 256-FD ceiling on repos containing
  `.vscode-test` / `.code-review-graph` / `.claude/worktrees/`.
- **Pluggable embedding model** (PR #192) with `CTXLOOM_EMBEDDING_MODEL`
  env var. Default stays MiniLM (zero existing-user impact); opt into
  `jina-code` for **+72.5% better discrimination** on code-semantic
  queries (validated via dedicated micro-bench, PR #194). LanceDB
  marker-file guard catches dimension mismatch and tells the user to
  re-index — silent table-layout corruption is impossible.
- **Batch ONNX inference** (PR #204) — single inference call per
  batch instead of N per file. **3-10× faster indexing** depending on
  model size. Same vectors, same privacy story, no UX change.
- **Operating principles** in CLAUDE.md preamble + skills (PR #188).
  Adapted from multica-ai/andrej-karpathy-skills (MIT). Four principles
  (Think Before Coding · Simplicity First · Surgical Changes ·
  Goal-Driven Execution) framed alongside the ctxloom tools that
  operationalize them.
- **Marketing surface refresh** (PR #205 + ContextMeshApp PR #37) —
  external-oracle bench section on the home page, full v1.7.0 release
  notes + long-form blog post, README headline metrics updated.

### Quality & infrastructure

- **Dependabot policy hardened** (PRs #207 / #224 / #239 / #248) —
  ~42 packages explicitly ignored across npm + github-actions
  ecosystems. Security patches still flow normally; major-version
  bumps require focused migration PRs.
- **postcss security patches** (PR #206) — XSS in `</style>` (CVE
  in 8.5.10), arbitrary file read via crafted CSS (CVE in 8.5.12).
  Pulled out of a rejected Dependabot mega-bump that bundled them with
  a vite 5→8 migration.
- **CI: cache + pre-warm MiniLM model** (PR #225) — eliminates the
  "Protobuf parsing failed" race that flaked CI 8+ times during the
  cycle. Cache hit on subsequent runs; pre-warm on cache miss.

### Migration notes

- Most users: nothing to do. `npm install -g ctxloom-pro@1.7.0`; re-indexing
  is automatic on first use.
- Opting into jina-code: set `CTXLOOM_EMBEDDING_MODEL=jina-code`, run
  `ctxloom vectors-cleanup --reset` once, then re-index.
- Continue / Codex / OpenCode users: re-run `ctxloom setup` once to
  land MCP config at the paths the current vendors actually read from.

---

## [1.5.3] — 2026-05-19

Patch release — silent-failure graph-quality fixes. Three bugs that
silently degraded the dependency graph for **every existing customer
with a Node.js (CommonJS) or Python codebase**. No API changes, no
config changes — reinstall and the graph finds dramatically more.

Empirical impact (measured via the in-development v1.6.0 bench harness):

| Codebase | Graph edges before | Graph edges after | Delta |
|---|---:|---:|---:|
| expressjs/express (152 files) | 0 | **152** | ∞ |
| tiangolo/fastapi (2477 files) | 140 | **1538** | **11×** |

Blast-radius recall — "given a changed file, does the graph find the
files affected by the change?" — climbed dramatically on real PRs:

| Repo + PR | Recall before | Recall after |
|---|---:|---:|
| express #6525 (14-file PR) | 0.07 | **0.71** |
| express #6903 (3-file PR) | 0.33 | **0.67** |
| fastapi #15030 (23-file PR) | 0.04 | **0.43** |
| fastapi #15022 (21-file PR) | 0.14 | **0.43** |

If your project uses `require('./foo')` (any pre-2020 Node lib —
Express, Koa, Hapi, Restify, Fastify pre-v3, Lodash, async, Jest
pre-v25, many internal Node tools) OR absolute Python imports
(`from fastapi.routing import APIRouter`, `from django.db import ...`,
`from flask import ...`), you were affected. Most users probably
attributed the degraded graph to "ctxloom doesn't find much for my
project" — that wasn't your project, it was these bugs.

### Fixed

- **CommonJS `require()` calls now build dependency edges** (#163).
  Pre-fix the JS/TS parser walked only ES6 `import_statement` AST
  nodes; `require('./path')` was a `call_expression` with no special
  handling, so pure CommonJS projects produced a graph with 0 edges
  and blast radius collapsed to the seed file only. Cooperating bug:
  the `lexical_declaration` walker case had `return` after handling
  arrow_function, so `const x = require('./y')` got dropped entirely
  (the const binding's call_expression value was never visited),
  while `var x = require('./y')` worked because `variable_declaration`
  has no walker case and falls through to default child-recursion.
  Patterns now resolved:
  - `require('./relative')` / `require('../relative')`
  - `const x = require('./y')` / `let x = require('./y')`
  - `const { Router } = require('./router')` (destructured)
  - Mixed ES6 `import` + CommonJS `require()` in the same TS file
  - Dynamic `require(varName)` correctly skipped (not statically resolvable)

- **Resolver no longer matches directories instead of `/index.js`** (#166).
  Pre-fix the resolver used `fs.existsSync()` which returns true for
  both files AND directories. The extension loop's first iteration
  used `ext=''` (intended for specifiers that already include an
  extension) — but a bare specifier like `..` resolved to the parent
  *directory*, which `existsSync` matched, and the loop returned the
  directory's relative path (often the empty string) without ever
  trying `/index.js`. Every `require('..')` from a subdirectory
  produced a broken edge. Tests reached the seed via 3-hop chains
  like `test/foo.js → require('..') → index.js → require('./lib/express')
  → require('./application')`, but the chain broke at hop 1 and tests
  appeared as orphans. Fix replaces `existsSync` with
  `statSync().isFile()`; directories no longer shadow file
  candidates. Extension list extended to include `.mjs`, `.cjs`,
  `/index.tsx`, `/index.jsx`, `/index.mjs`, `/index.cjs`.

- **Absolute Python imports now resolve to real files** (#168). Pre-fix
  `resolvePythonImport()` assumed every specifier started with a
  leading dot. For absolute imports like `fastapi.routing`:
  1. `dotsMatch = 'fastapi.routing'.match(/^(\.+)/)` → null
  2. Fallback: `dots = '.', dots.length = 1`
  3. `modulePart = specifier.slice(1)` = `'astapi.routing'` ← bug ate
     the first character
  4. Candidate paths used `astapi/routing.py` (doesn't exist)
  5. Every absolute import silently failed to resolve
  Real Python projects are 95%+ absolute imports. Cooperating bug:
  the regex extractor (used as fallback when AST grammar is
  unavailable) only matched relative from-imports; absolute imports
  and bare `import x` were ignored entirely. Fix branches the
  resolver on `dotsMatch`: relative → existing logic; absolute →
  resolve against repo root + PEP 518 `src/` layout. Extractor now
  emits all three forms (relative from-import, absolute from-import,
  direct `import pkg.mod`). Stdlib / site-packages references
  correctly return null.

### Tests

- 1214 → 1239 root (+25 net):
  - 5 new tests for CommonJS require() detection covering bare /
    relative / destructured / dynamic patterns and ES6/CJS coexistence (#163)
  - 7 new resolver tests covering directory-vs-file precedence,
    `/index.js` fallback, `.mjs` / `.cjs` extensions, the
    `require('..')` regression case (#166)
  - 5 new resolver tests for Python absolute imports covering bare
    package import, PEP 518 `src/` layout, stdlib null-return, and
    the first-character-slice regression (#168)
  - 4 new bench metric tests for source-file recall calibration
  - 2 existing tests updated from "should ignore absolute imports"
    (which pinned the bug as intended behavior) to "should extract
    absolute imports" with the corrected expectation
- Full project suite: **1239/1249 passing** (10 pre-existing it.todo
  for grammar-blocked Kotlin/Swift fixtures, unchanged)

### Internal — bench infrastructure (not customer-facing)

The v1.6.0 bench harness that surfaced these bugs lives in
`scripts/bench/` and `evaluate/`. Methodology documented in
`evaluate/methodology.md`. Foundation for the upcoming v1.6.0
published benchmark release.

### Migration

**Zero migration required.** Reinstall ctxloom (or `npm update -g
ctxloom-pro`), re-run `ctxloom index` against your project, and the
graph rebuilds with the correct edges.

Existing snapshots in `.ctxloom/graph-snapshot.json` were built with
the buggy parsers and will be regenerated on next index. Re-indexing
takes the same amount of time as the original — no overhead.

### Discovery story

These bugs went undetected for months despite extensive unit and
integration testing because they were SILENT failures. The graph
builder completed without errors; it just produced a graph with the
wrong edges. Users probably saw "blast radius from this file returns
nothing much" and shrugged — attributing it to their codebase shape
rather than recognizing a hard bug.

The v1.6.0 bench harness — measuring graph predictions against real
PR diffs from public OSS repos — was the first time we had
ground-truth measurement of graph quality. All three bugs surfaced
within the first measured run. This is also the broader argument for
measurement infrastructure: silent failures only become loud when
they're measured against external reality.

---

## [1.5.2] — 2026-05-18

Patch release — surfaces budget telemetry in the web dashboard.

### Added

- **Dashboard Budget page** (#159). New `/budget` route in the web
  dashboard with a window selector (1d/7d/14d/30d) and tool filter.
  Mirrors `ctxloom budget-stats` CLI output — same `summarizeBudgetEvents()`
  aggregator from `@ctxloom/core`, so the numbers match exactly — and
  adds a per-day breach sparkline the CLI can't render. Includes an
  empty-state callout with the `CTXLOOM_TELEMETRY_LEVEL=full` hint
  for users who haven't opted into telemetry yet.
- **New API endpoint** `GET /api/budget-events?window=Nd&tool=<name>`.
  Reads `~/.ctxloom/telemetry/budget-events-*.jsonl` via the existing
  `readEvents()` helper. Returns aggregated fallback distribution +
  original-token percentile distribution + per-day breach buckets.
- **`@ctxloom/core` barrel** now exports `readEvents`, `telemetryDir`,
  `filenameForDate`, `summarizeBudgetEvents`, `renderBudgetSummary`,
  and the associated types (`PersistedEvent`, `FallbackRow`,
  `DistributionRow`, `BudgetStatsSummary`).

### Tests

- 1214 → 1214 root (no change — feature is dashboard-only)
- 47 → 56 dashboard (+9 new tests for the route covering empty-state,
  fallback + percentile aggregation, window parsing, tool filter,
  invalid-window 400, per-day breach buckets without double-counting)

### Migration

Zero migration required. Existing users who upgrade get the new
dashboard page automatically when they next run `ctxloom dashboard`.
Users who haven't enabled telemetry see an empty-state callout
explaining how to opt in.

### Companion non-npm work

- [kodiii/ctxloomAPP #32](https://github.com/kodiii/ctxloomAPP/pull/32)
  refreshes the marketing landing + docs pages with v1.4.0–v1.5.1
  features (`ctx_get_minimal_context`, `--host=<id>`, Agent-First
  Harness, prepackaged skills, task-tool budget enforcement,
  telemetry-learned suggestions). Auto-deploys via the hosted
  pipeline — no npm release tied to it.

---

## [1.5.1] — 2026-05-18

Patch release — hardening cohort surfaced by v1.5.0's multi-agent
dogfood review. Six small, thematic items: 1 correctness fix +
1 API-hygiene change + 4 regression-tripwire tests. None block any
v1.5.0 user; all reduce future regression risk.

### Fixed

- **M2 — Per-sample `original_tokens` clamping in the telemetry
  learner.** Pre-fix `clampTokens` ran on the AVERAGE; a single
  poisoned event with `Number.MAX_SAFE_INTEGER` and `n=1` produced
  a misleading `estimated_tokens: 100000`. Post-fix every
  observation is clamped to `[0, 100000]` BEFORE accumulation, so
  even a corrupted telemetry file yields sane suggestions.
  (\`packages/core/src/budget/learnedSuggestions.ts:185-193\`)
- **L1 — Case-fold-aware `safeJoin()` containment check.** Pre-fix
  the install-time path check used case-sensitive \`startsWith\` on
  macOS/Windows where the filesystem is case-insensitive (APFS /
  NTFS). Post-fix the comparison case-folds on those platforms;
  Linux behavior unchanged (\`toLowerCase()\` no-op when strings
  already match). No known active exploit — defense in depth.
  (\`packages/core/src/install/installer.ts:187-204\`)

### Changed (API hygiene)

- **M3 — `@internal` annotation on test-only exports.**
  \`__resetTaskBudgetTrackerForTests\` and
  \`__resetLearnedSuggestionsCacheForTests\` are now exported with
  `@internal` JSDoc + the root tsconfig gains `stripInternal: true`.
  Signal to IDE autocomplete + future doc tooling that these are
  test hooks, not public API. Runtime symbols stay accessible
  (so the global vitest setup still works).
  (\`packages/core/src/index.ts:251-289\`, \`tsconfig.json:18\`)

### Tests (regression tripwires)

- **M4 — Privacy-sentinel grep for learner output.** Mirrors the
  PR #140 sentinel-grep contract. Tests seed events with sentinel
  fields (\`path\`, \`query\`, \`stack\`, \`args\`, \`error\`); assert
  \`JSON.stringify(getLearnedRules(...))\` excludes every sentinel.
  Plus a structural allowlist test pinning the four documented
  suggestion fields (\`tool\` / \`args\` / \`why\` / \`estimated_tokens\`).
  (\`tests/LearnedSuggestions.test.ts\`)
- **L5 — Drift pin on host adapter rendered content.** Pre-fix the
  host-adapter tests only smoke-checked the orientation anchor
  mention. Post-fix every adapter is pinned to four load-bearing
  sections (graph-first directive, anchor, \`next_tool_suggestions\`
  reference, token-budget protocol) AND a size envelope (1–5 KB).
  A refactor that trims structural content fails CI.
  (\`tests/InstallHostMatrix.test.ts\`)
- **L6 — Tighten `renderSummary` integration assertion.** Pre-fix
  the bot-section integration test asserted only "header present
  before footer." Post-fix the test computes the expected slash-
  command list, asserts every command actually appears in the
  rendered body, AND that they appear in the expected order. A
  bug that emitted an empty section would now fail CI.
  (\`apps/pr-bot/tests/suggestedNextSteps.test.ts\`)

### Tests

- 1203 → 1214 root (+11 net); 306 → 308 pr-bot (+2 net)

### Deferred to future

- L2 (DoS softener — not actionable yet), L3 (TaskBudgetPolicy
  refactor — bigger scope), L4 (budget.ts barrel split — moderate
  refactor), L7 (cache-eviction stampede — needs async refactor).
  All non-blocking; track separately.

---

## [1.5.0] — 2026-05-18

**Phase 4 — Agent-Harness completion.** v1.4.0 shipped the
harness layer (self-guiding API + install pipeline + skills).
v1.5.0 adds the four hardening pieces that were planned to follow:
server-enforced call budget, telemetry-learned suggestions, PR-bot
integration, and cross-agent host matrix. Every Phase 4 finding
from the agent-harness plan
([docs/superpowers/plans/2026-05-18-agent-harness.md](docs/superpowers/plans/2026-05-18-agent-harness.md))
is now shipped.

### Added

- **Server-enforced task-tool budget** (#152). The ≤8-call protocol
  target is now ENFORCED in \`ToolRegistry.dispatch\` instead of
  living only in CLAUDE.md prose. Agents exceeding the ceiling
  (default 8 calls, override via \`CTXLOOM_TASK_TOOL_BUDGET=N\`) get
  their arguments transparently overridden to skeleton/minimal mode
  — the bot can't ignore the rule and burn unbounded tokens.
  Inactivity gap (90s) auto-resets the budget for the next task.
  Five tools exempt from counting: \`ctx_get_minimal_context\` (the
  orientation anchor must always be reachable), \`ctx_status\`,
  \`ctx_get_workflow\`, \`ctx_get_rules\`, \`ctx_suggested_questions\`.
  Single \`mcp.task_budget.exceeded\` telemetry event per breach
  (log-flood safe). Honors the existing \`CTXLOOM_DISABLE_BUDGET=1\`
  kill switch.
- **Telemetry-learned \`next_tool_suggestions\`** (#153). Opt-in via
  \`CTXLOOM_LEARNED_SUGGESTIONS=1\`. Mines
  \`~/.ctxloom/telemetry/budget-events-*.jsonl\` to derive tool-
  transition rules from real usage (≥3 samples per pair, default
  14-day window). Replaces author-curated static rules from
  v1.4.0's Phase 1b where data exists, falls through to static
  otherwise. Token estimates filled from observed
  \`original_tokens\` averages — agents see real cost shape, not
  author guesses. Cached 1h; ~0ns per-call cost.
- **PR-bot suggests Phase 3 skills** (#155). Every review comment
  now ends in a "Suggested next steps" section with risk-tiered
  slash-command recommendations the PR author can paste into local
  Claude Code. Recommendations: always \`/ctxloom-review-pr <N>\`;
  high/medium risk + top-importer file → \`/ctxloom-blast <file>\`;
  multi-file + non-low risk → \`/ctxloom-coverage-gap\`; large diff
  (≥10 files) → \`/ctxloom-explore\`. Wrapped in \`<details>\` so it
  doesn't dominate the comment.
- **Cross-agent host matrix** (#154). \`ctxloom init --host=<id>\`
  writes rule files for additional agent hosts beyond
  Claude/AGENTS/Gemini. Supported ids: \`cursor\` →
  \`.cursorrules\`, \`aider\` → \`CONVENTIONS.md\`, \`copilot\` →
  \`.github/copilot-instructions.md\`, \`windsurf\` →
  \`.windsurfrules\`. \`--host=all\` expands to every adapter;
  comma-separated values + multiple flags merge. Unknown ids drop
  with a warning (not a hard failure). All paths go through the
  same \`safeJoin()\` boundary as Phase 2.

### Privacy + security (cross-cutting)

- Task-budget tracker is process-local — no IPC, no disk
  persistence, no user input persisted in tracker state.
- Telemetry learner reads only event name + tool name + token
  counts (privacy contract pinned by PR #140). Allowlist filter
  drops references to deleted/renamed tools. Token estimates
  clamped to [0, 100000]. Parse failures fall through to empty →
  static rules take over.
- PR-bot suggested-steps section built from author-controlled
  static templates + PR metadata only (number, file paths from
  \`changedFiles\`). No content from the diff itself echoed.
- Cross-agent host adapters render via author-controlled templates
  — no user input in generated files.

### Tests

- 1133 → 1201 (+68 net across the cohort):
  - 22 task-budget tests (counter, inactivity gap, kill switch,
    env override, arg injection, dispatch integration)
  - 17 telemetry-learner tests (transition counting, session-gap
    boundaries, allowlist, token aggregation, cache, robustness,
    suggestNext integration, opt-in gate)
  - 29 host-matrix tests (adapter registry, --host opt-in,
    \`all\` expansion, dedup, unknown-id warning, idempotency,
    drift recovery, dry-run, path safety, content shape)
- 287 → 305 PR-bot tests (+18 suggested-steps tests: risk-tiered
  recommendations, top-file picking, Markdown shape, integration
  ordering)

### Migration

Zero migration required. All changes are additive or behind opt-in
flags:

- Task budget enforcement: triggered only when an agent exceeds 8
  calls. Existing agents that stay under the protocol target see
  no change.
- Learned suggestions: opt-in via \`CTXLOOM_LEARNED_SUGGESTIONS=1\`.
  Default behavior is the v1.4.0 static rules.
- Cross-agent hosts: opt-in via \`--host=<id>\`. Default install is
  unchanged from v1.4.0.
- PR-bot suggested-steps section: always present, wrapped in
  \`<details>\` so it's collapsed by default.

### Looking forward

Phase 4 closes the agent-harness implementation arc. v1.5.x
follow-ups will tune the constants (per-tool
\`DEFAULT_MAX_RESPONSE_TOKENS\` from real p75 telemetry, learner
defaults from observed adoption) once usage data accumulates.

---

## [1.4.0] — 2026-05-18

**Agent-First Harness** — the headline shift in v1.4.0. ctxloom now
ships a self-installing harness that makes ctxloom MCP tools the
*path of least resistance* for any agent host (Claude Code, Gemini
CLI, generic). Closes the gap with code-review-graph's "forced-use"
model — but with stronger primitives (HMAC-pinned blocks, response
budgets already in place, PR-bot pipeline already wired).

The strategic shift: pre-1.4 relied on the agent **remembering** to
use ctxloom (via free-text rules in CLAUDE.md). v1.4 makes the
harness decide — via prepackaged skills, SessionStart guidance,
PostToolUse auto-update, and a self-guiding API surface.

### Added

- **\`ctx_get_minimal_context\` — the orientation anchor** (#148).
  Mandatory first MCP call in any ctxloom workflow. Returns
  ~150 tokens covering graph readiness, recent working-tree
  changes, top hub nodes, and a **task-aware** suggested-first-tool.
  Pass \`task\` ("review PR 142", "rename X", "check coverage") and
  regex routing picks the most-fitting follow-up. Each suggestion
  carries \`estimated_tokens\` so the agent can budget the next call.
  Cache: 10s TTL keyed on \`(project_root, task)\` — multiple agents
  asking in quick succession get cached answers (<5ms).
- **\`next_tool_suggestions\` on every budget-wrapped response** (#148).
  Author-curated follow-ups with \`why\` reasoning + token-cost
  estimates. Zero per-call cost (static lookup, ~0ns). Capped at 3
  entries per response. Drift test asserts every rule's source AND
  target tool name is a real registered tool — typos / deleted tools
  fail CI.
- **\`ctxloom init\` writes the harness layer** (#149). New flags
  \`--skip-harness\` / \`--dry-run\` / \`--force\`. Files written:
  \`CLAUDE.md\`, \`AGENTS.md\`, \`GEMINI.md\` (HMAC-signed agent-rule
  blocks), \`.claude/hooks.json\` (SessionStart + PostToolUse),
  \`.claude/hooks/session-start.sh\` (banner). All idempotent.
- **HMAC-pinned templated blocks** (#149). Each agent-rule block is
  wrapped with \`<!-- BEGIN CTXLOOM-RULES v:1 hmac:sha256:... -->\`
  markers. On re-install: intact + canonical → no-op; drift detected
  + content matches canonical → update in place; HMAC mismatch
  (hand-edited) → refuse to clobber, warn unless \`--force\`. The
  HMAC is for **drift detection, not security** — anyone with
  source can compute it; goal is catching good-faith hand-edits.
- **SessionStart hook** (#149, \`.claude/hooks/session-start.sh\`).
  Prints orientation banner with graph stats at every Claude Code
  session start. Uses \`ctxloom status --json\` (cached <100ms).
- **PostToolUse hook** (#149, matcher \`Write|Edit\`). Auto-runs
  \`ctxloom update --incremental --quiet\` after every agent file
  edit. **Belt-and-suspenders** with the live file watcher: if the
  watcher dies, the hook still keeps the graph fresh.
- **Six prepackaged Claude Code skills** (#150). Slash commands that
  orchestrate ctxloom tool sequences:
    - \`/ctxloom-explore\` — architecture overview + communities + hubs
    - \`/ctxloom-blast <symbol>\` — blast radius + callers + flows + coverage
    - \`/ctxloom-refactor-safely <old> <new>\` — preview-before-apply rename
    - \`/ctxloom-coverage-gap\` — knowledge gaps scored by callers + churn + risk
    - \`/ctxloom-review-pr <PR>\` — multi-tier PR review (mirrors the bot)
    - \`/ctxloom-budget-stats\` — wraps the CLI inline
  Every skill enforces three invariants (drift-tested):
  opens with \`ctx_get_minimal_context\`, has explicit
  Steps + Budget sections, references only real registered tool names.

### Changed (internal)

- \`EnforceBudgetOptions\` gains an optional \`ctx\` field (existing
  callers unaffected; #148 wiring).
- \`BudgetMeta\` gains optional \`next_tool_suggestions: NextToolSuggestion[]\`
  (only present when source tool has author-curated rules — #148).
- \`@ctxloom/core\` barrel exports new installer + skill APIs
  (\`installHarness\`, \`CTXLOOM_SKILLS\`, \`computeBlockHmac\`,
  \`extractBlock\`, \`verifyBlock\`, \`upsertBlock\` — for tests +
  future tooling that wants to inspect the templated blocks).

### Security

- All harness writes go through a \`safeJoin()\` helper that resolves
  paths and refuses writes outside the project root — symlink-
  resistant. Tested.
- Generated \`session-start.sh\` is POSIX-portable (no bashisms); no
  user-controllable env vars echoed; hardcoded relative DB path.
- \`task\` input to \`ctx_get_minimal_context\` is sanitized (control
  chars stripped, Zod cap at 200 chars), **never** echoed into the
  response body. Used only for regex routing + privacy-preserving
  telemetry.

### Compare table (vs code-review-graph)

| Layer | code-review-graph | ctxloom v1.4.0 |
|---|---|---|
| \`.mcp.json\` shipped in repo | ✅ | ✅ |
| SessionStart hook | ✅ | ✅ |
| PostToolUse auto-update | ✅ | ✅ |
| Prepackaged skills | ✅ 7 | ✅ 6 |
| Self-guiding API (\`get_minimal_context\` + \`next_tool_suggestions\`) | ✅ | ✅ |
| Response budgets / skeleton-first | ❌ | ✅ |
| PR-bot multi-agent reviews | ❌ | ✅ |
| Multi-project state | ❌ | ✅ |
| HMAC-pinned blocks (drift detection) | ❌ (version hash only) | ✅ |
| Task-aware first-tool routing | ❌ (static) | ✅ |
| Token-cost estimates per suggestion | ❌ | ✅ |

### Tests

- 1041 → 1133 (+92 net across the cohort)
- 36 minimal-context + next-tool-suggestions tests (#148)
- 30 installer + HMAC-block tests (#149)
- 18 skill installation + content drift tests (#150)

### Migration

**Zero migration required.** Every change is additive:

- \`ctx_get_minimal_context\` is a new tool; pre-1.4 callers don't see it
- \`next_tool_suggestions\` only attaches when callers opt into the
  budget surface (existing behavior — \`hasBudgetArgs\` gate)
- \`ctxloom init\` keeps its pre-Phase-2 behavior with \`--skip-harness\`
- Pre-1.4 \`init\` users automatically get the new harness files on
  next re-run (idempotent)

### Roadmap forward (Phase 4 — v1.5.x)

- **4a** Server-enforced graph-call budget (≤8 tool calls per task)
- **4b** Telemetry-learned \`next_tool_suggestions\` (replaces static rules)
- **4c** PR-bot integration with the new skills
- **4d** Cross-agent host matrix (\`ctxloom init --host=cursor|aider|copilot\`)

---

## [1.3.1] — 2026-05-18

Patch release. Closes the dogfood follow-up cohort surfaced by PR #135's
multi-agent review and the Phase B A/B gate. Two real user-facing bug
fixes; everything else is internal hardening with zero behavior change
on the default code path.

### Fixed

- **`ctxloom budget-stats` no longer blocked by the license gate** (#138).
  The CLI integration test added in TEST-135-3 discovered the diagnostic
  command was being routed through `ctxloomLicenseGate` despite being a
  purely local read-only operation (parses JSONL under
  `~/.ctxloom/telemetry/`). Added to `LICENSE_GATE_BYPASS_COMMANDS`
  alongside `status` / `--help` / `trial` / `activate`. Users in
  license-recovery scenarios (expired / revoked / network-failing
  validate) can now inspect telemetry exactly when it matters most.
- **`CTXLOOM_TELEMETRY_DIR` env path sanitized** (#146 → closes #142).
  Pre-fix, `telemetryDir()` returned the raw env value verbatim, so an
  operator typo (`/etc/foo`) or a relative path silently created
  directories under unintended roots. Now rejects values containing
  `..` or non-absolute paths with a one-time `logger.warn`, falling back
  to the home default. Defense in depth.
- **First `appendFileSync` failure now surfaces a single warn** (#146 →
  closes #143). EACCES / ENOSPC / EROFS / misconfigured-dir errors were
  swallowed silently — operator got zero signal that telemetry
  persistence was broken. Now the first failure emits one
  `logger.warn` with the error message; subsequent failures stay
  silent (no log flooding). MCP server still never faults on telemetry
  errors.
- **`readEvents` drops malformed-timestamp events** (#146 → closes #144).
  `new Date('not-a-date').getTime()` is `NaN`, and `NaN < x || NaN > x`
  are both false — so corrupted timestamps silently passed the boundary
  filter and contaminated `budget-stats` percentile calculations. One-
  line `Number.isFinite` guard before the boundary check.

### Changed (internal — no user-visible behavior change)

- **Injectable `TelemetrySink`** (#139 → closes ARCH-135-1 scope).
  Refactored `emitTelemetry(event, sink = diskSink)` and added
  `EnforceBudgetOptions.sink` so callers can swap the default disk-JSONL
  transport for in-memory / Sentry / OTLP / dashboard ring-buffer sinks.
  Default behavior identical.
- **`TelemetrySink` contract hardened** (#140 → closes M1/L3/L4 from #139
  dogfood). `emitTelemetry` now wraps `sink.append(event)` in
  `try/catch` so third-party sinks that throw cannot fault the tool
  call. Privacy contract pinned as a regression test (sentinel-grep +
  key allowlist). The default-sink test strengthened from shape-only to
  spy-based.
- **`ServerContext.telemetrySink`** (#145 → closes #141).
  Process-level transport, picked once at boot. `enforceBudget` resolves
  `opts.sink ?? opts.ctx?.telemetrySink ?? diskSink`. Wiring a non-disk
  sink (Sentry breadcrumbs, OTLP, dashboard) is now a one-line change at
  the boot site instead of touching all 12 instrumented tool registrars.

### Dogfood notes

- Phase B A/B dogfood gate (Part 2 of #107) ran on PR #139 — provisional
  pass after #140 + #145 + #146 closed the four cross-branch findings.
  See issues #141 / #142 / #143 / #144 (all closed by this release).
- Remaining Phase B work: per-tool `DEFAULT_MAX_RESPONSE_TOKENS` tuning
  from real-world p75 (calendar-gated, ~2w usage window). Will land in
  a future patch as data accumulates.

---

## [1.3.0] — 2026-05-17

Coordinated release marking **Phase B complete**: skeleton-first
response budgets are now enforced server-side on all 12 source-returning
MCP tools (was: prompt-layer guidance only). Marketing claim updated
from *"skeleton-first via `ctx_get_context_packet`"* to *"skeleton-first
across all source-returning tools, server-enforced budgets, no quality
loss"*.

### Highlights

- **Response Budgets** (#106) — all 12 source-returning tools accept
  three new optional input fields (`max_response_tokens`,
  `on_budget_exceeded`, `response_format`) and wrap their response in a
  `{data, meta}` envelope when any field is set. Defaults activate only
  when opted in; pre-1.3 callers see zero behavior change. Over-budget
  responses auto-substitute a Skeletonizer signature view (or a
  per-tool-specific lighter form) rather than dumping 50KB of source.
  See [README → Response Budgets](README.md#response-budgets-v127) and
  [docs/skeleton-first.md](docs/skeleton-first.md).
- **Multi-language Skeletonizer coverage** (#105) — 8 of 11 languages
  production-ready with full fixture suite (Python, Go, Rust, Java, C#,
  Ruby, PHP, Dart); Kotlin/Swift pinned with tripwires pending CDN
  grammar availability.
- **`CTXLOOM_DISABLE_BUDGET=1` kill switch** — documented escape hatch
  for the soak period. Server-side env var; silently ignores all budget
  args.
- **`CTXLOOM_TELEMETRY_LEVEL=full`** — emits structured
  `mcp.budget.exceeded` and `mcp.fallback.used` events to stderr for
  per-tool tuning telemetry. **Note:** additive to the existing
  `all`/`error`/`off` PostHog scope — see README Telemetry section.
- **pr-bot auto-prompt** — every PR review comment now ends in a
  collapsible `<details>` block containing a ready-to-paste deep-review
  prompt the user can drop into a local Claude Code session. Encodes
  the bot's pre-computed risk band, blast radius, top-risk files, and
  coverage status so the specialists skip the structural pre-fetch.
- **Hardened grammar loader** — fixed an unhandled-error crash that
  triggered on any repo containing a `.cs` file (or any future
  subdir-pathed wasm). Two-line root cause: missing parent-dir creation
  + `'error'` listener attached too late on the WriteStream.
- **`vscode-extension/` app dropped** — was not shipped; deletion frees
  ~11k lines and removes two CI workflows that pointed at an
  unpublished target. `cli-v*` tarball releases preserved (the build
  script moved to `scripts/cli-tarballs/`).

### Tests

- 805 → 953 across this release window (+148 net)
- 117 new tests covering the budget surface (36 infrastructure + 81
  per-tool integration)
- 10 multi-language Skeletonizer tests (8 active + 10 `it.todo` for
  the 2 grammar-blocked languages)
- 18 README↔source drift-detection tests prevent the defaults table
  from silently desyncing as per-tool budgets are tuned

### Migration

**Zero migration required.** Pre-1.3 callers that don't pass any of the
three new fields receive their existing raw response unchanged. The
budget surface is strictly opt-in.

### Known follow-ups (post-release)

- Telemetry collector — aggregate `mcp.budget.exceeded` /
  `mcp.fallback.used` events across sessions for per-tool p75
  derivation. Tracked in a follow-up issue.
- Per-tool default tuning — re-derive each tool's `DEFAULT_MAX_RESPONSE_TOKENS`
  from real usage data once ~2 weeks of telemetry accumulates.
- Specialist agent opt-in — add explicit `max_response_tokens` args to
  each ctxloom call inside the four reviewer-agent specs to let the
  budget surface kick in during the dogfood loop itself.

---

## [1.2.7] — 2026-05-17

### Added

- **Phase B2 budget surface (Part 4/5, batch of 7 remaining tools).**
  `ctx_git_diff_review`, `ctx_wiki_generate`, `ctx_find_large_functions`,
  `ctx_apply_refactor`, `ctx_refactor_preview`, `ctx_cross_repo_search`,
  and `ctx_execution_flow` all accept the three new optional input fields
  and emit a `{data, meta}` envelope when opted in. Per-tool skeleton
  fallbacks designed individually: `git_diff_review` drops `<skeleton>`
  blocks + omits transitive importers; `wiki_generate` downgrades to
  `detail_level=minimal`; `refactor_preview` drops per-change before/after
  but keeps the file summary; etc. Brings B2 to **12/12 source-returning
  tools wired**.
- **pr-bot auto-prompt feature.** Every review comment now ends in a
  collapsible `<details>` block with a ready-to-paste deep-review prompt
  for a local Claude Code session. The prompt encodes the bot's
  pre-computed risk band, blast radius, top-risk files (with coverage
  status), and suggested reviewers so the four specialists skip the
  structural pre-fetch and start straight on per-domain analysis.

### Tests

- 893 → 953 (+60: 42 B2.4 budget integration + 18 drift detection)

---

## [1.2.6] — 2026-05-17

### Added

- **Phase B2 budget surface (Parts 1–3/5).** Shared infrastructure
  module ([`packages/core/src/budget/budget.ts`](packages/core/src/budget/budget.ts))
  + pilot integration into `ctx_get_file` + first batch of 4 tools
  (`ctx_get_definition`, `ctx_get_context_packet`, `ctx_search`,
  `ctx_full_text_search`). Includes the `enforceBudget()` fallback
  ladder, `CTXLOOM_DISABLE_BUDGET=1` kill switch, and
  `CTXLOOM_TELEMETRY_LEVEL=full` event emission. **66 new tests.**
- **Multi-language Skeletonizer coverage** (#105 Phase B1). 10
  fixture files + 50 per-language assertions for Python, Go, Rust,
  Java, C#, Ruby, PHP, and Dart. Kotlin and Swift gated behind
  `it.todo` pending grammar availability.
- **`packages/core/src/grammars/GrammarLoader.ts` hardening.** Two-line
  fix for an unhandled `'error'` event crash that triggered on any
  repo containing a file in a language whose `wasmFile` lives in a
  subdirectory (originally surfaced on `.cs` files in CI). Root cause:
  missing parent-dir `mkdirSync` + `'error'` listener attached inside
  the `https.get` callback (too late). Fix attaches the listener
  synchronously and creates `path.dirname(dest)` recursively before any
  I/O. End-to-end win: C# grammar (which had been failing silently on
  every CI run) now works.
- **Go / Ruby / Dart skeleton import preservation.** Three independent
  parser fixes in `ASTParser.ts`: `parseGo` now emits a wrapping
  `import` node covering the full `import (...)` block; `parseRuby`
  emits import nodes for `require` / `require_relative` / `load` /
  `autoload` calls; `parseDart` removes the relative-only filter and
  recursively descends into the deeper `library_import → ... → uri`
  tree to find Dart's import URI.

### Changed

- **Dropped the `apps/vscode-extension/` workspace.** Not shipped;
  removal frees ~11k lines from the tree and removes two CI workflows
  that pointed at an unpublished target. The CLI tarball release
  channel (`cli-v*` tag pushes) is preserved — the build script that
  used to live under `apps/vscode-extension/scripts/` was moved to
  `scripts/cli-tarballs/`.
- **pr-bot machine-block security fix.** The `extractRowFromComment`
  merge order now places `...machine` first and pins identity fields
  (`pr`, `url`, `title`, `posted_at`, `source`) after the spread. A PR
  comment author with prompt-injection authority can no longer overwrite
  those identity fields in the committed `dogfood-telemetry.jsonl`.
- **pr-bot summary cohort coherence.** Six small follow-ups from the
  PR #115 dogfood (telemetry pipeline test coverage). Closes the cohort.

### Tests

- 805 → 893 (+88: 66 B2 infrastructure/integration + 22 B1 multi-language)

---

## [1.2.5] — 2026-05-14

### Changed

- **pr-bot summary: hide `(score: 20%)` parenthetical on low-risk
  PRs.** The hardcoded `low → 0.20` score made every benign change
  read as "20% risky" when the label `Low risk` already said
  everything. Now the parenthetical only renders for
  `medium`/`high`/`critical`, where the magnitude actually helps a
  reviewer distinguish "borderline" from "deeply broken".
- **pr-bot summary: drop empty Risk breakdown `<details>` block.**
  When every changed file is `low` there's nothing to put in the
  table; the previous output rendered just the markdown headers
  with no rows, which looked like a bug. The section is now skipped
  entirely on benign PRs.

### Notes

- Both fixes are output-side only; the underlying risk scoring is
  unchanged. The first dogfood run after v1.2.5 ships (and the v1
  image is retagged) will produce a noticeably cleaner summary on
  docs-only / trivial PRs.

---

## [1.2.4] — 2026-05-14

### Fixed

- **pr-bot Docker image trusts `/github/workspace`.** GitHub Actions
  mounts the checkout as one uid and runs the action container as
  another (root), which trips git's "dubious ownership" guard.
  Every `git log` call from the action's `GitOverlayStore` failed,
  the overlay came back empty, and risk scoring was degraded. The
  Dockerfile now runs `git config --system --add safe.directory '*'`
  at build time.
- **Inline review comments use valid diff line numbers.** The
  renderer was hardcoding `line: 1`, which GitHub's review API
  rejected with `422 Line could not be resolved` whenever line 1
  wasn't in the PR diff (almost always). `runReview` now parses
  each file's patch from `pulls.listFiles` to find the first line
  on the RIGHT side of the first hunk and passes that to
  `renderInline`. Files where no valid line can be found (binary,
  rename without content change) get skipped instead of failing the
  whole review.
- **Inline + check-run failures no longer kill the review.** Both
  steps are wrapped in their own try/catch with `captureError`.
  The summary comment is the most valuable output; one of the
  optional steps throwing shouldn't blow up the whole bot.
- **Risk scorer no longer flags doc-only PRs as `medium`.** A change
  touching only `README.md` (or `CHANGELOG.md`, `LICENSE`, lockfiles,
  images) was coming back at 50% risk because the scorer penalized
  "no test coverage" for every file. Now non-source files
  (extensions `.md/.mdx/.txt/.rst/.adoc`, lockfiles, images, and
  basenames like `README`, `LICENSE`, `CHANGELOG`, `NOTICE`,
  `AUTHORS`) skip the coverage penalty and start at `low`. A
  non-source hub still escalates to `high`. JSON/YAML/TOML configs
  are deliberately **not** in the list — `package.json`,
  `tsconfig.json`, and workflow yaml all affect runtime behavior.
- **pr-bot review comment footer no longer advertises dead slash
  commands.** The Probot-era `/ctxloom explain | ignore | refresh`
  handlers were deleted when pr-bot pivoted to a fire-and-forget
  GitHub Action (PR #83) — the Action doesn't listen to
  `issue_comment` events. The footer now links to the README and
  the issue-filing form.

### Notes

- CLI behavior is unchanged; the scorer fix is in `@ctxloom/core`'s
  `detectChanges` (used by both the CLI's `ctx_detect_changes` tool
  and the pr-bot Action). To pick up the new behavior on the Action,
  the v1 image gets rebuilt on every `v*` tag.

---

## [1.2.3] — 2026-05-14

### Fixed

- **pr-bot Docker image now includes `git`.** The runtime image is
  `node:22-slim`, which doesn't ship git. The action shells out to
  git via `simple-git` (inside `@ctxloom/core`'s `GitOverlayStore`
  for co-change history), so every invocation crashed with
  `spawn git ENOENT`. Added `apt-get install -y git ca-certificates`
  to the runtime stage. Image grows by ~30 MB; cold pull from GHCR
  stays under 5 s.
- **GHCR pre-built image pipeline** introduced in PR #89: the
  Docker action references `docker://ghcr.io/kodiii/ctxloom-pr-bot:v1`
  instead of `image: 'Dockerfile'`, because GitHub's built-in
  Dockerfile resolution can't see across workspace packages in a
  monorepo. New \`.github/workflows/pr-bot-publish-image.yml\` builds
  with the monorepo root as Docker context on every `v*` tag push.

### Notes

- CLI behavior is unchanged. This release is strictly to ship the
  fixed Docker image to the GHCR registry under the `v1` tag.

---

## [1.2.2] — 2026-05-14

### Added

- **`ctxloom install-pr-bot`** — new CLI command that drops
  `.github/workflows/ctxloom-review.yml` into the current repo so every
  PR is reviewed by the ctxloom GitHub Action. Detects the repo's
  default branch from git (handles any default, not just `main`/`master`),
  refuses to install outside a git repo, refuses to overwrite an
  existing workflow unless `--force` is passed, and accepts a `--ref`
  to pin to a specific Action release tag (default: `v1`).
- **`ctxloom setup` now offers to install the PR-bot workflow** as an
  optional final step. Skipped in non-interactive mode and when the
  user declines; the wizard's primary MCP-client configuration has
  already succeeded by that point.
- 7 new tests in `tests/InstallPrBot.test.ts` covering the
  git-repo gate, file creation, default-branch detection (works on
  unborn HEADs), `--force` semantics, and `--ref` pinning.

---

## [1.2.1] — 2026-05-14

### Changed

- **`@ctxloom/core` heavy native deps now lazy-load.**
  `@huggingface/transformers` (embedder), `@lancedb/lancedb`
  (vector store), and `web-tree-sitter` (AST parser) used to be
  imported eagerly at module load. They are now `await import(...)`'d
  inside the functions that use them (`loadEmbedder`, `VectorStore.init`,
  `ASTParser.init`). User-visible effect: identical — the actual
  download / instantiation paths fire at the same moments. Internal
  effect: consumers that don't index code (e.g. the new `apps/pr-bot`
  Action) ship without ~450 MB of native bindings in their
  distribution. CLI behaviour and timing are unchanged.

### Added

- **`apps/pr-bot` ships as a Docker GitHub Action** (replaces the
  previous Probot/Fly hosted-app design that never deployed). Install
  with `uses: kodiii/ctxloom/apps/pr-bot@v1` in any repo's workflow.
  Posts risk-scored summary comments, inline review notes, and
  optionally a check-run that can block merge. No LLM calls, no
  hosted service, no per-PR cost — analysis runs entirely inside the
  consumer's CI. Documented in [`apps/pr-bot/README.md`](apps/pr-bot/README.md).
- **`scripts/clean-stale-src-artifacts.mjs` walks every workspace
  package's src/**, not just the root. Removes stale `.js`/`.d.ts`
  files left over from long-ago `tsc` runs that silently shadow
  refactored `.ts` sources. Allowlists `tailwind.config.js` /
  `postcss.config.js` to preserve legitimate JS configs.

### Internal

- pr-bot maturity sweep (PR #82): CI workflow, `captureError`
  wiring, per-installation rate limiting, `PRIVATE_KEY` hardening,
  cache eviction, Dockerfile HEALTHCHECK, JSON Schema for
  `.ctxloom.yml`, 22 new tests. These shipped with the Probot
  design and were superseded by the Action pivot in PR #83; the
  observability + JSON Schema bits carried over.

---

## [1.2.0] — 2026-05-14

### Added

- **First-run telemetry notice.** The first time a CLI command runs on
  a machine, ctxloom prints a one-time stderr banner explaining that
  anonymous telemetry is on, what's never collected, and how to disable
  it. A marker at `~/.ctxloom/telemetry_notice_shown` (mode `0o600`)
  ensures it appears at most once per machine. Skipped automatically in
  MCP stdio mode (where stdout/stderr is the protocol channel) and when
  telemetry is already disabled. Brings ctxloom in line with industry
  practice (Homebrew, npm, etc.).
- **Granular telemetry levels** via `CTXLOOM_TELEMETRY_LEVEL`:
  - `all` (default) — PostHog events + Sentry errors
  - `error` — Sentry errors only (no usage analytics)
  - `off` — both backends silent
  Mirrors VS Code's `telemetry.telemetryLevel`. Legacy
  `CTXLOOM_NO_TELEMETRY=1` and `DO_NOT_TRACK=1` continue to work and
  force `off`.
- **`docs/TELEMETRY.md`** — public, exhaustive documentation of every
  event, every property, what is never collected, how project paths are
  anonymized via SHA-256 truncation, and how stack frames are scrubbed
  before reaching Sentry. Linked from the README's new Telemetry
  section.
- **`getTelemetryLevel()`** and **`shouldShowTelemetryNotice()`**
  exported from `@ctxloom/core` for use by downstream integrations and
  the CLI entrypoint.

### Notes

- The CLI surface gains exactly one new env var
  (`CTXLOOM_TELEMETRY_LEVEL`). No existing behavior changes for users
  who set nothing.
- The notice is skipped when `command === undefined` (MCP server mode)
  so it never corrupts JSON-RPC over stdio.

---

## [1.1.5] — 2026-05-14

### Fixed

- **Dashboard browser telemetry now actually reaches PostHog.** v1.1.3
  shipped browser-side `dashboard_loaded` / `dashboard_page_viewed`
  events that the dashboard server accepted (`204 No Content`) but then
  silently dropped because the dashboard server's tsup config
  (`apps/dashboard/tsup.server.config.ts`) had no `define` block. The
  bundled-in `@ctxloom/core` telemetry module fell back to an empty
  `POSTHOG_KEY` and short-circuited every event in the
  `if (!POSTHOG_KEY) return` guard. Added the missing `define` block so
  `__TELEMETRY_POSTHOG_KEY__`, `__TELEMETRY_SENTRY_DSN__`, and
  `__CTXLOOM_VERSION__` are baked in at build time, mirroring the root
  CLI bundle.
- **Publish smoke test extended** to scan the dashboard server bundle
  for the empty-fallback pattern, not just the CLI bundle. Would have
  caught this bug at v1.1.3 publish time.

### Notes

- CLI telemetry (`project_resolved`, `multi_project_active`,
  `tool_dispatched`, etc.) was never affected — only browser events
  routed through the dashboard server's `/api/telemetry/event` proxy.

---

## [1.1.4] — 2026-05-13

### Added

- **Sentry sourcemap upload on every tagged release.** New GitHub
  Actions workflow `.github/workflows/sentry-sourcemaps.yml` triggers
  on `v*` tag push, builds all three release artifacts (CLI bundle,
  dashboard server bundle, dashboard client bundle), and uploads their
  sourcemaps to Sentry with `--include-sources` so the original
  TypeScript/TSX content is embedded directly into the `.map` files.
  Sentry events from v1.1.4 onward show fully demangled stack traces
  with original filenames, line numbers, and inline source.
- Vite client build now emits sourcemaps (`build.sourcemap: true`).
- `@sentry/cli` added as a devDependency for the workflow.

### Notes

- Sentry release name = bare version (e.g. `1.1.4`), which already
  matches the `tags.release` field on every Sentry event payload.
- Requires three GitHub repo settings to take effect: `SENTRY_AUTH_TOKEN`
  secret + `SENTRY_ORG` and `SENTRY_PROJECT` variables. If any are
  unset, the workflow logs a warning annotation and exits cleanly — the
  release tag push does not fail.

---

## [1.1.3] — 2026-05-13

### Added

- **Dashboard browser telemetry.** The React dashboard now fires two
  PostHog events: `dashboard_loaded` (once per session, on initial app
  mount) and `dashboard_page_viewed` (on every route change, with
  `path` as the only payload). All events carry `surface: 'dashboard'`
  so they can be filtered separately from CLI/MCP events in PostHog.
- **Dashboard server telemetry proxy.** New endpoints under
  `/api/telemetry`:
  - `GET /identity` — returns `{ enabled }`, honors
    `CTXLOOM_NO_TELEMETRY=1` / `DO_NOT_TRACK=1`
  - `POST /event` — validates against a hardcoded 2-event allowlist
    (`dashboard_loaded`, `dashboard_page_viewed`) before forwarding to
    `@ctxloom/core` `track()`. The browser cannot forge `license_*` or
    `project_*` events.
  - `POST /error` — caps `message` at 2000 chars and `stack` at 10000
    chars, forwards to `captureError`
- Browser inherits the v1.1.2 stable UUID identity, alias-once
  migration, `release` tag, and stack-frame scrubbing for free — the
  proxy resolves identity via the existing module-level cache in
  `@ctxloom/core`.

### Notes

- The browser never sees the PostHog write-key or the user's
  `distinct_id`; events are posted to the dashboard's own server and
  the server forwards them.
- React `ErrorBoundary` auto-capture, project-switch tracking, and
  search/graph-click events are intentionally deferred.

---

## [1.1.2] — 2026-05-13

### Changed

- **Telemetry `distinct_id` is now a stable anonymous UUID** persisted at
  `~/.ctxloom/distinct_id` (mode `0o600`) instead of `os.hostname()`.
  Users who rename their machine or work across multiple machines remain
  a single user in PostHog instead of fragmenting across hostnames.
- **First event after upgrade fires a PostHog `$create_alias`** that
  merges the user's pre-1.1.2 hostname-keyed event history with the new
  UUID identity. Best-effort and idempotent — if the alias request
  fails, `alias_pending` stays on disk and the next event retries.
- **Internal `track(event, props)` signature** — the explicit
  `distinctId` argument is gone; the UUID is resolved internally on
  first call and cached for the process lifetime. CLI surface unchanged.
- **`captureError` now carries `distinct_id` in Sentry `extra` context**
  so Sentry incidents can be cross-referenced with the user's PostHog
  event stream.

---

## [1.1.1] — 2026-05-13

### Added

- **Multi-project instrumentation.** PostHog state-transition events
  (`project_resolved`, `project_first_touch`, `project_evicted`,
  `alias_registered`, `multi_project_active`, `kill_switch_active`,
  `project_resolution_failed`) plus 25% sampled `tool_dispatched`.
- **Sentry coverage** for all non-structured tool-dispatch errors,
  `initGraph` failures, `ensureVectorsInitialized` rejections, and
  LRU dispose failures. Structured resolver errors (`alias_not_found`,
  `no_default_project`, `project_root_not_found`) deliberately stay
  Sentry-free — they are user mistakes, captured to PostHog only.
- **Sentry `release` tag** on every captured event, sourced from
  `package.json` version via the existing `__CTXLOOM_VERSION__` build
  constant.
- **Client-side stack-frame scrubbing.** `/Users/<name>/`,
  `/home/<name>/`, and `C:\Users\<name>\` are replaced with `~/`
  before transmission.
- **Project paths are never sent.** All multi-project events carry an
  opaque `project_id` (first 16 hex chars of SHA-256 over the canonical
  path). Aliases are sent only as `alias_length`.
- **`hashProjectRoot()` and `EmittedOnceTracker`** exported from
  `@ctxloom/core` for downstream integrations.

### Compatibility

- `CTXLOOM_NO_TELEMETRY=1` and `DO_NOT_TRACK=1` continue to disable
  both backends.
- `distinct_id` remains `os.hostname()` (matches existing license
  funnels).

---

## [1.1.0] — 2026-05-13

### Added
- **Multi-project support** — every tool now accepts an optional `project_root` parameter (alias or absolute path)
  - `ctxloom register --alias <name> <path>` CLI command to register project aliases
  - `ProjectStateManager` with LRU eviction (cap 5, override via `CTXLOOM_MAX_PROJECTS`)
  - Multi-project view in `ctx_status` (active projects, registered projects)
  - First-touch auto-indexing: graph (sync, Tier 1) + vectors (deferred, Tier 2)
  - `<ctxloom_indexing>` envelope emitted on first-touch responses
  - Structured XML error responses for project-resolution failures (`alias_not_found`, `no_default_project`, etc.)
  - Dashboard `ProjectSwitcher` shows alias as primary label
  - `RepoRegistry` alias field + `findByAlias()`, `findByPath()` helpers
  - `CTXLOOM_DISABLE_MULTIPROJECT=1` kill switch for backward compatibility (reverts to v1.0.31 behavior)
- **`ctx_cross_repo_search`** — federated semantic search across all registered repos via `RepoRegistry` (persists to `~/.ctxloom/repos.json`)
- **`ctx_execution_flow`** — DFS call graph traversal from any entry point with cycle detection; annotates each step with file path and graph type (call/import)
- **`ctx_refactor_preview`** — read-only symbol rename diff preview; scans definition files and all importers, returns per-file before/after line diffs
- **`ctx_git_diff_review`** — all-in-one code review packet: git diffs + API skeletons + blast radius in a single call
- **`ctx_wiki_generate`** — generates `.ctxloom/wiki/` — one Markdown page per Louvain community, hash-cached (no LLM required)
- **`ctx_graph_export`** — exports import graph to GraphML (Gephi/yEd), DOT (Graphviz), or Obsidian wikilink vault
- **`ctx_community_list`** — Louvain community detection (pure JS via graphology); clusters files into architectural modules
- **`ctx_architecture_overview`** — high-level structural summary: communities, hub files, cross-community coupling
- **`ctx_knowledge_gaps`** — finds isolated files, untested hubs, dead code candidates
- **`ctx_surprising_connections`** — detects circular deps, cross-community imports, prod→test violations
- **`CallGraphIndex.getCallees()`** — forward lookup for execution flow traversal
- **`CallGraphIndex.findFilesForCallerSymbol()`** — resolves caller file when symbol index has no definition entry
- **`GoModuleResolver`** — resolves Go module-path imports (`github.com/myorg/myapp/...`) via `go.mod` parsing
- Go/Rust/Java import graph edges now use AST-parsed import nodes (more accurate than regex); falls back to regex if grammar unavailable
- `ctxloom register <path>` / `ctxloom repos` CLI commands for cross-repo search management
- Benchmark suite: real skeletonization compression measurement with per-file token table; CI posts results as PR comment

### Changed
- Import graph edge building for Go now uses `GoModuleResolver` for module-path imports (previously only resolved relative `./` paths)
- Benchmark `compression` section now calls `Skeletonizer.skeletonize()` directly — produces actual token counts instead of estimates
- README: updated to reflect all 22 tools, accurate comparison table, correct project structure

---

## [1.0.10] — 2026-05-07

### Fixed
- **First-run embedder protobuf race** — on a fresh install, `@huggingface/transformers` lazy-downloads the 90 MB ONNX model. onnxruntime occasionally raced the FS-cache flush and threw `"Protobuf parsing failed"`, losing the first 1–2 indexed files even though the file ended up correctly written. `getEmbedder()` now retries up to 3 times with 1s/2s backoff on protobuf-parse errors only (genuine corruption / network errors fail immediately as before). Also adds an in-flight singleton so concurrent first-call requests share one model load instead of racing N parallel downloads. New unit tests in `tests/EmbedderRetry.test.ts`.

---

## [1.0.9] — 2026-05-07

### Fixed
- **`npm install -g ctxloom-pro@1.0.8` failed with 404** — `@ctxloom/core` (private workspace package, never published to npm) was listed in `dependencies` so npm tried to resolve it from the registry and failed for every fresh install. Moved to `devDependencies` (it's bundled into dist via tsup `noExternal`, so it doesn't need to be a runtime dep). 1.0.8 is deprecated on the registry.

---

## [1.0.8] — 2026-05-07

### Security (full audit)
- **Shell injection in `ctx_git_diff_review` (P0)** — `exec(\`git diff -- "${file}"\`)` interpolated AI-controlled file paths into a shell string. A prompt-injected MCP client could pass `; rm -rf ~ #` and achieve RCE in the CLI process. Switched to `execFile` with argv (no shell); all `changed_files` now pass through `PathValidator.isWithinRoot()` before reaching git. [#29]
- **Path traversal + exec RCE in dashboard server** — `apps/dashboard/server/routes/{file,open}.ts` used `startsWith(root)` (prefix-confusion bypassable: `/home/u/foo` ≠ `/home/u/foobar` boundary) plus `exec(\`code ${JSON.stringify(abs)}\`)` which still parses backticks inside double-quoted shell strings. Fixed: explicit `path.sep` boundary check + `execFile('code', [abs])`. [#29]
- **Hardcoded PostHog key + Sentry DSN** — fallbacks in `packages/core/src/license/telemetry.ts` would have shipped real production credentials when the repo goes public. Replaced with tsup `define` build-time injection from `CTXLOOM_BUILD_POSTHOG_KEY` / `CTXLOOM_BUILD_SENTRY_DSN`. Empty fallback in source = silent local builds. [#29]
- **Telemetry opt-out** — telemetry was unconditional. Honors `CTXLOOM_NO_TELEMETRY=1` and the standard `DO_NOT_TRACK=1` env vars. [#29]
- **Dashboard CORS lockdown + `/api/health` info leak** — `cors()` allowed any origin; `/api/health` returned the absolute project path. Pinned to localhost-only; removed root from health response. [#29]
- **Removed `CTXLOOM_LICENSE_BYPASS=1` env var** — undocumented dev shortcut that fully skipped license validation. The legitimate "Codzign team uses CLI without burning paid seats" use case is now served by the internal Polar product (€0, 5 lifetime activations). Tests updated to use real license fixtures. [#30]
- **Atomic 0o600 mode on license file** — `LicenseStore.write` previously did `writeFileSync` then `chmodSync` (TOCTOU window where another local user could read the key). Mode is now applied at file creation. [#30]
- **Validate workerData in indexerWorker** — was an `as` cast with no runtime check. Zod parse on entry. [#30]
- **Don't log license file path in `CTXLOOM_DEBUG`** — was leaking `/Users/<username>/.ctxloom/...`. [#30]

---

## [1.0.7] — 2026-05-07

### Fixed
- **`ctxloom dashboard` crashed on every fresh install (P0)** — `ERR_MODULE_NOT_FOUND` because `src/dashboard.ts` looked for `apps/dashboard/server/index.js` (no `/dist/` segment), and the dashboard's `dist/` files weren't included in the npm tarball anyway. Three compounding bugs fixed: path corrected, `apps/dashboard/dist/**/*` added to the published `files` whitelist, and the dashboard server build switched from `tsc` (which crashed on cross-package imports) to `tsup` with proper externals for native modules and CJS-only deps. [#26]
- **JSON log lines leaking into styled CLI output** — every `ctxloom status` / `ctxloom index` / `ctxloom dashboard` started with `{"ts":"...","level":"warn","msg":"..."}` noise. Logger now has a CLI mode (auto-detected from `process.argv`) that suppresses info/debug and pretty-prints warn/error as compact colored lines. MCP server mode (bare `ctxloom`) still emits structured JSON to stderr unchanged. The misleading "Set CTXLOOM_ROOT in your MCP server config" warning no longer fires during CLI commands. [#27]

### Other
- Tightened root `.gitignore` so a misconfigured tsc run anywhere in the workspace can't leak compiled output (`*.js` / `*.d.ts`) into nested `src/` directories and end up committed.

---

## [1.0.6] — 2026-05-07

### Fixed
- **License gate (P0)** — every paid activation was silently broken. `LicenseFileSchema` required a valid email format, but `activateLicense()` wrote `email: ''` because the Polar API doesn't return a customer email. The schema-parse error was caught silently in `LicenseStore.read()` → returned null → gate said "no active license". Email was unused metadata; removed from the schema entirely. Existing license files on disk still parse (Zod strips the unknown key). [#22]
- **`ctxloom index` crash on large projects (P0)** — `ENFILE: file table overflow` when running on 600+ file repos. Root cause: `VectorStore` opened LanceDB but never released file descriptors; the next phase (tree-sitter WASM grammar load) ran out of FDs and aborted with `mutex lock failed`. Same crash propagated to MCP server inside Claude Desktop. Added `VectorStore.close()`, called from `indexDirectory`, `cross-repo-search`, and `indexerWorker`. Process now bumps `nofile` rlimit on Node 24+. [#23]
- `LicenseStore.read()` now logs parse errors when `CTXLOOM_DEBUG=1` (was silent — masked the bug above for as long as it existed).

---

## [0.3.0] — 2025-Q1

### Added
- **`ctx_blast_radius`** — bidirectional import + call graph traversal; answers "if I change this, what breaks?"
- **`ctx_hub_nodes`** — top-N files by import degree (architectural chokepoints)
- **`ctx_bridge_nodes`** — top-N files by betweenness centrality (graph connectors)
- `ToolRegistry` — one file per tool, replaces monolithic `server.ts` switch statement
- `CallGraphIndex` — symbol-level call edges for TypeScript/JS via tree-sitter `call_expression` nodes
- `GrammarLoader` — lazy WASM grammar download with SHA-256 verification, cached at `~/.ctxloom/grammars/`
- Python full AST support (functions, classes, imports via tree-sitter-python)
- Go, Rust, Java AST symbol indexing via tree-sitter
- `ctx_similar_files` — find semantically similar files via vector embeddings
- `ctx_status` — server status: graph size, vector store count, initialization state

### Changed
- `ctx_get_call_graph` now annotates results with `graph_type: "call" | "import"` for transparency
- `DependencyGraph` snapshot format updated to include call graph index

---

## [0.2.0] — 2025-Q1

### Added
- `ctx_get_context_packet` — smart multi-file context: primary file + dependency skeletons + reverse importers
- `Skeletonizer` — reduces source files to signature-only views (70–90% token reduction)
- `SnapshotManager` — atomic graph snapshot writes; hydrates in O(n) on startup
- Multi-language import graph: Python, Rust, Go, Java (regex-based)
- `PathValidator` — path traversal protection (CWE-22), symlink-aware
- `FileWatcher` — chokidar-based incremental graph updates (200ms debounce)

---

## [0.1.0] — 2025-Q1

### Added
- Initial release
- `ctx_search` — hybrid semantic + import graph search
- `ctx_get_file` — safe file read with path traversal protection
- `ctx_get_call_graph` — import graph traversal with depth control
- `ctx_get_definition` — symbol definition lookup via AST index
- `ctx_get_rules` — project rule injection from `.cursorrules`, `CLAUDE.md`, etc.
- LanceDB vector store with `sentence-transformers/all-MiniLM-L6-v2` (local, 384-dim)
- TypeScript/JS full AST support via tree-sitter
- `ctxloom setup` — interactive wizard, detects 13 MCP clients
- `ctxloom index` — index current directory + build dependency graph
- MCP Stdio transport

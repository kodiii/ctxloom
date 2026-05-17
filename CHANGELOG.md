# Changelog

All notable changes to ctxloom are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

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

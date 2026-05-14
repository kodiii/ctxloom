# Changelog

All notable changes to ctxloom are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

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

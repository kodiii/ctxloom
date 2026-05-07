# Changelog

All notable changes to ctxloom are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [Unreleased]

### Added
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

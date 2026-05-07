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

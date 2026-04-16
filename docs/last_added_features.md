# ctxloom — Latest Features

> All features added in the most recent development cycle.
> Use this document to update the product website.

---

## Competitive Parity Sprint — April 2026

### New Tools (8 added)

#### `ctx_find_large_functions`
Scans the entire codebase (or a filtered subset) and returns functions and classes that exceed a configurable line-count threshold, sorted by size descending. Helps identify refactor targets and complexity hotspots without reading files manually.

Params: `threshold` (default 50 lines), `file_filter` (glob, optional), `limit` (default 30 results).

**Use it when:** Preparing for a refactor, auditing complexity, or enforcing team line-count conventions.

---

#### `ctx_full_text_search`
Hybrid keyword and vector search with regex support and configurable context lines. Returns results ranked by a combined semantic + literal relevance score.

**Use it when:** You know a rough string or pattern that appears in the code and want to find it fast — especially across a large repo where pure vector search might miss exact matches.

---

#### `ctx_suggested_questions`
Generates graph-driven code review questions without calling any LLM. Analyzes the dependency graph, call graph, and community structure to surface questions a human reviewer should ask: "Who else calls this function?", "Is this hub file tested?", "Does this change cross community boundaries?".

**Use it when:** Starting a code review and want a structured checklist of structural concerns — zero LLM cost.

---

#### `ctx_detect_changes`
Risk-scored change analysis. Classifies every changed symbol as `critical / high / medium / low` based on blast radius, community centrality, and call graph depth. Returns a prioritized list so reviewers focus on what matters most.

**Use it when:** Reviewing a large PR and need to know where to look first.

---

#### `ctx_apply_refactor`
Writes symbol renames to disk. Accepts the same rename spec as `ctx_refactor_preview` and applies the changes atomically. Supports `dry_run: true` to preview without writing.

**Use it when:** You've reviewed the `ctx_refactor_preview` diff and are ready to apply the rename.

---

#### `ctx_get_workflow`
Returns one of five pre-written workflow templates: `review`, `debug`, `onboard`, `refactor`, `audit`. Each template is a structured sequence of ctxloom tool calls optimized for that workflow — copy-paste into your AI session to get started immediately.

**Use it when:** Starting a new session and want a recommended tool sequence without having to remember the full API.

---

#### `ctx_graph_snapshot`
Saves a named checkpoint of the current dependency graph to `.ctxloom/snapshots/<name>.json`. Snapshots are atomic writes (`.tmp` rename) and include both the import graph and call graph.

**Use it when:** Before a large refactor, to capture a baseline you can diff against later.

---

#### `ctx_graph_diff`
Diffs two named snapshots. Returns added nodes, removed nodes, added edges, and removed edges — structured as a change report. Uses the same snapshot format as `ctx_graph_snapshot`.

**Use it when:** After a refactor, to verify the dependency graph changed only as intended.

---

### `detail_level="minimal"` on 7 tools

The following tools now accept `detail_level="minimal"` as a parameter. Minimal mode returns counts-only XML responses — approximately 40–60% fewer tokens than the default full output:

- `ctx_blast_radius`
- `ctx_hub_nodes`
- `ctx_bridge_nodes`
- `ctx_architecture_overview`
- `ctx_knowledge_gaps`
- `ctx_surprising_connections`
- `ctx_detect_changes`

**Use it when:** You need a quick structural signal (e.g., "how big is the blast radius?") without the full node list, or when operating near context window limits.

---

### New Language Support (4 added — total: 13)

| Language | Import parsing | Symbol parsing |
|----------|---------------|----------------|
| PHP | PSR-4 + `require_once` | Classes, functions, interfaces |
| Dart | Relative imports | Classes, functions |
| Vue SFC | Extracts `<script>` block, parses as TypeScript | Full TypeScript symbols |
| Jupyter Notebook (.ipynb) | Python cell imports | Python cell symbols |

---

### Edge Confidence Tiers

Call graph edges are now tagged with a confidence level: `extracted` (directly observed in AST), `inferred` (resolved via type information), or `ambiguous` (multiple possible targets). Tags survive JSON round-trip and are backward compatible — edges without a tag default to `extracted`.

This allows reviewers to filter out low-confidence edges when analyzing blast radius or execution flows.

---

### Graph Export: SVG and Interactive HTML

`ctx_graph_export` now supports two additional formats (total: 5):

- **SVG** — static vector image, suitable for embedding in docs or PRs
- **HTML** — interactive D3.js force-directed graph with hub nodes highlighted amber, drag/zoom/pan, and file path tooltips. XSS-safe (all labels HTML-escaped).

---

### Real Benchmark Numbers

Token reduction is now measured against 5 real open-source repos:

| Repository | Language | Reduction |
|------------|----------|-----------|
| expressjs/express | JavaScript | **92%** |
| sindresorhus/got | TypeScript | **93%** |
| SergioBenitez/Rocket | Rust | **93%** |
| fastify/fastify | JavaScript | **91%** |
| **Average** | | **92%** |

Run `npm run bench:repos` to reproduce.

---

### Key Numbers

| Metric | Before | After |
|--------|--------|-------|
| MCP tools | 22 | **29** |
| Languages supported | 9 | **13** |
| Token reduction (measured) | ~83% | **92% on real repos** |
| Graph export formats | 3 (GraphML, DOT, Obsidian) | **5 (+ SVG, HTML)** |
| Edge confidence tagging | ✗ | **✅ extracted / inferred / ambiguous** |
| `detail_level="minimal"` support | ✗ | **✅ on 7 tools** |
| Large-function finder | ✗ | **✅ `ctx_find_large_functions`** |

---

## Summary

ctxloom grew from **8 tools to 22 tools** and added deep architectural intelligence, graph visualization, and cross-repo capabilities — all local-first, no cloud, no Python.

---

## New Tools (14 added)

### 🔍 Architecture Intelligence

#### `ctx_community_list`
Groups your codebase into architectural clusters using Louvain community detection (pure JavaScript, zero Python dependencies). Each cluster is named after the longest common directory prefix of its member files — so you see "src/auth", "src/api", "src/payments" instead of "Community 1".

**Use it when:** You want to understand how your codebase is organized into subsystems — especially on a codebase you've never seen before.

---

#### `ctx_architecture_overview`
High-level structural summary of the entire codebase: how many architectural modules exist, which files are the hubs within each module, and which modules are tightly coupled to each other.

**Use it when:** Starting a new feature and need to understand the overall shape of the system before touching any code.

---

#### `ctx_knowledge_gaps`
Finds three categories of potential problems:
- **Isolated files** — zero import edges in or out (forgotten utilities)
- **Untested hubs** — files imported by many others, with no corresponding test file
- **Dead code candidates** — files imported by nobody and not an entry point

**Use it when:** Doing a codebase health audit, onboarding to a legacy project, or preparing for a refactor.

---

#### `ctx_surprising_connections`
Surfaces patterns that are often bugs or architectural violations:
- **Circular dependencies** — A → B → C → A
- **Cross-community imports** — tight coupling between supposed-to-be-independent modules
- **Production → test imports** — production files that accidentally import test helpers

**Use it when:** Something is breaking in a surprising way, or before a major refactor to find hidden coupling.

---

### ✏️ Code Navigation & Refactoring

#### `ctx_execution_flow`
Traces the full execution path from any function entry point through the call graph — depth-first, with cycle detection. Each step is annotated with its source file and whether the edge came from the call graph or the import graph.

**Use it when:** Debugging a request that goes through many layers, tracing payment or auth flows, or understanding what a function actually does end-to-end.

---

#### `ctx_refactor_preview`
Read-only preview of a symbol rename across the entire codebase. Shows every file and every line that would change — before anything is written to disk. Uses the call graph and import graph to find all occurrences, not just text search.

**Use it when:** About to rename a function used in 40 files and want to see the full diff before committing.

---

### 📋 Code Review

#### `ctx_git_diff_review`
One call returns everything an AI reviewer needs:
- Git diffs for every changed file
- API skeletons for changed files and their direct importers
- Full blast radius: direct importers, transitive importers, call sites

**Use it when:** Starting any code review. Replaces 5–10 separate calls into a single, structured review packet.

---

### 📚 Documentation & Export

#### `ctx_wiki_generate`
Generates a Markdown wiki inside `.ctxloom/wiki/` — one page per architectural community, containing: public API, hub files ranked by importance, cross-community dependencies, and code skeletons of the top files. Fully deterministic (no LLM), hash-cached (only regenerates pages when the underlying code changes).

**Use it when:** Onboarding new developers, keeping documentation in sync with the codebase, or exploring an unfamiliar project.

---

#### `ctx_graph_export`
Exports the full import graph to three formats:
- **GraphML** — open in Gephi or yEd for visual graph exploration
- **DOT** — render with Graphviz (`dot -Tsvg graph.dot > graph.svg`)
- **Obsidian** — browse your codebase as a linked knowledge base in Obsidian (wikilinks between files)

**Use it when:** You want to visualize your architecture, present it to stakeholders, or explore it interactively.

---

### 🌐 Cross-Repo

#### `ctx_cross_repo_search`
Registers multiple repos and searches across all of them simultaneously. Each repo keeps its own LanceDB store; results are merged and ranked by similarity score, with each result annotated by source repo.

New CLI commands:
```bash
ctxloom register /path/to/other-repo   # register for cross-repo search
ctxloom repos                          # list all registered repos
```

**Use it when:** Working in a monorepo, or when your frontend, backend, and shared libraries live in separate repos.

---

## Infrastructure Upgrades

### Go module-path import resolution
Previously, ctxloom only resolved `./relative` Go imports. Now it parses `go.mod` to resolve fully-qualified module-path imports like `github.com/myorg/myapp/internal/auth` → `internal/auth/auth.go`. This means the Go dependency graph is now accurate for real-world Go projects.

### Go / Rust / Java: AST import nodes replace regex
Import graph edges for Go, Rust, and Java now use the same tree-sitter AST that powers symbol indexing — the same pass that finds your functions and classes. Regex extraction is kept as a fallback when a grammar is unavailable.

### Benchmark suite: real token reduction numbers
The benchmark now calls `Skeletonizer.skeletonize()` on 5 real files sampled from the codebase and measures actual before/after token counts. No estimates. Every CI run on a pull request posts a table like:

| File | Raw tokens | Skeleton tokens | Reduction |
|------|-----------|-----------------|-----------|
| DependencyGraph.ts | 1,842 | 312 | **83%** |
| ASTParser.ts | 934 | 145 | **84%** |
| VectorStore.ts | 623 | 98 | **84%** |

Results are independently reproducible: `npx tsx benchmarks/benchmark.ts`

---

## Key Numbers

| Metric | Before | After |
|--------|--------|-------|
| MCP tools | 8 | **22** |
| Test coverage | ~150 tests | **280 tests** |
| Token reduction (measured) | ~estimated | **~83% actual** |
| Go import resolution | relative only | **full module-path** |
| Graph export formats | none | **GraphML, DOT, Obsidian** |
| Cross-repo search | ✗ | **✅** |
| Execution flow tracing | ✗ | **✅** |
| Rename preview | ✗ | **✅** |
| Wiki generation | ✗ | **✅** |

---

## Product Positioning Headlines

These claims are now measurable and reproducible:

1. **"29 MCP tools — the most complete code context engine for AI assistants"**
2. **"92% token reduction, measured on 5 real open-source repos — not estimated"**
3. **"13 languages: TS/JS, Python, Go, Rust, Java, C#, Ruby, Kotlin, Swift, PHP, Dart, Vue SFC, Jupyter"**
4. **"The only MCP server with execution flow tracing, cross-repo search, graph snapshots, and rename apply"**
5. **"Zero Python. Zero cloud. Everything runs locally."**

---

## Changelog Entry

```
v0.6.0 (latest — competitive parity sprint)
+ ctx_find_large_functions — find oversized functions/classes, sorted by size
+ detail_level="minimal" on ctx_blast_radius, ctx_hub_nodes, ctx_bridge_nodes,
  ctx_architecture_overview, ctx_knowledge_gaps, ctx_surprising_connections,
  ctx_detect_changes — 40–60% fewer tokens in counts-only mode
+ PHP language support: PSR-4 + require_once imports, class/function/interface parsing
+ Dart language support: relative imports, class/function parsing
+ Vue SFC support: <script> block extraction, parsed as TypeScript
+ Edge confidence tiers: extracted | inferred | ambiguous, full JSON round-trip
+ ctx_graph_export: SVG and interactive D3.js HTML formats (total: 5 formats)
+ Real benchmark numbers: 92% token reduction on 5 open-source repos

v0.5.0
+ ctx_full_text_search — hybrid keyword+vector search with regex and context lines
+ ctx_suggested_questions — structural review questions without LLM
+ ctx_detect_changes — risk-scored change analysis (critical/high/medium/low)
+ ctx_apply_refactor — write symbol renames to disk (dry_run supported)
+ ctx_get_workflow — 5 pre-written workflow templates (review/debug/onboard/refactor/audit)
+ ctx_graph_snapshot — named checkpoint snapshots of the dependency graph
+ ctx_graph_diff — diff two named snapshots (added/removed nodes and edges)
+ Jupyter notebook (.ipynb) support
+ Interactive D3.js force-directed graph: hub nodes highlighted amber, drag/zoom/pan

v0.4.0
+ ctx_community_list — Louvain architectural clustering
+ ctx_architecture_overview — community hubs and coupling map
+ ctx_knowledge_gaps — dead code, isolated files, untested hubs
+ ctx_surprising_connections — circular deps, prod→test violations
+ ctx_wiki_generate — deterministic Markdown wiki, hash-cached
+ ctx_graph_export — GraphML, DOT, Obsidian vault
+ ctx_git_diff_review — all-in-one code review packet
+ ctx_refactor_preview — read-only rename diff preview
+ ctx_execution_flow — DFS call graph with cycle detection
+ ctx_cross_repo_search — federated multi-repo semantic search
+ GoModuleResolver — go.mod-aware module-path import resolution
+ Real token reduction benchmarks (CI-integrated)
```

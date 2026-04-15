# ctxloom — Roadmap to #1

> Goal: Close all gaps against code-review-graph and become the most-starred MCP tool for code context on GitHub.

---

## Architecture Decisions (Make These First)

### 1. Grammar Delivery Strategy

Every new tree-sitter grammar adds ~1MB to the package. 18 languages = ~20MB bloat — unacceptable for an npm package.

**Decision: Lazy on-demand download, cached at `~/.ctxloom/grammars/`**

- Download on first encounter of a `.py` / `.go` / `.rs` etc. file
- Verify SHA-256 after download
- Cache indefinitely (never re-download unless version changes)
- Configurable via `CTXLOOM_GRAMMAR_CDN` env var for air-gapped environments
- `ctxloom grammars --list` CLI command to show status (cached / missing / version)

### 2. Server Architecture Refactor

`server.ts` is already 700 lines with a monolithic switch statement. It cannot scale to 28 tools.

**Decision: ToolRegistry + one file per tool**

```
src/
  tools/
    registry.ts            ← ToolRegistry: register(name, schema, handler), list(), dispatch()
    search.ts              ← ctx_search
    file.ts                ← ctx_get_file
    context-packet.ts      ← ctx_get_context_packet
    call-graph.ts          ← ctx_get_call_graph
    definition.ts          ← ctx_get_definition
    rules.ts               ← ctx_get_rules
    similar-files.ts       ← ctx_similar_files
    status.ts              ← ctx_status
    blast-radius.ts        ← [Phase 1]
    community.ts           ← [Phase 2]
    hub-nodes.ts           ← [Phase 2]
    ...
  server.ts                ← thin wiring layer only (~50 lines)
```

`ToolRegistry` is a `Map<name, {schema, handler}>` with `list()` and `dispatch()`. `server.ts` imports and wires it to the MCP transport.

### 3. True Call Graph vs Import Graph

The current `ctx_get_call_graph` traverses the **import graph** (which files import which files). It cannot answer "who calls function `processPayment()`" — only "which files import the file containing it." The tool name overpromises.

**Decision: Dual-index approach**

- Keep the import graph as the fast, always-available backbone (current)
- Add a `CallGraphIndex` for TypeScript/TSX: parse every `call_expression` node via tree-sitter, build `Map<"file:symbol", Set<"file:symbol">>` of actual call edges
- Persist in a second snapshot file alongside the import graph snapshot
- Fall back to import-graph traversal for languages without a call graph
- Be explicit in tool output: annotate results with `"graph_type": "call"` vs `"graph_type": "import"`

---

## Phase 1 — Foundation & Quick Wins
**Target: Weeks 1–2**

Goal: Fix architecture, ship measurable improvements, generate first wave of GitHub visibility.

### Tasks

| Task | Effort | Notes |
|---|---|---|
| Server refactor → ToolRegistry | 2d | Prerequisite for all new tools |
| Real call graph index (TypeScript/TSX) | 2d | Fixes misleading tool name; uses `call_expression` AST nodes |
| `GrammarLoader` infrastructure | 2d | Lazy download + SHA-256 verify + `~/.ctxloom/grammars/` cache |
| Full Python AST support + skeletonization | 2d | #1 language for AI/ML devs; depends on GrammarLoader |
| **`ctx_blast_radius`** | 2d | Most demo-able feature; see spec below |
| Benchmark suite | 1d | CI-integrated; gates HN launch |
| README animated GIF + comparison table | 1d | Biggest stars-per-hour ROI |

### New Tool: `ctx_blast_radius`

```
ctx_blast_radius(
  changed_files?: string[],  // default: auto-detect from git diff HEAD~1
  depth?: number,            // default: 3
  use_git?: boolean          // default: true
)
```

- `use_git: true`: runs `git diff HEAD~1 --name-only` to detect changed files automatically
- Traverses forward import edges (who imports the changed file) AND call-graph edges (who calls changed symbols)
- Groups output: `changed → direct importers → transitive importers → call sites`
- Returns affected symbol names, not just file names
- This answers "if I change this function, what breaks?" — the most-screenshotted feature in any code review tool

### Benchmark Suite

- `benchmarks/` directory with `benchmark.ts`
- Fixtures: representative multi-language repo (~500 files)
- Metrics: indexing time, `ctx_search` P50/P95 latency, `ctx_get_context_packet` token count vs raw, compression ratio
- CI: GitHub Actions job that posts results as a PR comment
- Output: `benchmarks/results.json` + `benchmarks/README.md` with methodology

**Do NOT launch on HN before benchmark numbers exist. HN readers will ask for proof.**

### Quick Wins (Do These Today)

1. **`ctx_blast_radius` MVP** — even import-graph-only version is the most demo-able gap to close
2. **`ctx_hub_nodes` + `ctx_bridge_nodes`** — 50 lines each on the existing graph, immediately shareable output
3. **Animated GIF** — record `ctxloom index` + blast radius query in Claude Code; convert via asciinema + svg-term-cli
4. **Comparison table in README** — ctxloom vs code-review-graph vs others; being honest builds trust and surfaces ctxloom in competitor searches

---

## Phase 2 — Language Parity & Graph Intelligence
**Target: Weeks 3–6**

Goal: Match language coverage, add architectural insight tools.

### Language Expansion (via GrammarLoader)

Priority order based on developer population size:

| Language | Grammar Package | Key AST Nodes |
|---|---|---|
| Go | `tree-sitter-go` | `function_declaration`, `method_declaration`, `type_declaration`, `import_declaration` |
| Rust | `tree-sitter-rust` | `function_item`, `struct_item`, `impl_item`, `use_declaration`, `mod_item` |
| Java | `tree-sitter-java` | `method_declaration`, `class_declaration`, `interface_declaration`, `import_declaration` |
| C# | `tree-sitter-c-sharp` | `method_declaration`, `class_declaration`, `namespace_declaration`, `using_directive` |
| C/C++ | `tree-sitter-c` + `tree-sitter-cpp` | `function_definition`, `struct_specifier`, `include_directive` |
| Ruby | `tree-sitter-ruby` | `method`, `class`, `require_relative` |
| PHP | `tree-sitter-php` | `function_definition`, `class_declaration`, `namespace_use_clause` |
| Kotlin | `tree-sitter-kotlin` | `function_declaration`, `class_declaration`, `import_header` |
| Swift | `tree-sitter-swift` | `function_declaration`, `class_declaration`, `import_declaration` |

For each language, update:
- `ASTParser` — language dispatch
- `importExtractor.ts` — AST-based import resolution (replace regex where needed)
- `Skeletonizer` — language-aware skeleton (signatures + fields, no bodies)
- `collectFiles()` — include new extensions
- `FileWatcher.isSourceFile()` — watch new extensions

**Known hard problems:**
- **Rust** — `impl Trait for Struct` must be indexed under both trait and struct name
- **C/C++** — same symbol appears in `.h` and `.c/.cpp`; needs deduplication in symbol index
- **Go** — module-path imports (e.g. `github.com/myorg/myapp/internal/auth`) require parsing `go.mod` to resolve to file paths; the current regex approach only handles `./relative` paths

### New Tools

| Tool | Effort | Description |
|---|---|---|
| `ctx_community_list` | 3d | Louvain clustering on import graph; cached in `.ctxloom/communities.json` |
| `ctx_architecture_overview` | 1d | Summarises communities: names, sizes, cross-community coupling score |
| `ctx_hub_nodes` | 1d | Top-N files by `in_degree + out_degree`; architectural chokepoints |
| `ctx_bridge_nodes` | 1d | Betweenness centrality; nodes on most shortest paths |
| `ctx_knowledge_gaps` | 1d | Isolated nodes, high-degree hubs with no test file, dead code candidates |
| `ctx_surprising_connections` | 1d | Cross-community imports, circular deps, test→production imports |

**Note on community detection:** The competitor uses the Leiden algorithm (Python-only). Use **Louvain** instead (`graphology-communities-louvain` — pure JS, zero native deps). Cache aggressively: recompute only when graph edge count changes; never run synchronously during a tool call; always run during `ctxloom index`.

**Launch:** Product Hunt after community + architecture tools are ready.

---

## Phase 3 — Elite Features & Ecosystem
**Target: Weeks 7–12**

Goal: Features that go viral, cross-repo support, wiki generation, graph export.

### New Tools

| Tool | Effort | Description |
|---|---|---|
| `ctx_execution_flow` | 4d | DFS on `CallGraphIndex` from entry point → leaf calls; detect cycles; annotate import-level vs call-level |
| `ctx_refactor_preview` | 3d | Symbol rename: find all call sites, return full diff preview (read-only — never applies changes) + dead code detection |
| `ctx_wiki_generate` | 2d | Structural Markdown docs per community: public API, hub files, skeleton views; writes to `.ctxloom/wiki/` |
| `ctx_graph_export` | 2d | Export to GraphML (Gephi/yEd), DOT (Graphviz), Obsidian vault (wikilinks); people post their visualizations |
| `ctx_git_diff_review` | 2d | Blast radius + affected flows + skeletons in one packet; the killer code review workflow tool |
| `ctx_cross_repo_search` | 1w | Federated vector search across registered repos (start with LanceDB multi-DB query merge) |

### `ctx_execution_flow` — What Makes It Hard

The call graph tracks calls within files well via `call_expression` nodes. Cross-file call edges require resolving which file's `export` corresponds to the `import` being called — connecting the import graph and the call graph. For non-TypeScript languages, emit import-level flow only with a clear annotation.

### `ctx_refactor_preview` — The Viral Demo Feature

"What would happen if I rename `processPayment` to `handleCheckout`?" → complete diff preview across the entire codebase, sourced from the call graph. Read-only; no changes applied. This is the feature people will post about.

### `ctx_wiki_generate` — Structural, No LLM Required

For each Louvain community:
- Community name (longest common directory prefix of member files)
- Key files (hub nodes within the community)
- Public API (symbols exported by community files)
- Dependency map (which other communities this one imports)
- Skeleton views of top-3 hub files

Write to `.ctxloom/wiki/index.md` + `.ctxloom/wiki/<community-name>.md`. Only regenerate pages whose input data hash changed. Being deterministic (no LLM) is a selling point — reproducible, no API costs.

### Cross-Repo Support

```bash
ctxloom register /path/to/other-repo   # index + store in ~/.ctxloom/repos.json
```

- `ctx_cross_repo_search(query, repos?)` — parallel query across all registered LanceDB stores, merged results
- Cross-repo dependency detection: parse `package.json` exports to detect when repo A imports symbols from repo B

Start with federated vector search only (simple, high value); leave cross-repo call graphs for later.

---

## GitHub Stars Strategy

### Positioning — Own These Two Claims

1. **"The only code context MCP with zero Python dependencies"**
   Real pain point for JS/TS developers burned by Python-based tooling.

2. **"Nx token reduction on real codebases — independently reproducible"**
   Link directly to `benchmarks/README.md` so the claim is verifiable.

### Launch Sequence

| When | Action |
|---|---|
| After Phase 1 benchmarks | **HN "Show HN"** — do not launch without benchmark numbers |
| After Phase 2 (architecture tools) | **Product Hunt** with animated demo |
| Week 8 | **Blog post**: "How I visualized 10,000 files of architecture in one command" — use `ctx_hub_nodes`, `ctx_bridge_nodes`, GraphML export |
| Week 8 | **Tweet thread**: before/after code review token counts with screenshots |
| Week 12 | **Cross-repo post**: targets large org / monorepo audience |

### Community Mechanics

- **GitHub Discussions** — enable immediately; pin "Show your graph" topic (graph export visualizations go viral)
- **`CONTRIBUTING.md`** — section: "Add a new language in 30 minutes"; drives community PRs + stars from each contributor's network
- **`good first issue` labels** — tag "add tree-sitter-kotlin grammar", "add tree-sitter-scala grammar" etc.
- **CHANGELOG.md** — user-visible changes listed per release; developers who return to check activity become advocates
- **Discord channel** — even 5 active users signals the project is alive; generates organic support content that ranks in search

### npm Discoverability

Add to `package.json` keywords: `blast-radius`, `code-review`, `architecture`, `dependency-graph`, `call-graph`, `community-detection`, `wiki-generation`, `tree-sitter`, `ast`, `monorepo`

---

## Tool Count Progression

| Phase | Tools | Count |
|---|---|---|
| Current | ctx_search, ctx_get_file, ctx_get_context_packet, ctx_get_call_graph, ctx_get_definition, ctx_get_rules, ctx_similar_files, ctx_status | **8** |
| After Phase 1 | + ctx_blast_radius, ctx_hub_nodes, ctx_bridge_nodes | **11** |
| After Phase 2 | + ctx_community_list, ctx_architecture_overview, ctx_knowledge_gaps, ctx_surprising_connections | **15** |
| After Phase 3 | + ctx_execution_flow, ctx_refactor_preview, ctx_wiki_generate, ctx_graph_export, ctx_git_diff_review, ctx_cross_repo_search | **21** |

---

## Hard Problems & Honest Flags

| Problem | Reality |
|---|---|
| **True call graph is slow** | Full symbol resolution across 10k+ files takes 30–120s. Must run in a background worker. Never block a tool call. Show progress. Be explicit when returning import-level vs call-level results. |
| **Community detection is CPU-heavy** | Cache aggressively; recompute only when graph edge count changes; always run during `ctxloom index`, never during a live tool call. |
| **Go imports need `go.mod` parsing** | Module-path imports (`github.com/myorg/myapp/internal/auth`) can't be resolved with regex. Parse `go.mod` to map module root → file paths. ~2 days of work. |
| **npm install size** | `@huggingface/transformers` + `@lancedb/lancedb` native binaries push global install to 200–400MB. Disclose this prominently. Investigate shared global model cache. |
| **Cross-repo call graphs** | Requires parsing `package.json` exports + matching to import specifiers across repos. Hard to do without false positives. Start with vector search only. |
| **Rust trait implementations** | `impl Trait for Struct` must be indexed under both names. Need naming convention decision before implementation. |
| **C/C++ header deduplication** | Same symbol in `.h` and `.c/.cpp`. Symbol index needs deduplication strategy. |

---

## Critical Files

| File | Why It Matters |
|---|---|
| `src/server.ts` | The monolith to refactor first; integration point for all new tools |
| `src/ast/ASTParser.ts` | Multi-language dispatch + call-site indexing; gates Phase 1 and all of Phase 2 |
| `src/graph/DependencyGraph.ts` | Backbone for blast radius, hub/bridge nodes, community detection, call-graph overlay |
| `tsup.config.ts` | Controls WASM bundling; must be updated for GrammarLoader to work across dev/build/install |
| `src/indexer/embedder.ts` | `collectFiles()` and `indexDirectory()` need extending for every new language |

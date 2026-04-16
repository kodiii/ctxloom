# ctxloom — The Universal Code Context Engine

A local-first MCP server that gives AI coding assistants deep structural understanding of your codebase through hybrid **Vector + AST + Graph** search, with **Skeletonization** for 70–90% token reduction.

No API keys. No cloud. No Python. Everything runs on your machine.

## Quick Start

**Prerequisites:** Node.js 20+ and an MCP-compatible AI tool (Claude Code, Cursor, Windsurf, etc.)

```bash
# 1. Install globally
npm install -g ctxloom

# 2. Auto-configure your AI tools (one-time)
ctxloom setup

# 3. Index your project (once per project)
cd /path/to/your/project
ctxloom index
```

### Manual Configuration

```jsonc
// ~/.claude/claude_desktop_config.json  (or equivalent)
{
  "mcpServers": {
    "ctxloom": {
      "command": "npx",
      "args": ["-y", "ctxloom"]
    }
  }
}
```

> If installed globally: `"command": "ctxloom"` with `"args": []`.

---

## How ctxloom Compares

| Feature | ctxloom | code-review-graph | Others |
|---------|---------|-------------------|--------|
| Zero Python dependencies | ✅ Pure JS/TS | ❌ Python required | varies |
| Local-first (no cloud) | ✅ | ✅ | varies |
| Blast radius analysis | ✅ `ctx_blast_radius` | ✅ | ❌ |
| Community / cluster detection | ✅ Louvain (pure JS) | ✅ Leiden (Python) | ❌ |
| Architecture overview | ✅ `ctx_architecture_overview` | ✅ | ❌ |
| Execution flow tracing | ✅ `ctx_execution_flow` | ❌ | ❌ |
| Refactor rename preview | ✅ `ctx_refactor_preview` | ❌ | ❌ |
| Wiki generation (no LLM) | ✅ `ctx_wiki_generate` | ✅ | ❌ |
| Graph export (Gephi/Obsidian) | ✅ `ctx_graph_export` | ✅ | ❌ |
| Cross-repo search | ✅ `ctx_cross_repo_search` | ✅ | ❌ |
| All-in-one code review packet | ✅ `ctx_git_diff_review` | ✅ | ❌ |
| Tree-sitter AST | ✅ TS/JS + Python | ✅ Multi-language | varies |
| Token reduction (skeletonization) | ✅ **~80% measured** | ✅ | ❌ |
| npm install size | ✅ <5 MB (lazy grammars) | ❌ Large | varies |
| MCP protocol native | ✅ | ✅ | varies |

> Token reduction is measured, not estimated. See [`benchmarks/README.md`](benchmarks/README.md).

---

## Tools — 27 total

### Search & Context

| Tool | Description |
|------|-------------|
| `ctx_search` | Hybrid semantic + graph search (vector similarity + import graph expansion) |
| `ctx_get_file` | Safe file read with path traversal protection (5 MB max) |
| `ctx_get_context_packet` | Smart multi-file context: primary file + dependency skeletons + reverse importers |
| `ctx_similar_files` | Find semantically similar files via vector embeddings |
| `ctx_cross_repo_search` | Federated semantic search across all registered repos |

### Graph Intelligence

| Tool | Description |
|------|-------------|
| `ctx_blast_radius` | "What breaks if I change this?" — import + call graph traversal |
| `ctx_hub_nodes` | Top-N files by import degree (architectural chokepoints) |
| `ctx_bridge_nodes` | Top-N files by betweenness centrality (graph connectors) |
| `ctx_community_list` | Louvain community detection — cluster files into architectural modules |
| `ctx_architecture_overview` | High-level summary: communities, hub files, cross-community coupling |
| `ctx_knowledge_gaps` | Isolated files, untested hubs, dead code candidates |
| `ctx_surprising_connections` | Circular deps, cross-community imports, prod→test violations |

### Code Navigation

| Tool | Description |
|------|-------------|
| `ctx_get_call_graph` | Bidirectional call graph traversal with configurable depth |
| `ctx_get_definition` | Symbol definition lookup via AST index |
| `ctx_execution_flow` | DFS call graph traversal from entry point with cycle detection |
| `ctx_refactor_preview` | Read-only symbol rename diff preview — see every change before applying |

### Review & Export

| Tool | Description |
|------|-------------|
| `ctx_git_diff_review` | All-in-one code review packet: git diffs + skeletons + blast radius |
| `ctx_wiki_generate` | Generate `.ctxloom/wiki/` — one Markdown page per community (no LLM needed) |
| `ctx_graph_export` | Export graph to GraphML (Gephi/yEd), DOT (Graphviz), or Obsidian vault |

### Utilities

| Tool | Description |
|------|-------------|
| `ctx_get_rules` | Inject project rules from `.cursorrules`, `CLAUDE.md`, `CONTEXT.md`, `.ctxloomrc` |
| `ctx_status` | Server status: graph size, vector store count, initialization state |

---

## CLI Commands

```
ctxloom                      Start MCP server (Stdio transport)
ctxloom index                Index current directory + build dependency graph
ctxloom setup                Detect and configure MCP-compatible AI tools (interactive)
ctxloom register <path>      Register a repo for cross-repo search
ctxloom repos                List all registered repos
ctxloom grammars             Show grammar cache status
ctxloom grammars --download  Pre-download all language grammars
ctxloom --help               Show help
```

---

## Language Support

| Language | Import Graph | Symbol Index | Skeletonization |
|----------|-------------|--------------|-----------------|
| TypeScript / JavaScript | ✅ Full AST | ✅ | ✅ |
| Python | ✅ Relative imports | ✅ | ✅ |
| Rust | ✅ `mod` resolution | ✅ | ✅ |
| Go | ✅ Relative paths | ✅ | ✅ |
| Java | ✅ Dot-to-slash | ✅ | ✅ |
| C# | ✅ Namespace resolution | ✅ | ✅ |
| Ruby | ✅ Relative paths | ✅ | ✅ |
| Kotlin | ✅ Package imports | ✅ | ✅ |
| Swift | ✅ Module imports | ✅ | ✅ |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      MCP Interface                       │
│                   (Stdio transport)                      │
├──────────────────────────────────────────────────────────┤
│                    27 Tools (ToolRegistry)                │
│  Search · Graph Intelligence · Navigation · Review       │
├──────────────────────────────────────────────────────────┤
│                    Context Engine                         │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Dependency │  │  VectorDB    │  │  Skeletonizer   │  │
│  │   Graph    │  │  (LanceDB)   │  │  (tree-sitter)  │  │
│  └────────────┘  └──────────────┘  └─────────────────┘  │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ CallGraph  │  │  Community   │  │  WikiGenerator  │  │
│  │   Index    │  │  Detector    │  │  GraphExporter  │  │
│  └────────────┘  └──────────────┘  └─────────────────┘  │
├──────────────────────────────────────────────────────────┤
│           File Watcher (chokidar, 200ms debounce)        │
│         Incremental graph updates + re-embedding         │
├──────────────────────────────────────────────────────────┤
│              Snapshot Manager (atomic writes)            │
│    .ctxloom/graph-snapshot.json + call-graph-snapshot    │
└──────────────────────────────────────────────────────────┘
```

### How search works

1. **Embed** — query is embedded with `sentence-transformers/all-MiniLM-L6-v2` (local, 384-dim)
2. **Vector search** — ANN query against pre-indexed file embeddings in LanceDB
3. **Graph expansion** — results expanded via import graph (importers + imports get a small score boost)
4. **Skeletonize** — dependency files reduced to signature-only views (functions, classes, exports) cutting token usage by ~80%

---

## Performance

Benchmarks run on every PR. To run locally:

```bash
npx tsx benchmarks/benchmark.ts
```

See [`benchmarks/README.md`](benchmarks/README.md) for methodology and how to reproduce results independently.

---

## Security

- **Path traversal prevention** — all file inputs validated against project root (CWE-22), symlink-aware
- **Shell injection prevention** — `execFileSync` with argument arrays; no shell string interpolation
- **XML injection prevention** — all user-controlled strings escaped before XML output
- **File size limits** — files over 5 MB rejected by `PathValidator` and skipped by indexer
- **Input bounds** — `limit` capped at 100, `depth` capped at 20 across all tools
- **Atomic snapshot writes** — written to `.tmp` then renamed; prevents torn reads
- **Snapshot schema validation** — validated before hydration; prevents prototype pollution

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CTXLOOM_ROOT` | Project root directory | Current working directory |
| `LOG_LEVEL` | Logging verbosity: `debug` / `info` / `warn` / `error` | `info` |
| `CTXLOOM_GRAMMAR_CDN` | CDN base URL for grammar downloads (air-gapped environments) | Built-in |

---

## Build from Source

```bash
git clone https://github.com/kodiii/ctxloom.git
cd ctxloom
npm install
npm run build
ctxloom index
node dist/index.js
```

---

## Project Structure

```
src/
├── index.ts                   # CLI entry point
├── server.ts                  # MCP server (Stdio transport)
├── tools/
│   ├── registry.ts            # ToolRegistry: register/dispatch
│   ├── search.ts              # ctx_search
│   ├── file.ts                # ctx_get_file
│   ├── context-packet.ts      # ctx_get_context_packet
│   ├── call-graph.ts          # ctx_get_call_graph
│   ├── definition.ts          # ctx_get_definition
│   ├── rules.ts               # ctx_get_rules
│   ├── similar-files.ts       # ctx_similar_files
│   ├── status.ts              # ctx_status
│   ├── blast-radius.ts        # ctx_blast_radius
│   ├── hub-nodes.ts           # ctx_hub_nodes
│   ├── bridge-nodes.ts        # ctx_bridge_nodes
│   ├── community-list.ts      # ctx_community_list
│   ├── architecture-overview.ts # ctx_architecture_overview
│   ├── knowledge-gaps.ts      # ctx_knowledge_gaps
│   ├── surprising-connections.ts # ctx_surprising_connections
│   ├── wiki-generate.ts       # ctx_wiki_generate
│   ├── graph-export.ts        # ctx_graph_export
│   ├── git-diff-review.ts     # ctx_git_diff_review
│   ├── refactor-preview.ts    # ctx_refactor_preview
│   ├── execution-flow.ts      # ctx_execution_flow
│   └── cross-repo-search.ts   # ctx_cross_repo_search
├── graph/
│   ├── DependencyGraph.ts     # In-memory graph + snapshot + multi-language
│   ├── CallGraphIndex.ts      # Symbol-level call edges (TypeScript/JS)
│   ├── CommunityDetector.ts   # Louvain clustering (graphology)
│   ├── WikiGenerator.ts       # Hash-cached community Markdown wiki
│   └── GraphExporter.ts       # GraphML / DOT / Obsidian export
├── ast/
│   ├── ASTParser.ts           # tree-sitter multi-language parser
│   └── Skeletonizer.ts        # Signature-only code views
├── db/
│   └── VectorStore.ts         # LanceDB vector storage
├── indexer/
│   └── embedder.ts            # HuggingFace embeddings + file collection
├── grammars/
│   └── GrammarLoader.ts       # Lazy grammar download + SHA-256 verify
├── security/
│   └── PathValidator.ts       # Path traversal protection (CWE-22)
├── watcher/
│   └── FileWatcher.ts         # chokidar (200ms debounce, incremental)
├── setup/
│   ├── clients.ts             # 13-client registry + detection
│   └── setup-wizard.ts        # Interactive setup CLI
└── utils/
    ├── logger.ts              # Structured JSON-lines logger (stderr)
    └── importExtractor.ts     # Regex import extraction (Python/Rust/Go/Java)

benchmarks/
├── benchmark.ts               # Benchmark suite (graph build + search + compression)
└── README.md                  # Methodology and reproducibility guide
```

---

## License

MIT © [Codzign](https://github.com/kodiii)

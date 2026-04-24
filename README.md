# ctxloom — The Universal Code Context Engine

A local-first MCP server that gives AI coding assistants deep structural understanding of your codebase through hybrid **Vector + AST + Graph** search, with **Skeletonization** for 92% token reduction.

No API keys. No cloud. No Python. Everything runs on your machine.

## Quick Start

**Prerequisites:** Node.js 20+ and an MCP-compatible AI tool (Claude Code, Cursor, Windsurf, etc.)

```bash
# 1. Install globally
npm install -g ctxloom-pro

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

## GitHub App — ctxloom-bot

![Beta](https://img.shields.io/badge/status-beta-orange)

Get automated risk analysis and reviewer suggestions on every pull request.

<!-- TODO: Add demo GIF showing bot posting summary + inline comment on a PR -->

- Posts a risk-scored summary comment on every PR, combining blast radius, churn, and coupling data
- Adds inline review comments at the specific lines that carry the highest structural risk
- Suggests reviewers based on ownership data mined from git history
- Responds to `/ctxloom` slash commands (e.g. `/ctxloom blast-radius`, `/ctxloom risk`) directly in PR threads

See [`apps/pr-bot/README.md`](apps/pr-bot/README.md) for full installation and self-hosting instructions.

---

## Web Dashboard

![Beta](https://img.shields.io/badge/status-beta-orange)

A local web dashboard that visualises your codebase's graph, risk, ownership, and community data in real time.

```bash
# Index first (with git history for full data)
ctxloom index --with-git

# Launch the dashboard
ctxloom dashboard
```

Visit `http://localhost:7842` — no browser extension required.

### Views

| View | What it shows |
|------|---------------|
| **Overview** | File count, edge count, communities, git status, risk breakdown donut, top architectural hubs |
| **Dependency Graph** | Interactive D3 force-directed graph — hover for details, click to highlight neighbours, search to pan, community legend, risk rings |
| **Risk** | Sortable table: composite risk score (churn × 0.3 + bug density × 0.3 + bus factor × 0.2 + coupling × 0.2), filterable by filename |
| **Communities** | Auto-detected Louvain modules — expandable cluster cards showing member files |
| **Ownership** | Per-file primary owner, share %, bus factor warnings — filterable by file or contributor |
| **Guide** | In-app reference explaining every metric and how to interpret it |

### Interactivity

- **Click any filename** across Risk, Ownership, and Communities to open a file preview drawer with the full source and an **Open in IDE** button (launches VS Code, Cursor, or system default)
- **↻ Refresh** button in Overview re-indexes the context in-place without restarting the server
- The server **auto-reloads** when `.ctxloom/graph-snapshot.json` changes — run `ctxloom index` in a separate terminal and the dashboard updates automatically

### Risk tiers

| Tier | Score | Meaning |
|------|-------|---------|
| critical | > 0.8 | Urgent — high churn, sole owner, heavily coupled |
| high | > 0.6 | Address soon |
| medium | > 0.3 | Monitor |
| low | ≤ 0.3 | Acceptable |

---

## Reviewer Suggestions

Suggest PR reviewers based on git ownership, co-change history, and recent activity — no static CODEOWNERS to maintain:

```bash
# Suggest reviewers for staged files
ctxloom review-suggest

# Suggest reviewers for specific files
ctxloom review-suggest src/auth.ts src/api/session.ts

# Show per-factor score breakdown
ctxloom review-suggest src/auth.ts --explain

# Generate / update .github/CODEOWNERS
ctxloom review-suggest --emit-codeowners --write

# Map git author emails to GitHub handles
GITHUB_TOKEN=<token> ctxloom authors-sync
```

### Scoring

Each candidate is scored across four factors:

| Factor | Weight | Source |
|--------|--------|--------|
| Ownership share | 50% | Blame-weighted commit history |
| Co-change recency | 25% | Files changed together in last 90 days |
| Recent activity | 15% | Commits in last 30/90 days |
| Bus-factor boost | 10% | Diversity nudge when bus factor ≤ 2 |

Candidates inactive for > 180 days are excluded automatically.

### GitHub Action

Add to `.github/workflows/review.yml`:

```yaml
name: Reviewer suggestions
on:
  pull_request:
    types: [opened, synchronize, reopened]
jobs:
  suggest:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: kodiii/ctxloom-review-suggest@v1
        with:
          max: 3
```

### Email → GitHub handle mapping

Create `.ctxloom/authors.yml` to map or exclude authors:

```yaml
mappings:
  alice@company.com: alice-gh
  bob@company.com: bobsmith
ignore:
  - bot@dependabot.com
```

---

## Architecture Rules Engine

Enforce architectural boundaries as a CI lint step — no runtime overhead, no flaky tests.

```bash
# Check rules against the indexed dependency graph
ctxloom rules check

# JSON output (for CI parsers)
ctxloom rules check --json

# Skip re-indexing, use existing snapshot
ctxloom rules check --use-snapshot

# Limit text output to N violations (default: 50)
ctxloom rules check --limit=20
```

### Configuration

Create `.ctxloom/rules.yml` in your project root:

```yaml
version: 1
rules:
  - name: domain must not import infra
    type: no-import
    from: "src/domain/**"
    to: "src/infra/**"
    severity: error        # optional — defaults to "error"

  - name: no circular via shared
    type: no-import
    from: "src/features/**"
    to: "src/shared/legacy/**"
    severity: warning
```

### Rule fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Human-readable rule label (shown in violations) |
| `type` | ✅ | Always `no-import` in v1 |
| `from` | ✅ | picomatch glob — files that must not import |
| `to` | ✅ | picomatch glob — files that must not be imported |
| `severity` | ❌ | `error` (default) or `warning` |

Globs use [picomatch](https://github.com/micromatch/picomatch) syntax with `{ dot: true }` for dotfiles.

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Clean (or warnings only) |
| 1 | One or more `error`-severity violations found |
| 2 | Config file invalid or I/O error |

### CI integration

```yaml
# .github/workflows/rules.yml
name: Architecture rules
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install -g ctxloom-pro
      - run: ctxloom index
      - run: ctxloom rules check --json
```

### MCP tool

The `ctx_rules_check` tool exposes the same engine to your AI assistant:

```json
// Request
{}

// Response (schemaVersion: 1)
{
  "schemaVersion": 1,
  "violations": [
    {
      "rule": "domain must not import infra",
      "severity": "error",
      "from": "src/domain/user.ts",
      "to": "src/infra/db.ts"
    }
  ],
  "warnings": []
}
```

The tool reads `.ctxloom/rules.yml` and the live dependency graph on every call — no restart required when config changes.

### Limitations (v1)

- **Direct imports only** — transitive violations are not detected
- **Snapshot staleness** — `--use-snapshot` skips re-indexing; stale graphs may miss recent violations
- Rule type `no-import` only; more rule types planned for v2

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
| Tree-sitter AST | ✅ TS/JS/Python/Go/Rust/Java/C#/Ruby/Kotlin/Swift/PHP/Dart/Vue — 13 languages | ✅ Multi-language | varies |
| Token reduction (skeletonization) | ✅ **92% measured on real repos** | ✅ | ❌ |
| npm install size | ✅ <5 MB (lazy grammars) | ❌ Large | varies |
| MCP protocol native | ✅ | ✅ | varies |
| PR-native review comments | ✅ ctxloom-bot posts on every PR | ❌ | ❌ |

> Token reduction is measured, not estimated. See [`benchmarks/README.md`](benchmarks/README.md).

---

## Tools — 32 total

### Search & Context

| Tool | Description |
|------|-------------|
| `ctx_search` | Hybrid semantic + graph search (vector similarity + import graph expansion) |
| `ctx_get_file` | Safe file read with path traversal protection (5 MB max) |
| `ctx_get_context_packet` | Smart multi-file context: primary file + dependency skeletons + reverse importers |
| `ctx_similar_files` | Find semantically similar files via vector embeddings |
| `ctx_cross_repo_search` | Federated semantic search across all registered repos |
| `ctx_full_text_search` | Hybrid keyword+vector search with regex support and configurable context lines |

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
| `ctx_find_large_functions` | Find functions/classes exceeding a line-count threshold, sorted by size descending |

### Code Navigation

| Tool | Description |
|------|-------------|
| `ctx_get_call_graph` | Bidirectional call graph traversal with configurable depth |
| `ctx_get_definition` | Symbol definition lookup via AST index |
| `ctx_execution_flow` | DFS call graph traversal from entry point with cycle detection |
| `ctx_refactor_preview` | Read-only symbol rename diff preview — see every change before applying |
| `ctx_apply_refactor` | Write symbol renames to disk atomically (supports dry_run) |

### Review & Export

| Tool | Description |
|------|-------------|
| `ctx_git_diff_review` | All-in-one code review packet: git diffs + skeletons + blast radius |
| `ctx_wiki_generate` | Generate `.ctxloom/wiki/` — one Markdown page per community (no LLM needed) |
| `ctx_graph_export` | Export graph to GraphML, DOT, Obsidian, SVG, or interactive D3.js HTML |
| `ctx_suggested_questions` | Graph-driven code review questions without LLM |
| `ctx_detect_changes` | Risk-scored change analysis — critical/high/medium/low priority |
| `ctx_graph_snapshot` | Save a named checkpoint of the dependency graph |
| `ctx_graph_diff` | Diff two named snapshots — added/removed nodes and edges |

### Utilities

| Tool | Description |
|------|-------------|
| `ctx_get_rules` | Inject project rules from `.cursorrules`, `CLAUDE.md`, `CONTEXT.md`, `.ctxloomrc` |
| `ctx_status` | Server status: graph size, vector store count, initialization state |
| `ctx_get_workflow` | Return a pre-written tool sequence for review/debug/onboard/refactor/audit workflows |
| `ctx_rules_check` | Check `.ctxloom/rules.yml` against the live dependency graph — returns `{schemaVersion:1, violations, warnings}` |

---

## Risk Overlay (Git History)

ctxloom fuses your git history onto the structural graph to produce a *risk map* — showing which files are historically risky, not just structurally coupled.

### Enable

Re-index with the `--with-git` flag (enabled by default):

```
ctxloom . --with-git --git-window-days=365
```

First run mines the last 365 days of commits (~30–90s on large repos). Subsequent runs are incremental.

### New tools

| Tool | Description |
|------|-------------|
| `ctx_git_coupling` | Given a file, returns top co-changed siblings with confidence score, shared commit count, and recency data. Surfaces "historically this file changes with X" — invisible to static analysis. |
| `ctx_risk_overlay` | Given a list of files, returns a per-file risk score (0–1) combining churn, bug-fix density, bus-factor ownership, and coupling fan-out. |

### Enriched tools

Existing tools gain a `risk` block when the overlay is active:

- **`ctx_detect_changes`** — each changed file now includes churn bucket, bug density, top coupled siblings, and ownership.
- **`ctx_blast_radius`** — adds a `historicalCoupling` section listing files that co-change with the seed set historically but are not reachable via imports ("historical surprise" surface).

### Privacy

The overlay is **local only**. No code or commit metadata is sent anywhere. The sidecar is stored at `.ctxloom/git-overlay.json` alongside the graph snapshot.

### Opt out

Pass `--no-git` to disable the overlay entirely. Tools degrade gracefully — the `risk` block becomes `null` and the note `"Re-index with --with-git to enable risk data."` appears in responses.

---

## CLI Commands

```
ctxloom                          Start MCP server (Stdio transport)
ctxloom index                    Index current directory + build dependency graph
ctxloom dashboard                Open the web dashboard (port 7842)
ctxloom dashboard --port=N       Start on a custom port
ctxloom dashboard --open         Open browser automatically
ctxloom setup                    Detect and configure MCP-compatible AI tools (interactive)
ctxloom register <path>          Register a repo for cross-repo search
ctxloom repos                    List all registered repos
ctxloom grammars                 Show grammar cache status
ctxloom grammars --download      Pre-download all language grammars
ctxloom rules check              Check .ctxloom/rules.yml against the dependency graph
ctxloom rules check --json       JSON output (schemaVersion: 1)
ctxloom rules check --use-snapshot  Skip re-indexing, use existing graph snapshot
ctxloom rules check --limit=N    Limit text output to N violations (default: 50)
ctxloom --help                   Show help
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
| PHP | ✅ PSR-4 + require_once | ✅ | ❌ |
| Dart | ✅ Relative imports | ✅ | ❌ |
| Vue SFC | ✅ Script block | ✅ | ❌ |
| Jupyter Notebook | ✅ Python cell imports | ✅ | ❌ |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      MCP Interface                       │
│                   (Stdio transport)                      │
├──────────────────────────────────────────────────────────┤
│                    32 Tools (ToolRegistry)                │
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
4. **Skeletonize** — dependency files reduced to signature-only views (functions, classes, exports) cutting token usage by ~92%

---

## Performance

Benchmarks run on every PR. To run locally:

```bash
npx tsx benchmarks/benchmark.ts
```

See [`benchmarks/README.md`](benchmarks/README.md) for methodology and how to reproduce results independently.

## Token reduction benchmarks

Measured on real open-source repos with realistic review scenarios (skeletonization applies to JS/TS files; Python and Rust show graph indexing metrics only):

| Repository | Language | Files | Raw tokens | Skeleton tokens | Reduction |
|---|---|---|---|---|---|
| expressjs/express | JavaScript | 141 | ~4,646 | ~390 | **92%** |
| sindresorhus/got | TypeScript | 71 | ~10,807 | ~742 | **93%** |
| pallets/flask | Python | 83 | n/a | n/a | n/a |
| SergioBenitez/Rocket | Rust | 495 | ~1,281 | ~90 | **93%** |
| fastify/fastify | JavaScript | 258 | ~2,136 | ~202 | **91%** |
| **Average (JS/TS/RS)** | | | | | **92%** |

Token counts use the standard 4 chars/token approximation. Results saved in [`benchmarks/public-repos-results.json`](benchmarks/public-repos-results.json). Run `npm run bench:repos` to reproduce.

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
│   ├── rules-check.ts         # ctx_rules_check
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
├── rules/
│   ├── types.ts               # Rule, RulesConfig, Violation, CheckResult, RulesConfigError
│   ├── loadConfig.ts          # YAML + zod config loader
│   ├── RulesChecker.ts        # picomatch glob engine — graph edges → violations
│   ├── reporter.ts            # formatText (human) + formatJson (schemaVersion: 1)
│   └── index.ts               # barrel export
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

[AGPL-3.0](./LICENSE) © [Codzign](https://github.com/kodiii)

ctxloom is open-source under the GNU Affero General Public License v3.0. You are free to use, modify, and distribute it under the same terms. Commercial use requires a paid license — see [ctxloom.com/pricing](https://ctxloom.com/pricing).

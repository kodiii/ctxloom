# ctxloom — The Universal Code Context Engine

A local-first MCP server that gives AI coding assistants deep structural understanding of your codebase through hybrid **Vector + AST + Graph** search, with **Skeletonization** for 92% token reduction.

No cloud indexing. No Python. Everything runs on your machine.

> **ctxloom requires a license.** Start a free 7-day trial — no credit card required.

## Multi-Project Support (v1.1.0)

ctxloom now supports analyzing multiple projects in a single MCP session. Every tool accepts an optional `project_root` parameter (alias or absolute path).

**Register a project alias:**
```bash
ctxloom register --alias myapp /path/to/project
```

**Use the alias in tool calls:**
```json
{
  "project_root": "myapp"
}
```

Or use an absolute path directly:
```json
{
  "project_root": "/path/to/project"
}
```

**Project state management:** ctxloom maintains an LRU cache of active projects (cap 5 by default, override via `CTXLOOM_MAX_PROJECTS`). First-touch auto-indexing indexes the dependency graph (sync, Tier 1) and queues vector indexing (deferred, Tier 2). Responses include a `<ctxloom_indexing>` envelope on first-touch. Project-resolution errors return structured XML: `<error code="alias_not_found" .../>`, `<error code="no_default_project" .../>`, etc.

**Backward compatibility:** Set `CTXLOOM_DISABLE_MULTIPROJECT=1` to revert to single-project (v1.0.31) behavior.

---

## Getting Started

**Prerequisites:** Node.js 20+ and an MCP-compatible AI tool (Claude Code, Cursor, Windsurf, etc.)

The full first-run flow is **one install + one trial + one init per project.** Each step is a single command.

### 1 — Install (once per machine)

```bash
npm install -g ctxloom-pro
```

> **For local trial / dev use the unpinned command above is fine.** For unattended CI usage, pin to the exact version (`ctxloom-pro@1.5.0`) so future CLI releases don't silently desync your agent-spec coverage — see the workflow example below.

### 2 — Start your free trial (once per email)

```bash
ctxloom trial
# Enter your email — a checkout link opens in your browser.
# No credit card required. After checkout, you receive a license key by email.
```

Already have a key?

```bash
ctxloom activate <your-key>
```

### 3 — Configure your AI tools (once per machine)

```bash
ctxloom setup
# Detects Claude Code, Cursor, Windsurf, Claude Desktop, Codex,
# Kimi, Continue, Aider, Augment, Kilo, Qwen, JetBrains, VS Code —
# writes the global MCP entry for each one you have installed.
```

### 4 — Bootstrap each project (once per project)

```bash
cd /path/to/your/project
ctxloom init           # writes .mcp.json + appends .ctxloom/ to .gitignore
ctxloom index          # builds vector + graph + git overlay
```

`ctxloom init` is the piece that pins ctxloom to **this** project. Without it, MCP clients (notably Claude Code) launch the global MCP server with cwd inherited from wherever the IDE was first opened — and **do not relaunch on project switch** — so a single Claude Code session ends up serving graph queries from the wrong codebase. The `.mcp.json` produced by `init` carries an explicit `CTXLOOM_ROOT` and short-circuits that ambiguity.

After `init` + `index`, reopen your AI tool in the project directory. Your assistant now has full structural context.

### License commands

```bash
ctxloom status         # tier, expiry, last validation
ctxloom deactivate     # release this machine's seat (to move to a new machine)
```

### CI / headless environments

```bash
CTXLOOM_LICENSE_KEY=<your-key> ctxloom index
```

Set `CTXLOOM_LICENSE_KEY` in your CI secrets. The key is validated on every run — no local state written to the runner.

### Manual MCP configuration (if you skip `ctxloom setup`)

Global MCP entry — match this in your client's config file by hand:

```jsonc
// Claude Code:    ~/.claude.json or .mcp.json in the project
// Cursor:         ~/.cursor/mcp.json
// Codex CLI:      ~/.codex/mcp.json
// Kimi:           ~/.kimi/mcp.json
// Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "ctxloom": {
      "command": "ctxloom",
      "args": []
    }
  }
}
```

Then run `ctxloom init` inside each project — it writes a `.mcp.json` in the project root with `env.CTXLOOM_ROOT` set, which overrides the global entry on a per-project basis (Claude Code, Cursor, and the other MCP-aware clients merge per-project config over global automatically).

If you have a single fixed project (e.g. a CI runner or a Claude Desktop session with no project concept), pin the global entry directly:

```jsonc
{
  "mcpServers": {
    "ctxloom": {
      "command": "ctxloom",
      "args": [],
      "env": { "CTXLOOM_ROOT": "/path/to/project" }
    }
  }
}
```

> Pricing: **Pro** €9.90/mo or €99/yr (1 seat) · **Team** €29.90/mo or €299/yr (5 seats) · [ctxloom.com/pricing](https://ctxloom.com/pricing)

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
      # Exact pin (not `@^1`) so future CLI releases that add/remove MCP
      # tools don't silently desync your reviewer-agent specs. Bump on
      # every release; see CHANGELOG.md for the live version table.
      - run: npm install -g ctxloom-pro@1.5.0
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

## Tools — 33 total

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
| `ctx_get_affected_flows` | Which flows are affected by changed files? Traces back to root callers, then forward — auto-detects from `git diff HEAD~1` |
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

## Response Budgets (v1.2.7+)

Twelve source-returning tools accept a server-enforced **token budget**. When a response would exceed the budget, the server auto-substitutes a lighter form (Skeletonizer signature view, summary-only XML, or paths-without-snippets) instead of dumping 50KB of source into your context window.

### Opting in

Pass any of these three optional fields to any of the 12 supported tools:

```json
{
  "max_response_tokens": 4000,
  "on_budget_exceeded": "skeleton",
  "response_format": "auto"
}
```

| Field | Values | Default |
|---|---|---|
| `max_response_tokens` | positive integer | per-tool (see below) |
| `on_budget_exceeded` | `"skeleton"` \| `"truncate"` \| `"error"` | `"skeleton"` |
| `response_format` | `"full"` \| `"skeleton"` \| `"auto"` | `"auto"` |

**Back-compat:** when none of these fields are passed, the tool returns its raw response unchanged. Existing callers see zero behavior change.

### Response envelope

When you opt in, the response is wrapped in a JSON envelope:

```json
{
  "data": "<the actual tool output — XML, text, or whatever the tool returns>",
  "meta": {
    "format": "full" | "skeleton" | "truncated",
    "original_tokens_est": 8400,
    "returned_tokens_est": 1600,
    "fallback_reason": null | "budget_exceeded" | "minified_input" | "size_cap" | "skeleton_failed"
  }
}
```

### Supported tools + default budgets

Defaults activate only when you opt in (any of the 3 fields above) without specifying `max_response_tokens` explicitly.

| Tool | Default | Skeleton fallback |
|---|---:|---|
| `ctx_get_file` | 8000 | Skeletonizer view of the file (~90% reduction on TS) |
| `ctx_get_context_packet` | 6000 | Re-render with the primary file skeletonized |
| `ctx_get_definition` | 2000 | none — truncate-only (already structural) |
| `ctx_git_diff_review` | 8000 | Drop `<skeleton>` blocks + omit transitive importers |
| `ctx_search` | 4000 | Drop content snippets (paths + scores only) |
| `ctx_full_text_search` | 4000 | Drop match snippets (paths + match counts only) |
| `ctx_wiki_generate` | 12000 | Downgrade to `detail_level=minimal` |
| `ctx_find_large_functions` | 2000 | none — truncate-only |
| `ctx_apply_refactor` | 2000 | none — truncate-only |
| `ctx_refactor_preview` | 4000 | Drop per-change before/after, keep file summary |
| `ctx_cross_repo_search` | 4000 | Drop content snippets |
| `ctx_execution_flow` | 4000 | none — truncate-only |

Defaults are **provisional** (derived from the issue's initial table); a future release will re-derive them from real per-tool p75 telemetry once enough usage data accumulates.

### Token estimator

Default = `chars / 4` — within ±10% of GPT/Claude tokenizers on code with zero tokenization cost. Pluggable per-tool via the `estimator` option on `BudgetOptions` for callers that need accuracy-critical estimation (e.g. tiktoken).

### Kill switch

Set `CTXLOOM_DISABLE_BUDGET=1` in the environment to silently ignore every `max_response_tokens` arg server-wide. Tools behave exactly as in pre-v1.2.7. Documented escape hatch for the soak period.

### Telemetry

Set `CTXLOOM_TELEMETRY_LEVEL=full` to emit structured `mcp.budget.exceeded` and `mcp.fallback.used` events to stderr. Useful for tuning defaults against your own usage patterns.

> **Note:** `CTXLOOM_TELEMETRY_LEVEL` is also consumed by the license / PostHog telemetry layer (see [Telemetry](#telemetry) below) which only recognizes `all` / `error` / `off`. `full` is a separate, **additive** level — it enables budget-event emission *without narrowing* PostHog scope. To narrow PostHog telemetry, set the variable to `error` or `off`; those values disable budget events as a side effect.

---

## CLI Commands

```
ctxloom                          Start MCP server (Stdio transport)
ctxloom index                    Index current directory + build dependency graph
ctxloom dashboard                Open the web dashboard (port 7842)
ctxloom dashboard --port=N       Start on a custom port
ctxloom dashboard --open         Open browser automatically
ctxloom setup                    Detect and configure MCP-compatible AI tools (interactive)
ctxloom register <path>          Register a repo for cross-repo search (v1.0.x)
ctxloom register --alias <name> <path>  Register a project with an alias for multi-project support (v1.1.0+)
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
| PHP | ✅ PSR-4 + require_once | ✅ | ✅ |
| Dart | ✅ Relative imports | ✅ | ✅ |
| Vue SFC | ✅ Script block | ✅ | ✅ |
| Jupyter Notebook | ✅ Python cell imports | ✅ | ✅ |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      MCP Interface                       │
│                   (Stdio transport)                      │
├──────────────────────────────────────────────────────────┤
│                    33 Tools (ToolRegistry)                │
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

Full-source skeletonization on real open-source frameworks — every TS/JS file (skipping tests, `.d.ts`, build output, minified vendor bundles).

| Repository | Files | Raw tokens | Skeleton tokens | Reduction |
|---|---:|---:|---:|---:|
| vercel/next.js | 2,742 | ~12.2M | ~584k | **95%** |
| honojs/hono | 200 | ~185k | ~30k | **84%** |
| vitejs/vite | 1,032 | ~459k | ~105k | **77%** |
| withastro/astro | 875 | ~805k | ~191k | **76%** |
| nestjs/nest | 1,305 | ~409k | ~177k | **57%** |
| **Weighted average · 6,154 files** | | **~14.1M** | **~1.1M** | **92%** |

Token counts use the standard 4 chars/token approximation. Per-repo range (57–95%) reflects file-shape sensitivity: codebases with lots of tiny re-export shims compress less than ones with meatier source. Results saved in [`benchmarks/large-repos-results.json`](benchmarks/large-repos-results.json). Run `npm run bench:repos` to reproduce.

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
| `CTXLOOM_MAX_PROJECTS` | LRU cache cap for multi-project state (v1.1.0+) | `5` |
| `CTXLOOM_DISABLE_MULTIPROJECT` | Set to `1` to revert to v1.0.31 single-project mode (v1.1.0+) | (unset) |
| `CTXLOOM_NO_TELEMETRY` | Set to `1` to disable anonymous telemetry entirely (v1.2.0+) | (unset) |
| `CTXLOOM_TELEMETRY_LEVEL` | `all` / `error` / `off` — granular telemetry scope (v1.2.0+) | `all` |
| `DO_NOT_TRACK` | Universal cross-tool opt-out — equivalent to `CTXLOOM_NO_TELEMETRY=1` | (unset) |

---

## Telemetry

ctxloom collects **anonymous, opt-out telemetry** to understand which features are used and to catch crashes. **No file contents, paths, project names, or aliases are ever transmitted.** Project identifiers are SHA-256 hashes of the absolute path. The `distinct_id` is a random UUID at `~/.ctxloom/distinct_id`.

Disable with `CTXLOOM_NO_TELEMETRY=1` or the cross-tool `DO_NOT_TRACK=1`. For a granular middle ground (crash reports yes, usage analytics no) use `CTXLOOM_TELEMETRY_LEVEL=error`.

The complete list of events, properties, what is *never* collected, and how project paths are anonymized is documented in **[docs/TELEMETRY.md](docs/TELEMETRY.md)**.

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

© 2026 [Codzign](https://github.com/kodiii)

ctxloom is source-available software. The source code is public for transparency and contributions. Use beyond the 7-day trial requires a valid license key — see [ctxloom.com/pricing](https://ctxloom.com/pricing).

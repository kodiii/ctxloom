# ctxloom — The Universal Code Context Engine

A local-first MCP server that gives AI coding assistants deep understanding of your codebase through hybrid **Vector + AST + Graph** search, with **Skeletonization** for 70-90% token reduction.

No API keys. No cloud. Everything runs on your machine.

## Quick Start

### Install from npm

**Prerequisites:** Node.js 20+ and an MCP-compatible AI tool (Claude Code, Cursor, Windsurf, etc.)

```bash
# 1. Install globally
npm install -g ctxloom

# 2. Index your project
cd /path/to/your/project
ctxloom index

# 3. Auto-configure your AI tools
ctxloom setup
```

### Manual Configuration

Add ctxloom to your MCP client config:

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

> If installed globally, use `"command": "ctxloom"` with `"args": []` instead.

### Auto-Setup — `ctxloom setup`

The interactive wizard detects all installed MCP-compatible tools and configures them with a single confirmation. Supports **13 clients**:

| Client | Detection Method | Config Format |
|--------|-----------------|---------------|
| Claude Desktop | Config + App Bundle | `mcpServers` |
| Claude Code | Config + CLI (`claude`) | `mcpServers` |
| Cursor | Config + CLI + App Bundle | `mcpServers` |
| VS Code | Config + CLI + App Bundle | `servers` |
| Windsurf | Config + CLI + App Bundle | `mcpServers` |
| Augment Code | Config + CLI | `mcpServers` |
| Kilo Code | Config + CLI | `mcpServers` |
| Continue.dev | Config + CLI | `experimental.mcpServers` |
| Aider | Config + CLI | `mcpServers` |
| Codex CLI | Config + CLI | `mcpServers` |
| Kimi | Config + CLI | `mcpServers` |
| Qwen Code | Config + CLI | `mcpServers` |
| JetBrains AI | Config + App Bundle | `mcpServers` |

**Detection methods:**
- **Config files** — Checks common config paths (`~/.claude/mcp.json`, VS Code settings, etc.)
- **CLI binaries** — Runs `which`/`where` to find installed commands
- **App bundles** — Checks `/Applications/` on macOS

**Safety:** The wizard never silently modifies configs — it shows what it found and asks for explicit confirmation before writing anything.

**Postinstall:** After `npm install -g ctxloom`, a lightweight notification shows detected tools and suggests running `ctxloom setup`. Skipped automatically in CI/CD environments.

---

## CLI Commands

```
ctxloom              Start MCP server on Stdio transport
ctxloom index        Index the current directory and build the dependency graph
ctxloom setup        Detect and configure MCP-compatible AI tools (interactive)
ctxloom --help       Show help
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CTXLOOM_ROOT` | Project root directory to index | Current working directory |
| `LOG_LEVEL` | Logging verbosity: `debug`, `info`, `warn`, `error` | `info` |

---

## Tools

| Tool | Description |
|------|-------------|
| `ctx_search` | Hybrid semantic + graph search over the codebase (limit 1–100) |
| `ctx_get_file` | Safe file read with path traversal protection (5 MB max) |
| `ctx_get_context_packet` | Smart multi-file context: primary file + dependency skeletons + reverse importers |
| `ctx_get_call_graph` | Bidirectional call graph traversal with configurable depth (max 10) |
| `ctx_get_definition` | Symbol definition lookup via AST index |
| `ctx_get_rules` | Project rule injection from `.cursorrules`, `CLAUDE.md`, `CONTEXT.md`, `.ctxloomrc` |
| `ctx_similar_files` | Find semantically similar files using vector embeddings (limit 1–100) |
| `ctx_status` | Server status: graph size, vector store record count, initialization state |

---

## Language Support

ctxloom builds dependency graphs for **5 language families**:

| Language | Import Style | Resolution |
|----------|-------------|------------|
| TypeScript / JavaScript | `import … from './foo'` | Full AST parse (tree-sitter) |
| Python | `from .bar import Baz` | Relative dot-notation |
| Rust | `mod utils;` | `foo.rs` or `foo/mod.rs` |
| Go | `import "./pkg"` | Relative path → directory |
| Java | `import com.example.Foo;` | Dot-to-slash mapping |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   MCP Interface                      │
│               (Stdio transport)                      │
├─────────────────────────────────────────────────────┤
│               Context Engine                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ In-Memory │  │ VectorDB │  │   Skeletonizer   │  │
│  │   Graph   │  │(LanceDB) │  │  (tree-sitter)   │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
├─────────────────────────────────────────────────────┤
│              File Watcher (chokidar)                 │
│           200ms debounce + incremental               │
│        graph updates + re-embedding                  │
├─────────────────────────────────────────────────────┤
│              Snapshot Manager                        │
│         (.ctxloom/graph-snapshot.json)               │
│    Atomic write + schema validation on load          │
└─────────────────────────────────────────────────────┘
```

### How the search works

1. **Vector search** — your query is embedded using `sentence-transformers/all-MiniLM-L6-v2` (local, 384-dim) and matched against pre-indexed file embeddings in LanceDB.
2. **Graph expansion** — results are expanded via the dependency graph: files that import or are imported by a match are surfaced with a small score penalty.
3. **Re-ranking** — results are combined (60% vector similarity, 40% graph proximity) and returned ranked.
4. **Skeletonization** — when returning context packets, dependency files are reduced to signature-only views (functions, classes, exports) cutting token usage by 70-90%.

---

## Security

ctxloom is designed with defence-in-depth:

- **Path traversal prevention** — All file path inputs validated against the project root (CWE-22). Symlink-aware via `fs.realpathSync`. Applied on every file read and FileWatcher event.
- **Shell injection prevention** — `execFileSync` with argument arrays used throughout; no shell string interpolation.
- **XML injection prevention** — All user-controlled strings (symbol names, file paths, query text) are escaped before being embedded in XML output.
- **File size limits** — Files over 5 MB are rejected by `PathValidator.readFile()` and skipped by the indexer.
- **Input bounds** — `limit` capped at 100, `depth` capped at 10 on all schema inputs.
- **Atomic snapshot writes** — Graph snapshot written to a `.tmp` file then renamed, preventing torn reads.
- **Snapshot schema validation** — Loaded snapshots are validated against an expected shape before hydration, preventing prototype pollution.
- **ReDoS mitigation** — Go block-import regex bounded to 4096 characters; content truncated at 512 KB before matching.
- **Structured logging** — All output goes to stderr as JSON-lines (`LOG_LEVEL` controlled). Canonical paths are never leaked in error messages.

---

## Build from Source

```bash
git clone https://github.com/kodiii/ctxLOOM.git
cd ctxLOOM
npm install
npm run build

# Index and start
ctxloom index
node dist/index.js
```

**MCP config (from source):**

```json
{
  "mcpServers": {
    "ctxloom": {
      "command": "node",
      "args": ["/path/to/ctxLOOM/dist/index.js"]
    }
  }
}
```

## Project Structure

```
src/
├── index.ts               # CLI entry point (index, setup, server)
├── server.ts              # MCP server + all 8 tool handlers
├── security/
│   └── PathValidator.ts   # Path traversal protection (CWE-22)
├── db/
│   └── VectorStore.ts     # LanceDB vector storage
├── indexer/
│   └── embedder.ts        # HuggingFace embeddings + parallel file collection
├── ast/
│   ├── ASTParser.ts       # tree-sitter parser
│   └── Skeletonizer.ts    # Signature-only code view
├── graph/
│   └── DependencyGraph.ts # In-memory graph + snapshot + multi-language
├── watcher/
│   └── FileWatcher.ts     # chokidar file watcher (200ms debounce)
├── utils/
│   ├── logger.ts          # Structured JSON-lines logger (stderr)
│   └── importExtractor.ts # Regex import extraction (Python, Rust, Go, Java)
├── setup/
│   ├── clients.ts         # 13-client registry + detection + config read/write
│   ├── setup-wizard.ts    # Interactive CLI wizard
│   └── postinstall.ts     # Post-install notification
├── workers/
│   └── indexerWorker.ts   # Worker thread (reserved)
└── tools/
    ├── findCallers.ts     # Call graph traversal
    └── ruleManager.ts     # Rule file loader
```

## License

MIT © [Codzign](https://github.com/kodiii)

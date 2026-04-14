# ContextMesh — The Universal Code Context Engine

A local-first MCP sidecar providing intelligent code context via hybrid Vector + AST + Graph search with **Skeletonization** (70-90% token reduction).

## Quick Start

### For End Users — Install from npm

No API keys required, no cloud accounts needed — everything runs locally.

**Prerequisites:** Node.js 20+ and an MCP-compatible AI tool (Claude Code, Cursor, etc.)

```bash
# 1. Install globally
npm install -g contextmesh

# 2. Index your project
cd /path/to/your/project
contextmesh index
# Scans your project, builds the dependency graph, generates vector embeddings,
# and creates the initial snapshot. Takes 5-15 seconds for a typical mid-size project.

# 3. Configure your AI tools (auto-detect!)
contextmesh setup
# Interactive wizard that detects installed MCP clients and configures them automatically.
# Or manually add ContextMesh as an MCP server in your AI tool's configuration:
```

```jsonc
// ~/.claude/claude_desktop_config.json  (or equivalent for Cursor, VS Code, etc.)
{
  "mcpServers": {
    "contextmesh": {
      "command": "npx",
      "args": ["-y", "contextmesh"]
    }
  }
}
```

> **Alternative:** If you installed globally, you can also use `"command": "contextmesh"` with `"args": []`.

### Auto-Setup — `contextmesh setup`

ContextMesh can automatically detect and configure your installed MCP-compatible AI tools. After installing, run:

```bash
contextmesh setup
```

The interactive wizard will scan your system for installed tools, show what was detected, and ask which ones to configure. It supports **13 MCP clients**:

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

**How detection works:**
- **Config files** — Checks common config paths (e.g., `~/.claude/mcp.json`, VS Code settings)
- **CLI binaries** — Runs `which`/`where` to find installed commands (e.g., `claude`, `cursor`)
- **App bundles** — Checks `/Applications/` on macOS for installed applications

**Safety:** The wizard never silently modifies your configs. It detects tools, shows you what it found, and asks for explicit confirmation before writing.

**Postinstall:** After `npm install -g contextmesh`, a lightweight notification shows which tools were detected and suggests running `contextmesh setup`. This is skipped in CI/CD environments.

### For Contributors — Build from Source

```bash
# Clone and install dependencies
git clone https://github.com/your-org/contextmesh.git
cd contextmesh
npm install

# Build
npm run build

# Index your project
node dist/index.js index

# Start MCP server (Stdio transport)
node dist/index.js
```

**MCP client config (from-source):**

```json
{
  "mcpServers": {
    "contextmesh": {
      "command": "node",
      "args": ["/path/to/contextmesh/dist/index.js"]
    }
  }
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CONTEXTMESH_ROOT` | Project root directory to index | Current working directory |
| `LOG_LEVEL` | Logging verbosity: `debug`, `info`, `warn`, `error` | `info` |

## CLI Commands

```
contextmesh              Start MCP server on Stdio transport
contextmesh index        Index the current directory and build dependency graph
contextmesh setup        Detect and configure MCP-compatible AI tools (interactive wizard)
contextmesh --help       Show help
```

## Tools Exposed

| Tool | Description |
|------|-------------|
| `ctx_search` | Hybrid semantic + graph search over the codebase (limit 1–100) |
| `ctx_get_file` | Safe file read with path traversal protection (5 MB max) |
| `ctx_get_context_packet` | Smart multi-file context: primary file + dependency skeletons + reverse importers |
| `ctx_get_call_graph` | Bidirectional call graph traversal with configurable depth (max 10) |
| `ctx_get_definition` | Symbol definition lookup via AST index |
| `ctx_get_rules` | Project rule injection from `.cursorrules`, `CLAUDE.md`, `CONTEXT.md`, `.contextmeshrc` |
| `ctx_similar_files` | Find semantically similar files using vector embeddings (limit 1–100) |
| `ctx_status` | Server status: graph size, vector store record count, initialization state |

## Language Support

ContextMesh builds dependency graphs for **5 language families**:

| Language | Import Style | Resolution |
|----------|-------------|------------|
| TypeScript / JavaScript | `import … from './foo'` | Full AST parse (tree-sitter) |
| Python | `from .bar import Baz` | Relative dot-notation |
| Rust | `mod utils;` | `foo.rs` or `foo/mod.rs` |
| Go | `import "./pkg"` | Relative path → directory |
| Java | `import com.example.Foo;` | Dot-to-slash mapping |

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
│       (.contextmesh/graph-snapshot.json)             │
│    Atomic write + schema validation on load          │
└─────────────────────────────────────────────────────┘
```

### Security

ContextMesh is designed with defence-in-depth:

- **PathValidator**: All file path inputs validated against the project root to prevent path traversal (CWE-22). Symlink-aware via `fs.realpathSync`. Applied on every file read and FileWatcher event.
- **Shell injection prevention**: `execFileSync` with argument arrays used throughout — no shell string interpolation.
- **XML injection prevention**: All user-controlled strings (`symbol`, file paths, query text) are escaped before being embedded in XML output.
- **File size limits**: Files over 5 MB are rejected by `PathValidator.readFile()` and skipped by the indexer.
- **Input bounds**: `limit` capped at 100, `depth` capped at 10 on all schema inputs.
- **Atomic snapshot writes**: Graph snapshot written to a `.tmp` file then renamed, preventing partial reads.
- **Snapshot schema validation**: Loaded snapshots are validated against an expected shape before hydration.
- **ReDoS mitigation**: Go block-import regex bounded to 4096 characters; content truncated at 512 KB before matching.
- **Structured logging**: All server output goes to stderr as JSON-lines (`LOG_LEVEL` controlled). No sensitive path leakage in error messages.

### Corrected Dependencies (per Flaw Analysis)

| Component | Original (Flawed) | Corrected |
|-----------|-------------------|-----------|
| Embedding Engine | `@xenova/transformers` | `@huggingface/transformers` v3+ |
| Model Identifier | `Xenova/all-MiniLM-L6-v2` | `sentence-transformers/all-MiniLM-L6-v2` (HF format) |
| Call Graph Tool | `ctx_find_callers` (one-way) | `ctx_get_call_graph` (bidirectional + depth) |
| Indexing | Sequential per-file | Parallel batches (concurrency 4) |

## Project Structure

```
src/
├── index.ts              # CLI entry point (index, setup, server)
├── server.ts             # MCP server + tool handlers (8 tools)
├── security/
│   └── PathValidator.ts  # Path traversal protection (CWE-22)
├── db/
│   └── VectorStore.ts    # LanceDB vector storage
├── indexer/
│   └── embedder.ts       # @huggingface/transformers embeddings + file collection
├── ast/
│   ├── ASTParser.ts      # tree-sitter parser (expanded patterns)
│   └── Skeletonizer.ts   # Signature-only code view
├── graph/
│   └── DependencyGraph.ts # In-memory graph + snapshot persistence + multi-language
├── watcher/
│   └── FileWatcher.ts    # chokidar file watcher (200ms debounce)
├── utils/
│   ├── logger.ts         # Structured JSON-lines logger (stderr, LOG_LEVEL)
│   └── importExtractor.ts # Regex-based import extraction (Python, Rust, Go, Java)
├── setup/
│   ├── clients.ts        # MCP client registry (13 clients) + detection + config read/write
│   ├── setup-wizard.ts   # Interactive CLI wizard (detect → prompt → confirm → write)
│   └── postinstall.ts    # Lightweight post-install notification
├── workers/
│   └── indexerWorker.ts  # Worker thread stub (reserved for future use)
└── tools/
    ├── findCallers.ts    # Call graph traversal logic
    └── ruleManager.ts    # .cursorrules / CLAUDE.md loader
```

## License

MIT

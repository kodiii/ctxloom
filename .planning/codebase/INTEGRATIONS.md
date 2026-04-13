# External Integrations

**Analysis Date:** 2026-04-13

## APIs & External Services

**Machine Learning (local, offline):**
- Hugging Face Transformers (via `@huggingface/transformers` ^3.0.0)
  - Model: `sentence-transformers/all-MiniLM-L6-v2`
  - Dimensions: 384 (fp32)
  - Auth: None — model is downloaded and cached locally by the library
  - Network: Required only on first run to download model weights; all inference is local thereafter
  - Used in: `src/indexer/embedder.ts`

**No cloud APIs are called at runtime.** The application is intentionally local-first and offline after initial model download.

## Data Storage

**Vector Database:**
- LanceDB (embedded, file-based) via `@lancedb/lancedb` ^0.27.0
  - Path: `{PROJECT_ROOT}/.contextmesh/vectors.lancedb`
  - Table: `code_embeddings` (schema: `id`, `filePath`, `vector Float32[384]`, `content`)
  - Client: Direct `@lancedb/lancedb` SDK — no ORM
  - Lifecycle: Created automatically on first `contextmesh index` run
  - Used in: `src/db/VectorStore.ts`

**File Storage:**
- Local filesystem only
  - Source files: read from `PROJECT_ROOT` (all `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.h`, `.md`, `.json`, `.yaml`, `.yml`, `.toml`)
  - MCP client configs: read/written to OS-standard locations (see MCP Clients section)
  - Vector data: written to `.contextmesh/` directory

**Caching:**
- None beyond LanceDB on-disk persistence

## Authentication & Identity

**Auth Provider:**
- None — the application has no user accounts, sessions, or authentication layer
- Path validation uses `PathValidator` (`src/security/PathValidator.ts`) to prevent directory traversal, but this is a security control, not auth

## Monitoring & Observability

**Error Tracking:**
- None — no Sentry, Datadog, or similar integration

**Logs:**
- `console.error()` to stderr for server operational messages (startup, indexing, re-indexing events, errors)
- `console.log()` to stdout for CLI commands (`index`, `setup`)
- No structured logging library; no log levels beyond implicit stdout/stderr split

## CI/CD & Deployment

**Hosting:**
- npm registry — published as `contextmesh` package with `bin.contextmesh` pointing to `dist/index.js`
- Consumers install via `npx -y contextmesh` or `npm install -g contextmesh`

**CI Pipeline:**
- Not detected — no `.github/workflows/`, no `Dockerfile`, no `docker-compose.yml`

**postinstall Hook:**
- `dist/setup/postinstall.js` runs after `npm install` to detect and optionally configure MCP clients
- Skips automatically in CI environments (checks: `CI`, `CONTINUOUS_INTEGRATION`, `GITHUB_ACTIONS`, `JENKINS_URL`, `TF_BUILD`)
- Skips when stdin is not a TTY

## Environment Configuration

**Required env vars:**
- None are required — the application starts without any environment variables

**Optional env vars:**
- `CONTEXTMESH_ROOT` - Override project root directory; defaults to `process.cwd()`
- CI detection vars (`CI`, `GITHUB_ACTIONS`, etc.) are read but not set by the application

**Secrets location:**
- No secrets, API keys, or credentials used anywhere in the codebase

## MCP Clients (Integration Targets)

The application writes configuration into the config files of these AI coding tools when `contextmesh setup` is run:

- **Claude Desktop** — `~/.claude/claude_desktop_config.json` or `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Code** — `~/.claude/mcp.json` or `~/.claude.json`
- **Cursor** — `~/.cursor/mcp.json` or platform config dir
- **VS Code** — `~/.vscode/mcp.json` or platform config dir
- **Windsurf** — `~/.windsurf/mcp.json` or platform config dir
- **Augment Code** — `~/.augment/mcp.json`
- **Kilo Code** — `~/.kilocode/mcp.json`
- **Continue.dev** — `~/.continue/config.json` (uses `experimental.mcpServers` path)
- **Aider** — `~/.aider/mcp.json`
- **Codex CLI** — `~/.codex/mcp.json`
- **Kimi** — `~/.kimi/mcp.json`
- **Qwen Code** — `~/.qwen/mcp.json`
- **JetBrains AI** — platform config dir `JetBrains/ai-mcp.json`

Config detection logic is in `src/setup/clients.ts`. Config writing uses `addContextMeshToConfig()` which preserves existing JSON and merges the `contextmesh` entry under the `mcpServers` key (or client-specific path).

## Webhooks & Callbacks

**Incoming:**
- None — the server communicates only via MCP Stdio transport (stdin/stdout), not HTTP

**Outgoing:**
- None

## File System Events

**Chokidar file watcher** (`src/watcher/FileWatcher.ts`):
- Watches `PROJECT_ROOT` recursively
- Ignores: `node_modules`, `.git`, `dist`, `build`, `.contextmesh`, `coverage`, `.next`, `.cache`
- Triggers re-embedding of modified source files via `generateEmbedding()` + `VectorStore.upsert()`
- 200ms debounce per file path
- Monitors: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.h`

---

*Integration audit: 2026-04-13*

# Architecture

**Analysis Date:** 2026-04-13

## Pattern Overview

**Overall:** Plugin/Sidecar Architecture — MCP (Model Context Protocol) server exposing tools over Stdio transport to AI coding tools (Claude Code, Cursor, Windsurf, etc.).

**Key Characteristics:**
- Local-first: all processing (embedding, AST parsing, graph traversal) happens on-device; no cloud API required for core functionality
- Lazy singleton initialization: expensive subsystems (ASTParser, VectorStore, DependencyGraph, Skeletonizer) are initialized on first use and reused for the server lifetime
- Three complementary indexes: vector embeddings (semantic), AST-parsed dependency graph (structural), and symbol index (definition lookup)
- Stdio-only transport: the MCP server communicates exclusively via stdin/stdout per MCP protocol spec

## Layers

**CLI Entry Point:**
- Purpose: Parse CLI command and dispatch to appropriate mode
- Location: `src/index.ts`
- Contains: `main()` switch on `process.argv[2]`; dispatches to `startServer()`, `indexDirectory()`, or `runSetupWizard()`
- Depends on: all subsystems
- Used by: Node.js process via `bin` entry in `package.json`

**MCP Server Layer:**
- Purpose: Expose all capabilities as MCP tools; handle request routing, input validation, and response formatting
- Location: `src/server.ts`
- Contains: `createServer()`, `startServer()`, tool request handlers (`handleCtxSearch`, `handleCtxGetContextPacket`), lazy singleton factories, FileWatcher startup
- Depends on: all subsystems (ASTParser, VectorStore, DependencyGraph, Skeletonizer, FileWatcher, RuleManager, PathValidator)
- Used by: `src/index.ts` (default command)

**AST Layer:**
- Purpose: Parse TypeScript/JavaScript source files into structured nodes; extract imports, functions, classes, interfaces, arrow functions
- Location: `src/ast/`
- Contains: `ASTParser` (wraps web-tree-sitter WASM), `Skeletonizer` (reduces full files to signature-only views)
- Depends on: `web-tree-sitter` WASM binaries at `dist/wasm/`
- Used by: DependencyGraph (for building the import graph), `handleCtxGetContextPacket` (via Skeletonizer), `findCallers` tool

**Graph Layer:**
- Purpose: Bidirectional in-memory import dependency graph with snapshot persistence
- Location: `src/graph/DependencyGraph.ts`
- Contains: `DependencyGraph` class with forward/reverse adjacency lists (`Map<string, Set<string>>`), symbol index (`Map<string, Array<{filePath, type, signature}>>`), and snapshot serialization to `.ctxloom/graph-snapshot.json`
- Depends on: `ASTParser`, `collectFiles` from embedder
- Used by: server.ts tool handlers for graph expansion in search, context packet generation, call graph traversal, and symbol definition lookup

**Vector Store Layer:**
- Purpose: Persist and search 384-dimensional code embeddings using approximate nearest neighbor
- Location: `src/db/VectorStore.ts`
- Contains: `VectorStore` class wrapping `@lancedb/lancedb`; schema: `{ id, filePath, vector: Float32[384], content }`; stores data at `.ctxloom/vectors.lancedb`
- Depends on: `@lancedb/lancedb`
- Used by: `indexDirectory`, `handleCtxSearch`, FileWatcher re-indexing callback

**Indexer/Embedder Layer:**
- Purpose: Generate vector embeddings from source files using a local HuggingFace model; batch-index full directories
- Location: `src/indexer/embedder.ts`
- Contains: `generateEmbedding()` (lazy-loaded `all-MiniLM-L6-v2` pipeline, 384 dims), `collectFiles()` (recursive file collector with ignore list), `indexDirectory()` (batch embedding + store upsert)
- Depends on: `@huggingface/transformers`, `VectorStore`
- Used by: `src/index.ts` index command, `src/server.ts` for on-demand embedding during search

**Security Layer:**
- Purpose: Prevent path traversal attacks (CWE-22) by ensuring all file reads resolve within the project root
- Location: `src/security/PathValidator.ts`
- Contains: `PathValidator` class; uses `fs.realpathSync` to resolve symlinks before boundary check
- Depends on: Node.js `fs`, `path`
- Used by: `src/server.ts` (`ctx_get_file`, `ctx_get_context_packet`), `RuleManager`

**Tools Layer:**
- Purpose: Specialized tool logic for call graph traversal and project rule injection
- Location: `src/tools/`
- Contains: `findCallers.ts` (`getCallGraph()`, `findCallers()` — bidirectional BFS traversal with depth), `ruleManager.ts` (`RuleManager` — scans for `.cursorrules`, `CLAUDE.md`, `CONTEXT.md`, `.ctxloomrc`, caches results)
- Depends on: `ASTParser`, `DependencyGraph`, `PathValidator`
- Used by: `src/server.ts` tool handlers

**File Watcher Layer:**
- Purpose: Detect source file changes and trigger incremental re-indexing without full restart
- Location: `src/watcher/FileWatcher.ts`
- Contains: `FileWatcher` class wrapping `chokidar`; 200ms debounce per file; emits `add | change | unlink` events
- Depends on: `chokidar`
- Used by: `startServer()` in `src/server.ts`

**Worker Layer:**
- Purpose: Offload embedding generation + LanceDB upsert to a Node.js worker thread to avoid blocking the MCP server event loop
- Location: `src/workers/indexerWorker.ts`
- Contains: Receives `{ filePath, content, root, dbPath }` from `workerData`, posts back `{ status, path?, error? }`
- Depends on: `generateEmbedding`, `VectorStore`
- Used by: intended for background indexing (infrastructure exists; main thread currently handles embedding inline via FileWatcher callback)

**Setup Layer:**
- Purpose: Interactive CLI wizard for detecting installed MCP clients and writing config entries
- Location: `src/setup/`
- Contains: `setup-wizard.ts` (`runSetupWizard()` — interactive + non-interactive modes), `clients.ts` (client registry with detection logic for Claude Desktop, Claude Code, Cursor, Windsurf, VS Code, Continue.dev, Aider, etc.), `postinstall.ts` (runs non-interactively on `npm install`)
- Depends on: Node.js `readline`, `os`, `fs`, `path`
- Used by: `src/index.ts` setup command, `npm postinstall` hook

## Data Flow

**Search Request (ctx_search):**

1. MCP client sends `ctx_search` tool call with `{ query, limit }`
2. `server.ts` validates input via Zod schema (`CtxSearchSchema`)
3. `generateEmbedding(query)` → 384-dim float vector via local HuggingFace pipeline
4. `VectorStore.search(queryEmbedding, limit)` → top-K results by cosine distance from LanceDB
5. For each vector result, `DependencyGraph.getImports()` and `getImporters()` expand the result set with structurally related files (score penalized by +0.1)
6. Results re-ranked: combined vector similarity (60%) + graph proximity (40%), sorted ascending by score
7. Response formatted as XML `<search_results>` and returned via MCP

**Context Packet Request (ctx_get_context_packet):**

1. MCP client sends `ctx_get_context_packet` with `{ target_file, mode }`
2. `PathValidator.readFile(target_file)` reads primary file content (with path boundary enforcement)
3. `DependencyGraph.getImports(target_file)` → list of dependency files
4. `DependencyGraph.getImporters(target_file)` → list of files that import target
5. For each dependency: `Skeletonizer.skeletonize(absPath)` reduces full file to signature-only view (~90% token reduction)
6. Response assembled as XML `<context_packet>` with primary content, dependency skeletons, and importer list

**File Change Re-indexing:**

1. `chokidar` detects `add | change | unlink` on a source file
2. 200ms debounce timer fires
3. On `unlink`: `VectorStore.remove(relPath)` deletes embedding record
4. On `add | change`: file content read → `generateEmbedding(content.slice(0, 4096))` → `VectorStore.upsert(relPath, embedding, content.slice(0, 512))`

**Call Graph Request (ctx_get_call_graph):**

1. MCP client sends `ctx_get_call_graph` with `{ symbol, direction, depth, target_file? }`
2. If no `target_file`: `DependencyGraph.lookupSymbol(symbol)` → definition file paths from symbol index
3. `DependencyGraph.traverse(startFile, direction, depth)` → BFS traversal over forward or reverse adjacency list
4. Results formatted as XML `<call_graph>` with `<source>` and `<imported_by | imports>` nodes

**Graph Initialization:**

1. `startServer()` triggers `getGraph()` asynchronously in the background
2. `DependencyGraph.buildFromDirectory(PROJECT_ROOT)` checks `.ctxloom/graph-snapshot.json` first
3. If snapshot exists: hydrate from JSON in O(n) time
4. If not: `collectFiles()` → for each file, `ASTParser.parse()` → extract import nodes → `addEdge()` → build symbol index
5. After build: `saveSnapshot()` persists to `.ctxloom/graph-snapshot.json`

**State Management:**
- `DependencyGraph`: in-memory `Map<string, Set<string>>` adjacency lists; persisted as JSON snapshot
- `VectorStore`: LanceDB file-based at `.ctxloom/vectors.lancedb`
- Embedder (`all-MiniLM-L6-v2` model): lazy singleton, cached in module scope
- All server-level subsystems: lazy singletons initialized on first tool call, stored as module-level `let` variables in `server.ts`

## Key Abstractions

**ParsedNode:**
- Purpose: Structured representation of a TypeScript/JavaScript AST node (function, class, interface, import, arrow_function, export_default)
- Examples: `src/ast/ASTParser.ts` (`ParsedNode` interface)
- Pattern: Flat record with `type`, `name`, `signature`, `methods`, `methodRanges`, `startLine`, `endLine`

**VectorSearchResult:**
- Purpose: Envelope for a LanceDB search hit
- Examples: `src/db/VectorStore.ts` (`VectorSearchResult` interface)
- Pattern: `{ filePath, content, score }` where score is cosine distance (lower = more similar)

**GraphEdge:**
- Purpose: Typed directed edge in the import graph
- Examples: `src/graph/DependencyGraph.ts` (`GraphEdge` interface)
- Pattern: `{ from: string, to: string }` (relative file paths)

**DetectedClient / MCPServerEntry:**
- Purpose: Registry entries for MCP-compatible AI tools
- Examples: `src/setup/clients.ts`
- Pattern: Client record includes detection logic (config paths, binaries, app bundles), config format, and `alreadyConfigured` flag

## Entry Points

**CLI Default (MCP Server):**
- Location: `src/index.ts` → `startServer()` in `src/server.ts`
- Triggers: `ctxloom` with no arguments, or `npx ctxloom` from MCP client config
- Responsibilities: Initialize MCP server on Stdio, start FileWatcher, lazily build DependencyGraph in background

**CLI: index:**
- Location: `src/index.ts` → `indexDirectory()` + `DependencyGraph.buildFromDirectory()`
- Triggers: `ctxloom index`
- Responsibilities: Batch-embed all source files in cwd, build and persist dependency graph snapshot

**CLI: setup:**
- Location: `src/index.ts` → `runSetupWizard()`
- Triggers: `ctxloom setup`
- Responsibilities: Detect installed MCP clients, offer interactive or automatic config writing

**Postinstall:**
- Location: `src/setup/postinstall.ts`
- Triggers: `npm install` via `postinstall` script
- Responsibilities: Run setup wizard in non-interactive mode

**Worker:**
- Location: `src/workers/indexerWorker.ts`
- Triggers: Spawned as a `worker_threads` Worker with `workerData`
- Responsibilities: Generate embedding and upsert to VectorStore off the main thread

## Error Handling

**Strategy:** Fail-fast with structured error responses. MCP tool handlers wrap all subsystem calls in try/catch and return `{ content: [{ type: 'text', text: 'Error: ...' }], isError: true }` rather than throwing. Fatal errors in `main()` exit with code 1.

**Patterns:**
- MCP tool handlers: catch-all try/catch, return `isError: true` response with message string
- PathValidator: throws `Error` with descriptive message on traversal attempt; callers catch and surface to MCP response
- VectorStore: silent catch on empty table deletes; falls back to index creation on search failure
- DependencyGraph: skips unparseable files silently; loadSnapshot returns false on parse error
- ASTParser / Skeletonizer: guard on init check (`if (!this.tsLang) throw`)
- WASM path discovery: multi-candidate resolution with last-resort fallback

## Cross-Cutting Concerns

**Logging:** All server-side logging goes to `console.error` (stderr) to avoid polluting the MCP Stdio transport on stdout. CLI output goes to `console.log`.

**Validation:** Zod schemas at the MCP tool boundary (`CtxSearchSchema`, `CtxGetFileSchema`, etc.); `PathValidator` for all filesystem reads.

**Authentication:** None — local-only server, no network exposure. Path boundary enforcement via `PathValidator` is the primary access control.

**Snapshot Persistence:** `DependencyGraph` writes `.ctxloom/graph-snapshot.json`; `VectorStore` writes `.ctxloom/vectors.lancedb`. Both directories are excluded from file watching and indexing.

---

*Architecture analysis: 2026-04-13*

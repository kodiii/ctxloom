# Codebase Concerns

**Analysis Date:** 2026-04-13

---

## Tech Debt

**`any` type on the global embedder singleton:**
- Issue: The HuggingFace pipeline is typed as `any`, suppressing all downstream type checking on the embedder object. The comment itself marks it with `eslint-disable-next-line @typescript-eslint/no-explicit-any`.
- Files: `src/indexer/embedder.ts` line 18
- Impact: No compile-time safety on pipeline calls; errors only surface at runtime.
- Fix approach: Import and use the `FeatureExtractionPipeline` type from `@huggingface/transformers` or create a minimal interface describing `.tolist()`.

**Non-null assertions on required-but-optional interface fields:**
- Issue: `getCallGraph` and `findCallers` both accept `parser` and `graph` as optional fields in their options interface, then immediately dereference them with the `!` operator (`opts.graph!`, `opts.parser!`). This is a design contradiction — the fields should simply be required.
- Files: `src/tools/findCallers.ts` lines 23, 77–78
- Impact: Runtime crash if callers omit `graph` or `parser`; TypeScript does not catch it.
- Fix approach: Mark `graph` and `parser` as required in `GetCallGraphOptions` and `FindCallersOptions`.

**`require()` call in an ESM module:**
- Issue: `commandExists()` in `src/setup/clients.ts` (line 414) uses `require('node:child_process').execSync`. The package is declared as `"type": "module"`, making CommonJS `require()` unavailable at runtime in standard ESM contexts. A second `require()` appears in `getServerEntry()` at line 53 for `require.resolve`.
- Files: `src/setup/clients.ts` lines 53, 414
- Impact: `ctxloom setup` will throw `ReferenceError: require is not defined` at runtime on Node 22 in strict ESM mode.
- Fix approach: Replace with `import { execSync } from 'node:child_process'` and `import.meta.resolve()` respectively; or use `createRequire(import.meta.url)` as a shim.

**`require()` in `ASTParser.ts` (ESM module):**
- Issue: The WASM discovery fallback in `src/ast/ASTParser.ts` (line 45) calls `require.resolve('web-tree-sitter/package.json')` inside a try/catch that swallows the error. In ESM this silently always fails, leaving the fallback path unreachable.
- Files: `src/ast/ASTParser.ts` line 45
- Impact: Silently broken WASM discovery path in ESM — increases risk of hard-to-diagnose `ASTParser not initialized` errors.
- Fix approach: Use `import.meta.resolve()` or remove the dead branch and rely on the working candidates above it.

**Graph snapshot has no staleness detection:**
- Issue: `DependencyGraph.loadSnapshot()` restores from disk without checking file modification timestamps or a content hash. If source files are added, deleted, or modified between runs the snapshot will silently serve stale graph data.
- Files: `src/graph/DependencyGraph.ts` lines 243–265
- Impact: `ctx_get_call_graph` and `ctx_get_definition` return incorrect results after files change between server restarts.
- Fix approach: Store a `builtAt` timestamp in the snapshot and rebuild if any tracked file has a newer `mtime`, or add a version hash of the file list.

**Skeletonizer re-reads the source file on every method signature extraction:**
- Issue: `readLines()` in `src/ast/Skeletonizer.ts` (line 147) calls `fs.readFileSync` synchronously on the file for each node in the skeleton, meaning a file with N nodes causes N synchronous disk reads.
- Files: `src/ast/Skeletonizer.ts` lines 147–149
- Impact: Performance degrades linearly with the number of symbols in the file; I/O amplification proportional to N.
- Fix approach: Read the file once at the top of `skeletonize()` and `skeletonizeXML()`, pass the lines array to `readLines()`.

**`collectFiles` ignores directories that start with `.` (too broad):**
- Issue: In `src/indexer/embedder.ts` line 72, any directory whose name starts with `.` is silently skipped. This correctly excludes `.git` and `.ctxloom`, but also accidentally excludes legitimate source directories like `.github/workflows` or `.claude/agents`.
- Files: `src/indexer/embedder.ts` line 72
- Impact: Hidden source directories are not indexed or graphed, causing incomplete search results.
- Fix approach: Replace the blanket `.startsWith('.')` check with an explicit allowlist or explicit denylist using the same `IGNORED_DIRS` set already defined above it.

**`indexDirectory` is sequential (no concurrency):**
- Issue: `indexDirectory` in `src/indexer/embedder.ts` processes files one-at-a-time inside a `for` loop, awaiting each embedding before moving to the next. A worker file exists (`src/workers/indexerWorker.ts`) but is never called — it appears to be dead/unused code.
- Files: `src/indexer/embedder.ts` lines 101–117, `src/workers/indexerWorker.ts`
- Impact: Initial indexing of large codebases is bottlenecked by sequential CPU-bound embedding computation. A 1000-file project will be significantly slower than necessary.
- Fix approach: Use the existing worker module with a pool of `worker_threads` (e.g., `pLimit` or a manual pool of 4–8 workers), or use `Promise.all` with controlled concurrency.

---

## Security Considerations

**No file-size limit on `readFile` / `readFileSync`:**
- Risk: `PathValidator.readFile()` and direct `fs.readFileSync` calls throughout the codebase read entire files into memory without size bounds. Serving extremely large generated files (minified bundles accidentally included in the indexed set) or symlinked special files can exhaust memory.
- Files: `src/security/PathValidator.ts` line 68, `src/ast/ASTParser.ts` line 120, `src/ast/Skeletonizer.ts` line 148
- Current mitigation: Path traversal is blocked; `collectFiles` ignores `dist/`.
- Recommendations: Add a configurable max file size (e.g., 1 MB) check before reading; skip or truncate oversized files.

**SQL-injection-style vector query injection via `filePath`:**
- Risk: In `src/db/VectorStore.ts` lines 69 and 135, the delete filter is built by string interpolation: `` `filePath = '${escaped}'` ``. The `escaped` value only replaces single quotes; other LanceDB filter syntax characters (e.g., backslash, SQL keywords) are not sanitised.
- Files: `src/db/VectorStore.ts` lines 68–73, 134–136
- Current mitigation: Partial: single-quote escaping only.
- Recommendations: Use LanceDB's parameterised filter API if available; otherwise apply a comprehensive allowlist on `filePath` (alphanumeric, `/`, `.`, `_`, `-`).

**`getServerEntry()` uses `require.resolve` to detect global install:**
- Risk: As noted in Tech Debt above, this call throws at runtime in ESM. Beyond the crash risk, resolving a package path and running it as `command: 'ctxloom'` without verifying the binary location could be a supply-chain vector if the package name is squatted.
- Files: `src/setup/clients.ts` lines 50–61
- Current mitigation: None (call is always inside a try/catch that silently falls back).
- Recommendations: Remove `require.resolve` in favour of `import.meta.resolve`; verify the resolved binary against a known prefix before using it.

**No input sanitisation on XML attribute values for `filePath` in search results:**
- Risk: In `src/server.ts` line 164 and related output in `src/tools/findCallers.ts`, `filePath` values from the graph/store are embedded directly into XML attribute strings: `file="${result.filePath}"`. If a file path contains `"` or `>` the XML is malformed; a crafted path could inject XML nodes that mislead the consuming AI.
- Files: `src/server.ts` lines 163–170, `src/tools/findCallers.ts` lines 103–108
- Current mitigation: Content inside tags is escaped; file path attributes are not.
- Recommendations: Apply the same `escapeXML()` helper (already present in `src/ast/Skeletonizer.ts` line 152) to all `file="..."` attributes.

---

## Performance Bottlenecks

**Synchronous `buildFromDirectory` on every cold start:**
- Problem: When no snapshot exists, `getGraph()` in `src/server.ts` (line 86–90) calls `buildFromDirectory` synchronously before the server can serve any tools. For large projects this can take tens of seconds.
- Files: `src/server.ts` lines 84–91, `src/graph/DependencyGraph.ts` lines 41–96
- Cause: AST parsing is done serially for every file in the project before the first request can be answered.
- Improvement path: Return a partially-ready graph immediately, continue building in background; or persist the snapshot more aggressively so cold starts are rare.

**`Skeletonizer.readLines()` synchronous disk I/O per node (repeated reads):**
- Already documented under Tech Debt above. For a class with 20 methods, the same file is read 20 times.

**`handleCtxGetContextPacket` uses `Promise.all` over potentially large import sets:**
- Problem: In `src/server.ts` lines 192–199, all imported files are skeletonized concurrently with `Promise.all`. For a highly-connected module with dozens of imports, this fires dozens of ASTParser+readFile operations simultaneously.
- Files: `src/server.ts` lines 192–199
- Cause: Unbounded concurrency on I/O + CPU-bound WASM parsing.
- Improvement path: Use `p-limit` or a similar concurrency limiter (e.g., max 5 concurrent skeletonizations).

**Embedding model loaded in-process on every server start:**
- Problem: `getEmbedder()` downloads or loads the `all-MiniLM-L6-v2` model from disk/network on first call. This is a 90 MB+ model and adds latency to the first tool invocation.
- Files: `src/indexer/embedder.ts` lines 23–30
- Cause: Lazy singleton; no pre-warming.
- Improvement path: Pre-warm the embedder during server startup in a background `Promise` (similar to how `getGraph()` is pre-warmed in `startServer`).

---

## Missing Error Handling

**Silent `catch {}` blocks that swallow all errors:**
- Multiple empty `catch {}` blocks silently discard errors, making debugging very difficult:
  - `src/graph/DependencyGraph.ts` line 88 — AST parse failure during graph build: the file is silently skipped with no logging.
  - `src/graph/DependencyGraph.ts` line 262 — snapshot `loadSnapshot` JSON parse failure: returns `false` silently, forcing a full rebuild with no warning.
  - `src/db/VectorStore.ts` line 72 — delete-before-upsert failure: silently continues, potentially creating duplicates.
  - `src/db/VectorStore.ts` line 123 — retry after creating index also silently returns `[]`.
  - `src/db/VectorStore.ts` line 150 — `countRows` failure: returns `0` silently.
  - `src/ast/ASTParser.ts` line 50 — WASM `require.resolve` fallback: silently ignored.
  - `src/setup/clients.ts` line 324 — malformed JSON config: partially detected but not surfaced to the user.
- Files: all listed above
- Impact: Transient and permanent failures are invisible; users see empty results with no diagnostic.
- Fix approach: Replace empty `catch {}` with at minimum `console.error('[ContextMesh] context:', err)` or structured error logging.

**`ctx_search` has no error handling at the top level:**
- In `src/server.ts` lines 323–327, `handleCtxSearch` is awaited without a try/catch. If `getStore()`, `generateEmbedding()`, or `store.search()` throw, the error is caught only by the outer handler at line 451, which returns a generic "Internal error" with no context about which tool failed or why.
- Files: `src/server.ts` lines 323–327
- Fix approach: Wrap `handleCtxSearch` call in its own try/catch consistent with the other tool handlers.

**`FileWatcher` callback errors are unhandled:**
- In `src/server.ts` lines 484–511, the watcher callback is an async function but `watcher.start()` inside `FileWatcher` does not attach a `.catch()` handler on the callback's promise. Any exception thrown during re-indexing produces an unhandled promise rejection.
- Files: `src/server.ts` lines 484–511, `src/watcher/FileWatcher.ts` lines 50–53
- Fix approach: Wrap the `this.onChange(...)` call in `FileWatcher` with try/catch or add `.catch()` to the resulting promise.

---

## Missing Observability

**No structured logging:**
- All logging is done via `console.error` (in server/graph code) and `console.log` (in CLI commands). There is no log levels, no structured JSON output, no correlation IDs, and no timestamps.
- Files: `src/server.ts`, `src/graph/DependencyGraph.ts`, `src/indexer/embedder.ts`
- Risk: In production (running as an MCP server process), `console.error` lines on stderr are the only signal. There is no way to filter by severity or search by file path.
- Recommendations: Introduce a minimal logger with level support (`debug`, `info`, `warn`, `error`); use structured JSON logging behind a flag for machine-readable output.

**No metrics on indexing or search performance:**
- There is no timing, latency tracking, or count metrics on embedding generation, graph traversal, or vector search.
- Files: all `src/` files
- Risk: Performance regressions are invisible until users notice slowness.
- Recommendations: Add `performance.now()` spans around critical paths and log durations at `debug` level; expose a summary on `ctx_get_rules` or a dedicated diagnostic tool.

**No health check or readiness signal:**
- The MCP server starts and immediately accepts tool calls, but the embedding model and graph may still be initialising. There is no way for the MCP client to know when the server is ready.
- Files: `src/server.ts` lines 467–527
- Risk: Tool calls made before the graph or embedder is ready will fail with opaque errors.
- Recommendations: Add a `ctx_ready` tool or a startup log line that explicitly signals readiness after both `getGraph()` and `getEmbedder()` resolve.

---

## Scalability Concerns

**In-memory dependency graph has no size bound:**
- `DependencyGraph` stores all nodes and edges in `Map<string, Set<string>>` with no eviction or pruning.
- Files: `src/graph/DependencyGraph.ts` lines 22–27
- Current capacity: Works well for codebases up to ~10,000 files; untested beyond that.
- Limit: Memory usage grows with project size; a monorepo with 50,000+ files would likely exhaust available memory.
- Scaling path: For very large projects, shard the graph or use an on-disk graph store. For typical projects, document the expected scale.

**`RuleManager` caches rule file content indefinitely:**
- `cachedRules` is populated on first load and never evicted unless `invalidateCache()` is called — but `invalidateCache()` is never called anywhere in the codebase.
- Files: `src/tools/ruleManager.ts` lines 29, 113
- Impact: Changes to `.cursorrules` or `CLAUDE.md` during a server session are not picked up without restarting the server.
- Scaling path: Hook the `FileWatcher` to call `ruleManager.invalidateCache()` when a rule file changes.

**No concurrency control on singleton initialisation:**
- All lazy singletons in `src/server.ts` (`getStore`, `getGraph`, `getParser`, `getSkeletonizer`) use double-checked `if (!_x)` guards without async locks. If multiple tool calls arrive before the singleton is ready, multiple concurrent `init()` calls will fire.
- Files: `src/server.ts` lines 67–118
- Impact: Multiple `lancedb.connect()` or `ASTParser.init()` calls may race, potentially corrupting the singleton or creating duplicate connections.
- Scaling path: Replace the `if (!_x)` pattern with a promise-memoised initialiser (store the `Promise<T>` itself, not `T`).

---

## Dependency Risks

**`@huggingface/transformers` at `^3.0.0` (semver major):**
- Risk: The `^` range allows major version bumps within the 3.x series but the library has historically had breaking changes between minor versions. The model loading API (`pipeline`, `dtype`, `tolist()`) may change without a major bump.
- Impact: Embedding generation silently broken after a minor update; the `any` type on the embedder means TypeScript will not catch API drift.
- Mitigation plan: Pin to an exact version or `~3.0.0` (patch-only) and add a regression test that asserts the output shape.

**`web-tree-sitter` at `^0.25.0` and `tree-sitter-typescript` at `^0.23.2`:**
- Risk: WASM grammar files are copied to `dist/wasm/` at build time. The WASM binary format and the API surface of `web-tree-sitter` can change between minor versions. The WASM discovery code already has 5 candidate paths as evidence of prior instability.
- Impact: `ASTParser.init()` fails with a hard-to-diagnose error if WASM path layout changes.
- Mitigation plan: Pin exact versions; document the WASM copy step clearly in the build config.

**`@lancedb/lancedb` at `^0.27.0`:**
- Risk: LanceDB is a fast-moving project; the native addon is rebuilt for each Node version. The filter string API (used for upsert/delete) is undocumented for parameterised queries.
- Impact: Filter injection risk (noted above in Security); potential breakage on Node version upgrades.
- Mitigation plan: Pin exact version; watch the LanceDB changelog for parameterised filter support.

**`workers/indexerWorker.ts` is dead code:**
- Risk: The file exists and is part of the distributed package but is never imported or spawned. It represents maintenance surface (must be updated when `generateEmbedding` or `VectorStore` signatures change) without providing any benefit.
- Files: `src/workers/indexerWorker.ts`
- Impact: Confusion for contributors; potential for the dead worker to diverge and cause subtle bugs if eventually activated.
- Mitigation plan: Either integrate the worker into `indexDirectory` (completing the intended design) or delete the file.

---

## Test Coverage Gaps

**MCP tool integration tests are largely vacuous:**
- `tests/MCP.test.ts` tests that `createServer()` returns a `Server` instance, then verifies that a hardcoded array has 6 elements — it does not invoke any tool handler end-to-end.
- Files: `tests/MCP.test.ts` lines 32–58
- Risk: Tool handler bugs (wrong Zod schema, incorrect XML output, unhandled edge cases) are not caught.
- Priority: HIGH — these are the most user-facing code paths with zero functional coverage.

**`ctx_search` hybrid ranking logic is untested:**
- The re-ranking logic in `handleCtxSearch` (graph score offset of `+0.1`, combination of vector + graph proximity) has no tests.
- Files: `src/server.ts` lines 131–159
- Risk: Silent regression in search quality after changes.
- Priority: HIGH

**`indexDirectory` sequential flow has no integration test:**
- The `indexDirectory` function is only tested indirectly through `VectorStore` unit tests. The full flow of reading a file, generating an embedding, and upserting is not tested together.
- Files: `src/indexer/embedder.ts` lines 89–120
- Risk: Regressions in the indexing pipeline are not caught.
- Priority: MEDIUM

**Snapshot staleness and `buildFromDirectory` rebuild path are not tested:**
- `DependencyGraph.loadSnapshot()` success and failure paths are not covered by `tests/DependencyGraph.test.ts`.
- Files: `src/graph/DependencyGraph.ts` lines 243–265
- Risk: Snapshot corruption or format changes cause silent graph failures in production.
- Priority: MEDIUM

**Embedding tests conditionally skip based on local HuggingFace cache:**
- `tests/Embedder.test.ts` silently skips `generateEmbedding` tests if `~/.cache/huggingface` is absent. In CI this means the most critical function is never exercised.
- Files: `tests/Embedder.test.ts` lines 14–23, 33–38
- Risk: Embedding model API changes (e.g., `.tolist()` behaviour) are not detected in CI.
- Priority: MEDIUM — use a fixture or mock model in unit tests; reserve real model tests for a separate integration suite.

**No coverage thresholds configured:**
- `vitest.config.ts` does not configure a `coverage` section or minimum thresholds.
- Files: `vitest.config.ts`
- Risk: Coverage can regress to zero without any pipeline failure.
- Priority: LOW — add `coverage: { thresholds: { lines: 80 } }` and run `vitest run --coverage` in CI.

**`noUnusedLocals` and `noUnusedParameters` disabled in TypeScript:**
- `tsconfig.json` lines 18–19 explicitly set both to `false`, meaning unused variables and parameters produce no compile error.
- Files: `tsconfig.json`
- Risk: Dead code accumulates silently; the unused `workers/indexerWorker.ts` is a direct result.
- Priority: LOW — enable both flags, resolve any existing violations.

---

*Concerns audit: 2026-04-13*

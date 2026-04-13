# Coding Conventions

**Analysis Date:** 2026-04-13

## Naming Patterns

**Files:**
- PascalCase for class-based modules: `ASTParser.ts`, `VectorStore.ts`, `DependencyGraph.ts`, `PathValidator.ts`, `FileWatcher.ts`, `Skeletonizer.ts`
- camelCase for function/utility modules: `embedder.ts`, `findCallers.ts`, `ruleManager.ts`
- camelCase for setup/entry files: `server.ts`, `index.ts`, `clients.ts`, `postinstall.ts`, `setup-wizard.ts`
- Test files mirror source names with `.test.ts` suffix: `ASTParser.test.ts`, `VectorStore.test.ts`

**Classes:**
- PascalCase: `ASTParser`, `DependencyGraph`, `VectorStore`, `PathValidator`, `FileWatcher`, `RuleManager`, `Skeletonizer`

**Functions:**
- camelCase for exported functions: `generateEmbedding()`, `collectFiles()`, `findCallers()`, `getCallGraph()`, `indexDirectory()`
- camelCase for private/internal functions: `findWasmDir()`, `getEmbedder()`, `getPathValidator()`

**Interfaces:**
- PascalCase: `ParsedNode`, `CallSite`, `MethodRange`, `GraphEdge`, `RuleFile`, `VectorSearchResult`

**Variables and Parameters:**
- camelCase throughout: `projectRoot`, `forwardEdges`, `reverseEdges`, `symbolIndex`, `cachedRules`
- Private class fields prefixed with underscore only for lazy singletons in `server.ts`: `_pathValidator`, `_store`
- Constants in SCREAMING_SNAKE_CASE for module-level config: `EMBEDDING_DIMENSION`, `MODEL_ID`, `CHUNK_SIZE`, `WASM_DIR`, `PROJECT_ROOT`, `DB_PATH`, `RULE_FILES`

**Zod Schemas:**
- PascalCase with `Schema` suffix: `CtxSearchSchema`, `CtxGetFileSchema`, `CtxGetContextPacketSchema`

## Code Style

**Formatting:**
- No Prettier config detected — formatting is not auto-enforced
- Single quotes for string literals
- Semicolons at end of statements
- 2-space indentation throughout
- Trailing commas in multi-line arrays and objects

**Type Checking (Linting):**
- TypeScript strict mode enabled (`"strict": true` in `tsconfig.json`)
- `tsc --noEmit` is the lint command (`npm run lint`)
- No ESLint config present — linting is TypeScript-only
- `noUnusedLocals` and `noUnusedParameters` are explicitly set to `false`

**TypeScript Configuration:**
- Target: ES2022
- Module: NodeNext with NodeNext module resolution
- `esModuleInterop: true`, `skipLibCheck: true`
- `resolveJsonModule: true`
- Declarations and source maps generated on build

## Import Organization

**Order observed:**
1. External packages (`web-tree-sitter`, `@huggingface/transformers`, `@lancedb/lancedb`, `@modelcontextprotocol/sdk/*`, `zod`)
2. Node built-ins via `node:` protocol (`node:fs`, `node:path`, `node:url`, `node:os`)
3. Internal modules with `.js` extension (ESM-compatible imports)

**Path Aliases:** None — all internal imports are relative paths with `.js` extension (ESM requirement):
```typescript
import { ASTParser } from '../ast/ASTParser.js';
import { collectFiles } from '../indexer/embedder.js';
```

**Node Built-in Protocol:** Consistently uses `node:` prefix for all built-in imports:
```typescript
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
```

## Error Handling

**Strategy:** Explicit try/catch with silent-skip pattern for non-critical operations.

**Patterns observed:**
- Empty `catch {}` blocks for recoverable/ignorable errors (file not found, unparseable files, snapshot load failure):
  ```typescript
  try {
    const nodes = await this.parser.parse(absPath);
  } catch {
    // Unparseable file — skip
  }
  ```
- `catch (err: unknown)` or `catch (err: any)` for errors that need to be re-thrown or logged:
  ```typescript
  } catch (err: any) {
    if (err?.message?.includes('Unauthorized')) { ... }
    throw err;
  }
  ```
- Guard clauses for uninitialized state:
  ```typescript
  if (!this.tsLang) throw new Error('ASTParser not initialized. Call init() first.');
  ```
- Boolean return pattern for fallible operations (`loadSnapshot()` returns `boolean`)
- Result object pattern in setup code: `{ success: boolean; message: string }`

**Error Messages:** Descriptive and include the input value in the message:
```typescript
throw new Error(`Path traversal blocked: "${inputPath}" resolves to "${canonical}" which is outside project root "${this.canonicalRoot}"`);
```

## Logging

**Approach:** `console.error` for operational logs (MCP server context; stderr does not interfere with MCP stdio), `console.log` for CLI/user-facing output (setup wizard, postinstall, index commands).

**Prefixing:** All operational log messages use `[ContextMesh]` or `[VectorStore]` prefix:
```typescript
console.error('[ContextMesh] Graph built from 42 files (17 edges)');
console.error('[VectorStore] Search failed, attempting to create index:', err);
```

**CLI output:** `setup-wizard.ts` and `postinstall.ts` use `console.log` with ANSI color codes for interactive user output. This is intentional for the CLI context.

## Comments

**File-level JSDoc:** Every source file opens with a `/** */` block describing the module purpose, key design decisions, and sometimes references to requirement IDs:
```typescript
/**
 * ASTParser — Wraps web-tree-sitter to extract structured nodes
 * ...
 * Handles both tree-sitter WASM grammar versions:
 *   - import_statement (newer tree-sitter-typescript)
 *   - import_declaration (older tree-sitter-typescript)
 */
```

**Method-level JSDoc:** Public methods on classes have `/** */` doc comments explaining purpose, parameters, and return values:
```typescript
/**
 * Validates that the given input path resolves within the project root.
 * @returns The canonical absolute path if valid
 * @throws Error if the path escapes the project root
 */
validate(inputPath: string): string { ... }
```

**Inline comments:** Used for section separators using ASCII art dividers:
```typescript
// ─── Configuration ──────────────────────────────────────────────────────
// ─── Lazy Singletons ────────────────────────────────────────────────────
// ─── Import statements (both grammar versions) ────────────────────────
```

**Requirement references:** Some comments reference PRD items: `// Fulfills FR-09 (Rule Injection, P0) from the PRD`

## Module Design

**Exports:** Named exports are the default pattern. Classes, interfaces, and utility functions are all named exports. `export default` is only used in fixture files.

**Class pattern:** Stateful modules (parser, store, graph, watcher) are classes. Stateless utilities (`generateEmbedding`, `collectFiles`, `findCallers`) are exported functions.

**Lazy initialization:** Shared instances in `server.ts` use lazy singleton functions to defer expensive initialization:
```typescript
let _store: VectorStore | null = null;
async function getStore(): Promise<VectorStore> {
  if (!_store) {
    _store = new VectorStore(DB_PATH);
    await _store.init();
  }
  return _store;
}
```

**Input validation:** Zod schemas defined at module level in `server.ts` for all MCP tool inputs. `PathValidator` used at every file access boundary.

## File Organization

- Source files are organized by domain under `src/`: `ast/`, `db/`, `graph/`, `indexer/`, `security/`, `setup/`, `tools/`, `watcher/`, `workers/`
- Each directory contains 1-2 tightly focused files (high cohesion)
- Tests are in a flat `tests/` directory at project root (not co-located with source)
- Test fixtures are in `tests/fixtures/`
- `src/server.ts` (528 lines) is the largest file and serves as the integration layer — it is at the upper limit of acceptable size

---

*Convention analysis: 2026-04-13*

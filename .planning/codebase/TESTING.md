# Testing Patterns

**Analysis Date:** 2026-04-13

## Test Framework

**Runner:**
- Vitest 3.x
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest built-in (`expect`) — no separate assertion library

**Run Commands:**
```bash
npm test              # Run all tests once (vitest run)
npx vitest            # Watch mode
npx vitest --coverage # Coverage (no threshold configured)
```

**Vitest Configuration:**
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    globals: true,         // describe/it/expect available without imports
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,   // 30s — accommodates WASM init and real I/O
    hookTimeout: 30_000,
  },
});
```

Note: `globals: true` is set but all test files still explicitly import `describe`, `it`, `expect`, `beforeAll`, `beforeEach`, `afterEach` from `vitest`. This is consistent and preferred for IDE support.

## Test File Organization

**Location:** Separate `tests/` directory at project root — NOT co-located with source files.

**Naming:**
- Test files use PascalCase matching the module name: `ASTParser.test.ts`, `DependencyGraph.test.ts`
- Exception: `MCP.test.ts` (server integration test), `findCallers.test.ts` (camelCase)
- Fixture files live in `tests/fixtures/`: `sample.ts` (TypeScript fixture for AST tests), `config.ts` (type fixture)

**Structure:**
```
tests/
├── ASTParser.test.ts        # Unit tests for src/ast/ASTParser.ts and Skeletonizer.ts
├── DependencyGraph.test.ts  # Unit tests for src/graph/DependencyGraph.ts
├── Embedder.test.ts         # Unit + conditional integration for src/indexer/embedder.ts
├── FileWatcher.test.ts      # Integration tests for src/watcher/FileWatcher.ts
├── MCP.test.ts              # Integration test for src/server.ts
├── PathValidator.test.ts    # Unit tests for src/security/PathValidator.ts
├── RuleManager.test.ts      # Unit tests for src/tools/ruleManager.ts
├── SetupWizard.test.ts      # Unit + integration tests for src/setup/clients.ts
├── VectorStore.test.ts      # Integration tests for src/db/VectorStore.ts
├── findCallers.test.ts      # Unit tests for src/tools/findCallers.ts
└── fixtures/
    ├── sample.ts            # TypeScript fixture file for AST parsing tests
    ├── config.ts            # Type fixture imported by sample.ts
    └── README.md
```

## Test Structure

**Suite Organization:**
```typescript
// File-level JSDoc describing what is tested
/**
 * Tests for ASTParser and Skeletonizer — Code parsing and skeletonization.
 */
import { describe, it, expect, beforeAll } from 'vitest';

describe('ClassName', () => {
  let instance: ClassName;

  beforeAll(async () => {
    instance = new ClassName();
    await instance.init();
  });

  describe('methodName()', () => {
    it('should [expected behavior]', async () => {
      const result = await instance.methodName(input);
      expect(result).toSatisfySomeAssertion();
    });
  });
});
```

**Patterns:**
- Top-level `describe` groups by class or export name
- Nested `describe` groups by method name with `()` suffix: `describe('parse()', () => {`
- Test names use the pattern `'should [do something]'`
- `beforeAll` for expensive async setup (WASM init, database init)
- `beforeEach` for per-test state reset (fresh class instance, fresh temp directory)
- `afterEach` for cleanup of temp directories via `fs.rmSync(tempDir, { recursive: true, force: true })`

## Mocking

**Framework:** No mocking library used. Tests use real implementations throughout.

**Strategy:** Real implementations with isolated state:
- `fs.mkdtempSync` creates isolated temp directories per test — no mocks needed for filesystem
- Real LanceDB connection in `VectorStore.test.ts` using temp dirs
- Real chokidar file watcher in `FileWatcher.test.ts`
- No `vi.mock()`, `vi.spyOn()`, or `jest.fn()` patterns present

**What is NOT mocked:**
- Filesystem operations (real temp dirs used instead)
- LanceDB database (real connection in temp dir)
- File watchers (real chokidar watcher)
- PathValidator (real implementation injected as dependency)

**Partial integration in MCP.test.ts:** When the full SDK transport cannot be tested, tests import sub-modules directly and test them in isolation:
```typescript
// Can't test server.request() without a transport — test sub-modules directly
const { PathValidator } = await import('../src/security/PathValidator.js');
const validator = new PathValidator(process.cwd());
expect(() => validator.validate('../../../etc/passwd')).toThrow('Path traversal blocked');
```

## Fixtures and Factories

**Test Data:**
- `tests/fixtures/sample.ts`: A real TypeScript file used as AST parsing input. Contains exports of each type the parser handles (interface, class, function, arrow function, export default, imports).
- `tests/fixtures/config.ts`: Minimal type definition imported by `sample.ts` to test cross-file import resolution.
- Inline data: Vector embeddings constructed inline with `new Array(384).fill(0)` and manual perturbations.
- Temp directories: Each stateful test suite creates/destroys a `fs.mkdtempSync` directory.

**Factory pattern:** Not used — test data is constructed inline or via fixture files.

## Coverage

**Requirements:** No coverage threshold configured — no `coverage` section in `vitest.config.ts`.

**Measured coverage:** Not enforced in CI. Run manually with `npx vitest --coverage`.

**Estimated coverage per module:**

| Module | Tests | Coverage Quality |
|--------|-------|-----------------|
| `src/security/PathValidator.ts` | `PathValidator.test.ts` | High — all public methods exercised including edge cases |
| `src/graph/DependencyGraph.ts` | `DependencyGraph.test.ts` | High — all public methods and edge cases covered |
| `src/tools/ruleManager.ts` | `RuleManager.test.ts` | High — all methods including cache, XML escaping |
| `src/db/VectorStore.ts` | `VectorStore.test.ts` | High — real I/O tested with temp db |
| `src/ast/ASTParser.ts` | `ASTParser.test.ts` | High — all node types exercised |
| `src/ast/Skeletonizer.ts` | `ASTParser.test.ts` | Medium — happy-path only |
| `src/watcher/FileWatcher.ts` | `FileWatcher.test.ts` | Medium — add/change/ignore tested but deletion not tested |
| `src/indexer/embedder.ts` | `Embedder.test.ts` | Medium — `collectFiles` high, `generateEmbedding` conditionally skipped if HF not accessible |
| `src/tools/findCallers.ts` | `findCallers.test.ts` | Medium — core logic covered, but `findCallers` with a parser is untested |
| `src/setup/clients.ts` | `SetupWizard.test.ts` | Medium — registry and config write/remove tested, detection is environment-dependent |
| `src/server.ts` | `MCP.test.ts` | Low — server creation tested, individual tool handlers not unit tested |
| `src/setup/setup-wizard.ts` | None | None — no tests |
| `src/workers/indexerWorker.ts` | None | None — no tests |
| `src/index.ts` | None | None — no tests |
| `src/setup/postinstall.ts` | None | None — no tests |

## Test Types

**Unit Tests:**
- `DependencyGraph.test.ts` — pure in-memory graph operations, synchronous
- `PathValidator.test.ts` — filesystem boundary validation
- `RuleManager.test.ts` — file loading and caching logic
- `findCallers.test.ts` — graph traversal and XML output

**Integration Tests (real I/O, real dependencies):**
- `VectorStore.test.ts` — real LanceDB in temp directory
- `FileWatcher.test.ts` — real chokidar watcher with real filesystem events
- `ASTParser.test.ts` — real WASM-based tree-sitter parser
- `SetupWizard.test.ts` — real filesystem config file read/write
- `MCP.test.ts` — real MCP Server SDK instantiation

**E2E Tests:**
- Not present — no Playwright or similar framework configured

## Common Patterns

**Async Testing:**
```typescript
// beforeAll for expensive shared setup
beforeAll(async () => {
  parser = new ASTParser();
  await parser.init(); // WASM init — done once per suite
});

// async it blocks
it('should parse the sample TypeScript file', async () => {
  const nodes = await parser.parse(SAMPLE_TS);
  expect(nodes.length).toBeGreaterThan(0);
});
```

**Filesystem Testing (temp dir pattern):**
```typescript
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextmesh-test-'));
  validator = new PathValidator(tempDir);
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
```

**Error/Throw Testing:**
```typescript
// Synchronous throws
expect(() => validator.validate('../../../etc/passwd')).toThrow('Path traversal blocked');

// Async resolves without throw
await expect(store.remove('nonexistent.ts')).resolves.not.toThrow();

// Should not throw
expect(() => graph.removeFile('nonexistent.ts')).not.toThrow();
```

**Conditional Skip Pattern (Embedder):**
```typescript
// No vi.skip() — uses try/catch with manual warning
it('should produce a vector of the correct dimension', async () => {
  try {
    const embedding = await generateEmbedding('hello world');
    expect(embedding.length).toBe(EMBEDDING_DIMENSION);
  } catch (err: any) {
    if (err?.message?.includes('Unauthorized') || err?.message?.includes('access')) {
      console.warn('Skipping embedding test: HuggingFace model not accessible');
      return;
    }
    throw err;
  }
});
```

**Real file paths in tests:**
```typescript
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const SAMPLE_TS = path.join(FIXTURES_DIR, 'sample.ts');
```

## Notable Coverage Gaps

**`src/server.ts` (528 lines):** Tool handler logic is tested only at the sub-module level. The MCP tool handlers themselves (`ctx_search`, `ctx_get_context_packet`, `ctx_get_call_graph`, `ctx_get_definition`) have no direct test coverage. This is the largest gap.

**`src/setup/setup-wizard.ts`:** Interactive CLI wizard has zero tests. Relies on manual testing.

**`src/workers/indexerWorker.ts`:** Worker thread entrypoint has zero tests.

**`src/index.ts`:** CLI entrypoint has zero tests.

**File deletion handling in `FileWatcher`:** `unlink` events not tested in `FileWatcher.test.ts`.

**`findCallers` with a real parser:** `findCallers.test.ts` intentionally omits the parser argument to avoid WASM setup cost — call site lookup is not exercised.

**`DependencyGraph.buildFromDirectory()`:** The full directory scan + snapshot cycle is not unit tested. `buildFromDirectory` is exercised only implicitly through the MCP server startup in production.

---

*Testing analysis: 2026-04-13*

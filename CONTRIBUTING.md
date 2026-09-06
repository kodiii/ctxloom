# Contributing to ctxloom

Thanks for your interest in contributing! This guide covers the most common contribution paths.

## Quick orientation

```
packages/core/src/
├── tools/          # MCP tool implementations
├── ast/            # Tree-sitter parsing and skeletonization
├── graph/          # DependencyGraph, CallGraphIndex, CommunityDetector
├── utils/          # Import extractors, resolvers, and logging
├── grammars/       # Lazy grammar download + SHA-256 cache
└── indexer/        # File collection and vector indexing
packages/mcp-client/ # Public client package surface
apps/dashboard/      # Local web dashboard
apps/pr-bot/         # GitHub App and review action
src/                 # Compatibility re-exports and CLI entry points
tests/               # Vitest integration and regression tests
evaluate/            # External-oracle benchmark methodology and reports
```

Most implementation work belongs in `packages/core/src`. Files under `src/`
with the same names may only re-export the package implementation; check before
editing so a change lands in the source of truth.

## Development setup

```bash
git clone https://github.com/kodiii/ctxloom.git
cd ctxloom
npm ci
npm run build     # tsup, outputs to dist/
npm test          # vitest test suite
npm run lint      # tsc --noEmit
```

For package publication and release steps, see [`docs/RELEASING.md`](docs/RELEASING.md).

## Add or extend language support

This is the most impactful contribution you can make.

ctxloom currently indexes TypeScript/JavaScript, Python, Go, Rust, Java, C#,
Ruby, Kotlin, Swift, PHP, Dart, Vue, Jupyter, C/C++, Scala, Lua, Elixir, and
Zig. Check the issue tracker before starting another language so the work is not
duplicated.

A language usually touches these implementation surfaces:

1. `packages/core/src/grammars/GrammarLoader.ts` — register or load the grammar.
2. `packages/core/src/ast/ASTParser.ts` — extract declarations and imports.
3. `packages/core/src/utils/importExtractor.ts` — resolve local imports.
4. `packages/core/src/indexer/embedder.ts` — include the file extensions.
5. `packages/core/src/watcher/FileWatcher.ts` — recognize changed source files.
6. Tests under `tests/` — cover parsing, resolution, invalid syntax, and watcher/indexer parity.

Use an existing language with a similar module system as the template. For
example, a grammar registry entry has this shape:

```typescript
{
  language: 'kotlin',         // short name used in loadKotlin()
  version: '0.3.0',          // check npm for latest tree-sitter-kotlin version
  extensions: ['.kt', '.kts'],
  wasmFile: 'tree-sitter-kotlin.wasm',
  downloadUrl: 'https://github.com/nickel-lang/tree-sitter-kotlin/releases/download/v0.3.0/tree-sitter-kotlin.wasm',
  sha256: 'abc123...',        // SHA-256 of the WASM file
},
```

Tests should cover:

- Parse returns function/class/interface nodes
- Import nodes have correct `source` field
- Empty file returns `[]`
- Invalid syntax doesn't throw
- Imports resolve to the expected graph edge
- Indexer and file watcher accept the same extensions

Update the README language list and add a changelog entry with the tests used to
verify the new support.

---

## Adding or modifying an MCP tool

Each tool lives in `packages/core/src/tools/<name>.ts` and exports a registration
function such as `register<Name>Tool(registry, ctx)`.

1. Write failing tests in `tests/<Name>.test.ts`
2. Implement the tool (returns XML string)
3. Register it in the MCP server's tool registry
4. Add to help text in `src/index.ts`

See `packages/core/src/tools/blast-radius.ts` as a clean example.

## Code style

- TypeScript strict mode — no `any` in application code
- Immutable data patterns (no in-place mutation)
- Functions under 50 lines where possible
- All exported functions have explicit parameter and return types
- No `console.log` in source — use `logger.info/warn/error`
- XML output must escape all user-controlled strings via `escapeXML()`
- **Discriminated unions use compile-time exhaustiveness checks.** When `switch`ing on a `kind` discriminant, always include a `default` arm that assigns to `never` so adding a new union member is a TypeScript error at the switch site, not a silent runtime fallthrough:

  ```ts
  switch (source.kind) {
    case 'section':      return handleSection(source);
    case 'section-from': return handleSectionFrom(source);
    default: {
      const _exhaustive: never = source;
      throw new Error(`Unhandled kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
  ```

  Example: `apps/pr-bot/tests/agents.test.ts:extractFromSpec` (the `SharedBlockSource` union). Convention established by [PR #111's dogfood review (ARCH-111-2)](https://github.com/kodiii/ctxloom/pull/111).

## Running a subset of tests

```bash
npx vitest run tests/ASTParser.test.ts        # single file
npx vitest run --reporter=verbose             # verbose output
npx tsc --noEmit                              # type check only
```

## Pull request checklist

- [ ] Tests pass: `npm test`
- [ ] Type check passes: `npm run lint`
- [ ] New features have tests
- [ ] README updated if new language or tool added
- [ ] CHANGELOG entry added under `[Unreleased]`

## Good first issues

Look for issues tagged [`good first issue`](https://github.com/kodiii/ctxloom/issues?q=is%3Aopen+label%3A%22good+first+issue%22).

The easiest: **add tree-sitter support for a new language** using the template above.
Each language addition generates real GitHub visibility from that language community.

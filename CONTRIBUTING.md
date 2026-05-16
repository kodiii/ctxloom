# Contributing to ctxloom

Thanks for your interest in contributing! This guide covers the most common contribution paths.

## Quick orientation

```
src/
├── tools/          # One file per MCP tool — the easiest place to start
├── ast/ASTParser.ts   # Tree-sitter parsing per language
├── graph/          # DependencyGraph, CallGraphIndex, CommunityDetector
├── utils/          # Import extractors, GoModuleResolver, logger
└── grammars/       # Lazy grammar download + SHA-256 cache
tests/              # Vitest tests — one file per module
benchmarks/         # benchmark.ts + results.json
```

## Development setup

```bash
git clone https://github.com/kodiii/ctxloom.git
cd ctxloom
npm install
npm run build     # tsup, outputs to dist/
npm test          # vitest run (274 tests, ~90s)
npm run lint      # tsc --noEmit
```

## Add a new language in ~30 minutes

This is the most impactful contribution you can make.

Languages waiting for a PR: **C#, C/C++, Ruby, PHP, Kotlin, Swift**

Each language needs changes in 4 files. Here's the exact template:

### 1. `src/grammars/GrammarLoader.ts` — register the grammar

Find the `GRAMMARS` registry and add an entry:

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

### 2. `src/ast/ASTParser.ts` — add parse logic

```typescript
// 1. Add private field
private kotlinLang: TreeSitter.Language | null = null;

// 2. Add loader method
private async loadKotlin(): Promise<void> {
  if (this.kotlinLang) return;
  try {
    const wasmPath = await this.grammarLoader.ensureGrammar('kotlin');
    this.kotlinLang = await TreeSitter.Language.load(wasmPath);
  } catch (err) {
    logger.warn('Kotlin grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
  }
}

// 3. Route .kt / .kts in the parse() dispatch
if (ext === '.kt' || ext === '.kts') return this.parseKotlin(filePath);

// 4. Implement parser — emit nodes with these types:
//    'function', 'class', 'interface', 'import'
//    Each node needs: type, name, signature, startLine, endLine
//    Import nodes also need: source (the import path string)
private async parseKotlin(filePath: string): Promise<ParsedNode[]> {
  if (!this.kotlinLang) await this.loadKotlin();
  if (!this.kotlinLang) return [];

  const parser = new TreeSitter.Parser();
  parser.setLanguage(this.kotlinLang);
  const source = fs.readFileSync(filePath, 'utf-8');
  const tree = parser.parse(source);
  if (!tree) return [];

  const nodes: ParsedNode[] = [];
  const lines = source.split('\n');

  const walk = (node: TreeSitter.Node): void => {
    switch (node.type) {
      case 'function_declaration': {
        const nameNode = node.childForFieldName?.('name');
        if (nameNode) {
          nodes.push({
            type: 'function',
            name: nameNode.text,
            signature: (lines[node.startPosition.row] ?? '').trim(),
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
        }
        return;
      }
      // add class_declaration, import_header, etc.
    }
    for (const child of node.children) {
      if (child) walk(child);
    }
  };

  walk(tree.rootNode);
  return nodes;
}
```

### 3. `src/utils/importExtractor.ts` — add import resolution

Add a case for the new extension in both `extractImports()` and `resolveImport()`.
For most languages, this is: extract the string after `import` and map dots/slashes to a file path.

### 4. `src/indexer/embedder.ts` — include files in collection

Find `collectFiles()` and add the extension to the allowed set:

```typescript
const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs',
  '.py', '.go', '.rs', '.java',
  '.kt', '.kts',  // ← add here
]);
```

Also update `FileWatcher.isSourceFile()` in `src/watcher/FileWatcher.ts`.

### 5. Write tests

Add a test file `tests/ASTParser_<language>.test.ts` covering:
- Parse returns function/class/interface nodes
- Import nodes have correct `source` field
- Empty file returns `[]`
- Invalid syntax doesn't throw

See `tests/ASTParser.test.ts` for the pattern.

### 6. Update README

Add the language to the "Language Support" table in `README.md`.

---

## Adding or modifying an MCP tool

Each tool lives in `src/tools/<name>.ts` and exports `register<Name>Tool(registry, ctx)`.

1. Write failing tests in `tests/<Name>.test.ts`
2. Implement the tool (returns XML string)
3. Register in `src/tools/index.ts`
4. Add to help text in `src/index.ts`

See `src/tools/blast-radius.ts` as a clean example.

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

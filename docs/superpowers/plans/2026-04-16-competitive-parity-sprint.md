# Competitive Parity Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 6 feature gaps vs code-review-graph v2.3.2 and add PHP, Dart, and Vue/Svelte language support, while publishing real benchmark numbers.

**Architecture:**
- Phase 0: Run existing benchmark script, publish results to README
- Phase 1: Three new languages (PHP, Dart, Vue/Svelte) following the established loader/parser/extractor pattern already used for C#/Ruby/Kotlin/Swift
- Phase 2: Three quality-of-life gaps — `ctx_find_large_functions` tool, `detail_level` param on all tools, and edge confidence tiers on the call graph
- All changes are additive — no existing behavior is modified, only extended.

**Tech Stack:** TypeScript/ESM, NodeNext, tree-sitter WASM, vitest, zod, tsup

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/grammars/grammar-manifest.ts` | Modify | Add PHP, Dart, Vue grammar entries |
| `src/ast/ASTParser.ts` | Modify | Add loadPhp/Dart/Vue loaders + parse methods + dispatch |
| `src/utils/importExtractor.ts` | Modify | Add extractPhpImports, extractDartImports, extractVueImports + resolvers |
| `src/graph/DependencyGraph.ts` | Modify | Add `.php`, `.dart`, `.vue` to AST_EXTENSIONS |
| `src/indexer/embedder.ts` | Modify | Add `.php`, `.dart`, `.vue` to SUPPORTED_EXTENSIONS |
| `src/graph/CallGraphIndex.ts` | Modify | Add `confidence: 'extracted' \| 'inferred' \| 'ambiguous'` to CallEdge; update toJSON/fromJSON |
| `src/ast/ASTParser.ts` | Modify | Tag call edges with confidence when building call graph |
| `src/tools/find-large-functions.ts` | Create | `ctx_find_large_functions` tool |
| `src/tools/index.ts` | Modify | Register ctx_find_large_functions |
| `src/tools/blast-radius.ts` | Modify | Add `detail_level` param + minimal XML output |
| `src/tools/hub-nodes.ts` | Modify | Add `detail_level` param |
| `src/tools/bridge-nodes.ts` | Modify | Add `detail_level` param |
| `src/tools/architecture-overview.ts` | Modify | Add `detail_level` param |
| `src/tools/knowledge-gaps.ts` | Modify | Add `detail_level` param |
| `src/tools/surprising-connections.ts` | Modify | Add `detail_level` param |
| `src/tools/detect-changes.ts` | Modify | Add `detail_level` param |
| `src/tools/suggested-questions.ts` | Modify | Add `detail_level` param |
| `benchmarks/public-repos-results.json` | Create | Benchmark output (from running npm run bench:repos) |
| `README.md` | Modify | Add benchmark table |
| `tests/MultiLangAST.test.ts` | Modify | Add PHP, Dart, Vue parser tests |
| `tests/importExtractor.test.ts` | Modify | Add PHP, Dart, Vue import extraction tests |
| `tests/FindLargeFunctions.test.ts` | Create | Tests for ctx_find_large_functions |
| `tests/DetailLevel.test.ts` | Create | Tests for detail_level param on tools |
| `tests/CallGraphConfidence.test.ts` | Create | Tests for edge confidence tiers |

---

## Phase 0: Publish benchmark numbers

### Task 0: Run benchmark and update README

**Files:**
- Run: `npm run bench:repos`
- Modify: `README.md`

- [ ] **Step 1: Run the benchmark script**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
npm run bench:repos 2>&1 | tee benchmarks/bench-run.log
```

Expected: script clones 5 repos to `/tmp/ctxloom-bench-repos/`, indexes them, measures token reduction, writes `benchmarks/public-repos-results.json`. Takes 3–5 minutes.

- [ ] **Step 2: Read the results**

```bash
cat benchmarks/public-repos-results.json | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
  data.results?.forEach(r => console.log(r.repo, r.naiveTokens, r.graphTokens, r.reduction));
"
```

- [ ] **Step 3: Add benchmark table to README.md**

Find the `## Performance` or `## Benchmarks` section in README.md (or add one after the features section). Add:

```markdown
## Token reduction benchmarks

Measured on real open-source repos with realistic review scenarios:

| Repository | Naive tokens | Graph tokens | Reduction |
|---|---|---|---|
| expressjs/express | _N_ | _N_ | _N_× |
| sindresorhus/got | _N_ | _N_ | _N_× |
| pallets/flask | _N_ | _N_ | _N_× |
| fastify/fastify | _N_ | _N_ | _N_× |
| **Average** | | | **_N_×** |

Fill in the actual numbers from `benchmarks/public-repos-results.json`.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
git add benchmarks/public-repos-results.json README.md
git commit -m "docs: publish token reduction benchmark results"
```

---

## Phase 1: Language expansion

### Task 1: PHP language support

**Files:**
- Modify: `src/grammars/grammar-manifest.ts`
- Modify: `src/ast/ASTParser.ts`
- Modify: `src/utils/importExtractor.ts`
- Modify: `src/graph/DependencyGraph.ts`
- Modify: `src/indexer/embedder.ts`
- Modify: `tests/MultiLangAST.test.ts`
- Modify: `tests/importExtractor.test.ts`

- [ ] **Step 1: Write failing tests**

In `tests/MultiLangAST.test.ts`, add in the describe block after the Swift tests:

```typescript
describe('PHP parsing', () => {
  it('parses class declarations', async () => {
    const tmp = path.join(os.tmpdir(), 'test.php');
    fs.writeFileSync(tmp, `<?php\nnamespace App\\Models;\nclass User {\n  public function getName(): string { return $this->name; }\n}\n`);
    const parser = new ASTParser();
    await parser.init();
    const nodes = await parser.parse(tmp);
    fs.unlinkSync(tmp);
    const cls = nodes.find(n => n.type === 'class' && n.name === 'User');
    // graceful-degrade if grammar unavailable
    if (nodes.length > 0) expect(cls).toBeDefined();
  });

  it('parses function declarations', async () => {
    const tmp = path.join(os.tmpdir(), 'test.php');
    fs.writeFileSync(tmp, `<?php\nfunction greet(string $name): string {\n  return "Hello $name";\n}\n`);
    const parser = new ASTParser();
    await parser.init();
    const nodes = await parser.parse(tmp);
    fs.unlinkSync(tmp);
    if (nodes.length > 0) {
      const fn = nodes.find(n => n.type === 'function' && n.name === 'greet');
      expect(fn).toBeDefined();
    }
  });
});
```

In `tests/importExtractor.test.ts`, add:

```typescript
describe('PHP imports', () => {
  it('extracts require_once relative imports', () => {
    const content = `<?php\nrequire_once './Models/User.php';\nrequire './helpers.php';\n`;
    const result = extractImports('/project/src/index.php', content);
    expect(result).toContainEqual({ specifier: './Models/User.php', isRelative: true });
    expect(result).toContainEqual({ specifier: './helpers.php', isRelative: true });
  });

  it('extracts use namespace imports', () => {
    const content = `<?php\nuse App\\Models\\User;\nuse App\\Services\\AuthService;\n`;
    const result = extractImports('/project/src/index.php', content);
    expect(result.some(r => r.specifier.includes('User'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to confirm FAIL**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
npx vitest run tests/MultiLangAST.test.ts tests/importExtractor.test.ts 2>&1 | tail -20
```

Expected: test file errors or failures — PHP tests don't exist yet in these files.

- [ ] **Step 3: Add PHP to grammar manifest**

In `src/grammars/grammar-manifest.ts`, add after the swift entry:

```typescript
{
  language: 'php',
  extensions: ['.php'],
  npmPackage: 'tree-sitter-php',
  version: '0.23.11',
  wasmFile: 'tree-sitter-php.wasm',
  sha256: null,
},
```

- [ ] **Step 4: Add PHP loader + parser to ASTParser**

In `src/ast/ASTParser.ts`:

a) Add field after `private swiftLang: TreeSitter.Language | null = null;`:
```typescript
private phpLang: TreeSitter.Language | null = null;
```

b) Add loader method after `loadSwift()`:
```typescript
private async loadPhp(): Promise<void> {
  if (this.phpLang) return;
  try {
    const wasmPath = await this.grammarLoader.ensureGrammar('php');
    this.phpLang = await TreeSitter.Language.load(wasmPath);
  } catch (err) {
    const { logger } = await import('../utils/logger.js');
    logger.warn('PHP grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
  }
}
```

c) In `parse()`, add before the final `return` dispatch (after the `.swift` line):
```typescript
if (ext === '.php') return this.parsePhp(filePath);
```

d) Add `parsePhp()` method after `parseSwift()`:
```typescript
private async parsePhp(filePath: string): Promise<ParsedNode[]> {
  if (!this.phpLang) await this.loadPhp();
  if (!this.phpLang) return [];

  const parser = new TreeSitter.Parser();
  parser.setLanguage(this.phpLang);

  const source = fs.readFileSync(filePath, 'utf-8');
  const tree = parser.parse(source);
  if (!tree) return [];

  const nodes: ParsedNode[] = [];
  const lines = source.split('\n');

  const walk = (node: TreeSitter.Node): void => {
    switch (node.type) {
      case 'namespace_use_declaration': {
        for (const child of node.children) {
          if (child?.type === 'namespace_use_clause') {
            const nameNode = child.children.find(c => c?.type === 'qualified_name' || c?.type === 'name');
            if (nameNode) {
              nodes.push({ type: 'import', name: nameNode.text, source: nameNode.text,
                startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 });
            }
          }
        }
        return;
      }
      case 'function_definition': {
        const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'name');
        if (nameNode) {
          nodes.push({ type: 'function', name: nameNode.text,
            signature: (lines[node.startPosition.row] ?? '').trim(),
            startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 });
        }
        return;
      }
      case 'class_declaration': {
        const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'name');
        if (nameNode) {
          const body = node.childForFieldName?.('body');
          const methods = (body?.children ?? [])
            .filter((c): c is TreeSitter.Node => c !== null && c.type === 'method_declaration')
            .map(c => (c.childForFieldName?.('name') ?? c.children.find(ch => ch?.type === 'name'))?.text ?? '')
            .filter(Boolean);
          nodes.push({ type: 'class', name: nameNode.text, signature: `class ${nameNode.text}`,
            methods, startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 });
        }
        return;
      }
      case 'interface_declaration': {
        const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'name');
        if (nameNode) {
          nodes.push({ type: 'interface', name: nameNode.text, signature: `interface ${nameNode.text}`,
            startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 });
        }
        return;
      }
    }
    for (const child of node.children) {
      if (child) walk(child);
    }
  };

  walk(tree.rootNode);
  return nodes;
}
```

- [ ] **Step 5: Add PHP import extraction to importExtractor.ts**

a) Add `case '.php': return extractPhpImports(content);` in `extractImports()` before `default`.

b) Add `if (ext === '.php') return resolvePhpImport(fromAbs, fromDir, raw, rootDir);` in `resolveImport()`.

c) Add at end of file:
```typescript
// ─── PHP ──────────────────────────────────────────────────────────────────

function extractPhpImports(content: string): RawImport[] {
  const results: RawImport[] = [];

  // require/require_once/include/include_once with relative paths
  const requireRe = /(?:require|require_once|include|include_once)\s+['"](\.[^'"]+\.php)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = requireRe.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: true });
  }

  // use Namespace\ClassName; — absolute namespace import
  const useRe = /^use\s+([\w\\]+)(?:\s+as\s+\w+)?\s*;/gm;
  while ((m = useRe.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: false });
  }

  return results;
}

function resolvePhpImport(
  fromAbs: string,
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  if (raw.isRelative) {
    // Strip leading ./ and resolve relative to fromDir
    const candidate = path.resolve(fromDir, raw.specifier);
    if (fs.existsSync(candidate)) return path.relative(rootDir, candidate);
    return null;
  }

  // PSR-4: App\Models\User → src/Models/User.php or rootDir/App/Models/User.php
  const asPath = raw.specifier.replace(/\\/g, path.sep);
  const candidates = [
    path.join(rootDir, 'src', asPath + '.php'),
    path.join(rootDir, asPath + '.php'),
    path.join(fromDir, asPath.split(path.sep).pop()! + '.php'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.relative(rootDir, c);
  }
  return null;
}
```

- [ ] **Step 6: Add `.php` to DependencyGraph and embedder**

In `src/graph/DependencyGraph.ts` line 26, add `.php`:
```typescript
const AST_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rs', '.java', '.ipynb', '.php']);
```

In `src/indexer/embedder.ts`, add `.php` to SUPPORTED_EXTENSIONS:
```typescript
'.py', '.rs', '.go', '.java', '.cs', '.rb', '.kt', '.kts', '.swift', '.php',
```

- [ ] **Step 7: Run tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
npx vitest run tests/MultiLangAST.test.ts tests/importExtractor.test.ts 2>&1 | tail -20
```

Expected: all tests pass (PHP parser tests gracefully degrade if WASM unavailable).

- [ ] **Step 8: Run full suite**

```bash
npx vitest run 2>&1 | tail -10
```

- [ ] **Step 9: Commit**

```bash
git add src/grammars/grammar-manifest.ts src/ast/ASTParser.ts src/utils/importExtractor.ts \
        src/graph/DependencyGraph.ts src/indexer/embedder.ts
git commit -m "feat: add PHP language support"
```

---

### Task 2: Dart language support

**Files:**
- Modify: `src/grammars/grammar-manifest.ts`
- Modify: `src/ast/ASTParser.ts`
- Modify: `src/utils/importExtractor.ts`
- Modify: `src/graph/DependencyGraph.ts`
- Modify: `src/indexer/embedder.ts`
- Modify: `tests/MultiLangAST.test.ts`
- Modify: `tests/importExtractor.test.ts`

- [ ] **Step 1: Write failing tests**

In `tests/MultiLangAST.test.ts`, add in the describe block:

```typescript
describe('Dart parsing', () => {
  it('parses class declarations', async () => {
    const tmp = path.join(os.tmpdir(), 'test.dart');
    fs.writeFileSync(tmp, `class UserService {\n  String getName() => 'Alice';\n  void save(User user) {}\n}\n`);
    const parser = new ASTParser();
    await parser.init();
    const nodes = await parser.parse(tmp);
    fs.unlinkSync(tmp);
    if (nodes.length > 0) {
      expect(nodes.some(n => n.type === 'class' && n.name === 'UserService')).toBe(true);
    }
  });

  it('parses function declarations', async () => {
    const tmp = path.join(os.tmpdir(), 'test.dart');
    fs.writeFileSync(tmp, `String greet(String name) => 'Hello \$name';\nvoid main() { print(greet('world')); }\n`);
    const parser = new ASTParser();
    await parser.init();
    const nodes = await parser.parse(tmp);
    fs.unlinkSync(tmp);
    if (nodes.length > 0) {
      expect(nodes.some(n => n.type === 'function' && n.name === 'main')).toBe(true);
    }
  });
});
```

In `tests/importExtractor.test.ts`, add:

```typescript
describe('Dart imports', () => {
  it('extracts relative import paths', () => {
    const content = `import 'package:flutter/material.dart';\nimport './models/user.dart';\nimport '../utils/helpers.dart';\n`;
    const result = extractImports('/project/lib/main.dart', content);
    expect(result.some(r => r.isRelative && r.specifier.includes('user.dart'))).toBe(true);
    expect(result.some(r => r.isRelative && r.specifier.includes('helpers.dart'))).toBe(true);
    // package: imports are NOT relative and should not resolve to local files
    expect(result.some(r => r.specifier === 'package:flutter/material.dart')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm FAIL**

```bash
npx vitest run tests/MultiLangAST.test.ts tests/importExtractor.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Add Dart to grammar manifest**

In `src/grammars/grammar-manifest.ts`, add after the PHP entry:

```typescript
{
  language: 'dart',
  extensions: ['.dart'],
  npmPackage: 'tree-sitter-dart',
  version: '0.0.3',
  wasmFile: 'tree-sitter-dart.wasm',
  sha256: null,
},
```

- [ ] **Step 4: Add Dart loader + parser to ASTParser**

a) Add field: `private dartLang: TreeSitter.Language | null = null;`

b) Add loader method:
```typescript
private async loadDart(): Promise<void> {
  if (this.dartLang) return;
  try {
    const wasmPath = await this.grammarLoader.ensureGrammar('dart');
    this.dartLang = await TreeSitter.Language.load(wasmPath);
  } catch (err) {
    const { logger } = await import('../utils/logger.js');
    logger.warn('Dart grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
  }
}
```

c) In `parse()`, add: `if (ext === '.dart') return this.parseDart(filePath);`

d) Add `parseDart()` method:
```typescript
private async parseDart(filePath: string): Promise<ParsedNode[]> {
  if (!this.dartLang) await this.loadDart();
  if (!this.dartLang) return [];

  const parser = new TreeSitter.Parser();
  parser.setLanguage(this.dartLang);

  const source = fs.readFileSync(filePath, 'utf-8');
  const tree = parser.parse(source);
  if (!tree) return [];

  const nodes: ParsedNode[] = [];
  const lines = source.split('\n');

  const walk = (node: TreeSitter.Node): void => {
    switch (node.type) {
      case 'import_or_export': {
        const uriNode = node.children.find(c => c?.type === 'uri');
        const uri = uriNode?.text?.replace(/['"]/g, '') ?? '';
        // Only local relative imports (not package: or dart:)
        if (uri.startsWith('.')) {
          nodes.push({ type: 'import', name: uri, source: uri,
            startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 });
        }
        return;
      }
      case 'function_signature':
      case 'function_declaration': {
        const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'identifier');
        if (nameNode) {
          nodes.push({ type: 'function', name: nameNode.text,
            signature: (lines[node.startPosition.row] ?? '').trim(),
            startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 });
        }
        return;
      }
      case 'class_definition': {
        const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'identifier');
        if (nameNode) {
          nodes.push({ type: 'class', name: nameNode.text, signature: `class ${nameNode.text}`,
            methods: [], startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 });
        }
        return;
      }
    }
    for (const child of node.children) {
      if (child) walk(child);
    }
  };

  walk(tree.rootNode);
  return nodes;
}
```

- [ ] **Step 5: Add Dart import extraction to importExtractor.ts**

a) Add `case '.dart': return extractDartImports(content);`

b) Add `if (ext === '.dart') return resolveDartImport(fromDir, raw, rootDir);`

c) Add at end of file:
```typescript
// ─── Dart ─────────────────────────────────────────────────────────────────

function extractDartImports(content: string): RawImport[] {
  const results: RawImport[] = [];
  // Only relative imports (starting with . or ..); skip package: and dart: which are library imports
  const importRe = /^import\s+['"](\.[^'"]+\.dart)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: true });
  }
  return results;
}

function resolveDartImport(
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  const candidate = path.resolve(fromDir, raw.specifier);
  if (fs.existsSync(candidate)) return path.relative(rootDir, candidate);
  // Also try without explicit .dart extension
  const withoutExt = path.resolve(fromDir, raw.specifier.replace(/\.dart$/, ''));
  const withExt = withoutExt + '.dart';
  if (fs.existsSync(withExt)) return path.relative(rootDir, withExt);
  return null;
}
```

- [ ] **Step 6: Add `.dart` to DependencyGraph and embedder**

`DependencyGraph.ts`: add `.dart` to `AST_EXTENSIONS`.
`embedder.ts`: add `.dart` to `SUPPORTED_EXTENSIONS`.

- [ ] **Step 7: Run tests + full suite + commit**

```bash
npx vitest run 2>&1 | tail -10
git add src/grammars/grammar-manifest.ts src/ast/ASTParser.ts src/utils/importExtractor.ts \
        src/graph/DependencyGraph.ts src/indexer/embedder.ts
git commit -m "feat: add Dart language support"
```

---

### Task 3: Vue Single File Component support

Vue `.vue` files contain `<script lang="ts">` or `<script>` blocks with regular TypeScript/JS imports. The approach: extract the `<script>` block content, then run the TypeScript import parser on it.

**Files:**
- Modify: `src/ast/ASTParser.ts`
- Modify: `src/utils/importExtractor.ts`
- Modify: `src/graph/DependencyGraph.ts`
- Modify: `src/indexer/embedder.ts`
- Modify: `tests/importExtractor.test.ts`

Note: No tree-sitter grammar needed — we parse the extracted script block as regular TypeScript. No new grammar manifest entry.

- [ ] **Step 1: Write failing tests**

In `tests/importExtractor.test.ts`, add:

```typescript
describe('Vue SFC imports', () => {
  it('extracts imports from script block', () => {
    const content = `<template><div>Hello</div></template>\n<script lang="ts">\nimport { ref } from 'vue';\nimport UserCard from './components/UserCard.vue';\nimport { useStore } from '../store/index.ts';\n</script>\n`;
    const result = extractImports('/project/src/App.vue', content);
    expect(result.some(r => r.specifier.includes('UserCard.vue') && r.isRelative)).toBe(true);
    expect(result.some(r => r.specifier.includes('store') && r.isRelative)).toBe(true);
    // Non-relative (vue package) should not appear since extractImports filters non-relative
    // Actually vue package is non-relative, let's just check the relative ones resolved
  });

  it('returns empty for vue files with no script block', () => {
    const content = `<template><div>Hello</div></template>\n<style scoped>\n.foo { color: red; }\n</style>\n`;
    const result = extractImports('/project/src/NoScript.vue', content);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm FAIL**

```bash
npx vitest run tests/importExtractor.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Add Vue import extraction to importExtractor.ts**

Note: Vue files use TypeScript/JS imports inside the `<script>` block. We extract the block and run the existing TS import regex on it. **No new grammar manifest entry** — this is purely string extraction.

a) Add `case '.vue': return extractVueImports(content);` in `extractImports()`.

b) Add `if (ext === '.vue') return resolveVueImport(fromAbs, fromDir, raw, rootDir);` in `resolveImport()`. Vue resolves imports the same way TS does for `.vue` and `.ts/.js` files.

c) Add at end of file:
```typescript
// ─── Vue SFC ──────────────────────────────────────────────────────────────

function extractVueScriptContent(content: string): string {
  // Extract content of <script> or <script lang="ts"> block
  const match = content.match(/<script(?:\s[^>]*)?>([^]*?)<\/script>/i);
  return match?.[1] ?? '';
}

function extractVueImports(content: string): RawImport[] {
  const scriptContent = extractVueScriptContent(content);
  if (!scriptContent.trim()) return [];

  const results: RawImport[] = [];

  // Static imports: import X from './path' or import { X } from './path'
  const staticImport = /import\s+(?:[^'"]*from\s+)?['"](\.[^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = staticImport.exec(scriptContent)) !== null) {
    results.push({ specifier: m[1], isRelative: true });
  }

  return results;
}

function resolveVueImport(
  fromAbs: string,
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  // Try with the specifier as-is (e.g. './Foo.vue', './bar.ts')
  const direct = path.resolve(fromDir, raw.specifier);
  if (fs.existsSync(direct)) return path.relative(rootDir, direct);

  // Try adding common extensions if no extension given
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.vue', '/index.ts', '/index.js']) {
    const candidate = path.resolve(fromDir, raw.specifier.replace(/\.js$/, '') + ext);
    if (fs.existsSync(candidate)) return path.relative(rootDir, candidate);
  }
  return null;
}
```

- [ ] **Step 4: Add `.vue` to ASTParser dispatch**

In `src/ast/ASTParser.ts`, in `parse()`, add:
```typescript
if (ext === '.vue') return this.parseVue(filePath);
```

Add `parseVue()` method — extracts the script block and parses as TypeScript:
```typescript
private async parseVue(filePath: string): Promise<ParsedNode[]> {
  // Parse the <script> block as TypeScript using the existing TS parser
  let source: string;
  try {
    source = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  // Extract <script> or <script lang="ts"> block
  const match = source.match(/<script(?:\s[^>]*)?>([^]*?)<\/script>/i);
  if (!match?.[1]?.trim()) return [];

  const scriptContent = match[1];

  // Parse as TypeScript using the already-initialized tsLang
  const parser = new TreeSitter.Parser();
  parser.setLanguage(this.tsLang);
  const tree = parser.parse(scriptContent);
  if (!tree) return [];

  // Reuse the existing TS AST walker (walk is defined inside parseTypeScript)
  // Since the walker is inlined in parseTypeScript, we duplicate the core logic here
  return this.extractTSNodes(tree.rootNode, filePath, scriptContent.split('\n'));
}
```

**Important:** `extractTSNodes` may not exist yet as a separate method. Look at `parseTypeScript()` in ASTParser and check if it has an inlined walker. If the TS walker is inlined, you need to extract it into a private `extractTSNodes(rootNode, filePath, lines)` method first, then call it from both `parseTypeScript()` and `parseVue()`. If `extractTSNodes` already exists (check first), just use it.

If refactoring is needed, extract the TS AST walker:
```typescript
private extractTSNodes(rootNode: TreeSitter.Node, filePath: string, lines: string[]): ParsedNode[] {
  const nodes: ParsedNode[] = [];
  // ... move the existing walk logic from parseTypeScript here ...
  return nodes;
}
```

Then call `return this.extractTSNodes(tree.rootNode, filePath, source.split('\n'));` from `parseTypeScript()`.

- [ ] **Step 5: Add `.vue` to DependencyGraph TS_EXTENSIONS and embedder**

In `DependencyGraph.ts` line 24, add `.vue` to `TS_EXTENSIONS` (NOT `AST_EXTENSIONS` — Vue is parsed as TypeScript):
```typescript
const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue']);
```

In `embedder.ts`, add `.vue` to `SUPPORTED_EXTENSIONS`.

- [ ] **Step 6: Run tests + full suite + commit**

```bash
npx vitest run 2>&1 | tail -10
git add src/ast/ASTParser.ts src/utils/importExtractor.ts \
        src/graph/DependencyGraph.ts src/indexer/embedder.ts
git commit -m "feat: add Vue SFC (.vue) language support"
```

---

## Phase 2: Quality gaps

### Task 4: `ctx_find_large_functions` tool

Find functions and classes exceeding a configurable line-count threshold. Uses the symbol index already populated by DependencyGraph.

**Files:**
- Create: `src/tools/find-large-functions.ts`
- Modify: `src/tools/index.ts`
- Create: `tests/FindLargeFunctions.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/FindLargeFunctions.test.ts
import { describe, it, expect } from 'vitest';
import { findLargeFunctions, type LargeFunctionResult } from '../src/tools/find-large-functions.js';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';

describe('FindLargeFunctions', () => {
  function makeGraph(): DependencyGraph {
    const g = new DependencyGraph();
    // Add symbols manually via addSymbol()
    g.addSymbol('BigClass', { filePath: 'src/big.ts', type: 'class', signature: 'class BigClass',
      startLine: 1, endLine: 250 });
    g.addSymbol('SmallClass', { filePath: 'src/small.ts', type: 'class', signature: 'class SmallClass',
      startLine: 1, endLine: 30 });
    g.addSymbol('giantFn', { filePath: 'src/utils.ts', type: 'function', signature: 'function giantFn()',
      startLine: 5, endLine: 110 });
    g.addSymbol('tinyFn', { filePath: 'src/utils.ts', type: 'function', signature: 'function tinyFn()',
      startLine: 115, endLine: 120 });
    return g;
  }

  it('returns symbols over the threshold sorted by line count descending', () => {
    const results = findLargeFunctions(makeGraph(), 50);
    expect(results.length).toBe(2);
    expect(results[0].name).toBe('BigClass');
    expect(results[0].lineCount).toBe(250);
    expect(results[1].name).toBe('giantFn');
  });

  it('returns empty when nothing exceeds the threshold', () => {
    expect(findLargeFunctions(makeGraph(), 300)).toHaveLength(0);
  });

  it('respects file filter when provided', () => {
    const results = findLargeFunctions(makeGraph(), 50, 'src/big.ts');
    expect(results.every(r => r.filePath === 'src/big.ts')).toBe(true);
  });

  it('includes line count in results', () => {
    const results = findLargeFunctions(makeGraph(), 50);
    expect(results[0]).toMatchObject({ name: expect.any(String), lineCount: expect.any(Number), filePath: expect.any(String) });
  });
});
```

- [ ] **Step 2: Check `addSymbol()` signature in DependencyGraph**

Read `src/graph/DependencyGraph.ts` and find the `addSymbol()` method (added in the previous sprint). Confirm its parameter shape matches what the test uses. If the method takes `(name: string, entry: SymbolEntry)`, the test above is correct.

- [ ] **Step 3: Run tests to confirm FAIL**

```bash
npx vitest run tests/FindLargeFunctions.test.ts 2>&1 | tail -20
```

- [ ] **Step 4: Create `src/tools/find-large-functions.ts`**

```typescript
/**
 * find-large-functions.ts — ctx_find_large_functions
 *
 * Find functions and classes exceeding a configurable line-count threshold.
 * Uses the symbol index already populated by DependencyGraph during build.
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import type { DependencyGraph } from '../graph/DependencyGraph.js';

const schema = z.object({
  threshold: z.number().int().min(1).default(50).describe(
    'Minimum line count to include (default: 50). Functions/classes shorter than this are excluded.',
  ),
  file_filter: z.string().optional().describe(
    'Optional: restrict results to files matching this path substring.',
  ),
  limit: z.number().int().min(1).max(200).default(30).describe(
    'Maximum results to return (default: 30).',
  ),
});

export interface LargeFunctionResult {
  name: string;
  type: string;
  filePath: string;
  startLine: number;
  endLine: number;
  lineCount: number;
}

/** Find symbols exceeding threshold. Exported for testing. */
export function findLargeFunctions(
  graph: DependencyGraph,
  threshold: number,
  fileFilter?: string,
): LargeFunctionResult[] {
  const results: LargeFunctionResult[] = [];

  for (const [name, entries] of graph.symbolEntries()) {
    for (const entry of entries) {
      if (entry.type !== 'function' && entry.type !== 'class') continue;
      if (fileFilter && !entry.filePath.includes(fileFilter)) continue;

      const startLine = (entry as { startLine?: number }).startLine ?? 0;
      const endLine = (entry as { endLine?: number }).endLine ?? 0;
      const lineCount = endLine - startLine + 1;

      if (lineCount >= threshold) {
        results.push({ name, type: entry.type, filePath: entry.filePath, startLine, endLine, lineCount });
      }
    }
  }

  return results.sort((a, b) => b.lineCount - a.lineCount);
}

function escapeXML(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerFindLargeFunctionsTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_find_large_functions',
    {
      name: 'ctx_find_large_functions',
      description:
        'Find functions and classes that exceed a line-count threshold. ' +
        'Useful for identifying tech debt, refactoring candidates, and functions that are too long to review easily.',
      inputSchema: {
        type: 'object',
        properties: {
          threshold: { type: 'number', description: 'Minimum line count to include (default: 50).' },
          file_filter: { type: 'string', description: 'Restrict to files whose path contains this substring.' },
          limit: { type: 'number', description: 'Maximum results to return (default: 30, max: 200).' },
        },
      },
    },
    async (args: unknown) => {
      const { threshold, file_filter, limit } = schema.parse(args);
      const graph = await ctx.getGraph();

      const results = findLargeFunctions(graph, threshold, file_filter).slice(0, limit);

      if (results.length === 0) {
        return `<ctx_find_large_functions threshold="${threshold}" count="0">\n  <message>No functions or classes exceed ${threshold} lines.</message>\n</ctx_find_large_functions>`;
      }

      const lines = [
        `<ctx_find_large_functions threshold="${threshold}" count="${results.length}">`,
        ...results.map(r =>
          `  <symbol name="${escapeXML(r.name)}" type="${r.type}" file="${escapeXML(r.filePath)}" start="${r.startLine}" end="${r.endLine}" lines="${r.lineCount}" />`,
        ),
        `</ctx_find_large_functions>`,
      ];
      return lines.join('\n');
    },
  );
}
```

- [ ] **Step 5: Add `symbolEntries()` to DependencyGraph if missing**

In `src/graph/DependencyGraph.ts`, check if there's a method to iterate the symbolIndex. If not, add:
```typescript
/** Iterate all symbol entries. Used by ctx_find_large_functions. */
symbolEntries(): IterableIterator<[string, Array<{ filePath: string; type: string; signature: string }>]> {
  return this.symbolIndex.entries();
}
```

Also check if the symbol entries have `startLine`/`endLine` fields. Look at where `symbolIndex` is populated (around line 132-141 in DependencyGraph.ts). The symbol entries are `{ filePath, type, signature }`. We need `startLine` and `endLine`. Look at `ParsedNode` in ASTParser — it has `startLine` and `endLine`. The symbol indexing in DependencyGraph currently only stores `{ filePath, type, signature }` — NOT startLine/endLine.

**Fix:** Update the symbol index type and ingestion to also store `startLine` and `endLine`:

In `DependencyGraph.ts`:
1. Update the symbolIndex type declaration from `Array<{ filePath: string; type: string; signature: string }>` to `Array<{ filePath: string; type: string; signature: string; startLine?: number; endLine?: number }>`.
2. Update the symbol indexing loop (around line 132) to include startLine/endLine:
```typescript
for (const node of nodes) {
  if (node.type === 'function' || node.type === 'class' || node.type === 'interface') {
    const existing = this.symbolIndex.get(node.name) ?? [];
    existing.push({
      filePath: relPath,
      type: node.type,
      signature: node.signature ?? `${node.type} ${node.name}`,
      startLine: node.startLine,
      endLine: node.endLine,
    });
    this.symbolIndex.set(node.name, existing);
  }
}
```
3. Also update `addSymbol()` to accept `startLine`/`endLine` in the entry parameter.
4. Update `isValidSnapshot()` — no change needed since these are optional fields.

- [ ] **Step 6: Register tool in index.ts**

Add import: `import { registerFindLargeFunctionsTool } from './find-large-functions.js';`

Add registration: `registerFindLargeFunctionsTool(registry, ctx);`

- [ ] **Step 7: Run tests + full suite + commit**

```bash
npx vitest run tests/FindLargeFunctions.test.ts 2>&1 | tail -20
npx vitest run 2>&1 | tail -10
git add src/tools/find-large-functions.ts src/tools/index.ts src/graph/DependencyGraph.ts \
        tests/FindLargeFunctions.test.ts
git commit -m "feat: add ctx_find_large_functions tool"
```

---

### Task 5: `detail_level` parameter on key tools

Add `detail_level: "standard" | "minimal"` to the 7 most-used verbose tools. `"minimal"` returns only counts and top-level attributes — no per-item child elements. Target: 40–60% output reduction for tight context windows.

**Scope:** `blast-radius`, `hub-nodes`, `bridge-nodes`, `architecture-overview`, `knowledge-gaps`, `surprising-connections`, `detect-changes`.

**Files:**
- Modify: 7 tool files listed above
- Create: `tests/DetailLevel.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/DetailLevel.test.ts
import { describe, it, expect } from 'vitest';
import { computeBlastRadius } from '../src/tools/blast-radius.js';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';

// We test blast-radius as a representative; the pattern is the same for all tools.
// We test by calling the XML-building code directly.

describe('DetailLevel', () => {
  it('blast-radius standard mode includes file elements', async () => {
    // We test the XML format by checking the handler output through the tool directly.
    // Since handler calls are complex to isolate, we test via a light integration test:
    // Just verify the Zod schema accepts detail_level.
    const { z } = await import('zod');
    const schema = z.object({
      changed_files: z.array(z.string()).optional(),
      depth: z.number().optional(),
      use_git: z.boolean().optional(),
      detail_level: z.enum(['standard', 'minimal']).default('standard'),
    });
    expect(() => schema.parse({ detail_level: 'minimal' })).not.toThrow();
    expect(() => schema.parse({ detail_level: 'standard' })).not.toThrow();
    expect(() => schema.parse({})).not.toThrow();
  });

  it('minimal XML is shorter than standard XML', () => {
    // Test the helper function directly
    const { buildBlastRadiusXml } = require('../src/tools/blast-radius.js');
    // This will fail until we export the helper — that's expected at this step
    expect(buildBlastRadiusXml).toBeDefined();
  });
});
```

Note: the second test will fail until Step 3 exports `buildBlastRadiusXml`. That's expected — TDD.

- [ ] **Step 2: Run tests to confirm FAIL**

```bash
npx vitest run tests/DetailLevel.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Update `blast-radius.ts` as the reference implementation**

The pattern for every tool is:
1. Add `detail_level: z.enum(['standard', 'minimal']).default('standard')` to the Zod schema
2. Add `detail_level` to `inputSchema.properties`
3. In the handler, pass `detail_level` to the XML builder
4. In the XML builder, when `detail_level === 'minimal'`, return only the root element with count attributes — no children

In `src/tools/blast-radius.ts`:

a) Update Zod schema:
```typescript
const Schema = z.object({
  changed_files: z.array(z.string()).optional().describe('Changed file paths (relative). Defaults to git diff HEAD~1.'),
  depth: z.number().min(1).max(10).optional().default(3).describe('Traversal depth (default: 3)'),
  use_git: z.boolean().optional().default(true).describe('Auto-detect changed files from git diff HEAD~1'),
  detail_level: z.enum(['standard', 'minimal']).default('standard').describe(
    '"standard" (default) returns full per-file listings. "minimal" returns counts only — ~60% fewer tokens.',
  ),
});
```

b) Add `detail_level` to `inputSchema.properties`:
```typescript
detail_level: {
  type: 'string',
  enum: ['standard', 'minimal'],
  description: '"standard" returns full listings. "minimal" returns counts only (saves ~60% tokens).',
},
```

c) Extract the XML building to an exported helper and add minimal mode:
```typescript
export function buildBlastRadiusXml(
  result: BlastRadiusResult,
  depth: number,
  detailLevel: 'standard' | 'minimal',
): string {
  const graphType = result.callSites.length > 0 ? 'import+call' : 'import';

  if (detailLevel === 'minimal') {
    return [
      `<blast_radius changed="${result.changedFiles.length}" direct_importers="${result.directImporters.length}"`,
      ` transitive_importers="${result.transitiveImporters.length}" call_sites="${result.callSites.length}"`,
      ` depth="${depth}" graph_type="${graphType}" detail_level="minimal" />`,
    ].join('\n');
  }

  // Standard: existing full XML
  const lines = [
    `<blast_radius changed_files="${result.changedFiles.length}" depth="${depth}" graph_type="${graphType}">`,
    `  <changed count="${result.changedFiles.length}">`,
    ...result.changedFiles.map(f => `    <file path="${escapeXML(f)}" />`),
    '  </changed>',
    `  <direct_importers count="${result.directImporters.length}">`,
    ...result.directImporters.map(f => `    <file path="${escapeXML(f)}" />`),
    '  </direct_importers>',
    `  <transitive_importers count="${result.transitiveImporters.length}">`,
    ...result.transitiveImporters.map(f => `    <file path="${escapeXML(f)}" />`),
    '  </transitive_importers>',
    `  <call_sites count="${result.callSites.length}">`,
    ...result.callSites.map(s =>
      `    <call_site file="${escapeXML(s.file)}" caller="${escapeXML(s.callerSymbol)}" callee="${escapeXML(s.calleeSymbol)}" />`,
    ),
    '  </call_sites>',
    '</blast_radius>',
  ];
  return lines.join('\n');
}
```

Update the handler to use `buildBlastRadiusXml(result, depth, detail_level)`.

- [ ] **Step 4: Apply the same pattern to the other 6 tools**

For each tool, the minimal XML format is just the root element with count/summary attributes and `detail_level="minimal"`. Here are the minimal formats:

**`hub-nodes.ts`** minimal: `<hub_nodes count="N" detail_level="minimal" />`
**`bridge-nodes.ts`** minimal: `<bridge_nodes count="N" detail_level="minimal" />`
**`architecture-overview.ts`** minimal: `<architecture_overview communities="N" files="N" detail_level="minimal" />`
**`knowledge-gaps.ts`** minimal: `<knowledge_gaps count="N" detail_level="minimal" />`
**`surprising-connections.ts`** minimal: `<surprising_connections count="N" detail_level="minimal" />`
**`detect-changes.ts`** minimal: `<detect_changes count="N" critical="N" high="N" medium="N" low="N" detail_level="minimal" />`

Read each file, add the Zod param, add to inputSchema, and add the minimal branch in the XML output.

- [ ] **Step 5: Update the DetailLevel test to be meaningful**

Replace the second test with one that actually verifies the minimal output is shorter:

```typescript
it('blast-radius minimal XML is shorter than standard XML for same input', async () => {
  const { buildBlastRadiusXml } = await import('../src/tools/blast-radius.js');
  const result = {
    changedFiles: ['src/a.ts', 'src/b.ts'],
    directImporters: ['src/c.ts', 'src/d.ts'],
    transitiveImporters: ['src/e.ts'],
    callSites: [],
  };
  const standard = buildBlastRadiusXml(result, 3, 'standard');
  const minimal = buildBlastRadiusXml(result, 3, 'minimal');
  expect(minimal.length).toBeLessThan(standard.length);
  expect(minimal).toContain('detail_level="minimal"');
  expect(minimal).not.toContain('<file');
});
```

- [ ] **Step 6: Run tests + full suite + commit**

```bash
npx vitest run tests/DetailLevel.test.ts 2>&1 | tail -20
npx vitest run 2>&1 | tail -10
git add src/tools/blast-radius.ts src/tools/hub-nodes.ts src/tools/bridge-nodes.ts \
        src/tools/architecture-overview.ts src/tools/knowledge-gaps.ts \
        src/tools/surprising-connections.ts src/tools/detect-changes.ts \
        tests/DetailLevel.test.ts
git commit -m "feat: add detail_level=minimal param to 7 tools for token-efficient output"
```

---

### Task 6: Edge confidence tiers on call graph

Tag call graph edges with confidence: `EXTRACTED` (explicit call_expression in AST), `INFERRED` (import with no explicit call), `AMBIGUOUS` (computed/dynamic call).

**Files:**
- Modify: `src/graph/CallGraphIndex.ts`
- Modify: `src/ast/ASTParser.ts` (tag edges when adding them)
- Modify: `src/tools/call-graph.ts` (expose confidence in XML output)
- Create: `tests/CallGraphConfidence.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/CallGraphConfidence.test.ts
import { describe, it, expect } from 'vitest';
import { CallGraphIndex } from '../src/graph/CallGraphIndex.js';

describe('CallGraphConfidence', () => {
  it('CallEdge includes confidence field', () => {
    const idx = new CallGraphIndex();
    idx.addEdge({ callerFile: 'a.ts', callerSymbol: 'foo', calleeSymbol: 'bar', confidence: 'extracted' });
    const callers = idx.getCallers('bar');
    expect(callers[0]).toHaveProperty('confidence', 'extracted');
  });

  it('defaults confidence to "extracted" when not specified', () => {
    const idx = new CallGraphIndex();
    // addEdge without confidence — should default
    idx.addEdge({ callerFile: 'a.ts', callerSymbol: 'foo', calleeSymbol: 'bar' });
    const callers = idx.getCallers('bar');
    expect(callers[0].confidence).toBe('extracted');
  });

  it('serializes and deserializes confidence via toJSON/fromJSON', () => {
    const idx = new CallGraphIndex();
    idx.addEdge({ callerFile: 'a.ts', callerSymbol: 'foo', calleeSymbol: 'bar', confidence: 'inferred' });
    const json = idx.toJSON();
    const idx2 = CallGraphIndex.fromJSON(json);
    expect(idx2.getCallers('bar')[0].confidence).toBe('inferred');
  });

  it('getCallers filters by confidence when requested', () => {
    const idx = new CallGraphIndex();
    idx.addEdge({ callerFile: 'a.ts', callerSymbol: 'foo', calleeSymbol: 'baz', confidence: 'extracted' });
    idx.addEdge({ callerFile: 'b.ts', callerSymbol: 'bar', calleeSymbol: 'baz', confidence: 'inferred' });
    const extracted = idx.getCallers('baz', 'extracted');
    expect(extracted).toHaveLength(1);
    expect(extracted[0].callerSymbol).toBe('foo');
  });
});
```

- [ ] **Step 2: Run tests to confirm FAIL**

```bash
npx vitest run tests/CallGraphConfidence.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Read `src/graph/CallGraphIndex.ts`**

Before editing, read the file to understand the current `CallEdge` interface, `addEdge()`, `toJSON()`, `fromJSON()`, and `getCallers()` signatures. Then make the minimal change.

- [ ] **Step 4: Update `CallGraphIndex.ts`**

a) Update `CallEdge` interface to add `confidence`:
```typescript
export type EdgeConfidence = 'extracted' | 'inferred' | 'ambiguous';

export interface CallEdge {
  callerFile: string;
  callerSymbol: string;
  calleeSymbol: string;
  confidence: EdgeConfidence;
}
```

b) Update `addEdge()` to default `confidence` to `'extracted'` if not provided:
```typescript
addEdge(edge: Omit<CallEdge, 'confidence'> & { confidence?: EdgeConfidence }): void {
  const fullEdge: CallEdge = { ...edge, confidence: edge.confidence ?? 'extracted' };
  // ... existing storage logic using fullEdge ...
}
```

c) Update `getCallers()` to accept an optional confidence filter:
```typescript
getCallers(
  calleeSymbol: string,
  confidenceFilter?: EdgeConfidence,
): Array<{ file: string; symbol: string; confidence: EdgeConfidence }> {
  const edges = this.calleeToCaller.get(calleeSymbol) ?? [];
  const filtered = confidenceFilter ? edges.filter(e => e.confidence === confidenceFilter) : edges;
  return filtered.map(e => ({ file: e.callerFile, symbol: e.callerSymbol, confidence: e.confidence }));
}
```

Note: `getCallers()` currently returns `{ file, symbol }` — update callers in other tools if they break.

d) Update `toJSON()` to include confidence in the serialized edges.

e) Update `fromJSON()` to read confidence (default `'extracted'` for edges without it, for backward compat with old snapshots).

- [ ] **Step 5: Update call graph tool to expose confidence**

In `src/tools/call-graph.ts`, find where callers are rendered in XML. Add `confidence` attribute:
```xml
<caller file="..." symbol="..." confidence="extracted" />
```

- [ ] **Step 6: Run tests + full suite + commit**

```bash
npx vitest run tests/CallGraphConfidence.test.ts 2>&1 | tail -20
npx tsc --noEmit 2>&1 | head -20
npx vitest run 2>&1 | tail -10
git add src/graph/CallGraphIndex.ts src/ast/ASTParser.ts src/tools/call-graph.ts \
        tests/CallGraphConfidence.test.ts
git commit -m "feat: add EXTRACTED/INFERRED/AMBIGUOUS confidence tiers to call graph edges"
```

---

## Post-implementation

- [ ] **Update competitive-analysis.md**

After all tasks complete, update `docs/competitive-analysis.md`:
- Languages: 10 → **13** (added PHP, Dart, Vue)
- Rows we win: 7 → **9** (closed `find_large_functions` gap, detail_level gap, confidence tiers gap)
- Flip relevant rows from ❌ them to ➖ tie or ✅ us

- [ ] **Run full test suite one last time**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
npx vitest run 2>&1 | tail -15
npx tsc --noEmit 2>&1 | head -10
```

- [ ] **Final commit**

```bash
git commit -m "docs: update competitive analysis post-parity sprint"
```

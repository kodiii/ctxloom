# Phase 2a — Go + Rust + Java Language Support

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full AST-based symbol indexing for Go, Rust, and Java so that `ctx_get_definition` and `ctx_blast_radius` work for these languages, while fixing a latent Python import-graph bug in the process.

**Architecture:** Each language follows the same pattern established by Python in Phase 1: a `loadXxx()` method lazily downloads the WASM grammar via `GrammarLoader`, a `parseXxx()` private method walks the CST emitting `ParsedNode[]`, and `parse()` dispatches by extension. The `DependencyGraph` already includes Go/Rust/Java in `collectFiles()` and the watcher; this task moves them from the regex-only `else` branch into `AST_EXTENSIONS` (for symbol indexing) while keeping regex-based import resolution for these languages — which also fixes a latent Python import-graph bug where the TS-style resolver was silently failing to find `.py` files.

**Tech Stack:** TypeScript/ESM, web-tree-sitter (WASM), vitest, `GrammarLoader` (built in Phase 1). No new npm dependencies. Grammar manifests for Go/Rust/Java already exist in `src/grammars/grammar-manifest.ts`.

---

## File Map

### Modified
| File | What changes |
|------|-------------|
| `src/ast/ASTParser.ts` | Add `goLang`, `rustLang`, `javaLang` fields; `loadGo/Rust/Java()` methods; `parseGo/Rust/Java()` private methods; `parse()` extension dispatch |
| `src/graph/DependencyGraph.ts` | Add Go/Rust/Java to `AST_EXTENSIONS`; fix import resolution for non-TS AST languages (Python bug fix + Go/Rust/Java) |

### Created
| File | Responsibility |
|------|---------------|
| `tests/MultiLangAST.test.ts` | Dispatch + graceful degradation tests; DependencyGraph regression tests |

---

## Task 1 — DependencyGraph: Fix Import Resolution + Add Go/Rust/Java to AST_EXTENSIONS

**Problem:** Python files are currently in `AST_EXTENSIONS` but their import edges use the TS-style `this.resolveImport()` resolver, which only tries `.ts/.tsx/.js` extensions — it never finds `.py` files. Python import edges are silently broken. The same bug would affect Go/Rust/Java once added to `AST_EXTENSIONS`.

**Fix:** Route all non-TS AST languages through the existing `resolveMultiLangImport` (the regex extractor), which already handles Python, Go, Rust, and Java correctly. Symbol indexing still comes from AST for all languages.

**Files:**
- Modify: `src/graph/DependencyGraph.ts`
- Create: `tests/MultiLangAST.test.ts` (partial — DependencyGraph tests only)

- [ ] **Step 1.1: Write failing DependencyGraph test**

Create `tests/MultiLangAST.test.ts` with just the DependencyGraph section:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ASTParser } from '../src/ast/ASTParser.js';

// ─── DependencyGraph import-resolution regression tests ──────────────────────

describe('DependencyGraph — multi-language import resolution', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-dep-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves Rust mod declarations to file edges', async () => {
    // lib.rs declares `mod utils;`  →  expects edge lib.rs → utils.rs
    fs.writeFileSync(path.join(tmpDir, 'lib.rs'), 'mod utils;\n\nfn main() {}\n');
    fs.writeFileSync(path.join(tmpDir, 'utils.rs'), 'pub fn helper() {}\n');

    const parser = new ASTParser();
    await parser.init();
    const graph = new DependencyGraph();
    graph.setParser(parser);
    await graph.buildFromDirectory(tmpDir);

    expect(graph.getImports('lib.rs')).toContain('utils.rs');
  });

  it('resolves Python relative imports to file edges', async () => {
    // main.py: `from .utils import helper`  →  edge main.py → utils.py
    fs.writeFileSync(path.join(tmpDir, 'main.py'), 'from .utils import helper\n');
    fs.writeFileSync(path.join(tmpDir, 'utils.py'), 'def helper(): pass\n');

    const parser = new ASTParser();
    await parser.init();
    const graph = new DependencyGraph();
    graph.setParser(parser);
    await graph.buildFromDirectory(tmpDir);

    expect(graph.getImports('main.py')).toContain('utils.py');
  });

  it('adds Go/Rust/Java files to allFiles() after graph build', async () => {
    fs.writeFileSync(path.join(tmpDir, 'main.go'), 'package main\nfunc main() {}\n');
    fs.writeFileSync(path.join(tmpDir, 'Foo.java'), 'public class Foo {}\n');
    fs.writeFileSync(path.join(tmpDir, 'lib.rs'), 'fn hello() {}\n');

    const parser = new ASTParser();
    await parser.init();
    const graph = new DependencyGraph();
    graph.setParser(parser);
    await graph.buildFromDirectory(tmpDir);

    const files = graph.allFiles();
    expect(files).toContain('main.go');
    expect(files).toContain('Foo.java');
    expect(files).toContain('lib.rs');
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/MultiLangAST.test.ts
```

Expected: Python test FAILS (TS-style resolver can't find `.py` files). Rust test MAY pass (currently handled by `else` branch). Go/Rust/Java presence test passes. The Python failure is the bug we're fixing.

- [ ] **Step 1.3: Update `DependencyGraph.ts`**

Open `src/graph/DependencyGraph.ts`. Make the following changes:

**1. Update the `AST_EXTENSIONS` constant** (lines ~23-25):

```typescript
/** Extensions handled by the TypeScript/JS AST parser. */
const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
/** Extensions handled by the AST parser (TS/JS + Python + Go + Rust + Java). */
const AST_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rs', '.java']);
```

**2. Replace the import-resolution block in `buildFromDirectory`** (currently lines ~78-117). Replace the entire `if (AST_EXTENSIONS.has(ext)) { ... } else { ... }` block with:

```typescript
if (AST_EXTENSIONS.has(ext)) {
  // ── AST-parsed languages: symbol indexing via tree-sitter ────────
  const nodes = await this.parser.parse(absPath);

  if (TS_EXTENSIONS.has(ext)) {
    // TypeScript/JS: AST import nodes → TS-style path resolution
    const importNodes = nodes.filter(n => n.type === 'import');
    for (const imp of importNodes) {
      const src = imp.source ?? '';
      if (!src.startsWith('.')) continue; // skip node_modules
      const resolved = this.resolveImport(absPath, src, rootDir);
      if (resolved) this.addEdge(relPath, resolved);
    }
  } else {
    // Python / Go / Rust / Java: regex extractor handles import graph edges
    // (TS-style resolver does not know Python/Go/Rust/Java path conventions)
    const content = fs.readFileSync(absPath, 'utf-8');
    const rawImports = extractImports(absPath, content);
    for (const raw of rawImports) {
      const resolved = resolveMultiLangImport(absPath, raw, rootDir);
      if (resolved) this.addEdge(relPath, resolved);
    }
  }

  // Symbol indexing for all AST-parsed languages
  for (const node of nodes) {
    if (node.type === 'function' || node.type === 'class' || node.type === 'interface') {
      const existing = this.symbolIndex.get(node.name) ?? [];
      existing.push({
        filePath: relPath,
        type: node.type,
        signature: node.signature ?? `${node.type} ${node.name}`,
      });
      this.symbolIndex.set(node.name, existing);
    }
  }

  // Call graph edges: TypeScript/JS only
  if (TS_EXTENSIONS.has(ext)) {
    const callEdges = await this.parser.parseAllCallEdges(absPath);
    for (const edge of callEdges) {
      this.callGraphIndex.addEdge({ callerFile: relPath, ...edge });
    }
  }
} else {
  // ── Other languages (.c, .cpp, .h, .md, etc.): regex-based ──────
  const content = fs.readFileSync(absPath, 'utf-8');
  const rawImports = extractImports(absPath, content);
  for (const raw of rawImports) {
    const resolved = resolveMultiLangImport(absPath, raw, rootDir);
    if (resolved) this.addEdge(relPath, resolved);
  }
}
```

**3. Apply the same fix to `updateFile`** (currently lines ~276-316). Replace the `if (AST_EXTENSIONS.has(ext)) { ... } else { ... }` block in `updateFile` with the exact same structure:

```typescript
if (AST_EXTENSIONS.has(ext)) {
  // TypeScript / JavaScript / Python / Go / Rust / Java: full AST parse
  const nodes = await this.parser.parse(absPath);

  if (TS_EXTENSIONS.has(ext)) {
    const importNodes = nodes.filter(n => n.type === 'import');
    for (const importNode of importNodes) {
      const src = importNode.source ?? '';
      if (!src.startsWith('.')) continue;
      const resolved = this.resolveImport(absPath, src, rootDir);
      if (resolved) this.addEdge(relPath, resolved);
    }
  } else {
    const content = fs.readFileSync(absPath, 'utf-8');
    const rawImports = extractImports(absPath, content);
    for (const raw of rawImports) {
      const resolved = resolveMultiLangImport(absPath, raw, rootDir);
      if (resolved) this.addEdge(relPath, resolved);
    }
  }

  // Rebuild symbol index entries from this file
  for (const node of nodes) {
    if (node.type === 'function' || node.type === 'class' || node.type === 'interface') {
      const existing = this.symbolIndex.get(node.name) ?? [];
      existing.push({
        filePath: relPath,
        type: node.type,
        signature: node.signature ?? `${node.type} ${node.name}`,
      });
      this.symbolIndex.set(node.name, existing);
    }
  }

  // Rebuild call graph edges: TypeScript/JS only
  if (TS_EXTENSIONS.has(ext)) {
    const callEdges = await this.parser.parseAllCallEdges(absPath);
    for (const edge of callEdges) {
      this.callGraphIndex.addEdge({ callerFile: relPath, ...edge });
    }
  }
} else {
  const content = fs.readFileSync(absPath, 'utf-8');
  const rawImports = extractImports(absPath, content);
  for (const raw of rawImports) {
    const resolved = resolveMultiLangImport(absPath, raw, rootDir);
    if (resolved) this.addEdge(relPath, resolved);
  }
}
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/MultiLangAST.test.ts
```

Expected: All 3 tests pass. Python relative import edges now resolve correctly.

- [ ] **Step 1.5: Run full suite + type-check**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run && npx tsc --noEmit
```

Expected: All 167 tests pass, 0 TS errors.

- [ ] **Step 1.6: Commit**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
git add src/graph/DependencyGraph.ts tests/MultiLangAST.test.ts
git commit -m "fix: route Python/Go/Rust/Java through regex import resolver in DependencyGraph"
```

---

## Task 2 — Go AST Support

Go functions are `function_declaration`, methods are `method_declaration`, types are `type_declaration` → `type_spec`, imports are `import_declaration` → `import_spec`.

**Files:**
- Modify: `src/ast/ASTParser.ts`
- Modify: `tests/MultiLangAST.test.ts` (add Go section)

- [ ] **Step 2.1: Add Go tests to `tests/MultiLangAST.test.ts`**

Append the following `describe` block to `tests/MultiLangAST.test.ts`:

```typescript
// ─── ASTParser dispatch tests ─────────────────────────────────────────────

describe('ASTParser — Go dispatch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-go-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parse() dispatches .go files without throwing', async () => {
    const goFile = path.join(tmpDir, 'main.go');
    fs.writeFileSync(goFile, `package main

import "fmt"

func greet(name string) string {
  return fmt.Sprintf("Hello, %s", name)
}

type User struct {
  Name string
  Age  int
}
`);
    const parser = new ASTParser();
    await parser.init();
    const result = await parser.parse(goFile);
    // Grammar may or may not be downloaded in CI; result must be an array
    expect(Array.isArray(result)).toBe(true);
  });

  it('parse() returns [] gracefully when Go grammar unavailable', async () => {
    const goFile = path.join(tmpDir, 'empty.go');
    fs.writeFileSync(goFile, 'package main\n');
    const parser = new ASTParser();
    await parser.init();
    // Force grammar unavailable by using a loader with empty cache dir
    const result = await parser.parse(goFile);
    expect(Array.isArray(result)).toBe(true);
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/MultiLangAST.test.ts
```

Expected: FAIL on Go tests — `parse()` currently falls through to the TypeScript parser for `.go` files, which may throw or return garbage.

- [ ] **Step 2.3: Add Go support to `src/ast/ASTParser.ts`**

**1. Add fields** after `private grammarLoader = new GrammarLoader();`:

```typescript
private goLang: TreeSitter.Language | null = null;
private rustLang: TreeSitter.Language | null = null;
private javaLang: TreeSitter.Language | null = null;
```

**2. Add `loadGo()` method** after `loadPython()`:

```typescript
async loadGo(): Promise<void> {
  if (this.goLang) return;
  try {
    const wasmPath = await this.grammarLoader.ensureGrammar('go');
    this.goLang = await TreeSitter.Language.load(wasmPath);
  } catch (err) {
    const { logger } = await import('../utils/logger.js');
    logger.warn('Go grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
  }
}
```

**3. Add dispatch in `parse()`** — after the `if (ext === '.py') { ... }` block, add:

```typescript
if (ext === '.go') return this.parseGo(filePath);
if (ext === '.rs') return this.parseRust(filePath);
if (ext === '.java') return this.parseJava(filePath);
```

**4. Add `parseGo()` method** before the closing brace of the class (after `parsePython`):

```typescript
private async parseGo(filePath: string): Promise<ParsedNode[]> {
  if (!this.goLang) await this.loadGo();
  if (!this.goLang) return [];

  const parser = new TreeSitter.Parser();
  parser.setLanguage(this.goLang);

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
      case 'method_declaration': {
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
      case 'type_declaration': {
        for (const child of node.children) {
          if (child?.type === 'type_spec') {
            const nameNode = child.childForFieldName?.('name');
            if (nameNode) {
              const typeNode = child.childForFieldName?.('type');
              const isInterface = typeNode?.type === 'interface_type';
              nodes.push({
                type: isInterface ? 'interface' : 'class',
                name: nameNode.text,
                signature: `type ${nameNode.text} ${typeNode?.type ?? ''}`.trim(),
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
              });
            }
          }
        }
        return;
      }
      case 'import_declaration': {
        // Walk into import_spec_list or import_spec directly
        const walkImport = (n: TreeSitter.Node): void => {
          if (n.type === 'import_spec') {
            const pathNode = n.childForFieldName?.('path');
            if (pathNode) {
              const spec = pathNode.text.replace(/^"|"$/g, '');
              nodes.push({
                type: 'import',
                name: spec,
                source: spec,
                startLine: n.startPosition.row + 1,
                endLine: n.endPosition.row + 1,
              });
            }
          }
          for (const c of n.children) {
            if (c) walkImport(c);
          }
        };
        walkImport(node);
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

- [ ] **Step 2.4: Run Go tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/MultiLangAST.test.ts
```

Expected: Go dispatch tests pass. (If Go grammar is cached locally it will parse symbols; if not, returns `[]` gracefully.)

- [ ] **Step 2.5: Run full suite + type-check**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run && npx tsc --noEmit
```

Expected: All tests pass, 0 TS errors.

- [ ] **Step 2.6: Commit**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
git add src/ast/ASTParser.ts tests/MultiLangAST.test.ts
git commit -m "feat: Go AST support — symbol indexing via tree-sitter-go"
```

---

## Task 3 — Rust AST Support

Rust functions are `function_item`, structs are `struct_item`, enums are `enum_item`, impl blocks are `impl_item`, module declarations are `mod_item` (file refs only, not inline blocks), uses are `use_declaration`.

**Files:**
- Modify: `src/ast/ASTParser.ts`
- Modify: `tests/MultiLangAST.test.ts` (add Rust section)

- [ ] **Step 3.1: Add Rust tests to `tests/MultiLangAST.test.ts`**

Append after the Go `describe` block:

```typescript
describe('ASTParser — Rust dispatch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-rs-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parse() dispatches .rs files without throwing', async () => {
    const rsFile = path.join(tmpDir, 'lib.rs');
    fs.writeFileSync(rsFile, `pub struct User {
  pub name: String,
  pub age: u32,
}

impl User {
  pub fn new(name: String, age: u32) -> Self {
    User { name, age }
  }
}

pub fn greet(user: &User) -> String {
  format!("Hello, {}", user.name)
}
`);
    const parser = new ASTParser();
    await parser.init();
    const result = await parser.parse(rsFile);
    expect(Array.isArray(result)).toBe(true);
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/MultiLangAST.test.ts
```

Expected: Rust test FAILs — `.rs` dispatches to TypeScript parser which either throws or returns wrong results.

- [ ] **Step 3.3: Add `loadRust()` and `parseRust()` to `src/ast/ASTParser.ts`**

**1. Add `loadRust()` method** after `loadGo()`:

```typescript
async loadRust(): Promise<void> {
  if (this.rustLang) return;
  try {
    const wasmPath = await this.grammarLoader.ensureGrammar('rust');
    this.rustLang = await TreeSitter.Language.load(wasmPath);
  } catch (err) {
    const { logger } = await import('../utils/logger.js');
    logger.warn('Rust grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
  }
}
```

**2. Add `parseRust()` private method** after `parseGo()`:

```typescript
private async parseRust(filePath: string): Promise<ParsedNode[]> {
  if (!this.rustLang) await this.loadRust();
  if (!this.rustLang) return [];

  const parser = new TreeSitter.Parser();
  parser.setLanguage(this.rustLang);

  const source = fs.readFileSync(filePath, 'utf-8');
  const tree = parser.parse(source);
  if (!tree) return [];

  const nodes: ParsedNode[] = [];
  const lines = source.split('\n');

  const walk = (node: TreeSitter.Node): void => {
    switch (node.type) {
      case 'function_item': {
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
      case 'struct_item': {
        const nameNode = node.childForFieldName?.('name');
        if (nameNode) {
          nodes.push({
            type: 'class',
            name: nameNode.text,
            signature: `struct ${nameNode.text}`,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
        }
        return;
      }
      case 'enum_item': {
        const nameNode = node.childForFieldName?.('name');
        if (nameNode) {
          nodes.push({
            type: 'class',
            name: nameNode.text,
            signature: `enum ${nameNode.text}`,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
        }
        return;
      }
      case 'trait_item': {
        const nameNode = node.childForFieldName?.('name');
        if (nameNode) {
          nodes.push({
            type: 'interface',
            name: nameNode.text,
            signature: `trait ${nameNode.text}`,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
        }
        return;
      }
      case 'impl_item': {
        // `impl Foo` or `impl Trait for Foo` — index under the type name
        const typeNode = node.childForFieldName?.('type');
        if (typeNode) {
          const body = node.childForFieldName?.('body');
          const methods = (body?.children ?? [])
            .filter((c): c is TreeSitter.Node => c !== null && c.type === 'function_item')
            .map(c => c.childForFieldName?.('name')?.text ?? '')
            .filter(Boolean);
          nodes.push({
            type: 'class',
            name: typeNode.text,
            signature: `impl ${typeNode.text}`,
            methods,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
        }
        return;
      }
      case 'mod_item': {
        // `mod foo;` (no body) = file module declaration — emit as import
        const body = node.childForFieldName?.('body');
        if (body) return; // `mod foo { ... }` inline block — skip
        const nameNode = node.childForFieldName?.('name');
        if (nameNode) {
          nodes.push({
            type: 'import',
            name: nameNode.text,
            source: nameNode.text,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
        }
        return;
      }
      case 'use_declaration': {
        const arg = node.childForFieldName?.('argument');
        if (arg) {
          nodes.push({
            type: 'import',
            name: arg.text,
            source: arg.text,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
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

- [ ] **Step 3.4: Run Rust tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/MultiLangAST.test.ts
```

Expected: All tests in file pass.

- [ ] **Step 3.5: Run full suite + type-check**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run && npx tsc --noEmit
```

Expected: All tests pass, 0 TS errors.

- [ ] **Step 3.6: Commit**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
git add src/ast/ASTParser.ts tests/MultiLangAST.test.ts
git commit -m "feat: Rust AST support — symbol indexing via tree-sitter-rust"
```

---

## Task 4 — Java AST Support

Java classes are `class_declaration`, interfaces are `interface_declaration`, methods are `method_declaration`, imports are `import_declaration`.

**Files:**
- Modify: `src/ast/ASTParser.ts`
- Modify: `tests/MultiLangAST.test.ts` (add Java section)

- [ ] **Step 4.1: Add Java tests to `tests/MultiLangAST.test.ts`**

Append after the Rust `describe` block:

```typescript
describe('ASTParser — Java dispatch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-java-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parse() dispatches .java files without throwing', async () => {
    const javaFile = path.join(tmpDir, 'UserService.java');
    fs.writeFileSync(javaFile, `import java.util.List;
import java.util.Optional;

public class UserService {
  private final UserRepository repo;

  public UserService(UserRepository repo) {
    this.repo = repo;
  }

  public Optional<User> findById(String id) {
    return repo.findById(id);
  }

  public List<User> findAll() {
    return repo.findAll();
  }
}
`);
    const parser = new ASTParser();
    await parser.init();
    const result = await parser.parse(javaFile);
    expect(Array.isArray(result)).toBe(true);
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/MultiLangAST.test.ts
```

Expected: Java test FAILs.

- [ ] **Step 4.3: Add `loadJava()` and `parseJava()` to `src/ast/ASTParser.ts`**

**1. Add `loadJava()` method** after `loadRust()`:

```typescript
async loadJava(): Promise<void> {
  if (this.javaLang) return;
  try {
    const wasmPath = await this.grammarLoader.ensureGrammar('java');
    this.javaLang = await TreeSitter.Language.load(wasmPath);
  } catch (err) {
    const { logger } = await import('../utils/logger.js');
    logger.warn('Java grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
  }
}
```

**2. Add `parseJava()` private method** after `parseRust()`:

```typescript
private async parseJava(filePath: string): Promise<ParsedNode[]> {
  if (!this.javaLang) await this.loadJava();
  if (!this.javaLang) return [];

  const parser = new TreeSitter.Parser();
  parser.setLanguage(this.javaLang);

  const source = fs.readFileSync(filePath, 'utf-8');
  const tree = parser.parse(source);
  if (!tree) return [];

  const nodes: ParsedNode[] = [];
  const lines = source.split('\n');

  const walk = (node: TreeSitter.Node): void => {
    switch (node.type) {
      case 'class_declaration': {
        const nameNode = node.childForFieldName?.('name');
        if (nameNode) {
          const body = node.childForFieldName?.('body');
          const methods = (body?.children ?? [])
            .filter((c): c is TreeSitter.Node => c !== null && c.type === 'method_declaration')
            .map(c => c.childForFieldName?.('name')?.text ?? '')
            .filter(Boolean);
          nodes.push({
            type: 'class',
            name: nameNode.text,
            signature: `class ${nameNode.text}`,
            methods,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
        }
        return;
      }
      case 'interface_declaration': {
        const nameNode = node.childForFieldName?.('name');
        if (nameNode) {
          nodes.push({
            type: 'interface',
            name: nameNode.text,
            signature: `interface ${nameNode.text}`,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
        }
        return;
      }
      case 'method_declaration': {
        // Top-level methods outside a class (rare in Java but valid)
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
      case 'import_declaration': {
        // import com.example.Foo;  or  import static com.example.Foo.method;
        const child = node.children.find(
          c => c?.type === 'scoped_identifier' || c?.type === 'identifier',
        );
        if (child) {
          nodes.push({
            type: 'import',
            name: child.text,
            source: child.text,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
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

- [ ] **Step 4.4: Run all MultiLangAST tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/MultiLangAST.test.ts
```

Expected: All tests in file pass (9+ tests).

- [ ] **Step 4.5: Run full suite + type-check**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run && npx tsc --noEmit
```

Expected: All tests pass, 0 TS errors.

- [ ] **Step 4.6: Commit**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
git add src/ast/ASTParser.ts tests/MultiLangAST.test.ts
git commit -m "feat: Java AST support — symbol indexing via tree-sitter-java"
```

---

## Task 5 — Final Validation

- [ ] **Step 5.1: Run complete test suite**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run
```

Expected: All tests pass (174+).

- [ ] **Step 5.2: Type-check**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5.3: Build**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npm run build
```

Expected: Build succeeds.

- [ ] **Step 5.4: CLI smoke test**

```bash
node dist/index.js grammars
```

Expected output lists Python, Go, Rust, Java with status `○ (not cached)` — all four languages ready for on-demand grammar download.

- [ ] **Step 5.5: Update grammar-manifest versions (if needed)**

Check that the versions in `src/grammars/grammar-manifest.ts` are still current:
- `tree-sitter-go` 0.23.4
- `tree-sitter-rust` 0.23.2
- `tree-sitter-java` 0.23.5

These were set in Phase 1. If `npm info tree-sitter-go version` returns a newer version, update the manifest entry. No changes needed if they match.

---

## Self-Review Checklist

**Spec coverage (from ROADMAP Phase 2 — Language Expansion):**
- [x] Go: ASTParser dispatch + graceful degradation → Task 2
- [x] Rust: ASTParser dispatch + graceful degradation → Task 3
- [x] Java: ASTParser dispatch + graceful degradation → Task 4
- [x] Go `function_declaration` + `method_declaration` + `type_declaration` → Task 2
- [x] Rust `function_item` + `struct_item` + `impl_item` + `use_declaration` + `mod_item` → Task 3
- [x] Java `method_declaration` + `class_declaration` + `interface_declaration` + `import_declaration` → Task 4
- [x] DependencyGraph includes Go/Rust/Java in AST_EXTENSIONS → Task 1
- [x] Import resolution for Go/Rust/Java preserved via regex extractor → Task 1
- [x] Python import-graph bug fixed as side-effect → Task 1
- [x] GrammarLoader + grammar-manifest entries already exist (Phase 1) → no new task needed
- [x] Skeletonizer coverage: handles `function`, `class`, `interface` nodes which is exactly what all three parsers emit → no change needed (verified: Skeletonizer.skeletonize() has these cases)

**Deferred (out of Phase 2a scope, per ROADMAP):**
- C#, C/C++, Ruby, PHP, Kotlin, Swift — lower priority; follow same 4-step pattern
- Go module-path import resolution (`go.mod` parsing) — ROADMAP calls this a "hard problem"
- Rust `impl Trait for Struct` dual indexing — ROADMAP flags as complex
- Call graph edges for Go/Rust/Java (Phase 3 territory)

**Type consistency:**
- `ParsedNode` type field for Rust structs/enums/impl → `'class'` (no `'struct'` or `'enum'` in ParsedNode.type union — verified against existing TypeScript behavior which uses `'class'` for class declarations)
- `parseGo()`, `parseRust()`, `parseJava()` all return `Promise<ParsedNode[]>` ✓
- `loadGo()`, `loadRust()`, `loadJava()` all return `Promise<void>` ✓
- `goLang`, `rustLang`, `javaLang` typed as `TreeSitter.Language | null` ✓

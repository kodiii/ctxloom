# Compete With code-review-graph: 8 Gap Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 8 competitive gaps vs code-review-graph.com — add C#/Ruby/Kotlin/Swift language support, 5 new tools (apply_refactor, detect_changes, full_text_search, suggested_questions, get_workflow), SVG export, and a public-repo benchmark.

**Architecture:** Each language adds an entry to `grammar-manifest.ts`, a `parseX()` method in `ASTParser.ts`, and import extraction in `importExtractor.ts`. Each new tool follows the existing pattern: one file in `src/tools/`, registered in `src/tools/index.ts`, tested in `tests/`.

**Tech Stack:** TypeScript/ESM, web-tree-sitter WASM grammars via jsdelivr CDN, vitest, zod, LanceDB.

---

## File Map

**Modified:**
- `src/grammars/grammar-manifest.ts` — add C#, Ruby, Kotlin, Swift entries + `downloadUrl?` field
- `src/grammars/GrammarLoader.ts` — respect `downloadUrl` when set
- `src/ast/ASTParser.ts` — add `csLang`, `rubyLang`, `kotlinLang`, `swiftLang` + 4 parse methods
- `src/utils/importExtractor.ts` — add cases for `.cs`, `.rb`, `.kt`, `.swift`
- `src/indexer/embedder.ts` — add `.cs`, `.rb`, `.kt`, `.swift` to SUPPORTED_EXTENSIONS
- `src/graph/GraphExporter.ts` — add `toSVG()` method + `'svg'` case in `export()`
- `src/tools/graph-export.ts` — add `'svg'` to schema enum
- `src/tools/index.ts` — register 5 new tools

**Created:**
- `src/tools/apply-refactor.ts`
- `src/tools/detect-changes.ts`
- `src/tools/full-text-search.ts`
- `src/tools/suggested-questions.ts`
- `src/tools/get-workflow.ts`
- `benchmarks/benchmark-public-repos.ts`
- `tests/ApplyRefactor.test.ts`
- `tests/DetectChanges.test.ts`
- `tests/FullTextSearch.test.ts`
- `tests/SuggestedQuestions.test.ts`
- `tests/GetWorkflow.test.ts`
- `tests/SVGExport.test.ts`

---

## Task 1: GrammarEntry `downloadUrl` field

**Files:**
- Modify: `src/grammars/grammar-manifest.ts`
- Modify: `src/grammars/GrammarLoader.ts:71-94`

- [ ] **Step 1: Add `downloadUrl?` to GrammarEntry interface**

In `src/grammars/grammar-manifest.ts`, change the interface:

```typescript
export interface GrammarEntry {
  language: string;
  extensions: string[];
  npmPackage: string;
  version: string;
  wasmFile: string;
  sha256: string | null;
  downloadUrl?: string; // Override CDN URL (for grammars without WASM in npm package)
}
```

- [ ] **Step 2: Use `downloadUrl` in GrammarLoader.ensureGrammar**

In `src/grammars/GrammarLoader.ts`, find the line inside `ensureGrammar` that builds the URL:
```typescript
const url = `${this.cdn}/${entry.npmPackage}@${entry.version}/${entry.wasmFile}`;
```
Replace it with:
```typescript
const url = entry.downloadUrl ?? `${this.cdn}/${entry.npmPackage}@${entry.version}/${entry.wasmFile}`;
```

- [ ] **Step 3: Run the build to verify no type errors**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
npm run build 2>&1 | tail -5
```
Expected: `dist/` rebuilt with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/grammars/grammar-manifest.ts src/grammars/GrammarLoader.ts
git commit -m "feat: add optional downloadUrl override to GrammarEntry for non-npm WASM grammars"
```

---

## Task 2: C# Language Support

**Files:**
- Modify: `src/grammars/grammar-manifest.ts`
- Modify: `src/ast/ASTParser.ts`
- Modify: `src/utils/importExtractor.ts`
- Modify: `src/indexer/embedder.ts`

The C# WASM is published inside `@vscode/tree-sitter-wasm@0.3.1` at path `wasm/tree-sitter-c-sharp.wasm`. We use the existing CDN path mechanism — no `downloadUrl` needed.

- [ ] **Step 1: Add C# to grammar-manifest.ts**

Append to the `GRAMMAR_MANIFEST` array in `src/grammars/grammar-manifest.ts`:

```typescript
  {
    language: 'csharp',
    extensions: ['.cs'],
    npmPackage: '@vscode/tree-sitter-wasm',
    version: '0.3.1',
    wasmFile: 'wasm/tree-sitter-c-sharp.wasm',
    sha256: null,
  },
```

- [ ] **Step 2: Add csLang field and loadCSharp() to ASTParser**

In `src/ast/ASTParser.ts`, after the `private javaLang` field declaration, add:

```typescript
  private csLang: TreeSitter.Language | null = null;
```

After the `loadJava()` method, add:

```typescript
  private async loadCSharp(): Promise<void> {
    if (this.csLang) return;
    try {
      const wasmPath = await this.grammarLoader.ensureGrammar('csharp');
      this.csLang = await TreeSitter.Language.load(wasmPath);
    } catch (err) {
      const { logger } = await import('../utils/logger.js');
      logger.warn('C# grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
    }
  }
```

- [ ] **Step 3: Dispatch .cs files in parse()**

In `ASTParser.parse()`, after the `.java` dispatch line, add:

```typescript
    if (ext === '.cs') return this.parseCSharp(filePath);
```

- [ ] **Step 4: Add parseCSharp() method**

After `parseJava()`, add:

```typescript
  private async parseCSharp(filePath: string): Promise<ParsedNode[]> {
    if (!this.csLang) await this.loadCSharp();
    if (!this.csLang) return [];

    const parser = new TreeSitter.Parser();
    parser.setLanguage(this.csLang);

    const source = fs.readFileSync(filePath, 'utf-8');
    const tree = parser.parse(source);
    if (!tree) return [];

    const nodes: ParsedNode[] = [];
    const lines = source.split('\n');

    const walk = (node: TreeSitter.Node): void => {
      switch (node.type) {
        case 'using_directive': {
          const nameNode = node.children.find(
            c => c?.type === 'identifier' || c?.type === 'qualified_name' || c?.type === 'name',
          );
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
        case 'method_declaration': {
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'identifier');
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
        case 'class_declaration':
        case 'struct_declaration': {
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'identifier');
          if (nameNode) {
            const body = node.childForFieldName?.('body');
            const methods = (body?.children ?? [])
              .filter((c): c is TreeSitter.Node => c !== null && c.type === 'method_declaration')
              .map(c => (c.childForFieldName?.('name') ?? c.children.find(ch => ch?.type === 'identifier'))?.text ?? '')
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
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'identifier');
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
      }
      for (const child of node.children) {
        if (child) walk(child);
      }
    };

    walk(tree.rootNode);
    return nodes;
  }
```

- [ ] **Step 5: Add C# import extraction to importExtractor.ts**

In `src/utils/importExtractor.ts`, in the `extractImports` switch, add before `default`:
```typescript
    case '.cs':   return extractCSharpImports(content);
```

In `resolveImport`, add before the final `return null`:
```typescript
  if (ext === '.cs') return resolveCSharpImport(fromDir, raw, rootDir);
```

Add these two functions at the bottom of the file:

```typescript
// ─── C# ───────────────────────────────────────────────────────────────────

function extractCSharpImports(content: string): RawImport[] {
  const results: RawImport[] = [];
  const usingRe = /^using\s+(?:static\s+)?([\w.]+)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = usingRe.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: false });
  }
  return results;
}

function resolveCSharpImport(
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  // using Company.Project.Auth → try rootDir/Company/Project/Auth.cs
  const filePath = path.join(rootDir, raw.specifier.replace(/\./g, path.sep) + '.cs');
  if (fs.existsSync(filePath)) return path.relative(rootDir, filePath);
  // Same-directory fallback: last segment only
  const className = raw.specifier.split('.').pop() ?? raw.specifier;
  const local = path.join(fromDir, className + '.cs');
  if (fs.existsSync(local)) return path.relative(rootDir, local);
  return null;
}
```

- [ ] **Step 6: Add .cs to SUPPORTED_EXTENSIONS in embedder.ts**

In `src/indexer/embedder.ts`, find the `SUPPORTED_EXTENSIONS` Set and add `'.cs'`:

```typescript
  const SUPPORTED_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs',
    '.py', '.rs', '.go', '.java', '.cs', '.rb', '.kt', '.kts', '.swift',
    '.c', '.cpp', '.h',
    '.md', '.json', '.yaml', '.yml', '.toml',
  ]);
```

- [ ] **Step 7: Run build**

```bash
npm run build 2>&1 | tail -5
```
Expected: No TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add src/grammars/grammar-manifest.ts src/ast/ASTParser.ts src/utils/importExtractor.ts src/indexer/embedder.ts
git commit -m "feat: add C# language support (tree-sitter-c-sharp via @vscode/tree-sitter-wasm)"
```

---

## Task 3: Ruby Language Support

**Files:**
- Modify: `src/grammars/grammar-manifest.ts`
- Modify: `src/ast/ASTParser.ts`
- Modify: `src/utils/importExtractor.ts`

Ruby WASM is in `tree-sitter-ruby@0.23.1` npm package directly at `tree-sitter-ruby.wasm`.

- [ ] **Step 1: Add Ruby to grammar-manifest.ts**

```typescript
  {
    language: 'ruby',
    extensions: ['.rb'],
    npmPackage: 'tree-sitter-ruby',
    version: '0.23.1',
    wasmFile: 'tree-sitter-ruby.wasm',
    sha256: null,
  },
```

- [ ] **Step 2: Add rubyLang field and loadRuby() to ASTParser**

After the `private csLang` field, add:
```typescript
  private rubyLang: TreeSitter.Language | null = null;
```

After `loadCSharp()`, add:
```typescript
  private async loadRuby(): Promise<void> {
    if (this.rubyLang) return;
    try {
      const wasmPath = await this.grammarLoader.ensureGrammar('ruby');
      this.rubyLang = await TreeSitter.Language.load(wasmPath);
    } catch (err) {
      const { logger } = await import('../utils/logger.js');
      logger.warn('Ruby grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
    }
  }
```

- [ ] **Step 3: Dispatch .rb in parse()**

After the `.cs` dispatch:
```typescript
    if (ext === '.rb') return this.parseRuby(filePath);
```

- [ ] **Step 4: Add parseRuby() method**

```typescript
  private async parseRuby(filePath: string): Promise<ParsedNode[]> {
    if (!this.rubyLang) await this.loadRuby();
    if (!this.rubyLang) return [];

    const parser = new TreeSitter.Parser();
    parser.setLanguage(this.rubyLang);

    const source = fs.readFileSync(filePath, 'utf-8');
    const tree = parser.parse(source);
    if (!tree) return [];

    const nodes: ParsedNode[] = [];
    const lines = source.split('\n');

    const walk = (node: TreeSitter.Node): void => {
      switch (node.type) {
        case 'method':
        case 'singleton_method': {
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'identifier');
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
        case 'class': {
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'constant');
          if (nameNode) {
            const body = node.childForFieldName?.('body');
            const methods = (body?.children ?? [])
              .filter((c): c is TreeSitter.Node => c !== null && (c.type === 'method' || c.type === 'singleton_method'))
              .map(c => (c.childForFieldName?.('name') ?? c.children.find(ch => ch?.type === 'identifier'))?.text ?? '')
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
        case 'module': {
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'constant');
          if (nameNode) {
            nodes.push({
              type: 'class',
              name: nameNode.text,
              signature: `module ${nameNode.text}`,
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

- [ ] **Step 5: Add Ruby import extraction to importExtractor.ts**

In `extractImports` switch, add:
```typescript
    case '.rb':   return extractRubyImports(content);
```

In `resolveImport`, add:
```typescript
  if (ext === '.rb') return resolveRubyImport(fromDir, raw, rootDir);
```

Add at the bottom of the file:
```typescript
// ─── Ruby ─────────────────────────────────────────────────────────────────

function extractRubyImports(content: string): RawImport[] {
  const results: RawImport[] = [];
  // Only require_relative resolves to local files; plain require is gems
  const relRe = /require_relative\s+['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = relRe.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: true });
  }
  return results;
}

function resolveRubyImport(
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  const candidates = [
    path.join(fromDir, raw.specifier + '.rb'),
    path.join(fromDir, raw.specifier),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.relative(rootDir, c);
  }
  return null;
}
```

- [ ] **Step 6: Run build**

```bash
npm run build 2>&1 | tail -5
```
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/grammars/grammar-manifest.ts src/ast/ASTParser.ts src/utils/importExtractor.ts
git commit -m "feat: add Ruby language support (tree-sitter-ruby@0.23.1)"
```

---

## Task 4: Kotlin Language Support

**Files:**
- Modify: `src/grammars/grammar-manifest.ts`
- Modify: `src/ast/ASTParser.ts`
- Modify: `src/utils/importExtractor.ts`

Kotlin's npm package (`tree-sitter-kotlin@0.3.8`) does not bundle a WASM file. The WASM must be built from source and placed at `~/.ctxloom/grammars/tree-sitter-kotlin.wasm`. If it is absent, the grammar loads silently as unavailable and `.kt` files are skipped — no crash.

- [ ] **Step 1: Build Kotlin WASM (requires Docker)**

```bash
cd /tmp
git clone https://github.com/nickel-org/tree-sitter-kotlin.git
cd tree-sitter-kotlin
npx tree-sitter build-wasm   # uses Docker internally
mkdir -p ~/.ctxloom/grammars
cp tree-sitter-kotlin.wasm ~/.ctxloom/grammars/
```

Verify:
```bash
ls -lh ~/.ctxloom/grammars/tree-sitter-kotlin.wasm
```
Expected: file exists, size ~1-3 MB.

- [ ] **Step 2: Add Kotlin to grammar-manifest.ts**

```typescript
  {
    language: 'kotlin',
    extensions: ['.kt', '.kts'],
    npmPackage: 'tree-sitter-kotlin',
    version: '0.3.8',
    wasmFile: 'tree-sitter-kotlin.wasm',
    sha256: null,
  },
```

- [ ] **Step 3: Add kotlinLang field and loadKotlin() to ASTParser**

After `private rubyLang`, add:
```typescript
  private kotlinLang: TreeSitter.Language | null = null;
```

After `loadRuby()`, add:
```typescript
  private async loadKotlin(): Promise<void> {
    if (this.kotlinLang) return;
    try {
      const wasmPath = await this.grammarLoader.ensureGrammar('kotlin');
      this.kotlinLang = await TreeSitter.Language.load(wasmPath);
    } catch (err) {
      const { logger } = await import('../utils/logger.js');
      logger.warn('Kotlin grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
    }
  }
```

- [ ] **Step 4: Dispatch .kt/.kts in parse()**

```typescript
    if (ext === '.kt' || ext === '.kts') return this.parseKotlin(filePath);
```

- [ ] **Step 5: Add parseKotlin() method**

```typescript
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
          const nameNode = node.children.find(c => c?.type === 'simple_identifier');
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
        case 'class_declaration':
        case 'object_declaration': {
          const nameNode = node.children.find(c => c?.type === 'type_identifier' || c?.type === 'simple_identifier');
          if (nameNode) {
            nodes.push({
              type: 'class',
              name: nameNode.text,
              signature: `class ${nameNode.text}`,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'import_header': {
          const identifier = node.children.find(c => c?.type === 'identifier');
          if (identifier) {
            nodes.push({
              type: 'import',
              name: identifier.text,
              source: identifier.text,
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

- [ ] **Step 6: Add Kotlin import extraction to importExtractor.ts**

In `extractImports` switch:
```typescript
    case '.kt':
    case '.kts': return extractKotlinImports(content);
```

In `resolveImport`:
```typescript
  if (ext === '.kt' || ext === '.kts') return resolveKotlinImport(fromDir, raw, rootDir);
```

At the bottom:
```typescript
// ─── Kotlin ───────────────────────────────────────────────────────────────

function extractKotlinImports(content: string): RawImport[] {
  const results: RawImport[] = [];
  const importRe = /^import\s+([\w.]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(content)) !== null) {
    results.push({ specifier: m[1], isRelative: false });
  }
  return results;
}

function resolveKotlinImport(
  fromDir: string,
  raw: RawImport,
  rootDir: string,
): string | null {
  // import com.example.Foo → rootDir/com/example/Foo.kt
  const asPath = raw.specifier.replace(/\./g, path.sep);
  for (const ext of ['.kt', '.kts']) {
    const candidate = path.join(rootDir, asPath + ext);
    if (fs.existsSync(candidate)) return path.relative(rootDir, candidate);
  }
  // Same-directory: last segment
  const className = raw.specifier.split('.').pop() ?? raw.specifier;
  const local = path.join(fromDir, className + '.kt');
  if (fs.existsSync(local)) return path.relative(rootDir, local);
  return null;
}
```

- [ ] **Step 7: Run build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 8: Commit**

```bash
git add src/grammars/grammar-manifest.ts src/ast/ASTParser.ts src/utils/importExtractor.ts
git commit -m "feat: add Kotlin language support (tree-sitter-kotlin@0.3.8, WASM built from source)"
```

---

## Task 5: Swift Language Support

**Files:**
- Modify: `src/grammars/grammar-manifest.ts`
- Modify: `src/ast/ASTParser.ts`
- Modify: `src/utils/importExtractor.ts`

Same WASM build requirement as Kotlin — `tree-sitter-swift@0.7.1` npm package has no bundled WASM.

- [ ] **Step 1: Build Swift WASM**

```bash
cd /tmp
git clone https://github.com/nickel-org/tree-sitter-swift.git
cd tree-sitter-swift
npx tree-sitter build-wasm
cp tree-sitter-swift.wasm ~/.ctxloom/grammars/
```

Verify:
```bash
ls -lh ~/.ctxloom/grammars/tree-sitter-swift.wasm
```

- [ ] **Step 2: Add Swift to grammar-manifest.ts**

```typescript
  {
    language: 'swift',
    extensions: ['.swift'],
    npmPackage: 'tree-sitter-swift',
    version: '0.7.1',
    wasmFile: 'tree-sitter-swift.wasm',
    sha256: null,
  },
```

- [ ] **Step 3: Add swiftLang field and loadSwift() to ASTParser**

After `private kotlinLang`, add:
```typescript
  private swiftLang: TreeSitter.Language | null = null;
```

After `loadKotlin()`, add:
```typescript
  private async loadSwift(): Promise<void> {
    if (this.swiftLang) return;
    try {
      const wasmPath = await this.grammarLoader.ensureGrammar('swift');
      this.swiftLang = await TreeSitter.Language.load(wasmPath);
    } catch (err) {
      const { logger } = await import('../utils/logger.js');
      logger.warn('Swift grammar unavailable', { detail: err instanceof Error ? err.message : String(err) });
    }
  }
```

- [ ] **Step 4: Dispatch .swift in parse()**

```typescript
    if (ext === '.swift') return this.parseSwift(filePath);
```

- [ ] **Step 5: Add parseSwift() method**

```typescript
  private async parseSwift(filePath: string): Promise<ParsedNode[]> {
    if (!this.swiftLang) await this.loadSwift();
    if (!this.swiftLang) return [];

    const parser = new TreeSitter.Parser();
    parser.setLanguage(this.swiftLang);

    const source = fs.readFileSync(filePath, 'utf-8');
    const tree = parser.parse(source);
    if (!tree) return [];

    const nodes: ParsedNode[] = [];
    const lines = source.split('\n');

    const walk = (node: TreeSitter.Node): void => {
      switch (node.type) {
        case 'function_declaration': {
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'simple_identifier');
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
        case 'class_declaration': {
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'type_identifier');
          if (nameNode) {
            nodes.push({
              type: 'class',
              name: nameNode.text,
              signature: `class ${nameNode.text}`,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'protocol_declaration': {
          const nameNode = node.childForFieldName?.('name') ?? node.children.find(c => c?.type === 'type_identifier');
          if (nameNode) {
            nodes.push({
              type: 'interface',
              name: nameNode.text,
              signature: `protocol ${nameNode.text}`,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
          }
          return;
        }
        case 'import_declaration': {
          const nameNode = node.children.find(c => c?.type === 'identifier');
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
      }
      for (const child of node.children) {
        if (child) walk(child);
      }
    };

    walk(tree.rootNode);
    return nodes;
  }
```

- [ ] **Step 6: Add Swift import extraction to importExtractor.ts**

In `extractImports`:
```typescript
    case '.swift': return extractSwiftImports(content);
```

In `resolveImport`:
```typescript
  if (ext === '.swift') return resolveSwiftImport(fromDir, raw, rootDir);
```

At the bottom:
```typescript
// ─── Swift ────────────────────────────────────────────────────────────────

function extractSwiftImports(content: string): RawImport[] {
  const results: RawImport[] = [];
  // Swift module imports are not file-level; skip plain `import Foundation`
  // Only handle local file includes via package structure (no standard syntax)
  return results;
}

function resolveSwiftImport(
  _fromDir: string,
  _raw: RawImport,
  _rootDir: string,
): string | null {
  // Swift uses module imports, not file imports — no local resolution
  return null;
}
```

- [ ] **Step 7: Run build and tests**

```bash
npm run build 2>&1 | tail -5
npm test 2>&1 | tail -10
```
Expected: build passes, existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/grammars/grammar-manifest.ts src/ast/ASTParser.ts src/utils/importExtractor.ts
git commit -m "feat: add Swift language support (tree-sitter-swift@0.7.1, WASM built from source)"
```

---

## Task 6: SVG Graph Export

**Files:**
- Modify: `src/graph/GraphExporter.ts`
- Modify: `src/tools/graph-export.ts`
- Create: `tests/SVGExport.test.ts`

Generates inline SVG with no external dependencies. Circular layout ≤50 nodes, grid layout >50 nodes. Hub nodes (≥5 importers) are highlighted amber.

- [ ] **Step 1: Write failing test**

Create `tests/SVGExport.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { GraphExporter } from '../src/graph/GraphExporter.js';

function makeGraph(): DependencyGraph {
  const g = new DependencyGraph();
  g.addEdge('src/a.ts', 'src/b.ts');
  g.addEdge('src/c.ts', 'src/b.ts');
  return g;
}

describe('GraphExporter — SVG', () => {
  it('toSVG() returns valid SVG string', () => {
    const exporter = new GraphExporter(makeGraph(), '/fake');
    const svg = exporter.toSVG();
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('includes a node per file', () => {
    const exporter = new GraphExporter(makeGraph(), '/fake');
    const svg = exporter.toSVG();
    expect(svg).toContain('src/a.ts');
    expect(svg).toContain('src/b.ts');
    expect(svg).toContain('src/c.ts');
  });

  it('includes edge lines', () => {
    const exporter = new GraphExporter(makeGraph(), '/fake');
    const svg = exporter.toSVG();
    expect(svg).toContain('<line');
  });

  it('export("svg") writes file and returns result', () => {
    import('node:fs').then(fs => {
      import('node:os').then(os => {
        import('node:path').then(pathMod => {
          const tmpRoot = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'ctxloom-svg-'));
          const exporter = new GraphExporter(makeGraph(), tmpRoot);
          const result = exporter.export('svg');
          expect(result.format).toBe('svg');
          expect(result.outputPath).toContain('graph.svg');
          expect(fs.existsSync(result.outputPath)).toBe(true);
          fs.rmSync(tmpRoot, { recursive: true, force: true });
        });
      });
    });
  });

  it('empty graph returns valid empty SVG', () => {
    const g = new DependencyGraph();
    const exporter = new GraphExporter(g, '/fake');
    const svg = exporter.toSVG();
    expect(svg).toContain('<svg');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/SVGExport.test.ts 2>&1 | tail -15
```
Expected: FAIL — `toSVG is not a function`.

- [ ] **Step 3: Add toSVG() to GraphExporter**

In `src/graph/GraphExporter.ts`, add after `toDOT()`:

```typescript
  toSVG(): string {
    const files = this.graph.allFiles();
    if (files.length === 0) {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="80">'
        + '<text x="20" y="50" font-size="14" fill="#94a3b8">No nodes in graph</text></svg>';
    }

    const W = 1400;
    const H = 900;
    const PADDING = 80;
    const NODE_R = 6;

    const positions = new Map<string, { x: number; y: number }>();

    if (files.length <= 50) {
      const r = (Math.min(W, H) - 2 * PADDING) / 2;
      const cx = W / 2;
      const cy = H / 2;
      files.forEach((f, i) => {
        const angle = (2 * Math.PI * i) / files.length - Math.PI / 2;
        positions.set(f, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
      });
    } else {
      const cols = Math.ceil(Math.sqrt(files.length * (W / H)));
      const cellW = (W - 2 * PADDING) / cols;
      const cellH = (H - 2 * PADDING) / Math.ceil(files.length / cols);
      files.forEach((f, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        positions.set(f, {
          x: PADDING + cellW * col + cellW / 2,
          y: PADDING + cellH * row + cellH / 2,
        });
      });
    }

    const lines: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#fafafa;font-family:monospace">`,
      '<defs>',
      '  <marker id="arr" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="5" markerHeight="5" orient="auto">',
      '    <path d="M0,0 L8,4 L0,8 z" fill="#94a3b8"/>',
      '  </marker>',
      '</defs>',
    ];

    // Edges
    for (const [src, sPos] of positions) {
      for (const tgt of this.graph.getImports(src)) {
        const tPos = positions.get(tgt);
        if (!tPos) continue;
        lines.push(
          `<line x1="${sPos.x.toFixed(1)}" y1="${sPos.y.toFixed(1)}" x2="${tPos.x.toFixed(1)}" y2="${tPos.y.toFixed(1)}" stroke="#94a3b8" stroke-width="0.8" marker-end="url(#arr)" opacity="0.5"/>`,
        );
      }
    }

    // Nodes + labels
    for (const [file, pos] of positions) {
      const importerCount = this.graph.getImporters(file).length;
      const isHub = importerCount >= 5;
      const color = isHub ? '#f59e0b' : '#4f6ef7';
      const r = isHub ? NODE_R + 2 : NODE_R;
      const label = (file.split('/').pop()?.replace(/\.[^.]+$/, '') ?? file).slice(0, 18);
      lines.push(
        `<circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="${r}" fill="${color}" opacity="0.85">`,
        `  <title>${escapeXML(file)} (${importerCount} importers)</title>`,
        `</circle>`,
        `<text x="${pos.x.toFixed(1)}" y="${(pos.y + r + 9).toFixed(1)}" text-anchor="middle" font-size="8" fill="#475569">${escapeXML(label)}</text>`,
      );
    }

    lines.push('</svg>');
    return lines.join('\n');
  }
```

- [ ] **Step 4: Add 'svg' case in GraphExporter.export()**

In the `export()` method, after the `'dot'` block add:

```typescript
    if (format === 'svg') {
      const outputPath = path.join(this.exportDir, 'graph.svg');
      fs.writeFileSync(outputPath, this.toSVG(), 'utf-8');
      return { format, outputPath, nodeCount: files.length, edgeCount };
    }
```

- [ ] **Step 5: Update ExportFormat type and graph-export.ts schema**

In `src/graph/GraphExporter.ts`, update the type:
```typescript
export type ExportFormat = 'graphml' | 'dot' | 'obsidian' | 'svg';
```

In `src/tools/graph-export.ts`, update the schema enum and inputSchema:
```typescript
const Schema = z.object({
  format: z.enum(['graphml', 'dot', 'obsidian', 'svg']).describe(
    'Output format: graphml (Gephi/yEd), dot (Graphviz), obsidian (wikilink vault), svg (inline, no dependencies)',
  ),
});
```
And in `inputSchema.properties.format`:
```typescript
enum: ['graphml', 'dot', 'obsidian', 'svg'],
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/SVGExport.test.ts 2>&1 | tail -10
```
Expected: 5 passing.

- [ ] **Step 7: Commit**

```bash
git add src/graph/GraphExporter.ts src/tools/graph-export.ts tests/SVGExport.test.ts
git commit -m "feat: add SVG graph export — inline SVG with circular/grid layout, no Graphviz required"
```

---

## Task 7: ctx_apply_refactor Tool

**Files:**
- Create: `src/tools/apply-refactor.ts`
- Create: `tests/ApplyRefactor.test.ts`
- Modify: `src/tools/index.ts`

Applies a symbol rename to disk — the write-mode complement to `ctx_refactor_preview`.

- [ ] **Step 1: Write failing tests**

Create `tests/ApplyRefactor.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerApplyRefactorTool } from '../src/tools/apply-refactor.js';
import type { ServerContext } from '../src/tools/context.js';

let tmpDir: string;

function makeCtx(graph: DependencyGraph, root: string): ServerContext {
  return {
    projectRoot: root,
    dbPath: path.join(root, '.ctxloom/vectors.lancedb'),
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.resolve(graph),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: () => Promise.reject(new Error('not needed')),
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => true,
    isParserInitialized: () => false,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-refactor-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ctx_apply_refactor', () => {
  it('returns XML with apply_refactor element', async () => {
    const filePath = path.join(tmpDir, 'util.ts');
    fs.writeFileSync(filePath, 'export function oldName() {}\n');
    const graph = new DependencyGraph();
    graph.addSymbol('util.ts', { type: 'function', name: 'oldName', signature: 'function oldName()', startLine: 1, endLine: 1 });
    const registry = new ToolRegistry();
    registerApplyRefactorTool(registry, makeCtx(graph, tmpDir));
    const result = await registry.dispatch('ctx_apply_refactor', {
      symbol: 'oldName',
      new_name: 'newName',
    });
    expect(result).toContain('<apply_refactor');
    expect(result).toContain('</apply_refactor>');
  });

  it('rewrites occurrences in definition file', async () => {
    const filePath = path.join(tmpDir, 'util.ts');
    fs.writeFileSync(filePath, 'export function oldName() { return oldName; }\n');
    const graph = new DependencyGraph();
    graph.addSymbol('util.ts', { type: 'function', name: 'oldName', signature: 'function oldName()', startLine: 1, endLine: 1 });
    const registry = new ToolRegistry();
    registerApplyRefactorTool(registry, makeCtx(graph, tmpDir));
    await registry.dispatch('ctx_apply_refactor', {
      symbol: 'oldName',
      new_name: 'newName',
    });
    const after = fs.readFileSync(filePath, 'utf-8');
    expect(after).toContain('newName');
    expect(after).not.toContain('oldName');
  });

  it('dry_run=true does not write files', async () => {
    const filePath = path.join(tmpDir, 'util.ts');
    const original = 'export function oldName() {}\n';
    fs.writeFileSync(filePath, original);
    const graph = new DependencyGraph();
    graph.addSymbol('util.ts', { type: 'function', name: 'oldName', signature: 'function oldName()', startLine: 1, endLine: 1 });
    const registry = new ToolRegistry();
    registerApplyRefactorTool(registry, makeCtx(graph, tmpDir));
    await registry.dispatch('ctx_apply_refactor', {
      symbol: 'oldName',
      new_name: 'newName',
      dry_run: true,
    });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(original);
  });

  it('reports total_files and total_occurrences', async () => {
    const filePath = path.join(tmpDir, 'util.ts');
    fs.writeFileSync(filePath, 'function oldName() {}\noldName();\n');
    const graph = new DependencyGraph();
    graph.addSymbol('util.ts', { type: 'function', name: 'oldName', signature: 'function oldName()', startLine: 1, endLine: 1 });
    const registry = new ToolRegistry();
    registerApplyRefactorTool(registry, makeCtx(graph, tmpDir));
    const result = await registry.dispatch('ctx_apply_refactor', {
      symbol: 'oldName',
      new_name: 'newName',
    });
    expect(result).toContain('total_files="1"');
    expect(result).toContain('total_occurrences="2"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/ApplyRefactor.test.ts 2>&1 | tail -10
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create src/tools/apply-refactor.ts**

```typescript
/**
 * ctx_apply_refactor — Apply a symbol rename across the codebase.
 *
 * Same candidate collection as ctx_refactor_preview but WRITES changes
 * to disk. Use dry_run=true to preview without writing.
 */
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';

const Schema = z.object({
  symbol: z.string().min(1).describe('Symbol name to rename (exact, case-sensitive)'),
  new_name: z.string().min(1).describe('New name for the symbol'),
  dry_run: z.boolean().optional().default(false).describe(
    'When true, compute changes but do not write to disk (default: false)',
  ),
  max_files: z.number().min(1).max(200).optional().default(50).describe(
    'Maximum candidate files to process (default: 50)',
  ),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface FileResult {
  filePath: string;
  occurrences: number;
  written: boolean;
}

function applyToFile(
  absPath: string,
  symbol: string,
  newName: string,
  dryRun: boolean,
): number {
  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
  } catch {
    return 0;
  }

  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'g');

  const occurrences = (content.match(regex) ?? []).length;
  if (occurrences === 0) return 0;

  if (!dryRun) {
    fs.writeFileSync(absPath, content.replace(regex, newName), 'utf-8');
  }
  return occurrences;
}

export function registerApplyRefactorTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_apply_refactor',
    {
      name: 'ctx_apply_refactor',
      description:
        'Apply a symbol rename across all definition files, importers, and call sites. ' +
        'Writes changes to disk. Use dry_run=true to preview without writing. ' +
        'Complement to ctx_refactor_preview.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Symbol to rename' },
          new_name: { type: 'string', description: 'New name' },
          dry_run: { type: 'boolean', description: 'Preview only, no writes (default: false)' },
          max_files: { type: 'number', description: 'Max candidate files (default: 50)' },
        },
        required: ['symbol', 'new_name'],
      },
    },
    async (args) => {
      const { symbol, new_name, dry_run, max_files } = Schema.parse(args);
      const graph = await ctx.getGraph();

      const definitions = graph.lookupSymbol(symbol);
      const candidateSet = new Set<string>();

      for (const def of definitions) {
        candidateSet.add(def.filePath);
        for (const imp of graph.getImporters(def.filePath)) {
          candidateSet.add(imp);
        }
      }

      const callIdx = graph.getCallGraphIndex();
      for (const caller of callIdx.getCallers(symbol)) {
        candidateSet.add(caller.file);
      }

      const candidates = Array.from(candidateSet).slice(0, max_files);
      const results: FileResult[] = [];
      let totalOccurrences = 0;

      for (const relPath of candidates) {
        const absPath = path.join(ctx.projectRoot, relPath);
        const count = applyToFile(absPath, symbol, new_name, dry_run);
        if (count > 0) {
          results.push({ filePath: relPath, occurrences: count, written: !dry_run });
          totalOccurrences += count;
        }
      }

      const xml = [
        `<apply_refactor symbol="${escapeXML(symbol)}" new_name="${escapeXML(new_name)}" dry_run="${dry_run}" total_files="${results.length}" total_occurrences="${totalOccurrences}">`,
      ];
      for (const r of results) {
        xml.push(
          `  <file path="${escapeXML(r.filePath)}" occurrences="${r.occurrences}" written="${r.written}"/>`,
        );
      }
      xml.push('</apply_refactor>');
      return xml.join('\n');
    },
  );
}
```

- [ ] **Step 4: Register in src/tools/index.ts**

Add import:
```typescript
import { registerApplyRefactorTool } from './apply-refactor.js';
```

Add registration inside `createToolRegistry()`:
```typescript
  registerApplyRefactorTool(registry, ctx);
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/ApplyRefactor.test.ts 2>&1 | tail -10
```
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add src/tools/apply-refactor.ts src/tools/index.ts tests/ApplyRefactor.test.ts
git commit -m "feat: add ctx_apply_refactor — write symbol renames to disk with dry_run support"
```

---

## Task 8: ctx_detect_changes Tool

**Files:**
- Create: `src/tools/detect-changes.ts`
- Create: `tests/DetectChanges.test.ts`
- Modify: `src/tools/index.ts`

Risk-scores each changed file as `critical / high / medium / low` based on importer count, hub status, and test coverage presence.

- [ ] **Step 1: Write failing tests**

Create `tests/DetectChanges.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerDetectChangesTool } from '../src/tools/detect-changes.js';
import type { ServerContext } from '../src/tools/context.js';

function makeCtx(graph: DependencyGraph): ServerContext {
  return {
    projectRoot: '/fake',
    dbPath: '/fake/.ctxloom/vectors.lancedb',
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.resolve(graph),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: () => Promise.reject(new Error('not needed')),
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => true,
    isParserInitialized: () => false,
  };
}

describe('ctx_detect_changes', () => {
  it('returns XML with detect_changes element', async () => {
    const g = new DependencyGraph();
    g.addEdge('src/api.ts', 'src/auth.ts');
    const registry = new ToolRegistry();
    registerDetectChangesTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_detect_changes', {
      changed_files: ['src/auth.ts'],
      use_git: false,
    });
    expect(result).toContain('<detect_changes');
    expect(result).toContain('</detect_changes>');
  });

  it('scores hub file (≥5 importers) with no test as critical', async () => {
    const g = new DependencyGraph();
    for (let i = 0; i < 6; i++) g.addEdge(`src/consumer${i}.ts`, 'src/core.ts');
    const registry = new ToolRegistry();
    registerDetectChangesTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_detect_changes', {
      changed_files: ['src/core.ts'],
      use_git: false,
    });
    expect(result).toContain('risk="critical"');
  });

  it('scores low-importer file with test as low', async () => {
    const g = new DependencyGraph();
    g.addEdge('tests/util.test.ts', 'src/util.ts');
    const registry = new ToolRegistry();
    registerDetectChangesTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_detect_changes', {
      changed_files: ['src/util.ts'],
      use_git: false,
    });
    expect(result).toContain('risk="low"');
  });

  it('includes file path and importer_count in output', async () => {
    const g = new DependencyGraph();
    g.addEdge('src/a.ts', 'src/b.ts');
    g.addEdge('src/c.ts', 'src/b.ts');
    const registry = new ToolRegistry();
    registerDetectChangesTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_detect_changes', {
      changed_files: ['src/b.ts'],
      use_git: false,
    });
    expect(result).toContain('src/b.ts');
    expect(result).toContain('importer_count="2"');
  });

  it('returns empty result for no changed files', async () => {
    const g = new DependencyGraph();
    const registry = new ToolRegistry();
    registerDetectChangesTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_detect_changes', {
      changed_files: [],
      use_git: false,
    });
    expect(result).toContain('count="0"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/DetectChanges.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Create src/tools/detect-changes.ts**

```typescript
/**
 * ctx_detect_changes — Risk-scored analysis of changed files.
 *
 * Each changed file is scored critical/high/medium/low based on:
 *   - importer_count: how many files depend on it
 *   - is_hub: importer_count >= 5
 *   - has_test_coverage: a *.test.* or *.spec.* file exists that
 *     imports this file or matches its path pattern
 */
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import type { DependencyGraph } from '../graph/DependencyGraph.js';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

const Schema = z.object({
  changed_files: z.array(z.string()).optional(),
  use_git: z.boolean().optional().default(true),
  depth: z.number().min(1).max(10).optional().default(3),
});

type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

const TEST_PATTERN = /(\.test\.|\.spec\.|\/tests\/|\/test\/|\/spec\/|__tests__)/;

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hasTestCoverage(filePath: string, graph: DependencyGraph): boolean {
  // Check if any file that imports this file is a test file
  const importers = graph.getImporters(filePath);
  if (importers.some(f => TEST_PATTERN.test(f))) return true;
  // Check if a test file exists with a matching name pattern
  const base = filePath.replace(/\.[^.]+$/, '');
  const allFiles = graph.allFiles();
  return allFiles.some(f => TEST_PATTERN.test(f) && f.includes(base.split('/').pop() ?? ''));
}

function computeRisk(
  filePath: string,
  graph: DependencyGraph,
): { level: RiskLevel; importerCount: number; isHub: boolean; hasCoverage: boolean; reasons: string[] } {
  const isTest = TEST_PATTERN.test(filePath);
  const importerCount = graph.getImporters(filePath).length;
  const isHub = importerCount >= 5;
  const hasCoverage = isTest || hasTestCoverage(filePath, graph);
  const reasons: string[] = [];

  if (isHub) reasons.push(`hub: ${importerCount} dependents`);
  if (!hasCoverage && !isTest) reasons.push('no test coverage');
  if (importerCount > 0 && !isHub) reasons.push(`${importerCount} direct importers`);

  let level: RiskLevel;
  if (isTest) {
    level = 'low';
  } else if (isHub && !hasCoverage) {
    level = 'critical';
  } else if (isHub || (!hasCoverage && importerCount > 2)) {
    level = 'high';
  } else if (importerCount > 0 || !hasCoverage) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { level, importerCount, isHub, hasCoverage, reasons };
}

async function detectChangedFiles(projectRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync('git diff HEAD~1 --name-only', { cwd: projectRoot });
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    logger.warn('git diff failed for detect_changes');
    return [];
  }
}

const RISK_ORDER: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function registerDetectChangesTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_detect_changes',
    {
      name: 'ctx_detect_changes',
      description:
        'Risk-score each changed file as critical/high/medium/low. ' +
        'Risk factors: hub files (≥5 importers), missing test coverage, blast radius size. ' +
        'Results sorted by risk level. Auto-detects changed files from git diff HEAD~1.',
      inputSchema: {
        type: 'object',
        properties: {
          changed_files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Relative paths of changed files. Omit to auto-detect from git.',
          },
          use_git: { type: 'boolean', description: 'Auto-detect from git diff HEAD~1 (default: true)' },
          depth: { type: 'number', description: 'Blast radius traversal depth (default: 3)' },
        },
      },
    },
    async (args) => {
      const { changed_files, use_git } = Schema.parse(args);

      let files = changed_files ?? [];
      if (files.length === 0 && use_git) {
        files = await detectChangedFiles(ctx.projectRoot);
      }

      if (files.length === 0) {
        return '<detect_changes count="0">\n  <!-- No changed files detected -->\n</detect_changes>';
      }

      const graph = await ctx.getGraph();

      const scored = files.map(f => ({ file: f, ...computeRisk(f, graph) }));
      scored.sort((a, b) => RISK_ORDER[a.level] - RISK_ORDER[b.level]);

      const criticalCount = scored.filter(s => s.level === 'critical').length;
      const highCount = scored.filter(s => s.level === 'high').length;

      const xml = [
        `<detect_changes count="${scored.length}" critical="${criticalCount}" high="${highCount}">`,
      ];

      for (const s of scored) {
        xml.push(
          `  <file path="${escapeXML(s.file)}" risk="${s.level}" importer_count="${s.importerCount}" is_hub="${s.isHub}" has_test_coverage="${s.hasCoverage}">`,
        );
        for (const reason of s.reasons) {
          xml.push(`    <reason>${escapeXML(reason)}</reason>`);
        }
        xml.push('  </file>');
      }

      xml.push('</detect_changes>');
      return xml.join('\n');
    },
  );
}
```

- [ ] **Step 4: Register in src/tools/index.ts**

```typescript
import { registerDetectChangesTool } from './detect-changes.js';
// inside createToolRegistry():
registerDetectChangesTool(registry, ctx);
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/DetectChanges.test.ts 2>&1 | tail -10
```
Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add src/tools/detect-changes.ts src/tools/index.ts tests/DetectChanges.test.ts
git commit -m "feat: add ctx_detect_changes — risk-scored change analysis (critical/high/medium/low)"
```

---

## Task 9: ctx_full_text_search Tool

**Files:**
- Create: `src/tools/full-text-search.ts`
- Create: `tests/FullTextSearch.test.ts`
- Modify: `src/tools/index.ts`

Regex scan over all indexed files, merged with optional vector results in hybrid mode.

- [ ] **Step 1: Write failing tests**

Create `tests/FullTextSearch.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerFullTextSearchTool } from '../src/tools/full-text-search.js';
import type { ServerContext } from '../src/tools/context.js';

function makeCtx(graph: DependencyGraph, root: string): ServerContext {
  return {
    projectRoot: root,
    dbPath: path.join(root, '.ctxloom/vectors.lancedb'),
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.resolve(graph),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: () => Promise.reject(new Error('not needed')),
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => true,
    isParserInitialized: () => false,
  };
}

describe('ctx_full_text_search', () => {
  it('returns XML with full_text_search element', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-fts-'));
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'function authenticate() {}');
    const g = new DependencyGraph();
    g.addEdge('a.ts', 'b.ts'); // ensures a.ts is in allFiles()
    // Also add standalone
    const registry = new ToolRegistry();
    registerFullTextSearchTool(registry, makeCtx(g, tmpDir));
    const result = await registry.dispatch('ctx_full_text_search', {
      query: 'authenticate',
      mode: 'keyword',
    });
    expect(result).toContain('<full_text_search');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds files containing the exact query term', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-fts-'));
    fs.writeFileSync(path.join(tmpDir, 'auth.ts'), 'export function authenticate() {}');
    fs.writeFileSync(path.join(tmpDir, 'other.ts'), 'export function unrelated() {}');
    const g = new DependencyGraph();
    g.addEdge('auth.ts', 'other.ts');
    const registry = new ToolRegistry();
    registerFullTextSearchTool(registry, makeCtx(g, tmpDir));
    const result = await registry.dispatch('ctx_full_text_search', {
      query: 'authenticate',
      mode: 'keyword',
    });
    expect(result).toContain('auth.ts');
    expect(result).not.toContain('"other.ts"');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty result when nothing matches', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-fts-'));
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'export const x = 1;');
    const g = new DependencyGraph();
    g.addEdge('a.ts', 'b.ts');
    const registry = new ToolRegistry();
    registerFullTextSearchTool(registry, makeCtx(g, tmpDir));
    const result = await registry.dispatch('ctx_full_text_search', {
      query: 'zzzNOTFOUNDzzz',
      mode: 'keyword',
    });
    expect(result).toContain('count="0"');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('respects case_sensitive=true', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-fts-'));
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'export function MyFunc() {}');
    const g = new DependencyGraph();
    g.addEdge('a.ts', 'b.ts');
    const registry = new ToolRegistry();
    registerFullTextSearchTool(registry, makeCtx(g, tmpDir));
    const sensitive = await registry.dispatch('ctx_full_text_search', {
      query: 'myfunc',
      mode: 'keyword',
      case_sensitive: true,
    });
    expect(sensitive).toContain('count="0"');
    const insensitive = await registry.dispatch('ctx_full_text_search', {
      query: 'myfunc',
      mode: 'keyword',
      case_sensitive: false,
    });
    expect(insensitive).toContain('a.ts');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/FullTextSearch.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Create src/tools/full-text-search.ts**

```typescript
/**
 * ctx_full_text_search — Regex/keyword scan over all indexed files.
 *
 * Modes:
 *   keyword  — regex scan only
 *   semantic — vector search only (delegates to existing ctx_search logic)
 *   hybrid   — keyword scan + vector search merged by score
 *
 * Regex: query is treated as a literal string unless it is wrapped in /…/
 * (e.g. /auth\w+/ is a raw regex, "authenticate" is a literal).
 */
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';

const Schema = z.object({
  query: z.string().min(1).describe('Search term — literal or /regex/'),
  mode: z.enum(['hybrid', 'keyword', 'semantic']).optional().default('hybrid').describe(
    'hybrid = keyword + vector; keyword = regex scan only; semantic = vector only',
  ),
  case_sensitive: z.boolean().optional().default(false),
  limit: z.number().min(1).max(100).optional().default(20),
  context_lines: z.number().min(0).max(5).optional().default(1).describe(
    'Lines of context around each match (default: 1)',
  ),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildPattern(query: string, caseSensitive: boolean): RegExp | null {
  const flags = caseSensitive ? 'g' : 'gi';
  if (query.startsWith('/') && query.endsWith('/') && query.length > 2) {
    try {
      return new RegExp(query.slice(1, -1), flags);
    } catch {
      return null;
    }
  }
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
}

interface KeywordResult {
  filePath: string;
  matchCount: number;
  snippets: string[];
}

function scanFile(
  absPath: string,
  pattern: RegExp,
  contextLines: number,
): KeywordResult | null {
  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }

  const lines = content.split('\n');
  const snippets: string[] = [];
  let matchCount = 0;

  for (let i = 0; i < lines.length; i++) {
    pattern.lastIndex = 0;
    if (pattern.test(lines[i])) {
      matchCount++;
      if (snippets.length < 3) {
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length - 1, i + contextLines);
        snippets.push(
          lines
            .slice(start, end + 1)
            .map((l, idx) => `${start + idx + 1}: ${l}`)
            .join('\n'),
        );
      }
    }
  }

  return matchCount > 0 ? { filePath: '', matchCount, snippets } : null;
}

export function registerFullTextSearchTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_full_text_search',
    {
      name: 'ctx_full_text_search',
      description:
        'Keyword/regex search over the full codebase with optional hybrid vector merge. ' +
        'Finds exact identifier matches that semantic search misses. ' +
        'Modes: keyword (fast regex), semantic (vector), hybrid (both merged).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or /regex/' },
          mode: { type: 'string', enum: ['hybrid', 'keyword', 'semantic'], description: 'Search mode (default: hybrid)' },
          case_sensitive: { type: 'boolean', description: 'Case-sensitive match (default: false)' },
          limit: { type: 'number', description: 'Max results (default: 20)' },
          context_lines: { type: 'number', description: 'Context lines around each match (default: 1)' },
        },
        required: ['query'],
      },
    },
    async (args) => {
      const { query, mode, case_sensitive, limit, context_lines } = Schema.parse(args);

      if (mode === 'semantic') {
        // Delegate to vector store
        try {
          const { generateEmbedding } = await import('../indexer/embedder.js');
          const store = await ctx.getStore();
          const embedding = await generateEmbedding(query);
          const results = await store.search(embedding, limit);
          const xml = [`<full_text_search query="${escapeXML(query)}" mode="semantic" count="${results.length}">`];
          for (const r of results) {
            xml.push(`  <result file="${escapeXML(r.filePath)}" score="${r.score.toFixed(4)}" matches="0"/>`);
          }
          xml.push('</full_text_search>');
          return xml.join('\n');
        } catch {
          return `<full_text_search query="${escapeXML(query)}" mode="semantic" count="0"/>`;
        }
      }

      const pattern = buildPattern(query, case_sensitive);
      if (!pattern) {
        return `<error>Invalid regex: ${escapeXML(query)}</error>`;
      }

      const graph = await ctx.getGraph();
      const files = graph.allFiles();

      const keywordResults: Array<{ filePath: string; score: number; matchCount: number; snippets: string[] }> = [];

      for (const relPath of files) {
        const absPath = path.join(ctx.projectRoot, relPath);
        const hit = scanFile(absPath, pattern, context_lines);
        if (hit) {
          keywordResults.push({
            filePath: relPath,
            score: 1 / hit.matchCount, // more matches = lower score = higher rank
            matchCount: hit.matchCount,
            snippets: hit.snippets,
          });
        }
      }

      keywordResults.sort((a, b) => a.score - b.score);
      let merged = keywordResults.slice(0, limit);

      if (mode === 'hybrid') {
        try {
          const { generateEmbedding } = await import('../indexer/embedder.js');
          const store = await ctx.getStore();
          const embedding = await generateEmbedding(query);
          const vectorResults = await store.search(embedding, Math.ceil(limit / 2));
          const seen = new Set(merged.map(r => r.filePath));
          for (const vr of vectorResults) {
            if (!seen.has(vr.filePath)) {
              merged.push({ filePath: vr.filePath, score: vr.score + 2, matchCount: 0, snippets: [] });
              seen.add(vr.filePath);
            }
          }
          merged.sort((a, b) => a.score - b.score);
          merged = merged.slice(0, limit);
        } catch {
          // vector store unavailable — keyword results only
        }
      }

      const xml = [
        `<full_text_search query="${escapeXML(query)}" mode="${mode}" case_sensitive="${case_sensitive}" count="${merged.length}">`,
      ];
      for (const r of merged) {
        xml.push(`  <result file="${escapeXML(r.filePath)}" matches="${r.matchCount}">`);
        for (const snippet of r.snippets) {
          xml.push(`    <match><![CDATA[${snippet}]]></match>`);
        }
        xml.push('  </result>');
      }
      xml.push('</full_text_search>');
      return xml.join('\n');
    },
  );
}
```

- [ ] **Step 4: Register in src/tools/index.ts**

```typescript
import { registerFullTextSearchTool } from './full-text-search.js';
// inside createToolRegistry():
registerFullTextSearchTool(registry, ctx);
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/FullTextSearch.test.ts 2>&1 | tail -10
```
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add src/tools/full-text-search.ts src/tools/index.ts tests/FullTextSearch.test.ts
git commit -m "feat: add ctx_full_text_search — hybrid keyword+vector search with regex and context lines"
```

---

## Task 10: ctx_suggested_questions Tool

**Files:**
- Create: `src/tools/suggested-questions.ts`
- Create: `tests/SuggestedQuestions.test.ts`
- Modify: `src/tools/index.ts`

Generates structural review questions from graph analysis — no LLM needed.

- [ ] **Step 1: Write failing tests**

Create `tests/SuggestedQuestions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerSuggestedQuestionsTool } from '../src/tools/suggested-questions.js';
import type { ServerContext } from '../src/tools/context.js';

function makeCtx(graph: DependencyGraph): ServerContext {
  return {
    projectRoot: '/fake',
    dbPath: '/fake/.ctxloom/vectors.lancedb',
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.resolve(graph),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: () => Promise.reject(new Error('not needed')),
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => true,
    isParserInitialized: () => false,
  };
}

describe('ctx_suggested_questions', () => {
  it('returns XML with suggested_questions element', async () => {
    const g = new DependencyGraph();
    g.addEdge('src/a.ts', 'src/b.ts');
    const registry = new ToolRegistry();
    registerSuggestedQuestionsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_suggested_questions', {
      changed_files: ['src/b.ts'],
      use_git: false,
    });
    expect(result).toContain('<suggested_questions');
    expect(result).toContain('</suggested_questions>');
  });

  it('asks about dependents when blast radius is non-trivial', async () => {
    const g = new DependencyGraph();
    for (let i = 0; i < 4; i++) g.addEdge(`src/consumer${i}.ts`, 'src/core.ts');
    const registry = new ToolRegistry();
    registerSuggestedQuestionsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_suggested_questions', {
      changed_files: ['src/core.ts'],
      use_git: false,
    });
    expect(result).toMatch(/importer|dependent|depend/i);
  });

  it('asks about test coverage when no tests exist', async () => {
    const g = new DependencyGraph();
    g.addEdge('src/a.ts', 'src/util.ts');
    const registry = new ToolRegistry();
    registerSuggestedQuestionsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_suggested_questions', {
      changed_files: ['src/util.ts'],
      use_git: false,
    });
    expect(result).toMatch(/test|coverage/i);
  });

  it('flags hub files as high-risk', async () => {
    const g = new DependencyGraph();
    for (let i = 0; i < 6; i++) g.addEdge(`src/consumer${i}.ts`, 'src/hub.ts');
    const registry = new ToolRegistry();
    registerSuggestedQuestionsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_suggested_questions', {
      changed_files: ['src/hub.ts'],
      use_git: false,
    });
    expect(result).toMatch(/hub|high.risk|6 files/i);
  });

  it('returns at least one question for any changed file', async () => {
    const g = new DependencyGraph();
    g.addEdge('src/a.ts', 'src/b.ts');
    const registry = new ToolRegistry();
    registerSuggestedQuestionsTool(registry, makeCtx(g));
    const result = await registry.dispatch('ctx_suggested_questions', {
      changed_files: ['src/a.ts'],
      use_git: false,
    });
    expect(result).toContain('<question');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/SuggestedQuestions.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Create src/tools/suggested-questions.ts**

```typescript
/**
 * ctx_suggested_questions — Auto-generate structural code review questions.
 *
 * Questions are derived purely from graph analysis (no LLM):
 *   1. Blast radius: are dependent files covered?
 *   2. Test coverage: is there a test file for this change?
 *   3. Hub risk: is this a highly-connected file?
 *   4. Cross-module spread: does this touch multiple top-level directories?
 *   5. Symbol changes: were exported symbols added/removed?
 */
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

const Schema = z.object({
  changed_files: z.array(z.string()).optional(),
  use_git: z.boolean().optional().default(true),
});

const TEST_PATTERN = /(\.test\.|\.spec\.|\/tests\/|\/test\/|\/spec\/|__tests__)/;

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function detectChangedFiles(projectRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync('git diff HEAD~1 --name-only', { cwd: projectRoot });
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    logger.warn('git diff failed for suggested_questions');
    return [];
  }
}

export function registerSuggestedQuestionsTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_suggested_questions',
    {
      name: 'ctx_suggested_questions',
      description:
        'Generate structural code review questions from graph analysis. ' +
        'No LLM required — questions are based on blast radius, test coverage, hub status, ' +
        'and cross-module spread. Designed to be included in a review prompt.',
      inputSchema: {
        type: 'object',
        properties: {
          changed_files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Changed file paths. Omit to auto-detect from git.',
          },
          use_git: { type: 'boolean', description: 'Auto-detect from git diff HEAD~1 (default: true)' },
        },
      },
    },
    async (args) => {
      const { changed_files, use_git } = Schema.parse(args);

      let files = changed_files ?? [];
      if (files.length === 0 && use_git) {
        files = await detectChangedFiles(ctx.projectRoot);
      }

      if (files.length === 0) {
        return '<suggested_questions count="0"><question>No changed files detected. Are you on a git branch with commits?</question></suggested_questions>';
      }

      const graph = await ctx.getGraph();
      const questions: string[] = [];

      // ── Per-file analysis ──────────────────────────────────────────────
      const allImporters = new Set<string>();
      const hubFiles: string[] = [];
      const untestedFiles: string[] = [];
      const topLevelDirs = new Set<string>();

      for (const file of files) {
        if (TEST_PATTERN.test(file)) continue;

        const importers = graph.getImporters(file);
        importers.forEach(f => allImporters.add(f));

        const isHub = importers.length >= 5;
        if (isHub) hubFiles.push(`${file} (${importers.length} dependents)`);

        const hasTest = importers.some(f => TEST_PATTERN.test(f))
          || graph.allFiles().some(f => TEST_PATTERN.test(f) && f.includes(file.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''));
        if (!hasTest) untestedFiles.push(file);

        const topDir = file.split('/')[0];
        if (topDir) topLevelDirs.add(topDir);
      }

      // ── Generate questions ────────────────────────────────────────────

      if (allImporters.size > 0) {
        questions.push(
          `${allImporters.size} file(s) depend on this change directly or transitively. Have they been reviewed for breakage?`,
        );
      }

      if (hubFiles.length > 0) {
        questions.push(
          `High-risk: ${hubFiles.join(', ')} ${hubFiles.length === 1 ? 'is a hub file' : 'are hub files'} with many dependents. Is the change backward-compatible?`,
        );
      }

      if (untestedFiles.length > 0) {
        questions.push(
          `No test file detected for: ${untestedFiles.slice(0, 3).join(', ')}. Should test coverage be added or updated?`,
        );
      }

      if (topLevelDirs.size > 1) {
        questions.push(
          `This change spans ${topLevelDirs.size} top-level directories (${Array.from(topLevelDirs).join(', ')}). Is the coupling intentional?`,
        );
      }

      // Always include a generic completeness check
      questions.push(
        `Does the change include updates to documentation, changelogs, or dependent package versions if the public API changed?`,
      );

      const xml = [`<suggested_questions count="${questions.length}" changed_files="${files.length}">`];
      for (const q of questions) {
        xml.push(`  <question>${escapeXML(q)}</question>`);
      }
      xml.push('</suggested_questions>');
      return xml.join('\n');
    },
  );
}
```

- [ ] **Step 4: Register in src/tools/index.ts**

```typescript
import { registerSuggestedQuestionsTool } from './suggested-questions.js';
// inside createToolRegistry():
registerSuggestedQuestionsTool(registry, ctx);
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/SuggestedQuestions.test.ts 2>&1 | tail -10
```
Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add src/tools/suggested-questions.ts src/tools/index.ts tests/SuggestedQuestions.test.ts
git commit -m "feat: add ctx_suggested_questions — graph-driven code review questions, no LLM required"
```

---

## Task 11: ctx_get_workflow Tool

**Files:**
- Create: `src/tools/get-workflow.ts`
- Create: `tests/GetWorkflow.test.ts`
- Modify: `src/tools/index.ts`

Returns pre-written workflow guidance for 5 common scenarios. No LLM, no graph — pure static content.

- [ ] **Step 1: Write failing tests**

Create `tests/GetWorkflow.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.js';
import { registerGetWorkflowTool } from '../src/tools/get-workflow.js';
import type { ServerContext } from '../src/tools/context.js';

function makeCtx(): ServerContext {
  return {
    projectRoot: '/fake',
    dbPath: '/fake/.ctxloom/vectors.lancedb',
    getStore: () => Promise.reject(new Error('not needed')),
    getGraph: () => Promise.reject(new Error('not needed')),
    getParser: () => Promise.reject(new Error('not needed')),
    getSkeletonizer: () => Promise.reject(new Error('not needed')),
    getRuleManager: () => { throw new Error('not needed'); },
    getPathValidator: () => { throw new Error('not needed'); },
    isStoreInitialized: () => false,
    isGraphInitialized: () => false,
    isParserInitialized: () => false,
  };
}

describe('ctx_get_workflow', () => {
  it('returns XML workflow element', async () => {
    const registry = new ToolRegistry();
    registerGetWorkflowTool(registry, makeCtx());
    const result = await registry.dispatch('ctx_get_workflow', { workflow: 'review' });
    expect(result).toContain('<workflow');
    expect(result).toContain('</workflow>');
  });

  it('returns review workflow with tool references', async () => {
    const registry = new ToolRegistry();
    registerGetWorkflowTool(registry, makeCtx());
    const result = await registry.dispatch('ctx_get_workflow', { workflow: 'review' });
    expect(result).toContain('ctx_git_diff_review');
    expect(result).toContain('ctx_detect_changes');
  });

  it('returns onboard workflow with search steps', async () => {
    const registry = new ToolRegistry();
    registerGetWorkflowTool(registry, makeCtx());
    const result = await registry.dispatch('ctx_get_workflow', { workflow: 'onboard' });
    expect(result).toContain('ctx_architecture_overview');
  });

  it('returns refactor workflow with preview and apply steps', async () => {
    const registry = new ToolRegistry();
    registerGetWorkflowTool(registry, makeCtx());
    const result = await registry.dispatch('ctx_get_workflow', { workflow: 'refactor' });
    expect(result).toContain('ctx_refactor_preview');
    expect(result).toContain('ctx_apply_refactor');
  });

  it('returns all 5 workflows without error', async () => {
    const registry = new ToolRegistry();
    registerGetWorkflowTool(registry, makeCtx());
    for (const w of ['review', 'debug', 'onboard', 'refactor', 'audit'] as const) {
      const result = await registry.dispatch('ctx_get_workflow', { workflow: w });
      expect(result).toContain('<workflow');
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/GetWorkflow.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Create src/tools/get-workflow.ts**

```typescript
/**
 * ctx_get_workflow — Pre-written workflow templates for common AI-assisted tasks.
 *
 * Returns a structured XML template with ordered steps referencing ctxloom tools.
 * Workflows: review, debug, onboard, refactor, audit.
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';

const Schema = z.object({
  workflow: z.enum(['review', 'debug', 'onboard', 'refactor', 'audit']).describe(
    'Workflow template to return',
  ),
});

const WORKFLOWS: Record<string, string> = {
  review: `<workflow name="review" title="Code Review Workflow">
  <description>Complete code review using graph-aware tools. Run these steps in order.</description>
  <step order="1" tool="ctx_detect_changes">
    Risk-score all changed files. Address critical and high items first.
    Call with: use_git=true
  </step>
  <step order="2" tool="ctx_git_diff_review">
    Get the full review packet: diffs, API skeletons, blast radius.
    Call with: use_git=true, include_skeletons=true, depth=3
  </step>
  <step order="3" tool="ctx_suggested_questions">
    Get graph-derived review questions to guide the review.
    Call with: use_git=true
  </step>
  <step order="4" tool="ctx_blast_radius">
    Verify transitive impact. Review any critical transitive importers.
    Call with: use_git=true, depth=5
  </step>
  <step order="5" tool="ctx_knowledge_gaps">
    Check for untested hubs introduced or worsened by the change.
  </step>
</workflow>`,

  debug: `<workflow name="debug" title="Debugging Workflow">
  <description>Trace a bug from symptom to root cause using call-graph and dependency tools.</description>
  <step order="1" tool="ctx_search">
    Find files related to the symptom using semantic search.
    Example: ctx_search(query="authentication failure 401")
  </step>
  <step order="2" tool="ctx_definition">
    Locate the definition of the failing function/class.
    Example: ctx_definition(symbol="verifyToken")
  </step>
  <step order="3" tool="ctx_call_graph">
    Trace callers of the suspected function to find the entry point.
    Example: ctx_call_graph(symbol="verifyToken", direction="callers")
  </step>
  <step order="4" tool="ctx_execution_flow">
    Walk the full execution path from entry point to the failure site.
    Example: ctx_execution_flow(entry="handleRequest", entry_file="src/server.ts")
  </step>
  <step order="5" tool="ctx_blast_radius">
    Understand what else could be affected by fixing the bug.
  </step>
</workflow>`,

  onboard: `<workflow name="onboard" title="Codebase Onboarding Workflow">
  <description>Get up to speed on an unfamiliar codebase in 5 steps.</description>
  <step order="1" tool="ctx_architecture_overview">
    Get the high-level module map, hub files, and community structure.
  </step>
  <step order="2" tool="ctx_community_list">
    Understand the main subsystems (communities) and their key files.
  </step>
  <step order="3" tool="ctx_hub_nodes">
    Identify the most-imported files — these are the architectural load-bearers.
  </step>
  <step order="4" tool="ctx_search">
    Search for the area you'll be working in.
    Example: ctx_search(query="user authentication flow")
  </step>
  <step order="5" tool="ctx_context_packet">
    Get a full context packet (file + importers + importees + skeleton) for your entry-point file.
  </step>
</workflow>`,

  refactor: `<workflow name="refactor" title="Safe Refactoring Workflow">
  <description>Rename or restructure a symbol safely using graph-aware tools.</description>
  <step order="1" tool="ctx_definition">
    Confirm the exact symbol name and its definition locations.
    Example: ctx_definition(symbol="OldClassName")
  </step>
  <step order="2" tool="ctx_blast_radius">
    See the full impact of changing this symbol.
  </step>
  <step order="3" tool="ctx_refactor_preview">
    Preview all changes before touching the disk.
    Example: ctx_refactor_preview(symbol="OldClassName", new_name="NewClassName")
  </step>
  <step order="4" tool="ctx_apply_refactor">
    Apply the rename. Review the XML output for missed files.
    Example: ctx_apply_refactor(symbol="OldClassName", new_name="NewClassName")
  </step>
  <step order="5">
    Run your test suite and build to verify no regressions.
    Command: npm test &amp;&amp; npm run build
  </step>
</workflow>`,

  audit: `<workflow name="audit" title="Code Health Audit Workflow">
  <description>Assess architectural health, dead code, and missing coverage.</description>
  <step order="1" tool="ctx_knowledge_gaps">
    Find isolated files, untested hubs, and dead-code candidates.
    Call with: min_importers=3, limit=30
  </step>
  <step order="2" tool="ctx_hub_nodes">
    List the highest-centrality files. Verify each has test coverage.
    Call with: limit=20
  </step>
  <step order="3" tool="ctx_bridge_nodes">
    Find architectural bridges — files whose removal would disconnect modules.
  </step>
  <step order="4" tool="ctx_surprising_connections">
    Uncover unexpected cross-module couplings that indicate design debt.
  </step>
  <step order="5" tool="ctx_wiki_generate">
    Generate a full Markdown wiki to document the current architecture.
  </step>
</workflow>`,
};

export function registerGetWorkflowTool(registry: ToolRegistry, _ctx: ServerContext): void {
  registry.register(
    'ctx_get_workflow',
    {
      name: 'ctx_get_workflow',
      description:
        'Return a step-by-step workflow template for common AI-assisted development tasks. ' +
        'Workflows: review (code review), debug (bug tracing), onboard (new codebase), ' +
        'refactor (safe renames), audit (code health). Each workflow lists ctxloom tools in order.',
      inputSchema: {
        type: 'object',
        properties: {
          workflow: {
            type: 'string',
            enum: ['review', 'debug', 'onboard', 'refactor', 'audit'],
            description: 'Which workflow to return',
          },
        },
        required: ['workflow'],
      },
    },
    async (args) => {
      const { workflow } = Schema.parse(args);
      return WORKFLOWS[workflow] ?? `<error>Unknown workflow: ${workflow}</error>`;
    },
  );
}
```

- [ ] **Step 4: Register in src/tools/index.ts**

```typescript
import { registerGetWorkflowTool } from './get-workflow.js';
// inside createToolRegistry():
registerGetWorkflowTool(registry, ctx);
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/GetWorkflow.test.ts 2>&1 | tail -10
```
Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add src/tools/get-workflow.ts src/tools/index.ts tests/GetWorkflow.test.ts
git commit -m "feat: add ctx_get_workflow — 5 pre-written workflow templates (review/debug/onboard/refactor/audit)"
```

---

## Task 12: Benchmark on Named Public Repos

**Files:**
- Create: `benchmarks/benchmark-public-repos.ts`
- Modify: `benchmarks/README.md`

Runs ctxloom indexing and compression metrics against well-known open-source repos to produce credible, comparable benchmark numbers.

- [ ] **Step 1: Create benchmarks/benchmark-public-repos.ts**

```typescript
#!/usr/bin/env tsx
/**
 * benchmark-public-repos.ts — Index named public repos and report metrics.
 *
 * Repos benchmarked (chosen for variety of size and language):
 *   - expressjs/express      (Node.js web framework, ~200 JS files)
 *   - fastify/fastify        (Node.js, ~300 JS/TS files)
 *   - sindresorhus/got       (TypeScript HTTP client, ~100 TS files)
 *   - pallets/flask          (Python web framework, ~100 PY files)
 *   - nickel-org/rocket      (Rust web framework, ~200 RS files)
 *
 * Usage:
 *   npx tsx benchmarks/benchmark-public-repos.ts
 *
 * Requires: git, internet access, ~500MB disk in /tmp
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const REPOS = [
  { name: 'expressjs/express',   url: 'https://github.com/expressjs/express.git',   lang: 'js' },
  { name: 'fastify/fastify',     url: 'https://github.com/fastify/fastify.git',     lang: 'js' },
  { name: 'sindresorhus/got',    url: 'https://github.com/sindresorhus/got.git',    lang: 'ts' },
  { name: 'pallets/flask',       url: 'https://github.com/pallets/flask.git',       lang: 'py' },
  { name: 'SergioBenitez/Rocket', url: 'https://github.com/SergioBenitez/Rocket.git', lang: 'rs' },
] as const;

const WORK_DIR = path.join(os.tmpdir(), 'ctxloom-bench-repos');
fs.mkdirSync(WORK_DIR, { recursive: true });

interface RepoResult {
  name: string;
  lang: string;
  files: number;
  indexTimeMs: number;
  graphEdges: number;
  rawChars: number;
  skeletonChars: number;
  reductionPct: number;
}

async function cloneRepo(name: string, url: string): Promise<string> {
  const dir = path.join(WORK_DIR, name.replace('/', '__'));
  if (!fs.existsSync(dir)) {
    console.log(`  Cloning ${name}...`);
    execSync(`git clone --depth=1 ${url} ${dir}`, { stdio: 'pipe' });
  } else {
    console.log(`  Using cached ${name}`);
  }
  return dir;
}

function countSourceFiles(dir: string, ext: string[]): string[] {
  const result: string[] = [];
  const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', 'target', '.ctxloom']);
  function walk(d: string): void {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED.has(entry.name)) walk(path.join(d, entry.name));
      } else if (ext.some(e => entry.name.endsWith(e))) {
        result.push(path.join(d, entry.name));
      }
    }
  }
  walk(dir);
  return result;
}

const EXT_MAP: Record<string, string[]> = {
  js: ['.js', '.mjs', '.cjs'],
  ts: ['.ts', '.tsx'],
  py: ['.py'],
  rs: ['.rs'],
};

async function benchmarkRepo(name: string, url: string, lang: string): Promise<RepoResult> {
  console.log(`\n── ${name} ──`);
  const dir = await cloneRepo(name, url);
  const exts = EXT_MAP[lang] ?? ['.ts'];
  const files = countSourceFiles(dir, exts);

  console.log(`  ${files.length} ${lang} files found`);

  // Index
  const t0 = Date.now();
  const { DependencyGraph } = await import('../src/graph/DependencyGraph.js');
  const { ASTParser } = await import('../src/ast/ASTParser.js');
  const parser = new ASTParser();
  await parser.init();
  const graph = new DependencyGraph();
  graph.setParser(parser);
  await graph.buildFromDirectory(dir);
  const indexTimeMs = Date.now() - t0;

  console.log(`  Indexed in ${indexTimeMs}ms, ${graph.edgeCount()} edges`);

  // Compression sample (5 files)
  const { Skeletonizer } = await import('../src/ast/Skeletonizer.js');
  const sk = new Skeletonizer();
  await sk.init();

  const step = Math.max(1, Math.floor(files.length / 5));
  const sampled = files.filter((_, i) => i % step === 0).slice(0, 5);

  let rawTotal = 0;
  let skeletonTotal = 0;

  for (const f of sampled) {
    const raw = fs.readFileSync(f, 'utf-8');
    rawTotal += raw.length;
    try {
      const skeleton = await sk.skeletonize(f);
      skeletonTotal += skeleton.length;
    } catch {
      skeletonTotal += raw.length; // fallback: no reduction
    }
  }

  const reductionPct = rawTotal > 0
    ? Math.round((1 - skeletonTotal / rawTotal) * 100)
    : 0;

  return {
    name,
    lang,
    files: files.length,
    indexTimeMs,
    graphEdges: graph.edgeCount(),
    rawChars: rawTotal,
    skeletonChars: skeletonTotal,
    reductionPct,
  };
}

async function main(): Promise<void> {
  console.log('ctxloom Public Repo Benchmark');
  console.log('================================\n');

  const results: RepoResult[] = [];
  for (const { name, url, lang } of REPOS) {
    try {
      results.push(await benchmarkRepo(name, url, lang));
    } catch (err) {
      console.error(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\n\n── Results Table ──────────────────────────────────────────────────────');
  console.log('Repo                          Lang  Files  IndexMs  Edges  Reduction');
  console.log('─────────────────────────────────────────────────────────────────────');
  for (const r of results) {
    const row = [
      r.name.padEnd(30),
      r.lang.padEnd(6),
      String(r.files).padEnd(7),
      String(r.indexTimeMs).padEnd(9),
      String(r.graphEdges).padEnd(7),
      `${r.reductionPct}%`,
    ].join(' ');
    console.log(row);
  }

  // Write JSON for CI
  const outPath = path.join(process.cwd(), 'benchmarks', 'public-repos-results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script for public repo benchmark**

In `package.json`, add to the `"scripts"` section:
```json
"bench:repos": "tsx benchmarks/benchmark-public-repos.ts"
```

- [ ] **Step 3: Run a smoke test (single repo)**

Edit `REPOS` temporarily to only include `sindresorhus/got` (smallest), then run:
```bash
npm run bench:repos 2>&1 | tail -20
```
Expected: table row with files count, index time, and reduction percentage.

Restore all 5 repos in the `REPOS` array after verifying.

- [ ] **Step 4: Update benchmarks/README.md**

Add a new section after the existing content:

```markdown
## Public Repo Benchmark

Benchmark ctxloom against well-known open-source repos:

```bash
npm run bench:repos
```

Repos benchmarked:
| Repo | Language | Purpose |
|------|----------|---------|
| expressjs/express | JavaScript | Web framework |
| fastify/fastify | JavaScript | Web framework |
| sindresorhus/got | TypeScript | HTTP client |
| pallets/flask | Python | Web framework |
| SergioBenitez/Rocket | Rust | Web framework |

Results are saved to `benchmarks/public-repos-results.json` for CI comparison.
```

- [ ] **Step 5: Commit**

```bash
git add benchmarks/benchmark-public-repos.ts benchmarks/README.md package.json
git commit -m "feat: add public-repo benchmark script — index and compress 5 named open-source repos"
```

---

## Final: Full Test Suite + Build

- [ ] **Step 1: Run all tests**

```bash
npm test 2>&1 | tail -20
```
Expected: all existing tests still pass + new tests added.

- [ ] **Step 2: Run build**

```bash
npm run build 2>&1 | tail -10
```
Expected: no TypeScript errors.

- [ ] **Step 3: Update tool count in README.md**

Find the line in `README.md` that says `22 tools` and update to `27 tools` (22 + apply_refactor + detect_changes + full_text_search + suggested_questions + get_workflow).

- [ ] **Step 4: Final commit**

```bash
git add README.md
git commit -m "docs: update tool count to 27 — all 8 competitive gaps implemented"
```

---

## Self-Review

**Spec coverage check:**
1. ✅ C# language support — Tasks 1+2
2. ✅ Ruby language support — Task 3
3. ✅ Kotlin language support — Task 4
4. ✅ Swift language support — Task 5
5. ✅ SVG graph export — Task 6
6. ✅ ctx_apply_refactor — Task 7
7. ✅ ctx_detect_changes — Task 8
8. ✅ ctx_full_text_search — Task 9
9. ✅ ctx_suggested_questions — Task 10
10. ✅ ctx_get_workflow — Task 11
11. ✅ Benchmark on named public repos — Task 12

**Type consistency:**
- `registerApplyRefactorTool` used in task 7 tests ✅
- `registerDetectChangesTool` used in task 8 tests ✅
- `registerFullTextSearchTool` used in task 9 tests ✅
- `registerSuggestedQuestionsTool` used in task 10 tests ✅
- `registerGetWorkflowTool` used in task 11 tests ✅
- `GraphExporter.toSVG()` and `ExportFormat` updated consistently ✅
- `GrammarEntry.downloadUrl?` added to interface and used in loader ✅

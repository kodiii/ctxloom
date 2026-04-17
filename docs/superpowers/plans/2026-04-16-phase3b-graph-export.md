# Phase 3b — ctx_graph_export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ctx_graph_export` — a tool that exports the import graph to GraphML (Gephi/yEd), DOT (Graphviz), or Obsidian wikilink format, written to `.ctxloom/export/`.

**Architecture:** A `GraphExporter` class (new file) holds the three format methods. It writes output to `.ctxloom/export/graph.graphml`, `.ctxloom/export/graph.dot`, or `.ctxloom/export/obsidian/<slug>.md` per node. The MCP tool wraps `GraphExporter.export()` and returns a one-line XML result. No new npm dependencies — pure string serialization.

**Tech Stack:** TypeScript/ESM, `node:fs`, vitest. No new npm dependencies.

---

## File Map

### Created
| File | Responsibility |
|------|---------------|
| `src/graph/GraphExporter.ts` | `toGraphML()`, `toDOT()`, `export()` including Obsidian multi-file write |
| `src/tools/graph-export.ts` | `ctx_graph_export` MCP tool |
| `tests/GraphExporter.test.ts` | Unit + integration tests for GraphExporter |

### Modified
| File | What changes |
|------|-------------|
| `src/tools/index.ts` | Import and register `registerGraphExportTool` |
| `src/index.ts` | Add `ctx_graph_export` to `--help` Tools Exposed section |

---

## Task 1 — GraphExporter Class

**Files:**
- Create: `src/graph/GraphExporter.ts`
- Create: `tests/GraphExporter.test.ts`

- [ ] **Step 1.1: Write failing GraphExporter tests**

Create `tests/GraphExporter.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { GraphExporter } from '../src/graph/GraphExporter.js';

function makeGraph(): DependencyGraph {
  const g = new DependencyGraph();
  g.addEdge('src/auth/user.ts', 'src/auth/session.ts');
  g.addEdge('src/auth/user.ts', 'src/auth/token.ts');
  g.addEdge('src/api/handler.ts', 'src/auth/user.ts');
  return g;
}

describe('GraphExporter — toGraphML()', () => {
  it('returns valid GraphML string', () => {
    const exporter = new GraphExporter(makeGraph(), '/fake');
    const xml = exporter.toGraphML();
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<graphml');
    expect(xml).toContain('<graph id="G" edgedefault="directed">');
    expect(xml).toContain('</graphml>');
  });

  it('includes a node entry for every file', () => {
    const graph = makeGraph();
    const exporter = new GraphExporter(graph, '/fake');
    const xml = exporter.toGraphML();
    for (const file of graph.allFiles()) {
      expect(xml).toContain(`id="${file}"`);
    }
  });

  it('includes an edge for every import', () => {
    const exporter = new GraphExporter(makeGraph(), '/fake');
    const xml = exporter.toGraphML();
    expect(xml).toContain('source="src/auth/user.ts"');
    expect(xml).toContain('target="src/auth/session.ts"');
  });

  it('returns empty graph element for empty graph', () => {
    const exporter = new GraphExporter(new DependencyGraph(), '/fake');
    const xml = exporter.toGraphML();
    expect(xml).toContain('<graph id="G" edgedefault="directed">');
    expect(xml).toContain('</graph>');
  });
});

describe('GraphExporter — toDOT()', () => {
  it('returns valid DOT string', () => {
    const exporter = new GraphExporter(makeGraph(), '/fake');
    const dot = exporter.toDOT();
    expect(dot).toContain('digraph G {');
    expect(dot.trim()).toMatch(/\}$/);
  });

  it('includes all nodes', () => {
    const graph = makeGraph();
    const exporter = new GraphExporter(graph, '/fake');
    const dot = exporter.toDOT();
    for (const file of graph.allFiles()) {
      expect(dot).toContain(`"${file}"`);
    }
  });

  it('includes directed edges', () => {
    const exporter = new GraphExporter(makeGraph(), '/fake');
    const dot = exporter.toDOT();
    expect(dot).toContain('"src/auth/user.ts" -> "src/auth/session.ts"');
  });
});

describe('GraphExporter — export()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-export-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('graphml: writes graph.graphml and returns correct metadata', () => {
    const graph = makeGraph();
    const exporter = new GraphExporter(graph, tmpDir);
    const result = exporter.export('graphml');
    expect(result.format).toBe('graphml');
    expect(result.outputPath).toBe(path.join(tmpDir, '.ctxloom', 'export', 'graph.graphml'));
    expect(fs.existsSync(result.outputPath)).toBe(true);
    expect(result.nodeCount).toBe(graph.allFiles().length);
    expect(result.edgeCount).toBe(graph.edgeCount());
  });

  it('graphml: file content is valid GraphML', () => {
    const exporter = new GraphExporter(makeGraph(), tmpDir);
    exporter.export('graphml');
    const content = fs.readFileSync(path.join(tmpDir, '.ctxloom', 'export', 'graph.graphml'), 'utf-8');
    expect(content).toContain('<graphml');
    expect(content).toContain('src/auth/user.ts');
  });

  it('dot: writes graph.dot and returns correct metadata', () => {
    const graph = makeGraph();
    const exporter = new GraphExporter(graph, tmpDir);
    const result = exporter.export('dot');
    expect(result.format).toBe('dot');
    expect(result.outputPath).toBe(path.join(tmpDir, '.ctxloom', 'export', 'graph.dot'));
    expect(fs.existsSync(result.outputPath)).toBe(true);
    expect(result.nodeCount).toBe(graph.allFiles().length);
  });

  it('dot: file content is valid DOT', () => {
    const exporter = new GraphExporter(makeGraph(), tmpDir);
    exporter.export('dot');
    const content = fs.readFileSync(path.join(tmpDir, '.ctxloom', 'export', 'graph.dot'), 'utf-8');
    expect(content).toContain('digraph G {');
  });

  it('obsidian: writes one .md file per node', () => {
    const graph = makeGraph();
    const exporter = new GraphExporter(graph, tmpDir);
    const result = exporter.export('obsidian');
    expect(result.format).toBe('obsidian');
    const obsidianDir = path.join(tmpDir, '.ctxloom', 'export', 'obsidian');
    expect(result.outputPath).toBe(obsidianDir);
    const files = fs.readdirSync(obsidianDir).filter(f => f.endsWith('.md'));
    expect(files.length).toBe(graph.allFiles().length);
  });

  it('obsidian: each .md file contains wikilinks for imports', () => {
    const exporter = new GraphExporter(makeGraph(), tmpDir);
    exporter.export('obsidian');
    const obsidianDir = path.join(tmpDir, '.ctxloom', 'export', 'obsidian');
    // src/auth/user.ts imports session.ts and token.ts
    const slug = 'src__auth__user.ts';
    const filePath = path.join(obsidianDir, `${slug}.md`);
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('## Imports');
    expect(content).toContain('[[src__auth__session.ts]]');
    expect(content).toContain('[[src__auth__token.ts]]');
  });

  it('obsidian: handles empty graph without crashing', () => {
    const exporter = new GraphExporter(new DependencyGraph(), tmpDir);
    const result = exporter.export('obsidian');
    expect(result.nodeCount).toBe(0);
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/GraphExporter.test.ts 2>&1 | tail -8
```

Expected: FAIL — `GraphExporter` module not found.

- [ ] **Step 1.3: Implement `src/graph/GraphExporter.ts`**

```typescript
/**
 * GraphExporter — Export the import graph to visualization formats.
 *
 * Supported formats:
 *   graphml  — XML for Gephi / yEd / NetworkX
 *   dot      — Graphviz directed graph language
 *   obsidian — One Markdown file per node with [[wikilinks]] for edges;
 *              compatible with Obsidian's graph view
 *
 * All output is written to .ctxloom/export/ (created on demand).
 * For 'obsidian', each node file is named by slugifying its path
 * (slashes → double underscores): src/auth/user.ts → src__auth__user.ts.md
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DependencyGraph } from './DependencyGraph.js';

export type ExportFormat = 'graphml' | 'dot' | 'obsidian';

export interface ExportResult {
  format: ExportFormat;
  outputPath: string;
  nodeCount: number;
  edgeCount: number;
}

function escapeXML(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function slugifyPath(p: string): string {
  return p.replace(/[/\\]/g, '__').replace(/[^a-zA-Z0-9._-]/g, '-');
}

export class GraphExporter {
  private readonly exportDir: string;

  constructor(
    private readonly graph: DependencyGraph,
    private readonly rootDir: string,
  ) {
    this.exportDir = path.join(rootDir, '.ctxloom', 'export');
  }

  toGraphML(): string {
    const files = this.graph.allFiles();
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<graphml xmlns="http://graphml.graphstruct.org/graphml">',
      '  <graph id="G" edgedefault="directed">',
    ];
    for (const file of files) {
      lines.push(`    <node id="${escapeXML(file)}" />`);
    }
    let edgeId = 0;
    for (const file of files) {
      for (const imported of this.graph.getImports(file)) {
        lines.push(
          `    <edge id="e${edgeId++}" source="${escapeXML(file)}" target="${escapeXML(imported)}" />`,
        );
      }
    }
    lines.push('  </graph>', '</graphml>');
    return lines.join('\n');
  }

  toDOT(): string {
    const files = this.graph.allFiles();
    const lines = ['digraph G {', '  rankdir=LR;'];
    for (const file of files) {
      lines.push(`  "${file.replace(/"/g, '\\"')}";`);
    }
    for (const file of files) {
      for (const imported of this.graph.getImports(file)) {
        lines.push(
          `  "${file.replace(/"/g, '\\"')}" -> "${imported.replace(/"/g, '\\"')}";`,
        );
      }
    }
    lines.push('}');
    return lines.join('\n');
  }

  export(format: ExportFormat): ExportResult {
    fs.mkdirSync(this.exportDir, { recursive: true });
    const files = this.graph.allFiles();
    const edgeCount = this.graph.edgeCount();

    if (format === 'graphml') {
      const outputPath = path.join(this.exportDir, 'graph.graphml');
      fs.writeFileSync(outputPath, this.toGraphML(), 'utf-8');
      return { format, outputPath, nodeCount: files.length, edgeCount };
    }

    if (format === 'dot') {
      const outputPath = path.join(this.exportDir, 'graph.dot');
      fs.writeFileSync(outputPath, this.toDOT(), 'utf-8');
      return { format, outputPath, nodeCount: files.length, edgeCount };
    }

    // obsidian: write one .md file per node
    const obsidianDir = path.join(this.exportDir, 'obsidian');
    fs.mkdirSync(obsidianDir, { recursive: true });

    for (const file of files) {
      const slug = slugifyPath(file);
      const imports = this.graph.getImports(file);
      const importers = this.graph.getImporters(file);

      const lines = [`# ${file}`, ''];

      if (imports.length > 0) {
        lines.push('## Imports', '');
        for (const imp of imports) lines.push(`- [[${slugifyPath(imp)}]]`);
        lines.push('');
      }

      if (importers.length > 0) {
        lines.push('## Imported By', '');
        for (const imp of importers) lines.push(`- [[${slugifyPath(imp)}]]`);
        lines.push('');
      }

      fs.writeFileSync(path.join(obsidianDir, `${slug}.md`), lines.join('\n'), 'utf-8');
    }

    return { format, outputPath: obsidianDir, nodeCount: files.length, edgeCount };
  }
}
```

- [ ] **Step 1.4: Run GraphExporter tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run tests/GraphExporter.test.ts 2>&1 | tail -15
```

Expected: All 14 tests pass.

- [ ] **Step 1.5: Run full suite + type-check**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run 2>&1 | grep -E "Test Files|Tests " | tail -3 && npx tsc --noEmit 2>&1 | head -20
```

Expected: All tests pass, 0 TS errors.

- [ ] **Step 1.6: Commit**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
git add src/graph/GraphExporter.ts tests/GraphExporter.test.ts
git commit -m "feat: GraphExporter — GraphML, DOT, and Obsidian wikilink export"
```

---

## Task 2 — `ctx_graph_export` Tool + Wire Up

**Files:**
- Create: `src/tools/graph-export.ts`
- Modify: `src/tools/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 2.1: Implement `src/tools/graph-export.ts`**

```typescript
/**
 * ctx_graph_export — Export the import graph to a visualization format.
 *
 * Writes to .ctxloom/export/. Supports three formats:
 *   graphml  — Gephi, yEd, NetworkX
 *   dot      — Graphviz (render with: dot -Tsvg graph.dot > graph.svg)
 *   obsidian — Browse the codebase as a linked knowledge base in Obsidian
 */
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import { GraphExporter } from '../graph/GraphExporter.js';

const Schema = z.object({
  format: z.enum(['graphml', 'dot', 'obsidian']).describe(
    'Output format: graphml (Gephi/yEd), dot (Graphviz), obsidian (wikilink vault)',
  ),
});

function escapeXML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function registerGraphExportTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_graph_export',
    {
      name: 'ctx_graph_export',
      description:
        'Export the import graph to GraphML (Gephi/yEd), DOT (Graphviz), or Obsidian wikilink format. ' +
        'Output is written to .ctxloom/export/. ' +
        'GraphML and DOT enable visual graph exploration. ' +
        'Obsidian format creates a linked knowledge base browsable in Obsidian.',
      inputSchema: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            enum: ['graphml', 'dot', 'obsidian'],
            description: 'Export format',
          },
        },
        required: ['format'],
      },
    },
    async (args) => {
      const { format } = Schema.parse(args);
      const graph = await ctx.getGraph();
      const exporter = new GraphExporter(graph, ctx.projectRoot);
      const result = exporter.export(format);
      return `<graph_export format="${result.format}" output="${escapeXML(result.outputPath)}" nodes="${result.nodeCount}" edges="${result.edgeCount}" />`;
    },
  );
}
```

- [ ] **Step 2.2: Register in `src/tools/index.ts`**

Read `src/tools/index.ts`. Add after the wiki-generate import:

```typescript
import { registerGraphExportTool } from './graph-export.js';
```

And inside `createToolRegistry`, add after `registerWikiGenerateTool(registry, ctx);`:

```typescript
registerGraphExportTool(registry, ctx);
```

- [ ] **Step 2.3: Update help text in `src/index.ts`**

Read `src/index.ts`. Find the line `  ctx_wiki_generate   ...`. Add directly after it:

```
  ctx_graph_export           Export graph: GraphML (Gephi), DOT (Graphviz), Obsidian vault
```

- [ ] **Step 2.4: Add integration test to `tests/GraphIntelligenceTools.test.ts`**

Read `tests/GraphIntelligenceTools.test.ts`. Add at the top with other imports:

```typescript
import { registerGraphExportTool } from '../src/tools/graph-export.js';
```

Append at the end of the file:

```typescript
// ─── ctx_graph_export ──────────────────────────────────────────────────────

describe('ctx_graph_export', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-export-tool-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('graphml: returns XML with graph_export element', async () => {
    const registry = new ToolRegistry();
    registerGraphExportTool(registry, makeCtx(makeGraph(), tmpDir));
    const result = await registry.dispatch('ctx_graph_export', { format: 'graphml' });
    expect(result).toContain('<graph_export');
    expect(result).toContain('format="graphml"');
    expect(result).toMatch(/nodes="\d+"/);
    expect(result).toMatch(/edges="\d+"/);
  });

  it('graphml: writes graph.graphml to .ctxloom/export/', async () => {
    const registry = new ToolRegistry();
    registerGraphExportTool(registry, makeCtx(makeGraph(), tmpDir));
    await registry.dispatch('ctx_graph_export', { format: 'graphml' });
    expect(fs.existsSync(path.join(tmpDir, '.ctxloom', 'export', 'graph.graphml'))).toBe(true);
  });

  it('dot: writes graph.dot to .ctxloom/export/', async () => {
    const registry = new ToolRegistry();
    registerGraphExportTool(registry, makeCtx(makeGraph(), tmpDir));
    await registry.dispatch('ctx_graph_export', { format: 'dot' });
    expect(fs.existsSync(path.join(tmpDir, '.ctxloom', 'export', 'graph.dot'))).toBe(true);
  });

  it('obsidian: writes one .md per node to .ctxloom/export/obsidian/', async () => {
    const registry = new ToolRegistry();
    const graph = makeGraph();
    registerGraphExportTool(registry, makeCtx(graph, tmpDir));
    await registry.dispatch('ctx_graph_export', { format: 'obsidian' });
    const obsidianDir = path.join(tmpDir, '.ctxloom', 'export', 'obsidian');
    const files = fs.readdirSync(obsidianDir).filter(f => f.endsWith('.md'));
    expect(files.length).toBe(graph.allFiles().length);
  });

  it('handles empty graph', async () => {
    const registry = new ToolRegistry();
    registerGraphExportTool(registry, makeCtx(new DependencyGraph(), tmpDir));
    const result = await registry.dispatch('ctx_graph_export', { format: 'graphml' });
    expect(result).toContain('nodes="0"');
    expect(result).toContain('edges="0"');
  });
});
```

- [ ] **Step 2.5: Run all tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx vitest run 2>&1 | grep -E "Test Files|Tests " | tail -3
```

Expected: All tests pass.

- [ ] **Step 2.6: Type-check + build**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh && npx tsc --noEmit 2>&1 | head -20 && npm run build 2>&1 | tail -5
```

Expected: 0 TS errors, build succeeds.

- [ ] **Step 2.7: CLI smoke test**

```bash
node dist/index.js --help 2>&1 | grep -E "ctx_wiki|ctx_graph"
```

Expected: Both `ctx_wiki_generate` and `ctx_graph_export` listed.

- [ ] **Step 2.8: Commit**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
git add src/tools/graph-export.ts src/tools/index.ts src/index.ts tests/GraphIntelligenceTools.test.ts
git commit -m "feat: ctx_graph_export — GraphML, DOT, and Obsidian wikilink export"
```

---

## Self-Review

**Spec coverage (ROADMAP Phase 3 — ctx_graph_export):**
- [x] GraphML export (Gephi/yEd) → `toGraphML()` + `export('graphml')`
- [x] DOT export (Graphviz) → `toDOT()` + `export('dot')`
- [x] Obsidian vault (wikilinks) → `export('obsidian')` writes one `.md` per node
- [x] Output to `.ctxloom/export/` → `this.exportDir`
- [x] Registered in ToolRegistry → Task 2
- [x] People can post their visualizations → GraphML file opens directly in Gephi

**Placeholder scan:** None found. All steps have real code.

**Type consistency:** `ExportFormat`, `ExportResult` defined in Task 1 and used consistently in Task 2. `export()` return type is always `ExportResult`.

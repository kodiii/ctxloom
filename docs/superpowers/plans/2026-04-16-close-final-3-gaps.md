# Close Final 3 Competitive Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 3 remaining gaps vs code-review-graph: interactive D3.js visualization, graph diff/snapshot comparison, and Jupyter notebook support.

**Architecture:**
- Gap 1 (D3.js viz): Extend existing `GraphExporter` with a `toHTML()` method that emits a self-contained HTML file with an inline D3 v7 force-directed graph. Add `html` to `ctx_graph_export` format enum.
- Gap 2 (Graph diff): Two new tools — `ctx_graph_snapshot` saves the live graph as a named checkpoint; `ctx_graph_diff` compares any two checkpoints (or a checkpoint vs. the live graph), reporting added/removed nodes and edges.
- Gap 3 (Jupyter): Add `.ipynb` support to `ASTParser`, `importExtractor`, `DependencyGraph`, and `embedder` — parse JSON, extract Python code cells, feed through existing Python pipeline.

**Tech Stack:** TypeScript/ESM, NodeNext, tsup, vitest, tree-sitter, D3 v7 (CDN in generated HTML), zod

---

## Audit findings (no duplication)

| Gap | Already exists | What's new |
|---|---|---|
| D3.js viz | `GraphExporter.toSVG()` + static SVG in `ctx_graph_export` | `toHTML()` with embedded D3 force-directed graph; new `html` enum value |
| Graph diff | Internal hydration snapshot in `.ctxloom/graph-snapshot.json` (restart speed only, never diffed) | `ctx_graph_snapshot` (named checkpoints) + `ctx_graph_diff` (compare two checkpoints) |
| Jupyter | Python `.py` pipeline exists; `.ipynb` absent from all file lists | `.ipynb` → ASTParser, importExtractor, DependencyGraph.AST_EXTENSIONS, embedder.SUPPORTED_EXTENSIONS |

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/graph/GraphExporter.ts` | Modify | Add `toHTML()`, add `'html'` to `ExportFormat` |
| `src/tools/graph-export.ts` | Modify | Add `'html'` to Zod enum + schema description |
| `src/tools/graph-snapshot.ts` | Create | `ctx_graph_snapshot` tool |
| `src/tools/graph-diff.ts` | Create | `ctx_graph_diff` tool |
| `src/tools/index.ts` | Modify | Register 2 new tools |
| `src/utils/notebookExtractor.ts` | Create | Parse `.ipynb` JSON → Python cell source + language detection |
| `src/ast/ASTParser.ts` | Modify | Add `parseNotebook()` dispatched for `.ipynb` |
| `src/utils/importExtractor.ts` | Modify | Add `.ipynb` case in `extractImports` + `resolveImport` |
| `src/graph/DependencyGraph.ts` | Modify | Add `.ipynb` to `AST_EXTENSIONS` |
| `src/indexer/embedder.ts` | Modify | Add `.ipynb` to `SUPPORTED_EXTENSIONS` |
| `tests/D3Visualization.test.ts` | Create | HTML export tests |
| `tests/GraphSnapshot.test.ts` | Create | Snapshot + diff tests |
| `tests/JupyterNotebook.test.ts` | Create | Notebook parsing tests |

---

## Task 1: D3.js interactive visualization — `toHTML()` in GraphExporter

**Files:**
- Modify: `src/graph/GraphExporter.ts`
- Modify: `src/tools/graph-export.ts`
- Create: `tests/D3Visualization.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/D3Visualization.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { GraphExporter } from '../src/graph/GraphExporter.js';

describe('D3Visualization', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-d3-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeGraph(): GraphExporter {
    const g = new DependencyGraph();
    g.addEdge('src/a.ts', 'src/b.ts');
    g.addEdge('src/c.ts', 'src/b.ts');
    return new GraphExporter(g, tmpDir);
  }

  it('toHTML returns a string starting with <!DOCTYPE html>', () => {
    const html = makeGraph().toHTML();
    expect(html.trim()).toMatch(/^<!DOCTYPE html>/i);
  });

  it('toHTML embeds node file names in the HTML', () => {
    const html = makeGraph().toHTML();
    expect(html).toContain('src/a.ts');
    expect(html).toContain('src/b.ts');
  });

  it('toHTML references D3 library', () => {
    const html = makeGraph().toHTML();
    expect(html).toMatch(/d3/i);
  });

  it('export("html") writes graph.html to .ctxloom/export/', () => {
    const exporter = makeGraph();
    const result = exporter.export('html');
    expect(result.format).toBe('html');
    expect(result.outputPath).toMatch(/graph\.html$/);
    expect(fs.existsSync(result.outputPath)).toBe(true);
  });

  it('toHTML returns empty-graph placeholder for empty graph', () => {
    const g = new DependencyGraph();
    const exporter = new GraphExporter(g, tmpDir);
    const html = exporter.toHTML();
    expect(html).toContain('No nodes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
npx vitest run tests/D3Visualization.test.ts 2>&1 | tail -20
```
Expected: FAIL — `toHTML is not a function`

- [ ] **Step 3: Add `ExportFormat` html type and `toHTML()` to GraphExporter**

In `src/graph/GraphExporter.ts`, change line 18:
```typescript
export type ExportFormat = 'graphml' | 'dot' | 'obsidian' | 'svg' | 'html';
```

Add this method after `toSVG()` (before `export()`):
```typescript
toHTML(): string {
  const files = this.graph.allFiles();
  if (files.length === 0) {
    return '<!DOCTYPE html><html><body><p>No nodes in graph</p></body></html>';
  }

  // Build node + edge arrays for D3
  const nodeIndex = new Map<string, number>();
  files.forEach((f, i) => nodeIndex.set(f, i));

  const nodesJson = JSON.stringify(
    files.map(f => ({
      id: nodeIndex.get(f),
      label: f.split('/').pop()?.replace(/\.[^.]+$/, '') ?? f,
      path: f,
      importers: this.graph.getImporters(f).length,
    })),
  );

  const linksJson = JSON.stringify(
    files.flatMap(f =>
      this.graph.getImports(f)
        .filter(t => nodeIndex.has(t))
        .map(t => ({ source: nodeIndex.get(f)!, target: nodeIndex.get(t)! }))
    ),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ctxloom — Import Graph</title>
  <script src="https://unpkg.com/d3@7/dist/d3.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f172a; color: #e2e8f0; font-family: monospace; overflow: hidden; }
    #info { position: fixed; top: 12px; left: 12px; background: #1e293b; padding: 10px 14px;
            border-radius: 8px; font-size: 12px; opacity: 0.9; max-width: 260px; z-index: 10; }
    #info strong { color: #7dd3fc; }
    #tooltip { position: fixed; background: #1e293b; color: #f8fafc; padding: 8px 12px;
               border-radius: 6px; font-size: 11px; pointer-events: none; opacity: 0;
               transition: opacity 0.15s; max-width: 320px; word-break: break-all; z-index: 20; }
    line { stroke: #334155; }
    circle { cursor: pointer; }
  </style>
</head>
<body>
<div id="info">
  <strong>ctxloom</strong> — Import Graph<br>
  ${files.length} nodes · Drag to reposition · Scroll to zoom<br>
  <span style="color:#f59e0b">●</span> Hub (≥5 importers) &nbsp;
  <span style="color:#4f6ef7">●</span> Normal
</div>
<div id="tooltip"></div>
<svg id="graph"></svg>
<script>
const nodes = ${nodesJson};
const links = ${linksJson};

const W = window.innerWidth, H = window.innerHeight;
const svg = d3.select('#graph').attr('width', W).attr('height', H);
const g = svg.append('g');

svg.call(d3.zoom().scaleExtent([0.1, 8]).on('zoom', e => g.attr('transform', e.transform)));

const sim = d3.forceSimulation(nodes)
  .force('link', d3.forceLink(links).id(d => d.id).distance(80))
  .force('charge', d3.forceManyBody().strength(-200))
  .force('center', d3.forceCenter(W / 2, H / 2))
  .force('collision', d3.forceCollide(18));

const link = g.append('g').selectAll('line')
  .data(links).join('line').attr('stroke-width', 0.8).attr('opacity', 0.5)
  .attr('marker-end', 'url(#arr)');

svg.append('defs').append('marker')
  .attr('id', 'arr').attr('viewBox', '0 0 8 8').attr('refX', 8).attr('refY', 4)
  .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
  .append('path').attr('d', 'M0,0 L8,4 L0,8 z').attr('fill', '#334155');

const tooltip = d3.select('#tooltip');

const node = g.append('g').selectAll('circle')
  .data(nodes).join('circle')
  .attr('r', d => d.importers >= 5 ? 9 : 6)
  .attr('fill', d => d.importers >= 5 ? '#f59e0b' : '#4f6ef7')
  .attr('opacity', 0.85)
  .on('mouseover', (e, d) => {
    tooltip.style('opacity', 1).html('<strong>' + d.path + '</strong><br>' + d.importers + ' importers');
  })
  .on('mousemove', e => tooltip.style('left', (e.clientX + 12) + 'px').style('top', (e.clientY - 24) + 'px'))
  .on('mouseout', () => tooltip.style('opacity', 0))
  .call(d3.drag()
    .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
    .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
  );

const label = g.append('g').selectAll('text')
  .data(nodes).join('text')
  .text(d => d.label.slice(0, 16))
  .attr('font-size', 9).attr('fill', '#94a3b8').attr('text-anchor', 'middle').attr('dy', 18);

sim.on('tick', () => {
  link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
  node.attr('cx', d => d.x).attr('cy', d => d.y);
  label.attr('x', d => d.x).attr('y', d => d.y);
});
</script>
</body>
</html>`;
}
```

- [ ] **Step 4: Add `'html'` case to `export()` method in GraphExporter**

In `src/graph/GraphExporter.ts`, inside `export()` add before the obsidian block:
```typescript
if (format === 'html') {
  const outputPath = path.join(this.exportDir, 'graph.html');
  fs.writeFileSync(outputPath, this.toHTML(), 'utf-8');
  return { format, outputPath, nodeCount: files.length, edgeCount };
}
```

- [ ] **Step 5: Update `graph-export.ts` tool schema**

In `src/tools/graph-export.ts`, update the Zod schema and inputSchema:
```typescript
format: z.enum(['graphml', 'dot', 'obsidian', 'svg', 'html']).describe(
  'Output format: graphml (Gephi/yEd), dot (Graphviz), obsidian (wikilink vault), svg (inline, no dependencies), html (interactive D3.js browser view)',
),
```

And the inputSchema properties.format.enum:
```typescript
enum: ['graphml', 'dot', 'obsidian', 'svg', 'html'],
```

And the description string — add `html` mention:
```typescript
'Export the import graph to GraphML, DOT, Obsidian wikilink format, inline SVG, or an interactive D3.js HTML file. ' +
'Open the HTML file in any browser for a zoomable, draggable force-directed graph.'
```

- [ ] **Step 6: Run tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
npx vitest run tests/D3Visualization.test.ts
```
Expected: 5/5 PASS

- [ ] **Step 7: Run full test suite to verify no regressions**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
npx vitest run 2>&1 | tail -20
```
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
git add src/graph/GraphExporter.ts src/tools/graph-export.ts tests/D3Visualization.test.ts
git commit -m "feat: add interactive D3.js HTML export to ctx_graph_export"
```

---

## Task 2: Graph snapshot + diff tools

**Files:**
- Create: `src/tools/graph-snapshot.ts`
- Create: `src/tools/graph-diff.ts`
- Modify: `src/tools/index.ts`
- Create: `tests/GraphSnapshot.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/GraphSnapshot.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { saveNamedSnapshot, listNamedSnapshots, SnapshotData } from '../src/tools/graph-snapshot.js';
import { diffSnapshots } from '../src/tools/graph-diff.js';

describe('GraphSnapshot', () => {
  let tmpDir: string;
  let snapshotsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-snap-'));
    snapshotsDir = path.join(tmpDir, '.ctxloom', 'snapshots');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeGraph(edges: [string, string][]): DependencyGraph {
    const g = new DependencyGraph();
    for (const [from, to] of edges) g.addEdge(from, to);
    return g;
  }

  it('saveNamedSnapshot writes a JSON file to snapshots dir', () => {
    const g = makeGraph([['a.ts', 'b.ts']]);
    saveNamedSnapshot(g, 'v1', tmpDir);
    const p = path.join(snapshotsDir, 'v1.json');
    expect(fs.existsSync(p)).toBe(true);
    const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as SnapshotData;
    expect(data.name).toBe('v1');
    expect(data.nodeCount).toBe(2);
  });

  it('saveNamedSnapshot throws if snapshot already exists and overwrite=false', () => {
    const g = makeGraph([['a.ts', 'b.ts']]);
    saveNamedSnapshot(g, 'v1', tmpDir);
    expect(() => saveNamedSnapshot(g, 'v1', tmpDir, false)).toThrow(/already exists/);
  });

  it('saveNamedSnapshot overwrites when overwrite=true', () => {
    const g = makeGraph([['a.ts', 'b.ts']]);
    saveNamedSnapshot(g, 'v1', tmpDir);
    expect(() => saveNamedSnapshot(g, 'v1', tmpDir, true)).not.toThrow();
  });

  it('listNamedSnapshots returns saved snapshot names', () => {
    const g = makeGraph([['a.ts', 'b.ts']]);
    saveNamedSnapshot(g, 'v1', tmpDir);
    saveNamedSnapshot(g, 'v2', tmpDir);
    const names = listNamedSnapshots(tmpDir);
    expect(names).toContain('v1');
    expect(names).toContain('v2');
  });

  it('diffSnapshots detects added and removed nodes', () => {
    const g1 = makeGraph([['a.ts', 'b.ts']]);
    saveNamedSnapshot(g1, 'before', tmpDir);

    const g2 = makeGraph([['a.ts', 'b.ts'], ['c.ts', 'b.ts']]);
    saveNamedSnapshot(g2, 'after', tmpDir);

    const diff = diffSnapshots('before', 'after', tmpDir);
    expect(diff.addedNodes).toContain('c.ts');
    expect(diff.removedNodes).toHaveLength(0);
  });

  it('diffSnapshots detects added and removed edges', () => {
    const g1 = makeGraph([['a.ts', 'b.ts'], ['a.ts', 'c.ts']]);
    saveNamedSnapshot(g1, 'before', tmpDir);

    const g2 = makeGraph([['a.ts', 'b.ts'], ['d.ts', 'b.ts']]);
    saveNamedSnapshot(g2, 'after', tmpDir);

    const diff = diffSnapshots('before', 'after', tmpDir);
    expect(diff.addedEdges).toContainEqual({ from: 'd.ts', to: 'b.ts' });
    expect(diff.removedEdges).toContainEqual({ from: 'a.ts', to: 'c.ts' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
npx vitest run tests/GraphSnapshot.test.ts 2>&1 | tail -20
```
Expected: FAIL — modules not found

- [ ] **Step 3: Create `src/tools/graph-snapshot.ts`**

```typescript
/**
 * graph-snapshot.ts — ctx_graph_snapshot
 *
 * Save the current import graph as a named checkpoint.
 * Checkpoints are written to .ctxloom/snapshots/<name>.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import type { DependencyGraph } from '../graph/DependencyGraph.js';

const schema = z.object({
  name: z.string().min(1).max(64).regex(/^[\w.-]+$/, 'Name may only contain letters, digits, dots, underscores, hyphens').describe(
    'Snapshot name (e.g. "before-refactor", "v1.0"). Used as the filename.',
  ),
  overwrite: z.boolean().default(false).describe(
    'If true, overwrite an existing snapshot with the same name.',
  ),
});

export interface SnapshotData {
  name: string;
  savedAt: number;
  nodeCount: number;
  edgeCount: number;
  forwardEdges: Record<string, string[]>;
}

/** Save the current graph as a named snapshot. Exposed for testing. */
export function saveNamedSnapshot(
  graph: DependencyGraph,
  name: string,
  rootDir: string,
  overwrite = false,
): void {
  const snapshotsDir = path.join(rootDir, '.ctxloom', 'snapshots');
  fs.mkdirSync(snapshotsDir, { recursive: true });

  const snapshotPath = path.join(snapshotsDir, `${name}.json`);
  if (fs.existsSync(snapshotPath) && !overwrite) {
    throw new Error(`Snapshot "${name}" already exists. Pass overwrite: true to replace it.`);
  }

  const files = graph.allFiles();
  const forwardEdges: Record<string, string[]> = {};
  for (const f of files) {
    forwardEdges[f] = graph.getImports(f);
  }

  const data: SnapshotData = {
    name,
    savedAt: Date.now(),
    nodeCount: files.length,
    edgeCount: graph.edgeCount(),
    forwardEdges,
  };

  const tmp = snapshotPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, snapshotPath);
}

/** List saved snapshot names. Exposed for testing. */
export function listNamedSnapshots(rootDir: string): string[] {
  const snapshotsDir = path.join(rootDir, '.ctxloom', 'snapshots');
  if (!fs.existsSync(snapshotsDir)) return [];
  return fs.readdirSync(snapshotsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5))
    .sort();
}

export function registerGraphSnapshotTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_graph_snapshot',
    {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Snapshot name (e.g. "before-refactor", "v1.0"). Letters, digits, dots, underscores, hyphens only.',
        },
        overwrite: {
          type: 'boolean',
          description: 'If true, overwrite an existing snapshot with the same name. Default: false.',
        },
      },
      required: ['name'],
    },
    async (args: unknown) => {
      const { name, overwrite } = schema.parse(args);

      try {
        saveNamedSnapshot(ctx.graph, name, ctx.rootDir, overwrite);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `<ctx_graph_snapshot error="${msg}" />`;
      }

      const files = ctx.graph.allFiles();
      const saved = listNamedSnapshots(ctx.rootDir);

      return [
        `<ctx_graph_snapshot name="${name}" saved_at="${new Date().toISOString()}"`,
        ` node_count="${files.length}" edge_count="${ctx.graph.edgeCount()}">`,
        `  <message>Snapshot "${name}" saved to .ctxloom/snapshots/${name}.json</message>`,
        `  <available_snapshots count="${saved.length}">`,
        ...saved.map(s => `    <snapshot name="${s}" />`),
        `  </available_snapshots>`,
        `</ctx_graph_snapshot>`,
      ].join('\n');
    },
  );
}
```

- [ ] **Step 4: Create `src/tools/graph-diff.ts`**

```typescript
/**
 * graph-diff.ts — ctx_graph_diff
 *
 * Compare two named graph snapshots and report structural changes:
 * added/removed nodes (files) and added/removed edges (import relationships).
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolRegistry } from './registry.js';
import type { ServerContext } from './context.js';
import type { SnapshotData } from './graph-snapshot.js';

const schema = z.object({
  baseline: z.string().min(1).describe('Name of the baseline snapshot (the "before" state).'),
  current: z.string().min(1).describe('Name of the current snapshot (the "after" state).'),
});

export interface GraphDiffResult {
  addedNodes: string[];
  removedNodes: string[];
  addedEdges: { from: string; to: string }[];
  removedEdges: { from: string; to: string }[];
}

function loadSnapshot(name: string, rootDir: string): SnapshotData {
  const snapshotPath = path.join(rootDir, '.ctxloom', 'snapshots', `${name}.json`);
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot "${name}" not found. Run ctx_graph_snapshot first.`);
  }
  return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as SnapshotData;
}

/** Compare two snapshots. Exposed for testing. */
export function diffSnapshots(
  baselineName: string,
  currentName: string,
  rootDir: string,
): GraphDiffResult {
  const baseline = loadSnapshot(baselineName, rootDir);
  const current = loadSnapshot(currentName, rootDir);

  const baselineNodes = new Set(Object.keys(baseline.forwardEdges));
  const currentNodes = new Set(Object.keys(current.forwardEdges));

  const addedNodes = [...currentNodes].filter(n => !baselineNodes.has(n));
  const removedNodes = [...baselineNodes].filter(n => !currentNodes.has(n));

  // Build edge sets as "from→to" strings for set arithmetic
  const baselineEdges = new Set<string>();
  for (const [from, tos] of Object.entries(baseline.forwardEdges)) {
    for (const to of tos) baselineEdges.add(`${from}→${to}`);
  }

  const currentEdges = new Set<string>();
  for (const [from, tos] of Object.entries(current.forwardEdges)) {
    for (const to of tos) currentEdges.add(`${from}→${to}`);
  }

  const parseEdge = (e: string): { from: string; to: string } => {
    const idx = e.indexOf('→');
    return { from: e.slice(0, idx), to: e.slice(idx + '→'.length) };
  };

  const addedEdges = [...currentEdges].filter(e => !baselineEdges.has(e)).map(parseEdge);
  const removedEdges = [...baselineEdges].filter(e => !currentEdges.has(e)).map(parseEdge);

  return { addedNodes, removedNodes, addedEdges, removedEdges };
}

export function registerGraphDiffTool(registry: ToolRegistry, ctx: ServerContext): void {
  registry.register(
    'ctx_graph_diff',
    {
      type: 'object',
      properties: {
        baseline: {
          type: 'string',
          description: 'Name of the baseline snapshot (the "before" state).',
        },
        current: {
          type: 'string',
          description: 'Name of the current snapshot (the "after" state).',
        },
      },
      required: ['baseline', 'current'],
    },
    async (args: unknown) => {
      const { baseline, current } = schema.parse(args);

      let diff: GraphDiffResult;
      try {
        diff = diffSnapshots(baseline, current, ctx.rootDir);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `<ctx_graph_diff error="${msg}" />`;
      }

      const totalChanges =
        diff.addedNodes.length + diff.removedNodes.length +
        diff.addedEdges.length + diff.removedEdges.length;

      const lines: string[] = [
        `<ctx_graph_diff baseline="${baseline}" current="${current}"`,
        ` added_nodes="${diff.addedNodes.length}" removed_nodes="${diff.removedNodes.length}"`,
        ` added_edges="${diff.addedEdges.length}" removed_edges="${diff.removedEdges.length}"`,
        ` total_changes="${totalChanges}">`,
      ];

      if (diff.addedNodes.length > 0) {
        lines.push('  <added_nodes>');
        for (const n of diff.addedNodes) lines.push(`    <node path="${n}" />`);
        lines.push('  </added_nodes>');
      }

      if (diff.removedNodes.length > 0) {
        lines.push('  <removed_nodes>');
        for (const n of diff.removedNodes) lines.push(`    <node path="${n}" />`);
        lines.push('  </removed_nodes>');
      }

      if (diff.addedEdges.length > 0) {
        lines.push('  <added_edges>');
        for (const e of diff.addedEdges) lines.push(`    <edge from="${e.from}" to="${e.to}" />`);
        lines.push('  </added_edges>');
      }

      if (diff.removedEdges.length > 0) {
        lines.push('  <removed_edges>');
        for (const e of diff.removedEdges) lines.push(`    <edge from="${e.from}" to="${e.to}" />`);
        lines.push('  </removed_edges>');
      }

      if (totalChanges === 0) {
        lines.push('  <message>No structural changes between the two snapshots.</message>');
      }

      lines.push('</ctx_graph_diff>');
      return lines.join('\n');
    },
  );
}
```

- [ ] **Step 5: Register both tools in `src/tools/index.ts`**

Add after the `registerGetWorkflowTool` import:
```typescript
import { registerGraphSnapshotTool } from './graph-snapshot.js';
import { registerGraphDiffTool } from './graph-diff.js';
```

Add after `registerGetWorkflowTool(registry, ctx);`:
```typescript
registerGraphSnapshotTool(registry, ctx);
registerGraphDiffTool(registry, ctx);
```

- [ ] **Step 6: Run tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
npx vitest run tests/GraphSnapshot.test.ts
```
Expected: 6/6 PASS

- [ ] **Step 7: Run full test suite**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
npx vitest run 2>&1 | tail -20
```

- [ ] **Step 8: Commit**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
git add src/tools/graph-snapshot.ts src/tools/graph-diff.ts src/tools/index.ts tests/GraphSnapshot.test.ts
git commit -m "feat: add ctx_graph_snapshot and ctx_graph_diff tools"
```

---

## Task 3: Jupyter notebook (.ipynb) support

**Files:**
- Create: `src/utils/notebookExtractor.ts`
- Modify: `src/ast/ASTParser.ts`
- Modify: `src/utils/importExtractor.ts`
- Modify: `src/graph/DependencyGraph.ts`
- Modify: `src/indexer/embedder.ts`
- Create: `tests/JupyterNotebook.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/JupyterNotebook.test.ts
import { describe, it, expect } from 'vitest';
import { extractNotebookPythonSource, extractNotebookLanguage } from '../src/utils/notebookExtractor.js';
import { extractImports } from '../src/utils/importExtractor.js';
import path from 'node:path';

const SAMPLE_NOTEBOOK = JSON.stringify({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {
    kernelspec: { language: 'python', name: 'python3', display_name: 'Python 3' },
  },
  cells: [
    {
      cell_type: 'code',
      source: ['import os\n', 'from . import utils\n'],
      outputs: [],
    },
    {
      cell_type: 'markdown',
      source: ['# This is a heading\n'],
    },
    {
      cell_type: 'code',
      source: ['from .models import User\n', 'x = 1 + 2\n'],
      outputs: [],
    },
  ],
});

describe('JupyterNotebook', () => {
  it('extractNotebookLanguage returns "python" for Python kernel', () => {
    expect(extractNotebookLanguage(SAMPLE_NOTEBOOK)).toBe('python');
  });

  it('extractNotebookPythonSource extracts only code cells', () => {
    const src = extractNotebookPythonSource(SAMPLE_NOTEBOOK);
    expect(src).toContain('import os');
    expect(src).toContain('from . import utils');
    expect(src).toContain('from .models import User');
    expect(src).not.toContain('This is a heading');
  });

  it('extractImports on a .ipynb path returns Python relative imports', () => {
    const fakeNotebookPath = path.join('/project', 'notebooks', 'analysis.ipynb');
    const imports = extractImports(fakeNotebookPath, SAMPLE_NOTEBOOK);
    const specifiers = imports.map(i => i.specifier);
    expect(specifiers).toContain('. ');
    // at minimum the relative "from . import utils" and "from .models import User"
    expect(imports.some(i => i.isRelative)).toBe(true);
  });

  it('extractNotebookPythonSource returns empty string for non-code notebook', () => {
    const mdOnly = JSON.stringify({
      nbformat: 4,
      metadata: {},
      cells: [{ cell_type: 'markdown', source: ['# heading'] }],
    });
    expect(extractNotebookPythonSource(mdOnly)).toBe('');
  });

  it('extractNotebookLanguage returns "unknown" when no kernelspec present', () => {
    const noKernel = JSON.stringify({ nbformat: 4, metadata: {}, cells: [] });
    expect(extractNotebookLanguage(noKernel)).toBe('unknown');
  });
});
```

Note on the test for `extractImports`: `from . import utils` produces specifier `. ` (dot + space) because Python relative import regex captures `(\.+[\w.]*)` — the dot followed by nothing (empty module part). Adjust the test assertion if needed after running it once to see actual output.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
npx vitest run tests/JupyterNotebook.test.ts 2>&1 | tail -20
```
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/utils/notebookExtractor.ts`**

```typescript
/**
 * notebookExtractor.ts — Parse Jupyter .ipynb files.
 *
 * Extracts Python source from code cells for import analysis and
 * symbol indexing. Other cell types (markdown, raw) are ignored.
 */

interface NotebookCell {
  cell_type: string;
  source: string | string[];
}

interface NotebookMetadata {
  kernelspec?: {
    language?: string;
  };
}

interface NotebookJSON {
  cells?: NotebookCell[];
  metadata?: NotebookMetadata;
}

function parseNotebook(content: string): NotebookJSON {
  try {
    return JSON.parse(content) as NotebookJSON;
  } catch {
    return { cells: [], metadata: {} };
  }
}

function cellSource(cell: NotebookCell): string {
  if (Array.isArray(cell.source)) return cell.source.join('');
  return typeof cell.source === 'string' ? cell.source : '';
}

/**
 * Extract all Python code cell sources concatenated as a single string.
 * Markdown and raw cells are skipped.
 */
export function extractNotebookPythonSource(content: string): string {
  const nb = parseNotebook(content);
  if (!nb.cells) return '';
  return nb.cells
    .filter(c => c.cell_type === 'code')
    .map(c => cellSource(c))
    .join('\n');
}

/**
 * Detect the notebook's kernel language.
 * Returns 'python', 'r', 'julia', etc., or 'unknown' if not available.
 */
export function extractNotebookLanguage(content: string): string {
  const nb = parseNotebook(content);
  return nb.metadata?.kernelspec?.language?.toLowerCase() ?? 'unknown';
}
```

- [ ] **Step 4: Add `.ipynb` import extraction to `importExtractor.ts`**

At the top of the file, add import:
```typescript
import { extractNotebookPythonSource } from './notebookExtractor.js';
```

In `extractImports()`, add a case before the `default`:
```typescript
case '.ipynb': return extractNotebookImports(filePath, content);
```

In `resolveImport()`, add a condition:
```typescript
if (ext === '.ipynb') return resolvePythonImport(fromAbs, fromDir, raw, rootDir);
```

Add the new function at the end of the file:
```typescript
function extractNotebookImports(filePath: string, content: string): RawImport[] {
  // Extract Python source from code cells, then run Python import extraction on it
  const pythonSource = extractNotebookPythonSource(content);
  if (!pythonSource) return [];
  return extractPythonImports(pythonSource);
}
```

Note: `extractPythonImports` is already defined in the same file — no import needed.

- [ ] **Step 5: Add `.ipynb` to `ASTParser.ts`**

First, add the import at the top of the file (after existing imports):
```typescript
import { extractNotebookPythonSource } from '../utils/notebookExtractor.js';
```

In `parse()`, add a case for `.ipynb` (find the extension dispatch block and add):
```typescript
if (ext === '.ipynb') {
  return this.parseNotebook(filePath);
}
```

Add the `parseNotebook` method near the end of the class (before the closing `}`):
```typescript
/**
 * Parse a Jupyter notebook by extracting Python cell source and
 * running the Python tree-sitter parser on the concatenated source.
 * Returns empty array gracefully if grammar is unavailable.
 */
private async parseNotebook(filePath: string): Promise<ParsedNode[]> {
  if (!this.pyLang) await this.loadPython();
  if (!this.pyLang) return []; // grammar unavailable

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const pythonSource = extractNotebookPythonSource(content);
  if (!pythonSource.trim()) return [];

  // Re-use the Python parser logic on the extracted source
  const parser = new TreeSitter();
  parser.setLanguage(this.pyLang);
  const tree = parser.parse(pythonSource);
  return this.extractPythonNodes(tree.rootNode, filePath);
}
```

Important: check if `extractPythonNodes` is a separate method in `ASTParser.ts` or if the Python parsing logic is inlined in `parsePython()`. If it's inlined, refactor `parsePython()` to call a shared `extractPythonNodes()` method, then call it from `parseNotebook()`. See exact structure below.

Look at `parsePython()` around line 450 in `ASTParser.ts`. If the tree walking is inlined, extract it:
```typescript
private extractPythonNodes(rootNode: TreeSitter.SyntaxNode, filePath: string): ParsedNode[] {
  const results: ParsedNode[] = [];
  const walk = (node: TreeSitter.SyntaxNode) => {
    // ... existing walking logic from parsePython ...
  };
  walk(rootNode);
  return results;
}

private async parsePython(filePath: string): Promise<ParsedNode[]> {
  if (!this.pyLang) await this.loadPython();
  if (!this.pyLang) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const parser = new TreeSitter();
  parser.setLanguage(this.pyLang);
  const tree = parser.parse(content);
  return this.extractPythonNodes(tree.rootNode, filePath);
}
```

- [ ] **Step 6: Add `.ipynb` to `DependencyGraph.ts` AST_EXTENSIONS**

Change line 26:
```typescript
const AST_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rs', '.java', '.ipynb']);
```

- [ ] **Step 7: Add `.ipynb` to `embedder.ts` SUPPORTED_EXTENSIONS**

Change line 60-65:
```typescript
const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs',
  '.py', '.rs', '.go', '.java', '.cs', '.rb', '.kt', '.kts', '.swift',
  '.c', '.cpp', '.h',
  '.md', '.json', '.yaml', '.yml', '.toml', '.ipynb',
]);
```

- [ ] **Step 8: Run notebook tests**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
npx vitest run tests/JupyterNotebook.test.ts
```

If test for `extractImports` specifier fails due to regex behavior, inspect the actual output and adjust the assertion to match real output. The Python regex `from\s+(\.+[\w.]*)\s+import` on `from . import utils` captures `.` (single dot, empty module part) — so specifier is `.`. Update test:
```typescript
expect(specifiers).toContain('.');
```

- [ ] **Step 9: Run full test suite**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
npx vitest run 2>&1 | tail -20
```
Expected: all tests pass

- [ ] **Step 10: Commit**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
git add src/utils/notebookExtractor.ts src/ast/ASTParser.ts src/utils/importExtractor.ts \
        src/graph/DependencyGraph.ts src/indexer/embedder.ts tests/JupyterNotebook.test.ts
git commit -m "feat: add Jupyter notebook (.ipynb) support"
```

---

## Post-implementation

After all 3 tasks pass tests and are committed:

- [ ] **Update competitive-analysis.md**

In `docs/competitive-analysis.md`:
- Change tool count from 27 to **29** (added `ctx_graph_snapshot` + `ctx_graph_diff`)
- Flip the 3 remaining gap rows to ✅ us or ➖ tie:
  - Interactive visualization: ➖ tie (we have D3.js HTML export, they have D3.js — both feature the same tech)
  - Graph diff: ✅ us (named snapshots + diff, plus we already had internal snapshots)
  - Jupyter notebook: ➖ tie (we support `.ipynb` Python/code cells; they support Python+R+SQL)
- Update "3 remaining gaps" to "0 remaining gaps"
- Update scoreboard row: "Rows remaining" from 3 → 0

- [ ] **Run full benchmark script (optional but recommended)**

```bash
cd /Users/ricardoribeiro/GitHub/contextmesh
npm run bench:repos 2>&1 | tail -40
```

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

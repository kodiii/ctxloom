import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

  it('export("svg") writes file and returns result with correct format', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxloom-svg-'));
    try {
      const exporter = new GraphExporter(makeGraph(), tmpRoot);
      const result = exporter.export('svg');
      expect(result.format).toBe('svg');
      expect(result.outputPath).toContain('graph.svg');
      expect(fs.existsSync(result.outputPath)).toBe(true);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('empty graph returns valid empty SVG', () => {
    const g = new DependencyGraph();
    const exporter = new GraphExporter(g, '/fake');
    const svg = exporter.toSVG();
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });
});

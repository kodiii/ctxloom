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

  it('returns well-formed XML for empty graph', () => {
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
    // src/auth/user.ts imports session.ts and token.ts → slug is src__auth__user.ts
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

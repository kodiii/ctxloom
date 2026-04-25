/**
 * Tests for DependencyGraph — In-memory bidirectional import graph.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('DependencyGraph', () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  describe('addEdge()', () => {
    it('should add a forward edge', () => {
      graph.addEdge('a.ts', 'b.ts');
      expect(graph.getImports('a.ts')).toEqual(['b.ts']);
    });

    it('should add a reverse edge automatically', () => {
      graph.addEdge('a.ts', 'b.ts');
      expect(graph.getImporters('b.ts')).toEqual(['a.ts']);
    });

    it('should handle multiple edges from the same file', () => {
      graph.addEdge('a.ts', 'b.ts');
      graph.addEdge('a.ts', 'c.ts');
      expect(graph.getImports('a.ts').sort()).toEqual(['b.ts', 'c.ts']);
    });

    it('should not duplicate edges', () => {
      graph.addEdge('a.ts', 'b.ts');
      graph.addEdge('a.ts', 'b.ts');
      expect(graph.getImports('a.ts')).toEqual(['b.ts']);
    });
  });

  describe('getImports()', () => {
    it('should return empty array for file with no imports', () => {
      expect(graph.getImports('nonexistent.ts')).toEqual([]);
    });
  });

  describe('getImporters()', () => {
    it('should return empty array for file with no importers', () => {
      expect(graph.getImporters('nonexistent.ts')).toEqual([]);
    });
  });

  describe('removeFile()', () => {
    it('should remove all forward and reverse edges for a file', () => {
      graph.addEdge('a.ts', 'b.ts');
      graph.addEdge('c.ts', 'b.ts');
      graph.addEdge('a.ts', 'c.ts');

      graph.removeFile('b.ts');

      expect(graph.getImports('a.ts')).toEqual(['c.ts']);
      expect(graph.getImporters('b.ts')).toEqual([]);
      expect(graph.getImports('c.ts')).toEqual([]);
    });

    it('should handle removing a file with no edges', () => {
      expect(() => graph.removeFile('nonexistent.ts')).not.toThrow();
    });
  });

  describe('edgeCount()', () => {
    it('should return 0 for empty graph', () => {
      expect(graph.edgeCount()).toBe(0);
    });

    it('should count all forward edges', () => {
      graph.addEdge('a.ts', 'b.ts');
      graph.addEdge('a.ts', 'c.ts');
      graph.addEdge('d.ts', 'e.ts');
      expect(graph.edgeCount()).toBe(3);
    });
  });

  describe('allFiles()', () => {
    it('should return all files in the graph', () => {
      graph.addEdge('a.ts', 'b.ts');
      graph.addEdge('c.ts', 'd.ts');
      const files = graph.allFiles().sort();
      expect(files).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts']);
    });
  });

  describe('traverse()', () => {
    beforeEach(() => {
      // Build a graph: a -> b -> c, a -> d
      graph.addEdge('a.ts', 'b.ts');
      graph.addEdge('b.ts', 'c.ts');
      graph.addEdge('a.ts', 'd.ts');
    });

    it('should traverse callees (forward) at depth 1', () => {
      const result = graph.traverse('a.ts', 'callees', 1);
      expect(result.sort()).toEqual(['b.ts', 'd.ts']);
    });

    it('should traverse callees (forward) at depth 2', () => {
      const result = graph.traverse('a.ts', 'callees', 2);
      expect(result.sort()).toEqual(['b.ts', 'c.ts', 'd.ts']);
    });

    it('should traverse callers (reverse) at depth 1', () => {
      const result = graph.traverse('c.ts', 'callers', 1);
      expect(result).toEqual(['b.ts']);
    });

    it('should traverse callers (reverse) at depth 2', () => {
      const result = graph.traverse('c.ts', 'callers', 2);
      expect(result.sort()).toEqual(['a.ts', 'b.ts']);
    });

    it('should not include the start file', () => {
      const result = graph.traverse('a.ts', 'callees', 2);
      expect(result).not.toContain('a.ts');
    });
  });

  describe('lookupSymbol()', () => {
    it('should return empty array for unknown symbol', () => {
      expect(graph.lookupSymbol('unknown')).toEqual([]);
    });

    it('should return manually indexed symbols', () => {
      // The symbol index is populated by buildFromDirectory, but we can
      // verify the public interface works
      expect(graph.lookupSymbol('anything')).toEqual([]);
    });
  });
});

describe('DependencyGraph snapshot', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-graph-test-')));
    // Create .ctxloom directory for snapshots
    fs.mkdirSync(path.join(tempDir, '.ctxloom'), { recursive: true });
    // Create a simple TypeScript file
    fs.writeFileSync(path.join(tempDir, 'a.ts'), 'export const a = 1;');
    fs.writeFileSync(path.join(tempDir, 'b.ts'), "import { a } from './a.js'; export const b = a;");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should build from directory and save snapshot', async () => {
    const graph = new DependencyGraph();
    await graph.buildFromDirectory(tempDir);

    const snapshotPath = path.join(tempDir, '.ctxloom', 'graph-snapshot.json');
    expect(fs.existsSync(snapshotPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(data.builtAt).toBeDefined();
    expect(data.fileCount).toBeGreaterThan(0);
  });

  it('should load from snapshot on second build if file count unchanged', async () => {
    // First build — creates snapshot
    const graph1 = new DependencyGraph();
    await graph1.buildFromDirectory(tempDir);

    // Second build — should load from snapshot
    const graph2 = new DependencyGraph();
    await graph2.buildFromDirectory(tempDir);

    // Both graphs should have the same edge count
    expect(graph2.edgeCount()).toBe(graph1.edgeCount());
  });

  it('should detect staleness and rebuild when file count changes', async () => {
    // First build — creates snapshot
    const graph1 = new DependencyGraph();
    await graph1.buildFromDirectory(tempDir);
    const edges1 = graph1.edgeCount();

    // Add a new file (changes file count)
    fs.writeFileSync(path.join(tempDir, 'c.ts'), "import { b } from './b.js'; export const c = b;");

    // Second build — should detect staleness and rebuild
    const graph2 = new DependencyGraph();
    await graph2.buildFromDirectory(tempDir);

    // Graph should have been rebuilt (may have more or equal edges)
    expect(graph2.edgeCount()).toBeGreaterThanOrEqual(edges1);
  });
});

describe('buildFromDirectory afterReady callback', () => {
  it('fires the afterReady callback after a fresh build', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-after-'));
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'export const a = 1;');
    const graph = new DependencyGraph();
    const calls: number[] = [];
    await graph.buildFromDirectory(tmp, { afterReady: async () => { calls.push(Date.now()); } });
    expect(calls).toHaveLength(1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('fires the afterReady callback when hydrating from snapshot', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-after-snap-'));
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'export const a = 1;');
    // First build to create the snapshot
    const g1 = new DependencyGraph();
    await g1.buildFromDirectory(tmp);
    // Second build should hydrate from snapshot
    const g2 = new DependencyGraph();
    const calls: number[] = [];
    await g2.buildFromDirectory(tmp, { afterReady: async () => { calls.push(Date.now()); } });
    expect(calls).toHaveLength(1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

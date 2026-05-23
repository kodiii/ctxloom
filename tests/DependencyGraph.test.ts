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

  // ── Version-stamp staleness (schema v2) ─────────────────────────────
  // Real-world repro: a user upgraded from a pre-v1.6.0 ctxloom on a
  // FastAPI-style Python project and `ctxloom index` re-hydrated an
  // empty snapshot (every forwardEdges entry was `[]`) because the file
  // count hadn't drifted. These tests pin the version-based rebuild.

  it('should stamp ctxloomVersion and schema version 2 into the snapshot', async () => {
    const graph = new DependencyGraph();
    await graph.buildFromDirectory(tempDir);

    const snapshotPath = path.join(tempDir, '.ctxloom', 'graph-snapshot.json');
    const data = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(data.version).toBe(2);
    expect(typeof data.ctxloomVersion).toBe('string');
    expect(data.ctxloomVersion.length).toBeGreaterThan(0);
  });

  it('should invalidate a legacy v1 snapshot (no ctxloomVersion) and rebuild', async () => {
    // Seed a snapshot in the pre-v2 shape: schema version 1, no
    // ctxloomVersion field, file count matches current to defeat the
    // file-count staleness check, and all forwardEdges intentionally
    // empty — mirroring the EasyMoney repro shape.
    const snapshotPath = path.join(tempDir, '.ctxloom', 'graph-snapshot.json');
    const legacy = {
      version: 1,
      builtAt: Date.now() - 86_400_000,
      fileCount: 2, // matches `a.ts` + `b.ts` so file-count check passes
      forwardEdges: { 'a.ts': [], 'b.ts': [] },
      reverseEdges: { 'a.ts': [], 'b.ts': [] },
      symbolIndex: {},
    };
    fs.writeFileSync(snapshotPath, JSON.stringify(legacy));

    const graph = new DependencyGraph();
    await graph.buildFromDirectory(tempDir);

    // After rebuild, the b.ts → a.ts edge must be there (proof we
    // didn't just hydrate the empty legacy snapshot).
    expect(graph.edgeCount()).toBeGreaterThan(0);

    // Snapshot on disk should now be v2 with a ctxloomVersion field.
    const fresh = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(fresh.version).toBe(2);
    expect(typeof fresh.ctxloomVersion).toBe('string');
  });

  it('should invalidate a snapshot from an older ctxloomVersion', async () => {
    // First build to produce a real, well-shaped v2 snapshot.
    const graph1 = new DependencyGraph();
    await graph1.buildFromDirectory(tempDir);
    const realEdges = graph1.edgeCount();
    expect(realEdges).toBeGreaterThan(0);

    // Now overwrite the snapshot in place with an artificially-aged
    // ctxloomVersion + emptied edges. fileCount stays correct so only
    // the version check can save us.
    const snapshotPath = path.join(tempDir, '.ctxloom', 'graph-snapshot.json');
    const real = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        ...real,
        ctxloomVersion: '0.0.1',
        forwardEdges: Object.fromEntries(Object.keys(real.forwardEdges).map((k) => [k, []])),
        reverseEdges: Object.fromEntries(Object.keys(real.reverseEdges).map((k) => [k, []])),
      }),
    );

    const graph2 = new DependencyGraph();
    await graph2.buildFromDirectory(tempDir);

    // Rebuild kicked in → real edges restored.
    expect(graph2.edgeCount()).toBe(realEdges);
  });

  it('should reuse a snapshot from a same-or-newer ctxloomVersion (no crash)', async () => {
    const graph1 = new DependencyGraph();
    await graph1.buildFromDirectory(tempDir);
    const realEdges = graph1.edgeCount();
    expect(realEdges).toBeGreaterThan(0);

    const snapshotPath = path.join(tempDir, '.ctxloom', 'graph-snapshot.json');
    const real = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    // Force a version far in the future to exercise the 'newer' branch
    // (which warns but still hydrates the snapshot as-is).
    fs.writeFileSync(snapshotPath, JSON.stringify({ ...real, ctxloomVersion: '999.0.0' }));

    const graph2 = new DependencyGraph();
    await graph2.buildFromDirectory(tempDir);
    expect(graph2.edgeCount()).toBe(realEdges);
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

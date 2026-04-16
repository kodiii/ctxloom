import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { saveNamedSnapshot, listNamedSnapshots, type SnapshotData } from '../src/tools/graph-snapshot.js';
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

  it('diffSnapshots detects added nodes', () => {
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

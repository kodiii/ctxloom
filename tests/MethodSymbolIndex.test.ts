/**
 * Regression test: class methods must be findable via lookupSymbol.
 *
 * Bug (found in the 34-tool smoke test): ctx_get_call_graph {symbol:
 * "getRootDir"} returned "Symbol not found in graph index" even though
 * the call-graph snapshot HAD edges for getRootDir. Root cause: TS/JS
 * class methods are parsed onto the class node's `methodRanges`, NOT as
 * standalone `method` ParsedNodes — so the `node.type === 'method'`
 * branch in DependencyGraph's symbol-indexing loop never fired for them.
 * Methods were absent from symbolIndex, so lookupSymbol() (which
 * ctx_get_call_graph uses to resolve the start file) returned [].
 *
 * Fix: indexClassMethods() iterates node.methodRanges and registers
 * each method name. This test pins that a method on a class is
 * resolvable after buildFromDirectory.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DependencyGraph } from '../packages/core/src/graph/DependencyGraph.js';

describe('class method symbol indexing', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ctx-method-idx-'));
    writeFileSync(
      join(root, 'graph.ts'),
      [
        'export class DependencyGraph {',
        '  private rootDir = "";',
        '  getRootDir(): string {',
        '    return this.rootDir;',
        '  }',
        '  allFiles(): string[] {',
        '    return [];',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves a class method by name via lookupSymbol (pre-fix: empty)', async () => {
    const graph = new DependencyGraph();
    await graph.buildFromDirectory(root);

    const defs = graph.lookupSymbol('getRootDir');
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].filePath).toBe('graph.ts');
    expect(defs[0].type).toBe('method');
  });

  it('resolves a second method on the same class', async () => {
    const graph = new DependencyGraph();
    await graph.buildFromDirectory(root);

    expect(graph.lookupSymbol('allFiles').length).toBeGreaterThan(0);
  });

  it('still indexes the class itself', async () => {
    const graph = new DependencyGraph();
    await graph.buildFromDirectory(root);

    const cls = graph.lookupSymbol('DependencyGraph');
    expect(cls.length).toBeGreaterThan(0);
    expect(cls[0].type).toBe('class');
  });

  it('returns empty for a genuinely absent symbol (no false positives)', async () => {
    const graph = new DependencyGraph();
    await graph.buildFromDirectory(root);

    expect(graph.lookupSymbol('noSuchMethodAnywhere')).toEqual([]);
  });
});

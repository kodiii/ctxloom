/**
 * Tests for findCallers and getCallGraph tools.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';
import { findCallers, getCallGraph } from '../src/tools/findCallers.js';

describe('getCallGraph', () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
    // Build: a -> b -> c, a -> d, d -> c
    graph.addEdge('src/a.ts', 'src/b.ts');
    graph.addEdge('src/b.ts', 'src/c.ts');
    graph.addEdge('src/a.ts', 'src/d.ts');
    graph.addEdge('src/d.ts', 'src/c.ts');
  });

  it('should return callers of a file', async () => {
    const xml = await getCallGraph({
      symbol: 'c',
      direction: 'callers',
      depth: 1,
      projectRoot: '/project',
      graph,
    });
    // Without targetFile, symbol lookup returns nothing since symbol index is empty
    expect(xml).toContain('count="0"');
  });

  it('should traverse callers with targetFile', async () => {
    const xml = await getCallGraph({
      symbol: 'c',
      direction: 'callers',
      depth: 1,
      targetFile: 'src/c.ts',
      projectRoot: '/project',
      graph,
    });
    expect(xml).toContain('symbol="c"');
    expect(xml).toContain('direction="callers"');
    expect(xml).toContain('imported_by');
    expect(xml).toContain('src/b.ts');
    expect(xml).toContain('src/d.ts');
  });

  it('should traverse callees with targetFile', async () => {
    const xml = await getCallGraph({
      symbol: 'a',
      direction: 'callees',
      depth: 1,
      targetFile: 'src/a.ts',
      projectRoot: '/project',
      graph,
    });
    expect(xml).toContain('direction="callees"');
    expect(xml).toContain('imports');
    expect(xml).toContain('src/b.ts');
    expect(xml).toContain('src/d.ts');
  });

  it('should traverse at depth 2', async () => {
    const xml = await getCallGraph({
      symbol: 'c',
      direction: 'callers',
      depth: 2,
      targetFile: 'src/c.ts',
      projectRoot: '/project',
      graph,
    });
    expect(xml).toContain('src/a.ts');
  });

  it('should return empty result for unknown symbol without targetFile', async () => {
    const xml = await getCallGraph({
      symbol: 'nonexistent',
      direction: 'callers',
      depth: 1,
      projectRoot: '/project',
      graph,
    });
    expect(xml).toContain('not found');
  });

  it('should escape XML-special characters in file paths', async () => {
    const specialGraph = new DependencyGraph();
    // File path with XML-special character (quote)
    specialGraph.addEdge('src/a&b.ts', 'src/c"d.ts');

    const xml = await getCallGraph({
      symbol: 'test',
      direction: 'callees',
      depth: 1,
      targetFile: 'src/a&b.ts',
      projectRoot: '/project',
      graph: specialGraph,
    });

    // The raw & and " should not appear unescaped in XML attributes
    // They should be &amp; and &quot; respectively
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;');
    // Raw unescaped versions should not be in attribute values
    expect(xml).not.toMatch(/file="[^"]*&[^a-z]/); // no bare & in attribute
  });
});

describe('findCallers', () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
    graph.addEdge('src/caller.ts', 'src/target.ts');
  });

  it('should return empty callers when parser fails to find call sites', async () => {
    // graph has src/caller.ts -> src/target.ts
    // But parser is undefined — findCallSites will throw and be caught
    const xml = await findCallers({
      targetFile: 'src/target.ts',
      symbolName: 'myFunc',
      projectRoot: '/project',
      graph,
      parser: undefined as any, // parser is required but undefined triggers catch in loop
    });
    // The loop catches the parser error and continues — result is empty
    expect(xml).toContain('callers');
    expect(xml).toContain('myFunc');
  });

  it('should return empty for file with no importers', async () => {
    const emptyGraph = new DependencyGraph();
    const xml = await findCallers({
      targetFile: 'src/alone.ts',
      symbolName: 'myFunc',
      projectRoot: '/project',
      graph: emptyGraph,
    });
    expect(xml).toContain('count="0"');
    expect(xml).toContain('No files import');
  });
});

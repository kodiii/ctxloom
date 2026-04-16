import { describe, it, expect } from 'vitest';
import { findLargeFunctions, type LargeFunctionResult } from '../src/tools/find-large-functions.js';
import { DependencyGraph } from '../src/graph/DependencyGraph.js';

describe('FindLargeFunctions', () => {
  function makeGraph(): DependencyGraph {
    const g = new DependencyGraph();
    g.addSymbol('src/big.ts',   { name: 'BigClass',  type: 'class',    signature: 'class BigClass',      startLine: 1,   endLine: 250 });
    g.addSymbol('src/small.ts', { name: 'SmallClass', type: 'class',   signature: 'class SmallClass',    startLine: 1,   endLine: 30  });
    g.addSymbol('src/utils.ts', { name: 'giantFn',   type: 'function', signature: 'function giantFn()',  startLine: 5,   endLine: 110 });
    g.addSymbol('src/utils.ts', { name: 'tinyFn',    type: 'function', signature: 'function tinyFn()',   startLine: 115, endLine: 120 });
    return g;
  }

  it('returns symbols over the threshold sorted by line count descending', () => {
    const results = findLargeFunctions(makeGraph(), 50);
    expect(results.length).toBe(2);
    expect(results[0].name).toBe('BigClass');
    expect(results[0].lineCount).toBe(250);
    expect(results[1].name).toBe('giantFn');
  });

  it('returns empty when nothing exceeds the threshold', () => {
    expect(findLargeFunctions(makeGraph(), 300)).toHaveLength(0);
  });

  it('respects file filter when provided', () => {
    const results = findLargeFunctions(makeGraph(), 50, 'src/big.ts');
    expect(results.every(r => r.filePath === 'src/big.ts')).toBe(true);
  });

  it('includes line count in results', () => {
    const results = findLargeFunctions(makeGraph(), 50);
    expect(results[0]).toMatchObject({
      name: expect.any(String),
      lineCount: expect.any(Number),
      filePath: expect.any(String),
    });
  });
});
